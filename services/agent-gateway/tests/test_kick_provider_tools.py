"""Gemini 2.5 tools and structured output require separate, bounded requests."""
from types import SimpleNamespace as NS

import pytest

from gateway.providers import vertex_gemini as gemini
from tests.test_provider_usage_v3 import _gemini_client, _gemini_response, TOOLS


def final_response():
    response = _gemini_response()
    response.candidates[0].content.parts = [NS(text='{"ok": true}', thought=False)]
    return response


@pytest.mark.parametrize("calls", [0, 1, 5])
def test_tools_never_share_a_request_with_json_schema(monkeypatch, calls):
    responses = ([_gemini_response(calls), final_response()] if calls >= 2
                 else ([_gemini_response(1), _gemini_response(), final_response()] if calls
                       else [_gemini_response(), final_response()]))
    requests = _gemini_client(monkeypatch, responses)
    executed = []
    result = gemini.VertexGeminiProvider().generate(
        system="inspect, then answer", messages=[], model="gemini-2.5-pro",
        params={"max_tool_calls": 2, "max_tool_seconds": 240}, tools=TOOLS,
        json_schema={"type": "object", "properties": {"ok": {"type": "boolean"}}},
        tool_runner=lambda name, args: executed.append(name) or {"evidence": 1},
    )
    assert result.structured == {"ok": True}
    assert result.usage["calls"] == len(requests)
    assert len(executed) == min(calls, 2)
    assert hasattr(requests[0]["config"], "tools")
    for request in requests:
        config = request["config"]
        assert not (hasattr(config, "tools") and hasattr(config, "response_schema"))
        assert not (hasattr(config, "tools") and hasattr(config, "response_mime_type"))
    assert requests[-1]["config"].response_mime_type == "application/json"
    assert not hasattr(requests[-1]["config"], "tools")


def test_zero_tool_budget_starts_with_structured_final(monkeypatch):
    requests = _gemini_client(monkeypatch, [final_response()])
    result = gemini.VertexGeminiProvider().generate(
        system="answer", messages=[], model="gemini-2.5-pro", params={"max_tool_calls": 0},
        tools=TOOLS, json_schema={"type": "object"}, tool_runner=lambda *_: pytest.fail("budget exhausted"))
    assert result.structured == {"ok": True}
    assert len(requests) == 1 and not hasattr(requests[0]["config"], "tools")


def test_investigation_timeout_cannot_consume_reserved_final_time(monkeypatch):
    now = [0.0]
    monkeypatch.setattr(gemini.time, "monotonic", lambda: now[0])
    requests = _gemini_client(monkeypatch, [_gemini_response(1), _gemini_response(), final_response()])
    client = gemini._client()
    original = client.models.generate_content
    def respond(**kwargs):
        response = original(**kwargs)
        now[0] = 119.0 if len(requests) == 1 else 119.5
        return response
    client.models.generate_content = respond
    monkeypatch.setattr(gemini, "_client", lambda: client)
    gemini.VertexGeminiProvider().generate(
        system="inspect then answer", messages=[], model="gemini-2.5-pro",
        params={"max_tool_calls": 3, "max_tool_seconds": 240}, tools=TOOLS,
        json_schema={"type": "object"}, tool_runner=lambda *_: {})
    assert requests[1]["config"].http_options["timeout"] <= 1000
    assert requests[-1]["config"].http_options["timeout"] == 120000


def test_empty_investigation_response_still_uses_structured_final(monkeypatch):
    requests = _gemini_client(monkeypatch, [NS(candidates=[]), final_response()])
    result = gemini.VertexGeminiProvider().generate(
        system="inspect then answer", messages=[], model="gemini-2.5-pro",
        params={"max_tool_seconds": 240}, tools=TOOLS,
        json_schema={"type": "object"}, tool_runner=lambda *_: {})
    assert result.structured == {"ok": True}
    assert len(requests) == 2
