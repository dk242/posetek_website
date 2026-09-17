"""JSON Schema for the `build_workout` capability's single stage (contract §9d; normative doc
shape is TRAINING_PLAN_DATA_MODEL_PLAN.md Part 1 `plannedWorkouts`). The finalizer composes the
durable doc from this output plus params/context — the model never emits server bookkeeping
fields (`workoutId`, `playerId`, `planId`, `weekNumber`, `jobId`, `generatedAt`, `catalogVersion`,
`params`).

Same flat, `$ref`/`oneOf`-free shape as `training_plan_v1.py` for the same reason (shared by both
structured-output providers). Domain/rep-unit/measured-drill vocabularies are imported rather than
redeclared so the two schemas can never drift on shared enums.
"""

from __future__ import annotations

from gateway.schemas.training_plan_v1 import MEASURED_DRILLS, PLAN_DOMAINS, REP_UNITS

BLOCK_KINDS = ["warmup", "main", "game"]

# `"type": ["string", "null"]` — see report_v1.py's nullable-field note; `measuredDrillType` is
# non-null exactly when `isMeasuredDrill` is true (validators.py checks the pairing, not the
# schema — a plain type union can't express a cross-field "iff").
_NULLABLE_STRING = {"type": ["string", "null"]}

_WORKOUT_BLOCK = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "blockId", "order", "kind", "drillId", "name", "domain", "sets", "reps", "repUnit",
        "restSeconds", "estimatedMinutes", "cues", "whyIncluded", "isMeasuredDrill", "measuredDrillType",
    ],
    "properties": {
        "blockId": {"type": "string"},
        "order": {"type": "integer", "minimum": 1, "maximum": 8},
        "kind": {"type": "string", "enum": BLOCK_KINDS},
        # Catalog drill id, e.g. "STR-010" — must be one of workoutCandidates.drills (validator).
        "drillId": {"type": "string"},
        # Denormalized display fields, copied verbatim from the candidate (TRAINING_PLAN_DATA_MODEL_PLAN
        # Part 0 decision 5 applies to workouts too).
        "name": {"type": "string"},
        "domain": {"type": "string", "enum": PLAN_DOMAINS},
        "sets": {"type": "integer", "minimum": 1, "maximum": 10},
        "reps": {"type": "number", "minimum": 1},
        "repUnit": {"type": "string", "enum": REP_UNITS},
        "restSeconds": {"type": "integer", "minimum": 0, "maximum": 600},
        "estimatedMinutes": {"type": "integer", "minimum": 1, "maximum": 60},
        "cues": {"type": "array", "maxItems": 4, "items": {"type": "string", "maxLength": 80}},
        "whyIncluded": {"type": "string", "maxLength": 200},
        "isMeasuredDrill": {"type": "boolean"},
        # One of the app's recordable drill ids (MEASURED_DRILLS) when isMeasuredDrill, else null.
        "measuredDrillType": _NULLABLE_STRING,
    },
}

WORKOUT_V1_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "required": ["schemaVersion", "estimatedMinutes", "intro", "blocks", "stopRule"],
    "properties": {
        "schemaVersion": {"type": "integer", "enum": [1]},
        "estimatedMinutes": {"type": "integer", "minimum": 1, "maximum": 180},
        "intro": {"type": "string", "maxLength": 300},
        "blocks": {"type": "array", "minItems": 1, "maxItems": 8, "items": _WORKOUT_BLOCK},
        "stopRule": {"type": "string", "maxLength": 300},
    },
}

# Re-exported so validators.py / tests can import the measured-drill vocabulary from this module
# without reaching back into training_plan_v1 themselves.
__all__ = ["WORKOUT_V1_SCHEMA", "BLOCK_KINDS", "MEASURED_DRILLS"]
