"""Synthetic, independent safety and relevance checks for the new methodology."""
from copy import deepcopy
from datetime import timedelta
from unittest.mock import patch

import pytest

from evals.program_v3 import seed_invocation
from gateway.catalog_v2 import load_catalog, eligible_drill
from gateway.personalized_assessment import prepare_personalized_profile, compute_personalized_focus
from gateway.personalized_evidence import bundled_anchors, read_estimates, read_authoritative_results
from gateway.personalized_objectives import (methodology, objective_rows, rank_drills, block_rationale,
                                              format_metric, reviewed_drills, valid_rationale)
from gateway.program_profile import assemble_program_profile, EQUIPMENT
from gateway.program_composition import dose_options, catalog_capacity
from tests.test_best_result_modifiers import metric_row, snapshot
from tests.test_planner_native_handoff import native_invocation, with_conditional_agility


def seed_primary(inv, mid, score, *, at=None):
    """Raw native recording + processing artifacts, not a mocked qualification."""
    definitions = {'ballSpeed': ('deadballShot', 'kick', 'striking', 'velocity'),
                   'sprintCompletionTime': ('sprint', 'sprint', 'speed', 'totalTime'),
                   'verticalJumpHeight': ('jump', 'jump', 'power', 'jumpHeight'),
                   'broadJumpDistance': ('broadJump', 'broadJump', 'power', 'broadJumpDistance')}
    raw_type, drill, category, field = definitions[mid]
    reference = bundled_anchors()['cells']['senior|unspecified'][mid]
    best = reference * score/100 if not mid.endswith('Time') else reference*100/score
    ident = 'synthetic_' + mid; folder = f'{inv.player_id}/{raw_type}/session1/kick1'
    raw = {'repType': raw_type, 'createdAt': at or inv.context['_now'], 'storagePath': folder+'/video.mov',
           'sessionNumber': 1, 'repNumber': 1, field: best, 'resultsValid': True, 'processingStatus': 'complete', 'failedSteps': []}
    if raw_type == 'sprint':
        raw['max_velocity'] = 5
    inv.player_ref().collection('reps').document(ident).set(raw)
    inv.storage.put(folder+'/metadata.json', deepcopy(raw))
    inv.storage.put(folder+'/reprocess_context.json', {'rep': {'repId': ident, 'playerDocId': inv.player_id},
        'result': {'resultsValid': True, 'primaryMetric': 5 if raw_type == 'sprint' else best}})
    return drill, category, metric_row(mid, score=score, best=round(best, 4), referenceCanonical=round(reference, 4))


def supplied(inv, *rows):
    inv.params['statsProfile'] = snapshot(*rows)
    inv.params['statsProfile']['benchmarkProfile'] = {'ageBand': 'senior', 'gender': 'unspecified', 'isDefaulted': True}


def profile_and_catalog(*scores, position='FB'):
    inv = seed_invocation('cb15'); inv.params['intake'].update(horizonWeeks=1, sessionsPerWeek=2, minutesPerSession=60, equipment=list(EQUIPMENT))
    inv.player_ref().update({'position': position})
    inv.db._docs = {p: v for p, v in inv.db._docs.items() if 'reps' not in p}
    supplied(inv, *(seed_primary(inv, mid, score) for mid, score in scores))
    profile = prepare_personalized_profile(inv, assemble_program_profile(inv)); catalog = load_catalog(inv)
    eligible = {did: row for did, row in catalog.items() if eligible_drill(row, profile)[0] and row['domain'] not in ('ballMastery', 'games')}
    options = {did: dose_options(row) for did, row in eligible.items()}
    capacity = catalog_capacity(eligible, options, 2, 60)
    return inv, profile, eligible, options, capacity


def focus(profile, catalog, capacity):
    return compute_personalized_focus(profile, {r['domain'] for r in catalog.values()}, [], capacity, catalog=catalog)


def test_two_measured_priorities_allow_partial_nudge_inside_age_cap():
    _, profile, catalog, _, capacity = profile_and_catalog(('ballSpeed', 45), ('sprintCompletionTime', 60), ('broadJumpDistance', 95))
    split = focus(profile, catalog, capacity)
    assert split['measuredPriorityDomains'] == ['shooting', 'speed']
    assert sum(split['afterGaps'][d] for d in split['measuredPriorityDomains']) <= split['measuredPriorityMaxPct']
    assert all(split['afterGaps'][d] >= split['base'][d] for d in ('shooting', 'speed'))
    assert max(abs(split['afterGaps'][d]-split['base'][d]) for d in split['base']) <= 5
    assert sum(abs(split['afterGaps'][d]-split['base'][d]) for d in split['base']) <= 20


@pytest.mark.parametrize('weak,expected,excluded', [('verticalJumpHeight', 'VJP-', 'HJP-'), ('broadJumpDistance', 'HJP-', 'VJP-')])
def test_opposing_power_metrics_select_different_reviewed_exercises(weak, expected, excluded):
    other = 'broadJumpDistance' if weak == 'verticalJumpHeight' else 'verticalJumpHeight'
    _, profile, catalog, _, cap = profile_and_catalog((weak, 35), (other, 90), ('ballSpeed', 100))
    split = focus(profile, catalog, cap)
    primary = next(p for p in split['priorities'] if p['role'] == 'primary')
    assert primary['metricIds'] == [weak]
    assert all(d.startswith(expected) for d in primary['eligibleDrillIds'])
    ranking = rank_drills(catalog, profile)
    assert next(d for d in ranking if catalog[d]['domain'] == 'plyometrics').startswith(expected)
    stronger = next(p for p in split['priorities'] if p['metricIds'] == [other])
    assert stronger['role'] == 'maintain' and not stronger['supportedPrimary']


def test_sprint_time_never_maps_to_max_velocity_or_client_secondary_score():
    _, profile, catalog, _, cap = profile_and_catalog(('sprintCompletionTime', 45))
    profile['stats']['categories']['speed'] = 1
    split = focus(profile, catalog, cap)
    row = next(p for p in split['priorities'] if p['objectiveId'] == 'short_sprint')
    assert row['role'] == 'primary'
    assert set(row['eligibleDrillIds']) <= {'SPD-002', 'SPD-003', 'SPD-004'}
    assert 'SPD-006' not in row['eligibleDrillIds']
    assert 'does not diagnose' in row['reason']


def test_changed_teaching_content_or_archived_drill_cannot_keep_reviewed_link():
    _, profile, catalog, _, cap = profile_and_catalog(('ballSpeed', 40))
    original = deepcopy(catalog['SHT-003'])
    for change in ('archived', 'content'):
        catalog['SHT-003'] = deepcopy(original)
        if change == 'archived':
            catalog['SHT-003']['status'] = 'archived'
        else:
            catalog['SHT-003']['howTo']['steps'] = ['A different exercise now uses this ID.']
        row = next(p for p in objective_rows(profile, catalog) if p['objectiveId'] == 'shooting_speed')
        assert not row['eligibleDrillIds']
        split = focus(profile, catalog, cap)
        assert 'shooting' not in split['measuredPriorityDomains']


def test_combined_goal_keeps_conditional_agility_separate_from_sprint():
    inv = native_invocation(); with_conditional_agility(inv)
    inv.params['intake']['goals'] = ['speedAgility']
    profile = prepare_personalized_profile(inv, assemble_program_profile(inv)); cat = load_catalog(inv)
    eligible = {d: r for d, r in cat.items() if eligible_drill(r, profile)[0] and r['domain'] not in ('ballMastery', 'games')}
    cap = catalog_capacity(eligible, {d: dose_options(r) for d, r in eligible.items()}, 2, 60)
    rows = focus(profile, eligible, cap)['priorities']
    agility = next(r for r in rows if r['domain'] == 'agility')
    speed = next(r for r in rows if r['domain'] == 'speed')
    assert agility['evidenceBasis'] == 'conditionalEstimate' and agility['role'] == 'support'
    assert speed['evidenceBasis'] == 'goal'
    assert not agility['metricIds'] and 'Conditional' in agility['reason']
    assert 'No measured deficit' in speed['limitation']


def test_goal_for_strong_measured_area_is_support_not_a_measured_deficit():
    _, profile, cat, _, cap = profile_and_catalog(('ballSpeed', 105))
    profile['intake']['goals'] = ['shooting']
    split = focus(profile, cat, cap)
    row = next(p for p in split['priorities'] if p['objectiveId'] == 'shooting_speed')
    assert row['role'] == 'support' and row['evidenceBasis'] == 'measured'
    assert not row['supportedPrimary'] and 'shooting' not in split['measuredPriorityDomains']
    assert 'also selected as a training goal' in row['reason'] and 'does not imply a measured weakness' in row['reason']
    assert any(f['domain'] == 'shooting' and f['basis'] == 'stated_goal' for f in split['findings'])


@pytest.mark.parametrize('field,bad', [('method','wrong'), ('axis','ballControl'), ('protocolConfirmed',False),
    ('startBoundary','native'), ('observedCourseFraction',.59), ('observedCourseFraction',1),
    ('lowerSeconds',8), ('upperSeconds',6), ('confidence','high'), ('status','withdrawn'), ('reviewedByUid','')])
def test_malformed_or_unapproved_estimate_is_ignored(field, bad):
    inv = native_invocation(); _, entry = with_conditional_agility(inv)
    ref = inv.player_ref().collection('insightMetadata').document('provisionalEstimates')
    value = ref.get().to_dict(); value['entries'][0][field] = bad; ref.set(value)
    assert read_estimates(inv)[0] == []


@pytest.mark.parametrize('part', ['playerId','repId','drill','recordedAtMillis','storagePath','generation','md5Hash','sha256'])
def test_estimate_source_binding_is_required(part):
    inv = native_invocation(); with_conditional_agility(inv)
    ref = inv.player_ref().collection('insightMetadata').document('provisionalEstimates')
    value = ref.get().to_dict(); value['entries'][0]['source'][part] = 'wrong'; ref.set(value)
    assert read_estimates(inv)[0] == []


def test_client_stuffed_estimates_do_not_substitute_for_server_owned_document():
    inv = native_invocation(); inv.params['provisionalEstimates'] = [{'estimatedTotalSeconds': 3, 'drill': 'changeOfDirection'}]
    assert read_estimates(inv)[0] == []


def two_conditional_estimates():
    inv = native_invocation()
    inv.db._docs = {p:v for p,v in inv.db._docs.items() if 'reps' not in p}
    cod_id, cod = with_conditional_agility(inv)
    dribble = deepcopy(cod)
    dribble.update(id='reviewed_dribble_estimate', repId='incomplete_dribble', drill='dribbling', axis='ballControl',
                   method='constant_return_pace_v1', observedCourseFraction=.8)
    folder = f'{inv.player_id}/dribbling/session1/kick1'
    dribble['source'].update(repId=dribble['repId'], drill='dribbling', storagePath=folder+'/dribbling.mov')
    rep = inv.player_ref().collection('reps').document(cod_id).get().to_dict()
    rep.update(repType='dribbling', drillType='dribbling', storagePath=dribble['source']['storagePath'])
    inv.player_ref().collection('reps').document(dribble['repId']).set(rep)
    inv.storage.put(folder+'/metadata.json',deepcopy(rep))
    inv.storage.put(folder+'/reprocess_context.json',{'rep':{'repId':dribble['repId'],'playerDocId':inv.player_id},
                                                    'result':{'resultsValid':False,'primaryMetric':None}})
    inv.storage.put(dribble['source']['storagePath']+'.object-metadata',{'generation':'123','md5Hash':dribble['source']['md5Hash'],'size':1})
    ref = inv.player_ref().collection('insightMetadata').document('provisionalEstimates')
    ref.update({'entries':[cod,dribble]})
    return inv, [cod,dribble]


@pytest.mark.parametrize('completed', ['dribbling','changeOfDirection'])
def test_valid_measured_result_supersedes_only_its_own_conditional_axis(completed):
    inv, entries = two_conditional_estimates()
    assert len(read_estimates(inv)[0]) == 2
    entry = next(e for e in entries if e['drill'] == completed)
    source = inv.player_ref().collection('reps').document(entry['repId'])
    source.update({'resultsValid':True,'processingStatus':'complete','failedSteps':[],'totalTime':7.0})
    folder = entry['source']['storagePath'].rsplit('/',1)[0]
    inv.storage.put(folder+'/metadata.json',source.get().to_dict())
    inv.storage.put(folder+'/reprocess_context.json',{'rep':{'repId':entry['repId'],'playerDocId':inv.player_id},
                                                    'result':{'resultsValid':True,'primaryMetric':7.0}})
    remaining = read_estimates(inv)[0]
    assert len(remaining) == 1 and remaining[0]['drill'] != completed


def test_duplicate_correction_excludes_conditional_source():
    inv, entries = two_conditional_estimates()
    source, target = entries
    inv.player_ref().collection('reps').document(source['repId']).update({'duplicateOf':target['repId']})
    inv.player_ref().collection('insightMetadata').document('resultCorrections').set({
        'schemaVersion':1,'repairId':'synthetic_review','reviewedAtMillis':source['reviewedAtMillis'],
        'duplicateReps':{source['repId']:target['repId']}})
    remaining = read_estimates(inv)[0]
    assert len(remaining) == 1 and remaining[0]['repId'] == target['repId']


@pytest.mark.parametrize('cell',[[],{'ballSpeed':{'percentiles':[]}}])
def test_malformed_live_benchmark_cell_omits_priority_without_guessing(cell):
    inv, _, _, _, _ = profile_and_catalog(('ballSpeed',40))
    inv.db.collection('benchmarks').document('d1').set({'schemaVersion':1,'generation':3,'cells':{'senior|unspecified':cell}})
    assert not prepare_personalized_profile(inv,assemble_program_profile(inv))['bestResults']


def test_freshness_comes_from_current_recording_not_client_window():
    inv, _, _, _, _ = profile_and_catalog(('ballSpeed', 40))
    ref = inv.player_ref().collection('reps').document('synthetic_ballSpeed')
    ref.update({'createdAt': inv.context['_now']-timedelta(days=181)})
    inv.params['evidenceWindow'] = {'oldestAt': inv.context['_now'], 'newestAt': inv.context['_now']}
    profile = prepare_personalized_profile(inv, assemble_program_profile(inv))
    assert not profile['bestResults']


def test_score_must_agree_with_known_anchor_and_current_qualified_best():
    inv, _, _, _, _ = profile_and_catalog(('ballSpeed', 40))
    metric = inv.params['statsProfile']['drills'][0]['metrics'][0]
    metric['score'] = 10
    assert not prepare_personalized_profile(inv, assemble_program_profile(inv))['bestResults']


def test_unmapped_exercise_gets_honest_general_support_rationale():
    _, profile, cat, _, cap = profile_and_catalog(('sprintCompletionTime', 40))
    split = focus(profile, cat, cap)
    rationale, why = block_rationale(cat['SPD-006'], split['priorities'], cat)
    assert rationale['evidenceBasis'] == 'baseline' and 'no reviewed metric-specific link' in rationale['reason']
    plan = {'assessment': {'methodologyVersion': 'evidence-objectives-v1', 'priorities': split['priorities']}}
    block = {'drillId':'SPD-006', 'whyIncluded': why}
    assert valid_rationale(rationale, block, plan, cat)
    rationale['evidenceBasis'] = 'measured'
    assert not valid_rationale(rationale, block, plan, cat)


@pytest.mark.parametrize('mid,value,expected', [('ballSpeed', 16.35, '36.6 mph'), ('verticalJumpHeight', .3, '11.8 in'),
    ('broadJumpDistance', 1.5, '4.9 ft'), ('sprintCompletionTime', 3.054, '3.05 s')])
def test_coach_metric_labels_have_the_expected_units(mid, value, expected):
    assert format_metric(mid, value) == expected
