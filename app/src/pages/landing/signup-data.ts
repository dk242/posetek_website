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

  await db.collection("coaches").doc(coachId).set(coachData);
  return coachData;
}

// Organization admission and player-code redemption run through the trusted
// admission service (functions/admission.js). Codes are never discovered or
// redeemed by a client write, and only post-lockdown codes are accepted.
// (`cloud` is the same us-central1 Functions instance legacy reached through
// `firebase.functions()`.)

export async function discardFailedSignup(user: any): Promise<void> {
  if (!user) return;
  try {
    await user.delete();
  } catch {
    /* leave sign-in state to the next attempt */
  }
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
