"""Context assemblers — small, deterministic, individually testable functions that turn
Firestore documents into the dicts a prompt is built from (LLM_PLATFORM_PLAN.md Part 3).

Every assembler takes exactly one `Invocation` and returns a plain JSON-serializable dict, or
raises a `GatewayError` (usually `context_unavailable`) when the athlete genuinely has nothing to
reason over. Assemblers never make network/model calls and never write to Firestore — they are
pure reads, which is what makes them unit-testable against a fake Firestore with no model in the
loop (see conftest.py's FakeFirestore).

This module also owns the one piece of shared "domain knowledge" other gateway modules need:
`BENCHMARK_METRICS`, a Python mirror of `KickAI/Stats/AthleteBenchmarks.swift`'s `BenchmarkMetric`
enum, comparison math, and age/gender scaling. It lives here (rather than a separate module)
because `benchmarkContext` is its primary consumer; `validators.py`, `tools.py`, and `catalog.py`
import it from here rather than re-declaring it, so there is exactly one place the metric ids and
reference anchors can drift from the Swift source of truth.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from enum import Enum
from typing import Any, Optional

from gateway.ctx import Invocation
from gateway.errors import GatewayError, context_unavailable, invalid_request

# ---------------------------------------------------------------------------
# Benchmark metric registry — mirrors AthleteBenchmarks.swift exactly.
# ---------------------------------------------------------------------------


class ComparisonKind(str, Enum):
    HIGHER_IS_BETTER = "higherIsBetter"
    LOWER_IS_BETTER = "lowerIsBetter"
    TARGET_BAND = "targetBand"


@dataclass(frozen=True)
class MetricDef:
    metric_id: str
    axis: str
    drill: str
    comparison: ComparisonKind
    # higherIsBetter / lowerIsBetter only.
    senior_male_reference: Optional[float] = None
    # targetBand only.
    ideal: Optional[float] = None
    tolerance: Optional[float] = None
    falloff: Optional[float] = None


# Raw values, axis, drill, comparison, and senior-male reference anchors copied verbatim from
# `BenchmarkMetric.comparison` in AthleteBenchmarks.swift (canonical SI units — do not convert).
BENCHMARK_METRICS: dict[str, MetricDef] = {
    "sprintMaxSpeed": MetricDef("sprintMaxSpeed", "speed", "sprint", ComparisonKind.HIGHER_IS_BETTER, senior_male_reference=8.9),
    "sprintAvgSpeed": MetricDef("sprintAvgSpeed", "speed", "sprint", ComparisonKind.HIGHER_IS_BETTER, senior_male_reference=6.5),
    "sprintMaxAcceleration": MetricDef("sprintMaxAcceleration", "speed", "sprint", ComparisonKind.HIGHER_IS_BETTER, senior_male_reference=6.5),
    "sprintTimeToMaxSpeed": MetricDef("sprintTimeToMaxSpeed", "speed", "sprint", ComparisonKind.LOWER_IS_BETTER, senior_male_reference=3.2),
    "verticalJumpHeight": MetricDef("verticalJumpHeight", "power", "jump", ComparisonKind.HIGHER_IS_BETTER, senior_male_reference=0.66),
    "broadJumpDistance": MetricDef("broadJumpDistance", "power", "broadJump", ComparisonKind.HIGHER_IS_BETTER, senior_male_reference=2.60),
    "ballSpeed": MetricDef("ballSpeed", "striking", "kick", ComparisonKind.HIGHER_IS_BETTER, senior_male_reference=31.0),
    "launchAngle": MetricDef("launchAngle", "striking", "kick", ComparisonKind.TARGET_BAND, ideal=14, tolerance=5, falloff=20),
    "codTotalTime": MetricDef("codTotalTime", "agility", "changeOfDirection", ComparisonKind.LOWER_IS_BETTER, senior_male_reference=4.6),
    "codTurnTime": MetricDef("codTurnTime", "agility", "changeOfDirection", ComparisonKind.LOWER_IS_BETTER, senior_male_reference=1.45),
    "dribbleTotalTime": MetricDef("dribbleTotalTime", "ballControl", "dribbling", ComparisonKind.LOWER_IS_BETTER, senior_male_reference=9.0),
    "dribbleBallControl": MetricDef("dribbleBallControl", "ballControl", "dribbling", ComparisonKind.LOWER_IS_BETTER, senior_male_reference=0.90),
}

# BenchmarkAgeBand.developmentScale.
DEVELOPMENT_SCALE: dict[str, float] = {"u12": 0.72, "u14": 0.82, "u16": 0.91, "u18": 0.97, "senior": 1.0}
# BenchmarkGender.referenceScale.
GENDER_REFERENCE_SCALE: dict[str, float] = {"male": 1.0, "female": 0.88, "unspecified": 0.94}

# Maps a BenchmarkMetric id to where its raw canonical value lives on a parsed rep: the Firestore
# `repType` that carries it, and the canonical field name produced by `parse_rep_doc` below.
#
# `codTurnTime` is a best-effort mapping: CodProcessingService's three shuttle phases aren't
# labeled "turn" anywhere the gateway can read (only the Swift dashboard's static display string
# "Turn Phase" implies it), so `phase2Seconds` (the middle phase) is used as the closest analog to
# "time spent decelerating and turning." Flagged in the implementation report as an assumption to
# confirm against CodProcessingService's actual phase semantics.
_METRIC_SOURCE: dict[str, tuple[str, str]] = {
    "sprintMaxSpeed": ("sprint", "maxVelocityMS"),
    "sprintAvgSpeed": ("sprint", "avgVelocityMS"),
    "sprintMaxAcceleration": ("sprint", "maxAccelerationMS2"),
    "sprintTimeToMaxSpeed": ("sprint", "timeToMaxVelocitySeconds"),
    "verticalJumpHeight": ("jump", "jumpHeightMeters"),
    "broadJumpDistance": ("broadJump", "broadJumpDistanceMeters"),
    "ballSpeed": ("side_kick", "ballVelocityMS"),
    "launchAngle": ("side_kick", "launchAngleDegrees"),
    "codTotalTime": ("changeOfDirection", "totalTimeSeconds"),
    "codTurnTime": ("changeOfDirection", "phase2Seconds"),
    "dribbleTotalTime": ("dribbling", "totalTimeSeconds"),
    "dribbleBallControl": ("dribbling", "avgBallDistanceMeters"),
}


def band_for_score(score: float) -> str:
    """Mirrors `BenchmarkBand.band(forScore:)` exactly: elite >=100, approaching [85,100),
    developing [65,85), else earlyStage."""
    if score >= 100:
        return "elite"
    if score >= 85:
        return "approaching"
    if score >= 65:
        return "developing"
    return "earlyStage"


def _reference_value(metric_def: MetricDef, age_band: str, gender: str) -> Optional[float]:
    """Mirrors `AthleteBenchmarks.reference(for:profile:)`."""
    scale = DEVELOPMENT_SCALE[age_band] * GENDER_REFERENCE_SCALE[gender]
    if metric_def.comparison is ComparisonKind.HIGHER_IS_BETTER:
        return metric_def.senior_male_reference * scale
    if metric_def.comparison is ComparisonKind.LOWER_IS_BETTER:
        # A weaker athlete is allowed a *longer* time, so divide (matches the Swift comment).
        return metric_def.senior_male_reference / scale
    return None  # targetBand has no single reference.


def score_and_reference(
    metric_def: MetricDef, value: float, age_band: str, gender: str, measured_reference: Optional[float] = None
) -> tuple[Optional[float], Optional[float]]:
    """Mirrors `AthleteBenchmarks.score(for:canonicalValue:profile:)`.

    `measured_reference`, when given, overrides the hardcoded senior-male anchor (used when the W3
    benchmark store has a published value for this metric/ageBand/gender) — but has no effect on
    `targetBand` metrics, which are never age/gender scaled (a good launch angle is a good launch
    angle, per the Swift comment on `BenchmarkComparison.targetBand`).

    Returns `(score, referenceValueUsed)`; either may be None when the value can't be scored.
    """
    if value is None or not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        return None, None

    if metric_def.comparison is ComparisonKind.TARGET_BAND:
        ideal, tolerance, falloff = metric_def.ideal, metric_def.tolerance, metric_def.falloff
        if not falloff or falloff <= 0:
            return None, ideal
        deviation = max(0.0, abs(value - ideal) - tolerance)
        return 100.0 * max(0.0, 1.0 - deviation / falloff), ideal

    reference = measured_reference if measured_reference is not None else _reference_value(metric_def, age_band, gender)
    if reference is None or reference <= 0 or value <= 0:
        return None, reference

    if metric_def.comparison is ComparisonKind.HIGHER_IS_BETTER:
        return 100.0 * value / reference, reference
    return 100.0 * reference / value, reference


# ---------------------------------------------------------------------------
# Player profile resolution
# ---------------------------------------------------------------------------


def _coerce_datetime(value: Any) -> Optional[datetime]:
    """Firestore Timestamp fields already deserialize to `datetime.datetime` via the standard
    google-cloud-firestore client, so this mostly just normalizes tz-naive values to UTC."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)
    return None


def resolve_player_age(player_data: dict, *, now: Optional[datetime] = None) -> Optional[int]:
    """`age` (int or double) wins when present; otherwise derives from `birthDate`/`dateOfBirth`.

    Player documents do not currently store either field in production (AddPlayerView only
    collects height/weight/sport — see AthleteBenchmarkProfile's doc comment in
    AthleteBenchmarks.swift), so this resolves to None almost everywhere today. It is written
    forward-compatibly for when W3 adds them, per the assembler spec.
    """
    now = now or datetime.now(timezone.utc)
    raw_age = player_data.get("age")
    if isinstance(raw_age, (int, float)) and not isinstance(raw_age, bool) and raw_age > 0:
        return int(raw_age)
    for key in ("birthDate", "dateOfBirth"):
        born = _coerce_datetime(player_data.get(key))
        if born is not None:
            had_birthday = (now.month, now.day) >= (born.month, born.day)
            return now.year - born.year - (0 if had_birthday else 1)
    return None


def age_band_for_age(age: Optional[int]) -> str:
    """Mirrors `AthleteStatsViewModel.ageBand(forAge:)`. Unknown age defaults to `senior`, matching
    `AthleteBenchmarkProfile.unknown` (the least personalized, most conservative *scoring*
    standard — not to be confused with `catalog.py`'s deliberately opposite default for *safety
    filtering*, where unknown age must fall the other way)."""
    if age is None:
        return "senior"
    if age < 13:
        return "u12"
    if age <= 14:
        return "u14"
    if age <= 16:
        return "u16"
    if age <= 18:
        return "u18"
    return "senior"


def resolve_gender(player_data: dict) -> str:
    """Gender from a leading 'm'/'f' (case-insensitive), else `unspecified`."""
    raw = player_data.get("gender")
    if isinstance(raw, str) and raw.strip():
        lead = raw.strip()[0].lower()
        if lead == "m":
            return "male"
        if lead == "f":
            return "female"
    return "unspecified"


def assemble_player_profile(inv: Invocation) -> dict:
    """`players/{id}` -> age band, gender, position, height/weight, stated goals.

    Deliberately excludes anything beyond what a report needs to stay parent-readable and
    non-PII: no email, no phone, no raw birth date (only the derived age band).
    """
    snap = inv.player_ref().get()
    data = snap.to_dict() if getattr(snap, "exists", False) else None
    if not data:
        raise context_unavailable(f"No player profile found for '{inv.player_id}'")

    age = resolve_player_age(data)
    return {
        "ageBand": age_band_for_age(age),
        "gender": resolve_gender(data),
        "position": data.get("position"),
        "heightCm": data.get("height") if isinstance(data.get("height"), (int, float)) else None,
        "weightKg": data.get("weight") if isinstance(data.get("weight"), (int, float)) else None,
        "goals": data.get("goals") or data.get("statedGoals"),
    }


# ---------------------------------------------------------------------------
# Rep parsing (shared by recentReps, benchmarkContext, sessionDetail, and tools.py)
# ---------------------------------------------------------------------------

# Canonical field name -> Firestore field aliases, in the same precedence order as
# `DrillDashboardRepository.parseRepDocument` in the iOS app.
_NUMERIC_FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "jumpHeightMeters": ("jumpHeight",),
    "broadJumpDistanceMeters": ("broadJumpDistance",),
    "maxVelocityMS": ("max_velocity", "maxVelocity"),
    "ballVelocityMS": ("velocity",),
    "launchAngleDegrees": ("launch_angle", "launchAngle"),
    "avgVelocityMS": ("average_velocity", "averageVelocity"),
    "maxAccelerationMS2": ("max_acceleration", "maxAcceleration"),
    "timeToMaxVelocitySeconds": ("time_to_max_velocity", "timeToMaxVelocity"),
    "totalTimeSeconds": ("totalTime",),
    "totalDistanceMeters": ("totalDistance",),
    "phase1Seconds": ("phase1Time",),
    "phase2Seconds": ("phase2Time",),
    "phase3Seconds": ("phase3Time",),
    "avgBallDistanceMeters": ("avgBallDistance",),
}

MAX_REPS_PER_DRILL = 40

# (repType, canonical field) -> the benchmark metric that reads it, so per-metric "best" values
# can be direction-aware (a best shuttle time is the *minimum*). Derived from `_METRIC_SOURCE` at
# import; fields no benchmark metric reads (phase splits, distances) get no "best" rather than a
# guessed direction.
_FIELD_METRIC: dict[tuple[str, str], MetricDef] = {
    source: BENCHMARK_METRICS[metric_id] for metric_id, source in _METRIC_SOURCE.items()
}


def _best_value(metric_def: MetricDef, values: list[float]) -> Optional[float]:
    """The athlete's best value for one metric, honoring its comparison direction. For a
    targetBand metric (launch angle) "best" is the value closest to the ideal."""
    if not values:
        return None
    if metric_def.comparison is ComparisonKind.HIGHER_IS_BETTER:
        return max(values)
    if metric_def.comparison is ComparisonKind.LOWER_IS_BETTER:
        return min(values)
    if metric_def.ideal is None:
        return None
    return min(values, key=lambda v: abs(v - metric_def.ideal))


def _num(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _int(value: Any) -> Optional[int]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value)


def parse_rep_doc(doc: Any) -> dict:
    """Parses one `players/{id}/reps/{repId}` doc using the exact same field-name fallbacks as
    `DrillDashboardRepository.parseRepDocument` (Swift) — see that file for the field-name
    precedence this mirrors. Shared by `recentReps`, `benchmarkContext`, `sessionDetail`, and the
    `fetch_rep_metrics`/`fetch_pose_artifact` tools so there is exactly one rep-parsing path.
    """
    data = doc.to_dict() or {}
    metrics: dict[str, float] = {}
    for canonical_name, aliases in _NUMERIC_FIELD_ALIASES.items():
        for alias in aliases:
            value = _num(data.get(alias))
            if value is not None:
                metrics[canonical_name] = value
                break

    created_at = _coerce_datetime(data.get("createdAt")) or _coerce_datetime(data.get("timestamp"))
    rep_number = _int(data.get("repNumber"))
    if rep_number is None:
        rep_number = _int(data.get("kickNumber"))
    if rep_number is None:
        rep_number = _int(data.get("rep_number"))

    return {
        "id": doc.id,
        "repType": data.get("repType", ""),
        "createdAt": created_at or datetime.min.replace(tzinfo=timezone.utc),
        "sessionNumber": _int(data.get("sessionNumber")),
        "repNumber": rep_number,
        "metrics": metrics,
    }


def load_parsed_reps(inv: Invocation) -> list[dict]:
    docs = list(inv.player_ref().collection("reps").stream())
    return [parse_rep_doc(d) for d in docs]


def _trend(values: list[float]) -> str:
    """A simple, direction-agnostic trend: compares the mean of the first half of the series to
    the mean of the second half. Deliberately does not know whether higher-is-better for the
    metric (that's `BENCHMARK_METRICS`' concern) — it reports the raw numeric direction and lets
    the prompt/model apply meaning."""
    if len(values) < 2:
        return "insufficient_data"
    mid = max(1, len(values) // 2)
    first_avg = sum(values[:mid]) / len(values[:mid])
    second_avg = sum(values[mid:]) / len(values[mid:]) if values[mid:] else first_avg
    if first_avg == 0:
        if second_avg == 0:
            return "flat"
        return "increasing" if second_avg > 0 else "decreasing"
    delta = (second_avg - first_avg) / abs(first_avg)
    if delta > 0.03:
        return "increasing"
    if delta < -0.03:
        return "decreasing"
    return "flat"


def assemble_recent_reps(inv: Invocation) -> dict:
    """`players/{id}/reps` -> per-drill recent metrics + a simple trend. Capped at
    `MAX_REPS_PER_DRILL` (40) most-recent reps per drill so a long-tenured athlete's history
    doesn't blow out the prompt."""
    reps = load_parsed_reps(inv)
    if not reps:
        raise context_unavailable(f"No reps recorded for player '{inv.player_id}'")

    by_drill: dict[str, list[dict]] = {}
    for rep in reps:
        by_drill.setdefault(rep["repType"], []).append(rep)

    result: dict[str, Any] = {}
    for drill, drill_reps in by_drill.items():
        drill_reps.sort(key=lambda r: r["createdAt"], reverse=True)
        capped = drill_reps[:MAX_REPS_PER_DRILL]
        chronological = list(reversed(capped))

        metric_names: set[str] = set()
        for r in chronological:
            metric_names.update(r["metrics"].keys())

        metrics_out = {}
        for name in sorted(metric_names):
            series = [r["metrics"][name] for r in chronological if name in r["metrics"]]
            entry: dict[str, Any] = {"recentValues": series[-10:], "trend": _trend(series)}
            metric_def = _FIELD_METRIC.get((drill, name))
            if metric_def is not None:
                # All-time best, not best-of-the-capped-window — the athlete's PR
                # shouldn't age out of the prompt after 40 reps.
                all_values = [r["metrics"][name] for r in drill_reps if name in r["metrics"]]
                best = _best_value(metric_def, all_values)
                if best is not None:
                    entry["best"] = best
            metrics_out[name] = entry

        result[drill] = {"repCount": len(capped), "metrics": metrics_out}

    return result


# ---------------------------------------------------------------------------
# athleteStats — the v1 server-side-assembly exception
# ---------------------------------------------------------------------------

# Required = what AthleteStatsSnapshot.encode always emits. The client omits
# (rather than nulls) fields that don't exist for a given athlete — an unscored
# axis has no `score`, a metric with no benchmark has no `referenceCanonical`/
# `referenceFormatted`, a first rep has no `scoreDelta` — so those are
# validated only when present.
_REQUIRED_TOP = ("schemaVersion", "benchmarkProfile", "totalReps", "totalSessions", "axes", "drills")
_REQUIRED_BENCHMARK_PROFILE = ("ageBand", "gender", "isDefaulted")
_REQUIRED_AXIS = ("axis", "repCount", "missingDrills")
_REQUIRED_DRILL = ("drill", "repCount", "sessionCount", "metrics")
_REQUIRED_METRIC = (
    "metric", "score", "band", "bestCanonical", "latestCanonical",
    "bestFormatted", "unitLabel", "repCount",
)

SCORE_MIN, SCORE_MAX = 0.0, 400.0


def _require_keys(d: Any, keys: tuple[str, ...], where: str) -> None:
    if not isinstance(d, dict):
        raise invalid_request(f"{where} must be an object")
    missing = [k for k in keys if k not in d]
    if missing:
        raise invalid_request(f"{where} is missing required key(s): {', '.join(missing)}")


def _check_score(value: Any, where: str) -> None:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise invalid_request(f"{where} must be numeric, got {value!r}")
    if not (SCORE_MIN <= value <= SCORE_MAX):
        raise invalid_request(f"{where}={value} is outside the valid range [{SCORE_MIN}, {SCORE_MAX}]")


def assemble_athlete_stats(inv: Invocation) -> dict:
    """Reads `inv.params["statsProfile"]` — the client-computed `AthleteStatsProfileSnapshot`.

    This is the *v1 exception* to server-side context assembly (LLM_PLATFORM_PLAN.md Part 3,
    contract §5): scoring currently lives in Swift (`AthleteBenchmarks.score`), and porting it
    server-side before the W3 benchmark store exists would mean maintaining two copies of scoring
    math that could silently drift. Trusting a client-supplied payload is normally unacceptable in
    a server-authoritative pipeline — what makes it acceptable *here* is that every score in the
    snapshot is range-checked against [0, 400] (a generous superset of the 0-100+ "at standard"
    scale) and every required key is verified present, below. A malformed or adversarial snapshot
    is rejected outright (`invalid_request`) rather than silently reshaped or clamped, so a client
    bug fails loudly instead of quietly feeding a model bad numbers. Once the benchmark store
    lands and scoring moves server-side, this assembler — and the whole `statsProfile` param — is
    meant to go away.
    """
    profile = inv.params.get("statsProfile")
    if profile is None:
        raise context_unavailable(f"No statsProfile supplied for player '{inv.player_id}'")

    _require_keys(profile, _REQUIRED_TOP, "statsProfile")
    if "overallScore" in profile:
        _check_score(profile["overallScore"], "statsProfile.overallScore")
    _require_keys(profile["benchmarkProfile"], _REQUIRED_BENCHMARK_PROFILE, "statsProfile.benchmarkProfile")

    if not isinstance(profile["axes"], list):
        raise invalid_request("statsProfile.axes must be a list")
    for i, axis in enumerate(profile["axes"]):
        _require_keys(axis, _REQUIRED_AXIS, f"statsProfile.axes[{i}]")
        if "score" in axis:
            _check_score(axis["score"], f"statsProfile.axes[{i}].score")

    if not isinstance(profile["drills"], list):
        raise invalid_request("statsProfile.drills must be a list")
    for i, drill in enumerate(profile["drills"]):
        _require_keys(drill, _REQUIRED_DRILL, f"statsProfile.drills[{i}]")
        if "score" in drill:
            _check_score(drill["score"], f"statsProfile.drills[{i}].score")
        if not isinstance(drill["metrics"], list):
            raise invalid_request(f"statsProfile.drills[{i}].metrics must be a list")
        for j, metric in enumerate(drill["metrics"]):
            _require_keys(metric, _REQUIRED_METRIC, f"statsProfile.drills[{i}].metrics[{j}]")
            _check_score(metric["score"], f"statsProfile.drills[{i}].metrics[{j}].score")

    return profile


# ---------------------------------------------------------------------------
# benchmarkContext
# ---------------------------------------------------------------------------


def _measured_reference(inv: Invocation, metric_id: str, age_band: str, gender: str) -> Optional[float]:
    """Looks up a published reference in the `benchmarks` collection (W3's store), keyed by
    metric x ageBand x gender. Convention (not yet pinned down by any spec at time of writing):
    each doc carries `{"metric", "ageBand", "gender", "tier", "referenceValue"}`; queried by
    equality rather than a guessed doc id so the exact id scheme is W3's to decide."""
    if inv.db is None:
        return None
    try:
        query = (
            inv.db.collection("benchmarks")
            .where("metric", "==", metric_id)
            .where("ageBand", "==", age_band)
            .where("gender", "==", gender)
            .limit(1)
        )
        docs = list(query.stream())
    except Exception:
        return None
    if not docs:
        return None
    data = docs[0].to_dict() or {}
    value = data.get("referenceValue")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return None


def assemble_benchmark_context(inv: Invocation) -> dict:
    """D1 reference values + the athlete's normalized score per metric the athlete has data for.

    Implements the same math as `AthleteBenchmarks.reference`/`.score` (see `score_and_reference`
    above). Prefers a published `benchmarks` collection doc when present; falls back to the
    hardcoded senior-male anchor x developmentScale x referenceScale otherwise. The top-level
    `source` field says which was used for *any* metric ("measured" if at least one metric had a
    published reference, else "provisional") so a report can name its own provenance.
    """
    snap = inv.player_ref().get()
    player_data = snap.to_dict() if getattr(snap, "exists", False) else {}
    age = resolve_player_age(player_data)
    age_band = age_band_for_age(age)
    gender = resolve_gender(player_data)
    is_defaulted = age is None and not (isinstance(player_data.get("gender"), str) and player_data.get("gender").strip())

    reps = load_parsed_reps(inv)
    if not reps:
        raise context_unavailable(f"No reps recorded for player '{inv.player_id}'; nothing to benchmark")

    latest_by_type: dict[str, dict[str, float]] = {}
    for rep in sorted(reps, key=lambda r: r["createdAt"]):
        bucket = latest_by_type.setdefault(rep["repType"], {})
        bucket.update(rep["metrics"])

    metrics_out: dict[str, Any] = {}
    any_measured = False
    for metric_id, metric_def in BENCHMARK_METRICS.items():
        source = _METRIC_SOURCE.get(metric_id)
        if source is None:
            continue
        rep_type, field = source
        value = latest_by_type.get(rep_type, {}).get(field)
        if value is None:
            continue

        measured_ref = _measured_reference(inv, metric_id, age_band, gender)
        score, reference_value = score_and_reference(metric_def, value, age_band, gender, measured_ref)
        if score is None:
            continue

        metric_source = "measured" if measured_ref is not None else "provisional"
        any_measured = any_measured or metric_source == "measured"
        metrics_out[metric_id] = {
            "score": score,
            "band": band_for_score(score),
            "referenceCanonical": reference_value,
            "athleteCanonical": value,
            "source": metric_source,
        }

    if not metrics_out:
        raise context_unavailable(f"No benchmarkable metrics found for player '{inv.player_id}'")

    return {
        "ageBand": age_band,
        "gender": gender,
        "isDefaulted": is_defaulted,
        "source": "measured" if any_measured else "provisional",
        "metrics": metrics_out,
    }


def assemble_benchmark_context_optional(inv: Invocation) -> dict:
    """`benchmarkContext`, softened for chat: a report with nothing to benchmark should fail the
    job, but a chat athlete whose reps carry no benchmarkable metric should still get an answer —
    the model just needs to know the comparison data isn't there rather than the turn erroring
    out. Any `context_unavailable` from the strict assembler becomes `{"available": False}`."""
    try:
        context = assemble_benchmark_context(inv)
    except GatewayError as exc:
        if exc.code != "context_unavailable":
            raise
        return {"available": False, "reason": exc.message}
    context["available"] = True
    return context


# ---------------------------------------------------------------------------
# conversationHistory
# ---------------------------------------------------------------------------

CONVERSATION_HISTORY_LIMIT = 20


def assemble_conversation_history(inv: Invocation) -> dict:
    """Last N turns from `players/{id}/aiConversations/{convId}/messages`, ordered by
    `createdAt`. A missing/empty conversation is normal (a brand-new chat), not
    `context_unavailable` — it just returns no messages."""
    conv_id = inv.conversation_id
    if not conv_id:
        return {"conversationId": None, "messages": []}

    messages_ref = inv.player_ref().collection("aiConversations").document(conv_id).collection("messages")
    docs = list(messages_ref.order_by("createdAt").stream())
    trimmed = docs[-CONVERSATION_HISTORY_LIMIT:]

    messages = []
    for d in trimmed:
        data = d.to_dict() or {}
        messages.append({
            "role": data.get("role"),
            "content": data.get("content"),
            "createdAt": data.get("createdAt"),
        })
    return {"conversationId": conv_id, "messages": messages}


# ---------------------------------------------------------------------------
# sessionDetail
# ---------------------------------------------------------------------------


def assemble_session_detail(inv: Invocation) -> dict:
    """One `players/{id}/sessions/{sessionId}` doc plus the reps that belong to it, for
    `session_summary`. Reps are matched by `sessionNumber` (reps don't hold a session doc-id
    reference; they carry the numeric `sessionNumber` the session doc also carries — see
    `RecordingStateMachineView`'s "pins sessionNumber" behavior in RECORDING_PIPELINE.md), and by
    `repType` when the session doc records a type, to exclude any cross-drill numbering collision.
    """
    session_id = inv.params.get("sessionId")
    if not session_id:
        raise invalid_request("sessionDetail requires params.sessionId")

    session_ref = inv.player_ref().collection("sessions").document(session_id)
    session_snap = session_ref.get()
    session_data = session_snap.to_dict() if getattr(session_snap, "exists", False) else None
    if not session_data:
        raise context_unavailable(f"No session '{session_id}' found for player '{inv.player_id}'")

    session_number = _int(session_data.get("sessionNumber"))
    session_type = session_data.get("sessionType") or session_data.get("drillType")

    reps = load_parsed_reps(inv)
    session_reps = [
        r for r in reps
        if session_number is not None and r.get("sessionNumber") == session_number
        and (session_type is None or r["repType"] == session_type)
    ]
    session_reps.sort(key=lambda r: r["createdAt"])

    return {
        "sessionId": session_id,
        "sessionType": session_type,
        "repCount": _int(session_data.get("repCount")) or len(session_reps),
        "createdAt": session_data.get("timestamp") or session_data.get("createdAt"),
        "reps": [
            {"repId": r["id"], "repNumber": r.get("repNumber"), "metrics": r["metrics"]}
            for r in session_reps
        ],
    }


# ---------------------------------------------------------------------------
# kickAnalysisContext — the kick_analysis deterministic table
# ---------------------------------------------------------------------------

# The pro overlay asset the athlete is compared against (a right-foot kick;
# left-footed athletes are handled by mirroring inside kick_metrics). Mirrors
# `kProOverlayStoragePath` in the app. Its absence is an ops bug, never an
# athlete-data condition.
PRO_OVERLAY_BASE = "ProfessionalOverlay/SideView/Nolan/rightFoot"

# `repType` -> Storage drill-folder name — the same one-entry mapping tools.py's
# `_STORAGE_DRILL_FOLDER` uses (side_kick uploads under the legacy `deadballShot`
# folder; see RECORDING_PIPELINE.md's storage path table).
_KICK_STORAGE_DRILL_FOLDER = {"side_kick": "deadballShot"}

# Recording filenames end `..._kick_{fps}.mov` (RECORDING_PIPELINE.md filename
# rules); the fps embedded there is the capture rate the frame indices are in.
_STORAGE_FPS_PATTERN = re.compile(r"_kick_(\d+(?:\.\d+)?)\.mov$")
_DEFAULT_KICK_FPS = 240.0


def _fps_from_storage_path(storage_path: Any) -> float:
    if isinstance(storage_path, str):
        match = _STORAGE_FPS_PATTERN.search(storage_path)
        if match:
            fps = float(match.group(1))
            if fps > 0:
                return fps
    return _DEFAULT_KICK_FPS


def _kick_capture_fps(metadata: Any, storage_path: Any = None) -> tuple[float | None, str]:
    if isinstance(metadata, dict):
        for field in ("framesPerSecond", "fps", "frameRate", "captureFPS"):
            fps = _num(metadata.get(field))
            if fps is not None and fps > 0:
                return fps, f"metadata.{field}"
    if isinstance(storage_path, str):
        match = _STORAGE_FPS_PATTERN.search(storage_path)
        if match and float(match.group(1)) > 0:
            return float(match.group(1)), "filename"
    return None, "assumed"


def _download_optional_json(inv: Invocation, path: str) -> Any:
    try:
        return inv.storage.download_json(path)
    except FileNotFoundError:
        return None


def assemble_kick_analysis_context(inv: Invocation) -> dict:
    """Loads a kick rep's pose/ball artifacts plus the pro overlay asset and runs the
    deterministic athlete-vs-pro comparison (`kick_metrics.compute_kick_analysis`). Pure
    I/O + orchestration — all math lives in `gateway/kick_metrics.py`.
    """
    rep_id = inv.params.get("repId")
    if not rep_id or not isinstance(rep_id, str):
        raise invalid_request(f"'{inv.capability}' requires params.repId")

    doc = inv.player_ref().collection("reps").document(rep_id).get()
    if not getattr(doc, "exists", False):
        raise invalid_request(f"No rep '{rep_id}' found for this athlete")
    data = doc.to_dict() or {}
    rep = parse_rep_doc(doc)
    if rep["repType"] not in ("side_kick", "deadballShot"):
        raise invalid_request("Kick technique analysis requires a deadball kick rep")

    session_number = rep.get("sessionNumber")
    rep_number = rep.get("repNumber")
    if session_number is None or rep_number is None:
        raise invalid_request(f"Rep '{rep_id}' is missing session/rep numbering; cannot resolve its artifact path")

    drill_folder = _KICK_STORAGE_DRILL_FOLDER.get(rep["repType"], rep["repType"])
    base = f"{inv.player_id}/{drill_folder}/session{session_number}/kick{rep_number}"

    try:
        athlete_pose = inv.storage.download_json(f"{base}/pose.json")
        athlete_trajectory = inv.storage.download_json(f"{base}/ball_trajectory.json")
    except FileNotFoundError as exc:
        raise context_unavailable("This rep has no pose data to analyze.") from exc
    athlete_orig_ball = _download_optional_json(inv, f"{base}/orig_ball.json")
    ball_information = _download_optional_json(inv, f"{base}/ball_information.json")
    athlete_metadata = _download_optional_json(inv, f"{base}/metadata.json")

    trajectory = athlete_trajectory if isinstance(athlete_trajectory, dict) else {}
    # ball_information's contact_frame wins over the trajectory's — the same
    # precedence the viewer's Contact chip uses (KickProcessingService nulls it
    # in ball_information when results are invalid).
    contact_frame = None
    if isinstance(ball_information, dict):
        contact_frame = _int(ball_information.get("contact_frame"))
    if contact_frame is None:
        contact_frame = _int(trajectory.get("contact_frame"))
    transition_frame = _int(trajectory.get("transition_frame"))
    # Older reps persisted the key frames only on the Firestore rep doc — the
    # writer stores both fields from the same computation, so the doc is an
    # equally authoritative fallback (and the only carrier for pre-artifact
    # reps like session-era ball_trajectory.json without transition_frame).
    if contact_frame is None:
        contact_frame = _int(data.get("contact_frame"))
    if transition_frame is None:
        transition_frame = _int(data.get("transition_frame"))
    if contact_frame is None or transition_frame is None:
        raise context_unavailable("This rep is missing its contact/backswing key frames; cannot analyze.")

    # The app converts imperial input to centimeters before writing the player
    # doc's `height` (AddPlayerView) — a numeric value is cm by construction,
    # matching `assemble_player_profile`'s `heightCm` read. AddPlayerView
    # writes 0.0 for an empty form, so non-positive means unknown.
    player_snap = inv.player_ref().get()
    player_data = player_snap.to_dict() if getattr(player_snap, "exists", False) else {}
    height_cm = _num((player_data or {}).get("height"))
    athlete_height_meters = height_cm / 100.0 if height_cm is not None and height_cm > 0 else None

    try:
        pro_pose = inv.storage.download_json(f"{PRO_OVERLAY_BASE}/pose.json")
        pro_trajectory = inv.storage.download_json(f"{PRO_OVERLAY_BASE}/ball_trajectory.json")
        pro_orig_ball = inv.storage.download_json(f"{PRO_OVERLAY_BASE}/orig_ball.json")
    except (FileNotFoundError, ValueError) as exc:
        raise GatewayError("internal", f"Pro overlay asset is missing or corrupt: {exc}") from exc

    # Deferred so tests can stub the module before it's imported; kick_metrics
    # is pure math (no I/O) by design.
    from gateway import kick_metrics

    pro_metadata = _download_optional_json(inv, f"{PRO_OVERLAY_BASE}/metadata.json")
    pro_metadata = pro_metadata if isinstance(pro_metadata, dict) else {}
    capture_fps, fps_source = _kick_capture_fps(athlete_metadata, data.get("storagePath"))
    pro_fps, pro_fps_source = _kick_capture_fps(pro_metadata)

    computed = kick_metrics.compute_kick_analysis(
        athlete_pose,
        trajectory,
        athlete_orig_ball,
        athlete_metadata,
        pro_pose,
        pro_trajectory,
        pro_orig_ball,
        contact_frame=contact_frame,
        transition_frame=transition_frame,
        fps=capture_fps or _DEFAULT_KICK_FPS,
        strike_foot=data.get("strike_foot"),
        direction=data.get("direction"),
        athlete_height_meters=athlete_height_meters,
        pro_fps=pro_fps,
    )

    detail = computed.pop("_detail", {})
    computed.setdefault("dataQuality", {})["fpsSource"] = fps_source
    computed["dataQuality"]["proFpsSource"] = pro_fps_source if pro_fps is not None else "unavailable"
    from gateway.kick_evidence import attach_evidence, digest
    result = attach_evidence({
        "repId": rep_id,
        "drillType": data.get("drillType") or drill_folder,
        "repMetrics": {
            "velocityMS": rep["metrics"].get("ballVelocityMS"),
            "launchAngle": rep["metrics"].get("launchAngleDegrees"),
            "strikeFoot": data.get("strike_foot"),
        },
        **computed,
        "source": {"playerId": inv.player_id, "repId": rep_id, "artifactBase": base,
                   "frameCount": len(athlete_pose) if isinstance(athlete_pose, list) else 0,
                   "poseHash": digest(athlete_pose), "trajectoryHash": digest(trajectory),
                   "metadataHash": digest(athlete_metadata), "repDocHash": digest(data),
                   "ballInformationHash": digest(ball_information), "originalBallHash": digest(athlete_orig_ball),
                   "proAssetBase": PRO_OVERLAY_BASE,
                   "proPoseHash": digest(pro_pose), "proMetadataHash": digest(pro_metadata)},
    })
    inv._kick_rep_contexts = {rep_id: result}
    inv._kick_details = {rep_id: detail}
    return result


def assemble_kick_knowledge(inv: Invocation) -> dict:
    """The kicking-research corpus plus the deterministic fault pre-screen for THIS rep
    (KICK_ANALYSIS_V2_PLAN decisions 7-8). Runs after `kickAnalysisContext`, whose computed
    output it screens — assembler order in the registry entry is load-bearing.

    Corpus assets are baked into the image and ship with the code, like prompts. The screen
    is arithmetic the model kept getting wrong; the model's job is to judge the candidates.
    """
    from gateway import kick_faults, knowledge

    families = knowledge.kick_fault_families()
    computed = inv.context.get("kickAnalysisContext") or {}
    screen = kick_faults.screen_faults(computed, families) if computed else {
        "candidates": [], "unevaluated": [], "screened": 0,
    }
    return {
        "corpusVersion": knowledge.kick_corpus_version(),
        "biomechanics": knowledge.kick_biomechanics(),
        "referenceValues": knowledge.kick_reference_values(),
        "faultScreen": screen,
        "meaning": (
            "`faultScreen.candidates` are fault families whose documented signatures fired "
            "against this rep's deterministic numbers — they are leads to confirm or reject, "
            "not conclusions. `unevaluated` families could not be screened because the data "
            "they need is missing for this rep; treat them as unknown, not absent. "
            "`cueFamily` on each candidate is a menu of evidence-aligned phrasings to draw "
            "from and adapt, never to copy verbatim."
        ),
    }


def assemble_kick_previous_cues(inv: Invocation) -> dict:
    """Cues from this athlete's most recent kick analyses (excluding the rep being analyzed),
    so the focus stage can avoid repeating phrasings the athlete has already seen
    (KICK_ANALYSIS_V2_PLAN Part 1.9). Best-effort: any read failure yields an empty list —
    prior cues are an anti-repetition aid, never a reason to fail the job."""
    rep_id = inv.params.get("repId")
    entries: list[dict] = []
    try:
        docs = list(inv.player_ref().collection("aiAnalyses").stream())
    except Exception:  # noqa: BLE001 — tolerate any Firestore shape/permission hiccup
        return {"previous": []}
    for doc in docs:
        data = doc.to_dict() or {}
        if doc.id == rep_id or data.get("capability") != "kick_analysis":
            continue
        cues = [fa.get("cue") for fa in data.get("focusAreas") or []
                if isinstance(fa, dict) and fa.get("cue")]
        if cues:
            entries.append({"generatedAt": str(data.get("generatedAt") or ""), "cues": cues})
    entries.sort(key=lambda e: e["generatedAt"], reverse=True)
    return {"previous": [{"cues": e["cues"]} for e in entries[:3]]}


def assemble_kick_chat_knowledge(inv: Invocation) -> dict:
    """kick_chat's knowledge block: the same corpus + deterministic fault screen as
    `kickKnowledge`, plus the athlete-language symptom map that routes a complaint
    ("the ball keeps popping up") to the fault families and metric rows that can
    confirm or clear it. Runs after `kickAnalysisContext`, whose computed output the
    screen evaluates — assembler order in the registry entry is load-bearing."""
    from gateway import kick_faults, knowledge

    families = knowledge.kick_fault_families()
    computed = inv.context.get("kickAnalysisContext") or {}
    screen = kick_faults.screen_faults(computed, families) if computed else {
        "candidates": [], "unevaluated": [], "screened": 0,
    }
    return {
        "corpusVersion": knowledge.kick_corpus_version(),
        "biomechanics": knowledge.kick_biomechanics(),
        "referenceValues": knowledge.kick_reference_values(),
        "faultScreen": screen,
        "symptomMap": knowledge.kick_symptom_map(),
        "meaning": (
            "`faultScreen.candidates` are fault families whose documented signatures fired "
            "against this rep's deterministic numbers — leads to confirm or reject, not "
            "conclusions. `unevaluated` families could not be screened for this rep; treat "
            "them as unknown, not absent. `symptomMap` translates what the athlete SAYS into "
            "which candidate faults and metric rows to inspect; it routes attention and "
            "never decides. Cue phrasings are a menu to adapt, never to copy verbatim."
        ),
    }


def assemble_kick_rep_analysis(inv: Invocation) -> dict:
    """The persisted AI walkthrough for this rep (`aiAnalyses/{repId}`), slimmed to what
    chat needs: the cards the athlete just watched, so the coach's answers stay coherent
    with them instead of re-litigating. Best-effort — an athlete can open chat on a rep
    that was never analyzed, so absence is a normal state, never an error."""
    rep_id = inv.params.get("repId")
    if not rep_id or not isinstance(rep_id, str):
        return {"available": False}
    try:
        snap = inv.player_ref().collection("aiAnalyses").document(rep_id).get()
    except Exception:  # noqa: BLE001 — chat must survive any Firestore hiccup here
        return {"available": False}
    if not getattr(snap, "exists", False):
        return {"available": False}
    data = snap.to_dict() or {}
    if data.get("capability") != "kick_analysis":
        return {"available": False}

    def _slim_focus(fa: dict) -> dict:
        return {k: fa.get(k) for k in
                ("title", "cue", "why", "evidence", "bodyRegion", "frameKey")
                if fa.get(k) is not None}

    def _slim_obs(o: dict) -> dict:
        return {k: o.get(k) for k in
                ("id", "title", "observation", "bodyRegion", "frameKey", "deviationDirection", "severity")
                if o.get(k) is not None}

    return {
        "available": True,
        "generatedAt": str(data.get("generatedAt") or ""),
        "focusAreas": [_slim_focus(fa) for fa in data.get("focusAreas") or [] if isinstance(fa, dict)],
        "observations": [_slim_obs(o) for o in data.get("observations") or [] if isinstance(o, dict)],
        "meaning": (
            "What the AI walkthrough already told this athlete about this rep. When their "
            "question touches one of these cards, build on it (they have seen these exact "
            "words); when your numbers-based answer would contradict a card, trust the "
            "computed table in kickAnalysisContext and say the more careful thing."
        ),
    }


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# generate_training_plan assemblers (PLAN_GENERATION_AGENT_PLAN.md Part 2)
# ---------------------------------------------------------------------------

# Intake goal vocabulary -> plan domains. "allAround" (or unknown-but-domain-shaped
# strings) stays permissive — goals are prompt color and focus-area *bounds*, not filters.
# The app's questionnaire ships the six "real category" ids (speedAgility …
# strengthPower); the earlier motivation-phrased ids stay accepted for old clients.
_PLAN_GOAL_DOMAINS: dict[str, list[str]] = {
    "speedAgility": ["linearSpeed", "codAgility"],
    "passing": ["passingReceiving"],
    "firstTouch": ["passingReceiving"],
    "strengthPower": ["strengthResilience", "verticalPower", "horizontalPower"],
    "faster": ["linearSpeed"],
    "speed": ["linearSpeed"],
    "jumpHigher": ["verticalPower", "horizontalPower"],
    "explosive": ["verticalPower", "horizontalPower"],
    "betterShooter": ["shooting"],
    "shooting": ["shooting"],
    "betterDribbler": ["dribbling"],
    "dribbling": ["dribbling"],
    "moreAgile": ["codAgility"],
    "agility": ["codAgility"],
}

_PLAN_DOMAINS = [
    "linearSpeed", "verticalPower", "horizontalPower", "codAgility", "dribbling",
    "passingReceiving", "shooting", "strengthResilience", "representativeGames",
]

_INTAKE_SETTINGS = ("solo", "partner", "halfAndHalf", "team")
_INTAKE_LEVELS = ("foundation", "club", "performance")
_INTAKE_MINUTES = (15, 30, 45, 60, 75)
# Plan length the invitation slider offers; 6 is the default for old clients
# that don't send `horizonWeeks`.
_INTAKE_HORIZON_WEEKS = range(4, 13)
_DEFAULT_HORIZON_WEEKS = 6
# Sanity bounds only — age gates maturity floors and catalog eligibility.
_INTAKE_AGE_RANGE = range(5, 81)

# Which delivery modes an intake `setting` can actually execute.
_SETTING_DELIVERY_MODES = {
    "solo": {"solo", "coachApp"},
    "partner": {"solo", "partner", "coachApp"},
    "halfAndHalf": {"solo", "partner", "coachApp"},
    "team": {"solo", "partner", "coachApp", "group"},
}

# Maturity gates encoded as age floors (plan Part 0.5: no maturity instrument in v1 —
# a gate is eligible only when age alone already clears it).
_MATURITY_MIN_AGE = {"any": 0, "circaPostPHV": 13, "postPHVPreferred": 14, "postPHVMostly": 15}


def assemble_plan_intake_gate(inv: Invocation) -> dict:
    """Validates the intake params and short-circuits on the R26 safety flag —
    before any other assembler runs and long before any model call. Listed first
    in the capability's assembler order for exactly that reason."""
    intake = inv.params.get("intake")
    if not isinstance(intake, dict):
        raise invalid_request("generate_training_plan requires an `intake` params object")

    if intake.get("painFlag") is True:
        # Workbook R26: pain, marked avoidance, or acute injury -> no automated
        # prescription. The client shows the referral card without submitting;
        # this is the server-side guarantee behind that UI promise.
        raise invalid_request(
            "painFlag is set: no automated prescription (workbook R26). "
            "The athlete needs human review before a plan can be generated."
        )

    goals = intake.get("goals")
    days = intake.get("daysPerWeek")
    minutes = intake.get("minutesPerSession")
    setting = intake.get("setting")
    level = intake.get("level")
    equipment = intake.get("equipment")
    horizon = intake.get("horizonWeeks", _DEFAULT_HORIZON_WEEKS)
    age = intake.get("age")

    if not isinstance(goals, list) or len(goals) > 2 or not all(isinstance(g, str) for g in goals):
        raise invalid_request("intake.goals must be a list of at most 2 strings")
    if not isinstance(days, int) or not 1 <= days <= 6:
        raise invalid_request("intake.daysPerWeek must be an integer in 1..6")
    if minutes not in _INTAKE_MINUTES:
        raise invalid_request(f"intake.minutesPerSession must be one of {_INTAKE_MINUTES}")
    if setting not in _INTAKE_SETTINGS:
        raise invalid_request(f"intake.setting must be one of {_INTAKE_SETTINGS}")
    if level not in _INTAKE_LEVELS:
        raise invalid_request(f"intake.level must be one of {_INTAKE_LEVELS}")
    if not isinstance(equipment, list) or not all(isinstance(e, str) for e in equipment):
        raise invalid_request("intake.equipment must be a list of strings")
    if not isinstance(horizon, int) or isinstance(horizon, bool) or horizon not in _INTAKE_HORIZON_WEEKS:
        raise invalid_request(
            f"intake.horizonWeeks must be an integer in "
            f"{_INTAKE_HORIZON_WEEKS.start}..{_INTAKE_HORIZON_WEEKS.stop - 1}"
        )
    if age is not None and (not isinstance(age, int) or isinstance(age, bool) or age not in _INTAKE_AGE_RANGE):
        raise invalid_request(
            f"intake.age must be an integer in {_INTAKE_AGE_RANGE.start}..{_INTAKE_AGE_RANGE.stop - 1}"
        )

    goal_domains: list[str] = []
    for goal in goals:
        for domain in _PLAN_GOAL_DOMAINS.get(goal, [goal] if goal in _PLAN_DOMAINS else []):
            if domain not in goal_domains:
                goal_domains.append(domain)
    all_around = "allAround" in goals or not goals

    return {
        "intake": {
            "goals": goals,
            "freeTextGoals": intake.get("freeTextGoals") if isinstance(intake.get("freeTextGoals"), str) else None,
            "daysPerWeek": days,
            "minutesPerSession": minutes,
            "setting": setting,
            "equipment": equipment,
            "level": level,
            # Self-reported in the intake; downstream assemblers prefer it over
            # the player doc (which is often missing a birth date).
            "age": age,
            "horizonWeeks": horizon,
            "painFlag": False,
        },
        # Focus areas must stay inside measured findings ∪ these (validator);
        # allAround opens every domain.
        "goalDomains": _PLAN_DOMAINS if all_around else goal_domains,
        "weeklyBudgetMinutes": days * minutes,
    }


def assemble_training_history(inv: Invocation) -> dict:
    """Prior plans' shape + the last 28 days of workout logs, so the agent knows
    what's been tried and what the athlete actually does (including pain skips,
    which the assess prompt must convert into referral-shaped caution)."""
    plans_snap = list(
        inv.player_ref().collection("trainingPlans").stream()
    )
    plans = sorted(
        (p.to_dict() or {} for p in plans_snap),
        key=lambda d: str(d.get("startDate") or ""),
        reverse=True,
    )[:5]
    prior_plans = [{
        "status": p.get("status"),
        "startDate": p.get("startDate"),
        "horizonWeeks": p.get("horizonWeeks"),
        "focusDomains": [f.get("domain") for f in p.get("focusAreas") or [] if isinstance(f, dict)],
    } for p in plans]

    cutoff = datetime.now(timezone.utc) - timedelta(days=28)
    domain_exposures: dict[str, int] = {}
    pain_skips = 0
    log_count = 0
    for snap in inv.player_ref().collection("workoutLogs").stream():
        log = snap.to_dict() or {}
        started = _coerce_datetime(log.get("startedAt"))
        if started is None or started < cutoff:
            continue
        log_count += 1
        for block in log.get("blocks") or []:
            if not isinstance(block, dict):
                continue
            if block.get("skipReason") == "pain":
                pain_skips += 1
            if block.get("status") == "skipped":
                continue
            domain = block.get("domain")
            if isinstance(domain, str):
                domain_exposures[domain] = domain_exposures.get(domain, 0) + 1

    return {
        "priorPlans": prior_plans,
        "recentWorkoutLogs": {
            "windowDays": 28,
            "logCount": log_count,
            "domainExposures": domain_exposures,
            "painSkips": pain_skips,
        },
    }


def assemble_plan_knowledge(inv: Invocation) -> dict:
    """The research corpus slice for this athlete: their age band's matrix row, the
    full rules list, and the dosage/copy markdown. Conservative on unknown age —
    mirrors catalog.py's young-athlete default rather than assemblers.py's
    senior-scoring default, because this gates prescriptions, not scoring."""
    from gateway import knowledge
    from gateway.catalog import _UNKNOWN_AGE_SAFETY_DEFAULT

    snap = inv.player_ref().get()
    player_data = (snap.to_dict() if getattr(snap, "exists", False) else None) or {}
    intake = (inv.context.get("planIntake") or {}).get("intake") or {}
    # The questionnaire asks age directly; that self-report beats the player
    # doc, which historically lacks a birth date for most signup paths.
    intake_age = intake.get("age")
    age = intake_age if isinstance(intake_age, int) else resolve_player_age(player_data)
    age_unknown = age is None
    effective_age = age if age is not None else _UNKNOWN_AGE_SAFETY_DEFAULT

    band = knowledge.age_band_for(effective_age)
    level = intake.get("level", "club")
    row = knowledge.matrix_row(band, level)
    if row is None:
        for fallback in ("club", "foundation", "performance"):
            row = knowledge.matrix_row(band, fallback)
            if row is not None:
                break

    return {
        "catalogVersion": knowledge.catalog_version(),
        "ageBand": band,
        "effectiveAge": effective_age,
        "ageWasUnknown": age_unknown,
        "matrixRow": row,
        "rules": knowledge.rules(),
        "measuredDrillTests": knowledge.measured_drill_tests(),
        "dosagePrinciples": knowledge.dosage_principles(),
        "copyRules": knowledge.copy_rules(),
        "retestWindowWeeks": "6-8",
    }


def assemble_plan_candidate_drills(inv: Invocation) -> dict:
    """The safe, practical drill pool: `candidate_drill_ids` (age/contraindication —
    the safety-critical primitive) narrowed by intake level, setting-compatible
    delivery modes, equipment, and the age-encoded maturity gate, hydrated with the
    dose ranges the validator later enforces. The model never sees a drill outside
    this list, and the validator rejects any output that references one."""
    from gateway.catalog import candidate_drill_ids

    plan_intake = inv.context.get("planIntake") or {}
    intake = plan_intake.get("intake") or {}
    level = intake.get("level", "club")
    setting_modes = _SETTING_DELIVERY_MODES.get(intake.get("setting", "solo"), {"solo", "coachApp"})
    # A ball is table stakes for a soccer athlete (see tools/catalog/PROVISIONAL_DECISIONS.md).
    available = set(intake.get("equipment") or []) | {"ball"}

    knowledge_ctx = inv.context.get("planKnowledge") or {}
    effective_age = knowledge_ctx.get("effectiveAge", 10)

    safe_ids = candidate_drill_ids(inv)
    drills = []
    for doc in inv.db.collection("drillCatalog").stream():
        if doc.id not in safe_ids:
            continue
        data = doc.to_dict() or {}
        if level not in (data.get("eligibleLevels") or []):
            continue
        if not setting_modes & set(data.get("deliveryModes") or []):
            continue
        if effective_age < _MATURITY_MIN_AGE.get(data.get("maturityGate") or "any", 0):
            continue
        if not set(data.get("equipment") or []) <= available:
            continue
        dose = data.get("dose") or {}
        drills.append({
            "drillId": data.get("drillId") or doc.id,
            "name": data.get("name"),
            "domain": data.get("legacyDomain") or data.get("domain"),
            "deficitTags": data.get("deficitTags") or [],
            "execution": data.get("execution"),
            "evidenceTier": data.get("evidenceTier"),
            "intensityIntent": data.get("intensityIntent"),
            "technicalTransfer": data.get("technicalTransfer"),
            "cues": data.get("cues") or [],
            "equipment": data.get("equipment") or [],
            "estimatedMinutes": data.get("estimatedMinutes"),
            "dose": {k: dose.get(k) for k in (
                "setsMin", "setsMax", "repsMin", "repsMax", "repUnit", "perSide",
                "restSecondsMin", "restSecondsMax", "frequencyPerWeekMin",
                "frequencyPerWeekMax", "doseText", "restText", "frequencyText",
            )},
        })

    if not drills:
        raise context_unavailable(
            "No eligible drills for this athlete's age/level/setting/equipment — "
            "cannot generate a plan (is the drillCatalog published?)"
        )
    return {"count": len(drills), "drills": drills}


# ---------------------------------------------------------------------------
# build_workout assemblers (WORKOUT_BUILDER_AGENT_PLAN.md Part 1)
# ---------------------------------------------------------------------------

_WORKOUT_ENERGIES = ("low", "normal", "high")

# Below this, the assembler frames a one-block "micro session" rather than
# failing (plan Part 1's "Failure modes" note).
_MICRO_SESSION_THRESHOLD_MINUTES = 15

# Cap on the free-text adjustment message ("only 20 minutes, no goal today").
# Generous for a sentence or three, tight enough to keep prompt injection and
# runaway context in check — the job doc persists params verbatim.
_ADJUSTMENT_REQUEST_MAX_CHARS = 500

# App drill id (the vocabulary `retest.drills` and `WorkoutBlock.measuredDrillType`
# use — see MEASURED_DRILLS) -> the domain a plan week's `targets` key on. Distinct
# from `_METRIC_SOURCE`'s repType keys (a rep's raw `repType` field uses the legacy
# "side_kick" name for deadball shot; this dict uses the app's canonical drill id,
# matching WeeklyProgressBuilder.swift's own doc comment on that split).
MEASURED_DRILL_ID_DOMAINS: dict[str, str] = {
    "sprint": "linearSpeed",
    "jump": "verticalPower",
    "broadJump": "horizontalPower",
    "changeOfDirection": "codAgility",
    "dribbling": "dribbling",
    "deadballShot": "shooting",
}

# Mirrors WeeklyProgressBuilder.swift's `measuredDrillDomains` exactly (keyed by
# the raw Firestore `repType` field, NOT the app drill id above) — this is the
# parity assembler's whole reason for existing (plan Part 0.2): same inputs, same
# numbers, in both languages.
_REP_TYPE_DOMAINS: dict[str, str] = {
    "sprint": "linearSpeed",
    "jump": "verticalPower",
    "broadJump": "horizontalPower",
    "changeOfDirection": "codAgility",
    "dribbling": "dribbling",
    "side_kick": "shooting",
}

# A retest block has no catalog dose to bound it ("repeat the same setup and
# distance as your baseline reps") — a small fixed estimate for time-budget
# purposes only, not a prescription. Judgment call, logged here and in the plan's
# open questions rather than invented silently.
_RETEST_BLOCK_ESTIMATED_MINUTES = 8


def _resolve_tz(tz_name: Any):
    if isinstance(tz_name, str) and tz_name:
        try:
            from zoneinfo import ZoneInfo
            return ZoneInfo(tz_name)
        except Exception:
            pass
    return timezone.utc


def _parse_day_string(value: Any, tz) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    try:
        year, month, day = (int(p) for p in value.split("-"))
        return datetime(year, month, day, tzinfo=tz)
    except Exception:
        return None


def _current_week_number(start_date: Any, horizon_weeks: Any, tz_name: Any, *, now: Optional[datetime] = None) -> int:
    """Mirrors `TrainingPlan.currentWeekNumber(asOf:)` (Swift): day-precision, no
    Monday alignment, clamped to `[1, horizonWeeks]`."""
    tz = _resolve_tz(tz_name)
    base = _parse_day_string(start_date, tz)
    horizon = horizon_weeks if isinstance(horizon_weeks, int) and horizon_weeks > 0 else 1
    if base is None:
        return 1
    today = (now or datetime.now(tz)).astimezone(tz)
    today_midnight = datetime(today.year, today.month, today.day, tzinfo=tz)
    days = (today_midnight - base).days
    computed = (days // 7) + 1
    return min(max(computed, 1), horizon)


def _week_window(start_date: Any, week_number: int, tz_name: Any) -> tuple[Optional[datetime], Optional[datetime]]:
    """Mirrors `TrainingPlan.weekWindow(weekNumber:)`: `[start, end)`,
    `week N = [startDate + 7(N-1), startDate + 7N)`. Uses fixed 7-day
    `timedelta` arithmetic rather than Swift's calendar-day arithmetic — the two
    agree everywhere except a week that straddles a DST transition in `tz_name`,
    where this can be off by an hour at the boundary. Acceptable for the
    weekly-exposure grain this feeds; revisit if that boundary ever matters at
    minute precision."""
    tz = _resolve_tz(tz_name)
    base = _parse_day_string(start_date, tz)
    if base is None or not isinstance(week_number, int) or week_number < 1:
        return None, None
    return base + timedelta(days=7 * (week_number - 1)), base + timedelta(days=7 * week_number)


def assemble_active_plan_week(inv: Invocation) -> dict:
    """Validates `build_workout`'s params, resolves the athlete's one active plan
    (TrainingPlanStore's own query: `status == active`, newest `generatedAt`
    wins), and slices out the current week — the candidate pool every later
    assembler in this capability narrows (plan Part 0.1). `params.planId` must
    name that same active plan; a mismatch means the client's cached plan is
    stale, not that a different plan should silently be used."""
    plan_id = inv.params.get("planId")
    if not plan_id or not isinstance(plan_id, str):
        raise invalid_request("build_workout requires params.planId")

    time_available = inv.params.get("timeAvailableMinutes")
    if not isinstance(time_available, (int, float)) or isinstance(time_available, bool) or time_available <= 0:
        raise invalid_request("build_workout requires a positive params.timeAvailableMinutes")

    energy = inv.params.get("energy")
    if energy not in _WORKOUT_ENERGIES:
        raise invalid_request(f"params.energy must be one of {_WORKOUT_ENERGIES}")

    focus_domains = inv.params.get("focusDomains") or []
    if not isinstance(focus_domains, list) or not all(isinstance(d, str) for d in focus_domains):
        raise invalid_request("params.focusDomains must be a list of strings")

    equipment_today = inv.params.get("equipmentToday")
    if equipment_today is not None and (
        not isinstance(equipment_today, list) or not all(isinstance(e, str) for e in equipment_today)
    ):
        raise invalid_request("params.equipmentToday must be a list of strings when present")

    # Optional adjustment rebuild (contract §5): free text from the athlete
    # about what to change, plus the plannedWorkouts doc being adjusted. Both
    # are additive — an older client simply never sends them.
    adjustment_request = inv.params.get("adjustmentRequest")
    if adjustment_request is not None:
        if not isinstance(adjustment_request, str) or not adjustment_request.strip():
            raise invalid_request("params.adjustmentRequest must be a non-empty string when present")
        if len(adjustment_request) > _ADJUSTMENT_REQUEST_MAX_CHARS:
            raise invalid_request(
                f"params.adjustmentRequest must be at most {_ADJUSTMENT_REQUEST_MAX_CHARS} characters"
            )
        adjustment_request = adjustment_request.strip()

    previous_workout_id = inv.params.get("previousWorkoutId")
    if previous_workout_id is not None and (
        not isinstance(previous_workout_id, str)
        or not previous_workout_id
        # A path separator or dot-segment would make the Firestore client
        # raise ValueError inside .document() — surface it as the caller's
        # error, not an internal one.
        or "/" in previous_workout_id
        or previous_workout_id in (".", "..")
    ):
        raise invalid_request("params.previousWorkoutId must be a plain document id when present")

    plans_ref = inv.player_ref().collection("trainingPlans")
    active_docs = list(plans_ref.where("status", "==", "active").stream())
    if not active_docs:
        raise context_unavailable("No active training plan — generate one before requesting a workout")
    # More than one "active" doc should never happen (the plan finalizer
    # supersedes on every generation) — sort defensively rather than trust that.
    active_docs.sort(key=lambda d: str((d.to_dict() or {}).get("generatedAt") or ""), reverse=True)
    plan_snap = active_docs[0]
    plan = plan_snap.to_dict() or {}

    if plan_snap.id != plan_id:
        raise invalid_request(
            f"params.planId '{plan_id}' does not match the athlete's current active plan "
            f"'{plan_snap.id}' — the client's cached plan is stale"
        )

    if plan.get("schemaVersion") == 3:
        raise invalid_request("plan is v3; use workout_chat")

    tz_name = inv.params.get("timezone")
    horizon_weeks = plan.get("horizonWeeks")
    start_date = plan.get("startDate")
    week_number = _current_week_number(start_date, horizon_weeks, tz_name)

    weeks = plan.get("weeks") or []
    week = next((w for w in weeks if isinstance(w, dict) and w.get("weekNumber") == week_number), None)
    if week is None:
        raise context_unavailable(f"Active plan has no week {week_number} (horizon {horizon_weeks})")

    retest = plan.get("retest") or {}
    is_retest_week = isinstance(retest, dict) and week_number == retest.get("weekNumber")

    # The previous session, condensed, so an adjustment rebuild can honor
    # "keep everything but X". A missing doc is not an error — the athlete's
    # request still carries the intent on its own.
    previous_workout = None
    if adjustment_request and previous_workout_id:
        prev_snap = inv.player_ref().collection("plannedWorkouts").document(previous_workout_id).get()
        if prev_snap.exists:
            prev = prev_snap.to_dict() or {}
            previous_workout = {
                "workoutId": previous_workout_id,
                "estimatedMinutes": prev.get("estimatedMinutes"),
                "intro": prev.get("intro"),
                "params": prev.get("params"),
                "blocks": [
                    {
                        key: block.get(key)
                        for key in (
                            "blockId", "order", "kind", "drillId", "name", "domain",
                            "sets", "reps", "repUnit", "restSeconds", "estimatedMinutes",
                        )
                    }
                    for block in (prev.get("blocks") or [])
                    if isinstance(block, dict)
                ],
            }

    return {
        "planId": plan_snap.id,
        "weekNumber": week_number,
        "horizonWeeks": horizon_weeks,
        "startDate": start_date,
        "timezone": tz_name if isinstance(tz_name, str) else None,
        "catalogVersion": plan.get("catalogVersion"),
        "week": week,
        "isRetestWeek": is_retest_week,
        "retest": retest if is_retest_week else None,
        "timeAvailableMinutes": int(time_available),
        "energy": energy,
        "focusDomains": focus_domains,
        "equipmentToday": equipment_today,
        "isMicroSession": time_available < _MICRO_SESSION_THRESHOLD_MINUTES,
        "adjustmentRequest": adjustment_request,
        "previousWorkout": previous_workout,
    }


def assemble_week_progress(inv: Invocation) -> dict:
    """What actually happened this week, folded against what the plan's week
    asked for — the server-side twin of `WeeklyProgressBuilder.swift`
    (TRAINING_PLAN_DATA_MODEL_PLAN.md Part 2). Reads `activePlanWeek` from
    `inv.context` (assembler order in the registry guarantees it ran first) and
    must stay numerically identical to the Swift builder on the same inputs —
    that identity is what the parity test in both repos enforces."""
    v3_plan = (inv.context.get("workoutContext") or {}).get("plan")
    if isinstance(v3_plan, dict) and v3_plan.get("schemaVersion") == 3:
        from gateway.program_progress import fold_week_progress
        def rows(name):
            return [{**(d.to_dict() or {}), "id": d.id} for d in inv.player_ref().collection(name).stream()]
        wn = inv.context["workoutContext"].get("weekNumber", 1)
        return fold_week_progress(v3_plan, wn, rows("workoutLogs"), rows("reps"), rows("trainingSessions"))

    plan_week = inv.context.get("activePlanWeek") or {}
    week = plan_week.get("week") or {}
    week_number = plan_week.get("weekNumber")
    plan_id = plan_week.get("planId")
    if not week or week_number is None:
        return {"weekNumber": week_number, "domainProgress": [], "drillProgress": []}

    window_start, window_end = _week_window(plan_week.get("startDate"), week_number, plan_week.get("timezone"))

    logs: list[dict] = []
    logs_query = (
        inv.player_ref().collection("workoutLogs")
        .where("planId", "==", plan_id)
        .where("weekNumber", "==", week_number)
    )
    for snap in logs_query.stream():
        logs.append(snap.to_dict() or {})

    covered_session_ids = {l.get("linkedTrainingSessionId") for l in logs if l.get("linkedTrainingSessionId")}
    covered_rep_ids: set[str] = set()
    if covered_session_ids:
        for snap in inv.player_ref().collection("trainingSessions").stream():
            if snap.id not in covered_session_ids:
                continue
            data = snap.to_dict() or {}
            for ref in data.get("sessionRefs") or []:
                sid = ref.get("sessionDocId") if isinstance(ref, dict) else None
                if sid:
                    covered_rep_ids.add(sid)

    domain_exposure_count: dict[str, int] = {}
    for log in logs:
        for block in log.get("blocks") or []:
            if not isinstance(block, dict) or block.get("status") == "skipped":
                continue
            domain = block.get("domain")
            if isinstance(domain, str):
                domain_exposure_count[domain] = domain_exposure_count.get(domain, 0) + 1

    reps = load_parsed_reps(inv)
    free_session_keys_seen: set[str] = set()
    for rep in reps:
        created_at = rep.get("createdAt")
        if window_start is None or created_at is None or not (window_start <= created_at < window_end):
            continue
        if rep["id"] in covered_rep_ids:
            continue
        domain = _REP_TYPE_DOMAINS.get(rep["repType"])
        if domain is None:
            continue
        session_number = rep.get("sessionNumber")
        folder = f"session{session_number}" if session_number is not None else rep["id"]
        session_key = f"{domain}|{folder}"
        if session_key in free_session_keys_seen:
            continue
        free_session_keys_seen.add(session_key)
        domain_exposure_count[domain] = domain_exposure_count.get(domain, 0) + 1

    domain_progress = []
    for target in week.get("targets") or []:
        if not isinstance(target, dict):
            continue
        domain = target.get("domain")
        domain_progress.append({
            "domain": domain,
            "exposuresDone": domain_exposure_count.get(domain, 0),
            "exposuresTarget": target.get("exposures") or 0,
        })

    drill_completed_count: dict[str, int] = {}
    drill_minutes_done: dict[str, int] = {}
    for log in logs:
        for block in log.get("blocks") or []:
            if not isinstance(block, dict) or block.get("status") == "skipped":
                continue
            drill_id = block.get("drillId")
            if isinstance(drill_id, str):
                drill_completed_count[drill_id] = drill_completed_count.get(drill_id, 0) + 1
                # Minute-debit proxy (PLAN_GENERATION_V2_PLAN Part 3): a block
                # marked done debits its own estimatedMinutes. Blocks logged
                # before the workout player ships may lack the field — those
                # debit nothing here and the drill-level fallback below keeps
                # progress accounting on exposures, exactly as today.
                minutes = block.get("estimatedMinutes")
                if isinstance(minutes, (int, float)) and not isinstance(minutes, bool):
                    drill_minutes_done[drill_id] = drill_minutes_done.get(drill_id, 0) + int(minutes)

    drill_progress = []
    for drill in week.get("drills") or []:
        if not isinstance(drill, dict):
            continue
        drill_id = drill.get("drillId")
        completed = drill_completed_count.get(drill_id, 0)
        target = max(drill.get("frequencyPerWeek") or 1, 1)
        if completed <= 0:
            state = "notStarted"
        elif completed >= target:
            state = "done"
        else:
            state = "partial"
        # `weeklyMinutes` is server-computed on v2 plans; v1 plan rows lack it,
        # so fall back to the same arithmetic the v2 finalizer runs.
        weekly_minutes = drill.get("weeklyMinutes")
        if not isinstance(weekly_minutes, (int, float)) or isinstance(weekly_minutes, bool):
            weekly_minutes = (drill.get("estimatedMinutes") or 0) * target
        minutes_done = drill_minutes_done.get(drill_id, 0)
        drill_progress.append({
            "drillId": drill_id,
            "state": state,
            "completed": completed,
            "target": target,
            "weeklyMinutes": int(weekly_minutes),
            "minutesDone": minutes_done,
            "minutesRemaining": max(int(weekly_minutes) - minutes_done, 0),
        })

    return {"weekNumber": week_number, "domainProgress": domain_progress, "drillProgress": drill_progress}


def assemble_workout_candidates(inv: Invocation) -> dict:
    """Hydrates the plan week's own drills (never a different one — plan Part 0
    decision 1) with catalog dose ranges, minute costs, and eligibility flags,
    plus — on the retest week — one pseudo-candidate per `retest.drills` entry.
    The model never sees a drill outside this list, and the validator rejects
    any block that references one."""
    plan_week = inv.context.get("activePlanWeek") or {}
    week = plan_week.get("week") or {}
    energy = plan_week.get("energy", "normal")
    equipment_today = plan_week.get("equipmentToday")
    available_equipment = set(equipment_today) if equipment_today is not None else None

    progress = inv.context.get("weekProgress") or {}
    remaining_by_domain: dict[str, int] = {}
    for d in progress.get("domainProgress") or []:
        remaining_by_domain[d["domain"]] = max((d.get("exposuresTarget") or 0) - (d.get("exposuresDone") or 0), 0)
    minutes_remaining_by_drill: dict[str, int] = {}
    for d in progress.get("drillProgress") or []:
        if isinstance(d, dict) and isinstance(d.get("drillId"), str):
            minutes_remaining_by_drill[d["drillId"]] = d.get("minutesRemaining") or 0

    drills_out = []
    for drill in week.get("drills") or []:
        if not isinstance(drill, dict) or not drill.get("drillId"):
            continue
        doc = inv.db.collection("drillCatalog").document(drill["drillId"]).get()
        catalog = doc.to_dict() if getattr(doc, "exists", False) else {}
        catalog = catalog or {}
        dose = catalog.get("dose") or {}
        domain = drill.get("domain") or catalog.get("legacyDomain") or catalog.get("domain")
        equipment_eligible = available_equipment is None or set(catalog.get("equipment") or []) <= available_equipment
        energy_blocked = energy == "low" and catalog.get("intensityIntent") == "maxQuality"

        drills_out.append({
            "drillId": drill["drillId"],
            "name": drill.get("name") or catalog.get("name"),
            "domain": domain,
            "execution": catalog.get("execution"),
            "cues": catalog.get("cues") or drill.get("cues") or [],
            "regression": catalog.get("regression"),
            "intensityIntent": catalog.get("intensityIntent"),
            # The finalizer stamps a strengthResilience movement-circuit block
            # into every week (umbrella Part 0.1's warmup exception) — this is
            # a display hint for the prompt, not a structural requirement any
            # other candidate is barred from also being ordered first.
            "isStandingWarmup": domain == "strengthResilience",
            "energyBlocked": energy_blocked,
            "equipmentEligible": equipment_eligible,
            "dose": {k: dose.get(k) for k in (
                "setsMin", "setsMax", "repsMin", "repsMax", "repUnit",
                "restSecondsMin", "restSecondsMax",
            )},
            "estimatedMinutesRange": catalog.get("estimatedMinutes"),
            "remainingExposuresThisWeek": remaining_by_domain.get(domain, 0),
            # The v2 minute slice (PLAN_GENERATION_V2_PLAN Part 3): what's left
            # of this drill's weekly minute budget after completed blocks
            # debited theirs. The prompt composes whole dose-blocks from these.
            "remainingMinutesThisWeek": minutes_remaining_by_drill.get(drill["drillId"], 0),
        })

    retest_blocks = []
    if plan_week.get("isRetestWeek"):
        retest = plan_week.get("retest") or {}
        for measured_type in retest.get("drills") or []:
            if not isinstance(measured_type, str):
                continue
            domain = MEASURED_DRILL_ID_DOMAINS.get(measured_type)
            retest_blocks.append({
                "measuredDrillType": measured_type,
                "domain": domain,
                "name": f"Retest: {measured_type}",
                "note": retest.get("note"),
                "estimatedMinutes": _RETEST_BLOCK_ESTIMATED_MINUTES,
                "remainingExposuresThisWeek": remaining_by_domain.get(domain, 0) if domain else 0,
            })

    if not drills_out and not retest_blocks:
        raise context_unavailable("This week's plan has no drills to build a workout from")

    return {
        "planId": plan_week.get("planId"),
        "weekNumber": plan_week.get("weekNumber"),
        "energy": energy,
        "timeAvailableMinutes": plan_week.get("timeAvailableMinutes"),
        "focusDomains": plan_week.get("focusDomains") or [],
        "isMicroSession": plan_week.get("isMicroSession", False),
        "isRetestWeek": bool(plan_week.get("isRetestWeek")),
        "drills": drills_out,
        "retestBlocks": retest_blocks,
    }


from gateway.kick_comparison import assemble_comparison

ASSEMBLERS: dict[str, Any] = {
    "kickComparisonContext": assemble_comparison,
    # Key = context key: everything downstream reads inv.context["planIntake"].
    "planIntake": assemble_plan_intake_gate,
    "trainingHistory": assemble_training_history,
    "planKnowledge": assemble_plan_knowledge,
    "planCandidateDrills": assemble_plan_candidate_drills,
    "activePlanWeek": assemble_active_plan_week,
    "weekProgress": assemble_week_progress,
    "workoutCandidates": assemble_workout_candidates,
    "playerProfile": assemble_player_profile,
    "athleteStats": assemble_athlete_stats,
    "recentReps": assemble_recent_reps,
    "benchmarkContext": assemble_benchmark_context,
    "benchmarkContextOptional": assemble_benchmark_context_optional,
    "conversationHistory": assemble_conversation_history,
    "sessionDetail": assemble_session_detail,
    "kickAnalysisContext": assemble_kick_analysis_context,
    "kickKnowledge": assemble_kick_knowledge,
    "kickPreviousCues": assemble_kick_previous_cues,
    "kickChatKnowledge": assemble_kick_chat_knowledge,
    "kickRepAnalysis": assemble_kick_rep_analysis,
}
