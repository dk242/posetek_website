"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { FakeFirestore, FieldValue, HttpsError } = require("./test-support/fake-firestore");
const { createAnalysisReviews, athleteSplit, sourceHash } = require("./analysis-reviews");
const admin = { uid: "admin", email: "review@posetek.net", emailVerified: true };
const original = { schemaVersion: 2, playerId: "p1", repId: "r1", jobId: "job1", capability: "kick_analysis", metrics: [{ id: "contact.knee.kicking", valid: true }, { id: "contact.invalid", valid: false }], focusAreas: [{ title: "Original" }] };
const run = { playerId: "p1", jobId: "job1", capability: "kick_analysis", result: original, context: { metrics: "source evidence" }, provenance: { contextHash: "abc", models: { observer: "model" } } };
const payload = { playerId: "p1", targetType: "single", targetId: "r1", sourceJobId: "job1", baseRevision: 0, feedback: { summary: "Reviewed", focusAreas: [{ id: "focus1", title: "Priority", observation: "Visible at contact", cue: "A coaching cue", whyItMatters: "Why this matters", evidenceIds: ["contact.knee.kicking"] }] }, annotations: [{ id: "a1", repId: "r1", phase: "contact", frame: 12, limbs: ["leftShin"], comment: "Human observation", point: { x: 0.3, y: 0.7 } }], notes: { incorrect: "Low-priority finding", missedPriorities: "Missed key issue", other: "Context" }, datasetApproved: true, publish: true };
function setup(extra = {}) {
  const db = new FakeFirestore({ "players/p1": {}, "players/p1/reps/r1": { repType: "side_kick", strike_foot: "left" }, "players/p1/reps/r2": { repType: "side_kick", strike_foot: "right" }, "players/p1/aiAnalyses/r1": original, "players/p1/aiAnalysisRuns/job1": run, ...extra });
  return { db, api: createAnalysisReviews({ db, FieldValue, HttpsError }) };
}
test("review save and export require a verified admin", async () => {
  const { api, db } = setup();
  for (const caller of [null, { ...admin, emailVerified: false }, { ...admin, email: "x@posetek.net.evil.test" }, { ...admin, isAnonymous: true }]) {
    await assert.rejects(api.saveReview(payload, caller));
    await assert.rejects(api.exportReviews({ playerIds: ["p1"] }, caller));
  }
  assert.equal(db.docs.size, 5);
});
test("save preserves immutable original and publishes no private notes or identities", async () => {
  const { api, db } = setup();
  const saved = await api.saveReview(payload, admin);
  const review = db.snapshot(`players/p1/aiAnalysisReviews/${saved.reviewId}`);
  assert.deepEqual(review.original, original);
  assert.deepEqual(db.snapshot("players/p1/aiAnalyses/r1"), original);
  assert.deepEqual(db.snapshot("players/p1/aiAnalysisRuns/job1"), run);
  assert.equal(review.feedback.focusAreas[0].rank, 1);
  const projection = db.snapshot("players/p1/aiAnalysisCorrections/single_r1");
  assert.equal(projection.sourceJobId, "job1");
  for (const key of ["notes", "reviewerEmail", "reviewerUid", "original", "datasetApproved"]) assert.equal(projection[key], undefined);
});
test("competing reviews cannot overwrite each other", async () => {
  const { api, db } = setup();
  const results = await Promise.allSettled([api.saveReview(payload, admin), api.saveReview(payload, admin)]);
  assert.equal(results.filter(row => row.status === "fulfilled").length, 1);
  assert.equal(results.find(row => row.status === "rejected").reason.code, "aborted");
  assert.equal(db.snapshot("players/p1/aiAnalysisReviewHeads/single_r1").revision, 1);
});
test("regeneration and absent immutable history refuse stale review saves", async () => {
  const { api, db } = setup();
  await db.doc("players/p1/aiAnalyses/r1").update({ jobId: "job2" });
  await assert.rejects(api.saveReview(payload, admin), { code: "aborted" });
  await db.doc("players/p1/aiAnalyses/r1").update({ jobId: "job1" });
  await db.doc("players/p1/aiAnalysisRuns/job1").delete();
  await assert.rejects(api.saveReview(payload, admin), { code: "failed-precondition" });
});
test("forged source identity, invalid citations and cross-rep annotations are rejected", async () => {
  const { api, db } = setup();
  await assert.rejects(api.saveReview({ ...payload, annotations: [{ ...payload.annotations[0], repId: "r2" }] }, admin), { code: "invalid-argument" });
  await assert.rejects(api.saveReview({ ...payload, feedback: { ...payload.feedback, focusAreas: [{ ...payload.feedback.focusAreas[0], evidenceIds: ["contact.invalid"] }] } }, admin), { code: "invalid-argument" });
  await db.doc("players/p1/aiAnalysisRuns/job1").update({ playerId: "p2" });
  await assert.rejects(api.saveReview(payload, admin), { code: "failed-precondition" });
});
test("manual annotations work without a generation and retain the exact source rep", async () => {
  const { api, db } = setup();
  await db.doc("players/p1/aiAnalyses/r1").delete();
  const saved = await api.saveReview({ ...payload, sourceJobId: null, datasetApproved: false, feedback: { summary: "Manual", focusAreas: [] } }, admin);
  const review = db.snapshot(`players/p1/aiAnalysisReviews/${saved.reviewId}`);
  assert.equal(review.source.mode, "manual");
  assert.equal(review.original, null);
  assert.equal(review.manualSource.r1.rep.strike_foot, "left");
  assert.equal(review.manualSource.r1.verified, false);
});
test("export uses only latest approved revision, retains input lineage and splits by athlete", async () => {
  const { api } = setup();
  await api.saveReview(payload, admin);
  await api.saveReview({ ...payload, baseRevision: 1, publish: false, feedback: { ...payload.feedback, summary: "Latest" } }, admin);
  let result = await api.exportReviews({ playerIds: ["p1", "p1"] }, admin);
  assert.equal(result.examples.length, 1);
  assert.equal(result.examples[0].revision, 2);
  assert.equal(result.examples[0].expected.summary, "Latest");
  assert.deepEqual(result.examples[0].input, { context: run.context, toolEvidence: [] });
  assert.equal(result.examples[0].split, athleteSplit("p1"));
  await api.saveReview({ ...payload, baseRevision: 2, datasetApproved: false, publish: false }, admin);
  result = await api.exportReviews({ playerIds: ["p1"] }, admin);
  assert.equal(result.examples.length, 0);
});
test("export refuses changed original history", async () => {
  const { api, db } = setup();
  await api.saveReview(payload, admin);
  await db.doc("players/p1/aiAnalysisRuns/job1").update({ result: { ...original, jobId: "changed" } });
  await assert.rejects(api.exportReviews({ playerIds: ["p1"] }, admin), { code: "failed-precondition" });
});
test("comparison reviews bind both original reps and source comparison id", async () => {
  const comparison = { playerId: "p1", comparisonId: "pair", jobId: "job2", capability: "kick_foot_comparison", leftRepId: "r1", rightRepId: "r2", differences: [{ id: "contact.knee.kicking", comparable: true }] };
  const { api } = setup({ "players/p1/aiKickComparisons/pair": comparison, "players/p1/aiAnalysisRuns/job2": { ...run, jobId: "job2", capability: "kick_foot_comparison", result: comparison } });
  const result = await api.saveReview({ ...payload, targetType: "comparison", targetId: "pair", sourceJobId: "job2" }, admin);
  assert.equal(result.targetKey, "comparison_pair");
});
test("source hash is independent of nested map insertion order", () => {
  assert.equal(sourceHash({ a: 1, b: { c: 2, d: 3 } }), sourceHash({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(sourceHash({ a: [1, 2] }), sourceHash({ a: [2, 1] }));
});
test("approval withdrawal during export aborts instead of returning an obsolete example", async () => {
  const { api, db } = setup();
  await api.saveReview(payload, admin);
  const originalTransaction = db.runTransaction.bind(db);
  db.runTransaction = async callback => {
    await db.doc("players/p1/aiAnalysisReviewHeads/single_r1").update({ datasetApproved: false });
    return originalTransaction(callback);
  };
  await assert.rejects(api.exportReviews({ playerIds: ["p1"] }, admin), { code: "aborted" });
});
test("temporal citations honor explicit eligibility and annotations stay within source frame count", async () => {
  const result = { ...original, evidence: { rows: [{ id: "temporal.event", eligible: true }, { id: "contact.knee.kicking", eligible: false, valid: true }] }, provenance: { sources: { r1: { frameCount: 20 } } } };
  const { api } = setup({ "players/p1/aiAnalyses/r1": result, "players/p1/aiAnalysisRuns/job1": { ...run, result } });
  await assert.rejects(api.saveReview(payload, admin), { code: "invalid-argument" });
  const temporal = { ...payload, feedback: { ...payload.feedback, focusAreas: [{ ...payload.feedback.focusAreas[0], evidenceIds: ["temporal.event"] }] } };
  await assert.rejects(api.saveReview({ ...temporal, annotations: [{ ...payload.annotations[0], frame: 20 }] }, admin), { code: "invalid-argument" });
  await api.saveReview(temporal, admin);
});
test("manual dataset approval snapshots viewed artifact versions, pose frames and timebase", async () => {
  const { db } = setup();
  await db.doc("players/p1/aiAnalyses/r1").delete();
  const folder = "p1/deadballShot/session1/kick1";
  const frames = Array.from({ length: 30 }, () => Array.from({ length: 33 }, () => [0.2, 0.3, 0, 1]));
  const files = { "pose.json": Buffer.from(JSON.stringify(frames)), "metadata.json": Buffer.from(JSON.stringify({ framesPerSecond: 120, videoDisplayWidth: 1080, videoDisplayHeight: 1920 })) };
  const observed = Object.fromEntries(Object.entries(files).map(([name]) => [name, { path: `${folder}/${name}`, generation: "5", md5Hash: "md5" }]));
  let drift = false;
  const bucket = { name: "bucket", file: (path, options) => ({
    getMetadata: async () => { const bytes = files[path.split("/").at(-1)]; if (!bytes) { const error = new Error("Missing"); error.code = 404; throw error; } return [{ generation: drift ? "6" : "5", md5Hash: "md5", size: bytes.length }]; },
    download: async () => { assert.equal(options.generation, "5"); return [files[path.split("/").at(-1)]]; },
  }) };
  const api = createAnalysisReviews({ db, bucket, FieldValue, HttpsError });
  const manual = { ...payload, sourceJobId: null, observedSources: { r1: observed }, feedback: { summary: "Expert annotation", focusAreas: [] } };
  const saved = await api.saveReview(manual, admin);
  const source = db.snapshot(`players/p1/aiAnalysisReviews/${saved.reviewId}`).manualSource.r1;
  assert.equal(source.verified, true);
  assert.deepEqual(source.timebase, { fps: 120, frameCount: 30, width: 1080, height: 1920 });
  assert.deepEqual(source.poseFrames.map(row => row.frame), [11, 12, 13]);
  assert.match(source.artifacts["pose.json"].sha256, /^[0-9a-f]{64}$/);
  drift = true;
  await assert.rejects(api.saveReview({ ...manual, baseRevision: 1 }, admin), { code: "aborted" });
});
test("manual reviews with unverifiable source remain authorable but cannot enter training", async () => {
  const { api, db } = setup();
  await db.doc("players/p1/aiAnalyses/r1").delete();
  await assert.rejects(api.saveReview({ ...payload, sourceJobId: null, feedback: { summary: "Manual", focusAreas: [] } }, admin), { code: "failed-precondition" });
});
test("manual revisions cannot silently carry annotations onto changed source artifacts", async () => {
  const { api, db } = setup();
  await db.doc("players/p1/aiAnalyses/r1").delete();
  const manual = { ...payload, sourceJobId: null, datasetApproved: false, feedback: { summary: "Manual", focusAreas: [] } };
  const saved = await api.saveReview(manual, admin);
  await db.doc(`players/p1/aiAnalysisReviews/${saved.reviewId}`).update({ manualSource: { r1: { artifacts: { "pose.json": { generation: "old" } } } } });
  await assert.rejects(api.saveReview({ ...manual, baseRevision: 1 }, admin), { code: "aborted" });
  await api.saveReview({ ...manual, baseRevision: 1, resetManualSource: true }, admin);
});
test("export pagination is stable across mixed-case target identifiers", async () => {
  const { api, db } = setup();
  const ids = ["A", "a", "Z", "z", ...Array.from({ length: 24 }, (_, i) => `r${i}`)];
  for (const repId of ids) {
    const jobId = `job_${repId}`, result = { ...original, repId, jobId };
    await db.doc(`players/p1/reps/${repId}`).set({ repType: "kick" });
    await db.doc(`players/p1/aiAnalyses/${repId}`).set(result);
    await db.doc(`players/p1/aiAnalysisRuns/${jobId}`).set({ ...run, jobId, result });
    await api.saveReview({ ...payload, targetId: repId, sourceJobId: jobId, annotations: [] }, admin);
  }
  const first = await api.exportReviews({ playerIds: ["p1"] }, admin);
  const last = await api.exportReviews({ playerIds: ["p1"], cursor: first.nextCursor }, admin);
  assert.equal(first.examples.length, 25);
  assert.equal(last.examples.length, 3);
  assert.equal(last.nextCursor, null);
  assert.deepEqual([...first.examples, ...last.examples].map(row => row.targetId), ids.sort());
});
