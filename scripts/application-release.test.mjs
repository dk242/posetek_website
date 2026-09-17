import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { composeApplicationRelease } from "./build-application-release.mjs";
const sha = value => createHash("sha1").update(value).digest("hex");

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "posetek-app-release-"));
  const put = async (path, value) => { const full = join(root, path); await mkdir(dirname(full), { recursive: true }); await writeFile(full, value); };
  const files = new Map([["/application.html", "old entry"], ["/assets/old.js", "old asset"], ["/booking.html", "booking"], ["/marketing/home-navigation.js", "bridge"]]);
  for (const [path, bytes] of files) await put("production-dist" + path, bytes);
  await put("production-dist/index.html", "<!-- posetek-marketing-entry -->homepage");
  await put("deployment/homepage-baseline.json", JSON.stringify({ deploymentId: "reviewed", files: [...files].map(([path, bytes]) => ({ path, sha: sha(bytes), size: bytes.length })) }));
  await put("dist/index.html", '<html><body><div id="root"></div><script type="module" src="/assets/new.js"></script></body></html>');
  await put("dist/assets/new.js", "new asset");
  await put("dist/private.json", "must never ship");
  try { await run(root, put); } finally {
    assert.equal(dirname(root), resolve(tmpdir())); assert.ok(basename(root).startsWith("posetek-app-release-"));
    await rm(root, { recursive: true, force: true });
  }
}
test("application composition retains homepage and static files and excludes arbitrary root files", async () => fixture(async root => {
  const result = await composeApplicationRelease(root);
  assert.equal(result.preservedFiles, 3); assert.equal(result.added.length, 1);
  assert.equal(await readFile(join(root, "production-dist/index.html"), "utf8"), "<!-- posetek-marketing-entry -->homepage");
  assert.match(await readFile(join(root, "production-dist/application.html"), "utf8"), /home-navigation/);
  await assert.rejects(readFile(join(root, "production-dist/private.json")), { code: "ENOENT" });
}));
test("application composition rejects drift and asset-name collisions", async () => {
  await fixture(async (root, put) => { await put("production-dist/booking.html", "changed"); await assert.rejects(composeApplicationRelease(root), /Baseline not verified/); });
  await fixture(async (root, put) => { await put("dist/assets/old.js", "collision"); await assert.rejects(composeApplicationRelease(root), /Asset collision/); });
});
