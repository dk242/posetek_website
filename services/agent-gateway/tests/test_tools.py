"""Tool dispatch + handler tests. Storage-backed tools use the FakeStorage from conftest.py rather
than any real GCS bucket."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from gateway.errors import GatewayError
from gateway.tools import TOOL_SPECS, MAX_POSE_SAMPLES, run_tool
from tests.conftest import add_benchmark, add_player, add_rep


def _dt(days_ago: int) -> datetime:
    return datetime(2026, 1, 1, tzinfo=timezone.utc) - timedelta(days=days_ago)


# ---------------------------------------------------------------------------
# TOOL_SPECS / dispatch
# ---------------------------------------------------------------------------


def test_tool_specs_declares_legacy_and_v3_workout_tools():
    assert set(TOOL_SPECS.keys()) == {
        "fetch_rep_metrics", "fetch_pose_artifact", "fetch_benchmark", "search_drill_catalog",
        "search_drills", "get_drill", "get_drill_history", "estimate_minutes", "draft_create",
        "draft_add_block", "draft_set_dose", "draft_remove_block", "draft_reorder",
        "draft_set_intent", "draft_get", "validate_workout",
        "inspect_kick_evidence", "inspect_kick_comparison",
    }
    for name, spec in TOOL_SPECS.items():
        assert spec["name"] == name
        assert isinstance(spec["description"], str) and spec["description"]
        assert spec["parameters"]["type"] == "object"


def test_tool_specs_never_declare_a_playerid_parameter():
    for spec in TOOL_SPECS.values():
        assert "playerId" not in spec["parameters"].get("properties", {})


def test_run_tool_unknown_name_raises_invalid_request(make_invocation):
    inv = make_invocation()
    with pytest.raises(GatewayError) as exc_info:
        run_tool("delete_everything", {}, inv)
    assert exc_info.value.code == "invalid_request"


def test_run_tool_rejects_playerid_in_args(make_invocation):
    inv = make_invocation()
    with pytest.raises(GatewayError) as exc_info:
        run_tool("fetch_rep_metrics", {"playerId": "someone-else", "drill": "sprint"}, inv)
    assert exc_info.value.code == "invalid_request"


# ---------------------------------------------------------------------------
# fetch_rep_metrics
# ---------------------------------------------------------------------------


def test_fetch_rep_metrics_by_rep_id(db, make_invocation):
    add_player(db, "player1", {})
    add_rep(db, "player1", "rep1", {"repType": "sprint", "max_velocity": 8.1, "createdAt": _dt(1)})

    inv = make_invocation(player_id="player1")
    result = run_tool("fetch_rep_metrics", {"repId": "rep1"}, inv)

    assert len(result["reps"]) == 1
    assert result["reps"][0]["repId"] == "rep1"
    assert result["reps"][0]["metrics"]["maxVelocityMS"] == 8.1


def test_fetch_rep_metrics_by_drill_orders_desc_and_respects_limit(db, make_invocation):
    add_player(db, "player1", {})
    for i in range(5):
        add_rep(db, "player1", f"rep{i}", {"repType": "sprint", "max_velocity": float(i), "createdAt": _dt(5 - i)})

    inv = make_invocation(player_id="player1")
    result = run_tool("fetch_rep_metrics", {"drill": "sprint", "limit": 2}, inv)

    assert len(result["reps"]) == 2
    assert result["reps"][0]["metrics"]["maxVelocityMS"] == 4.0  # most recent first
    assert result["reps"][1]["metrics"]["maxVelocityMS"] == 3.0


def test_fetch_rep_metrics_requires_repid_or_drill(make_invocation):
    inv = make_invocation()
    with pytest.raises(GatewayError) as exc_info:
        run_tool("fetch_rep_metrics", {}, inv)
    assert exc_info.value.code == "invalid_request"


def test_fetch_rep_metrics_unknown_rep_id(db, make_invocation):
    add_player(db, "player1", {})
    inv = make_invocation(player_id="player1")
    with pytest.raises(GatewayError) as exc_info:
        run_tool("fetch_rep_metrics", {"repId": "ghost"}, inv)
    assert exc_info.value.code == "invalid_request"


# ---------------------------------------------------------------------------
# fetch_pose_artifact
# ---------------------------------------------------------------------------


def test_fetch_pose_artifact_decimates_and_preserves_endpoints_and_phase_boundaries(db, storage, make_invocation):
    add_player(db, "player1", {})
    add_rep(db, "player1", "rep1", {"repType": "sprint", "sessionNumber": 2, "repNumber": 3, "createdAt": _dt(1)})

    samples = [{"frameIndex": i, "phaseBoundary": i == 2500} for i in range(5000)]
    storage.put("player1/sprint/session2/kick3/pose.json", samples)

    inv = make_invocation(player_id="player1")
    result = run_tool("fetch_pose_artifact", {"repId": "rep1", "kind": "pose"}, inv)

    artifact = result["artifact"]
    assert len(artifact) <= MAX_POSE_SAMPLES
    assert artifact[0]["frameIndex"] == 0
    assert artifact[-1]["frameIndex"] == 4999
    assert any(frame["frameIndex"] == 2500 for frame in artifact)


def test_fetch_pose_artifact_short_series_is_returned_unchanged(db, storage, make_invocation):
    add_player(db, "player1", {})
    add_rep(db, "player1", "rep1", {"repType": "jump", "sessionNumber": 1, "repNumber": 1, "createdAt": _dt(1)})
    samples = [{"frameIndex": i} for i in range(10)]
    storage.put("player1/jump/session1/kick1/pose.json", samples)

    inv = make_invocation(player_id="player1")
    result = run_tool("fetch_pose_artifact", {"repId": "rep1", "kind": "pose"}, inv)

    assert result["artifact"] == samples


def test_fetch_pose_artifact_maps_side_kick_reptype_to_deadball_shot_folder(db, storage, make_invocation):
    add_player(db, "player1", {})
    add_rep(db, "player1", "rep1", {"repType": "side_kick", "sessionNumber": 1, "repNumber": 1, "createdAt": _dt(1)})
    storage.put("player1/deadballShot/session1/kick1/metadata.json", {"fps": 240})

    inv = make_invocation(player_id="player1")
    result = run_tool("fetch_pose_artifact", {"repId": "rep1", "kind": "metadata"}, inv)

    assert result["artifact"] == {"fps": 240}


def test_fetch_pose_artifact_missing_blob_raises_invalid_request(db, storage, make_invocation):
    add_player(db, "player1", {})
    add_rep(db, "player1", "rep1", {"repType": "jump", "sessionNumber": 1, "repNumber": 1, "createdAt": _dt(1)})

    inv = make_invocation(player_id="player1")
    with pytest.raises(GatewayError) as exc_info:
        run_tool("fetch_pose_artifact", {"repId": "rep1", "kind": "pose"}, inv)
    assert exc_info.value.code == "invalid_request"


# ---------------------------------------------------------------------------
# fetch_benchmark
# ---------------------------------------------------------------------------


def test_fetch_benchmark_returns_score_and_reference(db, make_invocation):
    add_player(db, "player1", {"age": 25, "gender": "male"})
    add_rep(db, "player1", "rep1", {"repType": "sprint", "max_velocity": 8.9, "createdAt": _dt(1)})

    inv = make_invocation(player_id="player1")
    result = run_tool("fetch_benchmark", {"metricId": "sprintMaxSpeed"}, inv)

    assert result["metricId"] == "sprintMaxSpeed"
    assert result["score"] == pytest.approx(100.0)
    assert result["band"] == "elite"


def test_fetch_benchmark_unknown_metric_with_no_data_is_context_unavailable(db, make_invocation):
    add_player(db, "player1", {"age": 25, "gender": "male"})
    add_rep(db, "player1", "rep1", {"repType": "sprint", "max_velocity": 8.9, "createdAt": _dt(1)})

    inv = make_invocation(player_id="player1")
    with pytest.raises(GatewayError) as exc_info:
        run_tool("fetch_benchmark", {"metricId": "verticalJumpHeight"}, inv)
    assert exc_info.value.code == "context_unavailable"


# ---------------------------------------------------------------------------
# search_drill_catalog
# ---------------------------------------------------------------------------


def test_search_drill_catalog_tool_delegates_to_catalog_module(db, make_invocation):
    from tests.conftest import add_drill

    add_player(db, "player1", {"age": 16})
    add_drill(db, "d1", {"name": "Sprint starts", "targetQuality": "acceleration", "minAge": 10, "maxAge": 99, "equipment": []})

    inv = make_invocation(player_id="player1")
    result = run_tool("search_drill_catalog", {"quality": "acceleration"}, inv)

    assert result["quality"] == "acceleration"
    assert {r["drillId"] for r in result["results"]} == {"d1"}
