"""The server-side capability registry (plan Part 1, Principle 2; contract
§4). Deliberately typed Python, not Firestore data: prompts and model choices
are logic, and changing them should go through code review like anything else
(plan: "not in Firestore").
"""

from __future__ import annotations

from dataclasses import dataclass, field

from gateway.errors import GatewayError

# Model ids as of 2026-08. Report generation is explicitly called out in the
# plan (Part 6) as "bake-off pending": Gemini Pro vs a Claude Opus-class model
# via Vertex, evaluated on ~10 real athlete profiles. Gemini is registered
# here because it's the platform's fixed default provider (plan's fixed
# constraint 1) — the bake-off, if it favors Claude, is a `provider`/`model`
# edit to this one entry, not new plumbing (gateway/providers/anthropic_vertex.py
# already implements the adapter).
_GEMINI_FLASH = "gemini-2.5-flash"
_GEMINI_PRO = "gemini-2.5-pro"

# The Flash capabilities are short, well-scoped turns; 2.5's default dynamic
# thinking buys them nothing and costs tokens and first-token latency.
_NO_THINKING = 0


@dataclass(frozen=True)
class StageSpec:
    """One self-contained render-prompt -> call-model -> validate cycle.

    A capability is an ordered, linear list of these. Everything that varies
    per model call lives here (prompt, provider/model/params, tools, output
    schema, validators); everything that is per *invocation* — assemblers,
    authorization, quota — stays on the CapabilitySpec and runs once.
    """

    id: str  # unique within the capability; also the key later stages read its output under
    prompt: str
    provider: str
    model: str
    params: dict = field(default_factory=dict)
    tools: list[str] = field(default_factory=list)
    output: str | None = None  # None = freeform text; else a gateway.schemas key
    validators: list[str] = field(default_factory=list)
    # Ids of *earlier* stages whose outputs this stage's prompt may read.
    # `None` = every earlier stage is visible; a list is enforced, so a stage's
    # dependencies are explicit and testable rather than "whatever ran before".
    inputs: list[str] | None = None
    # Iterated stage (PLAN_GENERATION_V2_PLAN Part 1): names a registered
    # iteration source in gateway.pipeline. The source is called with the
    # Invocation and the list of already-accepted iteration outputs, and
    # returns the next iteration's render-context fragment (or None when
    # done). The full render -> generate -> validate -> retry-once cycle runs
    # once per iteration — a failing iteration retries *alone* — and the
    # stage's recorded output is the accepted outputs in order, wrapped by the
    # source's declared result key. None = a normal single-call stage.
    iterate: str | None = None


@dataclass(frozen=True)
class CapabilitySpec:
    id: str
    transport: str  # "job" | "stream"
    assemblers: list[str]
    prompt: str
    provider: str
    model: str
    # Provider-neutral model knobs, translated by each adapter:
    #   temperature, max_output_tokens — as you'd expect.
    #   thinking_budget — reasoning tokens. Omit for the provider's default;
    #     `0` disables thinking; `-1` asks for a dynamic budget (Gemini only);
    #     a positive value is a token cap. Per-provider floors apply and are
    #     the entry's job to respect: Gemini 2.5 Pro cannot go below 128 or
    #     disable thinking at all, and Claude needs >= 1024 with
    #     max_output_tokens strictly above it. See each adapter's translation
    #     in gateway/providers/.
    params: dict
    tools: list[str]
    output: str | None  # None = freeform text; else a gateway.schemas key, e.g. "report_v1"
    validators: list[str]
    daily_limit: int
    # Opt this capability into strict validation ahead of the service-wide
    # VALIDATORS_ENFORCED flip. Use it when a validator exists to prevent the
    # model from stating something the deterministic data contradicts — logging
    # a violation and shipping the output anyway defeats the purpose.
    strict_validation: bool = False
    # Multi-stage capabilities only: an ordered, linear chain. When set, the
    # flat prompt/provider/model/params/tools/output/validators fields above
    # are unused — the stages carry them. Every entry below is flat.
    stages: list[StageSpec] | None = None

    def __post_init__(self) -> None:
        # A malformed chain is a code bug in this file, not anything a caller
        # can trigger, so it fails at import rather than mid-invocation.
        if self.stages is None:
            return
        if not self.stages:
            raise GatewayError("internal", f"Capability '{self.id}' declares an empty stage list")
        if self.transport == "stream" and len(self.stages) > 1:
            raise GatewayError(
                "internal", f"Stream capability '{self.id}' cannot declare more than one stage"
            )
        seen: set[str] = set()
        for stage in self.stages:
            if stage.id in seen:
                raise GatewayError("internal", f"Capability '{self.id}' declares duplicate stage id '{stage.id}'")
            for dep in stage.inputs or ():
                if dep not in seen:
                    raise GatewayError(
                        "internal",
                        f"Stage '{stage.id}' of capability '{self.id}' declares input '{dep}', "
                        "which is not an earlier stage",
                    )
            seen.add(stage.id)

    def stage_list(self) -> list[StageSpec]:
        """The stages to execute in order. A flat spec synthesizes the single
        stage its top-level fields already describe, so pipeline code has one
        shape to run and single-stage behavior is unchanged by construction.
        """
        if self.stages is not None:
            return list(self.stages)
        return [
            StageSpec(
                id=self.id,
                prompt=self.prompt,
                provider=self.provider,
                model=self.model,
                params=self.params,
                tools=self.tools,
                output=self.output,
                validators=self.validators,
            )
        ]


REGISTRY: dict[str, CapabilitySpec] = {
    "generate_report": CapabilitySpec(
        id="generate_report",
        transport="job",
        assemblers=["playerProfile", "athleteStats", "recentReps", "benchmarkContext"],
        prompt="report_v3",
        provider="vertex_gemini",
        model=_GEMINI_PRO,
        # No `thinking_budget`: 2.5 Pro can't disable thinking anyway, and its
        # default dynamic budget is the right baseline to run the bake-off on.
        params={"temperature": 0.4, "max_output_tokens": 4096},
        tools=["search_drill_catalog"],
        output="report_v1",
        validators=["report_v1"],
        daily_limit=3,
    ),
    "session_summary": CapabilitySpec(
        id="session_summary",
        transport="job",
        # Contract §5: params are `{"sessionId": ...}`. A dedicated
        # `sessionDetail` assembler (owned by the assemblers.py author) is
        # expected to read `players/{id}/sessions/{sessionId}` and its reps;
        # `playerProfile` gives the model age-band/position context so the
        # summary reads like it knows the athlete, not just the numbers.
        assemblers=["playerProfile", "sessionDetail"],
        prompt="session_summary_v1",
        provider="vertex_gemini",
        model=_GEMINI_FLASH,
        params={"temperature": 0.5, "max_output_tokens": 512, "thinking_budget": _NO_THINKING},
        tools=[],
        # NOTE: assumes a `session_summary_v1` schema is registered in
        # gateway/schemas — see README "Not yet implemented" if it isn't.
        output="session_summary_v1",
        validators=[],
        daily_limit=10,
    ),
    "coaching_chat": CapabilitySpec(
        id="coaching_chat",
        transport="stream",
        assemblers=["playerProfile"],
        prompt="coaching_chat_v1",
        provider="vertex_gemini",
        model=_GEMINI_FLASH,
        params={"temperature": 0.6, "max_output_tokens": 1024, "thinking_budget": _NO_THINKING},
        tools=[],
        output=None,
        validators=[],
        daily_limit=50,
    ),
    "pose_chat": CapabilitySpec(
        id="pose_chat",
        transport="stream",
        # benchmarkContextOptional (not the strict benchmarkContext): an athlete
        # with reps but nothing benchmarkable should still be able to chat.
        assemblers=["playerProfile", "recentReps", "benchmarkContextOptional"],
        prompt="pose_chat_v1",
        provider="vertex_gemini",
        model=_GEMINI_FLASH,
        params={"temperature": 0.5, "max_output_tokens": 1024, "thinking_budget": _NO_THINKING},
        tools=["fetch_rep_metrics", "fetch_pose_artifact", "fetch_benchmark"],
        output=None,
        validators=[],
        daily_limit=30,
    ),
    "kick_chat": CapabilitySpec(
        id="kick_chat",
        transport="stream",
        # Same deterministic spine as kick_analysis: kickAnalysisContext recomputes
        # the athlete-vs-pro table each turn (rep artifacts are immutable, so this
        # is latency, not staleness — ~0.5-1s before first token), kickChatKnowledge
        # screens it and adds the symptom map, kickRepAnalysis folds in the
        # walkthrough cards the athlete just watched. Requires params.repId.
        assemblers=["playerProfile", "kickAnalysisContext", "kickChatKnowledge", "kickRepAnalysis"],
        prompt="kick_chat_v1",
        provider="vertex_gemini",
        model=_GEMINI_FLASH,
        # Flash, not Pro: the deterministic screen has done the arithmetic and chat
        # latency is the product. A small thinking budget covers the symptom ->
        # fault-screen -> table lookup chain; it spends from max_output_tokens, so
        # the cap leaves ~1k tokens for the (deliberately short) answer.
        params={"temperature": 0.5, "max_output_tokens": 2048, "thinking_budget": 1024},
        tools=["fetch_rep_metrics", "fetch_benchmark"],
        output=None,
        validators=[],
        daily_limit=40,
    ),
    "generate_training_plan": CapabilitySpec(
        id="generate_training_plan", transport="job", assemblers=[],
        prompt="program_build_v3", provider="vertex_gemini", model="gemini-2.5-flash",
        params={}, tools=[], output=None, validators=[], daily_limit=1, strict_validation=True,
    ),
    "generate_personalized_plan": CapabilitySpec(
        id="generate_personalized_plan", transport="job", assemblers=[], prompt="program_build_v3",
        provider="vertex_gemini", model="gemini-2.5-flash", params={}, tools=[], output=None,
        validators=[], daily_limit=3, strict_validation=True,
    ),
    "assess_personalized_plan": CapabilitySpec(
        id="assess_personalized_plan", transport="job", assemblers=[], prompt="program_coach_v3",
        provider="vertex_gemini", model="gemini-2.5-flash", params={}, tools=[], output=None,
        validators=[], daily_limit=10, strict_validation=True,
    ),
    "activate_personalized_plan": CapabilitySpec(
        id="activate_personalized_plan", transport="job", assemblers=[], prompt="", provider="code", model="code",
        params={}, tools=[], output=None, validators=[], daily_limit=30, strict_validation=True,
    ),
    "discard_personalized_plan": CapabilitySpec(
        id="discard_personalized_plan", transport="job", assemblers=[], prompt="", provider="code", model="code",
        params={}, tools=[], output=None, validators=[], daily_limit=30, strict_validation=True,
    ),
    "apply_workout_draft": CapabilitySpec(
        id="apply_workout_draft", transport="job", assemblers=[], prompt="",
        provider="code", model="code", params={}, tools=[], output=None,
        validators=[], daily_limit=30, strict_validation=True,
    ),
    "save_workout_edit": CapabilitySpec(
        id="save_workout_edit", transport="job", assemblers=[], prompt="",
        provider="code", model="code", params={}, tools=[], output=None,
        validators=[], daily_limit=30, strict_validation=True,
    ),
    "validate_workout_start": CapabilitySpec(
        id="validate_workout_start", transport="job", assemblers=[], prompt="",
        provider="code", model="code", params={}, tools=[], output=None,
        validators=[], daily_limit=50, strict_validation=True,
    ),
    "workout_chat": CapabilitySpec(
        id="workout_chat", transport="stream", assemblers=[], prompt="workout_chat_v1",
        # 03A's measured starting point. Server-side knobs permit every model
        # in PROGRAM_ALLOWED_MODELS, with Sonnet 4.6 as the hard runtime cap.
        provider="vertex_gemini", model=_GEMINI_FLASH,
        params={"temperature": 0.3, "max_output_tokens": 4096, "thinking_budget": 0,
                "max_tool_calls": 30, "max_tool_seconds": 120},
        tools=["search_drills", "get_drill", "get_drill_history", "estimate_minutes",
               "draft_create", "draft_add_block", "draft_set_dose", "draft_remove_block",
               "draft_reorder", "draft_set_intent", "draft_get", "validate_workout"],
        output=None, validators=[], daily_limit=3, strict_validation=True,
    ),
    "build_workout": CapabilitySpec(
        id="build_workout",
        transport="job",
        # activePlanWeek validates params + resolves the active plan's current
        # week; weekProgress and workoutCandidates both read its output from
        # inv.context, so this order is load-bearing (WORKOUT_BUILDER_AGENT_PLAN
        # Part 1 — "One LLM stage with deterministic bookends").
        assemblers=["playerProfile", "activePlanWeek", "weekProgress", "workoutCandidates"],
        prompt="build_workout_v1",
        provider="vertex_gemini",
        model=_GEMINI_FLASH,
        params={"temperature": 0.4, "max_output_tokens": 4096, "thinking_budget": _NO_THINKING},
        tools=[],
        output="workout_v1",
        validators=["workout_v1"],
        daily_limit=3,
    ),
    "kick_analysis": CapabilitySpec(
        id="kick_analysis",
        transport="job",
        # kickAnalysisContext computes the full deterministic athlete-vs-pro
        # metric table + orientation + series before any model call
        # (KICK_ANALYSIS_V2_PLAN Part 1); playerProfile gives both stages
        # age-appropriate framing; kickPreviousCues feeds the focus stage's
        # anti-repetition rule.
        # Order matters: kickKnowledge screens kickAnalysisContext's computed output.
        assemblers=["playerProfile", "kickAnalysisContext", "kickKnowledge", "kickPreviousCues"],
        # Flat fields are unused when `stages` is set — the chain below carries
        # the real prompt/model/params per stage.
        prompt="kick_observe_v1",
        provider="vertex_gemini",
        model=_GEMINI_PRO,
        params={},
        tools=[],
        output=None,
        validators=[],
        daily_limit=10,
        # The kick validators enforce side/direction/frame consistency against the
        # deterministic table. v1 shipped direction-inverted cues to real athletes
        # precisely because violations were logged and persisted anyway, so this
        # capability is strict regardless of the service-wide flag.
        strict_validation=True,
        # Thinking bounded explicitly on both stages — the same 2.5 Pro
        # dynamic-thinking-truncates-constrained-JSON failure the plan chain
        # hit live (see generate_training_plan's note above); kick ran
        # unbounded until v2.
        stages=[
            StageSpec(id="observe", prompt="kick_observe_v1", provider="vertex_gemini",
                      model=_GEMINI_PRO, params={"temperature": 0.2, "max_output_tokens": 8192,
                                                 "thinking_budget": 3072, "max_tool_calls": 6,
                                                 "max_tool_seconds": 240},
                      tools=["inspect_kick_evidence"],
                      output="kick_observations_v1", validators=["kick_observations_v1"]),
            StageSpec(id="focus", prompt="kick_focus_v1", provider="vertex_gemini",
                      model=_GEMINI_PRO, params={"temperature": 0.4, "max_output_tokens": 6144,
                                                 "thinking_budget": 2048, "max_tool_calls": 4,
                                                 "max_tool_seconds": 240},
                      tools=["inspect_kick_evidence"],
                      output="kick_focus_v1", validators=["kick_focus_v1"],
                      inputs=["observe"]),
        ],
    ),
    "kick_foot_comparison": CapabilitySpec(
        id="kick_foot_comparison", transport="job",
        assemblers=["playerProfile", "kickComparisonContext"],
        prompt="kick_comparison_v1", provider="vertex_gemini", model=_GEMINI_PRO,
        params={"temperature": 0.2, "max_output_tokens": 8192, "thinking_budget": 3072,
                "max_tool_calls": 8, "max_tool_seconds": 240},
        tools=["inspect_kick_evidence", "inspect_kick_comparison"],
        output="kick_comparison_v1", validators=["kick_comparison_v1"],
        daily_limit=10, strict_validation=True,
    ),
}


def get_capability(capability_id: str) -> CapabilitySpec:
    spec = REGISTRY.get(capability_id)
    if spec is None:
        raise GatewayError("invalid_request", f"Unknown capability: {capability_id!r}")
    return spec


# V3 stage policies are server registry knobs, never client/model arguments.
# Pure arithmetic stages have model="code" and cannot be overridden into model
# arithmetic. Judgment stages support independent provider/model/thinking swaps.
PROGRAM_STAGES = {
    key: StageSpec(id=key, prompt="", provider="code", model="code")
    for key in ("assess", "focus_split", "select", "shape", "build", "time_check")
}
PROGRAM_STAGES.update({
    "coach_parse": StageSpec(id="coach_parse", prompt="program_coach_v3", provider="vertex_gemini",
        model="gemini-2.5-flash", params={"temperature":0, "max_output_tokens":512, "thinking_budget":0}),
    "repair": StageSpec(id="repair", prompt="program_build_v3", provider="vertex_gemini",
        model="gemini-2.5-flash", params={"temperature":0, "max_output_tokens":4096, "thinking_budget":0,
            "max_tool_calls":60, "max_tool_seconds":120}, tools=["draft_create", "draft_add_block",
            "draft_set_dose", "draft_remove_block", "draft_reorder", "draft_get",
            "get_drill", "search_drills", "estimate_minutes", "validate_workout"]),
    "adversarial": StageSpec(id="adversarial", prompt="program_check_v3", provider="anthropic_direct",
        model="claude-sonnet-4-6", params={"temperature":0, "max_output_tokens":1536, "thinking_budget":0}),
})
PROGRAM_ALLOWED_MODELS = {
    # Everything here is at or below Nolan's Sonnet 4.6 runtime cap. Flash-Lite
    # is the cheapest tier the adapter can reach and is an ablation candidate
    # for the scoped parse/check stages (03A). Note all Gemini 2.5 ids are
    # scheduled for retirement on 2026-10-16.
    "gemini-2.5-flash": "vertex_gemini",
    "gemini-2.5-flash-lite": "vertex_gemini",
    "claude-haiku-4-5@20251001": "anthropic_vertex",
    "claude-sonnet-4-5": "anthropic_vertex",
    "claude-sonnet-4-5@20250929": "anthropic_vertex",
    "claude-sonnet-4-6": "anthropic_vertex",
}

def program_stage(stage_id, overrides=None):
    from dataclasses import replace
    stage = PROGRAM_STAGES[stage_id]
    model = (overrides or {}).get(stage_id, stage.model)
    if stage.provider == "code":
        if model != "code":
            raise GatewayError("invalid_request", f"{stage_id} is deterministic arithmetic; only code is supported")
        return stage
    if model not in PROGRAM_ALLOWED_MODELS:
        raise GatewayError("invalid_request", "Runtime model exceeds or is outside the Sonnet 4.6 allowlist")
    # Scoped release: direct Anthropic is enabled only for Sonnet reviewing
    # generated workouts. Existing coach/chat and other stage routing stays put.
    provider = ("anthropic_direct" if stage_id == "adversarial" and model == "claude-sonnet-4-6"
                else PROGRAM_ALLOWED_MODELS[model])
    return replace(stage, model=model, provider=provider)


# Existing pose_chat opts into this policy only with context.coachWorkspaceVersion=1
# and config/llm.coachWorkspaceEnabled=true. Legacy requests retain their registry.
COACH_WORKSPACE_STAGE = StageSpec(
    id="coach_chat", prompt="coach_workspace_v1", provider="anthropic_vertex", model="claude-sonnet-4-6",
    params={"temperature": 0.4, "max_output_tokens": 768, "thinking_budget": 0,
            "max_tool_calls": 12, "max_tool_seconds": 60},
    tools=["fetch_rep_metrics", "fetch_benchmark", "search_drills", "get_drill", "get_drill_history",
           "estimate_minutes", "prepare_workout", "save_player_profile"],
)
COACH_MEMORY_STAGE = StageSpec(
    id="coach_memory", prompt="coach_memory_extract_v1", provider="vertex_gemini", model=_GEMINI_FLASH,
    params={"temperature": 0, "max_output_tokens": 512, "thinking_budget": 0, "request_timeout_seconds": 20},
)
