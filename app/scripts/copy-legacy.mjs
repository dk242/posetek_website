// Copies not-yet-ported legacy pages and their assets into the build output so
// every existing URL keeps working while the React migration is in progress.
//
// Ported pages are EXCLUDED so their URLs fall through to the SPA fallback and
// are served by React Router (which has a route alias for each legacy path).
import { cpSync, copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dist = join(repoRoot, "dist");

// Pages now served by the React app (see app/src/App.tsx). Keep in sync.
const PORTED = new Set([
  "index.html",
  "kickai.html",
  "coachesview.html",
  "profile.html",
  "broadJumpPage.html",
  "changeOfDirectionPage.html",
  "dribblingPage.html",
  "privacy.html",
  "404.html",
]);

// Root-level files never meant to be served.
const SKIP = new Set([
  "firebase.json",
  "firestore.indexes.json",
  "netlify.toml",
  "cors.json",
  "Music - Shortcut.lnk",
]);

mkdirSync(dist, { recursive: true });

let copied = 0;
for (const name of readdirSync(repoRoot)) {
  if (PORTED.has(name) || SKIP.has(name)) continue;
  const path = join(repoRoot, name);
  if (!statSync(path).isFile()) continue;
  if (!/\.(html|js|css|json|txt|xml|ico|svg|png|webmanifest)$/i.test(name)) continue;
  copyFileSync(path, join(dist, name));
  copied += 1;
}

cpSync(join(repoRoot, "images"), join(dist, "images"), { recursive: true });

console.log(`[copy-legacy] copied ${copied} legacy files + images/ into dist/`);
