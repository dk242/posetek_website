"use strict";

// Accountless athlete result shares, version 2. Every share carries a server
// HMAC over its issuance fields, so a document planted while Firestore was
// client-writable (or copied from the legacy collection) can never validate.
// Only a coach whose own coach document is bound to the caller UID may issue
// a share for an athlete on that coach's roster.

const { playerSegment } = require("./athlete-storage-paths");

const ATHLETE_SHARE_COLLECTION = "athleteResultSharesV2";
const ATHLETE_SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ATHLETE_SHARE_DRILLS = new Set(["shooting", "sprint", "jump", "broadJump", "changeOfDirection", "dribbling", "freeRecord"]);

function createAthleteShares({ db, crypto, Timestamp, HttpsError, signingKey }) {
  function athleteShareTokenHash(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  function validAthleteShareToken(token) {
    return typeof token === "string" && /^[A-Za-z0-9_-]{40,100}$/.test(token);
  }

  function athleteShareError() {
    return new HttpsError("permission-denied", "This results link is invalid or has expired. Ask the coach for a new link.");
  }

  function key() {
    const value = signingKey();
    if (typeof value !== "string" || value.length < 32) {
      throw new HttpsError("failed-precondition", "Results sharing is temporarily unavailable.");
    }
    return value;
  }

  function athleteShareSignature(hash, share) {
    const payload = JSON.stringify([
      hash, share.issuanceVersion, share.playerDocId,
      share.createdByUid, share.createdByCoachDocId,
      share.createdAt?.toMillis?.(), share.expiresAt?.toMillis?.(),
      share.allowedDrills,
    ]);
    return crypto.createHmac("sha256", key()).update(payload).digest("hex");
  }

  function validAthleteShareSignature(hash, share) {
    const signature = share.issuanceSignature;
    if (share.issuanceVersion !== 2 || typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) return false;
    return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(athleteShareSignature(hash, share), "hex"));
  }

  async function coachDocumentForUid(uid) {
    const direct = await db.collection("coaches").doc(uid).get();
    if (direct.exists && direct.data()?.userUID === uid) return direct;
    const query = await db.collection("coaches").where("userUID", "==", uid).limit(1).get();
    return query.empty || query.docs[0].data()?.userUID !== uid ? null : query.docs[0];
  }

  function coachCanViewPlayer(coachDoc, uid, playerDoc) {
    const coach = coachDoc.data() || {};
    if (coach.userUID !== uid) return false;
    const player = playerDoc.data() || {};
    const members = Array.isArray(coach.members) ? coach.members : [];
    const linkedCoachIds = [player.coachUID, player.coachId, player.coachDocId].filter(Boolean);
    return members.includes(playerDoc.id) || linkedCoachIds.includes(uid) || linkedCoachIds.includes(coachDoc.id);
  }

  async function verifiedAthleteShare(token, requestedDrill) {
    if (!validAthleteShareToken(token) || !ATHLETE_SHARE_DRILLS.has(requestedDrill)) throw athleteShareError();
    const hash = athleteShareTokenHash(token);
    const shareDoc = await db.collection(ATHLETE_SHARE_COLLECTION).doc(hash).get();
    if (!shareDoc.exists) throw athleteShareError();
    const share = shareDoc.data() || {};
    const expiresAtMs = share.expiresAt?.toMillis?.() || 0;
    const allowedDrills = Array.isArray(share.allowedDrills) ? share.allowedDrills : [];
    if (
      !validAthleteShareSignature(hash, share) ||
      share.revoked === true ||
      expiresAtMs <= Date.now() ||
      !allowedDrills.includes(requestedDrill) ||
      !playerSegment(share.playerDocId)
    ) {
      throw athleteShareError();
    }
    const playerDoc = await db.collection("players").doc(share.playerDocId).get();
    if (!playerDoc.exists || playerDoc.data()?.activeResultsShareV2Hash !== hash) throw athleteShareError();
    return { hash, shareDoc, share, playerDoc };
  }

  /**
   * Creates one accountless athlete-results link. A replacement link revokes the
   * previous link for that player. The raw bearer token is returned once and is
   * never stored; Firestore contains only its SHA-256 hash.
   */
  async function createAthleteResultsShare({ uid, playerDocId }) {
    if (!uid) throw new HttpsError("unauthenticated", "Sign in as a coach to create an athlete results link.");
    const player = String(playerDocId || "").trim();
    if (!playerSegment(player)) throw new HttpsError("invalid-argument", "playerDocId is required.");
    const [coachDoc, playerDoc] = await Promise.all([coachDocumentForUid(uid), db.collection("players").doc(player).get()]);
    if (!coachDoc || !playerDoc.exists || !coachCanViewPlayer(coachDoc, uid, playerDoc)) {
      throw new HttpsError("permission-denied", "This athlete is not on your roster.");
    }
    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = athleteShareTokenHash(rawToken);
    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(now.toMillis() + ATHLETE_SHARE_TTL_MS);
    const playerData = playerDoc.data() || {};
    const previousHash = typeof playerData.activeResultsShareV2Hash === "string" ? playerData.activeResultsShareV2Hash : null;
    const share = {
      issuanceVersion: 2, playerDocId: player, allowedDrills: [...ATHLETE_SHARE_DRILLS],
      createdByUid: uid, createdByCoachDocId: coachDoc.id, createdAt: now, expiresAt, revoked: false,
    };
    share.issuanceSignature = athleteShareSignature(tokenHash, share);
    const batch = db.batch();
    batch.set(db.collection(ATHLETE_SHARE_COLLECTION).doc(tokenHash), share);
    batch.set(playerDoc.ref, { activeResultsShareV2Hash: tokenHash, activeResultsShareV2ExpiresAt: expiresAt }, { merge: true });
    if (previousHash && previousHash !== tokenHash) {
      batch.set(db.collection(ATHLETE_SHARE_COLLECTION).doc(previousHash), { revoked: true, revokedAt: now }, { merge: true });
    }
    await batch.commit();
    return { token: rawToken, expiresAtMillis: expiresAt.toMillis() };
  }

  return {
    athleteShareTokenHash, validAthleteShareToken, athleteShareError, athleteShareSignature,
    validAthleteShareSignature, coachDocumentForUid, coachCanViewPlayer, verifiedAthleteShare,
    createAthleteResultsShare,
  };
}

module.exports = { createAthleteShares, ATHLETE_SHARE_COLLECTION, ATHLETE_SHARE_DRILLS, ATHLETE_SHARE_TTL_MS };
