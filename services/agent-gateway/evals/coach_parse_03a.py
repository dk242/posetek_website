"""Validate the archived 14-note fixture offline; --live measures actual Flash parsing.

  python -m evals.coach_parse_03a
  GCP_PROJECT=kickai-69dd0 VERTEX_LOCATION=global python -m evals.coach_parse_03a \
      --live --gcloud-auth --record /private/tmp/coach-parse-03a-live.json

Live mode records each synthetic context, rendered prompt, response and usage.
There is one provider call per note, without repair or fallback. This isolates
classification quality; it does not exercise full program generation or auth.
Offline fixture validation is never reported as model-quality evidence.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager, nullcontext
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
from unittest.mock import patch

from gateway.program_profile import DOMAINS

FIXTURE = Path(__file__).parent / 'fixtures' / 'coach_notes_03a.json'
MAX_BUDGET_USD = 0.05


def sha(data):
    return hashlib.sha256(data).hexdigest()


def tagset(rows):
    return {(row['domain'], row['direction']) for row in rows}


def load_fixture(path=FIXTURE):
    fixture = json.loads(Path(path).read_text())
    cases = fixture.get('cases', [])
    if fixture.get('schemaVersion') != 1 or len(cases) != 14:
        raise ValueError('Expected the version-1 14-case fixture')
    ids = [case['id'] for case in cases]
    if len(set(ids)) != len(ids):
        raise ValueError('Fixture ids must be unique')
    if fixture.get('provenance', {}).get('kind') != 'original-03a-scratchpad-fixture':
        raise ValueError('Fixture provenance is required')
    for case in cases:
        if not isinstance(case.get('text'), str) or not case['text'].strip():
            raise ValueError('Every fixture needs nonempty note text')
        for key in [case['expect'], *case.get('acceptableAlternatives', [])]:
            if len(key) > 4 or len({pair[0] for pair in key}) != len(key):
                raise ValueError('Expected tags must contain at most four unique domains')
            if any(len(pair) != 2 or pair[0] not in DOMAINS or pair[1] not in ('more', 'less') for pair in key):
                raise ValueError('Unknown expected domain or direction')
        if not isinstance(case.get('structuredTags'), list) or not case.get('leakMarkers'):
            raise ValueError('Fixture needs structured tags and explicit leak-marker scope')
    return fixture


def score_response(case, structured, text=''):
    """Score a response independently of the model, without repairing its labels."""
    from jsonschema import Draft7Validator
    from gateway.program_generator import COACH_SCHEMA

    errors = list(Draft7Validator(COACH_SCHEMA).iter_errors(structured))
    schema_valid = not errors
    rows = structured.get('parsedEmphasis', []) if isinstance(structured, dict) else []
    # Count malformed rows as failed schema, never as an empty successful parse.
    got = tagset(rows) if schema_valid else set()
    unique = schema_valid and len(got) == len(rows) and len({r['domain'] for r in rows}) == len(rows)
    expected = {tuple(pair) for pair in case['expect']}
    matched = got & expected
    raw = text + '\n' + json.dumps(structured, ensure_ascii=False)
    leaks = [marker for marker in case['leakMarkers'] if marker.casefold() in raw.casefold()]
    exact = schema_valid and unique and got == expected
    alternatives = [{tuple(pair) for pair in key} for key in case.get('acceptableAlternatives', [])]
    inversions = sorted((domain, direction) for domain, direction in got
                        if (domain, 'less' if direction == 'more' else 'more') in expected)
    return {
        'expected': sorted(expected), 'got': sorted(got), 'schemaValid': schema_valid,
        'uniqueDomains': unique, 'schemaErrorCount': len(errors), 'exactMatch': exact,
        'acceptableMatch': schema_valid and unique and not leaks and (exact or got in alternatives),
        'directionInversions': inversions, 'leakMarkersFound': leaks,
        'truePositives': len(matched), 'falsePositives': len(got - expected),
        'falseNegatives': len(expected - got),
        'precision': len(matched) / len(got) if got else float(not expected and schema_valid),
        'recall': len(matched) / len(expected) if expected else float(not got and schema_valid),
    }


def summarize(rows):
    scores = [row['score'] for row in rows if 'score' in row]
    count = len(scores)
    tp = sum(s['truePositives'] for s in scores)
    fp = sum(s['falsePositives'] for s in scores)
    fn = sum(s['falseNegatives'] for s in scores)
    return {
        'completedCases': len(rows), 'scoredCases': count,
        'providerErrors': sum('error' in row for row in rows),
        'exactMatches': sum(s['exactMatch'] for s in scores),
        'acceptableMatches': sum(s['acceptableMatch'] for s in scores),
        'directionInversions': sum(len(s['directionInversions']) for s in scores),
        'schemaFailures': sum(not s['schemaValid'] or not s['uniqueDomains'] for s in scores),
        'leakDetections': sum(bool(s['leakMarkersFound']) for s in scores),
        'macroPrecision': sum(s['precision'] for s in scores) / count if count else None,
        'macroRecall': sum(s['recall'] for s in scores) / count if count else None,
        'microPrecision': tp / (tp + fp) if tp + fp else float(not fn),
        'microRecall': tp / (tp + fn) if tp + fn else float(not fp),
        'estimatedCostUsd': round(sum(r.get('estimatedCostUsd', 0) for r in rows), 9),
        'modelCalls': sum(len(r.get('providerCalls', [])) for r in rows),
        'latencyMs': sum(r.get('latencyMs', 0) for r in rows),
    }


@contextmanager
def gcloud_auth(project):
    """Explicit eval-only use of existing gcloud login; token stays in memory."""
    import google.auth
    import google.auth._default
    from google.oauth2.credentials import Credentials

    class GcloudUserCredentials(Credentials):
        def __init__(self):
            super().__init__(token=None)
            self.refresh(None)

        def refresh(self, request):
            result = subprocess.run(['gcloud', 'auth', 'print-access-token'],
                                    capture_output=True, text=True, timeout=30)
            if result.returncode or not result.stdout.strip():
                raise RuntimeError('Existing gcloud login token unavailable')
            self.token = result.stdout.strip()
            self.expiry = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=30)

    credentials = GcloudUserCredentials()
    with patch.object(google.auth, 'default', lambda *a, **k: (credentials, project)), \
            patch.object(google.auth._default, 'default', lambda *a, **k: (credentials, project)):
        yield


def save_record(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')
    path.chmod(0o600)


def run_benchmark(*, live=False, record=None, use_gcloud_auth=False, budget_usd=MAX_BUDGET_USD):
    fixture = load_fixture()
    artifact = {'schemaVersion': 1, 'fixtureSha256': sha(FIXTURE.read_bytes()),
                'fixtureProvenance': fixture['provenance'], 'scoring': fixture['scoring'],
                'mode': 'live' if live else 'offline', 'caseCount': len(fixture['cases']),
                'startedAt': datetime.now(timezone.utc).isoformat()}
    if not live:
        artifact.update(status='fixture_valid', actualModelCalls=0, actualModelSpendUsd=0,
                        modelQualityMeasured=False, metrics=None,
                        evidence='Fixture structure only; no model execution or classification-quality measurement.')
        if record:
            save_record(record, artifact)
        return artifact
    if record is None:
        raise ValueError('--live requires --record to retain actual contexts, responses and usage')
    if not 0 < budget_usd <= MAX_BUDGET_USD:
        raise ValueError('Live estimated budget must be positive and at most $0.05')
    project, location = os.getenv('GCP_PROJECT'), os.getenv('VERTEX_LOCATION')
    if not project or location not in ('global', 'us-east5', 'europe-west1', 'asia-southeast1'):
        raise ValueError('Live mode requires GCP_PROJECT and explicit supported VERTEX_LOCATION')
    from gateway.program_generator import COACH_SCHEMA
    from gateway.prompts import render_program_prompt
    from gateway.providers.base import get_provider, ModelMessage
    from gateway.registry import program_stage
    from gateway.usage import estimate_cost_usd

    stage = program_stage('coach_parse')
    if (stage.provider, stage.model, stage.params.get('thinking_budget'), stage.params.get('max_output_tokens')) != ('vertex_gemini', 'gemini-2.5-flash', 0, 512):
        raise ValueError('Review model/limits and budget before changing this Flash-only benchmark')
    requests = []
    for case in fixture['cases']:
        context = {'untrustedCoachNote': {'text': case['text'], 'structuredTags': case['structuredTags']},
                   'allowedDomains': list(DOMAINS)}
        system, user = render_program_prompt(stage.prompt, context)
        # Deliberately conservative input reservation: one token per UTF-8 byte,
        # including schema plus 1024 protocol bytes. Thinking is disabled and
        # output capped. This is a list-price estimate, not a billing guarantee.
        input_reserve = len((system + user + json.dumps(COACH_SCHEMA)).encode()) + 1024
        reserve = estimate_cost_usd(stage.model, {'inputTokens': input_reserve, 'outputTokens': 512}, provider=stage.provider)
        requests.append((case, context, system, user, reserve))
    total_reserve = sum(request[4] for request in requests)
    if total_reserve > budget_usd:
        raise ValueError('Conservative estimated reservation exceeds requested budget; no model call made')
    root = Path(__file__).parents[1]
    artifact.update(status='running', modelQualityMeasured=False, provider=stage.provider,
                    model=stage.model, params=stage.params, project=project, location=location,
                    estimatedBudgetUsd=budget_usd, reservedEstimateUsd=round(total_reserve, 9),
                    costIsEstimate=True, evidence='Actual Vertex responses; synthetic original 03A notes; no database writes.',
                    sourceHashes={name: sha((root / name).read_bytes()) for name in
                                  ['gateway/prompts.py', 'gateway/registry.py', 'gateway/program_generator.py',
                                   'gateway/providers/vertex_gemini.py', 'gateway/usage.py', 'evals/coach_parse_03a.py']},
                    rows=[])
    save_record(record, artifact)
    try:
        with gcloud_auth(project) if use_gcloud_auth else nullcontext():
            provider = get_provider(stage.provider)
            for case, context, system, user, reserve in requests:
                if summarize(artifact['rows'])['estimatedCostUsd'] + reserve > budget_usd:
                    artifact['status'] = 'budget_stopped'
                    break
                started = time.monotonic()
                events = []
                row = {'id': case['id'], 'context': context, 'systemPrompt': system, 'userPrompt': user,
                       'responseSchema': COACH_SCHEMA, 'providerCalls': events}
                try:
                    result = provider.generate(system=system, messages=[ModelMessage(role='user', content=user)],
                                               model=stage.model, params={**stage.params, '_usage_callback': events.append},
                                               json_schema=COACH_SCHEMA)
                    row.update(response={'text': result.text, 'structured': result.structured}, usage=result.usage,
                               score=score_response(case, result.structured, result.text))
                except Exception as exc:
                    # Provider exception text may include URLs/credentials; retain a
                    # typed failure and any metered calls without printing secrets.
                    row['error'] = {'type': type(exc).__name__, 'code': getattr(exc, 'code', None)}
                row['latencyMs'] = round((time.monotonic() - started) * 1000)
                row['estimatedCostUsd'] = round(sum(estimate_cost_usd(stage.model, e['usage'], provider=stage.provider) for e in events), 9)
                artifact['rows'].append(row)
                artifact['metrics'] = summarize(artifact['rows'])
                save_record(record, artifact)
                if 'error' in row:
                    artifact['status'] = 'provider_failed'
                    break
    except Exception as exc:
        artifact['status'] = 'setup_failed'
        artifact['error'] = {'type': type(exc).__name__, 'code': getattr(exc, 'code', None)}
    if artifact['status'] == 'running':
        artifact['status'] = 'complete'
    artifact['metrics'] = summarize(artifact['rows'])
    artifact['actualModelCalls'] = artifact['metrics']['modelCalls']
    artifact['modelQualityMeasured'] = artifact['metrics']['scoredCases'] > 0
    artifact['finishedAt'] = datetime.now(timezone.utc).isoformat()
    artifact['allAcceptable'] = (len(artifact['rows']) == 14 and artifact['metrics']['acceptableMatches'] == 14)
    save_record(record, artifact)
    return artifact


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true', help='Make 14 paid, recorded Flash classification calls')
    parser.add_argument('--gcloud-auth', action='store_true', help='Explicitly reuse signed-in gcloud user credentials in memory')
    parser.add_argument('--record', type=Path, help='New JSON result path; existing evidence is never overwritten')
    parser.add_argument('--budget-usd', type=float, default=MAX_BUDGET_USD)
    args = parser.parse_args(argv)
    if args.record and args.record.exists():
        parser.error('Record already exists; choose a new path')
    if args.gcloud_auth and not args.live:
        parser.error('--gcloud-auth is only valid with --live')
    try:
        artifact = run_benchmark(live=args.live, record=args.record, use_gcloud_auth=args.gcloud_auth, budget_usd=args.budget_usd)
    except (ValueError, RuntimeError, OSError) as exc:
        parser.exit(2, f'Benchmark setup failed ({type(exc).__name__}); no model-quality result claimed.\n')
    print(json.dumps({key: value for key, value in artifact.items() if key not in ('rows', 'sourceHashes')}, indent=2))
    return 0 if not args.live or artifact.get('allAcceptable') else 1


if __name__ == '__main__':
    raise SystemExit(main())
