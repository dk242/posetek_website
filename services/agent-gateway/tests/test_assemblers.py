"""Assembler tests against fixture data in the fake Firestore (tests/conftest.py). No network, no
model calls — assemblers are pure Firestore reads plus deterministic math.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from gateway.assemblers import (
    ASSEMBLERS,
    age_band_for_age,
    assemble_athlete_stats,
    assemble_benchmark_context,
    assemble_benchmark_context_optional,
    assemble_conversation_history,
    assemble_player_profile,
    assemble_recent_reps,
    assemble_session_detail,
    resolve_gender,
    resolve_player_age,
)
from gateway.errors import GatewayError
from tests.conftest import add_benchmark, add_drill, add_message, add_player, add_rep, add_session


def _dt(days_ago: int) -> datetime:
    return datetime(2026, 1, 1, tzinfo=timezone.utc) - timedelta(days=days_ago)


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


def test_assemblers_registry_has_the_required_keys():
    assert set(ASSEMBLERS.keys()) == {
        "playerProfile",
        "athleteStats",
        "recentReps",
        "benchmarkContext",
        "benchmarkContextOptional",
        "conversationHistory",
        "sessionDetail",
        "kickAnalysisContext",
        "kickComparisonContext",
        "kickKnowledge",
        "kickPreviousCues",
        "kickChatKnowledge",
        "kickRepAnalysis",
        "planIntake",
        "trainingHistory",
        "planKnowledge",
        "planCandidateDrills",
        "activePlanWeek",
        "weekProgress",
        "workoutCandidates",
    }


# ---------------------------------------------------------------------------
# playerProfile
# ---------------------------------------------------------------------------


def test_player_profile_from_explicit_age_and_gender(db, make_invocation):
    add_player(db, "player1", {"age": 15, "gender": "Female", "position": "Midfielder", "height": 165.0, "weight": 55.0})
    inv = make_invocation(player_id="player1")

    profile = assemble_player_profile(inv)

    assert profile["ageBand"] == "u16"
    assert profile["gender"] == "female"
    assert profile["position"] == "Midfielder"
    assert profile["heightCm"] == 165.0
    assert profile["weightKg"] == 55.0


def test_player_profile_never_includes_pii():
    # Static check on the field surface, not a specific instance — guards against a future edit
    # accidentally adding an email/phone passthrough. String literals a function references (like
    # dict-key lookups) live in its bytecode constants.
    from gateway import assemblers

    consts = assemblers.assemble_player_profile.__code__.co_consts
    banned = {"email", "signupEmail", "phone", "phoneNumber"}
    assert not (banned & set(consts))


def test_player_profile_age_band_boundaries():
    assert age_band_for_age(12) == "u12"
    assert age_band_for_age(13) == "u14"
    assert age_band_for_age(14) == "u14"
    assert age_band_for_age(15) == "u16"
    assert age_band_for_age(16) == "u16"
    assert age_band_for_age(17) == "u18"
    assert age_band_for_age(18) == "u18"
    assert age_band_for_age(19) == "senior"
    assert age_band_for_age(None) == "senior"


def test_resolve_player_age_from_birth_date():
    now = datetime(2026, 8, 1, tzinfo=timezone.utc)
    # Birthday already passed this year.
    born = datetime(2010, 1, 15, tzinfo=timezone.utc)
    assert resolve_player_age({"birthDate": born}, now=now) == 16
    # Birthday hasn't happened yet this year.
    born_later = datetime(2010, 12, 15, tzinfo=timezone.utc)
    assert resolve_player_age({"dateOfBirth": born_later}, now=now) == 15


def test_resolve_gender_leading_letter():
    assert resolve_gender({"gender": "male"}) == "male"
    assert resolve_gender({"gender": "F"}) == "female"
    assert resolve_gender({"gender": "nonbinary"}) == "unspecified"
    assert resolve_gender({}) == "unspecified"


def test_player_profile_missing_doc_raises_context_unavailable(db, make_invocation):
    inv = make_invocation(player_id="ghost")
    with pytest.raises(GatewayError) as exc_info:
        assemble_player_profile(inv)
    assert exc_info.value.code == "context_unavailable"


# ---------------------------------------------------------------------------
# recentReps
# ---------------------------------------------------------------------------


def test_recent_reps_groups_by_drill_and_computes_trend(db, make_invocation):
    add_player(db, "player1", {})
    for i, speed in enumerate([7.0, 7.2, 7.5, 8.0, 8.5]):
        add_rep(
            db, "player1", f"rep{i}",
            {"repType": "sprint", "max_velocity": speed, "createdAt": _dt(days_ago=10 - i)},
        )

    inv = make_invocation(player_id="player1")
    result = assemble_recent_reps(inv)

    assert "sprint" in result
    assert result["sprint"]["repCount"] == 5
    assert result["sprint"]["metrics"]["maxVelocityMS"]["trend"] == "increasing"
    assert result["sprint"]["metrics"]["maxVelocityMS"]["recentValues"] == [7.0, 7.2, 7.5, 8.0, 8.5]


def test_recent_reps_caps_at_40_per_drill(db, make_invocation):
    add_player(db, "player1", {})
    for i in range(45):
        add_rep(db, "player1", f"rep{i}", {"repType": "jump", "jumpHeight": 0.5, "createdAt": _dt(days_ago=45 - i)})

    inv = make_invocation(player_id="player1")
    result = assemble_recent_reps(inv)

    assert result["jump"]["repCount"] == 40


def test_recent_reps_raises_when_athlete_has_no_reps(db, make_invocation):
    add_player(db, "player1", {})
    inv = make_invocation(player_id="player1")
    with pytest.raises(GatewayError) as exc_info:
        assemble_recent_reps(inv)
    assert exc_info.value.code == "context_unavailable"


def test_recent_reps_best_is_direction_aware(db, make_invocation):
    add_player(db, "player1", {})
    # higherIsBetter: sprint max speed -> best is the max.
    for i, speed in enumerate([7.0, 8.5, 8.0]):
        add_rep(db, "player1", f"s{i}", {"repType": "sprint", "max_velocity": speed, "createdAt": _dt(days_ago=9 - i)})
    # lowerIsBetter: COD total time -> best is the min.
    for i, t in enumerate([5.2, 4.4, 4.9]):
        add_rep(
            db, "player1", f"c{i}",
            {"repType": "changeOfDirection", "totalTime": t, "createdAt": _dt(days_ago=6 - i)},
        )

    inv = make_invocation(player_id="player1")
    result = assemble_recent_reps(inv)

    assert result["sprint"]["metrics"]["maxVelocityMS"]["best"] == 8.5
    assert result["changeOfDirection"]["metrics"]["totalTimeSeconds"]["best"] == 4.4


def test_recent_reps_best_survives_the_40_rep_cap(db, make_invocation):
    add_player(db, "player1", {})
    # The PR is the oldest rep, outside the 40-most-recent window.
    add_rep(db, "player1", "pr", {"repType": "jump", "jumpHeight": 0.9, "createdAt": _dt(days_ago=100)})
    for i in range(41):
        add_rep(db, "player1", f"rep{i}", {"repType": "jump", "jumpHeight": 0.5, "createdAt": _dt(days_ago=41 - i)})

    inv = make_invocation(player_id="player1")
    result = assemble_recent_reps(inv)

    assert result["jump"]["repCount"] == 40
    assert result["jump"]["metrics"]["jumpHeightMeters"]["best"] == 0.9


def test_recent_reps_no_best_for_unbenchmarked_fields(db, make_invocation):
    add_player(db, "player1", {})
    add_rep(
        db, "player1", "c1",
        {"repType": "changeOfDirection", "totalTime": 4.4, "phase1Time": 1.5, "createdAt": _dt(days_ago=1)},
    )

    inv = make_invocation(player_id="player1")
    result = assemble_recent_reps(inv)

    # phase1Seconds is read by no benchmark metric, so no direction is known.
    assert "best" not in result["changeOfDirection"]["metrics"]["phase1Seconds"]
    assert "best" in result["changeOfDirection"]["metrics"]["totalTimeSeconds"]


# ---------------------------------------------------------------------------
# athleteStats
# ---------------------------------------------------------------------------


def _valid_stats_profile() -> dict:
    return {
        "schemaVersion": 1,
        "overallScore": 87.4,
        "benchmarkProfile": {"ageBand": "u16", "gender": "male", "isDefaulted": False},
        "totalReps": 42,
        "totalSessions": 9,
        "axes": [{"axis": "power", "score": 91.2, "repCount": 12, "missingDrills": []}],
        "drills": [{
            "drill": "sprint", "score": 84.1, "repCount": 8, "sessionCount": 3,
            "lastRecorded": "2026-07-30T18:22:04Z",
            "metrics": [{
                "metric": "sprintMaxSpeed", "score": 88.0, "band": "approaching",
                "bestCanonical": 7.8, "latestCanonical": 7.5, "referenceCanonical": 8.9,
                "bestFormatted": "17.4 mph", "referenceFormatted": "19.9 mph",
                "unitLabel": "mph", "repCount": 8, "scoreDelta": 2.4,
            }],
        }],
    }


def test_athlete_stats_accepts_a_valid_profile(make_invocation):
    profile = _valid_stats_profile()
    inv = make_invocation(params={"statsProfile": profile})
    assert assemble_athlete_stats(inv) == profile


def test_athlete_stats_rejects_out_of_range_score(make_invocation):
    profile = _valid_stats_profile()
    profile["overallScore"] = 500.0  # > 400
    inv = make_invocation(params={"statsProfile": profile})
    with pytest.raises(GatewayError) as exc_info:
        assemble_athlete_stats(inv)
    assert exc_info.value.code == "invalid_request"


def test_athlete_stats_rejects_negative_score(make_invocation):
    profile = _valid_stats_profile()
    profile["drills"][0]["metrics"][0]["score"] = -5.0
    inv = make_invocation(params={"statsProfile": profile})
    with pytest.raises(GatewayError) as exc_info:
        assemble_athlete_stats(inv)
    assert exc_info.value.code == "invalid_request"


def test_athlete_stats_rejects_missing_required_key(make_invocation):
    profile = _valid_stats_profile()
    del profile["totalReps"]
    inv = make_invocation(params={"statsProfile": profile})
    with pytest.raises(GatewayError) as exc_info:
        assemble_athlete_stats(inv)
    assert exc_info.value.code == "invalid_request"
    assert "totalReps" in exc_info.value.message


def test_athlete_stats_raises_context_unavailable_when_absent(make_invocation):
    inv = make_invocation(params={})
    with pytest.raises(GatewayError) as exc_info:
        assemble_athlete_stats(inv)
    assert exc_info.value.code == "context_unavailable"


# ---------------------------------------------------------------------------
# benchmarkContext
# ---------------------------------------------------------------------------


def test_benchmark_context_provisional_hand_computed_score(db, make_invocation):
    # senior male, at exactly the anchor -> reference == anchor, score == 100 -> elite, provisional.
    add_player(db, "player1", {"age": 25, "gender": "male"})
    add_rep(db, "player1", "rep1", {"repType": "sprint", "max_velocity": 8.9, "createdAt": _dt(1)})

    inv = make_invocation(player_id="player1")
    context = assemble_benchmark_context(inv)

    assert context["ageBand"] == "senior"
    assert context["gender"] == "male"
    assert context["source"] == "provisional"
    metric = context["metrics"]["sprintMaxSpeed"]
    assert metric["score"] == pytest.approx(100.0)
    assert metric["band"] == "elite"
    assert metric["source"] == "provisional"
    assert metric["referenceCanonical"] == pytest.approx(8.9)


def test_benchmark_context_prefers_measured_reference_when_published(db, make_invocation):
    add_player(db, "player1", {"age": 25, "gender": "male"})
    add_rep(db, "player1", "rep1", {"repType": "sprint", "max_velocity": 8.9, "createdAt": _dt(1)})
    add_benchmark(db, "b1", {"metric": "sprintMaxSpeed", "ageBand": "senior", "gender": "male", "referenceValue": 10.0})

    inv = make_invocation(player_id="player1")
    context = assemble_benchmark_context(inv)

    metric = context["metrics"]["sprintMaxSpeed"]
    assert metric["source"] == "measured"
    assert context["source"] == "measured"
    assert metric["referenceCanonical"] == pytest.approx(10.0)
    assert metric["score"] == pytest.approx(89.0)
    assert metric["band"] == "approaching"


def test_benchmark_context_age_gender_scaling_u12_female():
    # u12 developmentScale 0.72, female referenceScale 0.88 -> scale 0.6336.
    from gateway.assemblers import BENCHMARK_METRICS, score_and_reference

    metric_def = BENCHMARK_METRICS["sprintMaxSpeed"]
    score, reference = score_and_reference(metric_def, value=5.0, age_band="u12", gender="female")
    expected_reference = 8.9 * 0.72 * 0.88
    assert reference == pytest.approx(expected_reference)
    assert score == pytest.approx(100 * 5.0 / expected_reference)


def test_benchmark_context_raises_when_no_reps(db, make_invocation):
    add_player(db, "player1", {"age": 25, "gender": "male"})
    inv = make_invocation(player_id="player1")
    with pytest.raises(GatewayError) as exc_info:
        assemble_benchmark_context(inv)
    assert exc_info.value.code == "context_unavailable"


def test_benchmark_context_optional_soft_fails_when_nothing_benchmarkable(db, make_invocation):
    add_player(db, "player1", {})
    inv = make_invocation(player_id="player1")

    result = assemble_benchmark_context_optional(inv)

    assert result["available"] is False
    assert "reason" in result


def test_benchmark_context_optional_passes_through_when_data_exists(db, make_invocation):
    add_player(db, "player1", {"age": 20, "gender": "male"})
    add_rep(db, "player1", "r1", {"repType": "sprint", "max_velocity": 8.0, "createdAt": _dt(days_ago=1)})
    inv = make_invocation(player_id="player1")

    result = assemble_benchmark_context_optional(inv)

    assert result["available"] is True
    assert "sprintMaxSpeed" in result["metrics"]


# ---------------------------------------------------------------------------
# conversationHistory
# ---------------------------------------------------------------------------


def test_conversation_history_orders_by_created_at_and_caps_length(db, make_invocation):
    add_player(db, "player1", {})
    for i in range(25):
        add_message(db, "player1", "conv1", f"m{i}", {"role": "user", "content": f"msg {i}", "createdAt": i})

    inv = make_invocation(player_id="player1", conversation_id="conv1")
    result = assemble_conversation_history(inv)

    assert result["conversationId"] == "conv1"
    assert len(result["messages"]) == 20
    assert result["messages"][0]["content"] == "msg 5"
    assert result["messages"][-1]["content"] == "msg 24"


def test_conversation_history_empty_when_no_conversation_id(make_invocation):
    inv = make_invocation(conversation_id=None)
    result = assemble_conversation_history(inv)
    assert result["messages"] == []


# ---------------------------------------------------------------------------
# sessionDetail
# ---------------------------------------------------------------------------


def test_session_detail_matches_reps_by_session_number_and_rep_type(db, make_invocation):
    add_player(db, "player1", {})
    add_session(db, "player1", "session3", {"sessionType": "sprint", "sessionNumber": 3, "repCount": 2, "timestamp": 100})
    add_rep(db, "player1", "r1", {"repType": "sprint", "sessionNumber": 3, "repNumber": 1, "max_velocity": 7.0, "createdAt": _dt(2)})
    add_rep(db, "player1", "r2", {"repType": "sprint", "sessionNumber": 3, "repNumber": 2, "max_velocity": 7.4, "createdAt": _dt(1)})
    # Decoys that must be excluded.
    add_rep(db, "player1", "r3", {"repType": "sprint", "sessionNumber": 4, "repNumber": 1, "max_velocity": 9.0, "createdAt": _dt(1)})
    add_rep(db, "player1", "r4", {"repType": "jump", "sessionNumber": 3, "repNumber": 1, "jumpHeight": 0.5, "createdAt": _dt(1)})

    inv = make_invocation(player_id="player1", params={"sessionId": "session3"})
    detail = assemble_session_detail(inv)

    assert detail["sessionType"] == "sprint"
    assert len(detail["reps"]) == 2
    assert {r["repId"] for r in detail["reps"]} == {"r1", "r2"}


def test_session_detail_missing_session_raises_context_unavailable(db, make_invocation):
    add_player(db, "player1", {})
    inv = make_invocation(player_id="player1", params={"sessionId": "nope"})
    with pytest.raises(GatewayError) as exc_info:
        assemble_session_detail(inv)
    assert exc_info.value.code == "context_unavailable"


def test_session_detail_requires_session_id_param(make_invocation):
    inv = make_invocation(params={})
    with pytest.raises(GatewayError) as exc_info:
        assemble_session_detail(inv)
    assert exc_info.value.code == "invalid_request"
