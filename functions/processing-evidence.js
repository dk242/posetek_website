"use strict";

const { storageFolderCandidates } = require("./athlete-storage-paths");
const { drillOf } = require("./insights-v2-qualification");

function failureMatchesRep(failure, rep, folders) {
  if (failure.repId !== null && failure.repId !== undefined && failure.repId !== "") return failure.repId === rep.id;
  if (failure.sessionDocId && rep.sessionId && failure.sessionDocId !== rep.sessionId) return false;
  const folder = failure.storage?.repArtifactFolder;
  if (typeof folder === "string" && folders.includes(folder.replace(/\/$/, ""))) return true;
  const failureDrill = drillOf({ drillType: failure.drillType });
  if (failureDrill === "unknown" || failureDrill !== drillOf(rep) || !Number.isSafeInteger(failure.repNumber)
    || failure.repNumber !== rep.repNumber) return false;
  return Boolean((failure.sessionDocId && rep.sessionId && failure.sessionDocId === rep.sessionId)
    || (Number.isSafeInteger(failure.sessionNumber) && failure.sessionNumber > 0 && failure.sessionNumber === rep.sessionNumber));
}
function contextIdentityMatches(context, playerId, rep) {
  const identity = context?.rep;
  if (!identity || typeof identity !== "object") return null;
  if ((identity.repId && identity.repId !== rep.id) || (identity.playerDocId && identity.playerDocId !== playerId)
    || (identity.sessionDocId && rep.sessionId && identity.sessionDocId !== rep.sessionId)
    || (identity.captureId && rep.captureId && identity.captureId !== rep.captureId)) return false;
  return identity.repId === rep.id && identity.playerDocId === playerId ? true : null;
}
function createProcessingEvidenceReader({ db, bucket, HttpsError, readEvidence: injectedEvidence }) {
  async function readJson(name) {
    let metadata;
    try { [metadata] = await bucket.file(name).getMetadata(); } catch (error) { if (Number(error.code) === 404) return null; throw error; }
    if (!Number.isFinite(Number(metadata.size)) || Number(metadata.size) > 2 * 1024 * 1024) throw new HttpsError("resource-exhausted", "A processing evidence file is too large to verify.");
    const [bytes] = await bucket.file(name, { generation: metadata.generation }).download();
    if (bytes.length > 2 * 1024 * 1024) throw new HttpsError("resource-exhausted", "A processing evidence file is too large to verify.");
    try { return JSON.parse(bytes.toString("utf8")); } catch { return null; }
  }
  async function readEvidence(playerId, rep, cache = new Map(), failures = []) {
    const fallback = { failures: failures.filter(f => failureMatchesRep(f, rep, [])) };
    if (injectedEvidence) return { ...fallback, ...await injectedEvidence(playerId, rep) };
    const coordinates = Number.isSafeInteger(rep.sessionNumber) && rep.sessionNumber > 0 && Number.isSafeInteger(rep.repNumber) && rep.repNumber > 0;
    if (!rep.storagePath && !coordinates) return fallback;
    let folders;
    try { folders = storageFolderCandidates(playerId, drillOf(rep), rep, bucket.name); if (!coordinates) folders = folders.slice(0, 1); } catch { return fallback; }
    let artifact = {};
    for (const folder of folders) {
      if (!cache.has(folder)) cache.set(folder, Promise.all([readJson(`${folder}/metadata.json`), readJson(`${folder}/reprocess_context.json`)]));
      const [metadata, context] = await cache.get(folder);
      if (metadata || context) {
        artifact = { folder, metadata, context, identityConflict: contextIdentityMatches(context, playerId, rep) === false };
        if (drillOf(rep) === "jump" && !Object.hasOwn(rep, "peakFrame") && !artifact.identityConflict) {
          const [keyFrames, torso] = await Promise.all([readJson(`${folder}/key_frames.json`), readJson(`${folder}/torso_midpoints.json`)]);
          artifact.keyFrames = keyFrames;
          artifact.frameCount = Array.isArray(torso) ? torso.length : null;
        }
        // An explicit path is authoritative. Do not silently switch to another
        // recording at reused numeric coordinates when its identity disagrees.
        break;
      }
    }
    let revision = null;
    const revisionId = rep.adminRevision?.revisionId;
    if (typeof revisionId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(revisionId)) {
      const snap = await db.collection("players").doc(playerId).collection("reps").doc(rep.id).collection("revisions").doc(revisionId).get();
      revision = snap.exists ? snap.data() : null;
    }
    return { ...artifact, revision, failures: failures.filter(f => failureMatchesRep(f, rep, folders)) };
  }
  return { readJson, readEvidence };
}
module.exports = { createProcessingEvidenceReader, failureMatchesRep, contextIdentityMatches };
