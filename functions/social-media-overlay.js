"use strict";

const { contextIdentityMatches } = require("./processing-evidence");

// Deliberately narrower than the private artifact API. These are drawing data,
// never raw artifacts, capture context, measurements, storage paths or URLs.
const MAX_FRAMES = 300;
const MAX_SOURCE_FRAMES = 12000;
const MAX_SECONDS = 600;
const MAX_BYTES = 200 * 1024;
const MAX_POSE_BYTES = 16 * 1024 * 1024;
const number = value => (typeof value === "number" || typeof value === "string" && value.trim()) && Number.isFinite(Number(value)) ? Number(value) : null;
const round = value => Math.round(value * 10000) / 10000;
const pointsOf = frame => Array.isArray(frame) ? frame : frame?.landmarks || frame?.pose;

function timesFor(metadata, capture, count) {
  // Timestamp precedence and FPS/offset semantics match pose-playback.ts. Unlike
  // private manual inspection, malformed recorded clocks must not fall back.
  const keys = ["frameTimestampsMs", "frameTimestampsSeconds", "frameTimestamps"];
  const key = keys.find(k => Object.hasOwn(metadata, k));
  if (key) {
    const raw = metadata[key];
    if (!Array.isArray(raw) || raw.length !== count) return null;
    const times = raw.map(value => { const n = number(value); return n === null ? null : n / (key === "frameTimestampsMs" ? 1000 : 1); });
    return times.every((time, i) => time !== null && time >= 0 && time <= MAX_SECONDS && (!i || time > times[i - 1])) ? times : null;
  }
  const fpsRaw = metadata.framesPerSecond ?? metadata.fps ?? metadata.frameRate;
  const recordedFps = number(fpsRaw);
  if (fpsRaw !== undefined && !(recordedFps > 0)) return null;
  const captureFps = number(capture?.clipFramesPerSecondUsed);
  if (recordedFps !== null && captureFps !== null && Math.abs(recordedFps - captureFps) > Math.max(recordedFps, captureFps) * .02) return null;
  const fps = recordedFps ?? captureFps;
  const offsetRaw = metadata.videoStartTimeSeconds ?? metadata.poseStartTimeSeconds;
  const offset = offsetRaw === undefined ? 0 : number(offsetRaw);
  // An already-trimmed source needs an explicit video offset; never guess it
  // from analysis markers (startFrame can describe a full-length pose file).
  if ((number(metadata.frameOffset) > 0 || number(metadata.poseFrameOffset) > 0) && offsetRaw === undefined) return null;
  if (!(fps > 0 && fps <= 1000) || offset === null || offset < 0 || offset + (count - 1) / fps > MAX_SECONDS) return null;
  return Array.from({ length: count }, (_, index) => offset + index / fps);
}

function normalizePoint(point, count, pixels, width, height) {
  let x = number(Array.isArray(point) ? point[0] : point?.x);
  let y = number(Array.isArray(point) ? point[1] : point?.y);
  const visibilityIndex = Array.isArray(point) ? point.length >= 4 ? 3 : count === 17 && point.length >= 3 ? 2 : -1 : -1;
  const hasVisibility = Array.isArray(point) ? visibilityIndex >= 0 : point != null && (Object.hasOwn(point, "visibility") || Object.hasOwn(point, "confidence"));
  const visibility = number(Array.isArray(point) ? point[visibilityIndex] : Object.hasOwn(point || {}, "visibility") ? point.visibility : point?.confidence);
  if (pixels) { if (x !== null) x /= width; if (y !== null) y /= height; }
  if (x === null || y === null || x < 0 || x > 1 || y < 0 || y > 1 || hasVisibility && (visibility === null || visibility < .1 || visibility > 1)) return null;
  return [round(x), round(y)];
}

function markersFor(rep, times) {
  const keys = rep.repType === "shooting" ? [["Backswing", "transition_frame"], ["Contact", "contact_frame"]]
    : rep.repType === "jump" ? [["Peak", "peakFrame"]]
    : rep.repType === "broadJump" ? [["Takeoff", "takeoffFrame"], ["Landing", "landingFrame"]]
    : rep.repType === "sprint" ? [["Start", "startFrame"], ["Finish", "endFrame"]]
    : [["Start", "startFrame"], ["Turn", "phase1EndFrame"], ["Return", "phase2EndFrame"], ["Finish", "endFrame"]];
  return keys.filter(([, key]) => Number.isSafeInteger(rep[key]) && rep[key] >= 0 && rep[key] < times.length)
    .map(([label, key]) => ({ label, time: round(times[rep[key]]) }));
}

function projectOverlay(raw, recording) {
  const { playerId, rep, effectiveRep, evidence, movieName } = recording;
  // A unique legacy folder can legitimately provide a video. Pose alignment is
  // stricter: its sidecar must name this athlete, rep and selected exact clip.
  if (!effectiveRep.resultStatus?.qualified || effectiveRep.resultStatus.duplicate
    || contextIdentityMatches(evidence.context, playerId, rep) !== true
    || evidence.context.rep.videoStoragePath !== movieName || !recording.movieGeneration) return null;
  const metadata = evidence.metadata || {};
  const source = Array.isArray(raw) ? raw : raw?.frames;
  if (!Array.isArray(source) || !source.length || source.length > MAX_SOURCE_FRAMES) return null;
  const width = number(metadata.videoDisplayWidth ?? metadata.videoWidth ?? metadata.imageWidth ?? metadata.frameWidth ?? metadata.width);
  const height = number(metadata.videoDisplayHeight ?? metadata.videoHeight ?? metadata.imageHeight ?? metadata.frameHeight ?? metadata.height);
  if (!(width > 0 && width <= 16384 && height > 0 && height <= 16384)) return null;
  const space = metadata.coordinateSpace ?? metadata.poseCoordinateSpace;
  if (space !== undefined && !["normalized", "normalised", "pixel", "pixels"].includes(space)) return null;
  const pixels = space === "pixel" || space === "pixels";
  const nonempty = source.map(pointsOf).filter(points => Array.isArray(points) && points.length);
  const count = nonempty[0]?.length;
  if (![17, 33].includes(count) || nonempty.some(points => points.length !== count)) return null;
  const layout = String(metadata.keypointLayout ?? metadata.poseLayout ?? "").toLowerCase();
  if (layout && !(count === 17 && layout.includes("coco") || count === 33 && layout.includes("mediapipe"))) return null;
  const times = timesFor(metadata, evidence.context.capture, source.length);
  if (!times) return null;
  const length = Math.min(MAX_FRAMES, source.length);
  const indices = Array.from({ length }, (_, i) => length === 1 ? 0 : Math.round(i * (source.length - 1) / (length - 1)));
  const frames = indices.map(index => {
    const points = pointsOf(source[index]);
    return { time: round(times[index]), points: Array.from({ length: count }, (_, joint) => normalizePoint(points?.[joint], count, pixels, width, height)) };
  });
  if (!frames.some(frame => frame.points.filter(Boolean).length >= 6) || frames.some((frame, i) => i > 0 && frame.time <= frames[i - 1].time)) return null;
  const result = { version: 1, coordinateSpace: "normalized", layout: count === 17 ? "coco17" : "mediapipe33", sourceWidth: width, sourceHeight: height,
    frames, markers: markersFor(effectiveRep, times), footJoints: count === 17 ? { left: 15, right: 16 } : { left: 27, right: 28 } };
  return Buffer.byteLength(JSON.stringify(result), "utf8") <= MAX_BYTES ? result : null;
}

async function readPose(bucket, name) {
  const [metadata] = await bucket.file(name).getMetadata();
  const size = Number(metadata.size), generation = String(metadata.generation || "");
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_POSE_BYTES || !/^\d+$/.test(generation)) return null;
  // Pose sequences are considerably larger than metadata (e.g. 240fps native
  // MediaPipe doubles). Pin the inspected generation and request at most the
  // limit plus one byte, so a wrong size declaration cannot cause an unbounded
  // download/allocation. Metadata/context retain their existing 2 MiB limit.
  const stream = bucket.file(name, { generation }).createReadStream({ start: 0, end: MAX_POSE_BYTES, validation: false });
  const chunks = [];
  let length = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > MAX_POSE_BYTES) { stream.destroy(); return null; }
    chunks.push(bytes);
  }
  if (length !== size) return null;
  return JSON.parse(Buffer.concat(chunks, length).toString("utf8"));
}

async function readSocialOverlay(recording, bucket) {
  if (contextIdentityMatches(recording.evidence.context, recording.playerId, recording.rep) !== true
    || recording.evidence.context.rep.videoStoragePath !== recording.movieName) return null;
  // Folder/clip identity comes only from the canonical media resolver.
  // Optional drawing failures do not prevent an authorized video from playing.
  try { return projectOverlay(await readPose(bucket, `${recording.folder}/pose.json`), recording); }
  catch { return null; }
}

module.exports = { readSocialOverlay, projectOverlay, MAX_FRAMES, MAX_SOURCE_FRAMES, MAX_BYTES, MAX_POSE_BYTES };
