"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const { patchIndex } = require("./prepare.cjs");
test("leaderboard overlay changes only its exact resolver initialization", () => {
  const anchor = 'const teamLeaderboard = createTeamLeaderboard({ db, HttpsError: functions.https.HttpsError });';
  const source = "unchanged before\n" + anchor + "\nunchanged after";
  const result = patchIndex(source);
  assert.ok(result.startsWith("unchanged before\n")); assert.ok(result.endsWith("\nunchanged after"));
  assert.match(result, /effectiveResults \}\);/); assert.match(result, /kickai-69dd0\.firebasestorage\.app/);
  assert.throws(() => patchIndex(source.replace(anchor, "changed")), /initialization changed/);
  assert.throws(() => patchIndex(source + anchor), /initialization changed/);
});
