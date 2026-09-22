"""Deterministic admin edit; the browser never writes executable plan arrays."""
from copy import deepcopy
from datetime import timedelta
import hashlib
from zoneinfo import ZoneInfo
from google.cloud.firestore_v1.transaction import transactional

from gateway.authz import authorize_v3
from gateway.errors import GatewayError, invalid_request, permission_denied
from gateway.workout_persistence import (_id, _data, _read, _now, _active, _find_workout,
    _schedule_ref, _schedule, _evidence, _validate, _safe_workout, _executable,
    _week_derived, _diff, _counter, _bytes, enforce_document_size)


def save_workout_edit(inv):
    if authorize_v3(inv, mutation=True) != 'admin':
        raise permission_denied('Manual workout edits require a verified PoseTek administrator')
    params = inv.params
    keys = {'planId', 'workoutId', 'expectedPlanRevision', 'expectedWorkoutRevision',
            'expectedScheduleRevision', 'workout', 'rationale'}
    if set(params) != keys or not isinstance(params.get('workout'), dict):
        raise invalid_request('Manual save requires the workout, rationale and all three expected revisions')
    for key in ('expectedPlanRevision', 'expectedWorkoutRevision', 'expectedScheduleRevision'):
        if type(params[key]) is not int or params[key] < 1:
            raise invalid_request(key + ' must be a positive integer')
    rationale = params.get('rationale')
    if not isinstance(rationale, str) or not 3 <= len(rationale.strip()) <= 2000:
        raise invalid_request('Write 3–2000 characters of edit rationale')
    plan_ref = inv.player_ref().collection('trainingPlans').document(_id(params['planId'], 'planId'))
    workout_id = _id(params['workoutId'], 'workoutId')
    job_id = _id(inv.job_id, 'jobId')
    adjustment_id = 'manual_' + job_id
    adjustment_ref = inv.player_ref().collection('planAdjustments').document(adjustment_id)
    request_hash = hashlib.sha256(_bytes(params)).hexdigest()
    previous = _data(adjustment_ref.get())
    if previous:
        if previous.get('requestHash') != request_hash or previous.get('editor', {}).get('uid') != inv.uid:
            raise GatewayError('validation_failed', 'Manual save retry changed its original request')
        return previous['result']
    logs, reservations = _evidence(inv)
    revision = _schedule(inv)
    if revision != params['expectedScheduleRevision']:
        raise GatewayError('validation_failed', 'The schedule changed. Reload before saving this workout.')

    @transactional
    def commit(tx):
        read = lambda ref: _read(ref, tx)
        if authorize_v3(inv, mutation=True, read=read) != 'admin':
            raise permission_denied('Administrator access changed')
        existing = _data(read(adjustment_ref))
        if existing:
            if existing.get('editor', {}).get('uid') != inv.uid or existing.get('requestHash') != request_hash:
                raise permission_denied('Edit result belongs to another request')
            return existing['result']
        plan = _data(read(plan_ref)); _active(plan)
        current_schedule = _data(read(_schedule_ref(inv))).get('revision', 0)
        week, before = _find_workout(plan, workout_id)
        if (current_schedule != revision or plan.get('planRevision', 1) != params['expectedPlanRevision']
                or before.get('revision', 1) != params['expectedWorkoutRevision']):
            raise GatewayError('validation_failed', 'The plan, workout or schedule changed. Reload and review before saving.')
        after = _safe_workout(params['workout'])
        if after.get('workoutId') != workout_id or after.get('order') != before.get('order'):
            raise invalid_request('A manual edit cannot change workout identity or order')
        if after.get('scheduledDate') != before.get('scheduledDate'):
            raise invalid_request('Changing a session date needs a reviewed new plan; the workout editor cannot reschedule it')
        old_ids = {b['blockId']: b['drillId'] for b in before.get('blocks', [])}
        for block in after.get('blocks', []):
            bid = block.get('blockId', '')
            if bid in old_ids and old_ids[bid] != block.get('drillId'):
                raise invalid_request('An existing block identity cannot be assigned to another drill')
            if bid not in old_ids and isinstance(bid, str) and bid.startswith('b') and bid[1:].isdigit() and int(bid[1:]) < before.get('nextBlockSequence', 1):
                raise invalid_request('Retired block identifiers cannot be reused')
        after['nextBlockSequence'] = max(after.get('nextBlockSequence', 1), before.get('nextBlockSequence', 1))
        target = {'kind': 'plan', 'planId': plan['planId'], 'workoutId': workout_id,
                  'weekNumber': week['weekNumber'], 'baseRevision': before.get('revision', 1)}
        check, profile, catalog, _ = _validate(inv, after, plan, target, logs, reservations, read=read)
        new_revision = before.get('revision', 1) + 1
        new_plan_revision = plan.get('planRevision', 1) + 1
        after.update(revision=new_revision, previousRevision=_executable(before), editedBy='admin',
                     editorUid=inv.uid, editedAt=_now(inv), check={**check, 'checkedAt': _now(inv), 'notes': []})
        week['workouts'] = [after if w['workoutId'] == workout_id else w for w in week['workouts']]
        if any(row.get('trainingPolicy') for row in catalog.values()):
            plan['requiresTrainingStartAuthorization'] = True
        _week_derived(week)
        plan.update(planRevision=new_plan_revision, updatedAt=_now(inv), lastEdit={
            'workoutId': workout_id, 'revision': new_revision, 'editedBy': 'admin',
            'editedAt': _now(inv), 'adjustmentId': adjustment_id})
        result = {'adjustmentId': adjustment_id, 'newPlanRevision': new_plan_revision, 'newWorkoutRevision': new_revision}
        adjustment = {'schemaVersion': 2, 'planId': plan['planId'], 'planSchemaVersion': 3,
            'workoutId': workout_id, 'weekNumber': week['weekNumber'],
            'editor': {'uid': inv.uid, 'role': 'admin', 'surface': 'gateway'},
            'basePlanRevision': params['expectedPlanRevision'], 'newPlanRevision': new_plan_revision,
            'baseRevision': params['expectedWorkoutRevision'], 'newRevision': new_revision,
            'before': _executable(before), 'after': _executable(after), 'diff': _diff(before, after),
            'rationale': rationale.strip(), 'warningsOverridden': [], 'catalogRows': catalog,
            'trainingReadinessRevision': profile.get('wholeBody', {}).get('readiness', {}).get('revision'),
            'createdAt': _now(inv), 'clientVersion': inv.client_version, 'result': result, 'requestHash': request_hash}
        enforce_document_size(plan, 'plan'); enforce_document_size(adjustment, 'adjustment')
        tx.set(plan_ref, plan)
        tx.create(adjustment_ref, adjustment)
        tx.set(_schedule_ref(inv), _counter(revision, _now(inv)))
        return deepcopy(result)
    return commit(inv.db.transaction())


def validate_workout_start(inv):
    """Issue a short revision-bound authorization; never fabricate workout logs."""
    authorize_v3(inv, mutation=True)
    keys = {'planId', 'workoutId', 'expectedPlanRevision', 'expectedWorkoutRevision',
            'expectedScheduleRevision', 'equipmentConfirmed', 'supervision', 'painFlag'}
    if set(inv.params) != keys:
        raise invalid_request('Workout start needs current revisions and today\'s equipment, supervision and pain confirmation')
    params = inv.params
    if (type(params['equipmentConfirmed']) is not bool or type(params['painFlag']) is not bool
            or params['supervision'] not in ('qualifiedCoach', 'unavailable')):
        raise invalid_request('Confirm today\'s conditions explicitly')
    if params['painFlag'] or not params['equipmentConfirmed']:
        raise GatewayError('validation_failed', 'Do not start: pain or unavailable equipment requires review')
    for key in ('expectedPlanRevision', 'expectedWorkoutRevision', 'expectedScheduleRevision'):
        if type(params[key]) is not int or params[key] < 1: raise invalid_request('Invalid expected revision')
    plan_ref = inv.player_ref().collection('trainingPlans').document(_id(params['planId'], 'planId'))
    wid = _id(params['workoutId'], 'workoutId')
    before_revision = _schedule(inv)
    logs, reservations = _evidence(inv)
    if _schedule(inv) != before_revision:
        raise GatewayError('validation_failed', 'The workout schedule changed. Check readiness again.')

    @transactional
    def preflight(tx):
        read = lambda ref: _read(ref, tx)
        authorize_v3(inv, mutation=True, read=read)
        plan = _data(read(plan_ref)); _active(plan)
        week, saved = _find_workout(plan, wid)
        schedule = _data(read(_schedule_ref(inv))).get('revision', 0)
        if (schedule != before_revision or schedule != params['expectedScheduleRevision']
                or plan.get('planRevision', 1) != params['expectedPlanRevision']
                or saved.get('revision', 1) != params['expectedWorkoutRevision']):
            raise GatewayError('validation_failed', 'Plan readiness changed; reload the workout before starting')
        if plan.get('requiresTrainingStartAuthorization') is not True:
            raise invalid_request('This readiness preflight is for the expanded training contract')
        today = _now(inv).astimezone(ZoneInfo(plan['timezone'])).date().isoformat()
        if saved.get('scheduledDate') != today:
            raise GatewayError('validation_failed', 'This workout is not scheduled for today; review the schedule first')
        log = _data(read(inv.player_ref().collection('workoutLogs').document(plan['planId'] + '_' + wid)))
        if log and (log.get('endedAt') is not None or log.get('workoutRevision') != saved.get('revision', 1)):
            raise GatewayError('validation_failed', 'The saved session is finished or uses a different prescription revision')
        checked_plan = deepcopy(plan)
        checked_plan['intake']['trainingContext']['supervision'] = params['supervision']
        candidate = deepcopy(saved)
        target = {'kind': 'plan', 'planId': plan['planId'], 'workoutId': wid, 'weekNumber': week['weekNumber']}
        _, profile, _, _ = _validate(inv, candidate, checked_plan, target, logs, reservations, read=read)
        if profile.get('wholeBody', {}).get('mobileVerified') is not True:
            raise GatewayError('capability_disabled', 'Expanded training starts require verified installed mobile support')
        for original, current in zip(saved['blocks'], candidate['blocks']):
            if original.get('loadingInstructions') != current.get('loadingInstructions'):
                raise GatewayError('validation_failed', 'Coach loading instructions changed; review an updated prescription before starting')
        if log and log.get('workoutSnapshot', {}).get('blocks') != saved.get('blocks'):
            raise GatewayError('validation_failed', 'The in-progress session snapshot no longer matches the current prescription')
        readiness = profile.get('wholeBody', {}).get('readiness', {})
        from gateway.whole_body import _time
        clearance_expiry = _time(readiness.get('expiresAt'))
        if (not profile.get('wholeBody', {}).get('reviewerEnabled') or readiness.get('status') != 'cleared'
                or not clearance_expiry or clearance_expiry <= _now(inv)):
            raise GatewayError('validation_failed', 'Coach clearance expired; review readiness before starting')
        grant = {'schemaVersion': 1, 'authUID': inv.uid, 'planId': plan['planId'],
                 'workoutId': wid, 'planRevision': plan['planRevision'],
                 'workoutRevision': saved.get('revision', 1), 'scheduleRevision': schedule,
                 'readinessRevision': readiness.get('revision'), 'reviewedBy': readiness.get('reviewedBy'),
                 'validatedDate': today, 'createdAt': _now(inv),
                 'expiresAt': min(_now(inv) + timedelta(minutes=5), clearance_expiry)}
        tx.set(inv.player_ref().collection('workoutStartAuthorizations').document(plan['planId'] + '_' + wid), grant)
        return {'ready': True, 'trainingPolicyVersion': 'whole-body-v1', 'workoutId': wid,
                'planRevision': plan['planRevision'], 'workoutRevision': saved.get('revision', 1),
                'scheduleRevision': schedule,
                'readinessRevision': profile.get('wholeBody', {}).get('readiness', {}).get('revision')}
    return preflight(inv.db.transaction())
