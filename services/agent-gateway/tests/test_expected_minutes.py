import json
from pathlib import Path

import pytest

from gateway.errors import GatewayError
from gateway.workout_time import arithmetic_block, estimate_block, estimate_workout

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "expected_minutes_fixture.json").read_text())
NEGATIVE_CASES = {"seconds-per-rep-rest", "max-clamp"}


@pytest.mark.parametrize("case", FIXTURE["blocks"], ids=lambda case: case["id"])
def test_shared_arithmetic_and_prescription_validity(case):
    assert arithmetic_block(case["input"]) == case["expected"]
    if case["id"] in NEGATIVE_CASES:
        with pytest.raises(GatewayError):
            estimate_block(case["input"])
    else:
        assert estimate_block(case["input"]) == case["expected"]


@pytest.mark.parametrize("case", FIXTURE["workouts"], ids=lambda case: case["id"])
def test_shared_workout_transition_fixture(case):
    inputs = {row["id"]: row["input"] for row in FIXTURE["blocks"]}
    result = estimate_workout([inputs[key] for key in case["blockCaseIds"]])
    assert [b["estimatedMinutes"] for b in result["blocks"]] == case["expected"]["blockMinutes"]
    assert result["estimatedMinutes"] == case["expected"]["estimatedMinutes"]
    assert result["transitionMinutes"] == case["expected"]["transitionMinutes"]


@pytest.mark.parametrize("field,value", [("sets", True), ("sets", 0), ("reps", 1.5), ("reps", float("nan")),
                                          ("restSeconds", -1), ("restSeconds", False), ("repUnit", "laps"),
                                          ("perSide", 1), ("restScope", None), ("restScope", "efforts"),
                                          ("restBetweenSetsSeconds", True), ("familiarizationReps", -1)])
def test_invalid_numeric_and_unit_inputs(field, value):
    block = dict(FIXTURE["blocks"][0]["input"], **{field: value})
    with pytest.raises(GatewayError):
        estimate_block(block)


@pytest.mark.parametrize("unit", ["seconds", "minutes", "meters"])
def test_duration_familiarization_is_rejected(unit):
    with pytest.raises(GatewayError):
        estimate_block({"sets": 1, "reps": 2, "repUnit": unit, "restSeconds": 0, "familiarizationReps": 1})
