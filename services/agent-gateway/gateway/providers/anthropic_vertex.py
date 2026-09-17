"""Claude via Vertex AI, using the `anthropic` SDK's `AnthropicVertex` client
(`from anthropic import AnthropicVertex`). Authenticates purely through the
Cloud Run service account's ADC — no Anthropic API key.

Available per capability (plan Part 6's report-generation bake-off candidate)
but not wired into any `REGISTRY` entry by default; Gemini is the platform's
fixed default provider (plan's fixed constraint 1). Every SDK symbol is
imported inside a function so a missing/broken `anthropic` install only
breaks the first call that needs it.
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

_DEFAULT_MAX_TOKENS = 1024
# Anthropic's floor for extended thinking; `max_tokens` must also exceed it.
_MIN_THINKING_BUDGET = 1024

# Claude has no native "structured output" mode. The standard workaround —
# used here rather than parsing free text — is to force a single tool call
# whose input_schema *is* the desired JSON schema, then read the call's
# input back out; Claude's tool-use argument generation is schema-constrained
# the same way native structured output is on other providers.
_STRUCTURED_TOOL_NAME = "emit_result"


def _client():
    try:
        from anthropic import AnthropicVertex
    except ImportError as exc:  # pragma: no cover - exercised only when the SDK is missing
        raise GatewayError("provider_error", f"anthropic[vertex] is not available: {exc}") from exc

    project = os.environ.get("GCP_PROJECT")
    region = os.environ.get("VERTEX_LOCATION", "us-central1")
    if not project:
        raise GatewayError("provider_error", "GCP_PROJECT is not configured")
    return AnthropicVertex(project_id=project, region=region, max_retries=0, timeout=120)


def _usage_from_response(usage) -> dict:
    # output_tokens includes thinking. Newer SDK/provider versions may expose
    # a separate raw-thinking breakdown; preserve null when Vertex omits it.
    # input_tokens excludes cache reads/writes; normalize total input consistently.
    read = int(getattr(usage, "cache_read_input_tokens", 0) or 0)
    write = int(getattr(usage, "cache_creation_input_tokens", 0) or 0)
    cache = getattr(usage, "cache_creation", None)
    details = getattr(usage, "output_tokens_details", None)
    thoughts = details.get("thinking_tokens") if isinstance(details, dict) else getattr(details, "thinking_tokens", None)
    return {
        "inputTokens": int(getattr(usage, "input_tokens", 0) or 0) + read + write,
        "outputTokens": int(getattr(usage, "output_tokens", 0) or 0),
        "cachedInputTokens": read, "cacheWriteInputTokens": write,
        "cacheWrite1hInputTokens": int(getattr(cache, "ephemeral_1h_input_tokens", 0) or 0),
        "thinkingTokens": int(thoughts) if thoughts is not None else None,
        "thinkingTokensAvailable": thoughts is not None,
        "outputIncludesThinking": True,
    }


def _add(cumulative: dict, usage: dict) -> None:
    add_usage(cumulative, usage)


def _to_anthropic_messages(messages: list[ModelMessage]) -> list[dict]:
    return [{"role": "assistant" if m.role == "assistant" else "user", "content": m.content} for m in messages]


def _to_anthropic_tools(tool_specs: list[dict]) -> list[dict]:
    return [
        {
            "name": spec["name"],
            "description": spec.get("description", ""),
            "input_schema": spec.get("parameters") or {"type": "object", "properties": {}},
        }
        for spec in tool_specs
    ]


def _summarize_args(args: dict) -> str:
    try:
        return json.dumps(args)[:200]
    except Exception:
        return str(args)[:200]


def _text_of(content_blocks) -> str:
    return "".join(getattr(b, "text", "") or "" for b in content_blocks if getattr(b, "type", None) == "text")


def _sampling_kwargs(params: dict, *, forced_tool_use: bool) -> dict:
    """Builds the `max_tokens` / `temperature` / `thinking` slice of a
    `messages.create()` call from the registry's `params`. Pure — no SDK — so
    the constraint handling below is unit-tested.

    Translation of the provider-neutral `thinking_budget` (see the
    `CapabilitySpec.params` comment in registry.py): absent or `0` means send
    no `thinking` param, which is Claude's default anyway; a positive value
    becomes `{"type": "enabled", "budget_tokens": N}`. `-1` (Gemini's "pick a
    dynamic budget") has no Claude equivalent and is rejected rather than
    guessed at.

    Two Anthropic constraints are enforced here instead of being discovered as
    a 400 from Vertex, since either one means a miswired registry entry:
    `budget_tokens` >= 1024, and `max_tokens` strictly greater than it. Both
    raise `internal` — a registry entry is code, so this is a code bug.
    """
    max_tokens = params.get("max_output_tokens") or _DEFAULT_MAX_TOKENS
    kwargs: dict = {"max_tokens": max_tokens}
    budget = params.get("thinking_budget")

    if isinstance(budget, bool) or not isinstance(budget, (int, type(None))):
        raise GatewayError("internal", f"Invalid thinking_budget in registry params: {budget!r}")

    # No budget, or an explicit 0, is just Claude's default — send nothing.
    #
    # The second half of this condition is the interesting one: extended
    # thinking is incompatible with a forced `tool_choice: {"type": "tool"}`,
    # which is exactly how generate() gets structured output out of a model
    # with no JSON mode. Thinking is dropped for that request rather than
    # structured output being weakened — combining them needs the
    # auto-tool_choice + "call emit_result when you're done" prompt pattern,
    # a different and unvalidated shape for the report path. Out of scope;
    # streaming and auto tool use still get thinking.
    if not budget or forced_tool_use:
        if params.get("temperature") is not None:
            kwargs["temperature"] = params["temperature"]
        return kwargs

    if budget < _MIN_THINKING_BUDGET:
        raise GatewayError(
            "internal",
            f"thinking_budget must be >= {_MIN_THINKING_BUDGET} for Claude (got {budget})",
        )
    if max_tokens <= budget:
        raise GatewayError(
            "internal",
            f"max_output_tokens ({max_tokens}) must exceed thinking_budget ({budget}) for Claude",
        )

    kwargs["thinking"] = {"type": "enabled", "budget_tokens": budget}
    # Claude rejects a temperature other than 1 while thinking. A spec setting
    # both is choosing thinking, so temperature is dropped rather than clamped.
    return kwargs


def _sdk_kwargs(method, kwargs: dict) -> dict:
    """Keep legacy model sampling controls across SDK 1.x signature changes.

    Anthropic SDK 1.4 removed temperature from typed create/stream signatures,
    while capped Sonnet 4.6 still accepts it in the Messages API request body.
    The SDK's documented extra_body escape hatch preserves the registry knob.
    Old SDKs keep the native typed keyword; no trial request/retry is needed.
    """
    import inspect
    out = dict(kwargs)
    signature = inspect.signature(method)
    if ("temperature" in out and "temperature" not in signature.parameters
            and not any(p.kind is inspect.Parameter.VAR_KEYWORD for p in signature.parameters.values())):
        out["extra_body"] = {**out.get("extra_body", {}), "temperature": out.pop("temperature")}
    return out


class AnthropicVertexProvider(Provider):
    # `name` is what the usage ledger records and `label` what errors say. The
    # first-party adapter (anthropic_direct.py) subclasses this and overrides
    # only these two and the client factory: everything after the client is
    # constructed is the same `messages.create` surface on both endpoints.
    name = "anthropic_vertex"
    label = "Anthropic Vertex"

    def _make_client(self):
        return _client()

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
        client = self._make_client()
        anthropic_messages = _to_anthropic_messages(messages)
        anthropic_tools = _to_anthropic_tools(tools) if tools else []
        tool_choice = None

        if json_schema is not None:
            anthropic_tools = anthropic_tools + [
                {
                    "name": _STRUCTURED_TOOL_NAME,
                    "description": "Emit the final structured result.",
                    "input_schema": json_schema,
                }
            ]
            tool_choice = {"type": "tool", "name": _STRUCTURED_TOOL_NAME}

        max_calls, max_seconds = tool_limits(params)
        deadline = time.monotonic() + max_seconds
        calls_made = 0
        cumulative = empty_usage()
        tool_calls_log: list[dict] = []

        while True:
            if calls_made >= max_calls or time.monotonic() >= deadline:
                anthropic_tools = [t for t in anthropic_tools if t["name"] == _STRUCTURED_TOOL_NAME]
            kwargs = {
                "model": model,
                "timeout": request_timeout(params, deadline),
                "system": system,
                "messages": anthropic_messages,
                **_sampling_kwargs(params, forced_tool_use=tool_choice is not None),
            }
            if anthropic_tools:
                kwargs["tools"] = anthropic_tools
            if tool_choice:
                kwargs["tool_choice"] = tool_choice

            try:
                with ProviderCall(params, self.name, model, cumulative) as metered:
                    response = client.messages.create(**_sdk_kwargs(client.messages.create, kwargs))
                    metered.usage = _usage_from_response(getattr(response, "usage", None))
            except Exception as exc:
                raise GatewayError("provider_error", f"{self.label} call failed: {exc}") from exc

            tool_blocks = [b for b in response.content if getattr(b, "type", None) == "tool_use"]
            structured_block = next((b for b in tool_blocks if b.name == _STRUCTURED_TOOL_NAME), None)
            if structured_block is not None:
                return ModelResult(
                    text=_text_of(response.content),
                    structured=dict(structured_block.input or {}),
                    usage=cumulative,
                    tool_calls=tool_calls_log,
                )

            real_tool_calls = [b for b in tool_blocks if b.name != _STRUCTURED_TOOL_NAME]
            if not real_tool_calls or not tool_runner:
                text = _text_of(response.content)
                structured = safe_json_loads(text) if json_schema is not None else None
                return ModelResult(text=text, structured=structured, usage=cumulative, tool_calls=tool_calls_log)

            if not anthropic_tools:
                raise GatewayError("provider_error", "Model requested tools after the tool budget was exhausted")

            # The whole `content` goes back verbatim, not just the tool_use
            # blocks: with thinking enabled the API requires the thinking
            # blocks of a tool-use turn be replayed unmodified.
            anthropic_messages.append({"role": "assistant", "content": response.content})
            tool_results = []
            for b in real_tool_calls:
                args = dict(b.input or {})
                tool_calls_log.append({"name": b.name, "argsSummary": _summarize_args(args)})
                if calls_made >= max_calls or time.monotonic() >= deadline:
                    result = {"error": "tool_budget_exhausted"}
                else:
                    calls_made += 1
                    try:
                        result = tool_runner(b.name, args)
                    except GatewayError:
                        raise
                    except Exception as exc:
                        result = {"error": str(exc)}
                tool_results.append({"type": "tool_result", "tool_use_id": b.id, "content": json.dumps(result)})
            anthropic_messages.append({"role": "user", "content": tool_results})

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
        """Same probe-then-stream trade as the Gemini adapter (see its
        `stream()` docstring): tool turns run as one non-streaming call each;
        only the final, tool-free turn streams token deltas.
        """
        client = self._make_client()
        anthropic_messages = _to_anthropic_messages(messages)
        anthropic_tools = _to_anthropic_tools(tools) if tools else []

        max_calls, max_seconds = tool_limits(params)
        deadline = time.monotonic() + max_seconds
        calls_made = 0
        cumulative = empty_usage()

        while True:
            use_tools = bool(anthropic_tools) and tool_runner and calls_made < max_calls and time.monotonic() < deadline
            base_kwargs = {
                "model": model,
                "timeout": request_timeout(params, deadline),
                "system": system,
                "messages": anthropic_messages,
                # Never a forced tool_choice on this path — stream() only ever
                # uses auto tool use, which thinking is compatible with.
                **_sampling_kwargs(params, forced_tool_use=False),
            }

            if use_tools:
                try:
                    with ProviderCall(params, self.name, model, cumulative) as metered:
                        response = client.messages.create(**_sdk_kwargs(client.messages.create, {**base_kwargs, "tools": anthropic_tools}))
                        metered.usage = _usage_from_response(getattr(response, "usage", None))
                except Exception as exc:
                    raise GatewayError("provider_error", f"{self.label} call failed: {exc}") from exc

                tool_blocks = [b for b in response.content if getattr(b, "type", None) == "tool_use"]
                if tool_blocks:
                    anthropic_messages.append({"role": "assistant", "content": response.content})
                    tool_results = []
                    for b in tool_blocks:
                        args = dict(b.input or {})
                        yield {"type": "tool", "name": b.name, "status": "started", "argsSummary": _summarize_args(args)}
                        if calls_made >= max_calls or time.monotonic() >= deadline:
                            result = {"error": "tool_budget_exhausted"}
                        else:
                            calls_made += 1
                            try:
                                result = tool_runner(b.name, args)
                            except GatewayError:
                                raise
                            except Exception as exc:
                                result = {"error": str(exc)}
                        yield {"type": "tool", "name": b.name, "status": "finished"}
                        tool_results.append({"type": "tool_result", "tool_use_id": b.id, "content": json.dumps(result)})
                    anthropic_messages.append({"role": "user", "content": tool_results})
                    continue

                text = _text_of(response.content)
                if text:
                    yield {"type": "delta", "text": text}
                yield {"type": "usage", "usage": cumulative}
                return

            try:
                with ProviderCall(params, self.name, model, cumulative) as metered:
                    with client.messages.stream(**_sdk_kwargs(client.messages.stream, base_kwargs)) as stream:
                        for text in stream.text_stream:
                            if text:
                                yield {"type": "delta", "text": text}
                        final = stream.get_final_message()
                        metered.usage = _usage_from_response(getattr(final, "usage", None))
            except Exception as exc:
                raise GatewayError("provider_error", f"{self.label} stream failed: {exc}") from exc

            yield {"type": "usage", "usage": cumulative}
            return
