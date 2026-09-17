"""End-to-end tests for the `kick_analysis` capability: the `kickAnalysisContext` assembler's
I/O behavior, both stage validators through the real pipeline, and the finalizer's
`KickAnalysisV1` assembly + `aiAnalyses/{repId}` persistence.

`gateway/kick_metrics.py` (the deterministic math) is owned by another author and may not exist
when this suite runs — `compute_kick_analysis` is always monkeypatched with a canned result here,
both so this suite passes without that file and so the two suites stay independent when it lands.
"""

from __future__ import annotations

import copy
import datetime as dt
import re
import sys
import types as pytypes

import pytest

# Same import-time stub as test_pipeline_stages.py: `gateway.usage` imports
# `google.cloud.firestore` at module load and the package isn't installed in CI.
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


def _ensure_kick_metrics_module():
    """Returns `gateway.kick_metrics`, installing an empty stand-in module when the sibling's
    file doesn't exist yet — the assembler imports it lazily, so tests only need the module
    object to exist before `compute_kick_analysis` is monkeypatched onto it."""
    try:
        from gateway import kick_metrics

        return kick_metrics
    except ImportError:
        module = pytypes.ModuleType("gateway.kick_metrics")
        sys.modules["gateway.kick_metrics"] = module
        import gateway

        gateway.kick_metrics = module
        return module


_KICK_METRICS = _ensure_kick_metrics_module()

from gateway import pipeline  # noqa: E402
from gateway.assemblers import assemble_kick_analysis_context  # noqa: E402
from gateway.errors import GatewayError  # noqa: E402
from gateway.providers import base as providers_base  # noqa: E402
from tests.conftest import add_player, add_rep  # noqa: E402
from tests.test_pipeline_stages import FakeProvider, ledger, structured_result  # noqa: E402


# ---------------------------------------------------------------------------
# Canned data
# ---------------------------------------------------------------------------

_METRIC_ROWS = [
    {
        "id": "backswing.hip_openness", "frameKey": "backswing", "metric": "hip_openness", "side": None,
        "athlete": 0.42, "pro": 0.61, "delta": -0.19, "units": "ratio",
        "athleteMeters": None, "proMeters": None, "deltaMeters": None,
        "jointIds": [23, 24], "valid": True, "note": None,
    },
    {
        "id": "contact.knee_angle.kicking", "frameKey": "contact", "metric": "knee_angle", "side": "kicking",
        "athlete": 128.4, "pro": 141.0, "delta": -12.6, "units": "degrees",
        "athleteMeters": None, "proMeters": None, "deltaMeters": None,
        "jointIds": [24, 26, 28], "valid": True, "note": None,
    },
    {
        "id": "contact.knee_angle.support", "frameKey": "contact", "metric": "knee_angle", "side": "support",
        "athlete": 121.0, "pro": 138.0, "delta": -17.0, "units": "degrees",
        "athleteMeters": None, "proMeters": None, "deltaMeters": None,
        "jointIds": [23, 25, 27], "valid": True, "note": None,
    },
    {
        "id": "backswing.wrist_trunk_offset.lead", "frameKey": "backswing", "metric": "wrist_trunk_offset", "side": "lead",
        "athlete": 0.20, "pro": 0.44, "delta": -0.24, "units": "ratio",
        "athleteMeters": None, "proMeters": None, "deltaMeters": None,
        "jointIds": [11, 12, 23], "valid": True, "note": None,
    },
    {
        "id": "contact.arm_abduction.lead", "frameKey": "contact", "metric": "arm_abduction", "side": "lead",
        "athlete": 21.0, "pro": 48.5, "delta": -27.5, "units": "degrees",
        "athleteMeters": None, "proMeters": None, "deltaMeters": None,
        "jointIds": [12, 14, 16], "valid": True, "note": None,
    },
    {
        "id": "contact.wrist_trunk_offset.lead", "frameKey": "contact", "metric": "wrist_trunk_offset", "side": "lead",
        "athlete": 0.18, "pro": 0.41, "delta": -0.23, "units": "ratio",
        "athleteMeters": None, "proMeters": None, "deltaMeters": None,
        "jointIds": [11, 12, 23], "valid": True, "note": None,
    },
    {
        "id": "followThrough.trunk_lean", "frameKey": "followThrough", "metric": "trunk_lean", "side": None,
        "athlete": None, "pro": None, "delta": None, "units": "degrees",
        "athleteMeters": None, "proMeters": None, "deltaMeters": None,
        "jointIds": [11, 12, 23, 24], "valid": False, "note": "insufficient pose coverage",
    },
]

CANNED_COMPUTED = {
    "keyFrames": {"backswing": 210, "contact": 262, "followThrough": 312},
    "fps": 240.0,
    "proFrameShift": 12,
    "mirrored": False,
    "scale": {"source": "pro_height", "mPerPx": None, "assumedProHeightMeters": 1.778},
    "metrics": _METRIC_ROWS,
    "orientation": {
        "kickingSide": "right", "supportSide": "left",
        "kickingSideSource": "strike_foot", "strikeFootField": "right",
        "derivedKickingSide": "right", "sideAgreement": "agree",
        "direction": "left_to_right", "directionSource": "rep_doc",
        "proKickingSide": "right", "mirrored": False, "meaning": "canned",
    },
    "bodyParts": {
        "kickingLeg": {"side": "right", "jointIds": [24, 26, 28, 30, 32]},
        "supportLeg": {"side": "left", "jointIds": [23, 25, 27, 29, 31]},
        "leadArm": {"side": "left", "jointIds": [11, 13, 15]},
        "trailArm": {"side": "right", "jointIds": [12, 14, 16]},
        "hips": {"side": None, "jointIds": [23, 24]},
        "trunk": {"side": None, "jointIds": [11, 12, 23, 24]},
    },
    "jointNames": {"23": "left hip", "24": "right hip"},
    "dataQuality": {
        "poseCoverage": {"backswing": 1.0, "contact": 1.0, "followThrough": 0.9},
        "alignment": "ball_center",
        "proLayout": "mediapipe33",
        "sideConfidence": "high",
        "mirrorConfidence": "high",
        "followThroughClamped": False,
        "notes": [],
    },
}

OBSERVATIONS = {
    "schemaVersion": 1,
    "observations": [
        {
            "id": "obs_hips_backswing", "frameKey": "backswing", "bodyRegion": "hips",
            "title": "Hips stay closed in the backswing", "severity": 3,
            "deviationDirection": "athleteLower",
            "metricIds": ["backswing.hip_openness"],
            "observation": "Hip openness is 0.42 vs the pro's 0.61.",
            "reasoning": "The sagittal hip proxy differs; it cannot establish compensatory movement.",
        },
        {
            "id": "obs_knee_contact", "frameKey": "contact", "bodyRegion": "kickingLeg",
            "title": "Kicking knee is under-loaded at contact", "severity": 4,
            "deviationDirection": "athleteLower",
            "metricIds": ["contact.knee_angle.kicking"],
            "observation": "Knee angle is 128.4 deg vs the pro's 141.0.",
            "reasoning": "The measured knee angle differs at contact; energy transfer was not measured.",
        },
        {
            "id": "obs_arms_contact", "frameKey": "contact", "bodyRegion": "arms",
            "title": "Arms tucked at contact", "severity": 2,
            "deviationDirection": "athleteLower",
            "metricIds": ["contact.arm_abduction.lead", "contact.wrist_trunk_offset.lead"],
            "observation": "Lead arm abduction is 21.0 deg vs the pro's 48.5.",
            "reasoning": "The lead arm is closer to the torso; the snapshot does not establish instability.",
        },
    ],
}

FOCUS = {
    "schemaVersion": 1,
    "focusAreas": [
        {
            "observationId": "obs_hips_backswing", "rank": 1, "frameKey": "backswing",
            "title": "Open your hips earlier",
            "cue": "Turn your hips toward the target before your foot swings through.",
            "whyItMatters": "A comfortable movement experiment may help clarify the hip-angle difference.",
            "metricIds": ["backswing.hip_openness"],
        },
        {
            "observationId": "obs_knee_contact", "rank": 2, "frameKey": "contact",
            "title": "Drive the knee through",
            "cue": "Drive your knee through the ball as your foot arrives.",
            "whyItMatters": "Another clip may help compare the kicking-knee position at contact.",
            "metricIds": ["contact.knee_angle.kicking"],
        },
        {
            "observationId": "obs_arms_contact", "rank": 3, "frameKey": "contact",
            "title": "Free your arms",
            "cue": "Let both arms swing wide to balance your body.",
            "whyItMatters": "Exploring a comfortable arm position may help compare movement across clips.",
            "metricIds": ["contact.arm_abduction.lead", "contact.wrist_trunk_offset.lead"],
        },
    ],
}

_LONG_CUE = (
    "Keep your arms out wide away from your body so that you can stay balanced "
    "all the way through the entire kicking motion today"
)


def _focus_subset(*indices: int) -> dict:
    """FOCUS restricted to the given card indices, reranked 1..n — the response a model
    would give once salvage has dropped the observations the other cards referenced."""
    cards = [copy.deepcopy(FOCUS["focusAreas"][i]) for i in indices]
    for rank, card in enumerate(cards, start=1):
        card["rank"] = rank
    return {"schemaVersion": 1, "focusAreas": cards}

PLAYER_ID = "player1"
REP_ID = "rep1"
_ARTIFACT_BASE = f"{PLAYER_ID}/deadballShot/session4/kick2"
_PRO_BASE = "ProfessionalOverlay/SideView/Nolan/rightFoot"


def _seed_kick_rep(db, storage, *, include_pose: bool = True, include_pro: bool = True):
    add_player(db, PLAYER_ID, {"firstName": "A", "height": 175.0, "authenticationUID": "uid1"})
    add_rep(db, PLAYER_ID, REP_ID, {
        "repType": "side_kick",
        "drillType": "deadballShot",
        "sessionNumber": 4,
        "repNumber": 2,
        "velocity": 22.5,
        "launch_angle": 14.2,
        "strike_foot": "right",
        "direction": "left_to_right",
        "storagePath": f"{_ARTIFACT_BASE}/side_kick_240.mov",
        "createdAt": dt.datetime(2026, 8, 1, tzinfo=dt.timezone.utc),
    })

    if include_pose:
        storage.put(f"{_ARTIFACT_BASE}/pose.json", [[[0.5, 0.5, 0.0, 0.99]] * 33] * 4)
    # Trajectory carries a *different* contact frame than ball_information so the
    # precedence (ball_information wins — the Contact chip's rule) is observable.
    storage.put(f"{_ARTIFACT_BASE}/ball_trajectory.json", {
        "t_values": [258, 259, 260], "x_values": [0.5, 0.52, 0.54], "y_values": [0.5, 0.49, 0.48],
        "contact_frame": 260, "transition_frame": 210, "direction": "left_to_right",
    })
    storage.put(f"{_ARTIFACT_BASE}/orig_ball.json", [0.45, 0.62, 0.51, 0.70])
    storage.put(f"{_ARTIFACT_BASE}/ball_information.json", {
        "ball_speed_ms": 22.5, "ball_speed_mph": 50.3, "launch_angle": 14.2, "contact_frame": 262,
    })
    storage.put(f"{_ARTIFACT_BASE}/metadata.json", {"frameWidth": 1080, "frameHeight": 1920})

    if include_pro:
        storage.put(f"{_PRO_BASE}/pose.json", [[[0.5, 0.5, 0.0, 0.99]] * 33] * 4)
        storage.put(f"{_PRO_BASE}/ball_trajectory.json", {"contact_frame": 250, "transition_frame": 200})
        storage.put(f"{_PRO_BASE}/orig_ball.json", [0.40, 0.60, 0.46, 0.68])


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def kick_compute(monkeypatch):
    """Stubs `compute_kick_analysis` with the canned result, recording each call's kwargs."""
    calls: list[dict] = []

    def _compute(*args, **kwargs):
        calls.append({"args": args, "kwargs": kwargs})
        return copy.deepcopy(CANNED_COMPUTED)

    monkeypatch.setattr(_KICK_METRICS, "compute_kick_analysis", _compute, raising=False)
    return calls


@pytest.fixture
def provider(monkeypatch):
    def _install(script: list) -> FakeProvider:
        fake = FakeProvider(script)
        monkeypatch.setattr(providers_base, "get_provider", lambda name: fake)
        return fake

    return _install


@pytest.fixture
def kick_invocation(make_invocation):
    def _make(params: dict | None = None):
        inv = make_invocation(
            capability="kick_analysis",
            player_id=PLAYER_ID,
            params={"repId": REP_ID} if params is None else params,
        )
        inv.job_id = "job1"
        return inv

    return _make


# ---------------------------------------------------------------------------
# Assembler
# ---------------------------------------------------------------------------


def test_assembler_passes_rep_derived_kwargs_to_compute(db, storage, kick_compute, kick_invocation):
    _seed_kick_rep(db, storage)

    context = assemble_kick_analysis_context(kick_invocation())

    assert len(kick_compute) == 1
    kwargs = kick_compute[0]["kwargs"]
    assert kwargs["contact_frame"] == 262  # ball_information wins over the trajectory's 260
    assert kwargs["transition_frame"] == 210
    assert kwargs["fps"] == 240.0  # parsed from the storagePath filename
    assert kwargs["strike_foot"] == "right"
    assert kwargs["direction"] == "left_to_right"
    assert kwargs["athlete_height_meters"] == pytest.approx(1.75)  # 175 cm player doc

    assert context["repId"] == REP_ID
    assert context["drillType"] == "deadballShot"
    assert context["repMetrics"] == {"velocityMS": 22.5, "launchAngle": 14.2, "strikeFoot": "right"}
    assert context["metrics"] == _METRIC_ROWS
    assert context["keyFrames"] == CANNED_COMPUTED["keyFrames"]


def test_key_frames_fall_back_to_the_rep_doc(db, storage, kick_compute, kick_invocation):
    """Older reps carry contact/transition only on the Firestore rep doc — their
    ball_trajectory.json predates the transition_frame key and there is no
    ball_information.json. Caught live by the first B5 E2E run (session23/kick5)."""
    _seed_kick_rep(db, storage)
    storage.put(f"{_ARTIFACT_BASE}/ball_trajectory.json", {
        "t_values": [258, 259, 260], "x_values": [0.5, 0.52, 0.54], "y_values": [0.5, 0.49, 0.48],
        "contact_frame": 415, "direction": "left_to_right",
    })
    storage.put(f"{_ARTIFACT_BASE}/ball_information.json", None)  # not a dict -> ignored
    add_rep(db, PLAYER_ID, REP_ID, {
        "repType": "side_kick",
        "sessionNumber": 4,
        "repNumber": 2,
        "strike_foot": "right",
        "direction": "left_to_right",
        "storagePath": f"{_ARTIFACT_BASE}/side_kick_240.mov",
        "contact_frame": 415,
        "transition_frame": 398,
        "createdAt": dt.datetime(2026, 8, 1, tzinfo=dt.timezone.utc),
    })

    assemble_kick_analysis_context(kick_invocation())

    kwargs = kick_compute[0]["kwargs"]
    assert kwargs["contact_frame"] == 415
    assert kwargs["transition_frame"] == 398  # from the rep doc, not the artifact


def test_missing_rep_doc_is_invalid_request(db, storage, kick_compute, make_invocation):
    add_player(db, PLAYER_ID, {"firstName": "A"})
    inv = make_invocation(capability="kick_analysis", player_id=PLAYER_ID, params={"repId": "ghost"})

    with pytest.raises(GatewayError) as exc:
        assemble_kick_analysis_context(inv)

    assert exc.value.code == "invalid_request"
    assert "ghost" in exc.value.message


def test_missing_pro_asset_is_internal(db, storage, kick_compute, kick_invocation):
    _seed_kick_rep(db, storage, include_pro=False)

    with pytest.raises(GatewayError) as exc:
        assemble_kick_analysis_context(kick_invocation())

    assert exc.value.code == "internal"


# ---------------------------------------------------------------------------
# Full pipeline — happy path
# ---------------------------------------------------------------------------


def test_pipeline_builds_kick_analysis_v2(db, storage, kick_compute, provider, kick_invocation):
    _seed_kick_rep(db, storage)
    provider([structured_result(OBSERVATIONS), structured_result(FOCUS)])

    result, usage = pipeline.run_job_capability(kick_invocation())

    assert result["schemaVersion"] == 2
    assert result["capability"] == "kick_analysis"
    assert result["repId"] == REP_ID
    assert result["playerId"] == PLAYER_ID
    assert result["jobId"] == "job1"
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", result["generatedAt"])

    # The deterministic table and its companions come from the assembler, not the model.
    assert result["keyFrames"] == CANNED_COMPUTED["keyFrames"]
    assert result["fps"] == 240.0
    assert result["mirrored"] is False
    assert result["scale"] == CANNED_COMPUTED["scale"]
    assert result["metrics"] == _METRIC_ROWS
    assert result["dataQuality"] == {**CANNED_COMPUTED["dataQuality"], "fpsSource": "filename", "proFpsSource": "unavailable"}

    # Stage 1 output rides through unchanged (including reasoning — the longitudinal record).
    assert result["observations"] == OBSERVATIONS["observations"]

    # v2 passthroughs from the assembler.
    assert result["orientation"] == CANNED_COMPUTED["orientation"]
    assert result["bodyParts"] == CANNED_COMPUTED["bodyParts"]
    assert result["jointNames"] == CANNED_COMPUTED["jointNames"]

    # Stage 2 output is augmented per item: bodyRegion copied from its observation,
    # jointIds derived from the bodyRegion through the body-part dictionary (v2), and a
    # deterministic evidence readout from the first cited valid row.
    expected_focus = [
        {**FOCUS["focusAreas"][0], "bodyRegion": "hips", "jointIds": [23, 24],
         "evidence": "hip_openness at backswing: you 0.42, pro 0.61"},
        {**FOCUS["focusAreas"][1], "bodyRegion": "kickingLeg", "jointIds": [24, 26, 28],
         "evidence": "knee_angle (kicking) at contact: you 128\u00b0, pro 141\u00b0"},
        {**FOCUS["focusAreas"][2], "bodyRegion": "arms", "jointIds": [11, 13, 15],
         "evidence": "arm_abduction (lead) at contact: you 21\u00b0, pro 48\u00b0"},
    ]
    assert result["focusAreas"] == [{**area, "evidenceIds": area["metricIds"]} for area in expected_focus]

    assert usage["outcome"] == "complete"


def test_pipeline_persists_the_analysis_to_ai_analyses(db, storage, kick_compute, provider, kick_invocation):
    _seed_kick_rep(db, storage)
    provider([structured_result(OBSERVATIONS), structured_result(FOCUS)])

    result, _usage = pipeline.run_job_capability(kick_invocation())

    doc = db.get_doc(("players", PLAYER_ID, "aiAnalyses", REP_ID))
    assert doc is not None
    assert "createdAt" in doc
    assert {k: v for k, v in doc.items() if k != "createdAt"} == result


def test_pipeline_ledgers_two_stage_tagged_usage_entries(db, storage, kick_compute, provider, kick_invocation):
    _seed_kick_rep(db, storage)
    provider([structured_result(OBSERVATIONS), structured_result(FOCUS)])

    pipeline.run_job_capability(kick_invocation())

    entries = ledger(db)
    assert [e["stage"] for e in entries] == ["observe", "focus"]
    assert all(e["capability"] == "kick_analysis" for e in entries)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def test_an_overlong_cue_triggers_exactly_one_validation_retry(db, storage, kick_compute, provider, kick_invocation, monkeypatch):
    monkeypatch.setenv("VALIDATORS_ENFORCED", "1")
    bad_focus = copy.deepcopy(FOCUS)
    bad_focus["focusAreas"][2]["cue"] = _LONG_CUE
    fake = provider([structured_result(OBSERVATIONS), structured_result(bad_focus), structured_result(FOCUS)])
    _seed_kick_rep(db, storage)

    result, _usage = pipeline.run_job_capability(kick_invocation())

    assert len(fake.calls) == 3  # observe + focus + one focus retry
    retry_message = fake.calls[2]["messages"][-1]
    assert "must be corrected" in retry_message
    assert "cue" in retry_message
    assert [a["cue"] for a in result["focusAreas"]] == [a["cue"] for a in FOCUS["focusAreas"]]

    entries = ledger(db)
    assert [e["stage"] for e in entries] == ["observe", "focus", "focus"]
    assert [e["outcome"] for e in entries] == ["complete", "validation_retry", "complete"]


def test_the_retry_replays_the_rejected_output_to_the_model(db, storage, kick_compute, provider, kick_invocation, monkeypatch):
    """Positional feedback ("focusAreas[2] duplicates focusAreas[1]") is unusable if the model
    cannot see the numbering it is being told about — its retry regenerates the array. Two live
    kick_analysis runs failed twice in a row on exactly that, 2026-08-04."""
    monkeypatch.setenv("VALIDATORS_ENFORCED", "1")
    bad_focus = copy.deepcopy(FOCUS)
    bad_focus["focusAreas"][2]["cue"] = _LONG_CUE
    fake = provider([structured_result(OBSERVATIONS), structured_result(bad_focus), structured_result(FOCUS)])
    _seed_kick_rep(db, storage)

    pipeline.run_job_capability(kick_invocation())

    retry_message = fake.calls[2]["messages"][-1]
    assert "YOUR PREVIOUS OUTPUT:" in retry_message
    assert _LONG_CUE in retry_message, "the model must see the exact text that was rejected"
    assert "VIOLATIONS:" in retry_message
    assert "fixes ONLY what the violations name" in retry_message


def test_distinct_focuses_in_the_same_body_region_are_preserved(db, storage, kick_compute, provider, kick_invocation, monkeypatch):
    monkeypatch.setenv("VALIDATORS_ENFORCED", "1")
    observations = copy.deepcopy(OBSERVATIONS)
    observations["observations"][1] = {
        "id": "obs_arms_backswing", "frameKey": "backswing", "bodyRegion": "arms",
        "title": "Arms pinned in the backswing", "severity": 3,
        "deviationDirection": "athleteLower",
        "metricIds": ["backswing.wrist_trunk_offset.lead"],
        "observation": "Lead wrist stays near the trunk midline.",
        "reasoning": "Pinned arms at backswing leave nothing to counterbalance the swing.",
    }
    redundant_focus = copy.deepcopy(FOCUS)
    redundant_focus["focusAreas"][1] = {
        "observationId": "obs_arms_backswing", "rank": 2, "frameKey": "backswing",
        "title": "Get your arms up early",
        "cue": "Lift both arms away from your sides as you approach.",
        "whyItMatters": "Early arm width sets up a balanced strike.",
        "metricIds": ["backswing.wrist_trunk_offset.lead"],
    }
    # Body-region variety is not an acceptance requirement. Distinct phase findings survive.
    provider([structured_result(observations), structured_result(redundant_focus)])
    _seed_kick_rep(db, storage)
    result, _usage = pipeline.run_job_capability(kick_invocation())
    assert [a["observationId"] for a in result["focusAreas"]] == [
        "obs_hips_backswing", "obs_arms_backswing", "obs_arms_contact"]
    assert "validation" not in result
    assert [e["outcome"] for e in ledger(db)] == ["complete", "complete"]


def test_side_incompatible_body_region_is_dropped_after_retry(db, storage, kick_compute, provider, kick_invocation, monkeypatch):
    """BUG-A guardrail: an observation labeled supportLeg citing kicking-side rows must never
    reach the athlete — this is exactly the mislabel that highlighted the strike leg under
    plant-leg text. Salvage drops it; the clean observations still ship."""
    monkeypatch.setenv("VALIDATORS_ENFORCED", "1")
    bad = copy.deepcopy(OBSERVATIONS)
    bad["observations"][1]["bodyRegion"] = "supportLeg"  # cites contact.knee_angle.kicking
    provider([structured_result(bad), structured_result(bad), structured_result(_focus_subset(0, 2))])
    _seed_kick_rep(db, storage)

    result, _usage = pipeline.run_job_capability(kick_invocation())

    assert [o["id"] for o in result["observations"]] == ["obs_hips_backswing", "obs_arms_contact"]
    (dropped,) = result["validation"]["salvagedStages"]["observe"]
    assert "whose side is" in dropped


def test_deviation_direction_contradiction_is_dropped_after_retry(db, storage, kick_compute, provider, kick_invocation, monkeypatch):
    """BUG-B guardrail: declaring athleteHigher when every cited delta is negative is exactly
    the inverted-direction reading that produced backwards cues in prod. The contradicting
    observation is dropped; the rest ship."""
    monkeypatch.setenv("VALIDATORS_ENFORCED", "1")
    bad = copy.deepcopy(OBSERVATIONS)
    bad["observations"][0]["deviationDirection"] = "athleteHigher"  # hip_openness delta -0.19
    provider([structured_result(bad), structured_result(bad), structured_result(_focus_subset(1, 2))])
    _seed_kick_rep(db, storage)

    result, _usage = pipeline.run_job_capability(kick_invocation())

    assert [o["id"] for o in result["observations"]] == ["obs_knee_contact", "obs_arms_contact"]
    (dropped,) = result["validation"]["salvagedStages"]["observe"]
    assert "deviationDirection" in dropped


def test_left_right_wording_is_rejected_then_corrected(db, storage, kick_compute, provider, kick_invocation, monkeypatch):
    monkeypatch.setenv("VALIDATORS_ENFORCED", "1")
    bad_focus = copy.deepcopy(FOCUS)
    bad_focus["focusAreas"][2]["cue"] = "Swing your left arm wide to stay balanced through it."
    fake = provider([structured_result(OBSERVATIONS), structured_result(bad_focus), structured_result(FOCUS)])
    _seed_kick_rep(db, storage)

    result, _usage = pipeline.run_job_capability(kick_invocation())

    assert len(fake.calls) == 3
    assert "functionally" in fake.calls[2]["messages"][-1]
    assert [a["cue"] for a in result["focusAreas"]] == [a["cue"] for a in FOCUS["focusAreas"]]


def test_kick_analysis_enforces_validators_without_the_service_wide_flag(db, storage, kick_compute, provider, kick_invocation, monkeypatch):
    """v1 shipped direction-inverted cues to real athletes because violations were logged and
    the output persisted anyway. kick_analysis therefore opts into strict validation itself,
    independent of VALIDATORS_ENFORCED (which stays off for capabilities still being tuned).
    With EVERY observation violating, salvage has nothing to certify — the job still fails
    closed rather than shipping an empty analysis."""
    monkeypatch.delenv("VALIDATORS_ENFORCED", raising=False)
    bad = copy.deepcopy(OBSERVATIONS)
    for obs in bad["observations"]:
        obs["observation"] += " Keep the left side quiet."  # side words: every item violates
    provider([structured_result(bad), structured_result(bad)])
    _seed_kick_rep(db, storage)

    with pytest.raises(GatewayError) as exc:
        pipeline.run_job_capability(kick_invocation())

    assert exc.value.code == "validation_failed"
    # And nothing un-validated reached the durable record.
    assert db.get_doc(("players", PLAYER_ID, "aiAnalyses", REP_ID)) is None


def test_observation_citing_only_another_frames_metrics_is_dropped(db, storage, kick_compute, provider, kick_invocation, monkeypatch):
    """Observed live 2026-08-04: a BACKSWING card asserting plant-foot-to-ball placement, which
    is a contact-frame quantity. The walkthrough pauses on the card's frame, so its evidence has
    to exist there — an item that can't meet that is dropped, not shown."""
    monkeypatch.setenv("VALIDATORS_ENFORCED", "1")
    bad = copy.deepcopy(OBSERVATIONS)
    bad["observations"][0]["frameKey"] = "backswing"
    bad["observations"][0]["metricIds"] = ["contact.knee_angle.kicking"]
    bad["observations"][0]["bodyRegion"] = "kickingLeg"
    provider([structured_result(bad), structured_result(bad), structured_result(_focus_subset(1, 2))])
    _seed_kick_rep(db, storage)

    result, _usage = pipeline.run_job_capability(kick_invocation())

    assert [o["id"] for o in result["observations"]] == ["obs_knee_contact", "obs_arms_contact"]
    (dropped,) = result["validation"]["salvagedStages"]["observe"]
    assert "different frame" in dropped


def test_cross_frame_citation_is_allowed_alongside_own_frame_evidence(db, storage, kick_compute, provider, kick_invocation, monkeypatch):
    """The causal-chain reasoning the observe prompt asks for must still be legal: cite another
    frame freely, as long as the card is also grounded at its own frame."""
    monkeypatch.setenv("VALIDATORS_ENFORCED", "1")
    ok = copy.deepcopy(OBSERVATIONS)
    ok["observations"][1]["metricIds"] = ["contact.knee_angle.kicking", "backswing.hip_openness"]
    provider([structured_result(ok), structured_result(FOCUS)])
    _seed_kick_rep(db, storage)

    result, _usage = pipeline.run_job_capability(kick_invocation())
    assert result["observations"][1]["metricIds"] == ["contact.knee_angle.kicking", "backswing.hip_openness"]


def test_straighten_the_plant_leg_anti_cue_card_is_dropped(db, storage, kick_compute, provider, kick_invocation, monkeypatch):
    """The support knee is ~42 deg flexed at contact — 'keep that leg straighter' is excluded
    coaching, and it shipped in a real walkthrough card. Its card is dropped; the others ship."""
    monkeypatch.setenv("VALIDATORS_ENFORCED", "1")
    observations = copy.deepcopy(OBSERVATIONS)
    observations["observations"][1]["bodyRegion"] = "supportLeg"
    observations["observations"][1]["metricIds"] = ["contact.knee_angle.support"]
    bad_focus = copy.deepcopy(FOCUS)
    bad_focus["focusAreas"][1]["cue"] = "Keep that plant leg straighter and stronger through contact."
    bad_focus["focusAreas"][1]["metricIds"] = ["contact.knee_angle.support"]
    provider([structured_result(observations), structured_result(bad_focus), structured_result(bad_focus)])
    _seed_kick_rep(db, storage)

    result, _usage = pipeline.run_job_capability(kick_invocation())

    assert [a["observationId"] for a in result["focusAreas"]] == ["obs_hips_backswing", "obs_arms_contact"]
    (dropped,) = result["validation"]["salvagedStages"]["focus"]
    assert "straighten or lock the plant leg" in dropped


@pytest.mark.parametrize("phrasing", [
    "The kicking leg fails to fully extend into the ball.",
    "The kicking leg never reaches full extension at the strike.",
    "The kicking knee should extend fully through contact.",
])
def test_knee_extension_at_contact_anti_cue_variants_are_dropped(phrasing, db, storage, kick_compute, provider, kick_invocation, monkeypatch):
    """Live 2026-08-04: the deployed model wrote "fails to fully extend into the ball" as an
    observation on the kicking leg at contact. The knee is 40-60 deg flexed there — full
    extension belongs to follow-through — so every inflection of the claim must be caught, not
    just the phrasings that happened to be listed first. The item is dropped; the rest ship."""
    monkeypatch.delenv("VALIDATORS_ENFORCED", raising=False)
    bad = copy.deepcopy(OBSERVATIONS)
    bad["observations"][1]["observation"] = phrasing  # kickingLeg @ contact
    provider([structured_result(bad), structured_result(bad), structured_result(_focus_subset(0, 2))])
    _seed_kick_rep(db, storage)

    result, _usage = pipeline.run_job_capability(kick_invocation())

    assert [o["id"] for o in result["observations"]] == ["obs_hips_backswing", "obs_arms_contact"]
    (dropped,) = result["validation"]["salvagedStages"]["observe"]
    assert "kicking knee should be straight at contact" in dropped


def test_two_instruction_cue_is_rejected(db, storage, kick_compute, provider, kick_invocation, monkeypatch):
    """The shipped card welded two fixes into one cue. Word count alone passed it (16 words)."""
    monkeypatch.setenv("VALIDATORS_ENFORCED", "1")
    bad_focus = copy.deepcopy(FOCUS)
    bad_focus["focusAreas"][0]["cue"] = "Plant your foot beside the ball. Keep the swing long."
    fake = provider([structured_result(OBSERVATIONS), structured_result(bad_focus), structured_result(FOCUS)])
    _seed_kick_rep(db, storage)

    result, _usage = pipeline.run_job_capability(kick_invocation())

    assert len(fake.calls) == 3
    assert "more than one sentence" in fake.calls[2]["messages"][-1]
    assert [a["cue"] for a in result["focusAreas"]] == [a["cue"] for a in FOCUS["focusAreas"]]


def test_evidence_line_prefers_a_row_from_the_cards_own_frame(db, storage, kick_compute, provider, kick_invocation):
    """A backswing card must not quote a contact number underneath the paused backswing frame."""
    observations = copy.deepcopy(OBSERVATIONS)
    observations["observations"][0]["metricIds"] = ["contact.knee_angle.kicking", "backswing.hip_openness"]
    focus = copy.deepcopy(FOCUS)
    focus["focusAreas"][0]["metricIds"] = ["contact.knee_angle.kicking", "backswing.hip_openness"]
    provider([structured_result(observations), structured_result(focus)])
    _seed_kick_rep(db, storage)

    result, _usage = pipeline.run_job_capability(kick_invocation())

    backswing_area = next(a for a in result["focusAreas"] if a["frameKey"] == "backswing")
    assert backswing_area["evidence"] == "hip_openness at backswing: you 0.42, pro 0.61"


# ---------------------------------------------------------------------------
# Failure modes
# ---------------------------------------------------------------------------


def test_missing_pose_json_is_context_unavailable(db, storage, kick_compute, provider, kick_invocation):
    _seed_kick_rep(db, storage, include_pose=False)
    provider([])

    with pytest.raises(GatewayError) as exc:
        pipeline.run_job_capability(kick_invocation())

    assert exc.value.code == "context_unavailable"
    assert "no pose data" in exc.value.message


def test_missing_rep_id_param_is_invalid_request(db, storage, kick_compute, provider, kick_invocation):
    _seed_kick_rep(db, storage)
    provider([])

    with pytest.raises(GatewayError) as exc:
        pipeline.run_job_capability(kick_invocation(params={}))

    assert exc.value.code == "invalid_request"
    assert "repId" in exc.value.message
