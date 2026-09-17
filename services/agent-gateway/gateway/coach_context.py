"""Bounded player evidence and corpus retrieval for the versioned AI coach."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import re

from gateway import knowledge
from gateway.assemblers import assemble_recent_reps, assemble_benchmark_context_optional
from gateway.catalog_v2 import load_catalog, eligible_drill
from gateway.coach_workspace import load, snapshot, now, _time
from gateway.errors import GatewayError
from gateway.program_profile import resolve_age, resolve_technical_eligibility, age_band, POSITIONS
from gateway.program_focus import focus_policy, compute_focus_split
from gateway.workout_history import build_frequency_context, load_history_evidence, evidence_blocks


def _pick(data, keys):
    return {key: deepcopy(data[key]) for key in keys if key in data}


def coach_training_setting(intake, message):
    """Normal soccer kit is a default, never an override of stated limits."""
    setting = _pick(intake, ("equipment", "setting", "painFlag"))
    defaulted = "equipment" not in setting
    equipment = list(setting.get("equipment") or []) if not defaulted else ["ball", "cones", "markers", "wall", "timer"]
    terms = {"ball": r"balls?", "cones": r"cones?", "markers": r"markers?", "wall": r"walls?", "timer": r"timer", "goal": r"goals?"}
    only = re.search(r"(?i)\b(?:i\s+)?only\s+have\s+([^.!?\n]+)", message)
    if only:
        equipment = [key for key, term in terms.items() if re.search(r"(?i)\b(?:" + term + r")\b", only[1])]
    for restriction in re.finditer(r"(?i)\b(?:no|without|don['’]?t\s+have|do\s+not\s+have)\s+([^.!?;\n]+)", message):
        clause = re.split(r"(?i)\b(?:but|i\s+have)\b", restriction[1])[0]
        removed = {key for key, term in terms.items() if re.search(r"(?i)\b(?:" + term + r")\b", clause)}
        equipment = [item for item in equipment if item not in removed]
    setting.update(equipment=equipment, setting=setting.get("setting", "solo"))
    if re.search(r"(?i)\b(?:alone|by\s+myself|solo|no\s+partner|without\s+(?:a\s+)?partner)\b", message):
        setting["setting"] = "solo"
    return setting, {"normalKitDefaulted": defaulted, "equipment": equipment,
                     "note": "Assume a ball, cones/markers, usable space and wall unless the athlete states a restriction. No routine equipment questionnaire."}


def coach_priorities(player, intake, age, catalog, trusted_profile):
    """Share the generator's curriculum policy without treating a low test as a goal."""
    from gateway.coach_actions import _POSITION_ALIASES
    raw_position = player.get("position") or intake.get("position")
    position = raw_position if raw_position in POSITIONS else _POSITION_ALIASES.get(str(raw_position).casefold())
    level = intake.get("level", "club")
    level = level if level in ("foundation", "club", "performance") else "club"
    policy = focus_policy()
    row = next(row for row in policy["rows"] if row["position"] == (position or "neutral")
               and row["ageBand"] == age_band(age or 10) and row["level"] == level)
    profile = {**trusted_profile, "position": position, "ageBand": row["ageBand"], "level": level,
               "stats": {}, "peer": {}, "measuredMetricIds": []}
    domains = {drill["domain"] for drill in catalog.values() if eligible_drill(drill, trusted_profile)[0]}
    split = None
    try:
        split = compute_focus_split(profile, domains)
    except GatewayError:
        pass  # Advice still uses the role baseline when the catalog is sparse.
    technical = ("passing", "receiving", "dribbling", "shooting")
    percentages = split["final"] if split else row["percentages"]
    return {"source": "shared_program_focus_v3", "policyVersion": policy["version"],
            "policyStatus": policy["status"], "position": position, "baseline": deepcopy(row),
            "catalogFocus": deepcopy(split["final"]) if split else None,
            "technicalPriorities": sorted(technical, key=lambda key: (-percentages[key], key)),
            "roleGuidance": ("Midfield priorities are passing, receiving/first touch, scanning, and ball control. Lead with technical work. Broad jump or plyometrics is never the default main focus for a midfielder."
                if position in ("DM", "CM", "AM") else "Lead with soccer skills suited to the athlete's role and stated goal; physical development supports those skills."),
            "measurementGuardrail": "A low isolated test score does not select the training focus. Test gaps may inform bounded supporting work after role, skill development and the athlete's actual request."}


def _recent(inv, collection, field, maximum):
    rows = [{**(snap.to_dict() or {}), "id": snap.id} for snap in inv.player_ref().collection(collection)
            .order_by(field, direction="DESCENDING").limit(maximum + 1).stream()]
    rows.sort(key=lambda value: _time(value.get(field)) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return rows[:maximum], {"limit": maximum, "truncated": len(rows) > maximum,
                            "scope": "recent records with " + field, "completeHistory": False}


def _originated_after(row, cutoff):
    # A reply written after Forget may have started before it. Its source time
    # prevents that late write from reintroducing forgotten context next turn.
    started = _time(row.get("sourceTurnStartedAt") or row.get("createdAt"))
    return cutoff is None or (started is not None and started > cutoff)


def thread_history(conv_ref, *, reset_at=None, limit=20):
    rows = [{**(snap.to_dict() or {}), "id": snap.id} for snap in conv_ref.collection("messages")
            .order_by("createdAt", direction="DESCENDING").limit(limit + 1).stream()]
    cutoff = _time(reset_at)
    rows = [row for row in rows if row.get("role") in ("user", "assistant") and isinstance(row.get("content"), str)
            and _originated_after(row, cutoff)]
    rows.sort(key=lambda row: _time(row.get("createdAt")) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    rows = rows[:limit]
    # Keep recent turns inside a fixed character budget too.
    chosen, size = [], 0
    for row in rows:
        text = row["content"][:2000]
        if size + len(text) > 12000:
            break
        chosen.append({"role": row["role"], "content": text})
        size += len(text)
    return list(reversed(chosen))


def assemble(inv, *, role, conversation_id):
    player = inv.player_ref().get().to_dict() or {}
    schedule_ref = inv.player_ref().collection("workoutSchedule").document("current")
    schedule_revision = (schedule_ref.get().to_dict() or {}).get("revision", 0)
    plans = [{**(snap.to_dict() or {}), "planId": snap.id} for snap in inv.player_ref().collection("trainingPlans")
             .where("status", "==", "active").limit(2).stream()]
    plan = plans[0] if len(plans) == 1 else {}
    intake = plan.get("intake") or {}
    age, source, gaps = resolve_age(player, intake, now(inv))
    training_setting, equipment_context = coach_training_setting(intake, inv.params.get("message", ""))
    trusted_profile = {"age": age, "technicalEligibility": resolve_technical_eligibility(inv.db, inv.player_id, player),
                       "intake": {**training_setting, "goals": intake.get("goals", [])}}
    # An internal read context, never a valid writable workout target. This
    # supports the existing get/search/history tools without forking a tool or
    # letting general coach chat create/modify a workout.
    inv.context["programProfile"] = trusted_profile
    inv.context["workoutContext"] = {"target": {"kind": "read"}, "plan": {"timezone": plan.get("timezone", "UTC")},
                                     "frequency": {}, "frequencyWindow": {"coverage": "unavailable"}, "now": now(inv)}
    if plan.get("schemaVersion") == 3:
        from gateway.assemblers import _current_week_number
        try:
            week_number = _current_week_number(plan["startDate"], plan["horizonWeeks"], plan["timezone"], now=now(inv))
            read_target = {"kind": "read", "planId": plan["planId"], "weekNumber": week_number}
            history = load_history_evidence(inv)
            frequency = build_frequency_context(plan, read_target, history["logs"], history["reservations"], now=now(inv))
            if (schedule_ref.get().to_dict() or {}).get("revision", 0) != schedule_revision:
                frequency.update(coverage="incomplete", coverageReasons=["Schedule changed during context assembly"])
            inv.context["workoutContext"].update(target=read_target, frequency=frequency["counts"], frequencyWindow=frequency)
        except (GatewayError, KeyError, TypeError, ValueError):
            pass  # Marked unavailable, never interpreted as an empty schedule.
    catalog = load_catalog(inv)
    evidence = {"profile": {"age": age, "ageSource": source, "toneAge": age or 15,
                            "toneAgeDefaulted": age is None, "position": player.get("position"),
                            "goals": player.get("goals") or player.get("statedGoals"),
                            "preferredFoot": player.get("preferredFoot") or player.get("dominantFoot"), "ageDataGaps": gaps},
                "viewerRole": role, "coverage": {}, "equipmentContext": equipment_context,
                "trainingPriorities": coach_priorities(player, intake, age, catalog, trusted_profile),
                "profileUpdatesThisTurn": deepcopy(inv.context.get("coachProfileUpdates", []))}
    for key, fn in (("recentTests", assemble_recent_reps), ("benchmarks", assemble_benchmark_context_optional)):
        try:
            evidence[key] = fn(inv)
        except GatewayError as exc:
            if exc.code != "context_unavailable":
                raise
            evidence[key] = {"available": False}
    logs, log_coverage = _recent(inv, "workoutLogs", "startedAt", 20)
    evidence["recentWorkouts"] = [{**_pick(row, ("id", "planId", "workoutId", "weekNumber", "workoutRevision", "source", "status", "startedAt", "completedAt", "endedAt", "endReason", "elapsedSeconds")),
        "workout": _pick(row.get("workoutSnapshot") or {}, ("title", "intent", "revision", "estimatedMinutes")),
        "blocks": [_pick(block, ("drillId", "name", "domain", "status", "setsCompleted", "estimatedMinutes", "elapsedSeconds"))
                   for block in evidence_blocks(row)[:12]], "loggedBlockCount": len(row.get("blocks") or [])} for row in logs]
    evidence["coverage"]["recentWorkouts"] = log_coverage
    for row, shaped in zip(logs, evidence["recentWorkouts"]):
        started, ended = _time(row.get("startedAt")), _time(row.get("endedAt"))
        if started is not None and ended is not None and ended >= started:
            shaped["durationSeconds"] = int((ended - started).total_seconds())
    evidence["coverage"]["weeklyFrequency"] = _pick(inv.context["workoutContext"]["frequencyWindow"],
        ("coverage", "windowStart", "windowEnd", "timezone", "coverageReasons"))
    adjustments, adjustment_coverage = _recent(inv, "planAdjustments", "createdAt", 12)
    evidence["recentRefinements"] = []
    for row in adjustments:
        editor = row.get("editor") or {}
        value = {**_pick(row, ("id", "planId", "workoutId", "createdAt", "diff")), "editorRole": editor.get("role")}
        if role == "athlete" and editor.get("role") == "athlete" and editor.get("uid") == inv.uid:
            value.update(_pick(row, ("rationale",)))
        evidence["recentRefinements"].append(value)
    evidence["coverage"]["recentRefinements"] = adjustment_coverage
    evidence["activePlan"] = _pick(plan, ("planId", "schemaVersion", "startDate", "horizonWeeks", "sessionsPerWeek", "minutesPerSession", "planSummary"))
    evidence["activePlan"]["goals"] = _pick(intake, ("goals", "setting", "equipment"))
    # Compact curriculum snapshot, no private assessment/profile text or old
    # revisions. Full executable detail remains reachable from Training.
    evidence["activePlan"]["weeks"] = [{**_pick(week, ("weekNumber", "theme", "focus", "targets")),
        "workouts": [_pick(workout, ("workoutId", "title", "intent", "focusDomains", "estimatedMinutes", "revision"))
                     for workout in (week.get("workouts") or [])[:6]]} for week in (plan.get("weeks") or [])[:12]]
    evidence["coverage"]["activePlan"] = {"ambiguous": len(plans) > 1, "available": bool(plan)}
    evidence["research"] = {
        "sources": [{"id": "dosage-principles", "title": "PoseTek Drill Matrix Research & Implementation Guide, dosage principles",
                     "status": "evidence-informed implementation guidance"},
                    {"id": "copy-rules", "title": "PoseTek youth coaching copy rules", "status": "product communication policy"}],
        "dosagePrinciples": "\n".join(line for line in knowledge.dosage_principles().splitlines() if "retest" not in line.casefold()),
        "copyRules": knowledge.copy_rules(),
        "policyOverrides": ["Current v3 programs have no automatic retest week; the legacy corpus retest sentence is excluded."],
        "coverage": "Bundled dosage/copy guidance and eligible drill catalog; not a complete literature search.",
    }
    test_ids = {test_id for drill in (evidence.get("recentTests") or {})
                for test_id in knowledge.measured_drill_tests().get(drill, [])}
    rules = knowledge.rules_for_tests(test_ids)
    evidence["research"]["relevantRecommendationRules"] = [
        _pick(rule, ("ruleId", "observedFlag", "trigger", "constraint", "prescriptionLogic", "guardrail", "sourceIds"))
        for rule in rules if "retest" not in str(rule).casefold()][:12]
    evidence["research"]["recommendationCoverage"] = {"matched": len(rules), "includedLimit": 12,
        "note": "Source IDs identify the bundled matrix references; do not invent missing study titles or URLs."}
    if age is not None:
        evidence["research"]["ageLevelGuidance"] = knowledge.matrix_row(knowledge.age_band_for(age), intake.get("level", "club"))
    ws = load(inv) if role == "athlete" else None
    memory_state = snapshot(inv, ws) if ws else None
    evidence["confirmedMemories"] = ([{key: value for key, value in item.items() if key in ("memoryId", "category", "text", "createdAt", "expiresAt")}
                                       for item in memory_state["memories"] if item["status"] == "active"] if ws and ws["enabled"] else [])
    evidence["priorConversations"] = []
    if ws and ws["enabled"]:
        conversations, coverage = _recent(inv, "aiConversations", "lastMessageAt", 12)
        for conversation in conversations:
            # No staff-authored history, no another athlete, no private coach
            # notes. Only self-authored general/workout conversations qualify.
            if (conversation["id"] == conversation_id or conversation.get("createdByUid") != inv.uid
                    or conversation.get("capability") not in ("pose_chat", "coaching_chat", "workout_chat")):
                continue
            prior = thread_history(inv.player_ref().collection("aiConversations").document(conversation["id"]),
                                   reset_at=ws.get("historyResetAt"), limit=4)
            # User statements only; old model answers are not independent facts.
            prior = [row for row in prior if row["role"] == "user"][-2:]
            if prior:
                evidence["priorConversations"].append({"conversationId": conversation["id"], "messages": prior})
            if len(evidence["priorConversations"]) >= 4:
                break
        evidence["coverage"]["priorConversations"] = {**coverage, "included": len(evidence["priorConversations"]), "scope": "up to four own recent conversations; user statements only"}
    return evidence, ws, memory_state
