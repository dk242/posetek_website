#!/usr/bin/env node
"use strict";

// Read-only account lookup for reconciling Firebase Authentication users with
// Firestore player documents. This script never creates, updates, or deletes.
const path = require("node:path");
const { createRequire } = require("node:module");

const DEFAULT_PROJECT_ID = "kickai-69dd0";
const PLAYER_FIELDS = [
  "name",
  "firstName",
  "lastName",
  "email",
  "signupEmail",
  "authenticationUID",
  "userUID",
  "registered",
  "organizationId",
  "teamId",
  "teamIds",
];

function usage() {
  return `Usage:
  node scripts/find-player-account.cjs --email player@example.com
  node scripts/find-player-account.cjs --uid FIREBASE_AUTH_UID
  node scripts/find-player-account.cjs --id FIRESTORE_PLAYER_DOCUMENT_ID
  node scripts/find-player-account.cjs --name "First Last"

Options:
  --project PROJECT_ID   Firebase project (default: ${DEFAULT_PROJECT_ID})
  --help                 Show this help

The lookup is strictly read-only. It checks Firebase Authentication plus the
players collection's email, signupEmail, authenticationUID, userUID, name,
firstName/lastName, and document ID aliases as appropriate.`;
}

function parseArgs(argv) {
  const result = { projectId: DEFAULT_PROJECT_ID };
  const valueOptions = new Map([
    ["--email", "email"],
    ["--uid", "uid"],
    ["--id", "id"],
    ["--name", "name"],
    ["--project", "projectId"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      result.help = true;
      continue;
    }
    const key = valueOptions.get(argument);
    if (!key) throw new Error(`Unknown option: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    result[key] = value.trim();
    index += 1;
  }
  if (result.help) return result;
  const selectors = ["email", "uid", "id", "name"].filter(key => result[key]);
  if (selectors.length !== 1) throw new Error("Provide exactly one of --email, --uid, --id, or --name.");
  if (!result.projectId) throw new Error("Project ID cannot be empty.");
  return result;
}

function queryPlan(options) {
  if (options.email) {
    const values = [...new Set([options.email, options.email.toLowerCase()])];
    return values.flatMap(value => [
      { kind: "field", field: "email", value, label: `email == ${JSON.stringify(value)}` },
      { kind: "field", field: "signupEmail", value, label: `signupEmail == ${JSON.stringify(value)}` },
    ]);
  }
  if (options.uid) return [
    { kind: "document", value: options.uid, label: `document ID == ${JSON.stringify(options.uid)}` },
    { kind: "field", field: "authenticationUID", value: options.uid, label: `authenticationUID == ${JSON.stringify(options.uid)}` },
    { kind: "field", field: "userUID", value: options.uid, label: `userUID == ${JSON.stringify(options.uid)}` },
  ];
  if (options.id) return [
    { kind: "document", value: options.id, label: `document ID == ${JSON.stringify(options.id)}` },
  ];
  const plan = [
    { kind: "field", field: "name", value: options.name, label: `name == ${JSON.stringify(options.name)}` },
  ];
  const parts = options.name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) plan.push({
    kind: "fields",
    fields: [["firstName", parts[0]], ["lastName", parts.slice(1).join(" ")]],
    label: `firstName == ${JSON.stringify(parts[0])} AND lastName == ${JSON.stringify(parts.slice(1).join(" "))}`,
  });
  return plan;
}

function selectPlayerFields(data) {
  return Object.fromEntries(PLAYER_FIELDS.filter(field => data[field] !== undefined).map(field => [field, data[field]]));
}

async function runPlayerQueries(db, plan) {
  const matches = new Map();
  const record = (snapshot, label) => {
    if (!snapshot.exists) return;
    const existing = matches.get(snapshot.id) || {
      playerDocumentId: snapshot.id,
      matchedBy: [],
      ...selectPlayerFields(snapshot.data()),
    };
    if (!existing.matchedBy.includes(label)) existing.matchedBy.push(label);
    matches.set(snapshot.id, existing);
  };

  for (const item of plan) {
    if (item.kind === "document") {
      record(await db.collection("players").doc(item.value).get(), item.label);
      continue;
    }
    let query = db.collection("players");
    if (item.kind === "field") query = query.where(item.field, "==", item.value);
    else for (const [field, value] of item.fields) query = query.where(field, "==", value);
    const snapshot = await query.limit(20).get();
    for (const document of snapshot.docs) record(document, item.label);
  }
  return [...matches.values()];
}

function summarizeAuthUser(user) {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    disabled: user.disabled,
    emailVerified: user.emailVerified,
    createdAt: user.metadata?.creationTime,
    lastSignInAt: user.metadata?.lastSignInTime,
  };
}

async function findAuthUser(auth, options) {
  try {
    if (options.email) return summarizeAuthUser(await auth.getUserByEmail(options.email));
    if (options.uid) return summarizeAuthUser(await auth.getUser(options.uid));
    return null;
  } catch (error) {
    if (error?.code === "auth/user-not-found") return null;
    throw error;
  }
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const requireFromFunctions = createRequire(path.resolve(__dirname, "../functions/package.json"));
  const admin = requireFromFunctions("firebase-admin");
  const app = admin.apps.length ? admin.app() : admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: options.projectId,
  });

  try {
    const [authentication, players] = await Promise.all([
      findAuthUser(app.auth(), options),
      runPlayerQueries(app.firestore(), queryPlan(options)),
    ]);
    process.stdout.write(`${JSON.stringify({
      projectId: options.projectId,
      readOnly: true,
      authentication,
      players,
      matchCount: players.length,
    }, null, 2)}\n`);
  } finally {
    await app.delete();
  }
}

module.exports = { parseArgs, queryPlan, selectPlayerFields, summarizeAuthUser };

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`Account lookup failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

