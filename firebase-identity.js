// Shared legacy-page identity resolution. Firestore rules remain the authority.
(function (root) {
  "use strict";

  function ownsPlayer(doc, uid) {
    if (!uid || !doc || !doc.exists) return false;
    const data = doc.data() || {};
    const fields = ["authenticationUID", "userUID"];
    if (fields.some(field => Object.prototype.hasOwnProperty.call(data, field) && data[field] !== uid)) return false;
    return doc.id === uid || fields.some(field => data[field] === uid);
  }

  async function ownDocument(db, collection, uid) {
    try {
      return await db.collection(collection).doc(uid).get();
    } catch (error) {
      // A missing own-document probe may be denied by rules that rely on
      // resource fields. Continue with the constrained UID query only.
      if (error.code === "permission-denied" || error.code === "firestore/permission-denied") return null;
      throw error;
    }
  }

  async function findCoach(db, uid) {
    if (!uid) return null;
    const direct = await ownDocument(db, "coaches", uid);
    if (direct && direct.exists) {
      const data = direct.data() || {};
      if (data.userUID === uid) return direct;
    }
    const query = await db.collection("coaches").where("userUID", "==", uid).limit(1).get();
    return query.empty ? null : query.docs[0];
  }

  async function findPlayer(db, uid) {
    if (!uid) return null;
    for (const field of ["authenticationUID", "userUID"]) {
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

  const identity = { ownsPlayer, findCoach, findPlayer };
  root.PoseTekIdentity = identity;
  if (typeof module !== "undefined" && module.exports) module.exports = identity;
})(typeof globalThis !== "undefined" ? globalThis : this);
