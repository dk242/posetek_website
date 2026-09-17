"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const baseline = require("./baseline.json");
function files(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw Error("Source symlinks are not supported.");
    return entry.isDirectory() ? files(path.join(directory, entry.name), prefix + entry.name + "/") : [prefix + entry.name];
  }).sort();
}
function prepare(name, sourceDirectory, outputDirectory) {
  const expected = baseline.endpoints[name];
  if (!expected) throw Error("Only the three reviewed path-reader endpoints are supported.");
  if (fs.existsSync(outputDirectory)) throw Error("Choose a new private output directory.");
  if (JSON.stringify(files(sourceDirectory)) !== JSON.stringify(Object.keys(expected.files).sort())) throw Error("Source inventory changed.");
  const contents = new Map();
  for (const [file, hash] of Object.entries(expected.files)) {
    const bytes = fs.readFileSync(path.join(sourceDirectory, file));
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== hash) throw Error("Source drift: " + file);
    contents.set(file, bytes);
  }
  contents.set("athlete-storage-paths.js", fs.readFileSync(path.join(__dirname, "../../functions/athlete-storage-paths.js")));
  fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  for (const [file, bytes] of contents) {
    fs.mkdirSync(path.dirname(path.join(outputDirectory, file)), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(outputDirectory, file), bytes, { mode: 0o600 });
  }
  return { endpoint: name, previousVersion: expected.version, changedFiles: ["athlete-storage-paths.js"],
    files: Object.fromEntries([...contents].map(([name, bytes]) => [name, crypto.createHash("sha256").update(bytes).digest("hex")])) };
}
if (require.main === module) { const [name, source, output] = process.argv.slice(2); if (!output) throw Error("Usage: node prepare.cjs ENDPOINT PRIVATE_SOURCE NEW_IGNORED_OUTPUT"); console.log(JSON.stringify(prepare(name, source, output), null, 2)); }
module.exports = { prepare };
