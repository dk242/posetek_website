"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FakeFirestore, FakeTimestamp, HttpsError } = require("./test-support/fake-firestore");
const { createEffectiveResults } = require("./effective-results");
const { readProvisionalEstimates, validatedEntry, WINDOW_MS } = require("./provisional-estimates");

const NOW = Date.UTC(2026, 8, 17, 22), RECORDED = NOW - 86400000;
const FOLDER = "player/dribbling/session1/kick1", SOURCE = `${FOLDER}/dribbling.mov`;
const MD5 = Buffer.alloc(16, 1).toString("base64"), DOC = "players/player/insightMetadata/provisionalEstimates";
const admin = { uid: "admin", email: "admin@posetek.net", emailVerified: true };
const row = { id: "rep", repType: "dribbling", drillType: "dribbling", createdAtMillis: RECORDED,
  storageFolder: FOLDER, totalTime: null, resultStatus: { qualified: false, duplicate: false, reason: "noPrimaryResult", revisionId: null } };
function entry() {
  return { id: "reviewed-rep-v1", repId: "rep", drill: "dribbling", axis: "ballControl", kind: "conditionalEstimate",
    method: "constant_return_pace_v1", status: "active", confidence: "low", estimatedTotalSeconds: 10,
    lowerSeconds: 9.6, upperSeconds: 11.4, observedCourseFraction: 0.94, recordedAtMillis: RECORDED,
    reviewedAtMillis: NOW - 1000, reviewedByUid: "reviewer", source: { playerId: "player", repId: "rep", drill: "dribbling",
      recordedAtMillis: RECORDED, storagePath: SOURCE, generation: "123", md5Hash: MD5, sha256: "1".repeat(64) } };
}
function harness({ entries = [entry()], seed = {}, evidence, onMetadata } = {}) {
  const original = { repType: "dribbling", drillType: "dribbling", createdAt: FakeTimestamp.fromMillis(RECORDED),
    sessionNumber: 1, repNumber: 1, totalTime: null, storagePath: SOURCE };
  const db = new FakeFirestore({ "players/player": { userUID: "athlete" }, "players/player/reps/rep": original,
    [DOC]: { schemaVersion: 1, playerId: "player", entries }, ...seed });
  const reads = [], originalRead = db.read.bind(db); db.read = path => { reads.push(path); return originalRead(path); };
  const calls = [], objects = new Map([[SOURCE, { generation: "123", md5Hash: MD5 }]]);
  const bucket = { name: "test", file(name) { return { async getMetadata() {
    calls.push(name); if (onMetadata) await onMetadata(db); const value = objects.get(name);
    if (!value) throw Object.assign(Error("missing"), { code: 404 }); return [value];
  } }; } };
  const defaultEvidence = { folder: FOLDER, metadata: { resultsValid: false, processingStatus: "partial", totalTime: null },
    context: { rep: { playerDocId: "player", repId: "rep", videoStoragePath: SOURCE }, result: { resultsValid: false, primaryMetric: null } } };
  const service = createEffectiveResults({ db, bucket, HttpsError, now: () => NOW, readEvidence: evidence || (async () => defaultEvidence) });
  return { db, bucket, reads, calls, objects, service, original };
}
const read = (h, reps = [row], drill) => readProvisionalEstimates({ db: h.db, bucket: h.bucket, playerId: "player", reps, drill, now: NOW });

test("authenticated estimates are an allowlisted top-level planning projection; measured rows are unchanged", async () => {
  const h = harness(), before = await h.service.listForPlayer("player", undefined, true);
  const result = await h.service.getResults({ playerId: "player" }, { uid: "athlete" });
  assert.deepEqual(result.reps, before.reps); assert.equal(result.version, before.version);
  assert.equal(result.provisionalEstimates.length, 1); const estimate = result.provisionalEstimates[0];
  assert.equal(estimate.estimatedTotalSeconds, 10); assert.equal(estimate.observedCourseFraction, 0.94);
  assert.equal(estimate.confidence, "low"); assert.match(estimate.limitation, /not a confidence interval/);
  for (const key of ["source", "storagePath", "generation", "md5Hash", "sha256", "reviewedByUid", "totalTime", "resultStatus"])
    assert.equal(Object.hasOwn(estimate, key), false);
  assert.equal(result.reps[0].totalTime, null); assert.equal(result.reps[0].resultStatus.qualified, false);
  assert.deepEqual(h.db.snapshot("players/player/reps/rep"), h.original);
});

test("shared readers neither read the private estimate document nor add estimate fields", async () => {
  const h = harness(); const result = await h.service.listForPlayer("player");
  assert.deepEqual(Object.keys(result).sort(), ["reps", "version"]);
  assert.equal(h.reads.includes(DOC), false); assert.deepEqual(h.calls, []);
});

test("client-stuffed estimate data in request or rep fields has no authority", async () => {
  const h = harness({ entries: [], seed: { "players/player/reps/rep": {
    repType: "dribbling", drillType: "dribbling", createdAt: FakeTimestamp.fromMillis(RECORDED), totalTime: null,
    storagePath: SOURCE, provisionalEstimates: [entry()], estimatedTotalSeconds: 10,
  } } });
  const result = await h.service.getResults({ playerId: "player", provisionalEstimates: [entry()], source: entry().source }, admin);
  assert.deepEqual(result.provisionalEstimates, []); assert.equal(Object.hasOwn(result.reps[0], "estimatedTotalSeconds"), false);
  assert.equal(result.reps[0].totalTime, null);
});

test("current measured dribbling automatically hides all estimates without reading private provenance", async () => {
  const h = harness(); assert.deepEqual(await read(h, [row, { ...row, id: "new-measured", totalTime: 9,
    resultStatus: { qualified: true, duplicate: false } }]), []);
  assert.equal(h.reads.includes(DOC), false); assert.deepEqual(h.calls, []);
});

test("foreign, missing, reclassified, duplicate and already-qualified source attempts cannot receive estimates", () => {
  const cases = [[], [{ ...row, id: "foreign" }], [{ ...row, repType: "changeOfDirection" }], [{ ...row, drillType: "changeOfDirection" }],
    [{ ...row, createdAtMillis: RECORDED + 1 }], [{ ...row, storageFolder: null }],
    [{ ...row, resultStatus: { qualified: false, duplicate: true } }], [{ ...row, resultStatus: { qualified: true, duplicate: false } }],
    [{ ...row, resultStatus: undefined }]];
  for (const rows of cases) assert.equal(validatedEntry(entry(), "player", rows, NOW), null);
});

test("strict fields reject unsupported methods, COD, malformed values, stale dates and foreign provenance", () => {
  const changes = [e => e.id = "../id", e => e.status = "approved", e => e.method = "assumed_score", e => e.confidence = "high",
    e => e.drill = "changeOfDirection", e => e.axis = "agility", e => e.kind = "verifiedResult", e => delete e.reviewedByUid,
    e => e.estimatedTotalSeconds = "10", e => e.estimatedTotalSeconds = NaN, e => e.estimatedTotalSeconds = Infinity,
    e => e.estimatedTotalSeconds = 1.99, e => e.estimatedTotalSeconds = 60.01, e => e.lowerSeconds = 10.1,
    e => e.upperSeconds = 9.9, e => e.lowerSeconds = e.upperSeconds = 10,
    e => e.observedCourseFraction = 0.749, e => e.observedCourseFraction = 1, e => e.observedCourseFraction = "0.94",
    e => e.recordedAtMillis = NOW - WINDOW_MS - 1, e => e.reviewedAtMillis = NOW + 1,
    e => e.reviewedAtMillis = RECORDED - 1, e => e.recordedAtMillis = String(RECORDED),
    e => e.source.playerId = "other", e => e.source.repId = "other", e => e.source.drill = "changeOfDirection",
    e => e.source.recordedAtMillis++, e => e.source.storagePath = "other/dribbling/session1/kick1/dribbling.mov",
    e => e.source.storagePath = FOLDER + "/../other.mov", e => e.source.storagePath = FOLDER + "/nested/video.mov",
    e => e.source.generation = "0", e => e.source.generation = 123, e => e.source.md5Hash = "invalid", e => e.source.sha256 = "invalid"];
  for (const change of changes) { const e = entry(); change(e); assert.equal(validatedEntry(e, "player", [row], NOW), null); }
});

test("malformed or foreign documents, duplicate entries and unsupported drill requests are withheld", async () => {
  for (const value of [null, [], {}, { schemaVersion: 2, playerId: "player", entries: [entry()] },
    { schemaVersion: 1, playerId: "other", entries: [entry()] }, { schemaVersion: 1, playerId: "player", entries: Array(21).fill(entry()) }]) {
    const h = harness({ seed: { [DOC]: value } }); assert.deepEqual(await read(h), []);
  }
  const duplicate = harness({ entries: [entry(), { ...entry(), id: "another-id" }] }); assert.deepEqual(await read(duplicate), []);
  const h = harness(); assert.deepEqual(await read(h, [row], "changeOfDirection"), []); assert.equal(h.reads.includes(DOC), false);
});

test("source generations and MD5 must still match; deleted originals hide estimates and transport errors propagate", async () => {
  for (const meta of [{ generation: "124", md5Hash: MD5 }, { generation: "123", md5Hash: Buffer.alloc(16).toString("base64") }, null]) {
    const h = harness(); if (meta) h.objects.set(SOURCE, meta); else h.objects.delete(SOURCE); assert.deepEqual(await read(h), []);
  }
  const h = harness({ onMetadata: async () => { throw Error("source unavailable"); } }); await assert.rejects(read(h), /source unavailable/);
});

test("a changed rep pointer, identity date, drill or neighboring movie cannot reuse reviewed provenance", async () => {
  for (const patch of [{ storagePath: FOLDER + "/other.mov" }, { createdAt: FakeTimestamp.fromMillis(RECORDED + 1) },
    { repType: "changeOfDirection" }, { storagePath: FOLDER }]) {
    const h = harness(); await h.db.collection("players").doc("player").collection("reps").doc("rep").update(patch);
    assert.deepEqual(await read(h), []); assert.deepEqual(h.calls, []);
  }
  const e = entry(); e.source.storagePath = FOLDER + "/neighbor.mov";
  const h = harness({ entries: [e] }); h.objects.set(e.source.storagePath, { generation: "123", md5Hash: MD5 });
  assert.deepEqual(await read(h), []); assert.deepEqual(h.calls, []);
});

test("unauthorized viewers cannot read private estimates and authorization is checked again after source verification", async () => {
  const h = harness(); await assert.rejects(h.service.getResults({ playerId: "player" }, { uid: "outsider" }), { code: "permission-denied" });
  assert.equal(h.reads.includes(DOC), false); assert.deepEqual(h.calls, []);
  const changed = harness({ onMetadata: async db => db.collection("players").doc("player").update({ userUID: "new-owner" }) });
  await assert.rejects(changed.service.getResults({ playerId: "player" }, { uid: "athlete" }), { code: "permission-denied" });
  assert.equal(changed.reads.filter(path => path === "players/player").length, 2);
});

test("extra private annotations are not exposed or used as public estimate copy", async () => {
  const e = entry(); e.assumption = "untrusted replacement"; e.limitation = "pretend this is measured"; e.secretNote = "private";
  const result = await read(harness({ entries: [e] })); assert.equal(result.length, 1);
  assert.equal(result[0].assumption, "Maintains the observed return pace to the finish."); assert.match(result[0].limitation, /conditional estimate/);
  assert.equal(Object.hasOwn(result[0], "secretNote"), false);
});
