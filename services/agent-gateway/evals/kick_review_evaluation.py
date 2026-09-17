"""Regression evaluation for approved kick-review-v1 exports.

Measures evidence-priority retention, not the clinical/biomechanical correctness
of prose. Human annotations remain the authority for prose and causal judgments.
Usage: python kick_review_evaluation.py reviews.jsonl candidates.jsonl
Candidate rows: {reviewId, sourceJobId, result:{focusAreas:[...]}}.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path

def athlete_split(player_id: str) -> str:
    bucket = int(hashlib.sha256(('kick-review-v1:' + player_id).encode()).hexdigest()[:8], 16) % 5
    return 'evaluation' if bucket == 0 else 'train'

def cited_ids(area: dict) -> set[str]:
    return {v for v in area.get('evidenceIds', area.get('metricIds', [])) if isinstance(v, str)}

def ordered(areas: list[dict]) -> list[dict]:
    return sorted(areas, key=lambda row: row.get('rank') if isinstance(row.get('rank'), (float, int)) and not isinstance(row.get('rank'), bool) and math.isfinite(row['rank']) else float('inf'))

def evaluate_case(review: dict, candidate: dict) -> dict:
    if review.get('datasetVersion') != 'kick-review-v1' or review.get('schemaVersion') != 1:
        raise ValueError('Unsupported dataset version')
    if review.get('split') != athlete_split(review['playerId']):
        raise ValueError('Athlete split mismatch')
    source = review.get('source') or {}
    if source.get('mode') != 'agent' or not source.get('jobId') or not source.get('resultHash'):
        raise ValueError('An immutable agent source is required for regression scoring')
    if candidate.get('reviewId') != review.get('reviewId') or candidate.get('sourceJobId') != source['jobId']:
        raise ValueError('Candidate does not match the reviewed source')
    expected = ordered((review.get('expected') or {}).get('focusAreas', []))
    actual = ordered((candidate.get('result') or {}).get('focusAreas', []))
    expected_sets = [cited_ids(area) for area in expected]
    actual_sets = [cited_ids(area) for area in actual]
    all_actual = set().union(*actual_sets) if actual_sets else set()
    scorable = [ids for ids in expected_sets if ids]
    matched = sum(bool(ids & all_actual) for ids in scorable)
    first_expected = expected_sets[0] if expected_sets else set()
    first_actual = actual_sets[0] if actual_sets else set()
    original = review.get('original') or {}
    evidence = original.get('evidence') or {}
    evidence_rows = evidence.get('rows', []) if isinstance(evidence, dict) else evidence
    source_rows = {row['id']: row for row in [*original.get('metrics', []), *evidence_rows, *original.get('differences', [])]
                   if isinstance(row, dict) and isinstance(row.get('id'), str)}
    known = {row['id'] for row in source_rows.values()
             if isinstance(row, dict) and isinstance(row.get('id'), str)
             and row.get('eligible', row.get('valid', True)) is True and row.get('comparable', True) is True}
    unknown = sorted(all_actual - known)
    # Empty expert selection is meaningful; adding faults is a regression signal.
    unexpected_focus = len(actual) if not expected else 0
    return {'reviewId':review['reviewId'], 'split':review['split'],
        'expectedPriorities':len(expected), 'scorablePriorities':len(scorable),
        'matchedPriorities':matched,
        'priorityEvidenceRecall':matched / len(scorable) if scorable else None,
        'firstPriorityRetainedFirst':bool(first_expected & first_actual) if first_expected else None,
        'unknownEvidenceIds':unknown, 'unexpectedFocusCount':unexpected_focus,
        'requiresHumanReview':True, 'hasUnscoredPriorities':len(scorable) != len(expected),
        'passesStructuralChecks':not unknown and unexpected_focus == 0 and matched == len(scorable)
            and (not first_expected or bool(first_expected & first_actual)),
        'limitations':['Shared evidence does not establish agreement on diagnosis, cue, importance, or causation.',
                      'Free-text notes and priorities without evidence citations require human judgment.']}

def evaluate_dataset(reviews: list[dict], candidates: list[dict], split: str = 'evaluation') -> dict:
    if split not in ['evaluation', 'train', 'all']: raise ValueError('Invalid split')
    ids = [r.get('reviewId') for r in reviews]
    if len(ids) != len(set(ids)): raise ValueError('Duplicate review revisions in dataset')
    targets = [(r.get('playerId'), r.get('targetType'), r.get('targetId')) for r in reviews]
    if len(targets) != len(set(targets)): raise ValueError('Export must contain only one current approved revision per target')
    candidates_by_id = {}
    for c in candidates:
        if c.get('reviewId') in candidates_by_id: raise ValueError('Duplicate candidate')
        candidates_by_id[c.get('reviewId')] = c
    rows, skipped, missing = [], [], []
    for review in reviews:
        if review.get('split') != athlete_split(review['playerId']): raise ValueError('Athlete split mismatch')
        if split != 'all' and review.get('split') != split: continue
        if (review.get('source') or {}).get('mode') != 'agent':
            skipped.append({'reviewId':review.get('reviewId'), 'reason':'Manual annotation has no agent baseline; human review only'})
            continue
        candidate = candidates_by_id.get(review.get('reviewId'))
        if candidate is None:
            missing.append(review.get('reviewId'))
            continue
        rows.append(evaluate_case(review, candidate))
    count = sum(r['scorablePriorities'] for r in rows)
    return {'datasetVersion':'kick-review-v1', 'split':split, 'evaluated':len(rows),
        'priorityEvidenceRecall':sum(r['matchedPriorities'] for r in rows) / count if count else None,
        'missingCandidates':missing, 'skipped':skipped, 'cases':rows,
        'status':'no_evidence' if not rows else 'incomplete' if missing else 'regression' if not all(r['passesStructuralChecks'] for r in rows)
            else 'human_review_required' if any(r['hasUnscoredPriorities'] for r in rows) else 'pass',
        'qualityClaim':'Structural evidence regression only; technique and prose require expert review.'}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reviews', type=Path)
    parser.add_argument('candidates', type=Path)
    parser.add_argument('--split', choices=['evaluation', 'train', 'all'], default='evaluation')
    args = parser.parse_args()
    read = lambda path: [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    result = evaluate_dataset(read(args.reviews), read(args.candidates), args.split)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['status'] == 'pass' else 1)

if __name__ == '__main__': main()
