"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FakeFirestore, HttpsError } = require("./test-support/fake-firestore");
const { createSocial } = require("./social");
const { idFor } = require("./social-projection");
const NOW = Date.UTC(2026, 8, 18);
const viewer = uid => ({ uid });
const admin = { uid: "admin", email: "staff@posetek.net", emailVerified: true };
const v2 = { contractVersion: 2 };
const player = (uid, more = {}) => ({ authenticationUID: uid, userUID: uid, organizationId: "club", teamId: "team", firstName: uid, lastName: "PrivateLast", dateOfBirth: "2014-01-01", email: "private@example.test", ...more });
const rep = (id = "r", more = {}) => ({ id, repType: "jump", sessionId: "s1", sessionNumber: 1, repNumber: 1, jumpHeight: .5, createdAt: NOW - 3600000, storagePath: "p2/jump/session1/kick1", ...more });
function setup(extra = {}, options = {}) {
  let time = NOW;
  const db = new FakeFirestore({ "socialSettings/feed": { enabled: true, communityEnabled: true, allOrganizations: true },
    "players/p1": player("u1"), "players/p2": player("u2"), "players/p3": player("u3", { organizationId: "other", age: 9 }),
    "players/p2/reps/r": rep(), "organizations/club": { name: "Example club" }, "teams/team": { name: "Example team" }, ...extra });
  const videos = options.videos || [];
  const signed = [];
  const bucket = { name: "bucket", getFiles: async ({ prefix }) => [videos.filter(name => name.startsWith(prefix)).map(name => ({ name }))],
    file: name => ({ getMetadata: async () => { if (!videos.includes(name)) throw Object.assign(new Error("missing"), { code: 404 }); return [{ size: 42, generation: "1" }]; },
      getSignedUrl: async ({ expires }) => { signed.push({ name, expires }); return [`https://signed.example/${name}`]; } }) };
  const readEvidence = options.readEvidence || (async (id, r) => ({ folder: r.storagePath, metadata: { ...r, resultsValid: true, processingStatus: "complete" },
    context: { rep: { repId: r.id, playerDocId: id, ...(options.claimedPath ? { videoStoragePath: options.claimedPath } : {}) }, result: { resultsValid: true } } }));
  return { db, api: createSocial({ db, bucket, HttpsError, now: () => time, readEvidence }), signed, advance: ms => { time += ms; } };
}
async function publish(f, changes = {}) {
  await f.api.rebuild("p2");
  await f.api.saveCommunityProfile({ displayName: "Alex P", discoverable: true, showClub: false }, viewer("u2"));
  const id = idFor("p2", "session", "jump:s1");
  await f.api.setVisibility({ ...v2, id, audience: "community", hidden: false, videos: true, commentsEnabled: true, caption: "Practice today", ...changes }, viewer("u2"));
  return id;
}
test("new preferences are private; recorded legacy defaults and scopes stay compatible", async () => {
  const f = setup({ "socialPreferences/u2": { audience: "organization", automatic: true, videos: true } });
  assert.deepEqual((await f.api.getContext(v2, viewer("u1"))).preferences, { audience: "private", automatic: false, videos: false });
  await f.api.rebuild("p2");
  assert.equal((await f.api.getFeed({}, viewer("u1"))).items.length, 1);
  assert.equal((await f.api.getFeed({ scope: "community", ...v2 }, viewer("u3"))).items.length, 0);
  await assert.rejects(f.api.savePreferences({ audience: "community", automatic: true, videos: true }, viewer("u2")), { code: "invalid-argument" });
});
test("discovery is explicit and age independent, with minimal profiles and no unclaimed roster", async () => {
  const f = setup({ "players/unclaimed": { firstName: "Pending", age: 10, registered: false }, "socialCommunityProfiles/unclaimed": { discoverable: true, displayName: "Pending" } });
  assert.equal((await f.api.discovery({}, viewer("u1"))).people.length, 0);
  await f.api.saveCommunityProfile({ displayName: "Young player", discoverable: true, showClub: false }, viewer("u3"));
  const people = (await f.api.discovery({ query: "young" }, viewer("u1"))).people;
  assert.equal(people.length, 1); assert.equal(people[0].playerId, "p3");
  for (const field of ["age", "dateOfBirth", "email", "uid", "authenticationUID", "metrics"]) assert.equal(people[0][field], undefined);
  await assert.rejects(f.api.discovery({}, null), { code: "unauthenticated" });
});
test("feature gate defaults closed without preventing owners reading saved settings", async () => {
  const f = setup({ "socialSettings/feed": { enabled: true, allOrganizations: true } });
  assert.equal((await f.api.getContext(v2, viewer("u1"))).communityEnabled, false);
  assert.equal((await f.api.getCommunityProfile({}, viewer("u1"))).mine, true);
  await assert.rejects(f.api.discovery({}, viewer("u1")), { code: "failed-precondition" });
  await assert.rejects(f.api.saveCommunityProfile({ displayName: "Player", discoverable: true, showClub: false }, viewer("u1")), { code: "failed-precondition" });
});

test("first publication can distinguish an unsaved fallback name without exposing setup state to other players", async () => {
  const f = setup();
  assert.equal((await f.api.getCommunityProfile({}, viewer('u2'))).displayNameConfigured, false);
  const saved = await f.api.saveCommunityProfile({ displayName: 'Alex P', discoverable: false, showClub: false }, viewer('u2'));
  assert.equal(saved.displayNameConfigured, true);
  assert.equal(saved.discoverable, false);
  assert.equal(saved.clubName, '');
  await publish(f);
  assert.equal((await f.api.getCommunityProfile({ playerId: 'p2' }, viewer('u3'))).displayNameConfigured, undefined);
});
test("community publication is per activity; V1 omits new audience and asks detail clients to update", async () => {
  const f = setup({ "players/p2/reps/second": rep("second", { sessionId: "s2", sessionNumber: 2, storagePath: "p2/jump/session2/kick1" }) });
  const id = await publish(f);
  const community = await f.api.getFeed({ ...v2, scope: "community" }, viewer("u3"));
  assert.equal(community.items.length, 1); assert.equal(community.items[0].id, id);
  assert.equal(community.items[0].authorName, "Alex P"); assert.equal(community.items[0].authorUid, undefined);
  assert.equal(community.items[0].teamName, ""); assert.equal(community.items[0].canViewVideo, false);
  assert.equal((await f.api.getFeed({}, viewer("u1"))).items.length, 0);
  await assert.rejects(f.api.getDetail({ id }, viewer("u3")), { code: "failed-precondition" });
  await assert.rejects(f.api.getFeed({ scope: "community" }, viewer("u1")), { code: "invalid-argument" });
  assert.equal((await f.api.getFeed({ ...v2, scope: "all" }, viewer("u3"))).items.length, 0);
});
test("discovery off preserves authorized direct post profiles; withdraw revokes posts separately", async () => {
  const f = setup(); const id = await publish(f);
  await f.api.saveCommunityProfile({ displayName: "Alex P", discoverable: false, showClub: false }, viewer("u2"));
  assert.equal((await f.api.discovery({}, viewer("u3"))).people.length, 0);
  assert.equal((await f.api.getCommunityProfile({ playerId: "p2" }, viewer("u3"))).displayName, "Alex P");
  assert.equal((await f.api.getDetail({ ...v2, id }, viewer("u3"))).id, id);
  f.advance(1); await f.api.withdrawCommunityPosts({}, viewer("u2"));
  await assert.rejects(f.api.getDetail({ ...v2, id }, viewer("u3")), { code: "permission-denied" });
  await assert.rejects(f.api.getCommunityProfile({ playerId: "p2" }, viewer("u3")), { code: "permission-denied" });
  assert.equal((await f.api.getDetail({ ...v2, id }, viewer("u2"))).communityPublished, false);
});
test("any signed-in claimed player can react/comment; comments disabled is authoritative", async () => {
  const f = setup(); const id = await publish(f);
  await f.api.kudos({ id, liked: true }, viewer("u3"));
  await f.api.comment({ id, commentId: "comment1", text: "Nice work" }, viewer("u3"));
  assert.equal((await f.api.comments({ ...v2, id }, viewer("u1"))).items[0].uid, undefined);
  await f.api.setVisibility({ ...v2, id, audience: "community", hidden: false, videos: false, commentsEnabled: false }, viewer("u2"));
  f.advance(3000);
  await assert.rejects(f.api.comment({ id, commentId: "comment2", text: "Again" }, viewer("u3")), { code: "permission-denied" });
  await f.api.comment({ id, commentId: "comment1", remove: true }, viewer("u2"));
  assert.equal((await f.api.comments({ ...v2, id }, viewer("u1"))).items.length, 0);
});
test("inbox interaction retries are idempotent and hide removed/private/blocked sources", async () => {
  const f = setup(); const id = await publish(f);
  for (let i = 0; i < 2; i++) await f.api.kudos({ id, liked: true }, viewer("u3"));
  for (let i = 0; i < 2; i++) await f.api.comment({ id, commentId: "comment1", text: "Nice work" }, viewer("u3"));
  let inbox = await f.api.inbox({}, viewer("u2")); assert.equal(inbox.items.length, 2); assert.equal(inbox.unreadCount, 2);
  await f.api.markInboxRead({ ids: inbox.items.map(x => x.id) }, viewer("u2"));
  assert.equal((await f.api.inbox({}, viewer("u2"))).unreadCount, 0);
  await f.api.kudos({ id, liked: false }, viewer("u3"));
  assert.equal((await f.api.inbox({}, viewer("u2"))).items.length, 1);
  await f.api.connect({ playerId: "p3", action: "block" }, viewer("u2"));
  assert.equal((await f.api.inbox({}, viewer("u2"))).items.length, 0);
  await assert.rejects(f.api.getDetail({ id, ...v2 }, viewer("u3")), { code: "permission-denied" });
  assert.equal((await f.api.discovery({}, viewer("u3"))).people.length, 0);
});
test("request and acceptance notifications track current connection state", async () => {
  const f = setup();
  await f.api.connect({ playerId: "p2", action: "request" }, viewer("u1"));
  await f.api.connect({ playerId: "p2", action: "request" }, viewer("u1"));
  assert.equal((await f.api.inbox({}, viewer("u2"))).items.length, 1);
  await f.api.connect({ playerId: "p1", action: "accept" }, viewer("u2"));
  assert.equal((await f.api.inbox({}, viewer("u2"))).items.length, 0);
  assert.equal((await f.api.inbox({}, viewer("u1"))).items[0].type, "accepted");
  await f.api.connect({ playerId: "p2", action: "remove" }, viewer("u1"));
  assert.equal((await f.api.inbox({}, viewer("u1"))).items.length, 0);
});
test("activity/comment/profile moderation is authorized, recorded and prevents interaction", async () => {
  const f = setup(); const id = await publish(f);
  await f.api.comment({ id, commentId: "comment1", text: "Text" }, viewer("u3"));
  await f.api.reportContent({ targetType: "comment", activityId: id, commentId: "comment1", reason: "Review" }, viewer("u1"));
  await assert.rejects(f.api.moderateContent({}, viewer("u1")), { code: "permission-denied" });
  let report = (await f.api.moderateContent({}, admin)).reports[0]; assert.equal(report.reporterUid, undefined);
  await f.api.moderateContent({ reportId: report.id, action: "removeComment" }, admin);
  assert.equal((await f.api.comments({ ...v2, id }, viewer("u1"))).items.length, 0);
  await f.api.reportContent({ targetType: "profile", playerId: "p2", reason: "Review" }, viewer("u1"));
  report = (await f.api.moderateContent({}, admin)).reports[0];
  await f.api.moderateContent({ reportId: report.id, action: "suspendProfile" }, admin);
  assert.equal((await f.api.discovery({}, viewer("u1"))).people.length, 0);
  await assert.rejects(f.api.getDetail({ ...v2, id }, viewer("u1")), { code: "permission-denied" });
  await assert.rejects(f.api.kudos({ id, liked: true }, viewer("u2")), { code: "permission-denied" });
  assert.ok([...f.db.docs.keys()].some(p => p.startsWith("socialModerationAudit/")));
});
test("all additional writes reject administrator athlete preview", async () => {
  const f = setup();
  for (const name of ["saveCommunityProfile", "withdrawCommunityPosts", "markInboxRead", "reportContent", "moderateContent"]) {
    await assert.rejects(async () => f.api[name]({ viewAsPlayerId: "p1" }, admin), { code: "permission-denied" });
  }
});
test("canonical projection rejects failed measurements and proven duplicate mirrors", async () => {
  const f = setup({ "players/p2/reps/invalid": rep("invalid", { sessionId: "invalid", resultsValid: false, processingStatus: "failed" }),
    "players/p2/reps/mirror": rep("mirror", { storagePath: null }) });
  await f.api.rebuild("p2");
  const summaries = [...f.db.docs.values()].filter(x => x.kind === "session");
  assert.equal(summaries.length, 1); assert.deepEqual(summaries[0].repIds, ["r"]); assert.equal(summaries[0].schemaVersion, 2);
});
test("accepted revisions and explicit correction documents reproject without changing activity identity", async () => {
  const r = rep("r", { resultsValid: false, adminRevision: { revisionId: "fix", atMillis: NOW } });
  const f = setup({ "players/p2/reps/r": r, "players/p2/reps/r/revisions/fix": { revisionId: "fix", fields: { jumpHeight: .5 } } },
    { readEvidence: async (id, raw) => ({ metadata: { ...raw, resultsValid: true, processingStatus: "complete" }, context: { result: { resultsValid: false } } }) });
  await f.api.rebuild("p2");
  const id = idFor("p2", "session", "jump:s1"); assert.ok(f.db.snapshot(`socialActivities/${id}`));
  await f.db.doc("players/p2/reps/r").update({ duplicateOf: "other" });
  await f.db.doc("players/p2/reps/other").set(rep("other", { sessionId: "s2", sessionNumber: 2, storagePath: "p2/jump/session2/kick1" }));
  await f.db.doc("players/p2/insightMetadata/resultCorrections").set({ schemaVersion: 1, repairId: "repair", reviewedAtMillis: NOW, duplicateReps: { r: "other" } });
  await f.api.rebuild("p2"); assert.equal(f.db.snapshot(`socialActivities/${id}`), undefined);
});
test("old unqualified projection is withheld until migration; raw source stays untouched", async () => {
  const f = setup(); await f.api.rebuild("p2"); const id = idFor("p2", "session", "jump:s1");
  await f.db.doc(`socialActivities/${id}`).update({ schemaVersion: 1 });
  await assert.rejects(f.api.getDetail({ ...v2, id }, viewer("u2")), { code: "permission-denied" });
  assert.equal((await f.api.rebuild("p2", true)).writes, 1);
  assert.equal(f.db.snapshot(`socialActivities/${id}`).schemaVersion, 1);
  await f.api.rebuild("p2"); assert.equal(f.db.snapshot(`socialActivities/${id}`).schemaVersion, 2);
  assert.deepEqual(f.db.snapshot("players/p2/reps/r"), rep());
});
test("selected exact media uses five-minute links, rejects ambiguity and exposes truthful availability", async () => {
  const path = "p2/jump/session1/kick1/right.mov", videos = ["p2/jump/session1/kick1/wrong.mov", path];
  const f = setup({}, { videos, claimedPath: path }); const id = await publish(f);
  const detail = await f.api.getDetail({ ...v2, id }, viewer("u3")); assert.equal(detail.canViewVideo, true); assert.equal(f.signed.length, 0);
  const media = await f.api.media({ id }, viewer("u3")); assert.equal(media.expiresAt, NOW + 300000); assert.ok(media.url.endsWith("right.mov"));
  const ambiguous = setup({}, { videos }); const ambiguousId = await publish(ambiguous);
  assert.equal((await ambiguous.api.media({ id: ambiguousId }, viewer("u3"))).url, null);
  f.advance(1); await f.api.savePreferences({ audience: "private", automatic: false, videos: false }, viewer("u2"));
  assert.equal((await f.api.media({ id }, viewer("u3"))).url, null);
});
test("media rechecks authorization after signing and never returns a newly revoked URL", async () => {
  const path = "p2/jump/session1/kick1/right.mov";
  const f = setup({}, { videos: [path] }); const id = await publish(f);
  const original = f.db.doc(`socialActivitySettings/${id}`);
  // Simulate a privacy change while storage signing is awaiting completion.
  const originalRead = f.db.read.bind(f.db); let reads = 0;
  f.db.read = path => {
    if (path === `socialActivitySettings/${id}` && ++reads === 2) f.db.docs.set(path, { ...originalRead(path), hidden: true });
    return originalRead(path);
  };
  await assert.rejects(f.api.media({ id }, viewer("u3")), { code: "permission-denied" });
});
test("activity reprojection preserves explicit publication and engagement", async () => {
  const f = setup(); const id = await publish(f);
  await f.api.kudos({ id, liked: true }, viewer("u3"));
  await f.api.rebuild("p2");
  const detail = await f.api.getDetail({ ...v2, id }, viewer("u3")); assert.equal(detail.kudos, 1); assert.equal(detail.communityPublished, true);
  assert.equal((await f.api.rebuild("p2")).writes, 0);
});
test("rebound account never inherits the prior owner's discovery or publication consent", async () => {
  const f = setup(); const id = await publish(f);
  await f.db.doc("players/p2").update({ authenticationUID: "replacement", userUID: "replacement" });
  assert.equal((await f.api.discovery({}, viewer("u3"))).people.length, 0);
  await assert.rejects(f.api.getDetail({ ...v2, id }, viewer("u3")), { code: "permission-denied" });
  assert.equal((await f.api.getCommunityProfile({}, viewer("replacement"))).discoverable, false);
});
test("resolved suspension reports remain recoverable and restore re-enables only existing consent", async () => {
  const f = setup(); await publish(f);
  await f.api.reportContent({ targetType: "profile", playerId: "p2", reason: "Review" }, viewer("u3"));
  const report = (await f.api.moderateContent({}, admin)).reports[0];
  await f.api.moderateContent({ reportId: report.id, action: "suspendProfile" }, admin);
  assert.equal((await f.api.moderateContent({}, admin)).reports[0].targetSuspended, true);
  await f.api.moderateContent({ reportId: report.id, action: "restoreProfile" }, admin);
  assert.equal((await f.api.moderateContent({}, admin)).reports.length, 0);
  assert.equal((await f.api.discovery({}, viewer("u3"))).people.length, 1);
});
test("owner identity and forged profile/publication fields cannot grant access", async () => {
  const f = setup({ "players/unclaimed": { userUID: "unclaimed", authenticationUID: "other" } });
  await assert.rejects(f.api.saveCommunityProfile({ displayName: "Someone", discoverable: true, showClub: false, playerId: "p2" }, viewer("unclaimed")), { code: "permission-denied" });
  const id = await publish(f);
  await assert.rejects(f.api.setVisibility({ ...v2, id, audience: "private", hidden: true }, viewer("u3")), { code: "permission-denied" });
  await assert.rejects(f.api.setVisibility({ ...v2, id, audience: "community", hidden: false }, viewer("u2")), { code: "invalid-argument" });
  await assert.rejects(f.api.setVisibility({ ...v2, id, audience: "community", hidden: false, videos: true, commentsEnabled: true, selectedRepId: "another-capture" }, viewer("u2")), { code: "invalid-argument" });
});
test("community profile feed filters the chosen player before pagination", async () => {
  const f = setup({ "players/p1/reps/r1": rep("r1", { storagePath: "p1/jump/session1/kick1" }) });
  const targetId = await publish(f);
  await f.api.rebuild("p1");
  await f.api.saveCommunityProfile({ displayName: "Another author", discoverable: true, showClub: false }, viewer("u1"));
  await f.api.setVisibility({ ...v2, id: idFor("p1", "session", "jump:s1"), audience: "community", hidden: false, videos: false, commentsEnabled: true }, viewer("u1"));
  assert.equal((await f.api.getFeed({ ...v2, scope: "community" }, viewer("u3"))).items.length, 2);
  const profile = await f.api.getFeed({ ...v2, scope: "community", playerId: "p2" }, viewer("u3"));
  assert.deepEqual(profile.items.map(row => row.id), [targetId]); assert.equal(profile.cursor, null);
});
test("migration can prepare claimed players outside the legacy pilot while community stays gated", async () => {
  const f = setup({ "socialSettings/feed": { enabled: true, communityEnabled: false, organizationIds: ["pilot"] } });
  assert.equal((await f.api.rebuild("p2")).skipped, "outside pilot");
  assert.equal((await f.api.rebuild("p2", true, { includeCommunity: true })).count, 1);
  assert.equal(f.db.snapshot(`socialActivities/${idFor("p2", "session", "jump:s1")}`), undefined);
  assert.equal((await f.api.rebuild("p2", false, { includeCommunity: true })).count, 1);
  assert.equal((await f.api.getContext(v2, viewer("u2"))).communityEnabled, false);
  assert.equal((await f.api.getFeed(v2, viewer("u1"))).items.length, 0);
});
test("comment and kudos recheck block/privacy/account suspension inside their transactions", async () => {
  for (const mode of ["comments", "suspension", "block", "private", "binding"]) {
    const f = setup(); const id = await publish(f);
    const original = f.db.runTransaction.bind(f.db); let injected = false;
    f.db.runTransaction = async handler => {
      if (!injected) {
        injected = true;
        if (mode === "comments") await f.db.doc(`socialActivitySettings/${id}`).set({ commentsEnabled: false }, { merge: true });
        if (mode === "suspension") await f.db.doc("socialCommunityProfiles/p3").set({ suspended: true }, { merge: true });
        if (mode === "block") await f.db.doc(`socialConnections/${idFor("u2", "u3")}`).set({ participants: ["u2", "u3"], status: "none", blockedBy: ["u2"] });
        if (mode === "private") await f.db.doc(`socialActivitySettings/${id}`).set({ audience: "private" }, { merge: true });
        if (mode === "binding") await f.db.doc("players/p3").update({ userUID: "replacement", authenticationUID: "replacement" });
      }
      return original(handler);
    };
    await assert.rejects(f.api.comment({ id, commentId: "raced", text: "Do not commit" }, viewer("u3")), { code: "permission-denied" });
    assert.equal(f.db.snapshot(`socialActivities/${id}/comments/raced`), undefined);
    if (mode !== "comments") await assert.rejects(f.api.kudos({ id, liked: true }, viewer("u3")), { code: "permission-denied" });
  }
  for (const action of ["comment", "kudos"]) {
    const f = setup({ "socialPreferences/u2": { audience: "organization", automatic: true, videos: false } });
    await f.api.rebuild("p2"); const id = idFor("p2", "session", "jump:s1");
    const original = f.db.runTransaction.bind(f.db);
    f.db.runTransaction = async handler => {
      const p = f.db.snapshot("players/p1"); delete p.organizationId;
      await f.db.doc("players/p1").set(p);
      return original(handler);
    };
    await assert.rejects(f.api[action]({ id, commentId: "org-removed", text: "Do not commit", liked: true }, viewer("u1")), { code: "permission-denied" });
    assert.equal(f.db.snapshot(`socialActivities/${id}/comments/org-removed`), undefined);
    assert.equal(f.db.snapshot(`socialActivities/${id}/kudos/u1`), undefined);
  }
});
test("inbox comments do not attribute a previous account's action to a rebound player", async () => {
  const f = setup(); const id = await publish(f);
  await f.api.comment({ id, commentId: "before-transfer", text: "Original account" }, viewer("u3"));
  assert.equal((await f.api.inbox({}, viewer("u2"))).items.length, 1);
  await f.db.doc("players/p3").update({ authenticationUID: "replacement", userUID: "replacement", firstName: "Replacement" });
  assert.equal((await f.api.inbox({}, viewer("u2"))).items.length, 0);
});
test("comment notification identity includes its activity, not just the scoped comment id", async () => {
  const f = setup({ "players/p2/reps/second": rep("second", { sessionId: "s2", sessionNumber: 2, storagePath: "p2/jump/session2/kick1" }) });
  const first = await publish(f), second = idFor("p2", "session", "jump:s2");
  await f.api.setVisibility({ ...v2, id: second, audience: "community", hidden: false, videos: false, commentsEnabled: true }, viewer("u2"));
  await f.api.comment({ id: first, commentId: "same-id", text: "First" }, viewer("u3"));
  f.advance(3000);
  await f.api.comment({ id: second, commentId: "same-id", text: "Second" }, viewer("u3"));
  const items = (await f.api.inbox({}, viewer("u2"))).items;
  assert.equal(items.length, 2); assert.equal(new Set(items.map(x => x.activityId)).size, 2);
});
test("legacy lookup and legacy comment requests cannot bypass chosen community aliases", async () => {
  const f = setup(); const id = await publish(f);
  const person = (await f.api.people({ playerId: "p2" }, viewer("u3"))).people.find(row => row.playerId === "p2");
  assert.equal(person.name, "Alex P"); assert.equal(person.uid, null); assert.equal(person.canConnect, true);
  await f.db.doc(`socialActivities/${id}/comments/old`).set({ id: "old", uid: "u2", name: "Full secret legacy name", text: "Old comment", createdAt: NOW });
  await assert.rejects(f.api.comments({ id }, viewer("u3")), { code: "failed-precondition" });
  const comments = (await f.api.comments({ ...v2, id }, viewer("u3"))).items;
  assert.equal(comments[0].name, "Alex P"); assert.equal(comments[0].uid, undefined);
});
test("legacy active staff retain engagement and receive no fabricated player identity", async () => {
  const f = setup({ "socialPreferences/u2": { audience: "organization", automatic: true, videos: false },
    "coaches/coach": { userUID: "coach", organizationId: "club" },
    "organizations/club/members/coach": { userUID: "coach", role: "coach", status: "active", teamIds: ["team"], firstName: "Coach" } });
  await f.api.rebuild("p2"); const id = idFor("p2", "session", "jump:s1");
  await f.api.kudos({ id, liked: true }, viewer("coach"));
  await f.api.comment({ id, commentId: "coach-comment", text: "Well done" }, viewer("coach"));
  const items = (await f.api.inbox({}, viewer("u2"))).items;
  assert.equal(items.length, 2); assert.ok(items.every(x => x.actor.playerId === null && x.actor.displayName === "PoseTek staff"));
  await publish(f);
  await assert.rejects(f.api.comment({ id, commentId: "community-coach", text: "No player binding" }, viewer("coach")), { code: "permission-denied" });
});
