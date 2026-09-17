"""Workout evidence and replacement-aware weekly frequency accounting.

The complete fold is separate from model-visible truncation. Calendar week
boundaries use the plan timezone, including DST, and actual logs from any plan
count when their start falls in the target window.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from gateway.errors import invalid_request
from gateway.workout_time import integer


def timestamp(value):
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def week_window(plan: dict, week_number: int) -> tuple[datetime, datetime, str]:
    integer(week_number, "weekNumber", 1, 12)
    zone = plan.get("timezone", "UTC")
    try:
        tz = ZoneInfo(zone)
        start = date.fromisoformat(plan["startDate"]) + timedelta(days=7 * (week_number - 1))
    except (ValueError, KeyError, TypeError, ZoneInfoNotFoundError) as exc:
        raise invalid_request("A valid plan startDate and IANA timezone are required") from exc
    return datetime.combine(start, time.min, tz), datetime.combine(start + timedelta(days=7), time.min, tz), zone


def _week_number(plan: dict, target: dict) -> int:
    if target.get("kind") in ("new", "generation"):
        return target["weekNumber"]
    if "weekNumber" in target:
        return target["weekNumber"]
    for week in plan.get("weeks", []):
        if any(workout.get("workoutId") == target.get("workoutId") for workout in week.get("workouts", [])):
            return week["weekNumber"]
    raise invalid_request("Target week could not be resolved")


def _log_identity(log: dict) -> str:
    if log.get("source") == "plan":
        return f"plan:{log.get('planId')}:{log.get('workoutId')}"
    return "adhoc:" + str(log.get("id") or log.get("logId") or log.get("workoutId"))


def _target_identity(plan: dict, target: dict) -> str | None:
    if target.get("kind") == "plan":
        return f"plan:{target['planId']}:{target['workoutId']}"
    if target.get("kind") == "adhoc":
        return "adhoc:" + target["plannedWorkoutId"]
    if target.get("kind") == "generation":
        return f"plan:{plan.get('planId')}:{'w'+str(target['weekNumber'])+'s'+str(target['order'])}"
    return None


def evidence_blocks(log: dict) -> list[dict]:
    """Join completion data to its immutable executable snapshot when available."""
    frozen = {block.get("blockId"): block for block in (log.get("workoutSnapshot") or {}).get("blocks", [])}
    result = []
    for completion in log.get("blocks", []):
        if completion.get("status") not in ("done", "partial"):
            continue
        snap = frozen.get(completion.get("blockId"))
        # Snapshot owns identity/dose/time. Never trust changed log display data
        # in preference to the workout the athlete actually started.
        block = dict(completion)
        if snap is not None:
            block.update(snap)
            block["status"] = completion["status"]
            block["setsCompleted"] = completion.get("setsCompleted", 0)
        if isinstance(block.get("drillId"), str) and block["drillId"]:
            result.append(block)
    return result


def build_frequency_context(plan: dict, target: dict, logs: list[dict], reservations: list[dict], *, now: datetime | None = None) -> dict:
    week_number = _week_number(plan, target)
    start, end, zone = week_window(plan, week_number)
    now = now or datetime.now(timezone.utc)
    identities = defaultdict(set)
    incomplete = []
    excluded = _target_identity(plan, target)
    plan_id = plan.get("planId") or target.get("planId")
    for week in plan.get("weeks", []):
        if week.get("weekNumber") != week_number:
            continue
        for workout in week.get("workouts", []):
            identity = f"plan:{plan_id}:{workout.get('workoutId')}"
            if identity == excluded:
                continue
            for drill_id in {b.get("drillId") for b in workout.get("blocks", []) if b.get("drillId")}:
                identities[drill_id].add(identity)
    logged_adhoc = {str(log.get("id") or log.get("logId") or log.get("workoutId")) for log in logs if log.get("source", "adhoc") == "adhoc"}
    for reservation in reservations:
        reservation_id = str(reservation.get("id") or reservation.get("workoutId"))
        identity = "adhoc:" + reservation_id
        if identity == excluded or reservation_id in logged_adhoc or reservation.get("status") != "ready":
            continue
        window_start = timestamp(reservation.get("windowStart") or (reservation.get("reservationWindow") or {}).get("start"))
        window_end = timestamp(reservation.get("windowEnd") or (reservation.get("reservationWindow") or {}).get("end"))
        if window_start is None or window_end is None:
            # A reservation created for this same plan/week is unambiguous.
            if reservation.get("planId") != plan_id or reservation.get("weekNumber") != week_number:
                incomplete.append("Ready reservation has no resolvable date window: " + reservation_id)
                continue
            window_start, window_end = start, end
        if window_end <= now or not (window_start < end and window_end > start):
            continue
        for drill_id in {b.get("drillId") for b in reservation.get("blocks", []) if b.get("drillId")}:
            identities[drill_id].add(identity)
    for log in logs:
        started = timestamp(log.get("startedAt"))
        identity = _log_identity(log)
        if identity == excluded:
            continue
        actual = evidence_blocks(log)
        if started is None:
            if actual:
                # A known plan slot can be conservatively charged to its
                # assigned week; unplaceable actual sessions fail closed.
                if log.get("source") == "plan" and log.get("planId") == plan_id and log.get("weekNumber") == week_number:
                    for drill_id in {b["drillId"] for b in actual}:
                        identities[drill_id].add(identity)
                else:
                    incomplete.append("Completed/partial log has no valid startedAt: " + str(log.get("id", "unknown")))
            continue
        if not start <= started < end:
            continue
        for drill_id in {b["drillId"] for b in actual}:
            identities[drill_id].add(identity)
    return {"counts": {drill_id: len(used) for drill_id, used in sorted(identities.items())},
            "windowStart": start.isoformat(), "windowEnd": end.isoformat(), "timezone": zone,
            "targetExcluded": dict(target), "coverage": "incomplete" if incomplete else "complete",
            "coverageReasons": incomplete}


def load_history_evidence(inv) -> dict:
    if "workoutHistoryEvidence" not in inv.context:
        inv.context["workoutHistoryEvidence"] = {
            key: [dict(snap.to_dict() or {}, id=snap.id) for snap in inv.player_ref().collection(collection).stream()]
            for key, collection in (("logs", "workoutLogs"), ("reps", "reps"), ("reservations", "plannedWorkouts"))
        }
    return inv.context["workoutHistoryEvidence"]


def drill_history(logs: list[dict], reps: list[dict], *, window_days=28, timezone_name="UTC", now=None, drill_ids=None, frequency=None) -> dict:
    integer(window_days, "windowDays", 1, 90)
    now = now or datetime.now(timezone.utc)
    try:
        tz = ZoneInfo(timezone_name)
    except (TypeError, ZoneInfoNotFoundError) as exc:
        raise invalid_request("Invalid history timezone") from exc
    # Include today and the preceding N-1 local days, ending at asOf time.
    start = datetime.combine(now.astimezone(tz).date() - timedelta(days=window_days - 1), time.min, tz)
    by_drill = {}
    unknown_ids = set()
    for log in sorted(logs, key=lambda item: (timestamp(item.get("startedAt")) or datetime.min.replace(tzinfo=timezone.utc), str(item.get("id", "")))):
        at = timestamp(log.get("startedAt"))
        if at is None:
            unknown_ids.update(b["drillId"] for b in evidence_blocks(log))
            continue
        if not start <= at <= now:
            continue
        seen = set()
        for block in evidence_blocks(log):
            drill_id = block["drillId"]
            if drill_ids is not None and drill_id not in drill_ids:
                continue
            row = by_drill.setdefault(drill_id, {"timesDone": 0, "setsCompleted": 0, "minutesDone": 0, "lastDoneAt": None, "lastStatus": None})
            if drill_id not in seen:
                row["timesDone"] += 1
                seen.add(drill_id)
            sets = block.get("setsCompleted", 0)
            minutes = block.get("estimatedMinutes", 0)
            row["setsCompleted"] += max(0, sets) if type(sets) is int else 0
            if type(minutes) is int and minutes > 0:
                row["minutesDone"] += minutes if block["status"] == "done" else minutes // 2
            row["lastDoneAt"] = at.astimezone(tz).date().isoformat()
            row["lastStatus"] = block["status"]
    measured = {}
    sessions = defaultdict(set)
    for rep in reps:
        at = timestamp(rep.get("createdAt") or rep.get("timestamp"))
        kind = rep.get("repType")
        if kind not in {"sprint", "jump", "broadJump", "changeOfDirection", "dribbling", "side_kick", "deadballShot"} or at is None or not start <= at <= now:
            continue
        key = str(rep.get("sessionId") or rep.get("sessionNumber") or rep.get("id"))
        sessions[kind].add(key)
        row = measured.setdefault(kind, {"sessions": 0, "lastAt": None})
        day = at.astimezone(tz).date().isoformat()
        row["sessions"] = len(sessions[kind])
        row["lastAt"] = max(row["lastAt"] or day, day)
    return {"windowDays": window_days, "asOf": now.astimezone(tz).date().isoformat(),
            "windowStart": start.isoformat(), "windowEnd": now.isoformat(), "timezone": timezone_name,
            "drills": dict(sorted(by_drill.items())), "measured": dict(sorted(measured.items())),
            "thisWeek": dict(sorted((frequency or {}).items())), "truncated": False,
            "coverage": "incomplete" if unknown_ids else "complete", "unknownDrillIds": sorted(unknown_ids)}
