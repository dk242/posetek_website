const assert = require("node:assert/strict");
const { test } = require("node:test");
const { FakeFirestore, FieldValue, HttpsError } = require("./test-support/fake-firestore");
const { createAdmission, RATE_LIMIT } = require("./admission");

function harness(seed) {
  const db = new FakeFirestore(seed);
  const admission = createAdmission({ db, FieldValue, HttpsError, randomInt: () => 0 });
  return { db, admission };
}

const unclaimed = { firstName: "New", lastName: "Player", coachUID: "coach", coachDocId: "coach", registered: false, signupCode: "FRESH1", signupCodeVersion: 2 };

test("redeems a fresh unclaimed invitation once and binds both canonical UIDs", async () => {
  const { db, admission } = harness({ "players/p1": unclaimed });
  const result = await admission.redeemPlayerSignupCode({ uid: "athlete", email: "Athlete@Example.test", code: " fresh1 " });
  assert.equal(result.playerId, "p1");
  const player = db.snapshot("players/p1");
  assert.equal(player.authenticationUID, "athlete");
  assert.equal(player.userUID, "athlete");
  assert.equal(player.registered, true);
  assert.equal(player.email, "Athlete@Example.test");
  assert.equal(player.signupCode, undefined);
  assert.equal(player.signupCodeVersion, undefined);
  assert.equal(player.coachUID, "coach", "coach assignment is preserved");
  await assert.rejects(admission.redeemPlayerSignupCode({ uid: "second", code: "FRESH1" }), { code: "not-found" });
  await assert.rejects(admission.redeemPlayerSignupCode({ uid: "athlete", code: "FRESH1" }), { code: "already-exists" });
});

test("legacy, claimed, registered and reserved invitations are refused with one message", async () => {
  const { admission } = harness({
    "players/legacy": { ...unclaimed, signupCode: "OLD001", signupCodeVersion: undefined },
    "players/v1": { ...unclaimed, signupCode: "OLD002", signupCodeVersion: 1 },
    "players/claimed": { ...unclaimed, signupCode: "TAKEN1", userUID: "someone" },
    "players/registered": { ...unclaimed, signupCode: "REG001", registered: true },
    "players/diagnostics": { ...unclaimed, signupCode: "RESRV1" },
  });
  for (const code of ["OLD001", "OLD002", "TAKEN1", "REG001", "RESRV1", "NOPE"]) {
    await assert.rejects(admission.redeemPlayerSignupCode({ uid: "athlete", code }), { code: "not-found" });
  }
  await assert.rejects(admission.redeemPlayerSignupCode({ uid: "athlete", code: "bad code!" }), { code: "invalid-argument" });
  await assert.rejects(admission.redeemPlayerSignupCode({ uid: "", code: "FRESH1" }), { code: "unauthenticated" });
});

test("legacy code field is honored for fresh invitations and codes are matched case-insensitively", async () => {
  const { db, admission } = harness({ "players/quest": { ...unclaimed, signupCode: undefined, code: "PLRAB12" } });
  await admission.redeemPlayerSignupCode({ uid: "athlete", code: "plrab12" });
  assert.equal(db.snapshot("players/quest").userUID, "athlete");
  assert.equal(db.snapshot("players/quest").code, undefined);
});

test("redemption is rate limited per caller", async () => {
  const { admission } = harness({});
  for (let attempt = 0; attempt < RATE_LIMIT.attempts; attempt += 1) {
    await assert.rejects(admission.redeemPlayerSignupCode({ uid: "guesser", code: `GUESS${attempt}` }), { code: "not-found" });
  }
  await assert.rejects(admission.redeemPlayerSignupCode({ uid: "guesser", code: "FRESH1" }), { code: "resource-exhausted" });
});

test("player joins an organization by fresh code and a coach creates one", async () => {
  const { db, admission } = harness({ "organizations/org": { name: "Club", code: "ORGFRESH", codeVersion: 2, coaches: [], players: [] } });
  const joined = await admission.joinOrganization({ uid: "athlete", email: "a@example.test", role: "player", code: "orgfresh", firstName: "Ada", lastName: "Smith" });
  assert.equal(joined.organizationId, "org");
  const player = db.snapshot("players/athlete");
  assert.equal(player.authenticationUID, "athlete");
  assert.equal(player.userUID, "athlete");
  assert.equal(player.organizationCode, "ORGFRESH");
  assert.equal(player.organization.path, "organizations/org");
  assert.deepEqual(db.snapshot("organizations/org").players, ["athlete"]);

  const created = await admission.createOrganization({ uid: "coach", email: "c@example.test", firstName: "Cody", lastName: "Coach", name: "New Club" });
  assert.match(created.code, /^ORG[A-HJ-NP-Z2-9]{6}$/);
  const organization = db.snapshot(`organizations/${created.organizationId}`);
  assert.equal(organization.codeVersion, 2);
  assert.deepEqual(organization.coaches, ["coach"]);
  const coach = db.snapshot("coaches/coach");
  assert.equal(coach.userUID, "coach");
  assert.deepEqual(coach.members, []);
  assert.equal(coach.organizationCode, created.code);
});

test("organization admission refuses legacy codes and foreign profiles", async () => {
  const { admission } = harness({
    "organizations/legacy": { code: "ORGOLD", coaches: [], players: [] },
    "organizations/fresh": { code: "ORGNEW", codeVersion: 2, coaches: [], players: [] },
    "players/taken": { userUID: "someone-else" },
    "coaches/taken-coach": { userUID: "someone-else" },
  });
  const base = { email: "x@example.test", firstName: "A", lastName: "B" };
  await assert.rejects(admission.joinOrganization({ uid: "athlete", role: "player", code: "ORGOLD", ...base }), { code: "not-found" });
  await assert.rejects(admission.joinOrganization({ uid: "taken", role: "player", code: "ORGNEW", ...base }), { code: "permission-denied" });
  await assert.rejects(admission.joinOrganization({ uid: "taken-coach", role: "coach", code: "ORGNEW", ...base }), { code: "permission-denied" });
  await assert.rejects(admission.joinOrganization({ uid: "athlete", role: "admin", code: "ORGNEW", ...base }), { code: "invalid-argument" });
  await assert.rejects(admission.joinOrganization({ uid: "athlete", role: "player", code: "ORGNEW", ...base, firstName: "" }), { code: "invalid-argument" });
});

test("coach attaches an existing player by fresh code without stealing another roster", async () => {
  const { db, admission } = harness({
    "coaches/legacy-doc": { userUID: "coach", members: ["existing"] },
    "players/free": { userUID: "athlete", signupCode: "FRESH2", signupCodeVersion: 2 },
    "players/owned": { userUID: "other", coachUID: "another-coach", signupCode: "FRESH3", signupCodeVersion: 2 },
    "players/stale": { userUID: "third", signupCode: "OLD003" },
  });
  const result = await admission.attachPlayerByCode({ uid: "coach", code: "FRESH2" });
  assert.equal(result.playerId, "free");
  assert.equal(db.snapshot("players/free").coachUID, "coach");
  assert.equal(db.snapshot("players/free").coachDocId, "legacy-doc");
  assert.deepEqual(db.snapshot("coaches/legacy-doc").members, ["existing", "free"]);
  assert.equal(db.snapshot("coaches/legacy-doc").numberMembers, 2);
  await admission.attachPlayerByCode({ uid: "coach", code: "FRESH2" });
  assert.deepEqual(db.snapshot("coaches/legacy-doc").members, ["existing", "free"], "idempotent");
  await assert.rejects(admission.attachPlayerByCode({ uid: "coach", code: "FRESH3" }), { code: "failed-precondition" });
  await assert.rejects(admission.attachPlayerByCode({ uid: "coach", code: "OLD003" }), { code: "not-found" });
  await assert.rejects(admission.attachPlayerByCode({ uid: "athlete", code: "FRESH2" }), { code: "permission-denied" });
});

test("a coach document at the caller path with another owner grants nothing", async () => {
  const { admission } = harness({
    "coaches/attacker": { userUID: "real-coach", members: ["victim"] },
    "players/victim": { userUID: "v", signupCode: "FRESH4", signupCodeVersion: 2 },
  });
  await assert.rejects(admission.attachPlayerByCode({ uid: "attacker", code: "FRESH4" }), { code: "permission-denied" });
});
