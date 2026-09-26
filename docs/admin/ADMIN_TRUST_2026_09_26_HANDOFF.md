# Admin dashboard trust follow-up — September 26, 2026

This branch is website source only. It was not deployed and did not modify production data.

## Implemented

- Embedded Insights remounts for every query change. The URL includes scope, date range, timezone, testing window and player filters, so a cursor from page 2 cannot be sent with a changed report. The existing request guard cancels late responses from the previous component.
- Athlete recorded-result cards show loading, unavailable with a focused retry, or actual counts. A failed coach-note or plan-adjustment read is also labeled unavailable with retry.
- The two sparklines that graphed recording volume beside player and fully-tested totals were removed.
- Admin header labels Technique review, Drill library and AI incidents as global tools; their retained URL scope no longer claims to govern those screens.
- The not-tested attention count links to the same Insights scope/date with the matching testing-status filter. Rep-review and unmatched-failure counts link to their testing audit sections, with labels that describe the destination. Those two links still lack a record-level queue.
- The incident create trigger server-stamps `isTest` using `config/llm.testUids`, and a client-only failure keyed by its UUID folds a later user report into the same canonical document, even if the report arrived first. Ownership mismatch is rejected. Folded halves are excluded from incident counts even when their canonical document is outside the loaded window.

## Remaining before production release

- Add server-side issue-list endpoints and a filtered UI for `needsReview` and unmatched failure reports. The current testing audits provide aggregate diagnostics, not affected record lists.
- Add a safe, idempotent repair for pre-existing client-only pairs and missing `isTest` values. The create trigger only handles new documents; no historical write was performed here.
- Add server-paged incident search and counts. The admin view still loads only the newest 500 documents. A canonical document older than that window is absent from the visible list; its folded half is now correctly excluded as a separate incident.
- Add a real keyboard dialog primitive and tab interaction tests. Current incident drawer semantics remain incomplete.
- Verify the embedded Insights page-2 to 4-week transition in a signed-in browser or synthetic interactive harness. The key reset was validated structurally and by existing unit tests, but no interactive browser run was performed here.

## Validation

- `node --test functions/ai-incidents.test.js`
- `node app/node_modules/vitest/vitest.mjs run app/src/pages/admin app/src/pages/insights`
- `app/node_modules/.bin/tsc --noEmit -p app/tsconfig.json`

Dependencies were installed locally from `app/package-lock.json` with `npm --prefix app ci --ignore-scripts`; generated dependencies are ignored by Git.
