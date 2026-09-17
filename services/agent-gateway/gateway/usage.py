"""The usage ledger — the billing/attribution source of truth (contract §6;
plan Part 7). Every model call appends one `llmUsage/{autoId}` doc, and the
same map is echoed onto the job doc's `usage` field or the assistant
message's `usage` field by the caller.
"""

from __future__ import annotations

import os
import uuid
from typing import Optional

from gateway.providers.base import empty_usage, add_usage

from google.cloud import firestore


def record_usage(
    db,
    inv,
    *,
    provider: str,
    model: str,
    usage: dict,
    latency_ms: int,
    outcome: str,
    stage: Optional[str] = None,
    retry_index: int = 0,
    call_index: Optional[int] = None,
) -> dict:
    """Appends the ledger doc and returns the same map for the caller to echo
    onto the job doc / assistant message (contract §6's shape).

    `usage` is the provider-normalized `{"inputTokens", "outputTokens",
    "cachedInputTokens"}` map; missing/zero token counts (e.g. a call that
    failed before the model responded) are recorded as zeros rather than
    dropped, so the ledger entry always exists for the attempt.

    `stage` names which stage of a multi-stage capability made the call, so a
    chain's cost is attributable per stage instead of only in aggregate. It is
    omitted for single-stage capabilities, which is every capability today.
    """
    usage = usage or {}
    if not getattr(inv, "_usage_invocation_id", None):
        inv._usage_invocation_id = inv.job_id or uuid.uuid4().hex
    usage_map = {
        "invocationId": inv._usage_invocation_id,
        "capability": inv.capability,
        "provider": provider,
        "model": model,
        "playerId": inv.player_id,
        "requestedByUid": inv.uid,
        "jobId": inv.job_id,
        "conversationId": inv.conversation_id,
        "stage": stage,
        "inputTokens": int(usage.get("inputTokens", 0) or 0),
        "outputTokens": int(usage.get("outputTokens", 0) or 0),
        "cachedInputTokens": int(usage.get("cachedInputTokens", 0) or 0),
        "cacheWriteInputTokens": int(usage.get("cacheWriteInputTokens", 0) or 0),
        "cacheWrite1hInputTokens": int(usage.get("cacheWrite1hInputTokens", 0) or 0),
        "thinkingTokens": usage.get("thinkingTokens"),
        "thinkingTokensAvailable": bool(usage.get("thinkingTokensAvailable", False)),
        "outputIncludesThinking": usage.get("outputIncludesThinking", provider.startswith("anthropic")),
        "calls": int(usage.get("calls", 1)),
        "retryIndex": int(retry_index),
        "callIndex": call_index,
        "estimatedCostUsd": estimate_cost_usd(model, usage, provider=provider),
        "latencyMs": int(latency_ms),
        "outcome": outcome,
        "createdAt": firestore.SERVER_TIMESTAMP,
    }
    # jobId/conversationId are transport-exclusive (one is always None); drop
    # whichever doesn't apply instead of writing a stray null field.
    if usage_map["jobId"] is None:
        del usage_map["jobId"]
    if usage_map["conversationId"] is None:
        del usage_map["conversationId"]
    if usage_map["stage"] is None:
        del usage_map["stage"]

    if call_index is None:
        del usage_map["callIndex"]
    db.collection("llmUsage").document().set(usage_map)
    return usage_map


def record_code_usage(db, inv, *, operation_id: str) -> dict:
    """Meter a successful pure-code operation once, including transport retries.

    A deterministic create-only ledger ID lets a retry repair a post-commit
    ledger failure without adding another quota charge. No provider call or
    token spend is attributed to a deterministic Apply.
    """
    import hashlib
    from google.api_core.exceptions import AlreadyExists
    identity = "\0".join((inv.uid, inv.capability, operation_id))
    ref = db.collection("llmUsage").document("code_" + hashlib.sha256(identity.encode()).hexdigest())
    previous = ref.get()
    if previous.exists:
        return previous.to_dict()
    row = {
        "invocationId": operation_id, "capability": inv.capability,
        "provider": "code", "model": "code", "playerId": inv.player_id,
        "requestedByUid": inv.uid, "stage": "apply_workout_draft",
        "inputTokens": 0, "outputTokens": 0, "cachedInputTokens": 0,
        "cacheWriteInputTokens": 0, "cacheWrite1hInputTokens": 0,
        "thinkingTokens": None, "thinkingTokensAvailable": False,
        "outputIncludesThinking": False, "calls": 0, "retryIndex": 0,
        "estimatedCostUsd": 0.0, "latencyMs": 0, "outcome": "ok",
        "createdAt": firestore.SERVER_TIMESTAMP,
    }
    if inv.job_id:
        row["jobId"] = inv.job_id
    try:
        ref.create(row)
    except AlreadyExists:
        return ref.get().to_dict()
    return row


# USD per million text tokens, standard on-demand, verified 2026-09-06.
# https://cloud.google.com/vertex-ai/generative-ai/pricing
# Anthropic regional endpoint multiplier: 1.10; global endpoint uses base.
# Estimates exclude storage/grounding/discounts; no price guessed for other models.
_PRICE_BASE = {
    "gemini-2.5-flash": (0.30, 2.50, 0.03),
    "gemini-2.5-flash-lite": (0.10, 0.40, 0.01),
    "claude-sonnet-4-6": (3.00, 15.00, 0.30),
    "claude-sonnet-4-5": (3.00, 15.00, 0.30),
    "claude-sonnet-4-5@20250929": (3.00, 15.00, 0.30),
    "claude-haiku-4-5@20251001": (1.00, 5.00, 0.10),
}


def estimate_cost_usd(model: str, usage: dict, region: Optional[str] = None,
                      provider: Optional[str] = None) -> Optional[float]:
    """Provider-normalized input includes cached tokens; avoid counting twice.

    Gemini output excludes thoughts, so add them. Claude includes them in output,
    and may expose a separate breakdown on newer providers. This is an estimate, not an invoice.
    """
    rates = _PRICE_BASE.get(model)
    if rates is None:
        return None
    inp, out, cache = rates
    is_claude = model.startswith("claude-")
    # Only first-party requests omit Vertex's regional premium. Legacy callers
    # without a provider retain the existing Vertex accounting behavior.
    vertex_claude = is_claude and provider in (None, "anthropic_vertex")
    if vertex_claude and (region or os.getenv("VERTEX_LOCATION", "us-central1")) != "global":
        inp, out, cache = inp * 1.10, out * 1.10, cache * 1.10
    if model in ("claude-sonnet-4-5", "claude-sonnet-4-5@20250929") and int(usage.get("inputTokens", 0) or 0) > 200000:
        inp, out, cache = inp * 2, out * 1.5, cache * 2
    read = int(usage.get("cachedInputTokens", 0) or 0)
    write = int(usage.get("cacheWriteInputTokens", 0) or 0)
    hour_write = min(write, int(usage.get("cacheWrite1hInputTokens", 0) or 0))
    ordinary = max(0, int(usage.get("inputTokens", 0) or 0) - read - write)
    output = int(usage.get("outputTokens", 0) or 0)
    if not usage.get("outputIncludesThinking", is_claude):
        output += int(usage.get("thinkingTokens", 0) or 0)
    return round((ordinary * inp + read * cache + (write - hour_write) * inp * 1.25
                  + hour_write * inp * 2 + output * out) / 1_000_000, 9)


def make_usage_callback(inv, *, provider: str, model: str, stage: Optional[str] = None,
                        retry_index: int = 0):
    """Return callback with `.records` for this attempt; all calls also on inv.

    Stored outside inv.context so metering data never expands model prompts.
    The pipeline must NOT append a second aggregate ledger row for these calls.
    """
    records = []
    if not hasattr(inv, "_provider_usage_records"):
        inv._provider_usage_records = []

    def callback(event: dict):
        row = record_usage(inv.db, inv, provider=provider, model=model,
                           usage=event.get("usage") or {}, latency_ms=event.get("latencyMs", 0),
                           outcome=event.get("outcome", "complete"), stage=stage,
                           retry_index=retry_index, call_index=event.get("callIndex"))
        records.append(row)
        inv._provider_usage_records.append(row)
    callback.records = records
    return callback


def aggregate_usage(records: list[dict]) -> dict:
    total = empty_usage()
    for row in records:
        add_usage(total, row)
    total["estimatedCostUsd"] = (
        round(sum(r["estimatedCostUsd"] for r in records), 9)
        if all(r.get("estimatedCostUsd") is not None for r in records) else None
    )
    total["retries"] = (len({(r.get("stage"), r.get("retryIndex")) for r in records if r.get("retryIndex", 0) > 0})
                        + sum(int(r.get("retries", 0)) for r in records if "retryIndex" not in r))
    return total
