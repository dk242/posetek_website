"""Fault pre-screen tests — signature evaluation against a computed kick analysis.

The load-bearing behavior is the three-way outcome: fires / does not fire / cannot be evaluated.
A missing or invalid metric must NOT read as "no fault" (that would silently give an athlete a
clean bill of health on data we never had), so it lands in `unevaluated` instead.
"""

from __future__ import annotations

from gateway import kick_faults
from gateway import knowledge


def row(rid: str, *, athlete=None, pro=None, delta=None, valid=True, units="normalized"):
    return {"id": rid, "athlete": athlete, "pro": pro, "delta": delta,
            "units": units, "valid": valid}


def computed(rows, events=None):
    return {
        "metrics": rows,
        "jointAngleSequencing": {"events": {"athlete": events or {}}},
    }


PLANT_AHEAD = {
    "id": "plant_foot_too_far_ahead",
    "name": "Plant foot lands past the ball",
    "bodyRegion": "supportLeg",
    "frameKey": "contact",
    "why": "…",
    "cues": ["a", "b", "c"],
    "signature": {"all": [
        {"metricId": "contact.plant_foot_ball_offset_x.support", "field": "athlete",
         "op": "gt", "value": 0.05},
    ]},
}

NO_WHIP = {
    "id": "no_thigh_deceleration",
    "name": "Thigh never decelerates",
    "bodyRegion": "kickingLeg",
    "frameKey": "contact",
    "why": "…",
    "cues": ["a", "b", "c"],
    "signature": {"all": [
        {"event": "proximalToDistalOrderOK", "op": "isFalse"},
        {"event": "peakShankAngularVel.degPerS", "op": "lt", "value": 1000},
    ]},
}


def test_signature_fires_with_evidence():
    out = kick_faults.screen_faults(
        computed([row("contact.plant_foot_ball_offset_x.support", athlete=0.12, pro=0.02, delta=0.10)]),
        [PLANT_AHEAD],
    )
    assert [c["faultId"] for c in out["candidates"]] == ["plant_foot_too_far_ahead"]
    candidate = out["candidates"][0]
    assert candidate["evidence"] == [{
        "metricId": "contact.plant_foot_ball_offset_x.support",
        "athlete": 0.12, "pro": 0.02, "delta": 0.10, "units": "normalized",
    }]
    assert candidate["cueFamily"] == ["a", "b", "c"]
    assert out["unevaluated"] == []


def test_signature_below_threshold_does_not_fire():
    out = kick_faults.screen_faults(
        computed([row("contact.plant_foot_ball_offset_x.support", athlete=0.01, delta=0.0)]),
        [PLANT_AHEAD],
    )
    assert out["candidates"] == []
    assert out["unevaluated"] == []


def test_invalid_row_is_unevaluated_not_absent():
    out = kick_faults.screen_faults(
        computed([row("contact.plant_foot_ball_offset_x.support", athlete=None, valid=False)]),
        [PLANT_AHEAD],
    )
    assert out["candidates"] == []
    assert out["unevaluated"] == [{
        "faultId": "plant_foot_too_far_ahead",
        "reasons": ["metric 'contact.plant_foot_ball_offset_x.support' is invalid for this rep"],
    }]


def test_missing_row_is_unevaluated():
    out = kick_faults.screen_faults(computed([]), [PLANT_AHEAD])
    assert out["candidates"] == []
    assert "is not in the table" in out["unevaluated"][0]["reasons"][0]


def test_event_conditions_and_all_semantics():
    fires = kick_faults.screen_faults(
        computed([], {"proximalToDistalOrderOK": False,
                      "peakShankAngularVel": {"degPerS": 820}}),
        [NO_WHIP],
    )
    assert [c["faultId"] for c in fires["candidates"]] == ["no_thigh_deceleration"]

    # One condition false -> the family does not fire, and that is a real negative.
    quiet = kick_faults.screen_faults(
        computed([], {"proximalToDistalOrderOK": True,
                      "peakShankAngularVel": {"degPerS": 820}}),
        [NO_WHIP],
    )
    assert quiet["candidates"] == []
    assert quiet["unevaluated"] == []

    # Missing event -> unevaluated, never a silent pass.
    blind = kick_faults.screen_faults(
        computed([], {"proximalToDistalOrderOK": False}), [NO_WHIP])
    assert blind["candidates"] == []
    assert "peakShankAngularVel.degPerS" in blind["unevaluated"][0]["reasons"][0]


def test_shipped_corpus_signatures_are_well_formed():
    """Every shipped fault family must be machine-evaluable and carry real coaching content —
    a typo in a metric id would otherwise make a family permanently unevaluable in production."""
    valid_fields = {"athlete", "pro", "delta", "athleteMeters", "proMeters", "deltaMeters"}
    valid_ops = {"gt", "lt", "gte", "lte", "absGt", "absLt", "isTrue", "isFalse"}
    frame_keys = {"backswing", "contact", "followThrough"}
    regions = {"kickingLeg", "supportLeg", "hips", "trunk", "arms", "footPosition", "balance"}

    families = knowledge.kick_fault_families()
    assert len(families) >= 6
    seen_ids = set()
    for fam in families:
        assert fam["id"] not in seen_ids, f"duplicate fault id {fam['id']}"
        seen_ids.add(fam["id"])
        assert fam["bodyRegion"] in regions
        assert fam["frameKey"] in frame_keys
        assert fam["why"].strip()
        assert 3 <= len(fam["cues"]) <= 6, f"{fam['id']} needs 3-6 cue phrasings"
        for cue in fam["cues"]:
            words = len(cue.split())
            assert 5 <= words <= 20, f"{fam['id']} cue is {words} words: {cue}"
            assert " left " not in f" {cue.lower()} " and " right " not in f" {cue.lower()} ", cue
        conditions = fam["signature"]["all"]
        assert conditions, f"{fam['id']} has an empty signature"
        for cond in conditions:
            assert cond["op"] in valid_ops
            if "metricId" in cond:
                mid = cond["metricId"]
                assert mid.split(".")[0] in frame_keys, f"{fam['id']} cites bad frame in {mid}"
                assert cond.get("field", "delta") in valid_fields
            else:
                assert cond.get("event"), f"{fam['id']} condition names neither metricId nor event"


def test_shipped_reference_values_are_sourced():
    values = knowledge.kick_reference_values()
    assert len(values) >= 10
    confidences = {"established", "probable", "contested", "single-study"}
    for v in values:
        assert v["metric"].strip() and v["value"].strip()
        assert v["source"].strip(), f"unsourced reference value: {v['metric']}"
        assert v["confidence"] in confidences
