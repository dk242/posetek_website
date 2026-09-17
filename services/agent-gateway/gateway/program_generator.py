"""V3 deterministic stage spine: assess → split → select → shape → tools → check."""
from __future__ import annotations
from collections import Counter
from copy import deepcopy
from datetime import timezone
import hashlib
import json
import time
from zoneinfo import ZoneInfo

from gateway.errors import GatewayError
from gateway.program_profile import validate_program_intake,assemble_program_profile,now_for,DOMAINS
from gateway.program_focus import compute_focus_split,largest_remainder,focus_policy
from gateway.program_composition import dose_options,catalog_capacity,select_drills,compose_work_order,deliverable_week_allocations,describe_intent
from gateway.registry import PROGRAM_STAGES,program_stage

COACH_SCHEMA={'type':'object','additionalProperties':False,'required':['parsedEmphasis'],'properties':{
    'parsedEmphasis':{'type':'array','maxItems':4,'items':{'type':'object','additionalProperties':False,'required':['domain','direction','strength'],
        'properties':{'domain':{'type':'string','enum':list(DOMAINS)},'direction':{'type':'string','enum':['more','less']},'strength':{'type':'number','enum':[.5,1.0]}}}}}}
# 240 was below what a correct rejection actually needs: a Flash verdict that
# correctly quoted the intention and the offending block minutes ran ~300-400
# characters, so every genuine intent rejection was thrown away as a schema
# violation, spent the single repair allowance, and fed the build repair prompt
# "adversarial output did not match the required schema" instead of the reason.
CHECK_SCHEMA={'type':'object','additionalProperties':False,'required':['passed','issues'],'properties':{
    'passed':{'type':'boolean'},'issues':{'type':'array','maxItems':6,'items':{'type':'string','maxLength':600}}}}



def _progress(inv, stage, *, key=None, finished=False, detail=None, completed_workouts=None):
    """Publish actual completed work, never an elapsed-time simulation.

    Each assessed input, selected week and shaped/built/checked workout is a
    unit. Repeated repair attempts reuse their unit so progress cannot jump
    backwards or count unaccepted model output as another completed workout.
    """
    state = inv.context.get('_programProgressState')
    if state is None:
        return
    if finished:
        state['finished'].add(key or stage)
    if completed_workouts is not None:
        state['completedWorkouts'] = completed_workouts
    fraction = len(state['finished']) / state['totalUnits']
    event = {'stage': stage, 'completedWorkouts': state['completedWorkouts'],
             'totalWorkouts': state['totalWorkouts'],
             'fraction': 1.0 if stage == 'complete' else min(.99, fraction)}
    if detail:
        event['detail'] = detail
    if inv.context.get('_programProgress') == event:
        return
    inv.context['_programProgress'] = event
    callback = inv.context.get('_programProgressCallback')
    if callable(callback):
        # Main's transport wrapper handles best-effort Firestore reporting.
        callback(deepcopy(event))


def _workout_progress(inv, stage, week, order, *, finished=False, detail=None):
    _progress(inv, stage, key=f'{stage}/w{week}s{order}', finished=finished,
              detail=detail or f'Week {week}, workout {order}')


def _digest_record(inv,stage,started,result,**extra):
    row={'stage':stage,'model':'code','calls':0,'inputTokens':0,'outputTokens':0,'thinkingTokens':0,'thinkingTokensAvailable':True,'estimatedCostUsd':0,
         'latencyMs':round((time.monotonic()-started)*1000),**extra}
    inv.context.setdefault('_stageDigest',[]).append(row)
    inv.stage_outputs[stage]=deepcopy(result)
    inv.context.setdefault('_programStageOutputs',[]).append({'stage':stage,**extra,'output':deepcopy(result)})


def _model_call(inv,stage_id,context,*,schema=None,iteration='',attempt=0):
    from gateway.personalized_jobs import assert_execution
    assert_execution(inv)
    from gateway.prompts import render_program_prompt
    from gateway.providers.base import get_provider,ModelMessage
    from gateway.tools import TOOL_SPECS,run_tool
    from gateway.usage import make_usage_callback,aggregate_usage
    stage=program_stage(stage_id,inv.context.get('_stageModels'))
    remaining_seconds=inv.context.get('_programDeadline',time.monotonic()+3300)-time.monotonic()
    if remaining_seconds<=0:raise GatewayError('validation_failed','Program generation exceeded its 55-minute deadline; existing plan unchanged')
    system,user=render_program_prompt(stage.prompt,context)
    trace_context=deepcopy(context)
    if getattr(inv, '_daily_allowance_required', False):
        from gateway import config
        config.reserve_daily_allowance(inv)
    callback=make_usage_callback(inv,provider=stage.provider,model=stage.model,stage=f'{stage_id}/{iteration}' if iteration else stage_id,retry_index=attempt)
    actions=[]
    def runner(name,args):
        if name not in stage.tools:raise GatewayError('invalid_request','Tool not enabled for this stage')
        action={'name':name,'args':deepcopy(args)};actions.append(action)
        try:
            result=run_tool(name,args,inv);action['ok']=True;return result
        except GatewayError as exc:
            action.update(ok=False,error=exc.code)
            if exc.code not in ('invalid_request','validation_failed','context_unavailable'):raise
            return {'error':exc.code,'message':exc.message}
    start=time.monotonic();result=None
    inv.context['_activeProgramCall']={'stage':stage_id,'iteration':iteration,'attempt':attempt,'context':context}
    try:
        provider=get_provider(stage.provider)
        result=provider.generate(system=system,messages=[ModelMessage(role='user',content=user)],model=stage.model,
                  params={**stage.params,'max_tool_seconds':min(stage.params.get('max_tool_seconds',60),remaining_seconds),'_usage_callback':callback},json_schema=schema,
                  tools=[TOOL_SPECS[n] for n in stage.tools] or None,tool_runner=runner if stage.tools else None)
        # Fakes/older adapters can only report an aggregate. New production
        # adapters always callback each actual request, including failed ones.
        if not callback.records:
            callback({'usage':result.usage,'latencyMs':round((time.monotonic()-start)*1000),'outcome':'complete','callIndex':1})
        output=result.structured if result.structured is not None else {'text':result.text}
        if schema is not None:
            import jsonschema
            try:jsonschema.validate(output,schema)
            except jsonschema.ValidationError as exc:
                # ValidationError.message includes rejected values/property names.
                # A parser may echo private coach text there; job errors are public.
                raise GatewayError('validation_failed',f'{stage_id} output did not match the required schema.') from exc
        return output
    except Exception:
        if not callback.records:callback({'usage':{'calls':0},'latencyMs':round((time.monotonic()-start)*1000),'outcome':'failed','callIndex':1})
        raise
    finally:
        usage=aggregate_usage(callback.records)
        row={'stage':stage_id,'iteration':iteration,'attempt':attempt,'model':stage.model,'provider':stage.provider,**usage,
             'latencyMs':round((time.monotonic()-start)*1000)}
        inv.context.setdefault('_stageDigest',[]).append(row)
        safe_context=trace_context if stage_id!='coach_parse' else {'noteSha256':hashlib.sha256(user.encode()).hexdigest(),'privateNoteOmitted':True}
        entry={'stage':stage_id,'iteration':iteration,'attempt':attempt,'model':stage.model,'prompt':{'system':system,'user':safe_context},
               'result':(result.structured if result and result.structured is not None else {'text':result.text} if result else None),
               'toolActions':actions,'usage':row}
        inv.trace.append(entry)
        inv.context.setdefault('_programCalls',[]).append(entry)
        inv.context.pop('_activeProgramCall',None)


def parse_coach_feedback(inv,profile):
    feedback=inv.context['_programPrivate']['coachFeedback'];text=feedback.get('text','')
    if not text.strip():
        _digest_record(inv,'coach_parse',time.monotonic(),{'parsedEmphasis':[]},note='No note; no model call.')
        return []
    context={'untrustedCoachNote':{'text':text,'structuredTags':profile['coachFeedback']['emphasis']},'allowedDomains':list(DOMAINS)}
    for attempt in range(2):
        try:
            result=_model_call(inv,'coach_parse',context,schema=COACH_SCHEMA,attempt=attempt)
            parsed=result['parsedEmphasis']
            if len({v['domain'] for v in parsed})!=len(parsed):raise GatewayError('validation_failed','Duplicate coach emphasis domains')
            profile['coachFeedback']['parsedEmphasis']=parsed;inv.stage_outputs['coach_parse']=result
            return parsed
        except GatewayError as exc:
            if exc.code!='validation_failed' or attempt:raise
            context['repair']='Use unique known domains and only the schema fields.'
    raise AssertionError('unreachable')


def assess_player(inv):
    start=time.monotonic();profile=assemble_program_profile(inv)
    _digest_record(inv,'assess',start,{k:v for k,v in profile.items() if k!='intake'})
    return profile


def _assemble_work_order(inv, work_order, label):
    """Materialize the solver's work through the same catalog-bound chat tools."""
    from gateway.tools import run_tool
    start = time.monotonic()
    actions = [{'name': 'draft_create', 'args': {'from': 'empty', 'target': work_order['target'],
                **{key: work_order[key] for key in ('title', 'intent', 'focusDomains', 'budgetMinutes')}}}]
    fields = ('drillId', 'kind', 'sets', 'reps', 'restSeconds', 'restScope',
              'restBetweenSetsSeconds', 'familiarizationReps')
    actions += [{'name': 'draft_add_block', 'args': {key: block[key] for key in fields if key in block}}
                for block in work_order['blocks']]
    for action in actions:
        run_tool(action['name'], action['args'], inv)
    _digest_record(inv, 'build', start, inv.context['workoutDraft']['workout'], iteration=label,
                   toolActions=len(actions))


def _construction_signature(workout):
    # Block IDs may advance when a model recreates the identical rejected draft.
    # Only an actual construction change earns a second semantic verdict.
    fields = ('drillId', 'sets', 'reps', 'restSeconds', 'restScope',
              'restBetweenSetsSeconds', 'familiarizationReps')
    return [{key: block.get(key) for key in fields} for block in workout.get('blocks', [])]


def build_workout(inv,work_order,catalog,frequency,plan):
    from gateway.workout_tools import validate_workout
    week=work_order['weekNumber'];order=work_order['order'];label=f'w{week}s{order}'
    target={'kind':'generation','jobId':inv.job_id,'weekNumber':week,'order':order}
    work_order=deepcopy(work_order);work_order['target']=target
    inv.context['workoutContext']={'plan':plan,'target':target,'weekNumber':week,'frequency':dict(frequency),'catalog':catalog,
                                   'allowPartner':inv.context['programProfile']['intake']['setting'] in ('partner','halfAndHalf')}
    inv.context.pop('workoutDraft',None)
    allowed=[catalog[b['drillId']] for b in work_order['blocks']]
    # Catalog rows are small machine/display projections; private coach notes
    # and peer identities never enter this or the independent check prompt.
    context={'workOrder':work_order,'catalog':allowed,'profile':{'age':inv.context['programProfile']['age'],
             'position':inv.context['programProfile']['position'],'level':inv.context['programProfile']['level']}}
    issues=[]; needs_repair=False; rejected_signature=None
    for attempt in range(2):
        _workout_progress(inv,'build',week,order,detail=f'Week {week}, workout {order}' + (' — refining the workout' if attempt else ''))
        if attempt and needs_repair:
            context['repair']={'violations':issues,'instruction':'Change the construction to address these violations; do not repeat the rejected workout.'}
            _model_call(inv,'repair',context,iteration=label,attempt=attempt)
        elif not attempt:
            _assemble_work_order(inv,work_order,label)
        _workout_progress(inv,'build',week,order,finished=True)
        _workout_progress(inv,'time_check',week,order)
        envelope=inv.context.get('workoutDraft') or {};workout=deepcopy(envelope.get('workout') or {})
        check=validate_workout(workout,catalog,inv.context['programProfile'],frequency=frequency,plan=plan,target=target,
                               allow_partner=inv.context['workoutContext']['allowPartner'])
        issues=[v['message'] for v in check.get('violations') or []]
        for field in ('title','intent','focusDomains','budgetMinutes'):
            if workout.get(field)!=work_order[field]:issues.append(f'The build must preserve the shaped {field}.')
        if check['ok'] and work_order.get('intentVersion')=='domain-minutes-v1':
            actual_intent=describe_intent([(block['drillId'],block) for block in workout['blocks']],catalog)
            if actual_intent!=work_order['intent']:
                issues.append('The repaired doses or ordering contradict the fixed intention description.')
        if not check['ok']:issues.append('The deterministic workout check did not pass.')
        if issues:
            needs_repair=True
            rejected_signature=_construction_signature(workout)
            continue
        if attempt and needs_repair and _construction_signature(workout)==rejected_signature:
            issues=['The repair did not change the rejected workout.']
            break
        start=time.monotonic();_digest_record(inv,'time_check',start,check,iteration=label)
        _workout_progress(inv,'time_check',week,order,finished=True)
        _workout_progress(inv,'adversarial',week,order)
        # Independent catalog-backed check; model cannot silently reinterpret
        # or repair a failed intention by rewriting it.
        try:
            result=_model_call(inv,'adversarial',{'workout':workout,'deterministicCheck':check,
                   'catalog':[{k:catalog[b['drillId']].get(k) for k in ('drillId','name','domain','howTo','coachComments')} for b in workout['blocks']]},
                   schema=CHECK_SCHEMA,iteration=label,attempt=attempt)
        except GatewayError as exc:
            if exc.code != 'validation_failed':
                raise
            # A malformed independent verdict is not approval. Spend the same
            # single repair allowance as a semantic rejection, then fail closed.
            issues=[exc.message]
            needs_repair=False
            continue
        if result['passed'] is not True or result['issues']:
            issues=result['issues'] or ['Independent check failed.']
            needs_repair=True;rejected_signature=_construction_signature(workout)
            continue
        _workout_progress(inv,'adversarial',week,order,finished=True)
        workout['check']={'timeStatus':check['timeStatus'],'deltaMinutes':check['deltaMinutes'],'intentStatus':check['intentStatus'],
                          'checkedAt':now_for(inv),'notes':['Deterministic time/eligibility and independent intention checks passed.'],
                          'adversarialPassed':True}
        workout.update(workoutId=label,order=order,revision=1,editedBy='generator',editorUid=None,editedAt=now_for(inv),previousRevision=None)
        return workout
    raise GatewayError('validation_failed',f'{label} failed after one repair: '+'; '.join(issues)[:800])


def derive_week(week,split,budget,previous_week=None,allocation_projection=None):
    minutes=Counter();counts=Counter();transitions=0
    for w in week['workouts']:
        counts.update(set(b['domain'] for b in w['blocks']))
        for b in w['blocks']:minutes[b['domain']]+=b['estimatedMinutes']
        transitions+=max(0,len(w['blocks'])-1)
    allocated=(allocation_projection or {}).get('allocations') or largest_remainder(split,budget)
    week.update(focusSplit=deepcopy(split),allocations=[{'domain':d,'minutes':m} for d,m in allocated.items() if m],
                # Counter over a set: iteration order varies per process, so an
                # unsorted list made two identical generations differ byte for byte
                # and reordered 04's rendered targets on every regeneration.
                targets=[{'domain':d,'exposures':n} for d,n in sorted(counts.items(),key=lambda kv:(-kv[1],kv[0]))],
                actualMinutesByDomain={d:minutes[d] for d in sorted(minutes)},transitionMinutes=transitions)
    # Transition overhead is visible; it cannot masquerade as technical minutes.
    shortfalls={d:allocated[d]-minutes.get(d,0) for d in allocated if allocated[d]>minutes.get(d,0)}
    week['check']={'estimatedMinutes':sum(w['estimatedMinutes'] for w in week['workouts']),
                   'budgetMinutes':budget,'allocationShortfallsMinutes':shortfalls}
    if allocation_projection is not None:
        week['check']['allocationProjection']=deepcopy(allocation_projection)
    # progressionNote claims reps increase where legal. Measure it rather than
    # asserting it: retained = same drill in the same session slot as last week.
    if previous_week is not None:
        prior={w['order']:{b['drillId']:(b['sets'],b['reps']) for b in w['blocks']} for w in previous_week['workouts']}
        retained=progressed=0
        for w in week['workouts']:
            for b in w['blocks']:
                old=prior.get(w['order'],{}).get(b['drillId'])
                if old is None: continue
                retained+=1
                progressed+= (b['sets'],b['reps'])!=old
        week['check']['doseProgression']={'retainedBlocks':retained,'progressedBlocks':progressed}
    return week


def run_program(inv,*,persist=True,personalized=False):
    from gateway.catalog_v2 import load_catalog,eligible_drill
    from gateway.workout_persistence import persist_program
    from gateway.usage import aggregate_usage
    from gateway.workout_history import load_history_evidence,build_frequency_context
    started=time.monotonic();intake=validate_program_intake(inv)
    inv.context['_programDeadline']=started+3300
    if not inv.job_id:raise GatewayError('invalid_request','Generation requires a jobId for its bound internal drafts')
    total_workouts=intake['horizonWeeks']*intake['sessionsPerWeek']
    inv.context['_programProgressState']={'finished':set(),'completedWorkouts':0,'totalWorkouts':total_workouts,
                                          'totalUnits':3+intake['horizonWeeks']+4*total_workouts+1}
    _progress(inv,'assess')
    profile=assess_player(inv)
    if personalized:
        from gateway.personalized_assessment import prepare_personalized_profile,compute_personalized_focus,curriculum_report
        from gateway.personalized_composition import compose_personalized_week,allocation_check,preserve_priority_targets,ENGINE_VERSION
        profile=prepare_personalized_profile(inv,profile)
    _progress(inv,'assess',finished=True)
    _progress(inv,'coach_parse')
    parsed=parse_coach_feedback(inv,profile)
    _progress(inv,'coach_parse',finished=True)
    _progress(inv,'focus_split')
    catalog=load_catalog(inv)
    allow_partner=intake['setting'] in ('partner','halfAndHalf')
    eligible={did:r for did,r in catalog.items() if r['domain'] not in ('ballMastery','games') and eligible_drill(r,profile,allow_partner=allow_partner)[0]}
    if not eligible:raise GatewayError('context_unavailable','No published eligible catalog curriculum')
    options={did:dose_options(row) for did,row in eligible.items()};eligible={did:r for did,r in eligible.items() if options[did]}
    cap=catalog_capacity(eligible,options,intake['sessionsPerWeek'],intake['minutesPerSession'])
    stage_start=time.monotonic()
    split=(compute_personalized_focus if personalized else compute_focus_split)(profile,{r['domain'] for r in eligible.values()},parsed,cap)
    _digest_record(inv,'focus_split',stage_start,split)
    _progress(inv,'focus_split',finished=True)
    unapplied=split.pop('unappliedCoachRequests');unevidenced=split.pop('unevidencedLowScores')
    reasons={'no_eligible_curriculum':'there is no eligible curriculum for it in this catalog',
             'bounds_or_capacity_exhausted':'the configured coach-influence bound or the available catalog capacity was already exhausted',
             'unsupported_request':'the request was not a supported domain/direction'}
    data_gaps=list(profile['dataGaps'])+[f'No eligible {d} curriculum; its time was redistributed.' for d in split['unavailableDomains']]
    if split.get('redistribution',{}).get('unmetPolicy'):
        data_gaps.append('The available curriculum cannot fill this program within every authored-domain increase limit. '
                         'Only physical domains absorb the remaining points; the exact exceptions are recorded in focusSplit.redistribution.')
    data_gaps+= [f'Coach asked for {r["direction"]} {r["domain"]}; this was NOT applied because '
                 f'{reasons.get(r["reason"],r["reason"])}.' for r in unapplied]
    data_gaps+= [f'{row["category"]} scores {row["score"]}/100 but has no primary best result in the supplied stats snapshot, '
                 f'so it did not raise the {row["domain"]} allocation.' for row in unevidenced]
    data_gaps += [f'{d.capitalize()} allocation is limited by available doses and weekly frequency.' for d,c in cap.items() if c<40 and split['tableRow']['percentages'].get(d,0)>c]
    inputs={k:deepcopy(v) for k,v in profile.items() if k not in ('intake','dataGaps','measuredMetricIds')}
    assessment={'summary':(f'{profile["age"]}-year-old ' if profile['age'] is not None else 'Age unavailable; ')+f'{profile["position"] or "position-neutral"} player. Build repeatable soccer skills with controlled physical support.',
                'findings':split.pop('findings'),'dataGaps':data_gaps[:30],'inputs':inputs,'focusSplit':split}
    final=split['final'];N=intake['horizonWeeks'];S=intake['sessionsPerWeek'];M=intake['minutesPerSession'];now=now_for(inv)
    plan={'schemaVersion':3,'planId':'p_'+hashlib.sha256(inv.job_id.encode()).hexdigest()[:28],'playerId':inv.player_id,'jobId':inv.job_id,
          'generatedAt':now,'status':'active','startDate':now.astimezone(ZoneInfo(inv.params['timezone'])).date().isoformat(),'timezone':inv.params['timezone'],
          'horizonWeeks':N,'sessionsPerWeek':S,'minutesPerSession':M,'weeklyBudgetMinutes':S*M,'planRevision':1,'updatedAt':now,'lastEdit':None,
          'catalogVersion':(inv.db.collection('drillCatalogMeta').document('current').get().to_dict() or {}).get('catalogVersion','unknown'),
          'intake':intake,'assessment':assessment,'focusAreas':[{'domain':d,'rationale':f'Build {d} through consistent practice.'} for d in sorted(final,key=lambda d:(-final[d],d))[:3]],
          'weeks':[],'disclaimers':['D1 standards and the focus table are provisional product references.','Stop for pain and seek qualified guidance.']}
    if personalized:
        plan.update(engineVersion=ENGINE_VERSION,status='draft')
        assessment['curriculum']=curriculum_report(catalog,profile,options)
    evidence=load_history_evidence(inv)
    previous_core=[]
    for wn in range(1,N+1):
        _progress(inv,'select',detail=f'Week {wn} of {N}')
        stage_start=time.monotonic();ranking=select_drills(eligible,profile,previous_core)
        _digest_record(inv,'select',stage_start,{'weekNumber':wn,'candidates':ranking,'retainedCore':previous_core},iteration=f'w{wn}')
        _progress(inv,'select',key=f'select/w{wn}',finished=True,detail=f'Week {wn} of {N}')
        week={'weekNumber':wn,'theme':'Build the core' if wn==1 else 'Progress the core',
              'focus':'Repeat purposeful ball skills and keep physical work fresh.',
              'progressionNote':None if wn==N else 'Keep the core drills; increase reps only where the catalog and time budget allow.', 'workouts':[]}
        plan['weeks'].append(week)
        projection=deliverable_week_allocations(eligible,options,final,S*M)
        if personalized:
            projection=preserve_priority_targets(projection,final,S*M,split['measuredPriorityDomains'])
        remaining=deepcopy(projection['allocations'])
        schedulable={d:(final[d] if remaining.get(d,0)>0 else 0) for d in final}
        week_orders=None
        if personalized:
            priorities=split['measuredPriorityDomains']
            unsupported=[d for d in priorities if not remaining.get(d,0)]
            if unsupported:
                raise GatewayError('context_unavailable','A measured priority cannot fit a legal dose: '+', '.join(unsupported)+'. Increase available training time or review curriculum.')
            initial_frequency=build_frequency_context(plan,{'kind':'generation','jobId':inv.job_id,'weekNumber':wn,'order':1},evidence['logs'],evidence['reservations'],now=now)
            if initial_frequency.get('coverage')!='complete':
                raise GatewayError('context_unavailable','Weekly frequency cannot be enforced from incomplete dated evidence.')
            week_orders,diagnostics=compose_personalized_week(profile,eligible,options,ranking,remaining,initial_frequency['counts'],
                week_number=wn,previous_week=plan['weeks'][wn-2] if wn>1 else None,priority_domains=priorities)
            week['allocationSearch']=diagnostics
        for order in range(1,S+1):
            target={'kind':'generation','jobId':inv.job_id,'weekNumber':wn,'order':order}
            frequency_context=build_frequency_context(plan,target,evidence['logs'],evidence['reservations'],now=now)
            if frequency_context.get('coverage') != 'complete':
                raise GatewayError('context_unavailable','Weekly frequency cannot be enforced from incomplete dated evidence.')
            freq=frequency_context['counts']
            prior=plan['weeks'][wn-2]['workouts'][order-1] if wn>1 else None
            _workout_progress(inv,'shape',wn,order)
            stage_start=time.monotonic()
            work_order=week_orders[order-1] if week_orders is not None else compose_work_order(profile,eligible,options,ranking,schedulable,freq,week_number=wn,order=order,remaining=remaining,prior_workout=prior)
            _digest_record(inv,'shape',stage_start,work_order,iteration=f'w{wn}s{order}')
            _workout_progress(inv,'shape',wn,order,finished=True)
            workout=build_workout(inv,work_order,catalog,freq,plan)
            week['workouts'].append(workout)
            _progress(inv,'adversarial',completed_workouts=(wn-1)*S+order,detail=f'Checked workout {(wn-1)*S+order} of {total_workouts}')
            for b in workout['blocks']:remaining[b['domain']]=remaining.get(b['domain'],0)-b['estimatedMinutes']
        derive_week(week,final,S*M,previous_week=plan['weeks'][wn-2] if wn>1 else None,allocation_projection=projection)
        if personalized:
            week['check']['allocation']=allocation_check(week,projection['allocations'],priorities)
            if not week['check']['allocation']['passed']:
                raise GatewayError('validation_failed',f'Week {wn} did not meet its individual targets after validation. No plan was activated; review the schedule or curriculum.')
        total=week['check']['estimatedMinutes']
        if abs(total-S*M)>max(5,S*M*.1):raise GatewayError('validation_failed',f'Week {wn} does not fit the weekly budget')
        core={b['drillId'] for w in week['workouts'] for b in w['blocks']}
        if previous_core:
            retention=len(core&set(previous_core))/len(previous_core)
            week['check']['coreRetention']=retention
            if retention<.6:raise GatewayError('validation_failed',f'Week {wn} does not retain 60% of the prior core')
        previous_core=sorted(core)
    records=getattr(inv,'_provider_usage_records',[]);usage=aggregate_usage(records)
    usage['wallClockMs']=round((time.monotonic()-started)*1000)
    usage['stages']=deepcopy(inv.context['_stageDigest'])
    private={**inv.context['_programPrivate'],'stageOutputs':deepcopy(inv.stage_outputs),'stageExecutions':deepcopy(inv.context.get('_programStageOutputs',[])),
             'modelCalls':deepcopy(inv.context.get('_programCalls',[])),'stageUsage':usage,
             'generatorVersion':'program-v3-03a-2026-09-08','formulaVersion':'expected-minutes-v1-01A','focusTableVersion':focus_policy()['version'],
             'modelConfiguration':{sid:{'provider':program_stage(sid,inv.context.get('_stageModels')).provider,'model':program_stage(sid,inv.context.get('_stageModels')).model,
                 'params':program_stage(sid,inv.context.get('_stageModels')).params} for sid in PROGRAM_STAGES}}
    _progress(inv,'persist',detail='Saving your training program')
    if personalized:
        private['engineVersion']=ENGINE_VERSION
        inv.context['_personalizedPrivate']=private
        if persist:
            raise GatewayError('invalid_request','Personalized generation must use separate draft persistence')
    if persist:plan=persist_program(inv,plan,private)
    if not personalized:
        _progress(inv,'complete',key='persist',finished=True,completed_workouts=total_workouts)
    inv.context['_programResult']=plan
    return plan,usage
