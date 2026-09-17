"""Server-owned, athlete-confirmed coaching memory with source provenance.

The extractor can propose exact quotes from the current athlete turn. It cannot
activate memory, change the profile, write training plans, or make instructions.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import re

from google.cloud.firestore_v1.transaction import transactional

from gateway.authz import authorize_v3
from gateway.errors import GatewayError, invalid_request, permission_denied
from gateway.workout_persistence import _id

MAX_ACTIVE = 24
MAX_PROPOSED = 24
CATEGORIES = {"goal", "preference", "training_constraint"}
DEFAULT = {"schemaVersion": 1, "enabled": True, "revision": 0,
           "activeMemoryIds": [], "proposedMemoryIds": []}
_SENSITIVE = re.compile(r"(?i)\b(pain|hurt|injur\w*|asthma|diagnos\w*|medicat\w*|doctor|therap\w*|"
    r"depress\w*|anxiet\w*|anxious|mental|health|suicid\w*|abuse|sexual\w*|religio\w*|politic\w*|"
    r"password|secret|token|address|street|phone|email|school|weight|calori\w*|diet|allerg\w*|"
    r"ignore|instruction\w*|system|developer|prompt|assistant|override|forget|remember|"
    r"he|she|his|her|their|friend|teammate|coach\s+says)\b|https?://|@|\d{7,}")
_SELF = re.compile(r"(?i)\b(i\s+(?:want|prefer|like|love|enjoy|have|can|train|play|need|only|aim|"
    r"don't|do\s+not|would\s+like|am\s+working)|my\s+(?:goal|aim|preference))\b")
_NOT_MEMORY = re.compile(r"(?i)\b(today|tonight|this workout|this session|for now)\b")
_ATTRIBUTED_OR_PRIVATE = re.compile(r"(?i)\b(said|says|example|imagine|suppose|pretend|friend|teammate|"
    r"off the record|do not (?:save|store|remember)|don't (?:save|store|remember))\b|[\"“”]")


def now(inv):
    value = inv.context.get("now") or inv.context.get("_now")
    return value if isinstance(value, datetime) else datetime.now(timezone.utc)


def _time(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def ref(inv):
    return inv.player_ref().collection("coachWorkspace").document("current")


def records(inv):
    return inv.player_ref().collection("coachMemories")


def load(inv):
    snap = ref(inv).get()
    return {**deepcopy(DEFAULT), **(snap.to_dict() or {} if snap.exists else {})}


def _unexpired(memory, inv):
    expiry = _time(memory.get("expiresAt"))
    return expiry is not None and expiry > now(inv)


def _tombstone(mid, value, inv):
    return {"memoryId": mid, "status": "forgotten", "revision": int(value.get("revision", 0)) + 1, "updatedAt": now(inv)}


def snapshot(inv, workspace=None):
    workspace = workspace or load(inv)
    values = []
    ids = list(dict.fromkeys(workspace.get("activeMemoryIds", [])[:MAX_ACTIVE] + workspace.get("proposedMemoryIds", [])[:MAX_PROPOSED]))
    for mid in ids:
        snap = records(inv).document(_id(mid, "memoryId")).get()
        value = snap.to_dict() or {} if snap.exists else {}
        if value.get("status") not in ("active", "proposed") or not _unexpired(value, inv):
            continue
        fields = ("memoryId", "category", "text", "sourceQuote", "status", "revision", "sourceConversationId",
                  "sourceMessageId", "createdAt", "expiresAt")
        values.append({key: deepcopy(value[key]) for key in fields if key in value})
    return {"workspace": {key: workspace[key] for key in ("schemaVersion", "enabled", "revision")}, "memories": values}


def require_self(inv):
    if authorize_v3(inv) != "athlete":
        raise permission_denied("Only the athlete can manage their coach memory")


def action(inv, request):
    require_self(inv)
    if not isinstance(request, dict):
        raise invalid_request("memoryAction must be an object")
    kind = request.get("kind")
    allowed = {"list": {"kind"}, "confirm": {"kind", "memoryId", "expectedRevision"},
        "forget": {"kind", "memoryId", "expectedRevision"}, "forgetAll": {"kind", "expectedRevision"},
        "setEnabled": {"kind", "enabled", "expectedRevision"}}
    if kind not in allowed or set(request) != allowed[kind]:
        raise invalid_request("Invalid memory action fields")
    if kind == "list":
        return {**snapshot(inv), "actionResult": {"kind": kind, "status": "applied"}}
    expected = request.get("expectedRevision")
    if type(expected) is not int or expected < 0:
        raise invalid_request("expectedRevision must be the current workspace revision")
    if kind == "setEnabled" and type(request["enabled"]) is not bool:
        raise invalid_request("enabled must be a boolean")
    if kind in ("confirm", "forget"):
        _id(request.get("memoryId"), "memoryId")

    @transactional
    def commit(tx):
        if authorize_v3(inv, read=lambda value: list(value.stream(transaction=tx)) if hasattr(value, "stream") else value.get(transaction=tx)) != "athlete":
            raise permission_denied("Only the athlete can manage their coach memory")
        existing = ref(inv).get(transaction=tx)
        ws = {**deepcopy(DEFAULT), **(existing.to_dict() or {} if existing.exists else {})}
        if ws["revision"] != expected:
            raise GatewayError("validation_failed", "Coach memory changed. Refresh and try again.")
        indexed = list(dict.fromkeys(ws["activeMemoryIds"] + ws["proposedMemoryIds"]))
        indexed_records = {value: records(inv).document(value).get(transaction=tx).to_dict() or {} for value in indexed}
        active = [value for value in ws["activeMemoryIds"] if indexed_records[value].get("status") == "active" and _unexpired(indexed_records[value], inv)]
        proposed = [value for value in ws["proposedMemoryIds"] if indexed_records[value].get("status") == "proposed" and _unexpired(indexed_records[value], inv)]
        expired = set(indexed) - set(active + proposed)
        mid = request.get("memoryId")
        affected = indexed if kind == "forgetAll" else [mid] if mid else []
        loaded = {value: records(inv).document(value).get(transaction=tx).to_dict() or {} for value in affected}
        if kind == "confirm":
            memory = loaded[mid]
            if mid not in proposed or memory.get("status") != "proposed" or not _unexpired(memory, inv):
                raise GatewayError("validation_failed", "This memory suggestion is no longer available")
            if len(active) >= MAX_ACTIVE:
                raise GatewayError("validation_failed", "Keep up to 24 memories. Forget one before saving another.")
            proposed.remove(mid); active.append(mid)
            tx.update(records(inv).document(mid), {"status": "active", "revision": memory["revision"] + 1, "confirmedAt": now(inv)})
        elif kind in ("forget", "forgetAll"):
            if kind == "forget" and mid not in active + proposed:
                raise GatewayError("validation_failed", "This memory is no longer available")
            for value in affected:
                # A deterministic hash tombstone prevents unintentional recreation.
                # The remembered text/quote is removed rather than retained as audit.
                tx.set(records(inv).document(value), _tombstone(value, loaded[value], inv))
            active = [value for value in active if value not in affected]
            proposed = [value for value in proposed if value not in affected]
            ws["historyResetAt"] = now(inv)
        elif kind == "setEnabled":
            ws.update(enabled=request["enabled"], historyResetAt=now(inv))
        for value in expired - set(affected):
            tx.set(records(inv).document(value), _tombstone(value, indexed_records[value], inv))
        ws.update(activeMemoryIds=active, proposedMemoryIds=proposed, revision=expected + 1, updatedAt=now(inv))
        tx.set(ref(inv), ws)
    commit(inv.db.transaction())
    return {**snapshot(inv), "actionResult": {"kind": kind, "status": "applied"}}


def safe_candidate(value, message):
    if not isinstance(value, dict) or set(value) != {"category", "quote"} or value.get("category") not in CATEGORIES:
        return None
    quote = value.get("quote")
    if (not isinstance(quote, str) or not 10 <= len(quote) <= 240 or quote not in message
            or not _SELF.search(quote) or _SENSITIVE.search(quote) or _NOT_MEMORY.search(quote)
            or _ATTRIBUTED_OR_PRIVATE.search(message)):
        return None
    return {"category": value["category"], "text": quote, "sourceQuote": quote}


def propose(inv, candidates, *, message, conversation_id, message_id, expected_revision):
    require_self(inv)
    safe = [candidate for value in candidates[:2] if (candidate := safe_candidate(value, message))]
    if not safe:
        return snapshot(inv)
    candidates_by_id = {}
    for candidate in safe:
        identity = candidate["category"] + "\0" + " ".join(candidate["text"].casefold().split())
        mid = "m_" + hashlib.sha256(identity.encode()).hexdigest()[:32]
        candidates_by_id[mid] = candidate

    @transactional
    def commit(tx):
        if authorize_v3(inv, read=lambda value: list(value.stream(transaction=tx)) if hasattr(value, "stream") else value.get(transaction=tx)) != "athlete":
            raise permission_denied("Only athlete statements can become coach memory")
        existing = ref(inv).get(transaction=tx)
        ws = {**deepcopy(DEFAULT), **(existing.to_dict() or {} if existing.exists else {})}
        # Disable/forget during the provider call must win, never re-enable memory
        # or re-introduce a fact extracted against the previous workspace state.
        if not ws["enabled"] or ws["revision"] != expected_revision:
            return
        indexed = list(dict.fromkeys(ws["activeMemoryIds"] + ws["proposedMemoryIds"]))
        indexed_records = {mid: records(inv).document(mid).get(transaction=tx).to_dict() or {} for mid in indexed}
        seen = {mid: records(inv).document(mid).get(transaction=tx) for mid in candidates_by_id}
        ws["activeMemoryIds"] = [mid for mid in ws["activeMemoryIds"] if indexed_records[mid].get("status") == "active" and _unexpired(indexed_records[mid], inv)]
        ids = [mid for mid in ws["proposedMemoryIds"] if indexed_records[mid].get("status") == "proposed" and _unexpired(indexed_records[mid], inv)]
        expired = set(indexed) - set(ws["activeMemoryIds"] + ids)
        inserted = False
        for mid, candidate in candidates_by_id.items():
            if seen[mid].exists or len(ids) >= MAX_PROPOSED:
                continue
            tx.create(records(inv).document(mid), {**candidate, "memoryId": mid, "status": "proposed", "revision": 1,
                "sourceConversationId": conversation_id, "sourceMessageId": message_id,
                "createdAt": now(inv), "expiresAt": now(inv) + timedelta(days=180)})
            ids.append(mid); inserted = True
        for mid in expired:
            tx.set(records(inv).document(mid), _tombstone(mid, indexed_records[mid], inv))
        if inserted or expired:
            ws.update(proposedMemoryIds=ids, revision=ws["revision"] + 1, updatedAt=now(inv))
            tx.set(ref(inv), ws)
    commit(inv.db.transaction())
    return snapshot(inv)
