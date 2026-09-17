"""JSON Schema for `ReportV1` (contract §9), field-for-field.

Flat and `$ref`/`oneOf`-free by design: it's passed as-is both to Gemini's `response_schema`
(an OpenAPI-3-ish subset) and to an Anthropic tool-style structured-output call, and neither
provider's structured-output mode reliably supports refs or union-of-schemas ("no $ref, no
oneOf" — the caller's spec). Every object sets `additionalProperties: False` so the model can't
smuggle extra fields into a rendered report.

`dosage`'s four fields use `"type": ["integer", "null"]` (plain JSON Schema's way of saying
"integer or null", matching the contract's `"durationMinutes": null` example) rather than a
`oneOf`/`anyOf` union. This is valid JSON Schema but not universally how every provider spells
nullable (Gemini prefers a separate `"nullable": true` flag on an OpenAPI-style schema); adapting
that translation, if needed, is the provider adapter's job (`gateway/providers/*`, not owned by
this module) — `get_json_schema` returns the one canonical shape both providers translate from.
"""

from __future__ import annotations

_NULLABLE_INT = {"type": ["integer", "null"]}

REPORT_V1_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "generatedAt",
        "audience",
        "headline",
        "summary",
        "overallScore",
        "benchmarkContext",
        "strengths",
        "focusAreas",
        "metricCallouts",
        "prescriptions",
        "nextSteps",
        "disclaimers",
    ],
    "properties": {
        "schemaVersion": {"type": "integer", "enum": [1]},
        "generatedAt": {"type": "string", "description": "ISO 8601 timestamp."},
        "audience": {"type": "string", "enum": ["parent", "player", "coach"]},
        "headline": {"type": "string", "maxLength": 120},
        "summary": {"type": "string", "maxLength": 900},
        "overallScore": {"type": "number"},
        "benchmarkContext": {
            "type": "object",
            "additionalProperties": False,
            "required": ["ageBand", "gender", "isDefaulted", "sourceNote"],
            "properties": {
                "ageBand": {"type": "string", "enum": ["u12", "u14", "u16", "u18", "senior"]},
                "gender": {"type": "string", "enum": ["male", "female", "unspecified"]},
                "isDefaulted": {"type": "boolean"},
                "sourceNote": {"type": "string"},
            },
        },
        "strengths": {
            "type": "array",
            "maxItems": 4,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["title", "detail", "metricIds"],
                "properties": {
                    "title": {"type": "string"},
                    "detail": {"type": "string"},
                    "metricIds": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
        "focusAreas": {
            "type": "array",
            "maxItems": 4,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["title", "detail", "metricIds", "priority"],
                "properties": {
                    "title": {"type": "string"},
                    "detail": {"type": "string"},
                    "metricIds": {"type": "array", "items": {"type": "string"}},
                    "priority": {"type": "integer"},
                },
            },
        },
        "metricCallouts": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["metricId", "score", "band", "valueFormatted", "referenceFormatted", "comment"],
                "properties": {
                    "metricId": {"type": "string"},
                    "score": {"type": "number"},
                    "band": {"type": "string", "enum": ["elite", "approaching", "developing", "earlyStage"]},
                    "valueFormatted": {"type": "string"},
                    "referenceFormatted": {"type": "string"},
                    "comment": {"type": "string"},
                },
            },
        },
        "prescriptions": {
            "type": "array",
            "maxItems": 6,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["drillId", "name", "targetQuality", "rationale", "dosage", "cautions"],
                "properties": {
                    "drillId": {"type": "string"},
                    "name": {"type": "string"},
                    "targetQuality": {"type": "string"},
                    "rationale": {"type": "string"},
                    "dosage": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["sets", "reps", "durationMinutes", "frequencyPerWeek"],
                        "properties": {
                            "sets": _NULLABLE_INT,
                            "reps": _NULLABLE_INT,
                            "durationMinutes": _NULLABLE_INT,
                            "frequencyPerWeek": _NULLABLE_INT,
                        },
                    },
                    "cautions": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
        "nextSteps": {"type": "array", "items": {"type": "string"}},
        "disclaimers": {"type": "array", "items": {"type": "string"}},
    },
}
