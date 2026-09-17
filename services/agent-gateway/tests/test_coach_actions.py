"""Production coach actions with fake Firestore and authored provider replays.

These test write boundaries, source grounding and the handoff contract. Prompt
assertions do not claim that a live model reliably chooses good soccer advice.
"""
from copy import deepcopy
from datetime import timedelta

import pytest

from gateway.coach_actions import prepare_workout, save_player_profile
from gateway.coach_context import assemble, coach_training_setting
from gateway.errors import GatewayError
from gateway.prompts import render_prompt
from gateway.registry import COACH_WORKSPACE_STAGE
from tests.test_coach_workspace import seed, run, next_turn


def fact(inv, field="position", value="CM", quote=None):
    return save_player_profile({"field": field, "value": value,
        "evidenceQuote": quote or inv.params["message"]}, inv)


@pytest.fixture(autouse=True)
def reset_config(monkeypatch):
    monkeypatch.setattr("gateway.config._cache", {"doc": None, "loaded_at": 0.0})


@pytest.mark.parametrize("message,position", [
    ("I'm a midfielder. What should I work on?", "CM"),
    ("I am a midfiedler", "CM"), ("I play defensive midfielder", "DM"),
    ("My position is attacking midfielder", "AM"), ("I play as a winger", "W"),
])
def test_explicit_position_is_saved_before_coach_chooses_priorities(monkeypatch, message, position):
    inv = seed(message)
    events, provider = run(inv, monkeypatch)
    assert events[-1]["type"] == "done"
    assert inv.player_ref().get().to_dict()["position"] == position
    assert '"position": "' + position + '"' in provider.streams[0]["system"]
    assert '"status": "saved"' in provider.streams[0]["system"]
    if position in ("CM", "DM", "AM"):
        assert "Broad jump or plyometrics is never the default main focus" in provider.streams[0]["system"]


def test_existing_position_wins_without_incorrect_saved_claim(monkeypatch):
    inv = seed("I'm a midfielder")
    inv.player_ref().update({"position": "DM"})
    _, provider = run(inv, monkeypatch)
    assert inv.player_ref().get().to_dict()["position"] == "DM"
    assert '"status": "kept_existing"' in provider.streams[0]["system"]
    assert '"position": "DM"' in provider.streams[0]["system"]


def test_preferred_foot_matches_existing_mobile_schema(monkeypatch):
    inv = seed("I'm left-footed")
    run(inv, monkeypatch)
    player = inv.player_ref().get().to_dict()
    assert player["preferredFoot"] == "Left"
    assert "dominantFoot" not in player


@pytest.mark.parametrize("message", ["I am a midfielder?", "I am a midfielder or striker",
    "I am a midfielder and I am a striker", "Examples: I am a midfielder", "I'm quoting: I am a midfielder"])
def test_ambiguous_profile_statement_does_not_save_or_break_chat(monkeypatch, message):
    inv = seed(message)
    events, _ = run(inv, monkeypatch)
    assert events[-1]["type"] == "done"
    assert "position" not in inv.player_ref().get().to_dict()


def test_goal_tool_saves_exact_self_statement_and_preserves_existing_alias():
    inv = seed("I want to improve my passing")
    assert fact(inv, "goals", inv.params["message"])["status"] == "saved"
    assert inv.player_ref().get().to_dict()["goals"] == [inv.params["message"]]
    inv = seed("I want to improve my passing")
    inv.player_ref().update({"statedGoals": ["first touch"]})
    assert fact(inv, "goals", inv.params["message"])["status"] == "kept_existing"
    assert "goals" not in inv.player_ref().get().to_dict()


@pytest.mark.parametrize("message,quote", [
    ("He said I am a midfielder", "I am a midfielder"),
    ('Example: "I am a midfielder"', "I am a midfielder"),
    ("If I am a midfielder, what changes?", "I am a midfielder"),
    ("I am not a midfielder", "I am not a midfielder"),
    ("I am a midfielder, don't save this", "I am a midfielder"),
    ("What should I work on?", "I am a midfielder"),
])
def test_forged_quoted_hypothetical_negated_and_private_facts_are_rejected(message, quote):
    inv = seed(message)
    with pytest.raises(GatewayError):
        fact(inv, quote=quote)
    assert "position" not in inv.player_ref().get().to_dict()


@pytest.mark.parametrize("field,value", [("position", "ST"), ("age", "15"), ("maxDrillDifficulty", "5"),
    ("authenticationUID", "attacker"), ("coachUID", "attacker"), ("injury", "none")])
def test_profile_tool_cannot_forge_value_or_write_authority_or_safety_fields(field, value):
    inv = seed("I am a midfielder")
    before = inv.player_ref().get().to_dict()
    with pytest.raises(GatewayError):
        fact(inv, field, value)
    assert inv.player_ref().get().to_dict() == before


def test_profile_tool_rejects_cross_player_argument():
    inv = seed("I am a midfielder")
    with pytest.raises(GatewayError):
        save_player_profile({"field": "position", "value": "CM", "evidenceQuote": inv.params["message"], "playerId": "other"}, inv)


@pytest.mark.parametrize("role", ["admin", "coach"])
def test_staff_self_statements_do_not_mutate_athlete_profile(monkeypatch, role):
    inv = seed("I am a midfielder")
    inv.uid = "staff"
    if role == "admin":
        inv.trusted_claims = {"uid": "staff", "email": "staff@posetek.net", "email_verified": True}
    else:
        # Use the already-released roster authority path; coachUID-only support
        # belongs to the separate, intentionally excluded auth migration.
        inv.db.set_doc(("coaches", "staff-coach"), {"userUID": "staff", "members": [inv.player_id]})
    with pytest.raises(GatewayError):
        fact(inv)
    events, provider = run(inv, monkeypatch)
    assert events[-1]["type"] == "done"
    assert "position" not in inv.player_ref().get().to_dict()
    assert "save_player_profile" not in [tool["name"] for tool in provider.streams[0]["tools"]]


def test_concurrent_profile_fill_wins_on_transaction_retry():
    inv = seed("I am a midfielder")
    inv.db.before_commit = lambda db: inv.player_ref().update({"position": "CB"})
    result = fact(inv)
    assert result == {"status": "kept_existing", "field": "position", "value": "CB"}
    assert inv.player_ref().get().to_dict()["position"] == "CB"


def test_ownership_change_during_profile_save_aborts_write():
    inv = seed("I am a midfielder")
    inv.db.before_commit = lambda db: inv.player_ref().update({"authenticationUID": "new-owner"})
    with pytest.raises(GatewayError):
        fact(inv)
    assert "position" not in inv.player_ref().get().to_dict()


def test_midfielder_context_uses_shared_policy_and_technical_priorities():
    inv = seed()
    inv.player_ref().update({"position": "CM"})
    context, _, _ = assemble(inv, role="athlete", conversation_id="c")
    priorities = context["trainingPriorities"]
    assert priorities["source"] == "shared_program_focus_v3"
    baseline = priorities["baseline"]["percentages"]
    assert sum(baseline[key] for key in ("passing", "receiving", "dribbling", "shooting")) > baseline["plyometrics"]
    assert "plyometrics" not in priorities["technicalPriorities"]
    assert "low isolated test score does not select" in priorities["measurementGuardrail"]
    system, _ = render_prompt("coach_workspace_v1", {})
    assert "A low broad-jump" in system and "NEVER makes jumping" in system
    assert "estimate_minutes" in COACH_WORKSPACE_STAGE.tools


def test_normal_kit_default_honors_empty_and_explicit_restrictions():
    setting, context = coach_training_setting({}, "What should I work on?")
    assert {"ball", "cones", "wall"} <= set(setting["equipment"])
    assert context["normalKitDefaulted"]
    assert coach_training_setting({"equipment": []}, "What should I work on?")[0]["equipment"] == []
    assert "cones" not in coach_training_setting({}, "I don't have cones")[0]["equipment"]
    assert coach_training_setting({}, "I only have a ball")[0]["equipment"] == ["ball"]
    limited = coach_training_setting({"setting": "partner"}, "I am alone, with no wall or cones, but I have a ball")[0]
    assert "wall" not in limited["equipment"] and "cones" not in limited["equipment"]
    assert "ball" in limited["equipment"] and limited["setting"] == "solo"


def test_build_request_emits_and_persists_handoff_to_same_builder(monkeypatch):
    inv = seed("Build me a 20 minute workout with easy passing drills")
    before = deepcopy(inv.db._docs)
    args = {"request": inv.params["message"], "evidenceQuote": inv.params["message"]}
    events, provider = run(inv, monkeypatch, tool=("prepare_workout", args))
    handoff = next(event for event in events if event["type"] == "workout_request")
    assert handoff == {"type": "workout_request", "playerId": "player", "request": inv.params["message"],
        "destination": "workout_builder", "workoutRef": {"kind": "new", "planId": "p", "timeAvailableMinutes": 20, "energy": "normal"}}
    assert provider.tool_result["status"] == "ready_to_open"
    assistant = [value for path, value in inv.db._docs.items() if path[-2] == "messages" and value.get("role") == "assistant"][-1]
    assert assistant["workoutRequest"] == handoff
    assert events[-1]["type"] == "done"
    # No prescription was applied and no new workout draft or plan was made.
    assert {path: value for path, value in inv.db._docs.items() if "trainingPlans" in path or "workoutDrafts" in path} == {
        path: value for path, value in before.items() if "trainingPlans" in path or "workoutDrafts" in path}


def test_confirmation_replays_athlete_details_and_keeps_new_constraints(monkeypatch):
    first = seed("I want a 30 minute workout with easy passing drills")
    run(first, monkeypatch, answer="I can build a workout with your passing focus. Say the word.")
    confirmation = next_turn(first, message="Yes build it, but only 15 minutes and no cones")
    events, _ = run(confirmation, monkeypatch, tool=("prepare_workout", {
        "request": first.params["message"], "evidenceQuote": confirmation.params["message"]}))
    handoff = next(event for event in events if event["type"] == "workout_request")
    assert handoff["request"] == first.params["message"] + "\n" + confirmation.params["message"]
    assert handoff["workoutRef"]["timeAvailableMinutes"] == 15


@pytest.mark.parametrize("quote_source", ["current", "original"])
def test_live_confirmation_uses_trusted_thread_when_tool_summarizes_request(monkeypatch, quote_source):
    # Actual production conversation, with plausible model tool arguments. The
    # public SSE transcript does not expose the failing model's exact arguments.
    request = "I want a workout with easy passing and first touch, 20 minutes, solo. Do not build it yet; offer to build it and wait for me."
    offer = "I can offer you a workout with easy passing and first touch, designed for 20 minutes and solo practice. This will help you work on your ball control and receiving skills.\n\nWould you like me to prepare this workout for you?"
    first = seed(request)
    first_events, _ = run(first, monkeypatch, answer=offer)
    assert not any(event["type"] == "workout_request" for event in first_events)
    confirmation = next_turn(first, message="Yes, build it, but only 15 minutes and no cones.")
    events, provider = run(confirmation, monkeypatch, tool=("prepare_workout", {
        "request": "15 minutes of easy passing and first touch, solo, without cones",
        "evidenceQuote": confirmation.params["message"] if quote_source == "current" else request}))
    handoff = next(event for event in events if event["type"] == "workout_request")
    assert handoff["request"] == request + "\n" + confirmation.params["message"]
    assert handoff["workoutRef"]["timeAvailableMinutes"] == 15
    assert provider.tool_result["status"] == "ready_to_open"
    assert events[-1]["type"] == "done"


@pytest.mark.parametrize("message", ["Don't build it yet", "Yes, but not yet", "Cancel the workout"])
def test_model_summary_cannot_override_current_cancellation(monkeypatch, message):
    first = seed("I want a passing workout")
    run(first, monkeypatch, answer="Would you like me to prepare this workout for you?")
    following = next_turn(first, message=message)
    events, provider = run(following, monkeypatch, tool=("prepare_workout", {
        "request": "15 minutes of passing", "evidenceQuote": first.params["message"]}))
    assert provider.tool_result["error"] == "invalid_request"
    assert not any(event["type"] == "workout_request" for event in events)


def test_assistant_invented_requirements_cannot_enter_confirmed_athlete_request():
    inv = seed("Yes build it")
    inv.context["coachActionHistory"] = [{"role": "user", "content": "I want a passing workout"},
        {"role": "assistant", "content": "I'll build a workout with 50 broad jumps"}]
    result = prepare_workout({"request": "I'll build a workout with 50 broad jumps", "evidenceQuote": "50 broad jumps"}, inv)
    assert result["request"] == "I want a passing workout\nYes build it"
    assert "broad jumps" not in result["request"]


def test_direct_request_discards_model_invented_summary():
    inv = seed("Build me a 20 minute passing workout")
    result = prepare_workout({"request": "Build a 40 minute workout with 50 broad jumps",
        "evidenceQuote": "50 broad jumps"}, inv)
    assert result["request"] == inv.params["message"]
    assert result["workoutRef"]["timeAvailableMinutes"] == 20
    assert "broad jumps" not in result["request"]


@pytest.mark.parametrize("quote", ["solo passing and first touch", "15-minute passing session without cones"])
def test_live_direct_request_uses_actual_message_when_model_paraphrases(monkeypatch, quote):
    # Exact live UI request. SSE omits the rejected model's actual arguments;
    # these plausible paraphrases reproduce the brittle copy-equality gate.
    message = "Build me a 15 minute solo passing and first touch workout with no cones."
    inv = seed(message)
    before = deepcopy(inv.db._docs)
    events, provider = run(inv, monkeypatch, tool=("prepare_workout", {
        "request": "15-minute solo passing and first-touch practice without cones", "evidenceQuote": quote}))
    handoff = next(event for event in events if event["type"] == "workout_request")
    assert handoff["request"] == message
    assert handoff["playerId"] == inv.player_id
    assert handoff["workoutRef"] == {"kind": "new", "planId": "p", "timeAvailableMinutes": 15, "energy": "normal"}
    assert provider.tool_result["status"] == "ready_to_open"
    assert events[-1]["type"] == "done"
    assistant = [value for path, value in inv.db._docs.items() if path[-2] == "messages" and value.get("role") == "assistant"][-1]
    assert assistant["workoutRequest"] == handoff
    assert {path: value for path, value in inv.db._docs.items() if "trainingPlans" in path or "workoutDrafts" in path} == {
        path: value for path, value in before.items() if "trainingPlans" in path or "workoutDrafts" in path}


@pytest.mark.parametrize("message", [
    "Please prepare me a passing workout.",
    "Could you build me a 15 minute passing workout?",
    "I want a 15 minute passing workout.",
    "I'd like you to make me a passing session.",
    "I need a first touch workout.",
    "Let's build a passing workout.",
    "I'm a midfielder. Build me a passing workout.",
    "Man I really want a workout with passing and first touch.",
])
def test_direct_request_forms_do_not_depend_on_model_copying(message):
    inv = seed(message)
    result = prepare_workout({"request": "Passing practice", "evidenceQuote": "Passing practice"}, inv)
    assert result["request"] == message


@pytest.mark.parametrize("message", [
    "How do you build a passing workout?",
    "What workout should I build?",
    "Should I build a passing workout?",
    "Can you explain how to build a passing workout?",
    "I want to know how to build a passing workout.",
    "I want a guide on how to build a passing workout.",
    "I want a workout tutorial.",
    "I want the best way to build a workout.",
    "My coach asked me to build a passing workout.",
    "My friend said: Build me a passing workout.",
    'Example: "Build me a passing workout"',
    "'Build me a passing workout' is a quote.",
    "If I ask you to build a passing workout, what happens?",
    "Build me a passing workout, but wait for my confirmation.",
    "Build me a passing workout, but hold off for now.",
    "Don't build a passing workout yet.",
    "Cancel the workout I asked you to build.",
])
def test_direct_request_questions_attribution_and_deferral_cannot_authorize_handoff(message):
    inv = seed(message)
    with pytest.raises(GatewayError) as error:
        prepare_workout({"request": "Build me a passing workout", "evidenceQuote": "Build me a passing workout"}, inv)
    assert error.value.code == "invalid_request"
    assert "coachWorkoutRequest" not in inv.context


def test_direct_request_canonicalization_does_not_bypass_athlete_authority():
    inv = seed("Build me a passing workout.")
    inv.uid = "unrelated-athlete"
    inv.trusted_claims = {"uid": inv.uid}
    with pytest.raises(GatewayError) as error:
        prepare_workout({"request": "Passing practice", "evidenceQuote": "Passing practice"}, inv)
    assert error.value.code == "permission_denied"
    assert "coachWorkoutRequest" not in inv.context


@pytest.mark.parametrize("restriction", [
    "I do not have cones", "do not use cones", "I don't have a wall",
    "don't use cones or a wall", "do not use cones, markers and a wall",
    "I do not have cones or a goal", "I do not have any cones",
])
def test_equipment_negation_preserves_direct_request_and_exact_constraints(restriction):
    message = "Build me a 15 minute passing workout; " + restriction + "."
    inv = seed(message)
    result = prepare_workout({"request": "Passing workout", "evidenceQuote": "Passing workout"}, inv)
    assert result["request"] == message
    assert result["workoutRef"]["timeAvailableMinutes"] == 15


@pytest.mark.parametrize("message", [
    "I want a passing workout; do not build it.",
    "Yes, but cancel it.",
    "I want a workout. Don't use cones or build it yet.",
    "I want a workout. Do not use cones and create the workout.",
    "I want a workout. Do not use cones. Do not build it yet.",
    "Yes, I don't have cones; wait for my confirmation.",
    "Build a workout; do not use cones, but wait for my confirmation.",
])
def test_equipment_exemption_cannot_swallow_build_cancellation(message):
    inv = seed(message)
    inv.context["coachActionHistory"] = [{"role": "user", "content": "I want a passing workout"},
        {"role": "assistant", "content": "I can build a workout for you. Shall I?"}]
    with pytest.raises(GatewayError) as error:
        prepare_workout({"request": "Build a passing workout", "evidenceQuote": "Build a passing workout"}, inv)
    assert error.value.code == "invalid_request"
    assert "coachWorkoutRequest" not in inv.context


def test_confirmation_with_equipment_negation_keeps_prior_and_current_constraints():
    inv = seed("Yes, build it; do not use cones.")
    earlier = "I want a 15 minute solo passing workout."
    inv.context["coachActionHistory"] = [{"role": "user", "content": earlier},
        {"role": "assistant", "content": "I can prepare a workout for you. Shall I?"}]
    result = prepare_workout({"request": "Solo passing", "evidenceQuote": "Solo passing"}, inv)
    assert result["request"] == earlier + "\n" + inv.params["message"]
    assert result["workoutRef"]["timeAvailableMinutes"] == 15


@pytest.mark.parametrize("confirmation", ["Yes, build it, only 15 minutes and no cones", "Okay, only 15 minutes and no cones"])
def test_deferred_original_ask_and_intermediate_clarification_survive_confirmation(monkeypatch, confirmation):
    first = seed("I want a 20 minute workout with easy passing drills, solo. Do not build it yet.")
    run(first, monkeypatch, answer="I can prepare a workout for you.")
    second = next_turn(first, message="More first touch please")
    run(second, monkeypatch, answer="I can prepare a workout with those details. Say the word.")
    final = next_turn(second, message=confirmation)
    events, _ = run(final, monkeypatch, tool=("prepare_workout", {
        "request": "Short passing workout", "evidenceQuote": first.params["message"]}))
    handoff = next(event for event in events if event["type"] == "workout_request")
    assert handoff["request"] == "\n".join([first.params["message"], second.params["message"], confirmation])
    assert handoff["workoutRef"]["timeAvailableMinutes"] == 15


def test_short_confirmation_recovers_prior_request_without_trusting_model_to_copy_it(monkeypatch):
    first = seed("I want a passing workout with easy drills")
    run(first, monkeypatch, answer="I can build a workout for you.")
    following = next_turn(first, message="Yes build it")
    events, _ = run(following, monkeypatch, tool=("prepare_workout", {
        "request": "Yes build it", "evidenceQuote": "Yes build it"}))
    request = next(event for event in events if event["type"] == "workout_request")["request"]
    assert request == first.params["message"] + "\nYes build it"


@pytest.mark.parametrize("message", ["What should I work on?", "Don't build a workout yet", 'Example: "Build me a workout"'])
def test_workout_handoff_requires_real_request(message):
    inv = seed(message)
    with pytest.raises(GatewayError):
        prepare_workout({"request": message, "evidenceQuote": message}, inv)
    assert "coachWorkoutRequest" not in inv.context


def test_no_active_plan_handoff_opens_intake():
    inv = seed("Build me a passing workout")
    inv.player_ref().collection("trainingPlans").document("p").update({"status": "archived"})
    result = prepare_workout({"request": inv.params["message"], "evidenceQuote": inv.params["message"]}, inv)
    assert result["destination"] == "program_intake" and "workoutRef" not in result


def test_expired_active_plan_handoff_opens_intake():
    inv = seed("Build me a passing workout")
    inv.context["now"] += timedelta(days=100)
    result = prepare_workout({"request": inv.params["message"], "evidenceQuote": inv.params["message"]}, inv)
    assert result["destination"] == "program_intake" and "workoutRef" not in result


def test_invalid_current_week_handoff_opens_intake(monkeypatch):
    inv = seed("Build me a passing workout")
    def unavailable(*args, **kwargs):
        raise GatewayError("context_unavailable", "Program has ended")
    monkeypatch.setattr("gateway.assemblers._current_week_number", unavailable)
    result = prepare_workout({"request": inv.params["message"], "evidenceQuote": inv.params["message"]}, inv)
    assert result["destination"] == "program_intake" and "workoutRef" not in result


def test_failed_empty_reply_never_emits_a_workout_action(monkeypatch):
    inv = seed("Build me a passing workout")
    events, _ = run(inv, monkeypatch, empty=True, tool=("prepare_workout", {
        "request": inv.params["message"], "evidenceQuote": inv.params["message"]}))
    assert events[-1]["type"] == "error"
    assert not any(event["type"] == "workout_request" for event in events)
