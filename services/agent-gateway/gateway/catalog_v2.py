"""Normalized v2 catalog, with the approved legacy migration as a read adapter.

The status lists mirror agent 02's v3.1 audit: 65 published, 5 draft,
20 archived. Only the original 90 IDs are grandfathered; media-only records
and deferred BM content never gain executable defaults.
"""
from __future__ import annotations

from copy import deepcopy
import re

from gateway.errors import GatewayError, invalid_request, context_unavailable
from gateway.workout_time import integer, resolved_catalog_dose, estimate_block, WORK_DECISECONDS

DOMAINS = ("ballMastery", "dribbling", "passing", "receiving", "shooting", "speed",
           "agility", "plyometrics", "strength", "games")
# The original workbook publisher stored both enum IDs and display labels.
# Alias only known v1 labels; authored v2 documents still require the v2 taxonomy.
LEGACY_DOMAIN_LABELS = {"Linear Speed": "linearSpeed", "Vertical Power": "verticalPower",
                        "Horizontal Power": "horizontalPower", "COD / Agility": "codAgility",
                        "Passing / Receiving": "passingReceiving",
                        "Strength / Resilience": "strengthResilience"}
DOMAIN_MAP = {"linearSpeed": "speed", "codAgility": "agility", "verticalPower": "plyometrics",
              "horizontalPower": "plyometrics", "strengthResilience": "strength",
              "representativeGames": "games"}
LEGACY_IDS = frozenset(f"{prefix}-{number:03d}" for prefix, count in
                       (("SPD", 10), ("VJP", 8), ("HJP", 6), ("COD", 12), ("DRB", 14),
                        ("PAS", 10), ("SHT", 12), ("STR", 10), ("SSG", 8))
                       for number in range(1, count + 1))
DRAFT_IDS = frozenset({"COD-011", "SHT-007", "SHT-009", "SPD-007", "STR-008"})
ARCHIVED_IDS = frozenset({"DRB-001", "DRB-007", "DRB-014", "PAS-004", "PAS-007", "PAS-008",
                          "PAS-010", "SHT-012", "SPD-005", "SPD-010", "STR-010", "VJP-008",
                          *(f"SSG-{n:03d}" for n in range(1, 9))})
PARTNER_IDS = frozenset({"COD-006", "COD-008", "COD-009", "COD-011", "COD-012", "DRB-012",
                         "DRB-014", "PAS-002", "PAS-003", "PAS-004", "PAS-005", "PAS-006",
                         "PAS-007", "PAS-008", "PAS-009", "PAS-010", "SHT-007", "SHT-009",
                         "SHT-012", "SPD-007", "SPD-008", "STR-007", "STR-008", "STR-010",
                         *(f"SSG-{n:03d}" for n in range(1, 9))})


def safe_id(value, field="drillId") -> str:
    if not isinstance(value, str) or not value or len(value) > 128 or "/" in value or value in (".", ".."):
        raise invalid_request(f"{field} must be a nonempty slash-free ID of at most 128 characters")
    return value


def _legacy_difficulty(raw: dict) -> int:
    levels = set(raw.get("eligibleLevels") or [])
    if "foundation" in levels:
        base = 2 if "performance" in levels else 1
    elif "club" in levels:
        base = 3
    elif levels == {"performance"}:
        base = 4
    else:
        raise invalid_request("Legacy catalog difficulty cannot be resolved")
    return min(5, base + int(raw.get("maturityGate") in {"circaPostPHV", "postPHVPreferred", "postPHVMostly"}))


def normalize_catalog_drill(drill_id: str, raw: dict) -> dict:
    safe_id(drill_id)
    if not isinstance(raw, dict):
        raise invalid_request("Catalog row must be an object")
    if raw.get("drillId", drill_id) != drill_id:
        raise invalid_request("Catalog drillId disagrees with its document ID")
    version = raw.get("schemaVersion", 1)
    if type(version) is not int or version not in (1, 2):
        raise invalid_request("Unsupported catalog schemaVersion")
    if version == 1 and drill_id not in LEGACY_IDS:
        raise invalid_request("Unmigrated/media-only catalog row is not executable")
    out = deepcopy(raw)
    if version == 1:
        old_domain = LEGACY_DOMAIN_LABELS.get(raw.get("domain"), raw.get("domain"))
        domain = DOMAIN_MAP.get(old_domain, old_domain)
        if old_domain == "passingReceiving":
            domain = "receiving" if raw.get("targetQuality") == "receiving" else "passing"
        out.update({"schemaVersion": 2, "drillId": drill_id, "domain": domain,
                    "difficultyLevel": _legacy_difficulty(raw),
                    "status": "archived" if drill_id in ARCHIVED_IDS else "draft" if drill_id in DRAFT_IDS else "published",
                    "requiresPartner": drill_id in PARTNER_IDS or "partner" in (raw.get("equipment") or []) or (raw.get("playersMin") or 1) >= 2,
                    "equipment": [e for e in raw.get("equipment", []) if e != "partner"],
                    "maxFrequencyPerWeek": (raw.get("dose") or {}).get("frequencyPerWeekMax"),
                    "howTo": {"setup": raw.get("setup", ""), "steps": [s.strip() for s in re.split(r"\.\s+|;\s+", raw.get("execution", "")) if s.strip()][:12]},
                    "coachComments": list(raw.get("cues") or []) + (["You've got it when: " + raw["successCriteria"]] if raw.get("successCriteria") else []) + (["Safety: " + raw["safetyNote"]] if raw.get("safetyNote") else []),
                    "adaptiveLevers": (["Easier: " + raw["regression"]] if raw.get("regression") else []) + (["Harder: " + raw["progression"]] if raw.get("progression") else []),
                    "normalizationSource": "legacy-v3.1-approved-audit"})
    else:
        out["drillId"] = drill_id
        # Missing migration fields may fall back. Explicit empty/invalid
        # authored values never revive an older value.
        fallback_fields = ("difficultyLevel", "requiresPartner", "howTo", "maxFrequencyPerWeek", "coachComments", "adaptiveLevers", "status")
        if drill_id in LEGACY_IDS and any(key not in raw for key in fallback_fields):
            fallback = normalize_catalog_drill(drill_id, dict(raw, schemaVersion=1))
            for key in fallback_fields:
                if key not in raw:
                    out[key] = fallback[key]
    if out.get("domain") not in DOMAINS:
        raise invalid_request("Catalog domain is not v2")
    if not isinstance(out.get("name"), str) or not 1 <= len(out["name"]) <= 80:
        raise invalid_request("Catalog name must contain 1..80 characters")
    integer(out.get("minAge"), "minAge", 5, 99)
    integer(out.get("maxAge"), "maxAge", out["minAge"], 99)
    integer(out.get("difficultyLevel"), "difficultyLevel", 1, 5)
    integer(out.get("maxFrequencyPerWeek"), "maxFrequencyPerWeek", 1, 7)
    if out.get("status") not in ("published", "draft", "archived") or type(out.get("requiresPartner")) is not bool:
        raise invalid_request("Catalog status/requiresPartner is invalid")
    if not isinstance(out.get("equipment"), list) or any(not isinstance(e, str) or len(e) > 40 for e in out["equipment"]):
        raise invalid_request("Catalog equipment must be a string list")
    how_to = out.get("howTo")
    if not isinstance(how_to, dict) or not isinstance(how_to.get("setup"), str) or len(how_to["setup"]) > 400:
        raise invalid_request("Catalog howTo.setup must be text of at most 400 characters")
    steps = how_to.get("steps")
    if not isinstance(steps, list) or not 1 <= len(steps) <= 12 or any(not isinstance(step, str) or not step.strip() or len(step) > 240 for step in steps):
        raise invalid_request("Catalog howTo.steps must contain 1..12 nonempty steps of at most 240 characters")
    for field, count, size in (("coachComments", 8, 200), ("adaptiveLevers", 6, 240)):
        values = out.get(field)
        if not isinstance(values, list) or len(values) > count or any(not isinstance(value, str) or len(value) > size for value in values):
            raise invalid_request(f"Catalog {field} list is invalid")
    dose = out.get("dose")
    if not isinstance(dose, dict):
        raise invalid_request("Catalog dose missing")
    # All defaults must be representable. A too-large high dose is handled by
    # per-block validation; it need not make a smaller legal dose unavailable.
    for high in (False, True):
        concrete = resolved_catalog_dose(dose, maximum=high)
        if high is False and out["status"] == "published":
            estimate_block(concrete)
    for field in ("restSeconds", "restBetweenSetsSeconds"):
        lo, hi = dose.get(field + "Min"), dose.get(field + "Max")
        for val in (lo, hi):
            if val is not None:
                integer(val, field)
        if lo is not None and hi is not None and lo > hi:
            raise invalid_request(f"Catalog {field} range is reversed")
    # Return only v2 fields. Empty authored arrays/maps remain authoritative.
    if 'trainingPolicy' in out:
        from gateway.whole_body import validate_policy
        out['trainingPolicy'] = validate_policy(out['trainingPolicy'])
    fields = ("schemaVersion", "drillId", "name", "domain", "minAge", "maxAge", "difficultyLevel",
              "equipment", "requiresPartner", "howTo", "dose", "maxFrequencyPerWeek", "coachComments",
              "adaptiveLevers", "media", "status", "catalogVersion", "normalizationSource", "trainingPolicy")
    return {key: deepcopy(out[key]) for key in fields if key in out}


def load_catalog(inv) -> dict[str, dict]:
    context = inv.context.setdefault("workoutContext", {})
    if "catalog" in context:
        return context["catalog"]
    if "catalogV2" in inv.context:
        context["catalog"] = inv.context["catalogV2"]
        return context["catalog"]
    rows, errors = {}, {}
    for snap in inv.db.collection("drillCatalog").stream():
        try:
            rows[snap.id] = normalize_catalog_drill(snap.id, snap.to_dict())
        except GatewayError as exc:
            errors[snap.id] = exc.message
    context["catalog"] = rows
    context["catalogErrors"] = errors
    return rows


def get_catalog_drill(inv, drill_id: str) -> dict:
    safe_id(drill_id)
    catalog = load_catalog(inv)
    if drill_id not in catalog:
        snap = inv.db.collection("drillCatalog").document(drill_id).get()
        if not snap.exists:
            raise invalid_request(f"Unknown drill '{drill_id}'")
        catalog[drill_id] = normalize_catalog_drill(drill_id, snap.to_dict())
    return catalog[drill_id]


def eligible_drill(row: dict, profile: dict, *, equipment=None, allow_partner=None, max_difficulty=None) -> tuple[bool, list[str]]:
    intake = profile.get("intake") or {}
    reasons = []
    if intake.get("painFlag") or profile.get("painFlag"):
        reasons.append("pain_referral")
    age = profile.get("age")
    age = 10 if age is None else age
    ceiling = (profile.get("technicalEligibility") or {}).get("maxDrillDifficulty", 5)
    if type(age) is not int or type(ceiling) is not int or not 1 <= ceiling <= 5:
        return False, ["invalid_trusted_profile"]
    if max_difficulty is not None:
        ceiling = min(ceiling, integer(max_difficulty, "maxDifficulty", 1, 5))
    if row.get("status") != "published":
        reasons.append("not_published")
    if not row.get("minAge", 100) <= age <= row.get("maxAge", 0):
        reasons.append("age_ineligible")
    if row.get("difficultyLevel", 6) > ceiling:
        reasons.append("difficulty_ineligible")
    available = set(intake.get("equipment") or [])
    if equipment is not None:
        available &= set(equipment)
    if not set(row.get("equipment") or []).issubset(available):
        reasons.append("equipment_unavailable")
    setting = intake.get("setting", "solo")
    partner = setting == "partner" or (setting == "halfAndHalf" and allow_partner is True)
    if allow_partner is False:
        partner = False
    if row.get("requiresPartner") and not partner:
        reasons.append("partner_unavailable")
    from gateway.whole_body import eligibility_reasons
    reasons.extend(eligibility_reasons(row, profile))
    return not reasons, reasons


def catalog_minutes_range(row: dict) -> dict:
    estimates = []
    for high in (False, True):
        try:
            estimates.append(estimate_block(resolved_catalog_dose(row["dose"], maximum=high))["estimatedMinutes"])
        except GatewayError:
            # A high endpoint beyond 90 minutes is not a permitted dose.
            estimates.append(None)
    return {"min": estimates[0], "max": estimates[1]}
