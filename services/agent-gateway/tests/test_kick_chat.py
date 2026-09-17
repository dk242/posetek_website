"""kick_chat capability tests: registry/prompt coherence, symptom-map corpus integrity,
and the two chat assemblers (knowledge + persisted-walkthrough context).

The symptom map is the load-bearing new piece — it routes an athlete's complaint ("the ball
keeps popping up") to fault families and metric rows. A symptom entry pointing at a fault id
or metric id that doesn't exist would silently route the model's attention nowhere, so the
cross-reference checks here are strict.
"""

from __future__ import annotations

import datetime as dt
import sys
import types as pytypes

# The tool-runner tests import gateway.pipeline, whose usage-ledger import needs
# google.cloud.firestore — not installed in CI. Same import-time stub as
# test_pipeline_stages.py so this file passes when run alone.
if "google.cloud.firestore" not in sys.modules:
    _google = sys.modules.get("google") or pytypes.ModuleType("google")
    _cloud = getattr(_google, "cloud", None) or pytypes.ModuleType("google.cloud")
    _firestore = pytypes.ModuleType("google.cloud.firestore")
    _firestore.SERVER_TIMESTAMP = dt.datetime.now(dt.timezone.utc)
    _cloud.firestore = _firestore
    _google.cloud = _cloud
    sys.modules["google"] = _google
    sys.modules["google.cloud"] = _cloud
    sys.modules["google.cloud.firestore"] = _firestore

from gateway import knowledge
from gateway.assemblers import (
    ASSEMBLERS,
    assemble_kick_chat_knowledge,
    assemble_kick_rep_analysis,
)
from gateway.prompts import PROMPTS, render_prompt
from gateway.registry import get_capability
from gateway.tools import TOOL_SPECS

# ---------------------------------------------------------------------------
# Registry / prompt coherence
# ---------------------------------------------------------------------------


def test_kick_chat_spec_is_coherent():
    spec = get_capability("kick_chat")
    assert spec.transport == "stream"
    assert len(spec.stage_list()) == 1
    stage = spec.stage_list()[0]
    assert stage.output is None  # freeform chat text, never constrained decode
    # Every advertised tool must exist, and the prompt metadata must agree with the
    # registry — a prompt advertising a tool the runner rejects is a mid-stream error.
    assert set(stage.tools) <= set(TOOL_SPECS)
    assert PROMPTS["kick_chat_v1"]["tools"] == stage.tools
    # Thinking spends from max_output_tokens on Gemini; the cap must leave room to answer.
    assert stage.params["thinking_budget"] < stage.params["max_output_tokens"]
    # Assembler order is load-bearing: the knowledge screen reads kickAnalysisContext.
    assemblers = spec.assemblers
    assert set(assemblers) <= set(ASSEMBLERS)
    assert assemblers.index("kickAnalysisContext") < assemblers.index("kickChatKnowledge")


def test_kick_chat_prompt_renders_with_context():
    system, user = render_prompt("kick_chat_v1", {"kickChatKnowledge": {"symptomMap": {}}})
    assert "symptomMap" in system
    assert "2 to 4 short sentences" in system
    assert "kickChatKnowledge" in user


# ---------------------------------------------------------------------------
# Tool runner soft-failure (the review's "failed tool call kills the turn" fix)
# ---------------------------------------------------------------------------


def test_tool_runner_feeds_data_absence_back_to_the_model(make_invocation, monkeypatch):
    """context_unavailable/invalid_request raised BY a tool is a normal athlete
    state (no benchmark data, mistyped repId) — it must come back as a tool
    result the model can react to, never a terminal SSE error."""
    from gateway import pipeline
    from gateway.errors import GatewayError
    from gateway.registry import get_capability

    def _explode(name, args, inv):
        raise GatewayError("context_unavailable", "No recorded data for metric 'sprintMaxSpeed'")

    monkeypatch.setattr("gateway.tools.run_tool", _explode)
    spec = get_capability("kick_chat")
    stage = spec.stage_list()[0]
    runner = pipeline._build_tool_runner(spec, stage, make_invocation(capability="kick_chat"))

    out = runner("fetch_benchmark", {"metricId": "sprintMaxSpeed"})
    assert out == {"error": "No recorded data for metric 'sprintMaxSpeed'"}


def test_tool_runner_still_fails_loudly_for_unoffered_tools(make_invocation):
    import pytest

    from gateway import pipeline
    from gateway.errors import GatewayError
    from gateway.registry import get_capability

    spec = get_capability("kick_chat")
    stage = spec.stage_list()[0]
    runner = pipeline._build_tool_runner(spec, stage, make_invocation(capability="kick_chat"))

    with pytest.raises(GatewayError):
        runner("search_drill_catalog", {})


# ---------------------------------------------------------------------------
# Symptom map corpus integrity
# ---------------------------------------------------------------------------

_METRIC_IDS = {
    "arm_abduction", "foot_com_ball_offset_x", "foot_com_ball_offset_y", "hip_angle",
    "hip_openness", "knee_angle", "plant_foot_ball_offset_x", "shank_angle", "thigh_angle",
    "trunk_com_ball_offset_x", "trunk_com_offset_x", "trunk_com_offset_y", "trunk_lean",
    "wrist_trunk_offset",
}
_FRAME_KEYS = {"backswing", "contact", "followThrough"}
_EVENT_KEYS = {
    "maxKneeFlexion", "peakThighAngularVel", "peakShankAngularVel",
    "proximalToDistalOrderOK", "backswingKneeAngleDeg", "kickFootSpeedJustBeforeContact",
}


def _metric_ref_is_valid(ref: str) -> bool:
    """metricsToCheck entries are human-readable pointers like
    'contact.plant_foot_ball_offset_x (support)' or
    'jointAngleSequencing.events.proximalToDistalOrderOK' or 'comTrajectory'."""
    head = ref.split(" ")[0]
    if head == "comTrajectory":
        return True
    parts = head.split(".")
    if parts[0] == "jointAngleSequencing":
        return len(parts) >= 3 and parts[1] == "events" and parts[2] in _EVENT_KEYS
    return len(parts) == 2 and parts[0] in _FRAME_KEYS and parts[1] in _METRIC_IDS


def test_symptom_map_cross_references_are_real():
    family_ids = {f["id"] for f in knowledge.kick_fault_families()}
    symptom_map = knowledge.kick_symptom_map()
    assert symptom_map["noMatchGuidance"]
    symptoms = symptom_map["symptoms"]
    assert len(symptoms) >= 6
    seen_ids = set()
    for entry in symptoms:
        assert entry["id"] not in seen_ids
        seen_ids.add(entry["id"])
        assert entry["athleteLanguage"], entry["id"]
        assert entry["mechanics"], entry["id"]
        for fault_id in entry["candidateFaults"]:
            assert fault_id in family_ids, f"{entry['id']} references unknown fault '{fault_id}'"
        for ref in entry["metricsToCheck"]:
            assert _metric_ref_is_valid(ref), f"{entry['id']} references unknown metric '{ref}'"


def test_symptom_map_pain_entry_is_a_safety_route():
    pain = next(s for s in knowledge.kick_symptom_map()["symptoms"] if s["id"] == "pain")
    # Pain must never route into technique fixes: no candidate faults, no metrics,
    # and an explicit response directive.
    assert pain["candidateFaults"] == []
    assert pain["metricsToCheck"] == []
    assert "professional" in pain["response"].lower()


def test_symptom_map_covers_the_ball_pops_up_complaint():
    """The complaint that motivated the feature routes to the documented lofting
    mechanisms — plant behind the ball and weight hanging back."""
    entry = next(s for s in knowledge.kick_symptom_map()["symptoms"] if s["id"] == "ball_pops_up")
    assert "plant_foot_behind_ball" in entry["candidateFaults"]
    assert "weight_behind_the_ball" in entry["candidateFaults"]
    assert any("popping up" in phrase for phrase in entry["athleteLanguage"])


# ---------------------------------------------------------------------------
# kickChatKnowledge assembler
# ---------------------------------------------------------------------------


def test_kick_chat_knowledge_screens_the_computed_context(make_invocation):
    computed = {
        "metrics": [
            {"id": "contact.plant_foot_ball_offset_x.support", "athlete": -0.12,
             "pro": 0.05, "delta": -0.17, "units": "normalized", "valid": True},
        ],
        "jointAngleSequencing": {"events": {"athlete": {}}},
    }
    inv = make_invocation(capability="kick_chat", context={"kickAnalysisContext": computed})

    out = assemble_kick_chat_knowledge(inv)

    assert out["symptomMap"]["symptoms"]
    assert out["biomechanics"]
    assert out["referenceValues"]
    fired = {c["faultId"] for c in out["faultScreen"]["candidates"]}
    assert "plant_foot_behind_ball" in fired


def test_kick_chat_knowledge_with_no_computed_context(make_invocation):
    inv = make_invocation(capability="kick_chat", context={})
    out = assemble_kick_chat_knowledge(inv)
    assert out["faultScreen"] == {"candidates": [], "unevaluated": [], "screened": 0}
    assert out["symptomMap"]["symptoms"]


# ---------------------------------------------------------------------------
# kickRepAnalysis assembler
# ---------------------------------------------------------------------------


def _add_analysis(db, player_id: str, rep_id: str, data: dict) -> None:
    db.collection("players").document(player_id).collection("aiAnalyses").document(rep_id).set(data)


def test_kick_rep_analysis_absent_doc_is_unavailable(db, make_invocation):
    inv = make_invocation(capability="kick_chat", params={"repId": "rep1"})
    assert assemble_kick_rep_analysis(inv) == {"available": False}


def test_kick_rep_analysis_missing_rep_id_is_unavailable(make_invocation):
    inv = make_invocation(capability="kick_chat", params={})
    assert assemble_kick_rep_analysis(inv) == {"available": False}


def test_kick_rep_analysis_wrong_capability_doc_is_unavailable(db, make_invocation):
    _add_analysis(db, "player1", "rep1", {"capability": "generate_report"})
    inv = make_invocation(capability="kick_chat", params={"repId": "rep1"})
    assert assemble_kick_rep_analysis(inv) == {"available": False}


def test_kick_rep_analysis_slims_the_persisted_doc(db, make_invocation):
    _add_analysis(db, "player1", "rep1", {
        "capability": "kick_analysis",
        "generatedAt": "2026-08-04T15:19:29Z",
        "focusAreas": [{
            "title": "Plant foot lands too far ahead of the ball",
            "cue": "Take a shorter final step",
            "why": "…",
            "evidence": "plant_foot_ball_offset_x (support) at contact: you 24 cm, pro 5 cm",
            "bodyRegion": "supportLeg",
            "frameKey": "contact",
            "jointIds": [23, 25, 27],   # must NOT survive slimming
            "metricIds": ["contact.plant_foot_ball_offset_x.support"],
        }],
        "observations": [{
            "id": "obs1",
            "title": "Overstriding plant",
            "observation": "The plant foot lands well past the ball.",
            "bodyRegion": "supportLeg",
            "frameKey": "contact",
            "deviationDirection": "athleteHigher",
            "severity": 4,
            "reasoning": "internal chain — must NOT survive slimming",
            "metricIds": ["contact.plant_foot_ball_offset_x.support"],
        }],
        "metrics": [{"id": "bulky", "valid": True}],  # whole table must NOT ride into chat
    })
    inv = make_invocation(capability="kick_chat", params={"repId": "rep1"})

    out = assemble_kick_rep_analysis(inv)

    assert out["available"] is True
    assert out["generatedAt"] == "2026-08-04T15:19:29Z"
    (fa,) = out["focusAreas"]
    assert fa == {
        "title": "Plant foot lands too far ahead of the ball",
        "cue": "Take a shorter final step",
        "why": "…",
        "evidence": "plant_foot_ball_offset_x (support) at contact: you 24 cm, pro 5 cm",
        "bodyRegion": "supportLeg",
        "frameKey": "contact",
    }
    (obs,) = out["observations"]
    assert "reasoning" not in obs and "metricIds" not in obs
    assert obs["observation"] == "The plant foot lands well past the ball."
    assert "metrics" not in out
