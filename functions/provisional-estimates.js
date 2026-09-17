"use strict";

const { drillOf, millis } = require("./insights-v2-qualification");

// A planning-only projection, never a rep, accepted result or testing event.
// The document is server-owned under insightMetadata. Call this only after
// authenticating the viewer; accountless/shared readers must not read it.
const WINDOW_MS = 180 * 86400000;
const METHOD = "constant_return_pace_v1";
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const finite = value => typeof value === "number" && Number.isFinite(value);
const seconds = value => finite(value) && value >= 2 && value <= 60;
const date = value => Number.isSafeInteger(value) && value > 0;
const md5 = value => typeof value === "string" && /^[A-Za-z0-9+/]{22}==$/.test(value)
  && Buffer.from(value, "base64").length === 16 && Buffer.from(value, "base64").toString("base64") === value;

function validatedEntry(entry, playerId, rows, now) {
  if (!isObject(entry) || !identifier(entry.id) || !identifier(entry.repId) || entry.status !== "active"
    || entry.drill !== "dribbling" || entry.axis !== "ballControl" || entry.kind !== "conditionalEstimate"
    || entry.method !== METHOD || entry.confidence !== "low" || !identifier(entry.reviewedByUid)) return null;
  if (![entry.estimatedTotalSeconds, entry.lowerSeconds, entry.upperSeconds].every(seconds)
    || entry.lowerSeconds > entry.estimatedTotalSeconds || entry.estimatedTotalSeconds > entry.upperSeconds
    || entry.lowerSeconds === entry.upperSeconds || !finite(entry.observedCourseFraction)
    || entry.observedCourseFraction < 0.75 || entry.observedCourseFraction >= 1) return null;
  if (!date(entry.recordedAtMillis) || !date(entry.reviewedAtMillis)
    || entry.recordedAtMillis < now - WINDOW_MS || entry.recordedAtMillis > entry.reviewedAtMillis
    || entry.reviewedAtMillis > now) return null;
  const rep = rows.find(row => row.id === entry.repId);
  if (!rep || rep.repType !== "dribbling" || rep.drillType !== "dribbling"
    || rep.resultStatus?.qualified !== false || rep.resultStatus?.duplicate !== false
    || rep.createdAtMillis !== entry.recordedAtMillis || typeof rep.storageFolder !== "string" || !rep.storageFolder) return null;
  const source = entry.source;
  if (!isObject(source) || source.playerId !== playerId || source.repId !== entry.repId
    || source.drill !== "dribbling" || source.recordedAtMillis !== entry.recordedAtMillis
    || typeof source.storagePath !== "string" || !source.storagePath.startsWith(rep.storageFolder + "/")
    || !/^[A-Za-z0-9_.-]+\.(mov|mp4)$/i.test(source.storagePath.slice(rep.storageFolder.length + 1))
    || typeof source.generation !== "string" || !/^[1-9][0-9]{0,30}$/.test(source.generation)
    || !md5(source.md5Hash) || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256)) return null;
  return {
    id: entry.id, repId: entry.repId, drill: "dribbling", axis: "ballControl", kind: "conditionalEstimate", method: METHOD,
    estimatedTotalSeconds: entry.estimatedTotalSeconds, lowerSeconds: entry.lowerSeconds, upperSeconds: entry.upperSeconds,
    observedCourseFraction: entry.observedCourseFraction, recordedAtMillis: entry.recordedAtMillis,
    reviewedAtMillis: entry.reviewedAtMillis, confidence: "low",
    assumption: "Maintains the observed return pace to the finish.",
    limitation: "Finish was not recorded; this is a conditional estimate. The range is a sensitivity range, not a confidence interval.",
  };
}

async function readProvisionalEstimates({ db, bucket, playerId, reps, drill, now }) {
  if (!identifier(playerId) || !Array.isArray(reps) || !date(now) || (drill !== undefined && drill !== "dribbling")) return [];
  // A real result always supersedes the provisional planning aid. Do this
  // before reading the private document or inspecting any source objects.
  if (reps.some(rep => rep.repType === "dribbling" && rep.resultStatus?.qualified === true
    && rep.resultStatus?.duplicate === false)) return [];
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
    const projection = validatedEntry(entry, playerId, reps, now);
    if (!projection || ids.get(entry.id) !== 1 || repIds.get(entry.repId) !== 1) continue;
    // Require the current rep's exact movie pointer, not merely a neighboring
    // movie within the same folder. Missing legacy pointers need review first.
    const repSnapshot = await db.collection("players").doc(playerId).collection("reps").doc(entry.repId).get();
    const currentRep = repSnapshot.data();
    if (!currentRep || drillOf(currentRep) !== "dribbling" || millis(currentRep.createdAt) !== entry.recordedAtMillis
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

module.exports = { readProvisionalEstimates, validatedEntry, WINDOW_MS, METHOD };
