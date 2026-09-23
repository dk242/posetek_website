"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { FakeFirestore, FakeTimestamp, FieldValue, HttpsError } = require("./test-support/fake-firestore");
const { createDiagnosticRetention } = require("./diagnostic-retention");
const admin = { uid: "admin", email: "nolan@posetek.net", emailVerified: true };
const time = 1800000000000;
function harness(extra = {}, fail = false) {
  const db = new FakeFirestore({ "failureCases/processing-test": { schemaVersion: 2,
    storage: { prefix: "failure_cases/processing-test" }, artifactUploadState: "complete",
    artifactsAcknowledgedAt: FakeTimestamp.fromMillis(time - 31 * 86400000), ...extra } });
  const deleted = [];
  const bucket = { file: path => ({ delete: async options => {
    assert.equal(options.ignoreNotFound, true);
    if (fail && path.endsWith("report.json")) { fail = false; throw new Error("temporary storage failure"); }
    deleted.push(path);
  } }) };
  const api = createDiagnosticRetention({ db, bucket, FieldValue, HttpsError, now: () => time });
  return { db, api, deleted };
}
test("retention is disabled until explicitly enabled", async () => {
  const h = harness(); assert.deepEqual(await h.api.sweep(), { disabled: true }); assert.equal(h.deleted.length, 0);
});
test("hold, references and partial uploads preserve all evidence", async () => {
  for (const state of [{ investigationHold: true }, { artifactReferences: ["normal-archive-reference"] },
    { artifactUploadState: "partial" }, { artifactsAcknowledgedAt: null }]) {
    const h = harness(state); assert.deepEqual(await h.api.cleanIncident("processing-test"), { skipped: true }); assert.equal(h.deleted.length, 0);
  }
});
test("video expires after seven days while metadata remains an audit tombstone", async () => {
  const h = harness({ artifactsAcknowledgedAt: FakeTimestamp.fromMillis(time - 8 * 86400000) });
  assert.deepEqual(await h.api.cleanIncident("processing-test"), { state: "videoExpired" });
  assert.deepEqual(h.deleted, ["failure_cases/processing-test/video.mov"]);
  assert.deepEqual(await h.api.cleanIncident("processing-test"), { skipped: true });
});
test("cleanup death resumes idempotently and never visits ordinary athlete archives", async () => {
  const h = harness({}, true);
  await assert.rejects(h.api.cleanIncident("processing-test"));
  await assert.rejects(h.api.protect({ incidentId: "processing-test", hold: true, references: [] }, admin), { code: "failed-precondition" });
  assert.deepEqual(await h.api.cleanIncident("processing-test"), { state: "expired" });
  assert.ok(h.deleted.every(p => p.startsWith("failure_cases/processing-test/")));
  assert.equal((await h.db.collection("failureCases").doc("processing-test").get()).exists, true);
});
test("only verified administrators may hold or release evidence", async () => {
  const h = harness();
  await assert.rejects(h.api.protect({ incidentId: "processing-test", hold: true, references: [] }, { uid: "coach" }), { code: "permission-denied" });
  await h.api.protect({ incidentId: "processing-test", hold: true, references: [] }, admin);
  assert.deepEqual(await h.api.cleanIncident("processing-test"), { skipped: true });
  await h.api.protect({ incidentId: "processing-test", hold: false, references: [] }, admin);
  assert.deepEqual(await h.api.cleanIncident("processing-test"), { state: "expired" });
});
test("forged prefixes cannot target another incident", async () => {
  const h = harness({ storage: { prefix: "player/drill/session1" } });
  assert.deepEqual(await h.api.cleanIncident("processing-test"), { skipped: true });
  assert.equal(h.deleted.length, 0);
});

test("an outstanding resumable session delays cleanup until its safety window expires", async () => {
  const h = harness({ uploadSessionIssuedAt: FakeTimestamp.fromMillis(time - 86400000) });
  assert.deepEqual(await h.api.cleanIncident("processing-test"), { skipped: true });
  assert.equal(h.deleted.length, 0);
  await h.db.doc("failureCases/processing-test").update({ uploadSessionIssuedAt: FakeTimestamp.fromMillis(time - 9 * 86400000) });
  assert.deepEqual(await h.api.cleanIncident("processing-test"), { state: "expired" });
});
