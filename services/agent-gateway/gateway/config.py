"""`config/llm` kill switch + per-user daily quota (contract §11; plan Part 7).

A missing `config/llm` doc must not brick the product — everything defaults to
enabled with the registry's own `daily_limit`s. `globalEnabled: false` is the
one setting that must reliably kill the whole surface even if the rest of the
doc is stale or partially written, which is why it's checked before anything
per-capability.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import time
import uuid
from typing import Optional

from gateway.errors import GatewayError
from gateway.registry import get_capability

_CACHE_TTL_SECONDS = 30

# Module-level cache: one process serves many requests, and `config/llm` reads
# on *every* invocation per the contract, so an in-process TTL cache is the
# difference between one Firestore read per 30s and one per request.
_cache: dict = {"doc": None, "loaded_at": 0.0}

_DEFAULT_CONFIG = {
    "globalEnabled": True,
    "minClientVersion": None,
    "capabilities": {},
}


def load_llm_config(db) -> dict:
    now = time.monotonic()
    if _cache["doc"] is not None and (now - _cache["loaded_at"]) < _CACHE_TTL_SECONDS:
        return _cache["doc"]

    cfg = dict(_DEFAULT_CONFIG)
    try:
        snap = db.collection("config").document("llm").get()
        if snap.exists:
            data = snap.to_dict() or {}
            merged = dict(_DEFAULT_CONFIG)
            merged.update(data)
            merged["capabilities"] = data.get("capabilities") or {}
            cfg = merged
    except Exception:
        # A Firestore hiccup shouldn't 500 every request until it recovers —
        # fall back to the safe (fully enabled) default and let the next
        # cache expiry try again.
        cfg = dict(_DEFAULT_CONFIG)

    _cache["doc"] = cfg
    _cache["loaded_at"] = now
    return cfg


def capability_enabled(cfg: dict, capability: str) -> bool:
    if not cfg.get("globalEnabled", True):
        return False
    entry = (cfg.get("capabilities") or {}).get(capability)
    if entry is None:
        return True
    return bool(entry.get("enabled", True))


def v3_capability_enabled(cfg: dict, capability: str) -> bool:
    """New v3 routes require an explicit positive quota and literal enablement.

    This deliberately leaves legacy missing-entry and zero-limit semantics
    unchanged. A missing/stale config can never activate the new write surface.
    """
    capabilities = cfg.get("capabilities")
    entry = capabilities.get(capability) if isinstance(capabilities, dict) else None
    if not cfg.get("globalEnabled", True) or not isinstance(entry, dict):
        return False
    from gateway.personalized_access import CAPABILITIES
    policy = entry.get('dailyLimitPolicy')
    if capability in CAPABILITIES and policy is not None:
        return entry.get('enabled') is True and policy == 'unlimited'
    limit = entry.get("dailyLimitPerUser")
    return entry.get("enabled") is True and type(limit) is int and limit > 0


def _daily_limit(cfg: dict, capability: str) -> int:
    entry = (cfg.get("capabilities") or {}).get(capability) or {}
    override = entry.get("dailyLimitPerUser")
    if isinstance(override, int) and override >= 0:
        return override
    return get_capability(capability).daily_limit


def check_quota(db, cfg: dict, uid: str, capability: str, *, invocation_id: Optional[str] = None) -> None:
    """Counts distinct invocations from `llmUsage` docs for `(uid, capability)` since UTC midnight and
    compares against the effective daily limit. Provider subturns and retries share an invocation ID and count once.

    Note: this query (two equality filters + a range filter on `createdAt`)
    needs a composite index in Firestore; see the README.
    """
    from gateway.personalized_access import CAPABILITIES
    if capability in CAPABILITIES and ((cfg.get('capabilities') or {}).get(capability) or {}).get('dailyLimitPolicy') == 'unlimited':
        return
    limit = _daily_limit(cfg, capability)
    if limit <= 0:
        return  # explicit 0/negative override = unlimited; not used by any registry entry today

    midnight = dt.datetime.now(dt.timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    query = (
        db.collection("llmUsage")
        .where("requestedByUid", "==", uid)
        .where("capability", "==", capability)
        .where("createdAt", ">=", midnight)
    )

    # The ledger has one row per provider subturn/retry, whereas the product
    # limit is per invocation. Count distinct calls to the capability so a
    # 48-workout plan does not consume the user's entire daily plan allowance.
    # Legacy job rows can be grouped by jobId; old chat rows lack turn IDs and
    # conservatively remain individual invocations. conversationId is NOT a
    # turn identity (a conversation contains many turns).
    invocation_ids = set()
    for snap in query.stream():
        row = snap.to_dict() or {}
        invocation_ids.add(row.get("invocationId") or row.get("jobId") or snap.id)
    # An already metered immutable Apply may return its stored result at the
    # daily limit. The policy shell supplies this ID only after authorization.
    if invocation_id is not None and invocation_id in invocation_ids:
        return
    count = len(invocation_ids)

    if count >= limit:
        raise GatewayError("quota_exceeded", f"Daily limit of {limit} reached for '{capability}'")


def _parse_version(version: str) -> tuple:
    parts = []
    for piece in version.split("+")[0].split("."):
        try:
            parts.append(int(piece))
        except ValueError:
            parts.append(0)
    return tuple(parts)


def check_client_version(cfg: dict, client_version: Optional[str]) -> None:
    """`clientVersion` is `CFBundleShortVersionString+build` (contract §2);
    only the dotted version prefix is compared against `minClientVersion`.
    """
    min_version = cfg.get("minClientVersion")
    if not min_version:
        return
    if not client_version:
        raise GatewayError("client_too_old", "Client did not send a clientVersion")
    if _parse_version(client_version) < _parse_version(min_version):
        raise GatewayError(
            "client_too_old", f"Client version {client_version} is below minimum {min_version}"
        )


# Product allowances cannot be raised by a stale deployment config. Legacy
# workout requests share the adjustment bucket so an old client cannot evade it.
DAILY_ALLOWANCES = {
    "generate_training_plan": ("program", 1, ("generate_training_plan",)),
    "workout_chat": ("adjustment", 3, ("workout_chat", "build_workout")),
    "build_workout": ("adjustment", 3, ("workout_chat", "build_workout")),
}


def reserve_daily_allowance(inv, *, now=None):
    """Atomically admit one request, once per invocation, across devices.

    Called only after authorization/configuration, and never for trusted admins.
    The usage ledger still accounts for individual provider calls. This small
    server-only document reserves the allowance before those calls start, closing
    the race where simultaneous requests both saw yesterday's ledger count.
    A submitted request uses a slot even if the provider later fails; a retry of
    the same durable job ID uses its existing slot. Days reset at UTC midnight,
    matching the existing daily-quota contract.
    """
    policy = DAILY_ALLOWANCES.get(inv.capability)
    if policy is None:
        return
    from google.cloud import firestore
    from google.cloud.firestore_v1.transaction import transactional

    bucket, limit, capabilities = policy
    current = now or dt.datetime.now(dt.timezone.utc)
    midnight = current.astimezone(dt.timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    day = midnight.date().isoformat()
    invocation_id = getattr(inv, "_usage_invocation_id", None) or inv.job_id or uuid.uuid4().hex
    inv._usage_invocation_id = invocation_id
    key = hashlib.sha256((inv.uid + "\0" + bucket + "\0" + day).encode()).hexdigest()
    ref = inv.db.collection("llmDailyAllowances").document(key)

    @transactional
    def reserve(tx):
        snapshot = ref.get(transaction=tx)
        data = snapshot.to_dict() or {}
        used = set(data.get("invocationIds") or [])
        # On first use, import today's prior ledger calls so rollout does not
        # grant an extra allowance. Subsequent admissions serialize on this doc.
        if not snapshot.exists:
            for capability in capabilities:
                query = (inv.db.collection("llmUsage")
                    .where("requestedByUid", "==", inv.uid)
                    .where("capability", "==", capability)
                    .where("createdAt", ">=", midnight))
                for row in query.stream(transaction=tx):
                    value = row.to_dict() or {}
                    used.add(value.get("invocationId") or value.get("jobId") or row.id)
        if invocation_id in used:
            return
        if len(used) >= limit:
            label = "individualized program build" if bucket == "program" else "workout adjustment requests"
            raise GatewayError("quota_exceeded", f"You've used your {limit} daily {label}. Your allowance resets at midnight UTC.")
        used.add(invocation_id)
        tx.set(ref, {"requestedByUid": inv.uid, "day": day, "bucket": bucket,
                     "invocationIds": sorted(used), "updatedAt": firestore.SERVER_TIMESTAMP})

    reserve(inv.db.transaction())
