"""Multi-stage capability execution: the stage loop in `run_job_capability`,
the `inputs` visibility rule, per-stage validation retry, usage aggregation,
and the registry's misconfiguration guards.

No SDK, no Firestore, no Vertex: the provider is a scripted fake, prompts and
validators are registered into the same module-level dicts the real ones live
in, and the ledger writes into `conftest.FakeFirestore`.
"""

from __future__ import annotations

import datetime as dt
import json
import sys
import types as pytypes

import pytest

# `gateway.usage` imports `google.cloud.firestore` at module load and neither
# that package nor the provider SDKs are installed in CI, so it has to be
# stubbed before the pipeline (which imports the ledger) is imported — the same
# trick as test_provider_params.py's `google.genai` stub, just at import time
# rather than in a fixture. SERVER_TIMESTAMP is a concrete UTC datetime rather
# than an opaque sentinel so the fake Firestore's `createdAt >=` quota query
# stays comparable.
if "google.cloud.firestore" not in sys.modules:
    _google = sys.modules.get("google") or pytypes.ModuleType("google")
    _cloud = getattr(_google, "cloud", None) or pytypes.ModuleType("google.cloud")
    _firestore = pytypes.ModuleType("google.cloud.firestore")
    _firestore.SERVER_TIMESTAMP = dt.datetime.now(dt.timezone.utc)
    _cloud.firestore = _firestore
    _google.cloud = _cloud
    sys.modules["google"] = _google
    sys.modules["google.cloud"] = _cloud
    sys.modules["google.cloud.firestore"] = _firestore

from gateway import pipeline, prompts, validators  # noqa: E402
from gateway.errors import GatewayError  # noqa: E402
from gateway.providers import base as providers_base  # noqa: E402
from gateway.providers.base import ModelResult  # noqa: E402
from gateway.registry import REGISTRY, CapabilitySpec, StageSpec  # noqa: E402


# ---------------------------------------------------------------------------
# Fakes / fixtures
# ---------------------------------------------------------------------------


class FakeProvider:
    """Replays a scripted list of `ModelResult`s and records each call."""

    def __init__(self, script: list):
        self._script = list(script)
        self.calls: list[dict] = []

    def generate(self, *, system, messages, model, params, json_schema=None, tools=None, tool_runner=None):
        self.calls.append(
            {
                "system": system,
                "model": model,
                "params": params,
                "json_schema": json_schema,
                "tools": tools,
                "messages": [m.content for m in messages],
            }
        )
        if not self._script:
            raise AssertionError(f"FakeProvider ran out of scripted results at call {len(self.calls)}")
        return self._script.pop(0)

    def stream(self, **kwargs):  # pragma: no cover - job transport only
        raise NotImplementedError


def text_result(text: str, *, input_tokens: int = 0, output_tokens: int = 0, cached: int = 0) -> ModelResult:
    return ModelResult(
        text=text,
        structured=None,
        usage={"inputTokens": input_tokens, "outputTokens": output_tokens, "cachedInputTokens": cached},
    )


def structured_result(payload: dict, *, input_tokens: int = 0, output_tokens: int = 0) -> ModelResult:
    return ModelResult(
        text="",
        structured=payload,
        usage={"inputTokens": input_tokens, "outputTokens": output_tokens, "cachedInputTokens": 0},
    )


@pytest.fixture
def provider(monkeypatch):
    """Installs a FakeProvider for every `provider` name; the test scripts its
    results by appending to `.script` before invoking the pipeline."""
    holder = {"provider": None}

    def _install(script: list) -> FakeProvider:
        fake = FakeProvider(script)
        holder["provider"] = fake
        monkeypatch.setattr(providers_base, "get_provider", lambda name: fake)
        return fake

    return _install


@pytest.fixture
def register_prompt(monkeypatch):
    """Registers a throwaway renderer under a prompt key and records the
    context it was rendered against, so a test can assert what a stage saw."""
    rendered: dict[str, list[dict]] = {}

    def _register(key: str) -> dict[str, list[dict]]:
        def _renderer(context: dict) -> tuple[str, str]:
            rendered.setdefault(key, []).append(context)
            return f"system::{key}", json.dumps(context, sort_keys=True, default=str)

        monkeypatch.setitem(prompts._RENDERERS, key, _renderer)
        return rendered

    return _register


@pytest.fixture
def register_validator(monkeypatch):
    def _register(name: str, fn):
        monkeypatch.setitem(validators.VALIDATORS, name, fn)

    return _register


@pytest.fixture
def register_capability(monkeypatch):
    def _register(spec: CapabilitySpec) -> CapabilitySpec:
        monkeypatch.setitem(REGISTRY, spec.id, spec)
        return spec

    return _register


@pytest.fixture
def fake_clock(monkeypatch):
    """Advances 0.25s per reading (exact in binary, so no rounding slop), so
    every model call is charged a deterministic 250ms and a summed latency is
    actually testable."""
    ticks = {"t": 0.0}

    def _monotonic() -> float:
        ticks["t"] += 0.25
        return ticks["t"]

    monkeypatch.setattr(pipeline.time, "monotonic", _monotonic)


def ledger(db) -> list[dict]:
    docs = db.get_collection(("llmUsage",))
    return [docs[key] for key in sorted(docs, key=lambda k: int(k.split("_")[-1]))]


def flat_spec(capability_id: str, prompt: str, **overrides) -> CapabilitySpec:
    fields = {
        "id": capability_id,
        "transport": "job",
        "assemblers": [],
        "prompt": prompt,
        "provider": "vertex_gemini",
        "model": "test-model",
        "params": {"temperature": 0.1},
        "tools": [],
        "output": None,
        "validators": [],
        "daily_limit": 100,
    }
    fields.update(overrides)
    return CapabilitySpec(**fields)


# ---------------------------------------------------------------------------
# Flat-spec equivalence
# ---------------------------------------------------------------------------


def test_flat_capability_runs_exactly_one_unattributed_stage(
    db, make_invocation, provider, register_prompt, register_capability, fake_clock
):
    register_prompt("test_flat_v1")
    register_capability(flat_spec("test_flat", "test_flat_v1"))
    fake = provider([text_result("only answer", input_tokens=11, output_tokens=7)])

    result, usage = pipeline.run_job_capability(make_invocation(capability="test_flat"))

    assert result == {"text": "only answer"}
    assert len(fake.calls) == 1
    assert fake.calls[0]["model"] == "test-model"
    assert usage["inputTokens"] == 11
    assert usage["outputTokens"] == 7
    assert usage["outcome"] == "complete"
    # A flat capability's ledger doc and returned map are exactly what they
    # were before stages existed — no `stage` attribution.
    assert "stage" not in usage
    entries = ledger(db)
    assert len(entries) == 1
    assert "stage" not in entries[0]
    # The real server materializes the timestamp transform in the stored doc.
    assert isinstance(entries[0]["createdAt"], dt.datetime)
    assert {k: v for k, v in entries[0].items() if k != "createdAt"} == {k: v for k, v in usage.items() if k != "createdAt"}


def test_flat_capability_renders_the_assembled_context_with_no_stages_key(
    make_invocation, provider, register_prompt, register_capability
):
    rendered = register_prompt("test_flat_ctx_v1")
    register_capability(flat_spec("test_flat_ctx", "test_flat_ctx_v1"))
    provider([text_result("ok")])

    inv = make_invocation(capability="test_flat_ctx", context={"playerProfile": {"name": "A"}})
    pipeline.run_job_capability(inv)

    assert rendered["test_flat_ctx_v1"] == [{"playerProfile": {"name": "A"}}]


def test_flat_validation_failure_message_names_no_stage(
    make_invocation, provider, register_prompt, register_capability, register_validator, monkeypatch
):
    monkeypatch.setenv("VALIDATORS_ENFORCED", "1")
    register_prompt("test_flat_fail_v1")
    register_validator("always_bad", lambda result, inv: ["bad output"])
    register_capability(flat_spec("test_flat_fail", "test_flat_fail_v1", validators=["always_bad"]))
    provider([text_result("one"), text_result("two")])

    with pytest.raises(GatewayError) as exc:
        pipeline.run_job_capability(make_invocation(capability="test_flat_fail"))

    assert exc.value.code == "validation_failed"
    assert exc.value.message == "Output failed validation after one retry: bad output"


def test_relaxed_validators_log_and_return_the_first_output(
    make_invocation, provider, register_prompt, register_capability, register_validator, monkeypatch
):
    """Explicit legacy opt-out still logs and returns; the default is enforced."""
    monkeypatch.setenv("VALIDATORS_ENFORCED", "0")
    register_prompt("test_flat_relaxed_v1")
    register_validator("always_bad_relaxed", lambda result, inv: ["bad output"])
    register_capability(
        flat_spec("test_flat_relaxed", "test_flat_relaxed_v1", validators=["always_bad_relaxed"])
    )
    fake = provider([text_result("one"), text_result("two")])

    result, _usage = pipeline.run_job_capability(make_invocation(capability="test_flat_relaxed"))

    assert result["text"] == "one"
    assert len(fake.calls) == 1


# ---------------------------------------------------------------------------
# Two-stage chains
# ---------------------------------------------------------------------------


def test_second_stage_reads_the_first_stages_output(
    db, make_invocation, provider, register_prompt, register_capability, fake_clock
):
    rendered = register_prompt("test_draft_v1")
    register_prompt("test_polish_v1")
    register_capability(
        flat_spec(
            "test_chain",
            "unused",
            stages=[
                StageSpec(id="draft", prompt="test_draft_v1", provider="vertex_gemini", model="draft-model"),
                StageSpec(id="polish", prompt="test_polish_v1", provider="vertex_gemini", model="polish-model"),
            ],
        )
    )
    fake = provider(
        [
            text_result("rough", input_tokens=10, output_tokens=3, cached=1),
            text_result("polished", input_tokens=20, output_tokens=5, cached=2),
        ]
    )

    inv = make_invocation(capability="test_chain", context={"playerProfile": {"name": "A"}})
    result, usage = pipeline.run_job_capability(inv)

    # Stage 1 sees the assembled context only; stage 2 additionally sees stage
    # 1's output keyed by its stage id.
    assert rendered["test_draft_v1"] == [{"playerProfile": {"name": "A"}}]
    stage_two_context = rendered["test_polish_v1"][0]
    assert stage_two_context["playerProfile"] == {"name": "A"}
    assert stage_two_context["stages"] == {"draft": {"text": "rough"}}

    assert result == {"text": "polished"}
    assert [call["model"] for call in fake.calls] == ["draft-model", "polish-model"]

    assert usage["inputTokens"] == 30
    assert usage["outputTokens"] == 8
    assert usage["cachedInputTokens"] == 3
    assert usage["latencyMs"] == 500  # two 250ms calls under the fake clock
    assert usage["model"] == "polish-model"  # the call the result came from
    assert "stage" not in usage  # the aggregate belongs to no single stage

    entries = ledger(db)
    assert [e["stage"] for e in entries] == ["draft", "polish"]
    assert [e["latencyMs"] for e in entries] == [250, 250]


def test_the_job_doc_usage_map_never_carries_stage_attribution(
    db, make_invocation, provider, register_prompt, register_capability
):
    """`stage` is ledger-only — the job doc's `usage` is client-readable and
    has to keep exactly its contract §6 shape."""
    register_prompt("test_solo_v1")
    register_capability(
        flat_spec(
            "test_solo_chain",
            "unused",
            stages=[StageSpec(id="solo", prompt="test_solo_v1", provider="vertex_gemini", model="m")],
        )
    )
    provider([text_result("done", input_tokens=5)])

    _result, usage = pipeline.run_job_capability(make_invocation(capability="test_solo_chain"))

    assert "stage" not in usage
    assert usage["inputTokens"] == 5
    assert ledger(db)[0]["stage"] == "solo"


def test_declared_inputs_hide_other_stages(make_invocation, provider, register_prompt, register_capability):
    register_prompt("test_a_v1")
    register_prompt("test_b_v1")
    rendered = register_prompt("test_c_v1")
    register_capability(
        flat_spec(
            "test_inputs",
            "unused",
            stages=[
                StageSpec(id="a", prompt="test_a_v1", provider="vertex_gemini", model="m"),
                StageSpec(id="b", prompt="test_b_v1", provider="vertex_gemini", model="m"),
                StageSpec(id="c", prompt="test_c_v1", provider="vertex_gemini", model="m", inputs=["a"]),
            ],
        )
    )
    provider([text_result("from a"), text_result("from b"), text_result("from c")])

    pipeline.run_job_capability(make_invocation(capability="test_inputs"))

    assert rendered["test_c_v1"][0]["stages"] == {"a": {"text": "from a"}}


def test_an_empty_inputs_list_hides_every_prior_stage(
    make_invocation, provider, register_prompt, register_capability
):
    register_prompt("test_first_v1")
    rendered = register_prompt("test_isolated_v1")
    register_capability(
        flat_spec(
            "test_no_inputs",
            "unused",
            stages=[
                StageSpec(id="first", prompt="test_first_v1", provider="vertex_gemini", model="m"),
                StageSpec(id="isolated", prompt="test_isolated_v1", provider="vertex_gemini", model="m", inputs=[]),
            ],
        )
    )
    provider([text_result("one"), text_result("two")])

    pipeline.run_job_capability(make_invocation(capability="test_no_inputs", context={"playerProfile": {}}))

    assert "stages" not in rendered["test_isolated_v1"][0]


def test_the_disclaimer_keys_on_the_final_stages_output(
    make_invocation, provider, register_prompt, register_capability
):
    register_prompt("test_notes_v1")
    register_prompt("test_report_v1")
    register_capability(
        flat_spec(
            "test_report_chain",
            "unused",
            stages=[
                StageSpec(id="notes", prompt="test_notes_v1", provider="vertex_gemini", model="m"),
                StageSpec(
                    id="report", prompt="test_report_v1", provider="vertex_gemini", model="m", output="report_v1"
                ),
            ],
        )
    )
    provider([text_result("notes"), structured_result({"summary": "s", "disclaimers": []})])

    result, _usage = pipeline.run_job_capability(make_invocation(capability="test_report_chain"))

    assert result["disclaimers"] == [pipeline._PROVISIONAL_BENCHMARK_DISCLAIMER]


# ---------------------------------------------------------------------------
# Per-stage validation
# ---------------------------------------------------------------------------


def _fails_n_times(n: int):
    state = {"remaining": n}

    def _validator(result: dict, inv) -> list[str]:
        if state["remaining"] > 0:
            state["remaining"] -= 1
            return ["too short"]
        return []

    return _validator


def test_a_stage_retries_validation_once_and_the_chain_continues(
    db, make_invocation, provider, register_prompt, register_capability, register_validator, monkeypatch
):
    monkeypatch.setenv("VALIDATORS_ENFORCED", "1")
    register_prompt("test_retry_first_v1")
    rendered = register_prompt("test_retry_second_v1")
    register_validator("fails_once", _fails_n_times(1))
    register_capability(
        flat_spec(
            "test_retry_chain",
            "unused",
            stages=[
                StageSpec(
                    id="first",
                    prompt="test_retry_first_v1",
                    provider="vertex_gemini",
                    model="m",
                    validators=["fails_once"],
                ),
                StageSpec(id="second", prompt="test_retry_second_v1", provider="vertex_gemini", model="m"),
            ],
        )
    )
    fake = provider(
        [
            text_result("short", input_tokens=1),
            text_result("corrected", input_tokens=2),
            text_result("final", input_tokens=4),
        ]
    )

    result, usage = pipeline.run_job_capability(make_invocation(capability="test_retry_chain"))

    assert len(fake.calls) == 3
    assert "must be corrected" in fake.calls[1]["messages"][-1]
    assert result == {"text": "final"}
    # The discarded first attempt is ledgered but not echoed onto the job doc,
    # so the aggregate is the accepted call of each stage: 2 + 4.
    assert usage["inputTokens"] == 6

    entries = ledger(db)
    assert [e["outcome"] for e in entries] == ["validation_retry", "complete", "complete"]
    assert [e["stage"] for e in entries] == ["first", "first", "second"]
    # Stage 2 still ran, and it saw the corrected stage 1 output.
    assert rendered["test_retry_second_v1"][0]["stages"] == {"first": {"text": "corrected"}}


def test_a_stage_failing_validation_twice_raises_and_names_the_stage(
    make_invocation, provider, register_prompt, register_capability, register_validator, monkeypatch
):
    monkeypatch.setenv("VALIDATORS_ENFORCED", "1")
    register_prompt("test_doomed_v1")
    register_prompt("test_unreached_v1")
    register_validator("always_fails", _fails_n_times(99))
    register_capability(
        flat_spec(
            "test_doomed_chain",
            "unused",
            stages=[
                StageSpec(
                    id="doomed",
                    prompt="test_doomed_v1",
                    provider="vertex_gemini",
                    model="m",
                    validators=["always_fails"],
                ),
                StageSpec(id="unreached", prompt="test_unreached_v1", provider="vertex_gemini", model="m"),
            ],
        )
    )
    fake = provider([text_result("a"), text_result("b"), text_result("c")])

    with pytest.raises(GatewayError) as exc:
        pipeline.run_job_capability(make_invocation(capability="test_doomed_chain"))

    assert exc.value.code == "validation_failed"
    assert "stage 'doomed'" in exc.value.message
    assert len(fake.calls) == 2  # the second stage never ran


# ---------------------------------------------------------------------------
# Registry guards — a bad chain is a code bug, so it fails at construction
# ---------------------------------------------------------------------------


def _stage(stage_id: str, **overrides) -> StageSpec:
    fields = {"id": stage_id, "prompt": f"{stage_id}_v1", "provider": "vertex_gemini", "model": "m"}
    fields.update(overrides)
    return StageSpec(**fields)


def test_duplicate_stage_ids_are_rejected():
    with pytest.raises(GatewayError) as exc:
        flat_spec("dupes", "unused", stages=[_stage("a"), _stage("a")])
    assert exc.value.code == "internal"
    assert "duplicate stage id" in exc.value.message


@pytest.mark.parametrize("dep", ["b", "nope", "a"])
def test_inputs_must_reference_an_earlier_stage(dep):
    # "b" is later, "nope" doesn't exist, "a" is the stage itself.
    with pytest.raises(GatewayError) as exc:
        flat_spec("forward", "unused", stages=[_stage("a", inputs=[dep]), _stage("b")])
    assert exc.value.code == "internal"
    assert "not an earlier stage" in exc.value.message


def test_a_stream_capability_may_not_declare_multiple_stages():
    with pytest.raises(GatewayError) as exc:
        flat_spec("streamy", "unused", transport="stream", stages=[_stage("a"), _stage("b")])
    assert exc.value.code == "internal"
    assert "more than one stage" in exc.value.message


def test_a_stream_capability_may_declare_a_single_stage():
    spec = flat_spec("streamy_ok", "unused", transport="stream", stages=[_stage("only")])
    assert [s.id for s in spec.stage_list()] == ["only"]


def test_an_empty_stage_list_is_rejected():
    with pytest.raises(GatewayError) as exc:
        flat_spec("empty", "unused", stages=[])
    assert exc.value.code == "internal"


def test_a_flat_spec_synthesizes_one_stage_from_its_own_fields():
    spec = flat_spec("synth", "synth_v1", tools=["search_drill_catalog"], output="report_v1", validators=["report_v1"])
    stages = spec.stage_list()
    assert len(stages) == 1
    only = stages[0]
    assert (only.id, only.prompt, only.provider, only.model) == ("synth", "synth_v1", "vertex_gemini", "test-model")
    assert (only.params, only.tools, only.output, only.validators) == (
        spec.params,
        spec.tools,
        spec.output,
        spec.validators,
    )
    assert only.inputs is None


@pytest.mark.parametrize("capability_id", sorted(REGISTRY))
def test_every_shipped_capability_is_flat_single_stage(capability_id):
    spec = REGISTRY[capability_id]
    if capability_id == "kick_analysis":
        # Deliberately multi-stage (observe -> focus) — the conscious exemption
        # this test exists to force (KICK_AI_ANALYSIS_PLAN Part 1.1).
        assert spec.stages is not None
        assert [s.id for s in spec.stage_list()] == ["observe", "focus"]
        return
    if capability_id == "generate_training_plan":
        # V3 uses the deterministic orchestrator; every stage's policy remains
        # independently registered, and the legacy generic stage loop stays covered.
        from gateway.registry import PROGRAM_STAGES
        assert spec.stages is None and spec.strict_validation is True
        assert set(PROGRAM_STAGES) == {"assess", "coach_parse", "focus_split", "select", "shape", "build", "repair", "time_check", "adversarial"}
        return
    assert spec.stages is None
    assert len(spec.stage_list()) == 1


@pytest.mark.parametrize("capability_id", sorted(REGISTRY))
def test_every_registry_assembler_resolves(capability_id):
    """The assembler name doubles as the context key downstream code reads —
    a name in the registry that ASSEMBLERS doesn't carry (or vice versa) fails
    only at runtime. The planIntake/planIntakeGate mismatch shipped exactly
    this way: the gate ran, stored under its registry name, and every reader
    of context['planIntake'] silently got {} in production while tests seeded
    the right key directly."""
    from gateway.assemblers import ASSEMBLERS

    for name in REGISTRY[capability_id].assemblers:
        assert name in ASSEMBLERS, (
            f"capability '{capability_id}' references assembler '{name}', "
            "which is not registered in gateway.assemblers.ASSEMBLERS"
        )


def test_legacy_plan_intake_key_remains_available_for_historical_helpers():
    from gateway.assemblers import ASSEMBLERS, assemble_plan_intake_gate

    assert ASSEMBLERS.get("planIntake") is assemble_plan_intake_gate
    # V3 validates through program_profile before its deterministic chain.
    assert REGISTRY["generate_training_plan"].assemblers == []
    assert REGISTRY["generate_training_plan"].strict_validation is True


# ---------------------------------------------------------------------------
# Iterated stages (PLAN_GENERATION_V2_PLAN Part 1 / B2)
# ---------------------------------------------------------------------------


def _fragments_source(fragments: list[dict]):
    def _next(inv, outputs):
        return fragments[len(outputs)] if len(outputs) < len(fragments) else None

    return _next


def _iter_spec(**stage_overrides) -> CapabilitySpec:
    stage_fields = {
        "id": "fill",
        "prompt": "test_iter_v1",
        "provider": "vertex_gemini",
        "model": "test-model",
        "iterate": "test_iter",
    }
    stage_fields.update(stage_overrides)
    return flat_spec("test_iter_cap", "unused", stages=[StageSpec(**stage_fields)])


def test_iterated_stage_runs_once_per_fragment_and_wraps_outputs(
    db, make_invocation, provider, register_prompt, register_capability, fake_clock, monkeypatch
):
    rendered = register_prompt("test_iter_v1")
    monkeypatch.setitem(
        pipeline._ITERATION_SOURCES,
        "test_iter",
        (_fragments_source([{"cursor": {"n": 1}}, {"cursor": {"n": 2}}]), "items"),
    )
    register_capability(_iter_spec())
    fake = provider([text_result("one", output_tokens=5), text_result("two", output_tokens=7)])

    result, usage = pipeline.run_job_capability(make_invocation(capability="test_iter_cap"))

    assert result == {"items": [{"text": "one"}, {"text": "two"}]}
    assert len(fake.calls) == 2
    # Each iteration rendered against the shared context plus its own fragment.
    assert rendered["test_iter_v1"][0]["cursor"] == {"n": 1}
    assert rendered["test_iter_v1"][1]["cursor"] == {"n": 2}
    # Usage aggregates across every iteration's accepted call.
    assert usage["outputTokens"] == 12


def test_iterated_stage_retries_only_the_failing_iteration(
    db, make_invocation, provider, register_prompt, register_validator, register_capability,
    fake_clock, monkeypatch
):
    """The plan's hard requirement: iteration N failing validation retries
    iteration N alone — earlier accepted iterations are never re-run, later
    ones proceed normally, and the validator sees the iteration mirror."""
    register_prompt("test_iter_v1")
    monkeypatch.setitem(
        pipeline._ITERATION_SOURCES,
        "test_iter",
        (_fragments_source([{"cursor": {"n": 1}}, {"cursor": {"n": 2}}, {"cursor": {"n": 3}}]), "items"),
    )
    seen_iterations = []

    def _validator(result, inv):
        seen_iterations.append(inv.iteration["cursor"]["n"])
        return ["text says bad"] if result.get("text") == "bad" else []

    register_validator("test_iter_check", _validator)
    register_capability(_iter_spec(validators=["test_iter_check"]))
    monkeypatch.setenv("VALIDATORS_ENFORCED", "1")
    fake = provider([
        text_result("ok1"),
        text_result("bad"),
        text_result("ok2-retried"),
        text_result("ok3"),
    ])

    inv = make_invocation(capability="test_iter_cap")
    result, _usage = pipeline.run_job_capability(inv)

    assert result == {"items": [{"text": "ok1"}, {"text": "ok2-retried"}, {"text": "ok3"}]}
    assert len(fake.calls) == 4
    # The retry call replayed the rejected output + violations to iteration 2
    # only; iterations 1 and 3 ran exactly once.
    assert len(fake.calls[2]["messages"]) == 2
    assert "text says bad" in fake.calls[2]["messages"][1]
    assert seen_iterations == [1, 2, 2, 3]
    # The mirror never leaks out of the stage.
    assert inv.iteration == {}


def test_iterated_stage_with_no_iterations_is_internal_error(
    db, make_invocation, provider, register_prompt, register_capability, monkeypatch
):
    register_prompt("test_iter_v1")
    monkeypatch.setitem(pipeline._ITERATION_SOURCES, "test_iter", (_fragments_source([]), "items"))
    register_capability(_iter_spec())
    provider([])

    with pytest.raises(GatewayError) as exc:
        pipeline.run_job_capability(make_invocation(capability="test_iter_cap"))
    assert exc.value.code == "internal"
    assert "no iterations" in exc.value.message


def test_unregistered_iteration_source_is_internal_error(
    db, make_invocation, provider, register_prompt, register_capability
):
    register_prompt("test_iter_v1")
    register_capability(_iter_spec(iterate="not_registered"))
    provider([])

    with pytest.raises(GatewayError) as exc:
        pipeline.run_job_capability(make_invocation(capability="test_iter_cap"))
    assert exc.value.code == "internal"
    assert "not_registered" in exc.value.message


# ---------------------------------------------------------------------------
# Job trace — the per-attempt Q&A decision trail (inv.trace)
# ---------------------------------------------------------------------------


def test_trace_records_every_attempt_with_prompt_and_output(
    db, make_invocation, provider, register_prompt, register_capability, register_validator,
    fake_clock, monkeypatch
):
    """One record per model attempt, retries included: the rendered prompt in,
    thoughts/output/violations out. The retry attempt carries its follow-up
    correction message; the accepted attempt carries none."""
    monkeypatch.setenv("VALIDATORS_ENFORCED", "1")
    register_prompt("test_retry_first_v1")
    register_prompt("test_retry_second_v1")
    register_validator("fails_once", _fails_n_times(1))
    register_capability(
        flat_spec(
            "test_trace_chain",
            "unused",
            stages=[
                StageSpec(
                    id="first",
                    prompt="test_retry_first_v1",
                    provider="vertex_gemini",
                    model="m",
                    validators=["fails_once"],
                ),
                StageSpec(id="second", prompt="test_retry_second_v1", provider="vertex_gemini", model="m"),
            ],
        )
    )
    provider(
        [
            text_result("short"),
            text_result("corrected"),
            ModelResult(
                text="final", structured=None,
                usage={"inputTokens": 1, "outputTokens": 2, "cachedInputTokens": 0},
                thoughts="the athlete's budget splits cleanly",
            ),
        ]
    )

    inv = make_invocation(capability="test_trace_chain")
    pipeline.run_job_capability(inv)

    assert [(r["stage"], r["attempt"]) for r in inv.trace] == [("first", 1), ("first", 2), ("second", 1)]

    rejected, accepted, final = inv.trace
    assert rejected["violations"] == ["too short"]
    assert rejected["output"] == {"text": "short"}
    assert rejected["prompt"]["system"] == "system::test_retry_first_v1"
    assert rejected["prompt"]["followUps"] is None
    # The retry attempt's follow-up is the correction message the model saw.
    assert accepted["violations"] is None
    assert "must be corrected" in accepted["prompt"]["followUps"][0]
    # Provider thoughts ride along on the record for the attempt they came from.
    assert final["thoughts"] == "the athlete's budget splits cleanly"
    assert final["model"] == "m"
    assert final["latencyMs"] > 0


def test_trace_labels_iterations(
    db, make_invocation, provider, register_prompt, register_capability, fake_clock, monkeypatch
):
    register_prompt("test_iter_v1")
    monkeypatch.setitem(
        pipeline._ITERATION_SOURCES,
        "test_iter",
        (_fragments_source([{"cursor": {"n": 1}}, {"cursor": {"n": 2}}]), "items"),
    )
    register_capability(_iter_spec())
    provider([text_result("one"), text_result("two")])

    inv = make_invocation(capability="test_iter_cap")
    pipeline.run_job_capability(inv)

    assert [r["iteration"] for r in inv.trace] == ["cursor", "cursor"]
    assert [r["attempt"] for r in inv.trace] == [1, 1]


def test_trace_iteration_label_knows_plan_fill_weeks():
    assert pipeline._trace_iteration_label({"fillWeek": {"weekNumber": 3}}) == "week 3"
    assert pipeline._trace_iteration_label({}) is None


def test_validation_is_enforced_by_default(monkeypatch):
    monkeypatch.delenv("VALIDATORS_ENFORCED", raising=False)
    assert pipeline._validators_enforced() is True
