"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const baseline = require("./baseline.json");
const MODULES = ["team-leaderboard.js", "effective-results.js", "processing-evidence.js", "insights-v2-qualification.js", "insights-v2-projection.js", "athlete-storage-paths.js"];
function patchIndex(source) {
  const anchor = 'const teamLeaderboard = createTeamLeaderboard({ db, HttpsError: functions.https.HttpsError });';
  if (source.split(anchor).length !== 2) throw Error("Reviewed leaderboard initialization changed.");
  return source.replace(anchor, 'const effectiveResults = require("./effective-results").createEffectiveResults({ db, bucket: admin.storage().bucket("kickai-69dd0.firebasestorage.app"), HttpsError: functions.https.HttpsError });\nconst teamLeaderboard = createTeamLeaderboard({ db, HttpsError: functions.https.HttpsError, effectiveResults });');
}
function prepare(source, output) {
  if (fs.existsSync(output)) throw Error("Choose a new private candidate directory.");
  const names = fs.readdirSync(source).sort();
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(baseline.files).sort())) throw Error("Reviewed source inventory changed.");
  const contents = new Map();
  for (const name of names) {
    const bytes = fs.readFileSync(path.join(source, name));
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== baseline.files[name]) throw Error("Reviewed source changed: " + name);
    contents.set(name, bytes);
  }
  contents.set("index.js", Buffer.from(patchIndex(contents.get("index.js").toString("utf8"))));
  for (const name of MODULES) contents.set(name, fs.readFileSync(path.join(__dirname, "../../functions", name)));
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  for (const [name, bytes] of contents) fs.writeFileSync(path.join(output, name), bytes, { mode: 0o600 });
  return { endpoint: "getTeamLeaderboard", previousVersion: baseline.version, files: Object.fromEntries([...contents].map(([name, bytes]) => [name, crypto.createHash("sha256").update(bytes).digest("hex")])) };
}
if (require.main === module) { const [source, output] = process.argv.slice(2); if (!output) throw Error("Usage: node prepare.cjs PRIVATE_ORIGINAL PRIVATE_NEW_CANDIDATE"); console.log(JSON.stringify(prepare(source, output), null, 2)); }
module.exports = { prepare, patchIndex };
