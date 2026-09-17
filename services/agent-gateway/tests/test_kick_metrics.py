"""kick_metrics unit tests — synthetic stick figures with geometrically known angles, no
fixtures and no fakes (the module is pure math). Frame dims are square (1000x1000) so
normalized-space geometry maps 1:1 onto aspect-corrected pixel space.
"""

from __future__ import annotations

import math

import pytest

from gateway.kick_metrics import compute_kick_analysis

# Upright MediaPipe-33 figure, normalized coords, y down. Nose 0.20, ankles 0.80 ->
# athlete pixel height 600 px at H = 1000.
MP33_BASE = {
    0: (0.50, 0.20),
    11: (0.55, 0.30), 12: (0.45, 0.30),
    13: (0.57, 0.40), 14: (0.43, 0.40),
    15: (0.57, 0.50), 16: (0.43, 0.50),
    23: (0.55, 0.50), 24: (0.45, 0.50),
    25: (0.55, 0.65), 26: (0.45, 0.65),
    27: (0.55, 0.80), 28: (0.45, 0.80),
    29: (0.55, 0.82), 30: (0.45, 0.82),
    31: (0.57, 0.82), 32: (0.43, 0.82),
}
_LR_PAIRS = [(11, 12), (13, 14), (15, 16), (17, 18), (19, 20), (21, 22),
             (23, 24), (25, 26), (27, 28), (29, 30), (31, 32)]

COCO_BASE = {
    0: (0.50, 0.20),
    5: (0.55, 0.30), 6: (0.45, 0.30),
    7: (0.57, 0.40), 8: (0.43, 0.40),
    9: (0.57, 0.50), 10: (0.43, 0.50),
    11: (0.55, 0.50), 12: (0.45, 0.50),
    13: (0.55, 0.65), 14: (0.45, 0.65),
    15: (0.55, 0.80), 16: (0.45, 0.80),
}

META = {"frameWidth": 1000, "frameHeight": 1000}
BALL = [0.60, 0.78, 0.64, 0.82]  # center (0.62, 0.80)


def mp33_frame(overrides: dict | None = None, shift_x: float = 0.0) -> list:
    pts = []
    for i in range(33):
        if overrides and i in overrides:
            x, y = overrides[i]
        elif i in MP33_BASE:
            x, y = MP33_BASE[i]
        else:
            x, y = 0.50 + 0.005 * i, 0.22  # filler face/hand joints, all usable
        pts.append([x + shift_x, y, 0.0, 1.0])
    return pts


def mirror_mp33(frame: list) -> list:
    """Anatomical mirror: L/R indices swapped AND x flipped, like a real opposite-footed pro."""
    swap = {}
    for a, b in _LR_PAIRS:
        swap[a], swap[b] = b, a
    out = []
    for i in range(33):
        x, y, z, v = frame[swap.get(i, i)]
        out.append([1.0 - x, y, z, v])
    return out


def coco_frame(as_dicts: bool = False) -> list:
    pts = []
    for i in range(17):
        x, y = COCO_BASE.get(i, (0.50 + 0.005 * i, 0.22))  # eyes/ears filler
        pts.append({"x": x, "y": y} if as_dicts else [x, y])
    return pts


def mirror_box(b: list) -> list:
    return [1.0 - b[2], b[1], 1.0 - b[0], b[3]]


def traj(contact=20, transition=10, direction=None) -> dict:
    return {"contact_frame": contact, "transition_frame": transition, "direction": direction,
            "t_values": [], "x_values": [], "y_values": []}


def run(athlete_pose, pro_pose, *, athlete_ball=BALL, pro_ball=BALL, metadata=META,
        pro_traj=None, strike_foot="right", direction=None, height=None, fps=240,
        contact=20, transition=10, pro_fps=None):
    return compute_kick_analysis(
        athlete_pose, traj(contact, transition), athlete_ball, metadata,
        pro_pose, pro_traj if pro_traj is not None else traj(), pro_ball,
        contact_frame=contact, transition_frame=transition, fps=fps,
        strike_foot=strike_foot, direction=direction, athlete_height_meters=height,
        pro_fps=pro_fps,
    )


def by_id(out: dict) -> dict:
    return {r["id"]: r for r in out["metrics"]}


def assert_no_nonfinite(obj) -> None:
    if isinstance(obj, bool):
        return
    if isinstance(obj, float):
        assert math.isfinite(obj), f"non-finite {obj!r} in output"
    elif isinstance(obj, dict):
        for v in obj.values():
            assert_no_nonfinite(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            assert_no_nonfinite(v)


# ---------------------------------------------------------------------------


def test_known_angles_upright_figure():
    clip = [mp33_frame() for _ in range(120)]
    out = run(clip, [mp33_frame() for _ in range(120)], pro_traj=traj(contact=25, transition=15))
    rows = by_id(out)

    assert out["fps"] == 240.0
    assert out["proFrameShift"] == 5
    assert out["mirrored"] is False
    assert out["dataQuality"]["alignment"] == "ball_center"
    assert len(out["metrics"]) == 63  # 21 rows x 3 key frames

    assert rows["contact.shank_angle.kicking"]["athlete"] == pytest.approx(0.0, abs=1e-6)
    assert rows["contact.knee_angle.kicking"]["athlete"] == pytest.approx(180.0, abs=1e-6)
    assert rows["contact.thigh_angle.kicking"]["athlete"] == pytest.approx(0.0, abs=1e-6)
    assert rows["contact.hip_angle.kicking"]["athlete"] == pytest.approx(180.0, abs=1e-6)
    assert rows["contact.hip_openness"]["athlete"] == pytest.approx(0.5, abs=1e-6)
    assert rows["contact.trunk_lean"]["athlete"] == pytest.approx(0.0, abs=1e-6)
    # Trail (right) arm: shoulder (0.45, 0.30) -> wrist (0.43, 0.50) vs trunk-down axis.
    assert rows["contact.arm_abduction.trail"]["athlete"] == pytest.approx(
        math.degrees(math.atan2(0.02, 0.20)), abs=1e-6)
    assert rows["contact.wrist_trunk_offset.trail"]["athlete"] == pytest.approx(0.35, abs=1e-6)

    # Identical figures -> deltas vanish and foot centroids align exactly.
    assert rows["contact.knee_angle.kicking"]["delta"] == pytest.approx(0.0, abs=1e-6)
    assert rows["contact.foot_com_vs_pro.kicking"]["athlete"] == pytest.approx(0.0, abs=1e-9)

    # Side-less ids have no trailing segment; sided rows carry the role.
    assert rows["contact.hip_openness"]["side"] is None
    assert rows["contact.knee_angle.kicking"]["side"] == "kicking"
    assert rows["contact.plant_foot_ball_offset_x.support"]["jointIds"] == [27]
    assert_no_nonfinite(out)


def test_known_angles_bent_knee():
    # Right ankle moved so knee->ankle is horizontal: interior knee 90°, shank 90° vs vertical.
    clip = [mp33_frame(overrides={28: (0.60, 0.65)}) for _ in range(120)]
    out = run(clip, [mp33_frame() for _ in range(120)])
    rows = by_id(out)
    assert rows["contact.knee_angle.kicking"]["athlete"] == pytest.approx(90.0, abs=1e-6)
    assert rows["contact.shank_angle.kicking"]["athlete"] == pytest.approx(90.0, abs=1e-6)
    assert rows["contact.knee_angle.kicking"]["delta"] == pytest.approx(-90.0, abs=1e-6)


def _moving_clip(n=120, bs=10, mirror=False, shift_pro=0.0):
    frames = []
    for f in range(n):
        dx = 0.20 * (1.0 - f / bs) if f <= bs else 0.0
        frames.append(mp33_frame(shift_x=dx))
    if mirror:
        frames = [mirror_mp33(fr) for fr in frames]
    if shift_pro:
        frames = [[[x + shift_pro, y, z, v] for x, y, z, v in fr] for fr in frames]
    return frames


def test_mirroring_ball_center_alignment():
    athlete = _moving_clip()                      # run-up right-to-left
    pro = _moving_clip(mirror=True)               # anatomical mirror: left-to-right
    out = run(athlete, pro, pro_ball=mirror_box(BALL), direction="right_to_left")
    rows = by_id(out)
    assert out["mirrored"] is True
    assert out["dataQuality"]["alignment"] == "ball_center"
    # A mirrored pro of a mirrored athlete maps back exactly onto the athlete.
    assert rows["contact.foot_com_vs_pro.kicking"]["athlete"] == pytest.approx(0.0, abs=1e-9)
    assert rows["contact.knee_angle.kicking"]["delta"] == pytest.approx(0.0, abs=1e-6)
    assert rows["contact.shank_angle.support"]["delta"] == pytest.approx(0.0, abs=1e-6)


def test_mirroring_plant_foot_offset_sign_coherent():
    athlete = _moving_clip()
    # Pro shifted +0.03 pre-mirror: the plant-foot offset must compensate with the right sign.
    pro = _moving_clip(mirror=True, shift_pro=0.03)
    out = run(athlete, pro, athlete_ball=None, pro_ball=None, direction="right_to_left")
    rows = by_id(out)
    assert out["mirrored"] is True
    assert out["dataQuality"]["alignment"] == "plant_foot"
    assert rows["contact.foot_com_vs_pro.kicking"]["athlete"] == pytest.approx(0.0, abs=1e-9)
    # No ball -> ball-offset rows are invalid, not wrong.
    ball_row = rows["contact.plant_foot_ball_offset_x.support"]
    assert ball_row["valid"] is False
    assert "ball" in ball_row["note"]


def test_coco17_pro_layout():
    pro = [coco_frame(as_dicts=(f == 0)) for f in range(120)]  # frame 0 exercises dict keypoints
    out = run([mp33_frame() for _ in range(120)], pro)
    rows = by_id(out)
    assert out["dataQuality"]["proLayout"] == "coco17"
    assert any("COCO-17" in n for n in out["dataQuality"]["notes"])
    assert rows["contact.knee_angle.kicking"]["pro"] == pytest.approx(180.0, abs=1e-6)
    assert rows["contact.knee_angle.kicking"]["delta"] == pytest.approx(0.0, abs=1e-6)
    # Pro foot centroid degrades to the ankle alone but the row still computes.
    vs = rows["contact.foot_com_vs_pro.kicking"]
    assert vs["valid"] is True
    assert vs["athlete"] > 0.0
    assert_no_nonfinite(out)


def test_nan_literals_never_reach_output():
    clip = [mp33_frame() for _ in range(120)]
    for f in range(17, 24):                      # kicking (right) ankle NaN across contact ±3
        clip[f][28][0] = float("nan")
    clip[20][27][3] = float("nan")               # support ankle visibility NaN at contact only
    out = run(clip, [mp33_frame() for _ in range(120)])
    rows = by_id(out)
    assert_no_nonfinite(out)

    kick_shank = rows["contact.shank_angle.kicking"]
    assert kick_shank["valid"] is False
    assert kick_shank["athlete"] is None
    assert "r_ankle" in kick_shank["note"]
    assert rows["contact.knee_angle.kicking"]["valid"] is False
    # Support side recovers from a nearby frame (visibility-NaN is just "unusable").
    sup_shank = rows["contact.shank_angle.support"]
    assert sup_shank["valid"] is True
    assert "frame 19" in sup_shank["note"]
    # Other key frames are untouched.
    assert rows["backswing.shank_angle.kicking"]["valid"] is True


def test_null_frames_nearest_usable_and_coverage():
    clip: list = [mp33_frame() for _ in range(120)]
    for f in (19, 20, 21):
        clip[f] = None
    out = run(clip, [mp33_frame() for _ in range(120)])
    rows = by_id(out)
    knee = rows["contact.knee_angle.kicking"]
    assert knee["valid"] is True
    assert knee["athlete"] == pytest.approx(180.0, abs=1e-6)
    assert "frame 18" in knee["note"]
    cov = out["dataQuality"]["poseCoverage"]
    assert cov["contact"] == pytest.approx(8.0 / 11.0, abs=1e-9)
    assert cov["backswing"] == pytest.approx(1.0, abs=1e-9)


def test_scale_source_precedence():
    athlete = [mp33_frame() for _ in range(120)]
    pro = [mp33_frame() for _ in range(120)]
    # Support (left) ankle x 0.55, ball x 0.62 -> -70 px along a left_to_right kick (behind the
    # ball); athlete pixel height 600 px. Direction must be explicit: static synthetic clips
    # can't infer one, and directional x rows are invalid without it (v2).
    rid = "contact.plant_foot_ball_offset_x.support"

    out = run(athlete, pro, metadata={**META, "m_per_px": 0.002}, height=1.8,
              direction="left_to_right")
    assert out["scale"] == {"source": "aruco", "mPerPx": 0.002, "assumedProHeightMeters": None}
    rows = by_id(out)
    assert rows[rid]["athlete"] == pytest.approx(-70.0 / 600.0, abs=1e-9)
    assert rows[rid]["athleteMeters"] == pytest.approx(-70.0 * 0.002, abs=1e-9)

    out = run(athlete, pro, height=1.8, direction="left_to_right")
    assert out["scale"] == {"source": "athlete_height", "mPerPx": None, "assumedProHeightMeters": None}
    assert by_id(out)[rid]["athleteMeters"] == pytest.approx(-70.0 * 1.8 / 600.0, abs=1e-9)

    out = run(athlete, pro, direction="left_to_right")
    assert out["scale"] == {"source": "pro_height", "mPerPx": None, "assumedProHeightMeters": 1.778}
    assert by_id(out)[rid]["athleteMeters"] == pytest.approx(-70.0 * 1.778 / 600.0, abs=1e-9)

    # No ArUco, no athlete height, pro height unmeasurable (nose hidden) -> no meters at all.
    blind_pro = [mp33_frame() for _ in range(120)]
    for fr in blind_pro:
        fr[0][3] = 0.0
    out = run(athlete, blind_pro, direction="left_to_right")
    assert out["scale"] == {"source": "none", "mPerPx": None, "assumedProHeightMeters": None}
    for r in out["metrics"]:
        assert r["athleteMeters"] is None and r["proMeters"] is None and r["deltaMeters"] is None


# ---------------------------------------------------------------------------
# v2: direction-normalized signs, orientation block, body-part dictionary, series
# ---------------------------------------------------------------------------


def test_direction_normalized_x_offsets():
    """The same geometry must read 'behind the ball' one way and 'ahead' the other: positive
    always means toward the target, never screen-right."""
    athlete = [mp33_frame() for _ in range(120)]
    pro = [mp33_frame() for _ in range(120)]
    rid = "contact.plant_foot_ball_offset_x.support"
    raw = -70.0 / 600.0  # support ankle 70 px screen-left of ball center

    ltr = by_id(run(athlete, pro, direction="left_to_right"))[rid]
    rtl = by_id(run(athlete, pro, direction="right_to_left"))[rid]
    assert ltr["athlete"] == pytest.approx(raw, abs=1e-9)       # behind the ball
    assert rtl["athlete"] == pytest.approx(-raw, abs=1e-9)      # ahead of the ball
    assert "AHEAD of the ball" in ltr["meaning"]


def test_y_offsets_positive_up():
    # Kicking (right) foot centroid y = (0.80 + 0.82 + 0.82)/3 = 0.8133, ball center y = 0.80:
    # the foot is BELOW the ball center, so the v2 positive-up reading must be negative.
    out = run([mp33_frame() for _ in range(120)], [mp33_frame() for _ in range(120)],
              direction="left_to_right")
    row = by_id(out)["contact.foot_com_ball_offset_y.kicking"]
    assert row["valid"] is True
    assert row["athlete"] == pytest.approx(-(0.8133333 - 0.80) * 1000.0 / 600.0, abs=1e-4)
    assert "ABOVE" in row["meaning"]


def test_direction_unknown_invalidates_directional_rows():
    out = run([mp33_frame() for _ in range(120)], [mp33_frame() for _ in range(120)])
    rows = by_id(out)
    for rid in ("contact.plant_foot_ball_offset_x.support",
                "contact.foot_com_ball_offset_x.kicking",
                "contact.trunk_com_ball_offset_x",
                "contact.trunk_com_offset_x"):
        assert rows[rid]["valid"] is False
        assert "direction" in rows[rid]["note"]
    # y rows do not need a direction.
    assert rows["contact.foot_com_ball_offset_y.kicking"]["valid"] is True
    assert out["orientation"]["direction"] is None
    assert out["orientation"]["directionSource"] == "unknown"


def test_orientation_block_and_body_parts():
    out = run([mp33_frame() for _ in range(120)], [mp33_frame() for _ in range(120)],
              direction="left_to_right")
    o = out["orientation"]
    assert o["kickingSide"] == "right"
    assert o["supportSide"] == "left"
    assert o["kickingSideSource"] == "strike_foot"
    assert o["directionSource"] == "rep_doc"
    bp = out["bodyParts"]
    assert bp["kickingLeg"] == {"side": "right", "jointIds": [24, 26, 28, 30, 32]}
    assert bp["supportLeg"] == {"side": "left", "jointIds": [23, 25, 27, 29, 31]}
    assert bp["leadArm"] == {"side": "left", "jointIds": [11, 13, 15]}
    assert bp["trailArm"] == {"side": "right", "jointIds": [12, 14, 16]}
    assert out["jointNames"]["27"] == "left ankle"
    # Static clips make the mirror test inconclusive — that must be surfaced, not silent.
    assert out["dataQuality"]["mirrorConfidence"] == "low"
    assert any("mirror test inconclusive" in n for n in out["dataQuality"]["notes"])


def test_side_disagreement_flagged():
    clip = [mp33_frame() for _ in range(120)]
    for f in range(10, 21):                      # right ankle swings -> kinematics say "right"
        clip[f][28][0] = 0.45 + 0.02 * (f - 10)
    out = run(clip, [mp33_frame() for _ in range(120)], strike_foot="left")
    o = out["orientation"]
    assert o["kickingSide"] == "left"            # the field still wins (precedence unchanged)
    assert o["derivedKickingSide"] == "right"
    assert o["sideAgreement"] == "disagree"
    assert out["dataQuality"]["sideConfidence"] == "low"
    assert any("disagree" in n for n in out["dataQuality"]["notes"])
    # And the dictionary follows the chosen side.
    assert out["bodyParts"]["kickingLeg"]["side"] == "left"


def test_series_blocks_and_events():
    out = run([mp33_frame() for _ in range(120)], [mp33_frame() for _ in range(120)],
              direction="left_to_right", height=1.8)
    com = out["comTrajectory"]
    assert set(com["anchors"]) == {"backswingMinus50", "backswing", "contact", "contactPlus50"}
    assert com["anchors"]["contact"]["frame"] == 20
    # Trunk COM x = 0.50, ball x = 0.62 -> 120 px behind along left_to_right, height 600 px.
    assert com["anchors"]["contact"]["x"] == pytest.approx(-120.0 / 600.0, abs=1e-3)
    assert com["anchors"]["contact"]["y"] is not None
    assert len(com["athlete"]) > 0
    assert com["pro"] == []
    assert out["dataQuality"]["proTimingComparable"] is False

    seq = out["jointAngleSequencing"]
    contact_pt = next(p for p in seq["athlete"] if p["frame"] == 20)
    assert contact_pt["kickingKnee"] == pytest.approx(180.0, abs=0.1)
    assert contact_pt["supportShank"] == pytest.approx(0.0, abs=0.1)
    ev = seq["events"]["athlete"]
    assert ev["backswingKneeAngleDeg"] == pytest.approx(180.0, abs=0.1)
    assert ev["maxKneeFlexion"]["deg"] == pytest.approx(180.0, abs=0.1)  # static: never bends
    assert ev["kickFootSpeedJustBeforeContact"]["metersPerS"] == pytest.approx(0.0, abs=1e-6)
    assert_no_nonfinite(out)


def test_followthrough_clamp_is_flagged():
    clip = [mp33_frame() for _ in range(30)]
    out = run(clip, [mp33_frame() for _ in range(120)])
    assert out["keyFrames"]["followThrough"] == 29
    assert out["dataQuality"]["followThroughClamped"] is True
    assert any("clamped" in n for n in out["dataQuality"]["notes"])


def test_kick_side_fallback_from_ankle_x_range():
    clip = [mp33_frame() for _ in range(120)]
    for f in range(10, 21):                      # right ankle swings through the kick window
        clip[f][28][0] = 0.45 + 0.02 * (f - 10)
    out = run(clip, [mp33_frame() for _ in range(120)], strike_foot=None)
    rows = by_id(out)
    assert rows["contact.plant_foot_ball_offset_x.support"]["jointIds"] == [27]
    assert rows["contact.foot_com_vs_pro.kicking"]["jointIds"] == [28, 30, 32]


def test_followthrough_clamps_at_clip_end():
    clip = [mp33_frame() for _ in range(30)]
    out = run(clip, [mp33_frame() for _ in range(120)])
    assert out["keyFrames"] == {"backswing": 10, "contact": 20, "followThrough": 29}


def test_derivative_support_includes_frames_after_contact():
    athlete = [mp33_frame() for _ in range(120)]
    athlete[26][24][3] = 0.0  # hip gap outside the old backswing→contact quality window
    out = run(athlete, [mp33_frame() for _ in range(120)], direction="left_to_right")
    quality = out["jointAngleSequencing"]["events"]["quality"]
    assert quality["peakThighAngularVel"]["eligible"] is False
    assert quality["peakThighAngularVel"]["endFrame"] == 27
    assert quality["maxKneeFlexion"]["eligible"] is True


def test_partial_foot_centroid_is_not_a_comparable_measurement():
    athlete = [mp33_frame() for _ in range(120)]
    for frame in athlete:
        frame[30][3] = frame[32][3] = 0.0
    out = run(athlete, [mp33_frame() for _ in range(120)], direction="left_to_right")
    assert by_id(out)["contact.foot_com_ball_offset_x.kicking"]["valid"] is False
    assert by_id(out)["contact.foot_com_ball_offset_y.kicking"]["valid"] is False


def test_known_pro_fps_maps_source_frames_by_elapsed_time():
    out = run([mp33_frame() for _ in range(120)], [mp33_frame() for _ in range(120)],
              direction="left_to_right", fps=240, pro_fps=120)
    series = out["jointAngleSequencing"]["pro"]
    point = next(point for point in series if point["frame"] == 10)
    assert point["sourceFrame"] == 15  # 10 athlete frames before contact = 5 pro frames
    assert point["sourceFps"] == 120
    assert out["dataQuality"]["proTimingComparable"] is True
