"""Explicit public review projection. Private evidence and internal diagnostics never cross it."""
from copy import deepcopy
from datetime import datetime, date
from gateway.program_profile import DOMAINS, CATEGORY_DOMAIN


def pick(value, keys):
    def public_scalar(item):
        return item is None or isinstance(item, (str, int, float, bool, datetime, date))
    return {key: deepcopy(value[key]) for key in keys.split() if isinstance(value, dict) and key in value
            and (public_scalar(value[key]) or (isinstance(value[key], list)
                 and all(public_scalar(item) for item in value[key])))}


def rows(value, project):
    return [project(row) for row in value] if isinstance(value, list) else []


def amounts(value, allowed=DOMAINS):
    return {key: number for key, number in value.items() if key in allowed
            and isinstance(number, (int, float)) and not isinstance(number, bool)} if isinstance(value, dict) else {}


def evidence_policy(value):
    return pick(value, 'version windowDays status source confidence oldestAt newestAt reason')


def intake_view(value):
    return pick(value, 'horizonWeeks sessionsPerWeek minutesPerSession setting equipment level goals '
                'freeTextGoals painFlag age position')


def assessment_view(value):
    result = pick(value, 'engineVersion assessedAt summary dataGaps')
    result['findings'] = rows(value.get('findings'), lambda row: pick(row,
        'domain basis confidence statement targetBeforePct targetAfterEvidencePct targetFinalPct applied limitation'))
    source = value.get('inputs') or value
    peer = source.get('peer') or {}
    safe_peer = pick(peer, 'status reason')
    safe_peer['cohort'] = pick(peer.get('cohort'), 'kind size ageBand')
    safe_peer['percentiles'] = amounts(peer.get('percentiles'), CATEGORY_DOMAIN)
    result['inputs'] = {'evidencePolicy': evidence_policy(source.get('evidencePolicy')),
                        'peer': safe_peer}
    # Assessment jobs historically render these at the top level.
    result['evidencePolicy'] = result['inputs']['evidencePolicy']
    result['peer'] = safe_peer
    result['intake'] = intake_view(value.get('intake'))
    result['curriculum'] = rows(value.get('curriculum'), lambda row: {
        **pick(row, 'domain publishedDrills eligibleDrills status'),
        'excludedReasons': {str(k): v for k, v in (row.get('excludedReasons') or {}).items()
                            if isinstance(v, int) and not isinstance(v, bool)}})
    split = value.get('focusSplit') or {}
    result['focusSplit'] = (amounts(split) if any(key in DOMAINS for key in split)
                            else {key: amounts(split.get(key)) for key in ('base', 'afterGaps', 'final')})
    return result


def workout_view(value):
    result = pick(value, 'workoutId revision order title intent theme estimatedMinutes budgetMinutes focusDomains '
        'nextBlockSequence editedBy editorUid editedAt previousRevision')
    result['blocks'] = rows(value.get('blocks'), lambda block: pick(block,
        'blockId order drillId drillName name kind domain sets reps repUnit perSide restSeconds restScope '
        'restBetweenSetsSeconds familiarizationReps estimatedMinutes whyIncluded'))
    result['check'] = pick(value.get('check'), 'timeStatus deltaMinutes intentStatus checkedAt notes adversarialPassed')
    return result


def week_view(value):
    result = pick(value, 'weekNumber theme focus progressionNote transitionMinutes')
    result['workouts'] = rows(value.get('workouts'), workout_view)
    result['allocations'] = rows(value.get('allocations'), lambda row: pick(row, 'domain minutes percentage'))
    result['actualMinutesByDomain'] = amounts(value.get('actualMinutesByDomain'))
    result['focusSplit'] = amounts(value.get('focusSplit'))
    result['targets'] = rows(value.get('targets'), lambda row: pick(row, 'domain exposures'))
    check = value.get('check') or {}
    result['check'] = pick(check, 'estimatedMinutes budgetMinutes passed')
    result['check']['allocationShortfallsMinutes'] = amounts(check.get('allocationShortfallsMinutes'))
    result['check']['doseProgression'] = pick(check.get('doseProgression'), 'retainedBlocks progressedBlocks')
    result['check']['allocation'] = {'domains': rows((check.get('allocation') or {}).get('domains'),
        lambda row: pick(row, 'domain targetMinutes actualMinutes differenceMinutes toleranceMinutes met'))}
    projection = check.get('allocationProjection') or {}
    result['check']['allocationProjection'] = {'foldedMinutesByDomain': amounts(projection.get('foldedMinutesByDomain'))}
    return result


def public_plan(plan):
    result = pick(plan, 'schemaVersion planId playerId jobId engineVersion generatedAt status startDate timezone '
        'horizonWeeks sessionsPerWeek minutesPerSession weeklyBudgetMinutes planRevision disclaimers '
        'updatedAt lastEdit catalogVersion activatedAt activatedByUid sourceDraftId generationContextRef')
    result['intake'] = intake_view(plan.get('intake'))
    result['assessment'] = assessment_view(plan.get('assessment') or {})
    result['weeks'] = rows(plan.get('weeks'), week_view)
    result['focusAreas'] = rows(plan.get('focusAreas'), lambda row: pick(row, 'domain rationale'))
    return result


def draft_view(draft):
    result = pick(draft, 'schemaVersion draftId playerId createdByUid jobId engineVersion status createdAt '
        'expiresAt comparisonToken replacementPolicy activatedPlanId activatedAt discardedAt')
    result['expectedActivePlans'] = rows(draft.get('expectedActivePlans'), lambda row: pick(row, 'planId planRevision'))
    result['plan'] = public_plan(draft.get('plan') or {})
    return result


def job_result(capability, result):
    if capability == 'assess_personalized_plan':
        return assessment_view(result)
    return pick(result, 'draftId status engineVersion planId replayed')
