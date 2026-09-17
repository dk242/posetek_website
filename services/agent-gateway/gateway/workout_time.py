"""Contract v2 expected-time arithmetic and executable-input validation.

The shared fixture includes two deliberately invalid prescriptions. Arithmetic
parity is available separately; normal callers always use the strict estimator.
"""
from __future__ import annotations

from gateway.errors import invalid_request

FORMULA_VERSION = "expected-minutes-v1-01A"
WORK_DECISECONDS = {"reps": 80, "contacts": 20, "cues": 50, "passes": 100,
                     "shots": 150, "seconds": 10, "minutes": 600, "meters": 6}
DURATION_UNITS = frozenset({"seconds", "minutes", "meters"})
TIME_FIELDS = frozenset({"sets", "reps", "repUnit", "perSide", "restSeconds", "restScope",
                         "restBetweenSetsSeconds", "familiarizationReps"})


def integer(value, name: str, minimum: int = 0, maximum: int = 1000000) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise invalid_request(f"{name} must be an integer in {minimum}..{maximum}")
    return value


def arithmetic_block(block: dict) -> dict:
    """Literal fixture arithmetic; not permission to prescribe the input."""
    sets, reps = block["sets"], block["reps"]
    unit = block["repUnit"]
    rest = block.get("restSeconds", 0) * 10
    between = block.get("restBetweenSetsSeconds")
    between = rest if between is None else between * 10
    one_set = WORK_DECISECONDS[unit] * reps
    if block.get("restScope", "sets") == "reps":
        one_set += rest * (reps - 1)
    ds = sets * one_set + between * (sets - 1)
    ds += (block.get("familiarizationReps") or 0) * (WORK_DECISECONDS[unit] + rest)
    if block.get("perSide", False):
        ds *= 2
    return {"deciseconds": ds, "estimatedMinutes": max(1, min(90, (ds + 599) // 600))}


def estimate_block(block: dict) -> dict:
    if not isinstance(block, dict):
        raise invalid_request("A time block must be an object")
    integer(block.get("sets"), "sets", 1)
    integer(block.get("reps"), "reps", 1)
    integer(block.get("restSeconds"), "restSeconds")
    if block.get("repUnit") not in WORK_DECISECONDS:
        raise invalid_request("Unknown repUnit")
    if type(block.get("perSide", False)) is not bool:
        raise invalid_request("perSide must be a boolean")
    scope = block.get("restScope", "sets")
    if scope not in ("sets", "reps"):
        raise invalid_request("restScope must be sets or reps")
    between = block.get("restBetweenSetsSeconds")
    if between is not None:
        integer(between, "restBetweenSetsSeconds")
    familiar = block.get("familiarizationReps", 0)
    familiar = 0 if familiar is None else integer(familiar, "familiarizationReps")
    if block["repUnit"] in DURATION_UNITS and (scope == "reps" or familiar):
        raise invalid_request("Duration/distance sets cannot have per-rep rest or familiarization reps")
    result = arithmetic_block(block)
    if result["deciseconds"] > 54000:
        raise invalid_request("A block exceeds 90 actual minutes before estimator saturation")
    return result


def estimate_workout(blocks: list[dict]) -> dict:
    if not isinstance(blocks, list) or len(blocks) > 12:
        raise invalid_request("blocks must be a list with at most 12 entries")
    estimates = [estimate_block(block) for block in blocks]
    transition = max(0, len(blocks) - 1)
    return {"blocks": estimates, "transitionMinutes": transition,
            "estimatedMinutes": sum(b["estimatedMinutes"] for b in estimates) + transition}


def resolved_catalog_dose(dose: dict, *, maximum: bool | None = None) -> dict:
    """Concrete min/max/midpoint defaults, retaining all stored formula inputs."""
    if not isinstance(dose, dict):
        raise invalid_request("Catalog dose is missing")
    def point(name, minimum=1):
        low = integer(dose.get(name + "Min"), name + "Min", minimum)
        high = integer(dose.get(name + "Max"), name + "Max", minimum)
        if high < low:
            raise invalid_request(f"Catalog {name} range is reversed")
        return high if maximum is True else low if maximum is False else (low + high) // 2
    rest_key = "restSecondsMin" if maximum is False else "restSecondsMax"
    between_key = "restBetweenSetsSecondsMin" if maximum is False else "restBetweenSetsSecondsMax"
    return {"sets": point("sets"), "reps": point("reps"), "repUnit": dose.get("repUnit"),
            "perSide": dose.get("perSide", False), "restSeconds": dose.get(rest_key) or 0,
            "restScope": dose.get("restScope") or ("reps" if dose.get("setsMax") == 1 else "sets"),
            "restBetweenSetsSeconds": dose.get(between_key),
            "familiarizationReps": dose.get("familiarizationReps") or 0}


def dose_violations(block: dict, dose: dict) -> list[str]:
    """Finite input checks plus catalog bounds; returns reasons for a validator."""
    errors = []
    try:
        estimate_block(block)
        defaults = resolved_catalog_dose(dose)
    except Exception as exc:
        return [str(exc)]
    for field, minimum in (("sets", 1), ("reps", 1), ("restSeconds", 0), ("restBetweenSetsSeconds", 0)):
        value = block.get(field)
        low, high = dose.get(field + "Min"), dose.get(field + "Max")
        if field == "restBetweenSetsSeconds" and value is None:
            if low is not None or high is not None:
                errors.append("restBetweenSetsSeconds cannot omit the catalog's explicit rest")
            continue
        if low is None and high is None:
            if value != defaults[field]:
                errors.append(f"{field} must use the catalog default")
            continue
        if type(value) is not int or (low is not None and value < low) or (high is not None and value > high):
            errors.append(f"{field} outside catalog range {low}..{high}")
    for field in ("repUnit", "perSide", "restScope", "familiarizationReps"):
        value = block.get(field, False if field == "perSide" else 0 if field == "familiarizationReps" else None)
        if value != defaults[field] or (field == "perSide" and type(value) is not bool):
            errors.append(f"{field} is defined by the catalog")
    return errors
