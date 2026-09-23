"""Free replay by default; --mode live spends Vertex tokens against synthetic data.

Examples:
  python -m evals.program_v3 --mode replay --profile all
  python -m evals.program_v3 --mode live --profile cb15 --record /tmp/cb15-live.json
  python -m evals.program_v3 --mode live --profile cb15 --stage-model build=gemini-2.5-flash

Checked-in tapes are explicitly authored tool tapes, not recordings of live
models. --prepare-fixture regenerates these tapes as a reviewable maintenance
operation; regular replay NEVER generates or repairs a missing/stale tape.
Both modes run production authorization, config, stage, tool, validator and
persistence paths against FakeFirestore/Storage. Live only calls real models.
"""
from __future__ import annotations

import argparse
from collections import Counter,defaultdict
from contextlib import nullcontext
from copy import deepcopy
from datetime import datetime,timezone
import hashlib
import gzip
import json
import os
from pathlib import Path
import time
from unittest.mock import patch

from gateway.ctx import Invocation
from gateway.errors import GatewayError
from gateway.providers.base import ModelResult
from gateway.registry import PROGRAM_STAGES,program_stage
from gateway.usage import aggregate_usage
from tests.conftest import FakeFirestore,FakeStorage

FIXTURES=Path(__file__).parent/'fixtures'
NOW=datetime(2026,9,6,12,tzinfo=timezone.utc)
PROFILE_DOC=json.loads((FIXTURES/'profiles.json').read_text())
# Additional reviewer-authored profile sets live beside the original file so an
# adversarial reviewer never has to edit the set they are reviewing. Every
# profiles_*.json is merged; a duplicate id is a fixture bug, not a silent win.
PROFILES=dict(PROFILE_DOC['profiles'])
EXTRA_PROFILE_FILES=sorted(FIXTURES.glob('profiles_*.json'))
for _extra in EXTRA_PROFILE_FILES:
    for _id,_row in json.loads(_extra.read_text())['profiles'].items():
        if _id in PROFILES: raise ValueError(f'Duplicate eval profile id {_id!r} in {_extra.name}')
        PROFILES[_id]=_row
ALIASES={'two-week':'cb15','twoweek':'cb15','12x4':'worst12x4','winger12foundation':'winger12','striker17coachspeed':'striker17','six-week':'sixweek'}


def json_text(value):
    return json.dumps(value,sort_keys=True,ensure_ascii=False,default=lambda v:v.isoformat() if hasattr(v,'isoformat') else str(v),allow_nan=False)


def digest(value): return hashlib.sha256(json_text(value).encode()).hexdigest()


def read_json_artifact(path):
    """Read regular JSON or a compressed live record without changing its bytes."""
    path = Path(path)
    opener = gzip.open if path.suffix == '.gz' else open
    with opener(path, 'rt', encoding='utf-8') as stream:
        return json.load(stream)


def seed_invocation(profile_id,stage_models=None):
    fixture=deepcopy(PROFILES[profile_id]);db=FakeFirestore();storage=FakeStorage()
    player={k:v for k,v in fixture['player'].items() if v is not None}
    player.update(authenticationUID='synthetic-user',coachUID='synthetic-coach')
    player_id='eval_'+profile_id
    db.set_doc(('players',player_id),player)
    peers=[]
    for i,value in enumerate(fixture.get('peerDribblingTimes',[])):
        ident=f'eval_peer_{i}';peers.append(ident)
        db.set_doc(('players',ident),{'age':player.get('age',15),'gender':player.get('gender'),'coachUID':'synthetic-coach'})
        _reps(db,ident,value)
    if fixture.get('athleteDribblingTime') is not None:_reps(db,player_id,fixture['athleteDribblingTime'])
    db.set_doc(('coaches','coach-doc'),{'userUID':'synthetic-coach','members':[player_id,*peers]})
    for key, collection in (('plans', 'trainingPlans'), ('logs', 'workoutLogs'), ('reservations', 'plannedWorkouts')):
        for row in fixture.get('history', {}).get(key, []):
            db.set_doc(('players', player_id, collection, row['id']), {k: deepcopy(v) for k, v in row.items() if k != 'id'})
    if fixture.get('coachFeedback'):
        db.set_doc(('players',player_id,'privateProfile','coachFeedback'),{**fixture['coachFeedback'],'authorUid':'synthetic-coach','authorRole':'coach','updatedAt':NOW})
    catalog=json.loads((FIXTURES/'catalog_v2.json').read_text())
    for row in catalog['drills']:db.set_doc(('drillCatalog',row['drillId']),row)
    db.set_doc(('drillCatalogMeta','current'),{'catalogVersion':catalog['catalogVersion']})
    cfg={'globalEnabled':True,'programV3Enabled':True,'capabilities':{'generate_training_plan':{'enabled':True,'dailyLimitPerUser':3}}}
    db.set_doc(('config','llm'),cfg)
    params={'planVersion':3,'intake':fixture['intake'],'timezone':'America/Los_Angeles'}
    if fixture.get('stats') is not None:
        params['statsProfile']={'schemaVersion':1,'benchmarkProfile':{'ageBand':'u16','gender':'male','isDefaulted':False},'totalReps':6,'totalSessions':2,
            'overallScore':sum(fixture['stats'].values())/len(fixture['stats']),
            'axes':[{'axis':k,'score':v,'repCount':6 if k=='ballControl' else 0,'missingDrills':[]} for k,v in fixture['stats'].items()],'drills':[]}
    inv=Invocation(capability='generate_training_plan',player_id=player_id,uid='synthetic-user',job_id='eval_program_v3_'+profile_id,
                   params=params,db=db,storage=storage,trusted_claims={'uid':'synthetic-user'})
    inv.context.update(_now=NOW,_stageModels=stage_models or {})
    return inv


def _reps(db,player,value):
    for session in (1,2):
        for trial in (1,2,3):
            db.set_doc(('players',player,'reps',f'dribble_{session}_{trial}'),{'repType':'dribbling','totalTime':value,
              'sessionNumber':session,'repNumber':trial,'createdAt':NOW,'protocolId':'cone-slalom-standard-v1','valid':True})


def seed_methodology_evidence(inv, profile_id):
    """Explicit synthetic recordings for the current-methodology eval harness.

    Historical axis-only inputs are not authoritative primary results. Keep
    seed_invocation unchanged for legacy contract tests; this adapter supplies
    matching canonical reps, identity sidecars, and native-rounded snapshots.
    The recorded synthetic dribbling time takes precedence over its old axis
    score. No fixture claims to be a live athlete or a measured model response.
    """
    fixture = PROFILES[profile_id]
    if fixture.get('stats') is None:
        return inv
    anchors = json.loads((FIXTURES.parents[1] / 'knowledge/planner_primary_anchors_v2.json').read_text())['cells']['u16|male']
    specs = (
        ('ballSpeed', 'shooting', 'kick', 'striking', 'velocity'),
        ('verticalJumpHeight', 'jump', 'jump', 'power', 'jumpHeight'),
        ('broadJumpDistance', 'broadJump', 'broadJump', 'power', 'broadJumpDistance'),
        ('sprintCompletionTime', 'sprint', 'sprint', 'speed', 'totalTime'),
        ('codTotalTime', 'changeOfDirection', 'changeOfDirection', 'agility', 'totalTime'),
        ('dribbleTotalTime', 'dribbling', 'dribbling', 'ballControl', 'totalTime'),
    )
    drills = []
    for mid, drill, client_drill, axis, field in specs:
        reference = anchors[mid]; score = fixture['stats'][axis]
        value = reference * (100 / score if mid.endswith('Time') else score / 100)
        if drill == 'dribbling' and fixture.get('athleteDribblingTime') is not None:
            value = fixture['athleteDribblingTime']; score = reference / value * 100
        existing = [snap for snap in inv.player_ref().collection('reps').stream()
                    if snap.to_dict().get('repType') == drill]
        if not existing:
            ref = inv.player_ref().collection('reps').document('primary_' + drill)
            ref.set({'repType': drill, field: value, 'sessionNumber': 1, 'repNumber': 1, 'createdAt': NOW})
            existing = [ref.get()]
        for snap in existing:
            rep = snap.to_dict(); folder = f'{inv.player_id}/{"deadballShot" if drill == "shooting" else drill}/session{rep["sessionNumber"]}/kick{rep["repNumber"]}'
            rep.update({field: value, 'storagePath': folder + '/synthetic.mov'})
            if drill == 'sprint':
                rep['max_velocity'] = 6.0  # Overall qualification is independent of completion time.
            inv.player_ref().collection('reps').document(snap.id).set(rep)
            primary = rep['max_velocity'] if drill == 'sprint' else value
            inv.storage.put(folder + '/metadata.json', {field: value, **({'max_velocity': primary} if drill == 'sprint' else {}),
                'resultsValid': True, 'processingStatus': 'complete', 'failedSteps': []})
            inv.storage.put(folder + '/reprocess_context.json', {'rep': {'repId': snap.id, 'playerDocId': inv.player_id},
                'result': {'resultsValid': True, 'primaryMetric': primary}})
        drills.append({'drill': client_drill, 'displayName': client_drill, 'repCount': len(existing),
            'sessionCount': len({snap.to_dict()['sessionNumber'] for snap in existing}), 'isLowConfidence': True,
            'lastRecorded': NOW.isoformat(), 'metrics': [{'metric': mid, 'score': round(score, 2),
                'bestCanonical': round(value, 4), 'latestCanonical': round(value, 4), 'referenceCanonical': round(reference, 4),
                'repCount': len(existing), 'band': 'developing', 'bestFormatted': f'{value:.4f}', 'unitLabel': 's' if mid.endswith('Time') else 'm/s' if mid == 'ballSpeed' else 'm'}]})
    inv.params['statsProfile']['drills'] = drills
    inv.params['statsProfile']['totalReps'] = sum(row['repCount'] for row in drills)
    return inv


def authored_response(active,profile_id):
    """One-time tape preparation only; never used by normal replay or live."""
    stage=active['stage'];context=active['context'];actions=[]
    if stage=='coach_parse':
        result={'parsedEmphasis':deepcopy(PROFILES[profile_id].get('coachParsedEmphasis',[]))}
    elif stage=='build':
        work=context['workOrder']
        actions=[{'name':'draft_create','args':{'from':'empty','target':work['target'],**{k:work[k] for k in ('title','intent','focusDomains','budgetMinutes')}}}]
        fields=('drillId','kind','sets','reps','restSeconds','restScope','restBetweenSetsSeconds','familiarizationReps')
        for block in work['blocks']:
            actions.append({'name':'draft_add_block','args':{k:block[k] for k in fields if k in block}})
        actions.append({'name':'validate_workout','args':{}})
        result={'text':'The requested workout draft has been built with the catalog tools.'}
    elif stage=='adversarial':
        # Deliberately authored response. The independent deterministic eval gates
        # below verify actual domains/time; this is NOT evidence of model judgment.
        result={'passed':True,'issues':[]}
    else:raise ValueError('No authored response for '+stage)
    return {'stage':stage,'iteration':active['iteration'],'attempt':active['attempt'],
            'contextSha256':digest(context),'toolActions':actions,'result':result,
            'usage':{'inputTokens':0,'outputTokens':0,'thinkingTokens':0,'thinkingTokensAvailable':True,'cachedInputTokens':0,'calls':1,'latencyMs':0},
            'usageSource':'authored-fixture-no-model-usage'}


class ReplayProvider:
    def __init__(self,inv,profile_id,tape,prepare=False):
        self.inv,self.profile_id,self.prepare=inv,profile_id,prepare
        self.rows={(r['stage'],r.get('iteration',''),r.get('attempt',0)):r for r in tape.get('calls',[])}
        self.used=[]

    def generate(self,*,model,params,tool_runner=None,**kwargs):
        active=self.inv.context['_activeProgramCall'];key=(active['stage'],active['iteration'],active['attempt'])
        row=authored_response(active,self.profile_id) if self.prepare else deepcopy(self.rows.get(key))
        if row is None:raise GatewayError('provider_error',f'Missing replay tape for {key}; use explicit --prepare-fixture to author it.')
        if row.get('contextSha256') and row['contextSha256']!=digest(active['context']):
            raise GatewayError('provider_error',f'Replay context changed for {key}; review and regenerate the authored fixture explicitly.')
        self.used.append(deepcopy(row))
        for action in row.get('toolActions',[]):
            if tool_runner is None:raise GatewayError('provider_error','Replay tool action has no bound runner')
            outcome=tool_runner(action['name'],deepcopy(action['args']))
            if isinstance(outcome,dict) and outcome.get('error'):
                if action.get('ok') is not False or action.get('error')!=outcome['error']:
                    raise GatewayError('provider_error',f'Replay action unexpectedly refused: {action["name"]}: {outcome}')
            elif action.get('ok') is False:
                raise GatewayError('provider_error',f'Replay action expected refusal but succeeded: {action["name"]}')
        usage=deepcopy(row.get('usage') or {});usage.setdefault('calls',1)
        params['_usage_callback']({'usage':usage,'latencyMs':usage.get('latencyMs',0),'outcome':'complete','callIndex':1})
        result=row['result']
        if result is None:
            raise GatewayError('provider_error','Recorded provider attempt failed without a model response')
        return ModelResult(text=result.get('text',''),structured=result if 'text' not in result else None,usage=usage)


def qualitative_assertions(plan,fixture):
    """Independent acceptance properties, never generated from the plan under test."""
    expected=fixture['expected'];intake=fixture['intake'];checks=[]
    def check(condition,message):
        checks.append({'passed':bool(condition),'requirement':message})
    check(plan.get('schemaVersion')==3,'Persists schemaVersion 3')
    check(len(plan['weeks'])==intake['horizonWeeks'],'Requested horizon is preserved')
    check('retest' not in plan,'No generated retest week or block')
    split=plan['assessment']['focusSplit'];final=split['final']
    check(sum(final.values())==100 and all(type(v)is int and 0<=v<=40 for v in final.values()),'Focus split sums to 100 with a 40% domain cap')
    check(final['ballMastery']==0,'Deferred ball mastery is not prescribed or relabelled')
    check(final['dribbling']<=expected.get('dribblingPctMax',40),'Position-specific dribbling emphasis stays bounded')
    check(max(abs(final[d]-split['afterGaps'][d]) for d in final)<=10 and sum(abs(final[d]-split['afterGaps'][d]) for d in final)<=30,'Coach final per-domain and total movements stay bounded')
    if expected.get('coachSpeedIncreaseMin'):
        check(final['speed']-split['afterGaps']['speed']>=expected['coachSpeedIncreaseMin'],'Coach speed request makes a meaningful increase')
    prior=set()
    for week in plan['weeks']:
        workouts=week['workouts'];weekly=sum(w['estimatedMinutes'] for w in workouts);budget=intake['sessionsPerWeek']*intake['minutesPerSession']
        check(len(workouts)==intake['sessionsPerWeek'],f'Week {week["weekNumber"]}: exact session count')
        check(abs(weekly-budget)<=max(5,.1*budget),f'Week {week["weekNumber"]}: total time within 10% or 5 minutes')
        totals=Counter(b['domain'] for w in workouts for b in w['blocks']);minutes=Counter()
        for w in workouts:
            for b in w['blocks']:minutes[b['domain']]+=b['estimatedMinutes']
        # The old solver's fixed ball-share floor is not the new bounded policy.
        # Recompute every disclosed weekly allocation from actual block minutes;
        # do not accept the planner's own `met` or `passed` flags as proof.
        allocation_rows = week.get('check', {}).get('allocation', {}).get('domains', [])
        check(bool(allocation_rows), f'Week {week["weekNumber"]}: discloses numeric allocation targets')
        for row in allocation_rows:
            target = row['targetMinutes']; actual = minutes[row['domain']]
            check(abs(actual-target) <= max(5, .1*target) + 1e-8 and actual == row['actualMinutes'],
                  f'Week {week["weekNumber"]}: {row["domain"]} actual minutes meet its disclosed allocation')
        for domain in expected.get('physicalDomains',[]):check(totals[domain]>0,f'Week {week["weekNumber"]}: contains {domain}')
        core={b['drillId'] for w in workouts for b in w['blocks']}
        if prior:check(len(core&prior)/len(prior)>=expected['minimumCoreRetention'],f'Week {week["weekNumber"]}: retains at least 60% of prior core')
        prior=core
        for workout in workouts:
            label=workout['workoutId'];blocks=workout['blocks'];actual={b['domain'] for b in blocks}
            check(actual==set(workout['focusDomains']),f'{label}: built domains exactly match stated focus')
            check(abs(workout['estimatedMinutes']-workout['budgetMinutes'])<=max(5,.1*workout['budgetMinutes']),f'{label}: session time fits')
            check(all(b.get('kind') in ('warmup','main','cooldown') and not any(k in b for k in ('isMeasuredDrill','isRetest','measuredDrillType')) for b in blocks),f'{label}: ordinary catalog work, no recording requirements')
            fatigue=False;ordered=True
            for b in blocks:
                quality=b['domain'] in ('speed','agility','plyometrics')
                if quality and fatigue:ordered=False
                if not quality:fatigue=True
            check(ordered,f'{label}: fresh quality work precedes fatiguing ball work')
            check(workout['check']['intentStatus']=='pass' and workout['check'].get('adversarialPassed') is True,f'{label}: deterministic and independent check both accepted')
    return checks


def history_preservation_assertions(inv, fixture):
    checks = []
    for row in fixture.get('history', {}).get('logs', []):
        expected = {k: deepcopy(v) for k, v in row.items() if k != 'id'}
        actual = inv.player_ref().collection('workoutLogs').document(row['id']).get().to_dict()
        checks.append({'passed': actual == expected, 'requirement': f'Prior completed log {row["id"]} and immutable snapshot remain unchanged'})
    for row in fixture.get('history', {}).get('plans', []):
        actual = inv.player_ref().collection('trainingPlans').document(row['id']).get().to_dict() or {}
        checks.append({'passed': actual.get('weeks') == row.get('weeks') and actual.get('status') == 'superseded',
                       'requirement': f'Prior active plan {row["id"]} is superseded while its completed workouts remain unchanged'})
    return checks


def _source_hashes():
    root=Path(__file__).resolve().parents[1]
    paths=[*sorted((root/'gateway').glob('program_*.py')),*sorted((root/'gateway').glob('personalized_*.py')),
           root/'gateway/workout_persistence.py',root/'gateway/registry.py',root/'gateway/prompts.py',
           root/'knowledge/program_focus_v3.json',root/'knowledge/personalized_objectives_v1.json',
           root/'knowledge/planner_primary_anchors_v2.json',Path(__file__),FIXTURES/'catalog_v2.json',FIXTURES/'profiles.json',*EXTRA_PROFILE_FILES]
    return {str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}


def run_profile(profile_id,*,mode='replay',stage_models=None,prepare=False,tape_path=None):
    profile_id=ALIASES.get(profile_id,profile_id)
    if profile_id not in PROFILES:raise ValueError('Unknown profile '+profile_id)
    for stage,model in (stage_models or {}).items():
        if stage not in PROGRAM_STAGES:raise ValueError('Unknown stage '+stage)
        program_stage(stage,{stage:model}) # validate before creating any provider
    if mode=='live' and (not os.getenv('GCP_PROJECT') or os.getenv('VERTEX_LOCATION') not in ('us-east5','europe-west1','asia-southeast1','global')):
        raise ValueError('Live mode requires GCP_PROJECT and explicit VERTEX_LOCATION=us-east5/europe-west1/asia-southeast1/global')
    if prepare and mode!='replay':raise ValueError('Fixture authoring never uses a live model')
    path=Path(tape_path) if tape_path else FIXTURES/'replay'/f'{profile_id}.json'
    tape={} if prepare or mode=='live' else read_json_artifact(path)
    if 'runs' in tape:
        record=next((r for r in tape['runs'] if r['profileId']==profile_id),None)
        if record is None:raise ValueError('Recorded artifact has no matching profile')
        tape=record.get('replayTape') or {'source':'recorded-live','calls':record['calls']}
    inv=seed_methodology_evidence(seed_invocation(profile_id,stage_models),profile_id)
    replay=ReplayProvider(inv,profile_id,tape,prepare=prepare)
    source_hashes=_source_hashes()
    started=time.monotonic();plan=None;error=None;usage={};checks=[]
    from gateway import config
    from gateway.pipeline import run_job_capability
    from gateway.providers import base as provider_base
    actual_factory=provider_base.get_provider
    contexts={}
    class RecordingProvider:
        def __init__(self,name):self.actual=actual_factory(name)
        def generate(self,**kwargs):
            active=inv.context['_activeProgramCall']
            key=(active['stage'],active['iteration'],active['attempt'])
            contexts[key]=digest(active['context'])
            return self.actual.generate(**kwargs)
    manager=patch('gateway.providers.base.get_provider',lambda name:replay if mode=='replay' else RecordingProvider(name))
    # Config cache is process-wide in production; each synthetic eval must read
    # its own isolated database so running profiles in one process cannot leak.
    with patch.dict(config._cache,{'doc':None,'loaded_at':0}),manager:
        try:
            plan,usage=run_job_capability(inv)
            checks=qualitative_assertions(plan,PROFILES[profile_id])
            checks.extend(history_preservation_assertions(inv, PROFILES[profile_id]))
            if any(not c['passed'] for c in checks):error={'code':'quality_gate_failed','message':'; '.join(c['requirement'] for c in checks if not c['passed'])}
        except Exception as exc:
            error={'code':getattr(exc,'code',type(exc).__name__),'message':str(exc)}
            usage=aggregate_usage(getattr(inv,'_provider_usage_records',[]));usage['stages']=inv.context.get('_stageDigest',[])
    # A profile may declare that refusing is the correct output (no legal
    # curriculum for the athlete's constraints). Silence is not a pass: the
    # refusal must carry the declared error code.
    expected_error=PROFILES[profile_id].get('expectError')
    if expected_error:
        matched=bool(error) and error['code']==expected_error['code']
        checks=[{'passed':matched,'requirement':f"Refuses honestly with {expected_error['code']}: {expected_error.get('reason','')}"}]
        error=None if matched else (error or {'code':'no_error','message':'Generation succeeded where an honest refusal was required'})
    usage['wallClockMs']=round((time.monotonic()-started)*1000)
    artifact={'schemaVersion':1,'profileId':profile_id,'description':PROFILES[profile_id]['description'],'mode':mode,
              'usageSource':('authored tool tape; no model execution or measured model quality' if prepare or tape.get('source')=='authored-tool-tape' else 'recorded provider responses') if mode=='replay' else 'live Vertex responses',
              'passed':error is None,'error':error,'checks':checks,'profile':deepcopy(PROFILES[profile_id]),'params':deepcopy(inv.params),
              'catalogSha256':hashlib.sha256((FIXTURES/'catalog_v2.json').read_bytes()).hexdigest(),'sourceHashes':source_hashes,'sourceHashesCapturedAt':'run_start',
              'stageModels':{s:program_stage(s,stage_models).model for s in PROGRAM_STAGES},'plan':plan,'usage':usage,
              'actualModelSpendUsd':0 if mode=='replay' else usage.get('estimatedCostUsd'),
              'costIsEstimate':mode=='live','actualModelCalls':0 if mode=='replay' else usage.get('calls',0),
              'calls':inv.context.get('_programCalls',[]),'providerCalls':getattr(inv,'_provider_usage_records',[])}
    replay_rows=[]
    for call in artifact['calls']:
        key=(call['stage'],call.get('iteration',''),call.get('attempt',0))
        source=next((r for r in replay.used if (r['stage'],r.get('iteration',''),r.get('attempt',0))==key),{})
        replay_rows.append({k:deepcopy(call[k]) for k in ('stage','iteration','attempt','result','toolActions','usage')})
        replay_rows[-1]['contextSha256']=contexts.get(key) or source.get('contextSha256')
    artifact['replayTape']={'schemaVersion':1,'source':'recorded-live' if mode=='live' else tape.get('source','authored-tool-tape'),'profileId':profile_id,'calls':replay_rows}
    if prepare:
        payload={'schemaVersion':1,'source':'authored-tool-tape','note':'Explicitly authored legal tool actions and independent-check responses. Not recorded model behavior; zero token spend.','profileId':profile_id,'calls':replay.used}
        path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(payload,indent=2,default=str)+'\n')
    return artifact


def print_digest(artifact):
    usage=artifact['usage'];print(f"\n{artifact['profileId']}: {'PASS' if artifact['passed'] else 'FAIL'} — {artifact['description']}")
    print(f"  {artifact['mode']}; {artifact['usageSource']}; actual model spend USD {artifact['actualModelSpendUsd']}; wall {usage['wallClockMs']/1000:.2f}s")
    if artifact['error']:print('  '+artifact['error']['code']+': '+artifact['error']['message'])
    plan=artifact.get('plan')
    if plan:
        print('  Split: '+', '.join(f'{d} {v}%' for d,v in plan['assessment']['focusSplit']['final'].items() if v))
        for week in plan['weeks']:
            prog=week['check'].get('doseProgression')
            progress='' if not prog else f"; retained {prog['retainedBlocks']} blocks, {prog['progressedBlocks']} progressed"
            print(f"  Week {week['weekNumber']}: {sum(w['estimatedMinutes'] for w in week['workouts'])}/{plan['weeklyBudgetMinutes']} min{progress}")
            for w in week['workouts']:
                print(f"    {w['workoutId']} {w['estimatedMinutes']}/{w['budgetMinutes']} min: {w['intent']}")
                print('      '+', '.join(f"{b['drillId']} {b['name']} ({b['domain']}, {b['estimatedMinutes']} min)" for b in w['blocks']))
    stages=defaultdict(list)
    for row in usage.get('stages',[]):stages[row['stage']].append(row)
    for stage,rows in stages.items():
        totals=aggregate_usage(rows);models='/'.join(sorted({r['model'] for r in rows}))
        print(f"  Stage {stage} [{models}]: calls {totals['calls']}; in/out/thinking {totals['inputTokens']}/{totals['outputTokens']}/{totals['thinkingTokens']}; retries {totals['retries']}; {sum(r.get('latencyMs',0) for r in rows)}ms; estimated USD {totals['estimatedCostUsd']}")


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode',choices=('replay','live'),default='replay')
    parser.add_argument('--profile',default='all',help='all or '+','.join(PROFILES))
    parser.add_argument('--stage-model',action='append',default=[],metavar='STAGE=MODEL')
    parser.add_argument('--record',type=Path,help='Write complete run artifact JSON (including failures)')
    parser.add_argument('--prepare-fixture',action='store_true',help='Explicitly author/re-author free checked-in tool tapes; not a live model recording')
    parser.add_argument('--tape',type=Path,help='Use one explicit replay tape (single profile only)')
    parser.add_argument('--json',action='store_true',help='Print the JSON digest instead of readable output')
    args=parser.parse_args(argv)
    stage_models={}
    for item in args.stage_model:
        if '=' not in item:parser.error('--stage-model needs STAGE=MODEL')
        stage,model=item.split('=',1);stage_models[stage]=model
    ids=list(PROFILES) if args.profile=='all' else [ALIASES.get(args.profile,args.profile)]
    if args.tape and len(ids)!=1:parser.error('--tape requires one profile')
    artifacts=[]
    for profile_id in ids:
        try:artifact=run_profile(profile_id,mode=args.mode,stage_models=stage_models,prepare=args.prepare_fixture,tape_path=args.tape)
        except (ValueError,OSError,GatewayError) as exc:parser.error(str(exc))
        artifacts.append(artifact)
        if not args.json:print_digest(artifact)
        if args.record:
            args.record.parent.mkdir(parents=True,exist_ok=True)
            args.record.write_text(json.dumps({'runs':artifacts},indent=2,default=str)+'\n')
    if args.json:print(json.dumps({'runs':artifacts},indent=2,default=str))
    return 0 if all(a['passed'] for a in artifacts) else 1


if __name__=='__main__':raise SystemExit(main())
