"""Reviewed test-to-practice links, independent of catalog publication and dose.

A low overall time identifies a task to practice, not a biomechanical diagnosis.
Only reviewed teaching-content identities can claim a metric-specific link.
"""
from functools import lru_cache
import hashlib
import json
from pathlib import Path

VERSION = 'evidence-objectives-v1'


def format_metric(metric, value):
    if metric == 'ballSpeed':
        return f'{value * 2.23694:.1f} mph'
    if metric == 'verticalJumpHeight':
        return f'{value * 39.37007874015748:.1f} in'
    if metric == 'broadJumpDistance':
        return f'{value * 3.28084:.1f} ft'
    return f'{value:.2f} s'


@lru_cache(maxsize=1)
def methodology():
    return json.loads((Path(__file__).resolve().parents[1] / 'knowledge/personalized_objectives_v1.json').read_text())


def content_hash(row):
    value = {key: row.get(key) for key in ('name', 'domain', 'howTo')}
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def reviewed_drills(objective, catalog):
    existing = [entry['drillId'] for entry in objective['drills'] if entry['drillId'] in catalog
            and catalog[entry['drillId']]['domain'] == objective['domain']
            and catalog[entry['drillId']]['status'] == 'published'
            and content_hash(catalog[entry['drillId']]) == entry['contentSha256']]
    # New human-reviewed direct task links can extend the curriculum. Capacity
    # support remains outside the required direct-primary set, even at weight .5.
    additions = [did for did, row in catalog.items() if row.get('domain') == objective['domain']
                 and row.get('status') == 'published'
                 and row.get('trainingPolicy', {}).get('reviewStatus') == 'approved'
                 and any(link.get('objectiveId') == objective['id'] and link.get('relationship') == 'direct'
                         and link.get('weight') == 1 and link.get('sourceIds')
                         for link in row.get('trainingPolicy', {}).get('evidenceLinks', []))]
    return list(dict.fromkeys(existing + sorted(additions)))


def goal_domains(profile):
    aliases = {'firstTouch': 'receiving', 'strengthPower': 'strength', 'faster': 'speed',
               'betterShooter': 'shooting', 'betterDribbler': 'dribbling'}
    goals = []
    for goal in profile['intake'].get('goals', []):
        # The old combined control expresses both intentions, never silently
        # reroutes an agility estimate into a measured sprint objective.
        goals.extend(('speed', 'agility') if goal == 'speedAgility' else (aliases.get(goal, goal),))
    return list(dict.fromkeys(goals))


def objective_rows(profile, catalog):
    best = profile.get('bestResults', {}); goals = goal_domains(profile); output = []
    estimates = {e['drill']: e for e in profile.get('conditionalEstimates', [])}
    category_scores = {}
    for row in best.values():
        category_scores.setdefault(row['category'], []).append(row['score'])
    category_scores = {c: sum(v)/len(v) for c, v in category_scores.items()}
    strongest = max(category_scores.values(), default=0)
    for spec in methodology()['objectives']:
        metric = best.get(spec['metricId']); estimate = estimates.get({'dribbleTotalTime': 'dribbling', 'codTotalTime': 'changeOfDirection'}.get(spec['metricId']))
        if not metric and not estimate:
            continue
        basis = 'measured' if metric else 'conditionalEstimate'
        score = category_scores[metric['category']] if metric else None
        ids = reviewed_drills(spec, catalog) if catalog is not None else [r['drillId'] for r in spec['drills']]
        supported = bool(metric and metric['score'] < 85 and (score < 65 or score < 85 and strongest-score >= 20))
        names = {'ballSpeed': 'shooting speed', 'sprintCompletionTime': 'sprint completion',
                 'verticalJumpHeight': 'vertical jump', 'broadJumpDistance': 'broad jump',
                 'codTotalTime': 'no-ball shuttle completion', 'dribbleTotalTime': 'dribbling completion'}
        name = names[spec['metricId']]
        value = format_metric(spec['metricId'], metric['bestCanonical']) if metric else f'{estimate["estimatedTotalSeconds"]:g} s [{estimate["lowerSeconds"]:g}–{estimate["upperSeconds"]:g}]'
        reason = (f'Measured {name}: {value}; primary score {metric["score"]:.2f}/100 against a provisional product reference. '
                  if metric else f'Conditional completion estimate {value}, used only as supporting planning evidence. ')
        is_goal = spec['domain'] in goals
        if is_goal:
            reason += 'This area was also selected as a training goal; supporting emphasis does not imply a measured weakness. '
        limitation = ('Repeatability and a specific technical cause are not established; this is not a peer ranking.' if metric else estimate['limitation'])
        if not ids:
            limitation += ' No reviewed relevant exercise is currently eligible; general domain practice is not a substitute for a supported metric-specific selection.'
        output.append({'id': spec['id'], 'objectiveId': spec['id'], 'domain': spec['domain'], 'label': spec['label'],
            'role': 'support' if supported or estimate or is_goal else 'maintain', 'evidenceBasis': basis, 'confidence': 'low',
            'reason': reason + spec['trainingLink'], 'limitation': limitation, 'metricIds': [spec['metricId']] if metric else [],
            'progressCheck': spec['progressCheck'], 'eligibleDrillCount': len(ids), 'eligibleDrillIds': ids,
            'score': score, 'componentScore': metric['score'] if metric else None, 'supportedPrimary': supported,
            'goalRequested': is_goal})
    represented = {r['domain'] for r in output}
    from gateway.program_profile import DOMAINS
    domains = sorted({r['domain'] for r in catalog.values()}) if catalog is not None else list(DOMAINS)
    for domain in domains:
        if domain in represented:
            continue
        is_goal = domain in goals
        output.append({'id': 'general_' + domain, 'objectiveId': 'general_' + domain, 'domain': domain,
            'label': f'{domain.capitalize()} practice', 'role': 'support' if is_goal else 'maintain',
            'evidenceBasis': 'goal' if is_goal else 'baseline', 'confidence': 'low',
            'reason': f'{domain.capitalize()} is an explicit training goal.' if is_goal else f'Age, position and available curriculum support general {domain} practice.',
            'limitation': 'No measured deficit or specific technical cause is inferred.', 'metricIds': [],
            'progressCheck': 'Review completed practice, control and coach observations before changing emphasis.',
            'eligibleDrillCount': sum(r['domain'] == domain for r in (catalog or {}).values()),
            'eligibleDrillIds': [], 'score': None, 'componentScore': None, 'supportedPrimary': False, 'goalRequested': is_goal})
    return output


def rank_drills(catalog, profile, prior_core=()):
    prior = set(prior_core or ()); preferred = {'foundation': 1, 'club': 2, 'performance': 3}[profile['level']]
    priorities = profile.get('trainingPriorities', [])
    def relevance(did):
        matches = [(p['rank'], p['eligibleDrillIds'].index(did)) for p in priorities if did in p.get('eligibleDrillIds', [])]
        if profile.get('wholeBody'):
            from gateway.whole_body import support_links
            matches += [(p['rank'] + .5, 0) for p in priorities
                        if support_links(catalog[did], p['objectiveId'])]
        return min(matches) if matches else (999, 999)
    # Retention remains a hard weekly constraint. Reviewed task relevance comes
    # before a historical ID preference; difficulty never overrides eligibility.
    return sorted(catalog, key=lambda did: (relevance(did), did not in prior,
        abs(catalog[did]['difficultyLevel']-preferred), did))


def block_rationale(row, priorities, catalog):
    specs = {s['id']: s for s in methodology()['objectives']}
    matches = [p for p in priorities if p['domain'] == row['domain']]
    direct = [p for p in matches if p['objectiveId'] in specs and row['drillId'] in reviewed_drills(specs[p['objectiveId']], catalog)]
    from gateway.whole_body import support_links
    support = [p for p in priorities if support_links(row, p['objectiveId'])]
    priority = min(direct or matches, key=lambda p: p['rank']) if matches else None
    if direct:
        basis = priority['evidenceBasis']; reason = priority['reason']; progress = priority['progressCheck']
        label = {'measured': 'Measured-test practice', 'conditionalEstimate': 'Conditional support', 'goal': 'Stated goal', 'baseline': 'General practice'}[basis]
        summary = f'{label}: {priority["label"]}. {row["name"]} provides reviewed relevant practice.'
    elif support:
        priority = min(support, key=lambda p: p['rank'])
        basis = priority['evidenceBasis']
        reason = (f'Reviewed capacity support for {priority["label"].lower()}. '
                  'The test does not identify a muscle weakness or establish that this exercise caused improvement.')
        progress = 'Review exercise control and completion separately from the standardized performance retest.'
        summary = f'Research-supported capacity practice: {row["name"]} supports {priority["label"].lower()}; no specific muscle weakness is inferred.'
    else:
        basis = 'goal' if priority and priority['evidenceBasis'] == 'goal' else 'baseline'
        reason = f'General {row["domain"]} practice fits this allocation. There is no reviewed metric-specific link for this exercise; no technical deficit is inferred.'
        progress = 'Review practice completion and control with the coach.'
        summary = f'General {row["domain"]} support: {row["name"]}. No specific measured weakness is attributed to this exercise.'
    return {'methodologyVersion': VERSION, 'objectiveId': priority['objectiveId'] if priority else 'general_' + row['domain'],
            'priorityId': priority['id'] if priority else 'general_' + row['domain'], 'evidenceBasis': basis,
            'confidence': 'low', 'reason': reason, 'progressCheck': progress}, summary[:200]


def annotate_workout(workout, priorities, catalog):
    for block in workout['blocks']:
        block['trainingRationale'], block['whyIncluded'] = block_rationale(catalog[block['drillId']], priorities, catalog)


def valid_rationale(value, block, plan, catalog):
    if not isinstance(value, dict) or set(value) != {'methodologyVersion', 'objectiveId', 'priorityId', 'evidenceBasis', 'confidence', 'reason', 'progressCheck'}:
        return False
    assessment = (plan or {}).get('assessment') or {}
    if assessment.get('methodologyVersion') != VERSION or value.get('methodologyVersion') != VERSION:
        return False
    row = catalog.get(block.get('drillId'))
    if not row:
        return False
    expected, summary = block_rationale(row, assessment.get('priorities', []), catalog)
    return value == expected and block.get('whyIncluded') == summary
