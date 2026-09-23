"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeFirestore, FakeTimestamp, FieldValue, HttpsError } = require("./test-support/fake-firestore");
const {
  createTestingEvents,
  STATIONS,
  INVITE_TTL_MS,
  REPS_PER_PARTICIPANT,
  RESERVATIONS_PER_PARTICIPANT,
} = require("./testing-events");

const base = {
  "organizations/club": { schemaVersion: 2, name: "Test Club", memberUIDs: ["manager", "coach-a", "coach-b"] },
  "organizations/club/members/manager": { userUID: "manager", role: "manager", status: "active", teamIds: [] },
  "organizations/club/members/coach-a": { userUID: "coach-a", role: "coach", status: "active", teamIds: ["team-a"] },
  "organizations/club/members/coach-b": { userUID: "coach-b", role: "coach", status: "active", teamIds: ["team-b"] },
  "players/player-a": { organizationId: "club", teamId: "team-a", firstName: "Alex", lastName: "One", weight: 70 },
  "players/player-b": { organizationId: "club", teamId: "team-a", firstName: "Blair", lastName: "Two", weight: 61.5 },
  "players/player-c": { organizationId: "club", teamId: "team-b", firstName: "Casey", lastName: "Three", weight: 80 },
};

const auth = (uid, email = `${uid}@example.test`) => ({ uid, email, emailVerified: true, isAnonymous: false });
const admin = auth("admin", "admin@posetek.net");

function harness(seed = {}, clock = { value: 1000 }, overrides = {}) {
  const db = new FakeFirestore({ ...base, ...seed });
  const finalized = [];
  const testing = createTestingEvents({
    db,
    FieldValue,
    Timestamp: FakeTimestamp,
    HttpsError,
    now: () => clock.value,
    randomBytes: () => Buffer.alloc(24, 7),
    finalizePlayer: async (playerId) => { finalized.push(playerId); },
    ...overrides,
  });
  return { db, testing, clock, finalized };
}

async function draft(testing, playerIds = ["player-a", "player-b"], actor = auth("manager")) {
  return testing.createTestingEvent({ organizationId: "club", name: "Fall testing", playerIds }, actor);
}

test("fixed protocol is three stations and exactly twenty reps", () => {
  assert.equal(STATIONS.length, 3);
  assert.equal(REPS_PER_PARTICIPANT, 20);
  assert.equal(RESERVATIONS_PER_PARTICIPANT, 6);
  assert.deepEqual(STATIONS[1].drills[1].sides, ["left", "left", "right", "right"]);
  assert.deepEqual(STATIONS[2].drills[2].sides, ["left", "left", "right", "right"]);
});

test("manager creates immutable event snapshots and participant readiness", async () => {
  const { db, testing } = harness();
  const result = await draft(testing);
  assert.equal(result.status, "draft");
  const event = db.snapshot(`testingEvents/${result.eventId}`);
  assert.equal(event.ownerUid, "manager");
  assert.equal(event.repsPerParticipant, 20);
  assert.deepEqual(event.teamIds, ["team-a"]);
  assert.equal(event.protocolSnapshot.length, 3);
  assert.equal(db.snapshot(`testingEvents/${result.eventId}/participants/player-a`).weightKg, 70);
  assert.equal(db.snapshot(`testingEvents/${result.eventId}/stations/station-3`).markerCount, 2);
});

test("coach cannot include another team's player or forge organization access", async () => {
  const { testing } = harness();
  await assert.rejects(draft(testing, ["player-a", "player-c"], auth("coach-a")), { code: "permission-denied" });
  await assert.rejects(testing.createTestingEvent({ organizationId: "elsewhere", name: "No", playerIds: ["player-a"] }, auth("manager")), { code: "not-found" });
  const allowed = await draft(testing, ["player-a"], auth("coach-a"));
  assert.equal(allowed.participantCount, 1);
});

test("start proceeds without weight and keeps the missing status on the snapshot", async () => {
  const { db, testing } = harness({ "players/player-a": { ...base["players/player-a"], weight: null } });
  const event = await draft(testing, ["player-a"]);
  await testing.startTestingEvent({ eventId: event.eventId }, auth("manager"));
  assert.equal(db.snapshot(`testingEvents/${event.eventId}`).status, "live");
  const participant = db.snapshot(`testingEvents/${event.eventId}/participants/player-a`);
  assert.equal(participant.weightKg, null);
  assert.equal(participant.weightStatus, "missing");
  assert.notEqual(db.snapshot(`players/player-a/sessions/testing_${event.eventId}_station-1_jump`), undefined);
});

test("start refreshes weight from the canonical player after setup", async () => {
  const { db, testing } = harness({ "players/player-a": { ...base["players/player-a"], weight: null } });
  const event = await draft(testing, ["player-a"]);
  db.write("players/player-a", { weight: 72 }, { merge: true, create: false });
  await testing.startTestingEvent({ eventId: event.eventId }, auth("manager"));
  assert.equal(db.snapshot(`testingEvents/${event.eventId}/participants/player-a`).weightKg, 72);
  assert.equal(db.snapshot(`testingEvents/${event.eventId}`).status, "live");
});

test("start reserves deterministic sessions and absolute ranges exactly once", async () => {
  const { db, testing } = harness({
    "players/player-a/sessions/old-jump": { sessionType: "jump", sessionNumber: 4 },
    "players/player-a/reps/old-jump": { repType: "jump", absoluteRepNumber: 9 },
  });
  const event = await draft(testing, ["player-a"]);
  const started = await testing.startTestingEvent({ eventId: event.eventId }, auth("manager"));
  assert.equal(started.reservationCount, RESERVATIONS_PER_PARTICIPANT);
  assert.equal(db.snapshot(`testingEvents/${event.eventId}`).status, "live");
  const jump = db.snapshot(`testingEvents/${event.eventId}/sessionReservations/station-1_player-a_jump`);
  assert.equal(jump.sessionNumber, 5);
  assert.equal(jump.absoluteRepStart, 10);
  assert.equal(jump.repCount, 3);
  assert.equal(db.snapshot(`players/player-a/sessions/${jump.sessionDocId}`).testingEventId, event.eventId);
  const counterBefore = db.snapshot("players/player-a/recordingCounters/jump");
  const retried = await testing.startTestingEvent({ eventId: event.eventId }, auth("manager"));
  assert.equal(retried.reservationCount, RESERVATIONS_PER_PARTICIPANT);
  assert.deepEqual(db.snapshot("players/player-a/recordingCounters/jump"), counterBefore);
});

test("start advances past legacy Storage session folders", async () => {
  const inspected = [];
  const { db, testing } = harness({}, { value: 1000 }, {
    storageSessionFloors: async (playerId) => {
      inspected.push(playerId);
      return { jump: 8 };
    },
  });
  const event = await draft(testing, ["player-a"]);
  await testing.startTestingEvent({ eventId: event.eventId }, auth("manager"));
  const jump = db.snapshot(`testingEvents/${event.eventId}/sessionReservations/station-1_player-a_jump`);
  assert.equal(jump.sessionNumber, 9);
  assert.deepEqual(inspected, ["player-a"]);
});

test("thirty-athlete pilot reserves the full 600-rep event shape", async () => {
  const playerIds = Array.from({ length: 30 }, (_, index) => `pilot-${String(index + 1).padStart(2, "0")}`);
  const players = Object.fromEntries(playerIds.map((playerId, index) => [
    `players/${playerId}`,
    { organizationId: "club", teamId: "team-a", firstName: `Pilot ${index + 1}`, weight: 60 + index },
  ]));
  const storageReads = [];
  const { db, testing } = harness(players, { value: 1000 }, {
    storageSessionFloors: async (playerId) => { storageReads.push(playerId); return {}; },
  });
  const event = await draft(testing, playerIds);
  const started = await testing.startTestingEvent({ eventId: event.eventId }, auth("manager"));
  const reservationPrefix = `testingEvents/${event.eventId}/sessionReservations/`;
  const sessionCount = [...db.docs.keys()].filter((path) => /^players\/pilot-\d+\/sessions\/testing_/.test(path)).length;
  assert.equal(started.reservationCount, 30 * RESERVATIONS_PER_PARTICIPANT);
  assert.equal([...db.docs.keys()].filter((path) => path.startsWith(reservationPrefix)).length, 180);
  assert.equal(sessionCount, 180);
  assert.equal(db.snapshot(`testingEvents/${event.eventId}`).repsPerParticipant * 30, 600);
  assert.equal(new Set(storageReads).size, 30);
});

test("invite contains no stored secret, enforces roster authority, and is single-use", async () => {
  const { db, testing } = harness();
  const event = await draft(testing, ["player-a"]);
  const invite = await testing.createTestingEventInvite({ eventId: event.eventId }, auth("manager"));
  assert.match(invite.code, /^TEST-[A-Za-z0-9_-]{32}$/);
  assert.ok(!JSON.stringify([...db.docs.values()]).includes(invite.code));
  await assert.rejects(testing.joinTestingEvent({ code: invite.code }, auth("coach-b")), { code: "permission-denied" });
  const joined = await testing.joinTestingEvent({ code: invite.code }, auth("coach-a"));
  assert.equal(joined.eventId, event.eventId);
  assert.deepEqual(db.snapshot(`testingEvents/${event.eventId}`).operatorUids.sort(), ["coach-a", "manager"]);
  await assert.rejects(testing.joinTestingEvent({ code: invite.code }, auth("coach-a")), { code: "not-found" });
});

test("expired invite cannot be consumed", async () => {
  const { testing, clock } = harness();
  const event = await draft(testing, ["player-a"]);
  const invite = await testing.createTestingEventInvite({ eventId: event.eventId }, auth("manager"));
  clock.value += INVITE_TTL_MS + 1;
  await assert.rejects(testing.joinTestingEvent({ code: invite.code }, auth("coach-a")), { code: "not-found" });
});

test("station lease rejects a competing phone and permits manager takeover", async () => {
  const { testing } = harness();
  const event = await draft(testing, ["player-a"]);
  await testing.startTestingEvent({ eventId: event.eventId }, auth("manager"));
  const first = await testing.claimTestingStation({ eventId: event.eventId, stationId: "station-1", deviceId: "phone-a" }, auth("manager"));
  assert.equal(first.stationId, "station-1");
  await assert.rejects(testing.claimTestingStation({ eventId: event.eventId, stationId: "station-1", deviceId: "phone-b" }, admin), { code: "already-exists" });
  const taken = await testing.takeOverTestingStation({ eventId: event.eventId, stationId: "station-1", deviceId: "phone-b" }, admin);
  assert.equal(taken.deviceId, "phone-b");
  await assert.rejects(testing.renewTestingStationLease({ eventId: event.eventId, stationId: "station-1", deviceId: "phone-a" }, auth("manager")), { code: "failed-precondition" });
});

test("station calibration reset is versioned and restricted to the active station device", async () => {
  const { db, testing } = harness();
  const event = await draft(testing, ["player-a"]);
  await testing.startTestingEvent({ eventId: event.eventId }, auth("manager"));
  await testing.claimTestingStation({ eventId: event.eventId, stationId: "station-2", deviceId: "phone-a" }, auth("manager"));
  const reset = await testing.resetTestingStationCalibration({ eventId: event.eventId, stationId: "station-2", deviceId: "phone-a" }, auth("manager"));
  assert.equal(reset.setupVersion, 2);
  assert.equal(db.snapshot(`testingEvents/${event.eventId}/stations/station-2`).setupVersion, 2);
  await assert.rejects(
    testing.resetTestingStationCalibration({ eventId: event.eventId, stationId: "station-2", deviceId: "phone-b" }, auth("manager")),
    { code: "failed-precondition" }
  );
  await assert.rejects(
    testing.resetTestingStationCalibration({ eventId: event.eventId, stationId: "station-1", deviceId: "phone-a" }, auth("manager")),
    { code: "invalid-argument" }
  );
});

test("revoked event operator immediately loses callable access", async () => {
  const { db, testing } = harness();
  const event = await draft(testing, ["player-a"], auth("coach-a"));
  db.write("organizations/club/members/coach-a", { status: "revoked" }, { merge: true, create: false });
  await assert.rejects(testing.startTestingEvent({ eventId: event.eventId }, auth("coach-a")), { code: "permission-denied" });
});

test("close reports incomplete progress and closes only after all stations sync", async () => {
  const { db, testing } = harness();
  const event = await draft(testing, ["player-a"]);
  await testing.startTestingEvent({ eventId: event.eventId }, auth("manager"));
  let readiness = await testing.closeTestingEvent({ eventId: event.eventId }, auth("manager"));
  assert.equal(readiness.ready, false);
  assert.equal(readiness.missing, 3);
  for (const station of STATIONS) db.write(`testingEvents/${event.eventId}/progress/${station.id}_player-a`, {
    stationId: station.id, playerDocId: "player-a", status: "completed",
  }, { merge: false, create: false });
  readiness = await testing.closeTestingEvent({ eventId: event.eventId }, auth("manager"));
  assert.equal(readiness.ready, true);
  assert.equal(readiness.status, "closed");
  assert.equal(db.snapshot(`testingEvents/${event.eventId}`).status, "closed");
});

test("rep commits reconcile pending progress and coalesce player projections", async () => {
  const eventId = "event-sync";
  const progressRows = Object.fromEntries(STATIONS.map((station) => [
    `testingEvents/${eventId}/progress/${station.id}_player-a`,
    {
      stationId: station.id,
      playerDocId: "player-a",
      status: "completedPendingSync",
      repIds: [`${station.id}-rep`],
      pendingUploadCount: 1,
    },
  ]));
  const { db, testing, finalized } = harness({
    [`testingEvents/${eventId}`]: { ...base["organizations/club"], organizationId: "club", operatorUids: ["manager"], status: "live" },
    ...progressRows,
  });
  for (const station of STATIONS) {
    const repId = `${station.id}-rep`;
    const data = { testingEventId: eventId, testingStationId: station.id, testingParticipantId: "player-a" };
    await testing.onRepWrite({ before: { data: () => undefined }, after: { data: () => data } }, { params: { playerId: "player-a", repId } });
  }
  assert.deepEqual(finalized, ["player-a"]);
  for (const station of STATIONS) {
    const progress = db.snapshot(`testingEvents/${eventId}/progress/${station.id}_player-a`);
    assert.equal(progress.status, "completed");
    assert.equal(progress.pendingUploadCount, 0);
  }
  assert.equal(db.snapshot(`testingEvents/${eventId}/projectionDirty/player-a`).revision, 3);
  assert.equal(db.snapshot(`testingEvents/${eventId}/projectionFinalizations/player-a`).status, "completed");
});

test("progress written after an early rep commit still reconciles", async () => {
  const eventId = "event-race";
  const { db, testing } = harness({
    [`testingEvents/${eventId}`]: { organizationId: "club", operatorUids: ["manager"], status: "live" },
  });
  const data = { testingEventId: eventId, testingStationId: "station-1", testingParticipantId: "player-a" };
  await testing.onRepWrite({ before: { data: () => undefined }, after: { data: () => data } }, { params: { playerId: "player-a", repId: "rep-early" } });
  db.write(`testingEvents/${eventId}/progress/station-1_player-a`, {
    stationId: "station-1", playerDocId: "player-a", status: "completedPendingSync", repIds: ["rep-early"], pendingUploadCount: 1,
  }, { merge: false, create: false });
  await testing.onProgressWrite({ after: { data: () => db.snapshot(`testingEvents/${eventId}/progress/station-1_player-a`) } }, { params: { eventId, progressId: "station-1_player-a" } });
  assert.equal(db.snapshot(`testingEvents/${eventId}/progress/station-1_player-a`).status, "completed");
});

test("a committed rep repairs station progress after the app dies before its completion callback", async () => {
  const eventId = "event-recovery";
  const progressPath = `testingEvents/${eventId}/progress/station-1_player-a`;
  const { db, testing } = harness({
    [`testingEvents/${eventId}`]: { organizationId: "club", operatorUids: ["manager"], status: "live" },
    [progressPath]: {
      stationId: "station-1", playerDocId: "player-a", status: "inProgress",
      currentDrillIndex: 0, completedByDrill: {}, completedByProtocolSide: {},
      repIds: [], pendingUploadCount: 0, revision: 1, deviceId: "phone-a",
    },
  });
  const data = {
    testingEventId: eventId, testingStationId: "station-1", testingParticipantId: "player-a",
    testingDrillType: "jump", absoluteRepNumber: 1,
  };
  await testing.onRepWrite(
    { before: { data: () => undefined }, after: { data: () => data } },
    { params: { playerId: "player-a", repId: "recovered-rep" } }
  );
  const progress = db.snapshot(progressPath);
  assert.deepEqual(progress.repIds, ["recovered-rep"]);
  assert.equal(progress.completedByDrill.jump, 1);
  assert.equal(progress.pendingUploadCount, 0);
  assert.equal(progress.status, "inProgress");
});
