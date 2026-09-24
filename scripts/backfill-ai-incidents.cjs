"use strict";
// One-off backfill of aiIncidents for historical failed llmJobs (AI
// observability plan §3.3 / Phase 1: "the 89 historical failures").
//
//   node scripts/backfill-ai-incidents.cjs                 # dry run (default): reads only
//   node scripts/backfill-ai-incidents.cjs --apply --receipt <dry-run receipt>
//
// Each failed job becomes `aiIncidents/job-<jobId>` with `source: projection`
// and `backfill: true` — the same document projectFailedLlmJobs writes, so the
// alert metric (filter `backfill!=true`) never counts it, and the script
// writes no log lines. Writes are create-if-absent: a job the gateway or the
// projection already recorded is left alone, and a re-run is a no-op.
//
// The dry run writes a receipt listing what apply would create (ids, codes,
// capabilities, days — no uids, messages or player ids) to a git-ignored
// `.netlify/` path. Apply refuses without that receipt, and refuses if a job
// it would now create was not in it.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");
const { projectionFor } = require("../functions/ai-incidents");

const ROOT = path.resolve(__dirname, "..");
const PROJECT = "kickai-69dd0";

function usage() {
  return [
    "Usage: node scripts/backfill-ai-incidents.cjs [--apply] [--receipt <path>] [--project <id>]",
    "  default: dry run; writes a receipt under .netlify/ai-incidents/ and changes nothing",
    "  --apply: create the incidents listed in an existing dry-run receipt (create-if-absent)",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { mode: "dry-run", receiptPath: null, projectId: PROJECT };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") options.mode = "apply";
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--receipt") options.receiptPath = argv[++index];
    else if (argument === "--project") options.projectId = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.mode === "apply" && !options.receiptPath) throw new Error("--apply needs --receipt <dry-run receipt>");
  if (!options.receiptPath) options.receiptPath = `.netlify/ai-incidents/backfill-${new Date().toISOString().slice(0, 10)}.json`;
  return options;
}

function privatePath(value) {
  const resolved = path.resolve(ROOT, value);
  const relative = path.relative(path.join(ROOT, ".netlify"), resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Use a private, git-ignored .netlify/ path for the receipt");
  execFileSync("git", ["check-ignore", "--quiet", "--", resolved], { cwd: ROOT });
  return resolved;
}

async function plan({ db, FieldValue, Timestamp, nowMillis }) {
  const [jobs, config] = await Promise.all([
    db.collection("llmJobs").where("status", "==", "failed").get(),
    db.collection("config").doc("llm").get(),
  ]);
  const list = config.exists ? config.data().testUids : null;
  const testUids = new Set(Array.isArray(list) ? list.filter(uid => typeof uid === "string") : []);
  const rows = [];
  for (const job of jobs.docs) {
    const { incidentId, doc } = projectionFor(job.id, job.data(), { Timestamp, FieldValue, nowMillis, backfill: true, testUids });
    const existing = await db.collection("aiIncidents").doc(incidentId).get();
    rows.push({ incidentId, jobId: job.id, doc, exists: existing.exists });
  }
  rows.sort((a, b) => a.incidentId.localeCompare(b.incidentId));
  return rows;
}

function summarize(rows) {
  const toCreate = rows.filter(row => !row.exists);
  const byCode = {};
  for (const row of toCreate) byCode[row.doc.code] = (byCode[row.doc.code] || 0) + 1;
  return {
    failedJobs: rows.length,
    alreadyRecorded: rows.filter(row => row.exists).map(row => row.incidentId),
    toCreate: toCreate.map(row => ({ incidentId: row.incidentId, code: row.doc.code, kind: row.doc.kind,
      capability: row.doc.capability, day: row.doc.day, isTest: row.doc.isTest })),
    byCode,
  };
}

async function run({ db, FieldValue, Timestamp, mode, receiptPath, now = () => Date.now() }) {
  const rows = await plan({ db, FieldValue, Timestamp, nowMillis: now() });
  const summary = summarize(rows);
  if (mode === "dry-run") {
    if (fs.existsSync(receiptPath)) throw new Error(`Receipt already exists: ${receiptPath} (use a new path)`);
    const receipt = { schemaVersion: 1, state: "prepared", preparedAt: new Date(now()).toISOString(), ...summary };
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    return { mode, ...summary, remoteMutations: 0 };
  }
  if (mode !== "apply") throw new Error(`Unknown mode ${mode}`);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  if (receipt.state !== "prepared") throw new Error(`Receipt is ${receipt.state}, not prepared`);
  const approved = new Set(receipt.toCreate.map(row => row.incidentId));
  const unapproved = summary.toCreate.filter(row => !approved.has(row.incidentId)).map(row => row.incidentId);
  if (unapproved.length) throw new Error(`Jobs failed since the dry run; prepare a new receipt: ${unapproved.join(", ")}`);
  const created = [];
  for (const row of rows.filter(r => !r.exists)) {
    const ref = db.collection("aiIncidents").doc(row.incidentId);
    const made = await db.runTransaction(async tx => {
      if ((await tx.get(ref)).exists) return false;
      tx.create(ref, row.doc);
      return true;
    });
    if (made) created.push(row.incidentId);
  }
  Object.assign(receipt, { state: "applied", appliedAt: new Date(now()).toISOString(), created });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { mode, failedJobs: summary.failedJobs, created: created.length, remoteMutations: created.length };
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const receiptPath = privatePath(options.receiptPath);
  const requireFromFunctions = createRequire(path.resolve(__dirname, "../functions/package.json"));
  const admin = requireFromFunctions("firebase-admin");
  const app = admin.apps.length ? admin.app() : admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: options.projectId,
  });
  try {
    const result = await run({ db: app.firestore(), FieldValue: admin.firestore.FieldValue, Timestamp: admin.firestore.Timestamp,
      mode: options.mode, receiptPath });
    process.stdout.write(`${JSON.stringify({ projectId: options.projectId, receipt: path.relative(ROOT, receiptPath),
      ...result, toCreate: result.toCreate ? result.toCreate.length : undefined }, null, 2)}\n`);
  } finally {
    await app.delete();
  }
}

module.exports = { parseArgs, run, summarize };

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`AI incident backfill failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
