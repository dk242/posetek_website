"""Real canary overclaims and grounded alternatives, without athlete identifiers."""
from copy import deepcopy
from types import SimpleNamespace

import pytest

from gateway.kick_grounding import validate_grounded_text, validate_grounded_item
from gateway.kick_comparison import validate_comparison
from gateway.validators import validate_kick_observations_v1, validate_kick_focus_v1

SPEED = {'id':'event.kickFootSpeedJustBeforeContact.athleteHeightsPerS',
         'metric':'kickFootSpeedJustBeforeContact','units':'athlete heights/second',
         'eligible':True,'valid':True,'athlete':16.27,'frameKey':'contact','side':'kicking','delta':None}
ANGLE = {'id':'backswing.knee_angle.support','metric':'knee_angle','units':'degrees',
         'eligible':True,'valid':True,'athlete':111.1,'frameKey':'backswing','side':'support','delta':None}

@pytest.mark.parametrize('text',[
    'The right-footed kick is significantly more powerful than the left, primarily due to a more extensive backswing.',
    'The right kick generates substantially more power, evidenced by faster foot speed.',
    'The right foot demonstrates a more effective technique for power generation.',
    'The support leg is less stable during this kick.',
    'The support leg shows a much greater collapse through the follow-through.',
    'An unstable base leaks energy and reduces consistency.',
    'The larger backswing leads to higher foot speed and greater power and distance.',
    'Reach back with your heel for more power.',
    'The foot moves faster, so the ball speed is higher.',
    'The right kick may be more powerful.',
    'Not just faster, the right kick is more powerful.',
    'Power was not measured, but the right kick is significantly more powerful.',
    'Hip rotation may differ and therefore definitely causes greater power.',
    'There is no doubt the right foot is more powerful.',
])
def test_rejects_proxy_outcome_causal_and_dynamic_diagnoses(text):
    assert validate_grounded_text(text,'observation',[SPEED,ANGLE])

@pytest.mark.parametrize('text',[
    'Normalized foot speed does not establish greater power.',
    'A snapshot cannot determine dynamic stability.',
    'We cannot conclude that the kick is "more powerful" from normalized foot speed.',
    'The phrase "more powerful" is unsupported by these measurements.',
    'The snapshot does not establish that the support leg is unstable.',
    'The tracked foot speed is higher in this clip; ball speed was not measured.',
    'The knee is more flexed at backswing, with an angle of 111.1 degrees.',
    'The trunk leans 5 degrees more at contact.',
    'The thigh reaches peak angular velocity earlier in this clip.',
    'The two clips do not establish a cause for the difference.',
])
def test_accepts_measured_facts_and_explicit_unknowns(text):
    assert validate_grounded_text(text,'observation',[SPEED,ANGLE]) == []

@pytest.mark.parametrize('text',[
    'A comfortable backswing may help you explore a different movement range.',
    'This adjustment could help improve consistency; compare another matched pair.',
    'A larger backswing may contribute to more power, but power was not measured here.',
])
def test_conditional_coaching_rationale_is_not_a_promised_result(text):
    assert validate_grounded_text(text,'whyItMatters',[SPEED],suggestion=True)==[]


def test_hedge_on_earlier_clause_does_not_exempt_definite_cause():
    assert validate_grounded_text('Hip rotation may differ and therefore definitely causes greater power.','whyItMatters',[SPEED],suggestion=True)


def test_direct_ball_speed_evidence_requires_eligibility_correct_metric_and_units():
    text='The measured ball speed is higher in this clip.'
    ball={'metric':'ball_speed','units':'m/s','athlete':24.1,'eligible':True}
    assert validate_grounded_text(text,'observation',[ball])==[]
    for change in [{'eligible':False},{'units':'athlete heights/second'},{'metric':'kickFootSpeedJustBeforeContact'},{'athlete':None}]:
        assert validate_grounded_text(text,'observation',[{**ball,**change}])
    assert validate_grounded_text(text,'observation',[SPEED])


def test_direct_outcome_evidence_does_not_establish_causal_mechanism():
    ball={'metric':'ball_speed','units':'m/s','athlete':24.1,'eligible':True}
    assert validate_grounded_text('The backswing causes greater ball speed.','observation',[ball])


def test_only_cited_eligible_rows_can_ground_comparison_focus_outcomes():
    rows=[{**SPEED,'left':12.88,'right':16.27,'comparable':True},
          {'id':'ball.speed','metric':'ball_speed','units':'m/s','left':20.,'right':24.,'comparable':True}]
    inv=SimpleNamespace(context={'kickComparisonContext':{'differences':rows}})
    output={'schemaVersion':1,'summary':'The measured ball speed differs between these clips.',
            'focusAreas':[{'rank':1,'title':'Foot motion','observation':'The measured ball speed is higher.',
                'cue':'Try a comfortable backswing and compare another pair.',
                'whyItMatters':'Another pair may help clarify the movement difference.',
                'evidenceIds':[SPEED['id']]}]}
    assert any('unsupported ball_speed' in v for v in validate_comparison(output,inv))
    output['focusAreas'][0]['evidenceIds']=['ball.speed']
    assert validate_comparison(output,inv)==[]


def test_comparison_summary_is_checked_even_with_no_focuses():
    inv=SimpleNamespace(context={'kickComparisonContext':{'differences':[{**SPEED,'left':12.,'right':16.,'comparable':True}]}})
    output={'schemaVersion':1,'summary':'The right kick generates more power.','focusAreas':[]}
    assert any(v.startswith('summary:') for v in validate_comparison(output,inv))


def test_single_observation_reasoning_and_focus_are_guarded():
    inv=SimpleNamespace(context={'kickAnalysisContext':{'evidence':{'rows':[ANGLE]}}},stage_outputs={})
    observation={'id':'o1','frameKey':'backswing','bodyRegion':'supportLeg','title':'Plant knee angle',
        'severity':2,'deviationDirection':'notComparable','metricIds':[ANGLE['id']],
        'observation':'The plant knee is more flexed at backswing.',
        'reasoning':'This causes an unstable base and greater power loss.'}
    assert any('reasoning:' in v for v in validate_kick_observations_v1({'observations':[observation]},inv))
    observation['reasoning']='A phase snapshot cannot establish instability.'
    assert validate_kick_observations_v1({'observations':[observation]},inv)==[]
    inv.stage_outputs={'observe':{'observations':[observation]}}
    focus={'observationId':'o1','rank':1,'frameKey':'backswing','title':'Plant knee angle',
           'cue':'Try a comfortable plant position and review another clip.',
           'whyItMatters':'This generates greater power.','metricIds':[ANGLE['id']]}
    assert any('whyItMatters:' in v for v in validate_kick_focus_v1({'focusAreas':[focus]},inv))
    focus['whyItMatters']='Another clip may help you compare the plant knee position.'
    assert validate_kick_focus_v1({'focusAreas':[focus]},inv)==[]

@pytest.mark.parametrize('text',[
    'There is no evidence of knee collapse and the right kick is more powerful.',
    'The ball speed is unknown, and the right kick generates greater power.',
    'The backswing may differ, therefore it definitely generates more power.',
    'Try a comfortable plant position, which could help balance, and the right kick therefore generates more power.',
    'The right kick exerts more force.',
    'The right kick has greater energy.',
    'The knee is not unstable, and it collapses through contact.',
    'The right kick may be more powerful.',
    'The support leg stays stable throughout contact.',
    'The technique is effective and stable.',
    'The right kick is stronger and more explosive.',
    'The plant leg appears stable in the contact snapshot.',
    'The leg has excellent stability.',
])
def test_disclaimer_hedge_and_dynamic_scope_regressions(text):
    assert validate_grounded_text(text,'whyItMatters',[SPEED,ANGLE],suggestion=True)

@pytest.mark.parametrize('text',[
    'The tracked foot moved faster in this clip; ball speed and power were not measured.',
    'The measured foot speed increased from backswing to contact.',
    'The thigh rotation is reduced at contact compared with backswing.',
    'Ball speed and accuracy cannot be determined here.',
    'The ball speed difference was not measured.',
    'Foot speed is unavailable because of missing capture FPS.',
])
def test_legitimate_kinematics_and_missingness_scope(text):
    assert validate_grounded_text(text,'observation',[SPEED,ANGLE])==[]


def test_actual_comparison_retry_rejects_overclaim_and_accepts_grounded_output(monkeypatch,make_invocation):
    from gateway import pipeline
    from gateway.registry import get_capability
    from tests.test_pipeline_stages import FakeProvider,structured_result
    spec=get_capability('kick_foot_comparison')
    context={'kickComparisonContext':{'differences':[{**SPEED,'left':12.88,'right':16.27,'comparable':True}]}}
    inv=make_invocation(capability='kick_foot_comparison',context=context)
    bad={'schemaVersion':1,'summary':'The right kick generates substantially more power.','focusAreas':[]}
    good={'schemaVersion':1,'summary':'The tracked foot moved faster in this clip; ball speed and power were not measured.','focusAreas':[]}
    fake=FakeProvider([structured_result(bad),structured_result(good)])
    monkeypatch.setattr('gateway.providers.base.get_provider',lambda name:fake)
    result,_=pipeline._run_stage(spec,spec.stage_list()[0],inv,context)
    assert result==good and len(fake.calls)==2
    assert 'unsupported power' in fake.calls[1]['messages'][-1]
    assert bad['summary'] in fake.calls[1]['messages'][-1]
    assert inv.trace[0]['violations'] and inv.trace[1]['violations'] is None

@pytest.mark.parametrize('text',[
    'The camera angle is unknown, the backswing causes faster rotation.',
    'Capture FPS is missing, so this backswing produces faster foot speed.',
    'We cannot measure the knee angle, the right kick is more powerful.',
    'We cannot measure knee angle, so the right kick is more powerful.',
    'There is no evidence of collapse, implying a more powerful kick.',
])
def test_denial_or_missingness_cannot_shield_an_independent_claim(text):
    assert validate_grounded_text(text,'observation',[SPEED,ANGLE])

@pytest.mark.parametrize('text',[
    'No measured ball speed is available.',
    'The foot-speed estimate is unreliable due to missing capture FPS.',
])
def test_denials_and_actual_measurement_limit_explanations(text):
    assert validate_grounded_text(text,'observation',[SPEED,ANGLE])==[]


def test_incomparable_pair_cannot_borrow_single_eligibility():
    row={'metric':'ball_speed','units':'m/s','left':20.,'right':24.,'comparable':False,'eligible':True}
    assert validate_grounded_text('The measured ball speed is higher.','summary',[row])


def test_single_grounding_violations_keep_salvage_item_attribution():
    from gateway.validators import salvage_kick_observations_v1
    inv=SimpleNamespace(context={'kickAnalysisContext':{'evidence':{'rows':[ANGLE]}}},stage_outputs={})
    good={'id':'o1','frameKey':'backswing','bodyRegion':'supportLeg','title':'Plant knee angle',
        'severity':2,'deviationDirection':'notComparable','metricIds':[ANGLE['id']],
        'observation':'The measured plant knee angle differs at backswing.',
        'reasoning':'The phase snapshot does not establish instability.'}
    bad={**deepcopy(good),'id':'o2','observation':'The plant leg is unstable and leaks energy.'}
    result={'schemaVersion':1,'observations':[good,bad]}
    violations=validate_kick_observations_v1(result,inv)
    salvaged,dropped=salvage_kick_observations_v1(result,violations,inv)
    assert salvaged['observations']==[good] and len(dropped)==1
    assert validate_kick_observations_v1(salvaged,inv)==[]


def test_missing_fps_prevents_a_comparison_without_asserting_movement_causation():
    assert validate_grounded_text('The unavailable pro FPS prevents a speed comparison.','reasoning',[SPEED])==[]
    assert validate_grounded_text('The missing FPS produces greater power.','reasoning',[SPEED])
