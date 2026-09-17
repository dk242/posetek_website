"""V3 activation requires an explicit enabled capability and a positive quota."""
from unittest.mock import patch
import pytest
from gateway import config
from gateway.errors import GatewayError
from gateway.pipeline import _authorize_and_configure
from evals.program_v3 import seed_invocation
from tests.test_workout_persistence_v3 import setup


@pytest.mark.parametrize('capability', ['generate_training_plan', 'apply_workout_draft'])
@pytest.mark.parametrize('entry', [
    None, {}, True, {'enabled': True}, {'dailyLimitPerUser': 1},
    {'enabled': False, 'dailyLimitPerUser': 1}, {'enabled': 1, 'dailyLimitPerUser': 1},
    {'enabled': 'true', 'dailyLimitPerUser': 1},
    {'enabled': True, 'dailyLimitPerUser': 0}, {'enabled': True, 'dailyLimitPerUser': -1},
    {'enabled': True, 'dailyLimitPerUser': True}, {'enabled': True, 'dailyLimitPerUser': False},
    {'enabled': True, 'dailyLimitPerUser': 1.0}, {'enabled': True, 'dailyLimitPerUser': '1'},
])
def test_v3_incomplete_config_fails_before_auth_quota_or_models(capability, entry):
    inv = seed_invocation('cb15') if capability == 'generate_training_plan' else setup()[0]
    inv.capability = capability
    cfg = {'programV3Enabled': True, 'capabilities': {} if entry is None else {capability: entry}}
    with patch('gateway.config.load_llm_config', return_value=cfg), patch('gateway.authz.authorize_v3', side_effect=AssertionError('disabled gate reached auth')), patch('gateway.config.check_quota', side_effect=AssertionError('disabled gate reached quota')), pytest.raises(GatewayError) as err:
        _authorize_and_configure(inv)
    assert err.value.code == 'capability_disabled'


@pytest.mark.parametrize('capability', ['generate_training_plan', 'apply_workout_draft'])
def test_positive_v3_config_still_enforces_quota(capability):
    inv = seed_invocation('cb15') if capability == 'generate_training_plan' else setup()[0]
    inv.capability = capability
    cfg = {'programV3Enabled': True, 'capabilities': {capability: {'enabled': True, 'dailyLimitPerUser': 1}}}
    with patch('gateway.config.load_llm_config', return_value=cfg), patch('gateway.config.check_quota', side_effect=GatewayError('quota_exceeded', 'full')) as quota, pytest.raises(GatewayError) as err:
        _authorize_and_configure(inv)
    assert err.value.code == 'quota_exceeded' and quota.call_count == 1


def test_future_workout_chat_requires_same_explicit_config():
    assert not config.v3_capability_enabled({}, 'workout_chat')
    assert config.v3_capability_enabled({'capabilities': {'workout_chat': {'enabled': True, 'dailyLimitPerUser': 1}}}, 'workout_chat')
    assert not config.v3_capability_enabled({'globalEnabled': False, 'capabilities': {'workout_chat': {'enabled': True, 'dailyLimitPerUser': 1}}}, 'workout_chat')


def test_legacy_missing_entry_and_zero_quota_semantics_unchanged():
    assert config.capability_enabled({}, 'coaching_chat')
    cfg = {'capabilities': {'coaching_chat': {'dailyLimitPerUser': 0}}}
    assert config.capability_enabled(cfg, 'coaching_chat')
    assert config._daily_limit(cfg, 'coaching_chat') == 0
    config.check_quota(None, cfg, 'athlete', 'coaching_chat')
