"use strict";

// Read-only planner for legacy client-only pairs and missing test labels.
// It accepts an exported in-memory snapshot and returns proposed patches;
// it deliberately has no Firestore dependency or write path.
function planAiIncidentRepair(records, testUids) {
  const byId = new Map(records.map(record => [record.id, record.data || {}]));
  const tests = new Set(testUids);
  const patches = new Map();
  const add = (id, patch) => patches.set(id, { ...(patches.get(id) || {}), ...patch });
  const summary = { clientDocuments: 0, testLabels: 0, folds: 0, uidConflicts: 0, ambiguous: 0 };
  for (const [id, data] of byId) {
    if (!id.startsWith("client-")) continue;
    summary.clientDocuments++;
    const isTest = typeof data.requestedByUid === "string" && tests.has(data.requestedByUid);
    if (data.isTest !== isTest) { add(id, { isTest }); summary.testLabels++; }
    if (data.stage !== "user_report" || data.foldedInto || data.foldRejected || !data.requestId) continue;
    const originalId = `client-${data.requestId}`;
    if (originalId === id) { summary.ambiguous++; continue; }
    const original = byId.get(originalId);
    if (!original || original.stage === "user_report" || original.requestId !== data.requestId) continue;
    if (!data.requestedByUid || data.requestedByUid !== original.requestedByUid) { summary.uidConflicts++; continue; }
    if (original.userReport && JSON.stringify(original.userReport) !== JSON.stringify(data.userReport)) { summary.ambiguous++; continue; }
    add(id, { foldedInto: originalId });
    add(originalId, { source: "both", hasClient: true,
      clientIncidentIds: [...new Set([...(original.clientIncidentIds || []), id])],
      ...(!original.userReport && data.userReport ? { userReport: data.userReport } : {}) });
    summary.folds++;
  }
  return { summary, patches: [...patches].map(([id, patch]) => ({ id, patch })) };
}

module.exports = { planAiIncidentRepair };
