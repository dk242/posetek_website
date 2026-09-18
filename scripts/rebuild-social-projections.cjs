#!/usr/bin/env node
"use strict";
// Dry-run by default. Only server-owned activity summaries are written with --apply.
// Checkpoints contain player identifiers and must remain outside version control.
const fs = require("node:fs/promises");
const path = require("node:path");
const { createRequire } = require("node:module");
const { createSocial } = require("../functions/social");

async function migratePage({ db, social, cursor = null, limit = 20, apply = false, onCheckpoint = async () => {} }) {
  let query = db.collection("players").orderBy("__name__");
  if (cursor) query = query.startAfter(cursor);
  const page = await query.limit(limit).get(), results = [];
  for (const player of page.docs) {
    try {
      const result = await social.rebuild(player.id, !apply, { includeCommunity: true });
      results.push({ playerId: player.id, ...result });
      cursor = player.id;
      await onCheckpoint({ cursor, results, complete: false });
    } catch (error) {
      await onCheckpoint({ cursor, results, complete: false, failedPlayerId: player.id, error: error.message });
      throw error;
    }
  }
  const complete = page.size < limit;
  await onCheckpoint({ cursor, results, complete });
  return { cursor, results, complete };
}
async function main(args = process.argv.slice(2)) {
  const value = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
  const project = value("--project");
  if (!project || !/^[a-z][a-z0-9-]{4,62}$/.test(project)) throw Error("Supply --project explicitly.");
  const apply = args.includes("--apply"), limit = Number(value("--limit") || 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Error("--limit must be 1–100 players per page.");
  const mode = apply ? "apply" : "dry-run";
  const file = path.resolve(value("--checkpoint") || path.join(__dirname, "../.netlify/social-projection-" + mode + ".json"));
  let saved = {};
  try { saved = JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (saved.project && (saved.project !== project || saved.mode !== mode)) throw Error("Checkpoint project/mode does not match this run.");
  const requireFunctions = createRequire(path.join(__dirname, "../functions/package.json"));
  const admin = requireFunctions("firebase-admin");
  const functions = requireFunctions("firebase-functions");
  admin.initializeApp({ projectId: project });
  const db = admin.firestore();
  const social = createSocial({ db, bucket: admin.storage().bucket(value("--bucket") || `${project}.firebasestorage.app`), HttpsError: functions.https.HttpsError });
  const result = await migratePage({ db, social, cursor: value("--start-after") || saved.cursor || null, limit, apply,
    onCheckpoint: async progress => {
      const journal = { schemaVersion: 1, project, mode, updatedAt: new Date().toISOString(), ...progress };
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file + ".tmp", JSON.stringify(journal, null, 2) + "\n");
      await fs.rename(file + ".tmp", file);
    } });
  console.log(JSON.stringify({ mode, project, players: result.results.length, complete: result.complete, checkpoint: file }));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { migratePage };
