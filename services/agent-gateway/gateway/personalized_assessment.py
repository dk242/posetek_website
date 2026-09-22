"""Shared v3 evidence-to-objective policy; executable engine contracts stay stable."""
from copy import deepcopy
from datetime import datetime, timezone
from gateway.program_profile import CATEGORY_DOMAIN, DOMAINS
from gateway.program_focus import compute_focus_split, _transfer
from gateway.personalized_objectives import VERSION, objective_rows, goal_domains

POLICY = {'version': VERSION, 'windowDays': 180, 'withinPlayerMaxScore': 85,
          'withinPlayerMinSpread': 20, 'maxPrimaryObjectives': 2}


def prepare_personalized_profile(inv, profile):
    from gateway.personalized_evidence import read_authoritative_results, reconcile_best_results, read_estimates
    profile = deepcopy(profile)
    evidence = read_authoritative_results(inv)
    dates = reconcile_best_results(inv, profile, evidence)
    estimates, private_estimates = read_estimates(inv, evidence=evidence)
    profile['conditionalEstimates'] = estimates
    profile['estimatePolicy'] = {'enabled': inv.params.get('useProvisionalEstimates', inv.capability == 'generate_training_plan'),
                                 'acceptedCount': len(estimates), 'source': 'reviewed_server_document'}
    profile['evidencePolicy'] = {**POLICY, 'status': 'recent_qualified_results' if dates else 'insufficient',
        'source': 'qualified_server_results_reconciled_snapshot', 'confidence': 'low',
        'oldestAt': datetime.fromtimestamp(min(dates)/1000, timezone.utc) if dates else None,
        'newestAt': datetime.fromtimestamp(max(dates)/1000, timezone.utc) if dates else None,
        'reason': 'Recent server-qualified best results and known benchmark anchors; repeatability is not established.' if dates else
                  'No supplied primary best result matched recent qualified recordings and a known score. Baseline and explicit goals still apply.'}
    inv.context.setdefault('_programPrivate', {})['authoritativeEvidence'] = evidence['private']
    inv.context['_programPrivate']['conditionalEvidence'] = private_estimates
    inv.context['programProfile'] = profile
    return profile


def compute_personalized_focus(profile, eligible_domains, parsed, capacity, *, catalog=None):
    # Reuse the reviewed age/position baseline and capacity redistribution only.
    baseline_profile = deepcopy(profile)
    baseline_profile.update(bestResults={}, measuredMetricIds=[], peer={}, stats={'categories': {}})
    baseline_profile['intake']['goals'] = []
    split = compute_focus_split(baseline_profile, eligible_domains, [], capacity)
    # Preserve truthful audit feedback about supplied aggregate-only scores.
    # These rows do not participate in allocation or create measured objectives.
    supported_categories = {row['category'] for row in profile.get('bestResults', {}).values()}
    categories = profile.get('stats', {}).get('categories', {})
    split['unevidencedLowScores'] = [{'category':category,'domain':domain,'score':categories[category]}
        for category,domain in CATEGORY_DOMAIN.items() if category not in supported_categories
        and categories.get(category) is not None and categories[category] < 65]
    base = split['base']; after = dict(base); available = set(eligible_domains) - {'ballMastery', 'games'}
    caps = split['capacityCapsPct']; cap = split['measuredPriorityMaxPct']
    priorities = objective_rows(profile, catalog)
    # Category comparison chooses domains; the individual power metric chooses
    # relevant exercises within plyometrics. A weak component is not averaged
    # away at exercise selection, nor allowed to crowd out two other domains.
    candidates = sorted([p for p in priorities if p['supportedPrimary']],
                        key=lambda p: (p['score'], p['componentScore'], p['id']))
    selected = []; selected_domains = []
    for priority in candidates:
        domain = priority['domain']
        if domain in selected_domains:
            continue
        if len(selected) >= 2:
            priority['limitation'] += ' Two stronger supported domains take the primary slots.'
        elif not priority['eligibleDrillCount'] or domain not in available:
            priority['limitation'] += ' No eligible reviewed exercise can implement this as a primary objective.'
        elif sum(base[d] for d in selected_domains) + base[domain] > cap:
            priority['limitation'] += ' The age/level measured-priority cap leaves this as supporting work.'
        else:
            priority['role'] = 'primary'; selected.append(priority); selected_domains.append(domain)
    # Reserve both baseline allocations, then apply whatever positive increment
    # fits. A partial +1/+2 is valid; the old all-or-nothing +5 lost the second.
    for priority in selected:
        domain = priority['domain']
        amount = min(3 if profile.get('position') == 'CB' and domain == 'dribbling' else 5,
                     max(0, cap - sum(after[d] for d in selected_domains)))
        _transfer(after, domain, amount, allowed=available, anchor=base, max_delta=5,
                  total_delta=20, protected=selected_domains, ceilings=caps)
    goals = goal_domains(profile)
    support_domains = list(dict.fromkeys(goals + [p['domain'] for p in priorities if p['evidenceBasis'] == 'conditionalEstimate']))
    for domain in support_domains:
        if domain in available and domain not in selected_domains and after[domain] < 35:
            _transfer(after, domain, min(3, 35-after[domain]), allowed=available, anchor=base,
                      max_delta=5, total_delta=20, protected=selected_domains, ceilings=caps)
    # Opt-in whole-body support uses the existing bounded nudge machinery.
    # It neither changes measured priorities nor counts strength minutes twice.
    if profile.get('wholeBody') and 'strength' in available and 'strength' not in selected_domains:
        from gateway.whole_body import support_links
        linked = any(row.get('domain') == 'strength' and any(support_links(row, p['objectiveId'])
                     for p in priorities if p['role'] in ('primary', 'support')) for row in (catalog or {}).values())
        if linked:
            _transfer(after, 'strength', min(5, max(0, 15-after['strength'])), allowed=available, anchor=base,
                      max_delta=5, total_delta=20, protected=selected_domains, ceilings=caps)
    coached = dict(after); unapplied = []
    for item in sorted(parsed or [], key=lambda p: (p.get('direction') != 'less', p.get('domain', ''))):
        domain = item.get('domain'); direction = item.get('direction'); strength = item.get('strength', 1)
        if domain not in available or direction not in ('more', 'less') or strength not in (.5, 1):
            unapplied.append({'domain': domain, 'direction': direction, 'reason': 'no_eligible_curriculum' if domain not in available else 'unsupported_request'})
            continue
        before = dict(coached)
        amount = (10 if strength == 1 else 5) * (1 if direction == 'more' else -1)
        # One point at a time also preserves the age-specific priority cap.
        for _ in range(abs(amount)):
            proposed = dict(coached)
            _transfer(proposed, domain, 1 if amount > 0 else -1, allowed=available, anchor=after,
                      max_delta=10, total_delta=30, ceilings=caps)
            if sum(proposed[d] for d in selected_domains) > cap or any(proposed[d] == 0 for d in selected_domains):
                break
            coached = proposed
        if coached == before:
            unapplied.append({'domain': domain, 'direction': direction, 'reason': 'bounds_or_capacity_exhausted'})
    weekly = profile['intake']['sessionsPerWeek'] * profile['intake']['minutesPerSession']
    priorities.sort(key=lambda p: (0 if p['role'] == 'primary' else 1 if p['evidenceBasis'] == 'conditionalEstimate' else
                                  2 if p['role'] == 'support' else 3, p['score'] if p['score'] is not None else 999,
                                  p['componentScore'] if p['componentScore'] is not None else 999, -coached.get(p['domain'], 0), p['id']))
    findings = []
    for rank, p in enumerate(priorities, 1):
        p.update(rank=rank, targetPct=coached.get(p['domain'], 0), weeklyTargetMinutes=round(weekly*coached.get(p['domain'], 0)/100, 1), allocationScope='domain')
        if p['role'] in ('primary', 'support'):
            basis = ('stated_goal' if p['goalRequested'] and not p['supportedPrimary'] and p['evidenceBasis'] != 'conditionalEstimate' else
                     'best_result_gap' if p['evidenceBasis'] == 'measured' and p['score'] < 65 else
                     'within_player_priority' if p['evidenceBasis'] == 'measured' else
                     'conditional_support' if p['evidenceBasis'] == 'conditionalEstimate' else 'stated_goal')
            findings.append({'domain': p['domain'], 'basis': basis, 'metricIds': p['metricIds'], 'confidence': 'low',
                'statement': p['reason'], 'targetBeforePct': base.get(p['domain'], 0), 'targetAfterEvidencePct': after.get(p['domain'], 0),
                'targetFinalPct': p['targetPct'], 'applied': p['role'] == 'primary' or after.get(p['domain'], 0) > base.get(p['domain'], 0),
                'limitation': p['limitation']})
    assert sum(coached.values()) == 100 and sum(after[d] for d in selected_domains) <= cap
    assert max(abs(after[d]-base[d]) for d in DOMAINS) <= 5 and sum(abs(after[d]-base[d]) for d in DOMAINS) <= 20
    split.update(afterGaps=after, afterCoachNudge=coached, final=coached, findings=findings,
        measuredPriorityDomains=selected_domains, primaryObjectiveIds=[p['id'] for p in selected],
        assessmentPolicyVersion=VERSION, methodologyVersion=VERSION, priorities=priorities,
        unappliedCoachRequests=unapplied, nudges=[{'domain': d, 'from': after[d], 'to': coached[d], 'source': 'coachFeedback'} for d in DOMAINS if after[d] != coached[d]])
    profile['trainingPriorities'] = priorities
    return split


def curriculum_report(catalog, profile, options):
    from gateway.catalog_v2 import eligible_drill
    from gateway.program_profile import DOMAINS
    rows = []
    for domain in DOMAINS:
        entries = [(did, row) for did, row in catalog.items() if row['domain'] == domain]
        eligible = []
        exclusions = {}
        for did, row in entries:
            ok, reasons = eligible_drill(row, profile, allow_partner=profile['intake']['setting'] in ('partner', 'halfAndHalf'))
            if domain in ('ballMastery', 'games'):
                ok, reasons = False, ['Not supported by the executable v3 planner']
            if ok and options.get(did):
                eligible.append(did)
            else:
                for reason in reasons or ['No legal dose']:
                    exclusions[str(reason)] = exclusions.get(str(reason), 0) + 1
        rows.append({'domain': domain, 'publishedDrills': sum(row['status']=='published' for _,row in entries), 'eligibleDrills': len(eligible),
                     'excludedReasons': exclusions, 'status': 'available' if eligible else 'unavailable'})
    return rows
