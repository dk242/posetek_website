"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { planAiIncidentRepair } = require("./ai-incidents-repair-plan");

test("read-only legacy plan is idempotent and respects account boundaries", () => {
  const own = "8a1e0f5c-1f0e-4b7a-9a8f-2c3d4e5f6a7b";
  const records = [
    { id: `client-${own}`, data: { requestId: own, requestedByUid: "test-user", stage: "upload", client: { diagnostic: true } } },
    { id: "client-follow", data: { requestId: own, requestedByUid: "test-user", stage: "user_report", userReport: { note: "broken" } } },
    { id: "client-foreign", data: { requestId: own, requestedByUid: "other", stage: "user_report" } },
  ];
  const result = planAiIncidentRepair(records, ["test-user"]);
  assert.deepEqual(result.summary, { clientDocuments: 3, testLabels: 3, folds: 1, uidConflicts: 1, ambiguous: 0 });
  const patched = records.map(record => ({ ...record, data: { ...record.data, ...(result.patches.find(patch => patch.id === record.id)?.patch || {}) } }));
  assert.equal(patched[0].data.userReport.note, "broken");
  assert.equal(patched[1].data.foldedInto, `client-${own}`);
  assert.equal(patched[2].data.foldedInto, undefined);
  const second = planAiIncidentRepair(patched, ["test-user"]);
  assert.equal(second.summary.folds, 0);
  assert.equal(second.summary.testLabels, 0);
  assert.deepEqual(second.patches, []);
});
