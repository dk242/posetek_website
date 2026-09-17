"""Real transaction-decorator tests: fake DB checks atomic reads/writes and retries."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from gateway.ctx import Invocation
from gateway.errors import GatewayError
from gateway.authz import authorize_v3, resolve_job_identity
from gateway.workout_persistence import (persist_program, persist_workout_draft, apply_workout_draft,
    load_original_workout, assemble_workout_context, resume_workout_draft, document_size, enforce_document_size)
from tests.conftest import FakeFirestore, FakeStorage

NOW = datetime(2026, 9, 6, 12, tzinfo=timezone.utc)


def drill(did='DRB-501', frequency=6, difficulty=1):
    return {'schemaVersion': 2, 'drillId': did, 'name': 'Controlled touches', 'domain': 'dribbling',
            'minAge': 5, 'maxAge': 99, 'difficultyLevel': difficulty, 'equipment': ['ball'],
            'requiresPartner': False, 'status': 'published', 'maxFrequencyPerWeek': frequency,
            'howTo': {'setup': 'Use a ball.', 'steps': ['Move with controlled touches.']},
            'coachComments': [], 'adaptiveLevers': [], 'dose': {'setsMin': 1, 'setsMax': 3,
            'repsMin': 60, 'repsMax': 300, 'repUnit': 'seconds', 'perSide': False,
            'restSecondsMin': 0, 'restSecondsMax': 0, 'restScope': 'sets', 'familiarizationReps': 0}}


def workout(wid='w1s1', order=1, did='DRB-501'):
    return {'workoutId': wid, 'order': order, 'title': 'Controlled touches', 'intent': 'Practice dribbling with controlled touches.',
            'focusDomains': ['dribbling'], 'budgetMinutes': 15, 'estimatedMinutes': 15,
            'revision': 1, 'editedBy': 'generator', 'editedAt': NOW, 'editorUid': None,
            'previousRevision': None, 'nextBlockSequence': 2,
            'check': {'timeStatus': 'ok', 'deltaMinutes': 0, 'intentStatus': 'pass', 'checkedAt': NOW, 'notes': []},
            'blocks': [{'blockId': 'b1', 'order': 1, 'kind': 'main', 'drillId': did,
                       'name': 'Controlled touches', 'domain': 'dribbling', 'sets': 3, 'reps': 300,
                       'repUnit': 'seconds', 'perSide': False, 'restSeconds': 0, 'restScope': 'sets',
                       'restBetweenSetsSeconds': None, 'familiarizationReps': 0,
                       'estimatedMinutes': 15, 'whyIncluded': 'Improve close control.'}]}


def plan():
    return {'schemaVersion': 3, 'planId': 'p', 'playerId': 'player', 'catalogVersion': '2.0.0',
            'status': 'active', 'startDate': NOW.date().isoformat(), 'timezone': 'UTC',
            'horizonWeeks': 2, 'sessionsPerWeek': 2, 'minutesPerSession': 15, 'weeklyBudgetMinutes': 30,
            'planRevision': 1, 'intake': {'horizonWeeks': 2, 'sessionsPerWeek': 2, 'minutesPerSession': 15,
            'setting': 'solo', 'equipment': ['ball'], 'age': 15, 'level': 'club', 'painFlag': False},
            'assessment': {'inputs': {'position': 'CB', 'ageBand': 'U15-U16', 'level': 'club',
              'technicalEligibility': {'maxDrillDifficulty': 5, 'source': 'default', 'coachId': None}},
              'focusSplit': {'final': {'dribbling': 100}}},
            'weeks': [{'weekNumber': n, 'theme': 'Control', 'focus': 'Control', 'progressionNote': None,
              'allocations': [{'domain': 'dribbling', 'minutes': 30}], 'focusSplit': {'dribbling': 100},
              'targets': [{'domain': 'dribbling', 'exposures': 2}],
              'workouts': [workout(f'w{n}s1', 1), workout(f'w{n}s2', 2)]} for n in (1, 2)]}


def setup():
    db = FakeFirestore(); storage = FakeStorage()
    db.set_doc(('players', 'player'), {'authenticationUID': 'athlete', 'age': 15})
    db.set_doc(('drillCatalog', 'DRB-501'), drill())
    inv = Invocation(capability='generate_training_plan', player_id='player', uid='athlete',
                     job_id='generation1', db=db, storage=storage, context={'now': NOW})
    original = persist_program(inv, plan(), {'rawCoachNote': 'Private coach material', 'modelConfig': {'assess': 'fixture'}})
    return inv, original


def proposal(inv, wid='w1s1', title='Today controlled touches', did=None, *, target_kind='plan'):
    context = {'kind': 'plan', 'planId': 'p', 'workoutId': wid} if target_kind == 'plan' else {'kind': 'new', 'planId': 'p', 'timeAvailableMinutes': 15, 'energy': 'normal'}
    inv.capability = 'workout_chat'; inv.conversation_id = 'c-' + wid
    inv.params = {'context': {'workoutRef': context}, 'message': 'Focus on controlled dribbling today.'}
    inv.context.pop('workoutContext', None);inv.context.pop('workoutDraft', None);inv.context.pop('resumedDraftId', None)
    current = assemble_workout_context(inv)
    value = deepcopy(current['workout']) if target_kind == 'plan' else workout('adhoc', 1)
    value['title'] = title
    if did:
        value['blocks'][0]['drillId'] = did
        value['blocks'][0]['blockId'] = 'b2';value['nextBlockSequence'] = 3
    inv.context['workoutDraft'] = {'target': deepcopy(current['target']), 'workout': value}
    return persist_workout_draft(inv, source_message_id='m1')


def apply(inv, draft):
    inv.capability = 'apply_workout_draft'; inv.params = {'draftId': draft['draftId']}
    return apply_workout_draft(inv)


def saved_plan(inv): return inv.db.get_doc(('players', 'player', 'trainingPlans', 'p'))


def test_generation_persists_private_originals_atomically():
    inv, out = setup()
    assert out['schemaVersion'] == 3 and 'rawCoachNote' not in str(out)
    assert load_original_workout(inv, out, 'w1s1')['title'] == 'Controlled touches'
    private = inv.db.get_doc(('players', 'player', 'trainingPlanContexts', 'p'))
    assert private['rawCoachNote'] == 'Private coach material'
    assert private['originalWorkouts']['w2s2']['blocks']
    assert inv.db.get_doc(('players', 'player', 'workoutSchedule', 'current'))['revision'] == 1


def test_repeated_generation_and_apply_are_idempotent():
    inv, original = setup()
    assert persist_program(inv, plan(), {'rawCoachNote': 'Private coach material'}) == original
    draft = proposal(inv)
    first = apply(inv, draft); second = apply(inv, draft)
    assert first == second and saved_plan(inv)['planRevision'] == 2
    assert len(inv.db.get_collection(('players', 'player', 'planAdjustments'))) == 1


def test_apply_records_original_check_and_snapshot_without_touching_logs():
    inv, out = setup()
    frozen = deepcopy(out['weeks'][0]['workouts'][0])
    inv.db.set_doc(('players', 'player', 'workoutLogs', 'p_w1s1'), {'workoutSnapshot': frozen, 'startedAt': NOW, 'endedAt': None})
    before_logs = deepcopy(inv.db.get_collection(('players', 'player', 'workoutLogs')))
    result = apply(inv, proposal(inv))
    current = saved_plan(inv)['weeks'][0]['workouts'][0]
    assert current['revision'] == 2 and current['editedBy'] == 'athlete'
    assert current['previousRevision']['title'] == 'Controlled touches'
    assert 'previousRevision' not in current['previousRevision']
    audit = inv.db.get_doc(('players', 'player', 'planAdjustments', saved_plan(inv)['lastEdit']['adjustmentId']))
    assert audit['generatorIntent'] == frozen['intent']
    assert audit['before']['nextBlockSequence'] == 2
    assert audit['newPlanRevision'] == 2 and audit['editor']['role'] == 'athlete'
    assert inv.db.get_collection(('players', 'player', 'workoutLogs')) == before_logs


def test_restore_after_multiple_edits_preserves_sibling_and_log():
    inv, out = setup()
    apply(inv, proposal(inv, title='Second version'))
    apply(inv, proposal(inv, title='Third version'))
    apply(inv, proposal(inv, wid='w1s2', title='Sibling changed'))
    draft = proposal(inv, title='Restore draft')
    original = load_original_workout(inv, saved_plan(inv), 'w1s1')
    current = inv.context['workoutDraft']['workout']
    original['revision'] = current['revision']; original['nextBlockSequence'] = current['nextBlockSequence']
    inv.context['workoutDraft']['workout'] = original
    restored = persist_workout_draft(inv, ask='Restore the original workout.')
    apply(inv, restored)
    weeks = saved_plan(inv)['weeks']
    assert weeks[0]['workouts'][0]['title'] == 'Controlled touches'
    assert weeks[0]['workouts'][0]['revision'] == 4
    assert weeks[0]['workouts'][1]['title'] == 'Sibling changed'


def test_simultaneous_sibling_edit_is_preserved_on_retry():
    inv, out = setup(); draft = proposal(inv)
    def concurrent(db):
        p = saved_plan(inv); p['weeks'][0]['workouts'][1]['title'] = 'Concurrent sibling'
        p['weeks'][0]['workouts'][1]['revision'] = 2;p['planRevision'] = 2
        db.set_doc(('players', 'player', 'trainingPlans', 'p'), p)
        db.set_doc(('players', 'player', 'workoutSchedule', 'current'), {'schemaVersion': 1, 'revision': 2, 'updatedAt': NOW})
    inv.db.before_commit = concurrent
    apply(inv, draft)
    assert saved_plan(inv)['weeks'][0]['workouts'][1]['title'] == 'Concurrent sibling'
    assert saved_plan(inv)['planRevision'] == 3


def test_same_target_conflict_keeps_proposal_and_has_no_audit():
    inv, out = setup(); draft = proposal(inv)
    def concurrent(db):
        p = saved_plan(inv);p['weeks'][0]['workouts'][0]['revision'] = 2
        db.set_doc(('players', 'player', 'trainingPlans', 'p'), p)
    inv.db.before_commit = concurrent
    with pytest.raises(GatewayError, match='workout changed'):
        apply(inv, draft)
    assert inv.db.get_doc(('players', 'player', 'workoutDrafts', draft['draftId']))['status'] == 'proposed'
    assert not inv.db.get_collection(('players', 'player', 'planAdjustments'))


@pytest.mark.parametrize('change', ['archived', 'dose', 'playerDifficulty', 'coachDifficulty', 'age', 'equipment'])
def test_apply_revalidates_current_catalog_player_and_coach(change):
    inv, out = setup(); draft = proposal(inv)
    if change == 'archived':
        d=drill();d['status']='archived';inv.db.set_doc(('drillCatalog','DRB-501'), d)
    if change == 'dose':
        d=drill();d['dose']['repsMax']=100;inv.db.set_doc(('drillCatalog','DRB-501'),d)
    if change in ('playerDifficulty','coachDifficulty'):
        inv.db.set_doc(('drillCatalog','DRB-501'),drill(difficulty=3))
        player={'authenticationUID':'athlete','age':15}
        if change=='playerDifficulty':player['maxDrillDifficulty']=2
        else:
            player['coachUID']='coach-auth';inv.db.set_doc(('coaches','coach-doc'),{'userUID':'coach-auth','maxDrillDifficulty':2})
        inv.db.set_doc(('players','player'),player)
    if change=='age':
        d=drill();d['minAge']=16;inv.db.set_doc(('drillCatalog','DRB-501'),d)
    if change=='equipment':
        d=drill();d['equipment']=['goal'];inv.db.set_doc(('drillCatalog','DRB-501'),d)
    with pytest.raises(GatewayError):apply(inv,draft)
    assert saved_plan(inv)['planRevision']==1
    assert not inv.db.get_collection(('players','player','planAdjustments'))


def test_two_contending_edits_cannot_take_same_last_frequency_exposure():
    inv, out=setup();inv.db.set_doc(('drillCatalog','DRB-502'),drill('DRB-502',frequency=1))
    a=proposal(inv,'w1s1',did='DRB-502');b=proposal(inv,'w1s2',did='DRB-502')
    other=deepcopy(inv);other.db=inv.db;other.storage=inv.storage
    inv.db.before_commit=lambda db:apply(other,b)
    with pytest.raises(GatewayError):apply(inv,a)
    p=saved_plan(inv)
    assert p['weeks'][0]['workouts'][0]['blocks'][0]['drillId']=='DRB-501'
    assert p['weeks'][0]['workouts'][1]['blocks'][0]['drillId']=='DRB-502'
    assert len(inv.db.get_collection(('players','player','planAdjustments')))==1


def test_proposal_immutability_resume_supersede_and_target_binding():
    inv, out=setup();a=proposal(inv)
    original=deepcopy(inv.db.get_doc(('players','player','workoutDrafts',a['draftId'])))
    inv.context['workoutDraft']['workout']['title']='Changed next turn'
    b=persist_workout_draft(inv,ask='Shorter controlled practice please.')
    old=inv.db.get_doc(('players','player','workoutDrafts',a['draftId']))
    assert old['workout']==original['workout'] and old['status']=='superseded'
    assert a['draftId']!=b['draftId']
    inv.conversation_id='another-conversation'
    with pytest.raises(GatewayError):resume_workout_draft(inv,b['draftId'])


def test_draft_creator_and_expiry_denied_without_writes():
    inv, out=setup();d=proposal(inv)
    inv.uid='other'
    with pytest.raises(GatewayError):apply(inv,d)
    inv.uid='athlete';inv.context['now']=NOW+timedelta(days=2)
    with pytest.raises(GatewayError,match='expired'):apply(inv,d)
    assert saved_plan(inv)['planRevision']==1


def test_ready_adhoc_reservation_is_idempotent_and_logged_target_frozen():
    inv, out=setup();d=proposal(inv,target_kind='new');r=apply(inv,d)
    assert r['applied'] and r['target']['kind']=='adhoc' and apply(inv,d)==r
    adhoc=inv.db.get_doc(('players','player','plannedWorkouts',r['target']['plannedWorkoutId']))
    assert adhoc['status']=='ready' and adhoc['windowEnd']
    inv.db.set_doc(('players','player','workoutLogs',r['target']['plannedWorkoutId']),{'startedAt':NOW,'endedAt':None,'workoutSnapshot':adhoc})
    inv.params={'context':{'workoutRef':{'kind':'adhoc','plannedWorkoutId':r['target']['plannedWorkoutId']}}}
    with pytest.raises(GatewayError,match='frozen'):assemble_workout_context(inv)
    assert saved_plan(inv)['planRevision']==1


def test_generation_context_externalizes_and_checks_hash():
    inv,out=setup();p=plan();p['planId']='p2';inv.job_id='generation2'
    result=persist_program(inv,p,{'rawCoachNote':'secret','largeEvidence':'x'*500000})
    context=inv.db.get_doc(('players','player','trainingPlanContexts','p2'))
    assert 'artifactRef' in context and 'largeEvidence' not in context
    assert load_original_workout(inv,result,'w1s1')['blocks']
    path=context['artifactRef']['path'];inv.storage._files[path]['originalWorkouts']['w1s1']['title']='tampered'
    with pytest.raises(GatewayError,match='integrity'):load_original_workout(inv,result,'w1s1')


@pytest.mark.parametrize('weeks,sessions,blocks',[(12,4,8),(12,6,12)])
def test_maximum_document_shapes_are_measured_without_silent_truncation(weeks,sessions,blocks):
    p=plan();p['weeks']=[]
    for n in range(weeks):
        ws=[]
        for j in range(sessions):
            w=workout(f'w{n+1}s{j+1}',j+1);w['title']='T'*80;w['intent']='I'*400
            w['blocks']=[{**deepcopy(w['blocks'][0]),'blockId':f'b{k+1}','order':k+1,'whyIncluded':'W'*200} for k in range(blocks)]
            w['previousRevision']=deepcopy(w);w['previousRevision'].pop('previousRevision');ws.append(w)
        p['weeks'].append({'weekNumber':n+1,'workouts':ws})
    size=document_size(p)
    if size>900*1024:
        with pytest.raises(GatewayError,match='900 KiB'):enforce_document_size(p)
    else:assert enforce_document_size(p)==size
    assert len(p['weeks'])==weeks and len(p['weeks'][0]['workouts'])==sessions


def test_v3_authorization_never_uses_client_email_or_relaxed_flags(monkeypatch):
    inv,out=setup();inv.uid='outsider';inv.email='boss@posetek.net';inv.params={'email_verified':True,'role':'admin'}
    monkeypatch.delenv('AUTHZ_ENFORCED',raising=False)
    with pytest.raises(GatewayError):authorize_v3(inv,mutation=True)
    inv.trusted_claims={'uid':'outsider','email':'boss@posetek.net','email_verified':True}
    assert authorize_v3(inv,mutation=True)=='admin'
    inv.trusted_claims['email_verified']=False
    with pytest.raises(GatewayError):authorize_v3(inv,mutation=True)


def test_coach_reads_but_cannot_apply_or_propose():
    inv,out=setup();d=proposal(inv);inv.uid='coach'
    inv.db.set_doc(('coaches','coach-doc'),{'userUID':'coach','members':['player']})
    assert authorize_v3(inv)=='coach'
    with pytest.raises(GatewayError):apply(inv,d)
    with pytest.raises(GatewayError):persist_workout_draft(inv,ask='Change controlled work.')


def test_roster_coach_can_generate_but_unrelated_coach_cannot():
    inv, out = setup()
    inv.uid = 'coach'; inv.job_id = 'coach-generation'
    inv.db.set_doc(('coaches', 'c'), {'userUID': 'coach', 'members': ['player']})
    candidate = plan(); candidate['planId'] = 'coachplan'
    assert persist_program(inv, candidate, {})['planId'] == 'coachplan'
    inv.uid = 'outsider'
    with pytest.raises(GatewayError):persist_program(inv, plan(), {})


def test_existing_unlogged_adhoc_target_uses_canonical_target_without_week_number():
    inv, out = setup(); result = apply(inv, proposal(inv, target_kind='new'))
    aid = result['target']['plannedWorkoutId']
    inv.capability = 'workout_chat'; inv.conversation_id = 'adhoc-edit'
    inv.params = {'context': {'workoutRef': {'kind': 'adhoc', 'plannedWorkoutId': aid}}, 'message': 'Change today title.'}
    inv.context.pop('workoutContext', None);inv.context.pop('resumedDraftId', None)
    context = assemble_workout_context(inv)
    assert 'weekNumber' not in context['target']
    w = deepcopy(context['workout']); w['title'] = 'Changed ad-hoc title'
    inv.context['workoutDraft'] = {'target': context['target'], 'workout': w}
    edit = persist_workout_draft(inv); applied = apply(inv, edit)
    assert applied == {'applied': True, 'target': {'kind': 'adhoc', 'plannedWorkoutId': aid}}
    assert inv.db.get_doc(('players', 'player', 'plannedWorkouts', aid))['revision'] == 2


def test_late_generation_failure_does_not_supersede_or_write_private_record():
    inv, out = setup(); inv.job_id = 'failed-generation'
    candidate = plan();candidate['planId'] = 'bad'
    candidate['weeks'][-1]['workouts'][-1]['blocks'][0]['reps'] = 100000
    with pytest.raises(GatewayError):persist_program(inv, candidate, {'private': 'evidence'})
    assert saved_plan(inv)['status'] == 'active'
    assert not inv.db.get_doc(('players', 'player', 'trainingPlanContexts', 'bad'))
    assert not inv.db.get_doc(('players', 'player', 'trainingPlans', 'bad'))


def test_missing_original_blocks_apply_instead_of_inventing_later_original():
    inv, out = setup(); draft = proposal(inv)
    record = inv.db.get_doc(('players', 'player', 'trainingPlanContexts', 'p'))
    record['originalWorkouts'].pop('w1s1')
    inv.db.set_doc(('players', 'player', 'trainingPlanContexts', 'p'), record)
    with pytest.raises(GatewayError, match='original'):apply(inv, draft)
    assert saved_plan(inv)['planRevision'] == 1


def test_retired_block_id_cannot_be_reassigned_on_apply():
    inv, out = setup(); draft = proposal(inv)
    inv.db.set_doc(('drillCatalog', 'DRB-502'), drill('DRB-502'))
    value = inv.db.get_doc(('players', 'player', 'workoutDrafts', draft['draftId']))
    value['workout']['blocks'][0]['drillId'] = 'DRB-502'
    inv.db.set_doc(('players', 'player', 'workoutDrafts', draft['draftId']), value)
    with pytest.raises(GatewayError, match='block id'):apply(inv, draft)


def test_concurrent_difficulty_downgrade_revalidates_on_transaction_retry():
    inv, out = setup(); inv.db.set_doc(('drillCatalog', 'DRB-501'), drill(difficulty=3))
    draft = proposal(inv)
    inv.db.before_commit = lambda db: db.set_doc(('players', 'player'), {'authenticationUID': 'athlete', 'age': 15, 'maxDrillDifficulty': 1})
    with pytest.raises(GatewayError):apply(inv, draft)
    assert saved_plan(inv)['planRevision'] == 1


@pytest.mark.parametrize('context', [[], {'workoutRef': {'kind': 'generation'}},
    {'workoutRef': {'kind': 'plan', 'planId': 'p', 'workoutId': 'w1s1', 'baseRevision': 999}},
    {'workoutRef': {'kind': 'new', 'planId': 'p', 'timeAvailableMinutes': True, 'energy': 'normal'}}])
def test_malformed_context_fails_as_invalid_request(context):
    inv, out = setup();inv.params = {'context': context}
    with pytest.raises(GatewayError) as err:assemble_workout_context(inv)
    assert err.value.code == 'invalid_request'


def test_sse_and_job_json_support_native_timestamps(monkeypatch):
    import json, main
    inv, out = setup()
    event = proposal(inv)
    encoded = main._sse('draft', event)
    decoded = json.loads(encoded.split('data: ', 1)[1])
    assert decoded['workout']['editedAt'].startswith('2026-09-06')
    ref = inv.db.collection('llmJobs').document('complete')
    ref.set({'status': 'running'})
    main._complete_job(ref, 'complete', out, {})
    assert ref.get().to_dict()['status'] == 'complete'


def test_job_handler_uses_admin_auth_identity_not_claimed_job_email(monkeypatch):
    import main
    from gateway.authz import AuthContext
    db=FakeFirestore();db.set_doc(('llmJobs','job'),{'status':'pending','requestedByUid':'real-user',
        'requestedByEmail':'forged@posetek.net','playerId':'player','capability':'generate_training_plan',
        'params':{'planVersion':3,'role':'admin'}})
    monkeypatch.setattr(main,'_firestore_client',lambda:db)
    monkeypatch.setattr(main,'_artifact_store_client',lambda:FakeStorage())
    monkeypatch.setattr(main,'resolve_job_identity',lambda uid:AuthContext(uid=uid,email='actual@example.com',claims={'uid':uid,'email':'actual@example.com','email_verified':True}))
    seen=[]
    monkeypatch.setattr(main,'run_job_capability',lambda inv:(seen.append(inv) or {},{}))
    response=main.app.test_client().post('/v1/jobs/handle',json={'jobId':'job'})
    assert response.status_code==200
    assert seen[0].email=='actual@example.com'
    assert seen[0].trusted_claims['email']=='actual@example.com'
    assert seen[0].params['role']=='admin'


def test_storage_uses_creation_precondition_and_refuses_changed_bytes():
    import hashlib,json
    from gateway.storage import ArtifactStore
    from google.api_core.exceptions import PreconditionFailed
    value={'private':'original'};raw=json.dumps(value,sort_keys=True,separators=(',',':')).encode()
    path='trainingPlanContexts/p/plan/'+hashlib.sha256(raw).hexdigest()+'.json'
    calls=[]
    class Blob:
        stored=None
        def upload_from_string(self,data,**kw):
            calls.append(kw)
            if self.stored is not None:raise PreconditionFailed('exists')
            self.stored=data
        def download_as_bytes(self):return self.stored
    blob=Blob();store=ArtifactStore(SimpleNamespace(bucket=lambda n:SimpleNamespace(blob=lambda p:blob)))
    store.upload_immutable_json(path,value);store.upload_immutable_json(path,value)
    assert all(call['if_generation_match']==0 for call in calls)
    blob.stored=b'corrupt'
    with pytest.raises(ValueError):store.upload_immutable_json(path,value)


def test_catalog_change_during_generation_cannot_rewrite_immutable_replay_inputs():
    inv, out = setup();inv.job_id = 'generation-new';candidate = plan();candidate['planId'] = 'new-plan'
    inv.db.before_commit = lambda db: db.set_doc(('drillCatalog', 'DRB-501'), drill(frequency=5))
    with pytest.raises(GatewayError, match='catalog changed'):persist_program(inv, candidate, {})
    assert saved_plan(inv)['status'] == 'active'
    assert not inv.db.get_doc(('players', 'player', 'trainingPlans', 'new-plan'))


def test_v3_successful_trace_is_not_exposed_as_public_job_pointer():
    import main
    inv, out = setup(); inv.params = {"planVersion": 3}; inv.context["_programResult"] = out
    inv.trace = [{"prompt": {"user": "private coach input"}}]
    job = inv.db.collection("llmJobs").document("trace-job"); job.set({"status": "running"})
    main._persist_trace(job, "trace-job", inv)
    assert "traceRef" not in job.get().to_dict()
    assert not inv.storage._files


def test_failed_v3_trace_is_create_only_private_and_has_no_public_pointer():
    import main
    inv, out = setup(); inv.params = {"planVersion": 3}
    inv.trace = [{"prompt": {"user": "private coach input"}}]
    job = inv.db.collection("llmJobs").document("trace-job"); job.set({"status": "failed"})
    main._persist_trace(job, "trace-job", inv)
    paths = list(inv.storage._files)
    assert len(paths) == 1 and paths[0].startswith("trainingPlanContexts/player/failed-")
    assert "private coach input" in str(inv.storage._files[paths[0]])
    assert "traceRef" not in job.get().to_dict()
    main._persist_trace(job, "trace-job", inv)
    assert list(inv.storage._files) == paths


def test_proposal_rechecks_active_plan_before_persisting_and_superseding():
    inv, out = setup(); old = proposal(inv)
    current = saved_plan(inv);current['status'] = 'superseded'
    inv.db.set_doc(('players', 'player', 'trainingPlans', 'p'), current)
    inv.context['workoutDraft']['workout']['title'] = 'Stale proposed title'
    with pytest.raises(GatewayError, match='no longer active'):
        persist_workout_draft(inv, ask='Modify this workout again.')
    assert inv.db.get_doc(('players', 'player', 'workoutDrafts', old['draftId']))['status'] == 'proposed'
    assert len(inv.db.get_collection(('players', 'player', 'workoutDrafts'))) == 1


def _duplicate_candidate(value):
    block = deepcopy(value['blocks'][0])
    block.update(sets=3, reps=120, estimatedMinutes=6)
    value['blocks'] = [block, dict(block, blockId='b2', order=2)]
    value.update(nextBlockSequence=3, estimatedMinutes=13)
    return value


def test_duplicate_drill_rejected_at_generation_commit_without_replacing_active_plan():
    inv, out = setup(); inv.job_id = 'duplicate-generation'
    candidate = plan(); candidate['planId'] = 'duplicate-plan'
    _duplicate_candidate(candidate['weeks'][0]['workouts'][0])
    with pytest.raises(GatewayError, match='duplicate_drill'):
        persist_program(inv, candidate, {})
    assert saved_plan(inv)['status'] == 'active'
    assert not inv.db.get_doc(('players', 'player', 'trainingPlans', 'duplicate-plan'))


def test_duplicate_drill_rejected_before_proposal_write_and_on_forged_apply():
    inv, out = setup(); existing = proposal(inv)
    _duplicate_candidate(inv.context['workoutDraft']['workout'])
    with pytest.raises(GatewayError, match='duplicate_drill'):
        persist_workout_draft(inv, ask='More controlled work please.')
    assert len(inv.db.get_collection(('players', 'player', 'workoutDrafts'))) == 1
    record = inv.db.get_doc(('players', 'player', 'workoutDrafts', existing['draftId']))
    _duplicate_candidate(record['workout'])
    inv.db.set_doc(('players', 'player', 'workoutDrafts', existing['draftId']), record)
    with pytest.raises(GatewayError, match='duplicate_drill'):
        apply(inv, existing)
    assert saved_plan(inv)['planRevision'] == 1
    assert not inv.db.get_collection(('players', 'player', 'planAdjustments'))


def test_concurrent_sibling_cannot_add_same_new_drill_even_below_weekly_frequency_cap():
    inv, out = setup()
    inv.db.set_doc(('drillCatalog', 'DRB-502'), drill('DRB-502', frequency=6))
    a = proposal(inv, 'w1s1', did='DRB-502'); b = proposal(inv, 'w1s2', did='DRB-502')
    other = deepcopy(inv); other.db = inv.db; other.storage = inv.storage
    inv.db.before_commit = lambda db: apply(other, b)
    with pytest.raises(GatewayError, match='scheduled_elsewhere'):
        apply(inv, a)
    current = saved_plan(inv)
    assert current['weeks'][0]['workouts'][0]['blocks'][0]['drillId'] == 'DRB-501'
    assert current['weeks'][0]['workouts'][1]['blocks'][0]['drillId'] == 'DRB-502'
    assert len(inv.db.get_collection(('players', 'player', 'planAdjustments'))) == 1
