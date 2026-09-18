"use strict";

const { playerSegment, storageFolderCandidates } = require("./athlete-storage-paths");
const { isClubAdmin, clubStaffCanAccessPlayer } = require("./club-access");
const { EXERCISES, millis, drillOf, duplicateIds, qualifyRep } = require("./insights-v2-qualification");
const { completeQuery, mapBounded } = require("./insights-v2-projection");
const { createProcessingEvidenceReader, contextIdentityMatches } = require("./processing-evidence");
const { readProvisionalEstimates } = require("./provisional-estimates");
const NUMBERS = ["jumpHeight", "jump_height_m", "jump_height_in", "jump_height_inches", "broadJumpDistance", "velocity", "max_velocity", "maxVelocity", "average_velocity", "averageVelocity", "max_acceleration", "maxAcceleration", "time_to_max_velocity", "timeToMaxVelocity", "totalTime", "distance", "totalDistance", "outboundDistance", "returnDistance", "phase1Time", "phase2Time", "phase3Time", "phase1Percent", "phase2Percent", "phase3Percent", "avgBallDistance", "markerDistance", "launch_angle", "launchAngle", "startFrame", "endFrame", "apexFrame", "peakFrame", "takeoffFrame", "landingFrame", "phase1EndFrame", "phase2EndFrame", "contact_frame", "transition_frame"];
const LABELS = ["strike_foot", "dribble_foot", "footSide", "direction", "gateStartSide"];
const ARTIFACTS = Object.freeze({
  shooting: ["pose.json", "metadata.json", "ball_detections.json", "ball_information.json", "ball_trajectory.json"],
  sprint: ["pose.json", "metadata.json", "com_midpoints.json", "com_velocity.json"],
  jump: ["pose.json", "metadata.json", "com_height.json", "torso_midpoints.json", "key_frames.json"],
  broadJump: ["pose.json", "metadata.json", "foot_piecewise_fit.json", "key_frames.json", "foot_centers.json", "com_midpoints.json", "com_height.json"],
  changeOfDirection: ["pose.json", "metadata.json"], dribbling: ["pose.json", "metadata.json"],
});
const TTL_MS = 15 * 60 * 1000;
function resultStatus(rep, qualified) {
  return { qualified: Boolean(qualified.qualified), reason: qualified.reason, duplicate: Boolean(qualified.duplicate),
    revisionId: qualified.reason === "acceptedRevision" ? rep.adminRevision.revisionId : null };
}
function effectiveRep(rep, evidence, duplicate) {
  const qualification = qualifyRep(rep, evidence, duplicate);
  const output = { id: rep.id, repType: drillOf(rep), drillType: drillOf(rep), createdAtMillis: millis(rep.createdAt),
    resultStatus: resultStatus(rep, qualification) };
  for (const key of ["sessionNumber", "repNumber", "absoluteRepNumber"]) output[key] = Number.isSafeInteger(rep[key]) && rep[key] > 0 ? rep[key] : null;
  for (const key of ["sessionId", "trainingSessionId"]) if (playerSegment(rep[key])) output[key] = rep[key];
  if (typeof rep.captureId === "string" && /^[a-f0-9]{32}$/.test(rep.captureId)) output.captureId = rep.captureId;
  for (const key of NUMBERS) {
    // Explicit nulls from reviewed revisions must never be revived by metadata.
    const value = Object.hasOwn(rep, key) ? rep[key] : evidence.metadata?.[key];
    output[key] = qualification.qualified && typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  if (qualification.qualified && qualification.metric?.field === "jumpHeight") output.jumpHeight = qualification.metric.value;
  if (drillOf(rep) === "broadJump" && (!(output.jumpHeight > 0)
    || rep.metricValidity?.jumpHeight === false || evidence.metadata?.metricValidity?.jumpHeight === false)) output.jumpHeight = null;
  if (["jump", "broadJump"].includes(drillOf(rep))) {
    output.jump_height_m = output.jumpHeight;
    output.jump_height_in = output.jumpHeight === null ? null : output.jumpHeight * 39.37007874015748;
    output.jump_height_inches = output.jump_height_in;
  }
  if (drillOf(rep) === "jump" && qualification.qualified && !Object.hasOwn(rep, "peakFrame") && output.peakFrame === null) {
    const frames = evidence.keyFrames;
    if (Array.isArray(frames) && frames.length === 4 && Number.isSafeInteger(evidence.frameCount) && evidence.frameCount > 0
      && frames.every((frame, index) => Number.isSafeInteger(frame) && frame >= 0 && frame < evidence.frameCount && (!index || frame >= frames[index - 1]))) output.peakFrame = frames[3];
  }
  for (const [a, b] of [["max_velocity", "maxVelocity"], ["average_velocity", "averageVelocity"], ["max_acceleration", "maxAcceleration"], ["time_to_max_velocity", "timeToMaxVelocity"], ["launch_angle", "launchAngle"]]) {
    const sources = qualification.reason === "acceptedRevision" ? [evidence.revision?.fields, rep, evidence.metadata] : [rep, evidence.metadata];
    const source = sources.find(value => value && (Object.hasOwn(value, a) || Object.hasOwn(value, b)));
    const raw = source && (Object.hasOwn(source, a) ? source[a] : source[b]);
    const value = qualification.qualified && typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    output[a] = value; output[b] = value;
  }
  for (const key of LABELS) {
    const value = Object.hasOwn(rep, key) ? rep[key] : evidence.metadata?.[key];
    output[key] = qualification.qualified && typeof value === "string" && /^[A-Za-z_-]{1,40}$/.test(value) ? value : null;
  }
  return output;
}
function createEffectiveResults({ db, bucket, HttpsError, now = () => Date.now(), readEvidence: injectedEvidence }) {
  const reader = createProcessingEvidenceReader({ db, bucket, HttpsError, readEvidence: injectedEvidence });
  const fail = (code, message) => { throw new HttpsError(code, message); };
  async function authorize(playerId, auth) {
    if (!auth?.uid || auth.isAnonymous) fail("unauthenticated", "Sign in to view results.");
    if (!playerSegment(playerId)) fail("invalid-argument", "Choose a valid player.");
    const snapshot = await db.collection("players").doc(playerId).get();
    if (!snapshot.exists) fail("permission-denied", "You do not have access to these results.");
    const player = snapshot.data();
    if (isClubAdmin(auth)) return;
    const bindings = ["authenticationUID", "userUID"].filter(key => Object.hasOwn(player, key));
    if (bindings.length ? bindings.every(key => player[key] === auth.uid) : playerId === auth.uid) return;
    if (Object.hasOwn(player, "organizationId")) {
      if (await clubStaffCanAccessPlayer(db, auth.uid, player)) return;
    } else {
      const candidates = await completeQuery(db.collection("coaches").where("userUID", "==", auth.uid), 20, HttpsError);
      if (candidates.some(doc => {
        const coach = doc.data();
        return coach.userUID === auth.uid && ((Array.isArray(coach.members) && coach.members.includes(playerId))
          || [player.coachUID, player.coachId, player.coachDocId].some(id => id === auth.uid || id === doc.id));
      })) return;
    }
    fail("permission-denied", "You do not have access to these results.");
  }
  function validateDrill(drill, optional = false) {
    if (optional && drill === undefined) return;
    if (!EXERCISES.includes(drill)) fail("invalid-argument", "Choose a supported test.");
  }
  async function inventory(playerId) {
    if (!playerSegment(playerId)) fail("invalid-argument", "Choose a valid player.");
    const [docs, failures, corrections] = await Promise.all([
      completeQuery(db.collection("players").doc(playerId).collection("reps"), 20000, HttpsError),
      completeQuery(db.collection("failureCases").where("playerDocumentID", "==", playerId), 5000, HttpsError),
      db.collection("players").doc(playerId).collection("insightMetadata").doc("resultCorrections").get(),
    ]);
    const reps = docs.map(doc => ({ ...doc.data(), id: doc.id }));
    return { playerId, reps, failures: failures.map(doc => ({ ...doc.data(), id: doc.id })), duplicates: duplicateIds(reps, corrections.data()) };
  }
  function resolvedFolder(playerId, rep, evidence, reps, duplicates) {
    if (duplicates.has(rep.id) || contextIdentityMatches(evidence.context, playerId, rep) === false) return null;
    let folder = evidence.folder;
    if (!folder) {
      try { folder = storageFolderCandidates(playerId, drillOf(rep), rep, bucket.name)[0]; } catch { return null; }
    }
    const collision = reps.some(other => {
      if (other.id === rep.id || duplicates.has(other.id) || drillOf(other) !== drillOf(rep)) return false;
      try { return storageFolderCandidates(playerId, drillOf(other), other, bucket.name).includes(folder); } catch { return false; }
    });
    return contextIdentityMatches(evidence.context, playerId, rep) === true || !collision ? folder : null;
  }
  async function listForPlayer(playerId, drill, includeStorageFolder = false) {
    validateDrill(drill, true);
    const { reps, failures, duplicates } = await inventory(playerId), cache = new Map();
    const selected = reps.filter(rep => EXERCISES.includes(drillOf(rep)) && (!drill || drillOf(rep) === drill));
    const rows = await mapBounded(selected, 8, async rep => {
      const evidence = duplicates.has(rep.id) ? {} : await reader.readEvidence(playerId, rep, cache, failures);
      const row = effectiveRep(rep, evidence, duplicates.has(rep.id));
      // Authenticated native readers need exact capture identity for navigation.
      // Shared rows continue to use the scoped media endpoint only.
      if (includeStorageFolder) row.storageFolder = resolvedFolder(playerId, rep, evidence, reps, duplicates);
      return row;
    });
    rows.sort((a, b) => (b.createdAtMillis || 0) - (a.createdAtMillis || 0) || (b.absoluteRepNumber || 0) - (a.absoluteRepNumber || 0) || a.id.localeCompare(b.id));
    return { version: 1, reps: rows };
  }
  async function getResults(data, auth) {
    await authorize(data?.playerId, auth);
    const result = await listForPlayer(data.playerId, data.drill, true);
    const provisionalEstimates = await readProvisionalEstimates({ db, bucket, playerId: data.playerId,
      reps: result.reps, drill: data.drill, now: now() });
    await authorize(data.playerId, auth);
    return { ...result, provisionalEstimates };
  }
  async function signedFile(name, expires, sign = true, onInspected) {
    let meta;
    try { [meta] = await bucket.file(name).getMetadata(); } catch (error) { if (Number(error.code) === 404) return null; throw error; }
    // Pin URLs to the inspected generation so a later overwrite cannot change
    // the video or JSON behind a response already authorized for this attempt.
    onInspected?.(meta);
    if (!sign) return true;
    const [url] = await bucket.file(name, { generation: meta.generation }).getSignedUrl({ action: "read", expires });
    return url;
  }
  async function mediaForPlayer(playerId, drill, repId, options = {}) {
    validateDrill(drill);
    if (typeof repId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(repId)) fail("invalid-argument", "Choose a valid recording.");
    // Internal callers may share one inventory across a bounded media list.
    // No callable forwards client-provided options into this method.
    const snapshot = options.inventory || await inventory(playerId);
    if (snapshot.playerId !== playerId) fail("invalid-argument", "Media inventory owner does not match.");
    const { reps, failures, duplicates } = snapshot;
    const rep = reps.find(rep => rep.id === repId && drillOf(rep) === drill);
    if (!rep) fail("not-found", "The recording is unavailable.");
    const evidence = await reader.readEvidence(playerId, rep, options.evidenceCache || new Map(), failures);
    const status = resultStatus(rep, qualifyRep(rep, evidence, duplicates.has(rep.id)));
    const ttlMs = Number.isFinite(options.ttlMs) ? Math.max(1000, Math.min(TTL_MS, options.ttlMs)) : TTL_MS;
    const expiresAtMillis = now() + ttlMs;
    const response = { artifactUrls: {}, mediaUrl: null, source: "unavailable", expiresAtMillis, resultStatus: status };
    let folder = evidence.folder;
    if (!folder) {
      try { folder = storageFolderCandidates(playerId, drill, rep, bucket.name)[0]; } catch { folder = null; }
    }
    const identity = contextIdentityMatches(evidence.context, playerId, rep);
    const collision = reps.some(other => {
      if (other.id === rep.id || duplicates.has(other.id) || drillOf(other) !== drill) return false;
      try { return storageFolderCandidates(playerId, drill, other, bucket.name).includes(folder); } catch { return false; }
    });
    const useFolder = folder && !duplicates.has(rep.id) && identity !== false && (identity === true || !collision);
    if (useFolder) {
      const entries = await mapBounded(options.includeArtifacts === false ? [] : ARTIFACTS[drill], 6, async name => [name, await signedFile(`${folder}/${name}`, expiresAtMillis)]);
      response.artifactUrls = Object.fromEntries(entries.filter(([, url]) => url));
      const [files] = await bucket.getFiles({ prefix: `${folder}/`, maxResults: 100, autoPaginate: false });
      const movies = files.filter(file => /^[A-Za-z0-9_.-]+\.(mov|mp4)$/i.test(file.name.slice(folder.length + 1))).sort((a, b) => a.name.localeCompare(b.name));
      const claimedPath = evidence.context?.rep?.videoStoragePath;
      const movie = claimedPath ? movies.find(file => file.name === claimedPath) : movies.length === 1 ? movies[0] : null;
      let movieGeneration;
      if (movie) response.mediaUrl = await signedFile(movie.name, expiresAtMillis, options.sign !== false, meta => { movieGeneration = String(meta.generation || ""); });
      if (response.mediaUrl) response.source = "recording";
      // Server-only projection hook; no callable forwards caller options here.
      // The social surface receives sanitized inline drawings, never these
      // private binding/artifact details or the ordinary artifact URLs.
      if (response.mediaUrl && status.qualified && typeof options.onRecording === "function") {
        await options.onRecording({ playerId, rep, effectiveRep: effectiveRep(rep, evidence, duplicates.has(rep.id)), evidence, folder, movieName: movie.name, movieGeneration });
      }
    }
    if (!response.mediaUrl && !duplicates.has(rep.id)) {
      // The report itself must independently match both owner and exact rep.
      // Never sign arbitrary paths or disclose report/log contents to viewers.
      for (const failure of failures.filter(f => f.repId === rep.id && f.playerDocumentID === playerId)) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(failure.id)) continue;
        const prefix = `failure_cases/${failure.id}`;
        if (failure.storage?.reportPath !== `${prefix}/report.json`) continue;
        const report = await reader.readJson(`${prefix}/report.json`);
        const reportOwners = [report?.playerDocumentID, report?.clip?.playerDocId].filter(value => value !== undefined && value !== null);
        if (report?.repId !== rep.id || reportOwners.some(owner => owner !== playerId)) continue;
        // Original native reports identify the owner through clip.storagePath,
        // while newer envelopes may include it explicitly. Validate that path
        // with the same owner/drill boundary used by the recording signer.
        if (report?.clip?.storagePath) {
          try { storageFolderCandidates(playerId, drill, { storagePath: report.clip.storagePath }, bucket.name); } catch { continue; }
        } else if (!reportOwners.length) continue;
        const mediaUrl = await signedFile(`${prefix}/video.mov`, expiresAtMillis, options.sign !== false);
        if (mediaUrl) { response.mediaUrl = mediaUrl; response.source = "diagnostic"; break; }
      }
    }
    return response;
  }
  async function getMedia(data, auth) {
    await authorize(data?.playerId, auth);
    const result = await mediaForPlayer(data.playerId, data.drill, data.repId);
    await authorize(data.playerId, auth);
    return result;
  }
  return { getResults, getMedia, listForPlayer, mediaForPlayer, getMediaInventory: inventory, authorize };
}
module.exports = { createEffectiveResults, effectiveRep, resultStatus, ARTIFACTS };
