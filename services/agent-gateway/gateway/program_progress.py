"""Pure v3 progress/calendar fold. V1/V2 assembler behavior remains untouched.

Consumers must copy tests/fixtures/week_progress_v3.json byte-for-byte. The caller
supplies Firestore document IDs as `id` on logs/reps/training_sessions and `planId`
(or `id`) on the plan. All timestamps accept aware datetime or ISO-8601 strings.
No current prescription is substituted for a pinned log's historical blocks.
"""
from __future__ import annotations

import datetime as dt
from collections import Counter
from typing import Optional
from zoneinfo import ZoneInfo

_REP_DOMAINS = {
    "sprint": "speed", "jump": "plyometrics", "broadJump": "plyometrics",
    "changeOfDirection": "agility", "dribbling": "dribbling",
    "side_kick": "shooting", "deadballShot": "shooting",
}


def _timestamp(value) -> Optional[dt.datetime]:
    if isinstance(value, dt.datetime):
        return value if value.tzinfo else value.replace(tzinfo=dt.timezone.utc)
    if isinstance(value, str):
        try:
            parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)
        except ValueError:
            return None
    return None


def _zone(plan: dict):
    # Generated v3 plans validate timezone. Bad imported data fails visibly,
    # instead of shifting an athlete's day silently into UTC.
    return ZoneInfo(plan.get("timezone") or "UTC")


def week_window(plan: dict, week_number: int) -> tuple[dt.datetime, dt.datetime]:
    if isinstance(week_number, bool) or not isinstance(week_number, int) or week_number < 1:
        raise ValueError("week_number must be a positive integer")
    start = dt.date.fromisoformat(plan["startDate"])
    zone = _zone(plan)
    days = [start + dt.timedelta(days=7 * offset) for offset in (week_number - 1, week_number)]
    return tuple(dt.datetime.combine(day, dt.time.min, zone) for day in days)


def current_week(plan: dict, now=None) -> int:
    instant = _timestamp(now) if now is not None else dt.datetime.now(dt.timezone.utc)
    if instant is None:
        raise ValueError("now must be an ISO timestamp or datetime")
    days = (instant.astimezone(_zone(plan)).date() - dt.date.fromisoformat(plan["startDate"])).days
    return min(max(days // 7 + 1, 1), max(int(plan.get("horizonWeeks", 1)), 1))


def _plan_id(plan: dict) -> str:
    return plan.get("planId") or plan.get("id") or ""


def _rows_by_id(rows: list[dict]) -> dict[str, dict]:
    # A Firestore query returns a document once. Duplicate input snapshots must
    # not multiply evidence when callers combine query windows.
    return {row["id"]: row for row in rows if isinstance(row, dict) and isinstance(row.get("id"), str)}


def _plan_logs(plan: dict, logs: list[dict]) -> dict[str, dict]:
    plan_id = _plan_id(plan)
    result = {}
    for log_id, log in _rows_by_id(logs).items():
        wid = log.get("workoutId")
        if (log.get("source") == "plan" and log.get("planId") == plan_id
                and isinstance(wid, str) and log_id == f"{plan_id}_{wid}"):
            result[wid] = log
    return result


def _slot(workout: dict, log: Optional[dict]) -> dict:
    result = {"workoutId": workout["workoutId"], "state": "notStarted"}
    if log is not None:
        if log.get("endedAt") is not None:
            result.update(state="finished", endReason=log.get("endReason"))
        else:
            result["state"] = "inProgress"
    return result


def next_workout(plan: dict, logs: list[dict], now=None) -> Optional[dict]:
    """Return the executable workout, or None. Resume beats order in this week.

    Earlier weeks are never backfilled; all ended logs finish their slot,
    including abandoned/early-ended logs, without claiming completed targets.
    """
    if plan.get("status") != "active":
        return None
    current = current_week(plan, now)
    plan_logs = _plan_logs(plan, logs)
    weeks = sorted(plan.get("weeks") or [], key=lambda w: w["weekNumber"])
    for week in weeks:
        if week["weekNumber"] < current:
            continue
        workouts = sorted(week.get("workouts") or [], key=lambda w: w["order"])
        if week["weekNumber"] == current:
            for workout in workouts:
                log = plan_logs.get(workout["workoutId"])
                if log is not None and log.get("endedAt") is None:
                    # Resume the snapshot the athlete actually started.
                    return log.get("workoutSnapshot") or workout
        for workout in workouts:
            log = plan_logs.get(workout["workoutId"])
            if log is None or log.get("endedAt") is None:
                return (log.get("workoutSnapshot") or workout) if log is not None else workout
    return None


def _minute_debit(block: dict) -> int:
    value = block.get("estimatedMinutes", 0)
    minutes = max(0, int(value)) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0
    if block.get("status") == "done":
        return minutes
    if block.get("status") == "partial":
        return minutes // 2
    return 0


def _session_key(row: dict, *, ref: bool = False):
    kind = row.get("drillType") if ref else row.get("repType")
    if kind == "deadballShot":
        kind = "side_kick"
    number = row.get("sessionNumber")
    return (kind, str(number)) if number is not None else None


def fold_week_progress(plan: dict, week_number: int, logs: list[dict], reps: list[dict],
                       training_sessions: list[dict]) -> dict:
    """V3 §11/13 fold; one exposure per log/domain, block-level minute debit.

    Plan evidence follows its assigned slot week, independent of when it was
    started. Ad-hoc evidence uses actual startedAt in [local week start, end),
    regardless of which plan or assigned week originally seeded that workout.
    Test sessions only credit domain exposures, never slot completion/minutes.
    """
    if plan.get("schemaVersion") != 3:
        raise ValueError("fold_week_progress only accepts schemaVersion 3")
    start, end = week_window(plan, week_number)
    week = next((w for w in plan.get("weeks", []) if w.get("weekNumber") == week_number), {})
    workouts = sorted(week.get("workouts") or [], key=lambda w: w["order"])
    slot_ids = {w["workoutId"] for w in workouts}
    plan_logs = _plan_logs(plan, logs)
    included = []
    for log in _rows_by_id(logs).values():
        if log.get("source") == "plan":
            if log.get("workoutId") in slot_ids and plan_logs.get(log["workoutId"]) is log:
                included.append(log)
        elif log.get("source") == "adhoc":
            instant = _timestamp(log.get("startedAt"))
            if instant is not None and start <= instant < end:
                included.append(log)

    exposures, minutes_done, drill_done_logs, drill_minutes = Counter(), Counter(), Counter(), Counter()
    seen_drills = set()
    linked = set()
    for log in included:
        blocks = [b for b in log.get("blocks", []) if isinstance(b, dict)]
        active = [b for b in blocks if b.get("status") in ("done", "partial")]
        exposures.update({b["domain"] for b in active if isinstance(b.get("domain"), str)})
        if active and log.get("linkedTrainingSessionId"):
            linked.add(log["linkedTrainingSessionId"])
        for block in active:
            domain, drill = block.get("domain"), block.get("drillId")
            debit = _minute_debit(block)
            if isinstance(domain, str):
                minutes_done[domain] += debit
            if isinstance(drill, str):
                seen_drills.add(drill)
                drill_minutes[drill] += debit
        for drill in {b.get("drillId") for b in active if b.get("drillId")}:
            if all(b.get("status") == "done" for b in blocks if b.get("drillId") == drill):
                drill_done_logs[drill] += 1

    covered_ids, covered_sessions = set(), set()
    for session in training_sessions:
        if session.get("id") not in linked:
            continue
        for ref in session.get("sessionRefs") or []:
            if ref.get("sessionDocId"):
                covered_ids.add(ref["sessionDocId"])
            key = _session_key(ref, ref=True)
            if key is not None:
                covered_sessions.add(key)
    free_sessions = set()
    for rep_id, rep in _rows_by_id(reps).items():
        instant = _timestamp(rep.get("createdAt"))
        domain = _REP_DOMAINS.get(rep.get("repType"))
        key = _session_key(rep)
        if (not domain or instant is None or not start <= instant < end
                or rep_id in covered_ids or (key is not None and key in covered_sessions)):
            continue
        key = key if key is not None else (rep.get("repType"), rep_id)
        if key not in free_sessions:
            exposures[domain] += 1
            free_sessions.add(key)

    targets = {t["domain"]: t.get("exposures", 0) for t in week.get("targets") or []}
    allocations = {a["domain"]: a.get("minutes", 0) for a in week.get("allocations") or []}
    domains = list(dict.fromkeys([*targets, *allocations, *exposures]))
    drill_targets = Counter()
    for workout in workouts:
        drill_targets.update({b["drillId"] for b in workout.get("blocks", []) if b.get("drillId")})
    drills = list(dict.fromkeys(b["drillId"] for w in workouts for b in w.get("blocks", []) if b.get("drillId")))
    return {
        "weekNumber": week_number,
        "domainProgress": [{"domain": domain, "exposuresDone": exposures[domain],
                            "exposuresTarget": targets.get(domain, 0),
                            "minutesDone": minutes_done[domain],
                            "minutesRemaining": max(0, allocations.get(domain, 0) - minutes_done[domain])}
                           for domain in domains],
        "workoutProgress": [_slot(w, plan_logs.get(w["workoutId"])) for w in workouts],
        "drillProgress": [{"drillId": drill, "state": "notStarted" if drill not in seen_drills else
                           "done" if drill_done_logs[drill] >= drill_targets[drill] else "partial",
                           "minutesDone": drill_minutes[drill]} for drill in drills],
    }
