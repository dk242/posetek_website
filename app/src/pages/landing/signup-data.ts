// Firebase-touching signup helpers ported from kickai.html. Field names, the
// callable names and their payloads are byte-identical to the legacy page; the
// pure payload builders live in landing-helpers.ts so they can be unit-tested.

/* eslint-disable @typescript-eslint/no-explicit-any */

import firebase, { cloud, db } from "../../lib/firebase";
import {
  createOrganizationPayload,
  generateCode,
  joinOrganizationPayload,
  redeemPlayerSignupCodePayload,
} from "./landing-helpers";
import type { OrganizationRole } from "./landing-helpers";

// Create coach document in Firestore (the Coach tab still writes this directly)
export async function createCoachDocument(
  coachId: string,
  email: string,
  firstName: string,
  lastName: string,
  orgRef: any = null,
): Promise<any> {
  const coachData: Record<string, any> = {
    firstName: firstName,
    lastName: lastName,
    email: email,
    userUID: coachId,
    members: [],
    numberMembers: 0,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  if (orgRef) {
    coachData.organization = orgRef;
    coachData.coachCode = generateCode("COACH", 4);
  }

  await db.runTransaction(async transaction => {
    const ref = db.collection("coaches").doc(coachId);
    const existing = await transaction.get(ref);
    if (existing.exists) {
      if (existing.data()?.userUID !== coachId) throw new Error("This coach profile belongs to another account.");
      return;
    }
    transaction.set(ref, coachData);
  });
  return coachData;
}

// Organization admission and player-code redemption run through the trusted
// admission service (functions/admission.js). Codes are never discovered or
// redeemed by a client write, and only post-lockdown codes are accepted.
// (`cloud` is the same us-central1 Functions instance legacy reached through
// `firebase.functions()`.)

export async function resolvedLegacyAdmission(uid: string, role: OrganizationRole, expectedCode?: string): Promise<boolean> {
  const collection = role === "player" ? "players" : "coaches";
  const direct = await db.collection(collection).doc(uid).get();
  const profiles = direct.exists ? [direct] : (await db.collection(collection).where("userUID", "==", uid).limit(2).get()).docs;
  if (profiles.length !== 1) return false;
  const profile = profiles[0].data();
  if (!profile) return false;
  if (profile.userUID !== uid && profile.authenticationUID !== uid) return false;
  if (!profile.organization || (expectedCode && profile.organizationCode !== expectedCode.toUpperCase())) return false;
  const organization = await profile.organization.get();
  return organization.exists && Array.isArray(organization.data()?.[role === "player" ? "players" : "coaches"])
    && organization.data()![role === "player" ? "players" : "coaches"].includes(uid);
}

/** Binds an unclaimed, freshly invited player document to the caller. */
export function redeemPlayerSignupCode(code: string): Promise<any> {
  return cloud.httpsCallable("redeemPlayerSignupCode")(redeemPlayerSignupCodePayload(code));
}

/** Adds the caller to an organization by fresh code as a player or coach. */
export function joinOrganization(
  code: string,
  role: OrganizationRole,
  firstName: string,
  lastName: string,
): Promise<any> {
  return cloud.httpsCallable("joinOrganization")(joinOrganizationPayload(code, role, firstName, lastName));
}

/** A coach creates an organization and receives its fresh invitation code. */
export function createOrganization(name: string, firstName: string, lastName: string): Promise<any> {
  return cloud.httpsCallable("createOrganization")(createOrganizationPayload(name, firstName, lastName));
}
