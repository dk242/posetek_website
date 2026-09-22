"""Admin preview drafts and explicit, optimistic, idempotent plan activation.

Neither generation nor discard writes trainingPlans, workoutLogs, or reservations.
The activation transaction rechecks the reviewed state before any writes.
"""
from copy import deepcopy
from datetime import timedelta
import hashlib
from zoneinfo import ZoneInfo
from google.cloud.firestore_v1.transaction import transactional
from gateway.personalized_access import authorize_personalized
from gateway.personalized_views import draft_view, public_plan
from gateway.errors import GatewayError, invalid_request, permission_denied
from gateway.program_profile import resolve_age, resolve_technical_eligibility, compute_peers
from gateway.workout_persistence import (_bytes, _data, _read, _id, _now, _schedule_ref, _counter,
    _context_record, _fresh_profile_catalog, _validate, enforce_document_size)
from gateway.personalized_composition import ENGINE_VERSION, CURRENT_ENGINE_VERSION, allocation_check

GENERATE = 'generate_personalized_plan'
ACTIVATE = 'activate_personalized_plan'
DISCARD = 'discard_personalized_plan'
ASSESS = 'assess_personalized_plan'
CAPABILITIES = (GENERATE, ACTIVATE, DISCARD, ASSESS)


def engine_for(capability, requested=None):
    resolved = ENGINE_VERSION if capability in CAPABILITIES else CURRENT_ENGINE_VERSION
    if requested is not None and requested != resolved:
        raise invalid_request('Unsupported engine version for this operation')
    return resolved


def authorize_admin(inv, read=None):
    # Compatibility name for the original pilot callers/tests; scope is now the
    # reviewed web planner, not the separate individual-workout edit permission.
    return authorize_personalized(inv, read=read)


def digest(value):
    return hashlib.sha256(_bytes(value)).hexdigest()


def _snapshots(ref, read):
    return sorted([{'id': s.id, **_data(s)} for s in read(ref)], key=lambda row: row['id'])


def state(inv, read=_read, *, methodology=True):
    player = _data(read(inv.player_ref()))
    age, source, _ = resolve_age(player, inv.params.get('intake') or {}, _now(inv))
    profile = {k: player.get(k) for k in ('position', 'gender', 'organizationId', 'teamId', 'coachUID', 'coachId', 'coachDocId')}
    profile.update(age=age, ageSource=source,
        technicalEligibility=resolve_technical_eligibility(inv.db, inv.player_id, player, read=read),
        coachFeedback=_data(read(inv.player_ref().collection('privateProfile').document('coachFeedback'))))
    if (inv.params.get('intake') or {}).get('trainingContext'):
        readiness = _data(read(inv.player_ref().collection('privateProfile').document('trainingReadiness')))
        profile['trainingReadiness'] = readiness
        reviewer = readiness.get('reviewedBy')
        if isinstance(reviewer, str) and reviewer and '/' not in reviewer:
            profile['trainingReviewer'] = _data(read(inv.db.collection('trainingReviewers').document(reviewer)))
    active = _snapshots(inv.player_ref().collection('trainingPlans').where('status', '==', 'active'), read)
    logs = _snapshots(inv.player_ref().collection('workoutLogs'), read)
    reservations = _snapshots(inv.player_ref().collection('plannedWorkouts'), read)
    # Both new recordings and revisions of native metric/validity fields must
    # invalidate a review. Rep schemas differ across processors, so a partial
    # metric allowlist silently misses fields such as velocity and jumpHeight.
    reps = _snapshots(inv.player_ref().collection('reps'), read)
    revision = int(_data(read(_schedule_ref(inv))).get('revision', 0))
    peer,peer_evidence = compute_peers(inv,player,age,read=read)
    baseline = {'profileHash': digest(profile), 'activeHash': digest(active),
        'peerContextHash': digest({'peer':peer,'evidence':peer_evidence}),
        'historyHash': digest({'logs': logs, 'reservations': reservations}), 'testingHash': digest(reps),
        'scheduleRevision': revision,
        'activePlans': [{'planId': p['id'], 'planRevision': p.get('planRevision', 1)} for p in active]}
    if methodology:
        from gateway.personalized_evidence import read_authoritative_results, read_estimates
        evidence = read_authoritative_results(inv, read=read)
        _, estimates = read_estimates(inv, read=read, evidence=evidence)
        baseline['methodologyEvidenceHash'] = digest({'qualified': evidence['private'], 'estimates': estimates})
    return baseline, active, logs, reservations


def capture_state(inv):
    @transactional
    def capture(tx):
        read = lambda ref: _read(ref, tx)
        authorize_admin(inv, read)
        return state(inv, read)[0]
    return capture(inv.db.transaction())


def generate_draft(inv):
    from gateway.program_generator import run_program
    authorize_admin(inv)
    draft_id = 'pd_' + hashlib.sha256(_id(inv.job_id, 'jobId').encode()).hexdigest()[:28]
    ref = inv.player_ref().collection('personalizedPlanDrafts').document(draft_id)
    existing = _data(ref.get())
    if existing:
        authorize_personalized(inv, draft=existing)
        return {'draftId': draft_id, 'status': existing['status'], 'engineVersion': ENGINE_VERSION}, {}
    baseline = capture_state(inv)
    plan, usage = run_program(inv, persist=False, personalized=True)
    ids = {b['drillId'] for week in plan['weeks'] for w in week['workouts'] for b in w['blocks']}
    private = deepcopy(inv.context['_personalizedPrivate'])
    catalog = inv.context['workoutContext']['catalog']
    private['catalogRows'] = {did: deepcopy(catalog[did]) for did in sorted(ids)}
    private['baseline'] = baseline
    context = _context_record(inv, plan, private)
    context_ref = inv.player_ref().collection('personalizedPlanDraftContexts').document(draft_id)
    token = digest({'baseline': baseline, 'plan': plan})
    draft = {'schemaVersion': 1, 'draftId': draft_id, 'playerId': inv.player_id,
        'createdByUid': inv.uid, 'jobId': inv.job_id, 'engineVersion': ENGINE_VERSION,
        'status': 'ready', 'createdAt': _now(inv), 'expiresAt': _now(inv) + timedelta(days=7),
        'comparisonToken': token, 'expectedActivePlans': baseline['activePlans'],
        'baseline': baseline, 'catalogHash': digest(private['catalogRows']),
        'contextHash': digest(context), 'plan': plan,
        'replacementPolicy': 'Use this plan supersedes the active plan. Existing workout logs and ad-hoc reservations remain unchanged and count toward frequency limits. Start date remains the draft date; regenerate on another day.'}
    enforce_document_size(draft, 'personalized draft')
    enforce_document_size(context, 'personalized context')
    @transactional
    def save(tx):
        read = lambda target: _read(target, tx)
        authorize_admin(inv, read)
        current = _data(read(ref))
        if current:
            return current['status']
        if _data(read(context_ref)):
            raise GatewayError('validation_failed', 'Draft context exists without its draft; recovery required')
        tx.create(context_ref, context)
        tx.create(ref, draft)
        tx.create(inv.player_ref().collection('personalizedPlanDraftViews').document(draft_id), draft_view(draft))
        return 'ready'
    status = save(inv.db.transaction())
    from gateway.program_generator import _progress
    _progress(inv,'complete',key='persist',finished=True,completed_workouts=plan['horizonWeeks']*plan['sessionsPerWeek'])
    return {'draftId': draft_id, 'status': status, 'engineVersion': ENGINE_VERSION}, usage


def assess_priorities(inv):
    """Optional preflight uses the same assessment policy as draft generation."""
    from gateway.program_generator import assess_player,parse_coach_feedback
    from gateway.personalized_assessment import prepare_personalized_profile,compute_personalized_focus,curriculum_report
    from gateway.catalog_v2 import load_catalog,eligible_drill
    from gateway.program_composition import dose_options,catalog_capacity
    from gateway.usage import aggregate_usage
    authorize_admin(inv)
    profile=prepare_personalized_profile(inv,assess_player(inv))
    parsed=parse_coach_feedback(inv,profile)
    catalog=load_catalog(inv)
    eligible={did:row for did,row in catalog.items() if row['domain'] not in ('ballMastery','games') and
              eligible_drill(row,profile,allow_partner=profile['intake']['setting'] in ('partner','halfAndHalf'))[0]}
    options={did:dose_options(row) for did,row in eligible.items()}
    eligible={did:row for did,row in eligible.items() if options[did]}
    cap=catalog_capacity(eligible,options,profile['intake']['sessionsPerWeek'],profile['intake']['minutesPerSession'])
    split=compute_personalized_focus(profile,{r['domain'] for r in eligible.values()},parsed,cap,catalog=eligible)
    return {'engineVersion':ENGINE_VERSION,'assessedAt':_now(inv),'findings':split['findings'],
            'methodologyVersion':split['methodologyVersion'],'priorities':split['priorities'],'estimatePolicy':profile['estimatePolicy'],
            'focusSplit':split['final'],'evidencePolicy':profile['evidencePolicy'],'peer':profile['peer'],
            'dataGaps':profile['dataGaps'],'curriculum':curriculum_report(catalog,profile,options),
            'intake':profile['intake']},aggregate_usage(getattr(inv,'_provider_usage_records',[]))


def activate_draft(inv):
    authorize_admin(inv)
    draft_id = _id(inv.params.get('draftId'), 'draftId')
    ref = inv.player_ref().collection('personalizedPlanDrafts').document(draft_id)
    context_ref = inv.player_ref().collection('personalizedPlanDraftContexts').document(draft_id)
    @transactional
    def activate(tx):
        read = lambda target: _read(target, tx)
        authorize_admin(inv, read)
        draft = _data(read(ref))
        if not draft or draft.get('playerId') != inv.player_id or draft.get('engineVersion') != ENGINE_VERSION:
            raise invalid_request('The personalized draft is unavailable for this player')
        authorize_personalized(inv, read=read, draft=draft)
        if inv.params.get('comparisonToken') != draft['comparisonToken'] or inv.params.get('expectedActivePlans') != draft['expectedActivePlans']:
            raise GatewayError('validation_failed', 'Review this draft and its current-plan comparison before activating it')
        if draft['status'] == 'activated':
            return {'draftId': draft_id, 'status': 'activated', 'planId': draft['activatedPlanId'], 'replayed': True}
        if draft['status'] != 'ready' or draft['expiresAt'] <= _now(inv):
            raise GatewayError('validation_failed', 'Draft is no longer ready; generate a fresh comparison')
        plan = deepcopy(draft['plan'])
        today = _now(inv).astimezone(ZoneInfo(plan['timezone'])).date().isoformat()
        if (plan['startDate'] < today if plan.get('trainingPolicyVersion') == 'whole-body-v1' else plan['startDate'] != today):
            raise GatewayError('validation_failed', 'The draft start date has passed; generate a fresh draft for today')
        inv.params['intake'] = plan['intake']
        inv.params['useProvisionalEstimates'] = bool((plan.get('assessment', {}).get('estimatePolicy') or {}).get('enabled', False))
        baseline, active, logs, reservations = state(inv, read, methodology='methodologyEvidenceHash' in draft['baseline'])
        if baseline != draft['baseline']:
            raise GatewayError('validation_failed', 'Player context, testing, active plan or workout activity changed. Generate a fresh draft and review the updated comparison.')
        context = _data(read(context_ref))
        if not context or digest(context) != draft['contextHash']:
            raise GatewayError('validation_failed', 'Immutable draft evidence is unavailable')
        plan_id = _id(plan['planId'], 'planId')
        plan_ref = inv.player_ref().collection('trainingPlans').document(plan_id)
        final_context_ref = inv.player_ref().collection('trainingPlanContexts').document(plan_id)
        if _data(read(plan_ref)) or _data(read(final_context_ref)):
            raise GatewayError('validation_failed', 'Plan identity already exists; no plan was overwritten')
        ids = {b['drillId'] for week in plan['weeks'] for w in week['workouts'] for b in w['blocks']}
        _, rows = _fresh_profile_catalog(inv, plan, ids, read)
        from gateway.whole_body import assert_activation_allowed, mark_plan_authorization
        assert_activation_allowed(inv, rows, read)
        mark_plan_authorization(plan, rows)
        if digest(rows) != draft['catalogHash']:
            raise GatewayError('validation_failed', 'The curriculum changed. Generate a fresh draft before activating it.')
        for week in plan['weeks']:
            targets = {r['domain']: r['minutes'] for r in week['allocations']}
            if not allocation_check(week, targets, plan['assessment']['focusSplit']['measuredPriorityDomains'])['passed']:
                raise GatewayError('validation_failed', 'Draft no longer meets its individual allocation')
            for workout in week['workouts']:
                if workout.get('check', {}).get('adversarialPassed') is not True:
                    raise GatewayError('validation_failed', 'Draft is missing an independent workout check')
                _validate(inv, workout, plan, {'kind': 'plan', 'planId': plan_id,
                    'workoutId': workout['workoutId'], 'baseRevision': 1}, logs, reservations, read=read)
        plan.update(status='active', planRevision=1, activatedAt=_now(inv), activatedByUid=inv.uid,
            sourceDraftId=draft_id, updatedAt=_now(inv), generationContextRef=final_context_ref.path)
        enforce_document_size(plan, 'plan')
        for previous in active:
            tx.update(inv.player_ref().collection('trainingPlans').document(previous['id']), {'status': 'superseded', 'updatedAt': _now(inv)})
        tx.create(final_context_ref, context)
        tx.create(plan_ref, public_plan(plan))
        tx.set(_schedule_ref(inv), _counter(baseline['scheduleRevision'], _now(inv)))
        lifecycle = {'status': 'activated', 'activatedPlanId': plan_id, 'activatedAt': _now(inv), 'activatedByUid': inv.uid}
        tx.update(ref, lifecycle)
        tx.set(inv.player_ref().collection('personalizedPlanDraftViews').document(draft_id), draft_view({**draft, **lifecycle}))
        return {'draftId': draft_id, 'status': 'activated', 'planId': plan_id, 'replayed': False}
    return activate(inv.db.transaction())


def discard_draft(inv):
    draft_id = _id(inv.params.get('draftId'), 'draftId')
    ref = inv.player_ref().collection('personalizedPlanDrafts').document(draft_id)
    @transactional
    def discard(tx):
        read = lambda target: _read(target, tx)
        authorize_admin(inv, read)
        draft = _data(read(ref))
        if not draft or draft.get('playerId') != inv.player_id:
            raise invalid_request('The draft is unavailable')
        authorize_personalized(inv, read=read, draft=draft)
        if draft['status'] == 'activated':
            raise GatewayError('validation_failed', 'An activated plan cannot be discarded as a draft')
        if draft['status'] != 'discarded':
            lifecycle = {'status': 'discarded', 'discardedAt': _now(inv), 'discardedByUid': inv.uid}
            tx.update(ref, lifecycle)
            tx.set(inv.player_ref().collection('personalizedPlanDraftViews').document(draft_id), draft_view({**draft, **lifecycle}))
        return {'draftId': draft_id, 'status': 'discarded'}
    return discard(inv.db.transaction())
