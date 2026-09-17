"""Schema shape tests: no $ref/oneOf anywhere (both structured-output providers choke on them),
additionalProperties: false enforced at every object level, and the expected top-level fields."""

from __future__ import annotations

import pytest

from gateway.schemas import get_json_schema


def _walk(schema, path="$"):
    """Yields (path, node) for every dict node in the schema tree."""
    if isinstance(schema, dict):
        yield path, schema
        for key, value in schema.items():
            yield from _walk(value, f"{path}.{key}")
    elif isinstance(schema, list):
        for i, item in enumerate(schema):
            yield from _walk(item, f"{path}[{i}]")


def test_unknown_schema_key_raises():
    with pytest.raises(KeyError):
        get_json_schema("not_a_real_schema")


def test_get_json_schema_returns_a_copy_not_the_shared_constant():
    a = get_json_schema("report_v1")
    a["properties"]["headline"]["maxLength"] = 999999
    b = get_json_schema("report_v1")
    assert b["properties"]["headline"]["maxLength"] != 999999


_ALL_KEYS = [
    "report_v1", "session_summary_v1", "kick_observations_v1", "kick_focus_v1",
    "plan_assessment_v1", "plan_allocation_v1", "plan_week_v1", "workout_v1",
]


@pytest.mark.parametrize("key", _ALL_KEYS)
def test_schema_has_no_refs_or_oneof(key):
    schema = get_json_schema(key)
    for path, node in _walk(schema):
        assert "$ref" not in node, f"{path} uses $ref"
        assert "oneOf" not in node, f"{path} uses oneOf"
        assert "anyOf" not in node, f"{path} uses anyOf"


@pytest.mark.parametrize("key", _ALL_KEYS)
def test_every_object_node_forbids_additional_properties(key):
    schema = get_json_schema(key)
    for path, node in _walk(schema):
        if node.get("type") == "object":
            assert node.get("additionalProperties") is False, f"{path} allows additionalProperties"


def test_plan_allocation_v1_top_level_shape():
    schema = get_json_schema("plan_allocation_v1")
    assert set(schema["required"]) == {"schemaVersion", "planSummary", "weeks"}
    week = schema["properties"]["weeks"]["items"]
    assert set(week["required"]) == {"weekNumber", "theme", "intensityNote", "allocations"}
    # The model never emits the retest week: numbering caps at horizon-1.
    assert week["properties"]["weekNumber"]["maximum"] == 11
    assert schema["properties"]["weeks"]["maxItems"] == 11


def test_plan_week_v1_top_level_shape():
    schema = get_json_schema("plan_week_v1")
    assert set(schema["required"]) == {"weekNumber", "focus", "progressionNote", "drills"}
    drill = schema["properties"]["drills"]["items"]
    # weeklyMinutes is server-computed, never a model output field.
    assert "weeklyMinutes" not in drill["properties"]


def test_report_v1_top_level_shape():
    schema = get_json_schema("report_v1")
    assert schema["type"] == "object"
    assert set(schema["required"]) == {
        "schemaVersion", "generatedAt", "audience", "headline", "summary", "overallScore",
        "benchmarkContext", "strengths", "focusAreas", "metricCallouts", "prescriptions",
        "nextSteps", "disclaimers",
    }
    assert schema["properties"]["strengths"]["maxItems"] == 4
    assert schema["properties"]["focusAreas"]["maxItems"] == 4
    assert schema["properties"]["prescriptions"]["maxItems"] == 6
    assert schema["properties"]["summary"]["maxLength"] == 900


def test_session_summary_v1_top_level_shape():
    schema = get_json_schema("session_summary_v1")
    assert schema["type"] == "object"
    assert set(schema["required"]) == {"schemaVersion", "summary", "highlights"}
