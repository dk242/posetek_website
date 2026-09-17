const assert = require("node:assert/strict");
const { test } = require("node:test");
const { FakeFirestore, FakeTimestamp, HttpsError } = require("./test-support/fake-firestore");
const { createClubInsights, summarizePlayer, weekStart, weekWindow } = require("./club-insights");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 19, 15);
const THIS_WEEK = Date.UTC(2026, 8, 14);
const at = (millis) => FakeTimestamp.fromMillis(millis);

const seed = {
  "teams/a": { organizationId: "club", name: "U15 Blue" },
  "teams/b": { organizationId: "club", name: "U17 Red" },
  "teams/foreign": { organizationId: "elsewhere", name: "Other" },
  "organizations/club/members/manager": { userUID: "manager", role: "manager", teamIds: [], status: "active" },
  "organizations/club/members/coach-a": { userUID: "coach-a", role: "coach", teamIds: ["a"], status: "active" },
  "organizations/club/members/coach-b": { userUID: "coach-b", role: "coach", teamIds: ["b"], status: "active" },
  "organizations/club/members/retired": { userUID: "retired", role: "coach", teamIds: ["a"], status: "inactive" },
  "organizations/elsewhere/members/outsider": { userUID: "outsider", role: "manager", teamIds: [], status: "active" },
  "players/zoe": { firstName: "Zoe", lastName: "Park", organizationId: "club", teamId: "a", signupEmail: "zoe@example.test", authenticationUID: "zoe-auth" },
  "players/zoe/reps/r1": { repType: "sprint", max_velocity: 7.5, createdAt: at(THIS_WEEK - 7 * DAY + DAY), storagePath: "zoe/sprint/session1/kick1" },
  "players/zoe/reps/r2": { repType: "sprint", max_velocity: 8.2, createdAt: at(THIS_WEEK + DAY) },
  "players/zoe/reps/r3": { repType: "sprint", max_velocity: 7.9, createdAt: at(THIS_WEEK + 2 * DAY) },
  "players/zoe/reps/r4": { repType: "dribbling", totalTime: 6.4, createdAt: at(THIS_WEEK + DAY) },
  "players/zoe/reps/r5": { repType: "dribbling", totalTime: 5.9, createdAt: at(THIS_WEEK + 3 * DAY) },
  "players/zoe/reps/r6": { repType: "sprint", max_velocity: 8.8 },
  "players/ada": { firstName: "Ada", lastName: "Stone", organizationId: "club", teamId: "a" },
  "players/ben": { firstName: "Ben", lastName: "Ruiz", organizationId: "club", teamId: "b" },
  "players/ben/reps/r7": { repType: "sprint", max_velocity: 9.9, createdAt: at(THIS_WEEK + DAY) },
};

function service(extra = {}, options = {}) {
  const db = new FakeFirestore({ ...seed, ...extra });
  return createClubInsights({ db, HttpsError, now: () => NOW, ...options });
}

test("weeks are UTC Monday buckets ending with the current week", () => {
  assert.equal(weekStart(NOW), THIS_WEEK);
  assert.equal(weekStart(THIS_WEEK), THIS_WEEK);
  assert.equal(weekStart(THIS_WEEK - 1), THIS_WEEK - 7 * DAY);
  assert.deepEqual(weekWindow(NOW, 3), [THIS_WEEK - 14 * DAY, THIS_WEEK - 7 * DAY, THIS_WEEK]);
});

test("assigned coach gets weekly counts and best-per-week metrics for their team only", async () => {
  const result = await service().getClubInsights({ organizationId: "club", teamId: "a", weeks: 2 }, { uid: "coach-a" });
  assert.equal(result.teamName, "U15 Blue");
  assert.equal(result.rosterTruncated, false);
  assert.deepEqual(result.weeks, [THIS_WEEK - 7 * DAY, THIS_WEEK]);
  assert.deepEqual(result.players.map((player) => player.id), ["ada", "zoe"]);
  const zoe = result.players[1];
  assert.deepEqual(zoe.weeklyReps, [1, 4]);
  assert.deepEqual(zoe.drillCounts, { sprint: 3, dribbling: 2 });
  assert.equal(zoe.undatedReps, 1);
  assert.equal(zoe.lastActiveMillis, THIS_WEEK + 3 * DAY);
  assert.deepEqual(zoe.metrics, [
    { drill: "dribbling", field: "totalTime", lowerIsBetter: true, weeklyBest: [null, 5.9] },
    { drill: "sprint", field: "max_velocity", lowerIsBetter: false, weeklyBest: [7.5, 8.2] },
  ]);
  assert.deepEqual(result.players[0], { id: "ada", firstName: "Ada", lastName: "Stone", lastActiveMillis: null, undatedReps: 0, weeklyReps: [0, 0], drillCounts: {}, metrics: [] });
  const text = JSON.stringify(result);
  for (const leaked of ["ben", "zoe@example.test", "zoe-auth", "storagePath", "session1"]) assert.ok(!text.includes(leaked), leaked);
});

test("managers see any team in their club and verified PoseTek admins see any club", async () => {
  const insights = service();
  assert.equal((await insights.getClubInsights({ organizationId: "club", teamId: "b" }, { uid: "manager" })).players[0].id, "ben");
  const admin = await insights.getClubInsights({ organizationId: "club", teamId: "b" }, { uid: "staff", email: "staff@posetek.net", emailVerified: true });
  assert.equal(admin.weeks.length, 8);
});

test("callers without access to the team are refused", async () => {
  const insights = service({ "players/p": { firstName: "P", organizationId: "club", teamId: "a", authenticationUID: "player-auth" } });
  const request = { organizationId: "club", teamId: "a" };
  await assert.rejects(insights.getClubInsights(request, { uid: "coach-b" }), { code: "permission-denied" });
  await assert.rejects(insights.getClubInsights(request, { uid: "retired" }), { code: "permission-denied" });
  await assert.rejects(insights.getClubInsights(request, { uid: "outsider" }), { code: "permission-denied" });
  await assert.rejects(insights.getClubInsights(request, { uid: "player-auth" }), { code: "permission-denied" });
  await assert.rejects(insights.getClubInsights(request, { uid: "staff", email: "staff@posetek.net", emailVerified: false }), { code: "permission-denied" });
  await assert.rejects(insights.getClubInsights(request, { uid: "" }), { code: "unauthenticated" });
});

test("mismatched teams and malformed input are rejected", async () => {
  const insights = service();
  await assert.rejects(insights.getClubInsights({ organizationId: "club", teamId: "foreign" }, { uid: "manager" }), { code: "not-found" });
  await assert.rejects(insights.getClubInsights({ organizationId: "club", teamId: "missing" }, { uid: "manager" }), { code: "not-found" });
  await assert.rejects(insights.getClubInsights({ organizationId: "club", teamId: "a/b" }, { uid: "manager" }), { code: "invalid-argument" });
  for (const weeks of [0, 27, 2.5, "8"]) {
    await assert.rejects(insights.getClubInsights({ organizationId: "club", teamId: "a", weeks }, { uid: "manager" }), { code: "invalid-argument" });
  }
});

test("series never mix metric fields, and shooting aliases share one drill", () => {
  const weeks = [THIS_WEEK];
  const summary = summarizePlayer([
    { repType: "jump", jump_height_m: 0.42, createdAt: at(THIS_WEEK + DAY) },
    { repType: "jump", jump_height_in: 17, createdAt: at(THIS_WEEK + DAY) },
    { repType: "side_kick", velocity: 20, createdAt: at(THIS_WEEK + DAY) },
    { repType: "deadballShot", velocity: 24, createdAt: at(THIS_WEEK + DAY) },
    { repType: "sprint", max_velocity: "9", createdAt: at(THIS_WEEK + DAY) },
    { repType: "freeRecord", createdAt: at(THIS_WEEK + DAY) },
    { repType: "../../etc", createdAt: at(THIS_WEEK + DAY) },
    { repType: "__proto__", createdAt: at(THIS_WEEK + DAY) },
    { repType: "constructor", createdAt: at(THIS_WEEK + DAY) },
  ], weeks, NOW);
  assert.deepEqual(summary.drillCounts, { jump: 2, shooting: 2, sprint: 1, freeRecord: 1, unknown: 3 });
  assert.deepEqual(summary.metrics.map((metric) => [metric.drill, metric.field, metric.weeklyBest[0]]), [
    ["jump", "jump_height_in", 17],
    ["jump", "jump_height_m", 0.42],
    ["shooting", "velocity", 24],
  ]);
});

test("last active is rounded to the UTC day and never later than now", () => {
  const weeks = [THIS_WEEK];
  assert.equal(summarizePlayer([{ repType: "sprint", createdAt: at(THIS_WEEK + DAY + 5 * 3600 * 1000) }], weeks, NOW).lastActiveMillis, THIS_WEEK + DAY);
  assert.equal(summarizePlayer([{ repType: "sprint", createdAt: at(NOW + 30 * DAY) }], weeks, NOW).lastActiveMillis, Date.UTC(2026, 8, 19));
});

test("an oversized roster is capped and flagged rather than silently cut", async () => {
  const result = await service({}, { maxRoster: 1 }).getClubInsights({ organizationId: "club", teamId: "a" }, { uid: "coach-a" });
  assert.equal(result.players.length, 1);
  assert.equal(result.rosterTruncated, true);
});
