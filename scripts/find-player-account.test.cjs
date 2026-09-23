"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseArgs, queryPlan, selectPlayerFields, summarizeAuthUser } = require("./find-player-account.cjs");

test("requires exactly one lookup selector", () => {
  assert.throws(() => parseArgs([]), /exactly one/);
  assert.throws(() => parseArgs(["--email", "a@example.com", "--uid", "uid"]), /exactly one/);
  assert.equal(parseArgs(["--email", "a@example.com"]).projectId, "kickai-69dd0");
});

test("email plan checks both stored aliases and normalized case", () => {
  assert.deepEqual(queryPlan(parseArgs(["--email", "Player@Example.com"])), [
    { kind: "field", field: "email", value: "Player@Example.com", label: "email == \"Player@Example.com\"" },
    { kind: "field", field: "signupEmail", value: "Player@Example.com", label: "signupEmail == \"Player@Example.com\"" },
    { kind: "field", field: "email", value: "player@example.com", label: "email == \"player@example.com\"" },
    { kind: "field", field: "signupEmail", value: "player@example.com", label: "signupEmail == \"player@example.com\"" },
  ]);
});

test("UID plan checks the document ID and both UID aliases", () => {
  const plan = queryPlan(parseArgs(["--uid", "auth-123"]));
  assert.deepEqual(plan.map(item => item.kind === "document" ? "documentId" : item.field), [
    "documentId", "authenticationUID", "userUID",
  ]);
});

test("name plan checks full name and split first/last name", () => {
  const plan = queryPlan(parseArgs(["--name", "Taylor Van Dyke"]));
  assert.deepEqual(plan[1].fields, [["firstName", "Taylor"], ["lastName", "Van Dyke"]]);
});

test("output allowlists account-identifying fields", () => {
  const selected = selectPlayerFields({ name: "Test Player", email: "test@example.com", privateMetric: 42 });
  assert.deepEqual(selected, { name: "Test Player", email: "test@example.com" });
  assert.equal(summarizeAuthUser({ uid: "u1", email: "test@example.com", customClaims: { admin: true } }).customClaims, undefined);
});

