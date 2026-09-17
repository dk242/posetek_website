"""Drill catalog retrieval — LLM_PLATFORM_PLAN.md Part 5: "start structured, earn the vectors."

v1 retrieval is metadata-filtered Firestore queries against `drillCatalog`, **not embeddings**.
The catalog is a few hundred structured items (target quality, age range, equipment,
contraindications); a filtered query is exact, cheap, trivially testable, and — critically — *is*
the safety mechanism. Embedding similarity is the wrong tool for "never show a loaded squat to a
12-year-old": nothing about vector distance guarantees an age-inappropriate drill scores low, but
`minAge <= age <= maxAge` guarantees it's never in the candidate set at all. Do not replace this
with a similarity search without re-deriving the safety property some other way.

`candidate_drill_ids` is the safety-critical primitive: it computes the full age/contraindication-
filtered set of drills this athlete may ever be shown, independent of any specific quality query,
and caches it into `inv.context["candidateDrillIds"]`. `validators.py` reads that cache to enforce
that every drill a report prescribes came from this pre-filtered set — the "prescription-safety
mechanism" from the plan. `search_drill_catalog` (the model-callable tool) narrows that same safe
set further by quality/equipment; it never bypasses it.
"""

from __future__ import annotations

from typing import Any, Optional

from gateway.assemblers import resolve_player_age
from gateway.ctx import Invocation

# Player age fallback when neither `age` nor a birth date is on record. Deliberately the *opposite*
# direction from `age_band_for_age`'s "unknown -> senior" default in assemblers.py: that default
# only relaxes a *scoring standard* (harmless), whereas an unknown age here gates which drills are
# even allowed to reach the model. Defaulting to a young/conservative age means an athlete with no
# recorded age only sees drills that are safe for a young athlete — the failure mode this filter
# exists to prevent (an advanced/loaded drill reaching an actual 12-year-old whose age was never
# captured) is impossible under this default, at the cost of being overly conservative for adult
# athletes who simply haven't had their age recorded yet. That tradeoff is deliberate; revisit once
# age capture is reliable enough that "unknown" stops being the common case.
_UNKNOWN_AGE_SAFETY_DEFAULT = 10

# Speculative field names for player-recorded contraindications/injury flags. No such field exists
# in the player-doc schema today (AddPlayerView collects only height/weight/sport/sport), so this
# tries several plausible names and safely defaults to "no known contraindications" if none are
# present — permissive by necessity until W5 defines the real field.
_CONTRAINDICATION_FIELD_NAMES = ("contraindications", "injuries", "medicalFlags", "healthFlags")


def _player_contraindication_flags(player_data: dict) -> set[str]:
    for key in _CONTRAINDICATION_FIELD_NAMES:
        raw = player_data.get(key)
        if isinstance(raw, list) and raw:
            return {str(v) for v in raw}
    return set()


def _age_in_range(age: int, drill_data: dict) -> bool:
    min_age = drill_data.get("minAge")
    max_age = drill_data.get("maxAge")
    if not isinstance(min_age, (int, float)):
        min_age = 0
    if not isinstance(max_age, (int, float)):
        max_age = 120
    return min_age <= age <= max_age


def candidate_drill_ids(inv: Invocation) -> set[str]:
    """The full pre-filtered safe set of `drillCatalog` ids for this athlete: age-appropriate and
    free of any contraindication conflict. Not filtered by quality/equipment — those are narrower,
    per-query filters applied on top in `search_drill_catalog`. Cached on `inv.context` so repeated
    calls within one invocation (and the later validator stage) see the identical set."""
    cached = inv.context.get("candidateDrillIds")
    if cached is not None:
        return cached

    player_snap = inv.player_ref().get()
    player_data = player_snap.to_dict() if getattr(player_snap, "exists", False) else {}
    # A plan intake's self-reported age (already range-checked by the gate)
    # beats the player doc, which most signup paths never populate.
    intake_age = ((inv.context.get("planIntake") or {}).get("intake") or {}).get("age")
    age = intake_age if isinstance(intake_age, int) else resolve_player_age(player_data)
    if age is None:
        age = _UNKNOWN_AGE_SAFETY_DEFAULT
    flags = _player_contraindication_flags(player_data)

    ids: set[str] = set()
    for doc in inv.db.collection("drillCatalog").stream():
        data = doc.to_dict() or {}
        if not _age_in_range(age, data):
            continue
        contraindications = set(data.get("contraindications") or [])
        if contraindications & flags:
            continue
        ids.add(doc.id)

    inv.context["candidateDrillIds"] = ids
    return ids


def search_drill_catalog(inv: Invocation, quality: str, constraints: Optional[dict] = None) -> list[dict]:
    """Catalog entries already filtered by age/contraindications (via `candidate_drill_ids`), then
    narrowed to `targetQuality == quality` and, when `constraints["availableEquipment"]` is given,
    to drills whose `equipment` is a subset of what's available. Missing equipment constraints mean
    "no equipment restriction requested" — age/contraindication safety filtering still applies
    unconditionally regardless of what `constraints` does or doesn't specify.
    """
    constraints = constraints or {}
    safe_ids = candidate_drill_ids(inv)
    available_equipment = constraints.get("availableEquipment")
    available_equipment_set = set(available_equipment) if isinstance(available_equipment, list) else None

    results: list[dict] = []
    for doc in inv.db.collection("drillCatalog").stream():
        if doc.id not in safe_ids:
            continue
        data = doc.to_dict() or {}
        if data.get("targetQuality") != quality:
            continue
        if available_equipment_set is not None:
            equipment = set(data.get("equipment") or [])
            if not equipment.issubset(available_equipment_set):
                continue
        results.append({"drillId": doc.id, **data})

    return results
