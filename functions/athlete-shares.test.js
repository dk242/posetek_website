const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");
const { FakeFirestore, FakeTimestamp, HttpsError } = require("./test-support/fake-firestore");
const { createAthleteShares, ATHLETE_SHARE_COLLECTION } = require("./athlete-shares");

const KEY = "0123456789abcdef0123456789abcdef-signing";

function harness(seed, signingKey = KEY) {
  const db = new FakeFirestore(seed);
  const shares = createAthleteShares({ db, crypto, Timestamp: FakeTimestamp, HttpsError, signingKey: () => signingKey });
  return { db, shares };
}

const roster = {
  "coaches/coach": { userUID: "coach", members: ["victim"] },
  "players/victim": { firstName: "V", lastName: "Ictim", userUID: "v" },
};

test("a bound coach issues a signed share that verifies and revokes the previous link", async () => {
  const { db, shares } = harness(roster);
  const first = await shares.createAthleteResultsShare({ uid: "coach", playerDocId: "victim" });
  const verified = await shares.verifiedAthleteShare(first.token, "sprint");
  assert.equal(verified.playerDoc.id, "victim");
  assert.equal(verified.share.issuanceVersion, 2);
  const second = await shares.createAthleteResultsShare({ uid: "coach", playerDocId: "victim" });
  await assert.rejects(shares.verifiedAthleteShare(first.token, "sprint"), { code: "permission-denied" });
  await shares.verifiedAthleteShare(second.token, "jump");
  assert.equal(db.snapshot(`${ATHLETE_SHARE_COLLECTION}/${shares.athleteShareTokenHash(first.token)}`).revoked, true);
});

test("a coach document at the caller path owned by someone else cannot issue shares", async () => {
  const { shares } = harness({ ...roster, "coaches/attacker": { userUID: "other-coach", members: ["victim"] } });
  await assert.rejects(shares.createAthleteResultsShare({ uid: "attacker", playerDocId: "victim" }), { code: "permission-denied" });
  await assert.rejects(shares.createAthleteResultsShare({ uid: "coach", playerDocId: "../victim" }), { code: "invalid-argument" });
  await assert.rejects(shares.createAthleteResultsShare({ uid: null, playerDocId: "victim" }), { code: "unauthenticated" });
});

test("forged or pre-lockdown share records never validate, even with a matching player pointer", async () => {
  const token = "A".repeat(48);
  const { db, shares } = harness(roster);
  const hash = shares.athleteShareTokenHash(token);
  const planted = {
    playerDocId: "victim", allowedDrills: ["sprint"], revoked: false,
    createdAt: FakeTimestamp.fromMillis(1), expiresAt: FakeTimestamp.fromMillis(Date.now() + 1e9),
  };
  await db.doc(`${ATHLETE_SHARE_COLLECTION}/${hash}`).set(planted);
  await db.doc("players/victim").set({ activeResultsShareV2Hash: hash }, { merge: true });
  await assert.rejects(shares.verifiedAthleteShare(token, "sprint"), { code: "permission-denied" });
  await db.doc(`${ATHLETE_SHARE_COLLECTION}/${hash}`).set({ ...planted, issuanceVersion: 2, issuanceSignature: "f".repeat(64) });
  await assert.rejects(shares.verifiedAthleteShare(token, "sprint"), { code: "permission-denied" });
  const tampered = { ...planted, issuanceVersion: 2, createdByUid: "coach", createdByCoachDocId: "coach" };
  tampered.issuanceSignature = shares.athleteShareSignature(hash, tampered);
  await db.doc(`${ATHLETE_SHARE_COLLECTION}/${hash}`).set({ ...tampered, playerDocId: "other-athlete" });
  await db.doc("players/other-athlete").set({ activeResultsShareV2Hash: hash });
  await assert.rejects(shares.verifiedAthleteShare(token, "sprint"), { code: "permission-denied" });
});

test("sharing fails closed without a configured signing key", async () => {
  const { shares } = harness(roster, "");
  await assert.rejects(shares.createAthleteResultsShare({ uid: "coach", playerDocId: "victim" }), { code: "failed-precondition" });
});
