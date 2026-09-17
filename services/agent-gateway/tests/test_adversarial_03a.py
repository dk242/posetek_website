"""Independent planted-fixture boundaries and benchmark routing, not model quality."""
from copy import deepcopy
import json

import pytest

from evals import adversarial_03a as benchmark
from gateway.providers.base import ModelResult


@pytest.fixture
def cases():
    return {row['id']:row for row in benchmark.build_cases()}


def test_planted_inversion_and_honest_relabel_have_identical_legal_doses(cases):
    bad=cases['subtle_emphasis_inversion'];honest=cases['honest_relabel_same_blocks']
    assert bad['context']['workout']['blocks']==honest['context']['workout']['blocks']
    for case in (bad,honest):
        assert case['context']['deterministicCheck']['ok']
        assert case['context']['workout']['estimatedMinutes']==59
        assert case['context']['workout']['budgetMinutes']==60
    minutes={domain:sum(b['estimatedMinutes'] for b in bad['context']['workout']['blocks'] if b['domain']==domain)
             for domain in ('dribbling','passing','shooting')}
    assert minutes=={'dribbling':3,'passing':3,'shooting':49}
    assert bad['expectedAccepted'] is False and honest['expectedAccepted'] is True


def test_gross_domain_and_time_failures_are_distinct_code_boundaries(cases):
    gross=cases['gross_absent_domain']['context']['deterministicCheck']
    time=cases['time_overrun']['context']['deterministicCheck']
    assert not gross['ok'] and gross['intentStatus']=='fail' and gross['timeStatus']=='ok'
    assert not time['ok'] and time['timeStatus']=='over'
    assert time['intentStatus']=='pass'


def test_offline_does_not_call_live_auth_or_provider_and_does_not_claim_quality(monkeypatch,tmp_path):
    def forbidden(*a,**kw):raise AssertionError('Offline benchmark attempted a real provider/auth call')
    monkeypatch.setattr(benchmark,'gcloud_auth',forbidden)
    monkeypatch.setattr('gateway.providers.base.get_provider',forbidden)
    path=tmp_path/'offline.json'
    result=benchmark.run_benchmark(record=path)
    assert result['status']=='fixture_valid'
    assert result['actualModelCalls']==0 and result['modelQualityMeasured'] is False
    assert result['metrics'] is None
    assert json.loads(path.read_text())==result


@pytest.mark.parametrize('response',[{'passed':'no','issues':['Mismatch']},
                                    {'passed':False,'issues':[]},{'passed':True,'issues':['Mismatch']}])
def test_invalid_or_contradictory_verdict_never_counts_as_success(response):
    assert not benchmark.score_response({'expectedAccepted':False},response)['matchedExpectation']


def test_honest_controls_require_positive_coherent_verdict():
    assert benchmark.score_response({'expectedAccepted':True},{'passed':True,'issues':[]})['matchedExpectation']
    assert not benchmark.score_response({'expectedAccepted':True},{'passed':False,'issues':['Invented rest concern']})['matchedExpectation']


@pytest.mark.parametrize('model,ceiling',[('gemini-2.5-flash',.05),('claude-sonnet-4-6',.15)])
def test_live_route_never_sends_deterministically_rejected_cases(monkeypatch,tmp_path,model,ceiling):
    calls=[]
    class Provider:
        def generate(self,**kwargs):
            context=json.loads(kwargs['messages'][0].content);calls.append(context)
            assert context['deterministicCheck']['ok']
            inverted='The bulk of this session is dribbling' in context['workout']['intent']
            response={'passed':not inverted,'issues':['Shooting dominates the stated dribbling focus.'] if inverted else []}
            usage={'inputTokens':10,'outputTokens':10,'thinkingTokens':0,'thinkingTokensAvailable':True,'calls':1}
            kwargs['params']['_usage_callback']({'usage':usage,'outcome':'complete'})
            return ModelResult(text='',structured=response,usage=usage)
    monkeypatch.setenv('GCP_PROJECT','synthetic-test-project');monkeypatch.setenv('VERTEX_LOCATION','global')
    monkeypatch.setattr('gateway.providers.base.get_provider',lambda _:Provider())
    result=benchmark.run_benchmark(live=True,record=tmp_path/'live-fake.json',stage_model=model,budget_usd=ceiling)
    assert result['allMatched'] and result['sourceUnchanged']
    assert len(calls)==result['actualModelCalls']==3
    assert result['metrics']['deterministicallyBlocked']==2
    assert result['metrics']['matchedExpectations']==5
    assert result['reservedEstimateUsd']<=ceiling
    assert result['model']==model


def test_budget_preflight_refuses_before_any_live_call(monkeypatch,tmp_path):
    def forbidden(*a,**kw):raise AssertionError('Budget refusal attempted a real provider')
    monkeypatch.setenv('GCP_PROJECT','synthetic-test-project');monkeypatch.setenv('VERTEX_LOCATION','global')
    monkeypatch.setattr('gateway.providers.base.get_provider',forbidden)
    with pytest.raises(ValueError,match='reservation exceeds budget'):
        benchmark.run_benchmark(live=True,record=tmp_path/'over-budget.json',budget_usd=.000001)


def test_existing_evidence_cannot_be_overwritten(tmp_path):
    record=tmp_path/'existing.json';record.write_text('original evidence')
    with pytest.raises(ValueError,match='already exists'):
        benchmark.run_benchmark(record=record)
    assert record.read_text()=='original evidence'
