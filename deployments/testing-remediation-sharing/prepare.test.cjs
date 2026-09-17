"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const { patchClub } = require("./prepare.cjs");
const { FakeFirestore, FakeTimestamp, FieldValue, HttpsError } = require("../../functions/test-support/fake-firestore");
const source = path.join(__dirname, "../club-organization/sharing/overrides");
const originalClub = fs.readFileSync(path.join(source, "club-sharing-handlers.js"), "utf8");
function load() {
  const db = new FakeFirestore({
    "players/club-player": { organizationId: "club", teamId: "a", firstName: "Club", userUID: "athlete" },
    "players/legacy-player": { firstName: "Legacy", coachUID: "coach" },
    "coaches/coach": { userUID: "coach", members: ["legacy-player"] },
    "organizations/club/members/manager": { userUID: "manager", role: "manager", status: "active", teamIds: [] },
    "players/club-player/reps/rep": { repType: "sprint", max_velocity: 8, resultsValid: false, sessionNumber: 1, repNumber: 1, storagePath: "club-player/sprint/session1/kick1" },
    "players/legacy-player/reps/rep": { repType: "sprint", max_velocity: 7, storagePath: "legacy-player/sprint/session1/kick1" },
  });
  const bucket = { name: "test", file(name) { return { name, exists: async () => [true],
    async getMetadata() { return [{ size: 2, generation: "1" }]; }, async download() { return [Buffer.from("{}")]; },
    getSignedUrl: async () => [`https://example.invalid/${name}`] }; },
    getFiles: async ({ prefix }) => [[{ name: `${prefix}video.mov`, getSignedUrl: async () => [`https://example.invalid/${prefix}video.mov`] }]],
  };
  const functions = { https: { HttpsError, onCall: handler => handler, onRequest: handler => handler }, config: () => ({}) };
  functions.runWith = () => functions;
  const admin = { initializeApp() {}, firestore: () => db, storage: () => ({ bucket: () => bucket }) };
  admin.firestore.Timestamp = FakeTimestamp; admin.firestore.FieldValue = FieldValue;
  const clubModule = { exports: {} }, repositoryRequire = createRequire(path.resolve(__dirname, "../../functions/index.js"));
  vm.runInNewContext(patchClub(originalClub), { module: clubModule, exports: clubModule.exports, require: repositoryRequire, Buffer, process });
  const result = {};
  const originalRequire = createRequire(path.join(source, "index.js"));
  vm.runInNewContext(fs.readFileSync(path.join(source, "index.js"), "utf8"), { exports: result, require(name) {
    if (name === "firebase-functions") return functions;
    if (name === "firebase-admin") return admin;
    if (name === "stripe") return () => ({});
    if (name === "./club-sharing-handlers") return clubModule.exports;
    return originalRequire(name);
  }, console, Buffer, process, URL, Date, setTimeout, clearTimeout });
  return { db, api: result };
}
const auth = uid => ({ auth: { uid, token: { email: `${uid}@example.test`, email_verified: true } } });
process.env.ATHLETE_SHARE_SIGNING_KEY = "synthetic-only-effective-sharing-test-key-1234567890";
test("overlay retains legacy token protocol and its values while signed club reads suppress rejected results", async () => {
  const { db, api } = load();
  const legacy = await api.createAthleteResultsShare({ playerDocId: "legacy-player" }, auth("coach"));
  assert.ok(db.snapshot(`athleteResultShares/${crypto.createHash("sha256").update(legacy.token).digest("hex")}`));
  assert.equal((await api.getAthleteResultsShare({ token: legacy.token, drill: "sprint" })).reps[0].max_velocity, 7);
  const legacyMedia = await api.getAthleteSharedRepArtifacts({ token: legacy.token, drill: "sprint", repId: "rep" });
  assert.match(legacyMedia.mediaUrl, /legacy-player/);
  const club = await api.createAthleteResultsShare({ playerDocId: "club-player" }, auth("manager"));
  const row = (await api.getAthleteResultsShare({ token: club.token, drill: "sprint" })).reps[0];
  assert.equal(row.max_velocity, null); assert.equal(row.resultStatus.qualified, false);
  await db.collection("organizations").doc("club").collection("members").doc("manager").update({ status: "inactive" });
  await assert.rejects(api.getAthleteResultsShare({ token: club.token, drill: "sprint" }), { code: "permission-denied" });
});
test("overlay fails on changed source anchors instead of guessing a replacement", () => {
  assert.throws(() => patchClub(originalClub.replace('  const { athleteShareError } = athleteShares;', "changed")), /anchor changed/);
  assert.throws(() => patchClub(originalClub.replace('    const repsSnapshot = await playerRef.collection("reps").get();', "changed")), /body changed/);
  assert.equal(patchClub(originalClub).includes('if (drill !== "freeRecord")'), true);
});
