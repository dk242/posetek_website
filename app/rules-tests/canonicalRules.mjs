// The one source of the Firestore and Storage rules every suite in this
// directory tests: PoseTek-mobile-app/firebase/{firestore,storage}.rules.
// This repo holds no rules of its own and never publishes them (decision D5 in
// the mobile repo's GATEWAY_CONSOLIDATION_AND_RELEASE_PLAN; publishing is
// `python firebase/operations.py publish` in the mobile repo, nothing else).
//
// RULES_PATH and STORAGE_RULES_PATH point at the canonical files. Both default
// to a sibling checkout (../PoseTek-mobile-app/firebase/) of this repo. Run the
// suites through scripts/run-rules-tests.mjs, which sets both and starts the
// emulators; see app/rules-tests/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const canonicalDir = path.resolve(websiteRoot, '../PoseTek-mobile-app/firebase');

export const firestoreRulesPath = path.resolve(process.env.RULES_PATH || path.join(canonicalDir, 'firestore.rules'));
export const storageRulesPath = path.resolve(process.env.STORAGE_RULES_PATH || path.join(canonicalDir, 'storage.rules'));

const read = (file, variable) => {
  if (!fs.existsSync(file)) {
    throw new Error(`${variable}: ${file} does not exist. Point ${variable} at PoseTek-mobile-app/firebase/ (see app/rules-tests/README.md).`);
  }
  return fs.readFileSync(file, 'utf8');
};

export const firestoreRules = () => read(firestoreRulesPath, 'RULES_PATH');
export const storageRules = () => read(storageRulesPath, 'STORAGE_RULES_PATH');

// `firebase emulators:exec` exports each running emulator's address; the
// runner picks the ports, so no suite hardcodes one.
const hostPort = (variable) => {
  const value = process.env[variable];
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(value || '')) {
    throw new Error(`${variable} is not set to a local emulator; run this suite through scripts/run-rules-tests.mjs.`);
  }
  const [host, port] = value.split(':');
  return { host, port: Number(port) };
};

export const firestoreEmulator = () => ({ ...hostPort('FIRESTORE_EMULATOR_HOST'), rules: firestoreRules() });
export const storageEmulator = () => ({ ...hostPort('FIREBASE_STORAGE_EMULATOR_HOST'), rules: storageRules() });
