const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { FakeFirestore, FakeTimestamp, FieldValue } = require("../functions/test-support/fake-firestore");
const { parseArgs, run } = require("./backfill-ai-incidents.cjs");

const failed = (code, message, extra = {}) => ({
  status: "failed", capability: "generate_report", playerId: "player", requestedByUid: "athlete",
  completedAt: FakeTimestamp.fromMillis(Date.UTC(2026, 8, 8, 12)), error: { code, message }, ...extra,
});

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ai-incident-backfill-"));
  const db = new FakeFirestore({
    "llmJobs/JobA": failed("invalid_request", "Unknown plan"),
    "llmJobs/JobB": failed("validation_failed", "Output failed validation after one retry: summary uses banned phrase 'x': 'SENTINEL model text'"),
    "llmJobs/JobC": failed("provider_error", "Vertex 503", { requestedByUid: "tester" }),
    "llmJobs/JobDone": { status: "complete", capability: "generate_report" },
    "aiIncidents/job-JobC": { source: "gateway", kind: "failure" },
    "config/llm": { testUids: ["tester"] },
  });
  const options = { db, FieldValue, Timestamp: FakeTimestamp, receiptPath: path.join(directory, "receipt.json"), now: () => Date.UTC(2026, 8, 24) };
  return { db, options, clean: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test("dry run reads only and lists what apply would create, without personal fields", async () => {
  const { db, options, clean } = setup();
  try {
    const before = new Map(db.docs);
    const result = await run({ ...options, mode: "dry-run" });
    assert.equal(result.remoteMutations, 0);
    assert.equal(result.failedJobs, 3);
    assert.deepEqual(result.alreadyRecorded, ["job-JobC"]);
    assert.deepEqual(result.toCreate.map(row => row.incidentId), ["job-JobA", "job-JobB"]);
    assert.deepEqual(result.byCode, { invalid_request: 1, validation_failed: 1 });
    assert.deepEqual(db.docs, before);
    const receipt = fs.readFileSync(options.receiptPath, "utf8");
    assert.doesNotMatch(receipt, /athlete|player"|SENTINEL|Unknown plan/);
    await assert.rejects(run({ ...options, mode: "dry-run" }), /already exists/);
  } finally { clean(); }
});

test("apply creates only absent incidents, flagged backfill, and a re-run is a no-op", async () => {
  const { db, options, clean } = setup();
  try {
    await run({ ...options, mode: "dry-run" });
    const result = await run({ ...options, mode: "apply" });
    assert.equal(result.created, 2);
    const b = db.snapshot("aiIncidents/job-JobB");
    assert.equal(b.backfill, true);
    assert.equal(b.source, "projection");
    assert.equal(b.message, "output_failed_validation_after: 1 violation: summary_uses_banned_phrase");
    assert.deepEqual(db.snapshot("aiIncidents/job-JobC"), { source: "gateway", kind: "failure" });
    await assert.rejects(run({ ...options, mode: "apply" }), /applied, not prepared/);
  } finally { clean(); }
});

test("apply refuses jobs that failed after the dry run", async () => {
  const { db, options, clean } = setup();
  try {
    await run({ ...options, mode: "dry-run" });
    db.docs.set("llmJobs/JobLate", failed("internal", "later"));
    await assert.rejects(run({ ...options, mode: "apply" }), /job-JobLate/);
    assert.equal(db.snapshot("aiIncidents/job-JobA"), undefined);
  } finally { clean(); }
});

test("the CLI defaults to a dry run and needs a receipt to apply", () => {
  assert.equal(parseArgs([]).mode, "dry-run");
  assert.match(parseArgs([]).receiptPath, /^\.netlify\/ai-incidents\/backfill-\d{4}-\d{2}-\d{2}\.json$/);
  assert.throws(() => parseArgs(["--apply"]), /needs --receipt/);
  assert.equal(parseArgs(["--apply", "--receipt", ".netlify/ai-incidents/r.json"]).mode, "apply");
});
