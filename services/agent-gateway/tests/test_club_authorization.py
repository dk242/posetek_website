"""Club-only regressions on the exact serving source; legacy rollout is preserved."""
from types import SimpleNamespace

import pytest

from gateway import authz
from gateway.errors import GatewayError
from tests.conftest import FakeFirestore


def seed(role="coach", teams=None, status="active", organization="club", owner="athlete"):
    db = FakeFirestore()
    db.set_doc(("players", "player-document"), {
        "authenticationUID": owner, "userUID": owner,
        "organizationId": organization, "teamId": "girls",
        "coachUID": "staff", "coachDocId": "staff", "organizationCode": "PUBLIC",
        "signupEmail": "forged@example.test",
    })
    db.set_doc(("coaches", "staff"), {"userUID": "staff", "members": ["player-document"], "organizationCode": "PUBLIC"})
    db.set_doc(("organizations", "club", "members", "staff"), {
        "userUID": "staff", "role": role, "teamIds": ["girls"] if teams is None else teams,
        "status": status,
    })
    return db


def invoke(db, uid="staff", mutation=False, read=None, claims=None):
    inv = SimpleNamespace(db=db, uid=uid, player_id="player-document", trusted_claims=claims or {"uid": uid},
                          player_ref=lambda: db.collection("players").document("player-document"))
    return authz.authorize_v3(inv, mutation=mutation, read=read)


@pytest.mark.parametrize("role,teams", [("manager", []), ("coach", ["girls"]), ("coach", ["girls", "boys"])])
def test_active_club_staff_can_read_but_cannot_mutate_workouts(role, teams):
    db = seed(role, teams)
    assert invoke(db) == "coach"
    assert authz.authorize_player_access(db, "staff", None, "player-document", trusted_claims={"uid": "staff"}) == "coach"
    with pytest.raises(GatewayError):
        invoke(db, mutation=True)


@pytest.mark.parametrize("enforced", ["0", "1"])
@pytest.mark.parametrize("options", [
    {"teams": ["boys"]}, {"status": "inactive"}, {"role": "admin"},
    {"organization": "other-club"}, {"organization": ""}, {"organization": None},
    {"teams": "girls"}, {"teams": [None]},
])
def test_club_denials_never_fall_back_to_legacy_roster_or_relaxed_mode(monkeypatch, enforced, options):
    monkeypatch.setenv("AUTHZ_ENFORCED", enforced)
    db = seed(**options)
    with pytest.raises(GatewayError):
        invoke(db)
    with pytest.raises(GatewayError):
        authz.authorize_player_access(db, "staff", None, "player-document", trusted_claims={"uid": "staff"})
    with pytest.raises(GatewayError):
        authz._check_player_access(db, "staff", None, "player-document")


def test_transactional_read_checks_membership_and_revocation_in_same_snapshot():
    db = seed()
    paths = []
    def read(ref):
        paths.append(ref.path)
        return ref.get()
    assert invoke(db, read=read) == "coach"
    assert len(paths) == 2
    db.set_doc(("organizations", "club", "members", "staff"), {
        "userUID": "someone-else", "role": "manager", "teamIds": [], "status": "active",
    })
    with pytest.raises(GatewayError):
        invoke(db, read=read)


def test_canonical_player_self_and_verified_admin_remain_authorized():
    db = seed(status="inactive")
    assert invoke(db, uid="athlete", mutation=True) == "athlete"
    claims = {"uid": "admin", "email": "Admin@PoseTek.net", "email_verified": True}
    assert invoke(db, uid="admin", mutation=True, claims=claims) == "admin"
    assert authz.authorize_player_access(db, "admin", None, "player-document", trusted_claims=claims) == "admin"


@pytest.mark.parametrize("claims", [
    {"uid": "staff", "sub": "other"},
    {"uid": "staff", "firebase": {"sign_in_provider": "anonymous"}},
    {"uid": "staff", "email": "admin@posetek.net", "email_verified": False},
])
def test_club_calls_reject_bad_identity_even_with_valid_staff_membership(claims):
    db = seed()
    with pytest.raises(GatewayError):
        invoke(db, claims=claims)
    with pytest.raises(GatewayError):
        authz.authorize_player_access(db, "staff", None, "player-document", trusted_claims=claims)


def test_signup_email_and_document_id_do_not_override_canonical_owner(monkeypatch):
    monkeypatch.setenv("AUTHZ_ENFORCED", "0")
    db = seed()
    with pytest.raises(GatewayError):
        authz.authorize_player_access(db, "outsider", "forged@example.test", "player-document", trusted_claims={"uid": "outsider", "email": "forged@example.test", "email_verified": True})
    with pytest.raises(GatewayError):
        authz.authorize_player_access(db, "player-document", None, "player-document", trusted_claims={"uid": "player-document"})
    player = db.collection("players").document("player-document").get().to_dict()
    player["userUID"] = "other-athlete"
    db.set_doc(("players", "player-document"), player)
    for uid in ("athlete", "other-athlete"):
        with pytest.raises(GatewayError):
            invoke(db, uid=uid)


def test_serving_legacy_relaxed_mode_and_email_matching_are_unchanged(monkeypatch):
    db = FakeFirestore()
    db.set_doc(("players", "legacy"), {"authenticationUID": "owner", "signupEmail": "legacy@example.test"})
    monkeypatch.setenv("AUTHZ_ENFORCED", "0")
    assert authz.authorize_player_access(db, "unrelated", None, "legacy") is None
    monkeypatch.setenv("AUTHZ_ENFORCED", "1")
    with pytest.raises(GatewayError):
        authz.authorize_player_access(db, "unrelated", None, "legacy")
    assert authz.authorize_player_access(db, "email-user", "LEGACY@example.test", "legacy") is None
    assert authz.authorize_player_access(db, "missing-self", None, "missing-self") is None
