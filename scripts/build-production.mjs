// Release only the public homepage. Keep the current production application
// byte-for-byte, even when local dependencies or unrelated source have changed.
import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const app = join(root, "app");
const output = join(root, "production-dist");
const manifest = JSON.parse(await readFile(join(root, "deployment/homepage-baseline.json"), "utf8"));
const cache = join(app, "node_modules/.cache/homepage-baseline", manifest.deploymentId);
const hash = bytes => createHash("sha1").update(bytes).digest("hex");
const injected = /\n<!-- homepage-navigation:start -->[\s\S]*?<!-- homepage-navigation:end -->\n/g;
const entry = manifest.files.find(file => file.path === "/index.html");
const live = await fetch("https://posetek.net/", { signal: AbortSignal.timeout(30000) });
if (!live.ok) throw new Error("Could not verify production before building");
const liveHtml = await live.text();
let current = liveHtml;
if (liveHtml.includes("<!-- posetek-marketing-entry -->")) {
  const response = await fetch("https://posetek.net/application.html", { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error("Could not verify preserved application");
  current = (await response.text()).replace(injected, "");
}
if (hash(current) !== entry.sha) throw new Error("Production application changed; reconcile homepage-baseline.json with its latest deployment.");

function command(file, args) {
  const result = spawnSync(process.execPath, [file, ...args], { cwd: app, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Build command failed: ${file}`);
}
command(join(app, "node_modules/typescript/bin/tsc"), ["-b"]);
command(join(app, "node_modules/vite/bin/vite.js"), ["build", "--config", "vite.marketing.config.ts"]);

// Validate the absolute target immediately before the recursive operation.
if (relative(root, output) !== "production-dist" || isAbsolute(relative(root, output))) throw new Error("Invalid output directory");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
function contained(directory, file) {
  const target = resolve(directory, "." + file);
  const rel = relative(directory, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Invalid baseline path: " + file);
  return target;
}

let index = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (index < manifest.files.length) {
    const file = manifest.files[index++];
    const cached = contained(cache, file.path);
    let bytes;
    try { bytes = await readFile(cached); } catch { /* First release downloads the pinned deploy. */ }
    // Netlify pretty-URL processing rewrites served HTML. Prefer matching
    // original source bytes, allowing only Git's Windows line-ending conversion.
    if ((!bytes || hash(bytes) !== file.sha) && file.localPath) {
      try {
        const local = await readFile(contained(root, "/" + file.localPath));
        const normalized = Buffer.from(local.toString("utf8").replace(/\r\n/g, "\n"));
        if (hash(local) === file.sha) bytes = local;
        else if (hash(normalized) === file.sha) bytes = normalized;
      } catch { /* Download when the original source is unavailable. */ }
    }
    if (!bytes || hash(bytes) !== file.sha) {
      const response = await fetch(new URL(file.path, manifest.url), { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`Baseline download failed: ${file.path} (${response.status})`);
      bytes = Buffer.from(await response.arrayBuffer());
      if (hash(bytes) !== file.sha || bytes.length !== file.size) throw new Error("Baseline checksum mismatch: " + file.path);
    }
    await mkdir(dirname(cached), { recursive: true });
    await writeFile(cached, bytes);
    const target = contained(output, file.path === "/index.html" ? "/application.html" : file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}));

const shellPath = join(output, "application.html");
const applicationHtml = await readFile(shellPath, "utf8");
if (!applicationHtml.includes("</body>")) throw new Error("Unexpected application shell");
await writeFile(shellPath, applicationHtml.replace("</body>", '\n<!-- homepage-navigation:start -->\n<script src="/marketing/home-navigation.js" defer></script>\n<!-- homepage-navigation:end -->\n</body>'));
const marketingHtml = await readFile(join(root, "marketing-dist/index.html"), "utf8");
if (!marketingHtml.includes("<!-- posetek-marketing-entry -->")) throw new Error("Missing marketing entry marker");
await writeFile(join(output, "index.html"), marketingHtml);
await cp(join(root, "marketing-dist/assets"), join(output, "marketing/assets"), { recursive: true });
await cp(join(root, "deployment/home-navigation.js"), join(output, "marketing/home-navigation.js"));

for (const file of manifest.files) {
  const bytes = await readFile(contained(output, file.path === "/index.html" ? "/application.html" : file.path));
  const original = file.path === "/index.html" ? bytes.toString("utf8").replace(injected, "") : bytes;
  if (hash(original) !== file.sha) throw new Error("Preservation verification failed: " + file.path);
}
console.log(`[production] Verified ${manifest.files.length} preserved application files from ${manifest.deploymentId}; added isolated homepage.`);
