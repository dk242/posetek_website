"""Deterministic catalog selection, legal doses and truthful session work orders."""
from __future__ import annotations
from collections import Counter,defaultdict
from copy import deepcopy
from itertools import product
from math import ceil
from gateway.errors import GatewayError
from gateway.workout_time import resolved_catalog_dose,estimate_block,estimate_workout
from gateway.program_focus import largest_remainder

QUALITY={'speed','plyometrics','agility'}
BALL={'dribbling','passing','receiving','shooting'}
# Unavailable technical curriculum can move authored points to physical support.
# A soccer workout should still favour a technical majority whenever legal doses
# permit it; this is a composition target, not invented curriculum or extra volume.
BALL_WORK_TARGET_SHARE=.55
DOMAIN_LABELS={'plyometrics':'jump and landing','dribbling':'dribbling','passing':'passing',
               'receiving':'first touch','shooting':'shooting','speed':'speed','agility':'agility','strength':'strength'}


def _joined(items):
    items=list(items)
    return ', '.join(items[:-1])+' and '+items[-1] if len(items)>1 else items[0]


def describe_intent(selected,catalog):
    """Describe actual doses and positions; never imply equal or absent themes."""
    minutes=Counter()
    for did,dose in selected:minutes[catalog[did]['domain']]+=dose['estimatedMinutes']
    domains=sorted(minutes,key=lambda d:(-minutes[d],d))
    leaders=[d for d in domains if minutes[d]==minutes[domains[0]]]
    intent=('Shared lead focus: ' if len(leaders)>1 else 'Lead focus: ')
    intent+=_joined(f'{DOMAIN_LABELS[d]} ({minutes[d]} min)' for d in leaders)+'.'
    support=[f'{DOMAIN_LABELS[d]} ({minutes[d]} min)' for d in domains if d not in leaders]
    if support:intent+=' Supporting work: '+_joined(support)+'.'
    ordered=[catalog[did]['domain'] for did,_ in selected]
    # State only quality work that really opens this workout. Strength is a
    # separate domain, so its location is described separately below.
    if ordered[0] in QUALITY:
        first=[]
        for domain in ordered:
            if domain not in QUALITY:break
            if domain not in first:first.append(domain)
        intent+=' Start with fresh '+_joined(DOMAIN_LABELS[d] for d in first)+' work.'
    strength=[str(i+1) for i,d in enumerate(ordered) if d=='strength']
    if strength:
        intent+=' Strength work is in block'+('s ' if len(strength)>1 else ' ')+_joined(strength)+'.'
    intent+=' Keep the prescribed catalog rest.'
    if len(intent)>400:raise GatewayError('validation_failed','Generated workout intention exceeds the text limit.')
    return intent

def dose_options(row):
    """Compact exact-minute choices. Never extend catalog ranges to fill a clock."""
    dose=row['dose'];base=resolved_catalog_dose(dose)
    if dose['setsMax']-dose['setsMin']>20 or dose['repsMax']-dose['repsMin']>600:
        raise GatewayError('context_unavailable','Catalog dose range is too broad to compose safely')
    choices={}
    for sets,reps in product(range(dose['setsMin'],dose['setsMax']+1),range(dose['repsMin'],dose['repsMax']+1)):
        b={**base,'sets':sets,'reps':reps}
        try: estimate=estimate_block(b)
        except GatewayError: continue
        b['estimatedMinutes']=estimate['estimatedMinutes']
        # Retain the lowest volume achieving the same whole-minute estimate.
        key=b['estimatedMinutes']
        if key not in choices or (sets*reps,sets,reps)<(choices[key]['sets']*choices[key]['reps'],choices[key]['sets'],choices[key]['reps']): choices[key]=b
    return [choices[k] for k in sorted(choices)]

def catalog_capacity(catalog,options,sessions,budget):
    sums=Counter()
    for did,row in catalog.items():
        if options.get(did): sums[row['domain']]+=options[did][-1]['estimatedMinutes']*min(sessions,row['maxFrequencyPerWeek'])
    return {d:min(40,minutes*100//(sessions*budget)) for d,minutes in sums.items()}


def deliverable_week_allocations(catalog,options,split,weekly_budget):
    """Fold sub-dose weekly shares into feasible domains, retaining an audit.

    This is a budget projection, not a guarantee that a whole-dose scheduler can
    deliver every point exactly. One transition minute is included in each floor
    so a tiny allocation cannot promise a block with no time to reach it.
    """
    floors={}
    for did,row in catalog.items():
        if options.get(did):
            minimum=min(option['estimatedMinutes'] for option in options[did])+1
            floors[row['domain']]=min(floors.get(row['domain'],minimum),minimum)
    original=largest_remainder(split,weekly_budget)
    funded={d:value for d,value in original.items() if value and d in floors and value>=floors[d]}
    if not funded:raise GatewayError('context_unavailable','No weekly domain allocation can fit a legal catalog dose.')
    folded={d:value for d,value in original.items() if value and d not in funded}
    redistributed=largest_remainder(funded,sum(folded.values())) if folded else {d:0 for d in funded}
    allocations={d:funded.get(d,0)+redistributed.get(d,0) for d in split}
    return {'allocations':allocations,'minimumDoseMinutes':dict(sorted(floors.items())),
            'foldedMinutesByDomain':folded}

def select_drills(catalog,profile,prior_core=None):
    prior=set(prior_core or [])
    preferred={'foundation':1,'club':2,'performance':3}[profile['level']]
    return sorted(catalog,key=lambda did:(did not in prior,abs(catalog[did]['difficultyLevel']-preferred),did))

def _domain_candidates(catalog,options,ranking,frequency,domain,prior):
    rank={did:i for i,did in enumerate(ranking)}
    ids=[did for did in ranking if catalog[did]['domain']==domain and frequency.get(did,0)<catalog[did]['maxFrequencyPerWeek']]
    # Keep earlier IDs in later weeks; all legal rows remain available when a
    # frequency cap prevents reuse. Limit only this solver's candidate width.
    return sorted(ids,key=lambda did:(did not in prior,rank[did]))[:8]

def compose_work_order(profile,catalog,options,ranking,split,frequency,*,week_number,order,remaining,prior_workout=None):
    budget=profile['intake']['minutesPerSession'];sessions=profile['intake']['sessionsPerWeek'];slots_left=sessions-order+1
    prior_blocks=(prior_workout or {}).get('blocks') or [];prior={b['drillId']:b for b in prior_blocks}
    domains=[d for d in split if split[d]>0 and any(catalog[did]['domain']==d and frequency.get(did,0)<catalog[did]['maxFrequencyPerWeek'] for did in ranking)]
    # Three technical themes plus one fresh-quality theme gives a legible
    # session, while the quality themes alternate instead of cramming all
    # physical domains into every day.
    quality=sorted([d for d in domains if d in QUALITY],key=lambda d:(-remaining.get(d,0),d))
    technical=sorted([d for d in domains if d not in QUALITY],key=lambda d:(-remaining.get(d,0),d))
    focuses=(quality[:1]+technical[:3])
    if len(focuses)<4:
        focuses += [d for d in domains if d not in focuses][:4-len(focuses)]
    if budget<=30 and len(focuses)>3: focuses=sorted(focuses,key=lambda d:(-remaining.get(d,0),d))[:3]
    # Preserve a prior legal shape when possible. Newly unavailable rows remain
    # excluded, and no past choice can override today's frequency cap.
    if prior_workout and all(d in domains for d in prior_workout['focusDomains']): focuses=list(prior_workout['focusDomains'])
    candidates={d:_domain_candidates(catalog,options,ranking,frequency,d,prior) for d in focuses}
    focuses=[d for d in focuses if candidates[d]]
    if not focuses: raise GatewayError('context_unavailable','No eligible drills remain under weekly frequency limits')
    desired={d:max(1,remaining.get(d,0)/(1 if d in QUALITY else slots_left)) for d in focuses}
    # Reserve realistic transition overhead; exact accounting follows below.
    subtotal=max(1,budget-6)
    weights={d:max(1,round(v*100)) for d,v in desired.items()}
    desired=largest_remainder(weights,subtotal)
    ball_weights={d:desired[d] for d in focuses if d in BALL}
    physical_weights={d:desired[d] for d in focuses if d not in BALL}
    ball_target=ceil(subtotal*BALL_WORK_TARGET_SHARE)
    if ball_weights and physical_weights and sum(ball_weights.values())<ball_target:
        desired.update(largest_remainder(ball_weights,ball_target))
        desired.update(largest_remainder(physical_weights,subtotal-ball_target))
    selected=[];done=Counter()
    # One pass establishes the written focus; subsequent choices fill unmet
    # domain budgets with distinct drills rather than duplicating a dose.
    minimum_by_domain={d:min(options[did][0]['estimatedMinutes'] for did in candidates[d]) for d in focuses}
    for index,d in enumerate(focuses):
        # Preserve ranking whenever it fits. A short workout must be allowed
        # to use another catalog drill when the first one's minimum dose
        # leaves no room for the other written themes and transitions.
        reserved=sum(options[did][0]['estimatedMinutes'] for did,_ in selected)
        reserved+=sum(minimum_by_domain[other] for other in focuses[index+1:])+len(focuses)-1
        did=next((candidate for candidate in candidates[d]
                  if reserved+options[candidate][0]['estimatedMinutes']<=budget+max(5,budget//10)),None)
        if did is None:raise GatewayError('context_unavailable','No eligible minimum doses fit the session themes')
        target=desired[d]
        op=min(options[did],key=lambda o:(abs(o['estimatedMinutes']-min(target,12)),o['sets']*o['reps']))
        selected.append((did,deepcopy(op)));done[d]+=op['estimatedMinutes']
    def total(): return sum(o['estimatedMinutes'] for _,o in selected)+max(0,len(selected)-1)
    while total()<budget-2 and len(selected)<12:
        used={did for did,_ in selected};choices=[]
        for d in focuses:
            for did in candidates[d]:
                if did in used: continue
                for op in options[did]:
                    nt=total()+op['estimatedMinutes']+1
                    if nt>budget+max(5,budget//10):continue
                    # Balance desired domain volume, prefer budget-close work,
                    # and keep original IDs. Do not prefer high difficulty.
                    deviation=sum(abs((done[x]+(op['estimatedMinutes'] if x==d else 0))-desired[x]) for x in focuses)
                    score=deviation+abs(budget-nt)*.8+(0 if did in prior else .2)
                    choices.append((score,nt,did,op))
        if not choices:break
        _,_,did,op=min(choices,key=lambda c:(c[0],c[2],c[3]['sets']*c[3]['reps']))
        selected.append((did,deepcopy(op)));done[catalog[did]['domain']]+=op['estimatedMinutes']
    # Given selected drills, a small knapsack chooses whole legal dose blocks
    # nearest the clock while preserving domain allocations and prior doses.
    # Track whether a legal rep increase occurred separately from clock fit.
    # Otherwise an exact repetition always beats a one-minute progression,
    # even though both are comfortably inside the agreed session tolerance.
    states={(0,0,False):(0,[])}
    upper=budget+max(5,budget//10)
    for did,initial in selected:
        new={};domain=catalog[did]['domain'];old=prior.get(did)
        legal=options[did]
        if old and week_number>1:
            # Only reps progresses in later weeks; sets and all rest controls
            # stay fixed. At the ceiling a quality consolidation is honest.
            base={k:old[k] for k in ('sets','reps','repUnit','perSide','restSeconds','restScope','restBetweenSetsSeconds','familiarizationReps')}
            max_reps=catalog[did]['dose']['repsMax']
            legal=[]
            horizon=max(5,profile['intake'].get('horizonWeeks',2)-1)
            step=min(max(1,(max_reps-catalog[did]['dose']['repsMin'])//horizon),max(1,base['reps']//10))
            for reps in sorted({base['reps'],min(max_reps,base['reps']+1),min(max_reps,base['reps']+step)}):
                option={**base,'reps':reps};option['estimatedMinutes']=estimate_block(option)['estimatedMinutes'];legal.append(option)
        for (elapsed,ball_minutes,progressed),(penalty,blocks) in states.items():
            for option in legal:
                nt=elapsed+option['estimatedMinutes']+(1 if blocks else 0)
                if nt>upper:continue
                cost=penalty+abs(option['estimatedMinutes']-initial['estimatedMinutes'])*.6
                if old and option['reps']==old['reps']:cost+=.15
                key=(nt,ball_minutes+(option['estimatedMinutes'] if domain in BALL else 0),
                     progressed or bool(old and option['reps']>old['reps']))
                if key not in new or cost<new[key][0]:new[key]=(cost,blocks+[(did,deepcopy(option))])
        states=new
    if not states:raise GatewayError('context_unavailable','No legal dose combination fits this session')
    fitting={key:value for key,value in states.items() if abs(key[0]-budget)<=max(5,budget*.1)}
    if not fitting:raise GatewayError('context_unavailable','No legal dose combination fits the session time tolerance')
    # Prefer at least one legal increase, then the best clock/domain fit. At a
    # dose or time ceiling the unchanged option remains an honest consolidation.
    def preference(pair):
        (minutes,ball_minutes,progressed),(penalty,blocks)=pair
        block_minutes=minutes-max(0,len(blocks)-1)
        return (ball_minutes<block_minutes*BALL_WORK_TARGET_SHARE,not progressed,
                abs(minutes-budget)*5+penalty,minutes)
    (elapsed,_,_),(_,selected)=min(fitting.items(),key=preference)
    actual=Counter()
    for did,dose in selected:actual[catalog[did]['domain']]+=dose['estimatedMinutes']
    focuses=sorted(actual,key=lambda d:(-actual[d],d))
    # Doses can reverse the earlier remaining-budget priorities. Keep quality
    # work fresh, then lead with the actual technical emphasis before support
    # and strength. Only execution order changes; all selected doses stay fixed.
    selected.sort(key=lambda item:(0 if catalog[item[0]]['domain'] in QUALITY else
                                  1 if catalog[item[0]]['domain'] in BALL else 2,
                                  focuses.index(catalog[item[0]]['domain']),ranking.index(item[0])))
    labels=DOMAIN_LABELS
    title=' + '.join(labels[d].capitalize() for d in focuses[:2])
    intent=describe_intent(selected,catalog)
    blocks=[]
    for did,dose in selected:
        row=catalog[did]
        blocks.append({'drillId':did,**dose,'kind':'main','whyIncluded':f'Build {labels[row["domain"]]} through repeatable practice.'})
    return {'weekNumber':week_number,'order':order,'title':title[:80],'intent':intent[:400],'focusDomains':focuses,
            'intentVersion':'domain-minutes-v1',
            'budgetMinutes':budget,'estimatedMinutes':elapsed,'blocks':blocks,'domainBudgets':desired,
            'priorWorkout':deepcopy(prior_workout),'progression':'Keep the core; progress reps only where legal and inside the session budget.'}
