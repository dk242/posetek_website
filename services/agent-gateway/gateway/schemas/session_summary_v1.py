"""JSON Schema for the `session_summary` capability's result (contract §5):
`{"schemaVersion": 1, "summary": "...", "highlights": ["..."]}`. Same flat, `$ref`/`oneOf`-free
shape as `report_v1.py` for the same reason — shared by both structured-output providers.
"""

from __future__ import annotations

SESSION_SUMMARY_V1_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "required": ["schemaVersion", "summary", "highlights"],
    "properties": {
        "schemaVersion": {"type": "integer", "enum": [1]},
        "summary": {"type": "string", "maxLength": 900},
        "highlights": {"type": "array", "items": {"type": "string"}},
    },
}
