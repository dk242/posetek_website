"""Free replay checks the shipped stage/tool/persistence spine on real catalog rows."""
from copy import deepcopy
import json

import pytest

from evals.program_v3 import FIXTURES,PROFILES,ReplayProvider,qualitative_assertions,run_profile,seed_invocation
from gateway.errors import GatewayError


@pytest.mark.parametrize('profile_id',list(PROFILES))
def test_authored_replay_profiles_pass_independent_acceptance_gates(profile_id,monkeypatch):
    # This guard proves ordinary CI never resolves a network model client.
    from gateway.providers import anthropic_direct,anthropic_vertex,vertex_gemini
    monkeypatch.setattr(anthropic_vertex,'_client',lambda:pytest.fail('replay called Vertex'))
    monkeypatch.setattr(vertex_gemini,'_client',lambda:pytest.fail('replay called Vertex'))
    monkeypatch.setattr(anthropic_direct,'_client',lambda:pytest.fail('replay called the Claude API'))
    artifact=run_profile(profile_id)
    assert artifact['passed'],artifact['error']
    assert artifact['actualModelSpendUsd']==0
    assert artifact['checks'] and all(c['passed'] for c in artifact['checks'])
    assert 'authored' in artifact['usageSource']
    if PROFILES[profile_id].get('expectError'):
        # A profile whose correct output is an honest refusal produces no plan
        # and reaches no model; the declared error code is the assertion.
        assert artifact['plan'] is None
        return
    assert artifact['plan']['generationContextRef']
    assert artifact['providerCalls']
    assert all(c['usage']['inputTokens']==0 for c in artifact['calls'])


@pytest.mark.parametrize('compressed', [False, True])
def test_recorded_run_envelope_replays_and_context_drift_is_detected(tmp_path, compressed):
    artifact=run_profile('cb15')
    assert artifact['passed'],artifact['error']
    import gzip
    path=tmp_path/('record.json.gz' if compressed else 'record.json')
    def write_record():
        payload=json.dumps({'runs':[artifact]},default=str)
        if compressed:
            with gzip.open(path,'wt',encoding='utf-8') as stream:stream.write(payload)
        else:path.write_text(payload)
    write_record()
    again=run_profile('cb15',tape_path=path)
    assert again['passed'],again['error']
    assert again['plan']==artifact['plan']
    artifact['replayTape']['calls'][0]['contextSha256']='tampered'
    write_record()
    drift=run_profile('cb15',tape_path=path)
    assert not drift['passed'] and 'context changed' in drift['error']['message']


def test_missing_tape_never_synthesizes_model_output(tmp_path):
    path=tmp_path/'empty.json';path.write_text('{"source":"authored-tool-tape","calls":[]}')
    artifact=run_profile('cb15',tape_path=path)
    assert not artifact['passed'] and 'Missing replay tape' in artifact['error']['message']


def test_runtime_model_override_preserves_cap_before_any_call():
    with pytest.raises(GatewayError,match='Sonnet 4.6'):
        run_profile('cb15',stage_models={'repair':'claude-opus-4-6'})
    with pytest.raises(GatewayError,match='deterministic arithmetic'):
        run_profile('cb15',stage_models={'focus_split':'claude-sonnet-4-6'})
    artifact=run_profile('cb15',stage_models={'repair':'gemini-2.5-flash'})
    assert artifact['passed'],artifact['error']
    assert artifact['stageModels']['build']=='code' and artifact['stageModels']['repair']=='gemini-2.5-flash'
    assert artifact['actualModelSpendUsd']==0 # replay override is not measured ablation


def test_qualitative_gates_are_independent_of_authored_pass_response():
    artifact=run_profile('cb15');plan=deepcopy(artifact['plan'])
    plan['weeks'][0]['workouts'][0]['focusDomains']=['strength']
    checks=qualitative_assertions(plan,PROFILES['cb15'])
    assert any(not c['passed'] and 'built domains' in c['requirement'] for c in checks)


def test_live_mode_requires_explicit_project_and_supported_region(monkeypatch):
    monkeypatch.delenv('GCP_PROJECT',raising=False)
    monkeypatch.delenv('VERTEX_LOCATION',raising=False)
    with pytest.raises(ValueError,match='Live mode requires'):
        run_profile('cb15',mode='live')


def test_eval_catalog_is_sanitized_real_v2_snapshot_without_mobile_dependency():
    rows=json.loads((FIXTURES/'catalog_v2.json').read_text())['drills']
    assert len(rows)==90 and sum(r['status']=='published' for r in rows)==65
    assert all(r['schemaVersion']==2 and 'media' not in r for r in rows)
    assert not any(r['drillId'].startswith('BM-') for r in rows)



def test_recorded_soft_tool_refusal_can_replay_before_the_models_repair():
    inv=seed_invocation('cb15')
    inv.context['_activeProgramCall']={'stage':'build','iteration':'w1s1','attempt':0,'context':{}}
    row={'stage':'build','iteration':'w1s1','attempt':0,'toolActions':[
        {'name':'draft_add_block','args':{},'ok':False,'error':'invalid_request'},
        {'name':'draft_create','args':{},'ok':True}],
        'result':{'text':'repaired'},'usage':{'inputTokens':5,'outputTokens':2,'calls':1}}
    provider=ReplayProvider(inv,'cb15',{'calls':[row]})
    calls=[]
    def runner(name,args):
        calls.append(name)
        return {'error':'invalid_request'} if name=='draft_add_block' else {'ok':True}
    result=provider.generate(model='claude-sonnet-4-6',params={'_usage_callback':lambda event:None},tool_runner=runner)
    assert result.text=='repaired' and calls==['draft_add_block','draft_create']


def test_each_profile_explicitly_declares_stats_peers_coach_and_history_evidence():
    for fixture in PROFILES.values():
        assert {'stats', 'peerDribblingTimes', 'athleteDribblingTime', 'coachFeedback', 'coachParsedEmphasis', 'history', 'evidenceProvenance'} <= fixture.keys()
        assert set(fixture['history']) == {'plans', 'logs', 'reservations'}
        assert set(fixture['evidenceProvenance']) == {'stats', 'peers', 'coachFeedback', 'drillHistory'}


def test_no_stats_profile_has_actual_prior_completion_and_preserves_it():
    from gateway.workout_history import load_history_evidence, build_frequency_context, drill_history
    from evals.program_v3 import NOW
    inv = seed_invocation('nostats')
    evidence = load_history_evidence(inv)
    assert len(evidence['logs']) == 1 and not evidence['reps']
    plan = {'planId': 'new', 'startDate': '2026-09-06', 'timezone': 'America/Los_Angeles', 'weeks': []}
    frequency = build_frequency_context(plan, {'kind': 'generation', 'jobId': inv.job_id, 'weekNumber': 1, 'order': 1}, evidence['logs'], [], now=NOW)
    assert frequency['counts'] == {'DRB-006': 1}
    history = drill_history(evidence['logs'], [], now=NOW, timezone_name='America/Los_Angeles')
    assert history['drills']['DRB-006']['timesDone'] == 1
    assert history['drills']['DRB-006']['minutesDone'] == 3
    artifact = run_profile('nostats')
    assert artifact['passed'], artifact['error']
    preserved = [c for c in artifact['checks'] if 'Prior' in c['requirement']]
    assert len(preserved) == 2 and all(c['passed'] for c in preserved)


@pytest.mark.parametrize("profile_id,filename", [
    ("cb15", "eval-cb15-flash-live-02.json.gz"),
    ("striker17", "eval-striker17-live-01.json.gz"),
    ("worst12x4", "eval-worst12x4-live-01.json.gz"),
    ("cb15", "03a-deterministic-cb15.json.gz"),
    ("worst12x4", "03a-deterministic-worst12x4.json.gz"),
])
def test_historical_live_recordings_refuse_changed_solver_context(profile_id, filename, monkeypatch):
    if not (FIXTURES.parent / 'runs' / filename).exists():
        pytest.skip('Private historical model recording is excluded from the source handoff')
    # Immutable historical evidence stays intact. New solver/intent output must
    # never inherit a verdict recorded against different workout content.
    # Final-volume technical ordering also changes these two 03A contexts.
    from gateway.providers import anthropic_direct, anthropic_vertex, vertex_gemini
    for provider in (anthropic_direct, anthropic_vertex, vertex_gemini):
        monkeypatch.setattr(provider, '_client', lambda: pytest.fail('Offline replay called a provider'))
    artifact = run_profile(profile_id, tape_path=FIXTURES.parent / 'runs' / filename)
    assert artifact['passed'] is False and artifact['plan'] is None
    assert 'context changed' in artifact['error']['message']
    assert artifact['actualModelSpendUsd'] == artifact['actualModelCalls'] == 0


@pytest.mark.parametrize('profile_id', ['striker17'])
def test_03a_live_recordings_replay_offline(profile_id, monkeypatch):
    if not (FIXTURES.parent / 'runs' / f'03a-deterministic-{profile_id}.json.gz').exists():
        pytest.skip('Private historical model recording is excluded from the source handoff')
    from gateway.providers import anthropic_direct, anthropic_vertex, vertex_gemini
    for provider in (anthropic_direct, anthropic_vertex, vertex_gemini):
        monkeypatch.setattr(provider, '_client', lambda: pytest.fail('Offline replay called a provider'))
    artifact = run_profile(profile_id, tape_path=FIXTURES.parent / 'runs' / f'03a-deterministic-{profile_id}.json.gz')
    assert artifact['passed'], artifact['error']
    assert artifact['actualModelSpendUsd'] == artifact['actualModelCalls'] == 0
    assert artifact['stageModels']['build'] == 'code'
    assert not any(call['stage'] == 'build' for call in artifact['calls'])
    assert artifact['usage']['inputTokens'] > 0
