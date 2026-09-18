"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { projectOverlay, readSocialOverlay, MAX_FRAMES, MAX_BYTES, MAX_POSE_BYTES } = require("./social-media-overlay");
const { createSocial } = require("./social");
const { idFor } = require("./social-projection");
const { FakeFirestore, HttpsError } = require("./test-support/fake-firestore");

const NOW = Date.UTC(2026, 8, 18), folder = "p2/jump/session1/kick1", movie = `${folder}/right.mov`;
const rawPose = (count = 4, joints = 33) => Array.from({ length: count }, (_, i) => Array.from({ length: joints }, () => [.123456 + i / Math.max(count, 1) / 10, .7, joints === 17 ? .9 : -5, .9]));
function source(metadata = {}, changes = {}) {
  const rep = { id: "r", repType: "jump", storagePath: folder, sessionId: "s1", sessionNumber: 1, repNumber: 1, jumpHeight: .5, createdAt: NOW - 3600000 };
  return { playerId: "p2", rep, effectiveRep: { ...rep, peakFrame: 2, resultStatus: { qualified: true, duplicate: false } },
    movieName: movie, movieGeneration: "1", folder,
    evidence: { metadata: { frameWidth: 1920, frameHeight: 1080, framesPerSecond: 120, ...metadata }, context: { rep: { repId: "r", playerDocId: "p2", videoStoragePath: movie }, capture: { clipFramesPerSecondUsed: 120 } } }, ...changes };
}

test("overlay is a bounded drawing-only projection with exact video times and canonical markers", () => {
  const recording = source({ secret: "private", email: "athlete@example.test", reprocess_context: { private: true } });
  const result = projectOverlay(rawPose(), recording);
  assert.deepEqual(Object.keys(result).sort(), ["version", "coordinateSpace", "layout", "sourceWidth", "sourceHeight", "frames", "markers", "footJoints"].sort());
  assert.deepEqual(result.frames[0].points[0], [.1235, .7]);
  assert.equal(result.frames[1].time, .0083);
  assert.deepEqual(result.markers, [{ label: "Peak", time: .0167 }]);
  assert.deepEqual(result.footJoints, { left: 27, right: 28 });
  for (const value of ["private", "athlete@example.test", folder, "generation", "metadata", "capture"]) assert.equal(JSON.stringify(result).includes(value), false);
});

test("full-clip sampling stays below 300 frames and byte budget, without losing clip endpoints", () => {
  const result = projectOverlay(rawPose(2000), source());
  assert.equal(result.frames.length, MAX_FRAMES);
  assert.equal(result.frames[0].time, 0);
  assert.equal(result.frames.at(-1).time, 16.6583);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= MAX_BYTES);
  assert.equal(projectOverlay(rawPose(12001), source()), null);
});

test("pixel normalization respects dimensions, bounds, confidence and known skeletons", () => {
  const pose = rawPose(2, 17).map(frame => frame.map(() => [960, 540, .9]));
  pose[0][0] = [1921, 540, .9]; pose[0][1] = [960, 540, .01]; pose[0][2] = [true, 20, .9];
  const result = projectOverlay(pose, source({ coordinateSpace: "pixels", keypointLayout: "coco17" }));
  assert.equal(result.layout, "coco17"); assert.deepEqual(result.footJoints, { left: 15, right: 16 });
  assert.deepEqual(result.frames[0].points.slice(0, 4), [null, null, null, [.5, .5]]);
  for (const metadata of [{ frameWidth: null }, { frameHeight: 0 }, { coordinateSpace: "world" }, { keypointLayout: "mediapipe" }]) assert.equal(projectOverlay(pose, source(metadata)), null);
  assert.equal(projectOverlay(rawPose(2, 18), source()), null);
  assert.equal(projectOverlay([rawPose(1, 17)[0], rawPose(1, 33)[0]], source()), null);
});

test("malformed and conflicting timing remains unavailable instead of inventing a clock", () => {
  for (const metadata of [
    { frameTimestampsMs: [0, 1] }, { frameTimestampsMs: [0, 1, 1, 3] }, { frameTimestampsSeconds: [0, null, 2, 3] },
    { frameTimestamps: [0, .000001, .000002, 2] }, { frameTimestampsSeconds: [0, 1, 2, 601] },
    { framesPerSecond: 30 }, { framesPerSecond: false }, { frameOffset: 3 }, { poseStartTimeSeconds: -1 },
  ]) assert.equal(projectOverlay(rawPose(), source(metadata)), null, JSON.stringify(metadata));
  const noClock = source(); delete noClock.evidence.metadata.framesPerSecond; delete noClock.evidence.context.capture;
  assert.equal(projectOverlay(rawPose(), noClock), null);
  assert.deepEqual(projectOverlay(rawPose(), source({ frameTimestampsMs: [250, 300, 400, 600] })).frames.map(f => f.time), [.25, .3, .4, .6]);
  assert.deepEqual(projectOverlay(rawPose(), source({ poseStartTimeSeconds: 2 })).frames.map(f => f.time), [2, 2.0083, 2.0167, 2.025]);
});

test("unqualified, ambiguous, mismatched and missing exact capture bindings cannot yield overlay", () => {
  for (const change of [
    s => { s.effectiveRep.resultStatus.qualified = false; }, s => { s.effectiveRep.resultStatus.duplicate = true; },
    s => { s.evidence.context.rep.playerDocId = "other"; }, s => { s.evidence.context.rep.repId = "other"; },
    s => { s.evidence.context.rep.videoStoragePath = `${folder}/wrong.mov`; }, s => { delete s.evidence.context.rep.videoStoragePath; },
    s => { s.rep.captureId = "a"; s.evidence.context.rep.captureId = "b"; }, s => { s.movieGeneration = ""; },
  ]) { const value = source(); change(value); assert.equal(projectOverlay(rawPose(), value), null); }
  const canonicalNull = source(); canonicalNull.effectiveRep.peakFrame = null; canonicalNull.evidence.metadata.peakFrame = 2;
  assert.deepEqual(projectOverlay(rawPose(), canonicalNull).markers, []);
});

function fixture(options = {}) {
  const recording = source(options.metadata);
  const player = uid => ({ authenticationUID: uid, userUID: uid, organizationId: "club", firstName: "Athlete", lastName: "Private" });
  const db = new FakeFirestore({ "socialSettings/feed": { enabled: true, communityEnabled: true, allOrganizations: true },
    "players/p1": player("u1"), "players/p2": player("u2"), "players/p2/reps/r": recording.rep,
    "socialPreferences/u2": { audience: "organization", automatic: true, videos: true } });
  const state = { downloads: [], signed: [], onDownload: null, time: NOW, pose: options.pose === undefined ? rawPose() : options.pose, generation: "1" };
  const bucket = { name: "bucket", getFiles: async ({ prefix }) => [[movie, ...(options.otherMovies || [])].filter(name => name.startsWith(prefix)).map(name => ({ name }))],
    file: (name, version) => ({
      getMetadata: async () => {
        if (name === movie || options.otherMovies?.includes(name)) return [{ size: 42, generation: state.generation }];
        if (name === `${folder}/pose.json` && state.pose !== null) return [{ size: options.large ? MAX_POSE_BYTES + 1 : Buffer.byteLength(JSON.stringify(state.pose)), generation: "7" }];
        throw Object.assign(new Error("missing"), { code: 404 });
      },
      createReadStream: range => {
        assert.deepEqual(range, { start: 0, end: MAX_POSE_BYTES, validation: false });
        state.downloads.push({ name, generation: version?.generation });
        return Readable.from((async function* () {
          if (state.onDownload) { const run = state.onDownload; state.onDownload = null; await run(); }
          yield Buffer.from(options.badJson ? "invalid" : JSON.stringify(state.pose));
        })());
      },
      getSignedUrl: async ({ expires }) => { state.signed.push({ name, generation: version?.generation, expires }); return [`https://signed.example/${name}`]; },
    }) };
  const readEvidence = async (_id, rep) => ({ folder: rep.storagePath, metadata: { ...rep, ...structuredClone(recording.evidence.metadata), resultsValid: true, processingStatus: "complete" }, context: { ...structuredClone(recording.evidence.context), result: { resultsValid: true } } });
  const api = createSocial({ db, bucket, HttpsError, now: () => state.time, readEvidence });
  const id = idFor("p2", "session", "jump:s1");
  const save = (data = {}) => api.setVisibility({ contractVersion: 2, id, audience: "organization", hidden: false, videos: true, commentsEnabled: true, ...data }, { uid: "u2" });
  const media = (data = {}, uid = "u1") => api.media({ contractVersion: 2, id, includeOverlay: true, ...data }, { uid });
  return { recording, state, db, api, id, save, media, init: () => api.rebuild("p2") };
}

test("optional overlay is explicit per-post consent; owners preview without publishing and legacy shape stays unchanged", async () => {
  const f = fixture(); await f.init();
  let result = await f.media(); assert.ok(result.url); assert.equal(result.overlay, null); assert.equal(f.state.downloads.length, 0);
  assert.ok((await f.media({}, "u2")).overlay);
  assert.deepEqual(f.state.downloads, [{ name: `${folder}/pose.json`, generation: "7" }]);
  await f.save({ poseOverlay: true });
  assert.equal((await f.api.getDetail({ contractVersion: 2, id: f.id }, { uid: "u1" })).poseOverlay, true);
  result = await f.media(); assert.ok(result.overlay); assert.equal(result.expiresAt, NOW + 300000);
  assert.equal(f.state.signed.every(s => s.name === movie && s.generation === "1"), true);
  const legacy = await f.media({ includeOverlay: false }); assert.deepEqual(Object.keys(legacy).sort(), ["expiresAt", "url"]);
  await f.save(); assert.equal((await f.media()).overlay, null);
});

test("overlay permission validates booleans and cannot outlive video permission", async () => {
  const f = fixture(); await f.init();
  await assert.rejects(f.save({ poseOverlay: "true" }), { code: "invalid-argument" });
  await assert.rejects(f.media({ includeOverlay: "true" }), { code: "invalid-argument" });
  await assert.rejects(f.save({ videos: false, poseOverlay: true }), { code: "invalid-argument" });
  await f.save({ poseOverlay: true });
  await f.api.savePreferences({ audience: "organization", automatic: true, videos: false }, { uid: "u2" });
  assert.deepEqual(await f.media(), { url: null, expiresAt: null, overlay: null });
  assert.ok((await f.media({}, "u2")).overlay);
});

test("missing, malformed, oversized or untimed poses leave authorized video playable", async () => {
  for (const options of [{ pose: null }, { badJson: true }, { large: true }, { metadata: { framesPerSecond: 30 } }]) {
    const f = fixture(options); await f.init(); await f.save({ poseOverlay: true });
    const result = await f.media(); assert.ok(result.url); assert.equal(result.overlay, null);
    if (options.large) assert.equal(f.state.downloads.length, 0);
  }
});

test("exact selected movie is preserved; no guessed pose for a legacy video without its binding", async () => {
  const f = fixture({ otherMovies: [`${folder}/wrong.mov`] }); await f.init(); await f.save({ poseOverlay: true });
  assert.equal((await f.media()).url, `https://signed.example/${movie}`);
  delete f.recording.evidence.context.rep.videoStoragePath;
  assert.deepEqual(await f.media(), { url: null, expiresAt: null, overlay: null });
  const legacy = fixture(); await legacy.init(); await legacy.save({ poseOverlay: true }); delete legacy.recording.evidence.context.rep.videoStoragePath;
  const result = await legacy.media(); assert.ok(result.url); assert.equal(result.overlay, null);
});

test("pose consent revoked during artifact projection removes overlay but keeps separately consented video", async () => {
  const f = fixture(); await f.init(); await f.save({ poseOverlay: true });
  f.state.onDownload = () => f.db.doc(`socialActivitySettings/${f.id}`).update({ poseOverlay: false });
  const result = await f.media(); assert.ok(result.url); assert.equal(result.overlay, null);
});

test("video consent, audience, blocks and account binding are checked again after artifact reads", async () => {
  for (const mode of ["video", "audience", "block", "owner", "suspend"]) {
    const f = fixture(); await f.init();
    await f.api.saveCommunityProfile({ displayName: "Player", discoverable: true, showClub: false }, { uid: "u2" });
    await f.save({ audience: "community", poseOverlay: true });
    f.state.onDownload = async () => {
      if (mode === "video") await f.db.doc(`socialActivitySettings/${f.id}`).update({ videos: false });
      if (mode === "audience") await f.db.doc(`socialActivitySettings/${f.id}`).update({ audience: "private" });
      if (mode === "block") await f.db.doc(`socialConnections/${idFor("u1", "u2")}`).set({ participants: ["u1", "u2"], blockedBy: ["u2"] });
      if (mode === "owner") await f.db.doc("players/p2").update({ authenticationUID: "rebound", userUID: "rebound" });
      if (mode === "suspend") await f.db.doc("socialCommunityProfiles/p2").update({ suspended: true });
    };
    if (mode === "video") assert.deepEqual(await f.media(), { url: null, expiresAt: null, overlay: null });
    else await assert.rejects(f.media(), { code: "permission-denied" }, mode);
  }
});

test("changed rep, qualification, video generation or exact sidecar cannot mix old pose with new media", async () => {
  for (const mode of ["rep", "qualification", "generation", "context", "selection", "expired"]) {
    const f = fixture(); await f.init(); await f.save({ poseOverlay: true });
    f.state.onDownload = async () => {
      if (mode === "rep") await f.db.doc("players/p2/reps/r").update({ jumpHeight: .7 });
      if (mode === "qualification") await f.db.doc("players/p2/reps/r").update({ resultsValid: false });
      if (mode === "generation") f.state.generation = "2";
      if (mode === "context") f.recording.evidence.context.rep.repId = "different";
      if (mode === "selection") await f.db.doc(`socialActivities/${f.id}`).update({ repIds: [] });
      if (mode === "expired") f.state.time += 300001;
    };
    assert.deepEqual(await f.media(), { url: null, expiresAt: null, overlay: null }, mode);
  }
});

test("per-post pose consent is owner- and selected-rep-bound", async () => {
  const f = fixture(); await f.init(); await f.save({ poseOverlay: true });
  await f.db.doc(`socialActivitySettings/${f.id}`).update({ poseOverlayOwnerUid: "former-owner" });
  assert.equal((await f.media()).overlay, null);
  await f.db.doc(`socialActivitySettings/${f.id}`).update({ poseOverlayOwnerUid: "u2", poseOverlayRepId: "other-rep" });
  assert.equal((await f.media()).overlay, null);
  assert.equal(f.state.downloads.length, 0);
});

test("native double-precision 240fps pose above the metadata limit stays readable and response-bounded", async () => {
  const pose = Array.from({ length: 960 }, (_, frame) => Array.from({ length: 33 }, (_, joint) => [
    .1234567890123456 + frame * .000001, .3456789012345678 + joint * .000001, -.2345678901234567, .9876543210987654,
  ]));
  assert.ok(Buffer.byteLength(JSON.stringify(pose)) > 2 * 1024 * 1024);
  const f = fixture({ pose, metadata: { framesPerSecond: 240 } }); f.recording.evidence.context.capture.clipFramesPerSecondUsed = 240;
  await f.init(); await f.save({ poseOverlay: true });
  const result = await f.media();
  assert.ok(result.url); assert.equal(result.overlay.frames.length, MAX_FRAMES);
  assert.equal(result.overlay.frames.at(-1).time, 3.9958);
  assert.ok(Buffer.byteLength(JSON.stringify(result.overlay)) <= MAX_BYTES);
  assert.deepEqual(f.state.downloads, [{ name: `${folder}/pose.json`, generation: "7" }]);
});

test("pose source size and generation gates prevent an unbounded or unpinned read", async () => {
  for (const metadata of [{ size: MAX_POSE_BYTES + 1, generation: "1" }, { size: NaN, generation: "1" }, { size: -1, generation: "1" }, { size: 10, generation: "" }]) {
    let reads = 0;
    const bucket = { file: () => ({ getMetadata: async () => [metadata], createReadStream: () => { reads++; return Readable.from([]); } }) };
    assert.equal(await readSocialOverlay(source(), bucket), null);
    assert.equal(reads, 0);
  }
});

test("a lying size declaration cannot stream beyond the pose bound", async () => {
  let stream, requested;
  const bucket = { file: (_name, version) => ({
    getMetadata: async () => [{ size: 100, generation: "7" }],
    createReadStream: range => {
      requested = { range, generation: version.generation };
      stream = Readable.from((async function* () { for (let i = 0; i < 17; i++) yield Buffer.alloc(1024 * 1024, 32); })());
      return stream;
    },
  }) };
  assert.equal(await readSocialOverlay(source(), bucket), null);
  assert.deepEqual(requested, { range: { start: 0, end: MAX_POSE_BYTES, validation: false }, generation: "7" });
  assert.equal(stream.destroyed, true);
});

test("interrupted or incomplete pinned pose streams leave the overlay unavailable", async () => {
  for (const mode of ["error", "short"]) {
    const bucket = { file: () => ({ getMetadata: async () => [{ size: 100, generation: "7" }], createReadStream: () => Readable.from((async function* () {
      yield Buffer.from("[]"); if (mode === "error") throw new Error("Storage read interrupted");
    })()) }) };
    assert.equal(await readSocialOverlay(source(), bucket), null);
  }
});
