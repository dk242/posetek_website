# Admin workout saving and optional feedback — 2026-09-09

Status: code complete, worktree and primary validation passed. Signed-in acceptance remains pending. No deployment or Git push performed for this change.

Implementation branch: `worktree-workout-save-feedback`, based on `a8477be`; implementation commit `89ac799`.
The initial work used `/private/tmp/posetek-web-workout-fixes` while another session owned primary. Once that session released, this session acquired and verified primary ownership, detached the committed worktree, and validated the branch in primary. The temporary worktree and its generated files have been removed.

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

## Primary validation and cleanup

- The user authorized local main integration and cleanup on 2026-09-09. Primary had advanced to `74e5586` through documentation-only release receipts; no runtime files changed from this branch's base.
- Expanded transaction coverage confirms drill replacement/addition, reordering with stable IDs, and sets/reps edits, in addition to removal, audit serialization, feedback choices and stale-edit protection. No further save blocker was identified in this scoped review. Existing constraints remain: at least one drill, catalog dose and weekly frequency limits, active v3 plan and schedule counter, and unchanged revisions.
- In primary, `npm --prefix app test` passed **599 tests / 31 files**; `npm --prefix app run lint` exited 0 with existing warnings; `npm --prefix app run build` passed TypeScript, Vite and legacy asset copying. No dependency installation or simulator work was needed.
- The unrelated pre-existing receipt `deployments/source-integration-2026-09-09 2.json` was preserved byte-for-byte at `/private/tmp/posetek-preserved-source-integration-2026-09-09-2.json` before removing the duplicate filename from the working tree. SHA256: `6ef9cf7d16c4304c315726812a891009b4d9c3ee29508cad014247b3bc54d514`.
- The shared queue cannot clear a single entry, so a completion entry supersedes this task's earlier primary-validation requirement while retaining unrelated pending checks.

## Remaining acceptance

Browser bootstrap failed with `Importing module "node:process" is not allowed in node_repl`; no live athlete data was changed for testing. Verify admin edit → remove a drill → save with feedback → dialog closes → reopen and confirm persistence. Repeat with blank feedback and the checked no-feedback box; confirm the audit declaration/flag. Uncheck with blank text and confirm save is disabled. Confirm a stale-edit error stays visible and preserves the draft.

This fix is not live until a separately authorized website push/deployment. No rules or callable deployment is required for it.
