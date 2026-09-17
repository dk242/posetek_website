"""JSON Schemas for the `generate_training_plan` capability's stages (contract §9c;
normative doc shape is TRAINING_PLAN_DATA_MODEL_PLAN.md Part 1, v2 pipeline shape is
PLAN_GENERATION_V2_PLAN.md). Flat and `$ref`/`oneOf`-free like every other schema here, so
both structured-output providers can consume them.

Stage 1 (`assess`) emits findings + focus areas + carried-forward reasoning; stage 2
(`allocate`) emits the per-week minute-by-domain strategy; stage 3 (`fill`, run once per
training week) emits one week's drill prescriptions. The finalizer composes the durable
`trainingPlans` doc from all of them plus the intake echo — the model never emits server
bookkeeping fields, and `weeklyMinutes` (estimatedMinutes x frequencyPerWeek) is computed
by the gateway, never emitted.

The old single-shot `training_plan_v1` output schema (one 16k-token emission of the whole
plan) is retired — its `_PLAN_DRILL` row lives on unchanged as `plan_week_v1`'s row shape,
and the persisted doc's shape is documented in the data-model plan and contract, not here.
"""

from __future__ import annotations

PLAN_DOMAINS = [
    "linearSpeed", "verticalPower", "horizontalPower", "codAgility", "dribbling",
    "passingReceiving", "shooting", "strengthResilience", "representativeGames",
]

# App repType vocabulary — the only drills a retest can prescribe (they're recordable).
MEASURED_DRILLS = ["sprint", "jump", "broadJump", "changeOfDirection", "dribbling", "deadballShot"]

REP_UNITS = ["reps", "seconds", "contacts", "meters", "minutes", "cues", "passes", "shots"]

_FINDING = {
    "type": "object",
    "additionalProperties": False,
    "required": ["ruleId", "domain", "metricIds", "confidence", "statement"],
    "properties": {
        "ruleId": {"type": "string"},
        "domain": {"type": "string", "enum": PLAN_DOMAINS},
        "metricIds": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "string", "enum": ["low", "moderate", "high"]},
        "statement": {"type": "string", "maxLength": 300},
    },
}

PLAN_ASSESSMENT_V1_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "required": ["schemaVersion", "summary", "findings", "dataGaps", "focusAreas", "reasoning"],
    "properties": {
        "schemaVersion": {"type": "integer", "enum": [1]},
        "summary": {"type": "string", "maxLength": 600},
        "findings": {"type": "array", "maxItems": 8, "items": _FINDING},
        "dataGaps": {"type": "array", "items": {"type": "string", "maxLength": 200}},
        "focusAreas": {
            "type": "array",
            "minItems": 1,
            "maxItems": 3,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["domain", "rationale"],
                "properties": {
                    "domain": {"type": "string", "enum": PLAN_DOMAINS},
                    "rationale": {"type": "string", "maxLength": 300},
                },
            },
        },
        "reasoning": {"type": "string", "maxLength": 2000},
    },
}

_PLAN_DRILL = {
    "type": "object",
    "additionalProperties": False,
    "required": ["drillId", "name", "domain", "sets", "reps", "repUnit", "restSeconds",
                 "frequencyPerWeek", "intensityIntent", "estimatedMinutes", "cues", "note"],
    "properties": {
        "drillId": {"type": "string"},
        "name": {"type": "string"},
        "domain": {"type": "string", "enum": PLAN_DOMAINS},
        "sets": {"type": "integer", "minimum": 1, "maximum": 10},
        "reps": {"type": "number", "minimum": 1},
        "repUnit": {"type": "string", "enum": REP_UNITS},
        "restSeconds": {"type": "integer", "minimum": 0, "maximum": 600},
        "frequencyPerWeek": {"type": "integer", "minimum": 1, "maximum": 7},
        "intensityIntent": {"type": "string", "enum": ["low", "moderate", "high", "maxQuality"]},
        "estimatedMinutes": {"type": "integer", "minimum": 1, "maximum": 90},
        "cues": {"type": "array", "maxItems": 4, "items": {"type": "string", "maxLength": 80}},
        "note": {"type": "string", "maxLength": 200},
    },
}

# The intake's plan-length slider offers 4..12 weeks; the final week is the
# code-stamped retest week (PLAN_GENERATION_V2_PLAN decision 6), so the model
# stages only ever see/emit weeks 1..horizonWeeks-1.
HORIZON_WEEKS_MIN = 4
HORIZON_WEEKS_MAX = 12
_TRAINING_WEEKS_MIN = HORIZON_WEEKS_MIN - 1
_TRAINING_WEEKS_MAX = HORIZON_WEEKS_MAX - 1

# One domain's minute budget within one week. The 600-minute ceiling is just an
# absurdity bound (10 h/week on one domain); the real arithmetic — sums vs the
# athlete's weekly budget, the minimum block size — is validator work.
_ALLOCATION = {
    "type": "object",
    "additionalProperties": False,
    "required": ["domain", "minutes"],
    "properties": {
        "domain": {"type": "string", "enum": PLAN_DOMAINS},
        "minutes": {"type": "integer", "minimum": 1, "maximum": 600},
    },
}

_ALLOCATION_WEEK = {
    "type": "object",
    "additionalProperties": False,
    "required": ["weekNumber", "theme", "intensityNote", "allocations"],
    "properties": {
        "weekNumber": {"type": "integer", "minimum": 1, "maximum": _TRAINING_WEEKS_MAX},
        "theme": {"type": "string", "maxLength": 80},
        # How hard relative to this athlete's level, and what progresses vs last
        # week — the strategy note the fill stage takes as marching orders.
        "intensityNote": {"type": "string", "maxLength": 300},
        "allocations": {"type": "array", "minItems": 1, "maxItems": 5, "items": _ALLOCATION},
    },
}

# Stage 2 (`allocate`): the whole block's strategy in one small emission — the
# week x domain minute matrix plus intensity guidance, weeks 1..horizon-1.
PLAN_ALLOCATION_V1_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "required": ["schemaVersion", "planSummary", "weeks"],
    "properties": {
        "schemaVersion": {"type": "integer", "enum": [1]},
        "planSummary": {"type": "string", "maxLength": 600},
        "weeks": {"type": "array", "minItems": _TRAINING_WEEKS_MIN,
                  "maxItems": _TRAINING_WEEKS_MAX, "items": _ALLOCATION_WEEK},
    },
}

# Stage 3 (`fill`, one call per training week): one week's prescriptions against
# that week's allocation row. `theme`/`intensityNote` live on the allocation and
# are merged by the finalizer; `targets` are derived in code from
# frequencyPerWeek sums, so the fill emission is drills + the two copy fields.
PLAN_WEEK_V1_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "required": ["weekNumber", "focus", "progressionNote", "drills"],
    "properties": {
        "weekNumber": {"type": "integer", "minimum": 1, "maximum": _TRAINING_WEEKS_MAX},
        "focus": {"type": "string", "maxLength": 300},
        "progressionNote": {"type": "string", "maxLength": 300},
        "drills": {"type": "array", "minItems": 1, "maxItems": 8, "items": _PLAN_DRILL},
    },
}
