"use strict";

const { drillOf, millis } = require("./insights-v2-qualification");

// A planning-only projection, never a rep, accepted result or testing event.
// The document is server-owned under insightMetadata. Call this only after
// authenticating the viewer; accountless/shared readers must not read it.
const WINDOW_MS = 180 * 86400000;
const METHOD = "constant_return_pace_v1";
const COD_METHOD = "partial_shuttle_visual_start_v1";
const METHODS = {
  dribbling: { method: METHOD, axis: "ballControl", minimumCourseFraction: 0.75,
    assumption: "Maintains the observed return pace to the finish.",
    limitation: "Finish was not recorded; this is a conditional estimate. The range is a sensitivity range, not a confidence interval." },
  changeOfDirection: { method: COD_METHOD, axis: "agility", minimumCourseFraction: 0.60,
    assumption: "Uses a visually bracketed start and assumes constant observed pace through the unrecorded return to the finish.",
    limitation: "Most of the return and the finish were not recorded. The visually bracketed start and constant-pace projection are conditional; the wide range is a sensitivity range, not a confidence interval." },
};
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const finite = value => typeof value === "number" && Number.isFinite(value);
const seconds = value => finite(value) && value >= 2 && value <= 60;
const date = value => Number.isSafeInteger(value) && value > 0;
const md5 = value => typeof value === "string" && /^[A-Za-z0-9+/]{22}==$/.test(value)
  && Buffer.from(value, "base64").length === 16 && Buffer.from(value, "base64").toString("base64") === value;

function validatedEntry(entry, playerId, rows, now) {
  const method = isObject(entry) && Object.hasOwn(METHODS, entry.drill) ? METHODS[entry.drill] : null;
  if (!isObject(entry) || !identifier(entry.id) || !identifier(entry.repId) || entry.status !== "active"
    || !method || entry.axis !== method.axis || entry.kind !== "conditionalEstimate"
    || entry.method !== method.method || entry.confidence !== "low" || !identifier(entry.reviewedByUid)) return null;
  if (entry.drill === "changeOfDirection" && (entry.protocolConfirmed !== true || entry.startBoundary !== "visualBracket")) return null;
  if (![entry.estimatedTotalSeconds, entry.lowerSeconds, entry.upperSeconds].every(seconds)
    || entry.lowerSeconds > entry.estimatedTotalSeconds || entry.estimatedTotalSeconds > entry.upperSeconds
    || entry.lowerSeconds === entry.upperSeconds || !finite(entry.observedCourseFraction)
    || entry.observedCourseFraction < method.minimumCourseFraction || entry.observedCourseFraction >= 1) return null;
  if (!date(entry.recordedAtMillis) || !date(entry.reviewedAtMillis)
    || entry.recordedAtMillis < now - WINDOW_MS || entry.recordedAtMillis > entry.reviewedAtMillis
    || entry.reviewedAtMillis > now) return null;
  const rep = rows.find(row => row.id === entry.repId);
  if (!rep || rep.repType !== entry.drill || rep.drillType !== entry.drill
    || rep.resultStatus?.qualified !== false || rep.resultStatus?.duplicate !== false
    || rep.createdAtMillis !== entry.recordedAtMillis || typeof rep.storageFolder !== "string" || !rep.storageFolder) return null;
  const source = entry.source;
  if (!isObject(source) || source.playerId !== playerId || source.repId !== entry.repId
    || source.drill !== entry.drill || source.recordedAtMillis !== entry.recordedAtMillis
    || typeof source.storagePath !== "string" || !source.storagePath.startsWith(rep.storageFolder + "/")
    || !/^[A-Za-z0-9_.-]+\.(mov|mp4)$/i.test(source.storagePath.slice(rep.storageFolder.length + 1))
    || typeof source.generation !== "string" || !/^[1-9][0-9]{0,30}$/.test(source.generation)
    || !md5(source.md5Hash) || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256)) return null;
  return {
    id: entry.id, repId: entry.repId, drill: entry.drill, axis: method.axis, kind: "conditionalEstimate", method: method.method,
    estimatedTotalSeconds: entry.estimatedTotalSeconds, lowerSeconds: entry.lowerSeconds, upperSeconds: entry.upperSeconds,
    observedCourseFraction: entry.observedCourseFraction, recordedAtMillis: entry.recordedAtMillis,
    reviewedAtMillis: entry.reviewedAtMillis, confidence: "low",
    assumption: method.assumption, limitation: method.limitation,
  };
}

async function readProvisionalEstimates({ db, bucket, playerId, reps, drill, now }) {
  if (!identifier(playerId) || !Array.isArray(reps) || !date(now) || (drill !== undefined && !Object.hasOwn(METHODS, drill))) return [];
  // A measured result supersedes only its own drill. Do not load private
  // provenance when no requested drill has an eligible incomplete attempt.
  const eligibleDrills = new Set(Object.keys(METHODS).filter(candidate => (drill === undefined || drill === candidate)
    && !reps.some(rep => rep.repType === candidate && rep.resultStatus?.qualified === true && rep.resultStatus?.duplicate === false)
    && reps.some(rep => rep.repType === candidate && rep.drillType === candidate
      && rep.resultStatus?.qualified === false && rep.resultStatus?.duplicate === false)));
  if (eligibleDrills.size === 0) return [];
  const snapshot = await db.collection("players").doc(playerId).collection("insightMetadata").doc("provisionalEstimates").get();
  const document = snapshot.data();
  if (!isObject(document) || document.schemaVersion !== 1 || document.playerId !== playerId
    || !Array.isArray(document.entries) || document.entries.length > 20) return [];
  const ids = new Map(), repIds = new Map();
  for (const entry of document.entries) if (isObject(entry)) {
    ids.set(entry.id, (ids.get(entry.id) || 0) + 1);
    repIds.set(entry.repId, (repIds.get(entry.repId) || 0) + 1);
  }
  const output = [];
  for (const entry of document.entries) {
    if (!isObject(entry) || !eligibleDrills.has(entry.drill)) continue;
    const projection = validatedEntry(entry, playerId, reps, now);
    if (!projection || ids.get(entry.id) !== 1 || repIds.get(entry.repId) !== 1) continue;
    // Require the current rep's exact movie pointer, not merely a neighboring
    // movie within the same folder. Missing legacy pointers need review first.
    const repSnapshot = await db.collection("players").doc(playerId).collection("reps").doc(entry.repId).get();
    const currentRep = repSnapshot.data();
    if (!currentRep || drillOf(currentRep) !== entry.drill
      || (currentRep.drillType !== undefined && currentRep.drillType !== entry.drill)
      || millis(currentRep.createdAt) !== entry.recordedAtMillis
      || currentRep.storagePath !== entry.source.storagePath) continue;
    let metadata;
    try { [metadata] = await bucket.file(entry.source.storagePath).getMetadata(); }
    catch (error) { if (Number(error.code) === 404) continue; throw error; }
    // The reviewed SHA256 is private provenance; matching the live immutable
    // generation and MD5 binds this projection to those reviewed source bytes.
    if (String(metadata.generation) !== entry.source.generation || metadata.md5Hash !== entry.source.md5Hash) continue;
    output.push(projection);
  }
  return output.sort((a, b) => b.reviewedAtMillis - a.reviewedAtMillis || a.id.localeCompare(b.id));
}

module.exports = { readProvisionalEstimates, validatedEntry, WINDOW_MS, METHOD, COD_METHOD };
