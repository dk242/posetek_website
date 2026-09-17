"""Versioned pose_chat workspace, preserving the unmarked legacy transport."""
from __future__ import annotations

from dataclasses import replace
import json
import time

from google.cloud import firestore as fs
from google.cloud.firestore_v1.transaction import transactional

from gateway import config
from gateway.authz import authorize_v3
from gateway.coach_context import assemble, thread_history
from gateway.coach_actions import COACH_TOOL_SPECS, run_coach_action, save_explicit_profile_facts
from gateway import coach_workspace as memory
from gateway.errors import GatewayError, invalid_request, permission_denied
from gateway.providers.base import ModelMessage, get_provider
from gateway.usage import aggregate_usage, make_usage_callback
from gateway.workout_persistence import _id


EXTRACT_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["candidates"], "properties": {
    "candidates": {"type": "array", "maxItems": 2, "items": {"type": "object", "additionalProperties": False,
        "required": ["category", "quote"], "properties": {"category": {"type": "string", "enum": sorted(memory.CATEGORIES)},
            "quote": {"type": "string", "minLength": 10, "maxLength": 240}}}}}}


def _params(inv):
    ctx = inv.params.get("context")
    if not isinstance(ctx, dict) or ctx.get("coachWorkspaceVersion") != 1 or type(ctx.get("coachWorkspaceVersion")) is not int:
        raise invalid_request("coachWorkspaceVersion must be 1")
    if set(ctx) - {"coachWorkspaceVersion", "memoryAction"}:
        raise invalid_request("Unsupported coach workspace context field")
    message = inv.params.get("message")
    if not isinstance(message, str) or not 1 <= len(message.strip()) or len(message) > 2000:
        raise invalid_request("message must contain 1..2000 characters")
    for cid in (inv.conversation_id, inv.params.get("conversationId")):
        if cid is not None:
            _id(cid, "conversationId")
    if inv.conversation_id and inv.params.get("conversationId") and inv.conversation_id != inv.params["conversationId"]:
        raise invalid_request("Conflicting conversation IDs")
    return ctx, message


def _bind(inv, conv_ref, message):
    @transactional
    def commit(tx):
        snap = conv_ref.get(transaction=tx)
        if snap.exists:
            data = snap.to_dict() or {}
            if data.get("createdByUid") != inv.uid:
                raise permission_denied("The conversation belongs to another creator")
            if data.get("capability") != "pose_chat":
                raise invalid_request("A conversation cannot switch capabilities")
            tx.update(conv_ref, {"coachWorkspaceVersion": 1})
        else:
            tx.create(conv_ref, {"capability": "pose_chat", "coachWorkspaceVersion": 1, "createdByUid": inv.uid,
                "createdAt": fs.SERVER_TIMESTAMP, "title": message.strip().splitlines()[0][:80], "messageCount": 0})
    commit(inv.db.transaction())


def _extract(inv, message, user_id, workspace):
    from gateway.prompts import render_prompt
    from gateway.registry import COACH_MEMORY_STAGE, PROGRAM_ALLOWED_MODELS
    import jsonschema
    stage = COACH_MEMORY_STAGE
    callback = make_usage_callback(inv, provider=stage.provider, model=stage.model, stage="coach_memory", retry_index=0)
    system, prompt = render_prompt(stage.prompt, {"currentAthleteMessage": message})
    started = time.monotonic()
    try:
        if PROGRAM_ALLOWED_MODELS.get(stage.model) != stage.provider:
            raise GatewayError("internal", "Memory runtime must respect the Sonnet 4.6 model cap")
        result = get_provider(stage.provider).generate(system=system, messages=[ModelMessage(role="user", content=prompt)],
            model=stage.model, params={**stage.params, "_usage_callback": callback}, json_schema=EXTRACT_SCHEMA)
        if not callback.records:
            callback({"usage": result.usage, "latencyMs": round((time.monotonic() - started) * 1000), "outcome": "complete", "callIndex": 1})
        jsonschema.validate(result.structured, EXTRACT_SCHEMA)
        state = memory.propose(inv, result.structured["candidates"], message=message, conversation_id=inv.conversation_id,
                               message_id=user_id, expected_revision=workspace["revision"])
        return {**state, "extraction": {"status": "complete"}}
    except Exception:
        # A sidecar cannot turn a completed coach answer into a failed response.
        # Invalid extraction is never persisted, and no prompt text enters errors.
        inv.log.warning("Coach memory extraction unavailable", exc_info=False)
        if not callback.records:
            callback({"usage": {"calls": 0}, "latencyMs": round((time.monotonic() - started) * 1000), "outcome": "failed", "callIndex": 1})
        return {**memory.snapshot(inv), "extraction": {"status": "unavailable"}}


def run_coach_chat(inv):
    from gateway.pipeline import _authorize_and_configure, _resolve_conversation
    from gateway.prompts import render_prompt
    from gateway.registry import COACH_WORKSPACE_STAGE, PROGRAM_ALLOWED_MODELS
    from gateway.tools import TOOL_SPECS, run_tool

    turn_started_at = memory.now(inv)
    ctx, message = _params(inv)
    role = authorize_v3(inv)  # strict even if legacy AUTHZ_ENFORCED is off
    cfg = config.load_llm_config(inv.db)
    config.check_client_version(cfg, inv.client_version)
    action = ctx.get("memoryAction")
    if action is not None:
        # Privacy controls do not spend a model turn or require remaining chat
        # quota. Existing records remain manageable during a chat kill switch.
        privacy_action = isinstance(action, dict) and (action.get("kind") in ("list", "forget", "forgetAll")
            or (action.get("kind") == "setEnabled" and action.get("enabled") is False))
        if not privacy_action and cfg.get("coachWorkspaceEnabled") is not True:
            raise GatewayError("capability_disabled", "The coach workspace is not enabled yet")
        _, cid, _ = _resolve_conversation(inv)
        state = memory.action(inv, action)
        mid = "memory_" + str(state["workspace"]["revision"])
        yield {"type": "start", "conversationId": cid, "messageId": mid, "model": "code"}
        yield {"type": "memory", **state}
        yield {"type": "done", "messageId": mid, "finishReason": "stop"}
        return
    if cfg.get("coachWorkspaceEnabled") is not True:
        raise GatewayError("capability_disabled", "The coach workspace is not enabled yet")
    _authorize_and_configure(inv)
    stage = COACH_WORKSPACE_STAGE
    if PROGRAM_ALLOWED_MODELS.get(stage.model) != stage.provider:
        raise GatewayError("internal", "Coach runtime must respect the Sonnet 4.6 model cap")
    conv_ref, cid, _ = _resolve_conversation(inv)
    inv.conversation_id = cid
    _bind(inv, conv_ref, message)
    save_explicit_profile_facts(inv, role)
    evidence, workspace, memory_state = assemble(inv, role=role, conversation_id=cid)
    history = thread_history(conv_ref, reset_at=(workspace or {}).get("historyResetAt"))
    inv.context["coachActionHistory"] = history
    system, context_prompt = render_prompt(stage.prompt, evidence)
    user_ref = conv_ref.collection("messages").document()
    user_ref.set({"role": "user", "content": message, "createdAt": fs.SERVER_TIMESTAMP, "sourceTurnStartedAt": turn_started_at})
    assistant_ref = conv_ref.collection("messages").document()
    requested_model = stage.model
    yield {"type": "start", "conversationId": cid, "messageId": assistant_ref.id, "model": requested_model}
    text, actions = [], []
    all_records = []
    fallback_used = False
    tool_count, tool_started = 0, time.monotonic()

    def runner(name, args):
        nonlocal tool_count
        if name not in stage.tools:
            raise invalid_request("Tool is not enabled for this coach conversation")
        if tool_count >= 12 or time.monotonic() - tool_started >= 60:
            raise invalid_request("Coach tool call/time limit reached")
        tool_count += 1
        actions.append({"name": name})
        try:
            return run_coach_action(name, args, inv) if name in COACH_TOOL_SPECS else run_tool(name, args, inv)
        except GatewayError as exc:
            if exc.code not in ("invalid_request", "validation_failed", "context_unavailable"):
                raise
            return {"error": exc.code, "message": exc.message}

    try:
        for attempt in range(2):
            callback = make_usage_callback(inv, provider=stage.provider, model=stage.model, stage="coach_chat", retry_index=attempt)
            started = time.monotonic(); final_usage = {}
            try:
                for event in get_provider(stage.provider).stream(system=system + "\n\n" + context_prompt,
                    messages=[ModelMessage(role=row["role"], content=row["content"]) for row in history] + [ModelMessage(role="user", content=message)],
                    model=stage.model, params={**stage.params, "_usage_callback": callback},
                    tools=[(COACH_TOOL_SPECS[name] if name in COACH_TOOL_SPECS else TOOL_SPECS[name]) for name in stage.tools
                           if name != "save_player_profile" or role == "athlete"], tool_runner=runner):
                    if event.get("type") == "delta":
                        part = event.get("text", ""); text.append(part)
                        yield {"type": "delta", "text": part}
                    elif event.get("type") == "tool":
                        yield {"type": "tool", "name": event.get("name"), "status": event.get("status")}
                    elif event.get("type") == "usage":
                        final_usage = event.get("usage") or {}
                if not callback.records:
                    callback({"usage": final_usage, "latencyMs": round((time.monotonic() - started) * 1000), "outcome": "complete", "callIndex": 1})
                all_records.extend(callback.records)
                break
            except Exception as exc:
                if not callback.records:
                    callback({"usage": {"calls": 0}, "latencyMs": round((time.monotonic() - started) * 1000), "outcome": "failed", "callIndex": 1})
                all_records.extend(callback.records)
                if (attempt == 0 and not text and stage.model != "gemini-2.5-flash"
                        and cfg.get("coachWorkspaceFlashFallbackEnabled") is True
                        and (not isinstance(exc, GatewayError) or exc.code == "provider_error")):
                    stage = replace(stage, provider="vertex_gemini", model="gemini-2.5-flash")
                    fallback_used = True
                    yield {"type": "model", "model": stage.model, "reason": "fallback"}
                    continue
                raise
        if not "".join(text).strip():
            raise GatewayError("provider_error", "Your coach returned an empty reply. Please try again.")
        runtime = {"requestedModel": requested_model, "model": stage.model, "fallbackUsed": fallback_used}
        if role == "athlete":
            reset_at = memory._time(workspace.get("historyResetAt"))
            memory_state = ({**memory.snapshot(inv), "extraction": {"status": "skipped"}}
                            if not workspace["enabled"] or (reset_at is not None and turn_started_at <= reset_at)
                            else _extract(inv, message, user_ref.id, workspace))
            memory_state["runtime"] = runtime
        usage = aggregate_usage(getattr(inv, "_provider_usage_records", all_records))
        assistant_ref.set({"role": "assistant", "content": "".join(text), "createdAt": fs.SERVER_TIMESTAMP,
            "usage": usage, "toolCalls": actions, "runtime": runtime,
            "coachWorkspaceVersion": 1, "sourceTurnStartedAt": turn_started_at,
            "workspaceRevisionUsed": (workspace or {}).get("revision"),
            **({"workoutRequest": inv.context["coachWorkoutRequest"]} if inv.context.get("coachWorkoutRequest") else {}),
            "memoryIdsUsed": [item["memoryId"] for item in evidence["confirmedMemories"]]})
        conv_ref.set({"lastMessageAt": fs.SERVER_TIMESTAMP, "messageCount": fs.Increment(2)}, merge=True)
        if memory_state is not None:
            yield {"type": "memory", **memory_state}
        yield {"type": "usage", **{key: usage[key] for key in ("inputTokens", "outputTokens", "cachedInputTokens")}, "model": stage.model}
        yield {"type": "persisted", "conversationId": cid, "messageId": assistant_ref.id}
        if inv.context.get("coachWorkoutRequest"):
            yield inv.context["coachWorkoutRequest"]
        yield {"type": "done", "messageId": assistant_ref.id, "finishReason": "stop"}
    except Exception as exc:
        if isinstance(exc, GatewayError):
            yield {"type": "error", "code": exc.code, "message": exc.message}
        else:
            inv.log.exception("Coach conversation failed")
            yield {"type": "error", "code": "provider_error", "message": "Your coach could not finish this reply. Please try again."}
