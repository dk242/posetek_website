// Allow/deny tests for the admin console's writes, against the Firestore
// emulator and the canonical PoseTek-mobile-app/firebase/firestore.rules.
// Run it with the other suites: `node scripts/run-rules-tests.mjs adminRules`
// (see app/rules-tests/README.md).
//
// The claims under test, in the order they appear below:
//   1. admin-ness comes from a VERIFIED @posetek.net token, nothing else
//   2. an admin may author the catalog and may never delete from it
//   3. a plan edit and its rationale record exist together or not at all
//   4. an admin may not touch athlete evidence, except staff test recording
//      of a rep into an existing athlete (2026-09-16)

import assert from "node:assert/strict";
import firebase from "firebase/compat/app";
import "firebase/compat/firestore";
import { firestoreEmulator } from "./canonicalRules.mjs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";

const PROJECT_ID = "demo-posetek-admin";

const ADMIN = { sub: "admin1", email: "nolan@posetek.net", email_verified: true };
const ADMIN_MIXED_CASE = { sub: "admin2", email: "Nolan@PoseTek.net", email_verified: true };
const ADMIN_UNVERIFIED = { sub: "admin3", email: "dylan@posetek.net", email_verified: false };
const LOOKALIKE = { sub: "evil1", email: "nolan@posetek.net.evil.com", email_verified: true };
const ATHLETE = { sub: "player1", email: "kid@example.com", email_verified: true };

const PLAYER_ID = "p1";
const PLAN_ID = "plan1";
// The catalog rule pins createdAt/updatedAt to request.time, which only a
// server timestamp satisfies; a client Date would be refused for that alone.
const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();

const V3_PLAN = {
  schemaVersion: 3,
  planId: PLAN_ID,
  playerId: PLAYER_ID,
  status: "active",
  planRevision: 1,
  startDate: "2026-09-07",
  timezone: "America/Los_Angeles",
  horizonWeeks: 1,
  weeks: [{ weekNumber: 1, workouts: [{ workoutId: "w1s1", order: 1, revision: 1, blocks: [] }] }],
};

const V2_DRILL = {
  schemaVersion: 2,
  drillId: "DRB-501",
  name: "Figure-8 dribble",
  domain: "dribbling",
  minAge: 8,
  maxAge: 18,
  difficultyLevel: 2,
  equipment: ["ball", "cones"],
  requiresPartner: false,
  howTo: { setup: "Two cones.", steps: ["Weave the ball around both cones."] },
  dose: { setsMin: 3, setsMax: 4, repsMin: 20, repsMax: 30, repUnit: "seconds" },
  maxFrequencyPerWeek: 2,
  coachComments: [],
  adaptiveLevers: [],
  status: "published",
  catalogVersion: "1.0.5",
};

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: firestoreEmulator(),
});

async function seed() {
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc(`players/${PLAYER_ID}`).set({ firstName: "Sam", lastName: "R", coachUID: "coach1" });
    await db.doc("coaches/coach1").set({ userUID: "coach1", members: [PLAYER_ID] });
    await db.doc(`players/${PLAYER_ID}/trainingPlans/${PLAN_ID}`).set(V3_PLAN);
    await db.doc(`players/${PLAYER_ID}/workoutSchedule/current`).set({
      schemaVersion: 1, revision: 4, updatedAt: new Date(),
    });
  });
}

const results = [];
async function check(name, run) {
  try {
    await run();
    results.push(["pass", name]);
  } catch (error) {
    results.push(["FAIL", `${name} — ${error.message}`]);
  }
}

await testEnv.clearFirestore();
await seed();

const admin = testEnv.authenticatedContext(ADMIN.sub, ADMIN).firestore();
const mixedCase = testEnv.authenticatedContext(ADMIN_MIXED_CASE.sub, ADMIN_MIXED_CASE).firestore();
const unverified = testEnv.authenticatedContext(ADMIN_UNVERIFIED.sub, ADMIN_UNVERIFIED).firestore();
const lookalike = testEnv.authenticatedContext(LOOKALIKE.sub, LOOKALIKE).firestore();
const athlete = testEnv.authenticatedContext(ATHLETE.sub, ATHLETE).firestore();

// 1 — the predicate ---------------------------------------------------------

await check("verified @posetek.net upserts its own admins/{uid}", () =>
  assertSucceeds(admin.doc(`admins/${ADMIN.sub}`).set({
    schemaVersion: 1, uid: ADMIN.sub, email: ADMIN.email, displayName: "Nolan",
  })));

await check("mixed-case @PoseTek.net is an admin too", () =>
  assertSucceeds(mixedCase.doc(`admins/${ADMIN_MIXED_CASE.sub}`).set({
    schemaVersion: 1, uid: ADMIN_MIXED_CASE.sub, email: ADMIN_MIXED_CASE.email.toLowerCase(), displayName: "Nolan",
  })));

await check("an UNVERIFIED @posetek.net address is not an admin", () =>
  assertFails(unverified.doc(`admins/${ADMIN_UNVERIFIED.sub}`).set({
    schemaVersion: 1, uid: ADMIN_UNVERIFIED.sub, email: ADMIN_UNVERIFIED.email, displayName: "Dylan",
  })));

await check("posetek.net.evil.com is not an admin", () =>
  assertFails(lookalike.doc(`admins/${LOOKALIKE.sub}`).set({
    schemaVersion: 1, uid: LOOKALIKE.sub, email: LOOKALIKE.email, displayName: "Nope",
  })));

await check("an admin cannot create someone else's admin record", () =>
  assertFails(admin.doc("admins/someone-else").set({
    schemaVersion: 1, uid: "someone-else", email: ADMIN.email, displayName: "Nope",
  })));

await check("an athlete cannot read another athlete's private coach note", () =>
  assertFails(athlete.doc(`players/${PLAYER_ID}/privateProfile/coachFeedback`).get()));

// 2 — the catalog -----------------------------------------------------------

await check("an admin creates a v2 drill", () =>
  assertSucceeds(admin.doc("drillCatalog/DRB-501").set({
    ...V2_DRILL,
    updatedBy: ADMIN.sub,
    createdAt: serverTime(),
    updatedAt: serverTime(),
  })));

await check("a non-admin cannot write the catalog", () =>
  assertFails(athlete.doc("drillCatalog/DRB-502").set({
    ...V2_DRILL, drillId: "DRB-502", updatedBy: ATHLETE.sub, createdAt: serverTime(), updatedAt: serverTime(),
  })));

await check("nobody deletes a drill — ids are permanent", () =>
  assertFails(admin.doc("drillCatalog/DRB-501").delete()));

await check("a drill whose id disagrees with its document id is refused", () =>
  assertFails(admin.doc("drillCatalog/DRB-503").set({
    ...V2_DRILL, drillId: "DRB-501", updatedBy: ADMIN.sub, createdAt: serverTime(), updatedAt: serverTime(),
  })));

// 3 — the plan edit and its rationale record --------------------------------

const adjustmentId = `${PLAN_ID}_r2`;
const editedWeeks = [{
  weekNumber: 1,
  workouts: [{ workoutId: "w1s1", order: 1, revision: 2, editedBy: "admin", blocks: [] }],
}];

function adjustment(overrides = {}) {
  return {
    schemaVersion: 1,
    planId: PLAN_ID,
    planSchemaVersion: 3,
    weekNumber: 1,
    workoutId: "w1s1",
    editor: { uid: ADMIN.sub, role: "admin", surface: "web" },
    baseRevision: 1,
    newRevision: 2,
    basePlanRevision: 1,
    newPlanRevision: 2,
    before: {},
    after: {},
    rationale: "Swapped a dribbling block for change of direction.",
    createdAt: new Date(),
    ...overrides,
  };
}

function planUpdate(batch, overrides = {}) {
  batch.update(admin.doc(`players/${PLAYER_ID}/trainingPlans/${PLAN_ID}`), {
    weeks: editedWeeks,
    planRevision: 2,
    lastEdit: { workoutId: "w1s1", revision: 2, editedBy: "admin", adjustmentId },
    updatedAt: new Date(),
    ...overrides,
  });
  batch.update(admin.doc(`players/${PLAYER_ID}/workoutSchedule/current`), {
    revision: 5, updatedAt: new Date(),
  });
}

await check("a plan update WITHOUT its adjustment record is refused", () => {
  const batch = admin.batch();
  planUpdate(batch);
  return assertFails(batch.commit());
});

await check("an adjustment record WITHOUT its plan update is refused", () =>
  assertFails(admin.doc(`players/${PLAYER_ID}/planAdjustments/${adjustmentId}`).set(adjustment())));

await check("an empty rationale is refused", () => {
  const batch = admin.batch();
  planUpdate(batch);
  batch.set(admin.doc(`players/${PLAYER_ID}/planAdjustments/${adjustmentId}`), adjustment({ rationale: "" }));
  return assertFails(batch.commit());
});

await check("direct plan and journal writes are refused; edits require server validation", () => {
  const batch = admin.batch();
  planUpdate(batch);
  batch.set(admin.doc(`players/${PLAYER_ID}/planAdjustments/${adjustmentId}`), adjustment());
  return assertFails(batch.commit());
});

await check("an adjustment record can never be rewritten", () =>
  assertFails(admin.doc(`players/${PLAYER_ID}/planAdjustments/${adjustmentId}`)
    .update({ rationale: "actually, something else" })));

await check("a non-admin cannot edit a plan", () =>
  assertFails(athlete.doc(`players/${PLAYER_ID}/trainingPlans/${PLAN_ID}`).update({ planRevision: 3 })));

// 4 — athlete evidence stays the athlete's ----------------------------------

await check("an admin cannot write a workout log", () =>
  assertFails(admin.doc(`players/${PLAYER_ID}/workoutLogs/${PLAN_ID}_w1s1`).set({
    schemaVersion: 2, planId: PLAN_ID, workoutId: "w1s1", workoutRevision: 1,
    workoutSnapshot: {}, source: "plan", blocks: [], startedAt: new Date(),
  })));

// Staff test recording (decided 2026-09-16, `adminRecorder` in the canonical
// rules): a verified admin may record a rep into an EXISTING athlete. The live
// ruleset before the cutover still denies this and the website revises reps
// through the adminReviseRep callable, so the canonical rules are wider here;
// confirm at the cutover publish (mobile GATEWAY_CONSOLIDATION plan §4.8).
await check("an admin records a rep into an existing athlete", () =>
  assertSucceeds(admin.doc(`players/${PLAYER_ID}/reps/r1`).set({ repType: "sprint" })));

await check("an admin cannot write a rep for a player that does not exist", () =>
  assertFails(admin.doc("players/no-such-player/reps/r1").set({ repType: "sprint" })));

await check("an unverified @posetek.net address cannot write a rep", () =>
  assertFails(unverified.doc(`players/${PLAYER_ID}/reps/r2`).set({ repType: "sprint" })));

await check("an admin CAN read the athlete's records", () =>
  assertSucceeds(admin.doc(`players/${PLAYER_ID}/trainingPlans/${PLAN_ID}`).get()));

// ---------------------------------------------------------------------------

await testEnv.cleanup();

for (const [status, name] of results) console.log(`${status.padEnd(4)} ${name}`);
const failures = results.filter(([status]) => status === "FAIL");
console.log(`\n${results.length - failures.length}/${results.length} passed`);
assert.equal(failures.length, 0, `${failures.length} rule expectations failed`);
