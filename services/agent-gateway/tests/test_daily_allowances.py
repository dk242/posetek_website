"""Daily product limits serialize across simultaneous jobs/chat requests."""
from datetime import datetime, timedelta, timezone

import pytest

from gateway import config
from gateway.ctx import Invocation
from gateway.errors import GatewayError
from gateway.pipeline import _authorize_and_configure
from tests.conftest import FakeFirestore


NOW = datetime(2026, 9, 7, 12, tzinfo=timezone.utc)


def invocation(db=None, capability="generate_training_plan", request_id="first"):
    return Invocation(capability=capability, player_id="player-doc", uid="athlete",
                      db=db or FakeFirestore(), job_id=request_id)


def test_one_build_per_day_is_idempotent_and_resets():
    inv = invocation()
    config.reserve_daily_allowance(inv, now=NOW)
    config.reserve_daily_allowance(inv, now=NOW)
    other = invocation(inv.db, request_id="second")
    with pytest.raises(GatewayError, match="midnight UTC") as error:
        config.reserve_daily_allowance(other, now=NOW)
    assert error.value.code == "quota_exceeded"
    config.reserve_daily_allowance(other, now=NOW + timedelta(days=1))
    assert len(inv.db.get_collection(("llmDailyAllowances",))) == 2


def test_three_adjustment_requests_across_conversations_devices_and_legacy():
    db = FakeFirestore()
    for number, capability in enumerate(("workout_chat", "build_workout", "workout_chat")):
        inv = invocation(db, capability, str(number))
        inv.conversation_id = str(number)
        config.reserve_daily_allowance(inv, now=NOW)
    for capability in ("workout_chat", "build_workout"):
        with pytest.raises(GatewayError) as error:
            config.reserve_daily_allowance(invocation(db, capability, "fourth"), now=NOW)
        assert error.value.code == "quota_exceeded"
    # A different authenticated athlete gets their own allowance.
    other = invocation(db, "workout_chat", "fourth")
    other.uid = "other-athlete"
    config.reserve_daily_allowance(other, now=NOW)


def test_concurrent_last_slot_cannot_be_spent_twice():
    inv = invocation(request_id="loser")
    inv.db.before_commit = lambda db: config.reserve_daily_allowance(
        invocation(db, request_id="winner"), now=NOW)
    with pytest.raises(GatewayError) as error:
        config.reserve_daily_allowance(inv, now=NOW)
    assert error.value.code == "quota_exceeded"
    stored = next(iter(inv.db.get_collection(("llmDailyAllowances",)).values()))
    assert stored["invocationIds"] == ["winner"]


def test_rollout_imports_distinct_existing_calls_not_provider_subturns():
    inv = invocation(capability="workout_chat", request_id="third")
    for row, call in enumerate(("first", "first", "second")):
        inv.db.set_doc(("llmUsage", str(row)), {
            "requestedByUid": inv.uid, "capability": "workout_chat",
            "invocationId": call, "createdAt": NOW,
        })
    config.reserve_daily_allowance(inv, now=NOW)
    with pytest.raises(GatewayError):
        config.reserve_daily_allowance(invocation(inv.db, "workout_chat", "fourth"), now=NOW)


def test_verified_admin_bypasses_daily_quota_but_not_feature_gate(monkeypatch):
    inv = invocation(capability="pose_chat")
    inv.uid = "staff"
    inv.trusted_claims = {"uid": "staff", "email": "coach@posetek.net", "email_verified": True}
    inv.db.set_doc(("players", inv.player_id), {"authenticationUID": "athlete"})
    monkeypatch.setattr(config, "load_llm_config", lambda db: {"capabilities": {"pose_chat": {"enabled": True, "dailyLimitPerUser": 1}}})
    monkeypatch.setattr(config, "check_quota", lambda *a, **kw: pytest.fail("Admin quota read"))
    monkeypatch.setattr(config, "reserve_daily_allowance", lambda *a, **kw: pytest.fail("Admin reservation"))
    _authorize_and_configure(inv)
    monkeypatch.setattr(config, "load_llm_config", lambda db: {"globalEnabled": False})
    with pytest.raises(GatewayError) as error:
        _authorize_and_configure(inv)
    assert error.value.code == "capability_disabled"


def test_client_admin_email_cannot_bypass_allowance(monkeypatch):
    inv = invocation(capability="pose_chat")
    inv.email = "coach@posetek.net"
    inv.db.set_doc(("players", inv.player_id), {"authenticationUID": "athlete"})
    monkeypatch.setattr(config, "load_llm_config", lambda db: {})
    def full(*args, **kwargs):
        raise GatewayError("quota_exceeded", "full")
    monkeypatch.setattr(config, "check_quota", full)
    with pytest.raises(GatewayError) as error:
        _authorize_and_configure(inv)
    assert error.value.code == "quota_exceeded"


@pytest.mark.parametrize("failure", ["malformed_message", "missing_target", "staff_read_only", "foreign_conversation"])
def test_rejected_workout_before_model_does_not_spend_an_adjustment(monkeypatch, failure):
    from gateway.pipeline import run_stream_capability
    from tests.test_workout_chat import seed
    inv = seed()
    monkeypatch.setattr(config, "_cache", {"doc": None, "loaded_at": 0.0})
    if failure == "malformed_message":
        inv.params["message"] = "x"
    elif failure == "missing_target":
        inv.params["context"]["workoutRef"]["planId"] = "missing"
    elif failure == "staff_read_only":
        inv.uid = "coach"
        inv.player_ref().update({"coachUID": "coach"})
    else:
        inv.params["conversationId"] = "foreign"
        inv.player_ref().collection("aiConversations").document("foreign").set({
            "capability": "workout_chat", "createdByUid": "other", "workoutTarget": {"kind": "plan", "planId": "p", "workoutId": "w1s1"}})
    monkeypatch.setattr("gateway.providers.base.get_provider", lambda _: pytest.fail("Rejected request reached provider"))
    with pytest.raises(GatewayError):
        list(run_stream_capability(inv))
    assert not inv.db.get_collection(("llmDailyAllowances",)), "No model work occurred; retain the athlete's allowance"


def test_higher_config_cannot_raise_product_adjustment_limit(monkeypatch):
    from gateway.pipeline import run_stream_capability
    from tests.test_workout_chat import seed
    inv = seed()
    monkeypatch.setattr(config, "_cache", {"doc": None, "loaded_at": 0.0})
    # Seed product reservations without provider ledger writes, simulating
    # three requests in progress on other devices under a stale high config.
    for number in range(3):
        reserved = invocation(inv.db, "workout_chat", "occupied-" + str(number))
        config.reserve_daily_allowance(reserved)
    monkeypatch.setattr("gateway.providers.base.get_provider", lambda _: pytest.fail("Full allowance reached provider"))
    with pytest.raises(GatewayError) as error:
        list(run_stream_capability(inv))
    assert error.value.code == "quota_exceeded"
