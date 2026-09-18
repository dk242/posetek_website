"""Reusable v3 workout tools. Mutable drafts live only in one bound invocation.

Every mutation is copy/validate/commit: refusal preserves the draft exactly.
Firestore loaders are kept at tool entry points; the operations and checker
also run with a plain cached context and no database.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import re
import time

from gateway.catalog_v2 import (DOMAINS, safe_id, load_catalog, get_catalog_drill,
                                eligible_drill, catalog_minutes_range)
from gateway.errors import GatewayError, context_unavailable, invalid_request
from gateway.workout_history import drill_history, load_history_evidence
from gateway.workout_time import (integer, estimate_block, estimate_workout,
                                  resolved_catalog_dose, dose_violations, TIME_FIELDS)

MAX_TOOL_RESULT_BYTES = 32 * 1024
MAX_WORKOUT_BLOCKS = 12
HIGH_QUALITY_DOMAINS = frozenset({"speed", "plyometrics", "agility"})
DOSE_ARGS = frozenset({"sets", "reps", "restSeconds", "restScope", "restBetweenSetsSeconds", "familiarizationReps"})
BLOCK_FIELDS = TIME_FIELDS | {"blockId", "order", "kind", "drillId", "name", "domain", "estimatedMinutes", "whyIncluded"}
WORKOUT_FIELDS = frozenset({"workoutId", "order", "title", "intent", "focusDomains", "budgetMinutes", "estimatedMinutes", "blocks", "nextBlockSequence", "revision", "editedBy", "editedAt", "editorUid", "check"})
FORBIDDEN_RETEST_FIELDS = frozenset({"retest", "isRetest", "isMeasuredDrill", "measuredDrillType"})


def _json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=lambda x: x.isoformat() if hasattr(x, "isoformat") else str(x), allow_nan=False)


def _within_result_bound(value):
    if len(_json(value).encode("utf-8")) > MAX_TOOL_RESULT_BYTES:
        raise invalid_request("Tool result exceeds the 32 KiB JSON limit")
    return value


def _profile(inv):
    profile = inv.context.get("programProfile")
    if not isinstance(profile, dict):
        raise context_unavailable("The trusted programProfile must be assembled before workout tools")
    return profile


def _context(inv):
    context = inv.context.get("workoutContext")
    if not isinstance(context, dict) or "target" not in context:
        from gateway.workout_persistence import assemble_workout_context
        context = assemble_workout_context(inv)
        inv.context["workoutContext"] = context
    return context


def _allowed(args, fields):
    if not isinstance(args, dict) or set(args) - set(fields):
        raise invalid_request("Unknown or unsupported tool argument")


def _domains(value):
    if not isinstance(value, list) or not 1 <= len(value) <= 4 or any(d not in DOMAINS for d in value) or len(set(value)) != len(value):
        raise invalid_request("focusDomains must contain 1..4 distinct v2 domains")
    return value


def _text(value, name, limit, *, empty=False):
    if not isinstance(value, str) or (not empty and not value.strip()) or len(value) > limit:
        raise invalid_request(f"{name} must be text of {'0' if empty else '1'}..{limit} characters")
    return value


def _violation(code, message, block=None):
    row = {"code": code, "message": message}
    if block:
        row.update({key: block[key] for key in ("blockId", "drillId") if isinstance(block.get(key), str)})
    return row


def validate_workout(workout: dict, catalog: dict, profile: dict, frequency: dict | None = None,
                     plan: dict | None = None, target: dict | None = None, *, allow_partner=None, retained_drill_ids=None) -> dict:
    """Pure strict checker; unknown/malformed input never mutates or passes."""
    violations = []
    if not isinstance(workout, dict):
        workout = {}
        violations.append(_violation("workout_shape", "Workout must be an object"))
    if FORBIDDEN_RETEST_FIELDS & workout.keys():
        violations.append(_violation("no_retest", "V3 workouts cannot include retest or recording fields"))
    for name, limit in (("title", 80), ("intent", 400)):
        try:
            _text(workout.get(name), name, limit)
        except GatewayError as exc:
            violations.append(_violation("text", exc.message))
    focus = workout.get("focusDomains")
    try:
        _domains(focus)
    except GatewayError as exc:
        violations.append(_violation("focus", exc.message))
        focus = []
    budget = workout.get("budgetMinutes")
    try:
        integer(budget, "budgetMinutes", 1, 135)
        if (target or {}).get("kind") == "plan" and budget * 2 > (plan or {}).get("minutesPerSession", 0) * 3:
            raise invalid_request("Plan-target budget cannot exceed 1.5 times minutesPerSession")
    except GatewayError as exc:
        violations.append(_violation("budget", exc.message))
        budget = 0
    blocks = workout.get("blocks")
    if not isinstance(blocks, list) or not 1 <= len(blocks) <= MAX_WORKOUT_BLOCKS:
        violations.append(_violation("block_count", "Workout requires 1..12 blocks"))
        blocks = blocks if isinstance(blocks, list) else []
    ids, drills, domain_minutes, actual_minutes, seen_main, seen_cooldown = set(), set(), {}, 0, False, False
    ordering_ok, fatigue_seen = True, False
    max_sequence = 0
    for order, block in enumerate(blocks, 1):
        if not isinstance(block, dict):
            violations.append(_violation("block_shape", "Block must be an object"))
            continue
        allowed_fields = BLOCK_FIELDS
        if (plan or {}).get('assessment', {}).get('methodologyVersion') == 'evidence-objectives-v1':
            allowed_fields = BLOCK_FIELDS | {'trainingRationale'}
        if set(block) - allowed_fields:
            violations.append(_violation("block_fields", "Block contains unsupported fields, including any retest/recording fields", block))
        block_id = block.get("blockId")
        match = re.fullmatch(r"b([1-9][0-9]*)", block_id) if isinstance(block_id, str) else None
        if not match or block_id in ids:
            violations.append(_violation("block_id", "Block IDs must be unique bN identifiers", block))
        else:
            ids.add(block_id)
            max_sequence = max(max_sequence, int(match.group(1)))
        if type(block.get("order")) is not int or block["order"] != order:
            violations.append(_violation("order", "Block orders must be consecutive in array order", block))
        kind = block.get("kind")
        if kind not in ("warmup", "main", "cooldown"):
            violations.append(_violation("kind", "Block kind must be warmup, main or cooldown", block))
        if (kind == "warmup" and (seen_main or seen_cooldown)) or (kind == "main" and seen_cooldown):
            violations.append(_violation("ordering", "Warmup precedes main work and cooldown follows it", block))
        seen_main |= kind == "main"
        seen_cooldown |= kind == "cooldown"
        drill_id = block.get("drillId")
        row = catalog.get(drill_id) if isinstance(drill_id, str) else None
        if row is None:
            violations.append(_violation("unknown_drill", "Every block must reference a known executable catalog drill", block))
            continue
        if 'trainingRationale' in block:
            from gateway.personalized_objectives import valid_rationale
            if not valid_rationale(block['trainingRationale'], block, plan, catalog):
                violations.append(_violation('training_rationale', 'Exercise rationale must match the reviewed objective and current catalog teaching content.', block))
        if drill_id in drills:
            violations.append(_violation("duplicate_drill", "A workout cannot repeat a drill; change its dose or choose another drill", block))
        drills.add(drill_id)
        eligible, reasons = eligible_drill(row, profile, allow_partner=allow_partner)
        if not eligible:
            violations.extend(_violation(reason, f"Drill fails current eligibility: {reason}", block) for reason in reasons)
        if block.get("name") != row.get("name") or block.get("domain") != row.get("domain"):
            violations.append(_violation("catalog_identity", "Block name/domain must match the current catalog", block))
        for reason in dose_violations(block, row.get("dose", {})):
            violations.append(_violation("dose", reason, block))
        if not TIME_FIELDS.issubset(block):
            violations.append(_violation("time_inputs", "Block must store every formula input", block))
        try:
            calculated = estimate_block(block)["estimatedMinutes"]
            if type(block.get("estimatedMinutes")) is not int or block["estimatedMinutes"] != calculated:
                violations.append(_violation("block_minutes", "Block minutes do not match shared formula", block))
            actual_minutes += calculated
            domain_minutes[row["domain"]] = domain_minutes.get(row["domain"], 0) + calculated
        except GatewayError as exc:
            violations.append(_violation("time_inputs", exc.message, block))
        try:
            _text(block.get("whyIncluded"), "whyIncluded", 200)
        except GatewayError as exc:
            violations.append(_violation("text", exc.message, block))
        if kind == "main":
            if row["domain"] in HIGH_QUALITY_DOMAINS and fatigue_seen:
                ordering_ok = False
            if row["domain"] not in HIGH_QUALITY_DOMAINS:
                fatigue_seen = True
    sequence = workout.get("nextBlockSequence")
    if type(sequence) is not int or not max_sequence < sequence <= 1000000:
        violations.append(_violation("block_sequence", "nextBlockSequence must exceed every allocated surviving ID"))
    reserved = reserved_adjustment_drills(plan, target, frequency, retained_drill_ids=retained_drill_ids)
    for drill_id in sorted(drills):
        if drill_id in reserved:
            violations.append(_violation("scheduled_elsewhere", f"Drill '{drill_id}' is already scheduled or completed in another workout this week; choose a different drill", {"drillId": drill_id}))
        count = (frequency or {}).get(drill_id, 0)
        if type(count) is not int or count < 0 or count + 1 > catalog[drill_id]["maxFrequencyPerWeek"]:
            violations.append(_violation("frequency", f"Drill '{drill_id}' exceeds maxFrequencyPerWeek", {"drillId": drill_id}))
    transition = max(0, len(blocks) - 1)
    estimated = actual_minutes + transition
    if type(workout.get("estimatedMinutes")) is not int or workout["estimatedMinutes"] != estimated:
        violations.append(_violation("workout_minutes", "Workout minutes must equal block minutes plus transitions"))
    delta = estimated - budget
    tolerance = max(5, budget / 10)
    time_status = "ok" if abs(delta) <= tolerance else "under" if delta < 0 else "over"
    covered = [d for d in DOMAINS if domain_minutes.get(d, 0)]
    missing = [d for d in focus if d not in covered]
    extraneous = [d for d in covered if d not in focus]
    outside = sum(domain_minutes[d] for d in extraneous)
    intent_status = "fail" if missing or outside * 100 > actual_minutes * 40 else "warn" if not ordering_ok else "pass"
    return {"ok": not violations and time_status == "ok" and intent_status != "fail",
            "timeStatus": time_status, "deltaMinutes": delta, "intentStatus": intent_status,
            "intent": {"domainsCovered": covered, "missingDomains": missing, "extraneousDomains": extraneous, "orderingOk": ordering_ok},
            "violations": violations}


def reserved_adjustment_drills(plan, target, frequency, *, retained_drill_ids=None):
    """Existing core repetitions may stay; an adjustment cannot add another one.

    Frequency is the complete target-excluding server fold, including ready
    ad-hoc reservations and actual work in this week. Model-supplied exclusions
    cannot weaken it. Generation/new core selection retain their frequency rules.
    """
    target = target or {}
    if target.get("kind") not in ("plan", "adhoc"):
        return set()
    if retained_drill_ids is None:
        retained_drill_ids = {
            b.get("drillId") for week in (plan or {}).get("weeks", [])
            for workout in week.get("workouts", [])
            if target.get("kind") == "plan" and workout.get("workoutId") == target.get("workoutId")
            for b in workout.get("blocks", [])
        }
    return {did for did, count in (frequency or {}).items() if type(count) is int and count > 0} - set(retained_drill_ids)


def _retained_ids(context):
    current = context.get("workout")
    return {b.get("drillId") for b in current.get("blocks", [])} if isinstance(current, dict) else None


def _reserved_ids(context):
    return reserved_adjustment_drills(context.get("plan"), context.get("target"), context.get("frequency"),
                                      retained_drill_ids=_retained_ids(context))


def _check(inv, workout, *, include_request=True):
    context = _context(inv)
    check = validate_workout(workout, context.get("catalog", {}), _profile(inv), context.get("frequency", {}),
                            context.get("plan"), context.get("target"), allow_partner=context.get("allowPartner"),
                            retained_drill_ids=_retained_ids(context))
    from gateway.workout_requirements import with_requirements
    return with_requirements(check, workout, inv.context.get("workoutRequirements")) if include_request else check


def _draft(inv):
    draft = inv.context.get("workoutDraft")
    if not isinstance(draft, dict) or "workout" not in draft:
        raise invalid_request("Create a draft before editing it")
    if draft.get("target") != _context(inv).get("target"):
        raise invalid_request("The draft is not bound to this invocation's target")
    return draft


def _finish(inv, candidate, *, refuse_hard=True):
    workout = candidate["workout"]
    for order, block in enumerate(workout["blocks"], 1):
        block["order"] = order
        block["estimatedMinutes"] = estimate_block(block)["estimatedMinutes"]
    workout["estimatedMinutes"] = estimate_workout(workout["blocks"])["estimatedMinutes"]
    check = _check(inv, workout)
    # Empty drafts and temporary focus/budget mismatches are useful during an
    # edit. No hard safety/input violation is allowed to enter the draft.
    blocking = [v for v in check["violations"] if v["code"] != "block_count" and not v["code"].startswith("request_")]
    if refuse_hard and blocking:
        raise invalid_request("; ".join(v["message"] for v in blocking[:4]))
    candidate["check"] = check
    candidate["violations"] = deepcopy(check["violations"])
    _within_result_bound(candidate)
    inv.context["workoutDraft"] = candidate
    return deepcopy(candidate)


def _target_workout(context):
    if isinstance(context.get("workout"), dict):
        return context["workout"]
    target = context["target"]
    for week in (context.get("plan") or {}).get("weeks", []):
        for workout in week.get("workouts", []):
            if workout.get("workoutId") == target.get("workoutId"):
                return workout
    raise context_unavailable("Bound workout is unavailable")


def _bound_target(inv, supplied):
    expected = _context(inv).get("target")
    if not isinstance(supplied, dict) or supplied != expected:
        raise invalid_request("Tool target must exactly match the invocation-bound target")
    kind = supplied.get("kind")
    if kind == "generation":
        if inv.capability not in ("generate_training_plan", "generate_personalized_plan") or not inv.job_id or supplied.get("jobId") != inv.job_id:
            raise invalid_request("Generation targets are internal to their generation job")
        integer(supplied.get("weekNumber"), "weekNumber", 1, 12)
        integer(supplied.get("order"), "order", 1, 6)
        allowed = {"kind", "jobId", "weekNumber", "order"}
    elif kind in ("plan", "adhoc", "new"):
        safe_id(supplied.get("planId"), "planId")
        allowed = {"kind", "planId", "weekNumber"} if kind == "new" else {"kind", "planId", "baseRevision", "workoutId" if kind == "plan" else "plannedWorkoutId"}
        if kind == "new":
            integer(supplied.get("weekNumber"), "weekNumber", 1, 12)
        else:
            safe_id(supplied.get("workoutId") if kind == "plan" else supplied.get("plannedWorkoutId"), "workoutId")
            integer(supplied.get("baseRevision"), "baseRevision", 1)
    else:
        raise invalid_request("Unknown workout target kind")
    if set(supplied) != allowed:
        raise invalid_request("Malformed workout target")
    return deepcopy(supplied)


def draft_create(inv, args):
    _allowed(args, {"target", "from", "title", "intent", "focusDomains", "budgetMinutes"})
    target = _bound_target(inv, args.get("target"))
    context = _context(inv)
    load_catalog(inv)
    mode = args.get("from")
    if mode not in ("workout", "original", "planCore", "empty"):
        raise invalid_request("Unknown draft source")
    original, current = None, None
    if mode in ("workout", "original"):
        if target["kind"] not in ("plan", "adhoc"):
            raise invalid_request("Copying a workout requires an existing target")
        current = _target_workout(context)
        source = current
        if mode == "original":
            if target["kind"] != "plan":
                raise invalid_request("Only plan workouts have an immutable generated original")
            from gateway.workout_persistence import load_original_workout
            source = load_original_workout(inv, context["plan"], target["workoutId"])
            original = source
            for field in ("title", "intent", "focusDomains", "budgetMinutes"):
                if field in args and args[field] != source.get(field):
                    raise invalid_request("Original recovery metadata must match the stored original")
        workout = {key: deepcopy(value) for key, value in source.items() if key in WORKOUT_FIELDS}
        workout["nextBlockSequence"] = max(current.get("nextBlockSequence", 1), source.get("nextBlockSequence", 1))
        workout["revision"] = current.get("revision", target["baseRevision"])
        workout["order"] = current.get("order", 1)
    else:
        order = target.get("order", 1)
        workout = {"workoutId": f"w{target.get('weekNumber', context.get('weekNumber', 1))}s{order}",
                   "order": order, "title": args.get("title", "Training workout"),
                   "intent": args.get("intent"), "focusDomains": args.get("focusDomains"),
                   "budgetMinutes": args.get("budgetMinutes"), "estimatedMinutes": 0,
                   "blocks": [], "nextBlockSequence": 1}
    if original is None:
        for field in ("title", "intent", "focusDomains", "budgetMinutes"):
            if field in args:
                workout[field] = deepcopy(args[field])
    _text(workout.get("title"), "title", 80)
    _text(workout.get("intent"), "intent", 400)
    _domains(workout.get("focusDomains"))
    integer(workout.get("budgetMinutes"), "budgetMinutes", 1, 135)
    if target["kind"] == "plan" and workout["budgetMinutes"] * 2 > context["plan"]["minutesPerSession"] * 3:
        raise invalid_request("Plan-target budget cannot exceed 1.5 times minutesPerSession")
    # New drafts for an existing target preserve its immutable ID/order and
    # all previously allocated IDs, including earlier edits in this turn.
    if target["kind"] in ("plan", "adhoc"):
        bound = _target_workout(context)
        workout["workoutId"] = bound["workoutId"]
        workout["order"] = bound.get("order", 1)
        workout["nextBlockSequence"] = max(workout.get("nextBlockSequence", 1), bound.get("nextBlockSequence", 1))
    prior_draft = inv.context.get("workoutDraft")
    if isinstance(prior_draft, dict) and prior_draft.get("target") == target:
        workout["nextBlockSequence"] = max(workout.get("nextBlockSequence", 1), prior_draft["workout"].get("nextBlockSequence", 1))
    overflow = []
    if mode == "planCore":
        seen = set()
        for week in context.get("plan", {}).get("weeks", []):
            if week.get("weekNumber") != context.get("weekNumber", target.get("weekNumber")):
                continue
            for prior_workout in sorted(week.get("workouts", []), key=lambda w: w.get("order", 0)):
                for prior in prior_workout.get("blocks", []):
                    drill_id = prior.get("drillId")
                    if prior.get("domain") not in workout["focusDomains"] or drill_id in seen:
                        continue
                    seen.add(drill_id)
                    block = deepcopy(prior)
                    block["blockId"] = f"b{workout['nextBlockSequence']}"
                    block["order"] = len(workout["blocks"]) + 1
                    hypothetical = deepcopy(workout)
                    hypothetical["blocks"].append(block)
                    hypothetical["nextBlockSequence"] += 1
                    try:
                        hypothetical["estimatedMinutes"] = estimate_workout(hypothetical["blocks"])["estimatedMinutes"]
                        check = _check(inv, hypothetical, include_request=False)
                        fit = hypothetical["estimatedMinutes"] <= workout["budgetMinutes"] and not check["violations"]
                    except GatewayError:
                        fit = False
                    if not fit:
                        overflow.append(drill_id)
                        continue
                    workout = hypothetical
    now = datetime.now(timezone.utc)
    draft = {"schemaVersion": 1, "playerId": inv.player_id, "createdByUid": inv.uid,
             "conversationId": inv.conversation_id, "target": target, "status": "proposed",
             "createdAt": now.isoformat(), "expiresAt": (now + timedelta(hours=24)).isoformat(),
             "workout": workout, "catalogVersion": context.get("catalogVersion", "unknown"), "appliedResult": None}
    if overflow:
        draft["overflowCandidates"] = overflow[:90]
    return _finish(inv, draft)


def draft_add_block(inv, args):
    _allowed(args, DOSE_ARGS | {"drillId", "kind", "afterBlockId"})
    current = _draft(inv)
    if len(current["workout"]["blocks"]) >= MAX_WORKOUT_BLOCKS:
        raise invalid_request("A draft cannot have a thirteenth block")
    drill_id = safe_id(args.get("drillId"))
    if any(b.get("drillId") == drill_id for b in current["workout"]["blocks"]):
        raise invalid_request("A workout cannot repeat a drill; change its dose or choose another drill")
    if drill_id in _reserved_ids(_context(inv)):
        raise invalid_request("That drill is already scheduled or completed in another workout this week; search the full catalog for another drill")
    row = get_catalog_drill(inv, drill_id)
    defaults = resolved_catalog_dose(row["dose"])
    block = dict(defaults, **{k: args[k] for k in DOSE_ARGS if k in args})
    if dose_violations(block, row["dose"]):
        raise invalid_request("; ".join(dose_violations(block, row["dose"])))
    candidate = deepcopy(current)
    workout = candidate["workout"]
    sequence = workout["nextBlockSequence"]
    block.update({"blockId": f"b{sequence}", "order": len(workout["blocks"]) + 1,
                  "kind": args.get("kind", "main"), "drillId": row["drillId"], "name": row["name"],
                  "domain": row["domain"], "estimatedMinutes": estimate_block(block)["estimatedMinutes"],
                  "whyIncluded": f"Practice {row['name']} for this workout's {row['domain']} focus."})
    after = args.get("afterBlockId")
    index = len(workout["blocks"])
    if after is not None:
        indices = [i for i, b in enumerate(workout["blocks"]) if b["blockId"] == after]
        if not indices:
            raise invalid_request("afterBlockId is not in the current draft")
        index = indices[0] + 1
    workout["blocks"].insert(index, block)
    workout["nextBlockSequence"] += 1
    return _finish(inv, candidate)


def draft_set_dose(inv, args):
    _allowed(args, DOSE_ARGS | {"blockId"})
    candidate = deepcopy(_draft(inv))
    block = next((b for b in candidate["workout"]["blocks"] if b["blockId"] == args.get("blockId")), None)
    if block is None:
        raise invalid_request("Unknown blockId")
    block.update({key: value for key, value in args.items() if key in DOSE_ARGS})
    return _finish(inv, candidate)


def draft_remove_block(inv, args):
    _allowed(args, {"blockId"})
    candidate = deepcopy(_draft(inv))
    blocks = candidate["workout"]["blocks"]
    if args.get("blockId") not in {b["blockId"] for b in blocks}:
        raise invalid_request("Unknown blockId")
    candidate["workout"]["blocks"] = [b for b in blocks if b["blockId"] != args["blockId"]]
    return _finish(inv, candidate)


def draft_reorder(inv, args):
    _allowed(args, {"blockIds"})
    candidate = deepcopy(_draft(inv))
    by_id = {b["blockId"]: b for b in candidate["workout"]["blocks"]}
    order = args.get("blockIds")
    if not isinstance(order, list) or any(not isinstance(v, str) for v in order) or len(order) != len(by_id) or set(order) != set(by_id):
        raise invalid_request("blockIds must be a permutation of every current block ID")
    candidate["workout"]["blocks"] = [by_id[value] for value in order]
    return _finish(inv, candidate)


def draft_set_intent(inv, args):
    _allowed(args, {"title", "intent", "focusDomains", "budgetMinutes"})
    candidate = deepcopy(_draft(inv))
    candidate["workout"].update(deepcopy(args))
    return _finish(inv, candidate)


def draft_get(inv, args):
    _allowed(args, set())
    return deepcopy(_draft(inv))


def tool_validate_workout(inv, args):
    _allowed(args, set())
    return _check(inv, _draft(inv)["workout"])


def tool_estimate_minutes(inv, args):
    _allowed(args, {"blocks"})
    blocks = args.get("blocks")
    if isinstance(blocks, list):
        for block in blocks:
            _allowed(block, TIME_FIELDS)
    return estimate_workout(blocks)


def _history(inv, args):
    evidence = load_history_evidence(inv)
    context = _context(inv)
    now = context.get("now") or inv.context.get("_now") or inv.context.get("now")
    if not isinstance(now, datetime):
        now = None
    return drill_history(evidence["logs"], evidence["reps"], window_days=args.get("windowDays", 28),
                         timezone_name=context.get("plan", {}).get("timezone", "UTC"), now=now,
                         drill_ids=set(args["drillIds"]) if "drillIds" in args else None,
                         frequency=context.get("frequency", {}))


def get_drill_history(inv, args):
    _allowed(args, {"windowDays", "drillIds"})
    integer(args.get("windowDays", 28), "windowDays", 1, 90)
    if "drillIds" in args:
        if not isinstance(args["drillIds"], list) or len(args["drillIds"]) > 200:
            raise invalid_request("drillIds must contain at most 200 IDs")
        for drill_id in args["drillIds"]:
            safe_id(drill_id)
    result = _history(inv, args)
    result["frequencyWindow"] = {k: deepcopy(v) for k, v in (_context(inv).get("frequencyWindow") or {}).items() if k not in ("counts", "coverageReasons")}
    # Truncate both maps by the same sorted-ID prefix; omitted IDs are unknown.
    while len(_json(result).encode("utf-8")) > MAX_TOOL_RESULT_BYTES:
        ids = sorted(set(result["drills"]) | set(result["thisWeek"]) | set(result.get("unknownDrillIds", [])))
        if not ids:
            raise invalid_request("History metadata exceeds the tool result limit")
        result["drills"].pop(ids[-1], None)
        result["thisWeek"].pop(ids[-1], None)
        result["unknownDrillIds"] = [value for value in result.get("unknownDrillIds", []) if value != ids[-1]]
        result["truncated"] = True
        result["coverage"] = "incomplete"
    return result


def get_drill(inv, args):
    _allowed(args, {"drillId"})
    row = deepcopy(get_catalog_drill(inv, args.get("drillId")))
    context = _context(inv)
    eligible, reasons = eligible_drill(row, _profile(inv), allow_partner=context.get("allowPartner"))
    row["eligibility"] = {"eligible": eligible, "reasons": reasons,
                          "maxDrillDifficulty": (_profile(inv).get("technicalEligibility") or {}).get("maxDrillDifficulty", 5)}
    row["minutesRange"] = catalog_minutes_range(row)
    return row


def search_drills(inv, args):
    _allowed(args, {"domains", "maxDifficulty", "difficultyPreference", "equipment", "allowPartner", "freeText", "excludeDone", "excludeDrillIds", "limit", "windowDays"})
    limit = integer(args.get("limit", 25), "limit", 1, 25)
    window_days = integer(args.get("windowDays", 28), "windowDays", 1, 90)
    for name in ("allowPartner", "excludeDone"):
        if name in args and type(args[name]) is not bool:
            raise invalid_request(f"{name} must be a boolean")
    for name, maximum in (("domains", 10), ("equipment", 30), ("excludeDrillIds", 200)):
        if name in args and (not isinstance(args[name], list) or len(args[name]) > maximum or any(not isinstance(v, str) for v in args[name])):
            raise invalid_request(f"Invalid {name} list")
    if any(domain not in DOMAINS for domain in args.get("domains", [])):
        raise invalid_request("Unknown v2 domain")
    if "maxDifficulty" in args:
        integer(args["maxDifficulty"], "maxDifficulty", 1, 5)
    query = _text(args.get("freeText", ""), "freeText", 120, empty=True).casefold()
    preference = args.get("difficultyPreference", "balanced")
    if preference not in ("easier", "balanced", "harder"):
        raise invalid_request("difficultyPreference must be easier, balanced or harder")
    # Natural requests such as 'easy passing drills' rank the numeric catalog
    # difficulty. They never require an author to have written the word 'easy'.
    words = set(re.findall(r"[a-z0-9]+", query))
    if "difficultyPreference" not in args and words & {"easy", "easier", "simple", "simpler", "basic", "beginner"}:
        preference = "easier"
    stop_words = {"a", "an", "the", "and", "with", "for", "me", "drill", "drills", "workout", "workouts",
                  "easy", "easier", "simple", "simpler", "basic", "beginner", "more", "some", "please"}
    terms = words - stop_words
    context = _context(inv)
    profile = _profile(inv)
    partner = args.get("allowPartner", context.get("allowPartner"))
    if partner is True and profile.get("intake", {}).get("setting") == "halfAndHalf":
        context["allowPartner"] = True
    history = _history(inv, {"windowDays": window_days}) if args.get("excludeDone") else None
    draft = inv.context.get("workoutDraft") or {}
    current = draft.get("workout") if draft.get("target") == context.get("target") else context.get("workout")
    current_ids = {b.get("drillId") for b in (current or {}).get("blocks", [])}
    reserved_ids = _reserved_ids(context)
    excluded = set(args.get("excludeDrillIds", [])) | current_ids | reserved_ids
    level = profile.get("level") or (profile.get("intake") or {}).get("level", "club")
    preferred_level = {"foundation": 1, "club": 2, "performance": 3}.get(level, 2)
    ranked = []
    for drill_id, row in load_catalog(inv).items():
        eligible, _ = eligible_drill(row, profile, equipment=args.get("equipment"), allow_partner=partner, max_difficulty=args.get("maxDifficulty"))
        if not eligible or drill_id in excluded or (args.get("domains") and row["domain"] not in args["domains"]):
            continue
        frequency = context.get("frequency", {}).get(drill_id, 0)
        if frequency + 1 > row["maxFrequencyPerWeek"]:
            continue
        if history and (drill_id in history["drills"] or drill_id in history.get("unknownDrillIds", [])):
            continue
        searchable = " ".join((row["name"], row["domain"], _json(row.get("howTo", {})), _json(row.get("coachComments", [])), _json(row.get("adaptiveLevers", [])))).casefold()
        matches = sum(term in searchable for term in terms)
        difficulty = row["difficultyLevel"]
        fit = difficulty if preference == "easier" else -difficulty if preference == "harder" else abs(difficulty - preferred_level)
        result = {key: deepcopy(row[key]) for key in ("drillId", "name", "domain", "difficultyLevel", "minAge", "maxAge", "equipment", "requiresPartner", "dose", "maxFrequencyPerWeek")}
        result["minutesRange"] = catalog_minutes_range(row)
        result["hasMedia"] = any(isinstance(slot, dict) and slot.get("storagePath") and slot.get("status", "approved") == "approved" for slot in row.get("media", {}).values())
        if history:
            result["history"] = {"timesDone": 0, "lastDoneAt": None}
        ranked.append(((-matches, fit, frequency, drill_id), result))
    ranked.sort(key=lambda pair: pair[0])
    # Text is a ranking signal, not a hidden eligibility gate: surface the
    # fallback explicitly when no exact authored terms match the request.
    result = {"results": [row for _, row in ranked[:limit]], "totalMatches": len(ranked),
              "truncated": len(ranked) > limit, "windowDays": window_days,
              "selectionScope": "fullEligibleCatalog", "difficultyPreference": preference,
              "textMatchesFound": not terms or any(score[0] < 0 for score, _ in ranked),
              "historyCoverage": history["coverage"] if history else "not_requested"}
    while len(_json(result).encode("utf-8")) > MAX_TOOL_RESULT_BYTES and result["results"]:
        result["results"].pop()
        result["truncated"] = True
    return result


HANDLERS = {"search_drills": search_drills, "get_drill": get_drill, "get_drill_history": get_drill_history,
            "estimate_minutes": tool_estimate_minutes, "draft_create": draft_create,
            "draft_add_block": draft_add_block, "draft_set_dose": draft_set_dose,
            "draft_remove_block": draft_remove_block, "draft_reorder": draft_reorder,
            "draft_set_intent": draft_set_intent, "draft_get": draft_get, "validate_workout": tool_validate_workout}


def run_workout_tool(name, args, inv):
    """Bound counters live outside the model-visible context and cannot be reset by args."""
    context = inv.context.get("workoutContext", {})
    target = context.get("target", {})
    generation = target.get("kind") == "generation" and inv.capability in ("generate_training_plan", "generate_personalized_plan")
    key = _json(target) if generation else "turn"
    budgets = getattr(inv, "_workout_tool_budgets", None)
    if budgets is None:
        budgets = {}
        inv._workout_tool_budgets = budgets
    budget = budgets.setdefault(key, {"calls": 0, "seconds": 0.0})
    if budget["calls"] >= (60 if generation else 30) or budget["seconds"] >= 120:
        raise invalid_request("Workout tool call/time limit reached")
    budget["calls"] += 1
    started = time.monotonic()
    original = deepcopy(inv.context.get("workoutDraft"))
    try:
        result = HANDLERS[name](inv, args)
        result = _within_result_bound(result)
        if budget["seconds"] + time.monotonic() - started > 120:
            raise invalid_request("Workout tool time limit reached")
        return result
    except Exception:
        if original is None:
            inv.context.pop("workoutDraft", None)
        else:
            inv.context["workoutDraft"] = original
        raise
    finally:
        budget["seconds"] += time.monotonic() - started


def _spec(name, description, properties, required=()):
    return {"name": name, "description": description,
            "parameters": {"type": "object", "additionalProperties": False,
                           "properties": properties, "required": list(required)}}


S = {"type": "string"}
I = {"type": "integer"}
B = {"type": "boolean"}
STRINGS = {"type": "array", "items": S}
FOCUS = {"type": "array", "items": {"type": "string", "enum": list(DOMAINS)}}
DOSE_PROPERTIES = {"sets": I, "reps": I, "restSeconds": I, "restScope": {"type": "string", "enum": ["sets", "reps"]},
                   "restBetweenSetsSeconds": {"type": ["integer", "null"]}, "familiarizationReps": I}
TARGET = {"type": "object", "properties": {"kind": {"type": "string", "enum": ["plan", "adhoc", "new", "generation"]},
           "planId": S, "workoutId": S, "plannedWorkoutId": S, "baseRevision": I,
           "jobId": S, "weekNumber": I, "order": I}, "required": ["kind"], "additionalProperties": False}
TOOL_SPECS = {
    "search_drills": _spec("search_drills", "Find up to 25 ranked alternatives from the full eligible catalog. Excludes drills already in the working workout, new cross-day repeats and weekly frequency conflicts automatically. Use domains for the need and difficultyPreference for easy/harder requests; freeText ranks relevance, and textMatchesFound reports fallback. excludeDone is recent-window novelty only.",
                           {"domains": FOCUS, "maxDifficulty": I, "difficultyPreference": {"type": "string", "enum": ["easier", "balanced", "harder"]}, "equipment": STRINGS, "allowPartner": B,
                            "freeText": S, "excludeDone": B, "excludeDrillIds": STRINGS, "limit": I, "windowDays": I}),
    "get_drill": _spec("get_drill", "Read normalized executable catalog fields and current eligibility.", {"drillId": S}, ["drillId"]),
    "get_drill_history": _spec("get_drill_history", "Read recent completion history and target-excluding weekly reservations. Omitted IDs in a truncated result are unknown.", {"windowDays": I, "drillIds": STRINGS}),
    "estimate_minutes": _spec("estimate_minutes", "Compute shared exact time from stored dose inputs; no model arithmetic.", {"blocks": {"type": "array", "items": {"type": "object", "properties": dict(DOSE_PROPERTIES, repUnit={"type": "string"}, perSide=B), "required": ["sets", "reps", "repUnit", "restSeconds"], "additionalProperties": False}}}, ["blocks"]),
    "draft_create": _spec("draft_create", "Create one bound workout draft from workout, original, planCore or empty. Original recovery omits overrides.", {"target": TARGET, "from": {"type": "string", "enum": ["workout", "original", "planCore", "empty"]}, "title": S, "intent": S, "focusDomains": FOCUS, "budgetMinutes": I}, ["target", "from"]),
    "draft_add_block": _spec("draft_add_block", "Add an eligible drill; defaults use catalog midpoint and authored rest. Refusal leaves the draft unchanged.", dict(DOSE_PROPERTIES, drillId=S, kind={"type": "string", "enum": ["warmup", "main", "cooldown"]}, afterBlockId=S), ["drillId"]),
    "draft_set_dose": _spec("draft_set_dose", "Change dose only inside catalog bounds; time is recomputed.", dict(DOSE_PROPERTIES, blockId=S), ["blockId"]),
    "draft_remove_block": _spec("draft_remove_block", "Remove a block permanently from this draft; its ID is not reused.", {"blockId": S}, ["blockId"]),
    "draft_reorder": _spec("draft_reorder", "Reorder every current block ID exactly once.", {"blockIds": STRINGS}, ["blockIds"]),
    "draft_set_intent": _spec("draft_set_intent", "Change today's intent and budget before adapting blocks, including arbitrary shorter whole minutes.", {"title": S, "intent": S, "focusDomains": FOCUS, "budgetMinutes": I}),
    "draft_get": _spec("draft_get", "Read the current bound working draft.", {}),
    "validate_workout": _spec("validate_workout", "Check exact time, safety, frequency, dose, ordering and intent for the current draft.", {}),
}
