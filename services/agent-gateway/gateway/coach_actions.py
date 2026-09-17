"""Coach-only actions: grounded fill-only profile facts and a workout handoff.

Neither tool accepts an athlete/plan ID from the model. A handoff opens the
existing workout builder; its normal proposal, validation and Apply boundaries
still own every prescription write.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import date, timedelta
import re
from zoneinfo import ZoneInfo

from google.cloud import firestore as fs
from google.cloud.firestore_v1.transaction import transactional

from gateway.authz import authorize_v3
from gateway.coach_workspace import _ATTRIBUTED_OR_PRIVATE, _NOT_MEMORY, _SENSITIVE, now
from gateway.errors import GatewayError, invalid_request, permission_denied


COACH_TOOL_SPECS = {
    "save_player_profile": {
        "name": "save_player_profile",
        "description": "Fill a missing athlete profile fact from an exact current self-statement. Existing facts always win. Never use for staff statements, age, difficulty, injury or account data.",
        "parameters": {"type": "object", "additionalProperties": False,
            "required": ["field", "value", "evidenceQuote"], "properties": {
                "field": {"type": "string", "enum": ["position", "preferredFoot", "goals"]},
                "value": {"type": "string", "maxLength": 240},
                "evidenceQuote": {"type": "string", "minLength": 5, "maxLength": 240}}}},
    "prepare_workout": {
        "name": "prepare_workout",
        "description": "Prepare an actionable handoff to the existing workout builder after the athlete asks to build or confirms the offer. Copy request details from their own messages. This does not build or save a workout.",
        "parameters": {"type": "object", "additionalProperties": False,
            "required": ["request", "evidenceQuote"], "properties": {
                "request": {"type": "string", "minLength": 3, "maxLength": 500},
                "evidenceQuote": {"type": "string", "minLength": 2, "maxLength": 500}}}},
}

_POSITION_ALIASES = {
    "goalkeeper": "GK", "goalie": "GK", "keeper": "GK", "gk": "GK",
    "center back": "CB", "centre back": "CB", "centerback": "CB", "centreback": "CB", "cb": "CB",
    "full back": "FB", "fullback": "FB", "wing back": "FB", "wingback": "FB", "fb": "FB",
    "defensive midfielder": "DM", "holding midfielder": "DM", "dm": "DM",
    "central midfielder": "CM", "center midfielder": "CM", "centre midfielder": "CM",
    "midfielder": "CM", "midifielder": "CM", "midfiedler": "CM", "cm": "CM",
    "attacking midfielder": "AM", "am": "AM", "winger": "W", "w": "W", "striker": "ST", "st": "ST",
}
_POSITION = re.compile(r"(?i)\b(?:i\s+am|i['’]m|i\s+play(?:\s+as)?|my\s+position\s+is)\s+(?:a\s+|an\s+)?("
    + "|".join(re.escape(key) for key in sorted(_POSITION_ALIASES, key=len, reverse=True)) + r")\b")
_FOOT = re.compile(r"(?i)\b(?:i\s+am|i['’]m)\s+(left|right)[ -]footed\b|\bmy\s+(?:preferred|dominant|stronger)\s+foot\s+is\s+(left|right)\b")
_GOAL = re.compile(r"(?i)^(?:my\s+goal\s+is|i\s+(?:want|aim)\s+to\s+(?:improve|get\s+better|work\s+on|develop)|i['’]m\s+working\s+on)\b")
_TRAINING = re.compile(r"(?i)\b(pass\w*|receiv\w*|dribbl\w*|shoot\w*|finish\w*|first\s+touch|ball\s+control|scann\w*|speed|agility|strength|soccer|football)\b")
_UNSAFE_FACT = re.compile(r"(?i)\b(if|would|could|might|maybe|used\s+to|not|never|isn't|wasn't|examples?|quot(?:e|ed|ing)|pretend|suppose|imagine|said|says|actually)\b|[\"“”]")
_BUILD = re.compile(r"(?i)\b(?:build|make|create|prepare|plan|want|like)\b.{0,140}\b(?:workout|session)\b|\bworkout\b.{0,100}\b(?:build|make|create|prepare)\b")
# An offer can mention building anywhere; current consent must be a request,
# not a how-to question or a report that someone else wants a workout.
_DIRECT_BUILD = re.compile(r"(?i)(?:^|[.!;\n])\s*(?:(?:hey|hi|okay|ok|yes|yeah|sure|man)[,!]?\s+)?(?:"
    r"(?:please\s+)?(?:build|make|create|prepare|plan)\b|"
    r"(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:build|make|create|prepare|plan)\b|"
    r"i(?:\s+(?:really\s+)?(?:want|need)|(?:['’]d|\s+would)\s+like)\s+(?:"
    r"(?:you\s+)?to\s+(?:build|make|create|prepare|plan)\b|"
    r"(?:a|an|another|my|the)\b(?![^.!?\n]{0,140}\b(?:guide|tutorial|example|explanation|description|question|how\s+to|way\s+to)\b))|"
    r"let['’]s\s+(?:build|make|create|prepare|plan)\b)"
    r"[^.!?\n]{0,140}\b(?:workout|session)\b")
_CONFIRM = re.compile(r"(?i)^\s*(?:yes|yeah|yep|sure|ok|okay|please|go\s+ahead|do\s+it|build\s+it|make\s+it|let['’]s\s+do\s+it)\b")
_NO_BUILD = re.compile(r"(?i)\b(?:don['’]t|do\s+not|not\s+yet|never\s+mind|cancel)\b")
_DEFER_BUILD = re.compile(r"(?i)\b(?:wait|hold\s+off|not\s+now|after\s+i\s+confirm|until\s+i\s+(?:confirm|ask|say))\b")
_KIT_NOUN = r"(?:(?:a|an|any|the)\s+)?(?:cones?|markers?|balls?|walls?|goals?|hurdles?|ladders?|bands?|weights?|gym\s+equipment|equipment)"
_EQUIPMENT_NEGATION = re.compile(r"(?i)\b(?:i\s+)?(?:don['’]t|do\s+not)\s+(?:have|use)\s+"
    + _KIT_NOUN + r"(?:(?:,\s*|\s+(?:and|or)\s+)" + _KIT_NOUN + r")*\s*(?=$|[.!?;\n])")


def _build_denied(message):
    # Exempt only complete, bounded kit restrictions from the conservative
    # negation guard. A following 'or build it' / 'and cancel it' cannot match
    # the noun list, and cancellation elsewhere remains intact. This sanitized
    # string is used only for consent; the handoff keeps the exact user text.
    consent_text = _EQUIPMENT_NEGATION.sub("", message)
    return bool(_NO_BUILD.search(consent_text) or _DEFER_BUILD.search(message))


def _quote(message, quote):
    if not isinstance(quote, str) or not 5 <= len(quote) <= 240 or quote not in message:
        raise invalid_request("Use an exact quote from the current athlete message")
    # Check the whole message, too: extracting only the inside of a quoted,
    # hypothetical or negated sentence must not turn it into a real fact.
    if _ATTRIBUTED_OR_PRIVATE.search(message) or _UNSAFE_FACT.search(message) or _SENSITIVE.search(quote):
        raise invalid_request("Only an explicit current athlete self-statement can fill a profile fact")


def _profile_value(field, value, quote):
    if field == "position":
        match = _POSITION.search(quote)
        expected = _POSITION_ALIASES.get(match[1].casefold()) if match else None
    elif field == "preferredFoot":
        match = _FOOT.search(quote)
        expected = next((group.title() for group in match.groups() if group), None) if match else None
    elif field == "goals":
        expected = quote if _GOAL.search(quote) and _TRAINING.search(quote) and not _NOT_MEMORY.search(quote) else None
    else:
        raise invalid_request("This profile field cannot be changed by the coach")
    if expected is None or value != expected:
        raise invalid_request("The profile value must match the athlete's own words")
    return [expected] if field == "goals" else expected


def save_player_profile(args, inv):
    if not isinstance(args, dict) or set(args) != {"field", "value", "evidenceQuote"}:
        raise invalid_request("Profile save requires field, value and evidenceQuote only")
    if authorize_v3(inv) != "athlete":
        raise permission_denied("Staff chat cannot supply athlete self-stated profile facts")
    message = inv.params.get("message", "")
    quote = args["evidenceQuote"]
    _quote(message, quote)
    field = args["field"]
    value = _profile_value(field, args["value"], quote)
    pattern = {"position": _POSITION, "preferredFoot": _FOOT}.get(field)
    if pattern:
        matches = list(pattern.finditer(message))
        for match in matches:
            _profile_value(field, value, match[0])
        if not matches or any(re.match(r"\s*(?:\?|\bor\b)", message[match.end():], re.I) for match in matches):
            raise invalid_request("The profile statement must be unambiguous")

    @transactional
    def commit(tx):
        if authorize_v3(inv, mutation=True, read=lambda ref: ref.get(transaction=tx)) != "athlete":
            raise permission_denied("Only the athlete can supply their self-stated facts")
        snap = inv.player_ref().get(transaction=tx)
        if not snap.exists:
            raise permission_denied("The athlete profile is unavailable")
        player = snap.to_dict() or {}
        # Preserve meaningful legacy aliases as well as canonical values.
        aliases = {"goals": ("goals", "statedGoals"), "preferredFoot": ("preferredFoot", "dominantFoot")}.get(field, (field,))
        for key in aliases:
            existing = player.get(key)
            if existing is not None and existing != "" and existing != []:
                return {"status": "kept_existing", "field": field, "value": deepcopy(existing)}
        tx.update(inv.player_ref(), {field: value, "updatedAt": fs.SERVER_TIMESTAMP})
        return {"status": "saved", "field": field, "value": deepcopy(value)}

    result = commit(inv.db.transaction())
    inv.context.setdefault("coachProfileUpdates", []).append(result)
    return result


def save_explicit_profile_facts(inv, role):
    """Reliable common cases without spending a model call or trusting one.

    Goals remain a bounded model tool because they need a meaningful durable
    clause; position and foot have an existing small canonical vocabulary.
    """
    if role != "athlete":
        return
    message = inv.params.get("message", "")
    for field, pattern in (("position", _POSITION), ("preferredFoot", _FOOT)):
        match = pattern.search(message)
        if not match:
            continue
        quote = match[0]
        try:
            _quote(message, quote)
        except GatewayError:
            continue
        value = (_POSITION_ALIASES[match[1].casefold()] if field == "position"
                 else next(group.title() for group in match.groups() if group))
        try:
            save_player_profile({"field": field, "value": value, "evidenceQuote": quote}, inv)
        except GatewayError as exc:
            if exc.code != "invalid_request":
                raise


def prepare_workout(args, inv):
    if not isinstance(args, dict) or set(args) != {"request", "evidenceQuote"}:
        raise invalid_request("Workout handoff requires request and evidenceQuote only")
    authorize_v3(inv, mutation=True)
    message = inv.params.get("message", "")
    quote, request = args["evidenceQuote"], args["request"]
    if (not isinstance(quote, str) or not 2 <= len(quote) <= 500
            or _build_denied(message) or _ATTRIBUTED_OR_PRIVATE.search(message)):
        raise invalid_request("The athlete must request or confirm the workout in this turn")
    history = inv.context.get("coachActionHistory") or []
    previous_users = [row["content"] for row in history if row.get("role") == "user"][-4:]
    last_assistant = next((row["content"] for row in reversed(history) if row.get("role") == "assistant"), "")
    confirmed = bool(_CONFIRM.search(message) and _BUILD.search(last_assistant) and previous_users)
    if not _DIRECT_BUILD.search(message) and not confirmed:
        raise invalid_request("Offer a workout first and wait for the athlete to ask or confirm")
    if not isinstance(request, str) or not 3 <= len(request.strip()) <= 500:
        raise invalid_request("Copy 3..500 characters of the athlete's workout request")
    # Both direct requests and confirmations are grounded in server-held user
    # text. Model summaries/quotes cannot add, remove or rewrite constraints;
    # recopying a valid request exactly is not an authorization prerequisite.
    request = message.strip()
    if confirmed:
        # A previous 'do not build it yet' defers execution; today's explicit
        # confirmation authorizes it. Keep that original ask and every later
        # clarification rather than losing them to the last training keyword.
        relevant = [index for index, text in enumerate(previous_users) if _BUILD.search(text)]
        if not relevant:
            relevant = [index for index, text in enumerate(previous_users) if _TRAINING.search(text)]
        if not relevant:
            raise invalid_request("The earlier athlete workout request is unavailable; ask for the workout details")
        # A confirmation may add 'only 15 minutes' or 'no cones'. Keep that
        # new constraint and intermediate clarifications alongside the original
        # ask, even if the model passed only 'yes, build it' as the request.
        request = "\n".join(previous_users[relevant[-1]:] + [message.strip()])
    if len(request) > 500:
        raise invalid_request("The workout request and latest constraints must fit within 500 characters")
    plans = [{**(snap.to_dict() or {}), "planId": snap.id} for snap in inv.player_ref().collection("trainingPlans")
             .where("status", "==", "active").limit(2).stream()]
    plan = plans[0] if len(plans) == 1 and plans[0].get("schemaVersion") == 3 else None
    event = {"type": "workout_request", "playerId": inv.player_id, "request": request,
             "destination": "program_intake"}
    if plan:
        from gateway.assemblers import _current_week_number
        try:
            start = date.fromisoformat(plan["startDate"])
            local_day = now(inv).astimezone(ZoneInfo(plan["timezone"])).date()
            horizon = plan["horizonWeeks"]
            if type(horizon) is not int or not 1 <= horizon <= 12 or local_day >= start + timedelta(weeks=horizon):
                raise ValueError("The active program has ended")
            _current_week_number(plan["startDate"], plan["horizonWeeks"], plan["timezone"], now=now(inv))
            explicit_minutes = list(re.finditer(r"(?i)\b(\d{1,3})\s*(?:min(?:ute)?s?)\b", request))
            minutes = int(explicit_minutes[-1][1]) if explicit_minutes else plan.get("minutesPerSession", 30)
            if type(minutes) is not int or not 1 <= minutes <= 135:
                raise ValueError("Unsupported duration")
            event.update(destination="workout_builder", workoutRef={"kind": "new", "planId": plan["planId"],
                "timeAvailableMinutes": minutes, "energy": "normal"})
        except (GatewayError, KeyError, TypeError, ValueError):
            pass
    inv.context["coachWorkoutRequest"] = event
    return {"status": "ready_to_open", **deepcopy(event),
            "nextStep": "Open the workout builder to generate and review the proposal. No workout has been built or saved."}


def run_coach_action(name, args, inv):
    if name == "save_player_profile":
        return save_player_profile(args, inv)
    if name == "prepare_workout":
        return prepare_workout(args, inv)
    raise invalid_request("Unknown coach action")
