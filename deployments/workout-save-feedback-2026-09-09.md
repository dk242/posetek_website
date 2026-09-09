# Admin workout saving and optional feedback — 2026-09-09

Status: code complete, worktree validation passed; primary integration and signed-in acceptance pending. No deployment or Git push performed.

Branch: `worktree-workout-save-feedback`, based on `a8477be`.
Worktree: `/private/tmp/posetek-web-workout-fixes`.
The primary website checkout belongs to another live session; its working tree and claim were preserved.

## Changes

- Workout saves previously placed normalized UI catalog rows into `planAdjustments.catalogRows`. The real Firebase SDK rejected their optional `undefined` values before the transaction could commit. A drill-removal regression reproduced `Unsupported field value: undefined (found in field catalogRows.DRB-001.legacyDomain)` before the fix.
- The adjustment now captures raw catalog snapshots read and validated inside the transaction, preserving Firestore timestamps and avoiding UI-only optional fields. Plan, adjustment and schedule counter remain one atomic transaction; revisions and sibling workout preservation are unchanged.
- The admin Save the workout dialog offers **I have no feedback to provide here**. Checking it disables the feedback field and allows saving without typed text. Unchecking restores the text draft and the 3–2000 character requirement.
- Explicit opt-out persists that declaration as `rationale` and `feedbackProvided: false`; written feedback persists trimmed text and `feedbackProvided: true`. This additive field and the nonempty declaration fit the existing rules; no rules or function deployment is needed. Downstream evaluation can distinguish opted-out records using the flag. Older records have no flag.
- Scope is the admin workout-edit dialog described in the request; athlete completion flows are unchanged.

## Worktree validation

Existing primary `app/node_modules` was reused through a read-only-use symlink. No dependencies were installed; test caching and TypeScript incremental output were disabled to avoid writing shared dependency caches.

Commands run from the worktree's `app/`:

```sh
npm test -- --configLoader runner --no-cache
node node_modules/typescript/bin/tsc --project tsconfig.app.json --noEmit --incremental false
node node_modules/typescript/bin/tsc --project tsconfig.node.json --noEmit --incremental false
npm run lint
node node_modules/vite/bin/vite.js build --configLoader runner
node scripts/copy-legacy.mjs
git diff --check
```

Results: 596 tests / 31 files passed (17 new tests); both TypeScript checks passed; lint exited 0 with existing warnings; Vite build and legacy asset copy passed. Free disk space remained approximately 9.8 GiB. The transaction tests use the real Firebase SDK's synchronous write serialization with fixture reads and no network commits; they do not claim production rules or signed-in UI acceptance.

## Handoff

1. Verify/acquire primary ownership through `agent-guard.py`. Preserve this branch and safely detach/remove its worktree before checking the branch out in primary.
2. On the integrated branch run `npm --prefix app test`, `npm --prefix app run lint`, and `npm --prefix app run build`; resolve any conflicts with newer primary work. Merge with `git merge --no-ff worktree-workout-save-feedback` under the ordinary feature-branch workflow once applicable gates pass. Do not push without authorization.
3. Signed-in acceptance remains pending. Browser bootstrap failed with `Importing module "node:process" is not allowed in node_repl`; no live athlete data was changed for testing. Verify admin edit → remove a drill → save with feedback → dialog closes → reopen and confirm persistence. Repeat with blank feedback and the checked no-feedback box; confirm the audit declaration/flag. Uncheck with blank text and confirm save is disabled. Confirm a stale-edit error stays visible and preserves the draft.
4. Deploy only under the existing release authorization and coordination rules. This change is not live until the website is deployed.
