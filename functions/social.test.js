"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FakeFirestore, FakeTimestamp, HttpsError } = require("./test-support/fake-firestore");
const { createSocial } = require("./social");
const { projectActivities, idFor } = require("./social-projection");
test("bundled scoring reference matches the player app dataset", () => {
  assert.deepEqual(require("./social-benchmarks.json"), require("../app/src/pages/athlete-portal/player/D1Benchmarks.json"));
});
const NOW = Date.UTC(2026, 8, 13), date = new FakeTimestamp(NOW - 3600000);
const rep = (id = "r1", extra = {}) => ({ id, repType: "side_kick", sessionNumber: 1, repNumber: 1, velocity: 20, createdAt: date, ...extra });
const player = (uid, teamId = "t1", organizationId = "org") => ({ authenticationUID: uid, userUID: uid, organizationId, teamId, firstName: uid });
function setup(extra = {}, bucket = { name: "bucket", getFiles: async () => [[]] }) {
  const db = new FakeFirestore({ "socialSettings/feed": { enabled: true, organizationIds: ["org"], historySince: NOW - 30 * 86400000 },
    "players/p1": player("u1"), "players/p2": player("u2"), "players/p3": player("u3", "t2"), "players/p4": player("u4", "outside", "other"),
    "organizations/org": { name: "Vacaville" }, "teams/t1": { organizationId: "org", name: "Team one" }, "players/p2/reps/r1": rep(), ...extra });
  return { db, api: createSocial({ db, bucket, HttpsError, now: () => NOW }) };
}
const auth = uid => ({ uid });
test("projection groups reps, converts units, retains missing scores and emits one stable card", () => {
  const a = projectActivities("p", player("u"), [rep(), rep("r2", { velocity: 30 })], [], [], {}, NOW);
  assert.equal(a.length, 1); assert.equal(a[0].metrics[0].value, 2); assert.equal(a[0].metrics[1].value, 30 * 2.23694); assert.equal(a[0].score, null);
  assert.equal(a[0].id, projectActivities("p", player("u"), [rep()], [], [], {}, NOW)[0].id);
  assert.equal(a[0].availableAt, date.toMillis() + 300000);
});
test("invalid, zero, missing timestamp and unsupported reps never invent measurements", () => {
  assert.equal(projectActivities("p", player("u"), [rep("1", { velocity: null }), rep("2", { createdAt: null }), rep("3", { repType: "unknown" }), rep("4", { velocity: 0 })], [], [], {}, NOW).length, 0);
});
test("sprint benchmark uses completion time, not velocity; private attributes stay out of projection", () => {
  const dataset = { generation: 3, cells: { "u14|male": { sprintCompletionTime: { percentiles: { p50: 5 } } } } };
  const a = projectActivities("p", { ...player("u"), age: 13, gender: "male", email: "private", weight: 100 }, [rep("r", { repType: "sprint", max_velocity: 7, totalTime: 10 })], [], [], dataset, NOW)[0];
  assert.equal(a.score, 50); assert.equal(a.scoreGeneration, 3); assert.equal(a.age, undefined); assert.equal(a.email, undefined);
});
test("only ended workouts with saved work appear; linked measured sessions are deduplicated", () => {
  const log = { id: "w", endedAt: date, blocks: [{ blockId: "b", status: "partial", setsCompleted: 2 }], linkedTrainingSessionId: "s", activeSeconds: 180, workoutSnapshot: { title: "Training", blocks: [{ blockId: "b", name: "Squat" }] } };
  const sessions = [{ id: "s", sessionRefs: [{ drillType: "shooting", sessionNumber: 1 }] }];
  const a = projectActivities("p", player("u"), [rep()], [log, { ...log, id: "active", endedAt: null }], sessions, {}, NOW);
  assert.equal(a.length, 1); assert.equal(a[0].kind, "workout"); assert.equal(a[0].partial, true); assert.equal(a[0].metrics[1].value, 2); assert.equal(a[0].subtitle, "Squat");
});
test("rebuild is idempotent and rereads current source on delayed events; deleted source removes cards", async () => {
  const { api, db } = setup(); await api.rebuild("p2");
  assert.equal((await api.rebuild("p2")).writes, 0);
  await db.doc("players/p2/reps/r1").update({ velocity: 30 }); await api.rebuild("p2");
  const a = [...db.docs.values()].find(x => x.kind === "session"); assert.equal(a.metrics[1].value, 30 * 2.23694);
  await db.doc("players/p2/reps/r1").delete(); await api.rebuild("p2"); assert.equal([...db.docs.values()].filter(x => x.kind === "session").length, 0);
});
test("dry run does not write and history cutoff excludes old activity", async () => {
  const { api, db } = setup(); assert.equal((await api.rebuild("p2", true)).count, 1); assert.equal([...db.docs.keys()].some(k => k.startsWith("socialActivities/")), false);
  await db.doc("players/p2/reps/r1").update({ createdAt: new FakeTimestamp(NOW - 31 * 86400000) }); assert.equal((await api.rebuild("p2")).count, 0);
});
test("organization viewer receives projected metrics without raw reps or profile details", async () => {
  const { api } = setup(); await api.rebuild("p2"); const feed = await api.getFeed({}, auth("u1"));
  assert.equal(feed.items.length, 1); assert.equal(feed.items[0].authorName, "u2"); assert.equal(feed.items[0].repIds, undefined); assert.equal(feed.items[0].authenticationUID, undefined);
});
test("anonymous, mismatched bindings and strangers cannot access feed detail", async () => {
  const { api } = setup(); await api.rebuild("p2"); const id = (await api.getFeed({}, auth("u1"))).items[0].id;
  await assert.rejects(api.getFeed({}, null), { code: "unauthenticated" }); await assert.rejects(api.getFeed({}, { uid: "u1", isAnonymous: true }), { code: "unauthenticated" });
  await assert.rejects(api.getDetail({ id }, auth("u4")), { code: "permission-denied" });
  const malformed = setup({ "players/p1": { ...player("u1"), userUID: "other" } }); await assert.rejects(malformed.api.getFeed({}, auth("u1")), { code: "permission-denied" });
});
test("team-only, private, hidden and disabled automatic sharing are enforced server-side", async () => {
  const { api } = setup(); await api.rebuild("p2"); const id = (await api.getFeed({}, auth("u1"))).items[0].id;
  await api.savePreferences({ audience: "team", automatic: true, videos: true }, auth("u2"));
  assert.equal((await api.getFeed({}, auth("u3"))).items.length, 0);
  assert.equal((await api.getFeed({}, auth("u1"))).items.length, 1);
  await api.savePreferences({ audience: "organization", automatic: false, videos: true }, auth("u2")); assert.equal((await api.getFeed({}, auth("u1"))).items.length, 0);
  await api.setVisibility({ id, audience: "organization", hidden: false }, auth("u2")); assert.equal((await api.getFeed({}, auth("u1"))).items.length, 1);
  await api.setVisibility({ id, audience: "organization", hidden: true }, auth("u2")); assert.equal((await api.getFeed({}, auth("u1"))).items.length, 0);
  assert.equal((await api.getFeed({ scope: "mine" }, auth("u2"))).items.length, 1);
});
test("connection must be accepted by recipient; removing or blocking revokes cross-org access", async () => {
  const { api } = setup(); await api.rebuild("p2");
  await api.connect({ playerId: "p2", action: "request" }, auth("u4"));
  await assert.rejects(api.connect({ playerId: "p2", action: "accept" }, auth("u4")), { code: "failed-precondition" });
  assert.equal((await api.getFeed({ scope: "friends" }, auth("u4"))).items.length, 0);
  await api.connect({ playerId: "p4", action: "accept" }, auth("u2")); assert.equal((await api.getFeed({ scope: "friends" }, auth("u4"))).items.length, 1);
  await api.connect({ playerId: "p4", action: "block" }, auth("u2")); assert.equal((await api.getFeed({ scope: "friends" }, auth("u4"))).items.length, 0);
  await assert.rejects(api.connect({ playerId: "p2", action: "request" }, auth("u4")), { code: "permission-denied" });
});
test("team-only excludes outside friends; block also applies to organization peers", async () => {
  const { api } = setup(); await api.rebuild("p2");
  await api.connect({ playerId: "p2", action: "request" }, auth("u3")); await api.connect({ playerId: "p3", action: "accept" }, auth("u2"));
  await api.savePreferences({ audience: "team", automatic: true, videos: true }, auth("u2")); assert.equal((await api.getFeed({}, auth("u3"))).items.length, 0);
  await api.connect({ playerId: "p1", action: "block" }, auth("u2")); assert.equal((await api.getFeed({}, auth("u1"))).items.length, 0);
});
test("accepting a friend in another organization projects their history and acceptance retries succeed", async () => {
  const { api } = setup({ "players/p4/reps/r4": rep("r4") });
  assert.equal((await api.rebuild("p4")).count, 0);
  await api.connect({ playerId: "p4", action: "request" }, auth("u2"));
  await api.connect({ playerId: "p2", action: "accept" }, auth("u4"));
  await api.connect({ playerId: "p2", action: "accept" }, auth("u4"));
  assert.equal((await api.getFeed({ scope: "friends" }, auth("u2"))).items.length, 1);
});
test("membership moves and player deletion revoke stale summaries immediately", async () => {
  const { api, db } = setup(); await api.rebuild("p2"); const id = (await api.getFeed({}, auth("u1"))).items[0].id;
  await db.doc("players/p2").update({ organizationId: "other" }); await assert.rejects(api.getDetail({ id }, auth("u1")), { code: "permission-denied" });
  await db.doc("players/p2").delete(); await assert.rejects(api.getDetail({ id }, auth("u1")), { code: "permission-denied" });
});
test("Auth deletion tombstones override explicit public sharing and prevent preference resurrection", async () => {
  const { api, db } = setup(); await api.rebuild("p2"); const id = (await api.getFeed({}, auth("u1"))).items[0].id;
  await api.setVisibility({ id, audience: "organization", hidden: false }, auth("u2"));
  await db.doc("socialPreferences/u2").set({ accountDeleted: true, audience: "private", automatic: false, videos: false });
  assert.equal((await api.getFeed({}, auth("u1"))).items.length, 0);
  await assert.rejects(api.savePreferences({ audience: "organization", automatic: true, videos: true }, auth("u2")), { code: "permission-denied" });
  await assert.rejects(api.connect({ playerId: "p2", action: "request" }, auth("u1")), { code: "permission-denied" });
});
test("settling sessions are not presented as finished activity", async () => {
  const { api } = setup({ "players/p2/reps/r1": rep("r1", { createdAt: new FakeTimestamp(NOW - 1000) }) }); await api.rebuild("p2"); assert.equal((await api.getFeed({}, auth("u1"))).items.length, 0);
});
test("pagination is stable across equal timestamps and duplicate audience matches", async () => {
  const { api, db } = setup(); for (let n = 1; n <= 45; n++) await db.doc(`players/p2/reps/r${n}`).set(rep(`r${n}`, { sessionNumber: n }));
  await api.rebuild("p2"); const first = await api.getFeed({}, auth("u1")), second = await api.getFeed({ cursor: first.cursor }, auth("u1")), third = await api.getFeed({ cursor: second.cursor }, auth("u1"));
  assert.equal(first.items.length, 20); assert.equal(second.items.length, 20); assert.equal(third.items.length, 5); assert.equal(third.cursor, null); assert.equal(new Set([...first.items, ...second.items, ...third.items].map(a => a.id)).size, 45);
});
test("kudos and comment retries are idempotent; spoofing and unauthorized deletion are rejected", async () => {
  const { api } = setup(); await api.rebuild("p2"); const id = (await api.getFeed({}, auth("u1"))).items[0].id;
  await api.kudos({ id, liked: true }, auth("u1")); await api.kudos({ id, liked: true }, auth("u1")); assert.equal((await api.getDetail({ id }, auth("u1"))).kudos, 1);
  const input = { id, commentId: "comment", text: "Well done!", uid: "u2" }; await api.comment(input, auth("u1")); await api.comment(input, auth("u1"));
  const comments = await api.comments({ id }, auth("u2")); assert.equal(comments.items.length, 1); assert.equal(comments.items[0].uid, "u1");
  await assert.rejects(api.comment({ id, commentId: "comment", remove: true }, auth("u3")), { code: "permission-denied" });
  await api.comment({ id, commentId: "comment", remove: true }, auth("u2")); assert.equal((await api.comments({ id }, auth("u1"))).items.length, 0);
});
test("report moderation requires verified admin and hides activity", async () => {
  const { api } = setup(); await api.rebuild("p2"); const id = (await api.getFeed({}, auth("u1"))).items[0].id;
  await api.report({ id, reason: "Please review" }, auth("u1")); await assert.rejects(api.moderation({ id, hidden: true }, auth("u1")), { code: "permission-denied" });
  await api.moderation({ id, hidden: true }, { uid: "admin", email: "admin@posetek.net", emailVerified: true }); assert.equal((await api.getFeed({}, auth("u1"))).items.length, 0);
});
test("video signing uses validated owner folders, five-minute expiry, and current privacy", async () => {
  let signed = 0; const bucket = { name: "bucket", getFiles: async ({ prefix }) => [[{ name: prefix + "recording.mp4", getSignedUrl: async ({ expires }) => { signed++; assert.equal(expires, NOW + 300000); return ["https://signed.example/video"]; } }]] };
  const { api } = setup({}, bucket); await api.rebuild("p2"); const id = (await api.getFeed({}, auth("u1"))).items[0].id;
  assert.equal((await api.media({ id }, auth("u1"))).expiresAt, NOW + 300000);
  await api.savePreferences({ audience: "organization", automatic: true, videos: false }, auth("u2")); assert.equal((await api.media({ id }, auth("u1"))).url, null); assert.equal(signed, 1);
  await assert.rejects(api.media({ id }, auth("u4")), { code: "permission-denied" });
});
test("planted Storage path cannot sign another player's video", async () => {
  let listed = false; const { api } = setup({ "players/p2/reps/r1": rep("r1", { storagePath: "p1/deadballShot/session1/kick1" }) }, { name: "bucket", getFiles: async () => { listed = true; return [[]]; } });
  await api.rebuild("p2"); const id = idFor("p2", "session", "shooting:session1"); assert.equal((await api.media({ id }, auth("u1"))).url, null); assert.equal(listed, false);
});

const adminViewer = { uid: "admin", email: "staff@posetek.net", emailVerified: true };
test("admin athlete preview exactly matches athlete visibility without administrator bypass", async () => {
  const { api, db } = setup(); await api.rebuild("p2");
  const id = (await api.getFeed({}, auth("u1"))).items[0].id;
  await db.doc("socialPreferences/u2").set({ audience: "private" });
  assert.equal((await api.getFeed({}, adminViewer)).items.length, 1);
  assert.deepEqual(await api.getFeed({ viewAsPlayerId: "p1", organizationId: "org" }, adminViewer), await api.getFeed({}, auth("u1")));
  await assert.rejects(api.getDetail({ id, viewAsPlayerId: "p1" }, adminViewer), { code: "permission-denied" });
  await assert.rejects(api.getFeed({ viewAsPlayerId: "p1" }, auth("u2")), { code: "permission-denied" });
  await assert.rejects(api.getFeed({ viewAsPlayerId: "p1", organizationId: "other" }, adminViewer), { code: "permission-denied" });
  const c = await api.getContext({ viewAsPlayerId: "p1" }, adminViewer);
  assert.equal(c.admin, false); assert.equal(c.adminViewer, true); assert.equal(c.playerId, "p1");
});
test("every mutation rejects athlete preview mode", async () => {
  const { api } = setup();
  for (const method of ["savePreferences", "setVisibility", "connect", "kudos", "comment", "report", "moderation"]) {
    await assert.rejects(async () => api[method]({ viewAsPlayerId: "p1" }, adminViewer), { code: "permission-denied" });
  }
});
test("admin directory includes organizations and marks unclaimed athletes unavailable", async () => {
  const { api } = setup({ "players/unclaimed": { organizationId: "org", firstName: "Pending", registered: false }, "organizations/legacy": { name: "Legacy" } });
  const d = await api.adminDirectory({ organizationId: "org" }, adminViewer);
  assert.equal(d.organizations.length, 2); assert.equal(d.players.find(p => p.id === "unclaimed").canPreview, false);
  await assert.rejects(api.adminDirectory({}, auth("u1")), { code: "permission-denied" });
  await assert.rejects(api.getFeed({ viewAsPlayerId: "unclaimed" }, adminViewer), { code: "failed-precondition" });
});
test("all-organization rollout projects other clubs and preserves read isolation", async () => {
  const { api } = setup({ "socialSettings/feed": { enabled: true, allOrganizations: true }, "players/p4/reps/r1": rep() });
  await api.rebuild("p4"); assert.equal((await api.getFeed({}, auth("u4"))).items.length, 1);
  assert.equal((await api.getFeed({}, auth("u1"))).items.length, 0);
});

test("friends outside an organization project when connected to any enabled organization", async () => {
  const { api, db } = setup({ "socialSettings/feed": { enabled: true, allOrganizations: true, organizationIds:["org"] },
    "players/outside": { authenticationUID:"outside-user", userUID:"outside-user", firstName:"Friend" },
    "players/outside/reps/r1": rep(), "socialConnections/friend-edge": { participants:["outside-user","u4"], status:"accepted", blockedBy:[] } });
  assert.equal((await api.rebuild("outside")).count, 1);
  const friendFeed = await api.getFeed({scope:"friends"}, auth("u4"));
  assert.equal(friendFeed.items.length, 1);
});
