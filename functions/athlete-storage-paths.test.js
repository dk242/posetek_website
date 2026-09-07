const assert = require("node:assert/strict");
const { test } = require("node:test");
const { playerSegment, storageFolderCandidates } = require("./athlete-storage-paths");
const bucket = "kickai-69dd0.firebasestorage.app";
const folder = "athlete/sprint/session2/kick3";

test("owned raw, file and same-bucket gs recording paths remain supported", () => {
  for (const storagePath of [folder, folder + "/", folder + "/video.mov", `gs://${bucket}/${folder}/pose.json`]) {
    assert.deepEqual(storageFolderCandidates("athlete", "sprint", {storagePath, sessionNumber: 2, repNumber: 3}, bucket), [folder]);
  }
});
test("legacy missing storagePath uses only the authorized athlete", () => {
  assert.deepEqual(storageFolderCandidates("athlete", "shooting", {}, bucket), ["athlete/deadballShot/session1/kick1"]);
});
test("historic foreign, alternate-drill, encoded and traversal paths never reach the signer", () => {
  for (const storagePath of ["victim/sprint/session2/kick3", "athlete-other/sprint/session2/kick3",
    "athlete/jump/session2/kick3", "athlete/sprint/../../victim/sprint/session2/kick3",
    "athlete/sprint/session2/kick3/../secret", "athlete/sprint/session2/kick3%2f..%2fsecret",
    "athlete\\sprint\\session2\\kick3", `gs://foreign/${folder}`, `https://example.com/${folder}`,
    "/" + folder, folder + "?token=secret", folder + "\u0000", 123]) {
    assert.throws(() => storageFolderCandidates("athlete", "sprint", {storagePath}, bucket), String(storagePath));
  }
});
test("invalid/reserved owner IDs and inherited drill keys are refused", () => {
  for (const player of ["diagnostics", "failure_cases", "drillCatalogMedia", "../victim", "", "a/b"]) {
    assert.equal(playerSegment(player), false);
    assert.throws(() => storageFolderCandidates(player, "sprint", {}, bucket));
  }
  assert.throws(() => storageFolderCandidates("athlete", "toString", {}, bucket));
});
test("malformed recording numbers cannot change the signed folder", () => {
  for (const sessionNumber of [-1, 0, 1.5, Infinity, "../victim", {}]) {
    assert.throws(() => storageFolderCandidates("athlete", "sprint", {sessionNumber}, bucket));
  }
});
