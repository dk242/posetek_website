"""Shared v3 allocator for native generation and reviewed admin plan drafts.

Fit legal whole doses to disclosed weekly domain targets and reviewed primary
objectives. Results pass the catalog, time, frequency, progression and
independent semantic validators before their route-specific persistence.
"""
from collections import Counter, defaultdict
from copy import deepcopy
from math import ceil
import time
import warnings
from threading import Lock

from gateway.errors import GatewayError
from gateway.program_composition import QUALITY, BALL, DOMAIN_LABELS, describe_intent
from gateway.workout_time import estimate_block

ENGINE_VERSION = "personalized-v1"
CURRENT_ENGINE_VERSION = "current-2026-09-08"
_SOLVER_LOCK = Lock()


def preserve_priority_targets(projection, split, budget, priorities):
    """A small measured target may fit a whole dose within tolerance. Do not
    erase it merely because the current engine's nominal target is sub-dose.
    The optimizer decides actual feasibility under all clock and domain bounds.
    """
    from gateway.program_focus import largest_remainder
    value=deepcopy(projection)
    original=largest_remainder(split,budget)
    restored={d:original[d] for d in priorities if original.get(d,0)>0 and not value['allocations'].get(d,0)}
    if not restored:return value
    recipients={d:max(0,m-original.get(d,0)) for d,m in value['allocations'].items() if d not in restored}
    repayment=largest_remainder(recipients,sum(restored.values()))
    for d,m in repayment.items():value['allocations'][d]-=m
    for d,m in restored.items():
        value['allocations'][d]=m
        value['foldedMinutesByDomain'].pop(d,None)
    value['preservedSmallPriorityTargets']=restored
    return value


def project_week_targets(projection, split, budget, priorities, sessions, capacity, primary_cap):
    """Fund whole-domain slots before solving; one session has at most four.

    Measured objectives retain their target. Lower-priority general domains
    can be folded transparently when a short schedule cannot hold every theme.
    Catalog, 40-percent and age-specific primary caps still bound recipients.
    """
    from gateway.program_focus import largest_remainder
    value = deepcopy(projection)
    primary = {p['domain'] for p in priorities if p['role'] == 'primary'}
    nominal = largest_remainder(split, budget)
    ceilings = {d: int(min(40, capacity.get(d,40))*budget//100) for d in value['allocations']}
    group_ceiling = int(primary_cap*budget//100)
    priority_rank = {d: min((p['rank'] for p in priorities if p['domain'] == d), default=999) for d in value['allocations']}
    unassigned = 0; capped = {}
    # The inherited whole-dose projection can already have redistributed more
    # than these limits. Normalize that input before testing further increments.
    for domain, amount in value['allocations'].items():
        removed = max(0, amount-ceilings[domain])
        if removed:
            value['allocations'][domain] -= removed
            capped[domain] = removed; unassigned += removed
    while sum(value['allocations'].get(d,0) for d in primary) > group_ceiling:
        reducible = [d for d in primary if value['allocations'].get(d,0) > 1]
        if not reducible:
            raise GatewayError('context_unavailable','The measured-priority cap cannot retain positive work for every primary objective.')
        domain = max(reducible,key=lambda d:(value['allocations'][d]-nominal.get(d,0),
                                            value['allocations'][d],priority_rank[d],d))
        value['allocations'][domain] -= 1
        capped[domain] = capped.get(domain,0)+1; unassigned += 1
    if any(value['allocations'].get(d,0) <= 0 for d in primary):
        raise GatewayError('context_unavailable','The schedule cannot retain a positive target for every primary objective.')
    funded = [d for d, m in value['allocations'].items() if m > 0]
    if not capped and len(funded) <= 4*sessions:
        return value
    keep = set(sorted(funded, key=lambda d: (d not in primary, priority_rank[d], -split[d], d))[:4*sessions])
    if not primary <= keep:
        raise GatewayError('context_unavailable', 'The schedule cannot hold every primary objective; add a session or review priorities.')
    for domain in funded:
        if domain in keep:
            continue
        amount = value['allocations'][domain]
        unassigned += amount; value['allocations'][domain] = 0
        value.setdefault('foldedMinutesByDomain', {})[domain] = amount
    while unassigned:
        recipients = [d for d in keep if value['allocations'][d] < ceilings[d]
                      and (d not in primary or sum(value['allocations'][p] for p in primary) < group_ceiling)]
        if not recipients:
            break
        domain = min(recipients, key=lambda d: (value['allocations'][d]/max(1, split[d]), priority_rank[d], d))
        value['allocations'][domain] += 1; unassigned -= 1
    value.update(domainSlotLimit=4*sessions, unallocatedMinutes=unassigned,cappedMinutesByDomain=capped,
                 projectionReason='Whole-dose targets were reconciled with the age, catalog and four-domains-per-session limits. Unallocated minutes remain explicit when those limits prevent redistribution.')
    return value


def allocation_check(week, targets, priority_domains=()):
    actual = Counter()
    for workout in week['workouts']:
        for block in workout['blocks']:
            actual[block['domain']] += estimate_block(block)['estimatedMinutes']
    rows = []
    for domain in sorted(set(targets) | set(actual)):
        target = targets.get(domain, 0)
        tolerance = max(5, target * .1) if target else 0
        difference = actual[domain] - target
        met = abs(difference) <= tolerance and (domain not in priority_domains or actual[domain] > 0)
        rows.append({'domain': domain, 'targetMinutes': target, 'actualMinutes': actual[domain],
                     'differenceMinutes': difference, 'toleranceMinutes': tolerance, 'met': met})
    return {'passed': all(r['met'] for r in rows), 'policyVersion': ENGINE_VERSION, 'domains': rows}


def _progression_options(row, original, profile):
    """Consolidation or a bounded reps-only progression, keeping sets and rest."""
    fields = ('sets', 'reps', 'repUnit', 'perSide', 'restSeconds', 'restScope',
              'restBetweenSetsSeconds', 'familiarizationReps')
    base = {k: original[k] for k in fields if k in original}
    if row.get('trainingPolicy', {}).get('progression') == 'coachReviewed':
        return [{**base, 'estimatedMinutes': estimate_block(base)['estimatedMinutes']}]
    horizon = max(5, profile['intake'].get('horizonWeeks', 2) - 1)
    step = min(max(1, (row['dose']['repsMax'] - row['dose']['repsMin']) // horizon), max(1, base['reps'] // 10))
    choices = []
    for reps in sorted({base['reps'], min(row['dose']['repsMax'], base['reps'] + 1),
                        min(row['dose']['repsMax'], base['reps'] + step)}):
        value = {**base, 'reps': reps}
        value['estimatedMinutes'] = estimate_block(value)['estimatedMinutes']
        choices.append(value)
    return choices


def compose_personalized_week(profile, catalog, options, ranking, targets, frequency, *,
                              week_number, previous_week=None, priority_domains=(), objective_priorities=(), primary_cap_minutes=None, time_limit=20):
    from scipy.optimize import Bounds, LinearConstraint, milp
    from scipy.sparse import coo_matrix
    import numpy as np

    started = time.monotonic()
    sessions = profile['intake']['sessionsPerWeek']
    minutes = profile['intake']['minutesPerSession']
    session_tolerance = max(5, minutes * .1)
    weekly_tolerance = max(5, sessions * minutes * .1)
    domains = sorted(d for d, value in targets.items() if value > 0)
    prior = {w['order']: {b['drillId']: b for b in w['blocks']}
             for w in (previous_week or {}).get('workouts', [])}
    prior_core = {did for rows in prior.values() for did in rows}
    rank = {did: n for n, did in enumerate(ranking)}

    costs, lower, upper, integer = [], [], [], []
    def variable(cost=0., hi=1., binary=True):
        idx = len(costs)
        costs.append(cost); lower.append(0.); upper.append(hi); integer.append(int(binary))
        return idx

    rows, lows, highs = [], [], []
    def constraint(coefficients, lo=-np.inf, hi=np.inf):
        rows.append(coefficients); lows.append(lo); highs.append(hi)

    choices = {}
    by_session, by_drill, by_domain, by_slot_drill = (defaultdict(list) for _ in range(4))
    by_slot_domain = defaultdict(list)
    for slot in range(1, sessions + 1):
        for did in ranking:
            row = catalog[did]
            from gateway.whole_body import session_allowed
            if not session_allowed(row, profile, week_number, slot):
                continue
            if row['domain'] not in domains or frequency.get(did, 0) >= row['maxFrequencyPerWeek']:
                continue
            old = prior.get(slot, {}).get(did)
            legal = _progression_options(row, old, profile) if old else options[did]
            for dose in legal:
                if dose['estimatedMinutes'] > minutes + session_tolerance:
                    continue
                if row.get('trainingPolicy'):
                    from gateway.whole_body import quantities
                    amounts = quantities(dose, row)
                    if any(count > row['trainingPolicy']['limits'].get(unit+'PerSession', 0)
                           for unit, count in amounts.items()):
                        continue
                # Allocation and time errors dominate these small preferences.
                cost = .02 + rank[did] * (.001 if objective_priorities else .00001) + slot * .0000001
                if old:
                    cost -= .01
                    if dose['reps'] > old['reps']:
                        cost -= .001
                idx = variable(cost)
                choices[idx] = (slot, did, dose)
                by_session[slot].append(idx); by_drill[did].append(idx)
                by_domain[row['domain']].append(idx); by_slot_drill[(slot, did)].append(idx)
                by_slot_domain[(slot, row['domain'])].append(idx)
    if not choices:
        raise GatewayError('context_unavailable', 'No legal doses are available for the personalized weekly targets.')

    # A drill can appear at most once in a session, within its whole-week cap.
    for indices in by_slot_drill.values():
        constraint({i: 1 for i in indices}, hi=1)
    for did, indices in by_drill.items():
        constraint({i: 1 for i in indices}, hi=catalog[did]['maxFrequencyPerWeek'] - frequency.get(did, 0))
        if catalog[did].get('trainingPolicy'):
            from gateway.whole_body import quantities
            for unit in ('sets', 'contacts', 'holdSeconds'):
                constraint({i: quantities(choices[i][2], catalog[did])[unit] for i in indices},
                           hi=catalog[did]['trainingPolicy']['limits'].get(unit+'PerWeek', 0))

    if any(row.get('trainingPolicy') for row in catalog.values()):
        from gateway.whole_body import families_for, quantities, session_date, recovery_days
        limits = profile.get('wholeBody', {}).get('readiness', {}).get('limits') or {}
        families = set().union(*(families_for(row) for row in catalog.values()))
        family_flags = {}
        for family in families:
            entries = [i for i, (_, did, _) in choices.items() if family in families_for(catalog[did])]
            for unit in ('sets', 'contacts', 'holdSeconds'):
                if limits.get(unit+'PerWeek'):
                    constraint({i: quantities(choices[i][2], catalog[choices[i][1]])[unit] for i in entries}, hi=limits[unit+'PerWeek'])
            for slot in range(1, sessions+1):
                slots = [i for i in entries if choices[i][0] == slot]
                flag = variable(); family_flags[(family, slot)] = flag
                constraint({**{i: 1 for i in slots}, flag: -12}, hi=0)
                constraint({**{i: 1 for i in slots}, flag: -1}, lo=0)
                for unit in ('sets', 'contacts', 'holdSeconds'):
                    if limits.get(unit+'PerSession'):
                        constraint({i: quantities(choices[i][2], catalog[choices[i][1]])[unit] for i in slots}, hi=limits[unit+'PerSession'])
            policies = [r['trainingPolicy'] for r in catalog.values() if r.get('trainingPolicy') and family in families_for(r)]
            if policies:
                gap = max(recovery_days(p, profile) for p in policies)
                context = profile['intake'].get('trainingContext') or {}
                for a in range(1, sessions+1):
                    for b in range(a+1, sessions+1):
                        day_a, day_b = session_date(context, week_number, a), session_date(context, week_number, b)
                        if day_a and day_b and abs((day_b-day_a).days) < gap:
                            constraint({family_flags[(family,a)]:1, family_flags[(family,b)]:1}, hi=1)

    weekly_clock = {}
    for slot in range(1, sessions + 1):
        indices = by_session[slot]
        constraint({i: 1 for i in indices}, lo=1, hi=12)
        # One minute between blocks: sum(blockMinutes + 1) - 1.
        clock = {i: choices[i][2]['estimatedMinutes'] + 1 for i in indices}
        weekly_clock.update(clock)
        constraint(clock, lo=minutes + 1 - session_tolerance, hi=minutes + 1 + session_tolerance)
        error = variable(2., hi=session_tolerance, binary=False)
        constraint({**clock, error: -1}, hi=minutes + 1)
        constraint({**clock, error: 1}, lo=minutes + 1)
        domain_flags = []
        for domain in domains:
            flag = variable()
            domain_flags.append(flag)
            entries = by_slot_domain[(slot, domain)]
            constraint({**{i: 1 for i in entries}, flag: -12}, hi=0)
            constraint({**{i: 1 for i in entries}, flag: -1}, lo=0)
        constraint({i: 1 for i in domain_flags}, hi=4)
    constraint(weekly_clock, lo=sessions * minutes + sessions - weekly_tolerance,
               hi=sessions * minutes + sessions + weekly_tolerance)

    # Explicit domain constraints keep clock-fitting from erasing priorities.
    for domain in domains:
        target = targets[domain]
        tolerance = max(5, target * .1)
        volume = {i: choices[i][2]['estimatedMinutes'] for i in by_domain[domain]}
        minimum = max(0, target - tolerance, 1 if domain in priority_domains else 0)
        constraint(volume, lo=minimum, hi=target + tolerance)
        error = variable(10. if domain in priority_domains else 5., hi=tolerance, binary=False)
        constraint({**volume, error: -1}, hi=target)
        constraint({**volume, error: 1}, lo=target)

    # Every primary objective needs a reviewed relevant exercise, not merely
    # another exercise in the same broad domain.
    for priority in objective_priorities:
        if priority['role'] != 'primary':
            continue
        ids = set(priority.get('eligibleDrillIds', []))
        indices = [i for did in ids for i in by_drill[did]]
        if not indices:
            raise GatewayError('context_unavailable', 'No legal reviewed exercise remains for a primary objective. Review available time, equipment or curriculum.')
        constraint({i: 1 for i in indices}, lo=1)

    # Per-domain fitting tolerances must not silently increase the combined
    # age/level allowance for measured priorities.
    if primary_cap_minutes is not None and priority_domains:
        constraint({i: choices[i][2]['estimatedMinutes'] for d in priority_domains for i in by_domain[d]},
                   hi=primary_cap_minutes)

    # Preserve the existing >=60% distinct-drill retention rule across weeks.
    if prior_core:
        retained = []
        for did in sorted(prior_core):
            flag = variable()
            retained.append(flag)
            constraint({**{i: 1 for i in by_drill[did]}, flag: -1}, lo=0)
        constraint({i: 1 for i in retained}, lo=ceil(.6 * len(prior_core)))

    rr, cc, vv = [], [], []
    for r, values in enumerate(rows):
        for c, value in values.items():
            rr.append(r); cc.append(c); vv.append(value)
    matrix = coo_matrix((vv, (rr, cc)), shape=(len(rows), len(costs))).tocsc()
    if not _SOLVER_LOCK.acquire(timeout=25):
        raise GatewayError('context_unavailable','Allocation service is busy. Retry this draft after the current batch finishes.')
    try:
        # SciPy forwards solver-specific options to HiGHS. Keep this CPU-bound
        # stage single-threaded and serialize native calls within each process.
        with warnings.catch_warnings():
            warnings.filterwarnings('ignore',message='Unrecognized options detected.*threads.*',category=RuntimeWarning)
            result = milp(np.array(costs), integrality=np.array(integer), bounds=Bounds(lower, upper),
                          constraints=LinearConstraint(matrix, lows, highs),
                          options={'time_limit': max(1, time_limit), 'mip_rel_gap': .005, 'threads':1})
    finally:
        _SOLVER_LOCK.release()
    if result.x is None:
        message = ('No legal weekly combination can meet this player’s targets with the selected time, equipment and frequency limits.'
                   if result.status == 2 else 'The allocation search reached its limit. Try a smaller batch or shorter horizon.')
        raise GatewayError('context_unavailable', message)
    solution = np.array(result.x)
    binary_positions = np.array(integer, dtype=bool)
    if np.any(np.abs(solution[binary_positions] - np.rint(solution[binary_positions])) > 1e-5):
        raise GatewayError('validation_failed', 'Allocation search returned an incomplete solution.')
    solution[binary_positions] = np.rint(solution[binary_positions])
    evaluated = matrix @ solution
    if np.any(evaluated < np.array(lows) - 1e-5) or np.any(evaluated > np.array(highs) + 1e-5):
        raise GatewayError('validation_failed', 'Allocation search did not satisfy the required weekly constraints.')

    work_orders = []
    for slot in range(1, sessions + 1):
        selected = [(did, deepcopy(dose)) for idx, (s, did, dose) in choices.items() if s == slot and solution[idx] > .5]
        actual = Counter()
        for did, dose in selected:
            actual[catalog[did]['domain']] += dose['estimatedMinutes']
        focuses = sorted(actual, key=lambda d: (-actual[d], d))
        selected.sort(key=lambda item: (0 if catalog[item[0]]['domain'] in QUALITY else
                                       1 if catalog[item[0]]['domain'] in BALL else 2,
                                       focuses.index(catalog[item[0]]['domain']), rank[item[0]]))
        blocks = [{'drillId': did, **dose, 'kind': 'main',
                   'whyIncluded': f'Contributes {dose["estimatedMinutes"]} minutes toward the weekly {DOMAIN_LABELS[catalog[did]["domain"]]} target.'}
                  for did, dose in selected]
        work_orders.append({'weekNumber': week_number, 'order': slot,
                            'title': ' + '.join(DOMAIN_LABELS[d].capitalize() for d in focuses[:2])[:80],
                            'intent': describe_intent(selected, catalog), 'focusDomains': focuses,
                            'budgetMinutes': minutes, 'estimatedMinutes': sum(actual.values()) + len(blocks) - 1,
                            'blocks': blocks, 'domainBudgets': dict(actual), 'intentVersion': ENGINE_VERSION,
                            'priorWorkout': next((w for w in (previous_week or {}).get('workouts', []) if w['order'] == slot), None)})
    diagnostics = {'engineVersion': ENGINE_VERSION, 'latencyMs': round((time.monotonic() - started) * 1000),
                   'optimal': result.status == 0, 'variables': len(costs), 'constraints': len(rows)}
    return work_orders, diagnostics
