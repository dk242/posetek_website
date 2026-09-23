"use strict";

const { isClubAdmin } = require("./club-access");
const DAY = 86400000;
const FILES = ["video.mov", "report.json", "log.jsonl", "calibration.jpg", "calibration.json", "system_diagnostic.json"];
const milliseconds = value => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : NaN);

// Diagnostics-only retention. Never enumerate a bucket or touch athlete archives.
// Deployment starts disabled; a separate reviewed config write enables the sweep.
function createDiagnosticRetention({ db, bucket, FieldValue, HttpsError, now = Date.now }) {
  const ref = id => {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new HttpsError("invalid-argument", "Invalid incident ID.");
    return db.collection("failureCases").doc(id);
  };

  async function acknowledge(id) {
    const target = ref(id);
    return db.runTransaction(async tx => {
      const snapshot = await tx.get(target);
      const d = snapshot.data();
      if (!snapshot.exists || d.schemaVersion !== 2 || d.artifactUploadState !== "complete" || d.artifactsAcknowledgedAt) return false;
      tx.update(target, { artifactsAcknowledgedAt: FieldValue.serverTimestamp() });
      return true;
    });
  }

  async function protect(data, auth) {
    if (!isClubAdmin(auth)) throw new HttpsError("permission-denied", "Verified administrator required.");
    if (typeof data.hold !== "boolean" || !Array.isArray(data.references) || data.references.length > 64
        || data.references.some(v => typeof v !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(v))) {
      throw new HttpsError("invalid-argument", "Supply a hold and bounded reference IDs.");
    }
    const target = ref(data.incidentId);
    return db.runTransaction(async tx => {
      const snapshot = await tx.get(target);
      const d = snapshot.data();
      if (!snapshot.exists || d.schemaVersion !== 2) throw new HttpsError("not-found", "No schema-2 incident.");
      if (["videoDeleting", "allDeleting", "expired"].includes(d.retentionState)) {
        throw new HttpsError("failed-precondition", "Cleanup has already claimed this incident; retained artifacts cannot be promised.");
      }
      tx.update(target, { investigationHold: data.hold, artifactReferences: [...new Set(data.references)],
        retentionReviewedBy: auth.uid, retentionReviewedAt: FieldValue.serverTimestamp() });
      return { held: data.hold, references: data.references.length };
    });
  }

  async function cleanIncident(id) {
    const target = ref(id);
    const phase = await db.runTransaction(async tx => {
      const snapshot = await tx.get(target);
      const d = snapshot.data();
      if (!snapshot.exists || d.schemaVersion !== 2 || d.investigationHold === true
          || (d.artifactReferences?.length ?? 0) > 0 || d.retentionState === "expired") return null;
      if (d.storage?.prefix !== `failure_cases/${id}`) return null;
      // Recover an interrupted deletion using the already-persisted claim.
      if (["videoDeleting", "allDeleting"].includes(d.retentionState)) return d.retentionState;
      const lastSession = milliseconds(d.uploadSessionIssuedAt);
      if (Number.isFinite(lastSession) && now() - lastSession < 8 * DAY) return null;
      const acknowledged = milliseconds(d.artifactsAcknowledgedAt);
      if (d.artifactUploadState !== "complete" || !Number.isFinite(acknowledged)) return null;
      const age = now() - acknowledged;
      const next = age >= 30 * DAY ? "allDeleting"
        : age >= 7 * DAY && d.retentionState !== "videoExpired" ? "videoDeleting" : null;
      if (!next) return null;
      tx.update(target, { retentionState: next, retentionStartedAt: FieldValue.serverTimestamp() });
      return next;
    });
    if (!phase) return { skipped: true };
    // A failed object delete leaves the claim in place. Retries may repeat
    // successful deletions; 404 is success. Metadata remains an authorization
    // tombstone and an audit of expired evidence, not a promise of completeness.
    for (const name of phase === "videoDeleting" ? ["video.mov"] : FILES) {
      await bucket.file(`failure_cases/${id}/${name}`).delete({ ignoreNotFound: true });
    }
    await db.runTransaction(async tx => {
      const snapshot = await tx.get(target);
      if (snapshot.data()?.retentionState !== phase) throw new Error("Retention claim changed unexpectedly");
      tx.update(target, { retentionState: phase === "videoDeleting" ? "videoExpired" : "expired",
        retentionCompletedAt: FieldValue.serverTimestamp() });
    });
    return { state: phase === "videoDeleting" ? "videoExpired" : "expired" };
  }

  async function sweep() {
    const control = db.collection("config").doc("diagnosticsRetention");
    const config = (await control.get()).data() || {};
    if (config.enabled !== true) return { disabled: true };
    let query = db.collection("failureCases").orderBy("__name__").limit(50);
    if (typeof config.cursor === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(config.cursor)) query = query.startAfter(config.cursor);
    const batch = await query.get();
    const results = [];
    for (const snapshot of batch.docs) {
      try { results.push(await cleanIncident(snapshot.id)); }
      catch { results.push({ retryPending: true }); }
    }
    // A rotating bounded cursor avoids held/partial oldest rows starving later
    // candidates. A failed deletion is revisited on the next sweep cycle.
    await control.set({ cursor: batch.docs.length === 50 ? batch.docs.at(-1).id : null,
      lastSweepAt: FieldValue.serverTimestamp(), lastBatchCount: batch.docs.length }, { merge: true });
    return { checked: batch.docs.length, results };
  }
  return { acknowledge, protect, cleanIncident, sweep };
}
module.exports = { createDiagnosticRetention };
