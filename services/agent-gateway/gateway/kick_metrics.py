"""Deterministic kick-analysis metrics — pure math, zero I/O, stdlib only (no numpy).

Computes the athlete-vs-pro biomechanical comparison table for the `kick_analysis` capability
(KICK_AI_ANALYSIS_PLAN.md Part 1.2, LLM_GATEWAY_CONTRACT.md §9b). The alignment (frame shift,
mirror test, uniform scale, ball-center/plant-foot offset) is a faithful port of the iOS client's
`DeadballGeometry` so these numbers match the on-screen pro ghost the user is looking at.

Input hazards this module owns:
- `PythonCompatibleJSON` emits bare NaN/Infinity literals, which `json.loads` parses into
  float('nan')/inf — every read is finiteness-checked, and no NaN/Infinity may ever appear in
  the returned dict (numbers are finite-or-None; `valid: false` rows carry the reason).
- Frames may be null; a joint is usable only when x and y are finite AND visibility >= 0.10.
- The pro asset may be MediaPipe-33 or COCO-17 (keypoint count <= 20 => COCO, same rule as the
  client). COCO-17 has no heel/foot_index, so the pro foot centroid degrades to the ankle alone.
"""

from __future__ import annotations

import math
from typing import Any, Callable, Optional

_MIN_VISIBILITY = 0.10
# Nearest-usable-frame tolerance around a key frame, nearest first.
_SEARCH_OFFSETS = (0, -1, 1, -2, 2, -3, 3)
_ASSUMED_PRO_HEIGHT_M = 1.778
# shouldMirrorPro parity: run-up window before backswing and min |COM x-displacement|.
_MIRROR_WINDOW = 50
_MIRROR_MIN_DISPLACEMENT = 0.02

FRAME_KEYS = ("backswing", "contact", "followThrough")

# Landmark name -> index, per layout. Athlete pose is always MediaPipe-33.
MP33_INDEX: dict[str, int] = {
    "nose": 0,
    "l_shoulder": 11, "r_shoulder": 12,
    "l_elbow": 13, "r_elbow": 14,
    "l_wrist": 15, "r_wrist": 16,
    "l_hip": 23, "r_hip": 24,
    "l_knee": 25, "r_knee": 26,
    "l_ankle": 27, "r_ankle": 28,
    "l_heel": 29, "r_heel": 30,
    "l_foot_index": 31, "r_foot_index": 32,
}
COCO17_INDEX: dict[str, int] = {
    "nose": 0,
    "l_shoulder": 5, "r_shoulder": 6,
    "l_elbow": 7, "r_elbow": 8,
    "l_wrist": 9, "r_wrist": 10,
    "l_hip": 11, "r_hip": 12,
    "l_knee": 13, "r_knee": 14,
    "l_ankle": 15, "r_ankle": 16,
}

_TRUNK_NAMES = {"l_shoulder": "l_shoulder", "r_shoulder": "r_shoulder",
                "l_hip": "l_hip", "r_hip": "r_hip"}

# Human-readable joint names for the exported dictionary (athlete MediaPipe-33 space).
_JOINT_NAMES: dict[int, str] = {
    0: "nose",
    11: "left shoulder", 12: "right shoulder",
    13: "left elbow", 14: "right elbow",
    15: "left wrist", 16: "right wrist",
    23: "left hip", 24: "right hip",
    25: "left knee", 26: "right knee",
    27: "left ankle", 28: "right ankle",
    29: "left heel", 30: "right heel",
    31: "left foot (toe)", 32: "right foot (toe)",
}

# Sign conventions after direction normalization (v2): every *_x offset is reported ALONG THE KICK
# DIRECTION (positive = toward the target, "ahead"); every *_y offset is reported UPWARD
# (positive = above the reference). These strings ship with each metric row so the model never
# reverse-engineers an axis convention again.
_METRIC_MEANINGS: dict[str, str] = {
    "foot_com_vs_pro": "distance between the athlete's and pro's kicking-foot centers after alignment; always >= 0; smaller = closer to the pro",
    "foot_com_ball_offset_x": "kicking-foot center minus ball center along the kick direction: positive = foot AHEAD of the ball (toward target), negative = behind it",
    "foot_com_ball_offset_y": "kicking-foot center height vs ball center: positive = foot ABOVE the ball's center, negative = below it",
    "shank_angle": "ankle-to-knee segment vs vertical: 0 = vertical shin, larger = more tilted",
    "knee_angle": "interior hip-knee-ankle angle: 180 = fully straight leg, smaller = more bent",
    "thigh_angle": "knee-to-hip segment vs vertical: 0 = vertical thigh, larger = more tilted",
    "hip_angle": "interior shoulder-hip-knee angle: 180 = fully extended/open hip, smaller = more flexed",
    "hip_openness": "inter-hip distance / trunk length (sagittal proxy): smaller = hips square/closed to the camera, larger = hips rotated open",
    "trunk_lean": "trunk vs vertical signed along the kick direction: positive = leaning toward the target (over the ball), negative = leaning back/away",
    "trunk_com_offset_x": "trunk center of mass minus support-foot ankle along the kick direction: positive = body weight AHEAD of the plant foot (toward target)",
    "trunk_com_offset_y": "trunk center of mass height above the support-foot ankle: positive = above (larger = more upright/tall)",
    "trunk_com_ball_offset_x": "trunk center of mass minus ball center along the kick direction: positive = body AHEAD of / past the ball (toward target), negative = behind it",
    "plant_foot_ball_offset_x": "support-foot ankle minus ball center along the kick direction: positive = plant foot AHEAD of the ball (toward target), negative = behind it",
    "arm_abduction": "shoulder-to-wrist vs the downward trunk axis: 0 = arm hanging along the body, 90 = arm horizontal",
    "wrist_trunk_offset": "wrist horizontal distance from the trunk midline / trunk length: larger = arm held further out",
}

# Metrics whose x sign is meaningless without a resolved kick direction.
_DIRECTIONAL_X_METRICS = {
    "foot_com_ball_offset_x", "trunk_com_offset_x",
    "trunk_com_ball_offset_x", "plant_foot_ball_offset_x",
}


# ---------------------------------------------------------------------------
# Small numeric helpers — everything returns finite-or-None.
# ---------------------------------------------------------------------------


def _fin(v: Any) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if math.isfinite(f) else None


def _clamp(i: int, lo: int, hi: int) -> int:
    return max(lo, min(i, max(lo, hi)))


def _vec(a: tuple[float, float], b: tuple[float, float]) -> tuple[float, float]:
    return (b[0] - a[0], b[1] - a[1])


def _dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


def _mid(a: tuple[float, float], b: tuple[float, float]) -> tuple[float, float]:
    return ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0)


def _angle_deg(u: tuple[float, float], v: tuple[float, float]) -> Optional[float]:
    lu = math.hypot(*u)
    lv = math.hypot(*v)
    if lu < 1e-9 or lv < 1e-9:
        return None
    c = (u[0] * v[0] + u[1] * v[1]) / (lu * lv)
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def _vs_vertical_deg(v: tuple[float, float]) -> Optional[float]:
    # y grows downward, so "up" is (0, -1). Unsigned.
    return _angle_deg(v, (0.0, -1.0))


def _interior_deg(a: tuple[float, float], vertex: tuple[float, float],
                  c: tuple[float, float]) -> Optional[float]:
    return _angle_deg(_vec(vertex, a), _vec(vertex, c))


# ---------------------------------------------------------------------------
# Input sanitization
# ---------------------------------------------------------------------------


def _parse_keypoint(kp: Any) -> Optional[tuple[float, float]]:
    """[x,y] / [x,y,z,visibility] / {"x":..,"y":..} -> usable (x, y) or None."""
    if isinstance(kp, dict):
        x, y = kp.get("x"), kp.get("y")
        v = kp.get("visibility", 1.0)
    elif isinstance(kp, (list, tuple)) and len(kp) >= 2:
        x, y = kp[0], kp[1]
        v = kp[3] if len(kp) >= 4 else 1.0
    else:
        return None
    xf, yf, vf = _fin(x), _fin(y), _fin(v)
    if xf is None or yf is None or vf is None or vf < _MIN_VISIBILITY:
        return None
    return (xf, yf)


def _sanitize_pose(raw: Any) -> tuple[list[dict[int, tuple[float, float]]], int]:
    """Frames -> {joint index: (x, y)} of usable joints only. Null frames -> {}.
    Also returns the raw keypoint count (first non-empty frame) for layout detection."""
    frames: list[dict[int, tuple[float, float]]] = []
    kp_count = 0
    if not isinstance(raw, list):
        raw = []
    for fr in raw:
        if not isinstance(fr, list):
            frames.append({})
            continue
        if kp_count == 0 and fr:
            kp_count = len(fr)
        d: dict[int, tuple[float, float]] = {}
        for i, kp in enumerate(fr):
            pt = _parse_keypoint(kp)
            if pt is not None:
                d[i] = pt
        frames.append(d)
    return frames, kp_count


def _ball_center(box: Any) -> Optional[tuple[float, float]]:
    if not isinstance(box, (list, tuple)) or len(box) < 4:
        return None
    vals = [_fin(v) for v in box[:4]]
    if any(v is None for v in vals):
        return None
    return ((vals[0] + vals[2]) / 2.0, (vals[1] + vals[3]) / 2.0)


def _mirror_box(box: list[float]) -> list[float]:
    # [minX, minY, maxX, maxY] mirrored about x = 0.5.
    return [1.0 - box[2], box[1], 1.0 - box[0], box[3]]


# ---------------------------------------------------------------------------
# Alignment ports (DeadballGeometry parity)
# ---------------------------------------------------------------------------


def _com_x_displacement(frames: list[dict[int, tuple[float, float]]],
                        idx_map: dict[str, int],
                        end_frame: Optional[int],
                        window: int = _MIRROR_WINDOW) -> Optional[float]:
    """Hip-midpoint x-displacement over the window before `end_frame`; first/last-5-sample
    means resist single-frame glitches (comDisplacement parity)."""
    if end_frame is None or not frames:
        return None
    end = _clamp(end_frame, 0, len(frames) - 1)
    start = max(0, end - window)
    if end - start < 5:
        return None
    hip_idx = (idx_map["l_hip"], idx_map["r_hip"])
    xs: list[float] = []
    for fi in range(start, end + 1):
        pts = [frames[fi][i] for i in hip_idx if i in frames[fi]]
        if not pts:
            continue
        xs.append(sum(p[0] for p in pts) / len(pts))
    if len(xs) < 5:
        return None
    k = min(5, len(xs))
    return sum(xs[-k:]) / k - sum(xs[:k]) / k


def _scale_factor(a_frames: list[dict[int, tuple[float, float]]], a_idx: dict[str, int],
                  p_frames: list[dict[int, tuple[float, float]]], p_idx: dict[str, int],
                  frame_pairs: list[tuple[int, int]]) -> Optional[float]:
    """Mean athlete/pro segment-length ratio (L/R shank, thigh, torso) at the paired frames
    (computeProScaleFactor parity). None when no matched segment is measurable."""
    if not a_frames or not p_frames or not frame_pairs:
        return None
    segs = (("ankle", "knee"), ("knee", "hip"), ("hip", "shoulder"))
    total, count = 0.0, 0
    for af, pf in frame_pairs:
        A = a_frames[_clamp(af, 0, len(a_frames) - 1)]
        P = p_frames[_clamp(pf, 0, len(p_frames) - 1)]
        for side in ("l", "r"):
            for a_name, b_name in segs:
                ia, ib = a_idx.get(f"{side}_{a_name}"), a_idx.get(f"{side}_{b_name}")
                ja, jb = p_idx.get(f"{side}_{a_name}"), p_idx.get(f"{side}_{b_name}")
                if None in (ia, ib, ja, jb):
                    continue
                if ia not in A or ib not in A or ja not in P or jb not in P:
                    continue
                p_len = _dist(P[ja], P[jb])
                if p_len > 0.001:
                    total += _dist(A[ia], A[ib]) / p_len
                    count += 1
    return total / count if count else None


def _resolve(frames: list[dict[int, tuple[float, float]]], idx_map: dict[str, int],
             base: int, names_map: dict[str, str],
             need: str = "all") -> tuple[Optional[dict[str, tuple[float, float]]], Optional[int]]:
    """Nearest frame within ±3 of `base` where the named joints are usable. Names absent from
    the layout (COCO-17 heel/foot_index) are skipped, not required."""
    n = len(frames)
    if n == 0:
        return None, None
    base = _clamp(base, 0, n - 1)
    wanted = [(g, idx_map[lm]) for g, lm in names_map.items() if lm in idx_map]
    if not wanted:
        return None, None
    for off in _SEARCH_OFFSETS:
        f = base + off
        if f < 0 or f >= n:
            continue
        fr = frames[f]
        pts = {g: fr[i] for g, i in wanted if i in fr}
        if (need == "all" and len(pts) == len(wanted)) or (need == "any" and pts):
            return pts, f
    return None, None


def _derive_kick_side(frames: list[dict[int, tuple[float, float]]], idx_map: dict[str, int],
                      start: int, end: int) -> Optional[str]:
    """The foot (ankle) with the larger x-range over transition..contact is the kicking foot."""
    if not frames or end < start:
        return None
    ranges: dict[str, float] = {}
    for side in ("left", "right"):
        i = idx_map[f"{side[0]}_ankle"]
        xs = [frames[f][i][0] for f in range(max(0, start), min(end, len(frames) - 1) + 1)
              if i in frames[f]]
        if len(xs) >= 2:
            ranges[side] = max(xs) - min(xs)
    if len(ranges) < 2 or abs(ranges["left"] - ranges["right"]) < 1e-9:
        return None
    return max(ranges, key=lambda s: ranges[s])


def _pixel_height(frames: list[dict[int, tuple[float, float]]], idx_map: dict[str, int],
                  key_frames: list[int], frame_h: float) -> Optional[float]:
    """Max head-to-ankle vertical pixel span across the key frames (usable joints only,
    ±3 nearest-usable per frame)."""
    nose_i = idx_map["nose"]
    ankle_is = (idx_map["l_ankle"], idx_map["r_ankle"])
    best: Optional[float] = None
    n = len(frames)
    for kf in key_frames:
        if n == 0:
            break
        base = _clamp(kf, 0, n - 1)
        for off in _SEARCH_OFFSETS:
            f = base + off
            if f < 0 or f >= n:
                continue
            fr = frames[f]
            ankles = [fr[i][1] for i in ankle_is if i in fr]
            if nose_i not in fr or not ankles:
                continue
            span = (max(ankles) - fr[nose_i][1]) * frame_h
            if span > 0 and (best is None or span > best):
                best = span
            break
    return best


def _strip_nonfinite(obj: Any) -> Any:
    """Defense in depth — no NaN/Infinity may ever leave this module."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _strip_nonfinite(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_strip_nonfinite(v) for v in obj]
    return obj


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def compute_kick_analysis(
    athlete_pose: Any,
    athlete_trajectory: Any,
    athlete_orig_ball: Any,
    athlete_metadata: Any,
    pro_pose: Any,
    pro_trajectory: Any,
    pro_orig_ball: Any,
    *,
    contact_frame: int,
    transition_frame: int,
    fps: float,
    strike_foot: Optional[str] = None,
    direction: Optional[str] = None,
    athlete_height_meters: Optional[float] = None,
    pro_fps: Optional[float] = None,
) -> dict:
    notes: list[str] = []

    def note(msg: str) -> None:
        if msg not in notes:
            notes.append(msg)

    # --- Sanitize inputs -------------------------------------------------
    a_frames, _ = _sanitize_pose(athlete_pose)
    p_frames, p_kp_count = _sanitize_pose(pro_pose)
    a_idx = MP33_INDEX
    pro_layout = "coco17" if 0 < p_kp_count <= 20 else "mediapipe33"
    p_idx = COCO17_INDEX if pro_layout == "coco17" else MP33_INDEX
    if pro_layout == "coco17":
        note("pro foot centroid degrades to ankle only (COCO-17 pro has no heel/foot_index)")

    meta = athlete_metadata if isinstance(athlete_metadata, dict) else {}
    W = _fin(meta.get("frameWidth")) or 1920.0
    H = _fin(meta.get("frameHeight")) or 1080.0
    m_per_px = _fin(meta.get("m_per_px"))
    if m_per_px is not None and m_per_px <= 0:
        m_per_px = None

    a_traj = athlete_trajectory if isinstance(athlete_trajectory, dict) else {}
    p_traj = pro_trajectory if isinstance(pro_trajectory, dict) else {}

    n = len(a_frames)
    fps_v = _fin(fps)
    if fps_v is None or fps_v <= 0:
        fps_v = 240.0
        note("invalid fps — assumed 240 for the follow-through offset")

    # --- Key frames ------------------------------------------------------
    # followThrough = contact + 50 frames specified at 240 fps, scaled, clamped to the clip.
    bs_i = _clamp(int(transition_frame), 0, n - 1)
    cf_i = _clamp(int(contact_frame), 0, n - 1)
    ft_intended = cf_i + int(math.floor(50.0 * fps_v / 240.0 + 0.5))
    ft_i = _clamp(ft_intended, 0, n - 1)
    follow_through_clamped = ft_i != ft_intended
    if follow_through_clamped:
        note("follow-through frame clamped to the end of the clip (clip ends < 0.2 s after contact)")
    key_frames = {"backswing": bs_i, "contact": cf_i, "followThrough": ft_i}
    key_frames_valid = 0 <= transition_frame <= contact_frame < n
    if not key_frames_valid:
        note("backswing/contact frame indices are outside the pose clip or out of order")

    # --- Athlete kicking side -------------------------------------------
    # The Firestore field and the kinematic derivation are independent signals; both are always
    # computed so a disagreement can be surfaced instead of silently trusting either one (v2:
    # the on-device strike_foot heuristic is occlusion-sensitive and has produced flipped values).
    sf_field = strike_foot.lower() if isinstance(strike_foot, str) and strike_foot.lower() in ("left", "right") else None
    derived_kick = _derive_kick_side(a_frames, a_idx, bs_i, cf_i)
    if sf_field is not None:
        a_kick = sf_field
        kick_side_source = "strike_foot"
    elif derived_kick is not None:
        a_kick = derived_kick
        kick_side_source = "derived"
    else:
        a_kick = "right"
        kick_side_source = "assumed"
        note("strike foot unresolved — assumed right")
    if sf_field is not None and derived_kick is not None and sf_field != derived_kick:
        side_agreement = "disagree"
        note("strike_foot field and kinematic derivation disagree — side labels may be flipped")
    elif sf_field is not None and derived_kick is not None:
        side_agreement = "agree"
    else:
        side_agreement = "single_signal"
    side_confidence = "low" if (side_agreement == "disagree" or kick_side_source == "assumed") else "high"

    # --- Pro frame shift (proFrameShift parity) --------------------------
    p_cf = _fin(p_traj.get("contact_frame"))
    p_bs = _fin(p_traj.get("transition_frame"))
    pro_fps_v = _fin(pro_fps)
    if pro_fps_v is not None and pro_fps_v <= 0:
        pro_fps_v = None
    if pro_fps_v is None:
        note("pro capture FPS unavailable — pro temporal comparison is unavailable")
    shift = int(round(p_cf - cf_i)) if p_cf is not None and p_cf >= 0 else 0

    # --- Mirror decision (shouldMirrorPro parity) ------------------------
    a_disp = _com_x_displacement(a_frames, a_idx, bs_i)
    p_end = int(p_bs) if p_bs is not None else (int(p_cf) if p_cf is not None else None)
    p_disp = _com_x_displacement(p_frames, p_idx, p_end)
    mirror_conclusive = (a_disp is not None and p_disp is not None
                         and abs(a_disp) > _MIRROR_MIN_DISPLACEMENT
                         and abs(p_disp) > _MIRROR_MIN_DISPLACEMENT)
    mirrored = mirror_conclusive and (a_disp > 0) != (p_disp > 0)
    if not mirror_conclusive:
        note("pro mirror test inconclusive — assumed same facing as the pro")

    # --- Direction (signs every directional x metric and trunk_lean) -----
    dir_v = direction if direction in ("left_to_right", "right_to_left") else None
    direction_source = "rep_doc" if dir_v is not None else None
    if dir_v is None:
        raw_dir = a_traj.get("direction")
        dir_v = raw_dir if raw_dir in ("left_to_right", "right_to_left") else None
        direction_source = "trajectory" if dir_v is not None else None
    if dir_v is None and a_disp is not None and abs(a_disp) > _MIRROR_MIN_DISPLACEMENT:
        dir_v = "left_to_right" if a_disp > 0 else "right_to_left"
        direction_source = "inferred_from_run_up"
        note("kick direction inferred from run-up displacement")
    if direction_source is None:
        direction_source = "unknown"
    toward = {"left_to_right": 1.0, "right_to_left": -1.0}.get(dir_v)
    if toward is None:
        note("direction unknown — trunk_lean unsigned and directional x-offsets unavailable")

    # --- Uniform scale about (0.5, 0.5) ----------------------------------
    pairs: list[tuple[int, int]] = []
    if p_bs is not None:
        pairs.append((bs_i, int(p_bs)))
    if p_cf is not None:
        pairs.append((cf_i, int(p_cf)))
    scale_v = _scale_factor(a_frames, a_idx, p_frames, p_idx, pairs)
    if scale_v is None or scale_v <= 0:
        scale_v = 1.0
        note("pro scale fallback 1.0 (no matched segment lengths)")

    # --- Pro kicking side ------------------------------------------------
    p_start = int(p_bs) if p_bs is not None else max(0, int(p_cf) - 30 if p_cf is not None else 0)
    p_contact_i = int(p_cf) if p_cf is not None else 0
    p_kick = _derive_kick_side(p_frames, p_idx, p_start, p_contact_i)
    if p_kick is None:
        # A mirrored pro kicks with the anatomically opposite foot of the athlete.
        p_kick = ("left" if a_kick == "right" else "right") if mirrored else a_kick

    # --- Offset (ball-center, plant-foot fallback) -----------------------
    alignment = "failed"
    off_x = off_y = 0.0
    a_ball = _ball_center(athlete_orig_ball)
    p_ball_box = pro_orig_ball if isinstance(pro_orig_ball, (list, tuple)) and len(pro_orig_ball) >= 4 else None
    if p_ball_box is not None and mirrored:
        vals = [_fin(v) for v in p_ball_box[:4]]
        p_ball_box = _mirror_box(vals) if all(v is not None for v in vals) else None
    p_ball = _ball_center(p_ball_box)
    if a_ball is not None and p_ball is not None:
        off_x = a_ball[0] - ((p_ball[0] - 0.5) * scale_v + 0.5)
        off_y = a_ball[1] - ((p_ball[1] - 0.5) * scale_v + 0.5)
        alignment = "ball_center"
    else:
        # Swift parity: support-ankle difference, mirrored but NOT scaled.
        a_sup = "left" if a_kick == "right" else "right"
        p_sup = "left" if p_kick == "right" else "right"
        apts, _f = _resolve(a_frames, a_idx, cf_i, {"ankle": f"{a_sup[0]}_ankle"})
        ppts, _f = _resolve(p_frames, p_idx, _clamp(cf_i + shift, 0, max(0, len(p_frames) - 1)),
                            {"ankle": f"{p_sup[0]}_ankle"})
        if apts is not None and ppts is not None:
            px_, py_ = ppts["ankle"]
            if mirrored:
                px_ = 1.0 - px_
            off_x = apts["ankle"][0] - px_
            off_y = apts["ankle"][1] - py_
            alignment = "plant_foot"
        else:
            note("pro alignment failed — offset (0, 0)")

    # --- Figures ---------------------------------------------------------
    def a_px(pt: tuple[float, float]) -> tuple[float, float]:
        return (pt[0] * W, pt[1] * H)

    def p_px(pt: tuple[float, float]) -> tuple[float, float]:
        # transform_pro_point: offset + (mirror(p) - center) * scale + center, then pixels.
        x, y = pt
        if mirrored:
            x = 1.0 - x
        return ((off_x + (x - 0.5) * scale_v + 0.5) * W,
                (off_y + (y - 0.5) * scale_v + 0.5) * H)

    p_hi = max(0, len(p_frames) - 1)
    ath = {"label": "athlete", "frames": a_frames, "idx": a_idx, "kick": a_kick,
           "px": a_px, "base": lambda kf: _clamp(kf, 0, max(0, n - 1))}
    def pro_base(kf: int) -> int:
        if p_cf is not None and pro_fps_v is not None:
            return _clamp(int(round(p_cf + (kf - cf_i) * pro_fps_v / fps_v)), 0, p_hi)
        return _clamp(kf + shift, 0, p_hi)

    def pro_metric_base(kf: int) -> int:
        return _clamp(int(p_bs), 0, p_hi) if kf == bs_i and p_bs is not None else pro_base(kf)

    prf = {"label": "pro", "frames": p_frames, "idx": p_idx, "kick": p_kick,
           "px": p_px, "base": pro_base}

    def _pre(fig: dict, role: str) -> str:
        kick = fig["kick"]
        other = "left" if kick == "right" else "right"
        side = {"kicking": kick, "support": other, "trail": kick, "lead": other}[role]
        return side[0]

    def _aid(name: str) -> int:
        return MP33_INDEX[name]

    def _aids(role: Optional[str], *joints: str) -> list[int]:
        if role is None:
            return [_aid(j) for j in joints]
        p = _pre(ath, role)
        return [_aid(f"{p}_{j}") for j in joints]

    # --- Scale to meters -------------------------------------------------
    a_px_h = _pixel_height(a_frames, a_idx, [bs_i, cf_i, ft_i], H)
    p_key_frames = [int(v) for v in (p_bs, p_cf) if v is not None]
    p_px_h = _pixel_height(p_frames, p_idx, p_key_frames, H)

    ahm = _fin(athlete_height_meters)
    if ahm is not None and ahm <= 0:
        ahm = None
    if m_per_px is not None:
        scale_source, mpp_eff = "aruco", m_per_px
    elif ahm is not None and a_px_h is not None:
        scale_source, mpp_eff = "athlete_height", ahm / a_px_h
    elif p_px_h is not None and p_px_h * scale_v > 0:
        scale_source, mpp_eff = "pro_height", _ASSUMED_PRO_HEIGHT_M / (p_px_h * scale_v)
    else:
        scale_source, mpp_eff = "none", None
        note("no scale reference — meters unavailable")
    scale_block = {
        "source": scale_source,
        "mPerPx": m_per_px if scale_source == "aruco" else None,
        "assumedProHeightMeters": _ASSUMED_PRO_HEIGHT_M if scale_source == "pro_height" else None,
    }

    ball_px = a_px(a_ball) if a_ball is not None else None

    # --- Metric rows -----------------------------------------------------
    rows: list[dict] = []

    def _missing_msg(fig: dict, kf: int, names_map: dict[str, str]) -> str:
        base = fig["base"](kf)
        fr = fig["frames"][base] if fig["frames"] else {}
        known = [lm for lm in names_map.values() if lm in fig["idx"]]
        missing = sorted({lm for lm in known if fig["idx"][lm] not in fr}) or known
        return f"{fig['label']}: no usable {'/'.join(missing)} within ±3 of frame {base}"

    def _fig_value(fig: dict, kf: int, names_map: dict[str, str],
                   fn: Callable[[dict], Optional[float]],
                   need: str) -> tuple[Optional[float], Optional[int], Optional[str]]:
        base = pro_metric_base(kf) if fig["label"] == "pro" else fig["base"](kf)
        pts, f = _resolve(fig["frames"], fig["idx"], base, names_map, need)
        if pts is None:
            return None, None, _missing_msg(fig, kf, names_map)
        P = {g: fig["px"](pt) for g, pt in pts.items()}
        try:
            v = fn(P)
        except (KeyError, ZeroDivisionError, ValueError):
            v = None
        return _fin(v), f, None

    def _meaning(metric: str) -> Optional[str]:
        if metric == "trunk_lean" and toward is None:
            return "trunk vs vertical, UNSIGNED (kick direction unknown): 0 = upright, larger = more tilted in an unknown direction"
        return _METRIC_MEANINGS.get(metric)

    def _row(frame_key: str, metric: str, role: Optional[str], units: str,
             athlete: Optional[float], pro: Optional[float], joint_ids: list[int],
             a_m: Optional[float], p_m: Optional[float], valid: bool,
             note_txt: Optional[str]) -> dict:
        delta = athlete - pro if athlete is not None and pro is not None else None
        d_m = a_m - p_m if a_m is not None and p_m is not None else None
        rid = f"{frame_key}.{metric}" + (f".{role}" if role else "")
        return {"id": rid, "frameKey": frame_key, "metric": metric, "side": role,
                "athlete": athlete, "pro": pro, "delta": delta, "units": units,
                "athleteMeters": a_m, "proMeters": p_m, "deltaMeters": d_m,
                "jointIds": joint_ids, "valid": valid, "note": note_txt,
                "meaning": _meaning(metric)}

    def add_row(frame_key: str, kf: int, metric: str, role: Optional[str], units: str,
                names_fn: Callable[[dict], dict[str, str]],
                fn: Callable[[dict], Optional[float]], joint_ids: list[int],
                needs_ball: bool = False, need: str = "all",
                needs_direction: bool = False) -> None:
        if needs_ball and ball_px is None:
            rows.append(_row(frame_key, metric, role, units, None, None, joint_ids,
                             None, None, False, "no ball detection for this rep"))
            return
        if needs_direction and toward is None:
            rows.append(_row(frame_key, metric, role, units, None, None, joint_ids,
                             None, None, False,
                             "kick direction unknown — signed offset not interpretable"))
            return
        bits: list[str] = []
        a_val, a_f, a_miss = _fig_value(ath, kf, names_fn(ath), fn, need)
        p_val, p_f, p_miss = _fig_value(prf, kf, names_fn(prf), fn, need)
        if frame_key == "followThrough" and pro_fps_v is None:
            p_val = None
            p_miss = "pro follow-through timing unavailable without pro capture FPS"
        if a_miss:
            bits.append(a_miss)
        elif a_f is not None and a_f != ath["base"](kf):
            bits.append(f"athlete pose from frame {a_f}")
        if p_miss:
            bits.append(p_miss)
        elif p_f is not None and p_f != prf["base"](kf):
            bits.append(f"pro pose from frame {p_f}")
        if units == "normalized":
            # Primary value = pixels / athlete pixel height; meters = pixels * m/px.
            if a_px_h is None and (a_val is not None or p_val is not None):
                bits.append("athlete pixel height unavailable")
            athlete = a_val / a_px_h if a_val is not None and a_px_h else None
            pro = p_val / a_px_h if p_val is not None and a_px_h else None
            a_m = a_val * mpp_eff if a_val is not None and mpp_eff is not None else None
            p_m = p_val * mpp_eff if p_val is not None and mpp_eff is not None else None
        else:
            athlete, pro, a_m, p_m = a_val, p_val, None, None
        valid = athlete is not None
        if not valid and not bits:
            bits.append("value not computable")
        rows.append(_row(frame_key, metric, role, units, athlete, pro, joint_ids,
                         a_m, p_m, valid, "; ".join(bits) or None))
        rows[-1].update({"athleteFrame": a_f, "proFrame": p_f if pro is not None else None})

    # Shared geometry pieces (all in aspect-corrected pixel space).
    def _com4(P: dict) -> tuple[float, float]:
        pts = [P["l_shoulder"], P["r_shoulder"], P["l_hip"], P["r_hip"]]
        return (sum(p[0] for p in pts) / 4.0, sum(p[1] for p in pts) / 4.0)

    def _trunk_len(P: dict) -> float:
        return _dist(_mid(P["l_shoulder"], P["r_shoulder"]), _mid(P["l_hip"], P["r_hip"]))

    def _centroid(P: dict) -> Optional[tuple[float, float]]:
        pts = list(P.values())
        if not pts:
            return None
        return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))

    def leg_names(role: str, *joints: str) -> Callable[[dict], dict[str, str]]:
        return lambda fig: {j: f"{_pre(fig, role)}_{j}" for j in joints}

    def trunk_plus(role: str, *joints: str) -> Callable[[dict], dict[str, str]]:
        return lambda fig: {**_TRUNK_NAMES, **{j: f"{_pre(fig, role)}_{j}" for j in joints}}

    foot_names = leg_names("kicking", "ankle", "heel", "foot_index")
    foot_ids = _aids("kicking", "ankle", "heel", "foot_index")
    sup_ankle_id = _aids("support", "ankle")

    def f_trunk_lean(P: dict) -> Optional[float]:
        v = _vec(_mid(P["l_hip"], P["r_hip"]), _mid(P["l_shoulder"], P["r_shoulder"]))
        if toward is None:
            return _vs_vertical_deg(v)
        if math.hypot(*v) < 1e-9:
            return None
        return math.degrees(math.atan2(v[0] * toward, -v[1]))

    def f_hip_openness(P: dict) -> Optional[float]:
        tl = _trunk_len(P)
        return _dist(P["l_hip"], P["r_hip"]) / tl if tl > 1e-9 else None

    def f_arm_abduction(P: dict) -> Optional[float]:
        down = _vec(_mid(P["l_shoulder"], P["r_shoulder"]), _mid(P["l_hip"], P["r_hip"]))
        return _angle_deg(_vec(P["shoulder"], P["wrist"]), down)

    def f_wrist_trunk(P: dict) -> Optional[float]:
        tl = _trunk_len(P)
        if tl < 1e-9:
            return None
        mid_x = (_mid(P["l_shoulder"], P["r_shoulder"])[0] + _mid(P["l_hip"], P["r_hip"])[0]) / 2.0
        return abs(P["wrist"][0] - mid_x) / tl

    # v2 sign conventions: x differences are multiplied by `toward` so positive always means
    # "toward the target / ahead"; y differences are negated so positive always means "above"
    # (image y grows downward). Callers of direction-dependent metrics pass needs_direction=True,
    # which invalidates the row before these lambdas run when `toward` is None.
    def f_foot_ball_x(P: dict) -> Optional[float]:
        c = _centroid(P)
        return (c[0] - ball_px[0]) * toward if c is not None else None

    def f_foot_ball_y(P: dict) -> Optional[float]:
        c = _centroid(P)
        return -(c[1] - ball_px[1]) if c is not None else None

    if ball_px is not None:
        note("ball-offset metrics at followThrough use the pre-contact ball position (the ball has left the scene)")

    for frame_key, kf in (("backswing", bs_i), ("contact", cf_i), ("followThrough", ft_i)):
        # foot_com_vs_pro — cross-figure distance, so not via add_row.
        a_c, a_f = _resolve(a_frames, a_idx, ath["base"](kf), foot_names(ath), need="any")
        p_c, p_f = _resolve(p_frames, p_idx, pro_metric_base(kf), foot_names(prf), need="any")
        if frame_key == "followThrough" and pro_fps_v is None:
            p_c = None
        bits: list[str] = []
        if a_c is None:
            bits.append(_missing_msg(ath, kf, foot_names(ath)))
        elif a_f != ath["base"](kf):
            bits.append(f"athlete pose from frame {a_f}")
        if p_c is None:
            bits.append(_missing_msg(prf, kf, foot_names(prf)))
        elif p_f != prf["base"](kf):
            bits.append(f"pro pose from frame {p_f}")
        d_px: Optional[float] = None
        if a_c is not None and p_c is not None:
            ac = _centroid({g: a_px(pt) for g, pt in a_c.items()})
            pc = _centroid({g: p_px(pt) for g, pt in p_c.items()})
            if ac is not None and pc is not None:
                d_px = _fin(_dist(ac, pc))
        if d_px is not None and a_px_h:
            d_norm = d_px / a_px_h
            d_m = d_px * mpp_eff if mpp_eff is not None else None
            rows.append(_row(frame_key, "foot_com_vs_pro", "kicking", "normalized",
                             d_norm, 0.0, foot_ids, d_m, 0.0 if d_m is not None else None,
                             True, "; ".join(bits) or None))
        else:
            if d_px is not None and not a_px_h:
                bits.append("athlete pixel height unavailable")
            rows.append(_row(frame_key, "foot_com_vs_pro", "kicking", "normalized",
                             None, None, foot_ids, None, None, False,
                             "; ".join(bits) or "value not computable"))

        add_row(frame_key, kf, "foot_com_ball_offset_x", "kicking", "normalized",
                foot_names, f_foot_ball_x, foot_ids, needs_ball=True,
                needs_direction=True)
        add_row(frame_key, kf, "foot_com_ball_offset_y", "kicking", "normalized",
                foot_names, f_foot_ball_y, foot_ids, needs_ball=True)

        for role in ("kicking", "support"):
            add_row(frame_key, kf, "shank_angle", role, "degrees",
                    leg_names(role, "ankle", "knee"),
                    lambda P: _vs_vertical_deg(_vec(P["ankle"], P["knee"])),
                    _aids(role, "ankle", "knee"))
        for role in ("kicking", "support"):
            add_row(frame_key, kf, "knee_angle", role, "degrees",
                    leg_names(role, "hip", "knee", "ankle"),
                    lambda P: _interior_deg(P["hip"], P["knee"], P["ankle"]),
                    _aids(role, "hip", "knee", "ankle"))
        for role in ("kicking", "support"):
            add_row(frame_key, kf, "thigh_angle", role, "degrees",
                    leg_names(role, "knee", "hip"),
                    lambda P: _vs_vertical_deg(_vec(P["knee"], P["hip"])),
                    _aids(role, "knee", "hip"))
        for role in ("kicking", "support"):
            add_row(frame_key, kf, "hip_angle", role, "degrees",
                    leg_names(role, "shoulder", "hip", "knee"),
                    lambda P: _interior_deg(P["shoulder"], P["hip"], P["knee"]),
                    _aids(role, "shoulder", "hip", "knee"))

        add_row(frame_key, kf, "hip_openness", None, "ratio",
                lambda fig: dict(_TRUNK_NAMES), f_hip_openness,
                [_aid("l_shoulder"), _aid("r_shoulder"), _aid("l_hip"), _aid("r_hip")])
        add_row(frame_key, kf, "trunk_lean", None, "degrees",
                lambda fig: dict(_TRUNK_NAMES), f_trunk_lean,
                [_aid("l_shoulder"), _aid("r_shoulder"), _aid("l_hip"), _aid("r_hip")])
        add_row(frame_key, kf, "trunk_com_offset_x", None, "normalized",
                trunk_plus("support", "ankle"),
                lambda P: (_com4(P)[0] - P["ankle"][0]) * toward,
                [_aid("l_shoulder"), _aid("r_shoulder"), _aid("l_hip"), _aid("r_hip")] + sup_ankle_id,
                needs_direction=True)
        add_row(frame_key, kf, "trunk_com_offset_y", None, "normalized",
                trunk_plus("support", "ankle"),
                lambda P: -(_com4(P)[1] - P["ankle"][1]),
                [_aid("l_shoulder"), _aid("r_shoulder"), _aid("l_hip"), _aid("r_hip")] + sup_ankle_id)
        add_row(frame_key, kf, "trunk_com_ball_offset_x", None, "normalized",
                lambda fig: dict(_TRUNK_NAMES),
                lambda P: (_com4(P)[0] - ball_px[0]) * toward,
                [_aid("l_shoulder"), _aid("r_shoulder"), _aid("l_hip"), _aid("r_hip")],
                needs_ball=True, needs_direction=True)
        add_row(frame_key, kf, "plant_foot_ball_offset_x", "support", "normalized",
                leg_names("support", "ankle"),
                lambda P: (P["ankle"][0] - ball_px[0]) * toward,
                sup_ankle_id, needs_ball=True, needs_direction=True)

        for role in ("lead", "trail"):
            add_row(frame_key, kf, "arm_abduction", role, "degrees",
                    trunk_plus(role, "shoulder", "wrist"), f_arm_abduction,
                    _aids(role, "shoulder", "wrist"))
        for role in ("lead", "trail"):
            add_row(frame_key, kf, "wrist_trunk_offset", role, "ratio",
                    trunk_plus(role, "wrist"), f_wrist_trunk,
                    _aids(role, "wrist"))

    # --- Time series: COM trajectory + joint-angle sequencing (v2) -------
    # Sampled over [backswing - 60, followThrough + 20] (specified at 240 fps, scaled), ~30
    # points plus the four COM anchors. Values are per exact frame (no ±3 search) — a frame
    # with missing joints yields nulls rather than borrowing neighbors, so the series show
    # real tracking gaps instead of papering over them.
    def _scaled(frames_at_240: float) -> int:
        return int(round(frames_at_240 * fps_v / 240.0))

    def _rnd(v: Optional[float], nd: int) -> Optional[float]:
        return round(v, nd) if v is not None else None

    def _fig_frame(fig: dict, f: int) -> dict[int, tuple[float, float]]:
        frames = fig["frames"]
        if not frames:
            return {}
        return frames[_clamp(fig["base"](f), 0, len(frames) - 1)]

    def _named_px(fig: dict, fr: dict[int, tuple[float, float]],
                  name: str) -> Optional[tuple[float, float]]:
        i = fig["idx"].get(name)
        if i is None or i not in fr:
            return None
        return fig["px"](fr[i])

    def _com_px(fig: dict, fr: dict) -> Optional[tuple[float, float]]:
        pts = [_named_px(fig, fr, nm) for nm in ("l_shoulder", "r_shoulder", "l_hip", "r_hip")]
        if any(p is None for p in pts):
            return None
        return (sum(p[0] for p in pts) / 4.0, sum(p[1] for p in pts) / 4.0)

    def _com_point(fig: dict, f: int) -> dict:
        out: dict = {"frame": f, "msFromContact": _rnd((f - cf_i) / fps_v * 1000.0, 1),
                     "sourceFrame": fig["base"](f), "sourceFps": fps_v if fig["label"] == "athlete" else pro_fps_v,
                     "x": None, "y": None}
        if ball_px is None or toward is None or not a_px_h:
            return out
        com = _com_px(fig, _fig_frame(fig, f))
        if com is None:
            return out
        out["x"] = _rnd((com[0] - ball_px[0]) * toward / a_px_h, 3)
        out["y"] = _rnd(-(com[1] - ball_px[1]) / a_px_h, 3)
        return out

    def _leg_angles(fig: dict, fr: dict, role: str) -> dict[str, Optional[float]]:
        p = _pre(fig, role)
        hip = _named_px(fig, fr, f"{p}_hip")
        knee = _named_px(fig, fr, f"{p}_knee")
        ankle = _named_px(fig, fr, f"{p}_ankle")
        shoulder = _named_px(fig, fr, f"{p}_shoulder")
        return {
            "knee": _interior_deg(hip, knee, ankle) if None not in (hip, knee, ankle) else None,
            "hip": _interior_deg(shoulder, hip, knee) if None not in (shoulder, hip, knee) else None,
            "thigh": _vs_vertical_deg(_vec(knee, hip)) if None not in (knee, hip) else None,
            "shank": _vs_vertical_deg(_vec(ankle, knee)) if None not in (ankle, knee) else None,
        }

    def _trunk_lean_at(fig: dict, fr: dict) -> Optional[float]:
        pts = {nm: _named_px(fig, fr, nm) for nm in ("l_shoulder", "r_shoulder", "l_hip", "r_hip")}
        if any(p is None for p in pts.values()):
            return None
        return f_trunk_lean(pts)

    def _angles_point(fig: dict, f: int) -> dict:
        fr = _fig_frame(fig, f)
        kick = _leg_angles(fig, fr, "kicking")
        sup = _leg_angles(fig, fr, "support")
        return {"frame": f, "msFromContact": _rnd((f - cf_i) / fps_v * 1000.0, 1),
                "sourceFrame": fig["base"](f), "sourceFps": fps_v if fig["label"] == "athlete" else pro_fps_v,
                "kickingKnee": _rnd(kick["knee"], 1), "kickingHip": _rnd(kick["hip"], 1),
                "kickingThigh": _rnd(kick["thigh"], 1), "kickingShank": _rnd(kick["shank"], 1),
                "supportKnee": _rnd(sup["knee"], 1), "supportHip": _rnd(sup["hip"], 1),
                "supportThigh": _rnd(sup["thigh"], 1), "supportShank": _rnd(sup["shank"], 1),
                "trunkLean": _rnd(_trunk_lean_at(fig, fr), 1)}

    series_blocks: dict[str, Any] = {}
    dense_detail: dict[str, Any] = {}
    if n > 0:
        lo = max(0, bs_i - _scaled(60))
        hi = min(n - 1, ft_i + _scaled(20))
        count = min(30, hi - lo + 1)
        step = (hi - lo) / (count - 1) if count > 1 else 1.0
        sample_frames = sorted({lo + int(round(i * step)) for i in range(count)} | {bs_i, cf_i, ft_i})

        anchor_frames = {
            "backswingMinus50": max(lo, bs_i - _scaled(50)),
            "backswing": bs_i,
            "contact": cf_i,
            "contactPlus50": min(hi, cf_i + _scaled(50)),
        }

        def _events(fig: dict) -> dict:
            full: dict[int, dict[str, Optional[float]]] = {
                f: _leg_angles(fig, _fig_frame(fig, f), "kicking") for f in range(lo, hi + 1)
            }

            def _ang_vel(key: str, f: int) -> Optional[float]:
                a = full.get(f - 2, {}).get(key)
                b = full.get(f + 2, {}).get(key)
                if a is None or b is None:
                    return None
                return (b - a) * fps_v / 4.0

            def _peak(key: str, w_lo: int, w_hi: int) -> Optional[dict]:
                best_v: Optional[float] = None
                best_f: Optional[int] = None
                for f in range(max(lo + 2, w_lo), min(hi - 2, w_hi) + 1):
                    v = _ang_vel(key, f)
                    if v is not None and (best_v is None or abs(v) > abs(best_v)):
                        best_v, best_f = v, f
                if best_v is None or best_f is None:
                    return None
                return {"degPerS": _rnd(best_v, 0), "frame": best_f,
                        "msFromContact": _rnd((best_f - cf_i) / fps_v * 1000.0, 1)}

            thigh_peak = _peak("thigh", bs_i, cf_i + _scaled(5))
            shank_peak = _peak("shank", bs_i, cf_i + _scaled(5))
            p2d: Optional[bool] = None
            if thigh_peak is not None and shank_peak is not None:
                p2d = thigh_peak["frame"] < shank_peak["frame"]

            min_knee_v: Optional[float] = None
            min_knee_f: Optional[int] = None
            for f in range(max(lo, bs_i - _scaled(10)), cf_i + 1):
                v = full.get(f, {}).get("knee")
                if v is not None and (min_knee_v is None or v < min_knee_v):
                    min_knee_v, min_knee_f = v, f
            max_flex = None
            if min_knee_v is not None and min_knee_f is not None:
                max_flex = {"deg": _rnd(min_knee_v, 1), "frame": min_knee_f,
                            "msFromContact": _rnd((min_knee_f - cf_i) / fps_v * 1000.0, 1)}

            speed = None
            p = _pre(fig, "kicking")
            if cf_i - 3 >= 0:
                a1 = _named_px(fig, _fig_frame(fig, cf_i - 3), f"{p}_ankle")
                a2 = _named_px(fig, _fig_frame(fig, cf_i - 1), f"{p}_ankle")
                if a1 is not None and a2 is not None:
                    px_per_s = _dist(a1, a2) * fps_v / 2.0
                    speed = {
                        "metersPerS": _rnd(px_per_s * mpp_eff, 2) if mpp_eff is not None else None,
                        "athleteHeightsPerS": _rnd(px_per_s / a_px_h, 2) if a_px_h else None,
                    }

            return {"maxKneeFlexion": max_flex,
                    "peakThighAngularVel": thigh_peak,
                    "peakShankAngularVel": shank_peak,
                    "proximalToDistalOrderOK": p2d,
                    "backswingKneeAngleDeg": _rnd(full.get(bs_i, {}).get("knee"), 1),
                    "kickFootSpeedJustBeforeContact": speed}

        # Dense detail stays out of model initial context and durable Firestore payloads.
        # Bound both compute and tool response sizes without hiding decimation.
        dense_count = min(600, hi - lo + 1)
        dense_frames = sorted({lo + round(i * (hi - lo) / max(1, dense_count - 1))
                               for i in range(dense_count)})
        dense_detail = {"jointAngleSequencing": [_angles_point(ath, f) for f in dense_frames],
                        "comTrajectory": [_com_point(ath, f) for f in dense_frames]}

        def event_quality(fig: dict) -> dict:
            # Certify the actual support interval used by each estimator, including
            # derivative neighbors and the post-contact peak-search extension.
            bounds = {
                "maxKneeFlexion": (bs_i - _scaled(10), cf_i, "knee"),
                "peakThighAngularVel": (bs_i - 2, cf_i + _scaled(5) + 2, "thigh"),
                "peakShankAngularVel": (bs_i - 2, cf_i + _scaled(5) + 2, "shank"),
                "kickFootSpeedJustBeforeContact": (cf_i - 3, cf_i - 1, "ankle"),
            }
            quality = {}
            for name, (start, end, key) in bounds.items():
                frames = range(max(lo, start), min(hi, end) + 1)
                def tracked(f):
                    frame = _fig_frame(fig, f)
                    if key == "ankle":
                        return _named_px(fig, frame, f"{_pre(fig, 'kicking')}_ankle") is not None
                    return _leg_angles(fig, frame, "kicking").get(key) is not None
                good = sum(tracked(f) for f in frames)
                complete = start >= lo and end <= hi and len(frames) >= 3 and good == len(frames)
                if fig["label"] == "pro" and (pro_fps_v is None or p_cf is None):
                    complete = False
                quality[name] = {"eligible": complete, "trackedFrames": good, "totalFrames": len(frames),
                                 "startFrame": start, "endFrame": end,
                                 "notes": [] if complete else ["Tracking gaps or truncated estimator support window"]}
            return quality

        athlete_event_quality = event_quality(ath)
        pro_event_quality = event_quality(prf) if pro_fps_v else {}
        pro_events = _events(prf) if pro_fps_v else {}
        for name, quality in pro_event_quality.items():
            if not quality["eligible"]:
                pro_events[name] = None
        if any((pro_event_quality.get(name) or {}).get("eligible") is not True
               for name in ("peakThighAngularVel", "peakShankAngularVel")):
            pro_events["proximalToDistalOrderOK"] = None

        com_meaning = ("trunk center of mass relative to the pre-kick ball center; x positive = "
                       "toward the target (ahead of the ball), y positive = above the ball center; "
                       "units = fraction of athlete height; msFromContact < 0 = before ball contact")
        if ball_px is None or toward is None or not a_px_h:
            com_meaning += (" — UNAVAILABLE for this rep (missing ball detection, kick direction, "
                            "or athlete height reference)")
        series_blocks["comTrajectory"] = {
            "meaning": com_meaning,
            "anchors": {k: _com_point(ath, f) for k, f in anchor_frames.items()},
            "proAnchors": {k: _com_point(prf, f) for k, f in anchor_frames.items()} if pro_fps_v else {},
            "athlete": [_com_point(ath, f) for f in sample_frames],
            "pro": [_com_point(prf, f) for f in sample_frames] if pro_fps_v else [],
        }
        series_blocks["jointAngleSequencing"] = {
            "meaning": ("knee/hip = interior joint angles (180 = straight); thigh/shank = segment "
                        "vs vertical (0 = vertical); trunkLean signed along the kick direction "
                        "(positive = toward target); degrees, athlete-aligned pixel space; null = "
                        "joint not tracked at that frame"),
            "athlete": [_angles_point(ath, f) for f in sample_frames],
            "pro": [_angles_point(prf, f) for f in sample_frames] if pro_fps_v else [],
            "events": {
                "meaning": ("peak angular velocities of the kicking thigh/shank between backswing "
                            "and contact; proximal-to-distal sequencing is healthy when the "
                            "thigh's peak comes BEFORE the shank's (the thigh decelerates and "
                            "whips the shank through); maxKneeFlexion = deepest kicking-knee bend "
                            "of the backswing; kickFootSpeedJustBeforeContact uses the ankle over "
                            "the last ~2 frames before contact"),
                "athlete": _events(ath),
                "pro": pro_events,
                "quality": athlete_event_quality,
                "proQuality": pro_event_quality,
            },
        }

    # --- Pose coverage ---------------------------------------------------
    coverage: dict[str, float] = {}
    for frame_key, kf in key_frames.items():
        lo, hi = max(0, kf - 5), min(max(0, n - 1), kf + 5)
        total = hi - lo + 1 if n > 0 else 0
        good = sum(1 for f in range(lo, hi + 1) if len(a_frames[f]) >= 20) if total else 0
        coverage[frame_key] = good / total if total else 0.0

    # --- Orientation + body-part dictionary (v2) -------------------------
    sup_side = "left" if a_kick == "right" else "right"

    def _leg_ids(side: str) -> list[int]:
        p = side[0]
        return [MP33_INDEX[f"{p}_{j}"] for j in ("hip", "knee", "ankle", "heel", "foot_index")]

    def _arm_ids(side: str) -> list[int]:
        p = side[0]
        return [MP33_INDEX[f"{p}_{j}"] for j in ("shoulder", "elbow", "wrist")]

    body_parts = {
        "kickingLeg": {"side": a_kick, "jointIds": _leg_ids(a_kick)},
        "supportLeg": {"side": sup_side, "jointIds": _leg_ids(sup_side)},
        "leadArm": {"side": sup_side, "jointIds": _arm_ids(sup_side)},
        "trailArm": {"side": a_kick, "jointIds": _arm_ids(a_kick)},
        "hips": {"side": None, "jointIds": [MP33_INDEX["l_hip"], MP33_INDEX["r_hip"]]},
        "trunk": {"side": None,
                  "jointIds": [MP33_INDEX["l_shoulder"], MP33_INDEX["r_shoulder"],
                               MP33_INDEX["l_hip"], MP33_INDEX["r_hip"]]},
    }

    orientation = {
        "kickingSide": a_kick,
        "supportSide": sup_side,
        "kickingSideSource": kick_side_source,
        "strikeFootField": sf_field,
        "derivedKickingSide": derived_kick,
        "sideAgreement": side_agreement,
        "direction": dir_v,
        "directionSource": direction_source,
        "proKickingSide": p_kick,
        "mirrored": mirrored,
        "meaning": ("kickingSide is the athlete's physical strike leg — every metric row's "
                    "'kicking'/'support'/'lead'/'trail' resolves through it (lead arm = opposite "
                    "the kicking leg). direction is the athlete's on-screen kick direction, but "
                    "all *_x offset metrics are ALREADY normalized so positive = toward the "
                    "target regardless of it. mirrored means the right-footed pro asset was "
                    "mirrored to match the athlete's facing before comparison."),
    }

    result = {
        "keyFrames": key_frames,
        "fps": fps_v,
        "proFrameShift": shift,
        "mirrored": mirrored,
        "orientation": orientation,
        "bodyParts": body_parts,
        "jointNames": {str(i): nm for i, nm in sorted(_JOINT_NAMES.items())},
        "scale": scale_block,
        "metrics": rows,
        **series_blocks,
        "dataQuality": {
            "keyFramesValid": key_frames_valid,
            "proFps": pro_fps_v,
            "proTimingComparable": pro_fps_v is not None,
            "poseCoverage": coverage,
            "alignment": alignment,
            "proLayout": pro_layout,
            "sideConfidence": side_confidence,
            "mirrorConfidence": "high" if mirror_conclusive else "low",
            "followThroughClamped": follow_through_clamped,
            "notes": notes,
        },
    }
    result["_detail"] = dense_detail
    return _strip_nonfinite(result)
