"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { FakeFirestore, FieldValue, HttpsError } = require("./test-support/fake-firestore");
const { createRepRevisions } = require("./rep-revisions");

const admin = { uid: "admin", email: "Nolan@PoseTek.net", emailVerified: true };
const unverified = { uid: "admin2", email: "dylan@posetek.net", emailVerified: false };
const coach = { uid: "coach", email: "coach@example.test", emailVerified: true };

const FOLDER = "p1/changeOfDirection/session3/kick2";
const REP = {
  repType: "changeOfDirection", drillType: "changeOfDirection", sessionNumber: 3, repNumber: 2, absoluteRepNumber: 7,
  storagePath: `${FOLDER}/change_of_direction.mov`, sessionId: "s3", gateStartSide: "left", createdAt: "server-time",
  totalTime: null, phase1Time: null, startFrame: 120, apexFrame: 400, endFrame: null, markerDistance: 9.144,
};

function fakeBucket(files = {}, tokens = {}) {
  const store = new Map(Object.entries(files));
  const meta = new Map(Object.entries(tokens).map(([path, token]) => [path, { firebaseStorageDownloadTokens: token }]));
  const writes = [];
  const bucket = {
    name: "kickai-69dd0.firebasestorage.app",
    file: (path) => ({
      exists: async () => [store.has(path)],
      download: async () => [Buffer.from(store.get(path), "utf8")],
      getMetadata: async () => { if (!store.has(path)) throw new Error("No such object"); return [{ metadata: meta.get(path) || {} }]; },
      save: async (bytes, options) => {
        store.set(path, Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes));
        meta.set(path, options?.metadata?.metadata || {});
        writes.push({ path, options });
      },
      delete: async () => { store.delete(path); meta.delete(path); },
    }),
  };
  return { bucket, store, meta, writes };
}

const PHONE_TOKEN = "phone-token-1111";

function harness({ files, tokens, seed = {}, failSaveOn } = {}) {
  const db = new FakeFirestore({ "players/p1": { firstName: "A" }, "players/p1/reps/r1": REP, ...seed });
  const storage = fakeBucket(
    files ?? { [`${FOLDER}/metadata.json`]: JSON.stringify({ framesPerSecond: 120, totalFrames: 900, startFrame: 120, endFrame: NaN, failedSteps: ["cod.frames.end"], processingStatus: "partial" }).replace("null", "NaN") },
    tokens ?? (files ? {} : { [`${FOLDER}/metadata.json`]: PHONE_TOKEN }),
  );
  if (failSaveOn) {
    const original = storage.bucket.file;
    storage.bucket.file = (path) => {
      const file = original(path);
      if (path === failSaveOn) file.save = async () => { throw new Error("bucket down"); };
      return file;
    };
  }
  let tick = 1_700_000_000_000;
  let minted = 0;
  const revisions = createRepRevisions({ db, bucket: storage.bucket, FieldValue, HttpsError, now: () => (tick += 1000), randomHex: () => "abcd1234", randomToken: () => `minted-${++minted}` });
  return { db, revisions, ...storage };
}

const payload = {
  playerId: "p1", repId: "r1", drill: "changeOfDirection",
  fields: { endFrame: 420, phase1EndFrame: 300, phase2EndFrame: 330, totalTime: 2.5, phase1Time: 1.5, phase2Time: 0.25, phase3Time: 0.75, avgBallDistance: null },
  metadata: { endFrame: 420, totalTime: 2.5, failedSteps: [], processingStatus: "complete" },
  annotations: { schemaVersion: 1, com: [{ frame: 120, x: 0.2, y: 0.5 }] },
  note: "Set the end frame by hand",
};

test("only a verified posetek.net admin can revise a rep", async () => {
  const { revisions } = harness();
  await assert.rejects(revisions.reviseRep(payload, coach), { code: "permission-denied" });
  await assert.rejects(revisions.reviseRep(payload, unverified), { code: "permission-denied" });
  await assert.rejects(revisions.reviseRep(payload, { uid: "x", email: "nolan@posetek.net.evil.com", emailVerified: true }), { code: "permission-denied" });
  await assert.rejects(revisions.reviseRep(payload, null), { code: "unauthenticated" });
});

test("a revision overwrites the rep in place, keeps identity fields, and snapshots the original", async () => {
  const { db, revisions, store } = harness();
  const result = await revisions.reviseRep(payload, admin);
  assert.match(result.revisionId, /^\d{14}-abcd1234$/);
  assert.equal(result.folder, FOLDER);
  const rep = db.snapshot("players/p1/reps/r1");
  assert.equal(rep.endFrame, 420);
  assert.equal(rep.totalTime, 2.5);
  assert.equal(rep.avgBallDistance, null);
  assert.equal(rep.absoluteRepNumber, 7);
  assert.equal(rep.sessionId, "s3");
  assert.equal(rep.repType, "changeOfDirection");
  assert.equal(rep.createdAt, "server-time");
  assert.equal(rep.adminRevision.byEmail, "Nolan@PoseTek.net");
  assert.equal(rep.adminRevision.note, "Set the end frame by hand");
  const revision = db.snapshot(`players/p1/reps/r1/revisions/${result.revisionId}`);
  assert.equal(revision.previous.endFrame, null);
  assert.equal(revision.previous.startFrame, 120);
  assert.equal(revision.metadataBackedUp, true);
  assert.deepEqual(revision.fields, payload.fields);
  // The previous metadata.json is kept byte-for-byte, NaN token included.
  assert.match(store.get(`${FOLDER}/admin_revisions/${result.revisionId}/metadata.json`), /NaN/);
  const metadata = JSON.parse(store.get(`${FOLDER}/metadata.json`));
  assert.equal(metadata.framesPerSecond, 120);
  assert.equal(metadata.endFrame, 420);
  assert.deepEqual(metadata.failedSteps, []);
  assert.equal(metadata.processingStatus, "complete");
  assert.deepEqual(metadata.adminRevision.previousFailedSteps, ["cod.frames.end"]);
  const annotations = JSON.parse(store.get(`${FOLDER}/admin_annotations.json`));
  assert.equal(annotations.revisionId, result.revisionId);
  assert.equal(annotations.com[0].frame, 120);
});

test("fields outside the allow-list, wrong shapes, and the wrong drill are refused before anything is written", async () => {
  const { db, revisions, writes } = harness();
  await assert.rejects(revisions.reviseRep({ ...payload, fields: { absoluteRepNumber: 1 } }, admin), { code: "invalid-argument" });
  await assert.rejects(revisions.reviseRep({ ...payload, fields: { endFrame: 4.5 } }, admin), { code: "invalid-argument" });
  await assert.rejects(revisions.reviseRep({ ...payload, fields: { totalTime: "2.5" } }, admin), { code: "invalid-argument" });
  await assert.rejects(revisions.reviseRep({ ...payload, fields: { gateStartSide: "up" } }, admin), { code: "invalid-argument" });
  await assert.rejects(revisions.reviseRep({ ...payload, metadata: { processingStatus: "done" } }, admin), { code: "invalid-argument" });
  await assert.rejects(revisions.reviseRep({ ...payload, drill: "sprint", fields: { endFrame: 420 }, metadata: {} }, admin), { code: "failed-precondition" });
  await assert.rejects(revisions.reviseRep({ ...payload, repId: "../r1" }, admin), { code: "invalid-argument" });
  await assert.rejects(revisions.reviseRep({ ...payload, repId: "missing" }, admin), { code: "not-found" });
  await assert.rejects(revisions.reviseRep({ ...payload, fields: {}, metadata: {}, annotations: null }, admin), { code: "invalid-argument" });
  assert.equal(writes.length, 0);
  assert.equal(db.snapshot("players/p1/reps/r1").endFrame, null);
});

test("a rep whose storagePath points outside its athlete is refused", async () => {
  const { revisions } = harness({ seed: { "players/p1/reps/r1": { ...REP, storagePath: "other/changeOfDirection/session1/kick1/x.mov" } } });
  await assert.rejects(revisions.reviseRep(payload, admin), { code: "failed-precondition" });
});

test("a rep without metadata.json still gets one, and the revision records that nothing was backed up", async () => {
  const { db, revisions, store } = harness({ files: {} });
  const result = await revisions.reviseRep(payload, admin);
  assert.equal(db.snapshot(`players/p1/reps/r1/revisions/${result.revisionId}`).metadataBackedUp, false);
  const metadata = JSON.parse(store.get(`${FOLDER}/metadata.json`));
  assert.equal(metadata.totalTime, 2.5);
  assert.equal(metadata.adminRevision.revisionId, result.revisionId);
});

test("if the artifact write fails the document is restored and the revision withdrawn", async () => {
  const { db, revisions } = harness({ failSaveOn: `${FOLDER}/metadata.json` });
  await assert.rejects(revisions.reviseRep(payload, admin), { code: "internal" });
  const rep = db.snapshot("players/p1/reps/r1");
  assert.equal(rep.endFrame, null);
  assert.equal(rep.adminRevision, undefined);
});

test("a revision can be restored once, putting document and metadata back", async () => {
  const { db, revisions, store } = harness();
  const original = store.get(`${FOLDER}/metadata.json`);
  const { revisionId } = await revisions.reviseRep(payload, admin);
  assert.notEqual(store.get(`${FOLDER}/metadata.json`), original);
  await assert.rejects(revisions.restoreRepRevision({ playerId: "p1", repId: "r1", revisionId }, coach), { code: "permission-denied" });
  const restored = await revisions.restoreRepRevision({ playerId: "p1", repId: "r1", revisionId }, admin);
  assert.equal(restored.rep.endFrame, null);
  const rep = db.snapshot("players/p1/reps/r1");
  assert.equal(rep.endFrame, null);
  assert.equal(rep.adminRevision, undefined);
  assert.equal(rep.absoluteRepNumber, 7);
  assert.equal(store.get(`${FOLDER}/metadata.json`), original);
  assert.ok(db.snapshot(`players/p1/reps/r1/revisions/${revisionId}`).restoredAtMillis);
  await assert.rejects(revisions.restoreRepRevision({ playerId: "p1", repId: "r1", revisionId }, admin), { code: "failed-precondition" });
  await assert.rejects(revisions.restoreRepRevision({ playerId: "p1", repId: "r1", revisionId: "nope" }, admin), { code: "not-found" });
});

test("restoring a revision that had no metadata.json removes the one the revision created", async () => {
  const { revisions, store } = harness({ files: {} });
  const { revisionId } = await revisions.reviseRep(payload, admin);
  assert.ok(store.has(`${FOLDER}/metadata.json`));
  await revisions.restoreRepRevision({ playerId: "p1", repId: "r1", revisionId }, admin);
  assert.equal(store.has(`${FOLDER}/metadata.json`), false);
});

test("dribbling and sprint field rules accept their own fields and nothing else", async () => {
  const { db, revisions } = harness({ seed: {
    "players/p1/reps/d1": { repType: "dribbling", sessionNumber: 1, repNumber: 1 },
    "players/p1/reps/s1": { repType: "sprint", sessionNumber: 1, repNumber: 1 },
  } });
  await revisions.reviseRep({ playerId: "p1", repId: "d1", drill: "dribbling", fields: { avgBallDistance: 0.31, gateStartSide: "right" } }, admin);
  assert.equal(db.snapshot("players/p1/reps/d1").avgBallDistance, 0.31);
  await revisions.reviseRep({ playerId: "p1", repId: "s1", drill: "sprint", fields: { max_velocity: 7.2, endFrame: 300 } }, admin);
  assert.equal(db.snapshot("players/p1/reps/s1").max_velocity, 7.2);
  await assert.rejects(revisions.reviseRep({ playerId: "p1", repId: "s1", drill: "sprint", fields: { phase1Time: 1 } }, admin), { code: "invalid-argument" });
});

for (const [drill, repType, key] of [["dribbling", "dribbling", "dribble_foot"], ["shooting", "side_kick", "strike_foot"]]) {
  test(`${drill} foot can be assigned, replaced, cleared, and restored without altering measurements`, async () => {
    const folder = `p1/${drill === "shooting" ? "deadballShot" : drill}/session1/kick1`;
    const original = { repType, sessionNumber: 1, repNumber: 1, totalTime: 4, velocity: 25, markerDistance: 10, gateStartSide: "right" };
    const originalMetadata = { framesPerSecond: 60, totalTime: 4, velocity: 25, failedSteps: ["existing.failure"], processingStatus: "partial" };
    const originalAnnotations = JSON.stringify({ com: [{ frame: 10, x: 0.2, y: 0.5 }], customNote: "Keep this annotation" });
    const { db, revisions, store } = harness({ seed: { "players/p1/reps/foot": original }, files: { [`${folder}/metadata.json`]: JSON.stringify(originalMetadata), [`${folder}/admin_annotations.json`]: originalAnnotations } });
    const request = { playerId: "p1", repId: "foot", drill };
    for (const value of ["left", "right", null]) {
      await revisions.reviseRep({ ...request, fields: { [key]: value }, metadata: { [key]: value } }, admin);
      const rep = db.snapshot("players/p1/reps/foot");
      assert.equal(rep[key], value);
      for (const [field, expected] of Object.entries(original)) assert.deepEqual(rep[field], expected);
      const metadata = JSON.parse(store.get(`${folder}/metadata.json`));
      assert.equal(metadata[key], value);
      for (const [field, expected] of Object.entries(originalMetadata)) assert.deepEqual(metadata[field], expected);
      assert.equal(store.get(`${folder}/admin_annotations.json`), originalAnnotations);
    }
    await revisions.reviseRep({ ...request, fields: { [key]: "left" }, metadata: { [key]: "left" } }, admin);
    const measurements = drill === "dribbling" ? { totalTime: 3 } : { velocity: 30 };
    const { revisionId } = await revisions.reviseRep({ ...request, fields: measurements, metadata: measurements }, admin);
    assert.equal(db.snapshot("players/p1/reps/foot")[key], "left");
    assert.equal(JSON.parse(store.get(`${folder}/metadata.json`))[key], "left");
    await revisions.restoreRepRevision({ playerId: "p1", repId: "foot", revisionId }, admin);
    assert.equal(db.snapshot("players/p1/reps/foot")[key], "left");
  });

  test(`${drill} foot rejects invalid values and another drill's foot field before writing`, async () => {
    const { revisions, writes } = harness({ seed: { "players/p1/reps/foot": { repType, sessionNumber: 1, repNumber: 1 } } });
    const request = { playerId: "p1", repId: "foot", drill };
    for (const value of ["both", "LEFT", "", 0, [], {}]) {
      await assert.rejects(revisions.reviseRep({ ...request, fields: { [key]: value } }, admin), { code: "invalid-argument" });
      await assert.rejects(revisions.reviseRep({ ...request, metadata: { [key]: value } }, admin), { code: "invalid-argument" });
    }
    const otherKey = key === "dribble_foot" ? "strike_foot" : "dribble_foot";
    await assert.rejects(revisions.reviseRep({ ...request, fields: { [otherKey]: "left" } }, admin), { code: "invalid-argument" });
    assert.equal(writes.length, 0);
  });
}

test("every written file carries a Firebase download token so the web SDK can open it", async () => {
  const { revisions, meta, store } = harness();
  const { revisionId } = await revisions.reviseRep(payload, admin);
  // The phone's own token survives the overwrite, so cached download URLs stay valid.
  assert.equal(meta.get(`${FOLDER}/metadata.json`).firebaseStorageDownloadTokens, PHONE_TOKEN);
  assert.match(meta.get(`${FOLDER}/admin_annotations.json`).firebaseStorageDownloadTokens, /^minted-/);
  assert.match(meta.get(`${FOLDER}/admin_revisions/${revisionId}/metadata.json`).firebaseStorageDownloadTokens, /^minted-/);
  assert.match(meta.get(`${FOLDER}/admin_revisions/${revisionId}/rep.json`).firebaseStorageDownloadTokens, /^minted-/);
  await revisions.restoreRepRevision({ playerId: "p1", repId: "r1", revisionId }, admin);
  assert.equal(meta.get(`${FOLDER}/metadata.json`).firebaseStorageDownloadTokens, PHONE_TOKEN);
  assert.ok(store.has(`${FOLDER}/metadata.json`));
});

test("a rep whose metadata.json had no token gets a minted one", async () => {
  const { revisions, meta } = harness({ tokens: {} });
  await revisions.reviseRep(payload, admin);
  assert.match(meta.get(`${FOLDER}/metadata.json`).firebaseStorageDownloadTokens, /^minted-/);
});

test("a kick revision rewrites the ball artifacts the phone's viewer reads, backs them up, and restores them", async () => {
  const folder = "p1/deadballShot/session2/kick1";
  const originalInfo = JSON.stringify({ ball_speed_ms: 20, ball_speed_mph: 44.7, launch_angle: 12, contact_frame: 100 });
  const { db, revisions, store, meta } = harness({
    seed: { "players/p1/reps/k1": { repType: "side_kick", drillType: "deadballShot", sessionNumber: 2, repNumber: 1, velocity: 20, launch_angle: 12, contact_frame: 100 } },
    files: { [`${folder}/metadata.json`]: JSON.stringify({ frameWidth: 1920, m_per_px: 0.002, resultsValid: true }), [`${folder}/ball_information.json`]: originalInfo },
  });
  const request = {
    playerId: "p1", repId: "k1", drill: "shooting",
    fields: { velocity: 24.5, launch_angle: 15.2, contact_frame: 98 },
    metadata: { velocity: 24.5, launch_angle: 15.2, contact_frame: 98, resultsValid: true, processingStatus: "complete" },
    artifacts: {
      "ball_information.json": { ball_speed_ms: 24.5, ball_speed_mph: 54.8, launch_angle: 15.2, contact_frame: 98 },
      "ball_trajectory.json": { t_values: [98, 99], x_values: [0.4, 0.42], y_values: [0.8, 0.78], contact_frame: 98, transition_frame: null, direction: null },
    },
  };
  const { revisionId } = await revisions.reviseRep(request, admin);
  assert.equal(db.snapshot("players/p1/reps/k1").velocity, 24.5);
  assert.equal(JSON.parse(store.get(`${folder}/ball_information.json`)).ball_speed_ms, 24.5);
  assert.deepEqual(JSON.parse(store.get(`${folder}/ball_trajectory.json`)).t_values, [98, 99]);
  assert.match(meta.get(`${folder}/ball_trajectory.json`).firebaseStorageDownloadTokens, /^minted-/);
  assert.equal(store.get(`${folder}/admin_revisions/${revisionId}/ball_information.json`), originalInfo);
  const revision = db.snapshot(`players/p1/reps/k1/revisions/${revisionId}`);
  assert.deepEqual(revision.artifactsWritten, ["ball_information.json", "ball_trajectory.json"]);
  assert.deepEqual(revision.artifactsBackedUp, ["ball_information.json"]);
  await revisions.restoreRepRevision({ playerId: "p1", repId: "k1", revisionId }, admin);
  assert.equal(store.get(`${folder}/ball_information.json`), originalInfo);
  assert.equal(store.has(`${folder}/ball_trajectory.json`), false);
  assert.equal(db.snapshot("players/p1/reps/k1").velocity, 20);
});

test("artifacts outside the drill's allow-list are refused before anything is written", async () => {
  const { revisions, writes } = harness({ seed: { "players/p1/reps/k1": { repType: "side_kick", sessionNumber: 2, repNumber: 1 } } });
  await assert.rejects(revisions.reviseRep({ playerId: "p1", repId: "k1", drill: "shooting", artifacts: { "pose.json": { frames: [] } } }, admin), { code: "invalid-argument" });
  await assert.rejects(revisions.reviseRep({ playerId: "p1", repId: "k1", drill: "shooting", artifacts: { "ball_information.json": [1, 2] } }, admin), { code: "invalid-argument" });
  await assert.rejects(revisions.reviseRep({ ...payload, artifacts: { "ball_information.json": { ball_speed_ms: 1 } } }, admin), { code: "invalid-argument" });
  assert.equal(writes.length, 0);
});

test("a kick's direction takes the phone's travel labels, not a foot", async () => {
  const { db, revisions } = harness({ seed: { "players/p1/reps/k2": { repType: "side_kick", sessionNumber: 3, repNumber: 1, direction: "left_to_right" } } });
  const request = { playerId: "p1", repId: "k2", drill: "shooting" };
  await revisions.reviseRep({ ...request, fields: { direction: "right_to_left", velocity: 27.071, launch_angle: 34.451, contact_frame: 442 } }, admin);
  assert.equal(db.snapshot("players/p1/reps/k2").direction, "right_to_left");
  for (const value of ["left", "right", "up"]) {
    await assert.rejects(revisions.reviseRep({ ...request, fields: { direction: value } }, admin), { code: "invalid-argument" });
  }
});
