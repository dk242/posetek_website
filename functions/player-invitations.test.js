"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FakeFirestore, FieldValue, HttpsError } = require("./test-support/fake-firestore");
const { createPlayerInvitations } = require("./player-invitations");
const { createAdmission } = require("./admission");
const { createClubs } = require("./clubs");
const operator = { uid: "admin", email: "staff@posetek.net", emailVerified: true };
function setup(extra = {}) {
  const db = new FakeFirestore({ "coaches/c": { userUID: "c", members: [] }, "players/p": { firstName: "New", lastName: "Player", coachUID: "c", coachDocId: "c", registered: false }, ...extra });
  const args = { db, FieldValue, HttpsError }, invitations = createPlayerInvitations(args);
  return { db, invitations, admission: createAdmission({ ...args, invitations }), clubs: createClubs({ ...args, invitations }) };
}
test("new client-created profiles get protected idempotent invitations, never public secrets", async () => {
  const { db, invitations } = setup();
  const before = await invitations.ensure("p", null, { dryRun: true });
  assert.equal(before.writes, 3); assert.equal(db.snapshot("playerSignupInvitations/p"), undefined);
  const issued = await invitations.ensure("p");
  assert.match(issued.code, /^PLR-[A-F0-9]{32}$/);
  assert.equal((await invitations.ensure("p", { uid: "c" })).code, issued.code);
  assert.equal((await invitations.ensure("p")).writes, 0);
  assert.equal(db.snapshot("players/p").signupCode, undefined);
  assert.equal(db.snapshot("players/p").signupCodeVersion, 3);
  await assert.rejects(invitations.ensure("p", { uid: "attacker" }), { code: "permission-denied" });
});
test("redemption binds the existing profile once and delayed triggers cannot reset it", async () => {
  const { db, invitations, admission } = setup();
  const invite = await invitations.ensure("p");
  assert.deepEqual(await admission.redeemPlayerSignupCode({ uid: "athlete", email: "athlete@example.com", code: invite.code.toLowerCase() }), { playerId: "p" });
  assert.equal(db.snapshot("players/p").authenticationUID, "athlete");
  assert.equal(db.snapshot("players/p").userUID, "athlete");
  assert.equal(db.snapshot("playerSignupInvitations/p"), undefined);
  const original = db.snapshot("players/p");
  assert.equal((await invitations.ensure("p")).skipped, "Already claimed");
  assert.deepEqual(db.snapshot("players/p"), original);
  await assert.rejects(invitations.ensure("p", operator, { rotate: true }), { code: "failed-precondition" });
  await assert.rejects(admission.redeemPlayerSignupCode({ uid: "another", code: invite.code }), { code: "not-found" });
});
test("migration preserves valid version-2 codes and explicit replacement invalidates old codes", async () => {
  const { invitations, admission } = setup({ "players/p": { coachUID: "c", registered: false, signupCode: "FRESH22", signupCodeVersion: 2 } });
  assert.equal((await invitations.ensure("p")).code, "FRESH22");
  const replaced = await invitations.ensure("p", operator, { rotate: true });
  assert.notEqual(replaced.code, "FRESH22");
  await assert.rejects(admission.redeemPlayerSignupCode({ uid: "new", code: "FRESH22" }), { code: "not-found" });
  assert.deepEqual(await admission.redeemPlayerSignupCode({ uid: "new", code: replaced.code }), { playerId: "p" });
});
test("canonical team access wins over stale coach pointers and malformed ownership is preserved", async () => {
  const { invitations, db } = setup({ "organizations/org": { schemaVersion: 2 }, "players/p": { organizationId: "org", teamId: "t", coachUID: "c" },
    "organizations/org/members/other": { userUID: "other", status: "active", role: "coach", teamIds: ["other-team"] },
    "organizations/org/members/assigned": { userUID: "assigned", status: "active", role: "coach", teamIds: ["t"] } });
  await assert.rejects(invitations.ensure("p", { uid: "c" }), { code: "permission-denied" });
  await assert.rejects(invitations.ensure("p", { uid: "other" }), { code: "permission-denied" });
  assert.ok((await invitations.ensure("p", { uid: "assigned" })).code);
  await db.doc("players/p").update({ authenticationUID: "bound" });
  await assert.rejects(invitations.ensure("p", operator), { code: "failed-precondition" });
});
test("independent coach creation commits roster and invitation together", async () => {
  const { invitations, db } = setup();
  const result = await invitations.createCoachPlayer({ firstName: "New", lastName: "Athlete" }, { uid: "c" });
  assert.ok(db.snapshot("coaches/c").members.includes(result.playerId));
  assert.equal(db.snapshot("players/" + result.playerId).signupCode, undefined);
  assert.equal(db.snapshot("playerSignupInvitations/" + result.playerId).code, result.code);
});
test("missing owners and organization-only strangers never receive invitation access", async () => {
  const { invitations } = setup({ "players/orphan": { registered: false }, "players/mismatch": { coachUID: "different", coachDocId: "c" } });
  assert.ok((await invitations.ensure("orphan")).skipped);
  assert.ok((await invitations.ensure("mismatch")).skipped);
});

test("coach creation retries return the same player and never duplicate roster membership", async () => {
  const { invitations, db } = setup();
  const input = { firstName:"Retry", lastName:"Player", creationId:"test-creation-request-001" };
  const first = await invitations.createCoachPlayer(input, { uid:"c" });
  const retry = await invitations.createCoachPlayer(input, { uid:"c" });
  assert.deepEqual(retry, first); assert.equal(db.snapshot("coaches/c").members.length, 1);
});
test("admission with protected invitation support preserves the legacy coach attachment path", async () => {
  const { admission } = setup({ "players/p": { registered:false, signupCode:"LEGACY2", signupCodeVersion:2 } });
  const result = await admission.attachPlayerByCode({ uid:"c", code:"LEGACY2" });
  assert.ok(result);
});
