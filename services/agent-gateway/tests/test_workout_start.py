from copy import deepcopy
from datetime import timedelta

import pytest

from gateway.errors import GatewayError
from gateway.manual_workout import validate_workout_start
from gateway.workout_persistence import persist_program
from tests.test_workout_persistence_v3 import setup, saved_plan, NOW
from tests.test_whole_body import context, ready, policy


GRANT = ('players', 'player', 'workoutStartAuthorizations', 'p_w1s1')


def request():
    inv, plan = setup()
    inv.capability = 'validate_workout_start'
    inv.params = {'planId': 'p', 'workoutId': 'w1s1', 'expectedPlanRevision': 1,
        'expectedWorkoutRevision': 1, 'expectedScheduleRevision': 1,
        'equipmentConfirmed': True, 'supervision': 'qualifiedCoach', 'painFlag': False}
    plan['trainingPolicyVersion'] = 'whole-body-v1'
    plan['requiresTrainingStartAuthorization'] = True
    plan['intake']['trainingContext'] = context()
    exercise = inv.db.get_doc(('drillCatalog', 'DRB-501'))
    exercise['trainingPolicy'] = policy(modality='ball', loaded=False, loadFamilies=[])
    inv.db.set_doc(('drillCatalog', 'DRB-501'), exercise)
    for week in plan['weeks']:
        for workout in week['workouts']:
            workout['scheduledDate'] = (NOW + timedelta(days=(week['weekNumber']-1)*7+(workout['order']-1)*3)).date().isoformat()
            for block in workout['blocks']:
                block.update(trainingPolicyVersion='whole-body-v1', loadingInstructions=exercise['trainingPolicy']['loadingInstructions'])
    inv.db.set_doc(('players', 'player', 'trainingPlans', 'p'), plan)
    inv.db.set_doc(('players', 'player', 'privateProfile', 'trainingReadiness'), ready())
    inv.db.set_doc(('trainingReviewers', 'reviewer'), {'enabled': True, 'scopeType': 'posetek'})
    inv.db.set_doc(('config', 'llm'), {'wholeBodyTraining': {'previewEnabled': True, 'mobileVerified': True}})
    return inv


def test_start_issues_short_actor_and_revision_bound_grant_without_logging():
    inv = request(); before = saved_plan(inv)
    result = validate_workout_start(inv)
    assert result['ready'] and result['readinessRevision'] == 1
    grant = inv.db.get_doc(GRANT)
    assert grant['authUID'] == 'athlete'
    assert grant['expiresAt'] == NOW + timedelta(minutes=5)
    assert grant['validatedDate'] == '2026-09-06'
    assert grant['planRevision'] == grant['workoutRevision'] == grant['scheduleRevision'] == 1
    assert grant['reviewedBy'] == 'reviewer'
    assert saved_plan(inv) == before
    assert not inv.db.get_collection(('players', 'player', 'workoutLogs'))


@pytest.mark.parametrize('change', ['mobile', 'reviewer', 'readiness', 'date', 'dose', 'pain', 'equipment', 'supervision', 'stale', 'extra'])
def test_fresh_start_rejects_changed_safety_inputs_without_grant(change):
    inv = request()
    if change == 'mobile': inv.db.set_doc(('config', 'llm'), {'wholeBodyTraining': {'previewEnabled': True, 'mobileVerified': False}})
    if change == 'reviewer': inv.db.set_doc(('trainingReviewers', 'reviewer'), {'enabled': False, 'scopeType': 'posetek'})
    if change == 'readiness':
        value = ready(); value['status'] = 'pending'
        inv.db.set_doc(('players', 'player', 'privateProfile', 'trainingReadiness'), value)
    if change == 'date': inv.context['now'] = NOW + timedelta(days=1)
    if change == 'dose':
        value = inv.db.get_doc(('drillCatalog', 'DRB-501')); value['dose']['repsMax'] = 299
        inv.db.set_doc(('drillCatalog', 'DRB-501'), value)
    if change == 'pain': inv.params['painFlag'] = True
    if change == 'equipment': inv.params['equipmentConfirmed'] = False
    if change == 'supervision': inv.params['supervision'] = 'unavailable'
    if change == 'stale': inv.params['expectedWorkoutRevision'] = 2
    if change == 'extra': inv.params['clearance'] = True
    with pytest.raises(GatewayError): validate_workout_start(inv)
    assert not inv.db.get_doc(GRANT)


def add_partial_log(inv):
    snapshot = deepcopy(saved_plan(inv)['weeks'][0]['workouts'][0])
    log = {'source': 'plan', 'schemaVersion': 2, 'planId': 'p', 'workoutId': 'w1s1', 'weekNumber': 1,
           'workoutRevision': 1, 'workoutSnapshot': snapshot, 'startedAt': NOW,
           'blocks': [{'blockId': 'b1', 'status': 'partial', 'setsCompleted': 1}]}
    inv.db.set_doc(('players', 'player', 'workoutLogs', 'p_w1s1'), log)
    return log


def test_resume_rechecks_readiness_and_does_not_double_charge_own_log():
    inv = request(); log = add_partial_log(inv)
    assert validate_workout_start(inv)['ready']
    assert inv.db.get_doc(('players', 'player', 'workoutLogs', 'p_w1s1')) == log
    inv.db.set_doc(('trainingReviewers', 'reviewer'), {'enabled': False, 'scopeType': 'posetek'})
    with pytest.raises(GatewayError): validate_workout_start(inv)


@pytest.mark.parametrize('change', ['ended', 'revision', 'snapshot'])
def test_resume_refuses_finished_or_changed_prescriptions(change):
    inv = request(); log = add_partial_log(inv)
    if change == 'ended': log['endedAt'] = NOW
    if change == 'revision': log['workoutRevision'] = 2
    if change == 'snapshot': log['workoutSnapshot']['blocks'][0]['loadingInstructions'] = 'Changed load'
    inv.db.set_doc(('players', 'player', 'workoutLogs', 'p_w1s1'), log)
    with pytest.raises(GatewayError): validate_workout_start(inv)
    assert not inv.db.get_doc(GRANT)


def test_transaction_retry_rechecks_revoked_reviewer_before_authorizing():
    inv = request()
    inv.db.before_commit = lambda db: db.set_doc(('trainingReviewers', 'reviewer'), {'enabled': False, 'scopeType': 'posetek'})
    with pytest.raises(GatewayError): validate_workout_start(inv)
    assert not inv.db.get_doc(GRANT)


def test_native_persistence_cannot_bypass_restricted_mobile_gate():
    inv = request(); value = saved_plan(inv); value['planId'] = 'new-native'
    inv.capability = 'generate_training_plan'; inv.job_id = 'native'
    inv.db.set_doc(('config', 'llm'), {'wholeBodyTraining': {'previewEnabled': True, 'mobileVerified': False}})
    with pytest.raises(GatewayError, match='Expanded training plans remain drafts'):
        persist_program(inv, value, {})
    assert not inv.db.get_doc(('players', 'player', 'trainingPlans', 'new-native'))
    assert saved_plan(inv)['status'] == 'active'
