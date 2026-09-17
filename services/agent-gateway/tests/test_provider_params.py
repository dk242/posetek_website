"""Registry `params` -> per-provider call kwargs, the pure parts only.

Neither SDK is installed in CI, so this covers the translation helpers that
don't need one: Gemini's `_base_config_kwargs` (with a stub `google.genai`
injected for the one branch that constructs a `ThinkingConfig`) and Claude's
`_sampling_kwargs`, which is pure by construction. The SDK calls themselves
are still unexercised — that's what the bake-off run is for.
"""

from __future__ import annotations

import sys
import types as pytypes

import pytest

from gateway.errors import GatewayError
from gateway.providers.anthropic_vertex import _sampling_kwargs
from gateway.providers.vertex_gemini import _base_config_kwargs, _thinking_budget, _to_gemini_schema
from gateway.registry import REGISTRY


# ---------------------------------------------------------------------------
# Gemini
# ---------------------------------------------------------------------------


class _StubThinkingConfig:
    def __init__(self, thinking_budget=None, include_thoughts=None):
        self.thinking_budget = thinking_budget
        self.include_thoughts = include_thoughts


@pytest.fixture
def stub_genai_types(monkeypatch):
    """Injects just enough of `google.genai` for `from google.genai import
    types` to resolve to a stub exposing `ThinkingConfig`."""
    google_mod = sys.modules.get("google") or pytypes.ModuleType("google")
    genai_mod = pytypes.ModuleType("google.genai")
    types_mod = pytypes.ModuleType("google.genai.types")
    types_mod.ThinkingConfig = _StubThinkingConfig
    genai_mod.types = types_mod
    monkeypatch.setitem(sys.modules, "google", google_mod)
    monkeypatch.setitem(sys.modules, "google.genai", genai_mod)
    monkeypatch.setitem(sys.modules, "google.genai.types", types_mod)
    monkeypatch.setattr(google_mod, "genai", genai_mod, raising=False)


def test_gemini_omits_thinking_config_when_budget_absent():
    # The no-budget path must not even import the SDK — it is the default for
    # every capability that doesn't opt in.
    kwargs = _base_config_kwargs("sys", {"temperature": 0.4, "max_output_tokens": 4096})
    assert "thinking_config" not in kwargs
    assert kwargs == {"system_instruction": "sys", "temperature": 0.4, "max_output_tokens": 4096, "automatic_function_calling": {"disable": True}}


@pytest.mark.parametrize("budget", [0, -1, 128, 4096])
def test_gemini_passes_budget_through_to_thinking_config(stub_genai_types, budget):
    kwargs = _base_config_kwargs("sys", {"max_output_tokens": 512, "thinking_budget": budget})
    assert kwargs["thinking_config"].thinking_budget == budget


def test_gemini_zero_budget_survives_the_none_filter(stub_genai_types):
    """`0` disables thinking on Flash, so it must not be dropped by the
    adapter's `if v is not None` config filter the way a None would be."""
    kwargs = _base_config_kwargs("sys", {"thinking_budget": 0})
    filtered = {k: v for k, v in kwargs.items() if v is not None}
    assert "thinking_config" in filtered


@pytest.mark.parametrize("budget", [-2, 1.5, "512", True])
def test_gemini_rejects_a_malformed_budget(budget):
    with pytest.raises(GatewayError) as exc:
        _thinking_budget({"thinking_budget": budget})
    assert exc.value.code == "internal"


def test_gemini_include_thoughts_only_on_the_job_path(stub_genai_types):
    """`include_thoughts` is a job-trace concern: on by request (generate()),
    absent by default — the streaming path yields every text part as a
    user-facing delta and must never receive thought parts."""
    job = _base_config_kwargs("sys", {"thinking_budget": 1024}, include_thoughts=True)
    assert job["thinking_config"].include_thoughts is True
    stream = _base_config_kwargs("sys", {"thinking_budget": 1024})
    assert stream["thinking_config"].include_thoughts is None


def test_gemini_never_asks_for_thoughts_when_thinking_is_disabled(stub_genai_types):
    """Vertex 400s on `thinking_budget=0` + `include_thoughts=True`
    ("include_thoughts is only enabled when thinking is enabled"). That
    combination took `build_workout` (Flash, job transport, `_NO_THINKING`)
    down live for every request from 2026-08-22 to 2026-09-02 — the trace
    feature set the flag unconditionally on the job path. The budget itself
    must still survive: `0` is what disables thinking.
    """
    kwargs = _base_config_kwargs("sys", {"thinking_budget": 0}, include_thoughts=True)
    assert kwargs["thinking_config"].thinking_budget == 0
    assert kwargs["thinking_config"].include_thoughts is None


def test_gemini_asks_for_thoughts_on_a_dynamic_budget(stub_genai_types):
    """`-1` is dynamic thinking, not disabled thinking — the flag stays on."""
    kwargs = _base_config_kwargs("sys", {"thinking_budget": -1}, include_thoughts=True)
    assert kwargs["thinking_config"].include_thoughts is True


def _response(parts):
    part_objs = [pytypes.SimpleNamespace(text=t, thought=th) for t, th in parts]
    content = pytypes.SimpleNamespace(parts=part_objs)
    return pytypes.SimpleNamespace(candidates=[pytypes.SimpleNamespace(content=content)])


def test_gemini_text_extraction_excludes_thought_parts():
    from gateway.providers.vertex_gemini import _extract_text, _extract_thoughts

    response = _response([("planning the split...", True), ('{"ok": true}', False)])
    assert _extract_text(response) == '{"ok": true}'
    assert _extract_thoughts(response) == "planning the split..."


def test_gemini_thoughts_are_none_when_absent():
    from gateway.providers.vertex_gemini import _extract_thoughts

    assert _extract_thoughts(_response([("answer only", False)])) is None


# ---------------------------------------------------------------------------
# Claude
# ---------------------------------------------------------------------------


def test_claude_defaults_max_tokens_and_keeps_temperature():
    kwargs = _sampling_kwargs({"temperature": 0.4}, forced_tool_use=False)
    assert kwargs == {"max_tokens": 1024, "temperature": 0.4}


def test_claude_enables_thinking_and_drops_temperature():
    kwargs = _sampling_kwargs(
        {"temperature": 0.4, "max_output_tokens": 8192, "thinking_budget": 2048},
        forced_tool_use=False,
    )
    assert kwargs["thinking"] == {"type": "enabled", "budget_tokens": 2048}
    assert "temperature" not in kwargs


def test_claude_zero_budget_means_no_thinking_param():
    # A Flash-tuned entry (`thinking_budget: 0`) swapped onto Claude must not
    # trip the >= 1024 floor — 0 is "off", and off is Claude's default.
    kwargs = _sampling_kwargs({"temperature": 0.5, "max_output_tokens": 1024, "thinking_budget": 0}, forced_tool_use=False)
    assert "thinking" not in kwargs
    assert kwargs["temperature"] == 0.5


def test_claude_drops_thinking_when_the_structured_output_tool_is_forced():
    params = {"temperature": 0.4, "max_output_tokens": 8192, "thinking_budget": 2048}
    kwargs = _sampling_kwargs(params, forced_tool_use=True)
    assert "thinking" not in kwargs
    assert kwargs["temperature"] == 0.4


@pytest.mark.parametrize(
    "params",
    [
        {"max_output_tokens": 8192, "thinking_budget": 512},   # below the 1024 floor
        {"max_output_tokens": 2048, "thinking_budget": 2048},  # max_tokens must strictly exceed
        {"max_output_tokens": 1024, "thinking_budget": 4096},
        {"max_output_tokens": 8192, "thinking_budget": -1},    # Gemini-only "dynamic"
    ],
)
def test_claude_rejects_an_unsatisfiable_budget(params):
    with pytest.raises(GatewayError) as exc:
        _sampling_kwargs(params, forced_tool_use=False)
    assert exc.value.code == "internal"


@pytest.mark.parametrize("budget", [1.5, "2048", True])
def test_claude_rejects_a_malformed_budget(budget):
    with pytest.raises(GatewayError) as exc:
        _sampling_kwargs({"max_output_tokens": 8192, "thinking_budget": budget}, forced_tool_use=False)
    assert exc.value.code == "internal"


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("capability_id", sorted(REGISTRY))
def test_every_registry_entry_has_a_translatable_budget(capability_id):
    """Whatever each entry declares, both adapters must be able to translate
    it — a miswired budget is a deploy-time crash otherwise."""
    params = REGISTRY[capability_id].params
    _thinking_budget(params)
    if params.get("thinking_budget"):
        _sampling_kwargs(params, forced_tool_use=False)


# ---------------------------------------------------------------------------
# Gemini schema translation
# ---------------------------------------------------------------------------


def test_gemini_schema_strips_value_constraints():
    """Numeric bounds, length/item limits, and string formats explode Vertex's
    constrained-decoding automaton ("too many states for serving", hit live by
    generate_training_plan 2026-08-03) — they must be dropped at translation
    and left to the output validators."""
    schema = {
        "type": "object",
        "properties": {
            "sets": {"type": "integer", "minimum": 1, "maximum": 10},
            "note": {"type": "string", "maxLength": 200, "pattern": "^[a-z]+$"},
            "when": {"type": "string", "format": "date-time"},
            "weeks": {"type": "array", "minItems": 6, "maxItems": 6,
                      "items": {"type": "number", "exclusiveMinimum": 0, "multipleOf": 0.5}},
        },
        "required": ["sets"],
    }
    out = _to_gemini_schema(schema)
    assert out == {
        "type": "object",
        "properties": {
            "sets": {"type": "integer"},
            "note": {"type": "string"},
            "when": {"type": "string"},
            "weeks": {"type": "array", "items": {"type": "number"}},
        },
        "required": ["sets"],
    }


def test_gemini_schema_keeps_properties_named_like_keywords():
    """`properties` keys are field names, not schema keywords — a field
    literally named "format" or "pattern" must survive translation."""
    schema = {
        "type": "object",
        "properties": {
            "format": {"type": "string", "maxLength": 10},
            "pattern": {"type": ["string", "null"]},
        },
    }
    out = _to_gemini_schema(schema)
    assert out["properties"]["format"] == {"type": "string"}
    assert out["properties"]["pattern"] == {"type": "string", "nullable": True}


def test_gemini_schema_still_rewrites_nullable_and_non_string_enums():
    schema = {
        "type": "object",
        "properties": {
            "schemaVersion": {"type": "integer", "enum": [1]},
            "domain": {"type": "string", "enum": ["linearSpeed", "shooting"]},
            "note": {"type": ["string", "null"], "maxLength": 40},
        },
    }
    out = _to_gemini_schema(schema)
    assert out["properties"]["schemaVersion"] == {"type": "integer"}
    assert out["properties"]["domain"] == {"type": "string", "enum": ["linearSpeed", "shooting"]}
    assert out["properties"]["note"] == {"type": "string", "nullable": True}
