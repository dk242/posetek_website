"""Observed semantic failure through real tools, final persistence and Apply.

Firestore/provider are offline fakes. The regression fixture contains real UI
workout dose inputs; model repair actions are authored, not live-model evidence.
"""
from copy import deepcopy
import json
from pathlib import Path

import pytest

from gateway.ctx import Invocation
from gateway.errors import GatewayError
from gateway.pipeline import run_stream_capability, run_job_capability
from gateway.workout_requirements import derive_requirements, requirement_check, domain_minutes, bind_request_requirements
from gateway.workout_persistence import persist_program, persist_workout_draft, apply_workout_draft
from gateway.workout_time import estimate_workout
from gateway.workout_tools import validate_workout
from tests.conftest import FakeFirestore, FakeStorage
from tests.test_workout_chat import ScriptedProvider, doc, reset_config_cache
from tests.test_workout_persistence_v3 import NOW, drill, plan

FIXTURE = json.loads((Path(__file__).parent / 'fixtures/workout_adjustment_live_regression.json').read_text())


def observed_seed(message=None):
    db = FakeFirestore()
    db.set_doc(('players', 'player'), {'authenticationUID': 'athlete', 'age': 18, 'maxDrillDifficulty': 3})
    blocks = FIXTURE['before']['blocks'] + FIXTURE['rejectedProposal']['blocks']
    for block in blocks:
        row = drill(block['drillId'], difficulty=3 if block['drillId'] == 'PAS-005' else 2)
        row.update(domain=block['domain'], name=block['name'])
        # This fixture isolates request semantics. Production eligibility still
        # runs; bounded catalog ranges encompass the observed and repaired doses.
        row['dose'].update(setsMin=1, setsMax=6, repsMin=1, repsMax=60,
            repUnit=block['repUnit'], perSide=block['perSide'], restScope=block['restScope'],
            restSecondsMin=block['restSeconds'], restSecondsMax=block['restSeconds'])
        db.set_doc(('drillCatalog', block['drillId']), row)
    p = plan()
    p.update(horizonWeeks=1, sessionsPerWeek=1, minutesPerSession=60, weeklyBudgetMinutes=60)
    p['intake'].update(horizonWeeks=1, sessionsPerWeek=1, minutesPerSession=60, setting='partner')
    p['weeks'] = p['weeks'][:1]
    p['weeks'][0]['workouts'] = [deepcopy(FIXTURE['before'])]
    p['weeks'][0]['workouts'][0]['check'] = {'intentStatus': 'pass', 'timeStatus': 'ok', 'deltaMinutes': 0}
    inv = Invocation(capability='generate_training_plan', player_id='player', uid='athlete',
                     db=db, storage=FakeStorage(), context={'now': NOW})
    persist_program(inv, p, {})
    db.set_doc(('config', 'llm'), {'globalEnabled': True, 'capabilities': {
        'workout_chat': {'enabled': True, 'dailyLimitPerUser': 3},
        'apply_workout_draft': {'enabled': True, 'dailyLimitPerUser': 30}}})
    inv.capability = 'workout_chat'; inv.context = {'now': NOW}
    inv.params = {'message': message or FIXTURE['ask'], 'context': {'workoutRef': {
        'kind': 'plan', 'planId': 'p', 'workoutId': 'w1s1'}}}
    return inv


BAD_ACTIONS = [
    ('draft_set_intent', {'intent': FIXTURE['rejectedProposal']['intent']}),
    ('search_drills', {'domains': ['passing'], 'difficultyPreference': 'easier', 'limit': 25}),
    ('draft_remove_block', {'blockId': 'b9'}),
    ('draft_add_block', {'drillId': 'PAS-005', 'sets': 3, 'reps': 8, 'restSeconds': 30, 'afterBlockId': 'b10'}),
    ('validate_workout', {})]
REPAIR_ACTIONS = [('draft_set_dose', {'blockId': 'b15', 'sets': 6}),
                  ('draft_set_dose', {'blockId': 'b12', 'sets': 4}), ('validate_workout', {})]


class RepairProvider(ScriptedProvider):
    def stream(self, **kwargs):
        attempt = len(self.calls)
        self.actions = BAD_ACTIONS if not attempt else REPAIR_ACTIONS
        self.answer = 'WRONG: 57 minutes is close enough.' if not attempt else 'Ready to review: 20 minutes of passing in your 60-minute workout.'
        yield from super().stream(**kwargs)


def test_observed_proposal_fails_measured_focus_and_explicit_duration():
    rules = derive_requirements(FIXTURE['ask'], FIXTURE['before'])
    result = requirement_check(FIXTURE['rejectedProposal'], rules)
    assert result['focus']['passing'] == {'direction': 'more', 'beforeMinutes': 19,
        'currentMinutes': 16, 'requiredMinutes': 20}
    assert result['calculatedMinutes'] == 57 and result['requestedMinutes'] == 60
    assert {v['code'] for v in result['violations']} == {'request_focus', 'request_duration'}
    inv = observed_seed()
    catalog = {s.id: s.to_dict() for s in inv.db.collection('drillCatalog').stream()}
    # Reproduce why the prior general checker accepted it; its tolerance is not
    # globally tightened for generation or ordinary approximate workouts.
    assert validate_workout(FIXTURE['rejectedProposal'], catalog, {'age': 18, 'intake': {'equipment': ['ball']},
        'technicalEligibility': {'maxDrillDifficulty': 3}})['ok']


@pytest.mark.parametrize('text,expected', [
    ('More easy passing and first touch, less shooting.', {'passing': 'more', 'receiving': 'more', 'shooting': 'less'}),
    ('Increase strength and agility. Reduce dribbling.', {'strength': 'more', 'agility': 'more', 'dribbling': 'less'}),
    ('I want fewer jumps and more ball mastery.', {'plyometrics': 'less', 'ballMastery': 'more'}),
    ('Do not add more passing. More shooting please.', {'shooting': 'more'}),
    ('The coach said "more passing". I want less shooting.', {'shooting': 'less'}),
])
def test_relative_requests_are_generalized_and_negation_is_local(text, expected):
    result = derive_requirements(text, FIXTURE['before'])
    assert {k: v['direction'] for k, v in result['focus'].items()} == expected


@pytest.mark.parametrize('text', ['Keep the workout at 60 minutes.', 'Keep the workout at60minutes.',
    'Make it 60 mins.', 'Exactly 60 minutes please.'])
def test_explicit_duration_including_compact_ui_input(text):
    assert derive_requirements(text, FIXTURE['before'])['durationMinutes'] == 60


def test_title_budget_or_mutable_baseline_cannot_fake_compliance():
    before = deepcopy(FIXTURE['before'])
    rules = derive_requirements(FIXTURE['ask'], before)
    before['blocks'].clear()
    fake = deepcopy(FIXTURE['rejectedProposal'])
    fake.update(title='Much more passing', estimatedMinutes=60, budgetMinutes=57, focusDomains=['passing'])
    checked = requirement_check(fake, rules)
    assert not checked['ok'] and checked['focus']['passing']['beforeMinutes'] == 19


def test_same_turn_repair_preserves_quota_metering_stream_and_apply(monkeypatch):
    # Windows' coarse monotonic clock can give the two fast fake calls the
    # same timestamp. Advance a controlled clock instead of relying on CPU load.
    from itertools import count
    from types import SimpleNamespace
    ticks = count()
    monkeypatch.setattr('gateway.workout_chat.time', SimpleNamespace(monotonic=lambda: next(ticks) * .01))
    inv = observed_seed(); provider = RepairProvider(inv)
    monkeypatch.setattr('gateway.providers.base.get_provider', lambda _: provider)
    events = list(run_stream_capability(inv))
    assert events[-1]['type'] == 'done', events
    assert len(provider.calls) == 2
    initial = [r for name, r in provider.results if name == 'validate_workout'][0]
    assert not initial['ok'] and initial['request']['focus']['passing']['currentMinutes'] == 16
    assert 'WRONG' not in ''.join(e.get('text', '') for e in events)
    proposal = next(e for e in events if e['type'] == 'draft')
    w = proposal['workout']; assert domain_minutes(w)['passing'] == 20
    assert estimate_workout(w['blocks'])['estimatedMinutes'] == w['budgetMinutes'] == 60
    assert len({b['drillId'] for b in w['blocks']}) == len(w['blocks'])
    assert provider.calls[1]['params']['max_tool_calls'] == 25
    assert provider.calls[1]['params']['max_tool_seconds'] < provider.calls[0]['params']['max_tool_seconds']
    assert doc(inv, 'trainingPlans', 'p')['weeks'][0]['workouts'][0]['revision'] == 1
    saved = doc(inv, 'workoutDrafts', proposal['draftId'])
    assert saved['requestRequirements']['focus']['passing']['baselineMinutes'] == 19
    rows = [s.to_dict() for s in inv.db.collection('llmUsage').stream()]
    assert len(rows) == 4 and {r['callIndex'] for r in rows} == {1, 2, 3, 4}
    assert len({r['invocationId'] for r in rows}) == 1
    counters = [s.to_dict() for s in inv.db.collection('llmDailyAllowances').stream()]
    assert len(counters) == 1 and len(counters[0]['invocationIds']) == 1
    assistant = inv.player_ref().collection('aiConversations').document(inv.conversation_id).collection('messages').document(events[-1]['messageId']).get().to_dict()
    assert assistant['content'] == ''.join(e['text'] for e in events if e['type'] == 'delta')
    inv.capability = 'apply_workout_draft'; inv.params = {'draftId': proposal['draftId']}
    applied = apply_workout_draft(inv)
    assert apply_workout_draft(inv) == applied
    assert doc(inv, 'trainingPlans', 'p')['weeks'][0]['workouts'][0]['revision'] == 2


@pytest.mark.parametrize('legacy_draft', [False, True])
def test_final_persistence_and_apply_recheck_contract_even_if_tool_validation_skipped(monkeypatch, legacy_draft):
    inv = observed_seed(); provider = RepairProvider(inv)
    monkeypatch.setattr('gateway.providers.base.get_provider', lambda _: provider)
    events = list(run_stream_capability(inv)); proposal = next(e for e in events if e['type'] == 'draft')
    inv.context['workoutDraft']['workout'] = deepcopy(FIXTURE['rejectedProposal'])
    with pytest.raises(GatewayError, match='Requested more passing'):
        persist_workout_draft(inv)
    ref = inv.player_ref().collection('workoutDrafts').document(proposal['draftId'])
    changed = ref.get().to_dict()
    changed['workout'] = deepcopy(FIXTURE['rejectedProposal'])
    if legacy_draft:
        changed.pop('requestRequirements')
    ref.set(changed)
    inv.params = {'draftId': proposal['draftId']}; inv.capability = 'apply_workout_draft'
    with pytest.raises(GatewayError, match='Requested more passing'):
        apply_workout_draft(inv)
    assert doc(inv, 'trainingPlans', 'p')['weeks'][0]['workouts'][0]['revision'] == 1
    assert ref.get().to_dict()['status'] == 'proposed'


def test_resumed_contract_preserves_unmentioned_constraints_and_uses_visible_baseline():
    first = derive_requirements(FIXTURE['ask'], FIXTURE['before'])
    pending = deepcopy(FIXTURE['before']); pending['blocks'][1]['sets'] = 6
    current = domain_minutes(pending)['passing']
    inv = type('Context', (), {'context': {'workoutContext': {'workout': FIXTURE['before']},
        'workoutDraft': {'workout': pending}, 'priorWorkoutRequirements': first}})()
    contract = bind_request_requirements(inv, 'Less shooting and more passing please.')
    assert contract['focus']['passing']['baselineMinutes'] == current
    assert contract['focus']['shooting']['baselineMinutes'] == 15
    assert contract['durationMinutes'] == 60
    inv.context['workoutDraft']['workout'] = deepcopy(FIXTURE['before'])  # model reset
    assert inv.context['workoutRequirements']['focus']['passing']['baselineMinutes'] == current
    assert not requirement_check(inv.context['workoutDraft']['workout'], contract)['ok']


def test_unsatisfied_repair_is_bounded_and_never_presents_invalid_candidate(monkeypatch):
    inv = observed_seed(); provider = ScriptedProvider(inv, BAD_ACTIONS, answer='WRONG: Ready at 57 minutes.')
    monkeypatch.setattr('gateway.providers.base.get_provider', lambda _: provider)
    events = list(run_stream_capability(inv))
    assert len(provider.calls) == 2
    assert events[-1]['type'] == 'done' and not any(e['type'] in ('draft', 'error') for e in events)
    text = ''.join(e.get('text', '') for e in events)
    assert 'WRONG' not in text and 'Requested more passing' in text and 'duration 60' in text
    assert not list(inv.player_ref().collection('workoutDrafts').stream())


@pytest.mark.parametrize('text', ['No more passing today.', "Don't add more passing.",
    'Do I need more passing?', 'Should I do more passing?', 'Why is there less shooting?',
    'If I wanted more passing, what would you recommend?',
    "More passing isn't what I want.", 'More passing is not what I want.',
    'Can you explain how more passing affects my game?',
    'My coach says, more passing is good. Keep the same workout.'])
def test_nonrequests_never_reverse_negation_or_information_into_an_edit(text):
    assert derive_requirements(text, FIXTURE['before']) is None


def test_equipment_negation_does_not_swallow_actual_request():
    result = derive_requirements('I do not have cones, so give me more passing.', FIXTURE['before'])
    assert result['focus']['passing']['direction'] == 'more'


@pytest.mark.parametrize('text', ['At most 60 minutes.', 'No more than60minutes.', 'I have 60 minutes.', 'Only 60 minutes today.',
    'At most 60 minute workout.', 'Only 60-minute session.', 'Keep the workout under 60 minutes.',
    'Keep it below60 minutes.'])
def test_available_time_is_a_ceiling_not_forced_filler(text):
    contract = derive_requirements(text, FIXTURE['before'])
    assert contract['durationMode'] == 'maximum'
    assert requirement_check(FIXTURE['rejectedProposal'], contract)['ok']
    longer = deepcopy(FIXTURE['before']); longer['blocks'][1]['sets'] = 6
    assert not requirement_check(longer, contract)['ok']


def test_general_duration_noun_and_explicit_override():
    first = derive_requirements('I want a 60-minute workout.', FIXTURE['before'])
    assert first['durationMinutes'] == 60 and first['durationMode'] == 'exact'
    override = derive_requirements('Only 30 minutes today.', FIXTURE['before'], first)
    assert override['durationMinutes'] == 30 and override['durationMode'] == 'maximum'



def test_exhausted_action_budget_does_not_start_a_second_paid_attempt(monkeypatch):
    inv = observed_seed(); provider = ScriptedProvider(inv, BAD_ACTIONS + [('draft_get', {})] * 25)
    monkeypatch.setattr('gateway.providers.base.get_provider', lambda _: provider)
    events = list(run_stream_capability(inv))
    assert len(provider.calls) == 1 and len(provider.results) == 30
    assert events[-1]['type'] == 'done' and not any(e['type'] == 'draft' for e in events)
    assert len(list(inv.db.collection('llmUsage').stream())) == 2


def test_read_only_safety_reply_does_not_start_repair_or_create_a_proposal(monkeypatch):
    inv = observed_seed('My knee hurts, but I want more passing.')
    provider = ScriptedProvider(inv, [], answer='Stop training and tell a trusted adult about the pain.')
    monkeypatch.setattr('gateway.providers.base.get_provider', lambda _: provider)
    events = list(run_stream_capability(inv))
    assert len(provider.calls) == 1 and events[-1]['type'] == 'done'
    assert not any(e['type'] == 'draft' for e in events)
    assert not inv.context.get('workoutDraft')
    assert 'Stop training' in ''.join(e.get('text', '') for e in events)



def test_real_resumed_proposal_reset_cannot_lower_frozen_focus_baseline(monkeypatch):
    inv = observed_seed(); provider = RepairProvider(inv)
    monkeypatch.setattr('gateway.providers.base.get_provider', lambda _: provider)
    first = next(e for e in run_stream_capability(inv) if e['type'] == 'draft')
    resumed = Invocation(capability='workout_chat', player_id=inv.player_id, uid=inv.uid,
        db=inv.db, storage=inv.storage, conversation_id=inv.conversation_id, context={'now': NOW},
        params={'message': 'More passing please.', 'context': {'workoutRef': {
            'kind': 'plan', 'planId': 'p', 'workoutId': 'w1s1'}, 'draftId': first['draftId']}})
    from tests.test_workout_chat import create
    reset = ScriptedProvider(resumed, [create, ('draft_set_intent', {'title': 'More passing'})])
    monkeypatch.setattr('gateway.providers.base.get_provider', lambda _: reset)
    events = list(run_stream_capability(resumed))
    assert resumed.context['workoutRequirements']['focus']['passing']['baselineMinutes'] == 20
    assert resumed.context['workoutRequirements']['durationMinutes'] == 60
    assert len(reset.calls) == 2 and not any(e['type'] == 'draft' for e in events)
    assert doc(inv, 'workoutDrafts', first['draftId'])['status'] == 'proposed'



def test_time_ceiling_accepts_existing_shorter_budget_without_filler():
    from tests.test_workout_chat import seed
    inv = seed()
    thirty = doc(inv, 'trainingPlans', 'p')['weeks'][0]['workouts'][0]
    contract = derive_requirements('At most 60 minutes.', thirty)
    assert thirty['estimatedMinutes'] == thirty['budgetMinutes'] == 30
    assert requirement_check(thirty, contract)['ok']


def test_legacy_resume_unrelated_edit_cannot_erase_original_request(monkeypatch):
    inv = observed_seed(); provider = RepairProvider(inv)
    monkeypatch.setattr('gateway.providers.base.get_provider', lambda _: provider)
    first = next(e for e in list(run_stream_capability(inv)) if e['type'] == 'draft')
    ref = inv.player_ref().collection('workoutDrafts').document(first['draftId'])
    legacy = ref.get().to_dict(); legacy.pop('requestRequirements')
    legacy['workout'] = deepcopy(FIXTURE['rejectedProposal'])
    ref.set(legacy)
    resumed = Invocation(capability='workout_chat', player_id=inv.player_id, uid=inv.uid,
        db=inv.db, storage=inv.storage, conversation_id=inv.conversation_id, context={'now': NOW},
        params={'message': 'Make the title clearer.', 'context': {'workoutRef': {
            'kind': 'plan', 'planId': 'p', 'workoutId': 'w1s1'}, 'draftId': first['draftId']}})
    provider = ScriptedProvider(resumed, [('draft_set_intent', {'title': 'Clearer title'})])
    monkeypatch.setattr('gateway.providers.base.get_provider', lambda _: provider)
    events = list(run_stream_capability(resumed))
    assert resumed.context['workoutRequirements']['focus']['passing']['baselineMinutes'] == 19
    assert resumed.context['workoutRequirements']['durationMinutes'] == 60
    assert not any(e['type'] == 'draft' for e in events)
    assert ref.get().to_dict()['status'] == 'proposed'



def test_exhausted_catalog_and_fixed_doses_end_with_honest_feedback_not_safety_error(monkeypatch):
    inv = observed_seed()
    # Every original passing dose is already at its fixed maximum, and the only
    # distinct catalog alternative is unavailable. Duplicate IDs remain illegal.
    for block in FIXTURE['before']['blocks']:
        ref = inv.db.collection('drillCatalog').document(block['drillId'])
        row = ref.get().to_dict()
        row['dose'].update(setsMin=block['sets'], setsMax=block['sets'],
                           repsMin=block['reps'], repsMax=block['reps'])
        ref.set(row)
    inv.db.collection('drillCatalog').document('PAS-005').update({'status': 'archived'})
    provider = ScriptedProvider(inv, BAD_ACTIONS, answer='WRONG: I added more easy passing drills.')
    monkeypatch.setattr('gateway.providers.base.get_provider', lambda _: provider)
    events = list(run_stream_capability(inv))
    searches = [result for name, result in provider.results if name == 'search_drills']
    assert searches[0]['results'] == []
    assert len(provider.calls) == 2 and events[-1]['type'] == 'done'
    assert not any(e['type'] in ('draft', 'error') for e in events)
    text = ''.join(e.get('text', '') for e in events)
    assert 'WRONG' not in text and "couldn't" in text and 'relax one' in text
    assert not list(inv.player_ref().collection('workoutDrafts').stream())
    assert doc(inv, 'trainingPlans', 'p')['weeks'][0]['workouts'][0]['estimatedMinutes'] == 60
