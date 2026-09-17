"""Deterministic fault pre-screen — evaluates the research corpus's fault signatures against a
computed kick analysis, in pure Python (KICK_ANALYSIS_V2_PLAN decision 8).

The point is division of labour. Deciding *whether a number crosses a documented threshold* is
arithmetic, and the model was demonstrably bad at it (it inverted signs on 3/3 mirrored production
reps). Deciding *whether a firing threshold actually means this athlete has this fault, given
everything else in the clip* is judgment, which is what the model is for. So this module fires
candidates and the observe stage confirms, rejects, or adds to them — it never writes coaching.

Signature grammar (JSON, in `knowledge/kick_fault_cue_map.json`):

    "signature": {
      "all": [
        {"metricId": "contact.plant_foot_ball_offset_x.support",
         "field": "athlete" | "pro" | "delta" | "athleteMeters" | "deltaMeters",
         "op": "gt" | "lt" | "gte" | "lte" | "absGt" | "absLt",
         "value": 0.05},
        {"event": "proximalToDistalOrderOK", "op": "isFalse"},
        {"event": "peakShankAngularVel.degPerS", "op": "lt", "value": 1000}
      ]
    }

Every condition in `all` must hold for the family to fire. A condition whose metric row is
missing or `valid: false`, or whose event path is absent, makes the family **not fire** and is
recorded in `unevaluated` — never silently treated as false, so a data gap is visible rather
than looking like a clean bill of health.
"""

from __future__ import annotations

from typing import Any, Optional

_METRIC_FIELDS = ("athlete", "pro", "delta", "athleteMeters", "proMeters", "deltaMeters")


def _num(v: Any) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return float(v)


def _dig(obj: Any, path: str) -> Any:
    """Dotted lookup into the events block, e.g. 'peakShankAngularVel.degPerS'."""
    cur = obj
    for part in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def _compare(actual: float, op: str, expected: Optional[float]) -> Optional[bool]:
    if op in ("isTrue", "isFalse"):
        return None
    if expected is None:
        return None
    if op == "gt":
        return actual > expected
    if op == "lt":
        return actual < expected
    if op == "gte":
        return actual >= expected
    if op == "lte":
        return actual <= expected
    if op == "absGt":
        return abs(actual) > expected
    if op == "absLt":
        return abs(actual) < expected
    return None


def _evaluate_condition(cond: dict, rows: dict[str, dict],
                        events: dict) -> tuple[Optional[bool], Optional[str]]:
    """(result, reason-unevaluated). result None means "could not evaluate"."""
    op = cond.get("op")

    metric_id = cond.get("metricId")
    if metric_id:
        row = rows.get(metric_id)
        if row is None:
            return None, f"metric '{metric_id}' is not in the table"
        if row.get("valid") is not True:
            return None, f"metric '{metric_id}' is invalid for this rep"
        field = cond.get("field", "delta")
        if field not in _METRIC_FIELDS:
            return None, f"condition names unknown field '{field}'"
        actual = _num(row.get(field))
        if actual is None:
            return None, f"metric '{metric_id}' has no {field} value"
        result = _compare(actual, op, _num(cond.get("value")))
        if result is None:
            return None, f"condition on '{metric_id}' has an unusable operator/value"
        return result, None

    event_path = cond.get("event")
    if event_path:
        raw = _dig(events, event_path)
        if raw is None:
            return None, f"event '{event_path}' was not computable for this rep"
        if op == "isTrue":
            return raw is True, None
        if op == "isFalse":
            return raw is False, None
        actual = _num(raw)
        if actual is None:
            return None, f"event '{event_path}' is not numeric"
        result = _compare(actual, op, _num(cond.get("value")))
        if result is None:
            return None, f"condition on '{event_path}' has an unusable operator/value"
        return result, None

    return None, "condition names neither a metricId nor an event"


def screen_faults(computed: dict, families: list[dict]) -> dict:
    """Runs every family's signature against a `compute_kick_analysis` result.

    Returns `{"candidates": [...], "unevaluated": [...], "screened": n}` where each candidate
    carries the family's id/name/why/cues plus the evidence rows that made it fire, ready to
    drop into the observe stage's context.
    """
    from gateway.kick_evidence import evidence_rows
    rows = {r.get("id"): r for r in evidence_rows(computed) if isinstance(r, dict)}
    event_block = (computed.get("jointAngleSequencing") or {}).get("events") or {}
    events = dict(event_block.get("athlete") or {})
    for name, quality in (event_block.get("quality") or {}).items():
        if quality.get("eligible") is False:
            events[name] = None
            if name in ("peakThighAngularVel", "peakShankAngularVel"):
                events["proximalToDistalOrderOK"] = None
    quality = computed.get("dataQuality") or {}
    if quality.get("sideConfidence") == "low":
        events = {}
    elif quality.get("fpsSource") == "assumed":
        for name in ("peakThighAngularVel", "peakShankAngularVel", "proximalToDistalOrderOK", "kickFootSpeedJustBeforeContact"):
            events.pop(name, None)

    candidates: list[dict] = []
    unevaluated: list[dict] = []

    for family in families:
        conditions = (family.get("signature") or {}).get("all") or []
        if not conditions:
            continue
        fired = True
        blockers: list[str] = []
        evidence: list[dict] = []
        for cond in conditions:
            result, reason = _evaluate_condition(cond, rows, events)
            if result is None:
                fired = False
                blockers.append(reason or "unevaluable condition")
                continue
            if not result:
                fired = False
                continue
            metric_id = cond.get("metricId")
            if metric_id and metric_id in rows:
                row = rows[metric_id]
                evidence.append({
                    "metricId": metric_id,
                    "athlete": row.get("athlete"),
                    "pro": row.get("pro"),
                    "delta": row.get("delta"),
                    "units": row.get("units"),
                })
            elif cond.get("event"):
                evidence.append({"event": cond["event"], "value": _dig(events, cond["event"])})

        if blockers:
            unevaluated.append({"faultId": family.get("id"), "reasons": blockers})
        elif fired:
            candidates.append({
                "faultId": family.get("id"),
                "name": family.get("name"),
                "bodyRegion": family.get("bodyRegion"),
                "frameKey": family.get("frameKey"),
                "why": family.get("why"),
                "cueFamily": family.get("cues") or [],
                "evidence": evidence,
            })

    return {
        "candidates": candidates,
        "unevaluated": unevaluated,
        "screened": len(families),
    }
