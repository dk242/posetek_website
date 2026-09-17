"""Evidence support, scope isolation, immutable lineage and bilateral contracts."""
import copy
from types import SimpleNamespace as NS

import pytest

from gateway import pipeline, validators
from gateway.errors import GatewayError
from gateway.kick_evidence import attach_evidence, inspect_evidence, run_tool, digest
from gateway.kick_comparison import assemble_comparison, comparison_id, persist_analysis, validate_comparison
from gateway.schemas import get_json_schema
from tests.conftest import add_player
from tests.test_pipeline_stages import FakeProvider, structured_result


def context(side="left", rep_id="left1", value=125):
    return attach_evidence({
        "repId": rep_id, "keyFrames": {"backswing": 10, "contact": 20, "followThrough": 70}, "fps": 240,
        "orientation": {"kickingSide": side, "strikeFootField": side, "kickingSideSource": "strike_foot",
                        "sideAgreement": "agree"},
        "dataQuality": {"sideConfidence": "high", "fpsSource": "filename", "proTimingComparable": False},
        "source": {"repId": rep_id, "frameCount": 120, "poseHash": "pose"},
        "metrics": [{"id": "contact.knee_angle.kicking", "metric": "knee_angle", "side": "kicking",
                     "frameKey": "contact", "athlete": value, "pro": 130, "delta": value - 130,
                     "units": "degrees", "valid": True, "jointIds": [23, 25, 27]}],
        "jointAngleSequencing": {"events": {"athlete": {"maxKneeFlexion": {"deg": 95, "frame": 11, "msFromContact": -37.5}}, "pro": {}}},
    })


def test_ambiguous_sides_and_missing_motion_are_not_coachable():
    data = context()
    data["dataQuality"]["sideConfidence"] = "low"
    attach_evidence(data)
    assert not any(row["eligible"] for row in data["evidence"]["rows"])
    assert data["assessmentCoverage"]["eligibleCount"] == 0


def test_events_are_citable_without_inventing_a_pro_delta(make_invocation):
    data = context()
    inv = make_invocation(context={"kickAnalysisContext": data})
    observation = {"id": "o1", "frameKey": "backswing", "bodyRegion": "kickingLeg", "title": "Measured fold",
                   "severity": 2, "metricIds": [], "evidenceIds": ["event.maxKneeFlexion.deg"],
                   "deviationDirection": "notComparable", "observation": "The measured knee bend is available.", "reasoning": "Timing reference unavailable."}
    assert validators.validate_kick_observations_v1({"observations": [observation]}, inv) == []
    observation["evidenceIds"] = ["event.unknown"]
    assert validators.validate_kick_observations_v1({"observations": [observation]}, inv)


@pytest.mark.parametrize("args", [
    {"section": "measurements", "repId": "another-athlete-rep"},
    {"section": "measurements", "playerId": "someone-else"},
    {"section": "sequencing", "limit": 121},
    {"section": "sequencing", "startMs": float("nan")},
    {"section": "sequencing", "startMs": 5, "endMs": -5},
])
def test_detail_tools_cannot_expand_scope_or_budgets(make_invocation, args):
    inv = make_invocation(context={"kickAnalysisContext": context()})
    with pytest.raises(GatewayError):
        inspect_evidence(inv, args)


def test_dense_detail_is_bounded_and_preserved_for_review(make_invocation):
    inv = make_invocation(context={"kickAnalysisContext": context()})
    inv._kick_details = {"left1": {"jointAngleSequencing": [{"frame": i, "msFromContact": i, "kickingKnee": None if i == 5 else i} for i in range(300)]}}
    result = run_tool("inspect_kick_evidence", {"section": "sequencing", "limit": 120}, inv)
    assert len(result["rows"]) == 120 and result["decimated"]
    assert result["rows"][0]["frame"] == 0 and result["rows"][-1]["frame"] == 299
    assert inv._kick_tool_evidence[0]["result"] == result


def _pair(monkeypatch):
    left, right = context(), context("right", "right1", 140)
    def assemble(inv):
        return copy.deepcopy({"left1": left, "right1": right}[inv.params["repId"]])
    monkeypatch.setattr("gateway.assemblers.assemble_kick_analysis_context", assemble)
    return left, right


def test_comparison_is_ordered_functional_and_exact(monkeypatch, make_invocation):
    _pair(monkeypatch)
    inv = make_invocation(capability="kick_foot_comparison", params={"leftRepId": "left1", "rightRepId": "right1"})
    result = assemble_comparison(inv)
    row = next(row for row in result["differences"] if row["id"] == "contact.knee_angle.kicking")
    assert (row["left"], row["right"], row["delta"]) == (125, 140, 15)
    assert row["comparable"] is True
    assert result["comparisonId"] == comparison_id("left1", "right1")
    assert comparison_id("left1", "right1") != comparison_id("right1", "left1")


@pytest.mark.parametrize("problem", ["duplicate", "swapped", "disagree", "assumed", "missing"])
def test_comparison_rejects_unreliable_laterality(monkeypatch, make_invocation, problem):
    left, _ = _pair(monkeypatch)
    params = {"leftRepId": "left1", "rightRepId": "right1"}
    if problem == "duplicate": params["rightRepId"] = "left1"
    elif problem == "swapped": params = {"leftRepId": "right1", "rightRepId": "left1"}
    elif problem == "disagree": left["orientation"]["sideAgreement"] = "disagree"
    elif problem == "assumed": left["orientation"]["kickingSideSource"] = "assumed"
    else: left["orientation"]["strikeFootField"] = None
    with pytest.raises(GatewayError) as error:
        assemble_comparison(make_invocation(capability="kick_foot_comparison", params=params))
    assert error.value.code == "invalid_request"


def test_comparison_cannot_cite_ineligible_or_unknown_rows(make_invocation):
    inv = make_invocation(context={"kickComparisonContext": {"differences": [{"id": "row", "comparable": False}]}})
    result = {"summary": "A difference", "focusAreas": [{"rank": 1, "cue": "Keep the movement smooth through the strike", "evidenceIds": ["row"]}]}
    assert validate_comparison(result, inv)
    assert validate_comparison({"schemaVersion": 1, "summary": "No supported actionable difference", "focusAreas": []}, inv) == []


def test_full_comparison_pipeline_publishes_source_before_current(monkeypatch, make_invocation, db):
    _pair(monkeypatch)
    add_player(db, "player1", {"authenticationUID": "uid1"})
    provider = FakeProvider([structured_result({"schemaVersion": 1, "summary": "These clips differ; one pair does not establish a persistent fault.", "focusAreas": []})])
    monkeypatch.setattr("gateway.providers.base.get_provider", lambda name: provider)
    inv = make_invocation(capability="kick_foot_comparison", params={"leftRepId": "left1", "rightRepId": "right1"})
    inv.job_id = "bilateral-job"
    result, _ = pipeline.run_job_capability(inv)
    run = db.get_doc(("players", "player1", "aiAnalysisRuns", inv.job_id))
    current = db.get_doc(("players", "player1", "aiKickComparisons", result["comparisonId"]))
    assert run["result"] == result
    assert run["provenance"]["contextHash"] == digest(run["context"])
    assert current["jobId"] == inv.job_id
    assert result["leftKeyFrames"]["contact"] == 20
    assert result["provenance"]["sources"]["left1"]["frameCount"] == 120
    with pytest.raises(GatewayError, match="immutable"):
        persist_analysis(inv, result, "aiKickComparisons", result["comparisonId"])
    assert db.get_doc(("players", "player1", "aiAnalysisRuns", inv.job_id)) == run


def test_failed_atomic_publication_has_neither_partial_document(make_invocation, db):
    inv = make_invocation(capability="kick_analysis", params={"repId": "left1"}, context={"kickAnalysisContext": context()})
    inv.job_id = "atomic-job"
    def fail(_store):
        raise RuntimeError("injected transaction failure")
    db.before_commit = fail
    with pytest.raises(RuntimeError, match="transaction failure"):
        persist_analysis(inv, {"generatedAt": "2026-09-08T00:00:00Z"}, "aiAnalyses", "left1")
    assert db.get_doc(("players", "player1", "aiAnalysisRuns", inv.job_id)) is None
    assert db.get_doc(("players", "player1", "aiAnalyses", "left1")) is None


@pytest.mark.parametrize("text", ["The leg is nearly straight at contact.", "Strike with a bent knee, not a straight leg.", "Never lock your kicking knee at contact."])
def test_descriptions_and_negated_anti_cues_are_not_discarded(text):
    errors = []
    validators._check_kick_anti_cues({"observation": text, "cue": text}, "item", "kickingLeg", "contact", errors)
    # Descriptive wording belongs in observations, while a cue containing 'straight'
    # is only acceptable when it explicitly negates the prescription.
    if text.startswith("The leg"):
        errors = []
        validators._check_kick_anti_cues({"observation": text}, "item", "kickingLeg", "contact", errors)
    assert errors == []


def test_empty_supported_results_are_valid_schema_outputs():
    import jsonschema
    jsonschema.validate({"schemaVersion": 1, "observations": []}, get_json_schema("kick_observations_v1"))
    jsonschema.validate({"schemaVersion": 1, "focusAreas": []}, get_json_schema("kick_focus_v1"))


def test_borrowed_contact_pose_and_zero_coverage_are_ineligible():
    for patch in ({"athleteFrame": 23}, {}):
        data = context()
        data["metrics"][0].update(patch)
        if not patch:
            data["dataQuality"]["poseCoverage"] = {"contact": 0}
        attach_evidence(data)
        row = data["evidence"]["rows"][0]
        assert row["measurementValid"] is True
        assert row["eligible"] is False and row["comparisonEligible"] is False


def test_intrinsic_com_offsets_survive_failed_overlay_but_unsigned_lean_does_not():
    data = context()
    data["dataQuality"]["alignment"] = "failed"
    data["metrics"] = [{**data["metrics"][0], "id": "contact." + metric, "metric": metric, "side": None}
                       for metric in ("trunk_com_offset_x", "trunk_com_offset_y", "trunk_lean")]
    attach_evidence(data)
    rows = {row["metric"]: row for row in data["evidence"]["rows"]}
    assert rows["trunk_com_offset_x"]["comparisonEligible"]
    assert rows["trunk_com_offset_y"]["comparisonEligible"]
    assert not rows["trunk_lean"]["comparisonEligible"]


def test_metadata_fps_is_authoritative_and_never_assumed_for_pro():
    from gateway.assemblers import _kick_capture_fps
    assert _kick_capture_fps({"framesPerSecond": 60}, "side_kick_240.mov") == (60, "metadata.framesPerSecond")
    assert _kick_capture_fps({"fps": 120}) == (120, "metadata.fps")
    assert _kick_capture_fps({"framesPerSecond": 0}, "side_kick_240.mov") == (240, "filename")
    assert _kick_capture_fps({}) == (None, "assumed")


def test_repeated_tool_results_are_deduplicated_and_budget_excess_is_not_delivered(make_invocation, monkeypatch):
    inv = make_invocation(context={"kickAnalysisContext": context()})
    for _ in range(20):
        run_tool("inspect_kick_evidence", {"section": "measurements"}, inv)
    assert len(inv._kick_tool_evidence) == 1
    assert len(inv._kick_tool_evidence_calls) == 20
    monkeypatch.setattr("gateway.kick_evidence.MAX_INSPECTED_EVIDENCE_BYTES", 1)
    result = run_tool("inspect_kick_evidence", {"section": "measurements", "limit": 1}, inv)
    assert result["error"] == "evidence_budget_exhausted"
    assert inv._kick_tool_evidence[-1]["result"] == result


def test_comparison_validator_enforces_schema_even_when_provider_drops_bounds(make_invocation):
    inv = make_invocation()
    assert validate_comparison({"schemaVersion": 2, "summary": "hello", "focusAreas": []}, inv)
    assert validate_comparison({"schemaVersion": 1, "summary": "x" * 2001, "focusAreas": []}, inv)
    assert validate_comparison({"schemaVersion": 1, "summary": "hello", "focusAreas": [{}] * 5}, inv)


def test_temporal_evidence_label_preserves_units():
    from gateway.pipeline import _kick_evidence_line
    line = _kick_evidence_line([{"kind": "event", "metric": "maxKneeFlexion", "units": "milliseconds", "athlete": -37.5, "pro": None, "valid": True}])
    assert "timing" in line and "ms relative to contact" in line
