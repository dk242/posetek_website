// Compose the immutable serving website with an isolated planner entry point.
// Never rebuild/replace the kick workspace from the older local source.
import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(root, "app");
const output = join(root, "production-dist");
const manifest = JSON.parse((await readFile(join(root, "deployment/production-baseline.json"), "utf8")).replace(/^\uFEFF/, ""));
// Netlify lists its deployment configuration as a file, but does not serve it.
// The repository's reviewed configuration supplies the additional planner route.
const contentFiles = manifest.files.filter(file => file.path !== "/netlify.toml");
const hash = bytes => createHash("sha1").update(bytes).digest("hex");
const cache = join(app, "node_modules/.cache/production-baseline", manifest.deploymentId);
const injected = /\n<!-- personalized-planner-entry:start -->[\s\S]*?<!-- personalized-planner-entry:end -->\n/g;
const indexRecord = manifest.files.find(file => file.path === "/index.html");
const live = await fetch("https://posetek.net/", { signal: AbortSignal.timeout(30000) });
if (!live.ok || hash((await live.text()).replace(injected, "")) !== indexRecord.sha) {
  throw new Error("The production website changed. Reconcile its source/deployment before composing a release.");
}
function command(file, args) {
  const result = spawnSync(process.execPath, [file, ...args], { cwd: app, stdio: "inherit", windowsHide: true });
  if (result.status !== 0) throw new Error(`Build command failed: ${file}`);
}
command(join(app, "node_modules/typescript/bin/tsc"), ["-b"]);
command(join(app, "node_modules/vite/bin/vite.js"), ["build", "--base=/personalized-app/"]);

// Every recursive output operation is constrained to this dedicated directory.
if (relative(root, output) !== "production-dist" || isAbsolute(relative(root, output))) throw new Error("Invalid output directory");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
function contained(directory, file) {
  const target = resolve(directory, "." + file);
  const rel = relative(directory, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Invalid manifest path: " + file);
  return target;
}
let index = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (index < contentFiles.length) {
    const file = contentFiles[index++];
    const cached = contained(cache, file.path);
    let bytes;
    try { bytes = await readFile(cached); } catch { /* Download on cache miss. */ }
    if ((!bytes || hash(bytes) !== file.sha) && file.archive) {
      bytes = gunzipSync(await readFile(contained(join(root, "deployment"), "/" + file.archive)));
      if (hash(bytes) !== file.sha || bytes.length !== file.size) throw new Error("Preserved archive mismatch: " + file.path);
    }
    if (!bytes || hash(bytes) !== file.sha) {
      // Netlify can process served HTML (for example newline normalization).
      // An exact local hash match is the original deployed file, not a rebuild.
      try {
        const local = await readFile(contained(root, file.localPath ? "/" + file.localPath : file.path));
        if (hash(local) === file.sha && local.length === file.size) bytes = local;
        else if (/\.(html|css|js|json|txt|svg|xml)$/i.test(file.path)) {
          const lf = Buffer.from(local.toString("utf8").replace(/\r\n/g, "\n"));
          if (hash(lf) === file.sha && lf.length === file.size) bytes = lf;
        }
      } catch { /* Newer production assets are recovered from the pinned deploy. */ }
    }
    if (!bytes || hash(bytes) !== file.sha) {
      const url = new URL(file.path.split("/").map(encodeURIComponent).join("/"), manifest.url);
      const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`Baseline download failed: ${file.path} (${response.status})`);
      bytes = Buffer.from(await response.arrayBuffer());
      if (hash(bytes) !== file.sha || bytes.length !== file.size) throw new Error("Baseline checksum mismatch: " + file.path);
      await mkdir(dirname(cached), { recursive: true });
      await writeFile(cached, bytes);
    }
    const target = contained(output, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}));

const namespace = join(output, "personalized-app");
await mkdir(namespace, { recursive: true });
await cp(join(root, "dist/assets"), join(namespace, "assets"), { recursive: true });
await cp(join(root, "deployment/planner-entry.js"), join(namespace, "entry.js"));
await cp(join(root, "deployment/planner-entry.css"), join(namespace, "entry.css"));
function attach(html, shell) {
  if (!html.includes("</body>") || html.includes("personalized-planner-entry:start")) throw new Error("Unexpected entry HTML");
  return html.replace("</body>", `\n<!-- personalized-planner-entry:start -->\n<link rel="stylesheet" href="/personalized-app/entry.css">\n<script defer src="/personalized-app/entry.js" data-planner-shell="${shell}"></script>\n<!-- personalized-planner-entry:end -->\n</body>`);
}
await writeFile(join(output, "index.html"), attach(await readFile(join(output, "index.html"), "utf8"), "main"));
await writeFile(join(namespace, "index.html"), attach(await readFile(join(root, "dist/index.html"), "utf8"), "personalized"));
for (const file of contentFiles) {
  const bytes = await readFile(contained(output, file.path));
  const preserved = file.path === "/index.html" ? bytes.toString("utf8").replace(injected, "") : bytes;
  if (hash(preserved) !== file.sha) throw new Error("Preservation verification failed: " + file.path);
}
console.log(`[production] Preserved ${contentFiles.length} existing files; added the planner and its entry link.`);
