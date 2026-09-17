"""Catalog filtering tests — this filtering *is* the prescription-safety mechanism (see
gateway/catalog.py's module docstring), so the "excludes an age-inappropriate drill" case is the
one that matters most here.
"""

from __future__ import annotations

from gateway.catalog import candidate_drill_ids, search_drill_catalog
from tests.conftest import add_drill, add_player


def test_candidate_drill_ids_excludes_age_inappropriate_drill(db, make_invocation):
    add_player(db, "player1", {"age": 12})
    add_drill(db, "adult_loaded_squat", {"name": "Loaded back squat", "targetQuality": "power", "minAge": 16, "maxAge": 99, "equipment": ["barbell"]})
    add_drill(db, "youth_bodyweight_squat", {"name": "Bodyweight squat", "targetQuality": "power", "minAge": 8, "maxAge": 14, "equipment": []})

    inv = make_invocation(player_id="player1")
    ids = candidate_drill_ids(inv)

    assert "youth_bodyweight_squat" in ids
    assert "adult_loaded_squat" not in ids


def test_candidate_drill_ids_excludes_conflicting_contraindication(db, make_invocation):
    add_player(db, "player1", {"age": 16, "contraindications": ["knee_injury"]})
    add_drill(db, "safe_drill", {"name": "Safe drill", "targetQuality": "agility", "minAge": 10, "maxAge": 99, "contraindications": []})
    add_drill(db, "risky_drill", {"name": "Risky drill", "targetQuality": "agility", "minAge": 10, "maxAge": 99, "contraindications": ["knee_injury"]})

    inv = make_invocation(player_id="player1")
    ids = candidate_drill_ids(inv)

    assert "safe_drill" in ids
    assert "risky_drill" not in ids


def test_candidate_drill_ids_defaults_unknown_age_to_conservative_young_band(db, make_invocation):
    add_player(db, "player1", {})  # no age, no birth date
    add_drill(db, "adult_only", {"name": "Adult only", "targetQuality": "power", "minAge": 18, "maxAge": 99})
    add_drill(db, "youth_ok", {"name": "Youth ok", "targetQuality": "power", "minAge": 6, "maxAge": 12})

    inv = make_invocation(player_id="player1")
    ids = candidate_drill_ids(inv)

    assert "youth_ok" in ids
    assert "adult_only" not in ids


def test_candidate_drill_ids_caches_on_invocation_context(db, make_invocation):
    add_player(db, "player1", {"age": 16})
    add_drill(db, "d1", {"name": "D1", "targetQuality": "power", "minAge": 10, "maxAge": 99})

    inv = make_invocation(player_id="player1")
    first = candidate_drill_ids(inv)
    # Mutate underlying data; cached result must not change.
    add_drill(db, "d2", {"name": "D2", "targetQuality": "power", "minAge": 10, "maxAge": 99})
    second = candidate_drill_ids(inv)

    assert first is second
    assert inv.context["candidateDrillIds"] is first
    assert "d2" not in second


def test_search_drill_catalog_filters_by_quality_and_equipment(db, make_invocation):
    add_player(db, "player1", {"age": 16})
    add_drill(db, "power_bodyweight", {"name": "Power bodyweight", "targetQuality": "power", "minAge": 10, "maxAge": 99, "equipment": []})
    add_drill(db, "power_needs_box", {"name": "Box jumps", "targetQuality": "power", "minAge": 10, "maxAge": 99, "equipment": ["plyo_box"]})
    add_drill(db, "agility_bodyweight", {"name": "Agility ladder", "targetQuality": "agility", "minAge": 10, "maxAge": 99, "equipment": []})

    inv = make_invocation(player_id="player1")
    results = search_drill_catalog(inv, "power", {"availableEquipment": []})

    ids = {r["drillId"] for r in results}
    assert ids == {"power_bodyweight"}


def test_search_drill_catalog_without_equipment_constraint_does_not_filter_by_equipment(db, make_invocation):
    add_player(db, "player1", {"age": 16})
    add_drill(db, "power_needs_box", {"name": "Box jumps", "targetQuality": "power", "minAge": 10, "maxAge": 99, "equipment": ["plyo_box"]})

    inv = make_invocation(player_id="player1")
    results = search_drill_catalog(inv, "power")

    assert {r["drillId"] for r in results} == {"power_needs_box"}
