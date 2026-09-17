"""Model-callable tools (contract §10). Pose data is exposed as tools rather than pre-stuffed
context (LLM_PLATFORM_PLAN.md Part 3, "pose data as tools, not payload") so a chat capability only
pays for what the model actually asks to see.

Every handler takes `(inv: Invocation, args: dict)` and operates strictly on `inv.player_id` — none
of the four tools accept a `playerId` argument, so a model can never pivot to another athlete's
data. `run_tool` enforces this as a hard guard (belt-and-suspenders on top of the tool schemas
below simply not declaring the parameter), rejecting any call whose `args` includes `playerId`.

`inv.storage` is expected to expose `download_json(path: str) -> Any`, raising `FileNotFoundError`
for a missing blob — a thin facade over whatever Storage client `main.py`/`config.py` inject
(`Invocation.storage` is typed `Any` for exactly this reason). The concrete bucket/credentials
wiring is out of this module's scope; `tests/conftest.py`'s `FakeStorage` implements the same
facade so this module never touches real GCS.
"""

from __future__ import annotations

import re
from typing import Any, Callable

from gateway.assemblers import assemble_benchmark_context, parse_rep_doc
from gateway.catalog import search_drill_catalog as _catalog_search
from gateway.ctx import Invocation
from gateway.errors import context_unavailable, invalid_request
from gateway.workout_tools import TOOL_SPECS as WORKOUT_TOOL_SPECS, run_workout_tool
from gateway.kick_evidence import TOOL_SPECS as KICK_TOOL_SPECS, run_tool as run_kick_tool

MAX_FETCH_REP_LIMIT = 25
DEFAULT_FETCH_REP_LIMIT = 10
MAX_POSE_SAMPLES = 1500

# Known artifact `kind`s (RECORDING_PIPELINE.md's per-rep JSON artifact list, `.json` suffix
# dropped — the tool call takes the bare kind and this module appends the extension when building
# the storage path).
POSE_ARTIFACT_KINDS = (
    "pose",
    "filtered_average_2d_positions",
    "torso_midpoints",
    "key_frames",
    "joint_angles_key_frames",
    "chest_offsets",
    "velocity",
    "acceleration",
    "grf",
    "metadata",
    "COM",
    "COM_meters",
    "kalman_velocity",
    "kalman_acceleration",
    "model_velocity",
    "model_acceleration",
    "sprint_model_fit",
    "aruco_points",
)

# `repType` -> Storage drill-folder name. Only `side_kick` differs from its own repType value (the
# upload path uses the legacy `deadballShot` folder name — see RECORDING_PIPELINE.md's storage
# path table); every other drill's folder name matches its repType 1:1.
_STORAGE_DRILL_FOLDER = {"side_kick": "deadballShot"}


# ---------------------------------------------------------------------------
# Tool specs (model-facing function-calling schemas)
# ---------------------------------------------------------------------------

TOOL_SPECS: dict[str, dict] = {
    "fetch_rep_metrics": {
        "name": "fetch_rep_metrics",
        "description": (
            "Fetch typed metric fields for one rep by id, or the most recent reps for a drill. "
            "Exactly one of 'repId' or 'drill' must be given."
        ),
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "repId": {"type": "string", "description": "Fetch a single rep by its Firestore document id."},
                "drill": {"type": "string", "description": "Fetch recent reps for this drill's repType (e.g. 'sprint', 'jump')."},
                "limit": {
                    "type": "integer",
                    "description": f"Max reps to return when using 'drill' (default {DEFAULT_FETCH_REP_LIMIT}, max {MAX_FETCH_REP_LIMIT}).",
                },
            },
        },
    },
    "fetch_pose_artifact": {
        "name": "fetch_pose_artifact",
        "description": (
            "Fetch one Storage JSON artifact for a rep (pose landmarks, velocity/acceleration series, "
            "phase key frames, etc). Large per-frame series are decimated server-side before being "
            "returned — never assume every original frame is present."
        ),
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "required": ["repId", "kind"],
            "properties": {
                "repId": {"type": "string"},
                "kind": {"type": "string", "enum": list(POSE_ARTIFACT_KINDS)},
            },
        },
    },
    "fetch_benchmark": {
        "name": "fetch_benchmark",
        "description": "Fetch the D1 reference value and this athlete's score for one benchmark metric.",
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "required": ["metricId"],
            "properties": {
                "metricId": {"type": "string"},
            },
        },
    },
    "search_drill_catalog": {
        "name": "search_drill_catalog",
        "description": (
            "Search the drill catalog for a target training quality, already filtered to what's safe "
            "and age-appropriate for this athlete."
        ),
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "required": ["quality"],
            "properties": {
                "quality": {"type": "string", "description": "Target training quality, e.g. 'acceleration', 'power'."},
                "constraints": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "availableEquipment": {"type": "array", "items": {"type": "string"}},
                    },
                },
            },
        },
    },
}


TOOL_SPECS.update(WORKOUT_TOOL_SPECS)

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _public_rep_fields(rep: dict) -> dict:
    """JSON-safe projection of `parse_rep_doc`'s output for tool responses (datetime -> ISO string)."""
    created_at = rep.get("createdAt")
    return {
        "repId": rep["id"],
        "repType": rep["repType"],
        "createdAt": created_at.isoformat() if created_at is not None else None,
        "sessionNumber": rep.get("sessionNumber"),
        "repNumber": rep.get("repNumber"),
        "metrics": rep["metrics"],
    }


def _decimate_samples(samples: list) -> list:
    """Uniform-stride decimation to <= MAX_POSE_SAMPLES, always preserving the first/last frame and
    any frame explicitly flagged as a phase boundary (`{"phaseBoundary": true, ...}`), per contract
    §10's "preserving first/last and any phase-boundary frames." Frame objects that don't carry a
    `phaseBoundary` flag are still safely decimated — they just don't get special preservation.
    """
    n = len(samples)
    if n <= MAX_POSE_SAMPLES:
        return list(samples)

    must_keep = {0, n - 1}
    for i, item in enumerate(samples):
        if isinstance(item, dict) and item.get("phaseBoundary"):
            must_keep.add(i)

    remaining_budget = MAX_POSE_SAMPLES - len(must_keep)
    if remaining_budget > 0 and n > 2:
        stride = max(1, n // remaining_budget)
        idx = stride
        while idx < n - 1 and len(must_keep) < MAX_POSE_SAMPLES:
            must_keep.add(idx)
            idx += stride

    ordered = sorted(must_keep)
    if len(ordered) > MAX_POSE_SAMPLES:
        # Over budget (more phase-boundary frames than budget allowed) — keep first/last exactly,
        # uniformly thin everything in between rather than dropping from one end.
        first, last = ordered[0], ordered[-1]
        interior = ordered[1:-1]
        keep_interior_count = MAX_POSE_SAMPLES - 2
        if keep_interior_count > 0 and interior:
            step = len(interior) / keep_interior_count
            interior = [interior[min(int(i * step), len(interior) - 1)] for i in range(keep_interior_count)]
        else:
            interior = []
        ordered = [first] + interior + [last]

    return [samples[i] for i in ordered]


def _decimate_artifact(data: Any) -> Any:
    if isinstance(data, list):
        return _decimate_samples(data)
    if isinstance(data, dict):
        for key in ("frames", "samples", "landmarks", "series"):
            series = data.get(key)
            if isinstance(series, list):
                out = dict(data)
                out[key] = _decimate_samples(series)
                return out
    return data


def _download_json(inv: Invocation, path: str) -> Any:
    try:
        return inv.storage.download_json(path)
    except FileNotFoundError as e:
        raise invalid_request(f"No artifact found at storage path '{path}'") from e


# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------


def _tool_fetch_rep_metrics(inv: Invocation, args: dict) -> dict:
    rep_id = args.get("repId")
    drill = args.get("drill")
    if not rep_id and not drill:
        raise invalid_request("fetch_rep_metrics requires either 'repId' or 'drill'")

    if rep_id:
        doc = inv.player_ref().collection("reps").document(rep_id).get()
        if not getattr(doc, "exists", False):
            raise invalid_request(f"No rep '{rep_id}' found for this athlete")
        return {"reps": [_public_rep_fields(parse_rep_doc(doc))]}

    limit = args.get("limit", DEFAULT_FETCH_REP_LIMIT)
    if not isinstance(limit, int) or isinstance(limit, bool) or limit <= 0:
        raise invalid_request("'limit' must be a positive integer")
    limit = min(limit, MAX_FETCH_REP_LIMIT)

    docs = list(inv.player_ref().collection("reps").where("repType", "==", drill).stream())
    parsed = sorted((parse_rep_doc(d) for d in docs), key=lambda r: r["createdAt"], reverse=True)
    return {"reps": [_public_rep_fields(r) for r in parsed[:limit]]}


def _tool_fetch_pose_artifact(inv: Invocation, args: dict) -> dict:
    rep_id = args.get("repId")
    kind = args.get("kind")
    if not rep_id or not kind:
        raise invalid_request("fetch_pose_artifact requires 'repId' and 'kind'")

    doc = inv.player_ref().collection("reps").document(rep_id).get()
    if not getattr(doc, "exists", False):
        raise invalid_request(f"No rep '{rep_id}' found for this athlete")
    rep = parse_rep_doc(doc)

    session_number = rep.get("sessionNumber")
    rep_number = rep.get("repNumber")
    if session_number is None or rep_number is None:
        raise invalid_request(f"Rep '{rep_id}' is missing session/rep numbering; cannot resolve its artifact path")

    drill_folder = _STORAGE_DRILL_FOLDER.get(rep["repType"], rep["repType"])
    safe_kind = re.sub(r"[^A-Za-z0-9_]", "", str(kind))
    path = f"{inv.player_id}/{drill_folder}/session{session_number}/kick{rep_number}/{safe_kind}.json"

    raw = _download_json(inv, path)
    return {"repId": rep_id, "kind": kind, "artifact": _decimate_artifact(raw)}


def _tool_fetch_benchmark(inv: Invocation, args: dict) -> dict:
    metric_id = args.get("metricId")
    if not metric_id:
        raise invalid_request("fetch_benchmark requires 'metricId'")

    context = assemble_benchmark_context(inv)
    metric_data = context["metrics"].get(metric_id)
    if metric_data is None:
        raise context_unavailable(f"No recorded data for metric '{metric_id}'")

    return {
        "metricId": metric_id,
        "ageBand": context["ageBand"],
        "gender": context["gender"],
        **metric_data,
    }


def _tool_search_drill_catalog(inv: Invocation, args: dict) -> dict:
    quality = args.get("quality")
    if not quality:
        raise invalid_request("search_drill_catalog requires 'quality'")
    constraints = args.get("constraints") or {}
    results = _catalog_search(inv, quality, constraints)
    return {"quality": quality, "results": results}


_HANDLERS: dict[str, Callable[[Invocation, dict], dict]] = {
    "fetch_rep_metrics": _tool_fetch_rep_metrics,
    "fetch_pose_artifact": _tool_fetch_pose_artifact,
    "fetch_benchmark": _tool_fetch_benchmark,
    "search_drill_catalog": _tool_search_drill_catalog,
}


def run_tool(name: str, args: dict, inv: Invocation) -> dict:
    if name not in _HANDLERS and name not in WORKOUT_TOOL_SPECS and name not in KICK_TOOL_SPECS:
        raise invalid_request(f"Unknown tool '{name}'")
    if isinstance(args, dict) and "playerId" in args:
        # Defense in depth: no tool schema declares this parameter, but a model that hallucinates
        # one anyway must not be able to pivot to another athlete's data.
        raise invalid_request(f"Tool '{name}' does not accept a 'playerId' argument")
    if not isinstance(args, dict):
        raise invalid_request("Tool arguments must be an object")
    if name in WORKOUT_TOOL_SPECS:
        return run_workout_tool(name, args, inv)
    if name in KICK_TOOL_SPECS:
        return run_kick_tool(name, args, inv)
    return _HANDLERS[name](inv, args or {})


TOOL_SPECS.update(KICK_TOOL_SPECS)
