from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest

from gateway.errors import GatewayError
from gateway.whole_body import (validate_context, validate_policy, eligibility_reasons, bind_profile,
    session_date, session_allowed, load_violations, assert_activation_allowed, annotate_load_instructions)
from gateway.catalog_v2 import normalize_catalog_drill, eligible_drill
from gateway.program_profile import validate_program_intake
from gateway.personalized_views import public_plan
from tests.test_workout_persistence_v3 import setup, drill, workout, NOW


def context():
    return {'schemaVersion': 1, 'equipmentConfirmed': True, 'resistanceExperience': 'new',
            'sessionDays': [0, 3], 'supervision': 'qualifiedCoach', 'startDate': NOW.date().isoformat(),
            'externalSchedule': [], 'scheduleConfirmed': True}


def limits():
    # Synthetic test limits, not a real athlete prescription.
    return {'setsPerSession': 8, 'setsPerWeek': 12, 'contactsPerSession': 40,
            'contactsPerWeek': 80, 'holdSecondsPerSession': 120, 'holdSecondsPerWeek': 240,
            'minRecoveryHours': 48}


def policy(**updates):
    return {'version': 'whole-body-v1', 'modality': 'resistance', 'loadFamilies': ['knee'],
            'requiresClearance': True, 'requiresVerifiedMobile': True, 'reviewStatus': 'approved',
            'progression': 'coachReviewed', 'loaded': True, 'loadingInstructions': 'Use the load chosen by your coach.',
            'supervision': 'clearance', 'limits': limits(), 'evidenceLinks': [], **updates}


def ready():
    return {'schemaVersion': 1, 'status': 'cleared', 'loadFamilies': ['knee'], 'supervision': 'qualifiedCoach',
            'reviewedAt': NOW.isoformat(), 'expiresAt': (NOW+timedelta(days=60)).isoformat(),
            'reviewedBy': 'reviewer', 'revision': 1, 'limits': limits(),
            'exerciseLoads': {'STR-501': {'instruction': 'Coach-selected practice load.', 'independentAllowed': False},
                              'STR-502': {'instruction': 'Coach-selected practice load.', 'independentAllowed': False}}}


def row(did='STR-501', **changes):
    result = drill(did)
    result.update(name='Synthetic squat', domain='strength', equipment=['dumbbells'],
                  trainingPolicy=policy(), **changes)
    return result


def profile():
    return {'age': 15, 'ageSource': 'playerDocAge', 'technicalEligibility': {'maxDrillDifficulty': 5},
            'intake': {'equipment': ['dumbbells'], 'setting': 'solo', 'trainingContext': context()},
            'wholeBody': {'readiness': ready(), 'reviewerEnabled': True, 'now': NOW,
                          'previewEnabled': True, 'mobileVerified': False, 'preview': True}}


def blocks(*ids, sets=3):
    return {'workoutId': 'current', 'order': 1, 'blocks': [
        {'blockId': f'b{i+1}', 'drillId': did, 'sets': sets, 'reps': 6, 'repUnit': 'reps', 'perSide': False}
        for i, did in enumerate(ids)]}


def test_legacy_rows_and_intake_do_not_acquire_gym_defaults():
    inv, _ = setup()
    inv.params = {'planVersion': 3, 'timezone': 'UTC', 'intake': {
        'horizonWeeks': 2, 'sessionsPerWeek': 2, 'minutesPerSession': 15,
        'setting': 'solo', 'equipment': ['ball'], 'level': 'club'}}
    assert 'trainingContext' not in validate_program_intake(inv)
    assert eligibility_reasons(drill(), {}) == []
    assert 'whole_body_not_enabled' in eligibility_reasons(row(), {'age': 15, 'intake': {}})


@pytest.mark.parametrize('key,value', [('coachClearance', True), ('reviewedBy', 'reviewer'),
                                     ('supervision', 'independentCleared'), ('sessionDays', [{}, 1]),
                                     ('sessionDays', [True, 2]), ('startDate', '2026-13-01')])
def test_context_rejects_spoofed_clearance_and_malformed_schedule(key, value):
    value_context = context(); value_context[key] = value
    with pytest.raises(GatewayError): validate_context(value_context, 2)


@pytest.mark.parametrize('mutation,reason', [
    ('pending', 'content_review_pending'), ('revoked', 'coach_clearance_required'),
    ('expired', 'coach_clearance_required'), ('future', 'coach_clearance_required'),
    ('family', 'movement_clearance_required'), ('load', 'individual_load_instruction_required'),
    ('supervision', 'qualified_supervision_required'), ('equipment', 'equipment_unconfirmed'),
    ('schedule', 'schedule_unconfirmed'), ('mobile', 'mobile_release_pending'),
    ('age', 'whole_body_age_unconfirmed'), ('limits', 'reviewed_load_limits_required')])
def test_independent_fail_closed_eligibility_gates(mutation, reason):
    athlete = profile(); exercise = row()
    if mutation == 'pending': exercise['trainingPolicy']['reviewStatus'] = 'pending'
    if mutation == 'revoked': athlete['wholeBody']['reviewerEnabled'] = False
    if mutation == 'expired': athlete['wholeBody']['readiness']['expiresAt'] = NOW.isoformat()
    if mutation == 'future': athlete['wholeBody']['readiness']['reviewedAt'] = (NOW+timedelta(days=1)).isoformat()
    if mutation == 'family': athlete['wholeBody']['readiness']['loadFamilies'] = []
    if mutation == 'load': athlete['wholeBody']['readiness']['exerciseLoads'] = {}
    if mutation == 'supervision': athlete['intake']['trainingContext']['supervision'] = 'unavailable'
    if mutation == 'equipment': athlete['intake']['trainingContext']['equipmentConfirmed'] = False
    if mutation == 'schedule': athlete['intake']['trainingContext']['scheduleConfirmed'] = False
    if mutation == 'mobile': athlete['wholeBody']['preview'] = False
    if mutation == 'age': athlete['ageSource'] = 'absent'
    if mutation == 'limits': athlete['wholeBody']['readiness']['limits'] = {}
    assert reason in eligibility_reasons(exercise, athlete)


def test_independent_training_requires_both_family_and_exercise_clearance():
    athlete = profile(); athlete['intake']['trainingContext']['supervision'] = 'unavailable'
    athlete['wholeBody']['readiness']['supervision'] = 'independent'
    assert 'exercise_supervision_required' in eligibility_reasons(row(), athlete)
    athlete['wholeBody']['readiness']['exerciseLoads']['STR-501']['independentAllowed'] = True
    assert eligibility_reasons(row(), athlete) == []


def test_fresh_reviewer_grant_revocation_is_authoritative():
    inv, _ = setup()
    inv.capability = 'generate_personalized_plan'
    inv.db.set_doc(('players', inv.player_id, 'privateProfile', 'trainingReadiness'), ready())
    inv.db.set_doc(('config', 'llm'), {'wholeBodyTraining': {'previewEnabled': True}})
    inv.db.set_doc(('trainingReviewers', 'reviewer'), {'enabled': True, 'scopeType': 'posetek'})
    athlete = profile(); bind_profile(inv, athlete)
    assert not eligibility_reasons(row(), athlete)
    inv.db.set_doc(('trainingReviewers', 'reviewer'), {'enabled': False, 'scopeType': 'posetek'})
    bind_profile(inv, athlete)
    assert 'coach_clearance_required' in eligibility_reasons(row(), athlete)


def test_reviewer_must_still_be_assigned_to_this_athlete():
    inv, _ = setup()
    inv.db.set_doc(('players', inv.player_id, 'privateProfile', 'trainingReadiness'), ready())
    inv.db.set_doc(('trainingReviewers', 'reviewer'), {'enabled': True, 'scopeType': 'assignedPlayers'})
    athlete = profile(); bind_profile(inv, athlete)
    assert athlete['wholeBody']['reviewerEnabled'] is False
    inv.db.set_doc(('coaches', 'c'), {'userUID': 'reviewer', 'members': [inv.player_id]})
    bind_profile(inv, athlete)
    assert athlete['wholeBody']['reviewerEnabled'] is True


def test_real_weekdays_anchor_dates_across_plan_boundaries():
    assert session_date(context(), 1, 1).isoformat() == '2026-09-06'
    assert session_date(context(), 1, 2).isoformat() == '2026-09-09'
    assert session_date(context(), 2, 1).isoformat() == '2026-09-13'
    value = context(); value['startDate'] = '2026-09-08'
    assert session_date(value, 1, 1).isoformat() == '2026-09-09'


def test_external_match_and_expiring_clearance_prevent_unsafe_slot():
    athlete = profile()
    athlete['intake']['trainingContext']['externalSchedule'] = [{'day': 1, 'activity': 'match', 'durationMinutes': 60, 'effort': 'hard'}]
    assert not session_allowed(row(), athlete, 1, 1)
    assert session_allowed(row(), athlete, 1, 2)
    athlete['wholeBody']['readiness']['expiresAt'] = '2026-09-08T00:00:00Z'
    assert not session_allowed(row(), athlete, 1, 2)


def test_different_exercise_ids_cannot_evade_shared_load_caps():
    catalog = {did: row(did) for did in ('STR-501', 'STR-502')}
    violations = load_violations(blocks('STR-501', 'STR-502', sets=5), catalog, profile())
    assert 'load_limit_setsPerSession' in violations


def test_isometric_and_loaded_strength_share_same_family_budget():
    iso = row('STR-502'); iso['trainingPolicy'] = policy(modality='isometric', loaded=False)
    candidate = blocks('STR-501', 'STR-502', sets=5)
    candidate['blocks'][1].update(repUnit='seconds', reps=20)
    violations = load_violations(candidate, {'STR-501': row(), 'STR-502': iso}, profile())
    assert 'load_limit_setsPerSession' in violations


def test_recovery_boundary_and_rolling_week_do_not_reset_on_monday():
    previous = blocks('STR-502', sets=5); previous['workoutId'] = 'previous'
    catalog = {'STR-501': row(), 'STR-502': row('STR-502')}
    violations = load_violations(blocks('STR-501'), catalog, profile(),
                                prior_workouts=[(NOW.date()-timedelta(days=1), previous)])
    assert 'recovery_spacing' in violations
    violations = load_violations(blocks('STR-501', sets=8), catalog, profile(),
                                prior_workouts=[(NOW.date()-timedelta(days=5), previous)])
    assert 'load_limit_setsPerWeek' in violations


def test_partial_or_undated_external_work_is_not_silently_ignored():
    catalog = {'STR-501': row(), 'STR-502': row('STR-502')}
    assert 'load_history_incomplete' in load_violations(blocks('STR-501'), catalog, profile(),
                                                       prior_workouts=[(None, blocks('STR-502'))])


def test_plyometric_timed_reps_do_not_invent_contact_count():
    exercise = row(); exercise['trainingPolicy'] = policy(modality='plyometric', loaded=False)
    candidate = blocks('STR-501'); candidate['blocks'][0].update(repUnit='seconds', reps=20)
    assert 'plyometric_contacts_unquantified' in load_violations(candidate, {'STR-501': exercise}, profile())


def test_mobile_gate_ignores_client_claimed_verification():
    inv, _ = setup(); inv.params['mobileVerified'] = True
    with pytest.raises(GatewayError, match='mobile support'):
        assert_activation_allowed(inv, {'STR-501': row()})
    inv.db.set_doc(('config', 'llm'), {'wholeBodyTraining': {'mobileVerified': True}})
    assert_activation_allowed(inv, {'STR-501': row()})
    assert_activation_allowed(inv, {'DRB-501': drill()})


def test_projection_preserves_load_instructions_without_private_clearance():
    candidate = blocks('STR-501'); annotate_load_instructions(candidate, {'STR-501': row()}, profile())
    projected = public_plan({'schemaVersion': 3, 'trainingPolicyVersion': 'whole-body-v1',
        'intake': profile()['intake'], 'assessment': {'inputs': {'wholeBody': profile()['wholeBody']}},
        'weeks': [{'weekNumber': 1, 'workouts': [candidate]}]})
    assert projected['weeks'][0]['workouts'][0]['blocks'][0]['loadingInstructions'] == 'Coach-selected practice load.'
    assert projected['intake']['trainingContext']['scheduleConfirmed'] is True
    assert 'reviewedBy' not in str(projected)


@pytest.mark.parametrize('patch', [{'loaded': True, 'requiresVerifiedMobile': False},
                                  {'modality': 'plyometric', 'limits': {'setsPerSession': 1, 'setsPerWeek': 2}},
                                  {'reviewStatus': 'researched'}, {'progression': 'increaseEveryWeek'}])
def test_invalid_review_and_progression_policies_are_not_executable(patch):
    with pytest.raises(GatewayError): validate_policy(policy(**patch))


def test_catalog_normalization_preserves_policy_and_draft_never_qualifies():
    exercise = row(); exercise['status'] = 'draft'
    normalized = normalize_catalog_drill(exercise['drillId'], exercise)
    assert normalized['trainingPolicy'] == policy()
    assert 'not_published' in eligible_drill(normalized, profile())[1]


def test_unknown_training_experience_does_not_infer_gym_readiness():
    athlete = profile(); athlete['intake']['trainingContext']['resistanceExperience'] = 'unknown'
    assert 'training_experience_unconfirmed' in eligibility_reasons(row(), athlete)


def test_new_direct_test_links_require_review_and_same_task_domain():
    from gateway.personalized_objectives import methodology, reviewed_drills
    objective = next(s for s in methodology()['objectives'] if s['id'] == 'short_sprint')
    exercise = row('SPD-501'); exercise['domain'] = 'speed'
    exercise['trainingPolicy']['evidenceLinks'] = [{'objectiveId': 'short_sprint', 'relationship': 'direct',
                                                  'weight': 1, 'sourceIds': ['reviewed-study']}]
    catalog = {'SPD-501': exercise}
    assert reviewed_drills(objective, catalog) == ['SPD-501']
    exercise['trainingPolicy']['reviewStatus'] = 'pending'
    assert reviewed_drills(objective, catalog) == []
    exercise['trainingPolicy']['reviewStatus'] = 'approved'
    exercise['trainingPolicy']['evidenceLinks'][0].update(relationship='support', weight=.5)
    assert reviewed_drills(objective, catalog) == []
    exercise['trainingPolicy']['evidenceLinks'][0].update(relationship='direct', weight=1)
    exercise['domain'] = 'strength'
    assert reviewed_drills(objective, catalog) == []


def test_support_ranking_keeps_direct_test_practice_first_and_does_not_diagnose():
    from gateway.personalized_objectives import rank_drills, block_rationale
    from tests.test_evidence_objectives_v1 import profile_and_catalog, focus
    _, athlete, catalog, _, capacity = profile_and_catalog(('sprintCompletionTime', 45))
    split = focus(athlete, catalog, capacity)
    exercise = row()
    exercise['trainingPolicy']['evidenceLinks'] = [{'objectiveId': 'short_sprint', 'relationship': 'support',
                                                 'weight': .5, 'sourceIds': ['reviewed-study']}]
    catalog['STR-501'] = exercise; athlete['wholeBody'] = profile()['wholeBody']
    ranking = rank_drills(catalog, athlete)
    primary = next(p for p in split['priorities'] if p['role'] == 'primary')
    assert ranking.index(primary['eligibleDrillIds'][0]) < ranking.index('STR-501')
    rationale, summary = block_rationale(exercise, split['priorities'], catalog)
    assert rationale['objectiveId'] == 'short_sprint'
    assert 'does not identify a muscle weakness' in rationale['reason']
    assert 'capacity practice' in summary
    exercise['trainingPolicy']['reviewStatus'] = 'pending'
    assert 'No specific measured weakness' in block_rationale(exercise, split['priorities'], catalog)[1]


def test_loaded_dose_does_not_progress_automatically_across_weeks():
    from gateway.personalized_composition import _progression_options
    original = workout()['blocks'][0]
    result = _progression_options(row(), original, profile())
    assert len(result) == 1
    assert result[0]['sets'] == original['sets'] and result[0]['reps'] == original['reps']


def test_new_support_allocation_stays_inside_existing_priority_and_time_caps():
    from tests.test_evidence_objectives_v1 import profile_and_catalog, focus
    _, athlete, catalog, _, capacity = profile_and_catalog(('sprintCompletionTime', 45))
    legacy = focus(deepcopy(athlete), catalog, capacity)
    exercise = row()
    exercise['trainingPolicy']['evidenceLinks'] = [{'objectiveId': 'short_sprint', 'relationship': 'support',
                                                 'weight': .5, 'sourceIds': ['reviewed-study']}]
    catalog['STR-501'] = exercise; athlete['wholeBody'] = profile()['wholeBody']
    expanded = focus(athlete, catalog, capacity)
    assert expanded['measuredPriorityDomains'] == legacy['measuredPriorityDomains']
    assert sum(expanded['afterGaps'].values()) == 100
    assert expanded['afterGaps']['strength'] >= legacy['afterGaps']['strength']
    assert all(expanded['afterGaps'][d] >= legacy['afterGaps'][d] for d in legacy['measuredPriorityDomains'])
    assert max(abs(expanded['afterGaps'][d] - expanded['base'][d]) for d in expanded['base']) <= 5
    assert sum(abs(expanded['afterGaps'][d] - expanded['base'][d]) for d in expanded['base']) <= 20
