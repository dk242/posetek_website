"""build_workout unit coverage (WORKOUT_BUILDER_AGENT_PLAN.md Part 1/B2/B3 grain): the
active-week resolver, the weekProgress parity assembler, workoutCandidates hydration, the
validator, and the finalizer's disposable-doc behavior. No model calls anywhere."""

import sys
import types as pytypes
import datetime as dt

import pytest

if "google.cloud.firestore" not in sys.modules:
    _google = sys.modules.get("google") or pytypes.ModuleType("google")
    _cloud = getattr(_google, "cloud", None) or pytypes.ModuleType("google.cloud")
    _firestore = pytypes.ModuleType("google.cloud.firestore")
    _firestore.SERVER_TIMESTAMP = dt.datetime.now(dt.timezone.utc)
    _cloud.firestore = _firestore
    _google.cloud = _cloud
    sys.modules.setdefault("google", _google)
    sys.modules.setdefault("google.cloud", _cloud)
    sys.modules["google.cloud.firestore"] = _firestore

from gateway.assemblers import (
    assemble_active_plan_week,
    assemble_week_progress,
    assemble_workout_candidates,
)
from gateway.errors import GatewayError
from gateway.pipeline import _finalize_build_workout
from gateway.validators import validate_workout_v1
from tests.conftest import add_rep


BUILD_PARAMS = {"planId": "plan1", "timeAvailableMinutes": 30, "energy": "normal"}


def catalog_drill(drill_id, *, domain="linearSpeed", intensity="maxQuality",
                   equipment=("cones",), est=(4, 10), regression="Trim the range and reps."):
    return {
        "drillId": drill_id,
        "name": f"Drill {drill_id}",
        "domain": domain,
        "execution": "Do the thing.",
        "cues": ["Go"],
        "regression": regression,
        "intensityIntent": intensity,
        "equipment": list(equipment),
        "estimatedMinutes": {"min": est[0], "max": est[1]},
        "dose": {
            "setsMin": 2, "setsMax": 4, "repsMin": 2, "repsMax": 4, "repUnit": "reps",
            "restSecondsMin": 60, "restSecondsMax": 120,
        },
    }


def plan_drill(drill_id, *, domain="linearSpeed", sets=3, reps=3, freq=2,
               intensity="maxQuality", est=8):
    return {
        "drillId": drill_id, "name": f"Drill {drill_id}", "domain": domain,
        "sets": sets, "reps": reps, "repUnit": "reps", "restSeconds": 90,
        "frequencyPerWeek": freq, "intensityIntent": intensity,
        "estimatedMinutes": est, "cues": ["Go"], "note": "Because.",
    }


def seed_plan(db, player_id="player1", *, week_number=1, horizon=6,
              targets=None, drills=None, retest=None, days_ago=None):
    today = dt.datetime.now(dt.timezone.utc).date()
    offset_days = (week_number - 1) * 7 if days_ago is None else days_ago
    start_date = (today - dt.timedelta(days=offset_days)).strftime("%Y-%m-%d")
    week = {
        "weekNumber": week_number,
        "theme": "Week", "focus": "Focus", "progressionNote": "Builds",
        "targets": targets if targets is not None else [
            {"domain": "linearSpeed", "exposures": 2, "note": "Quality"},
        ],
        "drills": drills if drills is not None else [plan_drill("SPD-002")],
    }
    weeks = [week]
    for n in range(1, horizon + 1):
        if n != week_number:
            weeks.append({"weekNumber": n, "theme": "W", "focus": "F", "progressionNote": "B",
                          "targets": [], "drills": []})
    payload = {
        "status": "active", "startDate": start_date, "horizonWeeks": horizon,
        "catalogVersion": "1.0.0", "weeks": weeks,
        "retest": retest or {"weekNumber": horizon, "drills": ["sprint"], "note": "Same setup."},
    }
    db.set_doc(("players", player_id, "trainingPlans", "plan1"), payload)
    return "plan1"


def week_context(make_invocation, db, *, params=None, **kwargs):
    plan_id = seed_plan(db, **kwargs)
    merged_params = {**BUILD_PARAMS, "planId": plan_id, **(params or {})}
    inv = make_invocation(params=merged_params)
    inv.context["activePlanWeek"] = assemble_active_plan_week(inv)
    return inv


# ---------------------------------------------------------------------------
# activePlanWeek
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("patch", [
    {"planId": None},
    {"timeAvailableMinutes": 0},
    {"energy": "medium"},
    {"focusDomains": "shooting"},
    {"equipmentToday": "ball"},
])
def test_malformed_params_rejected(make_invocation, db, patch):
    seed_plan(db)
    inv = make_invocation(params={**BUILD_PARAMS, **patch})
    with pytest.raises(GatewayError) as err:
        assemble_active_plan_week(inv)
    assert err.value.code == "invalid_request"


def test_no_active_plan_is_context_unavailable(make_invocation, db):
    inv = make_invocation(params=BUILD_PARAMS)
    with pytest.raises(GatewayError) as err:
        assemble_active_plan_week(inv)
    assert err.value.code == "context_unavailable"


def test_stale_plan_id_rejected(make_invocation, db):
    seed_plan(db)
    inv = make_invocation(params={**BUILD_PARAMS, "planId": "not-the-active-one"})
    with pytest.raises(GatewayError) as err:
        assemble_active_plan_week(inv)
    assert err.value.code == "invalid_request"
    assert "stale" in str(err.value)


def test_resolves_current_week_and_retest_flag(make_invocation, db):
    seed_plan(db, week_number=1)
    inv = make_invocation(params=BUILD_PARAMS)
    out = assemble_active_plan_week(inv)
    assert out["planId"] == "plan1"
    assert out["weekNumber"] == 1
    assert out["isRetestWeek"] is False
    assert out["isMicroSession"] is False


def test_micro_session_flag_below_threshold(make_invocation, db):
    seed_plan(db)
    inv = make_invocation(params={**BUILD_PARAMS, "timeAvailableMinutes": 12})
    out = assemble_active_plan_week(inv)
    assert out["isMicroSession"] is True


def test_week_six_is_flagged_as_retest(make_invocation, db):
    seed_plan(db, week_number=6, horizon=6,
              retest={"weekNumber": 6, "drills": ["sprint", "jump"], "note": "Repeat baseline."})
    inv = make_invocation(params=BUILD_PARAMS)
    out = assemble_active_plan_week(inv)
    assert out["weekNumber"] == 6
    assert out["isRetestWeek"] is True
    assert out["retest"]["drills"] == ["sprint", "jump"]


# ---------------------------------------------------------------------------
# weekProgress (parity assembler — must match WeeklyProgressBuilder.swift)
# ---------------------------------------------------------------------------


def _plan_start(db):
    return dt.datetime.strptime(
        db.get_doc(("players", "player1", "trainingPlans", "plan1"))["startDate"], "%Y-%m-%d"
    ).replace(tzinfo=dt.timezone.utc)


def test_fresh_week_has_zero_progress(make_invocation, db):
    inv = week_context(make_invocation, db, targets=[
        {"domain": "linearSpeed", "exposures": 2, "note": "Quality"},
        {"domain": "dribbling", "exposures": 1, "note": "Touches"},
    ], drills=[plan_drill("SPD-002"), plan_drill("DRB-001", domain="dribbling", freq=1)])
    out = assemble_week_progress(inv)
    assert {d["domain"]: d["exposuresDone"] for d in out["domainProgress"]} == {"linearSpeed": 0, "dribbling": 0}
    assert all(d["state"] == "notStarted" for d in out["drillProgress"])


def test_mostly_done_week_only_dribbling_remains(make_invocation, db):
    inv = week_context(make_invocation, db, targets=[
        {"domain": "linearSpeed", "exposures": 2, "note": "Quality"},
        {"domain": "dribbling", "exposures": 1, "note": "Touches"},
    ], drills=[plan_drill("SPD-002", freq=2), plan_drill("DRB-001", domain="dribbling", freq=1)])
    db.set_doc(("players", "player1", "workoutLogs", "w1"), {
        "planId": "plan1", "weekNumber": 1,
        "blocks": [
            {"blockId": "b1", "drillId": "SPD-002", "domain": "linearSpeed", "status": "done"},
            {"blockId": "b2", "drillId": "SPD-002", "domain": "linearSpeed", "status": "done"},
        ],
    })
    out = assemble_week_progress(inv)
    progress = {d["domain"]: d for d in out["domainProgress"]}
    assert progress["linearSpeed"]["exposuresDone"] == 2
    assert progress["dribbling"]["exposuresDone"] == 0
    drills = {d["drillId"]: d for d in out["drillProgress"]}
    assert drills["SPD-002"]["state"] == "done"
    assert drills["DRB-001"]["state"] == "notStarted"


def test_skipped_with_pain_does_not_count(make_invocation, db):
    inv = week_context(make_invocation, db)
    db.set_doc(("players", "player1", "workoutLogs", "w1"), {
        "planId": "plan1", "weekNumber": 1,
        "blocks": [{"blockId": "b1", "drillId": "SPD-002", "domain": "linearSpeed",
                    "status": "skipped", "skipReason": "pain"}],
    })
    out = assemble_week_progress(inv)
    assert out["domainProgress"][0]["exposuresDone"] == 0


def test_free_recorded_reps_from_one_session_count_once(make_invocation, db):
    inv = week_context(make_invocation, db, targets=[{"domain": "linearSpeed", "exposures": 2, "note": "n"}])
    window_start = _plan_start(db)
    add_rep(db, "player1", "r1", {"repType": "sprint", "createdAt": window_start, "sessionNumber": 3})
    add_rep(db, "player1", "r2", {"repType": "sprint", "createdAt": window_start, "sessionNumber": 3})
    out = assemble_week_progress(inv)
    assert out["domainProgress"][0]["exposuresDone"] == 1


def test_deadball_shot_rep_type_side_kick_credits_shooting(make_invocation, db):
    # Deadball shot reps are written with repType "side_kick", not the app's
    # canonical "deadballShot" drill id — see MEASURED_DRILL_ID_DOMAINS' and
    # WeeklyProgressBuilder.swift's doc comments on the split.
    inv = week_context(make_invocation, db, targets=[{"domain": "shooting", "exposures": 1, "note": "n"}])
    window_start = _plan_start(db)
    add_rep(db, "player1", "r1", {"repType": "side_kick", "createdAt": window_start, "sessionNumber": 1})
    out = assemble_week_progress(inv)
    assert out["domainProgress"][0]["exposuresDone"] == 1


def test_rep_at_week_boundary_counts_toward_next_week_not_current(make_invocation, db):
    inv = week_context(make_invocation, db, week_number=1, horizon=2,
                        targets=[{"domain": "linearSpeed", "exposures": 1, "note": "n"}])
    window_end = _plan_start(db) + dt.timedelta(days=7)  # week 1's exclusive end
    add_rep(db, "player1", "r1", {"repType": "sprint", "createdAt": window_end, "sessionNumber": 1})
    out = assemble_week_progress(inv)
    assert out["domainProgress"][0]["exposuresDone"] == 0


def test_rep_covered_by_a_logged_training_session_is_not_a_second_exposure(make_invocation, db):
    inv = week_context(make_invocation, db, targets=[{"domain": "linearSpeed", "exposures": 2, "note": "n"}])
    window_start = _plan_start(db)
    db.set_doc(("players", "player1", "workoutLogs", "w1"), {
        "planId": "plan1", "weekNumber": 1, "linkedTrainingSessionId": "ts1",
        "blocks": [{"blockId": "b1", "drillId": "SPD-002", "domain": "linearSpeed", "status": "done"}],
    })
    db.set_doc(("players", "player1", "trainingSessions", "ts1"), {
        "sessionRefs": [{"sessionDocId": "r1", "drillType": "sprint", "sessionNumber": 1}],
    })
    add_rep(db, "player1", "r1", {"repType": "sprint", "createdAt": window_start, "sessionNumber": 1})
    out = assemble_week_progress(inv)
    # 1 from the logged block; the rep that produced it is not a second, free exposure.
    assert out["domainProgress"][0]["exposuresDone"] == 1


def test_week_progress_debits_minutes_from_done_blocks(make_invocation, db):
    """PLAN_GENERATION_V2_PLAN Part 3: a done block debits its own
    estimatedMinutes against the drill's server-computed weeklyMinutes."""
    inv = week_context(make_invocation, db, drills=[
        {**plan_drill("SPD-002", freq=2, est=8), "weeklyMinutes": 16},
    ])
    db.set_doc(("players", "player1", "workoutLogs", "w1"), {
        "planId": "plan1", "weekNumber": 1,
        "blocks": [{"blockId": "b1", "drillId": "SPD-002", "domain": "linearSpeed",
                    "status": "done", "estimatedMinutes": 8}],
    })
    out = assemble_week_progress(inv)
    row = out["drillProgress"][0]
    assert row["weeklyMinutes"] == 16
    assert row["minutesDone"] == 8
    assert row["minutesRemaining"] == 8


def test_week_progress_minutes_fall_back_on_v1_plans_and_old_logs(make_invocation, db):
    """A v1 plan row has no weeklyMinutes (fall back to estimatedMinutes x
    frequency) and a pre-player log block has no estimatedMinutes (debits
    nothing) — exposures accounting is untouched either way."""
    inv = week_context(make_invocation, db, drills=[plan_drill("SPD-002", freq=2, est=8)])
    db.set_doc(("players", "player1", "workoutLogs", "w1"), {
        "planId": "plan1", "weekNumber": 1,
        "blocks": [{"blockId": "b1", "drillId": "SPD-002", "domain": "linearSpeed",
                    "status": "done"}],
    })
    out = assemble_week_progress(inv)
    row = out["drillProgress"][0]
    assert row["weeklyMinutes"] == 16
    assert row["minutesDone"] == 0
    assert row["minutesRemaining"] == 16
    assert row["completed"] == 1  # the exposure still counted


def test_workout_candidates_carry_remaining_minutes(make_invocation, db):
    db.set_doc(("drillCatalog", "SPD-002"), catalog_drill("SPD-002"))
    inv = week_context(make_invocation, db, drills=[
        {**plan_drill("SPD-002", freq=2, est=8), "weeklyMinutes": 16},
    ])
    db.set_doc(("players", "player1", "workoutLogs", "w1"), {
        "planId": "plan1", "weekNumber": 1,
        "blocks": [{"blockId": "b1", "drillId": "SPD-002", "domain": "linearSpeed",
                    "status": "done", "estimatedMinutes": 8}],
    })
    inv.context["weekProgress"] = assemble_week_progress(inv)
    out = assemble_workout_candidates(inv)
    assert out["drills"][0]["remainingMinutesThisWeek"] == 8


# ---------------------------------------------------------------------------
# workoutCandidates
# ---------------------------------------------------------------------------


def test_workout_candidates_hydrates_and_flags_low_energy(make_invocation, db):
    db.set_doc(("drillCatalog", "SPD-002"), catalog_drill("SPD-002", intensity="maxQuality", equipment=("cones",)))
    db.set_doc(("drillCatalog", "DRB-001"), catalog_drill("DRB-001", domain="dribbling", intensity="moderate", equipment=("ball",)))
    inv = week_context(make_invocation, db, params={"energy": "low"}, targets=[
        {"domain": "linearSpeed", "exposures": 2, "note": "n"},
        {"domain": "dribbling", "exposures": 1, "note": "n"},
    ], drills=[plan_drill("SPD-002"), plan_drill("DRB-001", domain="dribbling", intensity="moderate")])
    inv.context["weekProgress"] = assemble_week_progress(inv)

    out = assemble_workout_candidates(inv)
    by_id = {d["drillId"]: d for d in out["drills"]}
    assert by_id["SPD-002"]["energyBlocked"] is True
    assert by_id["DRB-001"]["energyBlocked"] is False
    assert by_id["SPD-002"]["remainingExposuresThisWeek"] == 2
    assert by_id["SPD-002"]["regression"] == "Trim the range and reps."
    assert out["retestBlocks"] == []


def test_workout_candidates_flags_equipment_ineligible(make_invocation, db):
    db.set_doc(("drillCatalog", "SPD-002"), catalog_drill("SPD-002", equipment=("goal",)))
    inv = week_context(make_invocation, db, params={"equipmentToday": ["ball", "cones"]},
                        drills=[plan_drill("SPD-002")])
    inv.context["weekProgress"] = assemble_week_progress(inv)
    out = assemble_workout_candidates(inv)
    assert out["drills"][0]["equipmentEligible"] is False


def test_workout_candidates_retest_week_includes_pseudo_blocks(make_invocation, db):
    db.set_doc(("drillCatalog", "SPD-002"), catalog_drill("SPD-002"))
    inv = week_context(make_invocation, db, week_number=6, horizon=6,
                        retest={"weekNumber": 6, "drills": ["sprint", "jump"], "note": "Repeat baseline."},
                        targets=[{"domain": "linearSpeed", "exposures": 1, "note": "n"}],
                        drills=[plan_drill("SPD-002")])
    inv.context["weekProgress"] = assemble_week_progress(inv)
    out = assemble_workout_candidates(inv)
    assert out["isRetestWeek"] is True
    types = {b["measuredDrillType"] for b in out["retestBlocks"]}
    assert types == {"sprint", "jump"}
    sprint_block = next(b for b in out["retestBlocks"] if b["measuredDrillType"] == "sprint")
    assert sprint_block["domain"] == "linearSpeed"


# ---------------------------------------------------------------------------
# Validator
# ---------------------------------------------------------------------------


def workout_context(inv, *, energy="normal", time_available=20, focus_domains=None,
                     is_micro=False, retest_blocks=None):
    inv.context["workoutCandidates"] = {
        "drills": [
            {"drillId": "SPD-002", "domain": "linearSpeed", "intensityIntent": "maxQuality",
             "energyBlocked": energy == "low",
             "dose": {"setsMin": 2, "setsMax": 4, "repsMin": 2, "repsMax": 4,
                       "restSecondsMin": 60, "restSecondsMax": 120}},
            {"drillId": "STR-010", "domain": "strengthResilience", "intensityIntent": "low",
             "energyBlocked": False,
             "dose": {"setsMin": 1, "setsMax": 1, "repsMin": 8, "repsMax": 12,
                       "restSecondsMin": 0, "restSecondsMax": 0}},
            {"drillId": "DRB-001", "domain": "dribbling", "intensityIntent": "moderate",
             "energyBlocked": False,
             "dose": {"setsMin": 2, "setsMax": 4, "repsMin": 2, "repsMax": 4,
                       "restSecondsMin": 30, "restSecondsMax": 60}},
        ],
        "retestBlocks": retest_blocks or [],
        "energy": energy,
        "timeAvailableMinutes": time_available,
        "isMicroSession": is_micro,
        "focusDomains": focus_domains or [],
    }


def good_workout():
    return {
        "schemaVersion": 1, "estimatedMinutes": 18,
        "intro": "Quick speed + warmup session.",
        "blocks": [
            {"blockId": "b1", "order": 1, "kind": "warmup", "drillId": "STR-010", "name": "Movement circuit",
             "domain": "strengthResilience", "sets": 1, "reps": 10, "repUnit": "minutes", "restSeconds": 0,
             "estimatedMinutes": 10, "cues": ["Go"], "whyIncluded": "Standing warmup.",
             "isMeasuredDrill": False, "measuredDrillType": None},
            {"blockId": "b2", "order": 2, "kind": "main", "drillId": "SPD-002", "name": "Drill SPD-002",
             "domain": "linearSpeed", "sets": 3, "reps": 3, "repUnit": "reps", "restSeconds": 90,
             "estimatedMinutes": 8, "cues": ["Go"], "whyIncluded": "Speed target.",
             "isMeasuredDrill": False, "measuredDrillType": None},
        ],
        "stopRule": "Stop for pain, technique loss, or a big speed drop.",
    }


def test_validator_passes_good_workout(make_invocation):
    inv = make_invocation()
    workout_context(inv)
    assert validate_workout_v1(good_workout(), inv) == []


def test_validator_catches_out_of_pool_drill(make_invocation):
    inv = make_invocation()
    workout_context(inv)
    bad = good_workout()
    bad["blocks"][1]["drillId"] = "HAX-999"
    violations = validate_workout_v1(bad, inv)
    assert any("HAX-999" in v and "candidate pool" in v for v in violations)


def test_validator_enforces_energy_blocked_dose_floor(make_invocation):
    inv = make_invocation()
    workout_context(inv, energy="low", time_available=20)
    bad = good_workout()
    bad["blocks"][1]["sets"] = 4  # above SPD-002's setsMin=2 while energyBlocked
    violations = validate_workout_v1(bad, inv)
    assert any("energy" in v and "trimmed" in v for v in violations)


def test_validator_enforces_dose_ranges(make_invocation):
    inv = make_invocation()
    workout_context(inv)
    bad = good_workout()
    bad["blocks"][1]["sets"] = 9
    violations = validate_workout_v1(bad, inv)
    assert any("sets 9 outside" in v for v in violations)


def test_validator_enforces_maxquality_before_game(make_invocation):
    inv = make_invocation()
    workout_context(inv, time_available=20)
    inv.context["workoutCandidates"]["drills"].append(
        {"drillId": "SSG-001", "domain": "representativeGames", "intensityIntent": "moderate",
         "energyBlocked": False,
         "dose": {"setsMin": 1, "setsMax": 1, "repsMin": 1, "repsMax": 1, "restSecondsMin": 0, "restSecondsMax": 0}}
    )
    bad = good_workout()
    bad["blocks"] = [
        {"blockId": "b1", "order": 1, "kind": "game", "drillId": "SSG-001", "name": "Game",
         "domain": "representativeGames", "sets": 1, "reps": 1, "repUnit": "reps", "restSeconds": 0,
         "estimatedMinutes": 10, "cues": [], "whyIncluded": "x", "isMeasuredDrill": False, "measuredDrillType": None},
        {"blockId": "b2", "order": 2, "kind": "main", "drillId": "SPD-002", "name": "Speed",
         "domain": "linearSpeed", "sets": 3, "reps": 3, "repUnit": "reps", "restSeconds": 90,
         "estimatedMinutes": 8, "cues": [], "whyIncluded": "x", "isMeasuredDrill": False, "measuredDrillType": None},
    ]
    bad["estimatedMinutes"] = 18
    violations = validate_workout_v1(bad, inv)
    assert any("maxQuality" in v and "game" in v for v in violations)


def test_validator_enforces_time_budget(make_invocation):
    inv = make_invocation()
    workout_context(inv, time_available=60)
    violations = validate_workout_v1(good_workout(), inv)  # 18 min against a 60-min budget
    assert any("timeAvailableMinutes" in v for v in violations)


def test_validator_enforces_micro_session_single_block(make_invocation):
    inv = make_invocation()
    workout_context(inv, time_available=10, is_micro=True)
    violations = validate_workout_v1(good_workout(), inv)  # 2 blocks
    assert any("micro session" in v for v in violations)


def test_validator_enforces_requested_focus_domain_covered(make_invocation):
    inv = make_invocation()
    workout_context(inv, time_available=20, focus_domains=["dribbling"])
    violations = validate_workout_v1(good_workout(), inv)  # no dribbling block
    assert any("focusDomains" in v and "dribbling" in v for v in violations)


def test_validator_enforces_retest_block_shape(make_invocation):
    inv = make_invocation()
    workout_context(inv, time_available=20, retest_blocks=[
        {"measuredDrillType": "sprint", "domain": "linearSpeed", "name": "Retest: sprint", "estimatedMinutes": 8},
    ])
    bad = good_workout()
    bad["blocks"][1] = {
        "blockId": "b2", "order": 2, "kind": "main", "drillId": "wrongId", "name": "Sprint retest",
        "domain": "linearSpeed", "sets": 1, "reps": 1, "repUnit": "reps", "restSeconds": 0,
        "estimatedMinutes": 8, "cues": [], "whyIncluded": "Retest.",
        "isMeasuredDrill": True, "measuredDrillType": "sprint",
    }
    violations = validate_workout_v1(bad, inv)
    assert any("must equal its own measuredDrillType" in v for v in violations)


# ---------------------------------------------------------------------------
# Finalizer
# ---------------------------------------------------------------------------


def test_finalizer_persists_disposable_doc(make_invocation, db):
    inv = make_invocation(params={"planId": "plan1", "timeAvailableMinutes": 20, "energy": "normal"})
    inv.job_id = "job9"
    inv.context["activePlanWeek"] = {
        "planId": "plan1", "weekNumber": 2, "catalogVersion": "1.0.0",
        "timeAvailableMinutes": 20, "energy": "normal", "focusDomains": [], "equipmentToday": None,
    }
    payload = _finalize_build_workout(inv, good_workout())

    assert payload["planId"] == "plan1"
    assert payload["weekNumber"] == 2
    assert payload["jobId"] == "job9"
    assert payload["params"]["energy"] == "normal"
    stored = db.get_doc(("players", "player1", "plannedWorkouts", payload["workoutId"]))
    assert stored["intro"] == good_workout()["intro"]

    # Regenerating creates a second, independent doc — no supersede machinery
    # (WORKOUT_BUILDER_AGENT_PLAN Part 0.6: a workout is cheap and disposable).
    payload2 = _finalize_build_workout(inv, good_workout())
    assert payload2["workoutId"] != payload["workoutId"]


# ---------------------------------------------------------------------------
# Adjustment rebuilds (adjustmentRequest / previousWorkoutId, contract §5)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("patch", [
    {"adjustmentRequest": ""},
    {"adjustmentRequest": "   "},
    {"adjustmentRequest": 123},
    {"adjustmentRequest": "x" * 501},
    {"previousWorkoutId": ""},
    {"previousWorkoutId": 7},
    {"previousWorkoutId": "players/player1/plannedWorkouts/w1"},
    {"previousWorkoutId": ".."},
])
def test_adjustment_params_validated(make_invocation, db, patch):
    seed_plan(db)
    inv = make_invocation(params={**BUILD_PARAMS, **patch})
    with pytest.raises(GatewayError) as err:
        assemble_active_plan_week(inv)
    assert err.value.code == "invalid_request"


def test_plain_build_has_no_adjustment_context(make_invocation, db):
    seed_plan(db)
    inv = make_invocation(params=BUILD_PARAMS)
    out = assemble_active_plan_week(inv)
    assert out["adjustmentRequest"] is None
    assert out["previousWorkout"] is None


def test_adjustment_loads_condensed_previous_workout(make_invocation, db):
    seed_plan(db)
    db.set_doc(("players", "player1", "plannedWorkouts", "w-prev"), {
        "planId": "plan1", "weekNumber": 1, "estimatedMinutes": 28,
        "intro": "Yesterday's intro.",
        "params": {"timeAvailableMinutes": 30, "energy": "normal", "focusDomains": []},
        "blocks": [
            {"blockId": "b1", "order": 1, "kind": "main", "drillId": "SPD-002",
             "name": "Falling start", "domain": "linearSpeed", "sets": 3, "reps": 3,
             "repUnit": "reps", "restSeconds": 90, "estimatedMinutes": 8,
             "cues": ["Go"], "whyIncluded": "Speed.", "isMeasuredDrill": False,
             "measuredDrillType": None},
        ],
        "stopRule": "Stop for pain.",
    })
    inv = make_invocation(params={
        **BUILD_PARAMS,
        "adjustmentRequest": "  only 20 minutes, no goal today  ",
        "previousWorkoutId": "w-prev",
    })
    out = assemble_active_plan_week(inv)
    assert out["adjustmentRequest"] == "only 20 minutes, no goal today"
    assert out["previousWorkout"]["workoutId"] == "w-prev"
    assert out["previousWorkout"]["blocks"][0]["drillId"] == "SPD-002"
    # Condensed: teaching/rationale fields stay out of the rebuild context.
    assert "cues" not in out["previousWorkout"]["blocks"][0]
    assert "whyIncluded" not in out["previousWorkout"]["blocks"][0]


def test_adjustment_tolerates_missing_previous_workout(make_invocation, db):
    seed_plan(db)
    inv = make_invocation(params={
        **BUILD_PARAMS,
        "adjustmentRequest": "make it shorter",
        "previousWorkoutId": "w-gone",
    })
    out = assemble_active_plan_week(inv)
    assert out["adjustmentRequest"] == "make it shorter"
    assert out["previousWorkout"] is None


def test_validator_relaxes_time_budget_on_adjustment(make_invocation):
    inv = make_invocation()
    workout_context(inv, time_available=40)  # good_workout() is ~18 min
    assert any("timeAvailableMinutes" in v for v in validate_workout_v1(good_workout(), inv))

    inv.context["activePlanWeek"] = {"adjustmentRequest": "only 20 minutes today"}
    assert validate_workout_v1(good_workout(), inv) == []


def test_adjustment_time_budget_has_no_floor(make_invocation):
    # "only 20 minutes" against a 60-minute build is 0.30x — the feature's own
    # placeholder example. The rebuild keeps only the runaway upper bound.
    inv = make_invocation()
    workout_context(inv, time_available=60)
    inv.context["activePlanWeek"] = {"adjustmentRequest": "only 20 minutes today"}
    assert validate_workout_v1(good_workout(), inv) == []  # 18 min vs 60


def test_validator_skips_focus_check_on_adjustment(make_invocation):
    inv = make_invocation()
    workout_context(inv, time_available=20, focus_domains=["dribbling"])
    assert any("dribbling" in v for v in validate_workout_v1(good_workout(), inv))

    inv.context["activePlanWeek"] = {"adjustmentRequest": "no dribbling today"}
    assert validate_workout_v1(good_workout(), inv) == []


def test_build_workout_prompt_carries_the_adjustment(make_invocation):
    from gateway.prompts import render_prompt

    plain_system, plain_user = render_prompt("build_workout_v1", {"activePlanWeek": {}})
    assert "rebuild:" not in plain_user

    system, user = render_prompt("build_workout_v1", {
        "activePlanWeek": {
            "adjustmentRequest": "only 20 minutes, no goal today",
            "previousWorkout": {"workoutId": "w-prev"},
        },
    })
    assert "adjustmentRequest" in system
    assert "rebuild" in user
    assert "only 20 minutes, no goal today" in user


def test_duplicate_workout_drills_rejected_independent_of_block_identity(make_invocation):
    from copy import deepcopy
    from gateway.validators import assert_unique_workout_drills
    from gateway.errors import GatewayError
    inv = make_invocation(); workout_context(inv)
    value = good_workout()
    repeated = deepcopy(value['blocks'][0]); repeated.update(blockId='extra', order=3, kind='main')
    value['blocks'].append(repeated)
    assert any('repeats drillId' in message for message in validate_workout_v1(value, inv))
    with pytest.raises(GatewayError, match='cannot repeat'):
        assert_unique_workout_drills(value)


@pytest.mark.parametrize('enforced', ['0', '1'])
def test_legacy_finalizer_cannot_persist_duplicate_drills_with_relaxed_validators(make_invocation, db, monkeypatch, enforced):
    from copy import deepcopy
    monkeypatch.setenv('VALIDATORS_ENFORCED', enforced)
    inv = make_invocation()
    value = good_workout()
    value['blocks'].append(dict(deepcopy(value['blocks'][1]), blockId='b3', order=3))
    with pytest.raises(GatewayError, match='cannot repeat'):
        _finalize_build_workout(inv, value)
    assert not db.get_collection(('players', inv.player_id, 'plannedWorkouts'))
