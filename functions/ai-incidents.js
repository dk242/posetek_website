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
//   It also stamps every client doc's `expiresAt` (createdAt + 180 days),
//   which the rules do not let the phone set.
//
//   Reopen on recurrence (plan §5, Phase 4): when a new incident has the same
//   capability, code and stage as one whose `triage.state` is `verified`, the
//   class has come back. The new incident gets `reopenedFrom`, and the verified
//   one moves back to `new` with a note naming the recurrence (its fixRef and
//   replayNote stay as history). Test, backfill and user-report documents and
//   client halves never reopen anything: only a countable incident is evidence.
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
// The rules cap a triage note at 1000 characters; a reopened incident must stay
// saveable from the admin view.
const TRIAGE_NOTE_LIMIT = 1000;
// Verified incidents are a short list (a handful per weekly look, 180-day TTL).
const VERIFIED_SCAN_LIMIT = 500;

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
    // Contract §7: only context_unavailable carries a reason.
    reason: code === "context_unavailable" ? text(error.reason) : null,
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
      incidentId, kind: doc.kind, severity: doc.severity, code: doc.code, stage: doc.stage, reason: doc.reason ?? null,
      source: doc.source,
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

  /**
   * A phone may not choose its own retention: the rules refuse `expiresAt` on a
   * client create (a client clock cannot equal server time + 180 days), so its
   * documents get the same 180 days as every other writer's, from the
   * server-pinned `createdAt`. `update` never creates; a document already gone
   * has nothing to retain.
   */
  async function stampClientRetention(incidentId, doc) {
    if (doc.expiresAt) return;
    const created = millisOf(doc.createdAt) ?? now();
    try {
      await incidents.doc(incidentId).update({ expiresAt: Timestamp.fromMillis(created + RETENTION_DAYS * DAY_MS) });
    } catch (error) {
      if (!(error && (error.code === 5 || error.code === "not-found" || /NOT_FOUND/.test(String(error.message))))) throw error;
    }
  }

  async function stampClientTest(incidentId, doc) {
    const uid = text(doc.requestedByUid);
    const isTest = Boolean(uid && (await testUids()).has(uid));
    // Client supplied classifications are never authoritative. Also correct
    // older client documents when their create trigger is retried.
    if (doc.isTest !== isTest) {
      try { await incidents.doc(incidentId).update({ isTest }); }
      catch (error) {
        if (!(error && (error.code === 5 || error.code === "not-found" || /NOT_FOUND/.test(String(error.message))))) throw error;
      }
    }
    return isTest;
  }

  /**
   * Whether a newly created doc is a countable incident, and so evidence that
   * its class recurred. A client doc counts only when it stands alone: it has
   * no request or job, or its `requestId` is its own UUID (the phone's id for
   * a failure that never reached the gateway, contract §16.5). A client doc
   * naming another request is a half of that request's incident.
   */
  async function countsAsRecurrence(incidentId, doc) {
    if (doc.isTest === true || doc.backfill === true || doc.stage === "user_report") return false;
    if (incidentId.startsWith("client-")) {
      const own = incidentId.slice("client-".length);
      const standalone = !text(doc.jobId) && (!text(doc.requestId) || doc.requestId === own);
      if (!standalone) return false;
      // A phone cannot label itself test traffic; its account can be listed.
      return !(text(doc.requestedByUid) && (await testUids()).has(doc.requestedByUid));
    }
    return incidentId.startsWith("req-") || incidentId.startsWith("job-");
  }

  /** Moves each verified incident of the new one's class back to `new`. */
  async function reopenVerifiedClass(incidentId, doc) {
    if (!(await countsAsRecurrence(incidentId, doc))) return [];
    const same = (a, b) => (a ?? null) === (b ?? null);
    const verified = await incidents.where("triage.state", "==", "verified").limit(VERIFIED_SCAN_LIMIT).get();
    const matches = verified.docs.filter(snap => snap.id !== incidentId && same(snap.data().capability, doc.capability)
      && same(snap.data().code, doc.code) && same(snap.data().stage, doc.stage));
    const day = new Date(now()).toISOString().slice(0, 10);
    const reopened = [];
    for (const match of matches) {
      const ref = incidents.doc(match.id);
      const done = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const triage = snap.exists ? snap.data().triage : null;
        if (!triage || triage.state !== "verified") return false;  // another recurrence got there first
        const earlier = text(triage.note) ? ` Earlier note: ${triage.note}` : "";
        const note = codePoints(`Reopened ${day}: ${incidentId} recurred with the same capability, code and stage.${earlier}`,
          TRIAGE_NOTE_LIMIT);
        tx.update(ref, {
          triage: { ...triage, state: "new", note, updatedAt: FieldValue.serverTimestamp(), updatedBy: "foldAiIncidents" },
          reopenedBy: incidentId, reopenedAt: FieldValue.serverTimestamp(), reopenCount: FieldValue.increment(1),
        });
        return true;
      });
      if (done) reopened.push(match.id);
    }
    if (reopened.length) {
      await incidents.doc(incidentId).update({ reopenedFrom: reopened[0], reopenedFromIds: reopened });
      logger.write({
        severity: "WARNING", message: "ai_incident_reopened",
        "logging.googleapis.com/labels": { event: "ai_incident_reopened", incidentId, reopenedFrom: reopened[0],
          capability: doc.capability || "", code: doc.code || "", stage: doc.stage || "" },
      });
    }
    return reopened;
  }

  /** onCreate of any incident doc; order-independent. */
  async function foldIncident(incidentId, data) {
    const doc = data || {};
    if (incidentId.startsWith("client-")) doc.isTest = await stampClientTest(incidentId, doc);
    const results = await foldHalves(incidentId, doc);
    const reopened = await reopenVerifiedClass(incidentId, doc);
    return reopened.length ? { ...results, reopened } : results;
  }

  async function foldHalves(incidentId, doc) {
    if (incidentId.startsWith("client-")) {
      await stampClientRetention(incidentId, doc);
      const ownId = incidentId.slice("client-".length);
      // A client-only failure uses its UUID as requestId. It is the canonical
      // incident for later user-report documents with that same requestId.
      if (doc.requestId === ownId && doc.stage !== "user_report" && !doc.jobId) {
        const matches = await incidents.where("requestId", "==", ownId).get();
        const results = {};
        for (const match of matches.docs) {
          if (match.id !== incidentId && match.id.startsWith("client-") && match.data().stage === "user_report")
            results[match.id] = await foldPair(incidentId, match.id);
        }
        return Object.keys(results).length ? results : { standalone: true };
      }
      if (text(doc.requestId) && !doc.jobId) {
        const clientCanonicalId = `client-${doc.requestId}`;
        if (clientCanonicalId !== incidentId) {
          const candidate = await incidents.doc(clientCanonicalId).get();
          if (candidate.exists && candidate.data().stage !== "user_report")
            return { [clientCanonicalId]: await foldPair(clientCanonicalId, incidentId) };
        }
      }
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

  return { projectFailedJob, foldIncident, foldPair, createIfAbsent, testUids, reopenVerifiedClass };
}

function createAiIncidentEntrypoints(functions, admin, caller) {
  const incidents = createAiIncidents({
    db: admin.firestore(), FieldValue: admin.firestore.FieldValue, Timestamp: admin.firestore.Timestamp,
    logger: functions.logger,
  });
  const events = functions.runWith({ timeoutSeconds: 60, memory: "256MB", maxInstances: 5, failurePolicy: true });
  const listing = require("./ai-incidents-list").createAiIncidentList({ db: admin.firestore(), HttpsError: functions.https.HttpsError });
  return {
    listAiIncidents: functions.runWith({ timeoutSeconds: 120, memory: "512MB", maxInstances: 5 }).https.onCall((data, context) => listing.list(data || {}, caller(context))),
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
