"""Offline cross-route checks for the existing schema-3 athlete consumers.

These exercise gateway persistence and the documented Swift reader boundary;
they are not an Xcode/device execution claim. All athletes and media are synthetic.
"""
from copy import deepcopy
import json
from unittest.mock import patch

import pytest

from evals.program_v3 import seed_invocation
from gateway.personalized_plans import activate_draft, generate_draft
from gateway.personalized_views import public_plan
from gateway.personalized_evidence import read_authoritative_results, read_estimates, _qualified
from gateway.personalized_assessment import prepare_personalized_profile
from gateway.program_profile import assemble_program_profile
from gateway.program_generator import run_program
from gateway.workout_persistence import _active, _executable
from gateway.workout_time import estimate_block
from gateway.errors import GatewayError
from tests.conftest import FakeStorage
from tests.test_personalized_plans import activation
from tests.test_program_generator_v3 import ConstructingProvider


class EvidenceStorage(FakeStorage):
    def read_evidence_json(self, path):
        return self.download_json(path)

    def object_metadata(self, path):
        return self.download_json(path + '.object-metadata')


def native_invocation():
    """The current Swift request has no evidenceWindow or methodology flags."""
    inv = seed_invocation('cb15')
    inv.params['intake']['horizonWeeks'] = 1
    inv.storage = EvidenceStorage()
    for snap in inv.player_ref().collection('reps').stream():
        rep = snap.to_dict()
        folder = f'{inv.player_id}/dribbling/session{rep["sessionNumber"]}/kick{rep["repNumber"]}'
        rep['storagePath'] = folder + '/dribbling.mov'
        inv.player_ref().collection('reps').document(snap.id).set(rep)
        inv.storage.put(folder + '/metadata.json', {
            'totalTime': rep['totalTime'], 'resultsValid': True,
            'processingStatus': 'complete', 'failedSteps': []})
        inv.storage.put(folder + '/reprocess_context.json', {
            'rep': {'repId': snap.id, 'playerDocId': inv.player_id},
            'result': {'resultsValid': True, 'primaryMetric': rep['totalTime']}})
    inv.params['statsProfile']['drills'] = [{
        'drill': 'dribbling', 'displayName': 'Dribbling', 'repCount': 6,
        'sessionCount': 2, 'isLowConfidence': False,
        'lastRecorded': inv.context['_now'].isoformat(),
        'metrics': [{'metric': 'dribbleTotalTime', 'score': 51.99,
                     'bestCanonical': 12.0, 'latestCanonical': 12.0,
                     'referenceCanonical': 6.2391, 'repCount': 6,
                     'band': 'developing', 'bestFormatted': '12.00 s',
                     'unitLabel': 's'}]}]
    return inv


def consumer_boundary(plan):
    """Required/forbidden keys from TrainingPlanModels.swift's strict v3 branch."""
    assert plan['schemaVersion'] == 3
    assert all(isinstance(plan[key], str) and plan[key]
               for key in ('playerId', 'status', 'startDate', 'timezone'))
    assert 'retest' not in plan
    for week in plan['weeks']:
        assert week['weekNumber'] >= 1
        for workout in week['workouts']:
            assert workout['workoutId'] and 'isRetest' not in workout
            for block in workout['blocks']:
                assert block['blockId'] and block['drillId']
                assert block['kind'] != 'retest'
                assert 'isMeasuredDrill' not in block and 'measuredDrillType' not in block
                assert isinstance(block['whyIncluded'], str) and block['whyIncluded']
                assert len(block['whyIncluded']) <= 200
                assert estimate_block(block)['estimatedMinutes'] == block['estimatedMinutes']


@pytest.fixture(scope='module')
def native_plan():
    inv = native_invocation()
    params = deepcopy(inv.params)
    before_reps = deepcopy(inv.db.get_collection(('players', inv.player_id, 'reps')))
    with patch('gateway.providers.base.get_provider', lambda _: ConstructingProvider(inv)):
        plan, _ = run_program(inv)
    return inv, plan, params, before_reps


def test_existing_native_request_gets_new_methodology_and_active_plan(native_plan):
    inv, plan, params, before_reps = native_plan
    assert set(params) == {'planVersion', 'statsProfile', 'intake', 'timezone'}
    assert plan['status'] == 'active' and plan['assessment']['methodologyVersion']
    assert plan['assessment']['priorities']
    saved = inv.db.get_doc(('players', inv.player_id, 'trainingPlans', plan['planId']))
    assert saved == plan
    assert inv.db.get_doc(('players', inv.player_id, 'workoutSchedule', 'current'))['revision'] == 1
    assert inv.db.get_collection(('players', inv.player_id, 'reps')) == before_reps
    assert not inv.db.get_collection(('players', inv.player_id, 'personalizedPlanDrafts'))


def test_native_schema_and_why_text_survive_executable_snapshot(native_plan):
    _, plan, _, _ = native_plan
    consumer_boundary(plan)
    for week in plan['weeks']:
        for workout in week['workouts']:
            snapshot = _executable(workout)
            assert 'previousRevision' not in snapshot
            assert [b['whyIncluded'] for b in snapshot['blocks']] == [b['whyIncluded'] for b in workout['blocks']]
            assert all(b.get('trainingRationale') for b in snapshot['blocks'])


@pytest.fixture(scope='module')
def admin_draft():
    inv = native_invocation()
    inv.capability = 'generate_personalized_plan'
    inv.uid = 'admin'
    inv.trusted_claims = {'uid': 'admin', 'email': 'reviewer@posetek.net', 'email_verified': True}
    with patch('gateway.providers.base.get_provider', lambda _: ConstructingProvider(inv)):
        result, _ = generate_draft(inv)
    draft = inv.db.get_doc(('players', inv.player_id, 'personalizedPlanDrafts', result['draftId']))
    return inv, draft


def test_admin_draft_requires_explicit_activation_and_keeps_same_consumer_shape(admin_draft):
    inv, draft = deepcopy(admin_draft)
    assert not inv.db.get_collection(('players', inv.player_id, 'trainingPlans'))
    assert not inv.db.get_collection(('players', inv.player_id, 'workoutSchedule'))
    assert draft['status'] == 'ready' and draft['plan']['status'] == 'draft'
    view = inv.db.get_doc(('players', inv.player_id, 'personalizedPlanDraftViews', draft['draftId']))
    assert view['plan']['assessment']['methodologyVersion']
    assert view['plan']['assessment']['priorities']
    activation(inv, draft)
    result = activate_draft(inv)
    plan = inv.db.get_doc(('players', inv.player_id, 'trainingPlans', result['planId']))
    assert plan['status'] == 'active'
    assert plan['assessment']['priorities'] == view['plan']['assessment']['priorities']
    consumer_boundary(plan)
    assert not inv.db.get_collection(('players', inv.player_id, 'workoutLogs'))


def test_safe_priority_projection_drops_private_provenance(native_plan):
    _, plan, _, _ = native_plan
    value = deepcopy(plan)
    marker = 'PRIVATE_HANDOFF_SENTINEL'
    value['assessment']['priorities'][0]['source'] = {'objectPath': marker}
    value['assessment']['priorities'][0]['reviewerUid'] = marker
    block = value['weeks'][0]['workouts'][0]['blocks'][0]
    block['trainingRationale']['privateEvidence'] = marker
    value['assessment']['inputs']['rawEstimateDocuments'] = marker
    projected = public_plan(value)
    assert marker not in json.dumps(projected, default=str)
    assert projected['assessment']['priorities']
    assert projected['weeks'][0]['workouts'][0]['blocks'][0]['trainingRationale']


def test_saved_schema3_plan_without_new_methodology_remains_executable(native_plan):
    _, current, _, _ = native_plan
    saved = deepcopy(current)
    saved['assessment'].pop('methodologyVersion', None)
    saved['assessment'].pop('priorities', None)
    for week in saved['weeks']:
        for workout in week['workouts']:
            for block in workout['blocks']:
                block.pop('trainingRationale', None)
    before = deepcopy(saved)
    _active(saved)
    consumer_boundary(saved)
    for week in saved['weeks']:
        assert all(_executable(workout)['blocks'] for workout in week['workouts'])
    assert saved == before


def with_conditional_agility(inv):
    ident = 'incomplete_shuttle'
    folder = f'{inv.player_id}/changeOfDirection/session1/kick1'
    path = folder + '/change_of_direction.mov'
    at = round(inv.context['_now'].timestamp() * 1000)
    rep = {'repType': 'changeOfDirection', 'drillType': 'changeOfDirection',
           'createdAt': inv.context['_now'], 'sessionNumber': 1, 'repNumber': 1,
           'storagePath': path, 'totalTime': None, 'resultsValid': False,
           'processingStatus': 'partial', 'failedSteps': ['cod.frames.end']}
    inv.player_ref().collection('reps').document(ident).set(rep)
    inv.storage.put(folder + '/metadata.json', deepcopy(rep))
    inv.storage.put(folder + '/reprocess_context.json', {
        'rep': {'repId': ident, 'playerDocId': inv.player_id},
        'result': {'resultsValid': False, 'primaryMetric': None}})
    md5 = 'AAAAAAAAAAAAAAAAAAAAAA=='
    inv.storage.put(path + '.object-metadata', {'generation': '123', 'md5Hash': md5, 'size': 1})
    entry = {'id': 'reviewed_shuttle_estimate', 'repId': ident, 'drill': 'changeOfDirection',
             'axis': 'agility', 'kind': 'conditionalEstimate', 'status': 'active',
             'method': 'partial_shuttle_visual_start_v1', 'confidence': 'low',
             'protocolConfirmed': True, 'startBoundary': 'visualBracket',
             'estimatedTotalSeconds': 7.0, 'lowerSeconds': 6.0, 'upperSeconds': 8.0,
             'observedCourseFraction': .65, 'recordedAtMillis': at, 'reviewedAtMillis': at,
             'reviewedByUid': 'synthetic_reviewer',
             'source': {'playerId': inv.player_id, 'repId': ident, 'drill': 'changeOfDirection',
                        'recordedAtMillis': at, 'storagePath': path, 'generation': '123',
                        'md5Hash': md5, 'sha256': 'f' * 64}}
    inv.player_ref().collection('insightMetadata').document('provisionalEstimates').set({
        'schemaVersion': 1, 'playerId': inv.player_id, 'entries': [entry]})
    return ident, entry


def test_old_native_request_can_read_reviewed_estimate_without_fabricating_result():
    inv = native_invocation()
    ident, entry = with_conditional_agility(inv)
    before = deepcopy(inv.db._docs)
    evidence = read_authoritative_results(inv)
    source = next(row for row in evidence['rows'] if row['id'] == ident)
    assert source['qualified'] is False and source['primaryValue'] is None
    estimates, _ = read_estimates(inv, evidence=evidence)
    assert len(estimates) == 1 and estimates[0]['estimatedTotalSeconds'] == entry['estimatedTotalSeconds']
    assert estimates[0]['kind'] == 'conditionalEstimate'
    assert 'score' not in estimates[0] and 'source' not in estimates[0] and 'reviewedByUid' not in estimates[0]
    assert inv.db._docs == before


def test_admin_estimate_use_remains_explicit_and_current_source_bound():
    inv = native_invocation()
    _, entry = with_conditional_agility(inv)
    inv.capability = 'generate_personalized_plan'
    inv.uid = 'admin'
    inv.trusted_claims = {'uid': 'admin', 'email': 'reviewer@posetek.net', 'email_verified': True}
    assert read_estimates(inv)[0] == []
    inv.params['useProvisionalEstimates'] = True
    assert len(read_estimates(inv)[0]) == 1
    inv.storage.put(entry['source']['storagePath'] + '.object-metadata', {
        'generation': '124', 'md5Hash': entry['source']['md5Hash'], 'size': 1})
    assert read_estimates(inv)[0] == []


def test_native_no_window_reconciles_server_dates_and_keeps_estimate_separate():
    inv = native_invocation()
    with_conditional_agility(inv)
    profile = prepare_personalized_profile(inv, assemble_program_profile(inv))
    assert set(profile['bestResults']) == {'dribbleTotalTime'}
    assert profile['bestResults']['dribbleTotalTime']['source'] == 'qualified_server_result'
    assert profile['bestResults']['dribbleTotalTime']['bestCanonical'] == 12
    assert profile['bestResults']['dribbleTotalTime']['repCount'] == 6
    assert len(profile['conditionalEstimates']) == 1
    assert profile['conditionalEstimates'][0]['drill'] == 'changeOfDirection'


def test_unmatched_native_snapshot_cannot_invent_a_measured_priority():
    inv = native_invocation()
    metric = inv.params['statsProfile']['drills'][0]['metrics'][0]
    metric['bestCanonical'] = 4.0
    metric['score'] = 155.98
    profile = prepare_personalized_profile(inv, assemble_program_profile(inv))
    assert not profile['bestResults']


def test_accepted_revision_uses_failure_millis_when_created_at_is_null():
    # Node qualifyRep uses createdAt ?? createdAtMillis, not a missing-key-only fallback.
    rep = {'id': 'r', 'repType': 'dribbling', 'totalTime': 8,
           'adminRevision': {'revisionId': 'rev', 'atMillis': 2000}}
    metadata = {'totalTime': 8, 'resultsValid': True, 'processingStatus': 'complete',
                'failedSteps': [], 'adminRevision': {'revisionId': 'rev'}}
    revision = {'revisionId': 'rev', 'fields': {'totalTime': 8}}
    assert _qualified(rep, metadata, {}, revision,
                      [{'createdAt': None, 'createdAtMillis': 1000}], None)


def test_malformed_sidecar_result_is_unqualified_not_a_plan_wide_exception():
    rep = {'id': 'r', 'repType': 'dribbling', 'totalTime': 8}
    metadata = {'totalTime': 8, 'resultsValid': True, 'processingStatus': 'complete', 'failedSteps': []}
    assert not _qualified(rep, metadata, {'result': ['not a result map']}, {}, [], None)


@pytest.mark.parametrize('change', ['withdrawn', 'source_generation'])
def test_native_does_not_activate_after_conditional_evidence_changes_during_generation(change):
    inv = native_invocation()
    _, entry = with_conditional_agility(inv)

    class ChangingProvider(ConstructingProvider):
        changed = False

        def generate(self, **kwargs):
            result = super().generate(**kwargs)
            if self.inv.context['_activeProgramCall']['stage'] == 'adversarial' and not self.changed:
                self.changed = True
                if change == 'withdrawn':
                    ref = inv.player_ref().collection('insightMetadata').document('provisionalEstimates')
                    document = ref.get().to_dict()
                    document['entries'][0]['status'] = 'withdrawn'
                    ref.set(document)
                else:
                    inv.storage.put(entry['source']['storagePath'] + '.object-metadata', {
                        'generation': '124', 'md5Hash': entry['source']['md5Hash'], 'size': 1})
            return result

    provider = ChangingProvider(inv)
    with patch('gateway.providers.base.get_provider', lambda _: provider), pytest.raises(GatewayError):
        run_program(inv)
    assert provider.changed
    assert not inv.db.get_collection(('players', inv.player_id, 'trainingPlans'))
    assert not inv.db.get_collection(('players', inv.player_id, 'trainingPlanContexts'))
    assert not inv.db.get_collection(('players', inv.player_id, 'workoutSchedule'))


def test_short_native_schedule_keeps_reviewed_primary_drills_inside_combined_target_cap():
    # Import locally: the shared synthetic helpers also use native_invocation.
    from tests.test_evidence_objectives_v1 import profile_and_catalog
    inv, _, _, _, _ = profile_and_catalog(('ballSpeed', 45), ('sprintCompletionTime', 55))
    inv.params['intake'].update(sessionsPerWeek=1, minutesPerSession=60,
                                goals=['passing', 'strengthPower'])
    before = deepcopy(inv.db.get_collection(('players', inv.player_id, 'reps')))
    with patch('gateway.providers.base.get_provider', lambda _: ConstructingProvider(inv)):
        plan, _ = run_program(inv)
    consumer_boundary(plan)
    split = plan['assessment']['focusSplit']
    assert set(split['measuredPriorityDomains']) == {'shooting', 'speed'}
    assert split['measuredPriorityMaxPct'] == 45
    week = plan['weeks'][0]
    rows = week['check']['allocation']['domains']
    targets = {row['domain']: row['targetMinutes'] for row in rows}
    # Small-dose folding formerly inflated these targets from 15+12 to 16+13.
    assert 0 < targets['shooting'] and 0 < targets['speed']
    assert targets['shooting'] + targets['speed'] <= 27
    projection = week['check']['allocationProjection']
    assert sum(targets.values()) + projection.get('unallocatedMinutes', 0) == 60
    assert projection['cappedMinutesByDomain']['shooting'] == 1
    assert projection['cappedMinutesByDomain']['speed'] == 1
    assert sum(row['actualMinutes'] for row in rows if row['domain'] in {'shooting', 'speed'}) <= 27
    ids = {block['drillId'] for workout in week['workouts'] for block in workout['blocks']}
    assert 'SHT-003' in ids and ids & {'SPD-002', 'SPD-003', 'SPD-004'}
    assert inv.db.get_collection(('players', inv.player_id, 'reps')) == before
