"""Best drill results influence programs without displacing age/position baselines."""
from collections import defaultdict
from copy import deepcopy
from unittest.mock import patch

import pytest

from gateway.errors import GatewayError
from gateway.program_focus import compute_focus_split, focus_policy
from gateway.program_profile import (
    DOMAINS, _best_result_evidence, assemble_program_profile,
)
from tests.test_program_focus_v3 import AVAILABLE, profile
from tests.test_program_profile_v3 import NOW, params


# Independently enumerate the product's primary results, rather than importing
# the implementation's allowlist into tests of that allowlist.
PRIMARY = [
    ('ballSpeed', 'kick', 'striking', 'shooting', 18.0),
    ('verticalJumpHeight', 'jump', 'power', 'plyometrics', 0.25),
    ('broadJumpDistance', 'broadJump', 'power', 'plyometrics', 1.4),
    ('sprintCompletionTime', 'sprint', 'speed', 'speed', 4.2),
    ('codTotalTime', 'changeOfDirection', 'agility', 'agility', 7.1),
    ('dribbleTotalTime', 'dribbling', 'ballControl', 'dribbling', 13.0),
]


def metric_row(mid, *, score=40, best=1.4, count=1, **extra):
    return {
        'metric': mid, 'score': score, 'band': 'developing',
        'bestCanonical': best, 'latestCanonical': best,
        'bestFormatted': str(best), 'unitLabel': 'm', 'repCount': count,
        **extra,
    }


def snapshot(*rows, axis_score=90):
    """Rows are (drill, category, metric), with no protocol/timestamp metadata."""
    drills = {}
    axes = {}
    for drill, category, metric in rows:
        axes[category] = {
            'axis': category, 'score': axis_score,
            'repCount': metric['repCount'], 'missingDrills': [],
        }
        entry = drills.setdefault(drill, {
            'drill': drill, 'repCount': 0, 'sessionCount': 1,
            'score': axis_score, 'metrics': [],
        })
        entry['metrics'].append(metric)
        entry['repCount'] += metric['repCount']
    return {
        'schemaVersion': 1,
        'benchmarkProfile': {'ageBand': 'u16', 'gender': 'male', 'isDefaulted': False},
        'totalReps': sum(d['repCount'] for d in drills.values()), 'totalSessions': 1,
        'overallScore': axis_score, 'axes': list(axes.values()), 'drills': list(drills.values()),
    }


def assembled(db, make_invocation, stats):
    db.set_doc(('players', 'best-only'), {'age': 15, 'position': 'CB'})
    inv = make_invocation(player_id='best-only', params={**params(), 'statsProfile': stats})
    inv.context['_now'] = NOW
    return inv, assemble_program_profile(inv)


@pytest.mark.parametrize('mid,drill,category,domain,best', PRIMARY)
def test_one_best_result_per_drill_reaches_focus_without_repeatability_gate(
    db, make_invocation, mid, drill, category, domain, best,
):
    stats = snapshot((drill, category, metric_row(mid, best=best)))
    inv, data = assembled(db, make_invocation, stats)
    assert not db.get_collection(('players', inv.player_id, 'reps'))
    assert data['measuredMetricIds'] == []
    assert data['peer']['status'] == 'unavailable'
    assert data['bestResults'] == {mid: {
        'drill': drill, 'category': category, 'score': 40,
        'bestCanonical': best, 'repCount': 1,
    }}
    focus = compute_focus_split(data, AVAILABLE)
    assert focus['afterGaps'][domain] > focus['base'][domain]
    assert any(row['domain'] == domain and mid in row['metricIds'] for row in focus['findings'])
    assert focus['tableRow']['position'] == 'CB'
    assert focus['tableRow']['ageBand'] == 'U15-U16'


@pytest.mark.parametrize('count', [1, 2, 3, 100])
def test_number_of_reps_does_not_change_best_result_modifier(count):
    def focused(n):
        stats = snapshot(('broadJump', 'power', metric_row('broadJumpDistance', count=n)))
        return compute_focus_split(profile(bestResults=_best_result_evidence(stats)), AVAILABLE)
    first, current = focused(1), focused(count)
    assert current['afterGaps'] == first['afterGaps']
    assert current['final'] == first['final']
    assert current['measuredPriorityDomains'] == first['measuredPriorityDomains']


def test_strong_best_results_ignore_weak_latest_axes_drill_scores_and_secondary_metrics(db, make_invocation):
    stats = snapshot(
        ('sprint', 'speed', metric_row('sprintCompletionTime', score=100, best=3.0,
                                     latestCanonical=30, scoreDelta=-75, confidence='low')),
        ('sprint', 'speed', metric_row('sprintMaxSpeed', score=5, best=1.0)),
        ('kick', 'striking', metric_row('ballSpeed', score=100, best=25,
                                      latestCanonical=1, trend='declining')),
        ('kick', 'striking', metric_row('launchAngle', score=1, best=2)),
        axis_score=5,
    )
    _, data = assembled(db, make_invocation, stats)
    assert set(data['bestResults']) == {'sprintCompletionTime', 'ballSpeed'}
    focus = compute_focus_split(data, AVAILABLE)
    assert focus['afterGaps'] == focus['base']
    assert not focus['measuredPriorityDomains']
    assert not focus['findings']


def test_low_axis_and_old_repeatability_metric_ids_cannot_replace_a_primary_result():
    data = profile(
        stats={'categories': {'power': 10, 'speed': 10}},
        measuredMetricIds=['broadJumpDistance', 'sprintMaxSpeed'],
    )
    focus = compute_focus_split(data, AVAILABLE)
    assert focus['afterGaps'] == focus['base']
    assert not focus['findings']
    assert not focus['measuredPriorityDomains']


@pytest.mark.parametrize('vertical_score,expect_modifier', [(34, True), (35, False), (100, False)])
def test_power_uses_the_mean_of_best_results_once_per_drill(vertical_score, expect_modifier):
    stats = snapshot(
        ('jump', 'power', metric_row('verticalJumpHeight', score=vertical_score, best=.3, count=100)),
        ('broadJump', 'power', metric_row('broadJumpDistance', score=95, count=1)),
    )
    focus = compute_focus_split(profile(bestResults=_best_result_evidence(stats)), AVAILABLE)
    assert (focus['afterGaps']['plyometrics'] > focus['base']['plyometrics']) is expect_modifier
    if expect_modifier:
        finding = next(row for row in focus['findings'] if row['domain'] == 'plyometrics')
        assert set(finding['metricIds']) == {'verticalJumpHeight', 'broadJumpDistance'}


@pytest.mark.parametrize('position', ['CB', 'GK', 'W'])
@pytest.mark.parametrize('band,level', [('U9-U10', 'foundation'), ('U15-U16', 'club'), ('senior', 'performance')])
def test_all_six_weak_results_stay_within_baseline_modifier_and_age_caps(position, band, level):
    stats = snapshot(*[(drill, category, metric_row(mid, best=best, score=1))
                       for mid, drill, category, _, best in PRIMARY])
    data = profile(position=position, age_band=band, level=level,
                   bestResults=_best_result_evidence(stats))
    focus = compute_focus_split(data, AVAILABLE)
    assert focus['tableRow']['position'] == position
    assert focus['tableRow']['ageBand'] == band
    assert sum(focus['afterGaps'].values()) == 100
    assert all(0 <= focus['afterGaps'][d] <= focus['capacityCapsPct'][d] for d in DOMAINS)
    assert max(abs(focus['afterGaps'][d] - focus['base'][d]) for d in DOMAINS) <= 5
    assert sum(abs(focus['afterGaps'][d] - focus['base'][d]) for d in DOMAINS) <= 20
    assert sum(focus['afterGaps'][d] for d in focus['measuredPriorityDomains']) <= focus_policy()['measuredPriorityCaps'][band][level]
    if position == 'CB':
        assert focus['afterGaps']['dribbling'] - focus['base']['dribbling'] <= 3


@pytest.mark.parametrize('bad', [None, True, False, 0, -1, '1.4', float('nan'), float('inf'), -float('inf')])
def test_invalid_primary_best_value_fails_closed(db, make_invocation, bad):
    stats = snapshot(('broadJump', 'power', metric_row('broadJumpDistance', best=bad)))
    with pytest.raises(GatewayError) as failure:
        assembled(db, make_invocation, stats)
    assert failure.value.code == 'invalid_request'


@pytest.mark.parametrize('bad', [None, True, False, 0, -1, '1', 1.0, float('nan'), float('inf')])
def test_invalid_primary_rep_count_fails_closed(db, make_invocation, bad):
    stats = snapshot(('broadJump', 'power', metric_row('broadJumpDistance')))
    stats['drills'][0]['metrics'][0]['repCount'] = bad
    with pytest.raises(GatewayError) as failure:
        assembled(db, make_invocation, stats)
    assert failure.value.code == 'invalid_request'


@pytest.mark.parametrize('duplicate_drill', [False, True])
def test_duplicate_primary_results_cannot_weight_a_category_twice(db, make_invocation, duplicate_drill):
    stats = snapshot(('broadJump', 'power', metric_row('broadJumpDistance')))
    if duplicate_drill:
        stats['drills'].append(deepcopy(stats['drills'][0]))
    else:
        stats['drills'][0]['metrics'].append(deepcopy(stats['drills'][0]['metrics'][0]))
    with pytest.raises(GatewayError) as failure:
        assembled(db, make_invocation, stats)
    assert failure.value.code == 'invalid_request'


def test_primary_metric_under_wrong_drill_fails_closed(db, make_invocation):
    stats = snapshot(('sprint', 'speed', metric_row('broadJumpDistance')))
    with pytest.raises(GatewayError) as failure:
        assembled(db, make_invocation, stats)
    assert failure.value.code == 'invalid_request'


@pytest.mark.parametrize('sessions,minutes', [(1, 60), (2, 30)])
def test_one_best_result_changes_persisted_workout_minutes_with_same_age_and_position(sessions, minutes):
    from evals.program_v3 import seed_invocation
    from gateway.program_generator import run_program
    from tests.test_program_generator_v3 import ConstructingProvider

    def generate(score):
        inv = seed_invocation('cb15')
        # Keep real catalog and intake, while isolating best-result influence.
        inv.db._docs = {path: row for path, row in inv.db._docs.items() if 'reps' not in path}
        inv.params['intake'].update(horizonWeeks=1, sessionsPerWeek=sessions, minutesPerSession=minutes)
        inv.params['statsProfile'] = snapshot(
            ('broadJump', 'power', metric_row('broadJumpDistance', score=score)),
        )
        with patch('gateway.providers.base.get_provider', lambda _: ConstructingProvider(inv)):
            plan, _ = run_program(inv)
        assert inv.db.get_doc(('players', inv.player_id, 'trainingPlans', plan['planId']))
        domain_minutes = defaultdict(float)
        for week in plan['weeks']:
            for workout in week['workouts']:
                assert workout['check']['adversarialPassed']
                for block in workout['blocks']:
                    domain_minutes[block['domain']] += block['estimatedMinutes']
        return plan, domain_minutes

    strong, strong_minutes = generate(100)
    weak, weak_minutes = generate(40)
    strong_focus = strong['assessment']['focusSplit']
    weak_focus = weak['assessment']['focusSplit']
    assert weak_focus['tableRow'] == strong_focus['tableRow']
    assert weak_focus['base'] == strong_focus['base']
    assert weak_focus['final']['plyometrics'] > strong_focus['final']['plyometrics']
    assert weak_minutes['plyometrics'] > strong_minutes['plyometrics']
    assert weak['weeklyBudgetMinutes'] == strong['weeklyBudgetMinutes'] == sessions * minutes
    assert weak['assessment']['inputs']['peer']['status'] == 'unavailable'
    assert weak['assessment']['inputs']['bestResults']['broadJumpDistance']['repCount'] == 1
