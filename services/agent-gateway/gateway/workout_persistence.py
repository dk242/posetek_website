"""V3 prescription persistence. Athlete evidence is read-only throughout this module.

All prescription writes use Firestore's real transactional retry protocol. Frequency
assembly is optimistic: a schedule revision brackets ordinary collection reads and
is checked again inside the commit, so a retry never reuses stale reservations.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import uuid
from typing import Any

from google.cloud.firestore_v1.transaction import transactional
from gateway.authz import authorize_v3
from gateway.errors import GatewayError, invalid_request, context_unavailable, permission_denied

DOCUMENT_LIMIT = 900 * 1024
_CONTEXT_INLINE_LIMIT = 400 * 1024
_MAX_REASSEMBLY = 5


def _now(inv):
    return inv.context.get('_now') or inv.context.get('now') or datetime.now(timezone.utc)


def _json_default(value):
    if isinstance(value, datetime):
        return value.isoformat()
    raise TypeError(f'Unsupported persisted value {type(value).__name__}')


def _bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), default=_json_default).encode('utf-8')


def document_size(value):
    """Conservative UTF-8 and protobuf measurement, with document/name overhead."""
    from google.cloud.firestore_v1._helpers import encode_dict
    from google.cloud.firestore_v1.types.document import Document
    encoded = Document(fields=encode_dict(value))._pb.ByteSize()
    return max(len(_bytes(value)), encoded) + 1024


def enforce_document_size(value, label='document'):
    size = document_size(value)
    if size > DOCUMENT_LIMIT:
        raise GatewayError('validation_failed', f'{label} exceeds the 900 KiB persistence limit ({size} bytes)')
    return size


def _id(value, name):
    if not isinstance(value, str) or not value or '/' in value or value in ('.', '..') or len(value.encode('utf-8')) > 180:
        raise invalid_request(f'{name} must be a plain document id of at most 180 UTF-8 bytes')
    return value


def _read(ref, transaction=None):
    if hasattr(ref, 'stream'):
        return list(ref.stream(transaction=transaction)) if transaction else list(ref.stream())
    return ref.get(transaction=transaction) if transaction else ref.get()


def _data(snap):
    return (snap.to_dict() or {}) if snap.exists else {}


def _schedule_ref(inv):
    return inv.player_ref().collection('workoutSchedule').document('current')


def _schedule(inv):
    return int(_data(_schedule_ref(inv).get()).get('revision', 0))


def _counter(revision, now):
    return {'schemaVersion': 1, 'revision': revision + 1, 'updatedAt': now}


def _rows(ref):
    return [{'id': s.id, **(s.to_dict() or {})} for s in ref.stream()]


class _ReloadContext(Exception):
    pass


def _evidence(inv):
    return (_rows(inv.player_ref().collection('workoutLogs')),
            _rows(inv.player_ref().collection('plannedWorkouts')))


def _find_workout(plan, workout_id):
    matches = [(week, workout) for week in plan.get('weeks', []) for workout in week.get('workouts', [])
               if workout.get('workoutId') == workout_id]
    if len(matches) != 1:
        raise context_unavailable('The target workout is missing or ambiguous')
    return matches[0]


def _active(plan):
    if plan.get('schemaVersion') != 3:
        raise invalid_request('This operation requires a schemaVersion 3 plan')
    if plan.get('status') != 'active':
        raise GatewayError('validation_failed', 'The plan is no longer active')


def _safe_workout(workout):
    """Allowlist keeps private model/evaluation data out of SSE and public documents."""
    fields = ('workoutId', 'order', 'title', 'intent', 'focusDomains', 'budgetMinutes',
              'estimatedMinutes', 'blocks', 'revision', 'editedBy', 'editedAt', 'editorUid',
              'previousRevision', 'check', 'nextBlockSequence')
    return {k: deepcopy(workout[k]) for k in fields if k in workout}


def _executable(workout):
    return {k: v for k, v in _safe_workout(workout).items() if k != 'previousRevision'}


def _fresh_profile_catalog(inv, plan, drill_ids, read=None):
    from gateway.program_profile import resolve_age, resolve_technical_eligibility
    from gateway.catalog_v2 import normalize_catalog_drill
    load = read or _read
    player = _data(load(inv.player_ref()))
    age_result = resolve_age(player, plan.get('intake') or {}, _now(inv))
    age = age_result[0] if isinstance(age_result, tuple) else age_result.get('age') if isinstance(age_result, dict) else age_result
    profile = deepcopy(inv.context.get('programProfile') or {})
    profile.update(age=age or 10, intake=deepcopy(plan.get('intake') or {}),
                   technicalEligibility=resolve_technical_eligibility(inv.db, inv.player_id, player, read=load))
    catalog = {}
    for drill_id in sorted(set(drill_ids)):
        snap = load(inv.db.collection('drillCatalog').document(_id(drill_id, 'drillId')))
        if not snap.exists:
            raise GatewayError('validation_failed', f'Catalog drill {drill_id} is no longer available')
        catalog[drill_id] = normalize_catalog_drill(drill_id, snap.to_dict() or {})
    return profile, catalog


def _validate(inv, workout, plan, target, logs, reservations, *, read=None, requirements=None):
    from gateway.workout_history import build_frequency_context
    from gateway.workout_tools import validate_workout
    drill_ids = [b.get('drillId') for b in workout.get('blocks', [])]
    profile, catalog = _fresh_profile_catalog(inv, plan, drill_ids, read)
    fold_target = deepcopy(target)
    retained_ids = None
    if target.get('kind') == 'adhoc':
        reservation = next((r for r in reservations if (r.get('id') or r.get('workoutId')) == target['plannedWorkoutId']), {})
        fold_target['weekNumber'] = reservation.get('weekNumber')
        retained_ids = {b.get('drillId') for b in reservation.get('blocks', [])}
    frequency = build_frequency_context(plan, fold_target, logs, reservations, now=_now(inv))
    if frequency.get('coverage') != 'complete':
        raise context_unavailable('Workout frequency evidence is incomplete; resolve its week before committing')
    # Commit-time eligibility must use the same partner semantics generation
    # used (program_generator.run_program). `False` here is not "derive it from
    # the setting": eligible_drill treats an explicit False as a hard deny, so a
    # `setting: "partner"` plan built from partner drills was rejected at commit.
    check = validate_workout(workout, catalog, profile, frequency=frequency['counts'], plan=plan, target=target,
                            allow_partner=(plan.get('intake') or {}).get('setting') in ('partner', 'halfAndHalf'),
                            retained_drill_ids=retained_ids)
    from gateway.workout_requirements import with_requirements
    check = with_requirements(check, workout, requirements)
    if not check.get('ok'):
        raise GatewayError('validation_failed', 'Workout failed current validation: ' + '; '.join(map(str, check.get('violations') or check.get('notes') or [check])))
    return check, profile, catalog, frequency


def _context_record(inv, plan, private_context):
    originals = {w['workoutId']: _executable(w) for week in plan['weeks'] for w in week['workouts']}
    value = deepcopy(private_context)
    value.update(schemaVersion=1, playerId=inv.player_id, planId=plan['planId'],
                 originalWorkouts=originals, intake=deepcopy(plan['intake']),
                 assessment=deepcopy(plan.get('assessment') or {}), createdAt=_now(inv))
    # Used rows are durable, even when the caller supplied only stage diagnostics.
    ids = {b['drillId'] for w in originals.values() for b in w['blocks']}
    cached = (inv.context.get('workoutContext') or {}).get('catalog') or inv.context.get('catalogV2') or {}
    _, fresh_rows = _fresh_profile_catalog(inv, plan, ids)
    value['catalogRows'] = deepcopy(private_context.get('catalogRows') or {did: cached.get(did, fresh_rows[did]) for did in ids})
    if document_size(value) <= _CONTEXT_INLINE_LIMIT:
        return value
    raw = _bytes(value)
    digest = hashlib.sha256(raw).hexdigest()
    path = f'trainingPlanContexts/{inv.player_id}/{plan["planId"]}/{digest}.json'
    if not hasattr(inv.storage, 'upload_immutable_json'):
        raise context_unavailable('Private immutable artifact storage is required for this generation context')
    inv.storage.upload_immutable_json(path, value)
    return {'schemaVersion': 1, 'playerId': inv.player_id, 'planId': plan['planId'],
            'artifactRef': {'path': path, 'sha256': digest}, 'createdAt': _now(inv),
            **({'engineVersion': private_context['engineVersion']} if private_context.get('engineVersion') else {})}


def load_generation_context(inv, plan):
    expected = f'players/{inv.player_id}/trainingPlanContexts/{_id(plan.get("planId"), "planId")}'
    if plan.get('generationContextRef') != expected:
        raise context_unavailable('The original generation context is unavailable')
    record = _data(inv.db.document(expected).get())
    if not record:
        raise context_unavailable('The original generation context is missing')
    if record.get('artifactRef'):
        ref = record['artifactRef']
        prefix = f'trainingPlanContexts/{inv.player_id}/{plan["planId"]}/'
        if not isinstance(ref.get('path'), str) or not ref['path'].startswith(prefix):
            raise context_unavailable('Invalid private generation artifact reference')
        try:
            record = inv.storage.download_json(ref['path'])
        except (FileNotFoundError, ValueError) as exc:
            raise context_unavailable('The original generation artifact is missing') from exc
        if hashlib.sha256(_bytes(record)).hexdigest() != ref.get('sha256'):
            raise context_unavailable('The original generation artifact failed its integrity check')
    if record.get('playerId') != inv.player_id or record.get('planId') != plan['planId']:
        raise context_unavailable('The original generation context belongs to another target')
    return record


def load_original_workout(inv, plan, workout_id):
    authorize_v3(inv)
    original = (load_generation_context(inv, plan).get('originalWorkouts') or {}).get(workout_id)
    if not isinstance(original, dict):
        raise context_unavailable('The original generated workout is missing; recover generation evidence before editing')
    return _executable(original)


def persist_program(inv, plan, private_context):
    """Create the program and immutable original evidence atomically; supersede active plans."""
    authorize_v3(inv)
    plan = deepcopy(plan)
    # New native v3 plans cross the same explicit privacy boundary as reviewed
    # web plans. Original evidence remains only in the server-owned context.
    if (plan.get('assessment') or {}).get('methodologyVersion') == 'evidence-objectives-v1':
        from gateway.personalized_views import public_plan
        plan = public_plan(plan)
    from gateway.personalized_composition import CURRENT_ENGINE_VERSION
    plan['engineVersion'] = CURRENT_ENGINE_VERSION
    private_context = {**private_context, 'engineVersion': CURRENT_ENGINE_VERSION}
    plan_id = plan.get('planId') or ('p_' + hashlib.sha256(inv.job_id.encode()).hexdigest()[:28] if inv.job_id else uuid.uuid4().hex)
    _id(plan_id, 'planId')
    plan.update(planId=plan_id, playerId=inv.player_id, jobId=inv.job_id, schemaVersion=3,
                status='active', planRevision=1, lastEdit=None, generatedAt=_now(inv), updatedAt=_now(inv),
                generationContextRef=f'players/{inv.player_id}/trainingPlanContexts/{plan_id}')
    plan_ref = inv.player_ref().collection('trainingPlans').document(plan_id)
    context_ref = inv.player_ref().collection('trainingPlanContexts').document(plan_id)
    for week in plan['weeks']:
        for workout in week['workouts']:
            if not workout.get('check') or workout['check'].get('intentStatus') not in ('pass', 'warn'):
                raise GatewayError('validation_failed', 'Generation requires a completed adversarial check')
            workout.update(revision=1, editedBy='generator', editorUid=None, editedAt=_now(inv), previousRevision=None)
    enforce_document_size(plan, 'plan')
    private_context = deepcopy(private_context)
    ids = {b['drillId'] for week in plan['weeks'] for w in week['workouts'] for b in w['blocks']}
    cached = (inv.context.get('workoutContext') or {}).get('catalog') or inv.context.get('catalogV2') or {}
    _, fresh_rows = _fresh_profile_catalog(inv, plan, ids)
    private_context['catalogRows'] = {did: deepcopy(cached.get(did, fresh_rows[did])) for did in ids}
    record = _context_record(inv, plan, private_context)
    enforce_document_size(record, 'generation context')
    for _ in range(_MAX_REASSEMBLY):
        revision = _schedule(inv)
        logs, reservations = _evidence(inv)
        if _schedule(inv) != revision:
            continue
        @transactional
        def commit(tx):
            read = lambda ref: _read(ref, tx)
            authorize_v3(inv, read=read)
            existing = _data(read(plan_ref))
            existing_context = _data(read(context_ref))
            if existing:
                if existing.get('jobId') == inv.job_id and existing_context:
                    return existing
                raise GatewayError('validation_failed', 'A different plan already uses this id')
            if existing_context:
                raise GatewayError('validation_failed', 'Generation evidence already exists without its plan; recover it before retrying')
            current_revision = int(_data(read(_schedule_ref(inv))).get('revision', 0))
            if current_revision != revision:
                raise _ReloadContext()
            active = read(inv.player_ref().collection('trainingPlans').where('status', '==', 'active'))
            if private_context.get('methodologyVersion') == 'evidence-objectives-v1':
                from gateway.personalized_evidence import read_authoritative_results, read_estimates
                fresh_evidence = read_authoritative_results(inv, read=read)
                _, fresh_estimates = read_estimates(inv, read=read, evidence=fresh_evidence)
                if (_bytes(fresh_evidence['private']) != _bytes(private_context.get('authoritativeEvidence', {}))
                        or _bytes(fresh_estimates) != _bytes(private_context.get('conditionalEvidence', {}))):
                    raise GatewayError('validation_failed', 'Testing or conditional evidence changed during generation; generate a fresh plan.')
            for week in plan['weeks']:
                for workout in week['workouts']:
                    target = {'kind': 'plan', 'planId': plan_id, 'workoutId': workout['workoutId'], 'baseRevision': 1}
                    _, _, current_rows, _ = _validate(inv, workout, plan, target, logs, reservations, read=read)
                    if any(_bytes(row) != _bytes(private_context['catalogRows'][did]) for did, row in current_rows.items()):
                        raise GatewayError('validation_failed', 'The catalog changed during generation; regenerate against the current catalog')
            # Every read precedes every write: compatible with Firestore transactions.
            for snap in active:
                tx.update(inv.player_ref().collection('trainingPlans').document(snap.id), {'status': 'superseded', 'updatedAt': _now(inv)})
            tx.create(context_ref, record)
            tx.create(plan_ref, plan)
            tx.set(_schedule_ref(inv), _counter(revision, _now(inv)))
            return deepcopy(plan)
        try:
            return commit(inv.db.transaction())
        except _ReloadContext:
            continue
    raise GatewayError('validation_failed', 'The workout schedule kept changing; retry generation')


def _target_key(target):
    return {k: target[k] for k in ('kind', 'planId', 'workoutId', 'plannedWorkoutId', 'weekNumber') if k in target}


def assemble_workout_context(inv):
    """Server-bind client target and revision, then load a stable frequency snapshot."""
    authorize_v3(inv)
    request_context = inv.params.get('context') or {}
    if not isinstance(request_context, dict):
        raise invalid_request('context must be an object')
    requested = request_context.get('workoutRef')
    if not isinstance(requested, dict) or requested.get('kind') not in ('plan', 'adhoc', 'new'):
        raise invalid_request('context.workoutRef requires a plan, adhoc or new target')
    if 'baseRevision' in requested:
        raise invalid_request('The server captures target baseRevision')
    allowed = {'plan': {'kind', 'planId', 'workoutId'}, 'adhoc': {'kind', 'plannedWorkoutId', 'planId'},
               'new': {'kind', 'planId', 'timeAvailableMinutes', 'energy'}}[requested['kind']]
    if set(requested) - allowed:
        raise invalid_request('workoutRef contains unsupported fields')
    if requested['kind'] == 'new':
        minutes = requested.get('timeAvailableMinutes')
        if type(minutes) is not int or not 1 <= minutes <= 135 or requested.get('energy') not in ('low', 'normal', 'high'):
            raise invalid_request('New workouts require integer timeAvailableMinutes 1..135 and low/normal/high energy')
    for _ in range(_MAX_REASSEMBLY):
        revision = _schedule(inv)
        requested = deepcopy(requested)
        adhoc = None
        if requested['kind'] == 'adhoc':
            aid = _id(requested.get('plannedWorkoutId'), 'plannedWorkoutId')
            adhoc = _data(inv.player_ref().collection('plannedWorkouts').document(aid).get())
            if not adhoc:
                raise context_unavailable('The ad-hoc workout is unavailable')
            requested['planId'] = adhoc.get('planId')
        plan_id = _id(requested.get('planId'), 'planId')
        plan = _data(inv.player_ref().collection('trainingPlans').document(plan_id).get())
        _active(plan)
        target = {'kind': requested['kind'], 'planId': plan_id}
        current = None
        if target['kind'] == 'plan':
            wid = _id(requested.get('workoutId'), 'workoutId')
            week, current = _find_workout(plan, wid)
            target.update(workoutId=wid, baseRevision=current['revision'])
            week_number = week['weekNumber']
            load_original_workout(inv, plan, wid)
        elif target['kind'] == 'adhoc':
            target.update(plannedWorkoutId=adhoc['workoutId'], baseRevision=adhoc.get('revision', 1))
            current, week_number = adhoc, adhoc['weekNumber']
            if inv.player_ref().collection('workoutLogs').document(adhoc['workoutId']).get().exists:
                raise GatewayError('validation_failed', 'A logged ad-hoc workout is frozen; create a new workout')
        else:
            from gateway.assemblers import _current_week_number
            week_number = _current_week_number(plan['startDate'], plan['horizonWeeks'], plan['timezone'], now=_now(inv))
            target['weekNumber'] = week_number
        logs, reservations = _evidence(inv)
        if _schedule(inv) != revision:
            continue
        from gateway.catalog_v2 import load_catalog
        from gateway.workout_history import build_frequency_context
        frequency = build_frequency_context(plan, {**target, 'weekNumber': week_number}, logs, reservations, now=_now(inv))
        if frequency.get('coverage') != 'complete':
            raise context_unavailable('Weekly frequency cannot be enforced from incomplete dated evidence.')
        profile, _ = _fresh_profile_catalog(inv, plan, [])
        inv.context['programProfile'] = profile
        context = {'plan': plan, 'target': target, 'weekNumber': week_number, 'workout': current,
                   'frequency': frequency['counts'], 'frequencyWindow': frequency,
                   'catalog': load_catalog(inv), 'scheduleRevision': revision,
                   'timeAvailableMinutes': requested.get('timeAvailableMinutes'), 'energy': requested.get('energy', 'normal'),
                   'allowPartner': (plan.get('intake') or {}).get('setting') in ('partner', 'halfAndHalf')}
        inv.context['workoutContext'] = context
        if request_context.get('draftId'):
            resume_workout_draft(inv, request_context['draftId'])
        return context
    raise GatewayError('validation_failed', 'The workout schedule kept changing; retry')


def _check_draft_owner(inv, draft, *, proposed=True):
    if draft.get('playerId') != inv.player_id or draft.get('createdByUid') != inv.uid:
        raise permission_denied('The draft belongs to another player or creator')
    if proposed and draft.get('status') != 'proposed':
        raise GatewayError('validation_failed', 'The draft is no longer proposed')
    expiry = draft.get('expiresAt')
    if isinstance(expiry, str):
        expiry = datetime.fromisoformat(expiry.replace('Z', '+00:00'))
    if proposed and (not isinstance(expiry, datetime) or expiry <= _now(inv)):
        raise GatewayError('validation_failed', 'The draft expired; make a new proposal')


def resume_workout_draft(inv, draft_id):
    authorize_v3(inv)
    draft_id = _id(draft_id, 'draftId')
    draft = _data(inv.player_ref().collection('workoutDrafts').document(draft_id).get())
    _check_draft_owner(inv, draft)
    if draft.get('conversationId') != inv.conversation_id:
        raise permission_denied('The draft belongs to another conversation')
    bound = (inv.context.get('workoutContext') or {}).get('target')
    if not bound or _target_key(bound) != _target_key(draft.get('target') or {}):
        raise invalid_request('A conversation cannot switch workout targets')
    # A newer live revision must not silently rebase the selected proposal.
    if draft['target'].get('baseRevision') != bound.get('baseRevision'):
        raise GatewayError('validation_failed', 'workout changed since the draft was made')
    inv.context['workoutDraft'] = {'target': deepcopy(draft['target']), 'workout': _safe_workout(draft['workout'])}
    inv.context['resumedDraftId'] = draft_id
    from gateway.workout_requirements import derive_requirements
    inv.context['priorWorkoutRequirements'] = deepcopy(draft.get('requestRequirements')) or derive_requirements(
        draft.get('ask', ''), (inv.context.get('workoutContext') or {}).get('workout') or {})
    return {'draftId': draft_id, 'target': deepcopy(draft['target']), 'workout': _safe_workout(draft['workout']), 'check': deepcopy(draft['check'])}


def persist_workout_draft(inv, ask=None, source_message_id=None):
    """Persist immutable proposal before emitting its allowlisted SSE envelope."""
    authorize_v3(inv, mutation=True)
    envelope = inv.context.get('workoutDraft') or {}
    context = inv.context.get('workoutContext') or {}
    target = envelope.get('target') or context.get('target')
    if not target or target.get('kind') not in ('plan', 'adhoc', 'new') or target != context.get('target'):
        raise invalid_request('The draft must retain its server-bound target')
    _id(inv.conversation_id, 'conversationId')
    ask = ask if ask is not None else inv.params.get('message')
    if not isinstance(ask, str) or not 3 <= len(ask) <= 2000:
        raise invalid_request('The workout request must be 3..2000 characters')
    workout = _safe_workout(envelope.get('workout') or {})
    plan = context['plan']
    requirements = deepcopy(inv.context.get('workoutRequirements'))
    schedule_revision = _schedule(inv)
    logs, reservations = _evidence(inv)
    if _schedule(inv) != schedule_revision:
        raise GatewayError('validation_failed', 'The workout schedule changed; validate the proposal again')
    check, _, _, _ = _validate(inv, workout, plan, target, logs, reservations, requirements=requirements)
    workout['check'] = {k: deepcopy(v) for k, v in check.items() if k != 'ok'}
    workout['check'].update(checkedAt=_now(inv), notes=[])
    ref = inv.player_ref().collection('workoutDrafts').document()
    now = _now(inv)
    payload = {'schemaVersion': 1, 'playerId': inv.player_id, 'createdByUid': inv.uid,
               'conversationId': inv.conversation_id, 'sourceMessageId': source_message_id,
               'ask': ask, 'target': deepcopy(target), 'status': 'proposed', 'createdAt': now,
               'expiresAt': now + timedelta(hours=24), 'workout': workout, 'check': check,
               'catalogVersion': plan.get('catalogVersion'), 'appliedResult': None}
    if requirements:
        payload['requestRequirements'] = requirements
    enforce_document_size(payload, 'draft')
    conversation = inv.player_ref().collection('aiConversations').document(inv.conversation_id)
    resumed_id = inv.context.get('resumedDraftId')
    @transactional
    def commit(tx):
        read = lambda ref: _read(ref, tx)
        authorize_v3(inv, mutation=True, read=read)
        current = _data(read(conversation))
        fresh_plan = _data(read(inv.player_ref().collection('trainingPlans').document(target['planId'])))
        _active(fresh_plan)
        if int(_data(read(_schedule_ref(inv))).get('revision', 0)) != schedule_revision:
            raise GatewayError('validation_failed', 'The workout schedule changed; validate the proposal again')
        if target['kind'] == 'plan':
            _, fresh_workout = _find_workout(fresh_plan, target['workoutId'])
            if fresh_workout.get('revision') != target['baseRevision']:
                raise GatewayError('validation_failed', 'workout changed since the draft was made')
        elif target['kind'] == 'adhoc':
            fresh_workout = _data(read(inv.player_ref().collection('plannedWorkouts').document(target['plannedWorkoutId'])))
            if fresh_workout.get('planId') != target['planId'] or fresh_workout.get('revision') != target['baseRevision']:
                raise GatewayError('validation_failed', 'workout changed since the draft was made')
            if read(inv.player_ref().collection('workoutLogs').document(target['plannedWorkoutId'])).exists:
                raise GatewayError('validation_failed', 'A logged ad-hoc workout is frozen; create a new workout')
        _validate(inv, workout, fresh_plan, target, logs, reservations, read=read, requirements=requirements)
        bound = current.get('workoutTarget')
        if bound and _target_key(bound) != _target_key(target):
            raise invalid_request('A conversation cannot switch workout targets')
        if current.get('createdByUid') not in (None, inv.uid):
            raise permission_denied('The conversation belongs to another creator')
        old_ref = inv.player_ref().collection('workoutDrafts').document(resumed_id) if resumed_id else None
        if old_ref:
            old = _data(read(old_ref)); _check_draft_owner(inv, old)
            if old.get('conversationId') != inv.conversation_id or old.get('target') != target:
                raise permission_denied('The selected proposal belongs to another target')
        tx.set(conversation, {'workoutTarget': _target_key(target), 'createdByUid': inv.uid}, merge=True)
        tx.create(ref, payload)
        if old_ref:
            tx.update(old_ref, {'status': 'superseded', 'supersededBy': ref.id})
        return {'draftId': ref.id, 'target': deepcopy(target), 'workout': workout, 'check': check}
    result = commit(inv.db.transaction())
    inv.context['resumedDraftId'] = ref.id
    return result


def _week_derived(week):
    domains = {}
    exposures = {}
    transitions = 0
    for workout in week['workouts']:
        found = set()
        for block in workout['blocks']:
            domain = block['domain']; found.add(domain)
            domains[domain] = domains.get(domain, 0) + block['estimatedMinutes']
        for domain in found:
            exposures[domain] = exposures.get(domain, 0) + 1
        transitions += max(0, len(workout['blocks']) - 1)
    week['targets'] = [{'domain': d, 'exposures': n} for d, n in sorted(exposures.items())]
    week['actualMinutesByDomain'] = domains
    week['transitionMinutes'] = transitions


def _diff(before, after):
    old = {b['blockId']: b for b in before.get('blocks', [])}
    new = {b['blockId']: b for b in after.get('blocks', [])}
    brief = lambda b: {k: b[k] for k in ('blockId', 'drillId', 'domain')}
    keys = ('sets', 'reps', 'restSeconds', 'restScope', 'restBetweenSetsSeconds', 'familiarizationReps')
    doses = []
    for k in sorted(old.keys() & new.keys()):
        a = {f: old[k].get(f) for f in keys}; b = {f: new[k].get(f) for f in keys}
        if a != b:
            doses.append({'blockId': k, 'drillId': new[k]['drillId'], 'from': a, 'to': b})
    minutes = {}
    for sign, workout in ((-1, before), (1, after)):
        for block in workout.get('blocks', []):
            minutes[block['domain']] = minutes.get(block['domain'], 0) + sign * block['estimatedMinutes']
    return {'added': [brief(new[k]) for k in sorted(new.keys() - old.keys())],
            'removed': [brief(old[k]) for k in sorted(old.keys() - new.keys())], 'doseChanged': doses,
            'reordered': [b['blockId'] for b in before.get('blocks', [])] != [b['blockId'] for b in after['blocks']],
            'minutesDelta': after['estimatedMinutes'] - before.get('estimatedMinutes', 0), 'domainMinutesDelta': minutes}


def apply_workout_draft(inv):
    """Commit one proposal atomically; repeated Apply returns its immutable result."""
    authorize_v3(inv, mutation=True)
    draft_ref = inv.player_ref().collection('workoutDrafts').document(_id(inv.params.get('draftId'), 'draftId'))
    for _ in range(_MAX_REASSEMBLY):
        draft = _data(draft_ref.get()); _check_draft_owner(inv, draft, proposed=False)
        if draft.get('status') == 'applied':
            return deepcopy(draft['appliedResult'])
        _check_draft_owner(inv, draft)
        target = draft['target']
        if target.get('kind') not in ('plan', 'adhoc', 'new'):
            raise invalid_request('Invalid persisted target')
        plan_ref = inv.player_ref().collection('trainingPlans').document(_id(target.get('planId'), 'planId'))
        revision = _schedule(inv)
        plan = _data(plan_ref.get()); _active(plan)
        logs, reservations = _evidence(inv)
        if _schedule(inv) != revision:
            continue
        # Load immutable evidence before the transaction; create-only contexts cannot race edits.
        original_context = load_generation_context(inv, plan)
        new_ref = inv.player_ref().collection('plannedWorkouts').document('draft_' + draft_ref.id)
        @transactional
        def commit(tx):
            read = lambda ref: _read(ref, tx)
            role = authorize_v3(inv, mutation=True, read=read)
            current_draft = _data(read(draft_ref)); _check_draft_owner(inv, current_draft, proposed=False)
            if current_draft.get('status') == 'applied':
                return deepcopy(current_draft['appliedResult'])
            _check_draft_owner(inv, current_draft)
            current_plan = _data(read(plan_ref)); _active(current_plan)
            if int(_data(read(_schedule_ref(inv))).get('revision', 0)) != revision:
                raise _ReloadContext()
            before = {}
            week_number = target.get('weekNumber')
            target_ref = None
            if target['kind'] == 'plan':
                week, before = _find_workout(current_plan, target['workoutId'])
                week_number = week['weekNumber']
                if target['workoutId'] not in original_context.get('originalWorkouts', {}):
                    raise context_unavailable('The original generated workout is missing')
            elif target['kind'] == 'adhoc':
                target_ref = inv.player_ref().collection('plannedWorkouts').document(_id(target.get('plannedWorkoutId'), 'plannedWorkoutId'))
                before = _data(read(target_ref))
                if before.get('planId') != current_plan['planId']:
                    raise GatewayError('validation_failed', 'The ad-hoc target changed')
                week_number = before['weekNumber']
                if read(inv.player_ref().collection('workoutLogs').document(target['plannedWorkoutId'])).exists:
                    raise GatewayError('validation_failed', 'A logged ad-hoc workout is frozen; create a new workout')
            else:
                if not isinstance(week_number, int) or not 1 <= week_number <= current_plan['horizonWeeks']:
                    raise invalid_request('Invalid new-workout week')
                if read(new_ref).exists:
                    raise GatewayError('validation_failed', 'An unexpected reservation already uses the draft id')
            if before and before.get('revision', 1) != target.get('baseRevision'):
                raise GatewayError('validation_failed', 'workout changed since the draft was made')
            workout = _safe_workout(current_draft['workout'])
            if before:
                # A today-only edit never changes slot identity or ordering.
                workout['workoutId'] = before['workoutId']
                workout['order'] = before.get('order', workout.get('order', 1))
                workout['nextBlockSequence'] = max(workout.get('nextBlockSequence', 1), before.get('nextBlockSequence', 1))
            if before:
                known_blocks = {b['blockId']: b['drillId'] for b in before.get('blocks', [])}
                original_blocks = (original_context.get('originalWorkouts', {}).get(target.get('workoutId')) or {}).get('blocks', [])
                original_ids = {b['blockId']: b['drillId'] for b in original_blocks}
                for block in workout.get('blocks', []):
                    bid = block.get('blockId', '')
                    if bid in known_blocks and known_blocks[bid] != block.get('drillId'):
                        raise GatewayError('validation_failed', 'An existing block id cannot be reassigned to another drill')
                    if bid not in known_blocks and bid.startswith('b') and bid[1:].isdigit() and int(bid[1:]) < before.get('nextBlockSequence', 1):
                        if original_ids.get(bid) != block.get('drillId'):
                            raise GatewayError('validation_failed', 'A retired block id cannot be reused for a different drill')
            from gateway.workout_requirements import derive_requirements
            # Older proposals lack the durable contract; recover explicit intent
            # from their server-written ask and revision-bound live workout.
            requirements = current_draft.get('requestRequirements') or derive_requirements(current_draft.get('ask', ''), before)
            check, profile, catalog, frequency = _validate(inv, workout, current_plan, target, logs, reservations, read=read, requirements=requirements)
            if target['kind'] == 'new':
                workout['workoutId'] = new_ref.id
            new_revision = before.get('revision', 0) + 1
            workout.update(revision=new_revision, editedBy=role, editorUid=inv.uid, editedAt=_now(inv),
                           previousRevision=_executable(before) if before else None,
                           check={k: deepcopy(v) for k, v in check.items() if k != 'ok'})
            workout['check'].update(checkedAt=_now(inv), notes=[])
            base_plan_revision = current_plan.get('planRevision', 1)
            new_plan_revision = base_plan_revision + 1 if target['kind'] == 'plan' else base_plan_revision
            adjustment_id = f'{current_plan["planId"]}_r{new_plan_revision}' if target['kind'] == 'plan' else f'adhoc_{draft_ref.id}'
            adjustment_ref = inv.player_ref().collection('planAdjustments').document(adjustment_id)
            if read(adjustment_ref).exists:
                raise GatewayError('validation_failed', 'The adjustment identity already exists')
            original = original_context.get('originalWorkouts', {}).get(target.get('workoutId'), {})
            inputs = (current_plan.get('assessment') or {}).get('inputs') or {}
            snapshot = {k: deepcopy(inputs.get(k)) for k in ('position', 'ageBand', 'level', 'stats', 'peer')}
            feedback = inputs.get('coachFeedback') or {}
            snapshot.update(coachFeedbackPresent=bool(feedback.get('present')), coachFeedbackSha256=feedback.get('textSha256'),
                            focusSplitFinal=(current_plan.get('assessment') or {}).get('focusSplit', {}).get('final'),
                            technicalEligibility=profile.get('technicalEligibility'))
            adjustment = {'schemaVersion': 1, 'planId': current_plan['planId'], 'planSchemaVersion': 3,
                          'weekNumber': week_number, 'workoutId': workout.get('workoutId') or new_ref.id,
                          'editor': {'uid': inv.uid, 'role': role, 'surface': 'gateway'},
                          'baseRevision': before.get('revision', 0), 'newRevision': new_revision,
                          'basePlanRevision': base_plan_revision, 'newPlanRevision': new_plan_revision,
                          'before': _executable(before), 'after': _executable(workout), 'diff': _diff(before, workout),
                          'rationale': current_draft['ask'], 'conversationId': current_draft.get('conversationId'),
                          'generatorIntent': original.get('intent'), 'generatorCheck': original.get('check'),
                          'priorCheck': before.get('check'), 'generationContextRef': current_plan['generationContextRef'],
                          'warningsOverridden': [], 'profileSnapshot': snapshot, 'catalogRows': catalog,
                          'createdAt': _now(inv), 'clientVersion': inv.client_version}
            if target['kind'] == 'plan':
                # week is from the fresh transaction snapshot, preserving every sibling edit.
                week['workouts'] = [workout if w['workoutId'] == workout['workoutId'] else w for w in week['workouts']]
                _week_derived(week)
                current_plan.update(planRevision=new_plan_revision, updatedAt=_now(inv), lastEdit={
                    'workoutId': workout['workoutId'], 'revision': new_revision, 'editedBy': role,
                    'editedAt': _now(inv), 'adjustmentId': adjustment_id})
                enforce_document_size(current_plan, 'plan')
                result = {'applied': True, 'target': {'kind': 'plan', 'planId': current_plan['planId'],
                          'workoutId': workout['workoutId'], 'revision': new_revision}}
                persisted = current_plan
            else:
                wid = before.get('workoutId') or new_ref.id
                workout['workoutId'] = wid
                persisted = {**deepcopy(before), **workout, 'schemaVersion': 2, 'playerId': inv.player_id,
                             'planId': current_plan['planId'], 'weekNumber': week_number, 'source': 'adhoc',
                             'createdVia': 'workout_chat', 'conversationId': current_draft.get('conversationId'),
                             'jobId': inv.job_id, 'generatedAt': before.get('generatedAt', _now(inv)),
                             'catalogVersion': current_plan.get('catalogVersion'), 'status': 'ready',
                             'windowStart': frequency['windowStart'], 'windowEnd': frequency['windowEnd'],
                             'params': {'timeAvailableMinutes': workout['budgetMinutes'], 'ask': current_draft['ask']}}
                enforce_document_size(persisted, 'ad-hoc workout')
                result = {'applied': True, 'target': {'kind': 'adhoc', 'plannedWorkoutId': wid}}
            enforce_document_size(adjustment, 'adjustment')
            updated_draft = {**current_draft, 'status': 'applied', 'appliedResult': result, 'appliedAt': _now(inv)}
            enforce_document_size(updated_draft, 'draft')
            if target['kind'] == 'plan':
                tx.set(plan_ref, persisted)
            elif target_ref:
                tx.set(target_ref, persisted)
            else:
                tx.create(new_ref, persisted)
            tx.create(adjustment_ref, adjustment)
            tx.set(_schedule_ref(inv), _counter(revision, _now(inv)))
            tx.update(draft_ref, {'status': 'applied', 'appliedResult': result, 'appliedAt': _now(inv)})
            return result
        try:
            return commit(inv.db.transaction())
        except _ReloadContext:
            continue
    raise GatewayError('validation_failed', 'The workout schedule kept changing; retry Apply')
