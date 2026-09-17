"""Validator tests — one per violation class the contract §9 mandates, plus a fully-valid report
that must come back clean."""

from __future__ import annotations

import copy

from gateway.validators import VALIDATORS, validate_report_v1

STATS_PROFILE = {
    "schemaVersion": 1,
    "overallScore": 87.4,
    "benchmarkProfile": {"ageBand": "u16", "gender": "male", "isDefaulted": False},
    "totalReps": 10,
    "totalSessions": 3,
    "axes": [],
    "drills": [{
        "drill": "sprint", "score": 88.0, "repCount": 8, "sessionCount": 3, "lastRecorded": "2026-07-30T18:22:04Z",
        "metrics": [{
            "metric": "sprintMaxAcceleration", "score": 71.0, "band": "developing",
            "bestCanonical": 4.6, "latestCanonical": 4.6, "referenceCanonical": 6.5,
            "bestFormatted": "4.6 m/s²", "referenceFormatted": "6.5 m/s²",
            "unitLabel": "m/s²", "repCount": 8, "scoreDelta": 0.0,
        }],
    }],
}


def _valid_report() -> dict:
    return {
        "schemaVersion": 1,
        "generatedAt": "2026-08-01T12:00:00Z",
        "audience": "parent",
        "headline": "Strong power base, acceleration is the gap",
        "summary": "A short parent-readable summary.",
        "overallScore": 87.4,
        "benchmarkContext": {"ageBand": "u16", "gender": "male", "isDefaulted": False, "sourceNote": "Measured D1 data."},
        "strengths": [],
        "focusAreas": [{"title": "Acceleration", "detail": "…", "metricIds": ["sprintMaxAcceleration"], "priority": 1}],
        "metricCallouts": [{
            "metricId": "sprintMaxAcceleration", "score": 71.0, "band": "developing",
            "valueFormatted": "4.6 m/s²", "referenceFormatted": "6.5 m/s²", "comment": "…",
        }],
        "prescriptions": [{
            "drillId": "catalog_wall_drives_01", "name": "Wall drives", "targetQuality": "acceleration",
            "rationale": "…", "dosage": {"sets": 3, "reps": 6, "durationMinutes": None, "frequencyPerWeek": 2},
            "cautions": [],
        }],
        "nextSteps": ["Record a broad jump to complete the Power axis."],
        "disclaimers": [],
    }


def _invocation(make_invocation, *, candidate_drill_ids=None, benchmark_source="measured"):
    return make_invocation(
        params={"statsProfile": STATS_PROFILE},
        context={
            "candidateDrillIds": candidate_drill_ids if candidate_drill_ids is not None else {"catalog_wall_drives_01"},
            "benchmarkContext": {"source": benchmark_source},
        },
    )


def test_registry_exposes_report_v1():
    assert VALIDATORS["report_v1"] is validate_report_v1


def test_valid_report_has_no_violations(make_invocation):
    inv = _invocation(make_invocation)
    assert validate_report_v1(_valid_report(), inv) == []


def test_unknown_metric_id_in_focus_areas_is_flagged(make_invocation):
    report = _valid_report()
    report["focusAreas"][0]["metricIds"] = ["sprintPower"]
    inv = _invocation(make_invocation)

    violations = validate_report_v1(report, inv)

    assert any("focusAreas[0].metricIds" in v and "sprintPower" in v for v in violations)


def test_metric_callout_not_in_stats_profile_is_flagged(make_invocation):
    report = _valid_report()
    report["metricCallouts"][0]["metricId"] = "verticalJumpHeight"  # known metric, but not in STATS_PROFILE
    inv = _invocation(make_invocation)

    violations = validate_report_v1(report, inv)

    assert any("not present in the submitted stats profile" in v for v in violations)


def test_mislabeled_band_is_flagged(make_invocation):
    report = _valid_report()
    report["metricCallouts"][0]["band"] = "elite"  # score 71.0 actually maps to "developing"
    inv = _invocation(make_invocation)

    violations = validate_report_v1(report, inv)

    assert any("maps to 'developing'" in v for v in violations)


def test_prescription_outside_candidate_set_is_flagged(make_invocation):
    report = _valid_report()
    inv = _invocation(make_invocation, candidate_drill_ids=set())  # nothing is safe for this athlete

    violations = validate_report_v1(report, inv)

    assert any("prescriptions[0].drillId" in v and "candidate drill set" in v for v in violations)


def test_too_many_strengths_is_flagged(make_invocation):
    report = _valid_report()
    report["strengths"] = [
        {"title": f"S{i}", "detail": "…", "metricIds": []} for i in range(5)
    ]
    inv = _invocation(make_invocation)

    violations = validate_report_v1(report, inv)

    assert any("strengths has 5 items" in v for v in violations)


def test_summary_over_char_limit_is_flagged(make_invocation):
    report = _valid_report()
    report["summary"] = "x" * 901
    inv = _invocation(make_invocation)

    violations = validate_report_v1(report, inv)

    assert any("901 characters" in v for v in violations)


def test_missing_provisional_disclaimer_is_flagged_when_defaulted(make_invocation):
    report = _valid_report()
    report["benchmarkContext"]["isDefaulted"] = True
    report["disclaimers"] = []
    inv = _invocation(make_invocation, benchmark_source="measured")

    violations = validate_report_v1(report, inv)

    assert any("disclaimers must include the provisional-benchmark note" in v for v in violations)


def test_provisional_disclaimer_present_passes(make_invocation):
    report = _valid_report()
    report["benchmarkContext"]["isDefaulted"] = True
    report["disclaimers"] = ["Reference values are provisional and not yet measured."]
    inv = _invocation(make_invocation, benchmark_source="measured")

    violations = validate_report_v1(report, inv)

    assert not any("disclaimers" in v for v in violations)


def test_provisional_benchmark_source_also_requires_disclaimer(make_invocation):
    report = _valid_report()
    report["disclaimers"] = []
    inv = _invocation(make_invocation, benchmark_source="provisional")

    violations = validate_report_v1(report, inv)

    assert any("disclaimers must include the provisional-benchmark note" in v for v in violations)


def test_does_not_mutate_input_report(make_invocation):
    report = _valid_report()
    original = copy.deepcopy(report)
    inv = _invocation(make_invocation)

    validate_report_v1(report, inv)

    assert report == original
