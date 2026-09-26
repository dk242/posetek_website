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

test("client-only incident and later report fold once in either arrival order", async () => {
  const own = "8a1e0f5c-1f0e-4b7a-9a8f-2c3d4e5f6a7b";
  const originalId = `client-${own}`, followId = "client-1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
  const original = { requestedByUid: "athlete", requestId: own, stage: "upload", client: { detail: "diagnostic" } };
  const follow = { requestedByUid: "athlete", requestId: own, stage: "user_report", userReport: { note: "Please investigate" } };
  for (const first of [originalId, followId]) {
    const { db, incidents } = setup({ [`aiIncidents/${originalId}`]: original, [`aiIncidents/${followId}`]: follow });
    await incidents.foldIncident(first, first === originalId ? original : follow);
    await incidents.foldIncident(first === originalId ? followId : originalId, first === originalId ? follow : original);
    await incidents.foldIncident(followId, follow);
    assert.equal(db.snapshot(`aiIncidents/${followId}`).foldedInto, originalId);
    assert.deepEqual(db.snapshot(`aiIncidents/${originalId}`).userReport, follow.userReport);
    assert.deepEqual(db.snapshot(`aiIncidents/${originalId}`).client, original.client);
  }
});

test("client-only follow-up refuses another account and server labels test traffic", async () => {
  const own = "8a1e0f5c-1f0e-4b7a-9a8f-2c3d4e5f6a7b";
  const originalId = `client-${own}`, followId = "client-1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
  const original = { requestedByUid: "test-athlete", requestId: own, stage: "upload", isTest: false };
  const follow = { requestedByUid: "other-athlete", requestId: own, stage: "user_report", isTest: true };
  const { db, incidents } = setup({ "config/llm": { testUids: ["test-athlete"] }, [`aiIncidents/${originalId}`]: original, [`aiIncidents/${followId}`]: follow });
  await incidents.foldIncident(originalId, original);
  await incidents.foldIncident(followId, follow);
  assert.equal(db.snapshot(`aiIncidents/${originalId}`).isTest, true);
  assert.equal(db.snapshot(`aiIncidents/${followId}`).isTest, false);
  assert.equal(db.snapshot(`aiIncidents/${followId}`).foldRejected, "uidMismatch");
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

test("every client doc gets the 180-day retention the phone may not set, from its server createdAt", async () => {
  const created = FakeTimestamp.fromMillis(NOW - 5000);
  const half = clientHalf({ createdAt: created });
  const { db, incidents } = setup({ [`aiIncidents/req-${REQUEST_ID}`]: canonicalStream(), [`aiIncidents/${CLIENT_ID}`]: half });
  assert.deepEqual(await incidents.foldIncident(CLIENT_ID, half), { [`req-${REQUEST_ID}`]: "folded" });
  assert.equal(db.snapshot(`aiIncidents/${CLIENT_ID}`).expiresAt.toMillis(), NOW - 5000 + 180 * 24 * 60 * 60 * 1000);
  // The canonical doc keeps its own writer's retention.
  assert.equal(db.snapshot(`aiIncidents/req-${REQUEST_ID}`).expiresAt, undefined);

  const standalone = clientHalf({ createdAt: created });
  delete standalone.requestId;
  const alone = setup({ [`aiIncidents/${CLIENT_ID}`]: standalone });
  assert.deepEqual(await alone.incidents.foldIncident(CLIENT_ID, standalone), { standalone: true });
  assert.equal(alone.db.snapshot(`aiIncidents/${CLIENT_ID}`).expiresAt.toMillis(), NOW - 5000 + 180 * 24 * 60 * 60 * 1000);

  const kept = FakeTimestamp.fromMillis(NOW + 1);
  const already = setup({ [`aiIncidents/${CLIENT_ID}`]: { ...standalone, expiresAt: kept } });
  await already.incidents.foldIncident(CLIENT_ID, { ...standalone, expiresAt: kept });
  assert.equal(already.db.snapshot(`aiIncidents/${CLIENT_ID}`).expiresAt.toMillis(), NOW + 1);
});

// -- Reopen on recurrence (plan §5, Phase 4) ---------------------------------

const verifiedClass = (overrides = {}) => ({
  source: "gateway", transport: "job", kind: "refusal", capability: "generate_training_plan",
  code: "context_unavailable", stage: "assemble", requestedByUid: "athlete", jobId: "JobOld", requestId: "JobOld",
  triage: { state: "verified", owner: "nolan", note: "Catalog republished.", fixRef: "gateway abc1234",
    replayNote: "Replayed 2026-09-20: no incident.", updatedBy: "admin-uid" },
  ...overrides,
});
const recurrence = (overrides = {}) => ({
  source: "gateway", transport: "job", kind: "refusal", capability: "generate_training_plan",
  code: "context_unavailable", stage: "assemble", requestedByUid: "athlete", jobId: "JobNew", requestId: "JobNew",
  isTest: false, backfill: false, ...overrides,
});

test("a synthetic incident of a verified class reopens it and names where it came from", async () => {
  const { db, lines, incidents } = setup({
    "aiIncidents/job-JobOld": verifiedClass(), "aiIncidents/job-JobNew": recurrence(),
  });
  assert.deepEqual(await incidents.foldIncident("job-JobNew", recurrence()), { reopened: ["job-JobOld"] });
  const fresh = db.snapshot("aiIncidents/job-JobNew");
  assert.equal(fresh.reopenedFrom, "job-JobOld");
  assert.deepEqual(fresh.reopenedFromIds, ["job-JobOld"]);
  const old = db.snapshot("aiIncidents/job-JobOld");
  assert.equal(old.triage.state, "new");
  assert.match(old.triage.note, /^Reopened 2026-09-24: job-JobNew recurred with the same capability, code and stage\. Earlier note: Catalog republished\.$/);
  // History stays: the fix and the replay that verified it.
  assert.equal(old.triage.fixRef, "gateway abc1234");
  assert.equal(old.triage.replayNote, "Replayed 2026-09-20: no incident.");
  assert.equal(old.triage.owner, "nolan");
  assert.equal(old.triage.updatedBy, "foldAiIncidents");
  assert.equal(old.reopenedBy, "job-JobNew");
  assert.equal(old.reopenCount, 1);
  // Every triage key is one the rules accept, so an admin can save it again.
  assert.deepEqual(Object.keys(old.triage).sort(),
    ["fixRef", "note", "owner", "replayNote", "state", "updatedAt", "updatedBy"]);
  const line = lines.find(entry => entry.message === "ai_incident_reopened");
  assert.equal(line.severity, "WARNING");
  assert.deepEqual(line["logging.googleapis.com/labels"], {
    event: "ai_incident_reopened", incidentId: "job-JobNew", reopenedFrom: "job-JobOld",
    capability: "generate_training_plan", code: "context_unavailable", stage: "assemble",
  });
  // Reopened once: the next recurrence finds nothing verified.
  db.docs.set("aiIncidents/job-JobNext", recurrence({ jobId: "JobNext", requestId: "JobNext" }));
  assert.deepEqual(await incidents.foldIncident("job-JobNext", recurrence({ jobId: "JobNext", requestId: "JobNext" })), {});
});

test("recurrence matches capability, code and stage exactly, and only verified classes", async () => {
  const seed = {
    "aiIncidents/job-OtherStage": verifiedClass({ stage: "policy" }),
    "aiIncidents/job-OtherCode": verifiedClass({ code: "invalid_request" }),
    "aiIncidents/job-OtherCapability": verifiedClass({ capability: "build_workout" }),
    "aiIncidents/job-Fixed": verifiedClass({ triage: { state: "fixed", fixRef: "gateway abc1234" } }),
    "aiIncidents/job-Wontfix": verifiedClass({ triage: { state: "wontfix" } }),
    "aiIncidents/job-JobNew": recurrence(),
  };
  const { db, incidents } = setup(seed);
  assert.deepEqual(await incidents.foldIncident("job-JobNew", recurrence()), {});
  for (const id of ["OtherStage", "OtherCode", "OtherCapability"]) {
    assert.equal(db.snapshot(`aiIncidents/job-${id}`).triage.state, "verified", id);
  }
  assert.equal(db.snapshot("aiIncidents/job-Fixed").triage.state, "fixed");
  assert.equal(db.snapshot("aiIncidents/job-JobNew").reopenedFrom, undefined);
});

test("a class with a null stage (a projected job) matches another null stage only", async () => {
  const { db, incidents } = setup({
    "aiIncidents/job-JobOld": verifiedClass({ source: "projection", stage: null }),
    "aiIncidents/job-JobNew": recurrence({ source: "projection", stage: null }),
  });
  assert.deepEqual(await incidents.foldIncident("job-JobNew", recurrence({ source: "projection", stage: null })),
    { reopened: ["job-JobOld"] });
  assert.equal(db.snapshot("aiIncidents/job-JobOld").triage.state, "new");
});

test("test, backfill and user-report documents and client halves never reopen a class", async () => {
  const cases = [
    ["job-JobNew", recurrence({ isTest: true })],
    ["job-JobNew", recurrence({ backfill: true })],
    [CLIENT_ID, clientHalf({ capability: "generate_training_plan", code: "context_unavailable", stage: "assemble" })],
    [CLIENT_ID, { ...clientHalf({ capability: "generate_training_plan", code: "user_report", stage: "user_report" }),
      requestId: CLIENT_ID.slice("client-".length) }],
  ];
  for (const [id, doc] of cases) {
    const { db, incidents } = setup({ "aiIncidents/job-JobOld": verifiedClass(), [`aiIncidents/${id}`]: doc });
    const result = await incidents.foldIncident(id, doc);
    assert.equal(result.reopened, undefined, id);
    assert.equal(db.snapshot("aiIncidents/job-JobOld").triage.state, "verified", JSON.stringify(doc));
  }
});

test("a standalone phone incident reopens its class unless the account is a test account", async () => {
  const own = CLIENT_ID.slice("client-".length);
  const phone = clientHalf({ requestId: own, capability: "workout_chat", code: "recovery_failed",
    stage: "workout_chat_recover", transport: "client_read" });
  const verified = verifiedClass({ capability: "workout_chat", code: "recovery_failed", stage: "workout_chat_recover" });
  const live = setup({ "aiIncidents/job-JobOld": verified, [`aiIncidents/${CLIENT_ID}`]: phone });
  assert.deepEqual((await live.incidents.foldIncident(CLIENT_ID, phone)).reopened, ["job-JobOld"]);
  assert.equal(live.db.snapshot(`aiIncidents/${CLIENT_ID}`).reopenedFrom, "job-JobOld");

  const test = setup({ "config/llm": { testUids: ["athlete"] }, "aiIncidents/job-JobOld": verified,
    [`aiIncidents/${CLIENT_ID}`]: phone });
  assert.equal((await test.incidents.foldIncident(CLIENT_ID, phone)).reopened, undefined);
  assert.equal(test.db.snapshot("aiIncidents/job-JobOld").triage.state, "verified");
});

test("two recurrences at once reopen the class once", async () => {
  const second = recurrence({ jobId: "JobTwo", requestId: "JobTwo" });
  const { db, incidents } = setup({
    "aiIncidents/job-JobOld": verifiedClass(), "aiIncidents/job-JobNew": recurrence(), "aiIncidents/job-JobTwo": second,
  });
  const [a, b] = await Promise.all([incidents.foldIncident("job-JobNew", recurrence()), incidents.foldIncident("job-JobTwo", second)]);
  assert.equal([a.reopened, b.reopened].filter(Boolean).length, 1);
  assert.equal(db.snapshot("aiIncidents/job-JobOld").reopenCount, 1);
});

test("a long earlier note is cut to the 1000 characters the rules allow", async () => {
  const { db, incidents } = setup({
    "aiIncidents/job-JobOld": verifiedClass({ triage: { ...verifiedClass().triage, note: "n".repeat(1000) } }),
    "aiIncidents/job-JobNew": recurrence(),
  });
  await incidents.foldIncident("job-JobNew", recurrence());
  assert.equal(Array.from(db.snapshot("aiIncidents/job-JobOld").triage.note).length, 1000);
});

test("a projected context_unavailable job keeps the gateway's reason; other codes carry none", () => {
  const catalog = projectionFor("JobC", failedJob({ error: { code: "context_unavailable", reason: "catalog",
    message: "No published eligible catalog curriculum" } }), { Timestamp: FakeTimestamp, FieldValue, nowMillis: NOW });
  assert.equal(catalog.doc.reason, "catalog");
  const other = projectionFor("JobI", failedJob({ error: { code: "invalid_request", reason: "catalog", message: "x" } }),
    { Timestamp: FakeTimestamp, FieldValue, nowMillis: NOW });
  assert.equal(other.doc.reason, null);
});
