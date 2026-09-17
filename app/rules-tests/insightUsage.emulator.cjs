"use strict";

// Real server Firestore SDK integration, confined to a disposable local demo DB.
// Run from the repository root with FIRESTORE_EMULATOR_HOST=127.0.0.1:8189 and
// GCLOUD_PROJECT=demo-insight-usage-integration. No ADC or production token used.
const assert = require("node:assert/strict");
const { describe, test, before, after } = require("node:test");
const { createRequire } = require("node:module");
const path = require("node:path");
const PROJECT = "demo-insight-usage-integration", HOST = "127.0.0.1:8189";
if (process.env.FIRESTORE_EMULATOR_HOST !== HOST || process.env.GCLOUD_PROJECT !== PROJECT
  || !PROJECT.startsWith("demo-") || (process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT !== PROJECT)) {
  throw new Error("Refusing to run: explicit local emulator host and dedicated demo project are required.");
}
const localRequire = createRequire(path.resolve(__dirname, "../../functions/index.js"));
const { Firestore, Timestamp } = localRequire("@google-cloud/firestore");
const { HttpsError } = localRequire("firebase-functions/v1/https");
const { createInsightUsage, readPlayerUsage, FEATURES } = require("../../functions/insight-usage");
const DAY = 86400000, BIN = 900000, NOW = Math.floor(Date.now() / BIN) * BIN;
// This is the same Firestore SDK used by firebase-admin. The explicit emulator
// environment makes the SDK use its local owner credential without consulting ADC.
const db = new Firestore({ projectId: PROJECT, host: HOST, ssl: false });
const api = createInsightUsage({ db, Timestamp, HttpsError, now: () => NOW });
const uid = "usage-self", playerId = "usage-player", root = db.doc(`insightUsageDays/${playerId}`);
const date = new Date(NOW - 120000).toISOString().slice(0, 10);
const detail = root.collection("insightUsageDetailDays").doc(date), summary = root.collection("insightUsageDaily").doc(date);
const web = { schemaVersion: 1, sessionId: "12345678-1234-1234-1234-123456789abc", sequence: 0, platform: "web", build: "emulator-test",
  intervals: [{ startedAtMillis: NOW - 120000, endedAtMillis: NOW - 60000, feature: "results" }] };
const ios = { ...web, sessionId: "12345678-1234-1234-1234-123456789abd", platform: "ios",
  intervals: [{ startedAtMillis: NOW - 90000, endedAtMillis: NOW - 30000, feature: "workout" }] };
const report = () => readPlayerUsage(db, playerId, NOW - DAY, NOW, "America/Los_Angeles");
async function clearDemo() {
  // Project and loopback endpoint were verified before constructing this client.
  for (const name of ["players", "coaches", "organizations", "insightSettings", "insightUsageDays", "insightUsageIntervals", "insightUsageActors"]) {
    await db.recursiveDelete(db.collection(name));
  }
}

describe("Insights usage real Firestore transactions", { concurrency: false, timeout: 90000 }, () => {
  before(async () => {
    assert.equal(db.projectId, PROJECT);
    await clearDemo();
    const seed = db.batch();
    seed.set(db.doc(`players/${playerId}`), { authenticationUID: uid, userUID: uid, organizationId: "usage-club", teamId: "usage-team" });
    seed.set(db.doc("players/usage-coach-linked"), { authenticationUID: "usage-coach", userUID: "usage-coach" });
    seed.set(db.doc("coaches/usage-coach"), { userUID: "usage-coach", members: [playerId] });
    seed.set(db.doc("players/usage-manager-linked"), { authenticationUID: "usage-manager", userUID: "usage-manager", organizationId: "usage-club" });
    seed.set(db.doc("organizations/usage-club/members/usage-manager"), { userUID: "usage-manager", role: "manager", status: "active", teamIds: [] });
    seed.set(db.doc("insightSettings/usage"), { enabled: false });
    await seed.commit();
  });
  after(async () => { try { await clearDemo(); } finally { await db.terminate(); } });

  test("disabled collection writes no receipt or usage history", async () => {
    assert.deepEqual(await api.recordInsightUsage(web, { uid }), { accepted: false, reason: "disabled" });
    assert.equal((await root.get()).exists, false);
    assert.equal((await db.collection("insightUsageIntervals").get()).size, 0);
    assert.equal((await report()).collected, false);
    await db.doc("insightSettings/usage").set({ enabled: true });
  });

  test("concurrent overlapping web and iOS batches union in a real SDK transaction", async () => {
    const accepted = await Promise.all([api.recordInsightUsage(web, { uid }), api.recordInsightUsage(ios, { uid })]);
    assert.deepEqual(accepted, [{ accepted: true, duplicate: false }, { accepted: true, duplicate: false }]);
    const value = await report();
    assert.equal(value.complete, true); assert.equal(value.collected, true);
    assert.equal(value.webCollected, true); assert.equal(value.iosCollected, true);
    assert.equal(value.totalMillis, 90000); assert.equal(value.webMillis, 60000); assert.equal(value.iosMillis, 60000); assert.equal(value.overlapMillis, 30000);
    assert.equal(value.featureMillis.workout, 60000); assert.equal(value.featureMillis.results, 30000);
    assert.equal(Object.values(value.featureMillis).reduce((n, value) => n + value, 0), value.totalMillis);
    assert.equal(value.activeDays, 1); assert.equal(value.returning, false);
  });

  test("idempotent duplicate preserves totals while changed sequence evidence is rejected", async () => {
    const previous = await report();
    assert.deepEqual(await api.recordInsightUsage(web, { uid }), { accepted: true, duplicate: true });
    await assert.rejects(api.recordInsightUsage({ ...web, intervals: [{ ...web.intervals[0], feature: "video" }] }, { uid }), { code: "already-exists" });
    assert.deepEqual(await report(), previous);
    assert.equal((await db.collection("insightUsageIntervals").get()).size, 2);
    assert.equal((await db.doc(`insightUsageActors/${uid}`).get()).data().count, 2);
  });

  test("staff-selected players, coach or manager actors and malformed payloads are denied without writes", async () => {
    await assert.rejects(api.recordInsightUsage({ ...web, playerId }, { uid: "usage-coach" }), { code: "invalid-argument" });
    for (const actor of ["usage-coach", "usage-manager", "usage-outsider"]) {
      await assert.rejects(api.recordInsightUsage(web, { uid: actor }), { code: "permission-denied" });
    }
    await assert.rejects(api.recordInsightUsage(web, { uid, isAnonymous: true }), { code: "unauthenticated" });
    await assert.rejects(api.recordInsightUsage(web, { uid, email: "synthetic@posetek.net", emailVerified: true }), { code: "permission-denied" });
    for (const intervals of [[{ ...web.intervals[0], feature: "private-page" }], [{ ...web.intervals[0], endedAtMillis: NaN }], [[1, 2]]]) {
      await assert.rejects(api.recordInsightUsage({ ...web, sequence: 1, intervals }, { uid }), { code: "invalid-argument" });
    }
    assert.equal((await db.collection("insightUsageIntervals").get()).size, 2);
  });

  test("short-lived exact detail and long-lived coarse bins round-trip with real Firestore values", async () => {
    const [detailDoc, summaryDoc, receipts] = await Promise.all([detail.get(), summary.get(), db.collection("insightUsageIntervals").get()]);
    const exact = detailDoc.data(), coarse = summaryDoc.data();
    assert.equal(exact.schemaVersion, 1); assert.deepEqual(exact.channels.web_results, [{ start: NOW - 120000, end: NOW - 60000 }]);
    assert.ok(exact.expiresAt instanceof Timestamp);
    assert.equal(exact.expiresAt.toMillis(), Date.parse(`${date}T00:00:00Z`) + 90 * DAY);
    const expiry = new Date(`${date}T00:00:00Z`); expiry.setUTCMonth(expiry.getUTCMonth() + 24);
    assert.equal(coarse.expiresAt.toMillis(), expiry.getTime());
    assert.equal(coarse.schemaVersion, 2); assert.equal(coarse.binMinutes, 15); assert.equal(coarse.bins.length, 1);
    assert.equal(coarse.bins[0].totalMillis, 90000);
    assert.deepEqual(Object.keys(coarse.bins[0].featureMillis).sort(), [...FEATURES].sort());
    for (const prohibited of ["channels", "startedAtMillis", "endedAtMillis", "sessionId", "intervals", "sequence"]) assert.equal(JSON.stringify(coarse).includes(prohibited), false);
    for (const receipt of receipts.docs) assert.equal(receipt.data().expiresAt.toMillis(), NOW + 90 * DAY);
    assert.equal((await db.doc(`insightUsageActors/${uid}`).get()).data().expiresAt.toMillis(), NOW + DAY);
  });

  test("historical dates before collection stay uncollected and partial bins fail closed", async () => {
    const prior = await readPlayerUsage(db, playerId, NOW - 2 * DAY, NOW - DAY, "UTC");
    assert.equal(prior.collected, false); assert.equal(prior.webCollected, false); assert.equal(prior.iosCollected, false);
    const partial = await readPlayerUsage(db, playerId, NOW - 100000, NOW, "UTC");
    assert.equal(partial.complete, false); assert.equal(partial.totalMillis, 0);
  });

  test("aggregate report remains usable after raw detail and receipts are removed", async () => {
    const beforeExpiry = await report(), receipts = await db.collection("insightUsageIntervals").get();
    const expire = db.batch(); expire.delete(detail); for (const receipt of receipts.docs) expire.delete(receipt.ref); await expire.commit();
    assert.deepEqual(await report(), beforeExpiry);
    // Once detail has expired, a new batch cannot replace existing aggregate totals.
    await assert.rejects(api.recordInsightUsage({ ...web, sequence: 1 }, { uid }), { code: "failed-precondition" });
    assert.deepEqual(await report(), beforeExpiry);
  });
});
