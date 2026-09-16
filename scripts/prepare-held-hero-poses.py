"""Prepare public held poses from authorized local recording captures.

Raw recordings and the model belong in ignored .netlify/hero-pose-source.
This script has no Firebase dependency and never reads or writes credentials.
Install mediapipe, opencv-python and numpy in an isolated local environment.
"""

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python
from mediapipe.tasks.python import vision


MODEL_HASH = "64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b"
SOURCE_HASHES = {
    "sprint-pose.json": "5992c602699d78dcf30177b579ea787ad5861cbeaee9d7393b9d76f3be6959e4",
    "sprint-sprint.mov": "09f3d671f9a3f03e95f742878587d8bc1497c782769ee1f057ab935e8a3d3c50",
    "jump-pose.json": "7b43590b7b4567645c6052183e2bb65bd2a672ee9f69a94add0cd9f2d3b4b291",
    "jump-static_jump.mov": "9169de0bb113c28832eae1720ba32bf1d148ed9599636c234a2d97433d55e0af",
    "jump-key_frames.json": "c616452ded4907e7fd18f194d272cf7aa588c1b40ee37bee217d67175a1ddc89",
    "jump-metadata.json": "eb31f0051520ac3c570fde850fd50b83accd3383b33032e97bac13678ffeb669",
}
ROOT = Path(__file__).resolve().parents[1]
CONFIG = {
    "sprint": {"video": "sprint-sprint.mov", "frame": 312, "phase": "flight stride"},
    "jump": {"video": "jump-static_jump.mov", "frame": 158, "phase": "airborne peak"},
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def anatomy_height(points):
    """Pose-independent chain length used only for uniform display scale."""
    shoulders = (points[11] + points[12]) / 2
    hips = (points[23] + points[24]) / 2
    leg = sum(np.linalg.norm(points[a] - points[b]) for a, b in [(23, 25), (25, 27), (24, 26), (26, 28)]) / 2
    return np.linalg.norm(points[0] - shoulders) + np.linalg.norm(shoulders - hips) + leg


def prepare(key, config, source, target, landmarker):
    pose_path = source / f"{key}-pose.json"
    poses = json.loads(pose_path.read_text())
    video_path = source / config["video"]
    capture = cv2.VideoCapture(str(video_path))
    fps = capture.get(cv2.CAP_PROP_FPS)
    frame_index = config["frame"]
    inferred = []
    image_landmarks = []
    selected_image = None
    # Five source frames (~33 ms at 120 fps) reduce inference jitter without
    # replacing the captured action with an invented pose.
    for index in range(frame_index - 2, frame_index + 3):
        capture.set(cv2.CAP_PROP_POS_FRAMES, index)
        ok, frame = capture.read()
        if not ok:
            raise ValueError(f"Missing video frame {key}:{index}")
        height, width = frame.shape[:2]
        landmarks = np.array(poses[index])
        xy = landmarks[:, :2] * [width, height]
        center = (xy.min(axis=0) + xy.max(axis=0)) / 2
        side = max(np.ptp(xy[:, 0]), np.ptp(xy[:, 1])) * 1.55
        left = max(0, int(center[0] - side / 2))
        top = max(0, int(center[1] - side / 2))
        right = min(width, int(center[0] + side / 2))
        bottom = min(height, int(center[1] + side / 2))
        crop = frame[top:bottom, left:right]
        rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
        result = landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
        if not result.pose_world_landmarks:
            raise ValueError(f"No world landmarks found in {key}:{index}")
        world = np.array([[p.x, p.y, p.z] for p in result.pose_world_landmarks[0]])
        world -= (world[23] + world[24]) / 2
        inferred.append(world)
        local_image = np.array([[p.x, p.y] for p in result.pose_landmarks[0]])
        image_landmarks.append((local_image * [right - left, bottom - top] + [left, top]).tolist())
        if index == frame_index:
            selected_image = frame
    capture.release()
    median_world = np.median(np.array(inferred), axis=0)
    # Preserve MediaPipe's inferred depth, converting its downward Y and
    # camera-facing negative Z to the renderer's upward Y / positive Z.
    points = median_world * [1, -1, -1]
    shooting = np.array(json.loads((target / "shooting-pose.json").read_text())["points"])
    scale = float(anatomy_height(shooting) / anatomy_height(points))
    points *= scale
    clearance = 0.045
    if key == "jump":
        metadata = json.loads((source / "jump-metadata.json").read_text())
        # The recorded feet-to-ground gap preserves airborne placement.
        # Its calibration is only used for a display offset, not a new metric.
        foot_y = float(np.max(np.array(poses[frame_index])[[27, 28, 29, 30, 31, 32], 1]))
        clearance += max(0, metadata["ground_loc_y"] - foot_y) * metadata["m_to_normalized_units"] * scale
    else:
        # A sprint flight frame remains slightly clear of the pitch; the source
        # video confirms neither sole is planted. This is illustrative spacing.
        clearance = 0.12
    points[:, 1] += clearance - np.min(points[[27, 28, 29, 30, 31, 32], 1])
    raw_world = json.dumps(np.round(np.array(inferred), 9).tolist(), separators=(",", ":"))
    (source / f"{key}-world.json").write_text(raw_world)
    comparison = np.array(image_landmarks)[2] - np.array(poses[frame_index])[:, :2] * [selected_image.shape[1], selected_image.shape[0]]
    asset = {
        "frameIndex": frame_index,
        "phase": config["phase"],
        "sourceSha256": sha(pose_path),
        "reconstruction": {
            "sourceVideoSha256": sha(video_path),
            "worldSha256": hashlib.sha256(raw_world.encode()).hexdigest(),
            "model": "mediapipe-pose-landmarker-heavy/float16/1",
            "modelSha256": MODEL_HASH,
            "method": "five-frame-temporal-median-world-landmarks",
            "coordinates": "world-landmarks-meters-estimated",
            "fitFrameRange": [frame_index - 2, frame_index + 2],
            "sourceFps": round(fps, 6),
            "uniformDisplayScale": round(scale, 6),
            "groundClearance": round(clearance, 6),
            "groundPlacement": "recorded-calibrated-feet-to-ground-gap" if key == "jump" else "illustrative-flight-clearance-verified-from-source-frame",
            "meanImageLandmarkDifferencePixels": round(float(np.linalg.norm(comparison, axis=1).mean()), 3),
        },
        "points": np.round(points, 5).tolist(),
    }
    if points.shape != (33, 3) or not np.isfinite(points).all():
        raise ValueError("Invalid output points")
    (target / f"{key}-pose.json").write_text(json.dumps(asset, indent=2) + "\n")
    # Private visual evidence stays beside the source capture, outside Git.
    cv2.imwrite(str(source / f"{key}-selected-frame.jpg"), selected_image)
    print(f"Prepared {key} frame {frame_index}: 33 world landmarks; scale {scale:.4f}; clearance {clearance:.4f}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / ".netlify/hero-pose-source")
    parser.add_argument("--target", type=Path, default=ROOT / "app/src/pages/home/latest-hero")
    args = parser.parse_args()
    model = args.source / "pose_landmarker_heavy.task"
    if sha(model) != MODEL_HASH:
        raise ValueError("Pose model checksum differs from the accepted shooting reconstruction")
    for name, expected in SOURCE_HASHES.items():
        if sha(args.source / name) != expected:
            raise ValueError(f"Authorized source capture changed: {name}")
    if CONFIG["jump"]["frame"] not in json.loads((args.source / "jump-key_frames.json").read_text()):
        raise ValueError("Selected jump frame is not a recorded key frame")
    options = vision.PoseLandmarkerOptions(base_options=python.BaseOptions(model_asset_path=str(model)), running_mode=vision.RunningMode.IMAGE, num_poses=1)
    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        for key, config in CONFIG.items():
            prepare(key, config, args.source, args.target, landmarker)


if __name__ == "__main__":
    main()
