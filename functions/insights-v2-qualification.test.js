"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { qualifyRep, duplicateIds, testingStatus, demographics, workoutEvents } = require("./insights-v2-qualification");
const NOW = Date.UTC(2026, 8, 17, 12);
const rep = { id: "r", repType: "sprint", max_velocity: 8, createdAt: NOW - 1000 };
const evidence = { metadata: { resultsValid: true, processingStatus: "complete", failedSteps: [] }, context: { result: { resultsValid: true, primaryMetric: 8 } } };

test("positive root values require processing evidence, not mere document activity", () => {
  assert.equal(qualifyRep(rep, evidence).qualified, 1);
  assert.equal(qualifyRep(rep).reason, "missingEvidence");
  for (const value of [0, -1, NaN, Infinity, "8"]) assert.equal(qualifyRep({ ...rep, max_velocity: value }, evidence).qualified, 0);
  for (const metadata of [{ resultsValid: false }, { processingStatus: "partial" }, { processingStatus: null }, { processingStatus: "" }, { processingStatus: false }, { failedSteps: ["tracking"] }, { max_velocity: 9 }]) {
    assert.equal(qualifyRep(rep, { ...evidence, metadata }).qualified, 0);
  }
  assert.equal(qualifyRep(rep, { ...evidence, context: { result: { resultsValid: true, primaryMetric: 9 } } }).qualified, 0);
  assert.equal(qualifyRep(rep, { ...evidence, failures: [{ createdAt: NOW - 1000 }] }).qualified, 0);
  for (const value of [null, "", false]) assert.equal(qualifyRep({ ...rep, processingStatus: value }, evidence).qualified, 0);
});

test("only a matching existing accepted revision supersedes older sidecar failure", () => {
  const current = { ...rep, adminRevision: { revisionId: "rev", atMillis: NOW } };
  const revised = { metadata: { ...evidence.metadata, max_velocity: 8, adminRevision: { revisionId: "rev" } },
    context: { result: { resultsValid: false } }, revision: { revisionId: "rev", fields: { max_velocity: 8 } } };
  assert.equal(qualifyRep(current, revised).reason, "acceptedRevision");
  assert.equal(qualifyRep(current, { ...revised, revision: null }).qualified, 0);
  assert.equal(qualifyRep(current, { ...revised, revision: { ...revised.revision, restoredAtMillis: NOW } }).qualified, 0);
  assert.equal(qualifyRep(current, { ...revised, failures: [{ createdAt: NOW - 1 }] }).qualified, 1);
  assert.equal(qualifyRep(current, { ...revised, failures: [{ createdAt: NOW + 1 }] }).qualified, 0);
  assert.equal(qualifyRep(current, { ...revised, failures: [{}] }).qualified, 0);
});

test("pathless jump mirror deduplicates only with explicit matching session and rep", () => {
  const original = { id: "original", repType: "jump", sessionNumber: 1, sessionId: "one", repNumber: 2, storagePath: "recording" };
  const mirror = { ...original, id: "mirror", sessionId: "other", storagePath: undefined };
  assert.deepEqual([...duplicateIds([original, mirror])], ["mirror"]);
  assert.equal(duplicateIds([{ ...original, sessionNumber: undefined }, { ...mirror, sessionNumber: undefined }]).size, 0);
  assert.equal(duplicateIds([original, { ...original, id: "another" }]).size, 0);
  assert.equal(qualifyRep(mirror, evidence, true).attempt, 0);
});
test("cross-drill duplicateOf requires private server-reviewed correction and refuses missing targets, chains, self-links and foreign players", () => {
  const target = { id: "broad", repType: "broadJump", playerId: "player", storagePath: "player/broadJump/session1/kick1", broadJumpDistance: 1.4 };
  const mirror = { id: "mirror", repType: "jump", playerId: "player", duplicateOf: "broad", jumpHeight: 0.3 };
  const correction = { schemaVersion: 1, repairId: "reviewed-repair", reviewedAtMillis: 1000, duplicateReps: { mirror: "broad" } };
  assert.equal(duplicateIds([target, mirror]).size, 0);
  assert.deepEqual([...duplicateIds([target, mirror], correction)], ["mirror"]);
  for (const reps of [[mirror], [target, { ...mirror, duplicateOf: "mirror" }], [{ ...target, duplicateOf: "mirror" }, mirror], [{ ...target, playerId: "foreign" }, mirror]]) assert.equal(duplicateIds(reps, correction).size, 0);
  assert.equal(duplicateIds([target, mirror], { ...correction, duplicateReps: { mirror: "broad", broad: "mirror" } }).size, 0);
  assert.equal(duplicateIds([target, mirror], { ...correction, repairId: "" }).size, 0);
});

test("demographics never infer division or age from names and team labels", () => {
  assert.deepEqual(demographics({ firstName: "Example", teamName: "Girls U15", age: 14 }, {}, NOW), { division: "unknown", age: null, ageBand: "unknown" });
  assert.equal(demographics({ age: 14, ageRecordedAt: NOW - 1000 }, { division: "girls" }, NOW).ageBand, "13-15");
  assert.equal(demographics({ age: 14, ageRecordedAt: NOW - 366 * 86400000 }, {}, NOW).age, null);
  assert.equal(demographics({ age: 14, ageRecordedAt: NOW + 1 }, {}, NOW).age, null);
  assert.equal(demographics({ birthDate: "2010-09-18", age: 30, ageRecordedAt: NOW }, {}, NOW).age, 15);
  assert.equal(demographics({ dateOfBirth: "2010-09-17" }, {}, NOW).age, 16);
  assert.equal(demographics({ birthDate: "2090-01-01" }, {}, NOW).age, null);
});

test("workout completion is separate from completing every prescribed set", () => {
  const log = { id: "x", source: "plan", planId: "p", workoutId: "w", startedAt: NOW - 600000,
    endedAt: NOW, endReason: "completed", activeSeconds: 120,
    workoutSnapshot: { blocks: [{ blockId: "one", sets: 3 }, { blockId: "two", sets: 2 }] },
    blocks: [{ blockId: "one", status: "done", setsCompleted: 3 }, { blockId: "two", status: "skipped", setsCompleted: 1 }] };
  const result = workoutEvents([log])[0];
  assert.equal(result.status, "completed"); assert.equal(result.allPrescribedSetsCompleted, 0);
  assert.equal(result.unknownPrescription, 0); assert.equal(result.skippedBlocks, 1);
  assert.equal(result.setsCompleted, 4);
  assert.equal(result.timerMinutes, 2); assert.equal(result.estimatedMinutes, 0);
  const all = workoutEvents([{ ...log, blocks: log.blocks.map(b => ({ ...b, status: "done", setsCompleted: 3 })) }])[0];
  assert.equal(all.allPrescribedSetsCompleted, 1);
  const legacy = workoutEvents([{ ...log, activeSeconds: undefined, workoutSnapshot: undefined }])[0];
  assert.equal(legacy.estimatedMinutes, 10); assert.equal(legacy.unknownPrescription, 1);
});

test("recognized legacy jump inches normalize to meters consistently with evidence", () => {
  for (const field of ["jump_height_in", "jump_height_inches"]) {
    const current = { repType: "jump", [field]: 20 };
    const output = qualifyRep(current, { metadata: { resultsValid: true, jumpHeight: 0.508 }, context: { result: { resultsValid: true, primaryMetric: 20 } } });
    assert.equal(output.qualified, 1); assert.equal(output.metric.unit, "m"); assert.equal(output.metric.value, 0.508);
  }
});

test("linked workout logs count once; no ending is not inferred abandonment", () => {
  const base = { id: "legacy", planId: "plan", workoutId: "w", startedAt: NOW - 1000, blocks: [] };
  const result = workoutEvents([base, { ...base, id: "current", schemaVersion: 2, source: "plan", workoutSnapshot: { blocks: [] } }]);
  assert.equal(result.length, 1); assert.equal(result[0].duplicateLogs, 1);
  assert.equal(result[0].status, "inProgress"); assert.equal(result[0].unknownDuration, 1);
});

const evidencePath = path.resolve(__dirname, "../.netlify/vacaville-sep16-repair/completion-evidence.json");
const qualificationPath = path.resolve(__dirname, "../.netlify/vacaville-sep16-repair/completion-qualification.json");
test("private historical audit reproduces all approved qualifications and roster totals", { skip: !fs.existsSync(evidencePath) || !fs.existsSync(qualificationPath) }, () => {
  const historical = JSON.parse(fs.readFileSync(evidencePath)), approved = JSON.parse(fs.readFileSync(qualificationPath));
  const actual = [], statuses = {};
  for (const player of historical.roster) {
    const reps = historical.reps.filter(rep => rep.playerId === player.id), duplicates = duplicateIds(reps);
    const events = reps.map(rep => {
      const artifact = historical.artifacts[rep.evidenceFolder], expected = approved.assessments.find(row => row.rep.id === rep.id && row.rep.playerId === rep.playerId);
      const event = qualifyRep(rep, { metadata: artifact?.metadata?.value, context: artifact?.context?.value,
        // The private audit already independently verified revision existence.
        revision: expected?.qualifiedRevision ? { revisionId: rep.adminRevision.revisionId, fields: rep } : null }, duplicates.has(rep.id));
      assert.equal(event.qualified, expected.qualifying, "Historical qualification mismatch");
      assert.equal(event.attempt, expected.attempt, "Historical distinct-attempt mismatch");
      return event;
    });
    actual.push(...events);
    const status = testingStatus(events).status; statuses[status] = (statuses[status] || 0) + 1;
  }
  assert.equal(actual.length, 325); assert.equal(actual.reduce((n, e) => n + e.qualified, 0), 244);
  assert.equal(actual.reduce((n, e) => n + e.duplicate, 0), 27);
  assert.deepEqual(statuses, { fullyTested: 10, partiallyTested: 24, noRecordedTests: 2 });
});
