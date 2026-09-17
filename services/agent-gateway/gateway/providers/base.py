"""The provider interface every adapter implements, plus the `get_provider`
factory. Normalizes only what the pipeline actually touches — send messages,
stream deltas, request structured output, run a bounded tool loop, report
token usage — deliberately not a general LLM framework (plan Part 1,
Principle 3).
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Callable, Iterator, Optional


@dataclass
class ModelMessage:
    role: str  # "user" | "assistant"
    content: str


@dataclass
class ModelResult:
    text: str
    structured: Optional[dict]
    usage: dict
    tool_calls: list = field(default_factory=list)
    # Model-generated thought summary (Gemini `include_thoughts`), captured for
    # the job trace only — never part of the answer text and never rendered
    # into any later prompt. None for providers/calls that don't surface one.
    thoughts: Optional[str] = None


class Provider(ABC):
    @abstractmethod
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
        """Runs one capability invocation to completion, including the bounded
        tool loop (max 8 calls / 60s cumulative, contract §10) when `tools`
        and `tool_runner` are both given. When `json_schema` is set, requests
        structured output and returns it as `.structured`; otherwise
        `.structured` is `None` and `.text` is the freeform answer.
        """

    @abstractmethod
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
        """Yields `{"type": "delta", "text": ...}`, `{"type": "tool", "name":
        ..., "status": "started" | "finished", "argsSummary": ...}`, and
        exactly one terminal `{"type": "usage", "usage": {...}}` event. Never
        yields `error` itself — a provider failure is raised as a
        `GatewayError`; the pipeline is what turns that into an SSE `error`
        event, since only it knows the stream's persistence obligations.
        """


def get_provider(name: str) -> "Provider":
    """Imports the concrete provider lazily so a missing/broken SDK only
    breaks the capability that needs it, not process boot — `/health` must
    still answer even if `google-genai` or `anthropic` fail to import.
    """
    if name == "vertex_gemini":
        from gateway.providers.vertex_gemini import VertexGeminiProvider

        return VertexGeminiProvider()
    if name == "anthropic_vertex":
        from gateway.providers.anthropic_vertex import AnthropicVertexProvider

        return AnthropicVertexProvider()
    if name == "anthropic_direct":
        from gateway.providers.anthropic_direct import AnthropicDirectProvider

        return AnthropicDirectProvider()

    from gateway.errors import GatewayError

    raise GatewayError("internal", f"Unknown provider: {name!r}")


def safe_json_loads(text: str) -> dict:
    """Structured-output responses are still delivered as text by both SDKs
    in the code paths that need custom parsing (Gemini's function-response
    fallback text, Claude's plain-JSON fallback when no schema tool is used);
    a model returning malformed JSON is a provider-shaped failure, not a
    pipeline bug, hence `provider_error` rather than an uncaught exception.
    """
    from gateway.errors import GatewayError

    try:
        return json.loads(text)
    except Exception as exc:
        raise GatewayError("provider_error", f"Model did not return valid JSON: {exc}") from exc


_USAGE_SUM_KEYS = (
    "inputTokens", "outputTokens", "cachedInputTokens", "cacheWriteInputTokens",
    "cacheWrite1hInputTokens", "calls", "latencyMs",
)


def empty_usage() -> dict:
    return {**{key: 0 for key in _USAGE_SUM_KEYS}, "thinkingTokens": 0,
            "thinkingTokensAvailable": True}


def add_usage(total: dict, part: dict) -> None:
    """Preserve unavailable thinking counts; zero would falsely claim no thinking."""
    for key in _USAGE_SUM_KEYS:
        total[key] = total.get(key, 0) + int(part.get(key, 0) or 0)
    available = total.get("thinkingTokensAvailable", True) and part.get("thinkingTokensAvailable", False)
    total["thinkingTokensAvailable"] = available
    total["thinkingTokens"] = (
        int(total.get("thinkingTokens", 0) or 0) + int(part.get("thinkingTokens", 0) or 0)
        if available else None
    )


def tool_limits(params: dict) -> tuple[int, float]:
    """Server-only limits; these keys must never reach SDK request options."""
    from gateway.errors import GatewayError
    calls = params.get("max_tool_calls", 8)
    seconds = params.get("max_tool_seconds", 60)
    if isinstance(calls, bool) or not isinstance(calls, int) or not 0 <= calls <= 120:
        raise GatewayError("internal", "max_tool_calls must be an integer in 0..120")
    if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not 0 < seconds <= 900:
        raise GatewayError("internal", "max_tool_seconds must be in (0, 900]")
    return calls, float(seconds)


def request_timeout(params: dict, deadline: float) -> float:
    """Bound the actual HTTP request by both the registry limit and stage time.

    SDK retries are disabled. No final request starts after the stage deadline.
    """
    import time
    from gateway.errors import GatewayError
    limit = params.get("request_timeout_seconds", 120)
    if isinstance(limit, bool) or not isinstance(limit, (int, float)) or not 0 < limit <= 120:
        raise GatewayError("internal", "request_timeout_seconds must be in (0, 120]")
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise GatewayError("provider_error", "Provider stage deadline exceeded")
    return min(float(limit), remaining)


class ProviderCall:
    """One SDK request, successful or failed. SDK automatic retries are disabled.

    `_usage_callback(event)` is an internal params callback, never serialized to
    a prompt or sent to a provider. Caller owns attribution and persistence.
    A failure after streamed usage retains the last observed usage snapshot.
    """
    def __init__(self, params: dict, provider: str, model: str, total: dict):
        self.params, self.provider, self.model, self.total = params, provider, model, total
        self.usage = {"thinkingTokens": None, "thinkingTokensAvailable": False}

    def __enter__(self):
        import time
        self.started = time.monotonic()
        return self

    def __exit__(self, exc_type, exc, tb):
        import time
        usage = dict(self.usage)
        usage["calls"] = 1
        usage["latencyMs"] = max(0, int((time.monotonic() - self.started) * 1000))
        add_usage(self.total, usage)
        callback = self.params.get("_usage_callback")
        if callback is not None:
            callback({"provider": self.provider, "model": self.model, "usage": usage,
                      "latencyMs": usage["latencyMs"], "outcome": "failed" if exc_type else "complete",
                      "callIndex": self.total["calls"]})
        return False
