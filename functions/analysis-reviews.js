"use strict";

const crypto = require("crypto");
const { isClubAdmin } = require("./club-access");
const { storageFolderCandidates } = require("./athlete-storage-paths");

const PHASES = ["approach", "backswing", "contact", "followThrough"];
const LIMBS = ["leftUpperArm", "leftForearm", "rightUpperArm", "rightForearm", "leftThigh", "leftShin", "rightThigh", "rightShin", "hips", "shoulders", "trunk", "leftFoot", "rightFoot"];
function canonicalValue(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
  return value;
}
const canonical = value => JSON.stringify(canonicalValue(value));
const sourceHash = value => crypto.createHash("sha256").update(canonical(value)).digest("hex");
const athleteSplit = playerId => parseInt(crypto.createHash("sha256").update(`kick-review-v1:${playerId}`).digest("hex").slice(0, 8), 16) % 5 === 0 ? "evaluation" : "train";

function createAnalysisReviews({ db, bucket, FieldValue, HttpsError }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const id = (value, name) => typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : fail("invalid-argument", `Invalid ${name}.`);
  const text = (value, name, max = 4000) => typeof value === "string" && value.length <= max ? value.trim() : fail("invalid-argument", `${name} must be text under ${max} characters.`);
  const list = (value, name, max) => Array.isArray(value) && value.length <= max ? value : fail("invalid-argument", `${name} is too large or is not a list.`);
  const object = (value, name) => value && typeof value === "object" && !Array.isArray(value) ? value : fail("invalid-argument", `Invalid ${name}.`);
  const bool = (value, name) => typeof value === "boolean" ? value : fail("invalid-argument", `${name} must be explicit.`);
  function requireAdmin(auth) {
    if (!auth?.uid || auth.isAnonymous) fail("unauthenticated", "Sign in to continue.");
    if (!isClubAdmin(auth)) fail("permission-denied", "A verified PoseTek admin account is required.");
  }
  function feedbackOf(input) {
    object(input, "feedback");
    const focusAreas = list(input.focusAreas, "Priorities", 12).map((row, index) => {
      object(row, "priority");
      return {
        id: id(row.id, "priority id"), rank: index + 1,
        title: text(row.title, "Title", 200), observation: text(row.observation, "Observation"),
        cue: text(row.cue, "Cue", 1000), whyItMatters: text(row.whyItMatters, "Reason"),
        evidenceIds: [...new Set(list(row.evidenceIds, "Evidence ids", 40).map(value => text(value, "Evidence id", 200)))],
      };
    });
    if (new Set(focusAreas.map(row => row.id)).size !== focusAreas.length) fail("invalid-argument", "Priority ids must be unique.");
    if (focusAreas.some(row => !row.title || !row.observation || !row.cue)) fail("invalid-argument", "Each priority needs a title, observation and cue.");
    return { summary: text(input.summary, "Summary", 6000), focusAreas };
  }
  function annotationsOf(input) {
    const rows = list(input, "Annotations", 100).map(row => {
      object(row, "annotation");
      if (!PHASES.includes(row.phase)) fail("invalid-argument", "Choose a known kick phase.");
      if (!Number.isInteger(row.frame) || row.frame < 0 || row.frame > 10000000) fail("invalid-argument", "Annotation frame must be a nonnegative integer.");
      const limbs = [...new Set(list(row.limbs, "Limbs", LIMBS.length))];
      if (limbs.some(value => !LIMBS.includes(value))) fail("invalid-argument", "Unknown limb.");
      let point = null;
      if (row.point != null) {
        object(row.point, "point");
        if (![row.point.x, row.point.y].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1)) fail("invalid-argument", "Annotation points must be normalized video coordinates.");
        point = { x: row.point.x, y: row.point.y };
      }
      return { id: id(row.id, "annotation id"), repId: id(row.repId, "annotation rep"), phase: row.phase, frame: row.frame, limbs, point, comment: text(row.comment, "Annotation comment", 2000) };
    });
    if (new Set(rows.map(row => row.id)).size !== rows.length) fail("invalid-argument", "Annotation ids must be unique.");
    return rows;
  }
  async function manualSnapshot(playerId, repId, rep, annotations, observed) {
    const snapshot = { rep, artifacts: {}, timebase: { fps: null, frameCount: null, width: null, height: null }, poseFrames: [], verified: false, limitations: [] };
    if (!bucket || !observed) { snapshot.limitations.push("Source artifacts were not verified in the viewer."); return snapshot; }
    let folders;
    try { folders = storageFolderCandidates(playerId, "shooting", rep, bucket.name); }
    catch (_) { fail("failed-precondition", "The manual source path cannot be resolved safely."); }
    const observedPath = observed["pose.json"]?.path || observed["metadata.json"]?.path;
    const folder = folders.find(value => observedPath?.startsWith(`${value}/`));
    if (!folder) { snapshot.limitations.push("No source pose or metadata was available."); return snapshot; }
    const content = {};
    for (const name of ["pose.json", "metadata.json", "reprocess_context.json"]) {
      const path = `${folder}/${name}`, viewed = observed[name];
      const file = bucket.file(path);
      let metadata;
      try { [metadata] = await file.getMetadata(); }
      catch (error) { if (error.code === 404) { if (viewed) fail("aborted", "A source artifact was removed. Reload the recording before saving."); continue; } throw error; }
      if (!viewed || viewed.path !== path || String(viewed.generation) !== String(metadata.generation) || String(viewed.md5Hash || "") !== String(metadata.md5Hash || "")) fail("aborted", "The recording changed after it was opened. Reload before saving annotations.");
      const limit = name === "pose.json" ? 12 * 1024 * 1024 : 512 * 1024;
      if (!metadata.generation || Number(metadata.size) > limit) { snapshot.limitations.push(`${name} cannot be snapshotted within the review size limit.`); continue; }
      let bytes;
      try { [bytes] = await bucket.file(path, { generation: String(metadata.generation) }).download(); }
      catch (_) { fail("aborted", "A source artifact changed during snapshot. Reload before saving."); }
      if (bytes.length > limit) fail("resource-exhausted", "A source artifact exceeds the bounded review download.");
      snapshot.artifacts[name] = { path, generation: String(metadata.generation), md5Hash: metadata.md5Hash || null, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
      try { content[name] = JSON.parse(bytes.toString("utf8").replace(/(?<=[[,:\s])-?(?:NaN|Infinity)(?=[\],}\s])/g, "null")); }
      catch (_) { snapshot.limitations.push(`${name} is not readable JSON.`); }
    }
    const metadata = content["metadata.json"] || {}, capture = content["reprocess_context.json"]?.capture || {};
    const frames = Array.isArray(content["pose.json"]) ? content["pose.json"] : content["pose.json"]?.frames;
    const fps = metadata.framesPerSecond ?? capture.clipFramesPerSecondUsed;
    const width = metadata.videoDisplayWidth ?? metadata.frameWidth;
    const height = metadata.videoDisplayHeight ?? metadata.frameHeight;
    snapshot.timebase = { fps: typeof fps === "number" && fps > 0 ? fps : null, frameCount: Array.isArray(frames) ? frames.length : null, width: typeof width === "number" && width > 0 ? width : null, height: typeof height === "number" && height > 0 ? height : null };
    if (Array.isArray(frames)) {
      const requested = [...new Set(annotations.flatMap(row => [row.frame - 1, row.frame, row.frame + 1]).filter(frame => frame >= 0 && frame < frames.length))].sort((a, b) => a - b);
      snapshot.poseFrames = requested.map(frame => ({ frame, pose: frames[frame] }));
      if (annotations.some(row => row.frame >= frames.length)) fail("invalid-argument", "An annotation is outside the source recording.");
    }
    const poseValid = snapshot.poseFrames.length > 0 && snapshot.poseFrames.every(row => Array.isArray(row.pose) && [17, 33].includes(row.pose.length) && row.pose.filter(point => Array.isArray(point) && point.slice(0, 2).length === 2 && point.slice(0, 2).every(value => typeof value === "number" && Number.isFinite(value))).length >= 6);
    snapshot.verified = annotations.length > 0 && poseValid && Object.values(snapshot.timebase).every(value => typeof value === "number" && value > 0);
    if (!snapshot.verified) snapshot.limitations.push("Dataset approval requires frame annotations, readable pose frames, recorded FPS and video dimensions.");
    return snapshot;
  }
  async function saveReview(data, auth) {
    requireAdmin(auth);
    const playerId = id(data?.playerId, "athlete");
    const targetId = id(data?.targetId, "analysis");
    const targetType = ["single", "comparison"].includes(data?.targetType) ? data.targetType : fail("invalid-argument", "Choose an analysis type.");
    const sourceJobId = data.sourceJobId == null ? null : id(data.sourceJobId, "source job");
    const baseRevision = data.baseRevision;
    if (!Number.isInteger(baseRevision) || baseRevision < 0) fail("invalid-argument", "Invalid base revision.");
    const feedback = feedbackOf(data.feedback);
    const annotations = annotationsOf(data.annotations);
    const notesInput = object(data.notes, "notes");
    const notes = { incorrect: text(notesInput.incorrect, "Incorrect diagnoses", 6000), missedPriorities: text(notesInput.missedPriorities, "Missed priorities", 6000), other: text(notesInput.other, "Other notes", 6000) };
    const datasetApproved = bool(data.datasetApproved, "Dataset approval");
    const publish = bool(data.publish, "Publication choice");
    const player = db.collection("players").doc(playerId);
    let manualSource = null;
    let manualRepHash = null;
    if (!sourceJobId && targetType === "single") {
      const sourceRep = await player.collection("reps").doc(targetId).get();
      if (!sourceRep.exists) fail("not-found", "The source kick no longer exists.");
      manualRepHash = sourceHash(sourceRep.data());
      manualSource = await manualSnapshot(playerId, targetId, sourceRep.data(), annotations, data.observedSources?.[targetId]);
      if (datasetApproved && !manualSource.verified) fail("failed-precondition", "Save this manual review without dataset approval. Verified pose, FPS, dimensions and at least one annotation are required for training examples.");
    }
    const targetKey = `${targetType}_${targetId}`;
    const currentRef = player.collection(targetType === "single" ? "aiAnalyses" : "aiKickComparisons").doc(targetId);
    const headRef = player.collection("aiAnalysisReviewHeads").doc(targetKey);
    const reviewRef = player.collection("aiAnalysisReviews").doc();
    return db.runTransaction(async tx => {
      const [playerDoc, currentDoc, headDoc] = await Promise.all([tx.get(player), tx.get(currentRef), tx.get(headRef)]);
      if (!playerDoc.exists) fail("not-found", "Athlete not found.");
      const current = currentDoc.exists ? currentDoc.data() : null;
      const head = headDoc.exists ? headDoc.data() : null;
      if ((head?.revision || 0) !== baseRevision) fail("aborted", "Another review was saved. Reload before saving your revision.");
      if (manualSource && head?.reviewId) {
        const prior = await tx.get(player.collection("aiAnalysisReviews").doc(head.reviewId));
        if (prior.data()?.source?.mode === "manual" && sourceHash(prior.data().manualSource?.[targetId]?.artifacts || null) !== sourceHash(manualSource.artifacts) && data.resetManualSource !== true) fail("aborted", "The recording differs from the previous manual review. Start a fresh manual review for the changed source.");
      }
      if ((current?.jobId || null) !== sourceJobId) fail("aborted", "This analysis was regenerated. Reload and review the new original before saving.");
      if (current && !sourceJobId) fail("failed-precondition", "This older analysis has no source job. Generate a new analysis before editing it.");
      if (!current && targetType !== "single") fail("failed-precondition", "Generate a comparison before reviewing it.");
      let sourceRun = null;
      if (sourceJobId) {
        const run = await tx.get(player.collection("aiAnalysisRuns").doc(sourceJobId));
        if (!run.exists) fail("failed-precondition", "This older analysis has no immutable generation record. Generate a new analysis before editing it.");
        sourceRun = run.data();
        const result = sourceRun.result;
        const capability = targetType === "single" ? "kick_analysis" : "kick_foot_comparison";
        if (sourceRun.playerId !== playerId || sourceRun.jobId !== sourceJobId || sourceRun.capability !== capability || result?.playerId !== playerId || result?.jobId !== sourceJobId || (targetType === "single" ? result.repId : result.comparisonId) !== targetId) fail("failed-precondition", "The saved original does not match this athlete and analysis.");
      }
      const original = sourceRun?.result || null;
      const repIds = targetType === "single" ? [targetId] : [original?.leftRepId, original?.rightRepId];
      if (repIds.some(value => typeof value !== "string") || new Set(repIds).size !== repIds.length) fail("failed-precondition", "The source reps are invalid.");
      const repDocs = await Promise.all(repIds.map(repId => tx.get(player.collection("reps").doc(id(repId, "source rep")))));
      if (repDocs.some(doc => !doc.exists || !["deadballShot", "shooting", "side_kick", "kick"].some(kind => [doc.data().repType, doc.data().drillType].includes(kind)))) fail("failed-precondition", "Each source must be a saved kick for this athlete.");
      if (annotations.some(row => !repIds.includes(row.repId))) fail("invalid-argument", "Annotations must belong to the source reps.");
      if (manualRepHash && sourceHash(repDocs[0].data()) !== manualRepHash) fail("aborted", "The source rep changed during review save. Reload before saving.");
      const annotationBounds = Object.fromEntries(repIds.map((repId, index) => {
        const candidate = original?.provenance?.sources?.[repId]?.frameCount ?? sourceRun?.provenance?.sources?.[repId]?.frameCount ?? (targetType === "single" ? sourceRun?.context?.source?.frameCount : sourceRun?.context?.kickComparisonContext?.[index === 0 ? "left" : "right"]?.source?.frameCount) ?? manualSource?.timebase?.frameCount ?? repDocs[index].data().totalFrames;
        const frameCount = Number.isInteger(candidate) && candidate > 0 ? candidate : null;
        return [repId, { frameCount, verified: frameCount !== null }];
      }));
      if (annotations.some(row => annotationBounds[row.repId].verified && row.frame >= annotationBounds[row.repId].frameCount)) fail("invalid-argument", "An annotation is outside its source clip. Choose a frame within the recording.");
      const eligible = targetType === "comparison" ? (original?.differences || []).filter(row => row.comparable === true) : Array.isArray(original?.evidence?.rows) ? original.evidence.rows.filter(row => row.eligible === true) : (original?.metrics || []).filter(row => row.valid === true);
      const evidenceIds = new Set(eligible.map(row => row.id));
      if (feedback.focusAreas.some(row => row.evidenceIds.some(value => !evidenceIds.has(value)))) fail("invalid-argument", "A priority cites unavailable or invalid evidence. Use a manual annotation for your own observations.");
      const revision = baseRevision + 1;
      const source = { jobId: sourceJobId, mode: sourceJobId ? "agent" : "manual", resultHash: sourceHash(original), provenance: sourceRun?.provenance || null, runPath: sourceJobId ? `players/${playerId}/aiAnalysisRuns/${sourceJobId}` : null, repIds, annotationBounds, manualSourceReset: !sourceJobId && data.resetManualSource === true };
      const review = { schemaVersion: 1, reviewId: reviewRef.id, playerId, targetId, targetType, targetKey, revision, previousReviewId: head?.reviewId || null, source, original, feedback, annotations, notes, datasetApproved, published: publish, reviewerUid: auth.uid, reviewerEmail: auth.email, createdAt: FieldValue.serverTimestamp() };
      if (!original) review.manualSource = { [targetId]: manualSource };
      if (Buffer.byteLength(canonical(review)) > 850000) fail("resource-exhausted", "This review is too large. Reduce annotations or notes before saving.");
      tx.create(reviewRef, review);
      tx.set(headRef, { schemaVersion: 1, targetId, targetType, targetKey, reviewId: reviewRef.id, revision, sourceJobId, datasetApproved, published: publish, updatedAt: FieldValue.serverTimestamp() });
      const projection = player.collection("aiAnalysisCorrections").doc(targetKey);
      if (publish) tx.set(projection, { schemaVersion: 1, playerId, targetId, targetType, sourceJobId, reviewId: reviewRef.id, revision, feedback, annotations, updatedAt: FieldValue.serverTimestamp() });
      else tx.delete(projection);
      return { reviewId: reviewRef.id, revision, targetKey };
    });
  }

  async function exportReviews(data, auth) {
    requireAdmin(auth);
    const playerIds = [...new Set(list(data?.playerIds, "Athletes", 100).map(value => id(value, "athlete")))].sort();
    const cursor = data.cursor == null ? "" : text(data.cursor, "Cursor", 450);
    const candidates = [];
    for (const playerId of playerIds) {
      const heads = await db.collection("players").doc(playerId).collection("aiAnalysisReviewHeads").limit(201).get();
      if (heads.size > 200) fail("resource-exhausted", "An athlete has more than 200 targets; use the offline dataset exporter.");
      for (const head of heads.docs) if (head.data().datasetApproved) candidates.push({ key: `${playerId}/${head.id}`, playerId, head });
    }
    candidates.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    const remaining = candidates.filter(item => item.key > cursor);
    const examples = [];
    let bytes = 0;
    for (const item of remaining) {
      const { value, context } = await db.runTransaction(async tx => {
        const player = db.collection("players").doc(item.playerId);
        const [freshHead, review] = await Promise.all([tx.get(player.collection("aiAnalysisReviewHeads").doc(item.head.id)), tx.get(player.collection("aiAnalysisReviews").doc(item.head.data().reviewId))]);
        const head = freshHead.data(), value = review.data();
        if (!head?.datasetApproved || head.reviewId !== item.head.data().reviewId || head.revision !== item.head.data().revision) fail("aborted", "A dataset approval changed during export. Restart the export for the latest approvals.");
        if (!value?.datasetApproved || value.reviewId !== head.reviewId || value.targetKey !== item.head.id) fail("failed-precondition", "A review head is inconsistent; reload the export.");
        let context = { context: value.manualSource || null, toolEvidence: [] };
        if (value.source.jobId) {
          const run = await tx.get(player.collection("aiAnalysisRuns").doc(value.source.jobId));
          if (!run.exists || sourceHash(run.data().result) !== value.source.resultHash) fail("failed-precondition", "An original generation is missing or changed; export stopped.");
          context = { context: run.data().context || null, toolEvidence: run.data().toolEvidence || [] };
        }
        return { value, context };
      });
      const example = { schemaVersion: 1, datasetVersion: "kick-review-v1", split: athleteSplit(item.playerId), playerId: item.playerId, targetType: value.targetType, targetId: value.targetId, reviewId: value.reviewId, revision: value.revision, source: value.source, input: context, original: value.original, expected: value.feedback, annotations: value.annotations, notes: value.notes, reviewedAt: value.createdAt };
      const size = Buffer.byteLength(canonical(example));
      if (size > 5000000) fail("resource-exhausted", "A single example exceeds the export limit.");
      if (examples.length && (bytes + size > 5000000 || examples.length >= 25)) break;
      examples.push(example); bytes += size;
    }
    return { schemaVersion: 1, datasetVersion: "kick-review-v1", examples, nextCursor: examples.length < remaining.length ? remaining[examples.length - 1].key : null };
  }
  return { saveReview, exportReviews };
}

module.exports = { createAnalysisReviews, athleteSplit, sourceHash, PHASES, LIMBS };
