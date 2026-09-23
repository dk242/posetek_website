"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const v2 = require("./source-only.cjs"), v1 = require("./v1-source-only.cjs");
test("v2 source PATCH cannot include environment, IAM, trigger or retry changes", () => {
  const source = { bucket: "upload", object: "source.zip", generation: "123" };
  assert.deepEqual(v2.sourcePatch(source), { updateMask: "buildConfig.source.storageSource", body: { name: "projects/kickai-69dd0/locations/us-west1/functions/onVideoUpload", buildConfig: { source: { storageSource: source } } } });
  assert.equal(v2.sourceUrl(source), "https://storage.googleapis.com/storage/v1/b/upload/o/source.zip?alt=media&generation=123");
});
test("v2 verification ignores operational source/revision fields but detects guard, trigger and resource changes", () => {
  const before = { name: "owned", state: "ACTIVE", updateTime: "old", buildConfig: { build: "old", source: { old: true }, runtime: "nodejs22", entryPoint: "onVideoUpload", environmentVariables: { BUILD: "keep" } },
    serviceConfig: { revision: "old", availableMemory: "256M", environmentVariables: { POSETEK_REPAIR_ARCHIVES: "private" }, serviceAccountEmail: "unchanged" }, eventTrigger: { retryPolicy: "RETRY_POLICY_DO_NOT_RETRY" } };
  const after = structuredClone(before); after.updateTime = "new"; after.buildConfig.build = "new"; after.buildConfig.source = { new: true }; after.serviceConfig.revision = "new";
  assert.deepEqual(v2.protectedDefinition(after), v2.protectedDefinition(before));
  for (const mutate of [x => x.serviceConfig.environmentVariables.POSETEK_REPAIR_ARCHIVES = "changed", x => x.eventTrigger.retryPolicy = "changed", x => x.serviceConfig.availableMemory = "different", x => x.buildConfig.runtime = "different"]) {
    const changed = structuredClone(after); mutate(changed); assert.notDeepEqual(v2.protectedDefinition(changed), v2.protectedDefinition(before));
  }
});
test("v1 source PATCH is restricted to the six reviewed endpoints and sourceUploadUrl only", () => {
  for (const name of v1.OWNED) {
    const patch = v1.sourcePatch(name, "https://example.invalid/source.zip");
    assert.equal(patch.updateMask, "sourceUploadUrl"); assert.deepEqual(Object.keys(patch.body).sort(), ["name", "sourceUploadUrl"]);
  }
  assert.throws(() => v1.sourcePatch("unrelated", "url"));
});
test("v1 verification preserves runtime, IAM-adjacent config, secret bindings, labels and environment", () => {
  const before = { name: "owned", versionId: "1", status: "ACTIVE", updateTime: "old", sourceUploadUrl: "old", buildId: "old", runtime: "nodejs22", timeout: "120s", environmentVariables: { PRIVATE: "keep" }, secretEnvironmentVariables: [{ key: "KEY", version: "1" }], labels: { reviewed: "yes" } };
  const after = { ...before, versionId: "2", updateTime: "new", sourceUploadUrl: "new", buildId: "new" };
  assert.deepEqual(v1.protectedDefinition(before), v1.protectedDefinition(after));
  for (const key of ["runtime", "timeout", "environmentVariables", "secretEnvironmentVariables", "labels"]) assert.notDeepEqual(v1.protectedDefinition(before), v1.protectedDefinition({ ...after, [key]: "changed" }));
});
