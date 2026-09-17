"use strict";
const fs = require("node:fs"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const { google, canonical, sha, same } = require("./source-only.cjs");
const OWNED = ["getAthleteResultsShare", "getAthleteSharedRepArtifacts", "adminReviseRep", "adminSaveAnalysisReview", "getSocialMedia", "getTeamLeaderboard"];
const PARENT = "projects/kickai-69dd0/locations/us-central1";
const API = "https://cloudfunctions.googleapis.com/v1/";
function protectedDefinition(value) {
  const result = structuredClone(value);
  for (const key of ["versionId", "updateTime", "status", "sourceUploadUrl", "sourceRepository", "sourceToken", "buildId", "buildName"]) delete result[key];
  return result;
}
function sourcePatch(name, sourceUploadUrl) {
  if (!OWNED.includes(name)) throw Error("Endpoint is outside this reviewed source-only rollout.");
  return { updateMask: "sourceUploadUrl", body: { name: `${PARENT}/functions/${name}`, sourceUploadUrl } };
}
function files(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw Error("Source symlinks are not supported.");
    return entry.isDirectory() ? files(path.join(directory, entry.name), prefix + entry.name + "/") : [prefix + entry.name];
  }).sort();
}
async function zip(source, names, output, cliRoot) {
  const archiver = require(require.resolve("archiver", { paths: [cliRoot] })), stream = fs.createWriteStream(output, { mode: 0o600 });
  const archive = archiver("zip", { zlib: { level: 9 } });
  const done = new Promise((resolve, reject) => { stream.on("close", resolve); stream.on("error", reject); archive.on("error", reject); });
  archive.pipe(stream); for (const name of names) archive.append(fs.readFileSync(path.join(source, name)), { name, date: new Date("2000-01-01T00:00:00Z") });
  await archive.finalize(); await done;
}
async function sourceBytes(api, name, versionId) {
  const link = await api.request(API + `${PARENT}/functions/${name}:generateDownloadUrl`, "POST", { versionId });
  const response = await fetch(link.downloadUrl, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error("Source download failed: HTTP " + response.status);
  return Buffer.from(await response.arrayBuffer());
}
async function run(mode, name, runDirectory, sourceDirectory, expectedFile) {
  const patchScope = sourcePatch(name, "placeholder");
  if (!["prepare", "apply", "verify"].includes(mode)) throw Error("Choose prepare, apply or verify.");
  const root = path.resolve(__dirname, "../.."), directory = path.resolve(runDirectory), relative = path.relative(root, directory);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw Error("Use an ignored private run directory in this repository.");
  execFileSync("git", ["check-ignore", "--quiet", "--", path.join(relative, "manifest.json")], { cwd: root, stdio: "ignore" });
  const api = await google(), url = API + patchScope.body.name;
  const iam = () => api.request(url + ":getIamPolicy?options.requestedPolicyVersion=3");
  const save = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2), { mode: 0o600 });
  const read = name => JSON.parse(fs.readFileSync(path.join(directory, name)));
  if (mode === "prepare") {
    if (fs.existsSync(directory)) throw Error("Use a new private run directory.");
    if (!expectedFile || !sourceDirectory) throw Error("Supply exact prepared source and reviewed original function JSON.");
    const expected = JSON.parse(fs.readFileSync(expectedFile)), before = await api.request(url);
    if (before.status !== "ACTIVE") throw Error("The function is not ACTIVE.");
    same(before, expected, "Serving definition differs from the reviewed before snapshot.");
    const policy = await iam(), original = await sourceBytes(api, name, before.versionId);
    const names = files(sourceDirectory);
    if (!names.includes("index.js") || !names.includes("package.json") || names.some(name => name.startsWith("node_modules/") || !/^[A-Za-z0-9_.\/-]+$/.test(name))) throw Error("Candidate source inventory is not a clean prepared bundle.");
    same(await api.request(url), before, "Function changed during capture."); same(await iam(), policy, "IAM changed during capture.");
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); save("before.json", before); save("before-iam.json", policy);
    fs.writeFileSync(path.join(directory, "before.zip"), original, { mode: 0o600 });
    await zip(sourceDirectory, names, path.join(directory, "candidate.zip"), api.cliRoot);
    const manifest = { endpoint: name, previousVersion: before.versionId, originalSourceHash: sha(original), candidateHash: sha(fs.readFileSync(path.join(directory, "candidate.zip"))),
      files: Object.fromEntries(names.map(file => [file, sha(fs.readFileSync(path.join(sourceDirectory, file)))])), updateMask: patchScope.updateMask };
    save("manifest.json", manifest); return { prepared: true, endpoint: name, previousVersion: before.versionId, fileCount: names.length };
  }
  const before = read("before.json"), policy = read("before-iam.json"), manifest = read("manifest.json");
  if (manifest.endpoint !== name || manifest.updateMask !== patchScope.updateMask) throw Error("Manifest scope changed.");
  const candidate = fs.readFileSync(path.join(directory, "candidate.zip")); if (sha(candidate) !== manifest.candidateHash) throw Error("Candidate archive changed.");
  if (mode === "apply") {
    if (fs.existsSync(path.join(directory, "intent.json"))) throw Error("Previous apply may have succeeded. Verify and reconcile instead of retrying blindly.");
    same(await api.request(url), before, "Function changed after preparation."); same(await iam(), policy, "IAM changed after preparation.");
    const upload = await api.request(API + PARENT + "/functions:generateUploadUrl", "POST", {});
    const put = await fetch(upload.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/zip", "x-goog-content-length-range": "0,104857600" }, body: candidate, signal: AbortSignal.timeout(60000) });
    if (!put.ok) throw Error("Source upload failed: HTTP " + put.status);
    same(await api.request(url), before, "Function changed during upload."); same(await iam(), policy, "IAM changed during upload.");
    const patch = sourcePatch(name, upload.uploadUrl); save("intent.json", { candidateHash: manifest.candidateHash, updateMask: patch.updateMask });
    const operation = await api.request(url + "?updateMask=" + patch.updateMask, "PATCH", patch.body); save("operation.json", operation);
    console.log(name + ": source-only deployment accepted.");
    let current = operation;
    for (let attempt = 0; !current.done && attempt < 240; attempt++) { await new Promise(resolve => setTimeout(resolve, 5000)); current = await api.request(API + operation.name); }
    save("operation-final.json", current);
    if (!current.done || current.error) throw Error("Deployment did not finish successfully; inspect the private operation receipt.");
  }
  const after = await api.request(url), afterIam = await iam();
  if (after.status !== "ACTIVE") throw Error("The function is not ACTIVE.");
  same(protectedDefinition(after), protectedDefinition(before), "Non-source function configuration changed."); same(afterIam, policy, "IAM changed.");
  const deployed = await sourceBytes(api, name, after.versionId);
  if (sha(deployed) !== manifest.candidateHash) throw Error("Deployed source archive differs; compare source bytes before retrying.");
  save("after.json", after); save("after-iam.json", afterIam);
  const result = { verified: true, endpoint: name, version: after.versionId, candidateHash: manifest.candidateHash, protectedConfigurationUnchanged: true, iamUnchanged: true };
  save("verified.json", result); return result;
}
if (require.main === module) { const [mode, name, directory, source, expected] = process.argv.slice(2); run(mode, name, directory, source, expected).then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; }); }
module.exports = { protectedDefinition, sourcePatch, OWNED };
