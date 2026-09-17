"""Versioned preview policy. Client result snapshots remain low-confidence evidence.

Within-player priorities are comparisons of provisional normalized scores, never
peer ranks. Unknown/stale snapshot windows cannot create a measured deficit.
"""
from copy import deepcopy
from datetime import timedelta
from gateway.program_profile import CATEGORY_DOMAIN, now_for, timestamp
from gateway.program_focus import compute_focus_split

POLICY = {'version': 'personalized-evidence-v1', 'windowDays': 180,
          'withinPlayerMaxScore': 85, 'withinPlayerMinSpread': 20,
          'maxAdditionalPriorities': 1}


def prepare_personalized_profile(inv, profile):
    profile = deepcopy(profile)
    window = inv.params.get('evidenceWindow') or {}
    if not isinstance(window,dict):
        from gateway.errors import invalid_request
        raise invalid_request('evidenceWindow must be a dated snapshot window')
    oldest, newest = timestamp(window.get('oldestAt')), timestamp(window.get('newestAt'))
    now = now_for(inv)
    valid = bool(oldest and newest and now - timedelta(days=180) <= oldest <= newest <= now)
    status = 'recent_snapshot' if valid and profile['bestResults'] else 'insufficient'
    if not valid:
        profile['bestResults'] = {}
        profile['dataGaps'].append('Testing snapshot has no valid 180-day evidence window; no best-result priority was inferred.')
    profile['evidencePolicy'] = {**POLICY, 'status': status,
        'source': 'authorized_client_snapshot', 'confidence': 'low',
        'oldestAt': oldest if valid else None, 'newestAt': newest if valid else None,
        'reason': 'Recent range-checked best results; repeatability is not established.' if status == 'recent_snapshot'
                  else 'No recent, dated primary results. Position/age baseline and explicit coach requests still apply.'}
    peer_evidence = inv.context.get('_programPrivate', {}).get('peerEvidence', {})
    own = peer_evidence.get('athleteMetrics', {})
    if profile['peer'].get('status') == 'unavailable':
        profile['peer']['reason'] = 'no_qualifying_athlete_protocol' if not own else 'insufficient_matched_protocol_peers'
        profile['peer']['evidencePolicy'] = peer_evidence.get('metricValidityPolicy', {})
    inv.context['programProfile'] = profile
    return profile


def compute_personalized_focus(profile, eligible_domains, parsed, capacity):
    best = profile.get('bestResults', {})
    scores = {category: sum(r['score'] for r in best.values() if r['category'] == category) /
              sum(r['category'] == category for r in best.values())
              for category in CATEGORY_DOMAIN if any(r['category'] == category for r in best.values())}
    additional = []
    strongest = max(scores.values(), default=0)
    for category, score in sorted(scores.items(), key=lambda pair: (pair[1], pair[0])):
        if 65 <= score < POLICY['withinPlayerMaxScore'] and strongest - score >= POLICY['withinPlayerMinSpread']:
            domain = CATEGORY_DOMAIN[category]
            mids = sorted(m for m, r in best.items() if r['category'] == category)
            additional.append({'domain': domain, 'basis': 'within_player_priority', 'score': score,
                'metricIds': mids, 'confidence': 'low',
                'statement': f'{category}: primary score {score:g}/100 is at least 20 points below this player’s strongest measured category. '
                             'This is a bounded development priority against provisional references, not a peer percentile or trend.'})
            break
    split = compute_focus_split(profile, eligible_domains, parsed, capacity, additional_priorities=additional)
    split['assessmentPolicyVersion'] = POLICY['version']
    for row in split['findings']:
        domain = row['domain']
        row['evidence'] = [{'metricId': mid, **best[mid]} for mid in row.get('metricIds', []) if mid in best]
        row['targetBeforePct'] = split['base'].get(domain, 0)
        row['targetAfterEvidencePct'] = split['afterGaps'].get(domain, 0)
        row['targetFinalPct'] = split['final'].get(domain, 0)
        row['applied'] = domain in split['measuredPriorityDomains'] if row['basis'] != 'stated_goal' else split['afterGaps'].get(domain, 0) > split['base'].get(domain, 0)
        if not row['applied']:
            row['limitation'] = 'No eligible curriculum' if domain not in eligible_domains else 'Allocation bounds or catalog capacity prevent an additional increase.'
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
