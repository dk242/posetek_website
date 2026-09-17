"""Offline comparison. Model verdicts are stubbed; this measures deterministic fit,
not live semantic quality. Private captured fixtures are never committed.
Usage: python -X utf8 -m evals.personalized PRIVATE_INPUTS OUTPUT_DIRECTORY
"""
from copy import deepcopy
from pathlib import Path
import json,sys,time
from collections import Counter
from datetime import timedelta
from unittest.mock import patch
from contextlib import nullcontext
from tests.conftest import FakeFirestore,FakeStorage
from tests.test_program_generator_v3 import ConstructingProvider
from gateway.ctx import Invocation
from gateway.program_profile import timestamp
from gateway.program_generator import run_program
from gateway.personalized_composition import allocation_check


def signature(plan):
    return [[[(b['drillId'],b['sets'],b['reps'],b.get('restSeconds'),b.get('restBetweenSetsSeconds'))
              for b in w['blocks']] for w in week['workouts']] for week in plan['weeks']]


def run(data, *, live=False):
    results=[];private=[]
    for record in data['records']:
        position=record['player']['position'];sample=record['sample'];now=timestamp(sample['generatedAt'])
        inv=Invocation(capability='generate_training_plan',player_id=record['player']['id'],uid='offline-admin',
            job_id='offline-'+position,db=FakeFirestore(),storage=FakeStorage(),
            trusted_claims={'uid':'offline-admin','email':'offline@posetek.net','email_verified':True},
            params={'planVersion':3,'intake':sample['intake'],'timezone':'America/Los_Angeles',
                    'statsProfile':record['context']['rawStatsProfile']})
        inv.context['_now']=now
        dates=[timestamp(r.get('createdAt')) for r in record['reps']]
        if dates and all(d and now-timedelta(days=180)<=d<=now for d in dates):
            inv.params['evidenceWindow']={'oldestAt':min(dates),'newestAt':max(dates)}
        inv.db.set_doc(('players',inv.player_id),record['player'])
        for row in data['catalog']:inv.db.set_doc(('drillCatalog',row['id']),row)
        for row in data['coaches']:inv.db.set_doc(('coaches',row['id']),row)
        for row in record['reps']:inv.db.set_doc(('players',inv.player_id,'reps',row['id']),row)
        inv.db.set_doc(('players',inv.player_id,'privateProfile','coachFeedback'),record['context'].get('coachFeedback',{}))
        item={'position':position,'engines':{}};plans={}
        for personalized in ((True,) if live else (False,True)):
            attempt=deepcopy(inv);mode='personalized' if personalized else 'current';started=time.monotonic()
            try:
                with (nullcontext() if live else patch('gateway.providers.base.get_provider',lambda _:ConstructingProvider(attempt))):
                    plan,usage=run_program(attempt,persist=False,personalized=personalized)
                fits=[allocation_check(w,{r['domain']:r['minutes'] for r in w['allocations']}) for w in plan['weeks']]
                item['engines'][mode]={'status':'complete','elapsedMs':round((time.monotonic()-started)*1000),
                    'passedWeeks':sum(f['passed'] for f in fits),'weeks':len(fits),
                    'totalAbsoluteDomainErrorMinutes':sum(abs(d['differenceMinutes']) for f in fits for d in f['domains']),
                    'focusSplit':plan['assessment']['focusSplit']['final'],'allocation':fits,
                    'modelCalls':usage.get('calls'),'modelVerdictsStubbed':not live,
                    'estimatedCostUsd':usage.get('estimatedCostUsd'),'peer':plan['assessment']['inputs']['peer'],
                    'curriculum':plan['assessment'].get('curriculum')}
                plans[mode]=plan
            except Exception as exc:
                item['engines'][mode]={'status':'failed','reason':str(exc),'elapsedMs':round((time.monotonic()-started)*1000)}
        item['changedPrescription']=signature(plans['current'])!=signature(plans['personalized']) if len(plans)==2 else None
        results.append(item);private.append({'position':position,'plans':plans})
        print(position,{k:{f:v for f,v in r.items() if f in ('status','elapsedMs','passedWeeks','totalAbsoluteDomainErrorMinutes','reason')} for k,r in item['engines'].items()},flush=True)
    duplicates={}
    for mode in ('current','personalized'):
        groups={}
        for row in private:
            if mode in row['plans']:groups.setdefault(json.dumps(signature(row['plans'][mode])),[]).append(row['position'])
        duplicates[mode]=[group for group in groups.values() if len(group)>1]
    return {'method':('Fixed captured inputs and published catalog; live independent model validation.' if live else
                     'Fixed captured inputs and published catalog; independent model verdicts stubbed.')+' No production plan writes.',
            'results':results,'duplicatePrescriptions':duplicates},private


if __name__=='__main__':
    report,private=run(json.loads(Path(sys.argv[1]).read_text(encoding='utf8')))
    target=Path(sys.argv[2]);target.mkdir(parents=True,exist_ok=True)
    (target/'comparison-report.json').write_text(json.dumps(report,indent=2,default=str),encoding='utf8')
    (target/'private').mkdir(exist_ok=True)
    (target/'private/comparison-plans.json').write_text(json.dumps(private,default=str),encoding='utf8')
    print('Duplicate prescriptions:',report['duplicatePrescriptions'])
