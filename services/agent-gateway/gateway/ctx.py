"""`Invocation` — the single object threaded through every pipeline stage.

Assemblers, tools, and validators all take one of these and nothing else. That
is what makes them unit-testable: a test constructs an Invocation with a fake
`db` and calls the function directly, no Flask and no Vertex involved.

Critically, `uid`/`email` on an Invocation have **already passed
`authorize_player_access` for `player_id`**. A tool handler therefore inherits
the caller's authorization and can never widen it — the plan's "a tool can never
read a player the requesting user couldn't."
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class Invocation:
    capability: str
    player_id: str
    uid: str
    email: Optional[str] = None
    params: dict[str, Any] = field(default_factory=dict)

    # Transport A only.
    job_id: Optional[str] = None
    # Transport B only.
    conversation_id: Optional[str] = None

    client_version: Optional[str] = None

    # Verified ID-token claims or Admin Auth lookup; never request/job fields.
    trusted_claims: dict[str, Any] = field(default_factory=dict)

    # Injected clients. Typed loosely so tests can pass fakes.
    db: Any = None
    storage: Any = None

    log: logging.Logger = field(default_factory=lambda: logging.getLogger("gateway"))

    # Populated by the pipeline as stages run; carried so later stages (and the
    # usage ledger) can see what earlier ones produced.
    context: dict[str, Any] = field(default_factory=dict)

    # Accepted stage outputs keyed by stage id, stored by the pipeline as each
    # stage's result passes validation — so validators and finalizers of later
    # stages can read an earlier stage's output (e.g. `kick_focus_v1` resolving
    # a focus area's referenced observation).
    stage_outputs: dict[str, Any] = field(default_factory=dict)

    # Items dropped by validation salvage, keyed by stage id — populated when a
    # stage's post-retry output only passed by dropping violating items, so
    # finalizers can record what the athlete did NOT see and why. Deliberately
    # not part of `context`: that dict is rendered into later stages' prompts.
    salvage: dict[str, list[str]] = field(default_factory=dict)

    # The job's decision trail: one record per model attempt (retries
    # included), appended by the pipeline as calls happen — the rendered
    # prompt in, the model's thought summary and output out, plus any
    # validation violations. Persisted by main.py to the artifact bucket as
    # `llmJobs/{jobId}/trace.json`; never rendered into any prompt and never
    # part of the job result.
    trace: list[dict[str, Any]] = field(default_factory=list)

    # Iterated stages only (StageSpec.iterate): the context fragment of the
    # iteration currently running, mirrored here by the pipeline so the stage's
    # validators can check the output against the iteration that asked for it
    # (e.g. plan fill: "did the model fill the week this call was for?").
    # Validators only receive `(result, inv)` — without this mirror they cannot
    # see which iteration they are validating. Reset to {} between stages.
    iteration: dict[str, Any] = field(default_factory=dict)

    def player_ref(self):
        return self.db.collection("players").document(self.player_id)
