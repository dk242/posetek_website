"""Lookup for the gateway's versioned JSON output schemas."""

from __future__ import annotations

import copy

from gateway.schemas.kick_analysis_v1 import KICK_FOCUS_V1_SCHEMA, KICK_OBSERVATIONS_V1_SCHEMA
from gateway.schemas.kick_comparison_v1 import KICK_COMPARISON_V1_SCHEMA
from gateway.schemas.report_v1 import REPORT_V1_SCHEMA
from gateway.schemas.session_summary_v1 import SESSION_SUMMARY_V1_SCHEMA
from gateway.schemas.training_plan_v1 import (
    PLAN_ALLOCATION_V1_SCHEMA,
    PLAN_ASSESSMENT_V1_SCHEMA,
    PLAN_WEEK_V1_SCHEMA,
)
from gateway.schemas.workout_v1 import WORKOUT_V1_SCHEMA

_SCHEMAS: dict[str, dict] = {
    "report_v1": REPORT_V1_SCHEMA,
    "session_summary_v1": SESSION_SUMMARY_V1_SCHEMA,
    "kick_observations_v1": KICK_OBSERVATIONS_V1_SCHEMA,
    "kick_focus_v1": KICK_FOCUS_V1_SCHEMA,
    "kick_comparison_v1": KICK_COMPARISON_V1_SCHEMA,
    "plan_assessment_v1": PLAN_ASSESSMENT_V1_SCHEMA,
    "plan_allocation_v1": PLAN_ALLOCATION_V1_SCHEMA,
    "plan_week_v1": PLAN_WEEK_V1_SCHEMA,
    "workout_v1": WORKOUT_V1_SCHEMA,
}


def get_json_schema(key: str) -> dict:
    """Returns a deep copy of the named schema so a caller (e.g. a provider adapter translating
    it into a provider-specific shape) can freely mutate its copy without corrupting the shared
    module-level constant for the next invocation.

    Raises `KeyError` — schema keys are an internal registry lookup used by pipeline code, not
    client-facing input, so this isn't a `GatewayError`/contract error code.
    """
    if key not in _SCHEMAS:
        raise KeyError(f"Unknown schema key '{key}'")
    return copy.deepcopy(_SCHEMAS[key])
