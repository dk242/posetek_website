"""V3 profile inputs, best-result modifiers and separately validated peer ranks."""
from __future__ import annotations

import hashlib
import math
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from gateway.errors import GatewayError, invalid_request, context_unavailable

POSITIONS = ('GK', 'CB', 'FB', 'DM', 'CM', 'AM', 'W', 'ST')
DOMAINS = ('ballMastery', 'dribbling', 'passing', 'receiving', 'shooting', 'speed', 'agility', 'plyometrics', 'strength', 'games')
EQUIPMENT = ('ball','cones','markers','wall','goal','hurdles','box','sledOrBand','timer','bench','mat','kneePad','tapeMeasure','cueDevice')
CATEGORY_DOMAIN = {'striking':'shooting','power':'plyometrics','speed':'speed','ballControl':'dribbling','agility':'agility'}

# Use the client's current benchmark scores, which accompany its best results.
# The older server benchmark registry has different anchors and no sprint
# completion-time metric. Re-scoring here would disagree with the athlete's app.
BEST_RESULT_METRICS = {
    'ballSpeed': ('kick', 'striking'),
    'verticalJumpHeight': ('jump', 'power'),
    'broadJumpDistance': ('broadJump', 'power'),
    'sprintCompletionTime': ('sprint', 'speed'),
    'codTotalTime': ('changeOfDirection', 'agility'),
    'dribbleTotalTime': ('dribbling', 'ballControl'),
}


def _best_result_evidence(stats):
    """One primary best result per drill is sufficient for a bounded modifier.

    This uses the existing range-checked statsProfile contract, not a claim of
    server-verified repeatability or peer rank. Latest reps, trends, secondary
    metrics and aggregate axis/drill scores never select a result priority.
    """
    output = {}
    for drill in stats.get('drills') or []:
        for metric in drill.get('metrics') or []:
            mid = metric.get('metric')
            if not isinstance(mid, str) or mid not in BEST_RESULT_METRICS:
                continue
            expected_drill, category = BEST_RESULT_METRICS[mid]
            if drill.get('drill') != expected_drill:
                raise invalid_request(f'{mid} must belong to {expected_drill}')
            if mid in output:
                raise invalid_request(f'Duplicate best result for {mid}')
            best, score, count = metric.get('bestCanonical'), metric.get('score'), metric.get('repCount')
            if (not isinstance(best, (int, float)) or isinstance(best, bool)
                    or not math.isfinite(best) or best <= 0):
                raise invalid_request(f'{mid}.bestCanonical must be finite and positive')
            if (not isinstance(score, (int, float)) or isinstance(score, bool)
                    or not 0 <= score <= 400):
                raise invalid_request(f'{mid}.score must be finite and within 0..400')
            if not isinstance(count, int) or isinstance(count, bool) or count < 1:
                raise invalid_request(f'{mid}.repCount must be a positive integer')
            output[mid] = {'drill': expected_drill, 'category': category,
                           'score': score, 'bestCanonical': best, 'repCount': count}
    return output


def integer(value, minimum, maximum):
    return isinstance(value, int) and not isinstance(value, bool) and minimum <= value <= maximum


def now_for(inv):
    return inv.context.get('_now') or datetime.now(timezone.utc)


def timestamp(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    if isinstance(value, str):
        try:
            return timestamp(datetime.fromisoformat(value.replace('Z', '+00:00')))
        except ValueError:
            pass
    return None


def age_band(age):
    for ceiling, label in [(8,'U6-U8'),(10,'U9-U10'),(12,'U11-U12'),(14,'U13-U14'),(16,'U15-U16'),(19,'U17-U19')]:
        if age <= ceiling:
            return label
    return 'senior'


def resolve_age(player, intake=None, now=None):
    now = now or datetime.now(timezone.utc)
    gaps = []
    for field in ('birthDate', 'dateOfBirth'):
        if field not in player:
            continue
        birth = timestamp(player[field])
        if birth:
            b, today = birth.date(), now.astimezone(timezone.utc).date()
            age = today.year - b.year - ((today.month,today.day) < (b.month,b.day))
            if b <= today and integer(age,5,80):
                return age, 'birthDate' if field == 'birthDate' else 'dateOfBirth', gaps
        gaps.append(f'Invalid {field}; used the next available age source.')
    observed = player.get('age')
    if integer(observed,5,80):
        recorded = timestamp(player.get('ageRecordedAt'))
        if recorded is None or timedelta(0) <= now-recorded <= timedelta(days=365):
            if recorded is None:
                gaps.append('Recorded age has unknown freshness.')
            return observed, 'playerDocAge', gaps
        gaps.append('Recorded age is stale or future-dated; refresh age or birth date.')
    requested = (intake or {}).get('age')
    if integer(requested,5,80):
        return requested, 'intake', gaps
    return None, 'absent', gaps + ['Age unavailable; age 10 used only for drill eligibility.']


def validate_program_intake(inv):
    if not integer(inv.params.get('planVersion'),3,3):
        raise invalid_request('Upgrade required: generation requires planVersion: 3.')
    raw = inv.params.get('intake')
    if not isinstance(raw,dict):
        raise invalid_request('intake must be an object')
    if raw.get('painFlag') is True:
        raise invalid_request('painFlag is set: no automated prescription (workbook R26); human review required.')
    if not isinstance(raw.get('painFlag',False),bool):
        raise invalid_request('painFlag must be boolean')
    n = raw.get('horizonWeeks',6)
    s = raw.get('sessionsPerWeek',raw.get('daysPerWeek'))
    m = raw.get('minutesPerSession')
    if not integer(n,1,12) or not integer(s,1,6) or not integer(m,15,90) or m not in (15,30,45,60,75,90):
        raise invalid_request('horizonWeeks 1..12, sessionsPerWeek 1..6 and minutesPerSession 15/30/45/60/75/90 are required')
    if 'daysPerWeek' in raw and (not integer(raw['daysPerWeek'],1,6) or raw['daysPerWeek'] != s):
        raise invalid_request('daysPerWeek and sessionsPerWeek disagree')
    if raw.get('setting') not in ('solo','partner','halfAndHalf'):
        raise invalid_request('setting must be solo, partner or halfAndHalf')
    level = raw.get('level','club')
    if level not in ('foundation','club','performance'):
        raise invalid_request('level must be foundation, club or performance')
    equipment = raw.get('equipment')
    if not isinstance(equipment,list) or len(equipment)>len(EQUIPMENT) or any(e not in EQUIPMENT for e in equipment):
        raise invalid_request('equipment must use the catalog vocabulary')
    goals = raw.get('goals',[])
    if not isinstance(goals,list) or len(goals)>2 or any(not isinstance(g,str) or len(g)>40 for g in goals):
        raise invalid_request('goals must contain at most two short strings')
    free = raw.get('freeTextGoals','')
    if free is None: free = ''
    if not isinstance(free,str) or len(free)>500:
        raise invalid_request('freeTextGoals must be at most 500 characters')
    if raw.get('age') is not None and not integer(raw['age'],5,80):
        raise invalid_request('age must be an integer 5..80')
    if raw.get('position') is not None and raw['position'] not in POSITIONS:
        raise invalid_request('Unknown position')
    tz = inv.params.get('timezone')
    try:
        if not isinstance(tz,str) or not tz: raise ValueError()
        ZoneInfo(tz)
    except (ValueError,ZoneInfoNotFoundError):
        raise invalid_request('timezone must be a valid IANA identifier')
    result = {'horizonWeeks':n,'sessionsPerWeek':s,'minutesPerSession':m,'setting':raw['setting'],
              'equipment':list(dict.fromkeys(equipment)),'level':level,'goals':goals,'freeTextGoals':free,'painFlag':False}
    for key in ('age','position'):
        if raw.get(key) is not None: result[key]=raw[key]
    inv.context['programIntake']=result
    return result


def _read(ref, read=None):
    if read: return read(ref)
    return ref.get() if hasattr(ref,'id') else list(ref.stream())


def resolve_coach(db, player_id, player, read=None):
    """An assigned relationship wins; otherwise require one unique roster coach."""
    uid = player.get('coachUID')
    coaches = db.collection('coaches')
    if isinstance(uid,str) and uid and '/' not in uid:
        direct = _read(coaches.document(uid),read)
        matches = list(_read(coaches.where('userUID','==',uid),read))
        candidates = {d.id:d for d in matches}
        if direct.exists: candidates[direct.id]=direct
        if len(candidates)==1:
            snap=next(iter(candidates.values())); return snap.id,snap.to_dict() or {}
        if len(candidates)>1: return None,{}
    matches=[d for d in _read(coaches,read) if player_id in ((d.to_dict() or {}).get('members') or [])]
    if len(matches)==1: return matches[0].id,matches[0].to_dict() or {}
    return None,{}


def resolve_technical_eligibility(db, player_id, player=None, read=None):
    if player is None:
        player = _read(db.collection('players').document(player_id),read).to_dict() or {}
    coach_id, coach = resolve_coach(db,player_id,player,read)
    if integer(player.get('maxDrillDifficulty'),1,5):
        return {'maxDrillDifficulty':player['maxDrillDifficulty'],'source':'player','coachId':coach_id}
    if integer(coach.get('maxDrillDifficulty'),1,5):
        return {'maxDrillDifficulty':coach['maxDrillDifficulty'],'source':'coach','coachId':coach_id}
    return {'maxDrillDifficulty':5,'source':'default','coachId':coach_id}


def _metric_evidence(db, player_id, now, read=None):
    """A peer rank needs 2 sessions × >=3 trials with an explicit matched protocol.

    Legacy records without protocol metadata may still inform descriptive D1 scores,
    but cannot support a matched peer rank. Best-result allocation is separate.
    """
    from gateway.assemblers import BENCHMARK_METRICS,_METRIC_SOURCE,parse_rep_doc,ComparisonKind
    groups=defaultdict(lambda:defaultdict(list))
    for snap in _read(db.collection('players').document(player_id).collection('reps'),read):
        raw=snap.to_dict() or {}
        try:
            rep=parse_rep_doc(snap)
        except (TypeError, ValueError, OverflowError):
            # Malformed legacy identifiers (e.g. NaN sessionNumber) supply no
            # valid measured evidence; one bad row cannot crash assessment.
            continue
        protocol=raw.get('protocolId')
        at=rep['createdAt']; session=raw.get('sessionId') or rep.get('sessionNumber')
        if (not isinstance(protocol,str) or not protocol or len(protocol)>120 or session is None or
            raw.get('valid') is False or raw.get('isValid') is False or raw.get('qualityStatus') in ('invalid','rejected') or
            not now-timedelta(days=180)<=at<=now):
            continue
        for mid,(rtype,field) in _METRIC_SOURCE.items():
            value=rep['metrics'].get(field)
            if rtype==rep['repType'] and isinstance(value,(int,float)) and math.isfinite(value) and value>0:
                groups[(mid,protocol)][str(session)].append((at,value,snap.id))
    output={}
    for (mid,protocol),sessions in groups.items():
        accepted=[rows for rows in sessions.values() if len(rows)>=3]
        if len(accepted)<2: continue
        rows=[v for values in accepted for v in values]
        md=BENCHMARK_METRICS[mid]
        if md.comparison is ComparisonKind.TARGET_BAND: continue # biomechanical target is not a skill percentile
        best=(max if md.comparison is ComparisonKind.HIGHER_IS_BETTER else min)(v[1] for v in rows)
        result={'metricId':mid,'protocolId':protocol,'best':best,'sessions':len(accepted),'trials':len(rows),
                'repIds':[v[2] for v in rows],'lastAt':max(v[0] for v in rows).isoformat()}
        previous=output.get(mid)
        if previous is None or result['lastAt']>previous['lastAt']: output[mid]=result
    return output


def _organization_coaches(db,coach,read=None):
    organization=coach.get('organization')
    data={}
    if hasattr(organization,'get'):
        data=_read(organization,read).to_dict() or {}
    elif isinstance(organization,str) and organization:
        org_id=organization.rstrip('/').split('/')[-1]
        data=_read(db.collection('organizations').document(org_id),read).to_dict() or {}
    if not data and coach.get('organizationCode'):
        matches=_read(db.collection('organizations').where('code','==',coach['organizationCode']),read)
        if len(matches)==1: data=matches[0].to_dict() or {}
    ids=set()
    for value in data.get('coaches') or []:
        if hasattr(value,'id'): ids.add(value.id)
        elif isinstance(value,str): ids.add(value.rstrip('/').split('/')[-1])
    return [s for s in _read(db.collection('coaches'),read) if s.id in ids or (s.to_dict() or {}).get('userUID') in ids]


def compute_peers(inv,player,age,read=None):
    from gateway.assemblers import BENCHMARK_METRICS,ComparisonKind,resolve_gender
    now=now_for(inv); coach_id,coach=resolve_coach(inv.db,inv.player_id,player,read=read)
    own=_metric_evidence(inv.db,inv.player_id,now,read)
    private={'metricValidityPolicy':{'windowDays':180,'minSessions':2,'minTrialsPerSession':3,'protocol':'explicit matching protocolId','unknownProtocol':'unavailable'},'athleteMetrics':own,'metrics':{}}
    if age is None or not coach_id:
        return {'status':'unavailable','reason':'cohort_too_small','cohort':{'kind':'roster','size':0}},private
    roster=set(coach.get('members') or [])
    coach_keys={coach_id,coach.get('userUID')}
    organization_coaches=_organization_coaches(inv.db,coach,read)
    org_roster=set(roster); org_keys=set(coach_keys)
    for snap in organization_coaches:
        row=snap.to_dict() or {}; org_roster.update(row.get('members') or []); org_keys.update((snap.id,row.get('userUID')))
    gender=resolve_gender(player); roster_people={}; org_people={}
    for snap in _read(inv.db.collection('players'),read):
        if snap.id==inv.player_id: continue
        row=snap.to_dict() or {}; peer_age,_,_=resolve_age(row,now=now)
        if peer_age is None or age_band(peer_age)!=age_band(age): continue
        peer_gender=resolve_gender(row)
        if gender!='unspecified' and peer_gender!='unspecified' and peer_gender!=gender: continue
        if snap.id in roster or (row.get('coachUID') and row['coachUID'] in coach_keys): roster_people[snap.id]=row
        if snap.id in org_roster or (row.get('coachUID') and row['coachUID'] in org_keys): org_people[snap.id]=row
    evidence={p:_metric_evidence(inv.db,p,now,read) for p in org_people}
    categories=defaultdict(list); kinds=[]; sizes=[]
    for mid, target in own.items():
        chosen={}; kind='roster'
        for kind,people in [('roster',roster_people),('organization',org_people)]:
            chosen={p:evidence[p][mid] for p in people if mid in evidence[p] and evidence[p][mid]['protocolId']==target['protocolId']}
            if len(chosen)>=5: break
        detail={'cohortKind':kind,'cohortCount':len(chosen),'protocolId':target['protocolId'],'peers':chosen,'percentile':None}
        private['metrics'][mid]=detail
        if len(chosen)<5: continue
        md=BENCHMARK_METRICS[mid]; values=[r['best'] for r in chosen.values()]
        worse=sum(v<target['best'] if md.comparison is ComparisonKind.HIGHER_IS_BETTER else v>target['best'] for v in values)
        ties=sum(v==target['best'] for v in values)
        pct=math.floor(100*(worse+.5*ties)/len(values)+.5)
        detail['percentile']=pct; categories[md.axis].append(pct); kinds.append(kind);sizes.append(len(chosen))
    if not categories:
        return {'status':'unavailable','reason':'cohort_too_small','cohort':{'kind':'organization' if organization_coaches else 'roster','size':len(org_people)}},private
    return {'status':'available','cohort':{'kind':'organization' if 'organization' in kinds else 'roster','size':min(sizes),'ageBand':age_band(age)},
            'percentiles':{cat:math.floor(sum(v)/len(v)+.5) for cat,v in categories.items()}},private


def assemble_program_profile(inv):
    from gateway.assemblers import assemble_athlete_stats
    intake=inv.context.get('programIntake') or validate_program_intake(inv)
    snap=inv.player_ref().get()
    if not snap.exists: raise context_unavailable('Player profile unavailable')
    player=snap.to_dict() or {}; now=now_for(inv)
    age,source,gaps=resolve_age(player,intake,now)
    position=player.get('position') if player.get('position') in POSITIONS else intake.get('position')
    position_source='playerDoc' if player.get('position') in POSITIONS else ('intake' if position else 'absent')
    stats_input=inv.params.get('statsProfile')
    if stats_input is not None:
        stats_input=assemble_athlete_stats(inv)
    else: stats_input={}
    # assemble_athlete_stats preserves the snapshot directly.
    categories={cat:None for cat in CATEGORY_DOMAIN}
    for axis in stats_input.get('axes') or []:
        if axis.get('axis') in categories: categories[axis['axis']]=axis.get('score')
    stats={'overallScore':stats_input.get('overallScore'),'categories':categories}
    best_results = _best_result_evidence(stats_input)
    peer,peer_private=compute_peers(inv,player,age)
    if peer['status']=='unavailable': gaps.append('Peer signal unavailable: fewer than five matched athletes with valid evidence.')
    if position is None: gaps.append('Position absent; using the position-neutral base.')
    if not best_results:
        gaps.append('No primary best results available; no best-result modifier was applied to the age and position baseline.')
    feedback=inv.player_ref().collection('privateProfile').document('coachFeedback').get().to_dict() or {}
    text=feedback.get('text','')
    if not isinstance(text,str) or len(text)>1000: raise context_unavailable('Coach feedback needs a valid text value of at most 1000 characters')
    emphasis=[]
    for item in feedback.get('emphasis') or []:
        if isinstance(item,dict) and item.get('domain') in DOMAINS and item.get('direction') in ('more','less'):
            emphasis.append({'domain':item['domain'],'direction':item['direction']})
    safe_feedback={'present':bool(text.strip()),'updatedAt':feedback.get('updatedAt'),'authorUid':feedback.get('authorUid'),
                   'textSha256':hashlib.sha256(text.encode()).hexdigest() if text.strip() else None,'emphasis':emphasis[:4],'parsedEmphasis':[]}
    technical=resolve_technical_eligibility(inv.db,inv.player_id,player)
    if technical['coachId'] is None:
        gaps.append('No unique coach association; no coach difficulty setting inherited.')
    else:
        coach_data=inv.db.collection('coaches').document(technical['coachId']).get().to_dict() or {}
        if 'maxDrillDifficulty' in coach_data and not integer(coach_data['maxDrillDifficulty'],1,5):
            gaps.append('Invalid stored coach difficulty setting treated as absent.')
    for data in [player]:
        if 'maxDrillDifficulty' in data and not integer(data['maxDrillDifficulty'],1,5): gaps.append('Invalid stored difficulty setting treated as absent.')
    result={'position':position,'positionSource':position_source,'age':age,'ageSource':source,'ageBand':age_band(age or 10),
            'level':intake.get('level','club'),'levelSource':'intake' if 'level' in (inv.params.get('intake') or {}) else 'default',
            'stats':stats,'peer':peer,'coachFeedback':safe_feedback,'technicalEligibility':technical,'intake':intake,'dataGaps':gaps,
            'measuredMetricIds':sorted(peer_private['athleteMetrics']), 'bestResults': best_results}
    # Private inputs live outside renderable context and public plan/result projections.
    inv.context['_programPrivate']={'coachFeedback':feedback,'peerEvidence':peer_private,'rawStatsProfile':stats_input}
    inv.context['programProfile']=result
    return result
