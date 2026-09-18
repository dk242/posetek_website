"use strict";

const crypto = require("node:crypto");
const { isIP } = require("node:net");

const CHECK_LIMIT = 60;
const WINDOW_MS = 15 * 60 * 1000;
// SHA-512 makes the prefixed document ID longer than Firebase Auth's 128-character
// UID limit, so it cannot collide with admissionAttempts/{auth.uid} counters.
const KEY_PREFIX = "player-invitation-check-";
const KIND = "playerInvitationPreflight";

function createPlayerInvitationChecks({ db, HttpsError, now = () => Date.now() }) {
  return async function check(rawRequest) {
    // Use only the platform-provided request IP. Never accept a body value or
    // parse forwarding headers ourselves, and fail closed when it is absent.
    let ip = rawRequest?.ip;
    if (typeof ip !== "string" || ip.length > 64 || !isIP(ip)) {
      throw new HttpsError("failed-precondition", "Your invitation could not be checked. Please try again.");
    }
    ip = ip.toLowerCase();
    if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
    const key = KEY_PREFIX + crypto.createHash("sha512").update(ip).digest("hex");
    const ref = db.collection("admissionAttempts").doc(key);
    await db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      const current = now();
      const previous = snapshot.data();
      if (!Number.isSafeInteger(current) || current < 0 || (snapshot.exists && (
        previous?.lastKind !== KIND || !Number.isSafeInteger(previous.windowStartMillis) || previous.windowStartMillis < 0 ||
        !Number.isSafeInteger(previous.count) || previous.count < 0 || previous.count > CHECK_LIMIT
      ))) {
        throw new HttpsError("failed-precondition", "Your invitation could not be checked. Please try again.");
      }
      const inWindow = snapshot.exists && current - previous.windowStartMillis < WINDOW_MS;
      const count = inWindow ? previous.count : 0;
      if (count >= CHECK_LIMIT || (snapshot.exists && previous.windowStartMillis > current)) {
        throw new HttpsError("resource-exhausted", "Too many invitation checks. Please try again in a few minutes.");
      }
      const windowStartMillis = inWindow ? previous.windowStartMillis : current;
      // Logical expiry resets the quota even when no Firestore TTL policy is
      // configured. This contains no raw address, code, UID or athlete identity.
      tx.set(ref, { count: count + 1, windowStartMillis, lastKind: KIND, expiresAt: new Date(windowStartMillis + WINDOW_MS) });
    });
  };
}

module.exports = { createPlayerInvitationChecks };
