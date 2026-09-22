from copy import deepcopy
import pytest

from gateway.manual_workout import save_workout_edit
from gateway.errors import GatewayError
from tests.test_workout_persistence_v3 import setup, saved_plan


def request():
    inv, plan = setup()
    inv.capability = 'save_workout_edit'; inv.job_id = 'manual-job'
    inv.uid = 'admin'; inv.trusted_claims = {'uid': 'admin', 'email': 'admin@posetek.net', 'email_verified': True}
    current = deepcopy(plan['weeks'][0]['workouts'][0]); current['title'] = 'Reviewed practice'
    inv.params = {'planId': 'p', 'workoutId': 'w1s1', 'expectedPlanRevision': 1,
        'expectedWorkoutRevision': 1, 'expectedScheduleRevision': 1, 'workout': current,
        'rationale': 'Keep the current dose and clarify the title.'}
    return inv


def test_server_manual_save_atomic_and_idempotent_preserves_siblings():
    inv = request(); before = saved_plan(inv)
    result = save_workout_edit(inv)
    assert result['newPlanRevision'] == 2 and result['newWorkoutRevision'] == 2
    assert save_workout_edit(inv) == result
    after = saved_plan(inv)
    assert after['weeks'][0]['workouts'][0]['title'] == 'Reviewed practice'
    assert after['weeks'][0]['workouts'][1] == before['weeks'][0]['workouts'][1]
    assert len(inv.db.get_collection(('players', 'player', 'planAdjustments'))) == 1


@pytest.mark.parametrize('field', ['expectedPlanRevision', 'expectedWorkoutRevision', 'expectedScheduleRevision'])
def test_stale_manual_revision_does_not_write(field):
    inv = request(); before = saved_plan(inv); inv.params[field] = 4
    with pytest.raises(GatewayError): save_workout_edit(inv)
    assert saved_plan(inv) == before


def test_unverified_actor_and_reused_request_cannot_save():
    inv = request(); inv.trusted_claims['email_verified'] = False
    with pytest.raises(GatewayError): save_workout_edit(inv)
    inv = request(); save_workout_edit(inv); inv.params['workout']['title'] = 'Changed retry'
    with pytest.raises(GatewayError): save_workout_edit(inv)


def test_manual_edit_cannot_reschedule_or_reassign_block_identity():
    inv = request(); inv.params['workout']['scheduledDate'] = '2026-09-10'
    with pytest.raises(GatewayError): save_workout_edit(inv)
    inv = request(); inv.params['workout']['blocks'][0]['drillId'] = 'STR-501'
    with pytest.raises(GatewayError): save_workout_edit(inv)
