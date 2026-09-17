"""Server-held, measured requirements for explicit athlete workout edits.

Only the authenticated current request supplies intent; tools cannot rewrite the
baseline. These final-state requirements do not prohibit intermediate edits.
General generation retains its existing time tolerance.
"""
from __future__ import annotations

from copy import deepcopy
import re

from gateway.workout_time import estimate_block, estimate_workout

_ALIASES = {
    "ballMastery": r"ball\s*mastery|ball\s*control",
    "dribbling": r"dribbling",
    "passing": r"passing",
    "receiving": r"receiving|first[ -]?touch",
    "shooting": r"shooting|finishing",
    "speed": r"speed|sprinting|sprints",
    "agility": r"agility|change[ -]of[ -]direction",
    "plyometrics": r"plyometrics|jumping|jumps",
    "strength": r"strength",
    "games": r"games|small[ -]sided games",
}
_DOMAIN = "(?:" + "|".join(_ALIASES.values()) + ")"
_MODIFIERS = r"(?:(?:easy|easier|simple|simpler|technical|time|work|focus|emphasis|on|with|the|my|some|of|a|bit|little)\s+)*"
_FOCUS = re.compile(r"\b(?P<direction>more|less|fewer|increase|reduce|decrease)\s+" + _MODIFIERS +
                    r"(?P<domains>" + _DOMAIN + r"(?:\s*(?:drills?|work|practice|time))?(?:\s*(?:,|and)\s*" +
                    _MODIFIERS + _DOMAIN + r")*)\b", re.I)
_DOMAIN_RE = re.compile(_DOMAIN, re.I)
_NEGATIVE = re.compile(r"\b(?:no|not|never|don['’]?t|do not|avoid|stop|without|if|whether|said|says|asked|example)\b", re.I)
_NUMBER = r"(?P<minutes>\d{1,3})[ -]*(?:minutes?|mins?|m)\b"
_TIME = re.compile(
    r"\b(?:(?:keep|make|set|change|cut|shorten|reduce|extend|increase)\s+(?:(?:the|my|this)\s+)?"
    r"(?:workout|session|it|duration|total|time)\s*(?:(?:length|duration|time)\s*)?(?:(?:at|to|for|exactly|under|below)\s*)?|"
    r"(?:only|exactly|at most|no more than|i have|i['’]ve got)\s*)" + _NUMBER, re.I)
_TIME_NOUN = re.compile(r"\b(?P<minutes>\d{1,3})[ -]*(?:minutes?|mins?)[ -]+(?:workout|session)\b", re.I)


def _request_text(message):
    # Quoted examples and attributed/negated clauses are not athlete directions.
    return re.sub(r'"[^"\n]*"|“[^”\n]*”', "", message)


def _negated(text, start):
    sentence_prefix = re.split(r"[.!?;\n]|\b(?:but|so)\b", text[:start], flags=re.I)[-1]
    # A comma can separate an equipment restriction from a real request, but
    # does not turn quoted/attributed or informational prose into an imperative.
    if re.search(r"\b(?:said|says|asked|explain|how|why|whether)\b", sentence_prefix, re.I):
        return True
    prefix = sentence_prefix.rsplit(",", 1)[-1]
    return bool(_NEGATIVE.search(prefix) or re.search(r"\b(?:do|should|would|could|can)\s+i\b", prefix, re.I))


def domain_minutes(workout):
    totals = {}
    for block in (workout or {}).get("blocks", []):
        domain = block.get("domain")
        totals[domain] = totals.get(domain, 0) + estimate_block(block)["estimatedMinutes"]
    return totals


def derive_requirements(message, baseline, previous=None):
    """Freeze relative requests against the proposal the athlete actually saw.

    Unmentioned requirements survive a resumed edit. A new explicit direction or
    duration replaces that field; model scratch/reset operations never do.
    """
    result = deepcopy(previous) if previous else {"schemaVersion": 1, "focus": {}}
    text = _request_text(message)
    totals = domain_minutes(baseline)
    for match in _FOCUS.finditer(text):
        if _negated(text, match.start()) or re.match(r"\s*(?:(?:is|are|was|were)n['’]t|(?:is|are|was|were)\s+not)\b", text[match.end():], re.I):
            continue
        direction = "more" if match["direction"].lower() in ("more", "increase") else "less"
        for item in _DOMAIN_RE.finditer(match["domains"]):
            domain = next(key for key, pattern in _ALIASES.items() if re.fullmatch(pattern, item[0], re.I))
            result["focus"][domain] = {"direction": direction, "baselineMinutes": totals.get(domain, 0)}
    explicit_times = list(_TIME.finditer(text))
    noun_times = [m for m in _TIME_NOUN.finditer(text)
                  if not any(explicit.start() <= m.start() < explicit.end() for explicit in explicit_times)]
    for match in sorted(explicit_times + noun_times, key=lambda item: item.start()):
        if _negated(text, match.start()):
            continue
        minutes = int(match["minutes"])
        if 1 <= minutes <= 135:
            result["durationMinutes"] = minutes
            is_ceiling = re.match(r"(?:only|at most|no more than|i have|i['’]ve got)(?=\s|\d)", match[0], re.I) or re.search(r"\b(?:under|below)\s*\d", match[0], re.I)
            result["durationMode"] = "maximum" if is_ceiling else "exact"
    return result if result["focus"] or "durationMinutes" in result else None


def bind_request_requirements(inv, message):
    context = inv.context["workoutContext"]
    baseline = (inv.context.get("workoutDraft") or {}).get("workout") or context.get("workout") or {}
    requirements = derive_requirements(message, baseline, inv.context.get("priorWorkoutRequirements"))
    inv.context["workoutRequirements"] = requirements
    return requirements


def requirement_check(workout, requirements):
    if not requirements:
        return {"ok": True, "violations": []}
    totals = domain_minutes(workout)
    measured = estimate_workout(workout.get("blocks", []))["estimatedMinutes"]
    violations, focus = [], {}
    for domain, rule in requirements.get("focus", {}).items():
        before, current = rule["baselineMinutes"], totals.get(domain, 0)
        direction = rule["direction"]
        satisfied = current > before if direction == "more" else current < before
        focus[domain] = {"direction": direction, "beforeMinutes": before, "currentMinutes": current,
                         "requiredMinutes": before + 1 if direction == "more" else max(0, before - 1)}
        if not satisfied:
            violations.append({"code": "request_focus", "message":
                f"Requested {direction} {domain}: before {before} minutes, now {current}; "
                f"must be {'greater' if direction == 'more' else 'less'} than {before}."})
    requested = requirements.get("durationMinutes")
    maximum = requirements.get("durationMode") == "maximum"
    time_ok = measured <= requested if requested is not None and maximum else measured == requested
    budget = workout.get("budgetMinutes")
    budget_ok = True
    if requested is not None:
        budget_ok = type(budget) is int and (budget <= requested if maximum else budget == requested)
    if requested is not None and (not time_ok or not budget_ok):
        violations.append({"code": "request_duration", "message":
            f"Requested workout duration {requested} minutes; calculated {measured}, budget {workout.get('budgetMinutes')}. "
            + ("Calculated total (including transitions) and budget must fit within this ceiling." if maximum else
               "Both calculated total (including transitions) and budget must match the requested duration.")})
    return {"ok": not violations, "violations": violations, "focus": focus,
            "calculatedMinutes": measured, "requestedMinutes": requested}


def with_requirements(check, workout, requirements):
    if not requirements:
        return check
    result = deepcopy(check)
    measured = requirement_check(workout, requirements)
    result["request"] = measured
    result["violations"].extend(measured["violations"])
    result["ok"] = bool(result["ok"] and measured["ok"])
    return result
