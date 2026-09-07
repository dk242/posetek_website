"use strict";

// Trusted admission: invitation redemption, organization membership and roster
// attachment. Firestore rules deny the direct client writes these replace, so a
// previously public code can never become a client-side ownership claim.
//
// Every entry point takes the verified caller UID from the callable context,
// never from the request body. Invitation codes are single use and only the
// post-lockdown version is redeemable; pre-lockdown codes were world-readable
// and are rotated by firebase/operations.py in the mobile repository.

const { playerSegment } = require("./athlete-storage-paths");

const INVITATION_VERSION = 2;
const INVITATION_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RATE_LIMIT = Object.freeze({ attempts: 10, windowMs: 15 * 60 * 1000 });
const CANONICAL_UID_FIELDS = ["authenticationUID", "userUID"];

function createAdmission({ db, FieldValue, HttpsError, randomInt }) {
  const pick = randomInt || ((max) => Math.floor(Math.random() * max));

  function invitationCode(prefix = "", length = 6) {
    let code = prefix;
    for (let index = 0; index < length; index += 1) code += INVITATION_ALPHABET[pick(INVITATION_ALPHABET.length)];
    return code;
  }

  function requireUid(uid) {
    if (typeof uid !== "string" || !playerSegment(uid)) throw new HttpsError("unauthenticated", "Sign in to continue.");
    return uid;
  }

  function normalizeCode(raw) {
    const code = String(raw || "").trim();
    if (!code || code.length > 64 || !/^[A-Za-z0-9-]+$/.test(code)) {
      throw new HttpsError("invalid-argument", "Enter a valid code.");
    }
    return code;
  }

  function normalizeName(raw, label) {
    const value = String(raw || "").trim();
    if (!value || value.length > 100) throw new HttpsError("invalid-argument", `Enter a valid ${label}.`);
    return value;
  }

  function normalizeEmail(raw) {
    const value = typeof raw === "string" ? raw.trim() : "";
    return value && value.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? value : null;
  }

  function invalidInvitation() {
    return new HttpsError("not-found", "That code is not valid or has expired. Ask your coach for a new code.");
  }

  function ownedBy(data, uid) {
    const owners = CANONICAL_UID_FIELDS.filter((field) => Object.hasOwn(data, field)).map((field) => data[field]);
    if (owners.some((owner) => owner !== uid)) return false;
    return owners.length > 0;
  }

  function unclaimed(data) {
    return CANONICAL_UID_FIELDS.every((field) => !data[field]) && data.registered !== true;
  }

  function codeMatches(data, code) {
    return [data.signupCode, data.code].some((stored) => typeof stored === "string" && stored.toUpperCase() === code.toUpperCase());
  }

  async function enforceRateLimit(uid, kind) {
    const ref = db.collection("admissionAttempts").doc(uid);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const now = Date.now();
      const current = snapshot.exists ? snapshot.data() : {};
      const inWindow = typeof current.windowStartMillis === "number" && now - current.windowStartMillis < RATE_LIMIT.windowMs;
      const count = inWindow ? (current.count || 0) : 0;
      if (count >= RATE_LIMIT.attempts) {
        throw new HttpsError("resource-exhausted", "Too many attempts. Try again in a few minutes.");
      }
      transaction.set(ref, { count: count + 1, windowStartMillis: inWindow ? current.windowStartMillis : now, lastKind: kind, updatedAt: FieldValue.serverTimestamp() });
    });
  }

  async function firstMatch(collection, field, values) {
    for (const value of values) {
      const result = await db.collection(collection).where(field, "==", value).limit(1).get();
      if (!result.empty) return result.docs[0];
    }
    return null;
  }

  async function findPlayerByCode(code) {
    const candidates = [...new Set([code, code.toUpperCase()])];
    return (await firstMatch("players", "signupCode", candidates)) || firstMatch("players", "code", candidates);
  }

  async function findOwnedPlayer(uid) {
    const bound = await firstMatch("players", "authenticationUID", [uid]) || await firstMatch("players", "userUID", [uid]);
    if (bound) return bound;
    const direct = await db.collection("players").doc(uid).get();
    if (!direct.exists) return null;
    const data = direct.data() || {};
    return CANONICAL_UID_FIELDS.some((field) => data[field] && data[field] !== uid) ? null : direct;
  }

  async function findOwnedCoach(uid) {
    const direct = await db.collection("coaches").doc(uid).get();
    if (direct.exists && direct.data()?.userUID === uid) return direct;
    const query = await db.collection("coaches").where("userUID", "==", uid).limit(1).get();
    return query.empty || query.docs[0].data()?.userUID !== uid ? null : query.docs[0];
  }

  /** Binds an unclaimed, freshly invited player document to the caller. */
  async function redeemPlayerSignupCode({ uid, email, code }) {
    requireUid(uid);
    const normalized = normalizeCode(code);
    await enforceRateLimit(uid, "redeemPlayerSignupCode");
    if (await findOwnedPlayer(uid)) {
      throw new HttpsError("already-exists", "This account is already linked to an athlete profile.");
    }
    const candidate = await findPlayerByCode(normalized);
    if (!candidate || !playerSegment(candidate.id)) throw invalidInvitation();
    const playerId = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(candidate.ref);
      const data = snapshot.exists ? snapshot.data() : null;
      if (!data || data.signupCodeVersion !== INVITATION_VERSION || !unclaimed(data) || !codeMatches(data, normalized)) {
        throw invalidInvitation();
      }
      const updates = {
        authenticationUID: uid,
        userUID: uid,
        registered: true,
        signupCode: FieldValue.delete(),
        code: FieldValue.delete(),
        signupCodeVersion: FieldValue.delete(),
        signupRedeemedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      const verifiedEmail = normalizeEmail(email);
      if (verifiedEmail) updates.email = verifiedEmail;
      transaction.update(candidate.ref, updates);
      return snapshot.id;
    });
    return { playerId };
  }

  async function findOrganizationByCode(code) {
    const organization = await firstMatch("organizations", "code", [code.toUpperCase()]);
    if (!organization || organization.data()?.codeVersion !== INVITATION_VERSION || organization.data()?.schemaVersion === 2) throw invalidInvitation();
    return organization;
  }

  function coachProfile(uid, email, firstName, lastName, organization) {
    const profile = {
      firstName, lastName, userUID: uid, members: [], numberMembers: 0, sport: "Soccer",
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    };
    const verifiedEmail = normalizeEmail(email);
    if (verifiedEmail) profile.email = verifiedEmail;
    if (organization) Object.assign(profile, organization);
    return profile;
  }

  async function legacyIdentity(transaction, uid) {
    const [playersByAuth, playersByUser, directPlayer, coachesByUser, directCoach, clubs] = await Promise.all([
      transaction.get(db.collection("players").where("authenticationUID", "==", uid).limit(2)),
      transaction.get(db.collection("players").where("userUID", "==", uid).limit(2)),
      transaction.get(db.collection("players").doc(uid)),
      transaction.get(db.collection("coaches").where("userUID", "==", uid).limit(2)),
      transaction.get(db.collection("coaches").doc(uid)),
      transaction.get(db.collection("organizations").where("memberUIDs", "array-contains", uid).limit(1)),
    ]);
    const players = [...new Map([...playersByAuth.docs, ...playersByUser.docs, ...(directPlayer.exists ? [directPlayer] : [])].map((doc) => [doc.id, doc])).values()];
    const coaches = [...coachesByUser.docs, ...(directCoach.exists ? [directCoach] : [])];
    if ([...players, ...coaches].some((doc) => Object.hasOwn(doc.data() || {}, "organizationId")) || clubs.docs.some((doc) => doc.data().schemaVersion === 2)) {
      throw new HttpsError("failed-precondition", "Manage this account through its club.");
    }
    if (players.length > 1) throw new HttpsError("failed-precondition", "This login has multiple athlete profiles. Ask PoseTek to reconcile it.");
    return { player: players[0] || null, coach: directCoach };
  }

  async function ensureCoach(transaction, uid, email, firstName, lastName, organization) {
    const identity = await legacyIdentity(transaction, uid);
    const ref = db.collection("coaches").doc(uid);
    const snapshot = identity.coach;
    if (snapshot.exists) {
      if (Object.hasOwn(snapshot.data() || {}, "organizationId")) throw new HttpsError("failed-precondition", "Manage this account through its club.");
      if (snapshot.data()?.userUID !== uid) throw new HttpsError("permission-denied", "This coach profile belongs to another account.");
      transaction.update(ref, { ...organization, updatedAt: FieldValue.serverTimestamp() });
    } else {
      transaction.set(ref, coachProfile(uid, email, firstName, lastName, organization));
    }
    return ref;
  }

  async function ensurePlayer(transaction, uid, email, firstName, lastName, organization) {
    const identity = await legacyIdentity(transaction, uid);
    const ref = identity.player?.ref || db.collection("players").doc(uid);
    const snapshot = identity.player;
    if (snapshot?.exists) {
      if (Object.hasOwn(snapshot.data() || {}, "organizationId")) throw new HttpsError("failed-precondition", "Manage this athlete through their club.");
      if (!ownedBy(snapshot.data() || {}, uid)) throw new HttpsError("permission-denied", "This athlete profile belongs to another account.");
      transaction.update(ref, { ...organization, updatedAt: FieldValue.serverTimestamp() });
    } else {
      const profile = {
        firstName, lastName, userUID: uid, authenticationUID: uid, isTemporary: false, ...organization,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      };
      const verifiedEmail = normalizeEmail(email);
      if (verifiedEmail) profile.email = verifiedEmail;
      transaction.set(ref, profile);
    }
    return ref;
  }

  /** Adds the caller to an organization by fresh code as a player or coach. */
  async function joinOrganization({ uid, email, role, code, firstName, lastName }) {
    requireUid(uid);
    if (!["player", "coach"].includes(role)) throw new HttpsError("invalid-argument", "Choose player or coach.");
    const first = normalizeName(firstName, "first name");
    const last = normalizeName(lastName, "last name");
    const normalized = normalizeCode(code);
    await enforceRateLimit(uid, "joinOrganization");
    const organization = await findOrganizationByCode(normalized);
    const membership = { organization: organization.ref, organizationCode: normalized.toUpperCase() };
    await db.runTransaction(async (transaction) => {
      const organizationSnapshot = await transaction.get(organization.ref);
      if (!organizationSnapshot.exists || organizationSnapshot.data()?.schemaVersion === 2
        || organizationSnapshot.data()?.codeVersion !== INVITATION_VERSION
        || organizationSnapshot.data()?.code !== normalized.toUpperCase()) throw invalidInvitation();
      if (role === "player") await ensurePlayer(transaction, uid, email, first, last, membership);
      else await ensureCoach(transaction, uid, email, first, last, membership);
      transaction.update(organization.ref, {
        [role === "player" ? "players" : "coaches"]: FieldValue.arrayUnion(uid),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return { organizationId: organization.id };
  }

  /** A coach creates an organization and receives its fresh invitation code. */
  async function createOrganization({ uid, email, firstName, lastName, name }) {
    requireUid(uid);
    const first = normalizeName(firstName, "first name");
    const last = normalizeName(lastName, "last name");
    const organizationName = String(name || "").trim();
    if (!organizationName || organizationName.length > 120) throw new HttpsError("invalid-argument", "Enter an organization name.");
    await enforceRateLimit(uid, "createOrganization");
    const ref = db.collection("organizations").doc();
    const code = invitationCode("ORG", 6);
    await db.runTransaction(async (transaction) => {
      await ensureCoach(transaction, uid, email, first, last, { organization: ref, organizationCode: code });
      transaction.set(ref, {
        name: organizationName, coaches: [uid], players: [], code, codeVersion: INVITATION_VERSION,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return { organizationId: ref.id, code };
  }

  /** A coach attaches an existing player to their roster by the player's fresh code. */
  async function attachPlayerByCode({ uid, code }) {
    requireUid(uid);
    const normalized = normalizeCode(code);
    await enforceRateLimit(uid, "attachPlayerByCode");
    const coach = await findOwnedCoach(uid);
    if (!coach) throw new HttpsError("permission-denied", "A coach profile is required.");
    if (Object.hasOwn(coach.data() || {}, "organizationId")) throw new HttpsError("failed-precondition", "Manage player assignments through your club.");
    const candidate = await findPlayerByCode(normalized);
    if (!candidate || !playerSegment(candidate.id)) throw invalidInvitation();
    const playerId = await db.runTransaction(async (transaction) => {
      const [playerSnapshot, coachSnapshot] = await Promise.all([transaction.get(candidate.ref), transaction.get(coach.ref)]);
      const player = playerSnapshot.exists ? playerSnapshot.data() : null;
      if (!player || player.signupCodeVersion !== INVITATION_VERSION || !codeMatches(player, normalized)) throw invalidInvitation();
      if (Object.hasOwn(player, "organizationId")) throw new HttpsError("failed-precondition", "This athlete belongs to a club; ask its manager to adjust team assignments.");
      const links = [player.coachUID, player.coachId, player.coachDocId].filter(Boolean);
      if (links.length && !links.includes(uid) && !links.includes(coach.id)) {
        throw new HttpsError("failed-precondition", "That player is already on another coach's roster.");
      }
      const coachData = coachSnapshot.data() || {};
      if (Object.hasOwn(coachData, "organizationId")) throw new HttpsError("failed-precondition", "Manage player assignments through your club.");
      if (coachData.userUID !== uid) throw new HttpsError("permission-denied", "A coach profile is required.");
      const members = Array.isArray(coachData.members) ? coachData.members : [];
      transaction.update(candidate.ref, { coachUID: uid, coachDocId: coach.id, updatedAt: FieldValue.serverTimestamp() });
      if (!members.includes(playerSnapshot.id)) {
        transaction.update(coach.ref, { members: [...members, playerSnapshot.id], numberMembers: members.length + 1, updatedAt: FieldValue.serverTimestamp() });
      }
      return playerSnapshot.id;
    });
    return { playerId };
  }

  return { redeemPlayerSignupCode, joinOrganization, createOrganization, attachPlayerByCode, invitationCode };
}

module.exports = { createAdmission, INVITATION_VERSION, RATE_LIMIT };
