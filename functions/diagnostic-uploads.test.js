"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { FakeFirestore, FieldValue, HttpsError } = require("./test-support/fake-firestore");
const { createDiagnosticUploads } = require("./diagnostic-uploads");
const actor = { uid: "staff", email: "coach@example.test", emailVerified: true };
const data = { path: "failure_cases/processing-test/report.json", contentType: "application/json", byteCount: 10, sha256: "a".repeat(64) };
function harness(record = {}, seed = {}) {
  const db = new FakeFirestore({
    "failureCases/processing-test": { schemaVersion: 2, scope: "attempt", reportedByUid: "staff",
      playerDocumentID: "player", storage: { prefix: "failure_cases/processing-test" }, ...record },
    "players/player": { organizationId: "club", teamId: "team" },
    "organizations/club/members/staff": { userUID: "staff", status: "active", role: "coach", teamIds: ["team"] },
    "testingEvents/event": { organizationId: "club", operatorUids: ["staff"], status: "closed" }, ...seed });
  const issued = [];
  const bucket = { file: path => ({ createResumableUpload: async options => {
    issued.push({ path, options }); return ["https://storage.googleapis.com/private-upload-session"];
  } }) };
  return { db, issued, api: createDiagnosticUploads({ db, bucket, FieldValue, HttpsError }) };
}
test("current assigned staff may start an upload; revoked staff and another account may not", async () => {
  const h = harness();
  await h.api.authorize(data, actor);
  assert.equal(h.issued.length, 1);
  await h.db.doc("organizations/club/members/staff").update({ status: "revoked" });
  await assert.rejects(h.api.authorize(data, actor), { code: "permission-denied" });
  await assert.rejects(h.api.authorize(data, { ...actor, uid: "other" }), { code: "permission-denied" });
  assert.equal(h.issued.length, 1);
});
test("setup remains reportable after closure but event removal and membership revocation deny new sessions", async () => {
  const h = harness({ scope: "stationSetup", testingEventId: "event", playerDocumentID: null, attemptId: null });
  await h.api.authorize(data, actor);
  await h.db.doc("testingEvents/event").update({ operatorUids: [] });
  await assert.rejects(h.api.authorize(data, actor), { code: "permission-denied" });
  await h.db.doc("testingEvents/event").update({ operatorUids: ["staff"] });
  await h.db.doc("organizations/club/members/staff").update({ status: "revoked" });
  await assert.rejects(h.api.authorize(data, actor), { code: "permission-denied" });
});
test("actor-only system uploads cannot assert athlete identity", async () => {
  const h = harness({ scope: "actor", kind: "system_diagnostic", playerDocumentID: null, attemptId: null });
  const system = { ...data, path: "failure_cases/processing-test/system_diagnostic.json" };
  await h.api.authorize(system, actor);
  await h.db.doc("failureCases/processing-test").update({ playerDocumentID: "player" });
  await assert.rejects(h.api.authorize(system, actor), { code: "permission-denied" });
});
test("cleanup claims and malformed paths, MIME, size and hash never mint sessions", async () => {
  const h = harness();
  for (const override of [{ path: "player/drill/video.mov" }, { path: "failure_cases/processing-test/../video.mov" },
    { contentType: "text/html" }, { byteCount: 3 * 1024 * 1024 }, { sha256: "bad" }]) {
    await assert.rejects(h.api.authorize({ ...data, ...override }, actor));
  }
  await h.db.doc("failureCases/processing-test").update({ retentionState: "allDeleting" });
  await assert.rejects(h.api.authorize(data, actor));
  assert.equal(h.issued.length, 0);
});
test("conflicting athlete UID bindings do not grant self access", async () => {
  const h = harness({}, { "players/player": { authenticationUID: "staff", userUID: "other" } });
  await assert.rejects(h.api.authorize(data, actor));
});
