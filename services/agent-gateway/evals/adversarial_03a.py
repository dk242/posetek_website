"""Planted-failure benchmark: code rejects arithmetic failures, a model judges intent.

Offline is the default and never measures model quality. --live sends the three
deterministically valid cases once each, with no retries or repair. Gross missing
domains and time overruns are rejected before the model, as in production.
Synthetic workouts use the historical sanitized catalog snapshot and the current
methodology cb15 replay; they do not assert current live publication eligibility.
"""
from __future__ import annotations

import argparse
from contextlib import nullcontext
from copy import deepcopy
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import time

from evals.coach_parse_03a import gcloud_auth,save_record
from evals.program_v3 import run_profile,seed_invocation,seed_methodology_evidence
from gateway.catalog_v2 import load_catalog
from gateway.program_composition import dose_options
from gateway.program_profile import assemble_program_profile
from gateway.workout_tools import validate_workout

MAX_BUDGET_USD=.15
ROOT=Path(__file__).parents[1]
SOURCE_PATHS=('gateway/program_generator.py','gateway/program_composition.py','gateway/program_focus.py',
              'gateway/personalized_assessment.py','gateway/personalized_composition.py','gateway/personalized_objectives.py',
              'gateway/personalized_evidence.py','gateway/personalized_views.py','knowledge/personalized_objectives_v1.json',
              'gateway/prompts.py','gateway/registry.py','gateway/providers/vertex_gemini.py',
              'gateway/providers/anthropic_direct.py','gateway/usage.py','evals/adversarial_03a.py','evals/fixtures/catalog_v2.json',
              'evals/fixtures/replay/cb15.json')


def source_hashes():
    return {name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in SOURCE_PATHS}


def _finish(workout):
    for order,block in enumerate(workout['blocks'],1):
        block.update(order=order,blockId=f'b{order}')
    workout['nextBlockSequence']=len(workout['blocks'])+1
    workout['estimatedMinutes']=sum(b['estimatedMinutes'] for b in workout['blocks'])+max(0,len(workout['blocks'])-1)
    return workout


def build_cases():
    """Reconstruct the report's cases; no hard-coded/fabricated block minutes."""
    replay=run_profile('cb15')
    if not replay['passed'] or not replay.get('plan'):
        raise ValueError('Current cb15 replay must pass before using its honest control')
    plan=replay['plan'];inv=seed_methodology_evidence(seed_invocation('cb15'),'cb15')
    profile=assemble_program_profile(inv);catalog=load_catalog(inv)
    good=deepcopy(plan['weeks'][0]['workouts'][0])
    for key in ('check','revision','editedBy','editorUid','editedAt','previousRevision'):
        good.pop(key,None)

    def block_for(drill_id,hint):
        row=catalog[drill_id]
        option=min(dose_options(row),key=lambda value:abs(value['estimatedMinutes']-hint))
        return {**option,'drillId':drill_id,'name':row['name'],'domain':row['domain'],
                'kind':'main','whyIncluded':'Build capability through repeatable practice.'}

    # Same legal doses as the original 03A plant2.py experiment: 59/60 minutes,
    # every declared domain present, but shooting dominates the dribbling claim.
    inverted=deepcopy(good)
    inverted.update(title='Dribbling + Passing',
                    intent='Practice dribbling and passing. The bulk of this session is dribbling with both feet; passing supports it, with a short finishing touch at the end.',
                    focusDomains=['dribbling','passing','shooting'],
                    blocks=[block_for(did,hint) for did,hint in [('DRB-006',3),('PAS-001',3),('SHT-002',26),('SHT-005',12),('SHT-010',11)]])
    _finish(inverted)
    honest=deepcopy(inverted)
    honest.update(title='Shooting + Dribbling',
                  intent='Practice shooting with some dribbling and passing. Most of the session is finishing volume with catalog rest.',
                  focusDomains=['shooting','dribbling','passing'])
    # Isolate domain failure from time/dose: the unchanged control blocks are
    # honestly timed but cannot fulfil the newly claimed receiving curriculum.
    gross=deepcopy(good)
    gross.update(title='First touch practice',intent='Spend this session receiving passes and controlling the first touch.',focusDomains=['receiving'])
    # Isolate time failure without creating unsafe/illegal training doses.
    overrun=deepcopy(good);overrun['budgetMinutes']=40
    definitions=[('honest_control',good,True,True),('gross_absent_domain',gross,False,False),
                 ('subtle_emphasis_inversion',inverted,True,False),('time_overrun',overrun,False,False),
                 ('honest_relabel_same_blocks',honest,True,True)]
    cases=[]
    for ident,workout,expected_gate,expected_accept in definitions:
        check=validate_workout(workout,catalog,profile,frequency={},plan=plan,
                               target={'kind':'generation','jobId':inv.job_id,'weekNumber':1,'order':1},allow_partner=False)
        if check['ok'] is not expected_gate:
            raise ValueError(f'Fixture drift changed the deterministic boundary for {ident}')
        cases.append({'id':ident,'expectedDeterministicPass':expected_gate,'expectedAccepted':expected_accept,
                      'context':{'workout':workout,'deterministicCheck':check,
                                 'catalog':[{key:catalog[b['drillId']].get(key) for key in ('drillId','name','domain','howTo','coachComments')} for b in workout['blocks']]}})
    return cases


def score_response(case,response):
    from jsonschema import Draft7Validator
    from gateway.program_generator import CHECK_SCHEMA
    valid=not list(Draft7Validator(CHECK_SCHEMA).iter_errors(response))
    # A malformed/contradictory answer cannot count as a correct judgment.
    coherent=valid and (response['passed'] is (not bool(response['issues'])))
    accepted=valid and response['passed'] is True and not response['issues']
    return {'schemaValid':valid,'coherentVerdict':coherent,'accepted':accepted,
            'matchedExpectation':coherent and accepted is case['expectedAccepted']}


def summarize(rows):
    return {'completedCases':len(rows),'deterministicallyBlocked':sum(row['route']=='deterministic_rejection' for row in rows),
            'scoredModelCases':sum('score' in row for row in rows),
            'matchedExpectations':sum(row.get('matchedExpectation',False) for row in rows),
            'modelCalls':sum(len(row.get('providerCalls',[])) for row in rows),
            'estimatedCostUsd':round(sum(row.get('estimatedCostUsd',0) for row in rows),9),
            'providerErrors':sum('error' in row for row in rows)}


def run_benchmark(*,live=False,record=None,use_gcloud_auth=False,budget_usd=MAX_BUDGET_USD,stage_model=None):
    if record is not None:
        record=Path(record)
        if record.exists():raise ValueError('Record already exists; choose a new evidence path')
    hashes=source_hashes();cases=build_cases()
    artifact={'schemaVersion':1,'mode':'live' if live else 'offline','startedAt':datetime.now(timezone.utc).isoformat(),
              'sourceHashes':hashes,'caseCount':len(cases),'modelQualityMeasured':False,
              'provenance':{'source':'03A-adversarial-report.md section3.6 planted-failure test; original scratchpad plant.py and plant2.py',
                            'originalScriptSha256':{'plant.py':'e8a1d755866810010e44e9931a5804e01f60e8f2ea00e1cdeaf2095954a2cd6a',
                                                    'plant2.py':'b85a99e8f17db49f1213f4fdaf00ecb67e5e01eab34f7c2b15ff265310b476d4'},
                            'adaptation':'Original subtle inversion/honest relabel doses; current cb15 replay control; gross/time cases isolate their deterministic failure.'},
              'evidence':'Synthetic catalog workouts only. Model expectations authored before this benchmark runs. No Firebase or deployed-state writes.',
              'rows':[]}
    if not live:
        artifact.update(status='fixture_valid',actualModelCalls=0,actualModelSpendUsd=0,metrics=None,cases=cases)
        if record:save_record(record,artifact)
        return artifact
    if record is None:raise ValueError('Live benchmark requires a durable --record path')
    if not 0<budget_usd<=MAX_BUDGET_USD:raise ValueError('Estimated budget must be positive and at most $0.15')
    project,location=os.getenv('GCP_PROJECT'),os.getenv('VERTEX_LOCATION')
    if not project or location not in ('global','us-east5','europe-west1','asia-southeast1'):
        raise ValueError('Live mode requires GCP_PROJECT and supported explicit VERTEX_LOCATION')
    from gateway.program_generator import CHECK_SCHEMA
    from gateway.prompts import render_program_prompt
    from gateway.providers.base import get_provider,ModelMessage
    from gateway.registry import program_stage
    from gateway.usage import estimate_cost_usd
    stage=program_stage('adversarial',{'adversarial':stage_model} if stage_model else None)
    if ((stage.provider,stage.model) not in (('vertex_gemini','gemini-2.5-flash'),('anthropic_direct','claude-sonnet-4-6'))
            or (stage.params.get('thinking_budget'),stage.params.get('max_output_tokens'))!=(0,1536)):
        raise ValueError('Review model limits and budget before changing this Flash/Sonnet benchmark')
    if use_gcloud_auth and stage.provider!='vertex_gemini':
        raise ValueError('--gcloud-auth is for Vertex only; direct Anthropic uses its existing credential environment')
    requests={}
    for case in cases:
        if not case['context']['deterministicCheck']['ok']:continue
        system,user=render_program_prompt(stage.prompt,case['context'])
        input_reserve=len((system+user+json.dumps(CHECK_SCHEMA)).encode())+1024
        reserve=estimate_cost_usd(stage.model,{'inputTokens':input_reserve,'outputTokens':1536},provider=stage.provider)
        requests[case['id']]=(system,user,reserve)
    total_reserve=sum(value[2] for value in requests.values())
    if total_reserve>budget_usd:raise ValueError('Conservative estimated reservation exceeds budget; no provider called')
    artifact.update(status='running',provider=stage.provider,model=stage.model,params=stage.params,
                    project=project,location=location,estimatedBudgetUsd=budget_usd,
                    reservedEstimateUsd=total_reserve,costIsEstimate=True)
    save_record(record,artifact)
    try:
        with gcloud_auth(project) if use_gcloud_auth else nullcontext():
            provider=get_provider(stage.provider)
            for case in cases:
                row=deepcopy(case)
                if not case['context']['deterministicCheck']['ok']:
                    row.update(route='deterministic_rejection',modelCalled=False,matchedExpectation=not case['expectedAccepted'])
                else:
                    system,user,reserve=requests[case['id']]
                    if summarize(artifact['rows'])['estimatedCostUsd']+reserve>budget_usd:
                        artifact['status']='budget_stopped';break
                    events=[];started=time.monotonic()
                    row.update(route='adversarial',modelCalled=True,systemPrompt=system,userPrompt=user,responseSchema=CHECK_SCHEMA,providerCalls=events)
                    try:
                        result=provider.generate(system=system,messages=[ModelMessage(role='user',content=user)],model=stage.model,
                                                 params={**stage.params,'_usage_callback':events.append},json_schema=CHECK_SCHEMA)
                        if not events:events.append({'usage':result.usage,'outcome':'complete','usageSource':'provider_aggregate_fallback'})
                        score=score_response(case,result.structured)
                        row.update(response={'text':result.text,'structured':result.structured},usage=result.usage,score=score,
                                   matchedExpectation=score['matchedExpectation'])
                    except Exception as exc:
                        row['error']={'type':type(exc).__name__,'code':getattr(exc,'code',None)}
                    row['latencyMs']=round((time.monotonic()-started)*1000)
                    row['estimatedCostUsd']=round(sum(estimate_cost_usd(stage.model,event['usage'],provider=stage.provider) for event in events),9)
                artifact['rows'].append(row);save_record(record,artifact)
                if 'error' in row:artifact['status']='provider_failed';break
    except Exception as exc:
        artifact.update(status='setup_failed',error={'type':type(exc).__name__,'code':getattr(exc,'code',None)})
    if artifact['status']=='running':artifact['status']='complete'
    artifact['metrics']=summarize(artifact['rows'])
    artifact.update(actualModelCalls=artifact['metrics']['modelCalls'],actualModelSpendUsd=artifact['metrics']['estimatedCostUsd'],
                    modelQualityMeasured=artifact['metrics']['scoredModelCases']>0,sourceUnchanged=source_hashes()==hashes,
                    allMatched=artifact['metrics']['matchedExpectations']==len(cases),finishedAt=datetime.now(timezone.utc).isoformat())
    if not artifact['sourceUnchanged']:artifact.update(status='source_changed',allMatched=False)
    save_record(record,artifact)
    return artifact


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live',action='store_true')
    parser.add_argument('--gcloud-auth',action='store_true')
    parser.add_argument('--record',type=Path)
    parser.add_argument('--budget-usd',type=float,default=MAX_BUDGET_USD)
    parser.add_argument('--stage-model',help='Override only the adversarial model, e.g. gemini-2.5-flash or claude-sonnet-4-6; defaults to the production registry')
    args=parser.parse_args(argv)
    if args.gcloud_auth and not args.live:parser.error('--gcloud-auth requires --live')
    try:artifact=run_benchmark(live=args.live,record=args.record,use_gcloud_auth=args.gcloud_auth,budget_usd=args.budget_usd,stage_model=args.stage_model)
    except (ValueError,RuntimeError,OSError) as exc:parser.exit(2,f'Benchmark setup failed ({type(exc).__name__}); no model-quality result claimed.\n')
    print(json.dumps({key:value for key,value in artifact.items() if key not in ('rows','cases','sourceHashes')},indent=2))
    return 0 if not args.live or artifact.get('allMatched') else 1


if __name__=='__main__':raise SystemExit(main())
