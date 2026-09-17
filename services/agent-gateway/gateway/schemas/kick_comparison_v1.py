"""Model-authored portion of a deterministic bilateral kick comparison."""
KICK_COMPARISON_V1_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["schemaVersion", "summary", "focusAreas"],
    "properties": {
        "schemaVersion": {"type": "integer", "enum": [1]},
        "summary": {"type": "string", "minLength": 1, "maxLength": 2000},
        "focusAreas": {"type": "array", "minItems": 0, "maxItems": 4, "items": {
            "type": "object", "additionalProperties": False,
            "required": ["rank", "title", "observation", "cue", "whyItMatters", "evidenceIds"],
            "properties": {
                "rank": {"type": "integer", "minimum": 1, "maximum": 4},
                "title": {"type": "string", "minLength": 1, "maxLength": 160},
                "observation": {"type": "string", "minLength": 1, "maxLength": 1600},
                "cue": {"type": "string", "minLength": 1, "maxLength": 300},
                "whyItMatters": {"type": "string", "minLength": 1, "maxLength": 1600},
                "evidenceIds": {"type": "array", "minItems": 1, "maxItems": 12,
                                "items": {"type": "string"}},
            },
        }},
    },
}
