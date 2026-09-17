"use strict";
// Build only from the reviewed live dispatch source. The unsigned legacy
// protocol and its organization guards remain byte-identical.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const baseline = require("./baseline.json");
const MODULES = ["effective-results.js", "processing-evidence.js", "insights-v2-qualification.js", "insights-v2-projection.js", "athlete-storage-paths.js"];
function once(source, before, after) {
  if (source.split(before).length !== 2) throw Error("The reviewed sharing source anchor changed.");
  return source.replace(before, after);
}
function patchClub(source) {
  source = source.replace(/\r\n/g, "\n");
  source = once(source, '  const { athleteShareError } = athleteShares;', '  const { athleteShareError } = athleteShares;\n  const effectiveResults = require("./effective-results").createEffectiveResults({ db, bucket: admin.storage().bucket("kickai-69dd0.firebasestorage.app"), HttpsError: functions.https.HttpsError });');
  const begin = source.indexOf('    const repsSnapshot = await playerRef.collection("reps").get();');
  const end = source.indexOf('\n  }\n  const player = playerDoc.data() || {};', begin);
  if (begin < 0 || end < begin) throw Error("The reviewed club results body changed.");
  source = source.slice(0, begin) + '    reps = (await effectiveResults.listForPlayer(share.playerDocId, drill)).reps;' + source.slice(end);
  source = once(source, '  const player = playerDoc.data() || {};', '  await verifiedAthleteShare(data?.token, drill);\n  const player = playerDoc.data() || {};');
  source = once(source, '  const { share } = await verifiedAthleteShare(data?.token, drill);', '  const { share } = await verifiedAthleteShare(data?.token, drill);\n  if (drill !== "freeRecord") {\n    const result = await effectiveResults.mediaForPlayer(share.playerDocId, drill, repId);\n    await verifiedAthleteShare(data?.token, drill);\n    return result;\n  }');
  return source;
}
function prepare(sourceDirectory, outputDirectory) {
  const source = path.resolve(sourceDirectory), output = path.resolve(outputDirectory);
  if (fs.existsSync(output)) throw Error("Use a new private output directory.");
  const actualNames = fs.readdirSync(source).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(Object.keys(baseline.files).sort())) throw Error("The live source inventory changed.");
  const originals = new Map();
  for (const [name, hash] of Object.entries(baseline.files)) {
    const bytes = fs.readFileSync(path.join(source, name));
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== hash) throw Error("The live source hash changed: " + name);
    originals.set(name, bytes);
  }
  const club = patchClub(originals.get("club-sharing-handlers.js").toString("utf8"));
  const contents = new Map(originals); contents.set("club-sharing-handlers.js", Buffer.from(club));
  for (const name of MODULES) contents.set(name, fs.readFileSync(path.join(__dirname, "../../functions", name)));
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  for (const [name, bytes] of contents) fs.writeFileSync(path.join(output, name), bytes, { mode: 0o600 });
  return { files: Object.fromEntries([...contents].map(([name, bytes]) => [name, crypto.createHash("sha256").update(bytes).digest("hex")])),
    deployOnly: ["getAthleteResultsShare", "getAthleteSharedRepArtifacts"], preservedLegacyIndex: true };
}
if (require.main === module) {
  const [source, output] = process.argv.slice(2);
  if (!source || !output) throw Error("Usage: node prepare.cjs PRIVATE_EXACT_LIVE_SOURCE NEW_IGNORED_OUTPUT");
  console.log(JSON.stringify(prepare(source, output), null, 2));
}
module.exports = { patchClub, prepare, MODULES };
