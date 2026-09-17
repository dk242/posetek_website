"""Loader for the research knowledge assets baked into the image under `knowledge/`.

These files are the machine-readable half of the PoseTek drill-matrix research corpus,
emitted by the mobile repo's ingestion tool (`tools/catalog/catalog.py emit`) from the
authoritative workbook — never hand-edited here (DRILL_CATALOG_INGESTION_PLAN.md decision 1).
The drill *catalog* itself lives in Firestore (`drillCatalog`, published by the same tool)
because the app also reads it; everything here is prompt logic and ships with the image so
changes go through code review, same as prompts (LLM_PLATFORM_PLAN.md Principle 2).

All accessors cache on first load — the assets are immutable for the life of a container.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

KNOWLEDGE_DIR = Path(__file__).resolve().parents[1] / "knowledge"

# Tests the app can actually run, keyed by measured drill (mirrors the ingestion tool's
# APP_OBSERVABLE_TESTS; the emitted test_protocols.json carries the same mapping).
_JSON_ASSETS = (
    "recommendation_rules.json",
    "age_level_matrix.json",
    "test_protocols.json",
    "taxonomy.json",
    "drill_index.json",
    # Kick-analysis corpus (KICK_ANALYSIS_V2_PLAN decision 7). Unlike the drill-matrix
    # assets above these are authored in-repo — no workbook exists for kicking
    # biomechanics — so they ARE the source of record and are edited here directly.
    "kick_reference_values.json",
    "kick_fault_cue_map.json",
    "kick_symptom_map.json",
)
_MD_ASSETS = ("dosage_principles.md", "copy_rules.md", "kick_biomechanics.md")


@lru_cache(maxsize=None)
def _load_json(name: str) -> dict[str, Any]:
    return json.loads((KNOWLEDGE_DIR / name).read_text())


@lru_cache(maxsize=None)
def _load_text(name: str) -> str:
    return (KNOWLEDGE_DIR / name).read_text()


def catalog_version() -> str:
    return _load_json("drill_index.json")["catalogVersion"]


def rules() -> list[dict[str, Any]]:
    """All 28 recommendation rules. `testsSelector` semantics: "ids" (tests list is
    literal), "allTechnical" (tests expanded to T12-T18), "any" (wildcard — matches every
    test; the tests list is empty and MUST NOT be read as 'matches none')."""
    return _load_json("recommendation_rules.json")["rules"]


def rules_for_tests(test_ids: set[str]) -> list[dict[str, Any]]:
    """Rules whose trigger tests intersect `test_ids`, plus every wildcard rule."""
    out = []
    for r in rules():
        if r["testsSelector"] == "any" or set(r["tests"]) & test_ids:
            out.append(r)
    return out


def age_level_matrix() -> list[dict[str, Any]]:
    return _load_json("age_level_matrix.json")["matrix"]


def matrix_row(age_band: str, level: str) -> dict[str, Any] | None:
    for row in age_level_matrix():
        if row["ageBand"] == age_band and row["level"] == level:
            return row
    return None


def age_band_for(age: int) -> str:
    if age <= 8:
        return "U6-U8"
    if age <= 10:
        return "U9-U10"
    if age <= 12:
        return "U11-U12"
    if age <= 14:
        return "U13-U14"
    if age <= 16:
        return "U15-U16"
    return "U17-U19"


def tests() -> list[dict[str, Any]]:
    return _load_json("test_protocols.json")["tests"]


def measured_drill_tests() -> dict[str, list[str]]:
    """Measured app drill -> workbook test ids (the only tests that can ground a
    'measured gap' claim; everything else is stated-goal territory)."""
    return _load_json("test_protocols.json")["measuredDrillTests"]


def observable_test_ids() -> set[str]:
    return {t for ids in measured_drill_tests().values() for t in ids}


def taxonomy() -> list[dict[str, Any]]:
    return _load_json("taxonomy.json")["fields"]


def drill_index() -> dict[str, dict[str, Any]]:
    """drillId -> {name, domain, targetQuality, minAge, maxAge} for the full catalog.
    Display/cross-reference only — candidate filtering always goes through
    `gateway.catalog.candidate_drill_ids` against live Firestore."""
    return _load_json("drill_index.json")["drills"]


def dosage_principles() -> str:
    return _load_text("dosage_principles.md")


def copy_rules() -> str:
    return _load_text("copy_rules.md")


# --- Kick-analysis corpus --------------------------------------------------


def kick_biomechanics() -> str:
    """The phase-by-phase instep-kick model, evidence-graded, with sources inline."""
    return _load_text("kick_biomechanics.md")


def kick_reference_values() -> list[dict[str, Any]]:
    """Quantitative comparison anchors keyed to our metric families, each with source and
    confidence ("established" | "probable" | "contested" | "single-study")."""
    return _load_json("kick_reference_values.json")["referenceValues"]


def kick_fault_families() -> list[dict[str, Any]]:
    """Fault families: a machine-evaluable `signature` over our metric ids, the causal `why`,
    and 3-6 distinct `cues`. `gateway.kick_faults` evaluates the signatures; the model confirms
    or rejects the candidates and writes the final coaching."""
    return _load_json("kick_fault_cue_map.json")["faults"]


def kick_symptom_map() -> dict[str, Any]:
    """Athlete-language symptom index for kick_chat: `symptoms` (each with the documented
    mechanics, candidate fault-family ids, and the metric rows to inspect) plus
    `noMatchGuidance`. Routes the chat model's attention; `gateway.kick_faults` and the
    computed table decide what actually happened."""
    data = _load_json("kick_symptom_map.json")
    return {"symptoms": data["symptoms"], "noMatchGuidance": data["noMatchGuidance"]}


def kick_corpus_version() -> str:
    return _load_json("kick_fault_cue_map.json").get("version", "unknown")


def all_asset_names() -> tuple[str, ...]:
    return _JSON_ASSETS + _MD_ASSETS
