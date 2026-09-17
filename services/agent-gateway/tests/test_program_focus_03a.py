"""03A content-starvation regressions using the real eligible catalog snapshot."""
import json

import pytest

from evals.program_v3 import PROFILES,seed_invocation
from gateway.catalog_v2 import eligible_drill,load_catalog
from gateway.errors import GatewayError
from gateway.program_composition import catalog_capacity,dose_options
from gateway.program_focus import compute_focus_split
from gateway.program_profile import DOMAINS,assemble_program_profile
from tests.test_program_focus_v3 import profile


PHYSICAL={'speed','agility','plyometrics','strength'}
TECHNICAL={'dribbling','passing','receiving','shooting'}


def fixture_split(name):
    inv=seed_invocation(name)
    data=assemble_program_profile(inv)
    intake=data['intake']
    catalog={did:row for did,row in load_catalog(inv).items()
             if row['domain'] not in ('ballMastery','games')
             and eligible_drill(row,data,allow_partner=intake['setting'] in ('partner','halfAndHalf'))[0]}
    options={did:dose_options(row) for did,row in catalog.items()}
    catalog={did:row for did,row in catalog.items() if options[did]}
    caps=catalog_capacity(catalog,options,intake['sessionsPerWeek'],intake['minutesPerSession'])
    return compute_focus_split(data,{row['domain'] for row in catalog.values()},
                               PROFILES[name].get('coachParsedEmphasis',[]),caps)


@pytest.mark.parametrize('name', ['cb15','gk','xgk16','xfirsttouch14','xpartner15','x8nostats','one30','xmicro1x30'])
def test_availability_changes_are_reconstructable_and_do_not_escape_safety_caps(name):
    out=fixture_split(name)
    table=out['tableRow']['percentages']
    audit=out['redistribution']
    rebuilt=dict(table)
    for change in audit['changes']:
        domain=change['domain']
        assert change['from']==table[domain]
        assert change['to']-change['from']==change['deltaPct']
        rebuilt[domain]=change['to']
    assert rebuilt==out['base']
    assert sum(c['deltaPct'] for c in audit['changes'])==0
    assert sum(max(0,c['deltaPct']) for c in audit['changes'])==audit['redistributedPct']
    assert sum(c['overAuthoredGainLimitPct'] for c in audit['changes'])==audit['physicalOverflowPct']
    # The availability policy is applied before bounded evidence/coach stages.
    assert all(out['base'][d]<=table[d]+10 for d in TECHNICAL)
    for step in ('base','afterGaps','afterCoachNudge','final'):
        assert sum(out[step].values())==100
        assert all(type(v) is int and 0<=v<=min(40,out['capacityCapsPct'][d]) for d,v in out[step].items())
    # Firestore metadata cannot contain nested arrays. The provenance is a
    # JSON-safe object whose adjustment rows retain every old/new value.
    assert json.loads(json.dumps(audit))==audit
    assert all(isinstance(row,dict) for row in audit['changes']+audit['unmetPolicy'])


def test_solo_goalkeeper_keeps_shooting_and_dribbling_small_with_physical_residual():
    out=fixture_split('xgk16')
    assert out['base']['shooting']==15
    assert out['base']['dribbling']==15
    assert out['base']['passing']==13  # One real solo passing drill's capacity.
    assert out['base']['speed']==15
    assert out['base']['strength']==9
    table=out['tableRow']['percentages']
    physical_gains=[out['base'][d]-table[d] for d in PHYSICAL]
    assert max(physical_gains)-min(physical_gains)<=1
    assert out['redistribution']['status']=='bounded'
    assert not out['redistribution']['unmetPolicy']
    # Losing 37 authored points forces at least 74 L1 distance at sum=100.
    # The improvement is concentration, not an impossible smaller distance.
    assert sum(abs(out['base'][d]-table[d]) for d in DOMAINS)==74


def test_center_back_receiving_gap_does_not_become_forty_percent_shooting():
    out=fixture_split('cb15')
    assert out['base']['shooting']==25
    assert out['base']['dribbling']==15  # Existing role-specific cap survives.
    assert out['afterGaps']['dribbling']-out['base']['dribbling']<=3
    assert out['base']['receiving']==out['base']['ballMastery']==0


def test_under_eight_sparse_catalog_reports_the_mathematically_unmet_gain_policy():
    out=fixture_split('x8nostats')
    audit=out['redistribution']
    assert sum(audit['boundedCapsPct'].values())==90
    assert audit['status']=='limited'
    assert audit['physicalOverflowPct']==10
    assert audit['unmetPolicy'][0]['policy']=='max_authored_gain'
    assert audit['unmetPolicy'][0]['excessPct']==10
    assert out['base']['dribbling']==30
    assert out['base']['shooting']==20
    assert all(c['domain'] in PHYSICAL for c in audit['changes'] if c['overAuthoredGainLimitPct'])
    assert all(out['base'][d]==0 for d in ('ballMastery','passing','receiving','speed','games'))


def test_insufficient_physical_headroom_cannot_overflow_into_technical_domains():
    # Raw capacity reaches 120%, but authored+10 technical caps reach only 65%.
    # Without any eligible physical domain, this cannot become a valid program.
    with pytest.raises(GatewayError,match='authored technical focus bound') as failure:
        compute_focus_split(profile(position='neutral'),{'passing','dribbling','shooting'})
    assert failure.value.code=='context_unavailable'


def test_catalog_order_does_not_change_the_audited_redistribution():
    domains=sorted(set(DOMAINS)-{'ballMastery','games','receiving'})
    expected=compute_focus_split(profile(position='GK'),domains,capacity_pct={'passing':13})
    assert compute_focus_split(profile(position='GK'),list(reversed(domains)),capacity_pct={'passing':13})==expected
