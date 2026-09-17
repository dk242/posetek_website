const assert = require("node:assert/strict");
const { test } = require("node:test");
const { FakeFirestore, FakeTimestamp, HttpsError } = require("./test-support/fake-firestore");
const { createClubInsights, summarizePlayer, weekStart, weekWindow } = require("./club-insights");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 19, 15);
const THIS_WEEK = Date.UTC(2026, 8, 14);
const at = (millis) => FakeTimestamp.fromMillis(millis);

const seed = {
  "organizations/club": { schemaVersion: 2, name: "Club" },
  "organizations/elsewhere": { schemaVersion: 2, name: "Other club" },
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
  assert.deepEqual(result.players[0], { id: "ada", firstName: "Ada", lastName: "Stone", repsTruncated: false, recordedDocumentsRead: 0, lastActiveMillis: null, undatedReps: 0, futureDatedReps: 0, weeklyReps: [0, 0], drillCounts: {}, metrics: [] });
  assert.equal(result.historyTruncated, false);
  assert.equal(result.recordedDocumentsRead, 6);
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

test("last active is rounded to the UTC day and future records are separately disclosed", () => {
  const weeks = [THIS_WEEK];
  assert.equal(summarizePlayer([{ repType: "sprint", createdAt: at(THIS_WEEK + DAY + 5 * 3600 * 1000) }], weeks, NOW).lastActiveMillis, THIS_WEEK + DAY);
  const future = summarizePlayer([
    { repType: "sprint", max_velocity: 50, createdAt: at(NOW + 30 * DAY) },
    { repType: "sprint", max_velocity: 50, createdAt: at(NOW + 1000) },
  ], weeks, NOW);
  assert.equal(future.lastActiveMillis, null);
  assert.equal(future.futureDatedReps, 2);
  assert.deepEqual(future.weeklyReps, [0]);
  assert.deepEqual(future.drillCounts, {});
  assert.deepEqual(future.metrics, []);
});

test("an oversized roster is capped and flagged rather than silently cut", async () => {
  const result = await service({}, { maxRoster: 1 }).getClubInsights({ organizationId: "club", teamId: "a" }, { uid: "coach-a" });
  assert.equal(result.players.length, 1);
  assert.equal(result.rosterTruncated, true);
});

test("activity counts documents while invalid, failed and pending results cannot become progress bests", () => {
  const make = (extra) => ({ repType: "sprint", max_velocity: 50, createdAt: at(THIS_WEEK + DAY), ...extra });
  const result = summarizePlayer([
    make({ max_velocity: 7, processingStatus: "complete", resultsValid: true }),
    make({ resultsValid: false }),
    make({ resultsValid: "true" }),
    make({ processingStatus: "failed" }),
    make({ processingStatus: "pending" }),
    make({ processingStatus: "partial" }),
    make({ failedSteps: ["tracking"] }),
    make({ max_velocity: Infinity }),
    make({ max_velocity: -1 }),
    make({ max_velocity: 0 }),
    make({ max_velocity: "20" }),
    // A server-accepted manual revision already writes corrected root fields.
    make({ max_velocity: 8, adminRevision: { revisionId: "accepted", method: "manual_annotation" } }),
  ], [THIS_WEEK], NOW);
  assert.deepEqual(result.weeklyReps, [12]);
  assert.deepEqual(result.drillCounts, { sprint: 12 });
  assert.deepEqual(result.metrics, [{ drill: "sprint", field: "max_velocity", lowerIsBetter: false, weeklyBest: [8] }]);
  assert.ok(!JSON.stringify(result).includes("adminRevision"));
});

test("malformed timestamp shapes are counted as undated without crashing a team report", () => {
  const result = summarizePlayer([
    { createdAt: { toMillis: "not callable" } },
    { createdAt: { toMillis() { throw new Error("bad timestamp"); } } },
    { createdAt: { toMillis: () => Infinity } },
    { createdAt: { toMillis: () => 9e20 } },
    { createdAt: "2026-09-16" },
  ], [THIS_WEEK], NOW);
  assert.equal(result.undatedReps, 5);
  assert.equal(result.lastActiveMillis, null);
  assert.deepEqual(result.weeklyReps, [0]);
});

test("legacy roster mirrors, malformed memberships, and anonymous callers cannot grant team access", async () => {
  const request = { organizationId: "club", teamId: "a" };
  const legacy = service({ "coaches/legacy": { userUID: "legacy", organizationId: "club", members: ["zoe"], teamIds: ["a"] } });
  await assert.rejects(legacy.getClubInsights(request, { uid: "legacy" }), { code: "permission-denied" });
  for (const member of [
    { userUID: "another", role: "manager", teamIds: [], status: "active" },
    { userUID: "coach-a", role: "manager", teamIds: [4], status: "active" },
    { userUID: "coach-a", role: "coach", teamIds: ["a", "bad/path"], status: "active" },
    { userUID: "coach-a", role: "manager", teamIds: "a", status: "active" },
  ]) await assert.rejects(service({ "organizations/club/members/coach-a": member }).getClubInsights(request, { uid: "coach-a" }), { code: "permission-denied" });
  await assert.rejects(service().getClubInsights(request, { uid: "manager", isAnonymous: true }), { code: "unauthenticated" });
  await assert.rejects(service().getClubInsights(request, { uid: "admin", email: "staff@posetek.net", emailVerified: true, isAnonymous: true }), { code: "unauthenticated" });
});

test("canonical player ownership excludes stale team projections and legacy identities", async () => {
  const result = await service({
    "teams/a": { organizationId: "club", name: "A", playerIds: ["legacy", "moved"] },
    "players/legacy": { firstName: "Legacy", organizationCode: "club", team: "a", coachUID: "coach-a" },
    "players/moved": { firstName: "Moved", organizationId: "elsewhere", teamId: "a", coachUID: "coach-a" },
  }).getClubInsights({ organizationId: "club", teamId: "a" }, { uid: "coach-a" });
  assert.deepEqual(result.players.map(player => player.id), ["ada", "zoe"]);
});

test("revoked or reassigned membership and deleted organizations/teams abort after history reads", async () => {
  for (const change of ["revoked", "reassigned", "deleted-team", "moved-team", "deleted-organization"]) {
    const db = new FakeFirestore(seed);
    const transaction = db.runTransaction.bind(db);
    db.runTransaction = (callback, options) => {
      assert.deepEqual(options, { readOnly: true });
      assert.ok(db.queries.some(query => query.path.endsWith("/reps")));
      if (change === "revoked") db.docs.delete("organizations/club/members/coach-a");
      if (change === "reassigned") db.docs.set("organizations/club/members/coach-a", { userUID: "coach-a", role: "coach", teamIds: ["b"], status: "active" });
      if (change === "deleted-team") db.docs.delete("teams/a");
      if (change === "moved-team") db.docs.set("teams/a", { organizationId: "elsewhere", name: "Moved" });
      if (change === "deleted-organization") db.docs.delete("organizations/club");
      return transaction(callback, options);
    };
    await assert.rejects(createClubInsights({ db, HttpsError, now: () => NOW }).getClubInsights({ organizationId: "club", teamId: "a" }, { uid: "coach-a" }), { code: change === "revoked" || change === "reassigned" ? "permission-denied" : "not-found" });
  }
});

test("players transferred or deleted during aggregation are omitted and current names are returned", async () => {
  const db = new FakeFirestore(seed);
  const transaction = db.runTransaction.bind(db);
  db.runTransaction = (callback, options) => {
    db.docs.set("players/zoe", { firstName: "Now private", organizationId: "elsewhere", teamId: "foreign" });
    db.docs.set("players/ada", { firstName: "Current name", organizationId: "club", teamId: "a" });
    return transaction(callback, options);
  };
  db.write = () => { throw new Error("Insights must never write"); };
  const result = await createClubInsights({ db, HttpsError, now: () => NOW }).getClubInsights({ organizationId: "club", teamId: "a" }, { uid: "manager" });
  assert.deepEqual(result.players.map(player => [player.id, player.firstName]), [["ada", "Current name"]]);
  assert.ok(!JSON.stringify(result).includes("zoe"));
  assert.equal(result.recordedDocumentsRead, 0);
});

function instrumentReads(db, onGet) {
  const collection = db.collection.bind(db);
  const wrap = value => new Proxy(value, { get(target, key) {
    if (key === "get") return () => onGet(target, () => target.get());
    if (typeof target[key] !== "function") return target[key];
    return (...args) => {
      const next = target[key](...args);
      return next && typeof next.get === "function" ? wrap(next) : next;
    };
  } });
  db.collection = name => wrap(collection(name));
}

test("history scans have deterministic per-player and total bounds with explicit incomplete flags", async () => {
  const db = new FakeFirestore({ ...seed, "players/zoe/reps/r0": { repType: "jump" },
    "players/ada/reps/r1": { repType: "sprint", max_velocity: 6, createdAt: at(THIS_WEEK) } });
  const queries = [];
  instrumentReads(db, (target, get) => {
    if (target.path.endsWith("/reps")) queries.push({ max: target.max, orders: target.orders });
    return get();
  });
  const result = await createClubInsights({ db, HttpsError, now: () => NOW, maxRoster: 2, maxRepDocuments: 3, maxTotalRepDocuments: 4 }).getClubInsights({ organizationId: "club", teamId: "a" }, { uid: "coach-a" });
  assert.equal(result.repLimitPerPlayer, 2);
  assert.equal(result.historyTruncated, true);
  assert.equal(result.recordedDocumentsRead, 3);
  assert.deepEqual(queries, [{ max: 3, orders: [["__name__", "asc"]] }, { max: 3, orders: [["__name__", "asc"]] }]);
  const zoe = result.players.find(player => player.id === "zoe");
  assert.equal(zoe.recordedDocumentsRead, 2);
  assert.equal(zoe.repsTruncated, true);
  assert.equal(zoe.undatedReps, 1);
  assert.equal(result.players.find(player => player.id === "ada").repsTruncated, false);
});

test("player history reads respect concurrency and propagate unavailable data rather than returning zero", async () => {
  const db = new FakeFirestore(seed);
  let active = 0, peak = 0;
  instrumentReads(db, async (target, get) => {
    if (!target.path.endsWith("/reps")) return get();
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    try { return await get(); } finally { active--; }
  });
  await createClubInsights({ db, HttpsError, now: () => NOW, readConcurrency: 1 }).getClubInsights({ organizationId: "club", teamId: "a" }, { uid: "manager" });
  assert.equal(peak, 1);
  const failedDb = new FakeFirestore(seed);
  instrumentReads(failedDb, (target, get) => {
    if (target.path.endsWith("/reps")) throw new Error("Firestore unavailable");
    return get();
  });
  await assert.rejects(createClubInsights({ db: failedDb, HttpsError }).getClubInsights({ organizationId: "club", teamId: "a" }, { uid: "manager" }), /Firestore unavailable/);
});
