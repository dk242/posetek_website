// Port of the legacy `firebase-identity.js` (`window.PoseTekIdentity`): shared
// UID-first coach/player resolution. Firestore rules remain the authority —
// these helpers only decide which document a signed-in user is allowed to be
// treated as, using the same probes and error copy as the legacy pages.
//
// `db` is passed explicitly (legacy signature) so pure tests can supply a fake.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface IdentityDoc {
  id: string;
  exists: boolean;
  data(): Record<string, any> | undefined;
  ref?: any;
}

export interface IdentityDb {
  collection(name: string): {
    doc(id: string): { get(): Promise<IdentityDoc> };
    where(field: string, op: "==", value: unknown): {
      limit(n: number): { get(): Promise<{ empty: boolean; docs: IdentityDoc[] }> };
    };
  };
}

const OWNER_FIELDS = ["authenticationUID", "userUID"] as const;

export function ownsPlayer(doc: IdentityDoc | null | undefined, uid: string | null | undefined): boolean {
  if (!uid || !doc || !doc.exists) return false;
  const data = doc.data() || {};
  if (OWNER_FIELDS.some(field => Object.prototype.hasOwnProperty.call(data, field) && data[field] !== uid)) return false;
  return doc.id === uid || OWNER_FIELDS.some(field => data[field] === uid);
}

async function ownDocument(db: IdentityDb, collection: string, uid: string): Promise<IdentityDoc | null> {
  try {
    return await db.collection(collection).doc(uid).get();
  } catch (error: any) {
    // A missing own-document probe may be denied by rules that rely on
    // resource fields. Continue with the constrained UID query only.
    if (error?.code === "permission-denied" || error?.code === "firestore/permission-denied") return null;
    throw error;
  }
}

export async function findCoach(db: IdentityDb, uid: string | null | undefined): Promise<IdentityDoc | null> {
  if (!uid) return null;
  const direct = await ownDocument(db, "coaches", uid);
  if (direct && direct.exists) {
    const data = direct.data() || {};
    if (data.userUID === uid) return direct;
  }
  const query = await db.collection("coaches").where("userUID", "==", uid).limit(1).get();
  return query.empty ? null : query.docs[0];
}

export async function findPlayer(db: IdentityDb, uid: string | null | undefined): Promise<IdentityDoc | null> {
  if (!uid) return null;
  for (const field of OWNER_FIELDS) {
    const query = await db.collection("players").where(field, "==", uid).limit(1).get();
    if (!query.empty) {
      const doc = query.docs[0];
      if (!ownsPlayer(doc, uid)) throw new Error("This athlete account needs its profile link repaired. Contact your coach.");
      return doc;
    }
  }
  const direct = await ownDocument(db, "players", uid);
  return ownsPlayer(direct, uid) ? direct : null;
}
