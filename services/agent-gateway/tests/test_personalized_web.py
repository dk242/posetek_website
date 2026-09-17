from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from gateway.authz import AuthContext, authorize_v3
from gateway.ctx import Invocation
from gateway.errors import GatewayError
from gateway.personalized_access import CAPABILITIES, authorize_personalized
from gateway.personalized_jobs import claim, renew, update_owned, assert_execution, handle, ExecutionLost, operation_ref
from gateway.personalized_views import draft_view, job_result
from gateway.personalized_plans import activate_draft, discard_draft, state
from gateway import config
from tests.conftest import FakeStorage
from tests.test_club_authorization import seed
from tests.test_personalized_plans import invocation, generated, activation


def actor(role='coach', *, uid='staff', job_id='request', db=None):
    db = db or seed(role=role)
    inv = Invocation(capability='generate_personalized_plan', player_id='player-document', uid=uid,
        trusted_claims={'uid': uid}, db=db, storage=FakeStorage(), job_id=job_id,
        params={'engineVersion': 'personalized-v1', 'planVersion': 3, 'intake': {}, 'timezone': 'UTC'})
    inv.context['_leaseNow'] = datetime(2026, 9, 17, tzinfo=timezone.utc)
    db.set_doc(('llmJobs', job_id), {'schemaVersion': 1, 'status': 'pending', 'requestedByUid': uid,
        'playerId': inv.player_id, 'capability': inv.capability, 'params': deepcopy(inv.params)})
    return inv


@pytest.mark.parametrize('role,uid', [('coach', 'staff'), ('manager', 'staff'), ('coach', 'athlete')])
def test_current_actor_can_plan_without_widening_workout_edit_permission(role, uid):
    inv = actor(role, uid=uid)
    assert authorize_personalized(inv) in ('coach', 'athlete')
    if uid == 'staff':
        with pytest.raises(GatewayError):
            authorize_v3(inv, mutation=True)


@pytest.mark.parametrize('change', ['revoked', 'moved', 'conflicting-owner', 'bad-team-list', 'anonymous'])
def test_current_authority_is_required_even_with_legacy_roster_pointers(change):
    inv = actor()
    if change == 'revoked':
        inv.db.collection('organizations').document('club').collection('members').document('staff').update({'status': 'inactive'})
    elif change == 'moved':
        inv.player_ref().update({'teamId': 'boys'})
    elif change == 'conflicting-owner':
        inv.player_ref().update({'userUID': 'other'})
    elif change == 'bad-team-list':
        inv.db.collection('organizations').document('club').collection('members').document('staff').update({'teamIds': [None]})
    else:
        inv.trusted_claims['firebase'] = {'sign_in_provider': 'anonymous'}
    with pytest.raises(GatewayError):
        authorize_personalized(inv)


@pytest.fixture(scope='module')
def coach_draft():
    inv = invocation()
    inv.uid = 'synthetic-coach'
    inv.trusted_claims = {'uid': inv.uid}
    draft = generated(inv)
    return inv, draft


def test_requester_lifecycle_updates_safe_view_and_preserves_saved_history(coach_draft):
    inv, draft = deepcopy(coach_draft)
    view = inv.player_ref().collection('personalizedPlanDraftViews').document(draft['draftId']).get().to_dict()
    assert view['createdByUid'] == inv.uid and view['status'] == 'ready'
    assert view['plan']['weeks'][0]['workouts'][0]['blocks']
    assert 'contextHash' not in view and 'baseline' not in view
    assert 'coachFeedback' not in view['plan']['assessment']['inputs']
    before = {k: v for k, v in inv.db._docs.items() if 'workoutLogs' in k or 'plannedWorkouts' in k}
    activation(inv, draft)
    first = activate_draft(inv)
    assert activate_draft(inv)['planId'] == first['planId']
    final_view = inv.player_ref().collection('personalizedPlanDraftViews').document(draft['draftId']).get().to_dict()
    assert final_view['status'] == 'activated' and final_view['activatedPlanId'] == first['planId']
    assert before == {k: v for k, v in inv.db._docs.items() if 'workoutLogs' in k or 'plannedWorkouts' in k}


def test_another_authorized_requester_cannot_activate_or_discard(coach_draft):
    inv, draft = deepcopy(coach_draft)
    inv.uid = 'synthetic-user'; inv.trusted_claims = {'uid': inv.uid}
    activation(inv, draft)
    for operation in (activate_draft, discard_draft):
        with pytest.raises(GatewayError, match='requesting account'):
            operation(inv)


def test_discard_view_updates_atomically(coach_draft):
    inv, draft = deepcopy(coach_draft)
    activation(inv, draft)
    discard_draft(inv)
    view = inv.player_ref().collection('personalizedPlanDraftViews').document(draft['draftId']).get().to_dict()
    assert view['status'] == 'discarded'
    assert not list(inv.player_ref().collection('trainingPlans').stream())


def test_projection_is_an_allowlist_at_every_nested_boundary(coach_draft):
    _, draft = deepcopy(coach_draft)
    marker = 'PRIVATE_EVIDENCE_MUST_NOT_ESCAPE'
    draft['baseline'] = {'rawNote': marker}
    draft['plan']['assessment']['inputs']['coachFeedback'] = {'text': marker}
    draft['plan']['assessment']['inputs']['peer']['people'] = [marker]
    draft['plan']['weeks'][0]['workouts'][0]['modelTrace'] = marker
    draft['plan']['weeks'][0]['workouts'][0]['blocks'][0]['name'] = {'private': marker}
    draft['plan']['weeks'][0]['check']['trace'] = marker
    import json
    assert marker not in json.dumps(draft_view(draft), default=str)
    assert job_result('generate_personalized_plan', {'draftId': 'd', 'private': marker}) == {'draftId': 'd'}


@pytest.mark.parametrize('field,value', [('velocity', 20), ('jumpHeight', 0.7), ('isValid', False),
                                      ('qualityStatus', 'rejected'), ('adminRevisedAt', '2026-09-17')])
def test_native_recording_revisions_invalidate_review(coach_draft, field, value):
    inv, _ = deepcopy(coach_draft)
    ref = inv.player_ref().collection('reps').document('native-field-probe')
    ref.set({'repType': 'deadballShot', 'velocity': 10})
    before = state(inv)[0]
    ref.update({field: value})
    assert state(inv)[0]['testingHash'] != before['testingHash']


def test_assessment_projection_retains_intake_and_flat_allocations():
    result = job_result('assess_personalized_plan', {'intake': {'sessionsPerWeek': 3, 'minutesPerSession': 30,
        'setting': 'solo', 'private': 'omit'}, 'focusSplit': {'passing': 40, 'plyometrics': 20}})
    assert result['intake'] == {'sessionsPerWeek': 3, 'minutesPerSession': 30, 'setting': 'solo'}
    assert result['focusSplit'] == {'passing': 40, 'plyometrics': 20}


@pytest.mark.parametrize('capability', sorted(CAPABILITIES))
def test_explicit_unlimited_skips_daily_counting_but_not_gates(capability):
    cfg = {'globalEnabled': True, 'capabilities': {capability: {'enabled': True, 'dailyLimitPolicy': 'unlimited'}}}
    class NoReads:
        def collection(self, _):
            pytest.fail('Unlimited requests must not read a daily counter')
    for _ in range(12):
        assert config.v3_capability_enabled(cfg, capability)
        config.check_quota(NoReads(), cfg, 'actor', capability)
    cfg['globalEnabled'] = False
    assert not config.v3_capability_enabled(cfg, capability)
    cfg['globalEnabled'] = True
    cfg['capabilities'][capability]['dailyLimitPolicy'] = 'typo'
    assert not config.v3_capability_enabled(cfg, capability)
    assert not config.v3_capability_enabled({'capabilities': {capability: {'enabled': True, 'dailyLimitPerUser': 0}}}, capability)
    assert config.DAILY_ALLOWANCES['generate_training_plan'][1] == 1


def test_unlimited_does_not_apply_to_native_generation():
    cfg = {'capabilities': {'generate_training_plan': {'enabled': True, 'dailyLimitPolicy': 'unlimited'}}}
    assert not config.v3_capability_enabled(cfg, 'generate_training_plan')


def test_claim_serializes_duplicate_delivery_and_competing_requesters():
    inv = actor()
    assert claim(inv) == 'claimed'
    duplicate = deepcopy(inv); duplicate.db = inv.db; duplicate.context.pop('_personalizedExecution')
    assert claim(duplicate) == 'busy'
    competing = actor(uid='athlete', job_id='other', db=inv.db)
    assert claim(competing) == 'busy'
    update_owned(inv, {'status': 'complete'}, terminal=True)
    assert claim(competing) == 'claimed'
    assert claim(duplicate) == 'terminal'


def test_crashed_attempt_is_recoverable_and_stale_worker_is_fenced():
    old = actor()
    assert claim(old) == 'claimed'
    replacement = actor(uid='athlete', job_id='replacement', db=old.db)
    replacement.context['_leaseNow'] += timedelta(seconds=121)
    assert claim(replacement) == 'claimed'
    assert old.db.get_doc(('llmJobs', old.job_id))['status'] == 'failed'
    with pytest.raises(ExecutionLost):
        update_owned(old, {'status': 'complete', 'result': {'unsafe': True}})
    assert 'result' not in old.db.get_doc(('llmJobs', old.job_id))


def test_same_job_reclaims_expired_attempt_and_heartbeat_is_bounded():
    old = actor()
    assert claim(old) == 'claimed'
    newer = deepcopy(old); newer.db = old.db; newer.context.pop('_personalizedExecution')
    newer.context['_leaseNow'] += timedelta(seconds=121)
    assert claim(newer) == 'claimed'
    newer.context['_leaseNow'] += timedelta(seconds=60)
    renew(newer)
    assert_execution(newer)
    newer.context['_leaseNow'] += timedelta(hours=2)
    with pytest.raises(ExecutionLost):
        renew(newer)


def test_revocation_between_claim_read_and_commit_cannot_admit_request():
    inv = actor()
    def revoke(db):
        db.collection('organizations').document('club').collection('members').document('staff').update({'status': 'inactive'})
    inv.db.before_commit = revoke
    with pytest.raises(GatewayError):
        claim(inv)
    assert inv.db.get_doc(('llmJobs', inv.job_id))['status'] == 'pending'
    assert not operation_ref(inv).get().exists


def test_transport_filters_results_and_duplicate_event_does_no_model_work():
    inv = actor(); calls = []
    def run(current):
        calls.append(current.job_id)
        return {'draftId': 'draft', 'status': 'ready', 'private': 'secret'}, {'calls': 1}
    options = dict(storage_factory=FakeStorage, resolve_identity=lambda uid: AuthContext(uid, None, {'uid': uid}),
                   run_pipeline=run, persist_trace=lambda *args: None)
    job = inv.db.get_doc(('llmJobs', inv.job_id))
    assert handle(inv.db, inv.job_id, job, **options)[1] == 200
    assert handle(inv.db, inv.job_id, inv.db.get_doc(('llmJobs', inv.job_id)), **options)[1] == 200
    assert calls == [inv.job_id]
    assert inv.db.get_doc(('llmJobs', inv.job_id))['result'] == {'draftId': 'draft', 'status': 'ready'}


def test_transport_revocation_during_assessment_publishes_no_result():
    inv = actor()
    def run(current):
        current.db.collection('organizations').document('club').collection('members').document('staff').update({'status': 'inactive'})
        return {'findings': ['private']}, {}
    handle(inv.db, inv.job_id, inv.db.get_doc(('llmJobs', inv.job_id)), storage_factory=FakeStorage,
        resolve_identity=lambda uid: AuthContext(uid, None, {'uid': uid}), run_pipeline=run, persist_trace=lambda *args: None)
    result = inv.db.get_doc(('llmJobs', inv.job_id))
    assert result['status'] == 'failed' and 'result' not in result
