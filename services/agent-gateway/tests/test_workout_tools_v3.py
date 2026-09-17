from copy import deepcopy
from datetime import datetime, timezone
import json

import pytest

from gateway.catalog_v2 import normalize_catalog_drill, eligible_drill, LEGACY_IDS, ARCHIVED_IDS, DRAFT_IDS
from gateway.ctx import Invocation
from gateway.errors import GatewayError
from gateway.tools import TOOL_SPECS, run_tool
from gateway.workout_history import build_frequency_context, drill_history, week_window
from gateway.workout_time import resolved_catalog_dose, estimate_block
from gateway.workout_tools import validate_workout, run_workout_tool, MAX_TOOL_RESULT_BYTES


def catalog_row(drill_id="DRB-501", domain="dribbling", **overrides):
    row = {"schemaVersion": 2, "drillId": drill_id, "name": "Close control", "domain": domain,
           "minAge": 5, "maxAge": 99, "difficultyLevel": 2, "equipment": ["ball"],
           "requiresPartner": False, "status": "published", "maxFrequencyPerWeek": 3,
           "howTo": {"setup": "A small square", "steps": ["Move the ball through the square."]},
           "coachComments": ["Keep the ball close."], "adaptiveLevers": [], "catalogVersion": "2.0.0",
           "dose": {"setsMin": 2, "setsMax": 4, "repsMin": 60, "repsMax": 120, "repUnit": "seconds",
                    "perSide": False, "restSecondsMin": 30, "restSecondsMax": 60, "restScope": "sets",
                    "restBetweenSetsSecondsMin": None, "restBetweenSetsSecondsMax": None, "familiarizationReps": 0}}
    row.update(overrides)
    return row


def block(row, number=1, **overrides):
    result = dict(resolved_catalog_dose(row["dose"]), blockId=f"b{number}", order=number, kind="main",
                  drillId=row["drillId"], name=row["name"], domain=row["domain"], whyIncluded="Practice the intended skill.")
    result.update(overrides)
    result["estimatedMinutes"] = estimate_block(result)["estimatedMinutes"]
    return result


def workout(row=None, **overrides):
    row = row or catalog_row()
    b = block(row)
    result = {"workoutId": "w1s1", "order": 1, "title": "Control session", "intent": "Practice close control.",
              "focusDomains": [row["domain"]], "budgetMinutes": b["estimatedMinutes"], "estimatedMinutes": b["estimatedMinutes"],
              "blocks": [b], "nextBlockSequence": 2, "revision": 1}
    result.update(overrides)
    return result


def plan(row=None, **overrides):
    result = {"schemaVersion": 3, "planId": "p1", "status": "active", "startDate": "2026-09-06",
              "timezone": "America/Los_Angeles", "horizonWeeks": 2, "minutesPerSession": 60,
              "weeks": [{"weekNumber": 1, "workouts": [workout(row)]}, {"weekNumber": 2, "workouts": []}]}
    result.update(overrides)
    return result


def profile(**overrides):
    result = {"age": 15, "technicalEligibility": {"maxDrillDifficulty": 5},
              "intake": {"setting": "solo", "equipment": ["ball", "cones", "wall"], "level": "foundation", "painFlag": False}}
    result.update(overrides)
    return result


@pytest.fixture
def tool_inv(make_invocation):
    row = catalog_row()
    return make_invocation(capability="workout_chat", context={"programProfile": profile(),
           "workoutContext": {"target": {"kind": "plan", "planId": "p1", "workoutId": "w1s1", "baseRevision": 1},
                              "plan": plan(row), "weekNumber": 1, "catalog": {row["drillId"]: row}, "frequency": {}}})


def create(inv, **overrides):
    args = {"target": inv.context["workoutContext"]["target"], "from": "empty",
            "title": "Control session", "intent": "Practice close control.", "focusDomains": ["dribbling"], "budgetMinutes": 15}
    args.update(overrides)
    return run_tool("draft_create", args, inv)


def test_all_tools_are_exposed():
    assert {"search_drills", "get_drill", "get_drill_history", "estimate_minutes", "draft_create", "draft_add_block",
            "draft_set_dose", "draft_remove_block", "draft_reorder", "draft_set_intent", "draft_get", "validate_workout"} <= TOOL_SPECS.keys()


def test_pure_estimation_never_reads_database():
    inv = Invocation("workout_chat", "p", "u", db=None)
    assert run_tool("estimate_minutes", {"blocks": []}, inv)["estimatedMinutes"] == 0


def test_tool_add_recompute_remove_and_monotonic_ids(tool_inv):
    create(tool_inv)
    one = run_tool("draft_add_block", {"drillId": "DRB-501"}, tool_inv)
    assert one["workout"]["blocks"][0]["blockId"] == "b2"
    assert one["workout"]["blocks"][0]["repUnit"] == "seconds"
    run_tool("draft_remove_block", {"blockId": "b2"}, tool_inv)
    two = run_tool("draft_add_block", {"drillId": "DRB-501"}, tool_inv)
    assert two["workout"]["blocks"][0]["blockId"] == "b3"
    assert two["workout"]["nextBlockSequence"] == 4
    assert two["workout"]["estimatedMinutes"] == estimate_block(two["workout"]["blocks"][0])["estimatedMinutes"]


@pytest.mark.parametrize("tool,args", [("draft_add_block", {"drillId": "DRB-501", "sets": 100}),
                                      ("draft_add_block", {"drillId": "DRB-501", "restScope": "reps"}),
                                      ("draft_add_block", {"drillId": "DRB-501", "reps": True}),
                                      ("draft_add_block", {"drillId": "DRB-501", "afterBlockId": "ghost"}),
                                      ("draft_add_block", {"drillId": "DRB-501", "kind": "retest"}),
                                      ("draft_set_intent", {"budgetMinutes": 91}),
                                      ("draft_set_intent", {"focusDomains": ["unknown"]}),
                                      ("draft_set_intent", {"intent": "x" * 401}),
                                      ("draft_remove_block", {"blockId": "ghost"}),
                                      ("draft_set_dose", {"blockId": "b1", "sets": 0}),
                                      ("draft_reorder", {"blockIds": ["b1", "b1"]})])
def test_refusal_leaves_draft_unchanged(tool_inv, tool, args):
    create(tool_inv)
    run_tool("draft_add_block", {"drillId": "DRB-501"}, tool_inv)
    before = deepcopy(tool_inv.context["workoutDraft"])
    with pytest.raises(GatewayError):
        run_tool(tool, args, tool_inv)
    assert tool_inv.context["workoutDraft"] == before


@pytest.mark.parametrize("field,value", [("status", "draft"), ("status", "archived"), ("minAge", 16),
                                        ("maxAge", 14), ("requiresPartner", True), ("equipment", ["sledOrBand"])])
def test_catalog_safety_cannot_be_widened_by_search_or_add(tool_inv, field, value):
    row = tool_inv.context["workoutContext"]["catalog"]["DRB-501"]
    row[field] = value
    assert run_tool("search_drills", {"allowPartner": True, "equipment": ["ball", "sledOrBand"]}, tool_inv)["results"] == []
    create(tool_inv)
    with pytest.raises(GatewayError):
        run_tool("draft_add_block", {"drillId": "DRB-501"}, tool_inv)


def test_difficulty_resolves_trusted_rating_not_stats_level(tool_inv):
    row = tool_inv.context["workoutContext"]["catalog"]["DRB-501"]
    row["difficultyLevel"] = 4
    assert len(run_tool("search_drills", {}, tool_inv)["results"]) == 1
    tool_inv.context["programProfile"]["technicalEligibility"]["maxDrillDifficulty"] = 2
    assert run_tool("search_drills", {"maxDifficulty": 5}, tool_inv)["results"] == []
    assert run_tool("get_drill", {"drillId": "DRB-501"}, tool_inv)["eligibility"]["eligible"] is False


def test_half_and_half_partner_opt_in(tool_inv):
    tool_inv.context["programProfile"]["intake"]["setting"] = "halfAndHalf"
    tool_inv.context["workoutContext"]["catalog"]["DRB-501"]["requiresPartner"] = True
    assert not run_tool("search_drills", {}, tool_inv)["results"]
    assert run_tool("search_drills", {"allowPartner": True}, tool_inv)["results"]
    create(tool_inv)
    run_tool("draft_add_block", {"drillId": "DRB-501"}, tool_inv)


def test_known_get_to_add_without_search(tool_inv, db):
    other = catalog_row("PAS-501", "passing", name="Wall passing")
    db.collection("drillCatalog").document("PAS-501").set(other)
    assert run_tool("get_drill", {"drillId": "PAS-501"}, tool_inv)["domain"] == "passing"
    create(tool_inv, focusDomains=["passing"])
    assert run_tool("draft_add_block", {"drillId": "PAS-501"}, tool_inv)["workout"]["blocks"][0]["domain"] == "passing"


def test_frequency_counts_distinct_workouts_and_target_exclusion(tool_inv):
    create(tool_inv)
    tool_inv.context["workoutContext"]["frequency"] = {"DRB-501": 2}
    run_tool("draft_add_block", {"drillId": "DRB-501"}, tool_inv)
    with pytest.raises(GatewayError, match="cannot repeat"):
        run_tool("draft_add_block", {"drillId": "DRB-501"}, tool_inv)
    run_tool("draft_remove_block", {"blockId": "b2"}, tool_inv)
    tool_inv.context["workoutContext"]["frequency"]["DRB-501"] = 3
    before = deepcopy(tool_inv.context["workoutDraft"])
    with pytest.raises(GatewayError):
        run_tool("draft_add_block", {"drillId": "DRB-501"}, tool_inv)
    assert tool_inv.context["workoutDraft"] == before


def test_13th_block_rejected(tool_inv):
    create(tool_inv)
    for n in range(12):
        did = f"DRB-{501+n}"
        tool_inv.context["workoutContext"]["catalog"][did] = catalog_row(did)
        run_tool("draft_add_block", {"drillId": did}, tool_inv)
    before = deepcopy(tool_inv.context["workoutDraft"])
    with pytest.raises(GatewayError, match="thirteenth"):
        run_tool("draft_add_block", {"drillId": "DRB-501"}, tool_inv)
    assert tool_inv.context["workoutDraft"] == before


def test_target_cannot_switch_or_forge_generation(tool_inv):
    target = dict(tool_inv.context["workoutContext"]["target"], workoutId="w1s2")
    with pytest.raises(GatewayError):
        create(tool_inv, target=target)
    target = {"kind": "generation", "jobId": "evil", "weekNumber": 1, "order": 1}
    tool_inv.context["workoutContext"]["target"] = target
    with pytest.raises(GatewayError):
        create(tool_inv)


def test_generation_internal_target_and_60_calls(tool_inv):
    tool_inv.capability = "generate_training_plan"
    tool_inv.job_id = "j1"
    tool_inv.context["workoutContext"]["target"] = {"kind": "generation", "jobId": "j1", "weekNumber": 1, "order": 1}
    create(tool_inv)
    for _ in range(59):
        run_tool("draft_get", {}, tool_inv)
    with pytest.raises(GatewayError, match="limit"):
        run_tool("draft_get", {}, tool_inv)
    tool_inv.context["workoutContext"]["target"]["order"] = 2
    create(tool_inv)


def test_chat_30_calls_and_pure_no_read(tool_inv):
    create(tool_inv)
    tool_inv.db = None
    for _ in range(29):
        run_tool("draft_get", {}, tool_inv)
    with pytest.raises(GatewayError, match="limit"):
        run_tool("draft_get", {}, tool_inv)


def test_time_cap_preserves_draft(tool_inv, monkeypatch):
    create(tool_inv)
    before = deepcopy(tool_inv.context["workoutDraft"])
    clock = iter([0, 121, 121])
    monkeypatch.setattr("gateway.workout_tools.time.monotonic", lambda: next(clock))
    with pytest.raises(GatewayError, match="time limit"):
        run_tool("draft_set_intent", {"intent": "Changed"}, tool_inv)
    assert tool_inv.context["workoutDraft"] == before


@pytest.mark.parametrize("bad", [{"isRetest": False}, {"retest": None}])
def test_checker_rejects_retest_presence(tool_inv, bad):
    w = workout(**bad)
    result = validate_workout(w, tool_inv.context["workoutContext"]["catalog"], profile())
    assert not result["ok"]
    assert any(v["code"] == "no_retest" for v in result["violations"])


def test_checker_exact_minutes_intent_and_ordering(tool_inv):
    rows = {r["drillId"]: r for r in [catalog_row(), catalog_row("SPD-501", "speed")]}
    w = workout()
    assert validate_workout(w, rows, profile())["ok"]
    w["estimatedMinutes"] += 1
    assert not validate_workout(w, rows, profile())["ok"]
    w = workout(focusDomains=["speed"])
    assert validate_workout(w, rows, profile())["intentStatus"] == "fail"
    w["blocks"].append(block(rows["SPD-501"], number=2))
    w.update(estimatedMinutes=15, budgetMinutes=15, nextBlockSequence=3, focusDomains=["speed", "dribbling"])
    check = validate_workout(w, rows, profile())
    assert check["intentStatus"] == "warn"
    assert check["intent"]["orderingOk"] is False


def test_shorter_arbitrary_20_minute_request(tool_inv):
    create(tool_inv)
    run_tool("draft_add_block", {"drillId": "DRB-501", "sets": 4, "reps": 120}, tool_inv)
    tool_inv.context["workoutContext"]["catalog"]["DRB-502"] = catalog_row("DRB-502")
    run_tool("draft_add_block", {"drillId": "DRB-502", "sets": 3, "reps": 120}, tool_inv)
    run_tool("draft_set_intent", {"budgetMinutes": 20}, tool_inv)
    assert run_tool("validate_workout", {}, tool_inv)["ok"]


def test_plancore_deduplicates_and_reports_overflow(tool_inv):
    context = tool_inv.context["workoutContext"]
    context["target"] = {"kind": "new", "planId": "p1", "weekNumber": 1}
    rows = [catalog_row(f"DRB-{n:03d}") for n in range(501, 506)]
    context["catalog"].update({r["drillId"]: r for r in rows})
    w = context["plan"]["weeks"][0]["workouts"][0]
    w["blocks"] = [block(row, i + 1) for i, row in enumerate(rows)] + [block(rows[0], 6)]
    result = create(tool_inv, **{"from": "planCore"}, budgetMinutes=15)
    assert [b["drillId"] for b in result["workout"]["blocks"]] == ["DRB-501", "DRB-502"]
    assert result["overflowCandidates"] == ["DRB-503", "DRB-504", "DRB-505"]


def test_original_uses_private_loader_and_current_revision_counter(tool_inv, monkeypatch):
    import gateway.workout_persistence as persistence
    original = workout(title="Original", nextBlockSequence=2)
    original["rawCoachFeedback"] = "PRIVATE"
    context = tool_inv.context["workoutContext"]
    current = context["plan"]["weeks"][0]["workouts"][0]
    current.update(title="Third edit", revision=3, nextBlockSequence=6)
    context["target"]["baseRevision"] = 3
    monkeypatch.setattr(persistence, "load_original_workout", lambda *args: original)
    result = run_tool("draft_create", {"target": context["target"], "from": "original"}, tool_inv)
    assert result["workout"]["title"] == "Original"
    assert result["workout"]["revision"] == 3
    assert result["workout"]["nextBlockSequence"] == 6
    assert "PRIVATE" not in json.dumps(result)
    with pytest.raises(GatewayError):
        run_tool("draft_create", {"target": context["target"], "from": "original", "intent": "replacement"}, tool_inv)


def test_search_filters_text_window_and_caps(tool_inv):
    context = tool_inv.context["workoutContext"]
    context["catalog"] = {f"DRB-{n:03d}": catalog_row(f"DRB-{n:03d}") for n in range(501, 551)}
    now = datetime(2026, 9, 8, 12, tzinfo=timezone.utc)
    context["now"] = now
    tool_inv.context["workoutHistoryEvidence"] = {"logs": [{"id": "old", "startedAt": now, "blocks": [{"drillId": "DRB-501", "status": "partial", "estimatedMinutes": 5}]}], "reps": [], "reservations": []}
    result = run_tool("search_drills", {"excludeDone": True, "freeText": "keep the BALL", "windowDays": 28}, tool_inv)
    assert result["windowDays"] == 28 and result["truncated"]
    assert len(result["results"]) == 25
    assert result["results"][0]["drillId"] == "DRB-502"


def test_large_history_truncates_without_losing_enforcement(tool_inv):
    now = datetime(2026, 9, 8, 12, tzinfo=timezone.utc)
    context = tool_inv.context["workoutContext"]
    context["now"] = now
    context["frequency"] = {f"DRB-{n:04d}": 3 for n in range(1000)}
    tool_inv.context["workoutHistoryEvidence"] = {"logs": [{"id": "log", "startedAt": now, "blocks": [{"drillId": f"DRB-{n:04d}", "status": "done", "estimatedMinutes": 5} for n in range(1000)]}], "reps": [], "reservations": []}
    result = run_tool("get_drill_history", {}, tool_inv)
    assert result["truncated"] and result["coverage"] == "incomplete"
    assert len(json.dumps(result, separators=(",", ":")).encode()) <= MAX_TOOL_RESULT_BYTES
    assert len(context["frequency"]) == 1000
    assert list(result["drills"]) == sorted(result["drills"])


def test_catalog_v1_adaptation_approved_status_and_empty_v2_fields():
    base = catalog_row()
    base.update(schemaVersion=1, domain="linearSpeed", eligibleLevels=["club", "performance"], maturityGate="circaPostPHV", execution="Step one. Step two.", setup="Start here")
    base["dose"]["frequencyPerWeekMax"] = 2
    for field in ("difficultyLevel", "howTo", "coachComments", "adaptiveLevers", "status", "requiresPartner", "maxFrequencyPerWeek"):
        base.pop(field, None)
    base.pop("drillId")
    counts = {}
    for drill_id in sorted(LEGACY_IDS):
        row = normalize_catalog_drill(drill_id, base)
        counts[row["status"]] = counts.get(row["status"], 0) + 1
        assert row["difficultyLevel"] == 4 and row["domain"] == "speed"
    assert counts == {"published": 65, "draft": 5, "archived": 20}
    row = catalog_row(equipment=[], coachComments=[], adaptiveLevers=[], howTo={"setup": "", "steps": ["Move."]})
    normalized = normalize_catalog_drill(row["drillId"], row)
    assert normalized["equipment"] == [] and normalized["coachComments"] == []
    with pytest.raises(GatewayError):
        normalize_catalog_drill("BM-001", {"media": {}})


def test_history_and_frequency_dedupe_frozen_snapshots_and_cross_plan_evidence():
    row = catalog_row()
    p = plan(row)
    same = workout(row, workoutId="w1s2", order=2)
    same["blocks"].append(block(row, 2))
    p["weeks"][0]["workouts"].append(same)
    at = datetime(2026, 9, 8, 12, tzinfo=timezone.utc)
    frozen = workout(row)
    log = {"id": "p1_w1s2", "source": "plan", "planId": "p1", "workoutId": "w1s2", "startedAt": at,
           "workoutSnapshot": frozen, "blocks": [{"blockId": "b1", "drillId": "forged", "status": "partial", "setsCompleted": 2, "estimatedMinutes": 90}]}
    adhoc = {"id": "a1", "source": "adhoc", "planId": "older", "startedAt": at, "blocks": [{"drillId": row["drillId"], "status": "done", "estimatedMinutes": 5, "setsCompleted": 2}]}
    skipped = {"id": "a2", "source": "adhoc", "startedAt": at, "blocks": [{"drillId": row["drillId"], "status": "skipped"}]}
    reservations = [{"id": "a1", "status": "ready", "planId": "p1", "weekNumber": 1, "blocks": [block(row)]},
                    {"id": "a3", "status": "ready", "planId": "p1", "weekNumber": 1, "blocks": [block(row)]}]
    target = {"kind": "plan", "planId": "p1", "workoutId": "w1s1", "baseRevision": 1}
    result = build_frequency_context(p, target, [log, adhoc, skipped], reservations, now=at)
    assert result["counts"] == {row["drillId"]: 3}  # one other slot, one logged adhoc, one ready
    history = drill_history([log, adhoc, skipped], [], now=at, frequency=result["counts"])
    assert history["drills"][row["drillId"]]["timesDone"] == 2
    assert history["drills"][row["drillId"]]["minutesDone"] == frozen["blocks"][0]["estimatedMinutes"] // 2 + 5
    assert "forged" not in history["drills"]


def test_frequency_keeps_frozen_removed_drill_on_edited_other_slot():
    original = catalog_row()
    changed = catalog_row("PAS-501", "passing")
    p = plan(changed)
    log = {"id": "p1_w1s1", "source": "plan", "planId": "p1", "workoutId": "w1s1", "startedAt": "2026-09-08T12:00:00Z",
           "workoutSnapshot": workout(original), "blocks": [{"blockId": "b1", "status": "done"}]}
    result = build_frequency_context(p, {"kind": "new", "planId": "p1", "weekNumber": 1}, [log], [], now=datetime(2026, 9, 8, tzinfo=timezone.utc))
    assert result["counts"] == {"DRB-501": 1, "PAS-501": 1}


def test_dst_week_is_calendar_based_and_half_open():
    p = plan(startDate="2026-11-01")
    start, end, _ = week_window(p, 1)
    assert start.isoformat() == "2026-11-01T00:00:00-07:00"
    assert end.isoformat() == "2026-11-08T00:00:00-08:00"
    assert (end.astimezone(timezone.utc) - start.astimezone(timezone.utc)).total_seconds() == 169 * 3600
    logs = [{"id": "at_end", "source": "adhoc", "startedAt": end, "blocks": [{"drillId": "DRB-999", "status": "done"}]}]
    assert "DRB-999" not in build_frequency_context(p, {"kind": "new", "planId": "p1", "weekNumber": 1}, logs, [], now=start)["counts"]


def test_recreate_empty_never_reuses_retired_or_current_ids(tool_inv):
    create(tool_inv)
    first = run_tool("draft_add_block", {"drillId": "DRB-501"}, tool_inv)
    retired = first["workout"]["blocks"][0]["blockId"]
    create(tool_inv)
    second = run_tool("draft_add_block", {"drillId": "DRB-501"}, tool_inv)
    assert second["workout"]["blocks"][0]["blockId"] != retired
    assert second["workout"]["workoutId"] == "w1s1"


def test_unknown_date_history_is_not_claimed_unseen(tool_inv):
    tool_inv.context["workoutHistoryEvidence"] = {"logs": [{"id": "undated", "blocks": [{"drillId": "DRB-501", "status": "done"}]}], "reps": [], "reservations": []}
    history = run_tool("get_drill_history", {}, tool_inv)
    assert history["coverage"] == "incomplete"
    assert history["unknownDrillIds"] == ["DRB-501"]
    result = run_tool("search_drills", {"excludeDone": True}, tool_inv)
    assert result["results"] == [] and result["historyCoverage"] == "incomplete"


def test_unplaceable_actual_evidence_makes_frequency_incomplete():
    log = {"id": "undated", "source": "adhoc", "blocks": [{"drillId": "DRB-501", "status": "partial"}]}
    result = build_frequency_context(plan(), {"kind": "new", "planId": "p1", "weekNumber": 1}, [log], [])
    assert result["coverage"] == "incomplete" and result["coverageReasons"]
    # A known scheduled slot can conservatively retain the frozen evidence.
    log.update(source="plan", planId="p1", workoutId="w1s1", weekNumber=1)
    result = build_frequency_context(plan(), {"kind": "new", "planId": "p1", "weekNumber": 1}, [log], [])
    assert result["coverage"] == "complete" and result["counts"]["DRB-501"] == 1


@pytest.mark.parametrize("field,value", [("howTo", None), ("howTo", {"setup": "", "steps": []}),
                                          ("coachComments", "old copy"), ("coachComments", ["x" * 201]),
                                          ("adaptiveLevers", ["x"] * 7), ("difficultyLevel", True)])
def test_explicit_invalid_v2_fields_do_not_fall_back(field, value):
    row = catalog_row(**{field: value})
    with pytest.raises(GatewayError):
        normalize_catalog_drill(row["drillId"], row)


def test_estimator_and_cap_refusal_do_not_modify_existing_draft(tool_inv):
    create(tool_inv)
    before = deepcopy(tool_inv.context["workoutDraft"])
    with pytest.raises(GatewayError):
        run_tool("estimate_minutes", {"blocks": [{"sets": 1, "reps": 100, "repUnit": "minutes", "restSeconds": 0}]}, tool_inv)
    assert tool_inv.context["workoutDraft"] == before


@pytest.mark.parametrize("label,quality,expected", [
    ("Linear Speed", "speed", "speed"),
    ("Vertical Power", "power", "plyometrics"),
    ("Horizontal Power", "power", "plyometrics"),
    ("COD / Agility", "agility", "agility"),
    ("Passing / Receiving", "passing", "passing"),
    ("Passing / Receiving", "receiving", "receiving"),
    ("Strength / Resilience", "strength", "strength"),
])
def test_live_workbook_display_domains_preserve_legacy_drill_eligibility(label, quality, expected):
    raw = catalog_row("SPD-002", domain=label, schemaVersion=1, targetQuality=quality,
                      eligibleLevels=["club"], setup="Start here", execution="Move with control.")
    raw["dose"]["frequencyPerWeekMax"] = 2
    row = normalize_catalog_drill("SPD-002", raw)
    assert row["domain"] == expected and row["status"] == "published"
    assert eligible_drill(row, profile())[0]
    # A malformed new document must not get a legacy interpretation.
    raw["schemaVersion"] = 2
    with pytest.raises(GatewayError, match="domain is not v2"):
        normalize_catalog_drill("SPD-002", raw)


@pytest.mark.parametrize("kind", ["main", "warmup", "cooldown"])
def test_checker_rejects_same_drill_even_with_distinct_block_ids_and_kinds(kind):
    from gateway.workout_time import estimate_workout
    row = catalog_row()
    blocks = [block(row, 1, kind=kind), block(row, 2, kind=kind)]
    minutes = estimate_workout(blocks)["estimatedMinutes"]
    value = workout(blocks=blocks, budgetMinutes=minutes, estimatedMinutes=minutes, nextBlockSequence=3)
    result = validate_workout(value, {row["drillId"]: row}, profile())
    assert not result["ok"]
    assert [v["code"] for v in result["violations"]] == ["duplicate_drill"]


def test_search_more_easy_passing_broadens_beyond_program_and_excludes_current_and_sibling(tool_inv):
    context = tool_inv.context["workoutContext"]
    rows = [catalog_row("PAS-501", "passing", name="Current wall passes"),
            catalog_row("PAS-502", "passing", name="Scheduled partner-free passes"),
            catalog_row("PAS-503", "passing", name="Challenging target pass", difficultyLevel=4),
            catalog_row("PAS-999", "passing", name="Target gates", difficultyLevel=1),
            catalog_row("PAS-998", "passing", name="Unavailable target", difficultyLevel=1, equipment=["sled"])]
    context["catalog"] = {r["drillId"]: r for r in rows}
    context["plan"]["weeks"][0]["workouts"] = [workout(rows[0]), workout(rows[1], workoutId="w1s2", order=2)]
    context["workout"] = deepcopy(context["plan"]["weeks"][0]["workouts"][0])
    context["frequency"] = {"PAS-502": 1}
    run_tool("draft_create", {"target": context["target"], "from": "workout"}, tool_inv)
    result = run_tool("search_drills", {"domains": ["passing"], "freeText": "easy passing drills"}, tool_inv)
    assert result["selectionScope"] == "fullEligibleCatalog"
    assert result["difficultyPreference"] == "easier"
    assert [r["drillId"] for r in result["results"]] == ["PAS-999", "PAS-503"]
    before = deepcopy(tool_inv.context["workoutDraft"])
    with pytest.raises(GatewayError, match="already scheduled"):
        run_tool("draft_add_block", {"drillId": "PAS-502"}, tool_inv)
    assert tool_inv.context["workoutDraft"] == before
    run_tool("draft_add_block", {"drillId": "PAS-999"}, tool_inv)
    assert {b["drillId"] for b in tool_inv.context["workoutDraft"]["workout"]["blocks"]} == {"PAS-501", "PAS-999"}


def test_search_keeps_hard_limits_when_requested_difficulty_or_terms_cannot_match(tool_inv):
    context = tool_inv.context["workoutContext"]
    context["catalog"] = {"DRB-501": catalog_row(difficultyLevel=3)}
    assert run_tool("search_drills", {"difficultyPreference": "easier", "maxDifficulty": 2}, tool_inv)["results"] == []
    result = run_tool("search_drills", {"freeText": "unavailablecue"}, tool_inv)
    assert result["results"] and result["textMatchesFound"] is False


def test_validator_allows_existing_cross_day_core_but_rejects_new_cross_day_drill():
    original = catalog_row(); other = catalog_row("DRB-502")
    source = plan(original)
    target = {"kind": "plan", "planId": "p1", "workoutId": "w1s1", "baseRevision": 1}
    frequency = {"DRB-501": 1, "DRB-502": 1}
    catalog = {row["drillId"]: row for row in (original, other)}
    assert validate_workout(workout(original), catalog, profile(), frequency, source, target)["ok"]
    result = validate_workout(workout(other), catalog, profile(), frequency, source, target)
    assert not result["ok"] and any(v["code"] == "scheduled_elsewhere" for v in result["violations"])
