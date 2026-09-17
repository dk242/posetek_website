// Deliberate application release, separate from ordinary homepage preservation.
// The existing build verifies live drift and assembles all preserved public files first.
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join, relative, isAbsolute, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const sha = bytes => createHash("sha1").update(bytes).digest("hex");
export async function composeApplicationRelease(root) {
  const output = join(root, "production-dist"), dist = join(root, "dist");
  const baseline = JSON.parse(await readFile(join(root, "deployment/homepage-baseline.json"), "utf8"));
  const homepage = await readFile(join(output, "index.html"));
  if (!homepage.toString().includes("<!-- posetek-marketing-entry -->")) throw new Error("Verified homepage output is required");
  const coaches = await readFile(join(output, "coaches/index.html"));
  if (!coaches.toString().includes("<!-- posetek-coaches-entry -->")) throw new Error("Verified coaches output is required");
  const entry = await readFile(join(dist, "index.html"), "utf8");
  if (!entry.includes('id="root"') || !entry.includes('type="module"') || entry.includes("/src/") || !entry.includes("/assets/")) throw new Error("Fresh compiled application entry required");
  const before = new Map();
  for (const file of baseline.files) {
    const bytes = await readFile(join(output, file.path.slice(1)));
    if (sha(bytes) !== file.sha || bytes.length !== file.size) throw new Error("Baseline not verified: " + file.path);
    before.set(file.path, bytes);
  }
  const added = [];
  async function copyAssets(directory, prefix = "/assets") {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = prefix + "/" + item.name, source = join(directory, item.name);
      if (item.isDirectory()) { await copyAssets(source, path); continue; }
      if (!item.isFile()) throw new Error("Unexpected asset type: " + path);
      const target = resolve(output, "." + path), rel = relative(output, target);
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Invalid output path");
      const bytes = await readFile(source);
      const preserved = before.get(path);
      if (preserved && sha(preserved) !== sha(bytes)) throw new Error("Asset collision with existing application: " + path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      if (!preserved) added.push({ path, sha: sha(bytes), size: bytes.length });
    }
  }
  await copyAssets(join(dist, "assets"));
  const bridge = '\n<!-- homepage-navigation:start -->\n<script src="/marketing/home-navigation.js" defer></script>\n<!-- homepage-navigation:end -->\n';
  const application = entry.replace("</body>", bridge + "</body>");
  if (!application.includes(bridge)) throw new Error("Application body is missing");
  await writeFile(join(output, "application.html"), application);
  for (const [path, bytes] of before) {
    if (path === "/application.html") continue;
    if (sha(await readFile(join(output, path.slice(1)))) !== sha(bytes)) throw new Error("Unrelated file changed: " + path);
  }
  if (sha(await readFile(join(output, "index.html"))) !== sha(homepage)) throw new Error("Homepage changed during application composition");
  if (sha(await readFile(join(output, "coaches/index.html"))) !== sha(coaches)) throw new Error("Coaches page changed during application composition");
  const receipt = { baselineDeploymentId: baseline.deploymentId, homepageSha: sha(homepage), coachesSha: sha(coaches), preservedFiles: before.size - 1,
    application: { path: "/application.html", sha: sha(application), size: Buffer.byteLength(application) }, added };
  await mkdir(join(root, ".netlify"), { recursive: true });
  await writeFile(join(root, ".netlify/application-release-build.json"), JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  function run(file, args = [], cwd = root) {
    const result = spawnSync(process.execPath, [file, ...args], { cwd, stdio: "inherit", windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error("Build failed: " + file);
  }
  run(join(root, "scripts/build-production.mjs"));
  // Do not copy arbitrary repository-root legacy files into a public release.
  run(join(root, "app/node_modules/vite/bin/vite.js"), ["build"], join(root, "app"));
  const receipt = await composeApplicationRelease(root);
  console.log(JSON.stringify({ preservedFiles: receipt.preservedFiles, addedAssets: receipt.added.length, application: receipt.application }));
}
