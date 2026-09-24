"use strict";

// aiIncidents projections — AI observability plan §3.3 (PoseTek-mobile-app
// docs/plans/AI_OBSERVABILITY_AND_IMPROVEMENT_PLAN.md) and contract §16.
//
// projectFailedLlmJobs: every llmJobs doc that flips to `failed` gets an
//   `aiIncidents/job-<jobId>` doc with `source: projection` — only if absent.
//   The gateway writes the same id *before* it flips the status, so a job it
//   already recorded is neither duplicated nor counted twice: the one
//   structured `ai_incident` log line (what the alert metric counts) is emitted
//   only when this function creates the doc. It covers any gateway revision
//   without the incident hooks, and gateway incident writes that failed.
//
// foldAiIncidents: the phone writes only its own `client-<uuid>` docs. When
//   such a doc carries a `requestId`/`jobId`, it is a half, not an incident;
//   this function merges its `client` map (and a later `userReport`) into the
//   canonical `req-`/`job-` doc. It runs on create of either half, so arrival
//   order does not matter, and it merges only when both halves name the same
//   `requestedByUid` (otherwise the client doc is marked `foldRejected`).
//
// The redaction helpers mirror gateway/incidents.py exactly; both repos pin
// them with an identical copy of test-support/ai-incident-vectors.json.

const crypto = require("node:crypto");

const SCHEMA_VERSION = 1;
const COLLECTION = "aiIncidents";
const RETENTION_DAYS = 180;
const MESSAGE_LIMIT = 512;
const DAY_MS = 24 * 60 * 60 * 1000;

const REFUSAL_CODES = new Set([
  "quota_exceeded", "permission_denied", "context_unavailable", "capability_disabled",
  "client_too_old", "invalid_request", "unauthenticated", "app_check_failed",
]);
const SEVERITY = { failure: "error", refusal: "warning", degraded: "info" };
const LOG_SEVERITY = { failure: "ERROR", refusal: "WARNING", degraded: "INFO" };
const HTTP_STATUS = {
  unauthenticated: 401, app_check_failed: 401, permission_denied: 403, capability_disabled: 503,
  quota_exceeded: 429, invalid_request: 400, client_too_old: 426, context_unavailable: 422,
  validation_failed: 502, provider_error: 502, internal: 500,
};

// Same patterns, same order, as KickAI's DiagnosticIncidentEvidence.redacted.
const REDACTIONS = [
  /https?:\/\/[^\s]+/gi,
  /(?:file:\/\/)?\/(?:private\/|var\/|Users\/)[^\s]+/gi,
  /bearer\s+[^\s]+/gi,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
];
const QUOTED = /'[^']*'|"[^"]*"/g;
const DOC_ID_PART = /^[A-Za-z0-9_-]{1,128}$/;

// Python slices by code point; so do these.
const codePoints = (value, limit) => Array.from(value).slice(0, limit).join("");

function redact(value) {
  let text = codePoints(String(value ?? ""), 4096);
  for (const pattern of REDACTIONS) text = text.replace(pattern, "[redacted]");
  return codePoints(text, MESSAGE_LIMIT);
}

function violationCode(violation) {
  const words = String(violation).replace(QUOTED, " ").match(/[A-Za-z]+/g) || [];
  const kept = words.filter((word, index) => index === 0 || !/^[A-Z]/.test(word)).slice(0, 4);
  return kept.map(word => word.toLowerCase()).join("_") || "unspecified";
}

function validationSummary(message) {
  const text = String(message ?? "").replace(QUOTED, " ");
  const at = text.indexOf(": ");
  const violations = (at >= 0 ? text.slice(at + 2).split("; ") : [text]).filter(v => v.trim());
  const codes = [];
  for (const violation of violations) {
    const code = violationCode(violation);
    if (!codes.includes(code)) codes.push(code);
  }
  const prefix = at >= 0 ? violationCode(text.slice(0, at)) : "validation_failed";
  const count = violations.length;
  return codePoints(`${prefix}: ${count} violation${count !== 1 ? "s" : ""}: ${codes.slice(0, 12).join(", ")}`, MESSAGE_LIMIT);
}

const safeMessage = (code, message) => (code === "validation_failed" ? validationSummary(message) : redact(message));
const kindFor = code => (REFUSAL_CODES.has(code) ? "refusal" : "failure");

function incidentIdForJob(jobId) {
  const id = String(jobId);
  return DOC_ID_PART.test(id) ? `job-${id}` : `job-${crypto.createHash("sha256").update(id).digest("hex").slice(0, 40)}`;
}
function incidentIdForRequest(requestId) {
  const id = String(requestId);
  return DOC_ID_PART.test(id) ? `req-${id}` : `req-${crypto.createHash("sha256").update(id).digest("hex").slice(0, 40)}`;
}

const text = value => (typeof value === "string" && value ? value : null);
const millisOf = value => (value && typeof value.toMillis === "function" ? value.toMillis()
  : value instanceof Date ? value.getTime() : null);

/** The projection of one failed job. Pure apart from the injected clock. */
function projectionFor(jobId, job, { Timestamp, FieldValue, nowMillis, backfill = false, testUids = new Set() }) {
  const error = job && typeof job.error === "object" && job.error ? job.error : {};
  const code = text(error.code) || "internal";
  const kind = kindFor(code);
  const occurred = millisOf(job.completedAt) ?? nowMillis;
  const started = millisOf(job.startedAt);
  const uid = text(job.requestedByUid);
  const doc = {
    schemaVersion: SCHEMA_VERSION,
    source: "projection",
    transport: "job",
    kind,
    severity: SEVERITY[kind],
    capability: text(job.capability),
    playerId: text(job.playerId),
    requestedByUid: uid,
    clientVersion: text(job.clientVersion),
    platform: null,
    isTest: Boolean(uid && testUids.has(uid)),
    backfill: Boolean(backfill),
    gatewayRevision: null,
    requestId: String(jobId),
    requestIdSource: "job",
    jobId: String(jobId),
    conversationId: null,
    messageId: null,
    draftId: text(job.params && job.params.draftId),
    invocationId: null,
    traceRef: text(job.traceRef),
    code,
    stage: null,
    message: safeMessage(code, error.message ?? error.detail),
    httpStatus: HTTP_STATUS[code] ?? 500,
    providerStatus: null,
    provider: null,
    model: null,
    latencyMs: started !== null && millisOf(job.completedAt) !== null ? Math.max(0, occurred - started) : null,
    providerCalls: Number.isInteger(job.usage && job.usage.calls) ? job.usage.calls : null,
    allowance: null,
    quota: null,
    degraded: [],
    messageLength: null,
    messageSha256Prefix: null,
    occurredAt: Timestamp.fromMillis(occurred),
    day: new Date(occurred).toISOString().slice(0, 10),
    expiresAt: Timestamp.fromMillis(occurred + RETENTION_DAYS * DAY_MS),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  return { incidentId: incidentIdForJob(jobId), doc };
}

/** The structured line the Phase 2 log-based metric counts. */
function incidentLine(incidentId, doc) {
  return {
    severity: LOG_SEVERITY[doc.kind] || "INFO",
    message: "ai_incident",
    "logging.googleapis.com/labels": {
      event: "ai_incident", kind: doc.kind, code: doc.code, capability: doc.capability || "",
      requestId: doc.requestId || "", jobId: doc.jobId || "", isTest: String(Boolean(doc.isTest)),
      backfill: String(Boolean(doc.backfill)), incidentId,
    },
    aiIncident: {
      incidentId, kind: doc.kind, severity: doc.severity, code: doc.code, stage: doc.stage, source: doc.source,
      transport: doc.transport, capability: doc.capability, playerId: doc.playerId, requestId: doc.requestId,
      jobId: doc.jobId, isTest: doc.isTest, backfill: doc.backfill, httpStatus: doc.httpStatus, message: doc.message,
    },
  };
}

function createAiIncidents({ db, FieldValue, Timestamp, logger, now = () => Date.now() }) {
  const incidents = db.collection(COLLECTION);
  let testUidCache = { at: -Infinity, value: new Set() };

  async function testUids() {
    if (now() - testUidCache.at < 60_000) return testUidCache.value;
    let value = new Set();
    try {
      const snap = await db.collection("config").doc("llm").get();
      const list = snap.exists ? snap.data().testUids : null;
      if (Array.isArray(list)) value = new Set(list.filter(uid => typeof uid === "string"));
    } catch (_) { /* unlabelled beats unrecorded */ }
    testUidCache = { at: now(), value };
    return value;
  }

  /** Create-if-absent; returns {created, incidentId}. */
  async function createIfAbsent(incidentId, doc) {
    const ref = incidents.doc(incidentId);
    const created = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (snap.exists) return false;
      tx.create(ref, doc);
      return true;
    });
    return { created, incidentId };
  }

  async function projectFailedJob(jobId, before, after) {
    if (!after || after.status !== "failed" || (before && before.status === "failed")) return { skipped: true };
    const { incidentId, doc } = projectionFor(jobId, after, { Timestamp, FieldValue, nowMillis: now(), testUids: await testUids() });
    const result = await createIfAbsent(incidentId, doc);
    if (result.created) logger.write(incidentLine(incidentId, doc));
    return result;
  }

  async function foldPair(canonicalId, clientId) {
    const canonicalRef = incidents.doc(canonicalId);
    const clientRef = incidents.doc(clientId);
    return db.runTransaction(async tx => {
      const canonical = await tx.get(canonicalRef);
      const client = await tx.get(clientRef);
      if (!canonical.exists || !client.exists) return "missing";
      const half = client.data();
      if (half.foldedInto || half.foldRejected) return "done";
      const whole = canonical.data();
      if (!text(half.requestedByUid) || half.requestedByUid !== whole.requestedByUid) {
        tx.update(clientRef, { foldRejected: "uidMismatch", foldCheckedAt: FieldValue.serverTimestamp() });
        return "uidMismatch";
      }
      const update = {
        source: "both", hasClient: true, updatedAt: FieldValue.serverTimestamp(),
        clientIncidentIds: FieldValue.arrayUnion(clientId),
      };
      if (half.client && typeof half.client === "object" && !whole.client) update.client = half.client;
      if (half.userReport && typeof half.userReport === "object" && !whole.userReport) update.userReport = half.userReport;
      tx.update(canonicalRef, update);
      tx.update(clientRef, { foldedInto: canonicalId, foldedAt: FieldValue.serverTimestamp() });
      return "folded";
    });
  }

  /** onCreate of any incident doc; order-independent. */
  async function foldIncident(incidentId, data) {
    const doc = data || {};
    if (incidentId.startsWith("client-")) {
      const canonicalId = text(doc.requestId) ? incidentIdForRequest(doc.requestId)
        : text(doc.jobId) ? incidentIdForJob(doc.jobId) : null;
      if (!canonicalId) return { standalone: true };
      return { [canonicalId]: await foldPair(canonicalId, incidentId) };
    }
    const field = incidentId.startsWith("req-") ? "requestId" : incidentId.startsWith("job-") ? "jobId" : null;
    const key = field && text(doc[field]);
    if (!key) return {};
    const halves = await incidents.where(field, "==", key).get();
    const results = {};
    for (const half of halves.docs) {
      if (!half.id.startsWith("client-")) continue;
      const data = half.data();
      if (data.foldedInto || data.foldRejected) continue;
      results[half.id] = await foldPair(incidentId, half.id);
    }
    return results;
  }

  return { projectFailedJob, foldIncident, foldPair, createIfAbsent, testUids };
}

function createAiIncidentEntrypoints(functions, admin) {
  const incidents = createAiIncidents({
    db: admin.firestore(), FieldValue: admin.firestore.FieldValue, Timestamp: admin.firestore.Timestamp,
    logger: functions.logger,
  });
  const events = functions.runWith({ timeoutSeconds: 60, memory: "256MB", maxInstances: 5, failurePolicy: true });
  return {
    projectFailedLlmJobs: events.firestore.document("llmJobs/{jobId}").onWrite((change, context) =>
      incidents.projectFailedJob(context.params.jobId, change.before?.data?.(), change.after?.data?.())),
    foldAiIncidents: events.firestore.document(`${COLLECTION}/{incidentId}`).onCreate((snap, context) =>
      incidents.foldIncident(context.params.incidentId, snap.data())),
  };
}

module.exports = {
  createAiIncidents, createAiIncidentEntrypoints, projectionFor, incidentLine, redact, violationCode,
  validationSummary, safeMessage, kindFor, incidentIdForJob, incidentIdForRequest, COLLECTION, RETENTION_DAYS,
};
