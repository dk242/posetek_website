"""Opt-in whole-body training policy. Unreviewed content never becomes executable.

These are product eligibility and accounting rules, not clinical assessments.
Legacy catalogs/intakes retain their existing behavior. New prescriptions fail
closed on missing reviewer decisions and remain mobile-gated at every commit.
"""
from collections import Counter, defaultdict
from copy import copy, deepcopy
from datetime import date, datetime, timedelta, timezone
from math import ceil

from gateway.errors import GatewayError, invalid_request

VERSION = 'whole-body-v1'
GYM_EQUIPMENT = ('dumbbells', 'barbell', 'weightPlates', 'squatRack', 'trapBar',
                 'kettlebell', 'cableMachine', 'resistanceBand', 'medicineBall',
                 'pullUpBar', 'legCurlMachine', 'legPressMachine', 'jumpRope', 'sliders')
FAMILIES = frozenset(('knee', 'hip', 'hamstring', 'adductor', 'calf', 'trunk', 'upperPush', 'upperPull'))
MODALITIES = frozenset(('resistance', 'isometric', 'plyometric', 'speed', 'agility', 'ball', 'mobility'))
OBJECTIVES = frozenset(('shooting_speed', 'short_sprint', 'vertical_jump', 'horizontal_jump',
                        'dribble_completion', 'planned_change_direction'))
LIMITS = ('setsPerSession', 'setsPerWeek', 'contactsPerSession', 'contactsPerWeek',
          'holdSecondsPerSession', 'holdSecondsPerWeek', 'minRecoveryHours')


def _int(value, low=0, high=100000):
    return type(value) is int and low <= value <= high


def _day(value):
    try:
        return date.fromisoformat(value) if isinstance(value, str) and len(value) == 10 else None
    except ValueError:
        return None


def _time(value):
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00')) if isinstance(value, str) else None
        return parsed.replace(tzinfo=timezone.utc) if parsed and not parsed.tzinfo else parsed
    except ValueError:
        return None


def validate_context(raw, sessions):
    if not isinstance(raw, dict) or raw.get('schemaVersion') != 1:
        raise invalid_request('trainingContext requires schemaVersion 1')
    allowed = {'schemaVersion', 'equipmentConfirmed', 'resistanceExperience', 'sessionDays',
               'supervision', 'startDate', 'externalSchedule', 'scheduleConfirmed'}
    if set(raw) - allowed:
        raise invalid_request('Unknown trainingContext field; clearance cannot be supplied in intake')
    if any(type(raw.get(k)) is not bool for k in ('equipmentConfirmed', 'scheduleConfirmed')):
        raise invalid_request('Equipment and schedule confirmation must be explicit booleans')
    if raw.get('resistanceExperience') not in ('unknown', 'new', 'experienced'):
        raise invalid_request('Resistance experience must be unknown, new or experienced')
    if raw.get('supervision') not in ('unconfirmed', 'qualifiedCoach', 'unavailable'):
        raise invalid_request('Supervision availability cannot grant independent clearance')
    days = raw.get('sessionDays')
    if (not isinstance(days, list) or len(days) != sessions
            or any(not _int(d, 0, 6) for d in days) or len(set(days)) != len(days)):
        raise invalid_request('Choose one distinct weekday (Sunday=0) per planned session')
    if _day(raw.get('startDate')) is None:
        raise invalid_request('trainingContext.startDate must be YYYY-MM-DD')
    external = raw.get('externalSchedule')
    if not isinstance(external, list) or len(external) > 28:
        raise invalid_request('externalSchedule must contain at most 28 weekly activities')
    for row in external:
        if (not isinstance(row, dict) or set(row) != {'day', 'activity', 'durationMinutes', 'effort'}
                or not _int(row['day'], 0, 6) or row['activity'] not in ('practice', 'match', 'strength', 'other')
                or not _int(row['durationMinutes'], 1, 480) or row['effort'] not in ('easy', 'moderate', 'hard')):
            raise invalid_request('Each external activity needs a weekday, activity, duration and effort')
    return deepcopy(raw)


def validate_policy(raw):
    if not isinstance(raw, dict) or raw.get('version') != VERSION:
        raise invalid_request('Unknown exercise training policy')
    required = {'version', 'modality', 'loadFamilies', 'requiresClearance', 'requiresVerifiedMobile',
                'reviewStatus', 'progression', 'loaded', 'loadingInstructions', 'supervision', 'limits', 'evidenceLinks'}
    if not required <= set(raw):
        raise invalid_request('Training policy is incomplete')
    if raw['modality'] not in MODALITIES or raw['progression'] != 'coachReviewed':
        raise invalid_request('Unsupported modality or progression policy')
    if raw['reviewStatus'] not in ('pending', 'approved') or raw['supervision'] not in ('none', 'clearance'):
        raise invalid_request('Invalid content review or supervision requirement')
    if any(type(raw[k]) is not bool for k in ('requiresClearance', 'requiresVerifiedMobile', 'loaded')):
        raise invalid_request('Training policy eligibility flags must be booleans')
    families = raw['loadFamilies']
    if not isinstance(families, list) or any(f not in FAMILIES for f in families) or len(set(families)) != len(families):
        raise invalid_request('Unknown or duplicated load family')
    if not isinstance(raw['loadingInstructions'], str) or len(raw['loadingInstructions']) > 500:
        raise invalid_request('Loading instructions must be at most 500 characters')
    if raw['loaded'] and (not raw['requiresClearance'] or not raw['requiresVerifiedMobile'] or not raw['loadingInstructions'].strip()):
        raise invalid_request('Loaded exercises require clearance, mobile verification and load instructions')
    limits = raw['limits']
    if (not isinstance(limits, dict) or any(k not in LIMITS for k in limits)
            or not all(_int(limits.get(k), 1) for k in ('setsPerSession', 'setsPerWeek'))
            or any(not _int(v) for v in limits.values())):
        raise invalid_request('Exercise dose limits need bounded integer values')
    if raw['modality'] == 'plyometric' and not all(_int(limits.get(k), 1) for k in ('contactsPerSession', 'contactsPerWeek')):
        raise invalid_request('Plyometrics require reviewed session and weekly contact caps')
    if raw['modality'] == 'isometric' and not all(_int(limits.get(k), 1) for k in ('holdSecondsPerSession', 'holdSecondsPerWeek')):
        raise invalid_request('Isometrics require reviewed session and weekly hold caps')
    links = raw['evidenceLinks']
    if not isinstance(links, list) or len(links) > 12:
        raise invalid_request('Evidence links must be a bounded list')
    for link in links:
        if (not isinstance(link, dict) or link.get('objectiveId') not in OBJECTIVES
                or link.get('relationship') not in ('direct', 'support')
                or type(link.get('weight')) not in (int, float)
                or link['weight'] != (1 if link['relationship'] == 'direct' else .5)
                or not isinstance(link.get('sourceIds'), list) or not link['sourceIds']
                or any(not isinstance(s, str) or not 1 <= len(s) <= 100 for s in link['sourceIds'])):
            raise invalid_request('Evidence links must name sources and a direct/support relationship')
    return deepcopy(raw)


def bind_profile(inv, profile, read=None):
    """Read trusted readiness independently of all athlete/model supplied fields."""
    if not (profile.get('intake') or {}).get('trainingContext'):
        profile.pop('wholeBody', None)
        return profile
    load = read or (lambda ref: ref.get())
    snapshot = load(inv.player_ref().collection('privateProfile').document('trainingReadiness'))
    readiness = (snapshot.to_dict() or {}) if snapshot.exists else {}
    reviewer_id = readiness.get('reviewedBy')
    reviewer = {}
    if isinstance(reviewer_id, str) and reviewer_id and '/' not in reviewer_id:
        reviewer_snapshot = load(inv.db.collection('trainingReviewers').document(reviewer_id))
        reviewer = (reviewer_snapshot.to_dict() or {}) if reviewer_snapshot.exists else {}
    reviewer_in_scope = reviewer.get('scopeType') == 'posetek'
    if reviewer.get('scopeType') == 'assignedPlayers':
        from gateway.authz import authorize_v3
        reviewer_inv = copy(inv)
        reviewer_inv.uid = reviewer_id
        reviewer_inv.trusted_claims = {'uid': reviewer_id}
        try:
            reviewer_in_scope = authorize_v3(reviewer_inv, read=read) == 'coach'
        except GatewayError:
            reviewer_in_scope = False
    cfg_snapshot = load(inv.db.collection('config').document('llm'))
    cfg = (cfg_snapshot.to_dict() or {}).get('wholeBodyTraining', {}) if cfg_snapshot.exists else {}
    now = inv.context.get('_now') or inv.context.get('now') or datetime.now(timezone.utc)
    profile['wholeBody'] = {'readiness': readiness, 'reviewerEnabled': reviewer.get('enabled') is True and reviewer_in_scope, 'now': now,
        'previewEnabled': cfg.get('previewEnabled') is True,
        'mobileVerified': cfg.get('mobileVerified') is True,
        'preview': inv.capability in ('assess_personalized_plan', 'generate_personalized_plan')}
    return profile


def eligibility_reasons(row, profile):
    policy = row.get('trainingPolicy')
    if policy is None:
        return []
    reasons = []
    if policy.get('reviewStatus') != 'approved': reasons.append('content_review_pending')
    context = (profile.get('intake') or {}).get('trainingContext') or {}
    bound = profile.get('wholeBody') or {}
    if not context or not bound.get('previewEnabled'): reasons.append('whole_body_not_enabled')
    if context.get('equipmentConfirmed') is not True: reasons.append('equipment_unconfirmed')
    if context.get('scheduleConfirmed') is not True: reasons.append('schedule_unconfirmed')
    if (policy.get('loaded') or policy.get('modality') in ('resistance', 'isometric', 'plyometric')) and context.get('resistanceExperience') not in ('new', 'experienced'):
        reasons.append('training_experience_unconfirmed')
    if not _int(profile.get('age'), 10, 18) or profile.get('ageSource') == 'absent': reasons.append('whole_body_age_unconfirmed')
    # Even a field exercise now carries clearance/start obligations that the
    # released native client cannot enforce. All v1 policy content is gated.
    if not bound.get('mobileVerified') and not bound.get('preview'):
        reasons.append('mobile_release_pending')
    readiness = bound.get('readiness') or {}
    if policy.get('requiresClearance'):
        now = bound.get('now') or datetime.now(timezone.utc)
        reviewed, expiry = _time(readiness.get('reviewedAt')), _time(readiness.get('expiresAt'))
        if (not bound.get('reviewerEnabled') or readiness.get('schemaVersion') != 1 or readiness.get('status') != 'cleared'
                or not _int(readiness.get('revision'), 1) or not isinstance(readiness.get('reviewedBy'), str)
                or not readiness['reviewedBy'] or not reviewed or reviewed > now or not expiry or expiry <= now):
            reasons.append('coach_clearance_required')
        if not set(policy.get('loadFamilies', [])) <= set(readiness.get('loadFamilies') or []):
            reasons.append('movement_clearance_required')
        limits = readiness.get('limits') or {}
        if not all(_int(limits.get(k), 1) for k in LIMITS): reasons.append('reviewed_load_limits_required')
        supervised = context.get('supervision') == 'qualifiedCoach'
        if readiness.get('supervision') != 'independent' and not supervised:
            reasons.append('qualified_supervision_required')
        if policy.get('loaded'):
            load = (readiness.get('exerciseLoads') or {}).get(row['drillId']) or {}
            if not isinstance(load.get('instruction'), str) or not 1 <= len(load['instruction'].strip()) <= 500:
                reasons.append('individual_load_instruction_required')
            if not supervised and load.get('independentAllowed') is not True:
                reasons.append('exercise_supervision_required')
    return list(dict.fromkeys(reasons))


def session_date(context, week, order):
    start = _day(context.get('startDate'))
    if not start: return None
    days = context.get('sessionDays') or []
    offsets = sorted((d - (start.weekday() + 1) % 7) % 7 for d in days)
    if not _int(order, 1, len(offsets)) or not _int(week, 1, 12): return None
    return start + timedelta(days=7 * (week - 1) + offsets[order - 1])


def recovery_days(policy, profile):
    hours = max(policy.get('limits', {}).get('minRecoveryHours', 0),
                (profile.get('wholeBody', {}).get('readiness', {}).get('limits') or {}).get('minRecoveryHours', 0))
    # Dates have no time-of-day precision; require a full intervening day even
    # for a shorter reviewed interval. Never claim measured elapsed hours.
    return max(2, ceil(hours / 24))


def session_allowed(row, profile, week, order):
    policy = row.get('trainingPolicy')
    if not policy: return True
    context = profile.get('intake', {}).get('trainingContext') or {}
    day = session_date(context, week, order)
    if not day: return False
    expiry = _time(profile.get('wholeBody', {}).get('readiness', {}).get('expiresAt'))
    if policy.get('requiresClearance') and (not expiry or day >= expiry.date()): return False
    if policy.get('modality') in ('ball', 'mobility'): return True
    gap = recovery_days(policy, profile)
    for activity in context.get('externalSchedule', []):
        if activity['effort'] == 'hard' or activity['activity'] in ('match', 'strength'):
            weekday = (day.weekday() + 1) % 7
            distance = min((activity['day'] - weekday) % 7, (weekday - activity['day']) % 7)
            if distance < gap: return False
    return True


def families_for(row):
    policy = row.get('trainingPolicy')
    if policy:
        return set(policy['loadFamilies'])
    # Conservative accounting for existing physical curriculum. Missing exact
    # classification never lets an old lower-body variant disappear from load.
    if row.get('domain') in ('speed', 'agility', 'plyometrics', 'strength'):
        return {'knee', 'hip', 'hamstring', 'adductor', 'calf', 'trunk'}
    return set()


def quantities(block, row):
    sides = 2 if block.get('perSide') else 1
    sets, reps = block.get('sets', 0), block.get('reps', 0)
    if not _int(sets) or not _int(reps): return {'sets': 0, 'contacts': 0, 'holdSeconds': 0}
    mode = row.get('trainingPolicy', {}).get('modality')
    # The catalog's set cap is per prescribed set (including both sides when
    # perSide is true). Actual contacts/hold duration include each side.
    contacts = sets * reps * sides if mode == 'plyometric' or row.get('domain') == 'plyometrics' else 0
    seconds = sets * reps * sides * (60 if block.get('repUnit') == 'minutes' else 1) if mode == 'isometric' else 0
    return {'sets': sets, 'contacts': contacts, 'holdSeconds': seconds}


def load_violations(workout, catalog, profile, *, plan=None, week=1, order=1, prior_workouts=()):
    """Same hard load validator for solver outputs, edits, activation and apply."""
    policy_blocks = [(b, catalog.get(b.get('drillId'), {})) for b in workout.get('blocks', [])
                     if catalog.get(b.get('drillId'), {}).get('trainingPolicy')]
    if not policy_blocks: return []
    reasons = []
    context = profile.get('intake', {}).get('trainingContext') or {}
    day = session_date(context, week, order)
    if day is None: return ['schedule_unconfirmed']
    bound = profile.get('wholeBody', {})
    readiness_limits = bound.get('readiness', {}).get('limits') or {}
    totals = defaultdict(Counter)
    for b in workout.get('blocks', []):
        row = catalog.get(b.get('drillId'), {})
        for family in families_for(row): totals[family].update(quantities(b, row))
    history = []
    for prior_week in (plan or {}).get('weeks', []):
        for prior in prior_week.get('workouts', []):
            if prior.get('workoutId') != workout.get('workoutId'):
                history.append((session_date(context, prior_week['weekNumber'], prior['order']), prior))
    history.extend(prior_workouts)
    for block, row in policy_blocks:
        policy = row['trainingPolicy']
        if not session_allowed(row, profile, week, order): reasons.append('external_schedule_conflict')
        if policy['modality'] == 'plyometric' and block.get('repUnit') not in ('contacts', 'reps'):
            reasons.append('plyometric_contacts_unquantified')
        for family in families_for(row):
            dated_loads = []
            for prior_date, prior in history:
                if prior_date is None:
                    reasons.append('load_history_incomplete'); continue
                relevant = [b for b in prior.get('blocks', []) if family in families_for(catalog.get(b.get('drillId'), {}))]
                if not relevant: continue
                if abs((prior_date - day).days) < recovery_days(policy, profile): reasons.append('recovery_spacing')
                if day - timedelta(days=6) <= prior_date <= day + timedelta(days=6):
                    for b in relevant: dated_loads.append((prior_date, quantities(b, catalog.get(b.get('drillId'), {}))))
            for unit in ('sets', 'contacts', 'holdSeconds'):
                rolling = max(totals[family][unit] + sum(q[unit] for at, q in dated_loads
                              if day-timedelta(days=offset) <= at <= day+timedelta(days=6-offset)) for offset in range(7))
                for window, count in (('Session', totals[family][unit]), ('Week', rolling)):
                    key = unit + 'Per' + window
                    limits = [v for v in (policy['limits'].get(key), readiness_limits.get(key)) if _int(v, 1)]
                    if count and (not limits or count > min(limits)): reasons.append('load_limit_' + key)
    return list(dict.fromkeys(reasons))


def assert_activation_allowed(inv, catalog, read=None):
    restricted = [r for r in catalog.values() if r.get('trainingPolicy')]
    if not restricted: return
    load = read or (lambda ref: ref.get())
    snap = load(inv.db.collection('config').document('llm'))
    policy = (snap.to_dict() or {}).get('wholeBodyTraining', {}) if snap.exists else {}
    if policy.get('mobileVerified') is not True:
        raise GatewayError('capability_disabled', 'Expanded training plans remain drafts until installed mobile support is verified. Existing plans are unchanged.')


def annotate_load_instructions(workout, catalog, profile):
    for block in workout.get('blocks', []):
        row = catalog.get(block.get('drillId'), {})
        policy = row.get('trainingPolicy')
        if not policy: continue
        load = (profile.get('wholeBody', {}).get('readiness', {}).get('exerciseLoads') or {}).get(row['drillId'], {})
        block['trainingPolicyVersion'] = VERSION
        block['loadingInstructions'] = load.get('instruction') if policy.get('loaded') else policy['loadingInstructions']


def mark_plan_authorization(plan, catalog):
    """Server-computed marker used by log security rules; never trust client flags."""
    required = any(catalog.get(b.get('drillId'), {}).get('trainingPolicy')
                   for week in plan.get('weeks', []) for w in week.get('workouts', [])
                   for b in w.get('blocks', []))
    if required:
        plan['requiresTrainingStartAuthorization'] = True
    elif 'requiresTrainingStartAuthorization' in plan:
        plan['requiresTrainingStartAuthorization'] = False


def support_links(row, objective_id):
    policy = row.get('trainingPolicy') or {}
    if row.get('status') != 'published' or policy.get('reviewStatus') != 'approved': return []
    return [link for link in policy.get('evidenceLinks', [])
            if link['objectiveId'] == objective_id and link['relationship'] == 'support']
