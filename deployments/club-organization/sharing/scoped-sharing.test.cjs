"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const { FakeFirestore, FakeTimestamp, FieldValue, HttpsError } = require("../../../functions/test-support/fake-firestore");
const source = path.join(__dirname, "overrides");
const auth = (uid, email = `${uid}@example.test`) => ({ auth: { uid, token: { email, email_verified: true } } });
function load(seed = {}) {
  const db = new FakeFirestore({
    "players/club-player": { organizationId: "club", teamId: "a", firstName: "Club", lastName: "Player", userUID: "athlete", coachUID: "old-coach" },
    "players/legacy-player": { firstName: "Legacy", lastName: "Player", userUID: "legacy-athlete", coachUID: "old-coach" },
    "players/club-player/reps/rep": { repType: "sprint", max_velocity: 8, storagePath: "club-player/sprint/session1/kick1" },
    "players/legacy-player/reps/rep": { repType: "sprint", max_velocity: 7, storagePath: "legacy-player/sprint/session1/kick1" },
    "coaches/old-coach": { userUID: "old-coach", members: ["club-player", "legacy-player"] },
    "organizations/club/members/manager": { userUID: "manager", role: "manager", teamIds: [], status: "active" },
    "organizations/club/members/coach-a": { userUID: "coach-a", role: "coach", teamIds: ["a"], status: "active" },
    "organizations/club/members/coach-b": { userUID: "coach-b", role: "coach", teamIds: ["b"], status: "active" },
    ...seed,
  });
  const accessed = [];
  const bucket = {
    file(name) { accessed.push(name); return { name, exists: async () => [true], getSignedUrl: async () => [`https://signed.example.test/${name}`] }; },
    getFiles: async ({ prefix }) => { accessed.push(prefix); return [[{ name: `${prefix}video.mov`, getSignedUrl: async () => [`https://signed.example.test/${prefix}video.mov`] }]]; },
  };
  const functions = { https: { HttpsError, onCall: (handler) => handler, onRequest: (handler) => handler }, config: () => ({}) };
  functions.runWith = () => functions;
  const admin = { initializeApp() {}, firestore: () => db, storage: () => ({ bucket: () => bucket }) };
  admin.firestore.Timestamp = FakeTimestamp; admin.firestore.FieldValue = FieldValue;
  const exports = {};
  const localRequire = createRequire(path.join(source, "index.js"));
  vm.runInNewContext(fs.readFileSync(path.join(source, "index.js"), "utf8"), {
    exports, require(name) {
      if (name === "firebase-functions") return functions;
      if (name === "firebase-admin") return admin;
      if (name === "stripe") return () => ({});
      return localRequire(name);
    }, console, Buffer, process, URL, Date, setTimeout, clearTimeout,
  }, { filename: "scoped-sharing/index.js" });
  return { db, api: exports, accessed };
}
function unsignedFixture(playerId, token = crypto.randomBytes(32).toString("base64url")) {
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, hash, share: { playerDocId: playerId, allowedDrills: ["sprint"], createdByUid: "old-coach", createdByCoachDocId: "old-coach", createdAt: FakeTimestamp.now(), expiresAt: FakeTimestamp.fromMillis(Date.now() + 600000), revoked: false } };
}
process.env.ATHLETE_SHARE_SIGNING_KEY = "synthetic-only-signing-key-for-offline-regression-1234567890";

test("unmigrated creation/read/artifact behavior and collection stay on serving legacy protocol", async () => {
  const { api, db, accessed } = load();
  const issued = await api.createAthleteResultsShare({ playerDocId: "legacy-player" }, auth("old-coach"));
  const hash = crypto.createHash("sha256").update(issued.token).digest("hex");
  assert.ok(db.snapshot(`athleteResultShares/${hash}`));
  assert.equal(db.snapshot(`athleteResultSharesV2/${hash}`), undefined);
  assert.equal(db.snapshot("players/legacy-player").activeResultsShareHash, hash);
  const result = await api.getAthleteResultsShare({ token: issued.token, drill: "sprint" });
  assert.equal(result.athlete.firstName, "Legacy");
  assert.equal(result.reps[0].max_velocity, 7);
  const files = await api.getAthleteSharedRepArtifacts({ token: issued.token, drill: "sprint", repId: "rep" });
  assert.match(files.artifactUrls["pose.json"], /legacy-player\/sprint/);
  assert.ok(accessed.every((entry) => entry.startsWith("legacy-player/")));
});
test("existing unsigned legacy links stay readable when the player is unmigrated", async () => {
  const old = unsignedFixture("legacy-player");
  const { api } = load({ [`athleteResultShares/${old.hash}`]: old.share, "players/legacy-player": { firstName: "Legacy", activeResultsShareHash: old.hash } });
  assert.equal((await api.getAthleteResultsShare({ token: old.token, drill: "sprint" })).athlete.firstName, "Legacy");
});
test("unsigned links cannot serve migrated club profiles even if forged creator and pointer match", async () => {
  for (const org of ["club", "", null]) {
    const old = unsignedFixture("club-player");
    const { api, accessed } = load({ [`athleteResultShares/${old.hash}`]: { ...old.share, createdByUid: "manager", createdByRole: "admin" }, "players/club-player": { organizationId: org, teamId: "a", activeResultsShareHash: old.hash } });
    await assert.rejects(api.getAthleteResultsShare({ token: old.token, drill: "sprint" }), { code: "permission-denied" });
    await assert.rejects(api.getAthleteSharedRepArtifacts({ token: old.token, drill: "sprint", repId: "rep" }), { code: "permission-denied" });
    assert.deepEqual(accessed, []);
  }
});
test("club creation rejects stale legacy rosters and wrong-team coaches", async () => {
  const { api } = load();
  for (const uid of ["old-coach", "coach-b", "stranger"]) await assert.rejects(api.createAthleteResultsShare({ playerDocId: "club-player" }, auth(uid)), { code: "permission-denied" });
});
test("manager and assigned coach issue signed club links with unchanged response shape", async () => {
  for (const uid of ["manager", "coach-a"]) {
    const { api, db } = load();
    const issued = await api.createAthleteResultsShare({ playerDocId: "club-player" }, auth(uid));
    assert.deepEqual(Object.keys(issued).sort(), ["expiresAtMillis", "token"]);
    const hash = crypto.createHash("sha256").update(issued.token).digest("hex");
    assert.equal(db.snapshot(`athleteResultSharesV2/${hash}`).issuanceVersion, 2);
    assert.equal(db.snapshot(`athleteResultShares/${hash}`), undefined);
    assert.equal((await api.getAthleteResultsShare({ token: issued.token, drill: "sprint" })).reps[0].max_velocity, 8);
    const files = await api.getAthleteSharedRepArtifacts({ token: issued.token, drill: "sprint", repId: "rep" });
    assert.match(files.artifactUrls["pose.json"], /club-player\/sprint/);
  }
});
test("club assignment revocation invalidates previously issued signed links", async () => {
  const { api, db } = load();
  const issued = await api.createAthleteResultsShare({ playerDocId: "club-player" }, auth("coach-a"));
  await db.collection("organizations").doc("club").collection("members").doc("coach-a").update({ status: "inactive" });
  await assert.rejects(api.getAthleteResultsShare({ token: issued.token, drill: "sprint" }), { code: "permission-denied" });
});
test("forged signed-record payload cannot bypass HMAC or fall back to unsigned club record", async () => {
  const fake = unsignedFixture("club-player");
  const { api } = load({
    [`athleteResultShares/${fake.hash}`]: fake.share,
    [`athleteResultSharesV2/${fake.hash}`]: { ...fake.share, issuanceVersion: 2, issuanceSignature: "f".repeat(64), createdByRole: "admin" },
    "players/club-player": { organizationId: "club", teamId: "a", activeResultsShareHash: fake.hash, activeResultsShareV2Hash: fake.hash },
  });
  await assert.rejects(api.getAthleteResultsShare({ token: fake.token, drill: "sprint" }), { code: "permission-denied" });
});
test("club artifact resolver refuses foreign storagePath before any Storage request", async () => {
  const { api, accessed } = load({ "players/club-player/reps/rep": { repType: "sprint", storagePath: "foreign-player/sprint/session1/kick1" } });
  const issued = await api.createAthleteResultsShare({ playerDocId: "club-player" }, auth("manager"));
  await assert.rejects(api.getAthleteSharedRepArtifacts({ token: issued.token, drill: "sprint", repId: "rep" }), { code: "permission-denied" });
  assert.deepEqual(accessed, []);
});
test("missing signing secret blocks club issuance but leaves legacy issuance functional", async () => {
  const key = process.env.ATHLETE_SHARE_SIGNING_KEY;
  delete process.env.ATHLETE_SHARE_SIGNING_KEY;
  try {
    const { api } = load();
    await assert.rejects(api.createAthleteResultsShare({ playerDocId: "club-player" }, auth("manager")), { code: "failed-precondition" });
    assert.ok((await api.createAthleteResultsShare({ playerDocId: "legacy-player" }, auth("old-coach"))).token);
  } finally { process.env.ATHLETE_SHARE_SIGNING_KEY = key; }
});

test("legacy storagePath cannot sign files owned by any migrated club athlete", async () => {
  for (const storagePath of ["club-player/sprint/session1/kick1", "gs://kickai-69dd0.firebasestorage.app/club-player/sprint/session1/kick1/video.mov", "club-player\\sprint\\session1\\kick1"])
    for (const organizationId of ["club", "", null]) {
      const old = unsignedFixture("legacy-player");
      const { api, accessed } = load({
        [`athleteResultShares/${old.hash}`]: old.share,
        "players/legacy-player": { activeResultsShareHash: old.hash },
        "players/club-player": { organizationId },
        "players/legacy-player/reps/rep": { repType: "sprint", storagePath },
      });
      await assert.rejects(api.getAthleteSharedRepArtifacts({ token: old.token, drill: "sprint", repId: "rep" }), { code: "permission-denied" });
      assert.deepEqual(accessed, []);
    }
});
test("planted nested legacy profiles cannot keep unsigned access after their top-level owner migrates", async () => {
  for (const organizationId of ["club", "", null]) {
    const old = unsignedFixture("club-player/shadow/profile");
    const { api, db, accessed } = load({
      [`athleteResultShares/${old.hash}`]: old.share,
      "players/club-player": { organizationId },
      "players/club-player/shadow/profile": { activeResultsShareHash: old.hash, coachUID: "old-coach" },
      "players/club-player/shadow/profile/reps/rep": { repType: "sprint" },
    });
    await assert.rejects(api.createAthleteResultsShare({ playerDocId: "club-player/shadow/profile" }, auth("old-coach")), { code: "permission-denied" });
    assert.equal((await db.collection("athleteResultShares").get()).size, 1);
    assert.equal(db.snapshot("players/club-player/shadow/profile").activeResultsShareHash, old.hash);
    await assert.rejects(api.getAthleteResultsShare({ token: old.token, drill: "sprint" }), { code: "permission-denied" });
    await assert.rejects(api.getAthleteSharedRepArtifacts({ token: old.token, drill: "sprint", repId: "rep" }), { code: "permission-denied" });
    assert.deepEqual(accessed, []);
  }
});
test("legacy path compatibility is preserved when its alternate target owner is unmigrated", async () => {
  const { api, accessed } = load({ "players/legacy-player/reps/rep": { repType: "sprint", storagePath: "historic-player/sprint/session1/kick1" } });
  const issued = await api.createAthleteResultsShare({ playerDocId: "legacy-player" }, auth("old-coach"));
  const result = await api.getAthleteSharedRepArtifacts({ token: issued.token, drill: "sprint", repId: "rep" });
  assert.match(result.artifactUrls["pose.json"], /historic-player\/sprint/);
  assert.ok(accessed.length > 0);
});
