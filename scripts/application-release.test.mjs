import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { composeApplicationRelease, restoreMarketingSnapshot } from "./build-application-release.mjs";
const sha = value => createHash("sha1").update(value).digest("hex");

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "posetek-app-release-"));
  const put = async (path, value) => { const full = join(root, path); await mkdir(dirname(full), { recursive: true }); await writeFile(full, value); };
  const files = new Map([["/application.html", "old entry"], ["/assets/old.js", "old asset"], ["/booking.html", "booking"], ["/marketing/home-navigation.js", "bridge"]]);
  for (const [path, bytes] of files) await put("production-dist" + path, bytes);
  await put("production-dist/index.html", "<!-- posetek-marketing-entry -->homepage");
  await put("production-dist/coaches/index.html", "<!-- posetek-coaches-entry -->coaches");
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
  assert.equal(await readFile(join(root, "production-dist/coaches/index.html"), "utf8"), "<!-- posetek-coaches-entry -->coaches");
  assert.match(await readFile(join(root, "production-dist/application.html"), "utf8"), /home-navigation/);
  await assert.rejects(readFile(join(root, "production-dist/private.json")), { code: "ENOENT" });
}));
test("application composition rejects drift and asset-name collisions", async () => {
  await fixture(async (root, put) => { await put("production-dist/booking.html", "changed"); await assert.rejects(composeApplicationRelease(root), /Baseline not verified/); });
  await fixture(async (root, put) => { await put("dist/assets/old.js", "collision"); await assert.rejects(composeApplicationRelease(root), /Asset collision/); });
});

async function snapshotFixture(run) {
  return fixture(async (root, put) => {
    const original = new Map([
      ["/index.html", "<!-- posetek-marketing-entry -->approved homepage\r\n"],
      ["/coaches/index.html", "<!-- posetek-coaches-entry -->approved coaches\r\n"],
      ["/marketing/assets/players-pinned.js", "approved players\r\n"],
      ["/marketing/assets/nested/coaches-pinned.js", "approved coaches\r\n"],
    ]);
    for (const [path, bytes] of original) await put("private-snapshot" + path, bytes);
    await put("production-dist/marketing/assets/obsolete.js", "generated old asset");
    await put("production-dist/marketing/assets/nested/obsolete.js", "generated nested old asset");
    await put("production-dist/marketing/public.txt", "unrelated public file");
    const manifestPath = join(root, "snapshot.json");
    const manifest = {
      deploymentId: "approved-marketing",
      sourceDirectory: join(root, "private-snapshot"),
      files: [...original].map(([path, bytes]) => ({ path, sha: sha(bytes), size: Buffer.byteLength(bytes) })),
      served: [...original].map(([path, bytes]) => ({ path: path === "/index.html" ? "/" : path === "/coaches/index.html" ? "/coaches" : path,
        sha: sha(path.endsWith(".html") ? bytes.replaceAll("\r\n", "\n") : bytes) })),
    };
    const save = () => writeFile(manifestPath, JSON.stringify(manifest));
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push(url);
      assert.equal(options.cache, "no-store");
      assert.equal(new URL(url).origin, "https://posetek.net");
      let path = new URL(url).pathname;
      if (path === "/") path = "/index.html";
      if (path === "/coaches" || path === "/coaches/") path = "/coaches/index.html";
      const bytes = original.get(path);
      assert.ok(bytes !== undefined, "Only scoped marketing URLs may be fetched");
      return new Response(path.endsWith(".html") ? bytes.replaceAll("\r\n", "\n") : bytes);
    };
    const unchanged = async () => {
      assert.equal(await readFile(join(root, "production-dist/index.html"), "utf8"), "<!-- posetek-marketing-entry -->homepage");
      assert.equal(await readFile(join(root, "production-dist/marketing/assets/obsolete.js"), "utf8"), "generated old asset");
      assert.equal(await readFile(join(root, "production-dist/application.html"), "utf8"), "old entry");
    };
    await save();
    await run({ root, put, original, manifest, manifestPath, save, fetchImpl, calls, unchanged });
  });
}

test("marketing snapshot restores exact approved bytes, removes obsolete assets, and records provenance", async () => snapshotFixture(async ({ root, original, manifestPath, fetchImpl, calls }) => {
  const marketing = await restoreMarketingSnapshot(root, manifestPath, { fetchImpl });
  assert.deepEqual(marketing, { marketingDeploymentId: "approved-marketing" });
  assert.equal(calls.length, original.size);
  for (const [path, bytes] of original) assert.deepEqual(await readFile(join(root, "production-dist" + path)), Buffer.from(bytes));
  await assert.rejects(readFile(join(root, "production-dist/marketing/assets/obsolete.js")), { code: "ENOENT" });
  await assert.rejects(readFile(join(root, "production-dist/marketing/assets/nested/obsolete.js")), { code: "ENOENT" });
  assert.equal(await readFile(join(root, "production-dist/marketing/public.txt"), "utf8"), "unrelated public file");
  assert.equal(await readFile(join(root, "production-dist/marketing/home-navigation.js"), "utf8"), "bridge");
  assert.equal(await readFile(join(root, "production-dist/assets/old.js"), "utf8"), "old asset");
  const receipt = await composeApplicationRelease(root, marketing);
  assert.equal(receipt.marketingDeploymentId, "approved-marketing");
  assert.equal(receipt.homepageSha, sha(original.get("/index.html")));
  const saved = JSON.parse(await readFile(join(root, ".netlify/application-release-build.json"), "utf8"));
  assert.equal(saved.marketingDeploymentId, "approved-marketing");
  assert.ok(!JSON.stringify(saved).includes("private-snapshot"));
}));

test("marketing snapshot validates every checksum and size before output mutation", async () => {
  for (const field of ["sha", "size"]) await snapshotFixture(async ({ root, manifest, manifestPath, save, fetchImpl, calls, unchanged }) => {
    manifest.files.at(-1)[field] = field === "sha" ? "0".repeat(40) : 10000;
    await save();
    await assert.rejects(restoreMarketingSnapshot(root, manifestPath, { fetchImpl }), /checksum or size mismatch/);
    assert.equal(calls.length, 0);
    await unchanged();
  });
});

test("marketing snapshot rejects out-of-scope, traversal, encoded and duplicate file paths", async () => {
  for (const path of ["/application.html", "/assets/app.js", "/marketing/assets/../public.txt", "/marketing/assets/../../assets/app.js", "/marketing/assets/%2e%2e/file.js", "/marketing/assets/a\\file.js", "/INDEX.html"]) {
    await snapshotFixture(async ({ root, manifest, manifestPath, save, fetchImpl, unchanged }) => {
      manifest.files.push({ ...manifest.files[0], path });
      await save();
      await assert.rejects(restoreMarketingSnapshot(root, manifestPath, { fetchImpl }), /Invalid marketing snapshot file/);
      await unchanged();
    });
  }
  await snapshotFixture(async ({ root, manifest, manifestPath, save, fetchImpl, unchanged }) => {
    manifest.files.push({ ...manifest.files[2], path: "/marketing/assets/PLAYERS-PINNED.js" });
    await save();
    await assert.rejects(restoreMarketingSnapshot(root, manifestPath, { fetchImpl }), /Duplicate marketing snapshot path/);
    await unchanged();
  });
});

test("marketing snapshot requires isolated absolute source and complete scoped live coverage", async () => {
  const mutations = [
    [m => { m.sourceDirectory = "relative"; }, /Invalid marketing snapshot manifest/],
    [(m, root) => { m.sourceDirectory = join(root, "production-dist"); }, /must not overlap/],
    [m => { m.served.pop(); }, /must cover every snapshot file/],
    [m => { m.served[0].path = "//outside.example/"; }, /Invalid served marketing snapshot path/],
    [m => { m.served.push(m.served[0]); }, /Duplicate served marketing snapshot path/],
  ];
  for (const [mutate, expected] of mutations) await snapshotFixture(async ({ root, manifest, manifestPath, save, fetchImpl, calls, unchanged }) => {
    mutate(manifest, root);
    await save();
    await assert.rejects(restoreMarketingSnapshot(root, manifestPath, { fetchImpl }), expected);
    assert.equal(calls.length, 0);
    await unchanged();
  });
});

test("marketing snapshot stops on live drift, failures or external redirects without output changes", async () => {
  for (const fault of ["drift", "http", "redirect"]) await snapshotFixture(async ({ root, manifestPath, fetchImpl, unchanged }) => {
    const verify = async (url, options) => {
      if (!url.includes("nested/")) return fetchImpl(url, options);
      if (fault === "http") return new Response("missing", { status: 404 });
      if (fault === "redirect") return { ok: true, url: "https://outside.example/file.js" };
      return new Response("new concurrent deployment");
    };
    await assert.rejects(restoreMarketingSnapshot(root, manifestPath, { fetchImpl: verify }), /marketing changed|Could not verify|Unexpected marketing verification redirect/);
    await unchanged();
  });
});

test("marketing snapshot rejects source and output directory junctions before mutation", async () => {
  for (const tree of ["private-snapshot", "production-dist"]) await snapshotFixture(async ({ root, put, manifestPath, fetchImpl, calls, unchanged }) => {
    const nested = join(root, tree, "marketing/assets/nested");
    // This exact fixture-owned directory is contained in the temporary test root.
    assert.equal(dirname(dirname(dirname(nested))), join(root, tree));
    await rm(nested, { recursive: true });
    await put("outside/coaches-pinned.js", "approved coaches\r\n");
    await symlink(join(root, "outside"), nested, "junction");
    await assert.rejects(restoreMarketingSnapshot(root, manifestPath, { fetchImpl }), /Symbolic links are not allowed/);
    assert.equal(calls.length, 0);
    await unchanged();
    assert.equal(await readFile(join(root, "outside/coaches-pinned.js"), "utf8"), "approved coaches\r\n");
  });
});
