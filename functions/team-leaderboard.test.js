const assert = require("node:assert/strict");
const { test } = require("node:test");
const { FakeFirestore, FakeTimestamp, HttpsError } = require("./test-support/fake-firestore");
const { createTeamLeaderboard, projectedRep } = require("./team-leaderboard");
const { createEffectiveResults } = require("./effective-results");
const { primary } = require("./insights-v2-qualification");
function service(db, readEvidence = async (_, rep) => ({ metadata: rep, context: { result: { resultsValid: true, primaryMetric: primary(rep)?.value } } })) {
  return createTeamLeaderboard({ db, HttpsError, effectiveResults: createEffectiveResults({ db, HttpsError, bucket: { name: "test" }, readEvidence }) });
}

const seed = {
  "coaches/legacy-doc": { userUID: "coach", members: ["me", "teammate", "ghost"] },
  "players/me": { firstName: "Ada", lastName: "Smith", authenticationUID: "athlete", userUID: "athlete", coachDocId: "legacy-doc", signupEmail: "private@example.test", height: 170 },
  "players/teammate": { firstName: "Bo", lastName: "Lee", userUID: "bo", coachUID: "coach", phone_number: "555", email: "bo@example.test" },
  "players/me/reps/r1": { repType: "sprint", max_velocity: 8.1, createdAt: FakeTimestamp.fromMillis(1000), storagePath: "me/sprint/session1/kick1", nested: { secret: true } },
  "players/teammate/reps/r2": { repType: "side_kick", velocity: 25.2, createdAt: FakeTimestamp.fromMillis(2000), strike_foot: "left" },
  "players/teammate/reps/r3": { repType: "changeOfDirection", totalTime: 4.2, phase1Time: 1.1, phase2Time: 2, phase3Time: 1.1 },
  "players/outsider": { firstName: "Out", lastName: "Sider", userUID: "out" },
  "players/outsider/reps/r4": { repType: "sprint", max_velocity: 9.9 },
};

test("athlete receives names and metric fields for the roster they belong to, nothing else", async () => {
  const db = new FakeFirestore(seed);
  const { getTeamLeaderboard } = service(db);
  const result = await getTeamLeaderboard({ uid: "athlete" });
  assert.equal(result.playerId, "me");
  assert.equal(result.coachId, "legacy-doc");
  assert.deepEqual(result.athletes.map((athlete) => athlete.id), ["me", "teammate"]);
  const teammate = result.athletes[1];
  assert.deepEqual(Object.keys(teammate).sort(), ["firstName", "id", "lastName", "reps"]);
  assert.deepEqual(teammate.reps.map(rep => rep.id), ["r2", "r3"]);
  assert.equal(teammate.reps[0].velocity, 25.2); assert.equal(teammate.reps[0].repType, "side_kick");
  assert.equal(teammate.reps[1].totalTime, 4.2);
  assert.equal(result.athletes[0].reps[0].max_velocity, 8.1);
  assert.equal(result.athletes[0].reps[0].createdAtMillis, 1000);
  assert.ok(result.athletes.every(athlete => athlete.reps.every(rep => rep.resultStatus.qualified && !rep.resultStatus.duplicate)));
  assert.ok(!JSON.stringify(result).includes("storagePath"));
  assert.ok(!JSON.stringify(result).includes("storageFolder"));
  assert.ok(!JSON.stringify(result).includes("outsider"));
  assert.ok(!JSON.stringify(result).includes("private@example.test"));
});

test("roster resolves through coachUID and members when no coachDocId is stored", async () => {
  const db = new FakeFirestore({
    ...seed,
    "players/me": { firstName: "Ada", lastName: "Smith", userUID: "athlete", coachUID: "coach" },
    "coaches/coach": { userUID: "coach", members: ["me"] },
  });
  const { getTeamLeaderboard } = service(db);
  assert.equal((await getTeamLeaderboard({ uid: "athlete" })).coachId, "coach");
  const membersOnly = new FakeFirestore({ ...seed, "players/me": { firstName: "Ada", lastName: "Smith", userUID: "athlete" } });
  assert.equal((await service(membersOnly).getTeamLeaderboard({ uid: "athlete" })).coachId, "legacy-doc");
});

test("unlinked, conflicting and teamless callers are refused", async () => {
  const db = new FakeFirestore({
    ...seed,
    "players/conflict": { authenticationUID: "conflict", userUID: "other" },
    "players/lonely": { userUID: "lonely" },
  });
  const { getTeamLeaderboard } = createTeamLeaderboard({ db, HttpsError });
  await assert.rejects(getTeamLeaderboard({ uid: "nobody" }), { code: "permission-denied" });
  await assert.rejects(getTeamLeaderboard({ uid: "conflict" }), { code: "permission-denied" });
  await assert.rejects(getTeamLeaderboard({ uid: "lonely" }), { code: "failed-precondition" });
  await assert.rejects(getTeamLeaderboard({ uid: "" }), { code: "unauthenticated" });
});

test("projection never forwards non-numeric metric values or unknown fields", () => {
  const rep = projectedRep({ id: "x", data: () => ({ repType: 12, velocity: "25", max_velocity: Infinity, totalTime: 3.5, storagePath: "p/x", drillType: "sprint" }) });
  assert.deepEqual(rep, { id: "x", drillType: "sprint", totalTime: 3.5 });
});

test("projection includes recorded foot and course distance for mobile comparisons", () => {
  const rep = projectedRep({ id: "dribble", data: () => ({ repType: "dribbling", dribble_foot: "left", markerDistance: 9.144, totalTime: 4.5, gateStartSide: "right", privateNote: "hidden" }) });
  assert.deepEqual(rep, { id: "dribble", repType: "dribbling", dribble_foot: "left", markerDistance: 9.144, totalTime: 4.5 });
  const cleared = projectedRep({ id: "cleared", data: () => ({ repType: "dribbling", dribble_foot: null, markerDistance: "9.144" }) });
  assert.deepEqual(cleared, { id: "cleared", repType: "dribbling" });
});

test("standings exclude failed metrics and duplicate mirrors using the shared effective qualification", async () => {
  const db = new FakeFirestore({ ...seed,
    "players/me/reps/failed": { repType: "sprint", max_velocity: 999, resultsValid: false },
    "players/me/reps/jump": { repType: "jump", jumpHeight: 0.3, sessionNumber: 1, repNumber: 1, storagePath: "me/jump/session1/kick1" },
    "players/me/reps/mirror": { repType: "jump", jumpHeight: 0.3, sessionNumber: 1, repNumber: 1 },
  });
  const result = await service(db).getTeamLeaderboard({ uid: "athlete" });
  assert.deepEqual(result.athletes.find(athlete => athlete.id === "me").reps.map(rep => rep.id).sort(), ["jump", "r1"]);
  assert.ok(!JSON.stringify(result).includes("999"));
});

test("standings recheck roster and club staff access after evidence reads", async () => {
  const db = new FakeFirestore(seed);
  const revoked = service(db, async (_, rep) => {
    await db.collection("coaches").doc("legacy-doc").update({ members: ["me"] });
    return { metadata: rep, context: { result: { resultsValid: true } } };
  });
  await assert.rejects(revoked.getTeamLeaderboard({ uid: "athlete" }), { code: "permission-denied" });
  const club = new FakeFirestore({ ...seed, "players/me": { userUID: "athlete", organizationId: "club", teamId: "a" },
    "teams/a": { organizationId: "club" }, "organizations/club/members/coach": { userUID: "coach", role: "coach", status: "active", teamIds: ["a"] } });
  const clubRevoked = service(club, async (_, rep) => {
    await club.collection("organizations").doc("club").collection("members").doc("coach").update({ teamIds: [] });
    return { metadata: rep, context: { result: { resultsValid: true } } };
  });
  await assert.rejects(clubRevoked.getTeamLeaderboard({ uid: "coach", teamId: "a" }), { code: "permission-denied" });
});

test("missing resolver and evidence failures never return raw standings", async () => {
  const db = new FakeFirestore(seed);
  await assert.rejects(createTeamLeaderboard({ db, HttpsError }).getTeamLeaderboard({ uid: "athlete" }), { code: "unavailable" });
  await assert.rejects(service(db, async () => { throw Error("evidence unavailable"); }).getTeamLeaderboard({ uid: "athlete" }), /evidence unavailable/);
});
