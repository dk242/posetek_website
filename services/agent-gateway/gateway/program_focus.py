"""Editable baseline data and bounded, integer-only allocation arithmetic."""
from __future__ import annotations
import json
from functools import lru_cache
from pathlib import Path
from gateway.errors import GatewayError
from gateway.program_profile import DOMAINS,CATEGORY_DOMAIN

@lru_cache(maxsize=1)
def focus_policy():
    return json.loads((Path(__file__).resolve().parents[1]/'knowledge/program_focus_v3.json').read_text())

def largest_remainder(weights,total):
    denominator=sum(weights.values())
    if denominator<=0: raise GatewayError('validation_failed','No available allocation weights')
    out={d:weights[d]*total//denominator for d in weights}
    for d in sorted(weights,key=lambda d:(-(weights[d]*total%denominator),d))[:total-sum(out.values())]: out[d]+=1
    return out

def _transfer(split,domain,amount,*,allowed,anchor,max_delta,total_delta,single=40,protected=(),ceilings=None):
    """One-point transfers; every intermediate and final map satisfies all bounds."""
    ceilings=ceilings or {d:single for d in split}
    direction=1 if amount>0 else -1
    for _ in range(abs(amount)):
        if not 0<=split[domain]+direction<=ceilings[domain]: break
        donors=[]
        for other in allowed:
            if other==domain or other in protected: continue
            proposed=dict(split);proposed[domain]+=direction;proposed[other]-=direction
            if any(not 0<=v<=ceilings[d] for d,v in proposed.items()): continue
            if any(abs(proposed[d]-anchor[d])>max_delta for d in split): continue
            if sum(abs(proposed[d]-anchor[d]) for d in split)>total_delta: continue
            # Spend broad domains proportionately; deterministic tie break.
            donors.append(other)
        if not donors: break
        other=min(donors,key=lambda d:(-split[d] if direction>0 else split[d],d))
        split[domain]+=direction;split[other]-=direction


def _redistribute_content(table,available,ceilings,position,policy):
    """Redistribute unavailable shares without turning them into one ball skill.

    The authored-gain bound belongs to availability, before evidence/coach
    transfers. Sparse catalogs can make sum=100 impossible under this bound.
    Only physical domains may exceed it in that case, with an explicit policy
    shortfall; catalog, positional and 40% limits remain hard constraints.
    """
    rule=policy['contentRedistributionPolicy'];gain_limit=rule['maxAuthoredGainPct']
    role_caps=policy.get('contentPositionDomainCaps',{}).get(position,{})
    hard_caps={d:min(ceilings[d],role_caps.get(d,40)) for d in DOMAINS}
    base={d:min(table[d],hard_caps[d]) for d in DOMAINS}
    initial=dict(base)
    bounded_caps={d:min(hard_caps[d],table[d]+gain_limit) for d in DOMAINS}
    remaining=100-sum(base.values())
    priority=[d for d in policy['contentRedistributionPriority'] if d in available]

    def distribute(domains,caps):
        nonlocal remaining
        while remaining:
            candidates=[d for d in domains if base[d]<caps[d]]
            if not candidates:break
            # Water-fill gains, not final shares: preserve the authored role
            # differences while giving each available recipient equal turns.
            chosen=min(candidates,key=lambda d:(base[d]-table[d],priority.index(d)))
            base[chosen]+=1;remaining-=1

    technical=[d for d in priority if d in ('passing','shooting','dribbling','receiving')]
    physical=[d for d in priority if d in ('speed','plyometrics','agility','strength')]
    distribute(technical,bounded_caps)
    distribute(physical,bounded_caps)
    overflow=remaining
    distribute(physical,hard_caps)
    if remaining:
        raise GatewayError('context_unavailable',
            'Eligible curriculum cannot fill the weekly budget within the authored technical focus bound and physical capacity.')
    changes=[]
    for d in DOMAINS:
        if base[d]==table[d]:continue
        if d not in available:reason='no_eligible_curriculum'
        elif initial[d]<table[d]:reason='position_cap' if role_caps.get(d,40)<ceilings[d] else 'catalog_capacity'
        elif base[d]>bounded_caps[d]:reason='physical_capacity_fallback'
        else:reason='bounded_redistribution'
        changes.append({'domain':d,'from':table[d],'to':base[d],
                        'deltaPct':base[d]-table[d],'reason':reason,
                        'overAuthoredGainLimitPct':max(0,base[d]-table[d]-gain_limit)})
    audit={'policyVersion':rule['version'],'maxAuthoredGainPct':gain_limit,
           'status':'limited' if overflow else 'bounded','redistributedPct':100-sum(initial.values()),
           'boundedCapsPct':bounded_caps,'physicalOverflowPct':overflow,'changes':changes,
           'unmetPolicy':([{'policy':'max_authored_gain','excessPct':overflow,
                            'reason':'Eligible curriculum cannot reach 100% within every authored gain bound; residual time uses eligible physical work.'}]
                          if overflow else [])}
    return base,audit


def compute_focus_split(profile,eligible_domains,parsed_emphasis=None,capacity_pct=None,*,additional_priorities=()):
    policy=focus_policy();position=profile.get('position') or 'neutral';level=profile.get('level','club');band=profile['ageBand']
    row=next(r for r in policy['rows'] if r['position']==position and r['level']==level and r['ageBand']==band)
    table=dict(row['percentages']);available=set(eligible_domains)-{'ballMastery','games'}
    if len(available)<3: raise GatewayError('context_unavailable','Fewer than three eligible domains cannot satisfy the 40% focus cap.')
    # Availability precedes the four auditable stages. Preserve table row separately.
    ceilings={d:min(40,(capacity_pct or {}).get(d,40)) if d in available else 0 for d in DOMAINS}
    if sum(ceilings.values())<100: raise GatewayError('context_unavailable','Catalog dose/frequency capacity cannot support the requested weekly budget.')
    missing=[d for d in DOMAINS if table[d] and d not in available]
    base,redistribution=_redistribute_content(table,available,ceilings,position,policy)
    after=dict(base);findings=[];measured=[]
    valid=set(profile.get('measuredMetricIds') or [])
    from gateway.assemblers import BENCHMARK_METRICS
    categories=profile.get('stats',{}).get('categories',{})
    percentiles=profile.get('peer',{}).get('percentiles',{})
    best_results=profile.get('bestResults') or {}
    gap_domains=[];unevidenced=[];gap_scores={}
    for cat,domain in CATEGORY_DOMAIN.items():
        peer_mids=sorted(m for m in valid if m in BENCHMARK_METRICS and BENCHMARK_METRICS[m].axis==cat)
        mids=sorted(m for m,row in best_results.items() if row['category']==cat)
        score=sum(best_results[m]['score'] for m in mids)/len(mids) if mids else None
        pct=percentiles.get(cat)
        basis='peer_gap' if peer_mids and pct is not None and pct<=25 else ('best_result_gap' if score is not None and score<65 else None)
        if basis:
            # Cite the evidence in the sentence, not only in assessment.inputs.
            # The brief asks the assessment to read like "he scored poorly in
            # dribbling relative to his teammates", which needs the numbers.
            cohort=(profile.get('peer') or {}).get('cohort') or {}
            score_text=f' Its primary best-result score is {score:g}/100 against the provisional D1 reference.' if score is not None else ''
            if basis=='peer_gap':
                statement=(f'{domain.capitalize()}: {cat} sits at the {pct}th percentile of '
                           f'{cohort.get("size","?")} matched {cohort.get("kind","roster")} peers in {cohort.get("ageBand","this age band")}.'+score_text)
            else:
                statement=(f'{domain.capitalize()}: primary best results score {score:g}/100 against the provisional D1 reference. '
                           'One best result per drill is sufficient for a small focus modifier; this is not a peer rank or a trend.')
            findings.append({'domain':domain,'basis':basis,'metricIds':peer_mids if basis=='peer_gap' else mids,
                             'confidence':'moderate' if basis=='peer_gap' else 'low','statement':statement})
            if domain in available:
                gap_domains.append(domain);gap_scores[domain]=pct if basis=='peer_gap' else score
        elif score is None and categories.get(cat) is not None and categories[cat]<65:
            # An aggregate axis alone is not one of the verified best results.
            unevidenced.append({'category':cat,'domain':domain,'score':categories[cat]})
    for priority in additional_priorities:
        if priority['domain'] not in gap_domains:
            findings.append(dict(priority))
            if priority['domain'] in available:
                gap_domains.append(priority['domain'])
                gap_scores[priority['domain']]=priority['score']
    cap=policy['measuredPriorityCaps'][band][level]
    # Not every weak test becomes a training priority. Choose bounded support
    # priorities whose TOTAL share stays below the age-level measured cap.
    for domain in sorted(set(gap_domains),key=lambda d:(gap_scores[d],after[d],d)):
        amount=3 if position=='CB' and domain=='dribbling' else 5
        if sum(after[d] for d in measured)+after[domain]+amount>cap: continue
        before=after[domain]
        _transfer(after,domain,amount,allowed=available,anchor=base,max_delta=5,total_delta=20,protected=measured,ceilings=ceilings)
        if after[domain]>before: measured.append(domain)
    goal_alias={'firstTouch':'receiving','speedAgility':'speed','strengthPower':'strength','faster':'speed','betterShooter':'shooting','betterDribbler':'dribbling'}
    goals=[goal_alias.get(g,g) for g in profile['intake'].get('goals',[])]
    for domain in goals:
        if domain in available and after[domain]<35:
            _transfer(after,domain,min(3,35-after[domain]),allowed=available,anchor=base,max_delta=5,total_delta=20,protected=measured,ceilings=ceilings)
            findings.append({'domain':domain,'basis':'stated_goal','metricIds':[],'confidence':'low','statement':f'{domain.capitalize()} is a stated training goal.'})
    assert all(abs(after[d]-base[d])<=5 for d in DOMAINS)
    assert sum(abs(after[d]-base[d]) for d in DOMAINS)<=20
    coached=dict(after)
    parsed=parsed_emphasis or []
    # A coach request that cannot be honoured must leave a trace. Before this,
    # "his first touch is terrible" on a catalog with no solo receiving content
    # was parsed, recorded as parsedEmphasis, and then silently did nothing.
    unapplied=[]
    # Explicit decreases first, then increases, preserving the final-map bounds.
    for item in sorted(parsed,key=lambda v:(v.get('direction')!='less',v.get('domain',''))):
        domain=item.get('domain');direction=item.get('direction');strength=item.get('strength',1.0)
        if domain not in available or direction not in ('more','less') or strength not in (.5,1.0):
            unapplied.append({'domain':domain,'direction':direction,
                              'reason':'no_eligible_curriculum' if domain not in available else 'unsupported_request'})
            continue
        before=coached[domain]
        _transfer(coached,domain,(10 if strength==1 else 5)*(1 if direction=='more' else -1),allowed=available,
                  anchor=after,max_delta=10,total_delta=30,ceilings=ceilings)
        if coached[domain]==before:
            unapplied.append({'domain':domain,'direction':direction,'reason':'bounds_or_capacity_exhausted'})
    assert sum(coached.values())==100 and all(0<=v<=40 for v in coached.values())
    assert max(abs(coached[d]-after[d]) for d in DOMAINS)<=10
    assert sum(abs(coached[d]-after[d]) for d in DOMAINS)<=30
    nudges=[{'domain':d,'from':after[d],'to':coached[d],'source':'coachFeedback','reason':'Coach training emphasis adjusted within the configured bounds.'} for d in DOMAINS if coached[d]!=after[d]]
    return {'base':base,'afterGaps':after,'afterCoachNudge':coached,'final':dict(coached),'nudges':nudges,
            'unappliedCoachRequests':unapplied,'unevidencedLowScores':unevidenced,
            'bounds':{k:policy['bounds'][k] for k in ('coachNudgeMaxPerDomainPct','coachNudgeMaxTotalPct','singleDomainMaxPct','gapNudgeMaxPerDomainPct','gapNudgeMaxTotalPct')},
            'tableRow':{'position':position,'ageBand':band,'level':level,'percentages':table,'version':policy['version']},
            'capacityCapsPct':ceilings,'unavailableDomains':missing,'redistribution':redistribution,
            'measuredPriorityDomains':measured,'measuredPriorityMaxPct':cap,'findings':findings}
