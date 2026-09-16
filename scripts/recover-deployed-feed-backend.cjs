#!/usr/bin/env node
"use strict";

// Read-only recovery. Downloads contain runtime configuration: keep them ignored
// and inspect an archive before copying any source into the repository.
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const output = path.join(root, ".netlify", "feed-recovery");
const project = "kickai-69dd0";
const region = "us-central1";
const api = "https://cloudfunctions.googleapis.com/v1";

async function main() {
  // Internal Firebase CLI auth APIs were verified with firebase-tools 14.14.0.
  // Reuse its signed-in account; never print or persist OAuth credentials.
  const flag = process.argv.indexOf("--firebase-tools-dir");
  const packagePath = flag >= 0
    ? path.resolve(process.argv[flag + 1] || "", "package.json")
    : require.resolve("firebase-tools/package.json");
  const cli = createRequire(packagePath);
  const { getProjectDefaultAccount } = cli("./lib/auth");
  const { requireAuth } = cli("./lib/requireAuth");
  const { getAccessToken } = cli("./lib/apiv2");
  const account = getProjectDefaultAccount(root);
  if (!account) throw new Error("Sign in with firebase login first.");
  execFileSync("git", ["check-ignore", "--quiet", ".netlify/feed-recovery/source.zip"], { cwd: root });
  await fs.mkdir(output, { recursive: true });
  await requireAuth({ project, ...account });
  const token = await getAccessToken();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const request = async (url, options = {}) => {
    const response = await fetch(url, { ...options, headers });
    if (!response.ok) throw new Error(`Read-only source API returned HTTP ${response.status}.`);
    return response.json();
  };
  let functions = [], pageToken;
  do {
    const url = new URL(`${api}/projects/${project}/locations/${region}/functions`);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const result = await request(url);
    functions.push(...(result.functions || []));
    pageToken = result.nextPageToken;
  } while (pageToken);
  const related = new Set(["ensurePlayerSignupInvitation", "ensurePlayerInvitationOnWrite", "createCoachPlayer", "issueClubPlayerInvitation"]);
  functions = functions.filter(f => /social/i.test(f.entryPoint) || related.has(f.entryPoint));
  const inventory = [];
  for (const fn of functions) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(fn.entryPoint)) throw new Error("Unexpected function entry point.");
    const source = await request(`${api}/${fn.name}:generateDownloadUrl`, { method: "POST", body: "{}" });
    // Signed URL is used only in memory; it is never placed in the receipt.
    const response = await fetch(source.downloadUrl);
    if (!response.ok) throw new Error(`Source download returned HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(path.join(output, `${fn.entryPoint}.zip`), bytes);
    inventory.push({ name: fn.entryPoint, versionId: fn.versionId, updatedAt: fn.updateTime,
      runtime: fn.runtime, archiveBytes: bytes.length, archiveSha256: createHash("sha256").update(bytes).digest("hex") });
  }
  await fs.writeFile(path.join(output, "recovered-source-inventory.json"), JSON.stringify({ project, region, recoveredAt: new Date().toISOString(), functions: inventory }, null, 2) + "\n");
  console.log(`Downloaded ${inventory.length} original source archives into ignored .netlify/feed-recovery/. No functions or application data changed.`);
}

main().catch(() => {
  // SDK errors can embed request URLs. Do not print unsanitized error objects.
  console.error("Source recovery did not complete. Verify the Firebase CLI path, its signed-in account, project permissions, network access, and that .netlify is ignored by Git.");
  process.exitCode = 1;
});
