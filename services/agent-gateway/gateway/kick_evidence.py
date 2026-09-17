"""Versioned, source-addressable kick evidence and bounded investigative tools.

Eligibility here concerns measurement support, never whether a technique is good.
The model and expert reviewers retain judgment over the supplied facts.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
from typing import Any

from gateway.errors import invalid_request

VERSION = "kick-evidence-v1"
PHASES = ("backswing", "contact", "followThrough")
MAX_DETAIL_SAMPLES = 120
MAX_INSPECTED_EVIDENCE_BYTES = 200_000
_REFERENCE_DEPENDENT = {"foot_com_vs_pro"}


def number(value: Any) -> bool:
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     allow_nan=False, default=str).encode()).hexdigest()


def _reasons(context: dict, row: dict) -> list[str]:
    quality = context.get("dataQuality") or {}
    reasons = []
    if quality.get("keyFramesValid") is False:
        reasons.append("Key frames are outside the recorded pose interval or out of order")
    if row.get("valid") is not True or not number(row.get("athlete")):
        reasons.append("Measurement unavailable")
    if row.get("side") and quality.get("sideConfidence") == "low":
        reasons.append("Kicking-side signals are unresolved or conflicting")
    phase = row.get("frameKey")
    if (quality.get("poseCoverage") or {}).get(phase) == 0:
        reasons.append("No complete pose frames in this phase window")
    intended = (context.get("keyFrames") or {}).get(phase)
    actual = row.get("athleteFrame")
    if number(actual) and number(intended) and actual != intended:
        reasons.append("Required joints were borrowed from another frame; this is not the stated phase measurement")
    if row.get("frameKey") == "followThrough" and quality.get("followThroughClamped"):
        reasons.append("Clip ends before the intended follow-through phase")
    if row.get("metric") in _REFERENCE_DEPENDENT and quality.get("alignment") == "failed":
        reasons.append("Professional overlay alignment failed")
    if row.get("metric") == "foot_com_vs_pro" and quality.get("proLayout") == "coco17":
        reasons.append("Reference has ankle-only tracking; foot centroid definitions differ")
    if row.get("metric") == "trunk_lean" and (context.get("orientation") or {}).get("direction") not in ("left_to_right", "right_to_left"):
        reasons.append("Kick direction is unknown; trunk lean has no comparable sign")
    return reasons


def build_evidence(context: dict) -> dict:
    """Stable IDs include both legacy static rows and motion-event facts.

    Missing pro timing is represented explicitly; athlete measurements remain useful
    for within-athlete comparisons without pretending the reference has a known FPS.
    """
    quality = context.get("dataQuality") or {}
    rows = []
    for original in context.get("metrics") or []:
        row = copy.deepcopy(original)
        reasons = _reasons(context, row)
        row.update({"kind": "metric", "measurementValid": row.get("valid") is True,
                    "valid": not reasons, "eligible": not reasons, "qualityNotes": reasons,
                    "repId": context.get("repId"),
                    "frame": row.get("athleteFrame", (context.get("keyFrames") or {}).get(row.get("frameKey"))),
                    "comparisonEligible": not reasons and row.get("metric") not in _REFERENCE_DEPENDENT})
        if row.get("note"):
            row["qualityNotes"].append(str(row["note"]))
        if row.get("metric") == "hip_openness":
            row["qualityNotes"].append("Sagittal proxy; cannot establish transverse pelvic rotation")
        if not number(row.get("pro")):
            row["qualityNotes"].append("Professional reference value unavailable")
        row["msFromContact"] = ((row["frame"] - context["keyFrames"]["contact"]) * 1000 / context["fps"]
                                if number(row.get("frame")) and number(context.get("fps")) and context["fps"] > 0
                                and number((context.get("keyFrames") or {}).get("contact")) else None)
        rows.append(row)

    events = ((context.get("jointAngleSequencing") or {}).get("events") or {})
    specs = [
        ("maxKneeFlexion", "deg", "degrees", "backswing"),
        ("maxKneeFlexion", "msFromContact", "milliseconds", "backswing"),
        ("peakThighAngularVel", "degPerS", "degrees/second", "contact"),
        ("peakThighAngularVel", "msFromContact", "milliseconds", "contact"),
        ("peakShankAngularVel", "degPerS", "degrees/second", "contact"),
        ("peakShankAngularVel", "msFromContact", "milliseconds", "contact"),
        ("kickFootSpeedJustBeforeContact", "athleteHeightsPerS", "athlete heights/second", "contact"),
    ]
    for event, field, units, phase in specs:
        athlete_event = (events.get("athlete") or {}).get(event) or {}
        pro_event = (events.get("pro") or {}).get(event) or {}
        athlete, pro = athlete_event.get(field), pro_event.get(field)
        reasons = []
        if quality.get("keyFramesValid") is False:
            reasons.append("Key frames are outside the recorded pose interval or out of order")
        if not number(athlete):
            reasons.append("Motion event unavailable")
        if quality.get("sideConfidence") == "low":
            reasons.append("Kicking-side signals are unresolved or conflicting")
        timed = units != "degrees"
        if timed and quality.get("fpsSource") == "assumed":
            reasons.append("Capture FPS is unknown; timing and velocity cannot be compared")
        event_quality = (events.get("quality") or {}).get(event) or {}
        if event_quality.get("eligible") is False:
            reasons.extend(event_quality.get("notes") or ["Motion event has insufficient tracking support"])
        rows.append({"id": f"event.{event}.{field}", "kind": "event", "metric": event,
                     "frameKey": phase, "frame": athlete_event.get("frame"), "side": "kicking",
                     "athlete": athlete, "pro": pro,
                     "delta": athlete - pro if number(athlete) and number(pro) else None,
                     "units": units, "valid": not reasons, "eligible": not reasons,
                     "measurementValid": number(athlete), "comparisonEligible": not reasons,
                     "jointIds": ((context.get("bodyParts") or {}).get("kickingLeg") or {}).get("jointIds", []),
                     "repId": context.get("repId"), "qualityNotes": reasons,
                     "msFromContact": athlete_event.get("msFromContact"),
                     "meaning": f"{event}.{field}; timing is relative to this rep's contact frame"})
    return {"version": VERSION, "rows": rows,
            "coverage": {"eligibleCount": sum(row["eligible"] for row in rows),
                         "totalCount": len(rows),
                         "unavailable": [{"id": row["id"], "notes": row["qualityNotes"]}
                                         for row in rows if not row["eligible"]]},
            "limitations": ["One sagittal recording cannot establish unobserved 3D technique",
                            "A difference from a reference or another foot is not itself a fault",
                            "Rep intent and repeatability are unknown unless explicitly supplied"]}


def attach_evidence(context: dict) -> dict:
    context["evidence"] = build_evidence(context)
    context["assessmentCoverage"] = context["evidence"]["coverage"]
    return context


def evidence_rows(context: dict) -> list[dict]:
    evidence = context.get("evidence")
    return evidence.get("rows", []) if isinstance(evidence, dict) else context.get("metrics", [])


TOOL_SPECS = {
    "inspect_kick_evidence": {
        "name": "inspect_kick_evidence",
        "description": "Inspect source-addressable measurements or dense phase motion samples for only this analysis's rep(s). Missing values and quality notes remain explicit. Each response is bounded to 120 rows.",
        "parameters": {"type": "object", "additionalProperties": False,
                       "required": ["section"], "properties": {
            "repId": {"type": "string"},
            "section": {"type": "string", "enum": ["measurements", "sequencing", "trajectory"]},
            "frameKey": {"type": "string", "enum": list(PHASES)},
            "startMs": {"type": "number"}, "endMs": {"type": "number"},
            "limit": {"type": "integer", "minimum": 1, "maximum": MAX_DETAIL_SAMPLES},
        }},
    },
    "inspect_kick_comparison": {
        "name": "inspect_kick_comparison",
        "description": "Inspect the left/right difference table for this bound pair, including ineligible rows and the reasons they cannot support feedback.",
        "parameters": {"type": "object", "additionalProperties": False, "properties": {
            "frameKey": {"type": "string", "enum": list(PHASES)},
            "limit": {"type": "integer", "minimum": 1, "maximum": MAX_DETAIL_SAMPLES},
        }},
    },
}


def _bounded_args(args: dict, allowed: set[str]) -> int:
    if not isinstance(args, dict) or set(args) - allowed:
        raise invalid_request("Unsupported kick evidence tool arguments")
    limit = args.get("limit", 60)
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_DETAIL_SAMPLES:
        raise invalid_request("limit must be an integer from 1 to 120")
    if args.get("frameKey") is not None and args["frameKey"] not in PHASES:
        raise invalid_request("Unknown kick phase")
    return limit


def inspect_evidence(inv, args: dict) -> dict:
    limit = _bounded_args(args, {"repId", "section", "frameKey", "startMs", "endMs", "limit"})
    contexts = getattr(inv, "_kick_rep_contexts", {})
    if not contexts and inv.context.get("kickAnalysisContext"):
        context = inv.context["kickAnalysisContext"]
        contexts = {context.get("repId"): context}
    rep_id = args.get("repId")
    if rep_id is None and len(contexts) == 1:
        rep_id = next(iter(contexts))
    if rep_id not in contexts:
        raise invalid_request("repId must identify a rep bound to this analysis")
    context = contexts[rep_id]
    section = args.get("section")
    phase = args.get("frameKey")
    if section == "measurements":
        rows = evidence_rows(context)
        if phase:
            rows = [row for row in rows if row.get("frameKey") == phase]
    elif section in ("sequencing", "trajectory"):
        key = "jointAngleSequencing" if section == "sequencing" else "comTrajectory"
        detail = getattr(inv, "_kick_details", {}).get(rep_id, {})
        rows = detail.get(key) or (context.get(key) or {}).get("athlete") or []
        lo, hi = args.get("startMs", -1000), args.get("endMs", 500)
        if not number(lo) or not number(hi) or not -2000 <= lo <= hi <= 2000:
            raise invalid_request("Motion window must be ordered within -2000 to 2000 ms")
        if phase:
            phase_frame = (context.get("keyFrames") or {}).get(phase)
            contact = (context.get("keyFrames") or {}).get("contact")
            fps = context.get("fps")
            if number(phase_frame) and number(contact) and number(fps) and fps > 0:
                center = (phase_frame - contact) * 1000 / fps
                lo, hi = max(lo, center - 100), min(hi, center + 100)
        rows = [row for row in rows if number(row.get("msFromContact")) and lo <= row["msFromContact"] <= hi]
    else:
        raise invalid_request("Unknown kick evidence section")
    count = len(rows)
    if count > limit:
        # Keep both ends of a time window; make decimation explicit.
        rows = [rows[round(i * (count - 1) / (limit - 1))] for i in range(limit)] if limit > 1 else rows[:1]
    return {"repId": rep_id, "section": section, "rows": copy.deepcopy(rows),
            "availableCount": count, "returnedCount": len(rows), "decimated": count > limit,
            "orientation": context.get("orientation"), "dataQuality": context.get("dataQuality"),
            "source": context.get("source")}


def inspect_comparison(inv, args: dict) -> dict:
    limit = _bounded_args(args, {"frameKey", "limit"})
    context = inv.context.get("kickComparisonContext")
    if not isinstance(context, dict):
        raise invalid_request("No comparison is bound to this invocation")
    rows = context.get("differences") or []
    if args.get("frameKey"):
        rows = [row for row in rows if row.get("frameKey") == args["frameKey"]]
    return {"leftRepId": context["leftRepId"], "rightRepId": context["rightRepId"],
            "differences": copy.deepcopy(rows[:limit]), "availableCount": len(rows),
            "truncated": len(rows) > limit, "dataQuality": context["dataQuality"]}


def run_tool(name: str, args: dict, inv) -> dict:
    result = {"inspect_kick_evidence": inspect_evidence,
              "inspect_kick_comparison": inspect_comparison}[name](inv, args)
    inspected = getattr(inv, "_kick_tool_evidence", [])
    record = {"tool": name, "args": copy.deepcopy(args), "result": copy.deepcopy(result)}
    key = digest(record)
    if not any(entry["id"] == key for entry in inspected):
        size = len(json.dumps(record, sort_keys=True, allow_nan=False, default=str).encode())
        used = getattr(inv, "_kick_tool_evidence_bytes", 0)
        if used + size > MAX_INSPECTED_EVIDENCE_BYTES:
            result = {"error": "evidence_budget_exhausted",
                      "message": "The durable evidence budget is full. Use evidence already supplied; do not infer unavailable details."}
            record = {"tool": name, "args": copy.deepcopy(args), "result": result}
            key = digest(record)
            size = len(json.dumps(record).encode())
        if not any(entry["id"] == key for entry in inspected):
            inspected.append({"id": key, **record})
            inv._kick_tool_evidence_bytes = used + size
    calls = getattr(inv, "_kick_tool_evidence_calls", [])
    calls.append(key)
    inv._kick_tool_evidence = inspected
    inv._kick_tool_evidence_calls = calls
    return result
