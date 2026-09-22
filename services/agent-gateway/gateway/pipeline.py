"""The staged capability pipeline (plan Part 4): authorize -> assemble ->
[retrieve] -> generate (tool loop) -> validate -> persist/deliver.

The policy shell (authorize, config gate, quota, assemblers, retrieve) runs
once per invocation; the generate/validate cycle runs once per `StageSpec` in
`spec.stage_list()`. A capability with no declared `stages` synthesizes exactly
one from its flat fields, so single-stage and multi-stage share one executor.

Both transports funnel through this file so a capability's behavior — which
assemblers run, which model, which validators — is entirely registry
configuration (plan Principle 2), never a bespoke code path per capability.
`gateway/assemblers.py`, `gateway/prompts.py`, `gateway/validators.py`,
`gateway/schemas`, and `gateway/tools.py` are owned by another author; this
module imports them lazily (inside functions) purely to dodge import cycles
at module-load time — the pipeline still genuinely depends on all of them.
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Callable, Iterator, Optional

from gateway import authz
from gateway import config as gw_config
from gateway import usage as usage_ledger
from gateway.ctx import Invocation
from gateway.errors import GatewayError
from gateway.providers.base import ModelMessage
from gateway.registry import CapabilitySpec, StageSpec, get_capability

log = logging.getLogger("gateway.pipeline")

_PROVISIONAL_BENCHMARK_DISCLAIMER = "Reference values are provisional and not yet measured."


# --------------------------------------------------------------------------
# Shared stages
# --------------------------------------------------------------------------


def _authorize_and_configure(inv: Invocation) -> tuple[CapabilitySpec, dict]:
    """authorize -> (config gate). Order matters: a disabled capability or an
    unauthorized caller should never trigger a quota read/write, and quota is
    checked last among the gates so it's the only one that costs a query.
    """
    spec = get_capability(inv.capability)
    cfg = gw_config.load_llm_config(inv.db)
    gw_config.check_client_version(cfg, inv.client_version)
    from gateway.personalized_plans import CAPABILITIES,GENERATE,DISCARD,ASSESS,authorize_admin,engine_for
    preview = inv.capability in CAPABILITIES
    is_v3 = preview or inv.capability in ("generate_training_plan", "apply_workout_draft", "save_workout_edit", "validate_workout_start", "workout_chat")
    enabled = (gw_config.v3_capability_enabled(cfg, inv.capability) if is_v3
               else gw_config.capability_enabled(cfg, inv.capability))
    if not enabled:
        raise GatewayError("capability_disabled", f"'{inv.capability}' is currently disabled")
    if is_v3:
        if preview:
            authorize_admin(inv)
            engine_for(inv.capability,inv.params.get('engineVersion'))
            if inv.capability != DISCARD and cfg.get('personalizedPlannerEnabled') is not True:
                raise GatewayError('capability_disabled','Personalized planner submissions are currently disabled; existing drafts remain available')
        elif inv.capability == 'generate_training_plan':
            engine_for(inv.capability,inv.params.get('engineVersion'))
        role = authz.authorize_v3(inv, mutation=inv.capability in ("apply_workout_draft", "save_workout_edit", "validate_workout_start"))
        if inv.capability == 'save_workout_edit' and role != 'admin':
            raise GatewayError('permission_denied', 'Manual workout edits require an administrator')
        if inv.capability in ("generate_training_plan",GENERATE,ASSESS):
            from gateway.program_profile import validate_program_intake
            validate_program_intake(inv)
            if cfg.get("programV3Enabled") is not True:
                raise GatewayError("capability_disabled", "V3 consumer release gate is not enabled")
    else:
        role = authz.authorize_player_access(inv.db, inv.uid, inv.email, inv.player_id, trusted_claims=inv.trusted_claims)
    if inv.capability == "apply_workout_draft":
        draft_id = inv.params.get("draftId")
        inv._usage_invocation_id = "apply:" + draft_id if isinstance(draft_id, str) else None
    elif inv.capability in ('activate_personalized_plan', 'discard_personalized_plan'):
        draft_id = inv.params.get('draftId')
        inv._usage_invocation_id = inv.capability + ':' + draft_id if isinstance(draft_id, str) else None
    # Only the shared trusted identity resolver can grant the staff bypass.
    # Feature switches and player authorization above still apply to admins.
    if role != "admin":
        gw_config.check_quota(inv.db, cfg, inv.uid, inv.capability,
                              invocation_id=getattr(inv, "_usage_invocation_id", None) or inv.job_id)
    inv._daily_allowance_required = role != "admin"
    return spec, cfg


def _assemble(spec: CapabilitySpec, inv: Invocation) -> None:
    from gateway.assemblers import ASSEMBLERS

    for name in spec.assemblers:
        fn = ASSEMBLERS.get(name)
        if fn is None:
            raise GatewayError("internal", f"No assembler registered for '{name}'")
        inv.context[name] = fn(inv)


def _retrieve(spec: CapabilitySpec, inv: Invocation) -> None:
    """Explicit no-op hook (plan Part 5): v1 retrieval is metadata-filtered
    Firestore queries exposed as the `search_drill_catalog` tool, not a
    separate pre-generation stage, so there's nothing to pre-fetch here today.
    Kept as a named stage so a future capability with real RAG doesn't have
    to restructure the pipeline to get one.
    """
    return None


def _tool_specs(stage: StageSpec) -> list[dict]:
    if not stage.tools:
        return []
    from gateway.tools import TOOL_SPECS

    return [TOOL_SPECS[name] for name in stage.tools if name in TOOL_SPECS]


def _build_tool_runner(spec: CapabilitySpec, stage: StageSpec, inv: Invocation):
    if not stage.tools:
        return None

    from gateway.tools import run_tool

    def _runner(name: str, args: dict) -> dict:
        if name not in stage.tools:
            # A tool the model was never offered showing up in a call would be
            # an SDK/prompt bug, not a user-triggerable path — fail loudly.
            raise GatewayError("invalid_request", f"Tool '{name}' is not enabled for capability '{spec.id}'")
        try:
            return run_tool(name, args, inv)
        except GatewayError as exc:
            if exc.code in ("invalid_request", "context_unavailable"):
                # Data absence is a normal athlete state, not a pipeline fault:
                # fetch_benchmark on a metric the athlete never recorded raises
                # context_unavailable, and a model-mistyped repId raises
                # invalid_request. Re-raising killed the whole streamed turn with
                # a terminal SSE error, which made the prompts' "answer honestly
                # with what you already have" instruction unfollowable — the
                # model never saw the failure. Feed it back as a tool result
                # instead, matching how providers already report non-Gateway
                # tool exceptions.
                inv.log.info("tool %s failed softly (%s): %s", name, exc.code, exc.message)
                return {"error": exc.message}
            raise

    return _runner


def _render_prompt(stage: StageSpec, context: dict) -> tuple[str, str]:
    from gateway.prompts import render_prompt

    return render_prompt(stage.prompt, context)


def _json_schema_for(stage: StageSpec) -> Optional[dict]:
    if stage.output is None:
        return None
    from gateway.schemas import get_json_schema

    return get_json_schema(stage.output)


def _validators_enforced(spec: CapabilitySpec | None = None) -> bool:
    """Semantic validation is on by default.

    Explicit legacy diagnostics may set VALIDATORS_ENFORCED=0. Capabilities
    marked strict still enforce, and the dedicated v3 path always enforces.
    """
    if os.environ.get("VALIDATORS_ENFORCED", "1") == "1":
        return True
    return bool(spec is not None and spec.strict_validation)


def _validate(stage: StageSpec, result_dict: dict, inv: Invocation) -> list[str]:
    if not stage.validators:
        return []
    from gateway.validators import VALIDATORS

    violations: list[str] = []
    if stage.output in ("kick_observations_v1", "kick_focus_v1", "kick_comparison_v1"):
        # Provider schema translation drops bounds; validate the canonical schema
        # before semantic checks, including malformed/empty arrays and object fields.
        from jsonschema import Draft202012Validator
        for error in Draft202012Validator(_json_schema_for(stage)).iter_errors(result_dict):
            path = "".join(f"[{part}]" if isinstance(part, int) else ("." if index else "") + part
                           for index, part in enumerate(error.absolute_path)) or "output"
            violations.append(f"{path}: {error.message}")
        if violations:
            return violations
    for name in stage.validators:
        fn = VALIDATORS.get(name)
        if fn is None:
            raise GatewayError("internal", f"No validator registered for '{name}'")
        violations.extend(fn(result_dict, inv) or [])
    return violations


def _stage_render_context(stage: StageSpec, inv: Invocation, stage_outputs: dict) -> dict:
    """The assembled context plus the prior stage outputs this stage declared
    visible — all of them when `inputs` is None, only the named ones otherwise.

    The `stages` key is omitted entirely when nothing is visible, so the first
    stage of a chain (and every single-stage capability) renders against
    exactly the context it would have rendered against before stages existed.
    """
    if stage.inputs is None:
        visible = dict(stage_outputs)
    else:
        visible = {name: stage_outputs[name] for name in stage.inputs if name in stage_outputs}
    if not visible:
        return inv.context
    return {**inv.context, "stages": visible}


def _trace_iteration_label(fragment: dict) -> Optional[str]:
    """A compact human label for which iteration a trace record belongs to.
    Knows the plan-fill fragment shape; anything else falls back to its keys."""
    if not fragment:
        return None
    fill = fragment.get("fillWeek")
    if isinstance(fill, dict) and fill.get("weekNumber") is not None:
        return f"week {fill['weekNumber']}"
    return "/".join(sorted(fragment))


def _run_stage(spec: CapabilitySpec, stage: StageSpec, inv: Invocation, context: dict) -> tuple[dict, dict]:
    """One render -> generate -> validate cycle, with the validate-retry-once
    loop. Returns `(result, usage_map)` for the call that produced the accepted
    result; a discarded retry attempt is still ledgered, it just isn't the map
    echoed onto the job doc.

    Every model attempt (retries included) appends one Q&A record to
    `inv.trace`: the rendered prompt in, the thought summary and output out,
    plus any validation violations — the raw material for the per-job
    `trace.json` artifact main.py persists.
    """
    from gateway.providers.base import get_provider

    system, user = _render_prompt(stage, context)
    json_schema = _json_schema_for(stage)
    tools = _tool_specs(stage)
    tool_runner = _build_tool_runner(spec, stage, inv)

    provider = get_provider(stage.provider)
    base_messages = [ModelMessage(role="user", content=user)]
    # Only a declared chain attributes its ledger entries; a flat capability
    # writes the same ledger doc it always has.
    ledger_stage = stage.id if spec.stages else None

    attempt = {"n": 0}

    def _trace_record(extra: list[ModelMessage], **fields) -> None:
        attempt["n"] += 1
        inv.trace.append({
            "stage": stage.id,
            "iteration": _trace_iteration_label(inv.iteration),
            "attempt": attempt["n"],
            "model": stage.model,
            "prompt": {
                "system": system,
                "user": user,
                "followUps": [m.content for m in extra] or None,
            },
            **fields,
        })

    def _call(extra: list[ModelMessage], outcome_on_success: str, outcome_on_violation: str):
        start = time.monotonic()
        try:
            model_result = provider.generate(
                system=system,
                messages=base_messages + extra,
                model=stage.model,
                params=stage.params,
                json_schema=json_schema,
                tools=tools or None,
                tool_runner=tool_runner,
            )
        except GatewayError as exc:
            latency_ms = int((time.monotonic() - start) * 1000)
            usage_ledger.record_usage(
                inv.db, inv, provider=stage.provider, model=stage.model, usage={}, latency_ms=latency_ms, outcome="failed", stage=ledger_stage
            )
            _trace_record(extra, error=f"{exc.code}: {exc.message}", latencyMs=latency_ms)
            raise
        except Exception as exc:
            latency_ms = int((time.monotonic() - start) * 1000)
            usage_ledger.record_usage(
                inv.db, inv, provider=stage.provider, model=stage.model, usage={}, latency_ms=latency_ms, outcome="failed", stage=ledger_stage
            )
            _trace_record(extra, error=str(exc), latencyMs=latency_ms)
            raise GatewayError("provider_error", str(exc)) from exc

        latency_ms = int((time.monotonic() - start) * 1000)
        result_dict = model_result.structured if json_schema is not None else {"text": model_result.text}
        violations = _validate(stage, result_dict, inv)
        outcome = outcome_on_violation if violations else outcome_on_success
        usage_map = usage_ledger.record_usage(
            inv.db, inv, provider=stage.provider, model=stage.model, usage=model_result.usage, latency_ms=latency_ms, outcome=outcome, stage=ledger_stage
        )
        _trace_record(
            extra,
            thoughts=model_result.thoughts,
            output=result_dict,
            violations=violations or None,
            usage=model_result.usage,
            latencyMs=latency_ms,
        )
        return result_dict, violations, usage_map

    enforced = _validators_enforced(spec)
    result_dict, violations, usage_map = _call([], "complete", "validation_retry" if enforced else "complete")
    if violations and not enforced:
        log.warning(
            "validators relaxed: capability=%s stage=%s job=%s violations=%s", spec.id, stage.id, inv.job_id, violations
        )
        return result_dict, usage_map
    if violations:
        log.info(
            "capability=%s stage=%s job=%s validation_retry violations=%s", spec.id, stage.id, inv.job_id, violations
        )
        # Replay the rejected output alongside the violations. Without it the model regenerates
        # from scratch and cannot act on positional feedback ("focusAreas[2] duplicates
        # focusAreas[1]") because its second attempt renumbers everything — observed failing
        # twice in a row on live kick_analysis runs, 2026-08-04. Sent as a user turn rather than
        # an assistant turn so it survives providers that reserve assistant slots for tool loops.
        try:
            rejected = json.dumps(result_dict, indent=2, sort_keys=True, default=str)
        except (TypeError, ValueError):
            rejected = str(result_dict)
        retry_note = ModelMessage(
            role="user",
            content=(
                "Your previous output violated the constraints listed below and must be "
                "corrected.\n\nYOUR PREVIOUS OUTPUT:\n" + rejected
                + "\n\nVIOLATIONS:\n- " + "\n- ".join(violations)
                + "\n\nReturn a corrected version that keeps everything valid from the previous "
                "output and fixes ONLY what the violations name. Satisfy ALL of them."
            ),
        )
        result_dict, violations, usage_map = _call([retry_note], "complete", "failed")
        if violations:
            # Last resort before failing the job: drop the violating items and ship
            # the ones that passed. Better an analysis missing one card than a spinner
            # ending in "didn't pass our checks" — but only when the salvaged
            # remainder re-validates clean; anything less re-opens v1's door.
            salvaged = _attempt_salvage(stage, result_dict, violations, inv)
            if salvaged is None:
                where = f" in stage '{stage.id}'" if spec.stages else ""
                raise GatewayError(
                    "validation_failed", f"Output{where} failed validation after one retry: " + "; ".join(violations)
                )
            result_dict, dropped = salvaged
            inv.salvage[stage.id] = dropped
            if inv.trace:
                # The record keeps the model's raw (violating) output; this
                # marks what salvage dropped to reach the accepted result.
                inv.trace[-1]["salvageDropped"] = dropped
            log.warning(
                "capability=%s stage=%s job=%s validation salvage: dropped %d item(s): %s",
                spec.id, stage.id, inv.job_id, len(dropped), dropped,
            )

    return result_dict, usage_map


def _attempt_salvage(stage: StageSpec, result_dict: dict, violations: list[str],
                     inv: Invocation):
    """Returns `(salvaged_result, dropped_descriptions)` from the first of the
    stage's validators that has a registered salvager and certifies a clean
    remainder, else None (the job fails as before). `dropped_descriptions` may be
    empty when only tolerated result-level rules fired."""
    from gateway.validators import SALVAGERS

    for name in stage.validators:
        salvager = SALVAGERS.get(name)
        if salvager is None:
            continue
        salvaged = salvager(result_dict, violations, inv)
        if salvaged is not None:
            return salvaged
    return None


# --------------------------------------------------------------------------
# Iterated stages (PLAN_GENERATION_V2_PLAN Part 1)
# --------------------------------------------------------------------------

# Backstop far above any real horizon (a 12-week plan is 11 fill calls) — a
# runaway iteration source is a code bug, and this converts it from an infinite
# job into an internal error.
_MAX_STAGE_ITERATIONS = 16


def _plan_week_digest(week: dict) -> dict:
    """The compact prior-week summary week N's fill call renders: drill ids +
    doses + domains, not the full rows (cues/notes are copy, not context)."""
    return {
        "weekNumber": week.get("weekNumber"),
        "drills": [
            {
                "drillId": d.get("drillId"),
                "name": d.get("name"),
                "domain": d.get("domain"),
                "sets": d.get("sets"),
                "reps": d.get("reps"),
                "repUnit": d.get("repUnit"),
                "frequencyPerWeek": d.get("frequencyPerWeek"),
                "intensityIntent": d.get("intensityIntent"),
                "estimatedMinutes": d.get("estimatedMinutes"),
            }
            for d in week.get("drills") or []
            if isinstance(d, dict)
        ],
    }


def _plan_horizon_weeks(inv: Invocation) -> int:
    intake = (inv.context.get("planIntake") or {}).get("intake") or {}
    horizon = intake.get("horizonWeeks")
    return horizon if isinstance(horizon, int) and horizon >= 2 else 6


def _usable_allocation_weeks(allocation: dict, horizon: int) -> list[dict]:
    """The allocation rows the fill stage and finalizer actually use: in-range
    (1..horizon-1, because week `horizon` is the code-stamped retest week),
    sorted, first-row-wins on duplicates. The allocate validator demands
    exactly 1..horizon-1, but this capability runs with relaxed validation
    (no `strict_validation`, `VALIDATORS_ENFORCED` unset pre-launch), so an
    accepted allocation may be misnumbered — reviewed live 2026-08-09: weeks
    numbered 1..h drove an extra fill call and a retest week colliding with a
    training week, and a numbering gap crashed the job with an internal error
    mid-chain. Deriving the iteration list here keeps both the fill loop and
    the composed plan on the invariant regardless of what shipped."""
    rows = [
        w for w in allocation.get("weeks") or []
        if isinstance(w, dict) and isinstance(w.get("weekNumber"), int)
        and 1 <= w["weekNumber"] <= horizon - 1
    ]
    rows.sort(key=lambda w: w["weekNumber"])
    usable: list[dict] = []
    seen: set[int] = set()
    for row in rows:
        if row["weekNumber"] in seen:
            continue
        seen.add(row["weekNumber"])
        usable.append(row)
    return usable


def _plan_fill_next_week(inv: Invocation, prior_outputs: list[dict]) -> Optional[dict]:
    """Iteration source for `generate_training_plan`'s fill stage: one iteration
    per usable allocation week, in order, each carrying that week's allocation
    row and a digest of the weeks already filled — the sequential
    build-on-what-came-before contract (plan decision 4). The week number is
    the iteration's, taken from the allocation row — never re-derived from
    model output."""
    allocation = inv.stage_outputs.get("allocate") or {}
    horizon = _plan_horizon_weeks(inv)
    usable = _usable_allocation_weeks(allocation, horizon)
    if not prior_outputs:
        raw_count = len([w for w in allocation.get("weeks") or [] if isinstance(w, dict)])
        if raw_count != len(usable):
            inv.log.warning(
                "plan fill: allocation shipped %d week rows but only %d are usable for "
                "horizon %d (relaxed validation) — filling the usable ones (job=%s)",
                raw_count, len(usable), horizon, inv.job_id,
            )
    if len(prior_outputs) >= len(usable):
        return None
    row = usable[len(prior_outputs)]
    return {
        "fillWeek": {
            "weekNumber": row["weekNumber"],
            "allocation": row,
            "priorWeeks": [_plan_week_digest(w) for w in prior_outputs],
        }
    }


# `StageSpec.iterate` key -> (next_fragment_fn, result_key). The fn is called
# with (inv, accepted_outputs_so_far) and returns the next iteration's render
# fragment or None when done; the stage output is {result_key: [outputs...]}.
_ITERATION_SOURCES: dict[str, tuple[Callable[[Invocation, list[dict]], Optional[dict]], str]] = {
    "plan_fill_weeks": (_plan_fill_next_week, "weeks"),
}


def _run_iterated_stage(spec: CapabilitySpec, stage: StageSpec, inv: Invocation,
                        context: dict) -> tuple[dict, list[dict]]:
    """Runs an iterated stage: the full render -> generate -> validate ->
    retry-once cycle once per iteration fragment. The hard requirement from the
    plan: **validation and retry are local to the iteration** — iteration N
    failing retries iteration N alone, with everything already accepted left
    untouched. Returns the wrapped output list plus one usage map per accepted
    iteration."""
    entry = _ITERATION_SOURCES.get(stage.iterate or "")
    if entry is None:
        raise GatewayError("internal", f"No iteration source registered for '{stage.iterate}'")
    next_fragment, result_key = entry

    outputs: list[dict] = []
    usage_maps: list[dict] = []
    while True:
        if len(outputs) >= _MAX_STAGE_ITERATIONS:
            raise GatewayError(
                "internal", f"Stage '{stage.id}' exceeded {_MAX_STAGE_ITERATIONS} iterations"
            )
        fragment = next_fragment(inv, outputs)
        if fragment is None:
            break
        # Mirrored for validators (they receive only `(result, inv)` and need
        # to know which iteration they are judging); merged into the render
        # context for the model.
        inv.iteration = fragment
        try:
            result_dict, usage_map = _run_stage(spec, stage, inv, {**context, **fragment})
        finally:
            inv.iteration = {}
        outputs.append(result_dict)
        usage_maps.append(usage_map)

    if not outputs:
        raise GatewayError("internal", f"Iterated stage '{stage.id}' produced no iterations")
    return {result_key: outputs}, usage_maps


def _aggregate_usage(usage_maps: list[dict]) -> dict:
    """The job doc's `usage` across a chain: the last stage's map (provider,
    model, outcome — the call the result came from) with the token counts and
    latency summed over every stage's accepted call. One stage in, that same
    map back out.
    """
    total = dict(usage_maps[-1])
    if len(usage_maps) > 1:
        for key in ("inputTokens", "outputTokens", "cachedInputTokens", "latencyMs"):
            total[key] = sum(int(m.get(key, 0) or 0) for m in usage_maps)
    # `stage` is ledger-only attribution: an aggregate belongs to no single
    # stage, and the job doc's `usage` keeps exactly its contract §6 shape.
    total.pop("stage", None)
    return total


def _ensure_report_disclaimer(result_dict: dict) -> None:
    """Contract §9: `disclaimers` must carry the provisional-benchmark note
    while W3's real benchmark data is unpublished (true for all of v1) or
    `isDefaulted`. The gateway appends it rather than trusting the model to
    remember it on every generation.
    """
    disclaimers = result_dict.get("disclaimers")
    if not isinstance(disclaimers, list):
        disclaimers = []
    if _PROVISIONAL_BENCHMARK_DISCLAIMER not in disclaimers:
        disclaimers = disclaimers + [_PROVISIONAL_BENCHMARK_DISCLAIMER]
    result_dict["disclaimers"] = disclaimers


def _kick_region_joint_ids(region: Any, cited_rows: list[dict], body_parts: dict) -> list:
    """Highlight joints derived from the focus area's bodyRegion through the deterministic
    body-part dictionary — never from metric-citation order, which could highlight one leg
    under a cue about the other (KICK_ANALYSIS_V2_PLAN Part 1.4)."""

    def part(name: str) -> list:
        return list((body_parts.get(name) or {}).get("jointIds") or [])

    if region == "kickingLeg":
        return part("kickingLeg")[:3]                      # hip, knee, ankle
    if region == "supportLeg":
        return part("supportLeg")[:3]
    if region == "footPosition":
        return part("kickingLeg")[2:5]                     # ankle, heel, foot tip
    if region == "hips":
        return part("hips")
    if region == "trunk":
        return part("trunk")
    if region == "balance":
        return part("supportLeg")[2:3] + part("hips")      # plant ankle + both hips
    if region == "arms":
        sides = {row.get("side") for row in cited_rows if row.get("side") in ("lead", "trail")}
        return part("trailArm") if sides == {"trail"} else part("leadArm")
    return []


def _kick_evidence_line(cited_rows: list[dict], frame_key: Any = None) -> Optional[str]:
    """One deterministic readout for the walkthrough panel — server-built so the number the
    athlete sees can never disagree with the table. Rows from the card's OWN frame win: the
    walkthrough is paused on that frame, so quoting another frame's number under it invites
    exactly the mismatch this feature exists to eliminate.
    """
    ordered = ([r for r in cited_rows if r.get("frameKey") == frame_key]
               + [r for r in cited_rows if r.get("frameKey") != frame_key]) if frame_key else cited_rows
    for row in ordered:
        if row.get("valid") is not True:
            continue
        athlete, pro = row.get("athlete"), row.get("pro")
        if athlete is None:
            continue
        if row.get("kind") == "event":
            labels = {"maxKneeFlexion": "Deepest knee bend", "peakThighAngularVel": "Peak thigh motion",
                      "peakShankAngularVel": "Peak lower-leg motion", "kickFootSpeedJustBeforeContact": "Foot speed before contact"}
            label = labels.get(row.get("metric"), str(row.get("metric")))
            unit = {"degrees": "°", "milliseconds": " ms relative to contact",
                    "degrees/second": "°/s", "athlete heights/second": " body heights/s"}.get(row.get("units"), " " + str(row.get("units", "")))
            if row.get("units") == "milliseconds":
                label += " timing"
            reference = f", reference {pro:.1f}{unit}" if pro is not None else ", reference unavailable"
            return f"{label}: you {athlete:.1f}{unit}{reference}"
        a_m, p_m = row.get("athleteMeters"), row.get("proMeters")
        label = str(row.get("metric", "")) + (f" ({row['side']})" if row.get("side") else "")
        frame = row.get("frameKey", "")
        if row.get("units") == "degrees":
            pro_s = f"{pro:.0f}°" if pro is not None else "n/a"
            return f"{label} at {frame}: you {athlete:.0f}°, pro {pro_s}"
        if a_m is not None and p_m is not None:
            return f"{label} at {frame}: you {a_m * 100:.0f} cm, pro {p_m * 100:.0f} cm"
        pro_s = f"{pro:.2f}" if pro is not None else "n/a"
        return f"{label} at {frame}: you {athlete:.2f}, pro {pro_s}"
    return None


def _finalize_kick_analysis(inv: Invocation, focus_result: dict) -> dict:
    """Builds `KickAnalysisV2` (contract §9b) from the deterministic table plus
    both stage outputs — the model never re-emits the table — and persists it to
    `players/{playerId}/aiAnalyses/{repId}`: the one deliberate Firestore write
    outside main.py's job bookkeeping, mirroring how chat persists transcripts.
    Current doc id = repId. Re-running replaces that projection while each job
    retains an immutable source/result in aiAnalysisRuns, published atomically.
    """
    # Deferred like usage.py's client import so tests' sys.modules stub applies.
    from google.cloud import firestore

    context = inv.context.get("kickAnalysisContext") or {}
    observations = (inv.stage_outputs.get("observe") or {}).get("observations") or []
    obs_by_id = {o.get("id"): o for o in observations if isinstance(o, dict)}
    from gateway.kick_evidence import evidence_rows
    metric_rows = {row.get("id"): row for row in evidence_rows(context) if isinstance(row, dict)}
    body_parts = context.get("bodyParts") or {}

    focus_areas: list[dict] = []
    for item in focus_result.get("focusAreas") or []:
        augmented = dict(item)
        observation = obs_by_id.get(item.get("observationId")) or {}
        region = observation.get("bodyRegion")
        augmented["bodyRegion"] = region
        citations = list(dict.fromkeys((item.get("metricIds") or []) + (item.get("evidenceIds") or [])))
        augmented["evidenceIds"] = citations
        cited_rows = [metric_rows.get(mid) or {} for mid in citations]
        joint_ids = _kick_region_joint_ids(region, cited_rows, body_parts) if body_parts else []
        if not joint_ids:
            # v1 fallback (no bodyParts in context, or an unknown region): union of the cited
            # metrics' joints in citation order, capped at 3.
            for row in cited_rows:
                for joint in row.get("jointIds") or []:
                    if joint not in joint_ids:
                        joint_ids.append(joint)
            joint_ids = joint_ids[:3]
        augmented["jointIds"] = joint_ids
        augmented["evidence"] = _kick_evidence_line(cited_rows, item.get("frameKey"))
        focus_areas.append(augmented)

    rep_id = context.get("repId") or inv.params.get("repId")
    payload = {
        "schemaVersion": 2,
        "capability": "kick_analysis",
        "repId": rep_id,
        "playerId": inv.player_id,
        "jobId": inv.job_id,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "keyFrames": context.get("keyFrames"),
        "fps": context.get("fps"),
        "mirrored": context.get("mirrored"),
        "orientation": context.get("orientation"),
        "bodyParts": context.get("bodyParts"),
        "jointNames": context.get("jointNames"),
        "scale": context.get("scale"),
        "metrics": context.get("metrics"),
        "comTrajectory": context.get("comTrajectory"),
        "jointAngleSequencing": context.get("jointAngleSequencing"),
        "observations": observations,
        "focusAreas": focus_areas,
        "dataQuality": context.get("dataQuality"),
        "evidence": context.get("evidence"),
        "assessmentCoverage": context.get("assessmentCoverage"),
    }
    if inv.salvage:
        # Provenance for cards the athlete did NOT see: their model output failed the
        # deterministic checks even after the retry, so they were dropped rather than
        # shown. Everything above passed the same checks the all-or-nothing path used.
        payload["validation"] = {"salvagedStages": dict(inv.salvage)}

    from gateway.kick_comparison import persist_analysis
    return persist_analysis(inv, payload, "aiAnalyses", rep_id)


_PLAN_STANDARD_DISCLAIMERS = [
    "Benchmarks are provisional and not yet sourced from first-party D1 data.",
    "Drill content is evidence-informed but has not completed expert content review.",
]


def _finalize_training_plan(inv: Invocation, fill_result: dict) -> dict:
    """Composes the durable `trainingPlans` doc (TRAINING_PLAN_DATA_MODEL_PLAN.md
    Part 1, v2 shape per PLAN_GENERATION_V2_PLAN Part 2) from the fill stage's
    accepted weeks + the allocate strategy + the assess stage + the intake echo,
    supersedes any currently-active plan (exactly one active, by construction —
    umbrella decision 7), and persists it. Doc id is a fresh auto-id; `jobId`
    carries provenance.

    Server-computed integrity (plan decisions 2 and 6 — never model-emitted):
    - each drill row's `weeklyMinutes` = estimatedMinutes x frequencyPerWeek;
    - each week's `targets` = per-domain frequencyPerWeek sums, matching how
      `weekProgress` counts exposures (one per non-skipped block);
    - week numbering comes from the iteration's allocation row, positionally —
      a fill output's own `weekNumber` is never trusted (under relaxed
      validation a mis-numbered emission would otherwise vanish a week and
      duplicate another);
    - week `horizonWeeks` is the stamped retest week: all six measured drills,
      no prescribed training work.
    """
    from google.cloud import firestore
    from gateway.assemblers import MEASURED_DRILL_ID_DOMAINS
    from gateway.schemas.training_plan_v1 import MEASURED_DRILLS

    assess = inv.stage_outputs.get("assess") or {}
    allocation = inv.stage_outputs.get("allocate") or {}
    plan_intake = inv.context.get("planIntake") or {}
    knowledge_ctx = inv.context.get("planKnowledge") or {}
    horizon = _plan_horizon_weeks(inv)

    tz = timezone.utc
    tz_name = inv.params.get("timezone")
    if isinstance(tz_name, str) and tz_name:
        try:
            from zoneinfo import ZoneInfo
            tz = ZoneInfo(tz_name)
        except Exception:
            tz = timezone.utc
    start_date = datetime.now(tz).strftime("%Y-%m-%d")

    # The same usable-row list the fill iterations ran against: fill output i
    # IS the fill of usable row i, so zip is the authoritative pairing.
    usable_rows = _usable_allocation_weeks(allocation, horizon)
    fill_weeks = [w for w in (fill_result or {}).get("weeks") or [] if isinstance(w, dict)]

    weeks: list[dict] = []
    for alloc, fill_week in zip(usable_rows, fill_weeks):
        drills: list[dict] = []
        exposures_by_domain: dict[str, int] = {}
        for drill in fill_week.get("drills") or []:
            if not isinstance(drill, dict):
                continue
            freq = max(int(drill.get("frequencyPerWeek") or 1), 1)
            minutes = int(drill.get("estimatedMinutes") or 0)
            drills.append({**drill, "weeklyMinutes": minutes * freq})
            domain = drill.get("domain")
            if isinstance(domain, str):
                exposures_by_domain[domain] = exposures_by_domain.get(domain, 0) + freq

        targets = [
            {"domain": domain, "exposures": exposures}
            for domain, exposures in sorted(exposures_by_domain.items(),
                                            key=lambda kv: (-kv[1], kv[0]))
        ]
        weeks.append({
            "weekNumber": alloc["weekNumber"],
            "theme": alloc.get("theme"),
            "focus": fill_week.get("focus"),
            "progressionNote": fill_week.get("progressionNote"),
            "intensityNote": alloc.get("intensityNote"),
            "allocations": alloc.get("allocations") or [],
            "targets": targets,
            "drills": drills,
        })

    # The stamped retest week (decision 6): every measured drill, retest-only.
    weeks.append({
        "weekNumber": horizon,
        "theme": "Retest week",
        "focus": "Re-measure every tracked drill to lock in this block's gains.",
        "progressionNote": "Compare each retest against your week-1 baseline in the app.",
        "intensityNote": "Low volume, high quality — arrive fresh for each test.",
        "allocations": [],
        "targets": [
            {"domain": MEASURED_DRILL_ID_DOMAINS[drill_id], "exposures": 1}
            for drill_id in MEASURED_DRILLS
        ],
        "drills": [],
    })
    retest = {
        "weekNumber": horizon,
        "drills": list(MEASURED_DRILLS),
        "note": ("Repeat every baseline test with the same setup and distances as your "
                 "first recordings, spread across the week. No new training work — "
                 "light movement between test days."),
    }

    plans = inv.db.collection("players").document(inv.player_id).collection("trainingPlans")
    for snap in plans.where("status", "==", "active").stream():
        data = snap.to_dict() or {}
        data["status"] = "superseded"
        plans.document(snap.id).set(data)

    doc_ref = plans.document()
    payload = {
        "schemaVersion": 1,
        "planId": doc_ref.id,
        "playerId": inv.player_id,
        "jobId": inv.job_id,
        "catalogVersion": knowledge_ctx.get("catalogVersion"),
        "status": "active",
        "startDate": start_date,
        "horizonWeeks": horizon,
        "intake": plan_intake.get("intake"),
        "assessment": {
            "summary": assess.get("summary"),
            "findings": assess.get("findings"),
            "dataGaps": assess.get("dataGaps"),
        },
        "focusAreas": assess.get("focusAreas"),
        "planSummary": allocation.get("planSummary"),
        "allocationSummary": [
            {"weekNumber": w["weekNumber"], "allocations": w.get("allocations") or []}
            for w in usable_rows
        ],
        "weeks": weeks,
        "retest": retest,
        "disclaimers": list(_PLAN_STANDARD_DISCLAIMERS),
    }
    doc_ref.set({**payload, "generatedAt": firestore.SERVER_TIMESTAMP})
    return payload


def _finalize_build_workout(inv: Invocation, workout_result: dict) -> dict:
    """Builds the durable `plannedWorkouts` doc (TRAINING_PLAN_DATA_MODEL_PLAN.md
    Part 1) from the model's output plus the `activePlanWeek` assembler's
    resolved plan/week/params — the model never emits `workoutId`, `playerId`,
    `planId`, `weekNumber`, `jobId`, `catalogVersion`, or `params` itself.
    Disposable by design (WORKOUT_BUILDER_AGENT_PLAN Part 0.6): a fresh
    auto-id every time, no supersede machinery."""
    from google.cloud import firestore
    from gateway.validators import assert_unique_workout_drills

    assert_unique_workout_drills(workout_result)

    plan_week = inv.context.get("activePlanWeek") or {}

    workouts = inv.db.collection("players").document(inv.player_id).collection("plannedWorkouts")
    doc_ref = workouts.document()

    payload = {
        "schemaVersion": 1,
        "workoutId": doc_ref.id,
        "playerId": inv.player_id,
        "planId": plan_week.get("planId"),
        "weekNumber": plan_week.get("weekNumber"),
        "jobId": inv.job_id,
        "catalogVersion": plan_week.get("catalogVersion"),
        "params": {
            "timeAvailableMinutes": plan_week.get("timeAvailableMinutes"),
            "energy": plan_week.get("energy"),
            "focusDomains": plan_week.get("focusDomains") or [],
            "equipmentOverride": plan_week.get("equipmentToday"),
        },
        "estimatedMinutes": workout_result.get("estimatedMinutes"),
        "intro": workout_result.get("intro"),
        "blocks": workout_result.get("blocks"),
        "stopRule": workout_result.get("stopRule"),
    }
    doc_ref.set({**payload, "generatedAt": firestore.SERVER_TIMESTAMP})
    return payload


# Capability-id-keyed hooks run after the stage loop to reshape the final
# stage's output into the job result (and perform any capability-owned
# persistence). Sits alongside the `_ensure_report_disclaimer` special case —
# most capabilities' results ARE their final stage's output and register
# nothing here.
from gateway.kick_comparison import finalize_comparison

_FINALIZERS: dict[str, Callable[[Invocation, dict], dict]] = {
    "kick_analysis": _finalize_kick_analysis,
    "kick_foot_comparison": finalize_comparison,
    "generate_training_plan": _finalize_training_plan,
    "build_workout": _finalize_build_workout,
}


# --------------------------------------------------------------------------
# Transport A — job capabilities
# --------------------------------------------------------------------------


def run_job_capability(inv: Invocation) -> tuple[dict, dict]:
    """Runs a `transport: "job"` capability end to end and returns `(result,
    usage)`. The caller (main.py's Eventarc handler) writes both onto the job
    doc — it, not this function, decides inline-vs-Storage for `result`
    (contract §2), which is a transport concern, not a pipeline one.

    The result is the *final* stage's output; earlier stages exist to feed it.
    """
    spec, _cfg = _authorize_and_configure(inv)
    if spec.transport != "job":
        raise GatewayError("invalid_request", f"'{inv.capability}' is not a job capability")

    from gateway.personalized_plans import GENERATE,ACTIVATE,DISCARD,ASSESS,generate_draft,activate_draft,discard_draft,assess_priorities
    if inv.capability == ASSESS:
        return assess_priorities(inv)
    if inv.capability == GENERATE:
        return generate_draft(inv)
    if inv.capability in (ACTIVATE,DISCARD):
        from gateway.usage import aggregate_usage
        result=(activate_draft if inv.capability==ACTIVATE else discard_draft)(inv)
        row=usage_ledger.record_code_usage(inv.db,inv,operation_id=inv.capability+':'+inv.params['draftId'])
        return result,aggregate_usage([row])
    if inv.capability == "generate_training_plan":
        from gateway.program_generator import run_program
        return run_program(inv)
    if inv.capability == 'save_workout_edit':
        from gateway.manual_workout import save_workout_edit
        from gateway.usage import aggregate_usage
        result = save_workout_edit(inv)
        row = usage_ledger.record_code_usage(inv.db, inv, operation_id='manual:' + str(inv.job_id))
        return result, aggregate_usage([row])
    if inv.capability == 'validate_workout_start':
        from gateway.manual_workout import validate_workout_start
        from gateway.usage import aggregate_usage
        result = validate_workout_start(inv)
        row = usage_ledger.record_code_usage(inv.db, inv, operation_id='start-check:' + str(inv.job_id))
        return result, aggregate_usage([row])
    if inv.capability == "apply_workout_draft":
        from gateway.workout_persistence import apply_workout_draft
        from gateway.usage import aggregate_usage
        result = apply_workout_draft(inv)
        row = usage_ledger.record_code_usage(inv.db, inv, operation_id=inv._usage_invocation_id)
        return result, aggregate_usage([row])

    _assemble(spec, inv)
    _retrieve(spec, inv)

    if inv._daily_allowance_required:
        gw_config.reserve_daily_allowance(inv)

    stages = spec.stage_list()
    stage_outputs: dict[str, dict] = {}
    usage_maps: list[dict] = []
    result_dict: dict = {}

    for stage in stages:
        context = _stage_render_context(stage, inv, stage_outputs)
        if stage.iterate:
            result_dict, stage_usage_maps = _run_iterated_stage(spec, stage, inv, context)
            usage_maps.extend(stage_usage_maps)
        else:
            result_dict, usage_map = _run_stage(spec, stage, inv, context)
            usage_maps.append(usage_map)
        stage_outputs[stage.id] = result_dict
        # Mirrored onto the Invocation so validators/finalizers of later stages
        # can read accepted earlier outputs (they only receive `(result, inv)`).
        inv.stage_outputs[stage.id] = result_dict

    if stages[-1].output == "report_v1":
        _ensure_report_disclaimer(result_dict)

    finalizer = _FINALIZERS.get(spec.id)
    if finalizer is not None:
        result_dict = finalizer(inv, result_dict)

    return result_dict, _aggregate_usage(usage_maps)


# --------------------------------------------------------------------------
# Transport B — stream capabilities
# --------------------------------------------------------------------------


def _resolve_conversation(inv: Invocation):
    """Returns `(conv_ref, conv_id, is_new)`. An explicit `conversationId`
    that doesn't exist yet is treated as "start this conversation with this
    id" rather than an error — the client mints ids optimistically in some
    flows (contract §3: "conversationId is authoritative" refers to what the
    *server* returns, not that the client can never suggest one).
    """
    conv_id = inv.params.get("conversationId") or inv.conversation_id
    players_ref = inv.player_ref()
    conversations = players_ref.collection("aiConversations")
    if conv_id:
        conv_ref = conversations.document(conv_id)
        snap = conv_ref.get()
        if snap.exists:
            data = snap.to_dict() or {}
            if data.get("coachWorkspaceVersion") == 1 or data.get("capability") == "workout_chat":
                if data.get("createdByUid") != inv.uid:
                    raise GatewayError("permission_denied", "The conversation belongs to another creator")
                if data.get("capability") != inv.capability:
                    raise GatewayError("invalid_request", "A conversation cannot switch capabilities")
                if (data.get("coachWorkspaceVersion") == 1
                        and (inv.params.get("context") or {}).get("coachWorkspaceVersion") != 1):
                    raise GatewayError("invalid_request", "This conversation requires the coach workspace version")
        return conv_ref, conv_id, not snap.exists
    conv_ref = conversations.document()
    return conv_ref, conv_ref.id, True


def _load_history(conv_ref) -> list[dict]:
    return [d.to_dict() for d in conv_ref.collection("messages").order_by("createdAt").stream()]


def _history_to_messages(history: list[dict]) -> list[ModelMessage]:
    out = []
    for m in history:
        role, content = m.get("role"), m.get("content")
        if role in ("user", "assistant") and content:
            out.append(ModelMessage(role=role, content=content))
    return out


def _title_from_message(message: str) -> str:
    stripped = message.strip()
    if not stripped:
        return "New conversation"
    return stripped.splitlines()[0][:80]


def run_stream_capability(inv: Invocation) -> Iterator[dict]:
    """Runs a `transport: "stream"` capability. Yields the same event dicts as
    `Provider.stream` (`delta`/`tool`/`usage`), plus `start` first and `done`
    last, plus one internal `{"type": "persisted", ...}` event right before
    `done` that is NOT part of the wire contract — the HTTP layer (main.py)
    must not forward it as an SSE frame; it exists so a test or log can
    confirm the transcript write happened without inspecting Firestore.

    Persists the user turn before generating and the assistant turn before
    `done` (contract §3) — Firestore, not the stream, is the transcript's
    source of truth, so a client that loses the connection mid-response loses
    nothing by re-reading the conversation.
    """
    if (inv.capability == "pose_chat" and isinstance(inv.params.get("context"), dict)
            and "coachWorkspaceVersion" in inv.params["context"]):
        from gateway.coach_chat import run_coach_chat
        yield from run_coach_chat(inv)
        return

    spec, _cfg = _authorize_and_configure(inv)
    if spec.transport != "stream":
        raise GatewayError("invalid_request", f"'{inv.capability}' is not a stream capability")

    if inv.capability == "workout_chat":
        from gateway.workout_chat import run_workout_chat
        yield from run_workout_chat(inv, spec)
        return

    # Streaming is single-stage by construction (the registry refuses a stream
    # capability with more than one), but it resolves its prompt/model/tools
    # through the same accessor as the job path so there's one place that maps
    # a spec to what a model call needs.
    stage = spec.stage_list()[0]

    user_message = inv.params.get("message")
    if not user_message or not isinstance(user_message, str):
        raise GatewayError("invalid_request", "'message' is required")

    from google.cloud import firestore as fs

    conv_ref, conv_id, is_new = _resolve_conversation(inv)
    inv.conversation_id = conv_id

    _assemble(spec, inv)
    history = _load_history(conv_ref)

    conv_ref.collection("messages").document().set(
        {"role": "user", "content": user_message, "createdAt": fs.SERVER_TIMESTAMP}
    )

    # The prompt renderer returns (system, user) where the user half carries the
    # assembled athlete context as JSON. On the job path that user prompt IS the
    # turn; here the turn is the athlete's own message, so the context half is
    # folded into the system prompt instead — dropping it (as this path once
    # did) sends the model into the conversation knowing nothing about the
    # athlete. History is deliberately NOT part of the rendered context: it
    # rides as real conversation messages below, and duplicating it inside the
    # system prompt would double its token cost every turn.
    system, context_prompt = _render_prompt(stage, inv.context)
    system = f"{system}\n\n{context_prompt}"
    messages = _history_to_messages(history) + [ModelMessage(role="user", content=user_message)]

    tools = _tool_specs(stage)
    tool_runner = _build_tool_runner(spec, stage, inv)

    from gateway.providers.base import get_provider

    provider = get_provider(stage.provider)
    ledger_stage = stage.id if spec.stages else None

    message_id = conv_ref.collection("messages").document().id
    yield {"type": "start", "conversationId": conv_id, "messageId": message_id, "model": stage.model}

    start = time.monotonic()
    text_parts: list[str] = []
    tool_calls_summary: list[dict] = []
    final_usage: dict = {}

    try:
        for event in provider.stream(
            system=system, messages=messages, model=stage.model, params=stage.params, tools=tools or None, tool_runner=tool_runner
        ):
            etype = event.get("type")
            if etype == "delta":
                text = event.get("text", "")
                text_parts.append(text)
                yield {"type": "delta", "text": text}
            elif etype == "tool":
                if event.get("status") == "started":
                    tool_calls_summary.append({"name": event.get("name"), "argsSummary": event.get("argsSummary", "")})
                yield {"type": "tool", "name": event.get("name"), "status": event.get("status")}
            elif etype == "usage":
                final_usage = event.get("usage", {})
    except GatewayError as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        usage_ledger.record_usage(
            inv.db, inv, provider=stage.provider, model=stage.model, usage=final_usage, latency_ms=latency_ms, outcome="failed", stage=ledger_stage
        )
        yield {"type": "error", "code": exc.code, "message": exc.message}
        return
    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        usage_ledger.record_usage(
            inv.db, inv, provider=stage.provider, model=stage.model, usage=final_usage, latency_ms=latency_ms, outcome="failed", stage=ledger_stage
        )
        yield {"type": "error", "code": "provider_error", "message": str(exc)}
        return

    latency_ms = int((time.monotonic() - start) * 1000)
    assistant_text = "".join(text_parts)
    usage_map = usage_ledger.record_usage(
        inv.db, inv, provider=stage.provider, model=stage.model, usage=final_usage, latency_ms=latency_ms, outcome="complete", stage=ledger_stage
    )
    yield {
        "type": "usage",
        "inputTokens": usage_map["inputTokens"],
        "outputTokens": usage_map["outputTokens"],
        "cachedInputTokens": usage_map["cachedInputTokens"],
    }

    assistant_doc: dict[str, Any] = {
        "role": "assistant",
        "content": assistant_text,
        "createdAt": fs.SERVER_TIMESTAMP,
        "usage": usage_map,
    }
    if tool_calls_summary:
        assistant_doc["toolCalls"] = tool_calls_summary
    conv_ref.collection("messages").document(message_id).set(assistant_doc)

    conv_update: dict[str, Any] = {
        "lastMessageAt": fs.SERVER_TIMESTAMP,
        "messageCount": fs.Increment(2),  # this turn's user message + assistant message
    }
    if is_new:
        conv_update.update(
            {
                "capability": spec.id,
                "createdByUid": inv.uid,
                "createdAt": fs.SERVER_TIMESTAMP,
                "title": _title_from_message(user_message),
            }
        )
    conv_ref.set(conv_update, merge=True)

    yield {"type": "persisted", "conversationId": conv_id, "messageId": message_id}
    yield {"type": "done", "messageId": message_id, "finishReason": "stop"}
