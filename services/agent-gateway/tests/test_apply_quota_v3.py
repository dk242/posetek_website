"""Pure Apply spends quota once even though it makes no provider calls."""
import pytest

from gateway import config, usage
from gateway.errors import GatewayError
from gateway.pipeline import run_job_capability
from tests.test_workout_persistence_v3 import setup, proposal, saved_plan


def configure(inv, monkeypatch, limit=1):
    inv.db.set_doc(('config', 'llm'), {'capabilities': {'apply_workout_draft': {'enabled': True, 'dailyLimitPerUser': limit}}})
    monkeypatch.setattr(config, '_cache', {'doc': None, 'loaded_at': 0.0})


def run_apply(inv, draft):
    inv.capability = 'apply_workout_draft'
    inv.params = {'draftId': draft['draftId']}
    return run_job_capability(inv)


def test_apply_daily_limit_counts_pure_code_once_and_allows_completed_retry(monkeypatch):
    inv, _ = setup()
    first = proposal(inv)
    sibling = proposal(inv, 'w1s2')
    configure(inv, monkeypatch)
    result, spend = run_apply(inv, first)
    assert result['applied'] is True
    assert spend['calls'] == 0 and spend['inputTokens'] == spend['outputTokens'] == 0
    assert spend['estimatedCostUsd'] == 0
    inv.job_id = 'different-transport-retry'
    assert run_apply(inv, first) == (result, spend)
    ledger = inv.db.get_collection(('llmUsage',))
    assert len(ledger) == 1
    row = next(iter(ledger.values()))
    assert row['invocationId'] == 'apply:' + first['draftId']
    assert row['provider'] == row['model'] == 'code'
    with pytest.raises(GatewayError) as err:
        run_apply(inv, sibling)
    assert err.value.code == 'quota_exceeded'
    assert saved_plan(inv)['planRevision'] == 2
    assert inv.db.get_doc(('players', 'player', 'workoutDrafts', sibling['draftId']))['status'] == 'proposed'


def test_failed_apply_is_not_metered_and_completed_retry_still_checks_authority(monkeypatch):
    inv, _ = setup()
    draft = proposal(inv)
    configure(inv, monkeypatch)
    inv.uid = 'outsider'
    with pytest.raises(GatewayError) as err:
        run_apply(inv, draft)
    assert err.value.code == 'permission_denied'
    assert not inv.db.get_collection(('llmUsage',))
    inv.uid = 'athlete'
    run_apply(inv, draft)
    inv.uid = 'outsider'
    with pytest.raises(GatewayError) as err:
        run_apply(inv, draft)
    assert err.value.code == 'permission_denied'
    assert len(inv.db.get_collection(('llmUsage',))) == 1


def test_meter_failure_after_apply_is_recovered_without_second_plan_edit(monkeypatch):
    inv, _ = setup()
    draft = proposal(inv)
    configure(inv, monkeypatch)
    record = usage.record_code_usage
    with monkeypatch.context() as m:
        m.setattr(usage, 'record_code_usage', lambda *a, **kw: (_ for _ in ()).throw(RuntimeError('transient ledger failure')))
        with pytest.raises(RuntimeError):
            run_apply(inv, draft)
    assert saved_plan(inv)['planRevision'] == 2
    assert not inv.db.get_collection(('llmUsage',))
    assert run_apply(inv, draft)[0]['applied'] is True
    assert saved_plan(inv)['planRevision'] == 2
    assert len(inv.db.get_collection(('llmUsage',))) == 1


def test_generation_provider_subturns_still_count_as_one_invocation(monkeypatch):
    inv, _ = setup()
    cfg = {'capabilities': {'generate_training_plan': {'dailyLimitPerUser': 2}}}
    for stage in ('shape', 'select', 'time_check'):
        usage.record_usage(inv.db, inv, provider='replay', model='gemini-2.5-flash', usage={}, latency_ms=0, outcome='ok', stage=stage)
    config.check_quota(inv.db, cfg, inv.uid, inv.capability)
    inv.job_id = 'second-generation'
    del inv._usage_invocation_id
    usage.record_usage(inv.db, inv, provider='replay', model='gemini-2.5-flash', usage={}, latency_ms=0, outcome='ok')
    with pytest.raises(GatewayError) as err:
        config.check_quota(inv.db, cfg, inv.uid, inv.capability)
    assert err.value.code == 'quota_exceeded'
