"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FakeFirestore, FakeTimestamp } = require("./test-support/fake-firestore");
const { createAiIncidentList } = require("./ai-incidents-list");
const admin = { uid: "admin", email: "operator@posetek.net", emailVerified: true };
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const base = Date.UTC(2026, 8, 26);
function setup() {
  const seed = { "config/llm": { testUids: ["test-user"] } };
  for (let i = 0; i < 620; i++) {
    const id = `req-${String(i).padStart(4, "0")}`;
    seed[`aiIncidents/${id}`] = { createdAt: FakeTimestamp.fromMillis(base + i), occurredAt: FakeTimestamp.fromMillis(base + i),
      requestId: `reference-${String(i).padStart(4, "0")}`, requestedByUid: i < 20 ? "test-user" : "athlete",
      playerId: `player-${i}`, kind: "failure", code: i % 2 ? "provider_error" : "internal", capability: "training", source: "gateway",
      isTest: false, secretRawPayload: "SENTINEL_DO_NOT_SEND", client: { errorCode: "known", rawPrompt: "SENTINEL_DO_NOT_SEND" } };
    if (i < 10) seed[`aiIncidents/client-half-${i}`] = { createdAt: FakeTimestamp.fromMillis(base + 1000 + i), foldedInto: id,
      requestedByUid: "athlete", source: "client", secretRawPayload: "SENTINEL_DO_NOT_SEND" };
  }
  seed["players/player-0"] = { firstName: "Oldest", lastName: "Athlete" };
  const db = new FakeFirestore(seed);
  return { db, list: createAiIncidentList({ db, HttpsError }).list };
}
test("server paging finds older references, excludes folded halves and computes full filtered counts", async () => {
  const { list } = setup();
  const first = await list({ filters: { test: "all" } }, admin);
  assert.equal(first.total, 620);
  assert.equal(first.rows.length, 50);
  assert.equal(first.rows[0].id, "req-0619");
  assert.equal(first.nextCursor !== null, true);
  assert.equal(first.breakdown.reduce((total, row) => total + row.count, 0), 620);
  assert.equal(first.facets.code.reduce((total, row) => total + row.count, 0), 620);
  assert.doesNotMatch(JSON.stringify(first), /SENTINEL_DO_NOT_SEND/);
  const second = await list({ filters: { test: "all" }, cursor: first.nextCursor }, admin);
  assert.equal(second.total, 620);
  assert.equal(second.rows[0].id, "req-0569");
  const athletes = await list({ filters: { test: "athletes" } }, admin);
  assert.equal(athletes.total, 600);
  const provider = await list({ filters: { test: "athletes", code: "provider_error" } }, admin);
  assert.equal(provider.total, 300);
  const tests = await list({ filters: { test: "test" } }, admin);
  assert.equal(tests.total, 20);
  assert.equal(tests.rows[0].data.isTest, true);
  const ref = await list({ filters: { test: "all", search: "reference-0000" } }, admin);
  assert.equal(ref.total, 1);
  assert.equal(ref.rows[0].id, "req-0000");
  const name = await list({ filters: { test: "all", search: "Oldest Athlete" } }, admin);
  assert.equal(name.total, 1);
  assert.equal(name.rows[0].playerName, "Oldest Athlete");
});
test("cursor binds filters and unverified callers cannot list incidents", async () => {
  const { list } = setup();
  const first = await list({ filters: { test: "all" } }, admin);
  await assert.rejects(list({ filters: { test: "test" }, cursor: first.nextCursor }, admin), { code: "invalid-argument" });
  await assert.rejects(list({}, { ...admin, emailVerified: false }), { code: "permission-denied" });
});
test("newer arrivals do not repeat records after a time-and-id cursor", async () => {
  const { db, list } = setup();
  const first = await list({ filters: { test: "all" } }, admin);
  db.docs.set("aiIncidents/req-new", { createdAt: FakeTimestamp.fromMillis(base + 10000), requestedByUid: "athlete", code: "internal", source: "gateway" });
  const second = await list({ filters: { test: "all" }, cursor: first.nextCursor }, admin);
  assert.equal(second.total, 621);
  assert.equal(second.rows[0].id, "req-0569");
  assert.ok(second.rows.every(row => !first.rows.some(previous => previous.id === row.id)));
});
