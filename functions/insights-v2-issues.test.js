"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { issueDetails } = require("./insights-v2");

const start = Date.UTC(2026, 8, 1), end = Date.UTC(2026, 9, 1), now = Date.UTC(2026, 8, 26);
const period = { startMillis: start, testingMode: "period" };
const row = {
  id: "player-1", firstName: "Casey", lastName: "Rivera", organizationName: "Club", teamName: "U17",
  history: {
    testing: [
      { id: "rep-current", at: start + 1000, drill: "sprint", reason: "missingEvidence", needsReview: 1 },
      { id: "rep-old", at: start - 1000, drill: "jump", needsReview: 1 },
      { id: "rep-good", at: start + 2000, needsReview: 0 },
      { id: "rep-undated", at: null, needsReview: 1 },
      { id: "rep-future", at: now + 1000, needsReview: 1 },
    ],
    failures: [
      { id: "failure-current", at: start + 1000, unmatched: 1 },
      { id: "failure-linked", at: start + 2000, unmatched: 0 },
      { id: "failure-old", at: start - 1000, unmatched: 1 },
      { id: "failure-undated", at: null, unmatched: 1 },
    ],
  },
};

test("issue queues match dated Insights counts under period and cumulative testing", () => {
  const review = issueDetails([row], "needsReview", period, now + 1, now);
  assert.equal(review.rows.length, 1);
  assert.equal(review.rows[0].recordId, "rep-current");
  assert.equal(review.rows[0].reason, "missingEvidence");
  assert.equal(review.undated, 1);
  assert.equal(review.futureDated, 1);
  assert.equal(review.undatedRows[0].recordId, "rep-undated");
  assert.equal(review.undatedRows[0].atMillis, null);
  assert.equal(review.futureRows[0].recordId, "rep-future");
  const cumulative = issueDetails([row], "needsReview", { ...period, testingMode: "cumulative" }, now + 1, now);
  assert.equal(cumulative.rows.length, 2);
  const failures = issueDetails([row], "unmatchedFailures", { ...period, testingMode: "cumulative" }, now + 1, now);
  assert.equal(failures.rows.length, 1);
  assert.equal(failures.rows[0].recordId, "failure-current");
  assert.equal(failures.undated, 1);
});
