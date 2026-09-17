"""Bound coaching prose to what the kick evidence can measure.

These are targeted entailment checks, not a biomechanical fault classifier or a
claim that arbitrary natural language can be fully validated. In particular,
kinematics cannot establish ball outcomes, causal mechanisms, or dynamic stability.
"""
from __future__ import annotations

import re
from gateway.kick_evidence import number

GROUNDING_INSTRUCTIONS = """MEASUREMENT AND CLAIM LIMITS (apply to every text field, including titles and reasoning):
- Athlete heights/second is normalized tracked FOOT speed, not ball speed, kick power,
  force, shot distance or accuracy. Say 'higher normalized foot speed in this clip'; never
  call a kick more powerful/effective, or claim more ball speed/distance, from segment motion.
- One clip per condition is observational. Do not say a difference causes, produces,
  generates, allows, leads to, leaks or transfers power/energy, or is 'due to' a technique.
  Give a possible coaching experiment with 'may/could help', not an established mechanism.
- A bent knee or a phase-angle difference is not evidence of instability, collapse,
  poor balance, an energy leak or ineffective force transfer. Describe the measured angle
  and phase instead. Dense tracking supports movement descriptions, not these diagnoses.
- Preserve explicit unknowns. Example: 'The tracked foot moved faster in this clip; ball
  speed and power were not measured. Try a comfortable backswing and review another pair.'
- Safe support-leg example: 'The plant knee was more flexed at backswing. This alone does
  not establish instability. A coach can review the movement before choosing an adjustment.'
- Cues must ask for a physical experiment, without promising more power or an ideal foot.
An eligible citation supports only that row's measurement, not every plausible consequence.
"""

# Split at contrast/independent clauses too: a disclaimer must not exempt a subsequent
# affirmative assertion ("power is unknown, but the right kick is more powerful").
_CLAUSES = re.compile(r"(?<=[.!?;])\s+|\s*[;]\s*|,?\s+\b(?:but|however|yet|nevertheless|therefore|thus|so)\b\s*|,\s+(?=(?:the|this|that|it|he|she|you|right|left|implying|meaning|suggesting)\b)|,\s+and\s+|\s+and\s+(?=(?:the|this|that|it|he|she|you|right|left)\b)", re.I)
_DENIAL_PREFIX = re.compile(
    r"\b(?:cannot|can't|can not|do not|does not|did not|don't|doesn't|didn't|never)\s+"
    r"(?:reliably\s+|directly\s+|alone\s+)?(?:establish|determine|infer|conclude|show|demonstrate|"
    r"prove|measure|assess|claim|mean|tell|say|confirm|indicate|support|justify|imply|guarantee|"
    r"generate|produce|cause|equate)(?:\s+\S+){0,12}$|"
    r"\bno\s+(?:evidence|measurement|basis)(?:\s+\S+){0,12}$|"
    r"\b(?:not|never)(?:\s+necessarily)?$|\bno(?:\s+measured)?$", re.I)
_MODAL = re.compile(r"\b(?:may|might|could|possibly|potentially)\b", re.I)
_OUTCOMES = {
    "power": re.compile(r"\b(?:more|less|greater|higher|lower|reduced|increased|extra|maximum|substantial(?:ly)?|significant(?:ly)?)\s+(?:\w+\s+){0,2}(?:power(?:ful)?|force|energy)\b|\b(?:powerful|stronger|more explosive)\b|\b(?:power|force|energy)\s+(?:generation|production|transfer|loss|leak(?:age)?)\b", re.I),
    "ball_speed": re.compile(r"\bball\s+(?:speed|velocity)\b|\b(?:faster|slower)\s+(?:ball|shot)\b", re.I),
    "ball_distance": re.compile(r"\b(?:greater|more|longer|increased|extra)\s+(?:shot\s+|kick\s+)?distance\b|\b(?:kick|shot|ball)\s+(?:travels?\s+)?(?:farther|further)\b", re.I),
    "accuracy": re.compile(r"\b(?:more|less|greater|better|improved|reduced)\s+accura(?:te|cy)\b", re.I),
    "effectiveness": re.compile(r"\b(?:more|less|better|greater)\s+effective(?:ness)?\b|\b(?:superior|inferior)\s+technique\b", re.I),
}
_CAUSAL = re.compile(
    r"\b(?:primarily\s+)?due to\b|\bbecause of\b|\b(?:caus(?:e[sd]?|ing)|lead(?:s|ing)? to|"
    r"result(?:s|ing)? in|produc(?:e[sd]?|ing)|generat(?:e[sd]?|ing)|allow(?:s|ing)?|"
    r"enabl(?:e[sd]?|ing)|ensur(?:e[sd]?|ing)|prevent(?:s|ing)?|leak(?:s|ing)?|"
    r"transfer(?:s|ring)?)\b|\b(?:increas(?:e[sd]?|ing)|reduc(?:e[sd]?|ing)|improv(?:e[sd]?|ing))\s+(?:the\s+|your\s+)?(?:power|force|energy|ball speed|balance|stability|consistency)\b", re.I)
_MECHANISM = re.compile(r"\b(?:power|force|energy|speed|velocity|distance|accuracy|balance|stabil\w*|consistency|acceleration|rotation|effective\w*)\b", re.I)
_DYNAMIC = re.compile(r"\b(?:unstable|instability|stable|stability|poor(?:er)? balance|los(?:e[sd]?|ing) balance|collapse[sd]?|collapsing|energy leak\w*|leaks? energy)\b", re.I)

# Only explicitly named, eligible outcome measurements with physical units can
# establish these outcomes. No current pose/angle/event row matches this allowlist.
_OUTCOME_METRICS = {
    "power": {"kick_power": {"watts", "W"}},
    "ball_speed": {"ball_speed": {"m/s", "meters/second", "km/h", "mph"}},
    "ball_distance": {"ball_distance": {"meters", "m"}},
}


def _measured(outcome: str, rows: list[dict]) -> bool:
    for row in rows:
        allowed = _OUTCOME_METRICS.get(outcome, {}).get(row.get("metric"), set())
        eligible = (row.get("comparable") is True if "comparable" in row
                    else row.get("eligible", row.get("valid")) is True)
        values = [row.get("left"), row.get("right")] if "comparable" in row else [row.get("athlete")]
        if eligible and row.get("units") in allowed and all(number(value) for value in values):
            return True
    return False


def _denied(clause: str, match: re.Match) -> bool:
    # Match-local scope protects an actual denial/unknown statement, including a
    # quotation, without granting blanket immunity to the rest of the paragraph.
    before, after = clause[:match.start()].rstrip(), clause[match.end():]
    denial = _DENIAL_PREFIX.search(before)
    if denial and not re.search(r"[,;]", before[denial.start():]):
        return True
    return bool(re.match(
        r"[\s'\"’”]*(?:(?:difference|and power|and accuracy)\s+)?(?:is|are|was|were|remain(?:s)?)?\s*"
        r"(?:not\b|unknown\b|unmeasured\b|unavailable\b|uncertain\b|unsupported\b|cannot be (?:measured|determined))", after, re.I))


def _qualified(prefix: str) -> bool:
    matches = list(_MODAL.finditer(prefix))
    if not matches:
        return False
    suffix = prefix[matches[-1].end():]
    # A hedge about an earlier fact does not qualify an independent conclusion.
    return len(suffix.split()) <= 8 and not re.search(r"\b(?:and|therefore|thus|so|definitely|certainly|proves?)\b|[,;]", suffix, re.I)


def _future_hypothesis(clause: str, match: re.Match) -> bool:
    prefix = clause[:match.start()]
    if not _qualified(prefix):
        return False
    modal = list(_MODAL.finditer(prefix))[-1]
    # Hedging a diagnosis of this recorded kick is still a proxy-outcome inference.
    return bool(re.search(r"\b(?:help|support|contribute|allow|enable|explore|improve)\b", prefix[modal.end():], re.I))


def validate_grounded_text(text: object, path: str, rows: list[dict], *, suggestion: bool = False) -> list[str]:
    if not isinstance(text, str):
        return []
    errors = []
    for clause in _CLAUSES.split(text):
        for outcome, pattern in _OUTCOMES.items():
            for match in pattern.finditer(clause):
                if _denied(clause, match) or _measured(outcome, rows):
                    continue
                # A clearly conditional coaching rationale may mention a possible
                # benefit; an observed-result field may not turn a proxy into it.
                if suggestion and _future_hypothesis(clause, match):
                    continue
                errors.append(f"{path}: unsupported {outcome} outcome; cite a directly measured outcome or describe only the measured foot/segment motion. Do not infer ball outcomes or technique superiority from pose speed/angles")
                break
        for causal in _CAUSAL.finditer(clause):
            limitation = (re.search(r"\b(?:unavailable|unreliable|unmeasured|unknown|missing|insufficient|invalid)\s*$", clause[:causal.start()], re.I)
                          and re.search(r"\b(?:capture|tracking|samples?|frames?|fps|coverage|clip|pose|data)\b", clause[causal.end():], re.I))
            blocked_comparison = (
                re.fullmatch(r"\s*(?:the\s+)?(?:unavailable|unreliable|unknown|missing|insufficient|absent)\s+(?:pro\s+|capture\s+)?(?:fps|frames?|tracking|samples?|data)\s*", clause[:causal.start()], re.I)
                and re.fullmatch(r"prevent(?:s|ing)?", causal.group(), re.I)
                and re.match(r"\s+(?:a\s+|the\s+)?(?:reliable\s+|valid\s+)?(?:speed\s+|temporal\s+|pro\s+)?(?:comparison|measurement|estimate)\b", clause[causal.end():], re.I))
            if _MECHANISM.search(clause) and not limitation and not blocked_comparison and not _denied(clause, causal) and not _qualified(clause[:causal.start()]):
                errors.append(f"{path}: observational evidence cannot establish this causal mechanism; describe the measured association and make any coaching rationale explicitly conditional (may/could), without promising an outcome")
        for dynamic in _DYNAMIC.finditer(clause):
            if not _denied(clause, dynamic) and not (suggestion and _future_hypothesis(clause, dynamic)):
                errors.append(f"{path}: pose snapshots/kinematics do not establish stability, collapse or energy transfer; describe the measured joint position/motion and phase, or explicitly state that stability is unknown")
    return list(dict.fromkeys(errors))


def validate_grounded_item(item: dict, path: str, rows: list[dict]) -> list[str]:
    errors = []
    for field in ("title", "observation", "reasoning", "cue", "whyItMatters"):
        errors.extend(validate_grounded_text(item.get(field), f"{path}.{field}", rows,
                                             suggestion=field in ("cue", "whyItMatters", "reasoning")))
    return errors
