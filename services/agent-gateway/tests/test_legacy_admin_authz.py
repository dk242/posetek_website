"""Verified staff compatibility while legacy authorization remains enforced."""
import pytest
from gateway.authz import AuthContext, authorize_player_access
from gateway.errors import GatewayError
from gateway.pipeline import _authorize_and_configure
from tests.conftest import FakeFirestore, FakeStorage


@pytest.fixture(autouse=True)
def strict(monkeypatch):
    monkeypatch.setenv('AUTHZ_ENFORCED','1')
    from gateway import config
    monkeypatch.setattr(config,'_cache',{'doc':None,'loaded_at':0.0})


def database():
    db=FakeFirestore()
    db.set_doc(('players','athlete-doc'),{'authenticationUID':'athlete','signupEmail':'athlete@example.com'})
    return db


def claims(**changes):
    return {'uid':'staff','email':'Staff@PoseTek.Net','email_verified':True,**changes}


def test_verified_staff_admin_can_read_unrelated_athlete_without_a_coach_doc():
    authorize_player_access(database(),'staff','ignored@example.com','athlete-doc',trusted_claims=claims())


@pytest.mark.parametrize('trusted',[
    None, {}, {'email':'staff@posetek.net','email_verified':True},
    claims(email_verified=False), claims(email_verified=1), claims(email_verified='true'),
    claims(email='staff@posetek.net.attacker.test'), claims(email='staff@notposetek.net'),
    claims(email='@posetek.net'), claims(email='staff@@posetek.net'),
    claims(email='person@example.com'), claims(uid='different-user'), claims(sub='different-user'),
])
def test_forged_email_unverified_or_mismatched_claims_do_not_grant_staff_privilege(trusted):
    with pytest.raises(GatewayError) as err:
        authorize_player_access(database(),'staff','forged@posetek.net','athlete-doc',trusted_claims=trusted)
    assert err.value.code=='permission_denied'


def test_mismatched_claim_uid_is_denied_even_for_self_and_with_relaxed_flag(monkeypatch):
    monkeypatch.setenv('AUTHZ_ENFORCED','0')
    with pytest.raises(GatewayError) as err:
        authorize_player_access(database(),'athlete','athlete@example.com','athlete-doc',trusted_claims={'uid':'other'})
    assert err.value.code=='permission_denied'


def test_existing_self_and_roster_coach_paths_still_work_but_outsider_does_not():
    db=database()
    authorize_player_access(db,'athlete',None,'athlete-doc',trusted_claims={'uid':'athlete'})
    db.set_doc(('coaches','coach-doc'),{'userUID':'coach','members':['athlete-doc']})
    authorize_player_access(db,'coach',None,'athlete-doc',trusted_claims={'uid':'coach'})
    with pytest.raises(GatewayError):
        authorize_player_access(db,'outsider',None,'athlete-doc',trusted_claims={'uid':'outsider'})


@pytest.mark.parametrize('real_claims,expected_status',[
    (claims(),'complete'),
    (claims(email='normal@example.com'),'failed'),
    (claims(email_verified=False),'failed'),
])
def test_real_report_job_transport_uses_server_claims_not_client_email(monkeypatch,real_claims,expected_status):
    import main
    db=database()
    db.set_doc(('llmJobs','legacy-report'),{'schemaVersion':1,'status':'pending','capability':'generate_report',
        'playerId':'athlete-doc','requestedByUid':'staff','requestedByEmail':'forged@posetek.net','params':{}})
    monkeypatch.setattr(main,'_firestore_client',lambda:db)
    monkeypatch.setattr(main,'_artifact_store_client',lambda:FakeStorage())
    resolved=[]
    def identity(uid):
        resolved.append(uid)
        return AuthContext(uid=uid,email=real_claims['email'],claims=real_claims)
    monkeypatch.setattr(main,'resolve_job_identity',identity)
    seen=[]
    def policy_then_report(inv):
        _authorize_and_configure(inv)  # Actual report registry/auth/quota; model content is outside this authorization change.
        seen.append(inv.trusted_claims)
        return {'text':'Authorized report output'},{}
    monkeypatch.setattr(main,'run_job_capability',policy_then_report)
    response=main.app.test_client().post('/v1/jobs/handle',json={'jobId':'legacy-report'})
    result=db.get_doc(('llmJobs','legacy-report'))
    assert response.status_code==200 and result['status']==expected_status
    assert resolved==['staff']
    if expected_status=='complete':assert seen==[real_claims]
    else:assert not seen and result['error']['code']=='permission_denied'


def test_disabled_account_resolution_stops_legacy_report_before_policy(monkeypatch):
    import main
    db=database();db.set_doc(('llmJobs','report'),{'status':'pending','capability':'generate_report',
        'requestedByUid':'disabled','requestedByEmail':'forged@posetek.net','playerId':'athlete-doc'})
    monkeypatch.setattr(main,'_firestore_client',lambda:db)
    monkeypatch.setattr(main,'_artifact_store_client',lambda:FakeStorage())
    def disabled(uid):raise GatewayError('unauthenticated','The requesting account is disabled')
    monkeypatch.setattr(main,'resolve_job_identity',disabled)
    monkeypatch.setattr(main,'run_job_capability',lambda inv:pytest.fail('Disabled identity reached policy/model'))
    main.app.test_client().post('/v1/jobs/handle',json={'jobId':'report'})
    assert db.get_doc(('llmJobs','report'))['error']['code']=='unauthenticated'


def test_marked_coach_verified_staff_finishes_under_strict_auth_without_self_memory(monkeypatch):
    from tests.test_coach_workspace import seed,run
    inv=seed('How can this athlete improve close control?')
    inv.uid='staff';inv.email='staff@posetek.net';inv.trusted_claims=claims()
    events,provider=run(inv,monkeypatch)
    assert events[-1]['type']=='done'
    assert provider.streams and not provider.extractions
    assert not any(event['type']=='memory' for event in events)


def test_marked_coach_outsider_remains_denied_before_provider(monkeypatch):
    from tests.test_coach_workspace import seed,FakeCoach
    from gateway.pipeline import run_stream_capability
    inv=seed();inv.uid='outsider';inv.email='outsider@example.com';inv.trusted_claims={'uid':'outsider'}
    provider=FakeCoach();monkeypatch.setattr('gateway.coach_chat.get_provider',lambda _:provider)
    with pytest.raises(GatewayError) as err:list(run_stream_capability(inv))
    assert err.value.code=='permission_denied' and not provider.streams
