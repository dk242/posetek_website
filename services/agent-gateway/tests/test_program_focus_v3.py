"""Independent invariants over every provisional row and adversarial coach mixes."""
from itertools import product
import copy

import pytest

from gateway.errors import GatewayError
from gateway.program_focus import focus_policy,compute_focus_split,largest_remainder
from gateway.program_profile import DOMAINS,POSITIONS

AVAILABLE=set(DOMAINS)-{'ballMastery','games','receiving'}


def profile(position='CB',age_band='U15-U16',level='club',**patch):
    return {'position':position,'ageBand':age_band,'level':level,'intake':{'goals':[]},'stats':{'categories':{}},'peer':{'status':'unavailable'},'measuredMetricIds':[],**patch}


def _bounds(out):
    for step in ('base','afterGaps','afterCoachNudge','final'):
        assert set(out[step])==set(DOMAINS)
        assert sum(out[step].values())==100
        assert all(type(v) is int and 0<=v<=40 for v in out[step].values())
        assert all(out[step][d]<=out['capacityCapsPct'][d] for d in DOMAINS)
    assert out['afterCoachNudge']==out['final']
    assert all(abs(out['afterGaps'][d]-out['base'][d])<=5 for d in DOMAINS)
    assert sum(abs(out['afterGaps'][d]-out['base'][d]) for d in DOMAINS)<=20
    assert all(abs(out['final'][d]-out['afterGaps'][d])<=10 for d in DOMAINS)
    assert sum(abs(out['final'][d]-out['afterGaps'][d]) for d in DOMAINS)<=30


def test_complete_189_row_table_is_explicit_provisional_data_and_sums_100():
    policy=focus_policy();rows=policy['rows']
    assert len(rows)==189
    assert len({(r['position'],r['ageBand'],r['level']) for r in rows})==189
    assert {r['position'] for r in rows}==set(POSITIONS)|{'neutral'}
    assert 'provisional' in policy['status']
    assert len(policy['provenance']['workbookSha256'])==64
    for row in rows:
        assert set(row['percentages'])==set(DOMAINS)
        assert sum(row['percentages'].values())==100
        assert all(type(v) is int and 0<=v<=40 for v in row['percentages'].values())
        out=compute_focus_split(profile(row['position'],row['ageBand'],row['level']),AVAILABLE)
        _bounds(out)
        assert out['final']['ballMastery']==0 and out['final']['receiving']==0


def test_center_back_dribbling_gap_is_supported_without_dominating_soccer_program():
    cb=profile(stats={'categories':{'ballControl':45}},bestResults={
        'dribbleTotalTime':{'category':'ballControl','score':45,'bestCanonical':15,'repCount':1,'drill':'dribbling'}})
    out=compute_focus_split(cb,AVAILABLE);neutral=compute_focus_split({**cb,'position':None},AVAILABLE)
    _bounds(out)
    assert out['afterGaps']['dribbling']-out['base']['dribbling']<=3
    assert out['afterGaps']['dribbling']<neutral['afterGaps']['dribbling']
    assert sum(out['final'][d] for d in ('passing','shooting','dribbling','receiving'))>=60
    assert any(f['basis']=='best_result_gap' for f in out['findings'])
    unsupported=compute_focus_split({**cb,'bestResults':{}},AVAILABLE)
    assert not unsupported['findings'] and unsupported['base']==unsupported['afterGaps']


def test_unvalidated_low_axis_audit_uses_named_firestore_records_without_changing_priorities():
    data=profile(position='CM', stats={'categories': {'power': 33.89, 'speed': 52}})
    out=compute_focus_split(data,AVAILABLE)
    assert out['unevidencedLowScores']==[
        {'category':'power','domain':'plyometrics','score':33.89},
        {'category':'speed','domain':'speed','score':52},
    ]
    assert out['afterGaps']==out['base']
    assert out['measuredPriorityDomains']==[]


def test_matched_peer_gap_is_distinct_from_emerging_or_missing_signal():
    for pct,basis in [(25,'peer_gap'),(26,None),(40,None)]:
        out=compute_focus_split(profile(peer={'status':'available','percentiles':{'speed':pct}},measuredMetricIds=['sprintMaxSpeed']),AVAILABLE)
        assert any(f['basis']==basis for f in out['findings']) if basis else not out['findings']


def test_coach_speed_request_is_meaningful_but_bounded():
    out=compute_focus_split(profile(),AVAILABLE,[{'domain':'speed','direction':'more','strength':1.0}])
    _bounds(out)
    assert out['final']['speed']==out['afterGaps']['speed']+10
    assert sum(out['final'][d] for d in ('passing','shooting','dribbling'))>=50
    assert out['nudges']


@pytest.mark.parametrize('directions',list(product(('more','less'),repeat=4)))
def test_adversarial_coach_tags_and_rounding_cannot_escape_final_l1_cap(directions):
    tags=[{'domain':domain,'direction':direction,'strength':1.0} for domain,direction in zip(('speed','agility','plyometrics','dribbling'),directions)]
    # Repeated tags remain bounded too: note text cannot enlarge either cap.
    out=compute_focus_split(profile(),AVAILABLE,tags*3)
    _bounds(out)


def test_availability_capacity_changes_are_explicit_and_infeasible_catalog_fails():
    cap={d:15 for d in AVAILABLE};cap['dribbling']=10
    out=compute_focus_split(profile(),AVAILABLE,capacity_pct=cap)
    _bounds(out)
    assert set(out['unavailableDomains'])>={'ballMastery','receiving'}
    with pytest.raises(GatewayError,match='capacity'):
        compute_focus_split(profile(),AVAILABLE,capacity_pct={d:14 for d in AVAILABLE})
    with pytest.raises(GatewayError,match='three eligible domains'):
        compute_focus_split(profile(),{'speed','plyometrics'})


def test_largest_remainder_is_exact_and_ties_have_stable_domain_order():
    assert largest_remainder({'speed':1,'passing':1,'dribbling':1},100)=={'speed':33,'passing':33,'dribbling':34}
    for total in (15,120,360,540):
        output=largest_remainder({'speed':13,'passing':31,'dribbling':29,'shooting':27},total)
        assert sum(output.values())==total and all(type(v) is int for v in output.values())
