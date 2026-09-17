"""Scoped serving-source provider invariants; no provider network calls."""
from types import SimpleNamespace as NS

import pytest

from gateway.errors import GatewayError
from gateway.providers import anthropic_direct as direct, anthropic_vertex as vertex
from gateway.providers.base import get_provider
from gateway.registry import COACH_WORKSPACE_STAGE, PROGRAM_ALLOWED_MODELS, program_stage
from gateway.usage import estimate_cost_usd, make_usage_callback


def test_only_sonnet_checker_routes_to_first_party():
    checker = program_stage('adversarial')
    assert (checker.provider, checker.model) == ('anthropic_direct', 'claude-sonnet-4-6')
    assert checker.tools == []
    assert checker.params == {'temperature': 0, 'max_output_tokens': 1536, 'thinking_budget': 0}
    assert (COACH_WORKSPACE_STAGE.provider, COACH_WORKSPACE_STAGE.model) == ('anthropic_vertex', 'claude-sonnet-4-6')
    assert PROGRAM_ALLOWED_MODELS['claude-sonnet-4-6'] == 'anthropic_vertex'
    assert 'claude-haiku-4-5' not in PROGRAM_ALLOWED_MODELS
    for stage in ('coach_parse', 'repair'):
        assert program_stage(stage).provider == 'vertex_gemini'
        assert program_stage(stage, {stage: 'claude-sonnet-4-6'}).provider == 'anthropic_vertex'
    assert program_stage('adversarial', {'adversarial': 'gemini-2.5-flash'}).provider == 'vertex_gemini'


def test_direct_factory_reuses_adapter_but_vertex_defaults_stay_identical():
    provider = get_provider('anthropic_direct')
    assert isinstance(provider, direct.AnthropicDirectProvider)
    assert isinstance(provider, vertex.AnthropicVertexProvider)
    assert (provider.name, provider.label) == ('anthropic_direct', 'Claude API')
    assert (vertex.AnthropicVertexProvider.name, vertex.AnthropicVertexProvider.label) == ('anthropic_vertex', 'Anthropic Vertex')


def test_direct_checker_structured_response_and_usage_use_direct_client(monkeypatch, make_invocation):
    monkeypatch.setattr(vertex, '_client', lambda: pytest.fail('Direct checker used Vertex client'))
    calls = []
    def create(**kwargs):
        calls.append(kwargs)
        return NS(content=[NS(type='tool_use', name=kwargs['tool_choice']['name'], id='result',
                              input={'passed': True, 'issues': []})],
                  usage=NS(input_tokens=1000, output_tokens=100, cache_read_input_tokens=0, cache_creation_input_tokens=0))
    monkeypatch.setattr(direct, '_client', lambda: NS(messages=NS(create=create)))
    monkeypatch.setenv('VERTEX_LOCATION', 'us-east5')
    inv = make_invocation()
    callback = make_usage_callback(inv, provider='anthropic_direct', model='claude-sonnet-4-6', stage='adversarial')
    schema = {'type': 'object', 'properties': {'passed': {'type': 'boolean'}, 'issues': {'type': 'array', 'items': {'type': 'string'}}}}
    result = get_provider('anthropic_direct').generate(system='review', messages=[], model='claude-sonnet-4-6',
        params={'temperature': 0, 'thinking_budget': 0, 'max_output_tokens': 1536, '_usage_callback': callback}, json_schema=schema)
    assert result.structured == {'passed': True, 'issues': []}
    assert calls[0]['model'] == 'claude-sonnet-4-6'
    row = inv._provider_usage_records[-1]
    assert row['provider'] == 'anthropic_direct' and row['stage'] == 'adversarial'
    assert row['estimatedCostUsd'] == pytest.approx(0.0045)
    assert row['outputIncludesThinking'] is True


def test_existing_vertex_factory_and_metering_remain_vertex(monkeypatch):
    calls = []
    events = []
    monkeypatch.setattr(direct, '_client', lambda: pytest.fail('Vertex path used direct client'))
    def create(**kwargs):
        calls.append(kwargs)
        return NS(content=[NS(type='text', text='ok')],
                  usage=NS(input_tokens=10, output_tokens=3, cache_read_input_tokens=0, cache_creation_input_tokens=0))
    monkeypatch.setattr(vertex, '_client', lambda: NS(messages=NS(create=create)))
    result = get_provider('anthropic_vertex').generate(system='s', messages=[], model='claude-sonnet-4-6',
        params={'max_output_tokens': 64, '_usage_callback': events.append})
    assert result.text == 'ok' and len(calls) == 1
    assert events[0]['provider'] == 'anthropic_vertex'


def test_only_first_party_pricing_omits_existing_regional_premium():
    usage = {'inputTokens': 1000, 'outputTokens': 100}
    assert estimate_cost_usd('claude-sonnet-4-6', usage, region='us-east5', provider='anthropic_direct') == pytest.approx(.0045)
    assert estimate_cost_usd('claude-sonnet-4-6', usage, region='us-east5', provider='anthropic_vertex') == pytest.approx(.00495)
    assert estimate_cost_usd('claude-sonnet-4-6', usage, region='us-east5') == pytest.approx(.00495)
    assert estimate_cost_usd('gemini-2.5-flash', usage, provider='vertex_gemini') == pytest.approx(.00055)


def test_direct_sdk_retries_are_disabled_and_missing_credentials_fail_closed(monkeypatch):
    import anthropic
    seen = []
    def constructor(**kwargs):
        seen.append(kwargs)
        raise RuntimeError('api_key client option must be set')
    monkeypatch.setattr(anthropic, 'Anthropic', constructor)
    with pytest.raises(GatewayError) as caught:
        direct._client()
    assert caught.value.code == 'provider_error'
    assert seen == [{'max_retries': 0, 'timeout': 120}]
