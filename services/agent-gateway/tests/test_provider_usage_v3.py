"""Exercise actual adapters against scripted SDK clients, without model/network cost."""
from types import SimpleNamespace as NS
import datetime as dt
import sys

import pytest

from gateway.errors import GatewayError
from gateway.providers import anthropic_vertex as claude, vertex_gemini as gemini
from gateway.providers.base import tool_limits
from gateway.usage import make_usage_callback, aggregate_usage, estimate_cost_usd

TOOLS=[{'name':'add','parameters':{'type':'object','properties':{}}}]


def _claude_response(calls=0):
    content=([NS(type='tool_use',name='add',id=f'tool{i}',input={}) for i in range(calls)]
             if calls else [NS(type='text',text='finished')])
    return NS(content=content,usage=NS(input_tokens=100,output_tokens=20,cache_read_input_tokens=5,cache_creation_input_tokens=10))


class Stream:
    def __init__(self,fail=False): self.fail=fail
    def __enter__(self): return self
    def __exit__(self,*args): return False
    @property
    def text_stream(self):
        yield 'finished'
        if self.fail: raise RuntimeError('disconnected')
    def get_final_message(self): return _claude_response()


def _claude_client(monkeypatch,responses,stream_failure=False):
    requests=[]
    def create(**kw):
        requests.append(kw)
        item=responses.pop(0)
        if isinstance(item,Exception): raise item
        return item
    def stream(**kw):
        requests.append(kw)
        return Stream(stream_failure)
    monkeypatch.setattr(claude,'_client',lambda:NS(messages=NS(create=create,stream=stream)))
    return requests


@pytest.mark.parametrize('streaming',[False,True])
def test_claude_batch_cannot_overrun_budget_and_every_call_is_metered(monkeypatch,make_invocation,db,streaming):
    inv=make_invocation()
    inv.job_id='job1'
    cb=make_usage_callback(inv,provider='anthropic_vertex',model='claude-sonnet-4-6',stage='build/w1s1',retry_index=1)
    requests=_claude_client(monkeypatch,[_claude_response(5),_claude_response()])
    executed=[]
    params={'max_tool_calls':2,'max_tool_seconds':60,'_usage_callback':cb}
    kwargs=dict(system='system',messages=[],model='claude-sonnet-4-6',params=params,tools=TOOLS,tool_runner=lambda n,a:executed.append(n) or {'ok':True})
    provider=claude.AnthropicVertexProvider()
    if streaming:
        result=list(provider.stream(**kwargs))[-1]['usage']
    else:
        result=provider.generate(**kwargs).usage
    assert len(executed)==2
    assert len(requests)==len(cb.records)==result['calls']==2
    assert all('_usage_callback' not in r and 'max_tool_calls' not in r and 'max_tool_seconds' not in r for r in requests)
    assert len(requests[-1]['messages'][-1]['content'])==5 # reply to every tool id, including refused calls
    assert 'tools' not in requests[-1]
    assert 0 < requests[-1]['timeout'] <= requests[0]['timeout'] <= 60
    assert result['inputTokens']==230 # uncached + read + write, both calls
    assert result['thinkingTokens'] is None and result['thinkingTokensAvailable'] is False
    assert all(r['retryIndex']==1 and r['stage']=='build/w1s1' for r in cb.records)
    assert len({r['invocationId'] for r in cb.records})==1
    assert len(db.get_collection(('llmUsage',)))==2
    assert aggregate_usage(cb.records)['calls']==2


@pytest.mark.parametrize('streaming',[False,True])
def test_claude_failures_get_one_ledger_row_and_preserve_previous_subturns(monkeypatch,make_invocation,streaming):
    cb=make_usage_callback(make_invocation(),provider='anthropic_vertex',model='claude-sonnet-4-6',stage='build')
    requests=_claude_client(monkeypatch,[_claude_response(1),RuntimeError('unavailable')],stream_failure=True)
    kwargs=dict(system='system',messages=[],model='claude-sonnet-4-6',params={'max_tool_calls':1,'_usage_callback':cb},tools=TOOLS,tool_runner=lambda n,a:{})
    provider=claude.AnthropicVertexProvider()
    with pytest.raises(GatewayError):
        if streaming: list(provider.stream(**kwargs))
        else: provider.generate(**kwargs)
    assert len(requests)==len(cb.records)==2
    assert [r['outcome'] for r in cb.records]==['complete','failed']
    assert sum(r['inputTokens'] for r in cb.records)==115


class Part:
    @staticmethod
    def from_text(text): return NS(text=text)
    @staticmethod
    def from_function_response(name,response): return NS(name=name,response=response)


def _gemini_response(calls=0):
    parts=([NS(function_call=NS(name='add',args={})) for _ in range(calls)]
           if calls else [NS(text='finished',thought=False)])
    return NS(candidates=[NS(content=NS(parts=parts))],usage_metadata=NS(prompt_token_count=100,candidates_token_count=20,cached_content_token_count=10,thoughts_token_count=7))


def _gemini_client(monkeypatch,responses,stream_failure=False):
    types=NS(Content=lambda **kw:NS(**kw),GenerateContentConfig=lambda **kw:NS(**kw),Part=Part)
    # Use an isolated stub even if other tests have replaced google-genai.
    monkeypatch.setitem(sys.modules,'google.genai',NS(types=types))
    monkeypatch.setattr(gemini,'_to_gemini_tools',lambda specs:specs)
    requests=[]
    def create(**kw):
        requests.append(kw)
        item=responses.pop(0)
        if isinstance(item,Exception): raise item
        return item
    def stream(**kw):
        requests.append(kw)
        yield _gemini_response()
        if stream_failure: raise RuntimeError('disconnected')
    monkeypatch.setattr(gemini,'_client',lambda:NS(models=NS(generate_content=create,generate_content_stream=stream)))
    return requests


@pytest.mark.parametrize('streaming',[False,True])
def test_gemini_subcalls_thinking_and_hard_batch_cap(monkeypatch,make_invocation,streaming):
    cb=make_usage_callback(make_invocation(),provider='vertex_gemini',model='gemini-2.5-flash',stage='build')
    requests=_gemini_client(monkeypatch,[_gemini_response(6),_gemini_response()])
    executed=[]
    kwargs=dict(system='system',messages=[],model='gemini-2.5-flash',params={'max_tool_calls':2,'_usage_callback':cb},tools=TOOLS,tool_runner=lambda n,a:executed.append(n) or {})
    provider=gemini.VertexGeminiProvider()
    result=list(provider.stream(**kwargs))[-1]['usage'] if streaming else provider.generate(**kwargs).usage
    assert len(executed)==2
    assert len(requests)==len(cb.records)==result['calls']==2
    assert result['thinkingTokens']==14
    assert result['outputTokens']==40
    assert len(requests[-1]['contents'][-1].parts)==6
    assert not hasattr(requests[-1]['config'],'tools')
    assert all(r['config'].automatic_function_calling == {'disable': True} for r in requests)
    assert 0 < requests[-1]['config'].http_options['timeout'] <= requests[0]['config'].http_options['timeout'] <= 60000
    assert aggregate_usage(cb.records)['estimatedCostUsd']==pytest.approx((180*.30+20*.03+54*2.50)/1e6)


@pytest.mark.parametrize('streaming',[False,True])
def test_gemini_failure_is_metered_with_streamed_usage_if_available(monkeypatch,make_invocation,streaming):
    cb=make_usage_callback(make_invocation(),provider='vertex_gemini',model='gemini-2.5-flash',stage='check')
    _gemini_client(monkeypatch,[RuntimeError('failure')],stream_failure=True)
    kwargs=dict(system='system',messages=[],model='gemini-2.5-flash',params={'_usage_callback':cb})
    with pytest.raises(GatewayError):
        if streaming: list(gemini.VertexGeminiProvider().stream(**kwargs))
        else: gemini.VertexGeminiProvider().generate(**kwargs)
    assert len(cb.records)==1 and cb.records[0]['outcome']=='failed'
    assert cb.records[0]['inputTokens']==(100 if streaming else 0)


def test_price_does_not_double_count_cache_or_claude_thinking():
    usage=claude._usage_from_response(NS(input_tokens=100,output_tokens=20,cache_read_input_tokens=50,cache_creation_input_tokens=10))
    assert estimate_cost_usd('claude-sonnet-4-6',usage,region='global')==pytest.approx((100*3+50*.3+10*3*1.25+20*15)/1e6)
    assert estimate_cost_usd('claude-sonnet-4-6',usage,region='us-central1')==pytest.approx((100*3+50*.3+10*3*1.25+20*15)*1.1/1e6,abs=1e-9)
    assert estimate_cost_usd('unknown',usage) is None
    assert gemini._usage_from_metadata(None)['thinkingTokens'] is None


@pytest.mark.parametrize('params',[{'max_tool_calls':True},{'max_tool_calls':121},{'max_tool_seconds':0},{'max_tool_seconds':901}])
def test_invalid_server_tool_limits_fail_closed(params):
    with pytest.raises(GatewayError): tool_limits(params)


def test_daily_quota_counts_invocations_not_model_subcalls(db,monkeypatch):
    from gateway.config import check_quota
    cfg={'capabilities':{'generate_training_plan':{'dailyLimitPerUser':2}}}
    now=dt.datetime.now(dt.timezone.utc)
    for i in range(5):
        db.set_doc(('llmUsage',f'u{i}'),{'requestedByUid':'user','capability':'generate_training_plan','createdAt':now,'invocationId':'same_job'})
    check_quota(db,cfg,'user','generate_training_plan')
    db.set_doc(('llmUsage','other'),{'requestedByUid':'user','capability':'generate_training_plan','createdAt':now,'invocationId':'other_job'})
    with pytest.raises(GatewayError,match='Daily limit'):
        check_quota(db,cfg,'user','generate_training_plan')


def test_claude_thinking_breakdown_when_provider_exposes_it():
    usage=claude._usage_from_response(NS(input_tokens=100,output_tokens=20,output_tokens_details=NS(thinking_tokens=13)))
    assert usage['thinkingTokens']==13 and usage['thinkingTokensAvailable'] is True
    assert estimate_cost_usd('claude-sonnet-4-6',usage,region='global')==pytest.approx((100*3+20*15)/1e6)



def test_claude_current_sdk_temperature_uses_extra_body_without_retry():
    def current(*,model,messages,max_tokens,extra_body=None):pass
    def legacy(*,model,messages,max_tokens,temperature=None):pass
    kwargs={'model':'claude-sonnet-4-6','messages':[],'max_tokens':500,'temperature':0}
    current_kwargs=claude._sdk_kwargs(current,kwargs)
    assert 'temperature' not in current_kwargs
    assert current_kwargs['extra_body']=={'temperature':0}
    assert claude._sdk_kwargs(legacy,kwargs)==kwargs
    assert kwargs['temperature']==0


def test_claude_installed_sdk_accepts_translated_kwargs_without_network():
    import inspect
    try:
        import anthropic
        client=anthropic.AnthropicVertex(project_id='unused',region='global')
    except (ImportError,AttributeError):
        pytest.skip('SDK not installed in this offline test environment')
    kwargs={'model':'claude-sonnet-4-6','messages':[],'max_tokens':500,'temperature':0}
    for method in (client.messages.create,client.messages.stream):
        inspect.signature(method).bind(**claude._sdk_kwargs(method,kwargs))


@pytest.mark.parametrize('model', ['claude-sonnet-4-5', 'claude-sonnet-4-5@20250929'])
def test_sonnet_45_fallback_stays_below_runtime_cap_with_truthful_cost(model):
    from gateway.registry import program_stage
    assert program_stage('repair', {'repair': model}).provider == 'anthropic_vertex'
    assert estimate_cost_usd(model, {'inputTokens': 1000, 'outputTokens': 100}, region='global') == pytest.approx(.0045)
    assert estimate_cost_usd(model, {'inputTokens': 200000, 'outputTokens': 100}, region='global') == pytest.approx(.6015)
    assert estimate_cost_usd(model, {'inputTokens': 200001, 'outputTokens': 100}, region='global') == pytest.approx(1.202256)
    with pytest.raises(GatewayError):
        program_stage('build', {'build': 'claude-opus-4-6'})


@pytest.mark.parametrize('limit', [True, 0, -1, float('nan'), float('inf'), 121])
def test_invalid_request_timeout_fails_closed(limit):
    import time
    from gateway.providers.base import request_timeout
    with pytest.raises(GatewayError, match='request_timeout_seconds'):
        request_timeout({'request_timeout_seconds': limit}, time.monotonic() + 60)


def test_request_timeout_caps_remaining_time_and_stops_after_deadline(monkeypatch):
    import time
    from gateway.providers.base import request_timeout
    monkeypatch.setattr(time, 'monotonic', lambda: 1000)
    assert request_timeout({}, 2000) == 120
    assert request_timeout({}, 1025) == 25
    assert request_timeout({'request_timeout_seconds': 10}, 1025) == 10
    with pytest.raises(GatewayError, match='deadline'):
        request_timeout({}, 1000)


def test_gemini_current_sdk_accepts_nullable_tool_schema_and_http_timeout_without_network():
    # Existing suites replace SDK modules with test doubles; use a clean process
    # to exercise the actually installed Pydantic SDK boundary without a request.
    import subprocess
    import textwrap
    program = textwrap.dedent("""
        from google.genai import types
        from gateway.providers.vertex_gemini import _to_gemini_tools
        schema = {'type': 'object', 'properties': {'restBetweenSetsSeconds': {'type': ['integer', 'null'], 'minimum': 0}}, 'additionalProperties': False}
        tool = _to_gemini_tools([{'name': 'draft_add_block', 'parameters': schema}])[0]
        assert tool.function_declarations[0].parameters_json_schema == schema
        config = types.GenerateContentConfig(tools=[tool], http_options={'timeout': 120000}, automatic_function_calling={'disable': True})
        assert config.automatic_function_calling.disable is True
        assert config.http_options.timeout == 120000
        assert config.tools[0].function_declarations[0].parameters is None
    """)
    completed = subprocess.run([sys.executable, '-c', program], capture_output=True, text=True)
    if 'No module named' in completed.stderr:
        pytest.skip('google-genai SDK is not installed in this offline environment')
    assert completed.returncode == 0, completed.stderr


def test_stage_digest_preserves_nested_retry_counts():
    from gateway.usage import aggregate_usage
    stages = [dict(stage="build", calls=3, retries=1, estimatedCostUsd=.01, thinkingTokensAvailable=True),
              dict(stage="build", calls=2, retries=0, estimatedCostUsd=.02, thinkingTokensAvailable=True)]
    result = aggregate_usage(stages)
    assert result["retries"] == 1
    assert result["calls"] == 5
    assert result["estimatedCostUsd"] == .03
