"""Athlete workout conversation: shared tools produce proposals; Apply is a job.

This module owns transport composition only. Eligibility, dose/time arithmetic,
history, proposal persistence and the apply transaction remain agent 03's code.
"""
from __future__ import annotations

from copy import deepcopy
import json
import time

from google.cloud import firestore as fs
from google.cloud.firestore_v1.transaction import transactional

from gateway.authz import authorize_v3
from gateway.errors import GatewayError, context_unavailable, invalid_request, permission_denied
from gateway.providers.base import ModelMessage
from gateway.usage import aggregate_usage, make_usage_callback
from gateway.workout_persistence import (
    _id, _safe_workout, _target_key, assemble_workout_context, persist_workout_draft,
)


def _validate_request(inv):
    message = inv.params.get("message")
    if not isinstance(message, str) or not 3 <= len(message.strip()) <= 500 or len(message) > 500:
        raise invalid_request("message must contain 3..500 characters")
    context = inv.params.get("context")
    if not isinstance(context, dict) or set(context) - {"workoutRef", "draftId"}:
        raise invalid_request("context requires workoutRef and optional draftId")
    for value in (inv.params.get("conversationId"), inv.conversation_id):
        if value is not None:
            _id(value, "conversationId")
    if inv.params.get("conversationId") and inv.conversation_id and inv.params["conversationId"] != inv.conversation_id:
        raise invalid_request("Conflicting conversation IDs")
    if "draftId" in context:
        _id(context["draftId"], "draftId")
    return message


def _check_conversation(data, inv, target=None):
    if data.get("createdByUid") != inv.uid:
        raise permission_denied("The conversation belongs to another creator")
    if data.get("capability") != "workout_chat":
        raise invalid_request("A conversation cannot switch capabilities")
    bound = data.get("workoutTarget")
    if not bound or (target is not None and _target_key(bound) != _target_key(target)):
        raise invalid_request("A conversation cannot switch workout targets")


def _bind_conversation(inv, ref, target, message):
    """Reserve creator/capability/target before transcript reads or provider use."""
    @transactional
    def bind(tx):
        snap = ref.get(transaction=tx)
        if snap.exists:
            _check_conversation(snap.to_dict() or {}, inv, target)
            return
        tx.create(ref, {"capability": "workout_chat", "createdByUid": inv.uid,
                        "workoutTarget": _target_key(target), "createdAt": fs.SERVER_TIMESTAMP,
                        "title": message.strip().splitlines()[0][:80], "messageCount": 0})
    bind(inv.db.transaction())


def _public_context(inv):
    """Do not render the private originals, raw catalog or invocation internals."""
    context = inv.context["workoutContext"]
    plan = context["plan"]
    profile = inv.context.get("programProfile") or {}
    week = next(w for w in plan["weeks"] if w["weekNumber"] == context["weekNumber"])
    def workout(value):
        return {k: v for k, v in _safe_workout(value or {}).items() if k != "previousRevision"}
    result = {
        "athlete": {k: deepcopy(profile[k]) for k in ("age", "technicalEligibility") if k in profile},
        "target": deepcopy(context["target"]),
        "plan": {k: deepcopy(plan[k]) for k in ("planId", "weeklyBudgetMinutes", "minutesPerSession") if k in plan},
        "week": {k: deepcopy(week[k]) for k in ("weekNumber", "theme", "focus", "allocations", "targets") if k in week},
        "planCore": [workout(w) for w in sorted(week.get("workouts", []), key=lambda w: w.get("order", 0))],
        "currentWorkout": workout(context.get("workout")),
        "weekProgress": deepcopy(inv.context["weekProgress"]),
        "timeAvailableMinutes": context.get("timeAvailableMinutes"), "energy": context.get("energy"),
        "trainingSetting": {k: deepcopy((plan.get("intake") or {}).get(k)) for k in ("equipment", "setting", "painFlag")},
    }
    if inv.context.get("workoutRequirements"):
        result["requestRequirements"] = deepcopy(inv.context["workoutRequirements"])
    if inv.context.get("workoutDraft"):
        result["proposedWorkout"] = workout(inv.context["workoutDraft"].get("workout"))
    return result


_DRAFT_DEPENDENT_TOOLS = frozenset({"draft_add_block", "draft_set_dose", "draft_remove_block",
    "draft_reorder", "draft_set_intent", "draft_get", "validate_workout"})


def _initial_draft_args(inv):
    """Default scratch state comes only from the server-bound workout/plan.

    This is setup for a tool, not a prescription write or a model-authored target.
    Resumed proposals bypass it and retain all their pending edits.
    """
    context = inv.context["workoutContext"]
    target = context["target"]
    if target["kind"] in ("plan", "adhoc"):
        return {"target": deepcopy(target), "from": "workout"}
    if target["kind"] != "new":
        raise invalid_request("Workout chat requires a bound athlete workout target")
    week = next(w for w in context["plan"]["weeks"] if w["weekNumber"] == context["weekNumber"])
    core = sorted(week.get("workouts") or [], key=lambda workout: workout.get("order", 0))
    if not core:
        raise context_unavailable("This week's program core is unavailable")
    return {"target": deepcopy(target), "from": "planCore", "title": core[0]["title"],
            "intent": core[0]["intent"], "focusDomains": deepcopy(core[0]["focusDomains"]),
            "budgetMinutes": context["timeAvailableMinutes"]}


def run_workout_chat(inv, spec):
    """Called after the common config/quota shell; yields the standard SSE shape."""
    from gateway.assemblers import assemble_week_progress
    from gateway.pipeline import _history_to_messages, _load_history, _resolve_conversation
    from gateway.prompts import render_prompt
    from gateway.providers.base import get_provider
    from gateway.registry import PROGRAM_ALLOWED_MODELS
    from gateway.tools import TOOL_SPECS, run_tool

    message = _validate_request(inv)
    # The existing proposal writer is mutation-authorized too. Fail before a
    # coach spends a model turn on a draft that writer would refuse to persist.
    authorize_v3(inv, mutation=True)
    stage = spec.stage_list()[0]
    if PROGRAM_ALLOWED_MODELS.get(stage.model) != stage.provider:
        raise GatewayError("internal", "Workout chat runtime must respect the Sonnet 4.6 model cap")
    conv_ref, conv_id, is_new = _resolve_conversation(inv)
    inv.conversation_id = conv_id
    if not is_new:
        _check_conversation(conv_ref.get().to_dict() or {}, inv)
    context = assemble_workout_context(inv)
    from gateway.workout_requirements import bind_request_requirements
    from gateway.workout_tools import _check
    requirements = bind_request_requirements(inv, message)
    _bind_conversation(inv, conv_ref, context["target"], message)
    inv.context["weekProgress"] = assemble_week_progress(inv)
    history = _load_history(conv_ref)[-20:]
    if getattr(inv, "_daily_allowance_required", False):
        from gateway import config
        config.reserve_daily_allowance(inv)
    system, context_prompt = render_prompt(stage.prompt, _public_context(inv))
    messages = _history_to_messages(history) + [ModelMessage(role="user", content=message)]
    user_ref = conv_ref.collection("messages").document()
    user_ref.set({"role": "user", "content": message, "createdAt": fs.SERVER_TIMESTAMP})
    assistant_ref = conv_ref.collection("messages").document()
    callback = make_usage_callback(inv, provider=stage.provider, model=stage.model, stage="workout_chat", retry_index=0)
    changed = False
    actions = []
    started = time.monotonic()
    max_actions = stage.params.get("max_tool_calls", 30)
    deadline = started + stage.params.get("max_tool_seconds", 120)

    def metered(event):
        # Repair is part of this invocation; every actual request has a distinct
        # call index, one usage row, and no second daily allowance reservation.
        callback({**event, "callIndex": len(callback.records) + 1})

    def runner(name, args):
        nonlocal changed
        if name not in stage.tools:
            raise invalid_request("Tool is not enabled for workout_chat")
        if len(actions) >= max_actions or time.monotonic() >= deadline:
            raise GatewayError("provider_error", "Workout tool budget exhausted")
        actions.append({"name": name})
        try:
            if name in _DRAFT_DEPENDENT_TOOLS and not inv.context.get("workoutDraft"):
                # A submitted edit already authorizes preparing scratch state.
                # Use the same bound tools/limits; never ask the athlete to
                # confirm an internal prerequisite. Track changes AFTER setup:
                # inspection or a rejected edit must not persist an untouched
                # default proposal. Read-only/safety replies never enter here.
                run_tool("draft_create", _initial_draft_args(inv), inv)
            before = deepcopy(inv.context.get("workoutDraft"))
            result = run_tool(name, args, inv)
            changed |= before != inv.context.get("workoutDraft")
            return result
        except GatewayError as exc:
            if exc.code not in ("invalid_request", "validation_failed", "context_unavailable"):
                raise
            return {"error": exc.code, "message": exc.message}

    yield {"type": "start", "conversationId": conv_id, "messageId": assistant_ref.id, "model": stage.model}
    text, final_usage = [], {}
    try:
        provider = get_provider(stage.provider)
        request_failure = None
        for attempt in range(2):
            if attempt:
                # The initial tool loop may overlook the validation result. One
                # final repair gets the same remaining action/time budget and
                # the current scratch state, never a fresh quota allowance.
                system, context_prompt = render_prompt(stage.prompt, _public_context(inv))
                system += ("\nThe server's final request check failed. Repair this working draft now "
                           "using the remaining tools and validate it again. Do not repeat the failed "
                           "claim or ask permission for setup. If no eligible solution exists, explain why. "
                           + json.dumps(request_failure, separators=(",", ":")))
                text = []
            final_usage = {}
            before_records = len(callback.records)
            remaining = max(0.001, deadline - time.monotonic())
            for event in provider.stream(system=system + "\n\n" + context_prompt, messages=messages,
                    model=stage.model, params={**stage.params, "_usage_callback": metered,
                        "max_tool_calls": max(0, max_actions - len(actions)), "max_tool_seconds": remaining},
                    tools=[TOOL_SPECS[n] for n in stage.tools], tool_runner=runner):
                kind = event.get("type")
                if kind == "delta":
                    part = event.get("text", "")
                    text.append(part)
                    # Do not briefly render a failed candidate as ready and then
                    # replace it during repair. Tools/progress still stream live.
                    if not requirements:
                        yield {"type": "delta", "text": part}
                elif kind == "tool":
                    yield {"type": "tool", "name": event.get("name"), "status": event.get("status")}
                elif kind == "usage":
                    final_usage = event.get("usage") or {}
            if len(callback.records) == before_records:
                metered({"usage": final_usage, "latencyMs": round((time.monotonic() - started) * 1000),
                         "outcome": "complete"})
            scratch = inv.context.get("workoutDraft")
            request_failure = _check(inv, scratch["workout"]) if scratch and requirements else None
            if not requirements or not changed or (request_failure and request_failure["ok"]):
                request_failure = None
                break
            if not scratch:
                request_failure = {"ok": False, "violations": [{"code": "request_no_edit",
                    "message": "The athlete requested an adjustment but no changed proposal was prepared."}]}
            if len(actions) >= max_actions or time.monotonic() >= deadline:
                break
        proposal = None
        if request_failure:
            # No invalid proposal can cross the Apply boundary. Honest measured
            # feedback is actionable and avoids the generic safety-error UI.
            details = " ".join(v["message"] for v in request_failure["violations"][:3])
            if not details:
                details = "The calculated time or skill coverage still needs adjustment."
            text = ["I couldn't make an eligible workout that meets all of your requested changes. " + details +
                    " Your current workout is unchanged. You can keep it or relax one of the requested limits."]
        elif changed and inv.context.get("workoutDraft"):
            proposal = persist_workout_draft(inv, ask=message, source_message_id=user_ref.id)
        if requirements:
            for part in text:
                yield {"type": "delta", "text": part}
        usage = aggregate_usage(callback.records)
        assistant = {"role": "assistant", "content": "".join(text), "createdAt": fs.SERVER_TIMESTAMP,
                     "usage": usage, "toolCalls": actions}
        if request_failure:
            assistant["requestCheck"] = deepcopy(request_failure)
        if proposal:
            assistant["draftId"] = proposal["draftId"]
        assistant_ref.set(assistant)
        conv_ref.set({"lastMessageAt": fs.SERVER_TIMESTAMP, "messageCount": fs.Increment(2)}, merge=True)
        if proposal:
            yield {"type": "draft", **proposal}
        yield {"type": "usage", **{k: usage[k] for k in ("inputTokens", "outputTokens", "cachedInputTokens")}}
        yield {"type": "persisted", "conversationId": conv_id, "messageId": assistant_ref.id}
        yield {"type": "done", "messageId": assistant_ref.id, "finishReason": "stop"}
    except Exception as exc:
        if not callback.records:
            callback({"usage": {"calls": 0}, "latencyMs": round((time.monotonic() - started) * 1000),
                      "outcome": "failed", "callIndex": 1})
        if isinstance(exc, GatewayError):
            yield {"type": "error", "code": exc.code, "message": exc.message}
        else:
            inv.log.exception("Workout chat failed")
            yield {"type": "error", "code": "provider_error", "message": "The workout conversation could not finish. Please try again."}
