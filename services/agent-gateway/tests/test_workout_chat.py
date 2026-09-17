"""Auth/transport integration with real shared tools and fake provider/Firestore.

Tool scripts are authored fixtures, not evidence about live model understanding.
The provider boundary is fake; assembly, eligibility, time, drafts, Apply and
usage callbacks are the production paths.
"""
from copy import deepcopy
from dataclasses import replace

import pytest

from gateway.ctx import Invocation
from gateway.errors import GatewayError
from gateway.pipeline import run_job_capability, run_stream_capability
from gateway.prompts import PROMPTS, render_prompt
from gateway.providers.base import ProviderCall, empty_usage
from gateway.registry import REGISTRY, get_capability
from gateway.tools import TOOL_SPECS
from gateway.workout_persistence import persist_program, load_original_workout
from tests.conftest import FakeFirestore, FakeStorage
from tests.test_workout_persistence_v3 import NOW, drill, plan


@pytest.fixture(autouse=True)
def reset_config_cache(monkeypatch):
    monkeypatch.setattr("gateway.config._cache", {"doc": None, "loaded_at": 0.0})


def seed(*, target=None, message="Prepare a draft for this workout."):
    db = FakeFirestore()
    db.set_doc(("players", "player"), {"authenticationUID": "athlete", "age": 15, "maxDrillDifficulty": 2})
    for did, domain, difficulty in (("DRB-501", "dribbling", 1), ("DRB-502", "dribbling", 1),
                                    ("DRB-503", "dribbling", 5), ("SPD-501", "speed", 1), ("AGI-501", "agility", 1)):
        value = drill(did, difficulty=difficulty)
        value.update(domain=domain)
        value["dose"]["setsMax"] = 6
        db.set_doc(("drillCatalog", did), value)
    p = plan()
    p.update(minutesPerSession=30, weeklyBudgetMinutes=60)
    p["intake"]["minutesPerSession"] = 30
    for week in p["weeks"]:
        week["allocations"][0]["minutes"] = 60
        for workout in week["workouts"]:
            workout.update(budgetMinutes=30, estimatedMinutes=30)
            workout["blocks"][0].update(sets=6, estimatedMinutes=30)
    inv = Invocation(capability="generate_training_plan", player_id="player", uid="athlete",
                     db=db, storage=FakeStorage(), context={"now": NOW})
    persist_program(inv, p, {"rawCoachNote": "SECRET_PRIVATE_NOTE", "otherPlayerId": "SECRET_OTHER_PLAYER"})
    db.set_doc(("config", "llm"), {"globalEnabled": True, "programV3Enabled": False,
        "capabilities": {"workout_chat": {"enabled": True, "dailyLimitPerUser": 30},
                         "apply_workout_draft": {"enabled": True, "dailyLimitPerUser": 30}}})
    inv.capability = "workout_chat"
    inv.params = {"message": message, "context": {"workoutRef": target or {"kind": "plan", "planId": "p", "workoutId": "w1s1"}}}
    inv.context = {"now": NOW}
    return inv


def scheduled(inv):
    return {"kind": "plan", "planId": "p", "workoutId": "w1s1", "baseRevision": 1}


def create(inv):
    return ("draft_create", {"target": deepcopy(inv.context["workoutContext"]["target"]), "from": "workout"})


def estimate(inv):
    fields = {"sets", "reps", "repUnit", "perSide", "restSeconds", "restScope", "restBetweenSetsSeconds", "familiarizationReps"}
    return ("estimate_minutes", {"blocks": [{k: v for k, v in b.items() if k in fields}
        for b in inv.context["workoutDraft"]["workout"]["blocks"]]})


class ScriptedProvider:
    def __init__(self, inv, actions=(), *, fail=False, answer="Ready to review your proposed workout."):
        self.inv, self.actions, self.fail, self.answer = inv, actions, fail, answer
        self.calls, self.results = [], []

    def stream(self, **kwargs):
        self.calls.append(kwargs)
        total = empty_usage()
        with ProviderCall(kwargs["params"], "vertex_gemini", kwargs["model"], total) as call:
            call.usage.update(inputTokens=100, outputTokens=20, cachedInputTokens=10)
            for action in self.actions:
                name, args = action(self.inv) if callable(action) else action
                yield {"type": "tool", "name": name, "status": "started"}
                self.results.append((name, kwargs["tool_runner"](name, args)))
                yield {"type": "tool", "name": name, "status": "completed"}
        with ProviderCall(kwargs["params"], "vertex_gemini", kwargs["model"], total) as call:
            call.usage.update(inputTokens=150, outputTokens=10)
            yield {"type": "delta", "text": self.answer}
            if self.fail:
                raise GatewayError("provider_error", "Fixture provider interrupted")
        yield {"type": "usage", "usage": total}


def run(inv, monkeypatch, actions=(), **kwargs):
    provider = ScriptedProvider(inv, actions, **kwargs)
    monkeypatch.setattr("gateway.providers.base.get_provider", lambda _: provider)
    return list(run_stream_capability(inv)), provider


def doc(inv, name, doc_id):
    return inv.player_ref().collection(name).document(doc_id).get().to_dict()


def test_registry_prompt_and_limits():
    spec = get_capability("workout_chat")
    assert spec.transport == "stream" and spec.strict_validation
    assert spec.model == "gemini-2.5-flash" and spec.params["thinking_budget"] == 0
    assert spec.params["max_tool_calls"] == 30 and spec.params["max_tool_seconds"] == 120
    assert spec.params["max_output_tokens"] == 4096
    assert set(spec.tools) <= set(TOOL_SPECS)
    assert PROMPTS[spec.prompt]["tools"] == spec.tools
    system, user = render_prompt(spec.prompt, {"target": {"kind": "new"}})
    for phrase in ("2 to 4 short sentences", "15-year-old", "planCore", "excludeDone:true", "28 days", "Pain", "Apply"):
        assert phrase in system
    assert "target" in user


def test_dribbling_unseen_proposal_persist_then_apply(monkeypatch):
    inv = seed(message="I want dribbling drills I haven't done yet.")
    inv.player_ref().collection("workoutLogs").document("prior").set({
        "schemaVersion": 2, "planId": "p", "weekNumber": 1, "workoutId": "prior", "status": "completed",
        "startedAt": NOW, "completedAt": NOW, "blocks": [{"drillId": "DRB-501", "domain": "dribbling", "status": "done", "estimatedMinutes": 5}]})
    original = deepcopy(doc(inv, "trainingPlans", "p"))
    events, provider = run(inv, monkeypatch, [
        ("get_drill_history", {"windowDays": 28}),
        ("search_drills", {"domains": ["dribbling"], "excludeDone": True, "windowDays": 28}),
        create, ("draft_remove_block", {"blockId": "b1"}),
        ("draft_add_block", {"drillId": "DRB-502", "sets": 6, "reps": 300, "restSeconds": 0}),
        ("draft_set_intent", {"title": "Fresh close control", "intent": "Practice dribbling with a fresh drill."}),
        estimate, ("validate_workout", {})])
    assert events[-1]["type"] == "done", events
    draft = next(e for e in events if e["type"] == "draft")
    assert draft["target"] == scheduled(inv)
    assert draft["workout"]["blocks"][0]["drillId"] == "DRB-502" and draft["check"]["ok"]
    results = dict(provider.results)
    assert [r["drillId"] for r in results["search_drills"]["results"]] == ["DRB-502"]
    assert doc(inv, "trainingPlans", "p") == original
    persisted = doc(inv, "workoutDrafts", draft["draftId"])
    assert persisted["status"] == "proposed" and persisted["sourceMessageId"]
    assistant_id = events[-1]["messageId"]
    assistant = inv.player_ref().collection("aiConversations").document(inv.conversation_id).collection("messages").document(assistant_id).get().to_dict()
    assert assistant["draftId"] == draft["draftId"]
    assert events.index(draft) < next(i for i, e in enumerate(events) if e["type"] == "done")
    assert "SECRET_" not in provider.calls[0]["system"] and "originalWorkouts" not in provider.calls[0]["system"]
    assert "weekProgress" in provider.calls[0]["system"]
    usage = [s.to_dict() for s in inv.db.collection("llmUsage").stream()]
    assert len(usage) == 2 and {r["callIndex"] for r in usage} == {1, 2}
    assert {r["stage"] for r in usage} == {"workout_chat"}
    assert sum(r["inputTokens"] for r in usage) == 250 and len({r["invocationId"] for r in usage}) == 1
    assert all("estimatedCostUsd" in r and "thinkingTokensAvailable" in r for r in usage)
    inv.capability = "apply_workout_draft"; inv.params = {"draftId": draft["draftId"]}
    result, _ = run_job_capability(inv)
    current = doc(inv, "trainingPlans", "p")
    edited = current["weeks"][0]["workouts"][0]
    assert edited["revision"] == 2 and edited["editedBy"] == "athlete"
    assert edited["blocks"][0]["drillId"] == "DRB-502"
    assert current["weeks"][0]["workouts"][1] == original["weeks"][0]["workouts"][1]
    assert load_original_workout(inv, current, "w1s1")["blocks"][0]["drillId"] == "DRB-501"
    assert result["target"]["revision"] == 2


def test_twenty_minute_cut_uses_real_time_tools(monkeypatch):
    inv = seed(message="Only 20 minutes today.")
    events, provider = run(inv, monkeypatch, [create,
        ("draft_set_intent", {"budgetMinutes": 20}),
        ("draft_set_dose", {"blockId": "b1", "sets": 4}), estimate, ("validate_workout", {})])
    draft = next(e for e in events if e["type"] == "draft")
    assert draft["workout"]["budgetMinutes"] == draft["workout"]["estimatedMinutes"] == 20
    assert dict(provider.results)["validate_workout"]["ok"]


def test_first_add_after_search_initializes_draft_without_another_confirmation(monkeypatch):
    # Reproduce the live provider's search -> add sequence, omitting the
    # model-dependent setup call that previously returned "Create a draft".
    inv = seed(message="I want more passing with easy drills. Give me a validated draft to review.")
    passing = drill("PAS-502", difficulty=1)
    passing.update(domain="passing")
    inv.db.set_doc(("drillCatalog", "PAS-502"), passing)
    before = deepcopy(doc(inv, "trainingPlans", "p"))
    events, provider = run(inv, monkeypatch, [
        ("search_drills", {"domains": ["passing"], "difficultyPreference": "easier"}),
        ("draft_add_block", {"drillId": "PAS-502", "sets": 1, "reps": 60, "restSeconds": 0})])
    assert "error" not in dict(provider.results)["draft_add_block"]
    proposal = next(event for event in events if event["type"] == "draft")
    assert proposal["target"] == scheduled(inv)
    assert [block["drillId"] for block in proposal["workout"]["blocks"]] == ["DRB-501", "PAS-502"]
    assert proposal["check"]["ok"] and proposal["workout"]["estimatedMinutes"] == 32
    assert doc(inv, "trainingPlans", "p") == before
    assert doc(inv, "workoutDrafts", proposal["draftId"])["status"] == "proposed"
    assert events[-1]["type"] == "done"


def test_failed_first_edit_does_not_persist_an_untouched_initialized_draft(monkeypatch):
    inv = seed()
    before = deepcopy(doc(inv, "trainingPlans", "p"))
    events, provider = run(inv, monkeypatch, [("draft_add_block", {"drillId": "DRB-501"})])
    result = dict(provider.results)["draft_add_block"]
    assert result["error"] == "invalid_request" and "cannot repeat a drill" in result["message"]
    assert events[-1]["type"] == "done" and not any(event["type"] == "draft" for event in events)
    assert not list(inv.player_ref().collection("workoutDrafts").stream())
    assert doc(inv, "trainingPlans", "p") == before


def test_draft_inspection_without_edit_does_not_create_a_proposal(monkeypatch):
    inv = seed(message="What is in my current workout?")
    events, provider = run(inv, monkeypatch, [("draft_get", {}), ("validate_workout", {})])
    assert dict(provider.results)["draft_get"]["workout"]["workoutId"] == "w1s1"
    assert dict(provider.results)["validate_workout"]["ok"]
    assert not any(event["type"] == "draft" for event in events)
    assert not list(inv.player_ref().collection("workoutDrafts").stream())


def test_new_workout_first_edit_seeds_bound_plan_core_without_applying_it(monkeypatch):
    inv = seed(target={"kind": "new", "planId": "p", "timeAvailableMinutes": 30, "energy": "normal"},
               message="Create a workout for today called Close control practice.")
    before = deepcopy(doc(inv, "trainingPlans", "p"))
    events, provider = run(inv, monkeypatch, [("draft_set_intent", {"title": "Close control practice"})])
    assert "error" not in dict(provider.results)["draft_set_intent"]
    proposal = next(event for event in events if event["type"] == "draft")
    assert proposal["target"] == {"kind": "new", "planId": "p", "weekNumber": 1}
    assert proposal["workout"]["title"] == "Close control practice"
    assert [block["drillId"] for block in proposal["workout"]["blocks"]] == ["DRB-501"]
    assert proposal["check"]["ok"] and proposal["workout"]["budgetMinutes"] == 30
    assert doc(inv, "trainingPlans", "p") == before
    assert not list(inv.player_ref().collection("plannedWorkouts").stream())


def test_resumed_proposal_keeps_pending_dose_when_first_tool_edits_its_title(monkeypatch):
    inv = seed(message="Cut today's workout to 20 minutes.")
    events, _ = run(inv, monkeypatch, [("draft_set_intent", {"budgetMinutes": 20}),
        ("draft_set_dose", {"blockId": "b1", "sets": 4})])
    first = next(event for event in events if event["type"] == "draft")
    followup = Invocation(capability="workout_chat", player_id=inv.player_id, uid=inv.uid,
        db=inv.db, storage=inv.storage, context={"now": NOW}, params={"conversationId": inv.conversation_id,
        "message": "Name this proposal Short close control.",
        "context": {"workoutRef": inv.params["context"]["workoutRef"], "draftId": first["draftId"]}})
    events, _ = run(followup, monkeypatch, [("draft_set_intent", {"title": "Short close control"})])
    proposal = next(event for event in events if event["type"] == "draft")
    assert proposal["workout"]["budgetMinutes"] == proposal["workout"]["estimatedMinutes"] == 20
    assert proposal["workout"]["blocks"][0]["sets"] == 4
    assert proposal["workout"]["title"] == "Short close control"
    assert doc(inv, "trainingPlans", "p")["weeks"][0]["workouts"][0]["budgetMinutes"] == 30


def test_existing_adhoc_workout_first_edit_is_only_a_bound_proposal(monkeypatch):
    inv = seed(target={"kind": "new", "planId": "p", "timeAvailableMinutes": 30, "energy": "normal"})
    events, _ = run(inv, monkeypatch, [("draft_set_intent", {"title": "Extra close control"})])
    first = next(event for event in events if event["type"] == "draft")
    inv.capability = "apply_workout_draft"
    inv.params = {"draftId": first["draftId"]}
    applied, _ = run_job_capability(inv)
    wid = applied["target"]["plannedWorkoutId"]
    before = deepcopy(doc(inv, "plannedWorkouts", wid))
    following = Invocation(capability="workout_chat", player_id=inv.player_id, uid=inv.uid,
        db=inv.db, storage=inv.storage, context={"now": NOW}, params={
        "message": "Rename this workout Extra technical practice.",
        "context": {"workoutRef": {"kind": "adhoc", "plannedWorkoutId": wid}}})
    events, _ = run(following, monkeypatch, [("draft_set_intent", {"title": "Extra technical practice"})])
    proposal = next(event for event in events if event["type"] == "draft")
    assert proposal["target"] == {"kind": "adhoc", "planId": "p", "plannedWorkoutId": wid, "baseRevision": before["revision"]}
    assert proposal["workout"]["workoutId"] == wid
    assert proposal["workout"]["title"] == "Extra technical practice"
    assert doc(inv, "plannedWorkouts", wid) == before


def test_speed_agility_new_workout_keeps_plan_speed_core(monkeypatch):
    inv = seed(target={"kind": "new", "planId": "p", "timeAvailableMinutes": 31, "energy": "normal"}, message="Build a speed and agility workout.")
    # Preserve the same legal executable structure, with existing speed work.
    p = doc(inv, "trainingPlans", "p")
    core = p["weeks"][0]["workouts"][0]
    core.update(focusDomains=["speed"], intent="Practice speed.", budgetMinutes=15, estimatedMinutes=15)
    core["blocks"][0].update(drillId="SPD-501", domain="speed", sets=3, estimatedMinutes=15)
    inv.player_ref().collection("trainingPlans").document("p").set(p)
    events, provider = run(inv, monkeypatch, [
        lambda inv: ("draft_create", {"target": inv.context["workoutContext"]["target"], "from": "planCore",
            "title": "Speed and agility", "intent": "Practice speed and agility.", "focusDomains": ["speed", "agility"], "budgetMinutes": 31}),
        ("search_drills", {"domains": ["agility"]}),
        ("draft_add_block", {"drillId": "AGI-501", "sets": 3, "reps": 300, "restSeconds": 0}),
        estimate, ("validate_workout", {})])
    draft = next(e for e in events if e["type"] == "draft")
    assert [b["drillId"] for b in draft["workout"]["blocks"]] == ["SPD-501", "AGI-501"]
    assert draft["workout"]["estimatedMinutes"] == 31 and draft["check"]["ok"]
    inv.capability = "apply_workout_draft"; inv.params = {"draftId": draft["draftId"]}
    result, _ = run_job_capability(inv)
    assert result["target"]["kind"] == "adhoc"
    assert doc(inv, "trainingPlans", "p") == p


def test_hard_difficulty_refusal_leaves_safe_draft(monkeypatch):
    inv = seed()
    events, provider = run(inv, monkeypatch, [create, ("draft_remove_block", {"blockId": "b1"}),
        ("draft_add_block", {"drillId": "DRB-503"}),
        ("draft_add_block", {"drillId": "DRB-502", "sets": 6, "reps": 300, "restSeconds": 0}), estimate])
    denied = next(result for name, result in provider.results if name == "draft_add_block")
    assert denied["error"] == "invalid_request"
    draft = next(e for e in events if e["type"] == "draft")
    assert [b["drillId"] for b in draft["workout"]["blocks"]] == ["DRB-502"]


def test_interrupted_provider_has_no_draft_or_done_and_meters_failure(monkeypatch):
    inv = seed()
    events, _ = run(inv, monkeypatch, [create], fail=True)
    assert events[-1]["type"] == "error" and not any(e["type"] in ("draft", "done") for e in events)
    assert not list(inv.player_ref().collection("workoutDrafts").stream())
    rows = [s.to_dict() for s in inv.db.collection("llmUsage").stream()]
    assert len(rows) == 2 and rows[-1]["outcome"] == "failed"
    assert rows[-1]["inputTokens"] == 150


def test_invalid_final_draft_has_no_usable_proposal(monkeypatch):
    inv = seed()
    events, _ = run(inv, monkeypatch, [create, ("draft_remove_block", {"blockId": "b1"})])
    assert events[-1]["type"] == "error" and events[-1]["code"] == "validation_failed"
    assert not any(e["type"] in ("draft", "done") for e in events)
    assert not list(inv.player_ref().collection("workoutDrafts").stream())


def test_clarification_and_safety_turn_can_finish_without_draft(monkeypatch):
    inv = seed(message="My knee hurts. Can I work through it?")
    events, _ = run(inv, monkeypatch, answer="Stop for now and speak to a trusted adult or qualified professional.")
    assert events[-1]["type"] == "done" and not any(e["type"] == "draft" for e in events)


@pytest.mark.parametrize("message", ["hi", " " * 5, "x" * 501, {"prompt": "hello"}])
def test_request_text_bounds_precede_transcript_and_provider(monkeypatch, message):
    inv = seed(message=message)
    with pytest.raises(GatewayError, match="3..500"):
        run(inv, monkeypatch)
    assert not list(inv.player_ref().collection("aiConversations").stream())


@pytest.mark.parametrize("identity", ["stranger", "coach"])
def test_other_player_or_read_only_coach_cannot_chat(monkeypatch, identity):
    inv = seed(); inv.uid = identity
    if identity == "coach":
        inv.db.set_doc(("coaches", "c"), {"userUID": "coach", "members": ["player"]})
    with pytest.raises(GatewayError) as error:
        run(inv, monkeypatch)
    assert error.value.code == "permission_denied"
    assert not list(inv.player_ref().collection("aiConversations").stream())
    assert not list(inv.db.collection("llmUsage").stream())


@pytest.mark.parametrize("field,value", [("createdByUid", "other"), ("capability", "coaching_chat"),
    ("workoutTarget", {"kind": "plan", "planId": "p", "workoutId": "w1s2"})])
def test_conversation_is_bound_before_transcript_writes(monkeypatch, field, value):
    inv = seed(); inv.params["conversationId"] = "bound"
    data = {"createdByUid": "athlete", "capability": "workout_chat", "workoutTarget": scheduled(inv)}
    data[field] = value
    ref = inv.player_ref().collection("aiConversations").document("bound"); ref.set(data)
    with pytest.raises(GatewayError):
        run(inv, monkeypatch)
    assert not list(ref.collection("messages").stream()) and ref.get().to_dict() == data


def test_resume_same_target_and_creator_supersedes_only_selected_draft(monkeypatch):
    inv = seed()
    events, _ = run(inv, monkeypatch, [create])
    first = next(e for e in events if e["type"] == "draft")
    followup = Invocation(capability="workout_chat", player_id=inv.player_id, uid=inv.uid,
        db=inv.db, storage=inv.storage, context={"now": NOW}, params={"conversationId": inv.conversation_id,
        "message": "Only 20 minutes today.", "context": {"workoutRef": inv.params["context"]["workoutRef"], "draftId": first["draftId"]}})
    events, _ = run(followup, monkeypatch, [("draft_get", {}), ("draft_set_intent", {"budgetMinutes": 20}),
        ("draft_set_dose", {"blockId": "b1", "sets": 4}), estimate])
    second = next(e for e in events if e["type"] == "draft")
    assert second["draftId"] != first["draftId"]
    assert doc(inv, "workoutDrafts", first["draftId"])["status"] == "superseded"
    assert second["workout"]["estimatedMinutes"] == 20


def test_capability_disabled_without_explicit_positive_quota(monkeypatch):
    inv = seed()
    inv.db.set_doc(("config", "llm"), {"globalEnabled": True, "capabilities": {"workout_chat": {"enabled": True}}})
    with pytest.raises(GatewayError) as error:
        run(inv, monkeypatch)
    assert error.value.code == "capability_disabled"


def test_runtime_rejects_model_above_cap(monkeypatch):
    inv = seed()
    monkeypatch.setitem(REGISTRY, "workout_chat", replace(REGISTRY["workout_chat"], model="claude-opus-4-6", provider="anthropic_vertex"))
    with pytest.raises(GatewayError, match="Sonnet 4.6"):
        run(inv, monkeypatch)


def test_draft_and_transcript_exist_at_draft_event_before_done(monkeypatch):
    inv = seed(); provider = ScriptedProvider(inv, [create])
    monkeypatch.setattr("gateway.providers.base.get_provider", lambda _: provider)
    seen = []
    for event in run_stream_capability(inv):
        if event["type"] == "draft":
            assert "done" not in seen
            assert doc(inv, "workoutDrafts", event["draftId"])["status"] == "proposed"
            messages = [s.to_dict() for s in inv.player_ref().collection("aiConversations").document(inv.conversation_id).collection("messages").stream()]
            assert any(m.get("draftId") == event["draftId"] and m["role"] == "assistant" for m in messages)
        seen.append(event["type"])
    assert seen[-1] == "done" and "draft" in seen


def test_trusted_admin_proposal_and_apply_keep_actual_editor_role(monkeypatch):
    inv = seed(); inv.uid = "admin"; inv.email = "admin@posetek.net"
    inv.trusted_claims = {"email": inv.email, "email_verified": True}
    events, _ = run(inv, monkeypatch, [create])
    proposal = next(e for e in events if e["type"] == "draft")
    inv.capability = "apply_workout_draft"; inv.params = {"draftId": proposal["draftId"]}
    run_job_capability(inv)
    edited = doc(inv, "trainingPlans", "p")["weeks"][0]["workouts"][0]
    assert edited["editedBy"] == "admin" and edited["editorUid"] == "admin"


def test_existing_adhoc_target_edits_it_without_rewriting_plan(monkeypatch):
    inv = seed()
    workout = deepcopy(doc(inv, "trainingPlans", "p")["weeks"][0]["workouts"][0])
    workout.update(schemaVersion=2, workoutId="adhoc1", planId="p", weekNumber=1, source="adhoc", status="ready",
                   windowStart=NOW, windowEnd=NOW.replace(day=13))
    inv.player_ref().collection("plannedWorkouts").document("adhoc1").set(workout)
    inv.params["context"]["workoutRef"] = {"kind": "adhoc", "planId": "p", "plannedWorkoutId": "adhoc1"}
    original = deepcopy(doc(inv, "trainingPlans", "p"))
    events, _ = run(inv, monkeypatch, [create, ("draft_set_intent", {"budgetMinutes": 20}),
        ("draft_set_dose", {"blockId": "b1", "sets": 4}), estimate])
    proposal = next(e for e in events if e["type"] == "draft")
    assert proposal["target"] == {"kind": "adhoc", "planId": "p", "plannedWorkoutId": "adhoc1", "baseRevision": 1}
    inv.capability = "apply_workout_draft"; inv.params = {"draftId": proposal["draftId"]}
    run_job_capability(inv)
    assert doc(inv, "plannedWorkouts", "adhoc1")["revision"] == 2
    assert doc(inv, "trainingPlans", "p") == original


def test_stale_resumed_proposal_fails_before_another_user_message(monkeypatch):
    inv = seed(); events, _ = run(inv, monkeypatch, [create])
    proposal = next(e for e in events if e["type"] == "draft")
    conv = inv.player_ref().collection("aiConversations").document(inv.conversation_id)
    count = len(list(conv.collection("messages").stream()))
    p = doc(inv, "trainingPlans", "p"); p["weeks"][0]["workouts"][0]["revision"] = 2
    inv.player_ref().collection("trainingPlans").document("p").set(p)
    followup = Invocation(capability="workout_chat", player_id=inv.player_id, uid=inv.uid,
        db=inv.db, storage=inv.storage, context={"now": NOW}, params={"conversationId": inv.conversation_id,
        "message": "Shorter please.", "context": {"workoutRef": inv.params["context"]["workoutRef"], "draftId": proposal["draftId"]}})
    with pytest.raises(GatewayError, match="changed"):
        run(followup, monkeypatch)
    assert len(list(conv.collection("messages").stream())) == count


def test_http_sse_forwards_draft_and_hides_internal_event(monkeypatch):
    import main
    from gateway.authz import AuthContext
    inv = seed()
    provider = ScriptedProvider(inv, [create])
    monkeypatch.setattr(main, "verify_request", lambda _: AuthContext(uid="athlete", email=None, claims={"uid": "athlete"}))
    monkeypatch.setattr(main, "_firestore_client", lambda: inv.db)
    monkeypatch.setattr(main, "_artifact_store_client", lambda: inv.storage)
    monkeypatch.setattr("gateway.providers.base.get_provider", lambda _: provider)
    # The HTTP invocation is authoritative, including its server-bound target.
    original_run = main.run_stream_capability
    def stream(request_inv):
        request_inv.context["now"] = NOW
        provider.inv = request_inv
        yield from original_run(request_inv)
    monkeypatch.setattr(main, "run_stream_capability", stream)
    response = main.app.test_client().post("/v1/chat/stream", json={"schemaVersion": 1,
        "capability": "workout_chat", "playerId": "player", "message": inv.params["message"],
        "context": inv.params["context"]})
    body = response.get_data(as_text=True)
    assert response.status_code == 200
    assert "event: draft\n" in body and "event: done\n" in body
    assert "event: persisted" not in body and "event: error" not in body
    assert body.index("event: draft") < body.index("event: done")


def test_easy_passing_adjustment_uses_full_catalog_once_per_drill_and_shared_time(monkeypatch):
    inv = seed(message='I want more passing, with easy drills.')
    for did, difficulty in [('PAS-501', 1), ('PAS-502', 1), ('PAS-503', 2), ('PAS-999', 1)]:
        row = drill(did, difficulty=difficulty)
        row.update(domain='passing', name='Passing ' + did)
        inv.db.set_doc(('drillCatalog', did), row)
    current = doc(inv, 'trainingPlans', 'p')
    sibling = current['weeks'][0]['workouts'][1]
    sibling['blocks'].append(dict(deepcopy(sibling['blocks'][0]), blockId='b2', order=2,
        drillId='PAS-502', domain='passing', name='Passing PAS-502', sets=1, reps=60, estimatedMinutes=1))
    sibling['nextBlockSequence'] = 3
    inv.db.set_doc(('players', 'player', 'trainingPlans', 'p'), current)
    events, provider = run(inv, monkeypatch, [create,
        ('draft_set_intent', {'focusDomains': ['dribbling', 'passing'], 'intent': 'Practice close control and easy passing.'}),
        ('draft_set_dose', {'blockId': 'b1', 'sets': 3}),
        ('search_drills', {'domains': ['passing'], 'difficultyPreference': 'easier', 'limit': 25}),
        ('draft_add_block', {'drillId': 'PAS-501', 'sets': 1, 'reps': 300}),
        ('draft_add_block', {'drillId': 'PAS-501'}),  # Provider tries the original bug; tool must refuse.
        ('draft_add_block', {'drillId': 'PAS-502'}),  # Other day reserved, even below frequency cap.
        ('draft_add_block', {'drillId': 'PAS-999', 'sets': 2, 'reps': 300}),
        estimate, ('validate_workout', {})])
    assert events[-1]['type'] == 'done', events
    draft = next(event for event in events if event['type'] == 'draft')
    assert [b['drillId'] for b in draft['workout']['blocks']] == ['DRB-501', 'PAS-501', 'PAS-999']
    assert draft['workout']['estimatedMinutes'] == 32 and draft['check']['ok']
    search = next(result for name, result in provider.results if name == 'search_drills')
    assert [row['drillId'] for row in search['results']] == ['PAS-501', 'PAS-999', 'PAS-503']
    refusals = [result for name, result in provider.results if name == 'draft_add_block' and 'error' in result]
    assert len(refusals) == 2
    inv.capability = 'apply_workout_draft'; inv.params = {'draftId': draft['draftId']}
    run_job_capability(inv)
    persisted = doc(inv, 'trainingPlans', 'p')
    assert persisted['weeks'][0]['workouts'][0]['blocks'] == draft['workout']['blocks']
    assert persisted['weeks'][0]['workouts'][1] == sibling


def test_half_and_half_plan_partner_drills_remain_editable(monkeypatch):
    inv = seed(message='Only 20 minutes today.')
    current = doc(inv, 'trainingPlans', 'p'); current['intake']['setting'] = 'halfAndHalf'
    inv.db.set_doc(('players', 'player', 'trainingPlans', 'p'), current)
    row = inv.db.get_doc(('drillCatalog', 'DRB-501')); row['requiresPartner'] = True
    inv.db.set_doc(('drillCatalog', 'DRB-501'), row)
    events, _ = run(inv, monkeypatch, [create,
        ('draft_set_intent', {'budgetMinutes': 20}), ('draft_set_dose', {'blockId': 'b1', 'sets': 4}),
        estimate, ('validate_workout', {})])
    assert events[-1]['type'] == 'done', events
    assert next(event for event in events if event['type'] == 'draft')['check']['ok']


def test_incomplete_schedule_is_rejected_before_provider_and_allowance(monkeypatch):
    inv = seed()
    inv.db.set_doc(('players', 'player', 'workoutLogs', 'undated'),
                   {'source': 'adhoc', 'blocks': [{'drillId': 'DRB-502', 'status': 'done'}]})
    monkeypatch.setattr('gateway.providers.base.get_provider', lambda _: pytest.fail('Provider must not run'))
    with pytest.raises(GatewayError, match='incomplete'):
        list(run_stream_capability(inv))
    assert not inv.db.get_collection(('llmUsage',))
    assert not inv.db.get_collection(('llmDailyAllowances',))
