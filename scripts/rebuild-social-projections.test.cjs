const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FakeFirestore } = require("../functions/test-support/fake-firestore");
const { migratePage } = require("./rebuild-social-projections.cjs");
test("migration defaults dry-run and resumes after the last completed player", async () => {
  const db = new FakeFirestore({ "players/a": {}, "players/b": {}, "players/c": {} }), calls = [];
  const social = { rebuild: async (id, dryRun) => { calls.push([id, dryRun]); return { writes: 1 }; } };
  const first = await migratePage({ db, social, limit: 2 });
  assert.deepEqual(calls, [["a", true], ["b", true]]); assert.equal(first.complete, false);
  const last = await migratePage({ db, social, cursor: first.cursor, limit: 2, apply: true });
  assert.deepEqual(calls[2], ["c", false]); assert.equal(last.complete, true);
});
test("failed player does not advance checkpoint and is retried on resume", async () => {
  const db = new FakeFirestore({ "players/a": {}, "players/b": {}, "players/c": {} }); let saved;
  await assert.rejects(migratePage({ db, social: { rebuild: async id => { if (id === "b") throw Error("bounded history"); return {}; } }, onCheckpoint: async p => { saved = p; } }), /bounded history/);
  assert.equal(saved.cursor, "a"); assert.equal(saved.failedPlayerId, "b");
  const resumed = [];
  await migratePage({ db, cursor: saved.cursor, social: { rebuild: async id => { resumed.push(id); return {}; } } });
  assert.deepEqual(resumed, ["b", "c"]);
});
