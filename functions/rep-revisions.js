"use strict";

// Admin rep revisions — the write half of the website's rep tools.
//
// Firestore and Storage rules deliberately deny every client, admins
// included, any write to `players/{id}/reps` and to athlete recording folders.
// A PoseTek admin who has re-annotated a rep therefore hands the re-derived
// result to this callable, which verifies the caller the way the rules do
// (verified @posetek.net token), snapshots what is there today, and only then
// overwrites the rep document and its `metadata.json` in place — same repId,
// same session, same `repCount`, so dashboards, leaderboards and the phone's
// session viewer all pick the corrected numbers up without a new rep
// appearing anywhere.
//
// Every revision is recoverable: the previous rep document is kept under
// `players/{id}/reps/{repId}/revisions/{revisionId}` and the previous
// metadata.json under `{repFolder}/admin_revisions/{revisionId}/`.

const { isClubAdmin } = require("./club-access");
const { playerSegment, storageFolderCandidates } = require("./athlete-storage-paths");

const REP_TYPES = Object.freeze({
  shooting: ["side_kick", "deadballShot", "shooting"],
  sprint: ["sprint"],
  jump: ["jump"],
  broadJump: ["broadJump"],
  changeOfDirection: ["changeOfDirection"],
  dribbling: ["dribbling"],
});

const SHUTTLE_NUMBER_FIELDS = [
  "totalTime", "totalDistance", "outboundDistance", "returnDistance",
  "phase1Time", "phase2Time", "phase3Time", "phase1Percent", "phase2Percent", "phase3Percent",
  "avgBallDistance", "markerDistance",
];
const SHUTTLE_FRAME_FIELDS = ["startFrame", "apexFrame", "endFrame", "phase1EndFrame", "phase2EndFrame"];

// What an admin may overwrite, per drill. Anything else on the document
// (identity, ordering, timestamps, storage pointers) is never touched.
const FIELD_RULES = Object.freeze({
  changeOfDirection: { numbers: SHUTTLE_NUMBER_FIELDS, frames: SHUTTLE_FRAME_FIELDS, strings: { gateStartSide: ["left", "right"] } },
  dribbling: { numbers: SHUTTLE_NUMBER_FIELDS, frames: SHUTTLE_FRAME_FIELDS, strings: { gateStartSide: ["left", "right"] } },
  sprint: {
    numbers: ["max_velocity", "maxVelocity", "average_velocity", "averageVelocity", "max_acceleration", "maxAcceleration", "time_to_max_velocity", "timeToMaxVelocity", "totalTime", "distance"],
    frames: ["startFrame", "endFrame"],
    strings: {},
  },
  jump: { numbers: ["jumpHeight"], frames: ["takeoffFrame", "peakFrame", "apexFrame", "landingFrame"], strings: {} },
  broadJump: { numbers: ["broadJumpDistance", "jumpHeight"], frames: ["takeoffFrame", "landingFrame"], strings: {} },
  shooting: { numbers: ["velocity", "launch_angle", "launchAngle"], frames: ["contact_frame", "transition_frame"], strings: { strike_foot: ["left", "right"], direction: ["left", "right"] } },
});

const METADATA_EXTRA_KEYS = ["failedSteps", "processingStatus", "resultsValid"];
const MAX_ANNOTATION_BYTES = 4 * 1024 * 1024;
const MAX_NOTE_LENGTH = 2000;
const MAX_REVISIONS_LISTED = 50;

function createRepRevisions({ db, bucket, FieldValue, HttpsError, now = () => Date.now(), randomHex = () => Math.random().toString(16).slice(2, 10) }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };

  function requireAdmin(auth) {
    if (!auth?.uid || auth.isAnonymous) fail("unauthenticated", "Sign in to continue.");
    if (!isClubAdmin(auth)) fail("permission-denied", "Only a verified PoseTek admin can revise a rep.");
  }

  function drillOf(value) {
    return Object.hasOwn(REP_TYPES, String(value)) ? String(value) : fail("invalid-argument", "Choose a supported drill.");
  }

  function repIdOf(value) {
    const id = typeof value === "string" ? value.trim() : "";
    if (!id || id.length > 200 || /[/\\]/.test(id) || id === "." || id === "..") fail("invalid-argument", "Enter a valid rep.");
    return id;
  }

  function repMatchesDrill(rep, drill) {
    const accepted = REP_TYPES[drill];
    return accepted.includes(rep.repType) || accepted.includes(rep.drillType);
  }

  /** Only allow-listed keys, each with the value shape the phone writes. */
  function sanitizeFields(drill, input) {
    if (input === undefined || input === null) return {};
    if (typeof input !== "object" || Array.isArray(input)) fail("invalid-argument", "Fields must be an object.");
    const rules = FIELD_RULES[drill];
    const out = {};
    for (const [key, value] of Object.entries(input)) {
      if (rules.numbers.includes(key)) {
        if (value === null) { out[key] = null; continue; }
        if (typeof value !== "number" || !Number.isFinite(value)) fail("invalid-argument", `${key} must be a number or null.`);
        out[key] = value;
      } else if (rules.frames.includes(key)) {
        if (value === null) { out[key] = null; continue; }
        if (!Number.isInteger(value) || value < 0 || value > 10_000_000) fail("invalid-argument", `${key} must be a frame index or null.`);
        out[key] = value;
      } else if (Object.hasOwn(rules.strings, key)) {
        if (value === null) { out[key] = null; continue; }
        if (!rules.strings[key].includes(value)) fail("invalid-argument", `${key} must be one of ${rules.strings[key].join(", ")}.`);
        out[key] = value;
      } else {
        fail("invalid-argument", `${key} is not a field the rep tools may change.`);
      }
    }
    return out;
  }

  function sanitizeMetadata(drill, input) {
    if (input === undefined || input === null) return {};
    if (typeof input !== "object" || Array.isArray(input)) fail("invalid-argument", "Metadata must be an object.");
    const extras = {};
    const rest = {};
    for (const [key, value] of Object.entries(input)) {
      if (METADATA_EXTRA_KEYS.includes(key)) extras[key] = value; else rest[key] = value;
    }
    const out = sanitizeFields(drill, rest);
    if ("failedSteps" in extras) {
      const steps = extras.failedSteps;
      if (!Array.isArray(steps) || steps.length > 50 || steps.some((step) => typeof step !== "string" || step.length > 100)) fail("invalid-argument", "failedSteps must be a short list of step ids.");
      out.failedSteps = steps;
    }
    if ("processingStatus" in extras) {
      if (!["complete", "partial"].includes(extras.processingStatus)) fail("invalid-argument", "processingStatus must be complete or partial.");
      out.processingStatus = extras.processingStatus;
    }
    if ("resultsValid" in extras) {
      if (typeof extras.resultsValid !== "boolean") fail("invalid-argument", "resultsValid must be a boolean.");
      out.resultsValid = extras.resultsValid;
    }
    return out;
  }

  function sanitizeAnnotations(input) {
    if (input === undefined || input === null) return null;
    if (typeof input !== "object" || Array.isArray(input)) fail("invalid-argument", "Annotations must be an object.");
    const text = JSON.stringify(input);
    if (Buffer.byteLength(text, "utf8") > MAX_ANNOTATION_BYTES) fail("invalid-argument", "The annotation file is too large.");
    return input;
  }

  function noteOf(value) {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value !== "string" || value.length > MAX_NOTE_LENGTH) fail("invalid-argument", `Keep the note under ${MAX_NOTE_LENGTH} characters.`);
    return value.trim();
  }

  async function readJsonFile(file) {
    const [exists] = await file.exists();
    if (!exists) return { exists: false, raw: null, value: null };
    const [buffer] = await file.download();
    const raw = buffer.toString("utf8");
    let value = null;
    try {
      // The phone can emit bare NaN / Infinity tokens (PythonCompatibleJSON).
      value = JSON.parse(raw.replace(/(?<=[[,:\s])-?(?:NaN|Infinity)(?=[\],}\s])/g, "null"));
    } catch (_) {
      value = null;
    }
    return { exists: true, raw, value };
  }

  async function resolveFolder(playerId, drill, rep) {
    let candidates;
    try {
      candidates = storageFolderCandidates(playerId, drill, rep, bucket.name);
    } catch (error) {
      fail("failed-precondition", `This rep's storage path cannot be resolved: ${error.message}`);
    }
    for (const folder of candidates) {
      const [metadataExists, poseExists] = await Promise.all([
        bucket.file(`${folder}/metadata.json`).exists().then(([exists]) => exists),
        bucket.file(`${folder}/pose.json`).exists().then(([exists]) => exists),
      ]);
      if (metadataExists || poseExists) return folder;
    }
    return candidates[0];
  }

  function saveJson(path, value) {
    return bucket.file(path).save(JSON.stringify(value), { resumable: false, contentType: "application/json", metadata: { cacheControl: "no-cache" } });
  }

  function revisionRef(playerId, repId, revisionId) {
    return db.collection("players").doc(playerId).collection("reps").doc(repId).collection("revisions").doc(revisionId);
  }

  function makeRevisionId() {
    const stamp = new Date(now()).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    return `${stamp}-${randomHex()}`;
  }

  /**
   * Overwrite one rep with an admin's re-derived values. Order of operations:
   * back up metadata.json → transactionally snapshot + overwrite the rep
   * document → write the new metadata.json and the annotation file. If the
   * artifact writes fail after the document commit, the document is restored
   * from the snapshot and the revision is withdrawn, so the two never disagree.
   */
  async function reviseRep(data, auth) {
    requireAdmin(auth);
    const playerId = playerSegment(data?.playerId) ? data.playerId : fail("invalid-argument", "Enter a valid athlete.");
    const repId = repIdOf(data?.repId);
    const drill = drillOf(data?.drill);
    const fields = sanitizeFields(drill, data?.fields);
    const metadataPatch = sanitizeMetadata(drill, data?.metadata);
    const annotations = sanitizeAnnotations(data?.annotations);
    const note = noteOf(data?.note);
    if (!Object.keys(fields).length && !Object.keys(metadataPatch).length && !annotations) fail("invalid-argument", "There is nothing to push.");

    const repRef = db.collection("players").doc(playerId).collection("reps").doc(repId);
    const repDoc = await repRef.get();
    if (!repDoc.exists) fail("not-found", "That rep no longer exists.");
    const existing = repDoc.data() || {};
    if (!repMatchesDrill(existing, drill)) fail("failed-precondition", "That rep is not a rep of this drill.");

    const folder = await resolveFolder(playerId, drill, existing);
    const revisionId = makeRevisionId();
    const metadataFile = bucket.file(`${folder}/metadata.json`);
    const previousMetadata = await readJsonFile(metadataFile);
    const backupPrefix = `${folder}/admin_revisions/${revisionId}`;
    if (previousMetadata.exists) {
      await bucket.file(`${backupPrefix}/metadata.json`).save(previousMetadata.raw, { resumable: false, contentType: "application/json" });
    }
    await saveJson(`${backupPrefix}/rep.json`, { repId, playerId, drill, previous: existing });

    const stampMillis = now();
    const revision = {
      schemaVersion: 1,
      revisionId,
      repId,
      playerId,
      drill,
      method: "manual_annotation",
      byUid: auth.uid,
      byEmail: auth.email || null,
      note,
      fields,
      metadataPatch,
      folder,
      metadataBackedUp: previousMetadata.exists,
      annotationsWritten: Boolean(annotations),
      previous: existing,
      createdAtMillis: stampMillis,
      createdAt: FieldValue.serverTimestamp(),
    };
    const provenance = { revisionId, method: "manual_annotation", byUid: auth.uid, byEmail: auth.email || null, atMillis: stampMillis, note: note || null };
    const next = { ...existing, ...fields, adminRevision: provenance, adminRevisedAt: FieldValue.serverTimestamp() };

    await db.runTransaction(async (transaction) => {
      const fresh = await transaction.get(repRef);
      if (!fresh.exists) fail("not-found", "That rep no longer exists.");
      transaction.set(revisionRef(playerId, repId, revisionId), revision);
      transaction.set(repRef, next);
    });

    try {
      const merged = { ...(previousMetadata.value && typeof previousMetadata.value === "object" ? previousMetadata.value : {}), ...metadataPatch, adminRevision: provenance };
      if (previousMetadata.value && Array.isArray(previousMetadata.value.failedSteps) && "failedSteps" in metadataPatch) {
        merged.adminRevision = { ...provenance, previousFailedSteps: previousMetadata.value.failedSteps };
      }
      await saveJson(`${folder}/metadata.json`, merged);
      if (annotations) await saveJson(`${folder}/admin_annotations.json`, { ...annotations, revisionId, playerId, repId, drill });
    } catch (error) {
      await db.runTransaction(async (transaction) => {
        transaction.set(repRef, existing);
        transaction.delete(revisionRef(playerId, repId, revisionId));
      });
      fail("internal", `The rep document was left unchanged because its artifacts could not be written: ${error.message}`);
    }

    return { revisionId, folder, rep: { id: repId, ...next, adminRevisedAt: null } };
  }

  /** Put a rep back the way it was before one revision (document and metadata.json). */
  async function restoreRepRevision(data, auth) {
    requireAdmin(auth);
    const playerId = playerSegment(data?.playerId) ? data.playerId : fail("invalid-argument", "Enter a valid athlete.");
    const repId = repIdOf(data?.repId);
    const revisionId = typeof data?.revisionId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(data.revisionId) ? data.revisionId : fail("invalid-argument", "Choose a revision.");
    const ref = revisionRef(playerId, repId, revisionId);
    const doc = await ref.get();
    if (!doc.exists) fail("not-found", "That revision does not exist.");
    const revision = doc.data();
    if (revision.restoredAtMillis) fail("failed-precondition", "That revision was already restored.");
    const repRef = db.collection("players").doc(playerId).collection("reps").doc(repId);

    const backup = bucket.file(`${revision.folder}/admin_revisions/${revisionId}/metadata.json`);
    const [hasBackup] = await backup.exists();
    if (hasBackup) {
      const [buffer] = await backup.download();
      await bucket.file(`${revision.folder}/metadata.json`).save(buffer, { resumable: false, contentType: "application/json", metadata: { cacheControl: "no-cache" } });
    } else if (revision.metadataBackedUp === false) {
      const current = bucket.file(`${revision.folder}/metadata.json`);
      const [exists] = await current.exists();
      if (exists) await current.delete();
    }

    await db.runTransaction(async (transaction) => {
      transaction.set(repRef, revision.previous || {});
      transaction.update(ref, { restoredAtMillis: now(), restoredByUid: auth.uid, restoredAt: FieldValue.serverTimestamp() });
    });
    return { revisionId, rep: { id: repId, ...(revision.previous || {}) } };
  }

  return { reviseRep, restoreRepRevision, FIELD_RULES, MAX_REVISIONS_LISTED };
}

module.exports = { createRepRevisions, REP_TYPES, FIELD_RULES };
