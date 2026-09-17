"""JSON Schemas for the `kick_analysis` capability's two stage outputs (contract §9b):
`kick_observations_v1` (stage 1 — every noticed problem area) and `kick_focus_v1` (stage 2 — the
zero to four supported walkthrough priorities). Same flat, `$ref`/`oneOf`-free shape as `report_v1.py` for the same
reason — shared by both structured-output providers.

Cross-referential constraints (metricIds ⊆ the deterministic table's valid rows, observationId ⊆
stage-1 ids, evidence eligibility, cue word count) can't be expressed in this schema subset — they
live in `validators.py` under the same keys.
"""

from __future__ import annotations

_FRAME_KEY = {"type": "string", "enum": ["backswing", "contact", "followThrough"]}

KICK_OBSERVATIONS_V1_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "required": ["schemaVersion", "observations"],
    "properties": {
        "schemaVersion": {"type": "integer", "enum": [1]},
        "observations": {
            "type": "array",
            "minItems": 0,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "id",
                    "frameKey",
                    "bodyRegion",
                    "title",
                    "severity",
                    "deviationDirection",
                    "metricIds",
                    "observation",
                    "reasoning",
                ],
                "properties": {
                    "id": {"type": "string"},
                    "frameKey": dict(_FRAME_KEY),
                    "bodyRegion": {
                        "type": "string",
                        "enum": [
                            "kickingLeg",
                            "supportLeg",
                            "hips",
                            "trunk",
                            "arms",
                            "footPosition",
                            "balance",
                        ],
                    },
                    "title": {"type": "string"},
                    "severity": {"type": "integer", "minimum": 1, "maximum": 5},
                    # Machine-checkable statement of which way the athlete deviates on the cited
                    # rows (delta = athlete - pro). Validated against the actual delta signs so
                    # prose like "too bent"/"too straight" can never invert the data (v2).
                    "deviationDirection": {
                        "type": "string",
                        "enum": ["athleteHigher", "athleteLower", "mixed", "notComparable"],
                    },
                    "metricIds": {"type": "array", "minItems": 0, "items": {"type": "string"}},
                    "evidenceIds": {"type": "array", "items": {"type": "string"}},
                    "observation": {"type": "string"},
                    "reasoning": {"type": "string"},
                },
            },
        },
    },
}

KICK_FOCUS_V1_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "required": ["schemaVersion", "focusAreas"],
    "properties": {
        "schemaVersion": {"type": "integer", "enum": [1]},
        "focusAreas": {
            "type": "array",
            "minItems": 0,
            "maxItems": 4,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "observationId",
                    "rank",
                    "frameKey",
                    "title",
                    "cue",
                    "whyItMatters",
                    "metricIds",
                ],
                "properties": {
                    "observationId": {"type": "string"},
                    "rank": {"type": "integer", "minimum": 1},
                    "frameKey": dict(_FRAME_KEY),
                    "title": {"type": "string"},
                    "cue": {"type": "string"},
                    "whyItMatters": {"type": "string"},
                    "metricIds": {"type": "array", "minItems": 0, "items": {"type": "string"}},
                    "evidenceIds": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
    },
}
