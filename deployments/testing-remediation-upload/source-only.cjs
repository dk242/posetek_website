"use strict";
// Source-only operator tool: never changes environment, IAM, trigger or retry policy.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const NAME = "projects/kickai-69dd0/locations/us-west1/functions/onVideoUpload";
const API = "https://cloudfunctions.googleapis.com/v2/";
const FILES = ["index.js", "repair-guard.js", "package.json", "package-lock.json"];
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const canonical = value => JSON.stringify(value && typeof value === "object" ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])) : value);
function protectedDefinition(value) {
  const result = structuredClone(value);
  for (const key of ["updateTime", "state", "stateMessages", "url", "satisfiesPzi", "satisfiesPzs"]) delete result[key];
  for (const key of ["build", "source", "sourceProvenance"]) delete result.buildConfig[key];
  for (const key of ["revision", "uri"]) delete result.serviceConfig[key];
  return result;
}
function sourcePatch(storageSource) {
  return { updateMask: "buildConfig.source.storageSource", body: { name: NAME, buildConfig: { source: { storageSource } } } };
}
function same(a, b, message) { if (canonical(a) !== canonical(b)) throw Error(message); }
async function google() {
  const cliRoot = path.join(process.env.APPDATA || "", "npm/node_modules/firebase-tools");
  const auth = require(path.join(cliRoot, "lib/auth.js")), account = auth.getProjectDefaultAccount(process.cwd());
  if (!account?.tokens?.refresh_token) throw Error("Existing Firebase CLI login required.");
  let token = account.tokens.access_token, expiry = account.tokens.expires_at;
  async function access() {
    if (!token || expiry < Date.now() + 60000) { const fresh = await auth.getAccessToken(account.tokens.refresh_token, ["https://www.googleapis.com/auth/cloud-platform"]); token = fresh.access_token; expiry = fresh.expires_at; }
    return token;
  }
  async function response(url, options = {}) {
    const result = await fetch(url, { ...options, headers: { Authorization: "Bearer " + await access(), "Content-Type": "application/json", ...options.headers }, signal: AbortSignal.timeout(60000) });
    if (!result.ok) throw Error("Google API request failed: HTTP " + result.status);
    return result;
  }
  return { cliRoot, request: async (url, method = "GET", body) => (await response(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) })).json(),
    bytes: async url => Buffer.from(await (await response(url)).arrayBuffer()) };
}
function sourceUrl(storageSource) {
  if (!storageSource?.bucket || !storageSource?.object) throw Error("Missing immutable Storage source.");
  return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(storageSource.bucket)}/o/${encodeURIComponent(storageSource.object)}?alt=media&generation=${storageSource.generation || 0}`;
}
async function iam(api, fn) { return api.request("https://run.googleapis.com/v2/" + fn.serviceConfig.service + ":getIamPolicy?options.requestedPolicyVersion=3"); }
async function zipSource(source, filename, cliRoot) {
  const archiver = require(require.resolve("archiver", { paths: [cliRoot] }));
  const stream = fs.createWriteStream(filename, { mode: 0o600 }), archive = archiver("zip", { zlib: { level: 9 } });
  const done = new Promise((resolve, reject) => { stream.on("close", resolve); stream.on("error", reject); archive.on("error", reject); });
  archive.pipe(stream);
  for (const name of FILES) archive.append(fs.readFileSync(path.join(source, name)), { name, date: new Date("2000-01-01T00:00:00Z") });
  await archive.finalize(); await done;
}
async function run(mode, runDirectory, expectedFile) {
  if (!["prepare", "apply", "verify"].includes(mode)) throw Error("Choose prepare, apply or verify.");
  const root = path.resolve(__dirname, "../.."), directory = path.resolve(runDirectory);
  const relative = path.relative(root, directory);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw Error("Run directory must be private and within this repository.");
  execFileSync("git", ["check-ignore", "--quiet", "--", path.join(relative, "manifest.json")], { cwd: root, stdio: "ignore" });
  const api = await google();
  const save = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2), { mode: 0o600 });
  const read = name => JSON.parse(fs.readFileSync(path.join(directory, name)));
  if (mode === "prepare") {
    if (fs.existsSync(directory)) throw Error("Choose a new private run directory.");
    if (!expectedFile) throw Error("Preparation requires the reviewed original function JSON path.");
    const expected = JSON.parse(fs.readFileSync(expectedFile));
    const before = await api.request(API + NAME);
    if (before.state !== "ACTIVE") throw Error("The function is not ACTIVE.");
    same(before.buildConfig.source, expected.buildConfig.source, "Serving source changed from reviewed original.");
    const policy = await iam(api, before), bytes = await api.bytes(sourceUrl(before.buildConfig.source.storageSource));
    same(await api.request(API + NAME), before, "Function changed during capture.");
    same(await iam(api, before), policy, "IAM changed during capture.");
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); save("before.json", before); save("before-iam.json", policy);
    fs.writeFileSync(path.join(directory, "before.zip"), bytes, { mode: 0o600 });
    const source = path.join(root, "functions/legacy-upload-processor");
    await zipSource(source, path.join(directory, "candidate.zip"), api.cliRoot);
    const manifest = { functionName: NAME, originalSourceHash: sha(bytes), candidateHash: sha(fs.readFileSync(path.join(directory, "candidate.zip"))),
      files: Object.fromEntries(FILES.map(name => [name, sha(fs.readFileSync(path.join(source, name)))])), updateMask: sourcePatch({}).updateMask };
    save("manifest.json", manifest);
    return { prepared: true, functionName: NAME, revision: before.serviceConfig.revision, files: manifest.files };
  }
  const before = read("before.json"), policy = read("before-iam.json"), manifest = read("manifest.json");
  if (manifest.functionName !== NAME || manifest.updateMask !== sourcePatch({}).updateMask) throw Error("Manifest scope changed.");
  const candidate = fs.readFileSync(path.join(directory, "candidate.zip"));
  if (sha(candidate) !== manifest.candidateHash) throw Error("Candidate archive changed.");
  if (mode === "apply") {
    if (fs.existsSync(path.join(directory, "intent.json"))) throw Error("An earlier apply may have been accepted. Use verify and reconcile before retrying.");
    same(await api.request(API + NAME), before, "Function changed after preparation.");
    same(await iam(api, before), policy, "IAM changed after preparation.");
    const upload = await api.request(API + NAME.split("/functions/")[0] + "/functions:generateUploadUrl", "POST", { environment: "GEN_2" });
    const put = await fetch(upload.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/zip" }, body: candidate, signal: AbortSignal.timeout(60000) });
    if (!put.ok) throw Error("Source upload failed: HTTP " + put.status);
    same(await api.request(API + NAME), before, "Function changed while uploading source.");
    same(await iam(api, before), policy, "IAM changed while uploading source.");
    const patch = sourcePatch(upload.storageSource); save("intent.json", { storageSource: upload.storageSource, candidateHash: manifest.candidateHash, updateMask: patch.updateMask });
    const operation = await api.request(API + NAME + "?updateMask=" + patch.updateMask, "PATCH", patch.body); save("operation.json", operation);
    console.log("Source-only deployment accepted; waiting for verification.");
    let current = operation;
    for (let attempt = 0; !current.done && attempt < 240; attempt++) { await new Promise(resolve => setTimeout(resolve, 5000)); current = await api.request(API + operation.name); }
    if (!current.done || current.error) { save("operation-final.json", current); throw Error("Deployment did not complete successfully; inspect the private operation receipt."); }
    save("operation-final.json", current);
  }
  const after = await api.request(API + NAME), afterIam = await iam(api, after);
  if (after.state !== "ACTIVE") throw Error("The function is not ACTIVE yet.");
  same(protectedDefinition(after), protectedDefinition(before), "Non-source function configuration changed.");
  same(afterIam, policy, "IAM changed.");
  const deployedBytes = await api.bytes(sourceUrl(after.buildConfig.source.storageSource));
  if (sha(deployedBytes) !== manifest.candidateHash) throw Error("Deployed source archive differs from the prepared bytes; compare the captured sources before any retry.");
  save("after.json", after); save("after-iam.json", afterIam);
  const verified = { verified: true, revision: after.serviceConfig.revision, source: after.buildConfig.source.storageSource, candidateHash: manifest.candidateHash, protectedConfigurationUnchanged: true, iamUnchanged: true };
  save("verified.json", verified); return verified;
}
if (require.main === module) { const [mode, directory, expected] = process.argv.slice(2); run(mode, directory, expected).then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; }); }
module.exports = { protectedDefinition, sourcePatch, sourceUrl, FILES, google, canonical, sha, same };
