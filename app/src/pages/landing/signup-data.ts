// Firestore signup helpers ported verbatim from kickai.html — collection names,
// field names/fallbacks, query shapes, and the legacy debug logging are preserved.

/* eslint-disable @typescript-eslint/no-explicit-any */

import firebase, { db } from "../../lib/firebase";
import { generateCode } from "./landing-helpers";

// Create a new organization in Firestore
export async function createOrganization(name: string, coachId: string): Promise<any> {
  const orgRef = db.collection("organizations").doc();
  const orgData = {
    name: name,
    coaches: [coachId],
    players: [],
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    code: generateCode("ORG", 6),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  await orgRef.set(orgData);
  return orgRef;
}

// Create coach document in Firestore
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

// Create player document in Firestore
export async function createPlayerDocument(
  playerId: string,
  email: string | null,
  firstName: string,
  lastName: string,
  coachRef: any = null,
  orgRef: any = null,
  isTemporary = false,
): Promise<any> {
  const playerData: Record<string, any> = {
    firstName: firstName,
    lastName: lastName,
    userUID: playerId,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    isTemporary: isTemporary,
  };

  if (email) {
    playerData.email = email;
  }

  if (coachRef) {
    playerData.coach = coachRef;
    playerData.playerCode = generateCode("PLR", 4);
  }

  if (orgRef) {
    playerData.organization = orgRef;
  }

  await db.collection("players").doc(playerId).set(playerData);
  return playerData;
}

// Find organization by code
export async function findOrganizationByCode(code: string): Promise<any> {
  const snapshot = await db
    .collection("organizations")
    .where("code", "==", code.toUpperCase())
    .limit(1)
    .get();

  if (!snapshot.empty) {
    const doc = snapshot.docs[0];
    return {
      id: doc.id,
      ref: doc.ref,
      ...doc.data(),
    };
  }
  return null;
}

// Find player by code
export async function findPlayerByCode(code: string): Promise<any> {
  const codeRaw = code.trim();
  const codeUpper = codeRaw.toUpperCase();
  console.log("[findPlayerByCode] Input (raw):", JSON.stringify(codeRaw), "| uppercased:", JSON.stringify(codeUpper));

  // DEBUG: dump ALL player docs and log their signupCode values (kept from legacy)
  const allSnap = await db.collection("players").get();
  console.log("[DEBUG] Total player docs in collection:", allSnap.size);
  allSnap.forEach((d) => {
    const data = d.data();
    console.log("[DEBUG] doc id:", d.id, "| signupCode:", JSON.stringify(data.signupCode), "| registered:", data.registered);
  });

  // Try exact match first, then case-insensitive fallback
  let snapshot = await db.collection("players").where("signupCode", "==", codeRaw).limit(1).get();
  console.log("[findPlayerByCode] Exact match query (no toUpperCase) returned", snapshot.size, "doc(s)");

  if (snapshot.empty) {
    snapshot = await db.collection("players").where("signupCode", "==", codeUpper).limit(1).get();
    console.log("[findPlayerByCode] Uppercased match query returned", snapshot.size, "doc(s)");
  }

  if (!snapshot.empty) {
    const doc = snapshot.docs[0];
    const data = doc.data();
    console.log("[findPlayerByCode] Found doc id:", doc.id, "| data:", data);
    return {
      id: doc.id,
      ref: doc.ref,
      ...data,
    };
  }
  console.warn("[findPlayerByCode] No matching player doc found for either casing");
  return null;
}
