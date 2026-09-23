"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FakeFirestore, HttpsError } = require("./test-support/fake-firestore");
const { createPlayerInvitationChecks } = require("./player-invitation-checks");

const start = Date.UTC(2026, 8, 18);
const request = { ip: "192.0.2.11" };
function setup(seed = {}) {
  const db = new FakeFirestore(seed);
  let time = start;
  const check = createPlayerInvitationChecks({ db, HttpsError, now: () => time });
  return { db, check, setTime: value => { time = value; } };
}
const counters = db => [...db.docs].filter(([path]) => path.startsWith("admissionAttempts/player-invitation-check-"));

test("one IP permits 60 checks per 15 minutes and resets without a TTL deletion", async () => {
  const { db, check, setTime } = setup();
  for (let n = 0; n < 60; n++) await check(request);
  assert.equal(counters(db)[0][1].count, 60);
  const before = JSON.stringify([...db.docs]);
  await assert.rejects(check(request), { code: "resource-exhausted" });
  assert.equal(JSON.stringify([...db.docs]), before);
  setTime(start + 15 * 60000 - 1);
  await assert.rejects(check(request), { code: "resource-exhausted" });
  setTime(start + 15 * 60000);
  await check(request);
  assert.equal(counters(db).length, 1);
  assert.equal(counters(db)[0][1].count, 1);
  assert.equal(counters(db)[0][1].windowStartMillis, start + 15 * 60000);
});

test("concurrent checks cannot exceed the per-IP quota", async () => {
  const { db, check } = setup();
  const outcomes = await Promise.allSettled(Array.from({ length: 65 }, () => check(request)));
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 60);
  assert.equal(outcomes.filter(result => result.status === "rejected" && result.reason.code === "resource-exhausted").length, 5);
  assert.equal(counters(db)[0][1].count, 60);
});

test("body and forwarding-header IPs cannot alter the quota key", async () => {
  const { db, check } = setup();
  for (let n = 0; n < 60; n++) await check({ ...request, body: { ip: `198.51.100.${n}`, code: "SYNTHETIC-CODE" }, headers: { "x-forwarded-for": `203.0.113.${n}` } });
  await assert.rejects(check({ ...request, body: { ip: "198.51.100.200" }, headers: { "x-real-ip": "198.51.100.201" } }), { code: "resource-exhausted" });
  assert.equal(counters(db).length, 1);
  await check({ ip: "192.0.2.12" });
  assert.equal(counters(db).length, 2);
});

test("missing or malformed platform IP fails closed without writes even when a header or body supplies one", async () => {
  const { db, check } = setup();
  for (const ip of [undefined, null, "", "not-an-ip", "192.0.2.11, 198.51.100.4", 123, "a".repeat(65)]) {
    await assert.rejects(check({ ip, body: request, headers: { "x-forwarded-for": request.ip } }), { code: "failed-precondition" });
  }
  await assert.rejects(check(undefined), { code: "failed-precondition" });
  assert.equal(db.docs.size, 0);
});

test("IPv4-mapped addresses share the same quota and native IPv6 addresses are accepted", async () => {
  const { db, check } = setup();
  await check(request);
  await check({ ip: "::ffff:" + request.ip });
  assert.equal(counters(db).length, 1);
  assert.equal(counters(db)[0][1].count, 2);
  await check({ ip: "2001:db8::abcd" });
  await check({ ip: "2001:DB8::ABCD" });
  assert.equal(counters(db).length, 2);
  assert.ok(counters(db).every(([, counter]) => counter.count === 2));
});

test("only hashed-IP counters are stored and their keys cannot collide with Auth UID counters", async () => {
  const preserved = { "admissionAttempts/existing-auth-user": { count: 8, windowStartMillis: start, lastKind: "redeemPlayerSignupCode" }, "players/athlete": { registered: false }, "players/athlete/reps/r": { totalTime: 12 } };
  const { db, check } = setup(preserved);
  // Inspect the outgoing SDK write since the lightweight fake does not retain Dates.
  const originalWrite = db.write.bind(db);
  let sent;
  db.write = (path, fields, options) => { sent = { path, fields }; originalWrite(path, fields, options); };
  await check({ ...request, body: { code: "SYNTHETIC-CODE", playerId: "athlete", email: "synthetic@example.test" }, auth: { uid: "existing-auth-user" } });
  assert.deepEqual(Object.keys(sent.fields).sort(), ["count", "expiresAt", "lastKind", "windowStartMillis"]);
  assert.equal(sent.fields.lastKind, "playerInvitationPreflight");
  assert.ok(sent.fields.expiresAt instanceof Date);
  assert.equal(sent.fields.expiresAt.valueOf(), start + 15 * 60000);
  const id = sent.path.split("/").at(-1);
  assert.match(id, /^player-invitation-check-[a-f0-9]{128}$/);
  assert.ok(id.length > 128);
  const serialized = JSON.stringify(sent);
  for (const secret of [request.ip, "SYNTHETIC-CODE", "synthetic@example.test", "existing-auth-user", "athlete"]) assert.ok(!serialized.includes(secret));
  for (const [path, fields] of Object.entries(preserved)) assert.deepEqual(db.snapshot(path), fields);
});

test("malformed counters and backwards clock do not reset the quota", async () => {
  const { db, check, setTime } = setup();
  await check(request);
  setTime(start - 1);
  await assert.rejects(check(request), { code: "resource-exhausted" });
  setTime(start);
  const key = counters(db)[0][0];
  for (const changes of [{ count: -1 }, { count: 1000 }, { lastKind: "another-counter" }, { windowStartMillis: "invalid" }]) {
    db.docs.set(key, { count: 1, windowStartMillis: start, lastKind: "playerInvitationPreflight", ...changes });
    const before = JSON.stringify([...db.docs]);
    await assert.rejects(check(request), { code: "failed-precondition" });
    assert.equal(JSON.stringify([...db.docs]), before);
  }
});
