const assert = require("node:assert/strict");
const { test } = require("node:test");
const { FakeFirestore, FakeTimestamp, HttpsError } = require("./test-support/fake-firestore");
const { createTeamLeaderboard, projectedRep } = require("./team-leaderboard");

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
  const { getTeamLeaderboard } = createTeamLeaderboard({ db, HttpsError });
  const result = await getTeamLeaderboard({ uid: "athlete" });
  assert.equal(result.playerId, "me");
  assert.equal(result.coachId, "legacy-doc");
  assert.deepEqual(result.athletes.map((athlete) => athlete.id), ["me", "teammate"]);
  const teammate = result.athletes[1];
  assert.deepEqual(Object.keys(teammate).sort(), ["firstName", "id", "lastName", "reps"]);
  assert.deepEqual(teammate.reps, [
    { id: "r2", repType: "side_kick", strike_foot: "left", velocity: 25.2, createdAtMillis: 2000 },
    { id: "r3", repType: "changeOfDirection", totalTime: 4.2, phase1Time: 1.1, phase2Time: 2, phase3Time: 1.1 },
  ]);
  assert.deepEqual(result.athletes[0].reps[0], { id: "r1", repType: "sprint", max_velocity: 8.1, createdAtMillis: 1000 });
  assert.ok(!JSON.stringify(result).includes("outsider"));
  assert.ok(!JSON.stringify(result).includes("private@example.test"));
});

test("roster resolves through coachUID and members when no coachDocId is stored", async () => {
  const db = new FakeFirestore({
    ...seed,
    "players/me": { firstName: "Ada", lastName: "Smith", userUID: "athlete", coachUID: "coach" },
    "coaches/coach": { userUID: "coach", members: ["me"] },
  });
  const { getTeamLeaderboard } = createTeamLeaderboard({ db, HttpsError });
  assert.equal((await getTeamLeaderboard({ uid: "athlete" })).coachId, "coach");
  const membersOnly = new FakeFirestore({ ...seed, "players/me": { firstName: "Ada", lastName: "Smith", userUID: "athlete" } });
  assert.equal((await createTeamLeaderboard({ db: membersOnly, HttpsError }).getTeamLeaderboard({ uid: "athlete" })).coachId, "legacy-doc");
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
