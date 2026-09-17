"""03A regressions: truthful emphasis, usable allocations and real legal progression."""
from collections import Counter
from copy import deepcopy

import pytest

from evals.program_v3 import PROFILES, seed_invocation
from gateway.catalog_v2 import eligible_drill, load_catalog
from gateway.errors import GatewayError
from gateway.program_composition import (
    DOMAIN_LABELS, QUALITY, catalog_capacity, compose_work_order,
    deliverable_week_allocations, describe_intent, dose_options, select_drills,
)
from gateway.program_focus import compute_focus_split
from gateway.program_profile import assemble_program_profile
from gateway.workout_time import dose_violations, estimate_block, estimate_workout
from tests.test_workout_tools_v3 import block, catalog_row, profile


def test_intent_distinguishes_leading_volume_from_small_support_and_strength():
    rows = {did: catalog_row(did, domain) for did, domain in (
        ('SPD-501', 'speed'), ('DRB-501', 'dribbling'), ('PAS-501', 'passing'), ('STR-501', 'strength'))}
    selected = [(did, {'estimatedMinutes': minutes}) for did, minutes in (
        ('SPD-501', 8), ('DRB-501', 30), ('PAS-501', 4), ('STR-501', 12))]
    intent = describe_intent(selected, rows)
    assert intent.startswith('Lead focus: dribbling (30 min).')
    assert 'passing (4 min)' in intent
    assert 'Start with fresh speed work.' in intent
    assert 'Strength work is in block 4.' in intent
    assert 'jump' not in intent and 'agility' not in intent


def test_intent_only_promises_quality_first_when_the_first_block_is_quality():
    rows = {'DRB-501': catalog_row(), 'SPD-501': catalog_row('SPD-501', 'speed')}
    intent = describe_intent([('DRB-501', {'estimatedMinutes': 20}), ('SPD-501', {'estimatedMinutes': 8})], rows)
    assert 'Start with fresh' not in intent
    assert 'speed (8 min)' in intent


def test_equal_largest_domain_minutes_are_shared_leads_not_secondary_support():
    rows = {did: catalog_row(did, domain) for did, domain in (
        ('SPD-501', 'speed'), ('PAS-501', 'passing'), ('SHT-501', 'shooting'), ('DRB-501', 'dribbling'))}
    selected = [(did, {'estimatedMinutes': minutes}) for did, minutes in (
        ('SPD-501', 6), ('PAS-501', 18), ('SHT-501', 18), ('DRB-501', 12))]
    intent = describe_intent(selected, rows)
    assert intent.startswith('Shared lead focus: passing (18 min) and shooting (18 min).')
    assert 'Supporting work: dribbling (12 min) and speed (6 min).' in intent
    assert 'Start with fresh speed work.' in intent


@pytest.mark.parametrize('passing_minutes,strength_minutes', [(8, 6), (6, 8)])
def test_final_technical_emphasis_follows_fresh_speed_before_support_and_strength(passing_minutes, strength_minutes):
    """Recreate the rejected VUSC 60-minute session without changing its doses."""
    prescriptions = [
        ('SPD-501', 'speed', 6), ('SPD-502', 'speed', 12),
        ('PAS-501', 'passing', passing_minutes), ('STR-501', 'strength', strength_minutes),
        ('DRB-501', 'dribbling', 19), ('DRB-502', 'dribbling', 4),
    ]
    rows = {}
    for did, domain, minutes in prescriptions:
        row = catalog_row(did, domain)
        row['dose'].update(setsMin=1, setsMax=1, repsMin=minutes * 60, repsMax=minutes * 60,
                           restSecondsMin=0, restSecondsMax=0)
        rows[did] = row
    options = {did: dose_options(row) for did, row in rows.items()}
    athlete = profile(level='club', intake={'minutesPerSession': 60, 'sessionsPerWeek': 2})
    # Earlier remaining budgets rank passing and strength above dribbling,
    # but the final legal doses give dribbling the largest actual volume.
    result = compose_work_order(athlete, rows, options, list(rows),
        {'speed': 20, 'passing': 30, 'strength': 25, 'dribbling': 25}, {},
        week_number=1, order=2, remaining={'speed': 18, 'passing': 24, 'strength': 20, 'dribbling': 19})
    assert [b['drillId'] for b in result['blocks']] == [
        'SPD-501', 'SPD-502', 'DRB-501', 'DRB-502', 'PAS-501', 'STR-501',
    ]
    assert result['intent'].startswith('Lead focus: dribbling (23 min).')
    assert 'Start with fresh speed work.' in result['intent']
    assert 'Strength work is in block 6.' in result['intent']
    assert result['estimatedMinutes'] == estimate_workout(result['blocks'])['estimatedMinutes'] == 60
    assert {b['drillId']: b['estimatedMinutes'] for b in result['blocks']} == {
        did: minutes for did, _, minutes in prescriptions
    }
    for current in result['blocks']:
        assert dose_violations(current, rows[current['drillId']]['dose']) == []


@pytest.mark.parametrize('domain', ['strength', 'speed', 'plyometrics', 'agility'])
def test_ordering_keeps_single_physical_domain_workouts_legal(domain):
    row = catalog_row('ONLY-501', domain)
    row['dose'].update(setsMin=1, setsMax=1, repsMin=15 * 60, repsMax=15 * 60,
                       restSecondsMin=0, restSecondsMax=0)
    athlete = profile(level='club', intake={'minutesPerSession': 15, 'sessionsPerWeek': 1})
    result = compose_work_order(athlete, {row['drillId']: row},
        {row['drillId']: dose_options(row)}, [row['drillId']], {domain: 100}, {},
        week_number=1, order=1, remaining={domain: 15})
    assert len(result['blocks']) == 1
    assert result['blocks'][0]['drillId'] == row['drillId']
    assert dose_violations(result['blocks'][0], row['dose']) == []
    assert result['estimatedMinutes'] == estimate_workout(result['blocks'])['estimatedMinutes'] == 15
    assert ('Start with fresh' in result['intent']) == (domain in QUALITY)


def test_week_allocations_fold_sub_dose_and_absent_domains_without_phantom_minutes():
    rows = {did: catalog_row(did, domain) for did, domain in (
        ('DRB-501', 'dribbling'), ('PAS-501', 'passing'), ('SPD-501', 'speed'))}
    options = {'DRB-501': [{'estimatedMinutes': 4}], 'PAS-501': [{'estimatedMinutes': 6}],
               'SPD-501': [{'estimatedMinutes': 10}]}
    result = deliverable_week_allocations(rows, options,
        {'dribbling': 40, 'passing': 40, 'speed': 10, 'receiving': 10}, 60)
    assert result['allocations'] == {'dribbling': 30, 'passing': 30, 'speed': 0, 'receiving': 0}
    assert result['foldedMinutesByDomain'] == {'speed': 6, 'receiving': 6}
    assert result['minimumDoseMinutes']['speed'] == 11
    assert sum(result['allocations'].values()) == 60


def test_week_allocations_refuse_when_no_domain_has_room_for_a_legal_dose():
    with pytest.raises(GatewayError, match='legal catalog dose'):
        deliverable_week_allocations({'DRB-501': catalog_row()},
            {'DRB-501': [{'estimatedMinutes': 30}]}, {'dribbling': 100}, 30)


def _single_domain_progression(reps, maximum):
    row = catalog_row()
    row['dose'].update(setsMin=4, setsMax=4, repsMin=300, repsMax=maximum)
    old = block(row, sets=4, reps=reps)
    previous = {'focusDomains': ['dribbling'], 'blocks': [old]}
    athlete = profile(level='club', intake={'minutesPerSession': 30, 'sessionsPerWeek': 1, 'horizonWeeks': 12})
    result = compose_work_order(athlete, {row['drillId']: row}, {row['drillId']: dose_options(row)},
        [row['drillId']], {'dribbling': 100}, {}, week_number=2, order=1,
        remaining={'dribbling': 30}, prior_workout=previous)
    return row, old, result


def test_progression_uses_time_tolerance_instead_of_repeating_exact_clock_forever():
    row, old, result = _single_domain_progression(405, 450)
    new = result['blocks'][0]
    assert old['estimatedMinutes'] == 30
    assert 30 < result['estimatedMinutes'] <= 35
    assert old['reps'] < new['reps'] <= old['reps'] + max(1, old['reps'] // 10)
    for key in ('sets', 'restSeconds', 'restScope', 'restBetweenSetsSeconds', 'repUnit', 'perSide'):
        assert new[key] == old[key]
    assert dose_violations(new, row['dose']) == []


@pytest.mark.parametrize('reps,maximum', [(450, 450), (480, 550)])
def test_progression_consolidates_at_catalog_or_time_ceiling(reps, maximum):
    row, old, result = _single_domain_progression(reps, maximum)
    assert result['blocks'][0]['reps'] == old['reps']
    assert result['estimatedMinutes'] <= 35
    assert dose_violations(result['blocks'][0], row['dose']) == []


@pytest.mark.parametrize('profile_id', [key for key, value in PROFILES.items() if not value.get('expectError')])
def test_real_catalog_composition_preserves_legal_doses_and_core_across_horizons(profile_id):
    """Exercise real age/equipment/frequency constraints without model responses."""
    inv = seed_invocation(profile_id)
    athlete = assemble_program_profile(inv)
    intake = athlete['intake']
    rows = {did: row for did, row in load_catalog(inv).items()
            if row['domain'] not in ('ballMastery', 'games')
            and eligible_drill(row, athlete, allow_partner=intake['setting'] in ('partner', 'halfAndHalf'))[0]}
    options = {did: dose_options(row) for did, row in rows.items()}
    split = compute_focus_split(athlete, {row['domain'] for row in rows.values()},
        capacity_pct=catalog_capacity(rows, options, intake['sessionsPerWeek'], intake['minutesPerSession']))['final']
    weekly_budget = intake['sessionsPerWeek'] * intake['minutesPerSession']
    allocation = deliverable_week_allocations(rows, options, split, weekly_budget)
    schedulable = {d: value if allocation['allocations'][d] else 0 for d, value in split.items()}
    previous = []
    previous_core = set()
    retained = progressed = 0
    for week in range(1, intake['horizonWeeks'] + 1):
        frequency = Counter()
        remaining = dict(allocation['allocations'])
        ranking = select_drills(rows, athlete, previous_core)
        workouts = []
        for order in range(1, intake['sessionsPerWeek'] + 1):
            prior = previous[order - 1] if previous else None
            workout = compose_work_order(athlete, rows, options, ranking, schedulable, frequency,
                week_number=week, order=order, remaining=remaining, prior_workout=prior)
            assert abs(workout['estimatedMinutes'] - intake['minutesPerSession']) <= max(5, intake['minutesPerSession'] * .1)
            assert estimate_workout(workout['blocks'])['estimatedMinutes'] == workout['estimatedMinutes']
            actual = Counter()
            old = {b['drillId']: b for b in (prior or {}).get('blocks', [])}
            fatigue = False
            for current in workout['blocks']:
                did = current['drillId']
                domain = rows[did]['domain']
                assert dose_violations(current, rows[did]['dose']) == []
                assert domain not in QUALITY or not fatigue
                fatigue = fatigue or domain not in QUALITY
                actual[domain] += current['estimatedMinutes']
                frequency[did] += 1
                assert frequency[did] <= rows[did]['maxFrequencyPerWeek']
                remaining[domain] -= current['estimatedMinutes']
                if did in old:
                    retained += 1
                    progressed += current['reps'] > old[did]['reps']
                    assert old[did]['reps'] <= current['reps'] <= old[did]['reps'] + max(1, old[did]['reps'] // 10)
                    for key in ('sets', 'restSeconds', 'restScope', 'restBetweenSetsSeconds', 'repUnit', 'perSide'):
                        assert current[key] == old[did][key]
            for domain, minutes in actual.items():
                assert f'{DOMAIN_LABELS[domain]} ({minutes} min)' in workout['intent']
            assert len(workout['intent']) <= 400
            workouts.append(workout)
        domain_minutes = Counter()
        for workout in workouts:
            for current in workout['blocks']:
                domain_minutes[rows[current['drillId']]['domain']] += current['estimatedMinutes']
        ball_minutes = sum(domain_minutes[d] for d in ('dribbling', 'passing', 'receiving', 'shooting'))
        assert ball_minutes / sum(domain_minutes.values()) >= PROFILES[profile_id]['expected']['ballShareMin']
        core = {b['drillId'] for w in workouts for b in w['blocks']}
        if previous_core:
            assert len(core & previous_core) / len(previous_core) >= .6
        previous_core = core
        previous = deepcopy(workouts)
    if profile_id == 'xmax12x4':
        # 03A measured 9/264 changed blocks (3.4%); require meaningful improvement
        # without relaxing any dose, frequency, retention or time assertion above.
        assert progressed / retained >= .15
