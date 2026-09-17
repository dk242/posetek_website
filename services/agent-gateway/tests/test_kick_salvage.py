"""Validation-salvage tests: when the post-retry output still has violations, drop the
violating items and ship the clean remainder instead of failing the whole job — but ONLY
when the remainder re-validates clean, and never when a violation can't be attributed to a
specific item. Zero survivors still fails (an empty analysis is the old failure with a
friendlier costume)."""

from __future__ import annotations

import datetime as dt
import sys
import types as pytypes

# gateway.pipeline imports the usage ledger, which needs google.cloud.firestore — not
# installed in CI. Same import-time stub as test_pipeline_stages.py.
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

from gateway import pipeline, validators
from gateway.registry import get_capability

# ---------------------------------------------------------------------------
# Fixture material: a tiny deterministic table + valid/invalid items
# ---------------------------------------------------------------------------

ROWS = [
    {"id": "contact.plant_foot_ball_offset_x.support", "frameKey": "contact", "side": "support",
     "athlete": 0.13, "pro": 0.03, "delta": 0.10, "units": "normalized", "valid": True},
    {"id": "contact.knee_angle.kicking", "frameKey": "contact", "side": "kicking",
     "athlete": 150.0, "pro": 130.0, "delta": 20.0, "units": "degrees", "valid": True},
    {"id": "contact.trunk_lean", "frameKey": "contact", "side": None,
     "athlete": -5.0, "pro": -12.0, "delta": 7.0, "units": "degrees", "valid": True},
]

CONTEXT = {"kickAnalysisContext": {"metrics": ROWS}}


def _obs(obs_id: str, region: str, metric_id: str, title: str) -> dict:
    return {
        "id": obs_id, "frameKey": "contact", "bodyRegion": region, "title": title,
        "observation": f"{title} at contact.", "severity": 3,
        "deviationDirection": "athleteHigher", "metricIds": [metric_id],
        "reasoning": "internal",
    }


GOOD_SUPPORT = _obs("obs-support", "supportLeg", "contact.plant_foot_ball_offset_x.support",
                    "Plant foot lands past the ball")
GOOD_KICKING = _obs("obs-kicking", "kickingLeg", "contact.knee_angle.kicking",
                    "Kicking knee stays open through contact")
GOOD_TRUNK = _obs("obs-trunk", "trunk", "contact.trunk_lean",
                  "Trunk tips toward the target early")
# 'left' in user-facing text is a per-item violation with an index-prefixed message.
BAD_SIDE_WORDS = _obs("obs-bad", "kickingLeg", "contact.knee_angle.kicking",
                      "Your left knee stays open")


def _card(rank: int, obs: dict, cue: str) -> dict:
    return {
        "rank": rank, "observationId": obs["id"], "frameKey": obs["frameKey"],
        "title": obs["title"], "cue": cue, "whyItMatters": "It changes the strike.",
        "metricIds": list(obs["metricIds"]),
    }


CUE = "Take a shorter final step to the ball"

# ---------------------------------------------------------------------------
# Observations salvage
# ---------------------------------------------------------------------------


def test_salvage_observations_drops_only_the_violating_item(make_invocation):
    inv = make_invocation(context=CONTEXT)
    result = {"observations": [GOOD_SUPPORT, BAD_SIDE_WORDS, GOOD_TRUNK]}
    violations = validators.validate_kick_observations_v1(result, inv)
    assert violations, "fixture must actually violate"

    salvaged, dropped = validators.salvage_kick_observations_v1(result, violations, inv)

    assert [o["id"] for o in salvaged["observations"]] == ["obs-support", "obs-trunk"]
    assert len(dropped) == 1 and "Your left knee stays open" in dropped[0]
    assert validators.validate_kick_observations_v1(salvaged, inv) == []


def test_salvage_returns_none_when_nothing_survives(make_invocation):
    inv = make_invocation(context=CONTEXT)
    bad2 = {**BAD_SIDE_WORDS, "id": "obs-bad2", "title": "Right knee drifts wide"}
    result = {"observations": [BAD_SIDE_WORDS, bad2]}
    violations = validators.validate_kick_observations_v1(result, inv)

    assert validators.salvage_kick_observations_v1(result, violations, inv) is None


def test_salvage_returns_none_on_unattributable_violation(make_invocation):
    inv = make_invocation(context=CONTEXT)
    result = {"observations": [GOOD_SUPPORT]}

    out = validators.salvage_kick_observations_v1(result, ["output is not a JSON object"], inv)

    assert out is None


# ---------------------------------------------------------------------------
# Focus salvage
# ---------------------------------------------------------------------------


def _focus_inv(make_invocation, observations: list[dict]):
    inv = make_invocation(context=CONTEXT)
    inv.stage_outputs["observe"] = {"observations": observations}
    return inv


def test_salvage_focus_drops_duplicate_observation_and_renumbers(make_invocation):
    inv = _focus_inv(make_invocation, [GOOD_SUPPORT, GOOD_KICKING, GOOD_TRUNK])
    dup_support = _card(4, GOOD_SUPPORT, "Land the plant foot beside the ball line")
    result = {"focusAreas": [
        _card(1, GOOD_SUPPORT, CUE),
        _card(2, GOOD_KICKING, "Drive the knee through as the foot arrives"),
        _card(3, GOOD_TRUNK, "Keep your chest tall over the ball"),
        dup_support,
    ]}
    violations = validators.validate_kick_focus_v1(result, inv)
    assert any("repeats the same observation" in v for v in violations)

    salvaged, dropped = validators.salvage_kick_focus_v1(result, violations, inv)

    assert [c["observationId"] for c in salvaged["focusAreas"]] == ["obs-support", "obs-kicking", "obs-trunk"]
    assert [c["rank"] for c in salvaged["focusAreas"]] == [1, 2, 3]
    assert len(dropped) == 1
    assert validators.validate_kick_focus_v1(salvaged, inv) == []


def test_salvage_focus_tolerates_count_floor_after_drop(make_invocation):
    """3 observations demand 3-4 cards; dropping a violating card can leave 2. Shipping 2
    good cards beats shipping nothing — the count rule is a selection preference, not a
    data-correctness rule, so it must not block salvage."""
    inv = _focus_inv(make_invocation, [GOOD_SUPPORT, GOOD_KICKING, GOOD_TRUNK])
    bad = _card(3, GOOD_TRUNK, "Keep your left shoulder tall over the ball")  # side word
    result = {"focusAreas": [
        _card(1, GOOD_SUPPORT, CUE),
        _card(2, GOOD_KICKING, "Drive the knee through as the foot arrives"),
        bad,
    ]}
    violations = validators.validate_kick_focus_v1(result, inv)

    salvaged, dropped = validators.salvage_kick_focus_v1(result, violations, inv)

    assert len(salvaged["focusAreas"]) == 2
    assert len(dropped) == 1
    remaining = validators.validate_kick_focus_v1(salvaged, inv)
    assert all(v.startswith("focusAreas has ") for v in remaining)


# ---------------------------------------------------------------------------
# Pipeline hook
# ---------------------------------------------------------------------------


def test_attempt_salvage_resolves_through_the_stage_registry(make_invocation):
    inv = _focus_inv(make_invocation, [GOOD_SUPPORT, GOOD_KICKING, GOOD_TRUNK])
    focus_stage = get_capability("kick_analysis").stage_list()[1]
    result = {"focusAreas": [
        _card(1, GOOD_SUPPORT, CUE),
        _card(2, GOOD_KICKING, "Drive the knee through as the foot arrives"),
        _card(3, GOOD_TRUNK, "Keep your left shoulder tall over the ball"),
    ]}
    violations = validators.validate_kick_focus_v1(result, inv)

    salvaged = pipeline._attempt_salvage(focus_stage, result, violations, inv)

    assert salvaged is not None
    salvaged_result, dropped = salvaged
    assert len(salvaged_result["focusAreas"]) == 2 and len(dropped) == 1


def test_attempt_salvage_is_none_for_stages_without_a_salvager(make_invocation):
    inv = make_invocation()
    report_stage = get_capability("generate_report").stage_list()[0]

    assert pipeline._attempt_salvage(report_stage, {"x": 1}, ["some violation"], inv) is None


def test_finalizer_records_what_was_dropped(db, make_invocation):
    inv = make_invocation(capability="kick_analysis", params={"repId": "rep1"}, context=CONTEXT)
    inv.stage_outputs["observe"] = {"observations": [GOOD_SUPPORT]}
    inv.job_id = "salvage-job"
    inv.salvage["focus"] = ["Bad card: focusAreas[2] …"]

    payload = pipeline._finalize_kick_analysis(inv, {"focusAreas": [_card(1, GOOD_SUPPORT, CUE)]})

    assert payload["validation"]["salvagedStages"] == {"focus": ["Bad card: focusAreas[2] …"]}
    persisted = db.collection("players").document("player1").collection("aiAnalyses").document("rep1").get()
    assert persisted.to_dict()["validation"]["salvagedStages"]["focus"]
