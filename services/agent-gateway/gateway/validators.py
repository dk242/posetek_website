"""Post-generation validators — LLM_PLATFORM_PLAN.md Part 4's "validate" stage: "safety lives
here." A validator takes the model's raw structured output plus the `Invocation` and returns a
list of *specific* human-readable violation strings (empty = valid). The pipeline (owned
elsewhere) feeds that list back to the model on a single re-prompt naming the violated
constraints, then fails the job with `validation_failed` if a second attempt still doesn't pass.
Un-validated output must never be persisted — see contract §9.

Violation strings are written to be directly useful as re-prompt text ("focusAreas[2].metricIds
contains 'sprintPower' which is not a known metric" beats "invalid metric"), so every message names
the offending path, value, and constraint.
"""

from __future__ import annotations

import re

from typing import Any, Optional

from gateway.assemblers import BENCHMARK_METRICS, band_for_score
from gateway.ctx import Invocation

MAX_STRENGTHS = 4
MAX_FOCUS_AREAS = 4
MAX_PRESCRIPTIONS = 6
MAX_SUMMARY_CHARS = 900


def _stats_profile_metric_ids(inv: Invocation) -> set[str]:
    profile = inv.params.get("statsProfile") or {}
    ids: set[str] = set()
    for drill in profile.get("drills") or []:
        for metric in drill.get("metrics") or []:
            metric_id = metric.get("metric") if isinstance(metric, dict) else None
            if metric_id:
                ids.add(metric_id)
    return ids


def _check_metric_ids(items: list, field_path: str, known_ids: set[str], violations: list[str]) -> None:
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        for metric_id in _kick_citations(item):
            if metric_id not in known_ids:
                violations.append(f"{field_path}[{i}].metricIds contains '{metric_id}' which is not a known metric")


def validate_report_v1(report: dict, inv: Invocation) -> list[str]:
    """Enforces every constraint listed in contract §9:

    - `metricIds` (strengths/focusAreas) and `metricCallouts[].metricId` are subsets of the real
      `BenchmarkMetric` id set.
    - `metricCallouts[].metricId` must also exist in the *submitted* stats profile — a model can't
      cite a metric the athlete has no data for.
    - `metricCallouts[].band` must equal what the score actually maps to (`band_for_score`) — the
      model may not relabel a score's severity.
    - `prescriptions[].drillId` must be in the pre-filtered candidate set the retrieval stage
      produced (`inv.context["candidateDrillIds"]`, populated by `catalog.candidate_drill_ids`).
      This is the prescription-safety mechanism; a violation here is never trimmed, only failed.
    - Length limits: strengths <=4, focusAreas <=4, prescriptions <=6, summary <=900 chars.
    - `disclaimers` must contain the provisional-benchmark note whenever the benchmark reference is
      provisional (either the report's own `benchmarkContext.isDefaulted`, or the assembled
      `benchmarkContext.source == "provisional"` from earlier in the pipeline).
    """
    if not isinstance(report, dict):
        return ["report is not a JSON object"]

    violations: list[str] = []
    known_metric_ids = set(BENCHMARK_METRICS.keys())
    profile_metric_ids = _stats_profile_metric_ids(inv)
    candidate_drill_ids = inv.context.get("candidateDrillIds")
    if candidate_drill_ids is None:
        candidate_drill_ids = set()

    summary = report.get("summary", "")
    if isinstance(summary, str) and len(summary) > MAX_SUMMARY_CHARS:
        violations.append(f"summary is {len(summary)} characters, exceeds the {MAX_SUMMARY_CHARS}-character limit")

    strengths = report.get("strengths") or []
    if len(strengths) > MAX_STRENGTHS:
        violations.append(f"strengths has {len(strengths)} items, exceeds the max of {MAX_STRENGTHS}")
    _check_metric_ids(strengths, "strengths", known_metric_ids, violations)

    focus_areas = report.get("focusAreas") or []
    if len(focus_areas) > MAX_FOCUS_AREAS:
        violations.append(f"focusAreas has {len(focus_areas)} items, exceeds the max of {MAX_FOCUS_AREAS}")
    _check_metric_ids(focus_areas, "focusAreas", known_metric_ids, violations)

    metric_callouts = report.get("metricCallouts") or []
    for i, callout in enumerate(metric_callouts):
        if not isinstance(callout, dict):
            violations.append(f"metricCallouts[{i}] is not an object")
            continue
        metric_id = callout.get("metricId")
        if metric_id not in known_metric_ids:
            violations.append(f"metricCallouts[{i}].metricId '{metric_id}' is not a known metric")
        elif metric_id not in profile_metric_ids:
            violations.append(f"metricCallouts[{i}].metricId '{metric_id}' is not present in the submitted stats profile")

        score = callout.get("score")
        band = callout.get("band")
        if isinstance(score, (int, float)) and not isinstance(score, bool):
            expected_band = band_for_score(score)
            if band != expected_band:
                violations.append(f"metricCallouts[{i}].band is '{band}' but score {score} maps to '{expected_band}'")
        else:
            violations.append(f"metricCallouts[{i}].score is missing or not numeric")

    prescriptions = report.get("prescriptions") or []
    if len(prescriptions) > MAX_PRESCRIPTIONS:
        violations.append(f"prescriptions has {len(prescriptions)} items, exceeds the max of {MAX_PRESCRIPTIONS}")
    for i, rx in enumerate(prescriptions):
        if not isinstance(rx, dict):
            violations.append(f"prescriptions[{i}] is not an object")
            continue
        drill_id = rx.get("drillId")
        if drill_id not in candidate_drill_ids:
            violations.append(
                f"prescriptions[{i}].drillId '{drill_id}' is not in the pre-filtered candidate drill set for this athlete"
            )

    benchmark_context = report.get("benchmarkContext") or {}
    is_defaulted = bool(benchmark_context.get("isDefaulted"))
    assembled_benchmark_context = inv.context.get("benchmarkContext") or {}
    is_provisional_source = assembled_benchmark_context.get("source") == "provisional"
    disclaimers = report.get("disclaimers") or []
    if is_defaulted or is_provisional_source:
        has_disclaimer = any(isinstance(d, str) and "provisional" in d.lower() for d in disclaimers)
        if not has_disclaimer:
            violations.append(
                "disclaimers must include the provisional-benchmark note because the benchmark "
                "reference is provisional (isDefaulted or an unpublished W3 store)"
            )

    return violations


MIN_CUE_WORDS = 5
MAX_CUE_WORDS = 20
# Stage 1 finding this many problem areas obliges stage 2 to surface at least 3
# of them (contract §9b: "3-4 whenever stage 1 produced >= 3 observations").
FOCUS_FLOOR_OBSERVATION_COUNT = 3
MIN_FOCUS_AREAS_WHEN_RICH = 3
MAX_KICK_FOCUS_AREAS = 4


def _kick_metric_rows(inv: Invocation) -> dict[str, dict]:
    context = inv.context.get("kickAnalysisContext") or {}
    from gateway.kick_evidence import evidence_rows
    rows = evidence_rows(context)
    return {row["id"]: row for row in rows if isinstance(row, dict) and row.get("id")}


def _kick_citations(item: dict) -> list[str]:
    return list(dict.fromkeys((item.get("metricIds") or []) + (item.get("evidenceIds") or [])))


def _check_kick_metric_ids(item: dict, path: str, rows: dict[str, dict], violations: list[str]) -> None:
    if not _kick_citations(item):
        violations.append(f"{path} must cite at least one eligible metricId or evidenceId")
    for metric_id in _kick_citations(item):
        row = rows.get(metric_id)
        if row is None:
            violations.append(f"{path}.metricIds contains '{metric_id}' which is not an id in the deterministic metric table")
        elif row.get("valid") is not True:
            violations.append(f"{path}.metricIds contains '{metric_id}' which is an invalid (valid=false) metric row and may not be cited")


# v2 side/direction guardrails (KICK_ANALYSIS_V2_PLAN Part 1.5) -------------------------------

# bodyRegion -> the metric-row sides it may cite. Regions absent from the map (hips, trunk,
# footPosition, balance) legitimately cite side-less or mixed rows and are unrestricted.
# Side-less rows (side: null) are always compatible with any region.
_KICK_REGION_ALLOWED_SIDES: dict[str, set[str]] = {
    "kickingLeg": {"kicking", "trail"},
    "supportLeg": {"support", "lead"},
    "arms": {"lead", "trail"},
}

_KICK_SIDE_WORDS = re.compile(r"\b(left|right)\b", re.IGNORECASE)
# User-facing free text only — `reasoning` is stage-internal and stays unrestricted.
_KICK_USER_TEXT_FIELDS = ("title", "observation", "cue", "whyItMatters")

# Anti-cues the research corpus explicitly excludes (knowledge/kick_biomechanics.md §7).
# These read as ordinary coaching language, which is exactly why they need a mechanical check
# rather than a prompt instruction: the support knee is ~42 deg flexed at ball contact and the
# kicking knee 40-60 deg flexed, so "straighten"/"lock" is wrong for both.
_KICK_STRAIGHTEN_WORDS = re.compile(
    r"\b(?:straight|straighter|straighten\w*|lock|locked|locking"
    # "fully extend" / "extend fully" / "full extension" in any order or inflection — the live
    # 2026-08-04 run emitted "fails to fully extend into the ball", which a fixed-phrase list
    # missed.
    r"|fully\s+extend\w*|extend\w*\s+fully|full\s+extension)\b",
    re.IGNORECASE,
)
_KICK_ARCH_BACK = re.compile(r"\barch(?:ing|es)?\s+(?:your|the|that)?\s*(?:lower\s+)?back\b", re.IGNORECASE)
# A second sentence (or clause after a hard stop) means a second instruction.
_KICK_SENTENCE_BREAK = re.compile(r"[.;!?]\s+\S")


def _check_kick_region_sides(item: dict, path: str, region: Any, rows: dict[str, dict],
                             violations: list[str]) -> None:
    allowed = _KICK_REGION_ALLOWED_SIDES.get(region) if isinstance(region, str) else None
    if allowed is None:
        return
    for metric_id in _kick_citations(item):
        side = (rows.get(metric_id) or {}).get("side")
        if side is not None and side not in allowed:
            violations.append(
                f"{path} has bodyRegion '{region}' but cites '{metric_id}' whose side is "
                f"'{side}' — a {region} item may only cite rows with side in "
                f"{sorted(allowed)} or side-less rows"
            )


def _check_kick_text_side_words(item: dict, path: str, violations: list[str]) -> None:
    for field in _KICK_USER_TEXT_FIELDS:
        text = item.get(field)
        if isinstance(text, str) and _KICK_SIDE_WORDS.search(text):
            violations.append(
                f"{path}.{field} uses the word 'left' or 'right' — name body parts functionally "
                "('kicking leg', 'plant leg', 'lead arm') instead; physical sides are resolved "
                "deterministically by the app"
            )


def _check_kick_frame_evidence(item: dict, path: str, rows: dict[str, dict],
                               violations: list[str]) -> None:
    """At least one cited row must come from the item's OWN key frame.

    Cross-frame citation is legitimate and the observe prompt encourages it (causal chains run
    backswing -> contact). What is not legitimate is an item whose evidence lives ENTIRELY at
    another frame: the walkthrough pauses on this item's frame and highlights joints there, so a
    backswing card justified only by contact rows shows the athlete a claim about a moment they
    are not looking at. Observed live 2026-08-04 — a backswing card asserting plant-foot-to-ball
    placement, which is a contact-frame quantity.
    """
    frame_key = item.get("frameKey")
    if not frame_key:
        return
    cited = [rows.get(mid) for mid in _kick_citations(item)]
    if any((row or {}).get("frameKey") == frame_key for row in cited if row):
        return
    # Only enforceable when the table actually offers valid evidence at that frame.
    if not any(r.get("frameKey") == frame_key and r.get("valid") is True for r in rows.values()):
        return
    violations.append(
        f"{path} has frameKey '{frame_key}' but every metric it cites is from a different frame — "
        f"cite at least one valid '{frame_key}.*' row, because the walkthrough pauses on that "
        "frame and the athlete is looking at it"
    )


def _check_kick_anti_cues(item: dict, path: str, region: Any, frame_key: Any,
                          violations: list[str]) -> None:
    """Coaching language the corpus excludes as contradicted by the evidence."""
    for field in _KICK_USER_TEXT_FIELDS:
        text = item.get(field)
        if not isinstance(text, str):
            continue
        if _KICK_ARCH_BACK.search(text):
            violations.append(
                f"{path}.{field} tells the athlete to arch their back — excluded coaching: trunk "
                "load is implicated in youth low back pain"
            )
        if not _KICK_STRAIGHTEN_WORDS.search(text):
            continue
        unsafe = False
        for clause in re.split(r"[.;!?]|\bbut\b", text, flags=re.IGNORECASE):
            if not _KICK_STRAIGHTEN_WORDS.search(clause):
                continue
            if re.search(r"\b(?:not|never|avoid|without|don't|do not)\b.{0,35}\b(?:straight\w*|lock\w*|fully extend\w*|full extension)\b", clause, re.IGNORECASE):
                if not re.search(r"\b(?:never reaches|fails? to|does not reach|doesn't reach)\b", clause, re.IGNORECASE):
                    continue
            if (field == "cue" or re.search(r"\b(?:should|must|needs? to|fails? to|never reaches|does not reach|doesn't reach)\b", clause, re.IGNORECASE)):
                unsafe = True
        if not unsafe:
            continue
        if region == "supportLeg":
            violations.append(
                f"{path}.{field} tells the athlete to straighten or lock the plant leg — excluded "
                "coaching: the support knee is about 42 degrees flexed at ball contact and only "
                "begins extending just before it, so a bent plant leg is correct"
            )
        elif region == "kickingLeg" and frame_key == "contact":
            violations.append(
                f"{path}.{field} implies the kicking knee should be straight at contact — excluded "
                "coaching: the knee is 40-60 degrees flexed at contact in every dataset and "
                "reaches full extension only during follow-through"
            )


def _check_kick_single_instruction(item: dict, path: str, violations: list[str]) -> None:
    """Keep each cue to one instruction; distinct priorities belong in separate cards."""
    cue = item.get("cue")
    if isinstance(cue, str) and _KICK_SENTENCE_BREAK.search(cue.strip()):
        violations.append(
            f"{path}.cue contains more than one sentence — give exactly ONE instruction; "
            "a second fix belongs in its own focus area or not at all"
        )


def _check_kick_deviation_direction(obs: dict, path: str, rows: dict[str, dict],
                                    violations: list[str]) -> None:
    signs: set[bool] = set()
    for metric_id in _kick_citations(obs):
        row = rows.get(metric_id)
        if row is None or row.get("valid") is not True:
            continue
        delta = row.get("delta")
        if isinstance(delta, (int, float)) and not isinstance(delta, bool) and delta != 0:
            signs.add(delta > 0)
    if not signs:
        if obs.get("evidenceIds") and obs.get("deviationDirection") != "notComparable":
            violations.append(f"{path}.deviationDirection must be notComparable when no reference delta exists")
        return
    if len(signs) > 1:
        if obs.get("deviationDirection") != "mixed":
            violations.append(f"{path}.deviationDirection must be mixed for opposite delta signs")
        return
    required = "athleteHigher" if True in signs else "athleteLower"
    if obs.get("deviationDirection") == required:
        return
    word = "positive" if True in signs else "negative"
    # The retry regenerates the whole array, so an index alone is not actionable — name the
    # observation and quote the deltas so the correction survives renumbering.
    detail = ", ".join(
        f"{mid} delta={rows[mid].get('delta')}"
        for mid in _kick_citations(obs)
        if mid in rows and rows[mid].get("valid") is True
    )
    violations.append(
        f"{path} (id '{obs.get('id')}', titled '{obs.get('title')}') declares "
        f"deviationDirection '{obs.get('deviationDirection')}' but every cited valid row's delta "
        f"(athlete minus pro) is {word} [{detail}] — it must be '{required}'. Use 'mixed' ONLY "
        "when the cited deltas genuinely have opposite signs; it is not a hedge."
    )


def validate_kick_observations_v1(result: dict, inv: Invocation) -> list[str]:
    """Contract §9b `observations` constraints the schema can't carry: unique ids, every
    `metricIds` entry naming a `valid: true` row of the deterministic table, bodyRegion/metric
    side compatibility, deviationDirection agreeing with the cited delta signs, and no
    'left'/'right' in user-facing text (v2)."""
    if not isinstance(result, dict):
        return ["output is not a JSON object"]

    violations: list[str] = []
    rows = _kick_metric_rows(inv)
    seen_ids: set[str] = set()
    for i, obs in enumerate(result.get("observations") or []):
        if not isinstance(obs, dict):
            violations.append(f"observations[{i}] is not an object")
            continue
        obs_id = obs.get("id")
        if obs_id in seen_ids:
            violations.append(f"observations[{i}].id '{obs_id}' duplicates an earlier observation's id — ids must be unique")
        elif obs_id:
            seen_ids.add(obs_id)
        path = f"observations[{i}]"
        from gateway.kick_grounding import validate_grounded_item
        violations.extend(validate_grounded_item(obs, path, [rows[key] for key in _kick_citations(obs) if key in rows]))
        _check_kick_metric_ids(obs, path, rows, violations)
        _check_kick_region_sides(obs, path, obs.get("bodyRegion"), rows, violations)
        _check_kick_deviation_direction(obs, path, rows, violations)
        _check_kick_text_side_words(obs, path, violations)
        _check_kick_frame_evidence(obs, path, rows, violations)
        _check_kick_anti_cues(obs, path, obs.get("bodyRegion"), obs.get("frameKey"), violations)
    return violations


def validate_kick_focus_v1(result: dict, inv: Invocation) -> list[str]:
    """Contract §9b `focusAreas` constraints, resolved against the accepted stage-1 output
    (`inv.stage_outputs["observe"]`): observationId subset, unique consecutive ranks from 1,
    unique observation references, 5-20-word cues, matching frameKeys, and eligible static
    or temporal evidence. Zero focuses and repeated body regions are valid."""
    if not isinstance(result, dict):
        return ["output is not a JSON object"]

    violations: list[str] = []
    observations = (inv.stage_outputs.get("observe") or {}).get("observations") or []
    obs_by_id = {o.get("id"): o for o in observations if isinstance(o, dict) and o.get("id")}
    rows = _kick_metric_rows(inv)

    focus_areas = result.get("focusAreas") or []
    if len(focus_areas) > MAX_KICK_FOCUS_AREAS:
        violations.append("focusAreas exceeds the maximum of four supported priorities")

    ranks: list[Any] = []
    seen_observations: set[str] = set()
    for i, area in enumerate(focus_areas):
        if not isinstance(area, dict):
            violations.append(f"focusAreas[{i}] is not an object")
            continue
        ranks.append(area.get("rank"))

        obs_id = area.get("observationId")
        obs = obs_by_id.get(obs_id)
        if obs_id in seen_observations:
            violations.append(f"focusAreas[{i}] repeats the same observation")
        seen_observations.add(obs_id)
        if obs is None:
            violations.append(f"focusAreas[{i}].observationId '{obs_id}' does not match any observation id from the observe stage")
        else:
            if area.get("frameKey") != obs.get("frameKey"):
                violations.append(
                    f"focusAreas[{i}].frameKey '{area.get('frameKey')}' does not equal the referenced "
                    f"observation's frameKey '{obs.get('frameKey')}'"
                )
            region = obs.get("bodyRegion")

        cue = area.get("cue")
        word_count = len(cue.split()) if isinstance(cue, str) else 0
        if not (MIN_CUE_WORDS <= word_count <= MAX_CUE_WORDS):
            violations.append(
                f"focusAreas[{i}].cue is {word_count} words; cues must be {MIN_CUE_WORDS}-{MAX_CUE_WORDS} words"
            )

        from gateway.kick_grounding import validate_grounded_item
        violations.extend(validate_grounded_item(area, f"focusAreas[{i}]", [rows[key] for key in _kick_citations(area) if key in rows]))
        _check_kick_metric_ids(area, f"focusAreas[{i}]", rows, violations)
        if obs is not None:
            _check_kick_region_sides(area, f"focusAreas[{i}]", obs.get("bodyRegion"), rows, violations)
            _check_kick_anti_cues(area, f"focusAreas[{i}]", obs.get("bodyRegion"),
                                  area.get("frameKey"), violations)
        _check_kick_text_side_words(area, f"focusAreas[{i}]", violations)
        _check_kick_frame_evidence(area, f"focusAreas[{i}]", rows, violations)
        _check_kick_single_instruction(area, f"focusAreas[{i}]", violations)

    expected_ranks = list(range(1, len(focus_areas) + 1))
    if focus_areas and sorted(r for r in ranks if isinstance(r, int)) != expected_ranks:
        violations.append(
            f"focusAreas ranks {ranks} are not unique and consecutive from 1 (expected a permutation of {expected_ranks})"
        )

    return violations


# ---------------------------------------------------------------------------
# Kick salvage — drop violating items instead of failing the whole job
# ---------------------------------------------------------------------------

# Every per-item kick violation message begins with its item path ("observations[3]…" /
# "focusAreas[1]…") — that prefix is the attribution contract the salvagers rely on. The two
# result-level messages that don't block salvage: the focus count-floor rule is a demand on the
# model's selection breadth (salvage deliberately accepts fewer cards), and the ranks rule is
# repaired structurally below by renumbering the survivors.
_KICK_ITEM_REF = re.compile(r"^(observations|focusAreas)\[(\d+)\]")
_KICK_SALVAGE_TOLERATED_PREFIXES = ("focusAreas has ", "focusAreas ranks ")


def _salvage_kick_items(key: str, validate_fn, result: dict, violations: list[str],
                        inv: Invocation) -> Optional[tuple[dict, list[str]]]:
    """Drops the items the violations attribute to and returns `(salvaged_result,
    dropped_descriptions)`, or None when salvage cannot certify a clean remainder —
    an unattributable violation, zero survivors, or a re-validation that still fails.
    The re-validation is the load-bearing step: salvaged output must pass the same
    checks as accepted output, or nothing ships (the v1 lesson)."""
    items = result.get(key)
    if not isinstance(items, list) or not items:
        return None

    flagged: dict[int, list[str]] = {}
    for msg in violations:
        match = _KICK_ITEM_REF.match(msg)
        if match and match.group(1) == key:
            flagged.setdefault(int(match.group(2)), []).append(msg)
        elif not msg.startswith(_KICK_SALVAGE_TOLERATED_PREFIXES):
            return None
    # No per-item violations means everything that fired was tolerated result-level
    # noise (count preference / ranks, repaired below) — keep every item.

    kept = [item for i, item in enumerate(items) if i not in flagged]
    if not kept or not all(isinstance(item, dict) for item in kept):
        return None
    if key == "focusAreas":
        kept = [{**item, "rank": rank} for rank, item in enumerate(kept, start=1)]

    salvaged = {**result, key: kept}
    remaining = [
        v for v in validate_fn(salvaged, inv)
        if not v.startswith(_KICK_SALVAGE_TOLERATED_PREFIXES[0])
    ]
    if remaining:
        return None

    dropped = []
    for i in sorted(flagged):
        item = items[i] if isinstance(items[i], dict) else {}
        label = item.get("title") or item.get("id") or f"{key}[{i}]"
        dropped.append(f"{label}: " + "; ".join(flagged[i]))
    return salvaged, dropped


def salvage_kick_observations_v1(result: dict, violations: list[str],
                                 inv: Invocation) -> Optional[tuple[dict, list[str]]]:
    return _salvage_kick_items("observations", validate_kick_observations_v1, result, violations, inv)


def salvage_kick_focus_v1(result: dict, violations: list[str],
                          inv: Invocation) -> Optional[tuple[dict, list[str]]]:
    return _salvage_kick_items("focusAreas", validate_kick_focus_v1, result, violations, inv)


# Validator name -> salvager. A stage with no entry keeps fail-closed behavior; a stage with
# one falls back to "ship the cards that passed" when the retry also fails validation.
SALVAGERS: dict[str, Any] = {
    "kick_observations_v1": salvage_kick_observations_v1,
    "kick_focus_v1": salvage_kick_focus_v1,
}


# ---------------------------------------------------------------------------
# generate_training_plan validators (PLAN_GENERATION_V2_PLAN Part 1)
# ---------------------------------------------------------------------------

# The checkable subset of the copy rules (guide §8). Case-insensitive substring match.
_PLAN_BANNED_PHRASES = ("you are slow", "the cause is", "caused")

# Allocation arithmetic (plan Part 1 "Allocate"): per-week totals inside
# [0.75x, 1.10x] of the athlete's real weekly budget, and no block smaller than
# the minimum — small-budget athletes never see 4-minute slivers (decision 3).
_ALLOCATION_BUDGET_LOWER = 0.75
_ALLOCATION_BUDGET_UPPER = 1.10
_MIN_ALLOCATION_BLOCK_MINUTES = 10

# Fill adherence (plan Part 1 "Fill"): per-domain Σ weeklyMinutes within ±15%
# of that domain's allocation. The absolute floor exists because dose-blocks
# are integer-grained — ±15% of a 10-minute block is 1.5 minutes, which no
# whole block can reliably hit.
_FILL_ADHERENCE_TOLERANCE = 0.15
_FILL_ADHERENCE_MIN_SLACK_MINUTES = 3

# Count caps mirroring the schemas' maxItems. vertex_gemini strips
# minItems/maxItems from the response schema (Vertex can't serve them) on the
# stated premise that "the gateway's own output validators enforce every one
# of these post-hoc" — so they must actually be enforced here.
_MAX_ALLOCATIONS_PER_WEEK = 5
_MAX_DRILLS_PER_WEEK = 8


def _check_banned_phrases(texts: list, where: str, violations: list[str]) -> None:
    for text in texts:
        if not isinstance(text, str):
            continue
        lowered = text.lower()
        for phrase in _PLAN_BANNED_PHRASES:
            if phrase in lowered:
                violations.append(f"{where} uses banned phrase '{phrase}': {text[:80]!r}")
                break


def validate_plan_assessment_v1(result: dict, inv: Invocation) -> list[str]:
    violations: list[str] = []
    known_rules = {r.get("ruleId") for r in (inv.context.get("planKnowledge") or {}).get("rules") or []}
    known_metrics = _stats_profile_metric_ids(inv)
    goal_domains = set((inv.context.get("planIntake") or {}).get("goalDomains") or [])

    findings = result.get("findings") or []
    for i, finding in enumerate(findings):
        if finding.get("ruleId") not in known_rules:
            violations.append(f"findings[{i}].ruleId '{finding.get('ruleId')}' is not a known rule")
    _check_metric_ids(findings, "findings", known_metrics, violations)

    finding_domains = {f.get("domain") for f in findings}
    for i, focus in enumerate(result.get("focusAreas") or []):
        domain = focus.get("domain")
        if domain not in finding_domains and domain not in goal_domains:
            violations.append(
                f"focusAreas[{i}].domain '{domain}' matches neither an assessed finding nor a stated goal"
            )

    _check_banned_phrases(
        [result.get("summary")]
        + [f.get("statement") for f in findings]
        + [f.get("rationale") for f in result.get("focusAreas") or []],
        "assessment",
        violations,
    )
    return violations


def _plan_focus_domains(inv: Invocation) -> set[str]:
    assess = inv.stage_outputs.get("assess") or {}
    return {
        f.get("domain") for f in assess.get("focusAreas") or []
        if isinstance(f, dict) and isinstance(f.get("domain"), str)
    }


def validate_plan_allocation_v1(result: dict, inv: Invocation) -> list[str]:
    """The allocate stage's arithmetic contract (plan Part 1 "Allocate"):
    weeks numbered exactly 1..horizon-1; per-week totals inside the budget
    band; no sliver blocks; no duplicate domains; only domains the assessment
    surfaced, the intake asked for, or strengthResilience (the standing warmup
    circuit every week funds); every allocated domain must actually have
    candidate drills, or the fill stage is doomed before it starts; the assess
    focus domains hold the plurality of total training minutes. Ramp shape is
    a logged check, not a blocking one."""
    if not isinstance(result, dict):
        return ["output is not a JSON object"]

    violations: list[str] = []
    plan_intake = inv.context.get("planIntake") or {}
    intake = plan_intake.get("intake") or {}
    horizon = intake.get("horizonWeeks") or 6
    budget = plan_intake.get("weeklyBudgetMinutes") or (
        (intake.get("daysPerWeek") or 0) * (intake.get("minutesPerSession") or 0)
    )

    candidate_domains = {
        d.get("domain") for d in (inv.context.get("planCandidateDrills") or {}).get("drills") or []
        if isinstance(d, dict) and isinstance(d.get("domain"), str)
    }
    assess = inv.stage_outputs.get("assess") or {}
    focus_domains = _plan_focus_domains(inv)
    finding_domains = {
        f.get("domain") for f in assess.get("findings") or []
        if isinstance(f, dict) and isinstance(f.get("domain"), str)
    }
    goal_domains = set(plan_intake.get("goalDomains") or [])
    # strengthResilience is always admissible: the age-band matrix requires the
    # standing warmup circuit in every week, and it has to be funded somewhere.
    allowed_domains = focus_domains | finding_domains | goal_domains | {"strengthResilience"}

    weeks = [w for w in result.get("weeks") or [] if isinstance(w, dict)]
    numbers = sorted(w.get("weekNumber") for w in weeks)
    if numbers != list(range(1, horizon)):
        violations.append(
            f"weeks must be numbered exactly 1..{horizon - 1} (week {horizon} is the "
            f"code-stamped retest week and is not yours to allocate); got {numbers}"
        )

    minutes_by_domain: dict[str, int] = {}
    weekly_totals: list[int] = []
    for week in weeks:
        wn = week.get("weekNumber")
        alloc_rows = week.get("allocations") or []
        if len(alloc_rows) > _MAX_ALLOCATIONS_PER_WEEK:
            violations.append(
                f"weeks[{wn}] has {len(alloc_rows)} allocation rows, exceeds the max of "
                f"{_MAX_ALLOCATIONS_PER_WEEK} — consolidate into fewer domains"
            )
        seen_domains: dict[str, int] = {}
        total = 0
        for i, alloc in enumerate(week.get("allocations") or []):
            if not isinstance(alloc, dict):
                continue
            where = f"weeks[{wn}].allocations[{i}]"
            domain = alloc.get("domain")
            minutes = alloc.get("minutes") or 0
            total += minutes
            if isinstance(domain, str):
                minutes_by_domain[domain] = minutes_by_domain.get(domain, 0) + minutes
                if domain in seen_domains:
                    violations.append(
                        f"{where} repeats domain '{domain}' (first at allocations[{seen_domains[domain]}]) "
                        "— one allocation row per domain per week"
                    )
                else:
                    seen_domains[domain] = i
                if domain not in allowed_domains:
                    violations.append(
                        f"{where} allocates '{domain}', which matches no assessed finding, no focus "
                        "area, and no stated goal — allocate only what the assessment or intake asked for"
                    )
                if candidate_domains and domain not in candidate_domains:
                    violations.append(
                        f"{where} allocates '{domain}' but the candidate drill pool has no drills in "
                        "that domain — the week could never be filled"
                    )
            if minutes < _MIN_ALLOCATION_BLOCK_MINUTES:
                violations.append(
                    f"{where} gives '{domain}' only {minutes} min — the minimum block is "
                    f"{_MIN_ALLOCATION_BLOCK_MINUTES} min (fold slivers into fewer, bigger blocks)"
                )
        weekly_totals.append(total)
        if budget:
            lower = budget * _ALLOCATION_BUDGET_LOWER
            upper = budget * _ALLOCATION_BUDGET_UPPER
            if not (lower <= total <= upper):
                violations.append(
                    f"weeks[{wn}] allocates {total} min but the athlete's weekly budget is "
                    f"{budget} min (daysPerWeek x minutesPerSession) — total must land in "
                    f"{lower:.0f}-{upper:.0f}"
                )

    # Focus plurality: the assessment's focus domains together must not be
    # out-allocated by any single other training domain. strengthResilience is
    # warmup overhead and exempt from the comparison.
    if focus_domains:
        focus_total = sum(minutes_by_domain.get(d, 0) for d in focus_domains)
        for domain, total in minutes_by_domain.items():
            if domain in focus_domains or domain == "strengthResilience":
                continue
            if total > focus_total:
                violations.append(
                    f"domain '{domain}' gets {total} min across the plan, more than the "
                    f"{focus_total} min given to the assessment's focus domains "
                    f"({sorted(focus_domains)}) combined — the focus must hold the plurality"
                )

    # Ramp-shape sanity starts as a logged check (plan Part 1): flag a block
    # whose volume only shrinks, but don't fail generation over it.
    if len(weekly_totals) >= 2 and all(b < a for a, b in zip(weekly_totals, weekly_totals[1:])):
        inv.log.info(
            "plan allocation ramp check: weekly totals strictly decrease %s (job=%s)",
            weekly_totals, inv.job_id,
        )

    texts = [result.get("planSummary")]
    for week in weeks:
        texts += [week.get("theme"), week.get("intensityNote")]
    _check_banned_phrases(texts, "allocation", violations)
    return violations


def _fill_week_context(result: dict, inv: Invocation) -> tuple[Optional[int], dict, list]:
    """`(expected_week_number, allocation_row, prior_week_digests)` for the fill
    iteration being validated — from the pipeline's iteration mirror when
    present, else resolved against the accepted allocate output (direct calls
    in tests, or a future non-iterated use)."""
    fill_week = (inv.iteration or {}).get("fillWeek")
    if isinstance(fill_week, dict):
        return (fill_week.get("weekNumber"), fill_week.get("allocation") or {},
                fill_week.get("priorWeeks") or [])
    allocation = inv.stage_outputs.get("allocate") or {}
    row = next(
        (w for w in allocation.get("weeks") or []
         if isinstance(w, dict) and w.get("weekNumber") == result.get("weekNumber")),
        {},
    )
    return None, row, []


def validate_plan_week_v1(result: dict, inv: Invocation) -> list[str]:
    """One fill iteration's contract (plan Part 1 "Fill"): the week this call
    was for; candidate membership + catalog dose ranges (ported from the
    single-shot validator) including the estimatedMinutes envelope, which is
    now load-bearing because minutes are the accounting currency; per-domain
    minute sums adhering to the week's allocation; no drills in un-allocated
    domains; copy rules. Continuity retention against the prior week is logged,
    never blocking (decision 4 — hard-blocking would forbid legitimate
    mid-block pivots)."""
    if not isinstance(result, dict):
        return ["output is not a JSON object"]

    violations: list[str] = []
    candidates = {
        d.get("drillId"): d
        for d in (inv.context.get("planCandidateDrills") or {}).get("drills") or []
        if isinstance(d, dict)
    }
    expected_number, alloc_row, prior_weeks = _fill_week_context(result, inv)

    wn = result.get("weekNumber")
    if expected_number is not None and wn != expected_number:
        violations.append(
            f"weekNumber is {wn} but this call is filling week {expected_number} — emit exactly "
            f"weekNumber {expected_number}"
        )

    allocations = {
        a.get("domain"): a.get("minutes") or 0
        for a in alloc_row.get("allocations") or []
        if isinstance(a, dict) and isinstance(a.get("domain"), str)
    }

    drills_out = result.get("drills") or []
    if not drills_out:
        violations.append("drills is empty — every training week prescribes at least one drill")
    if len(drills_out) > _MAX_DRILLS_PER_WEEK:
        violations.append(
            f"drills has {len(drills_out)} items, exceeds the max of {_MAX_DRILLS_PER_WEEK}"
        )

    minutes_by_domain: dict[str, int] = {}
    seen_drill_ids: dict[str, int] = {}
    for j, drill in enumerate(drills_out):
        if not isinstance(drill, dict):
            continue
        where = f"drills[{j}]"
        drill_id = drill.get("drillId")
        if isinstance(drill_id, str):
            if drill_id in seen_drill_ids:
                violations.append(
                    f"{where} repeats drillId '{drill_id}' (first at drills[{seen_drill_ids[drill_id]}]) "
                    "— one row per drill per week; raise sets/frequency within catalog range instead"
                )
            else:
                seen_drill_ids[drill_id] = j
        row = candidates.get(drill_id)
        if row is None:
            violations.append(f"{where} prescribes '{drill_id}', which is not in the candidate set")
            continue
        domain = drill.get("domain")
        if domain != row.get("domain"):
            violations.append(f"{where} domain '{domain}' != catalog '{row.get('domain')}'")
        # Both bounds guarded on every range: a one-sided catalog dose (e.g.
        # setsMin with no setsMax) must degrade to "unbounded", not TypeError.
        dose = row.get("dose") or {}
        sets, reps = drill.get("sets"), drill.get("reps")
        if dose.get("setsMin") is not None and dose.get("setsMax") is not None \
                and not dose["setsMin"] <= sets <= dose["setsMax"]:
            violations.append(f"{where} sets {sets} outside catalog range {dose['setsMin']}-{dose['setsMax']}")
        if dose.get("repsMin") is not None and dose.get("repsMax") is not None \
                and not dose["repsMin"] <= reps <= dose["repsMax"]:
            violations.append(f"{where} reps {reps} outside catalog range {dose['repsMin']}-{dose['repsMax']}")
        rest = drill.get("restSeconds")
        if dose.get("restSecondsMin") is not None and dose.get("restSecondsMax") is not None \
                and not dose["restSecondsMin"] <= rest <= dose["restSecondsMax"]:
            violations.append(
                f"{where} restSeconds {rest} outside catalog range "
                f"{dose['restSecondsMin']}-{dose['restSecondsMax']}"
            )
        freq = drill.get("frequencyPerWeek") or 0
        if dose.get("frequencyPerWeekMax") is not None and freq > dose["frequencyPerWeekMax"]:
            violations.append(
                f"{where} frequencyPerWeek {freq} exceeds catalog max {dose['frequencyPerWeekMax']}"
            )
        minutes = drill.get("estimatedMinutes") or 0
        envelope = row.get("estimatedMinutes") or {}
        env_min, env_max = envelope.get("min"), envelope.get("max")
        if env_min is not None and env_max is not None and not env_min <= minutes <= env_max:
            violations.append(
                f"{where} estimatedMinutes {minutes} outside catalog envelope {env_min}-{env_max}"
            )
        weekly_minutes = minutes * max(freq, 1)
        if isinstance(row.get("domain"), str):
            minutes_by_domain[row["domain"]] = (
                minutes_by_domain.get(row["domain"], 0) + weekly_minutes
            )
        if isinstance(domain, str) and allocations and domain not in allocations \
                and domain == row.get("domain"):
            violations.append(
                f"{where} prescribes '{drill_id}' in domain '{domain}', which has no allocation "
                f"this week — allocated domains: {sorted(allocations)}"
            )

    for domain, allocated in allocations.items():
        filled = minutes_by_domain.get(domain, 0)
        slack = max(round(allocated * _FILL_ADHERENCE_TOLERANCE), _FILL_ADHERENCE_MIN_SLACK_MINUTES)
        if not (allocated - slack <= filled <= allocated + slack):
            violations.append(
                f"domain '{domain}' fills {filled} min (Σ estimatedMinutes x frequencyPerWeek) "
                f"against an allocation of {allocated} min — land within ±{slack} min by adjusting "
                "doses, frequencies, or drill selection"
            )

    # Continuity retention (decision 4): visible from day one, blocking never.
    if prior_weeks:
        prev = prior_weeks[-1] if isinstance(prior_weeks[-1], dict) else {}
        prev_ids = {d.get("drillId") for d in prev.get("drills") or [] if isinstance(d, dict)}
        this_ids = {d.get("drillId") for d in result.get("drills") or [] if isinstance(d, dict)}
        if this_ids:
            retention = len(this_ids & prev_ids) / len(this_ids)
            inv.log.info(
                "plan fill continuity: week %s retains %.2f of its drills from week %s (job=%s)",
                wn, retention, prev.get("weekNumber"), inv.job_id,
            )

    texts = [result.get("focus"), result.get("progressionNote")]
    texts += [d.get("note") for d in result.get("drills") or [] if isinstance(d, dict)]
    _check_banned_phrases(texts, f"week {wn}", violations)
    return violations


# ---------------------------------------------------------------------------
# build_workout validators (WORKOUT_BUILDER_AGENT_PLAN.md Part 1)
# ---------------------------------------------------------------------------

MAX_WORKOUT_BLOCKS = 8
# Plan Part 1: "Σ estimatedMinutes ∈ [0.75x, 1.1x] of timeAvailableMinutes".
_TIME_BUDGET_LOWER = 0.75
_TIME_BUDGET_UPPER = 1.10
# A micro session (< 15 min requested) only needs to fit under budget — there's
# no meaningful lower bound for a single short block (plan Part 1's "Failure
# modes" note).
_MICRO_SESSION_UPPER = 1.10
_ESTIMATED_MINUTES_TOLERANCE = 2
# An adjustment rebuild ("only 20 minutes today") may legitimately override the
# original timeAvailableMinutes knob with free text the validator can't parse,
# so the budget loses its lower bound entirely — the UI's own placeholder
# ("only 20 minutes" against a 60-minute build) sits at 0.33x, below any
# reasonable floor. The upper bound stays as a runaway guard.
_ADJUSTED_TIME_BUDGET_UPPER = 1.75


def assert_unique_workout_drills(workout: dict) -> None:
    """Final persistence guard, including legacy relaxed-validator deployments."""
    from gateway.errors import GatewayError
    seen = set()
    for block in workout.get("blocks") or []:
        drill_id = block.get("drillId") if isinstance(block, dict) else None
        if isinstance(drill_id, str):
            if drill_id in seen:
                raise GatewayError("validation_failed", f"A workout cannot repeat drill '{drill_id}'; select another eligible drill")
            seen.add(drill_id)


def validate_workout_v1(result: dict, inv: Invocation) -> list[str]:
    """Enforces WORKOUT_BUILDER_AGENT_PLAN.md Part 1's validator list: every
    `drillId` in the candidate pool (or a valid retest block); doses inside
    catalog ranges, with low-energy max-intent drills trimmed to their dose
    floor; the time budget; the warmup-first / no-maxQuality-after-game
    ordering invariant; block count; `focusDomains` honored when a compatible
    candidate exists; measured-drill blocks carrying a consistent
    `isMeasuredDrill`/`measuredDrillType`/`drillId`."""
    if not isinstance(result, dict):
        return ["output is not a JSON object"]

    violations: list[str] = []
    candidates_ctx = inv.context.get("workoutCandidates") or {}
    catalog_by_id = {d["drillId"]: d for d in candidates_ctx.get("drills") or [] if d.get("drillId")}
    retest_by_type = {
        r["measuredDrillType"]: r for r in candidates_ctx.get("retestBlocks") or [] if r.get("measuredDrillType")
    }
    energy = candidates_ctx.get("energy", "normal")
    time_available = candidates_ctx.get("timeAvailableMinutes") or 0
    is_micro = bool(candidates_ctx.get("isMicroSession"))
    focus_domains = set(candidates_ctx.get("focusDomains") or [])

    blocks = result.get("blocks") or []
    if len(blocks) > MAX_WORKOUT_BLOCKS:
        violations.append(f"blocks has {len(blocks)} items, exceeds the max of {MAX_WORKOUT_BLOCKS}")
    if is_micro and len(blocks) != 1:
        violations.append(
            f"timeAvailableMinutes={time_available} is a micro session — expected exactly 1 block, got {len(blocks)}"
        )

    orders: list[Any] = []
    warmup_order: Optional[int] = None
    earliest_game_order: Optional[int] = None
    domains_present: set[str] = set()
    total_minutes = 0
    seen_drill_ids = set()

    for i, block in enumerate(blocks):
        where = f"blocks[{i}]"
        if not isinstance(block, dict):
            violations.append(f"{where} is not an object")
            continue

        drill_id = block.get("drillId")
        if isinstance(drill_id, str):
            if drill_id in seen_drill_ids:
                violations.append(f"{where} repeats drillId '{drill_id}'; each drill may appear only once per workout")
            seen_drill_ids.add(drill_id)
        order = block.get("order")
        orders.append(order)
        total_minutes += block.get("estimatedMinutes") or 0

        is_measured = bool(block.get("isMeasuredDrill"))
        measured_type = block.get("measuredDrillType")
        row: Optional[dict] = None
        if is_measured:
            row = retest_by_type.get(measured_type)
            if row is None:
                violations.append(
                    f"{where} claims isMeasuredDrill for measuredDrillType '{measured_type}', which is "
                    "not an offered retest block this week"
                )
            elif drill_id != measured_type:
                violations.append(f"{where}.drillId '{drill_id}' must equal its own measuredDrillType '{measured_type}'")
        else:
            if measured_type is not None:
                violations.append(f"{where}.measuredDrillType must be null when isMeasuredDrill is false")
            row = catalog_by_id.get(drill_id)
            if row is None:
                violations.append(f"{where}.drillId '{drill_id}' is not in this week's candidate pool")

        if row is None:
            continue

        if block.get("domain") != row.get("domain"):
            violations.append(f"{where}.domain '{block.get('domain')}' != candidate '{row.get('domain')}'")
        if isinstance(row.get("domain"), str):
            domains_present.add(row["domain"])

        dose = row.get("dose") or {}
        sets, reps, rest = block.get("sets"), block.get("reps"), block.get("restSeconds")
        if row.get("energyBlocked") and energy == "low":
            sets_min = dose.get("setsMin")
            if sets_min is not None and isinstance(sets, (int, float)) and sets > sets_min:
                violations.append(
                    f"{where} is a max-intent drill offered under low energy — sets must be trimmed to "
                    f"the catalog minimum ({sets_min}), got {sets}"
                )
        if dose.get("setsMin") is not None and isinstance(sets, (int, float)) and not dose["setsMin"] <= sets <= dose["setsMax"]:
            violations.append(f"{where} sets {sets} outside catalog range {dose['setsMin']}-{dose['setsMax']}")
        if dose.get("repsMin") is not None and isinstance(reps, (int, float)) and not dose["repsMin"] <= reps <= dose["repsMax"]:
            violations.append(f"{where} reps {reps} outside catalog range {dose['repsMin']}-{dose['repsMax']}")
        if dose.get("restSecondsMin") is not None and isinstance(rest, (int, float)) and not dose["restSecondsMin"] <= rest <= dose["restSecondsMax"]:
            violations.append(
                f"{where} restSeconds {rest} outside catalog range {dose['restSecondsMin']}-{dose['restSecondsMax']}"
            )

        kind = block.get("kind")
        if kind == "warmup" and warmup_order is None:
            warmup_order = order
        if kind == "game" and isinstance(order, int):
            earliest_game_order = order if earliest_game_order is None else min(earliest_game_order, order)
        if (
            row.get("intensityIntent") == "maxQuality"
            and earliest_game_order is not None
            and isinstance(order, int)
            and order > earliest_game_order
        ):
            violations.append(
                f"{where} is maxQuality intensity but is ordered after a 'game'-kind block "
                f"(order {order} > {earliest_game_order}) — max-intent work must come before game/transfer blocks"
            )

    if warmup_order is not None and warmup_order != 1:
        violations.append(f"a 'warmup'-kind block is present but its order is {warmup_order}, not 1 — warmup must come first")

    expected_orders = list(range(1, len(blocks) + 1))
    if blocks and sorted(o for o in orders if isinstance(o, int)) != expected_orders:
        violations.append(f"blocks order values {orders} are not a permutation of {expected_orders}")

    has_adjustment = bool((inv.context.get("activePlanWeek") or {}).get("adjustmentRequest"))

    if time_available:
        if is_micro:
            upper = time_available * _MICRO_SESSION_UPPER
            lower = 0
        elif has_adjustment:
            upper = time_available * _ADJUSTED_TIME_BUDGET_UPPER
            lower = 0
        else:
            upper = time_available * _TIME_BUDGET_UPPER
            lower = time_available * _TIME_BUDGET_LOWER
        if not (lower <= total_minutes <= upper):
            violations.append(
                f"workout totals ~{total_minutes} min but timeAvailableMinutes is {time_available} "
                f"(expected {lower:.0f}-{upper:.0f})"
            )

    # An adjustment may explicitly ask a focus off ("no shooting today"), and
    # the free text outranks the knob it was set with — skip the focus check
    # on rebuilds rather than fail a workout for honoring the athlete.
    if not has_adjustment:
        for domain in focus_domains:
            candidate_exists = any(d.get("domain") == domain for d in candidates_ctx.get("drills") or [])
            if candidate_exists and domain not in domains_present:
                violations.append(f"focusDomains requested '{domain}' and a compatible candidate exists, but no block covers it")

    result_estimated = result.get("estimatedMinutes")
    if isinstance(result_estimated, (int, float)) and abs(result_estimated - total_minutes) > _ESTIMATED_MINUTES_TOLERANCE:
        violations.append(
            f"estimatedMinutes {result_estimated} does not match the sum of block estimatedMinutes (~{total_minutes})"
        )

    return violations


VALIDATORS: dict[str, Any] = {
    "plan_assessment_v1": validate_plan_assessment_v1,
    "plan_allocation_v1": validate_plan_allocation_v1,
    "plan_week_v1": validate_plan_week_v1,
    "workout_v1": validate_workout_v1,
    "report_v1": validate_report_v1,
    "kick_observations_v1": validate_kick_observations_v1,
    "kick_focus_v1": validate_kick_focus_v1,
}


from gateway.kick_comparison import validate_comparison
VALIDATORS["kick_comparison_v1"] = validate_comparison
