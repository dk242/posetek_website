"""generate_training_plan unit coverage: the intake gate (R26 short-circuit),
candidate-pool composition (PLAN_GENERATION_AGENT_PLAN.md B2/B3 grain), the v2
allocate/fill validators, and the finalizer's composition + supersede-and-persist
behavior (PLAN_GENERATION_V2_PLAN B1/B3/B4/B6 grain). No model calls anywhere."""

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
    assemble_plan_candidate_drills,
    assemble_plan_intake_gate,
    assemble_plan_knowledge,
    assemble_training_history,
)
from gateway.errors import GatewayError
from gateway.pipeline import _finalize_training_plan, _plan_fill_next_week
from gateway.validators import (
    validate_plan_allocation_v1,
    validate_plan_assessment_v1,
    validate_plan_week_v1,
)


GOOD_INTAKE = {
    "goals": ["faster", "betterShooter"],
    "freeTextGoals": "Tryouts in two months.",
    "daysPerWeek": 3,
    "minutesPerSession": 45,
    "setting": "solo",
    "equipment": ["ball", "cones"],
    "level": "club",
    "painFlag": False,
}


def catalog_drill(drill_id, *, domain="linearSpeed", min_age=9, max_age=19,
                  levels=("foundation", "club", "performance"), modes=("solo", "coachApp"),
                  gate="any", equipment=("cones",), est=(2, 8)):
    return {
        "drillId": drill_id,
        "name": f"Drill {drill_id}",
        "domain": domain,
        "deficitTags": ["ACC"],
        "minAge": min_age,
        "maxAge": max_age,
        "eligibleLevels": list(levels),
        "maturityGate": gate,
        "deliveryModes": list(modes),
        "equipment": list(equipment),
        "contraindications": [],
        "targetQuality": "acceleration",
        "intensityIntent": "maxQuality",
        "technicalTransfer": "isolated",
        "evidenceTier": "A",
        "execution": "Do the thing.",
        "cues": ["Go"],
        "estimatedMinutes": {"min": est[0], "max": est[1]},
        "dose": {
            "setsMin": 2, "setsMax": 4, "repsMin": 2, "repsMax": 3, "repUnit": "reps",
            "perSide": False, "restSecondsMin": 60, "restSecondsMax": 120,
            "frequencyPerWeekMin": 1, "frequencyPerWeekMax": 2,
            "doseText": "2-4 sets x 2-3 reps", "restText": "60-120 s", "frequencyText": "1-2x/week",
        },
    }


def seed_player(db, player_id="player1", age=13):
    data = {"name": "Test Athlete"}
    if age is not None:
        data["age"] = age
    db.set_doc(("players", player_id), data)


def seed_catalog(db, drills):
    for d in drills:
        db.set_doc(("drillCatalog", d["drillId"]), d)


# ---------------------------------------------------------------------------
# Intake gate
# ---------------------------------------------------------------------------


def test_pain_flag_short_circuits(make_invocation):
    inv = make_invocation(params={"intake": {**GOOD_INTAKE, "painFlag": True}})
    with pytest.raises(GatewayError) as err:
        assemble_plan_intake_gate(inv)
    assert err.value.code == "invalid_request"
    assert "R26" in str(err.value)


@pytest.mark.parametrize("patch", [
    {"daysPerWeek": 9},
    {"minutesPerSession": 20},
    {"setting": "stadium"},
    {"level": "elite"},
    {"goals": ["a", "b", "c"]},
    {"horizonWeeks": 3},
    {"horizonWeeks": 13},
    {"horizonWeeks": "6"},
    {"horizonWeeks": True},
    {"age": 4},
    {"age": 12.5},
])
def test_malformed_intake_rejected(make_invocation, patch):
    inv = make_invocation(params={"intake": {**GOOD_INTAKE, **patch}})
    with pytest.raises(GatewayError):
        assemble_plan_intake_gate(inv)


def test_intake_gate_maps_goal_domains(make_invocation):
    inv = make_invocation(params={"intake": GOOD_INTAKE})
    out = assemble_plan_intake_gate(inv)
    assert out["goalDomains"] == ["linearSpeed", "shooting"]
    assert out["weeklyBudgetMinutes"] == 135
    assert out["intake"]["painFlag"] is False
    # Old clients send neither field: horizon defaults, age stays unknown.
    assert out["intake"]["horizonWeeks"] == 6
    assert out["intake"]["age"] is None


def test_intake_gate_maps_category_goal_vocabulary(make_invocation):
    """The app's six-category questionnaire (speedAgility … strengthPower)."""
    intake = {**GOOD_INTAKE, "goals": ["speedAgility", "strengthPower"],
              "setting": "halfAndHalf", "age": 15, "horizonWeeks": 9}
    inv = make_invocation(params={"intake": intake})
    out = assemble_plan_intake_gate(inv)
    assert out["goalDomains"] == [
        "linearSpeed", "codAgility", "strengthResilience", "verticalPower", "horizontalPower"
    ]
    assert out["intake"]["setting"] == "halfAndHalf"
    assert out["intake"]["age"] == 15
    assert out["intake"]["horizonWeeks"] == 9


def test_first_touch_and_passing_map_to_passing_receiving(make_invocation):
    inv = make_invocation(params={"intake": {**GOOD_INTAKE, "goals": ["firstTouch", "passing"]}})
    assert assemble_plan_intake_gate(inv)["goalDomains"] == ["passingReceiving"]


# ---------------------------------------------------------------------------
# Candidate pool composition
# ---------------------------------------------------------------------------


def make_plan_context(make_invocation, db, *, age=13, intake=None):
    seed_player(db, age=age)
    inv = make_invocation(params={"intake": intake or GOOD_INTAKE})
    inv.context["planIntake"] = assemble_plan_intake_gate(inv)
    inv.context["planKnowledge"] = assemble_plan_knowledge(inv)
    return inv


def test_candidate_pool_filters_compose(make_invocation, db):
    seed_catalog(db, [
        catalog_drill("SPD-OK"),
        catalog_drill("SPD-TOOOLD", min_age=15),                       # age 13 < minAge
        catalog_drill("SHT-GOAL", domain="shooting", equipment=("goal",)),  # goal not selected
        catalog_drill("STR-PERF", levels=("performance",)),            # level mismatch
        catalog_drill("VJP-LATE", gate="postPHVMostly"),               # maturity gate needs 15+
        catalog_drill("COD-PAIR", modes=("partner",)),                 # solo setting
        catalog_drill("DRB-BALL", domain="dribbling", equipment=("ball",)),  # ball implicit
    ])
    inv = make_plan_context(make_invocation, db)
    out = assemble_plan_candidate_drills(inv)
    ids = {d["drillId"] for d in out["drills"]}
    assert ids == {"SPD-OK", "DRB-BALL"}
    spd = next(d for d in out["drills"] if d["drillId"] == "SPD-OK")
    assert spd["dose"]["setsMax"] == 4  # hydration carries the validator's ranges


def test_unknown_age_uses_conservative_default(make_invocation, db):
    seed_catalog(db, [catalog_drill("SPD-OK", min_age=6), catalog_drill("SPD-11", min_age=11)])
    inv = make_plan_context(make_invocation, db, age=None)
    assert inv.context["planKnowledge"]["ageWasUnknown"] is True
    assert inv.context["planKnowledge"]["ageBand"] == "U9-U10"
    ids = {d["drillId"] for d in assemble_plan_candidate_drills(inv)["drills"]}
    assert ids == {"SPD-OK"}  # the 11+ drill is out for the default 10-year-old


def test_intake_age_beats_the_player_doc(make_invocation, db):
    """The questionnaire's self-reported age wins over the (often stale or
    missing) player doc, for both the knowledge band and the candidate pool."""
    seed_catalog(db, [catalog_drill("SPD-OK", min_age=6), catalog_drill("SPD-15", min_age=15)])
    intake = {**GOOD_INTAKE, "age": 16}
    inv = make_plan_context(make_invocation, db, age=10, intake=intake)
    assert inv.context["planKnowledge"]["effectiveAge"] == 16
    assert inv.context["planKnowledge"]["ageWasUnknown"] is False
    ids = {d["drillId"] for d in assemble_plan_candidate_drills(inv)["drills"]}
    assert ids == {"SPD-OK", "SPD-15"}


def test_half_and_half_setting_opens_partner_drills(make_invocation, db):
    seed_catalog(db, [catalog_drill("COD-PAIR", modes=("partner",)),
                      catalog_drill("SPD-OK")])
    intake = {**GOOD_INTAKE, "setting": "halfAndHalf"}
    inv = make_plan_context(make_invocation, db, intake=intake)
    ids = {d["drillId"] for d in assemble_plan_candidate_drills(inv)["drills"]}
    assert ids == {"COD-PAIR", "SPD-OK"}


def test_empty_candidate_pool_is_context_unavailable(make_invocation, db):
    seed_player(db)
    inv = make_plan_context(make_invocation, db)
    with pytest.raises(GatewayError) as err:
        assemble_plan_candidate_drills(inv)
    assert err.value.code == "context_unavailable"


def test_knowledge_slice_shape(make_invocation, db):
    inv = make_plan_context(make_invocation, db)
    k = inv.context["planKnowledge"]
    assert k["ageBand"] == "U13-U14"
    assert k["matrixRow"] is not None
    assert len(k["rules"]) == 28
    assert k["catalogVersion"] == "1.0.0"
    assert "stop" in k["dosagePrinciples"].lower()


def test_training_history_folds_logs(make_invocation, db):
    seed_player(db)
    now = dt.datetime.now(dt.timezone.utc)
    db.set_doc(("players", "player1", "workoutLogs", "w1"), {
        "startedAt": now - dt.timedelta(days=3),
        "blocks": [
            {"drillId": "SPD-002", "domain": "linearSpeed", "status": "done"},
            {"drillId": "STR-010", "domain": "strengthResilience", "status": "skipped",
             "skipReason": "pain"},
        ],
    })
    db.set_doc(("players", "player1", "workoutLogs", "w-old"), {
        "startedAt": now - dt.timedelta(days=60),
        "blocks": [{"drillId": "SPD-002", "domain": "linearSpeed", "status": "done"}],
    })
    db.set_doc(("players", "player1", "trainingPlans", "old1"), {
        "status": "superseded", "startDate": "2026-06-01", "horizonWeeks": 6,
        "focusAreas": [{"domain": "shooting"}],
    })
    inv = make_invocation()
    out = assemble_training_history(inv)
    assert out["recentWorkoutLogs"]["logCount"] == 1
    assert out["recentWorkoutLogs"]["domainExposures"] == {"linearSpeed": 1}
    assert out["recentWorkoutLogs"]["painSkips"] == 1
    assert out["priorPlans"][0]["focusDomains"] == ["shooting"]


# ---------------------------------------------------------------------------
# Validators
# ---------------------------------------------------------------------------


def assessment_context(inv):
    inv.context["planKnowledge"] = {"rules": [{"ruleId": "R01"}, {"ruleId": "R20"}]}
    inv.context["planIntake"] = {"goalDomains": ["linearSpeed", "shooting"], "intake": GOOD_INTAKE}
    inv.params["statsProfile"] = {"drills": [{"metrics": [{"metric": "sprintMaxAcceleration"}]}]}


def good_assessment():
    return {
        "schemaVersion": 1,
        "summary": "Acceleration may be limiting early speed.",
        "findings": [{"ruleId": "R01", "domain": "linearSpeed",
                      "metricIds": ["sprintMaxAcceleration"], "confidence": "moderate",
                      "statement": "5-10 m acceleration is below your matched range."}],
        "dataGaps": ["No COD reps recorded."],
        "focusAreas": [{"domain": "linearSpeed", "rationale": "Largest measured gap."}],
        "reasoning": "Lean acceleration + shooting; keep plyo dose low early.",
    }


def test_assessment_validator_passes_good(make_invocation):
    inv = make_invocation()
    assessment_context(inv)
    assert validate_plan_assessment_v1(good_assessment(), inv) == []


def test_assessment_validator_catches_violations(make_invocation):
    inv = make_invocation()
    assessment_context(inv)
    bad = good_assessment()
    bad["findings"][0]["ruleId"] = "R99"
    bad["findings"][0]["metricIds"] = ["madeUpMetric"]
    bad["focusAreas"] = [{"domain": "codAgility", "rationale": "Vibes."}]
    bad["summary"] = "Your trunk angle caused the result."
    violations = validate_plan_assessment_v1(bad, inv)
    assert len(violations) == 4
    assert any("R99" in v for v in violations)
    assert any("madeUpMetric" in v for v in violations)
    assert any("codAgility" in v for v in violations)
    assert any("banned phrase" in v for v in violations)


def plan_drill(**over):
    base = {"drillId": "SPD-OK", "name": "Drill", "domain": "linearSpeed", "sets": 3,
            "reps": 2, "repUnit": "reps", "restSeconds": 90, "frequencyPerWeek": 2,
            "intensityIntent": "maxQuality", "estimatedMinutes": 8,
            "cues": ["Go"], "note": "Why it's here."}
    base.update(over)
    return base


def _candidate(drill_id, domain):
    return {
        "drillId": drill_id, "name": f"Drill {drill_id}", "domain": domain,
        "estimatedMinutes": {"min": 4, "max": 30},
        "dose": {"setsMin": 2, "setsMax": 4, "repsMin": 2, "repsMax": 3,
                 "restSecondsMin": 60, "restSecondsMax": 120,
                 "frequencyPerWeekMin": 1, "frequencyPerWeekMax": 3},
    }


def plan_stage_context(inv):
    """The shared context both v2 plan validators read: intake + budget, the
    candidate pool, and the accepted assess output."""
    inv.context["planIntake"] = {
        "intake": {**GOOD_INTAKE, "horizonWeeks": 6},
        "goalDomains": ["linearSpeed", "shooting"],
        "weeklyBudgetMinutes": 135,
    }
    inv.context["planCandidateDrills"] = {"count": 4, "drills": [
        _candidate("SPD-OK", "linearSpeed"),
        _candidate("SHT-OK", "shooting"),
        _candidate("STR-OK", "strengthResilience"),
        _candidate("DRB-X", "dribbling"),
    ]}
    inv.stage_outputs["assess"] = good_assessment()  # focusAreas: linearSpeed


def allocation_week(n, allocations=None):
    return {"weekNumber": n, "theme": f"Week {n}",
            "intensityNote": "Progress dose one variable at a time.",
            "allocations": allocations if allocations is not None else [
                {"domain": "linearSpeed", "minutes": 60},
                {"domain": "shooting", "minutes": 45},
                {"domain": "strengthResilience", "minutes": 20},
            ]}


def good_allocation():
    # 125 min/week against a 135-min budget (band 101-148); focus domain
    # linearSpeed holds the plurality over shooting (300 vs 225 total).
    return {"schemaVersion": 1, "planSummary": "Six weeks building speed first.",
            "weeks": [allocation_week(n) for n in range(1, 6)]}


def test_allocation_validator_passes_good(make_invocation):
    inv = make_invocation()
    plan_stage_context(inv)
    assert validate_plan_allocation_v1(good_allocation(), inv) == []


def test_allocation_validator_pins_numbering_to_training_weeks(make_invocation):
    """Weeks are 1..horizon-1 — the retest week is the server's, and an
    allocation that includes it (or skips a week) is rejected."""
    inv = make_invocation()
    plan_stage_context(inv)
    bad = good_allocation()
    bad["weeks"].append(allocation_week(6))
    violations = validate_plan_allocation_v1(bad, inv)
    assert any("numbered exactly 1..5" in v and "retest" in v for v in violations)


def test_allocation_validator_enforces_budget_band(make_invocation):
    inv = make_invocation()
    plan_stage_context(inv)
    over = good_allocation()
    over["weeks"][1] = allocation_week(2, [{"domain": "linearSpeed", "minutes": 200}])
    violations = validate_plan_allocation_v1(over, inv)
    assert any("weeks[2] allocates 200 min" in v for v in violations)

    under = good_allocation()
    under["weeks"][0] = allocation_week(1, [{"domain": "linearSpeed", "minutes": 40}])
    violations = validate_plan_allocation_v1(under, inv)
    assert any("weeks[1] allocates 40 min" in v for v in violations)


def test_allocation_validator_rejects_slivers_and_duplicates(make_invocation):
    inv = make_invocation()
    plan_stage_context(inv)
    bad = good_allocation()
    bad["weeks"][0] = allocation_week(1, [
        {"domain": "linearSpeed", "minutes": 60},
        {"domain": "shooting", "minutes": 55},
        {"domain": "shooting", "minutes": 5},
    ])
    violations = validate_plan_allocation_v1(bad, inv)
    assert any("repeats domain 'shooting'" in v for v in violations)
    assert any("only 5 min" in v and "minimum block" in v for v in violations)


def test_allocation_validator_rejects_unwarranted_and_unfillable_domains(make_invocation):
    """dribbling matches no finding, no focus area, and no goal — and even if
    it did, allocating it requires candidate drills in that domain."""
    inv = make_invocation()
    plan_stage_context(inv)
    inv.context["planCandidateDrills"]["drills"] = [
        _candidate("SPD-OK", "linearSpeed"),
        _candidate("SHT-OK", "shooting"),
        _candidate("STR-OK", "strengthResilience"),
    ]
    bad = good_allocation()
    bad["weeks"][0] = allocation_week(1, [
        {"domain": "linearSpeed", "minutes": 60},
        {"domain": "dribbling", "minutes": 60},
    ])
    violations = validate_plan_allocation_v1(bad, inv)
    assert any("'dribbling'" in v and "no assessed finding" in v for v in violations)
    assert any("'dribbling'" in v and "no drills in that domain" in v for v in violations)


def test_allocation_validator_enforces_focus_plurality(make_invocation):
    inv = make_invocation()
    plan_stage_context(inv)
    bad = {"schemaVersion": 1, "planSummary": "Shooting-heavy.",
           "weeks": [allocation_week(n, [
               {"domain": "linearSpeed", "minutes": 20},
               {"domain": "shooting", "minutes": 85},
               {"domain": "strengthResilience", "minutes": 20},
           ]) for n in range(1, 6)]}
    violations = validate_plan_allocation_v1(bad, inv)
    assert any("plurality" in v and "'shooting'" in v for v in violations)


def test_allocation_validator_caps_rows_per_week(make_invocation):
    """vertex_gemini strips maxItems from the response schema on the premise
    that validators enforce counts post-hoc — so they must."""
    inv = make_invocation()
    plan_stage_context(inv)
    inv.context["planIntake"]["goalDomains"] = [
        "linearSpeed", "shooting", "dribbling", "codAgility", "verticalPower",
    ]
    inv.context["planCandidateDrills"]["drills"] = [
        _candidate("SPD-OK", "linearSpeed"), _candidate("SHT-OK", "shooting"),
        _candidate("DRB-X", "dribbling"), _candidate("COD-OK", "codAgility"),
        _candidate("VJP-OK", "verticalPower"), _candidate("STR-OK", "strengthResilience"),
    ]
    rows = [{"domain": d, "minutes": 20} for d in (
        "linearSpeed", "shooting", "dribbling", "codAgility", "verticalPower",
        "strengthResilience",
    )]
    bad = {"schemaVersion": 1, "planSummary": "Spread thin.",
           "weeks": [allocation_week(n, rows) for n in range(1, 6)]}
    violations = validate_plan_allocation_v1(bad, inv)
    assert any("6 allocation rows" in v for v in violations)


def test_allocation_ramp_shape_is_logged_not_blocking(make_invocation, caplog):
    import logging
    inv = make_invocation()
    plan_stage_context(inv)
    shrinking = {"schemaVersion": 1, "planSummary": "Tapering the whole time.",
                 "weeks": [allocation_week(n, [
                     {"domain": "linearSpeed", "minutes": 90 - 5 * n},
                     {"domain": "strengthResilience", "minutes": 60 - 5 * n},
                 ]) for n in range(1, 6)]}
    with caplog.at_level(logging.INFO, logger="gateway"):
        violations = validate_plan_allocation_v1(shrinking, inv)
    assert not any("decrease" in v for v in violations)
    assert any("ramp check" in r.message for r in caplog.records)


# ---------------------------------------------------------------------------
# Fill (plan_week_v1) validator
# ---------------------------------------------------------------------------


def fill_iteration(inv, *, week=1, prior=None, allocations=None):
    inv.iteration = {"fillWeek": {
        "weekNumber": week,
        "allocation": allocation_week(week, allocations),
        "priorWeeks": prior or [],
    }}


def good_week(number=1):
    # Per-domain sums match allocation_week's 60/45/20 exactly.
    return {"weekNumber": number, "focus": "Speed quality first.",
            "progressionNote": "Next week adds one set.",
            "drills": [
                plan_drill(estimatedMinutes=20, frequencyPerWeek=3),
                plan_drill(drillId="SHT-OK", domain="shooting", estimatedMinutes=15,
                           frequencyPerWeek=3),
                plan_drill(drillId="STR-OK", domain="strengthResilience",
                           estimatedMinutes=10, frequencyPerWeek=2,
                           intensityIntent="low"),
            ]}


def test_week_validator_passes_good(make_invocation):
    inv = make_invocation()
    plan_stage_context(inv)
    fill_iteration(inv)
    assert validate_plan_week_v1(good_week(), inv) == []


def test_week_validator_pins_the_iterations_week_number(make_invocation):
    inv = make_invocation()
    plan_stage_context(inv)
    fill_iteration(inv, week=3)
    violations = validate_plan_week_v1(good_week(1), inv)
    assert any("filling week 3" in v for v in violations)


def test_week_validator_catches_out_of_set_drill_and_dose(make_invocation):
    inv = make_invocation()
    plan_stage_context(inv)
    fill_iteration(inv)
    bad = good_week()
    bad["drills"][0] = plan_drill(drillId="HAX-999", estimatedMinutes=20, frequencyPerWeek=3)
    bad["drills"][1]["sets"] = 9
    violations = validate_plan_week_v1(bad, inv)
    assert any("HAX-999" in v and "candidate set" in v for v in violations)
    assert any("sets 9 outside" in v for v in violations)


def test_week_validator_enforces_minutes_envelope(make_invocation):
    """estimatedMinutes is the accounting currency now — the catalog envelope
    (4-30 in this fixture) is load-bearing, not advisory."""
    inv = make_invocation()
    plan_stage_context(inv)
    fill_iteration(inv, allocations=[{"domain": "linearSpeed", "minutes": 90}])
    bad = {**good_week(), "drills": [plan_drill(estimatedMinutes=45, frequencyPerWeek=2)]}
    violations = validate_plan_week_v1(bad, inv)
    assert any("estimatedMinutes 45 outside catalog envelope 4-30" in v for v in violations)


def test_week_validator_enforces_allocation_adherence(make_invocation):
    inv = make_invocation()
    plan_stage_context(inv)
    fill_iteration(inv)
    bad = good_week()
    bad["drills"][0] = plan_drill(estimatedMinutes=10, frequencyPerWeek=2)  # 20 of 60 linearSpeed min
    violations = validate_plan_week_v1(bad, inv)
    assert any("'linearSpeed' fills 20 min" in v and "60 min" in v for v in violations)


def test_week_validator_rejects_unallocated_domains(make_invocation):
    inv = make_invocation()
    plan_stage_context(inv)
    fill_iteration(inv)
    bad = good_week()
    bad["drills"].append(plan_drill(drillId="DRB-X", domain="dribbling",
                                    estimatedMinutes=10, frequencyPerWeek=1))
    violations = validate_plan_week_v1(bad, inv)
    assert any("'dribbling'" in v and "no allocation" in v for v in violations)


def test_week_validator_falls_back_to_the_accepted_allocation(make_invocation):
    """Without the pipeline's iteration mirror (direct calls), the validator
    resolves the week's allocation row from the accepted allocate output."""
    inv = make_invocation()
    plan_stage_context(inv)
    inv.stage_outputs["allocate"] = good_allocation()
    bad = good_week()
    bad["drills"][0] = plan_drill(estimatedMinutes=10, frequencyPerWeek=2)
    violations = validate_plan_week_v1(bad, inv)
    assert any("'linearSpeed' fills 20 min" in v for v in violations)


def test_week_validator_logs_continuity_retention(make_invocation, caplog):
    import logging
    inv = make_invocation()
    plan_stage_context(inv)
    prior = [{"weekNumber": 1, "drills": [{"drillId": "SPD-OK"}, {"drillId": "STR-OK"}]}]
    fill_iteration(inv, week=2, prior=prior)
    with caplog.at_level(logging.INFO, logger="gateway"):
        violations = validate_plan_week_v1(good_week(2), inv)
    assert violations == []
    assert any("continuity" in r.message for r in caplog.records)


def test_week_validator_rejects_duplicate_drill_ids(make_invocation):
    """Two rows of one drill would game per-domain adherence and give the app
    duplicate Identifiable ids — one row per drill per week."""
    inv = make_invocation()
    plan_stage_context(inv)
    fill_iteration(inv)
    bad = good_week()
    bad["drills"].append(plan_drill(estimatedMinutes=20, frequencyPerWeek=3))
    violations = validate_plan_week_v1(bad, inv)
    assert any("repeats drillId 'SPD-OK'" in v for v in violations)


def test_week_validator_rejects_empty_and_overlong_drill_lists(make_invocation):
    inv = make_invocation()
    plan_stage_context(inv)
    fill_iteration(inv)
    empty = {**good_week(), "drills": []}
    assert any("drills is empty" in v for v in validate_plan_week_v1(empty, inv))

    overlong = good_week()
    overlong["drills"] = [plan_drill(estimatedMinutes=20, frequencyPerWeek=3)] * 9
    assert any("9 items" in v for v in validate_plan_week_v1(overlong, inv))


def test_week_validator_tolerates_one_sided_dose_bounds(make_invocation):
    """A catalog row with setsMin but no setsMax must read as unbounded, not
    raise TypeError inside _validate (which would kill the whole job)."""
    inv = make_invocation()
    plan_stage_context(inv)
    for candidate in inv.context["planCandidateDrills"]["drills"]:
        candidate["dose"]["setsMax"] = None
        candidate["dose"]["restSecondsMin"] = None
    fill_iteration(inv)
    week = good_week()
    week["drills"][0]["sets"] = 9  # legal now: the sets range is open-ended
    violations = validate_plan_week_v1(week, inv)
    assert not any("sets" in v for v in violations)


def test_week_validator_flags_banned_phrases(make_invocation):
    inv = make_invocation()
    plan_stage_context(inv)
    fill_iteration(inv)
    bad = good_week()
    bad["focus"] = "Your weak hips caused the slow starts."
    violations = validate_plan_week_v1(bad, inv)
    assert any("banned phrase" in v for v in violations)


# ---------------------------------------------------------------------------
# Fill iteration source
# ---------------------------------------------------------------------------


def test_fill_source_walks_allocation_weeks_with_digests(make_invocation):
    inv = make_invocation()
    inv.context["planIntake"] = {"intake": {**GOOD_INTAKE, "horizonWeeks": 6}}
    inv.stage_outputs["allocate"] = good_allocation()

    first = _plan_fill_next_week(inv, [])
    assert first["fillWeek"]["weekNumber"] == 1
    assert first["fillWeek"]["allocation"]["theme"] == "Week 1"
    assert first["fillWeek"]["priorWeeks"] == []

    second = _plan_fill_next_week(inv, [good_week(1)])
    assert second["fillWeek"]["weekNumber"] == 2
    digest = second["fillWeek"]["priorWeeks"][0]
    assert digest["weekNumber"] == 1
    assert {d["drillId"] for d in digest["drills"]} == {"SPD-OK", "SHT-OK", "STR-OK"}
    # Digest rows are doses + domains, not the full copy fields.
    assert "note" not in digest["drills"][0]
    assert "cues" not in digest["drills"][0]

    done = _plan_fill_next_week(inv, [good_week(n) for n in range(1, 6)])
    assert done is None


def _walk_fill_source(inv):
    numbers, outputs = [], []
    while True:
        frag = _plan_fill_next_week(inv, outputs)
        if frag is None:
            return numbers
        numbers.append(frag["fillWeek"]["weekNumber"])
        outputs.append(good_week(frag["fillWeek"]["weekNumber"]))


def test_fill_source_ignores_the_retest_slot_under_relaxed_validation(make_invocation):
    """This capability runs relaxed (no strict_validation, VALIDATORS_ENFORCED
    unset), so a misnumbered allocation can be *accepted*. Weeks numbered 1..h
    must fill 1..h-1 only — never drive an extra iteration that collides with
    the stamped retest week."""
    inv = make_invocation()
    inv.context["planIntake"] = {"intake": {**GOOD_INTAKE, "horizonWeeks": 6}}
    inv.stage_outputs["allocate"] = {"schemaVersion": 1, "planSummary": "x",
                                     "weeks": [allocation_week(n) for n in range(1, 7)]}
    assert _walk_fill_source(inv) == [1, 2, 3, 4, 5]


def test_fill_source_skips_gaps_and_dedupes_instead_of_crashing(make_invocation):
    """A numbering gap used to raise GatewayError('internal') mid-chain after
    several paid fill calls; now the usable rows fill and the imperfection
    ships (the relaxed-mode contract), logged by the source."""
    inv = make_invocation()
    inv.context["planIntake"] = {"intake": {**GOOD_INTAKE, "horizonWeeks": 6}}
    inv.stage_outputs["allocate"] = {"weeks": [
        allocation_week(4), allocation_week(2), allocation_week(4), allocation_week(5),
    ]}
    assert _walk_fill_source(inv) == [2, 4, 5]


# ---------------------------------------------------------------------------
# Finalizer
# ---------------------------------------------------------------------------


def fill_result():
    return {"weeks": [good_week(n) for n in range(1, 6)]}


def finalizer_invocation(make_invocation):
    inv = make_invocation(params={"timezone": "America/Los_Angeles"})
    inv.job_id = "job42"
    inv.stage_outputs = {"assess": good_assessment(), "allocate": good_allocation()}
    inv.context["planIntake"] = {"intake": {**GOOD_INTAKE, "horizonWeeks": 6}}
    inv.context["planKnowledge"] = {"catalogVersion": "1.0.0"}
    return inv


def test_finalizer_supersedes_and_persists(make_invocation, db):
    db.set_doc(("players", "player1", "trainingPlans", "old1"),
               {"status": "active", "startDate": "2026-06-01"})
    inv = finalizer_invocation(make_invocation)

    payload = _finalize_training_plan(inv, fill_result())

    assert payload["status"] == "active"
    assert payload["planId"]
    assert payload["jobId"] == "job42"
    assert payload["intake"]["daysPerWeek"] == 3
    assert payload["focusAreas"][0]["domain"] == "linearSpeed"
    assert payload["horizonWeeks"] == 6
    assert len(payload["weeks"]) == 6
    assert payload["planSummary"] == "Six weeks building speed first."
    assert len(payload["disclaimers"]) == 2  # standard disclaimers only

    old = db.get_doc(("players", "player1", "trainingPlans", "old1"))
    assert old["status"] == "superseded"
    new = db.get_doc(("players", "player1", "trainingPlans", payload["planId"]))
    assert new["status"] == "active"
    assert new["startDate"] == payload["startDate"]


def test_finalizer_merges_allocation_computes_minutes_and_derives_targets(make_invocation, db):
    inv = finalizer_invocation(make_invocation)
    payload = _finalize_training_plan(inv, fill_result())

    week1 = payload["weeks"][0]
    assert week1["weekNumber"] == 1
    assert week1["theme"] == "Week 1"                     # from the allocation row
    assert week1["focus"] == "Speed quality first."       # from the fill output
    assert week1["intensityNote"].startswith("Progress dose")
    assert week1["allocations"][0] == {"domain": "linearSpeed", "minutes": 60}

    by_id = {d["drillId"]: d for d in week1["drills"]}
    assert by_id["SPD-OK"]["weeklyMinutes"] == 60         # 20 min x 3/week, server-computed
    assert by_id["SHT-OK"]["weeklyMinutes"] == 45
    assert by_id["STR-OK"]["weeklyMinutes"] == 20

    # Targets are frequencyPerWeek sums per domain, sorted by exposures desc.
    assert week1["targets"] == [
        {"domain": "linearSpeed", "exposures": 3},
        {"domain": "shooting", "exposures": 3},
        {"domain": "strengthResilience", "exposures": 2},
    ]

    assert [w["weekNumber"] for w in payload["allocationSummary"]] == [1, 2, 3, 4, 5]
    assert payload["allocationSummary"][0]["allocations"][0]["domain"] == "linearSpeed"


def test_finalizer_uses_iteration_week_numbers_not_model_echoes(make_invocation, db):
    """Fill output i is paired positionally with usable allocation row i — a
    model that echoes the digest's weekNumber cannot vanish a week or create a
    duplicate in the persisted doc."""
    inv = finalizer_invocation(make_invocation)
    weeks = [good_week(n) for n in range(1, 6)]
    weeks[2]["weekNumber"] = 2  # iteration 3's model echoed week 2's number
    payload = _finalize_training_plan(inv, {"weeks": weeks})
    assert [w["weekNumber"] for w in payload["weeks"]] == [1, 2, 3, 4, 5, 6]


def test_finalizer_does_not_double_number_the_retest_week(make_invocation, db):
    """An accepted allocation numbered 1..h (relaxed validation) must not
    produce a training week sharing the stamped retest week's number."""
    inv = finalizer_invocation(make_invocation)
    inv.stage_outputs["allocate"] = {
        "schemaVersion": 1, "planSummary": "x",
        "weeks": [allocation_week(n) for n in range(1, 7)],
    }
    # The fill loop (same usable-rows source) would have run 5 iterations.
    payload = _finalize_training_plan(inv, {"weeks": [good_week(n) for n in range(1, 6)]})
    numbers = [w["weekNumber"] for w in payload["weeks"]]
    assert numbers == [1, 2, 3, 4, 5, 6]
    assert payload["weeks"][5]["drills"] == []  # week 6 is the retest week, exactly once


def test_finalizer_stamps_the_retest_week(make_invocation, db):
    inv = finalizer_invocation(make_invocation)
    payload = _finalize_training_plan(inv, fill_result())

    retest_week = payload["weeks"][5]
    assert retest_week["weekNumber"] == 6
    assert retest_week["theme"] == "Retest week"
    assert retest_week["drills"] == []                    # retest-only, no model work
    assert retest_week["allocations"] == []
    assert {t["domain"] for t in retest_week["targets"]} == {
        "linearSpeed", "verticalPower", "horizontalPower", "codAgility",
        "dribbling", "shooting",
    }
    assert all(t["exposures"] == 1 for t in retest_week["targets"])

    assert payload["retest"]["weekNumber"] == 6
    assert set(payload["retest"]["drills"]) == {
        "sprint", "jump", "broadJump", "changeOfDirection", "dribbling", "deadballShot",
    }
