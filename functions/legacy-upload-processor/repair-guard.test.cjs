"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRepairGuard } = require("./repair-guard.js");
const md5 = createHash("md5").update("archived clip").digest("base64");
const data = { bucket: "test-bucket", name: "players/example/reps/clip.mov", md5Hash: md5 };
const key = d => createHash("sha256").update(`${d.bucket}\n${d.name}`).digest("hex");
test("only the configured archive bytes are skipped", () => {
  const guard = createRepairGuard(JSON.stringify({ [key(data)]: md5 }));
  assert.equal(guard(data), true);
  assert.equal(guard({ ...data, name: "unrelated.mov" }), false);
  assert.equal(guard({ ...data, bucket: "another-bucket" }), false);
  assert.equal(guard({ ...data, md5Hash: createHash("md5").update("new clip").digest("base64") }), false);
  assert.equal(guard({ ...data, md5Hash: undefined }), true);
  assert.equal(guard(null), false);
});
test("source and destination can both be protected for rollback", () => {
  const dest = { ...data, name: "players/canonical/reps/clip.mov" };
  const guard = createRepairGuard(JSON.stringify({ [key(data)]: md5, [key(dest)]: md5 }));
  assert.equal(guard(data), true);
  assert.equal(guard(dest), true);
  assert.equal(createRepairGuard()(data), false);
});
test("invalid deployment configuration fails at startup", () => {
  for (const value of ["null", "[]", "bad-json", '{"bad":"value"}', JSON.stringify({ [key(data)]: "bad" })]) {
    assert.throws(() => createRepairGuard(value));
  }
});

function loadHandler(archives = {}) {
  const calls = { storage: [], posts: [], errors: [], registration: null };
  const plain = value => JSON.parse(JSON.stringify(value));
  class Storage {
    bucket(bucket) {
      calls.storage.push({ operation: "bucket", bucket });
      return { file(name) {
        calls.storage.push({ operation: "file", name });
        return { async getSignedUrl(options) {
          calls.storage.push({ operation: "getSignedUrl", options: plain(options) });
          return ["https://example.invalid/test-signed-video"];
        } };
      } };
    }
  }
  const mocks = {
    "firebase-functions/v2/storage": { onObjectFinalized(options, handler) {
      calls.registration = plain(options);
      return handler;
    } },
    "firebase-functions": { logger: { log() {}, error(...args) { calls.errors.push(args); } } },
    axios: { async post(url, payload) {
      calls.posts.push({ url, payload: plain(payload) });
      return { status: 200, data: { accepted: true } };
    } },
    "@google-cloud/storage": { Storage },
    "./repair-guard": { createRepairGuard },
  };
  const context = { exports: {}, process: { env: { POSETEK_REPAIR_ARCHIVES: JSON.stringify(archives) } },
    require(name) { assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`); return mocks[name]; } };
  const filename = path.join(__dirname, "index.js");
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename });
  assert.deepEqual(calls.registration, { region: "us-west1" });
  assert.equal(typeof context.exports.onVideoUpload, "function");
  return { calls, handle: context.exports.onVideoUpload };
}

test("finalize handler skips guarded source and destination archives without Storage or HTTP work", async () => {
  const destination = { ...data, name: "players/canonical/reps/clip.mov" };
  const { handle, calls } = loadHandler({ [key(data)]: md5, [key(destination)]: md5 });
  for (const object of [data, destination, { ...data, md5Hash: undefined }]) {
    await handle({ data: { ...object, generation: "1234" } });
  }
  assert.deepEqual(calls.storage, []);
  assert.deepEqual(calls.posts, []);
  assert.deepEqual(calls.errors, []);
});

test("ordinary MOV and changed bytes at an archived path still invoke the legacy processor once", async () => {
  for (const object of [
    { ...data, name: "players/unrelated/session1/kick1/video.mov" },
    { ...data, md5Hash: createHash("md5").update("new recording").digest("base64") },
    { ...data, bucket: "unrelated-bucket" },
  ]) {
    const { handle, calls } = loadHandler({ [key(data)]: md5 });
    const before = Date.now();
    await handle({ data: object });
    assert.equal(calls.storage.length, 3);
    assert.deepEqual(calls.storage.slice(0, 2), [
      { operation: "bucket", bucket: object.bucket }, { operation: "file", name: object.name },
    ]);
    const options = calls.storage[2].options;
    assert.equal(options.version, "v4");
    assert.equal(options.action, "read");
    assert.ok(options.expires >= before + 300000 && options.expires <= Date.now() + 300000);
    assert.deepEqual(calls.posts, [{
      url: "https://kickai-processor-839600313930.us-west1.run.app",
      payload: { gcs_path: object.name, video_url: "https://example.invalid/test-signed-video" },
    }]);
    assert.deepEqual(calls.errors, []);
  }
});

test("ordinary JSON and other non-MOV artifacts produce no processing request", async () => {
  const { handle, calls } = loadHandler({ [key(data)]: md5 });
  for (const name of ["players/unrelated/metadata.json", "players/unrelated/pose.json", "players/unrelated/video.mp4", "players/unrelated/calibration.png"]) {
    await handle({ data: { ...data, name } });
  }
  assert.deepEqual(calls.storage, []);
  assert.deepEqual(calls.posts, []);
  assert.deepEqual(calls.errors, []);
});

test("ordinary body scan images retain the existing body-scan processor contract", async () => {
  const { handle, calls } = loadHandler({ [key(data)]: md5 });
  const object = { ...data, name: "players/unrelated/BodyScan.PNG" };
  await handle({ data: object });
  assert.equal(calls.storage.filter(call => call.operation === "getSignedUrl").length, 1);
  assert.deepEqual(calls.posts, [{
    url: "https://kickai-bodyscan-839600313930.us-west1.run.app",
    payload: { gcs_path: object.name, video_url: "https://example.invalid/test-signed-video", bucket: object.bucket },
  }]);
  assert.deepEqual(calls.errors, []);
});
