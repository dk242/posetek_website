"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FakeFirestore, FakeTimestamp, FieldValue } = require("./test-support/fake-firestore");
const vectors = require("./test-support/ai-incident-vectors.json");
const {
  createAiIncidents, projectionFor, redact, violationCode, validationSummary, incidentIdForJob, incidentIdForRequest,
} = require("./ai-incidents");

const NOW = Date.UTC(2026, 8, 24, 18, 0, 0);
const REQUEST_ID = "3f0c9a4e-8b1d-4c2e-9f3a-5b6c7d8e9f01";

function setup(seed = {}) {
  const db = new FakeFirestore(seed);
  const lines = [];
  const incidents = createAiIncidents({ db, FieldValue, Timestamp: FakeTimestamp, logger: { write: line => lines.push(line) }, now: () => NOW });
  return { db, lines, incidents };
}

const failedJob = (overrides = {}) => ({
  status: "failed", capability: "build_workout", playerId: "player", requestedByUid: "athlete",
  clientVersion: "1.4.0+220", params: { planId: "stale" },
  startedAt: FakeTimestamp.fromMillis(NOW - 4000), completedAt: FakeTimestamp.fromMillis(NOW - 1000),
  error: { code: "invalid_request", message: "Plan stale no longer exists" }, ...overrides,
});

test("redaction, violation-code and summary vectors match the gateway's copy", () => {
  for (const row of vectors.redact) assert.equal(redact(row.input), row.expected, row.input);
  for (const row of vectors.validationSummary) assert.equal(validationSummary(row.input), row.expected, row.input);
  for (const row of vectors.violationCode) assert.equal(violationCode(row.input), row.expected, row.input);
});

test("ids keep mixed-case and underscore job ids and hash anything else", () => {
  assert.equal(incidentIdForJob("aB3xYz9_Qe-12"), "job-aB3xYz9_Qe-12");
  assert.match(incidentIdForJob("bad/id"), /^job-[a-f0-9]{40}$/);
  assert.equal(incidentIdForRequest(REQUEST_ID), `req-${REQUEST_ID}`);
});

test("a job failed by a gateway without hooks is projected once, with one metric line", async () => {
  const { db, lines, incidents } = setup();
  const before = { status: "running" };
  const after = failedJob();
  assert.deepEqual(await incidents.projectFailedJob("JobAb_12", before, after), { created: true, incidentId: "job-JobAb_12" });
  const doc = db.snapshot("aiIncidents/job-JobAb_12");
  assert.equal(doc.source, "projection");
  assert.equal(doc.kind, "refusal");
  assert.equal(doc.severity, "warning");
  assert.equal(doc.code, "invalid_request");
  assert.equal(doc.transport, "job");
  assert.equal(doc.requestId, "JobAb_12");
  assert.equal(doc.backfill, false);
  assert.equal(doc.latencyMs, 3000);
  assert.equal(doc.httpStatus, 400);
  assert.equal(doc.expiresAt.toMillis() - doc.occurredAt.toMillis(), 180 * 24 * 60 * 60 * 1000);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].severity, "WARNING");
  assert.equal(lines[0].message, "ai_incident");
  assert.deepEqual(lines[0]["logging.googleapis.com/labels"], {
    event: "ai_incident", kind: "refusal", code: "invalid_request", capability: "build_workout",
    requestId: "JobAb_12", jobId: "JobAb_12", isTest: "false", backfill: "false", incidentId: "job-JobAb_12",
  });
  // A redelivered event (running -> failed again) is create-if-absent.
  assert.equal((await incidents.projectFailedJob("JobAb_12", before, after)).created, false);
  assert.equal(lines.length, 1);
});

test("a job the gateway already recorded is not created twice and emits no second line", async () => {
  const gateway = { source: "gateway", kind: "refusal", code: "invalid_request", stage: "assemble", requestedByUid: "athlete" };
  const { db, lines, incidents } = setup({ "aiIncidents/job-JobG": gateway });
  const result = await incidents.projectFailedJob("JobG", { status: "running" }, failedJob());
  assert.equal(result.created, false);
  assert.deepEqual(db.snapshot("aiIncidents/job-JobG"), gateway);
  assert.equal(lines.length, 0);
});

test("only the transition into failed projects", async () => {
  const { db, incidents } = setup();
  assert.deepEqual(await incidents.projectFailedJob("J1", { status: "pending" }, { status: "running" }), { skipped: true });
  assert.deepEqual(await incidents.projectFailedJob("J2", { status: "failed" }, failedJob()), { skipped: true });
  assert.deepEqual(await incidents.projectFailedJob("J3", { status: "failed" }, undefined), { skipped: true });
  assert.equal((await incidents.projectFailedJob("J4", undefined, failedJob())).created, true);
  assert.deepEqual([...db.docs.keys()].filter(path => path.startsWith("aiIncidents/")), ["aiIncidents/job-J4"]);
});

test("validation_failed projections carry codes, never the quoted model text", async () => {
  const { db, lines, incidents } = setup();
  await incidents.projectFailedJob("JobV", { status: "running" }, failedJob({
    capability: "generate_report",
    error: { code: "validation_failed", message: "Output failed validation after one retry: summary uses banned phrase 'elite': 'SENTINEL model text; more'" },
  }));
  const doc = db.snapshot("aiIncidents/job-JobV");
  assert.equal(doc.kind, "failure");
  assert.equal(doc.message, "output_failed_validation_after: 1 violation: summary_uses_banned_phrase");
  assert.doesNotMatch(JSON.stringify(doc) + JSON.stringify(lines), /SENTINEL/);
  assert.equal(lines[0].severity, "ERROR");
});

test("test accounts from config/llm.testUids are labelled server-side", async () => {
  const { db, lines, incidents } = setup({ "config/llm": { testUids: ["athlete"] } });
  await incidents.projectFailedJob("JobT", { status: "running" }, failedJob());
  assert.equal(db.snapshot("aiIncidents/job-JobT").isTest, true);
  assert.equal(lines[0]["logging.googleapis.com/labels"].isTest, "true");
});

test("backfill projections are flagged and otherwise identical", () => {
  const job = failedJob();
  const live = projectionFor("JobB", job, { Timestamp: FakeTimestamp, FieldValue, nowMillis: NOW });
  const backfill = projectionFor("JobB", job, { Timestamp: FakeTimestamp, FieldValue, nowMillis: NOW, backfill: true });
  assert.equal(backfill.doc.backfill, true);
  assert.deepEqual({ ...backfill.doc, backfill: false }, live.doc);
});

const canonicalStream = (overrides = {}) => ({
  source: "gateway", transport: "stream", kind: "refusal", code: "quota_exceeded", requestId: REQUEST_ID,
  requestedByUid: "athlete", playerId: "player", ...overrides,
});
const clientHalf = (overrides = {}) => ({
  schemaVersion: 1, source: "client", transport: "stream", code: "quota_exceeded", stage: "workout_chat_send",
  requestId: REQUEST_ID, requestedByUid: "athlete", playerId: "player",
  client: { errorCode: "quota_exceeded", userSaw: "You've used today's workout changes.", surface: "workout_chat" }, ...overrides,
});
const CLIENT_ID = "client-8a1e0f5c-1f0e-4b7a-9a8f-2c3d4e5f6a7b";

test("fold: the client half arriving after the gateway doc merges once", async () => {
  const { db, incidents } = setup({ [`aiIncidents/req-${REQUEST_ID}`]: canonicalStream(), [`aiIncidents/${CLIENT_ID}`]: clientHalf() });
  assert.deepEqual(await incidents.foldIncident(CLIENT_ID, clientHalf()), { [`req-${REQUEST_ID}`]: "folded" });
  const whole = db.snapshot(`aiIncidents/req-${REQUEST_ID}`);
  assert.equal(whole.source, "both");
  assert.equal(whole.hasClient, true);
  assert.deepEqual(whole.client, clientHalf().client);
  assert.deepEqual(whole.clientIncidentIds, [CLIENT_ID]);
  assert.equal(db.snapshot(`aiIncidents/${CLIENT_ID}`).foldedInto, `req-${REQUEST_ID}`);
  // The other trigger (the gateway doc's onCreate) finds nothing left to fold.
  assert.deepEqual(await incidents.foldIncident(`req-${REQUEST_ID}`, canonicalStream()), {});
  assert.deepEqual(db.snapshot(`aiIncidents/req-${REQUEST_ID}`).clientIncidentIds, [CLIENT_ID]);
});

test("fold: the client half arriving first is folded when the gateway doc is created", async () => {
  const { db, incidents } = setup({ [`aiIncidents/${CLIENT_ID}`]: clientHalf() });
  assert.deepEqual(await incidents.foldIncident(CLIENT_ID, clientHalf()), { [`req-${REQUEST_ID}`]: "missing" });
  assert.equal(db.snapshot(`aiIncidents/${CLIENT_ID}`).foldedInto, undefined);
  db.docs.set(`aiIncidents/req-${REQUEST_ID}`, canonicalStream());
  assert.deepEqual(await incidents.foldIncident(`req-${REQUEST_ID}`, canonicalStream()), { [CLIENT_ID]: "folded" });
  assert.equal(db.snapshot(`aiIncidents/req-${REQUEST_ID}`).source, "both");
  assert.equal(db.snapshot(`aiIncidents/${CLIENT_ID}`).foldedInto, `req-${REQUEST_ID}`);
});

test("fold: a client half naming another uid is rejected and the incident is untouched", async () => {
  const foreign = clientHalf({ requestedByUid: "someone-else" });
  const { db, incidents } = setup({ [`aiIncidents/req-${REQUEST_ID}`]: canonicalStream(), [`aiIncidents/${CLIENT_ID}`]: foreign });
  assert.deepEqual(await incidents.foldIncident(CLIENT_ID, foreign), { [`req-${REQUEST_ID}`]: "uidMismatch" });
  assert.deepEqual(db.snapshot(`aiIncidents/req-${REQUEST_ID}`), canonicalStream());
  assert.equal(db.snapshot(`aiIncidents/${CLIENT_ID}`).foldRejected, "uidMismatch");
  // And it is not retried from the canonical side.
  assert.deepEqual(await incidents.foldIncident(`req-${REQUEST_ID}`, canonicalStream()), {});
});

test("fold: a later user report attaches to a job incident by jobId", async () => {
  const REPORT_ID = "client-1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
  const report = { schemaVersion: 1, source: "client", transport: "job", code: "user_report", stage: "user_report",
    jobId: "JobR", requestedByUid: "athlete", userReport: { note: "It spun forever", submittedAt: "t" } };
  const { db, incidents } = setup({
    "aiIncidents/job-JobR": { source: "projection", requestedByUid: "athlete", jobId: "JobR", requestId: "JobR" },
    [`aiIncidents/${REPORT_ID}`]: report,
  });
  assert.deepEqual(await incidents.foldIncident(REPORT_ID, report), { "job-JobR": "folded" });
  const whole = db.snapshot("aiIncidents/job-JobR");
  assert.deepEqual(whole.userReport, report.userReport);
  assert.equal(whole.source, "both");
  assert.equal(whole.client, undefined);
});

test("a client-only incident with no request or job id stands alone", async () => {
  const { db, incidents } = setup();
  const alone = clientHalf({ requestId: undefined });
  delete alone.requestId;
  assert.deepEqual(await incidents.foldIncident(CLIENT_ID, alone), { standalone: true });
  assert.equal(db.docs.size, 0);
});
