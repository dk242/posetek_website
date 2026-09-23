from copy import deepcopy
from datetime import timedelta
from unittest.mock import patch
import pytest
from evals.program_v3 import seed_invocation
from tests.test_program_generator_v3 import ConstructingProvider
from gateway.personalized_plans import (generate_draft, activate_draft, discard_draft, engine_for,
    CAPABILITIES, ENGINE_VERSION, CURRENT_ENGINE_VERSION)
from gateway.personalized_assessment import prepare_personalized_profile, compute_personalized_focus
from gateway.program_profile import assemble_program_profile
from gateway.program_composition import catalog_capacity, dose_options
from gateway.catalog_v2 import load_catalog, eligible_drill
from gateway.errors import GatewayError
from gateway.pipeline import _authorize_and_configure
from gateway import config


def invocation():
    inv = seed_invocation('cb15')
    inv.params['intake'].update(horizonWeeks=2,sessionsPerWeek=2,minutesPerSession=60)
    inv.uid='admin'; inv.trusted_claims={'uid':'admin','email':'reviewer@posetek.net','email_verified':True}
    inv.capability=CAPABILITIES[0]
    inv.params['engineVersion']=ENGINE_VERSION
    return inv


def generated(inv):
    with patch('gateway.providers.base.get_provider',lambda _:ConstructingProvider(inv)):
        result,_ = generate_draft(inv)
    return inv.db.get_doc(('players',inv.player_id,'personalizedPlanDrafts',result['draftId']))


def activation(inv,draft):
    inv.capability=CAPABILITIES[1]
    inv.params={'draftId':draft['draftId'],'comparisonToken':draft['comparisonToken'],
        'expectedActivePlans':draft['expectedActivePlans'],'engineVersion':ENGINE_VERSION}


@pytest.fixture(scope='module')
def fixture():
    inv=invocation(); draft=generated(inv)
    return inv,draft


def test_draft_generation_never_activates_and_retries_reuse(fixture):
    inv,draft=deepcopy(fixture)
    assert not list(inv.player_ref().collection('trainingPlans').stream())
    assert not list(inv.player_ref().collection('trainingPlanContexts').stream())
    assert not list(inv.player_ref().collection('workoutSchedule').stream())
    assert draft['status']=='ready' and draft['plan']['status']=='draft'
    assert all(w['check']['allocation']['passed'] for w in draft['plan']['weeks'])
    again,_=generate_draft(inv)
    assert again['draftId']==draft['draftId']
    assert len(list(inv.player_ref().collection('personalizedPlanDrafts').stream()))==1


def test_activation_is_atomic_idempotent_and_editable(fixture):
    from gateway.workout_persistence import load_generation_context,load_original_workout
    inv,draft=deepcopy(fixture); activation(inv,draft)
    before_logs=list(inv.player_ref().collection('workoutLogs').stream())
    first=activate_draft(inv); second=activate_draft(inv)
    assert first['planId']==second['planId'] and second['replayed']
    plan=inv.db.get_doc(('players',inv.player_id,'trainingPlans',first['planId']))
    assert plan['status']=='active' and plan['engineVersion']==ENGINE_VERSION
    assert load_generation_context(inv,plan)['engineVersion']==ENGINE_VERSION
    assert load_original_workout(inv,plan,'w1s1')['blocks']
    assert inv.db.get_doc(('players',inv.player_id,'workoutSchedule','current'))['revision']==1
    assert len(list(inv.player_ref().collection('workoutLogs').stream()))==len(before_logs)


@pytest.mark.parametrize('changed',['profile','feedback','new_test','active_plan','log','reservation','counter','catalog','expired','day','token','selection'])
def test_changed_review_never_overwrites(fixture,changed):
    inv,draft=deepcopy(fixture); activation(inv,draft)
    player_path=('players',inv.player_id)
    if changed=='profile':
        p=inv.db.get_doc(player_path);p['maxDrillDifficulty']=1;inv.db.set_doc(player_path,p)
    elif changed=='feedback': inv.db.set_doc((*player_path,'privateProfile','coachFeedback'),{'text':'New emphasis'})
    elif changed=='new_test': inv.db.set_doc((*player_path,'reps','new'),{'ballSpeed':30})
    elif changed=='active_plan': inv.db.set_doc((*player_path,'trainingPlans','new'),{'status':'active','planRevision':2})
    elif changed=='log': inv.db.set_doc((*player_path,'workoutLogs','new'),{'status':'in_progress'})
    elif changed=='reservation': inv.db.set_doc((*player_path,'plannedWorkouts','new'),{'status':'planned'})
    elif changed=='counter': inv.db.set_doc((*player_path,'workoutSchedule','current'),{'revision':9})
    elif changed=='catalog':
        did=draft['plan']['weeks'][0]['workouts'][0]['blocks'][0]['drillId'];row=inv.db.get_doc(('drillCatalog',did));row['status']='archived';inv.db.set_doc(('drillCatalog',did),row)
    elif changed=='expired': inv.context['_now']+=timedelta(days=8)
    elif changed=='day': inv.context['_now']+=timedelta(days=1)
    elif changed=='token': inv.params['comparisonToken']='wrong'
    elif changed=='selection': inv.params['expectedActivePlans']=[{'planId':'other','planRevision':1}]
    with pytest.raises(GatewayError): activate_draft(inv)
    assert inv.db.get_doc((*player_path,'personalizedPlanDrafts',draft['draftId']))['status']=='ready'
    assert inv.db.get_doc((*player_path,'trainingPlans',draft['plan']['planId'])) is None


def test_concurrent_activity_forces_transaction_retry_then_rejects(fixture):
    inv,draft=deepcopy(fixture); activation(inv,draft)
    inv.db.before_commit=lambda db:db.set_doc(('players',inv.player_id,'workoutLogs','new'),{'status':'in_progress'})
    with pytest.raises(GatewayError,match='changed'): activate_draft(inv)
    assert not list(inv.player_ref().collection('trainingPlans').stream())


def test_peer_evidence_changes_invalidate_a_reviewed_priority(fixture):
    inv,draft=deepcopy(fixture); activation(inv,draft)
    path=('players','eval_peer_0','reps','dribble_1_1')
    row=inv.db.get_doc(path)
    assert row
    row['totalTime']=1
    inv.db.set_doc(path,row)
    with pytest.raises(GatewayError,match='changed'):activate_draft(inv)
    assert not list(inv.player_ref().collection('trainingPlans').stream())


def test_preflight_is_the_same_policy_and_creates_no_draft_or_plan():
    from gateway.personalized_plans import assess_priorities
    inv=invocation()
    result,_=assess_priorities(inv)
    assert sum(result['focusSplit'].values())==100
    assert result['engineVersion']==ENGINE_VERSION
    assert not list(inv.player_ref().collection('trainingPlans').stream())
    assert not list(inv.player_ref().collection('personalizedPlanDrafts').stream())


@pytest.mark.parametrize('sessions,minutes,weeks',[(1,15,1),(2,30,3),(6,15,2),(2,90,2)])
def test_schedule_boundaries_preserve_allocation_time_and_frequency(sessions,minutes,weeks):
    from gateway.program_generator import run_program
    inv=invocation();inv.params['intake'].update(sessionsPerWeek=sessions,minutesPerSession=minutes,horizonWeeks=weeks)
    with patch('gateway.providers.base.get_provider',lambda _:ConstructingProvider(inv)):
        plan,_=run_program(inv,persist=False,personalized=True)
    for week in plan['weeks']:
        assert week['check']['allocation']['passed']
        assert abs(week['check']['estimatedMinutes']-sessions*minutes)<=max(5,sessions*minutes*.1)
        for workout in week['workouts']:
            assert workout['check']['adversarialPassed']
            assert abs(workout['estimatedMinutes']-minutes)<=max(5,minutes*.1)
    assert not list(inv.player_ref().collection('trainingPlans').stream())


def test_discard_does_not_mutate_active_or_history(fixture):
    inv,draft=deepcopy(fixture);activation(inv,draft)
    assert discard_draft(inv)['status']=='discarded'
    assert discard_draft(inv)['status']=='discarded'
    with pytest.raises(GatewayError):activate_draft(inv)
    assert not list(inv.player_ref().collection('trainingPlans').stream())


@pytest.mark.parametrize('claims',[{'uid':'admin'}, {'uid':'admin','email':'a@posetek.net','email_verified':False},
    {'uid':'admin','email':'a@posetek.net.evil','email_verified':True}, {'uid':'other','email':'a@posetek.net','email_verified':True}])
def test_preview_auth_never_uses_client_email(fixture,claims):
    inv,draft=deepcopy(fixture);inv.trusted_claims=claims;inv.email='a@posetek.net';activation(inv,draft)
    with pytest.raises(GatewayError):activate_draft(inv)


def test_current_routing_is_default_and_unknown_versions_fail():
    assert engine_for('generate_training_plan')==CURRENT_ENGINE_VERSION
    assert engine_for(CAPABILITIES[0])==ENGINE_VERSION
    with pytest.raises(GatewayError):engine_for('generate_training_plan',ENGINE_VERSION)
    with pytest.raises(GatewayError):engine_for(CAPABILITIES[0],'future-v2')


def test_explicit_release_gates():
    inv=invocation();config._cache.update(doc=None,loaded_at=0)
    with pytest.raises(GatewayError) as exc:_authorize_and_configure(inv)
    assert exc.value.code=='capability_disabled'
    cfg={'globalEnabled':True,'programV3Enabled':True,'personalizedPlannerEnabled':True,
         'capabilities':{c:{'enabled':True,'dailyLimitPerUser':3} for c in CAPABILITIES}}
    inv.db.set_doc(('config','llm'),cfg);config._cache.update(doc=None,loaded_at=0)
    _authorize_and_configure(inv)
    cfg['personalizedPlannerEnabled']=False;inv.db.set_doc(('config','llm'),cfg);config._cache.update(doc=None,loaded_at=0)
    with pytest.raises(GatewayError):_authorize_and_configure(inv)
    config._cache.update(doc=None,loaded_at=0)


def test_recent_snapshot_moderate_priority_and_missing_window():
    from tests.test_evidence_objectives_v1 import seed_primary, supplied
    inv=invocation()
    inv.db._docs={path:row for path,row in inv.db._docs.items() if 'reps' not in path}
    supplied(inv,seed_primary(inv,'sprintCompletionTime',70),seed_primary(inv,'ballSpeed',100))
    # Native callers have no evidenceWindow. The current qualified recordings
    # establish dates; supplying a fresh client window cannot revive old data.
    inv.params.pop('evidenceWindow',None)
    profile=assemble_program_profile(inv)
    recent=prepare_personalized_profile(inv,profile)
    assert recent['bestResults']
    catalog=load_catalog(inv);eligible={did:r for did,r in catalog.items() if eligible_drill(r,recent)[0]}
    options={did:dose_options(r) for did,r in eligible.items()}
    cap=catalog_capacity(eligible,options,2,60)
    split=compute_personalized_focus(recent,{r['domain'] for r in eligible.values()},[],cap,catalog=eligible)
    finding=next(f for f in split['findings'] if f['basis']=='within_player_priority')
    assert finding['domain']=='speed' and finding['confidence']=='low'
    assert split['afterGaps']['speed']>split['base']['speed']
    assert sum(split['final'].values())==100
    for doc in inv.player_ref().collection('reps').stream():
        inv.player_ref().collection('reps').document(doc.id).update({'createdAt':inv.context['_now']-timedelta(days=181)})
    inv.params['evidenceWindow']={'oldestAt':inv.context['_now'],'newestAt':inv.context['_now']}
    assert not prepare_personalized_profile(inv,profile)['bestResults']
