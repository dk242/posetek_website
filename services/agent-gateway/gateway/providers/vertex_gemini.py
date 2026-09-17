"""Gemini via Vertex AI, using the `google-genai` SDK (`from google import
genai`, `genai.Client(vertexai=True, ...)`). Authenticates purely through the
Cloud Run service account's ADC — no API keys.

Every SDK symbol is imported inside a function, never at module scope, so a
missing/broken `google-genai` install only breaks the first call that needs
it (raised as `GatewayError("provider_error")`) rather than failing at import
time and taking `/health` down with it.
"""

from __future__ import annotations

import json
import os
import time
from typing import Callable, Iterator, Optional

from gateway.errors import GatewayError
from gateway.providers.base import (
    ModelMessage, ModelResult, Provider, safe_json_loads, ProviderCall, empty_usage, add_usage, tool_limits, request_timeout,
)


def _client():
    try:
        from google import genai
    except ImportError as exc:  # pragma: no cover - exercised only when the SDK is missing
        raise GatewayError("provider_error", f"google-genai is not available: {exc}") from exc

    project = os.environ.get("GCP_PROJECT")
    location = os.environ.get("VERTEX_LOCATION", "us-central1")
    if not project:
        raise GatewayError("provider_error", "GCP_PROJECT is not configured")
    from google.genai import types
    return genai.Client(vertexai=True, project=project, location=location,
                        http_options=types.HttpOptions(timeout=120000, retry_options=types.HttpRetryOptions(attempts=1)))


def _usage_from_metadata(usage_metadata) -> dict:
    thoughts = getattr(usage_metadata, "thoughts_token_count", None)
    return {
        "inputTokens": int(getattr(usage_metadata, "prompt_token_count", 0) or 0),
        "outputTokens": int(getattr(usage_metadata, "candidates_token_count", 0) or 0),
        "cachedInputTokens": int(getattr(usage_metadata, "cached_content_token_count", 0) or 0),
        "thinkingTokens": int(thoughts) if thoughts is not None else None,
        "thinkingTokensAvailable": thoughts is not None,
        "outputIncludesThinking": False,
    }


def _add(cumulative: dict, usage: dict) -> None:
    add_usage(cumulative, usage)


def _to_contents(messages: list[ModelMessage]):
    from google.genai import types

    return [
        types.Content(
            role="model" if m.role == "assistant" else "user",
            parts=[types.Part.from_text(text=m.content)],
        )
        for m in messages
    ]


def _to_gemini_tools(tool_specs: list[dict]):
    from google.genai import types

    declarations = [
        types.FunctionDeclaration(
            name=spec["name"],
            description=spec.get("description", ""),
            parameters_json_schema=spec.get("parameters") or {"type": "object", "properties": {}},
        )
        for spec in tool_specs
    ]
    return [types.Tool(function_declarations=declarations)]


def _extract_function_calls(response) -> list:
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return []
    parts = getattr(candidates[0].content, "parts", None) or []
    return [part.function_call for part in parts if getattr(part, "function_call", None) is not None]


def _extract_text(response) -> str:
    # Manual part-walk rather than `response.text`: with `include_thoughts` on,
    # thought-summary parts also carry `text`, and the answer must never
    # include them (SDK versions differ on whether `.text` filters thoughts).
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return getattr(response, "text", None) or ""
    parts = getattr(candidates[0].content, "parts", None) or []
    return "".join(
        getattr(p, "text", "") or "" for p in parts if not getattr(p, "thought", False)
    )


def _extract_thoughts(response) -> Optional[str]:
    """The thought-summary parts (`include_thoughts=True`), joined — captured
    for the job trace, never for the answer."""
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return None
    parts = getattr(candidates[0].content, "parts", None) or []
    thoughts = "".join(
        getattr(p, "text", "") or "" for p in parts if getattr(p, "thought", False)
    )
    return thoughts or None


def _summarize_args(args: dict) -> str:
    try:
        return json.dumps(args)[:200]
    except Exception:
        return str(args)[:200]


# Value-constraint keywords are dropped at translation time: Vertex compiles
# `response_schema` into a serving automaton, and numeric bounds, length/item
# limits, and string formats multiply its state count — `generate_training_plan`
# was rejected outright with "schema produces a constraint that has too many
# states for serving" (live, 2026-08-03) until these were stripped. Same
# pattern as non-string enums below: the gateway's own output validators
# enforce every one of these post-hoc, so the constraint is not lost.
_UNSERVABLE_CONSTRAINT_KEYS = frozenset({
    "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
    "minItems", "maxItems", "minLength", "maxLength", "pattern", "format",
})


def _to_gemini_schema(schema):
    """Translates the canonical JSON Schema (`gateway/schemas/*`) into the
    subset google-genai's typed `Schema` accepts — the adapter-side translation
    `report_v1.py`'s docstring assigns here.

    Three rewrites: `"type": ["integer", "null"]` becomes
    `"type": "integer", "nullable": True`; non-string `enum`s (e.g.
    `schemaVersion: {"type": "integer", "enum": [1]}`) drop the enum — Gemini
    only supports string enums; and `_UNSERVABLE_CONSTRAINT_KEYS` are dropped
    wholesale (see the comment above). Output-side validators enforce all
    dropped constraints.
    """
    if isinstance(schema, list):
        return [_to_gemini_schema(item) for item in schema]
    if not isinstance(schema, dict):
        return schema

    out = {}
    for key, value in schema.items():
        # `properties` keys are field *names*, not schema keywords — a field
        # named e.g. "format" must survive; only its sub-schema is translated.
        if key == "properties" and isinstance(value, dict):
            out[key] = {name: _to_gemini_schema(sub) for name, sub in value.items()}
            continue
        if key in _UNSERVABLE_CONSTRAINT_KEYS:
            continue
        if key == "type" and isinstance(value, list):
            non_null = [t for t in value if t != "null"]
            out["type"] = non_null[0] if non_null else "null"
            if "null" in value:
                out["nullable"] = True
        elif key == "enum" and not all(isinstance(v, str) for v in value):
            continue
        else:
            out[key] = _to_gemini_schema(value)
    return out


def _thinking_budget(params: dict) -> Optional[int]:
    """Reads the registry's provider-neutral `thinking_budget` (see the
    `CapabilitySpec.params` comment in registry.py) and validates it for
    Gemini, whose `ThinkingConfig.thinking_budget` happens to use the same
    vocabulary: `0` disables thinking, `-1` asks for a dynamic budget, and a
    positive value is a token cap.

    Returns None when the key is absent, which means "send no thinking_config
    at all" — 2.5 models then think dynamically by default. Note 2.5 Pro
    cannot disable thinking (minimum budget 128) and rejects `0`; that's a
    model-specific constraint the registry entry has to respect, not something
    this adapter can fix up, so it is left to fail loudly at the provider.
    """
    budget = params.get("thinking_budget")
    if budget is None:
        return None
    if isinstance(budget, bool) or not isinstance(budget, int) or budget < -1:
        raise GatewayError("internal", f"Invalid thinking_budget in registry params: {budget!r}")
    return budget


def _base_config_kwargs(system: str, params: dict, *, include_thoughts: bool = False) -> dict:
    kwargs = {
        "system_instruction": system,
        "temperature": params.get("temperature"),
        "max_output_tokens": params.get("max_output_tokens"),
        # The gateway owns and meters every tool subturn; never let the SDK loop.
        "automatic_function_calling": {"disable": True},
    }
    budget = _thinking_budget(params)
    if budget is not None:
        # Imported here, not at module scope, per this module's docstring. The
        # import is inside the `if` on purpose: capabilities that don't set a
        # budget build their kwargs without touching the SDK at all.
        from google.genai import types

        # `include_thoughts` only on the non-streaming job path: the trace
        # wants the thought summary, but the streaming path yields every text
        # part as user-facing deltas and must never receive thought parts.
        #
        # It is also only legal when thinking is actually on. Vertex hard-fails
        # `thinking_budget=0` + `include_thoughts=True` with a 400
        # ("include_thoughts is only enabled when thinking is enabled"), which
        # took `build_workout` — the one live Flash capability on the job path
        # with `_NO_THINKING` — down for every request between this trace
        # feature's deploy (rev 00025, 2026-08-22) and this fix. `-1` (dynamic)
        # is thinking-enabled, so only an explicit `0` suppresses the flag.
        kwargs["thinking_config"] = types.ThinkingConfig(
            thinking_budget=budget,
            include_thoughts=(include_thoughts and budget != 0) or None,
        )
    return kwargs


class VertexGeminiProvider(Provider):
    def generate(
        self,
        *,
        system: str,
        messages: list[ModelMessage],
        model: str,
        params: dict,
        json_schema: Optional[dict] = None,
        tools: Optional[list[dict]] = None,
        tool_runner: Optional[Callable[[str, dict], dict]] = None,
    ) -> ModelResult:
        from google.genai import types

        client = _client()
        contents = _to_contents(messages)
        config_kwargs = _base_config_kwargs(system, params, include_thoughts=True)
        if json_schema is not None:
            config_kwargs["response_mime_type"] = "application/json"
            config_kwargs["response_schema"] = _to_gemini_schema(json_schema)
        gemini_tools = _to_gemini_tools(tools) if tools else None

        max_calls, max_seconds = tool_limits(params)
        deadline = time.monotonic() + max_seconds
        calls_made = 0
        cumulative = empty_usage()
        tool_calls_log: list[dict] = []
        tools_active = bool(gemini_tools)

        while True:
            # Gemini 2.5 cannot combine function declarations and response_schema.
            # Investigate with tools, then use a separate structured final turn.
            # Reserve time for that final turn instead of exhausting the tool budget.
            final_reserve = min(120.0, max_seconds / 2) if json_schema is not None else 0
            if calls_made >= max_calls or time.monotonic() >= deadline - final_reserve:
                tools_active = False
            active_kwargs = dict(config_kwargs)
            request_deadline = deadline - final_reserve if tools_active else deadline
            active_kwargs["http_options"] = {"timeout": max(1, int(request_timeout(params, request_deadline) * 1000))}
            if tools_active and gemini_tools:
                active_kwargs["tools"] = gemini_tools
                active_kwargs.pop("response_mime_type", None)
                active_kwargs.pop("response_schema", None)
            config = types.GenerateContentConfig(**{k: v for k, v in active_kwargs.items() if v is not None})

            try:
                with ProviderCall(params, "vertex_gemini", model, cumulative) as metered:
                    response = client.models.generate_content(model=model, contents=contents, config=config)
                    metered.usage = _usage_from_metadata(getattr(response, "usage_metadata", None))
            except Exception as exc:
                raise GatewayError("provider_error", f"Vertex Gemini call failed: {exc}") from exc

            function_calls = _extract_function_calls(response) if (tool_runner and tools_active) else []
            if not function_calls:
                if json_schema is not None and tools_active:
                    candidates = getattr(response, "candidates", None) or []
                    content = getattr(candidates[0], "content", None) if candidates else None
                    if content is not None:
                        contents.append(content)
                    contents.append(types.Content(role="user", parts=[types.Part.from_text(
                        text="Investigation is complete. Return the final structured result using the supplied evidence and quality limits. Do not invent missing measurements.")]))
                    tools_active = False
                    continue
                text = _extract_text(response)
                structured = safe_json_loads(text) if json_schema is not None else None
                return ModelResult(
                    text=text, structured=structured, usage=cumulative,
                    tool_calls=tool_calls_log, thoughts=_extract_thoughts(response),
                )

            contents.append(response.candidates[0].content)
            # Gemini requires the reply to a function-call turn to be ONE
            # content carrying a response part per call — a content per call
            # fails with "number of function response parts is equal to..."
            response_parts = []
            for fc in function_calls:
                args = dict(fc.args or {})
                tool_calls_log.append({"name": fc.name, "argsSummary": _summarize_args(args)})
                if calls_made >= max_calls or time.monotonic() >= request_deadline:
                    result = {"error": "tool_budget_exhausted"}
                else:
                    calls_made += 1
                    try:
                        result = tool_runner(fc.name, args)
                    except GatewayError:
                        raise
                    except Exception as exc:
                        result = {"error": str(exc)}
                response_parts.append(types.Part.from_function_response(name=fc.name, response=result))
            contents.append(types.Content(role="user", parts=response_parts))

    def stream(
        self,
        *,
        system: str,
        messages: list[ModelMessage],
        model: str,
        params: dict,
        tools: Optional[list[dict]] = None,
        tool_runner: Optional[Callable[[str, dict], dict]] = None,
    ) -> Iterator[dict]:
        """Streams deltas turn by turn. When tools are enabled, each turn is
        first probed with a non-streaming call so we know whether the model
        wants a tool before committing to a token stream (incremental
        function-call parsing mid-stream is real but not worth building for
        v1 — see README). Once no more tool calls are pending, the final turn
        streams for real.
        """
        from google.genai import types

        client = _client()
        contents = _to_contents(messages)
        gemini_tools = _to_gemini_tools(tools) if tools else None

        max_calls, max_seconds = tool_limits(params)
        deadline = time.monotonic() + max_seconds
        calls_made = 0
        cumulative = empty_usage()

        while True:
            use_tools = bool(gemini_tools) and tool_runner and calls_made < max_calls and time.monotonic() < deadline
            config_kwargs = _base_config_kwargs(system, params)
            config_kwargs["http_options"] = {"timeout": max(1, int(request_timeout(params, deadline) * 1000))}
            if use_tools:
                config_kwargs["tools"] = gemini_tools
            config = types.GenerateContentConfig(**{k: v for k, v in config_kwargs.items() if v is not None})

            if use_tools:
                try:
                    with ProviderCall(params, "vertex_gemini", model, cumulative) as metered:
                        response = client.models.generate_content(model=model, contents=contents, config=config)
                        metered.usage = _usage_from_metadata(getattr(response, "usage_metadata", None))
                except Exception as exc:
                    raise GatewayError("provider_error", f"Vertex Gemini call failed: {exc}") from exc

                function_calls = _extract_function_calls(response)
                if function_calls:
                    contents.append(response.candidates[0].content)
                    # One content with all response parts — same Gemini
                    # requirement as in generate() above.
                    response_parts = []
                    for fc in function_calls:
                        args = dict(fc.args or {})
                        yield {"type": "tool", "name": fc.name, "status": "started", "argsSummary": _summarize_args(args)}
                        if calls_made >= max_calls or time.monotonic() >= deadline:
                            result = {"error": "tool_budget_exhausted"}
                        else:
                            calls_made += 1
                            try:
                                result = tool_runner(fc.name, args)
                            except GatewayError:
                                raise
                            except Exception as exc:
                                result = {"error": str(exc)}
                        yield {"type": "tool", "name": fc.name, "status": "finished"}
                        response_parts.append(types.Part.from_function_response(name=fc.name, response=result))
                    contents.append(types.Content(role="user", parts=response_parts))
                    continue

                text = _extract_text(response)
                if text:
                    yield {"type": "delta", "text": text}
                yield {"type": "usage", "usage": cumulative}
                return

            try:
                with ProviderCall(params, "vertex_gemini", model, cumulative) as metered:
                    for chunk in client.models.generate_content_stream(model=model, contents=contents, config=config):
                        um = getattr(chunk, "usage_metadata", None)
                        if um is not None:
                            metered.usage = _usage_from_metadata(um)
                        text = _extract_text(chunk)
                        if text:
                            yield {"type": "delta", "text": text}
            except Exception as exc:
                raise GatewayError("provider_error", f"Vertex Gemini stream failed: {exc}") from exc

            yield {"type": "usage", "usage": cumulative}
            return
