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

- The second pass adds a 25-record server-paged issue queue for `needsReview` reps and unmatched failure reports. It derives rows from the same authorized, filtered projection as the Insights counts and checks their dated total against the report. Staff can switch to separate date-missing and future-date queues. Freshly rebuilt projections include source IDs; older projections without IDs are labeled and link to the athlete's result list. Unmatched failure rows show their failure-case ID but the athlete results view has no failure-case detail route yet.
- `functions/ai-incidents-repair-plan.js` computes read-only, idempotent proposed patches for legacy client-only report pairs and `isTest` labels. It rejects UID mismatches and ambiguous existing reports. There is no Firestore write path, and no historical production data was changed. A reviewed migration and live snapshot audit remain necessary before applying any plan.
- Add server-paged incident search and counts. The admin view still loads only the newest 500 documents. A canonical document older than that window is absent from the visible list; its folded half is now correctly excluded as a separate incident.
- The incident drawer now has initial focus, contained Tab/Shift+Tab, Escape, background inertness, a labeled heading, and focus restoration. Insights tabs use roving tab focus and arrow/Home/End keys. A DOM interaction test covers these behaviors. A signed-in browser and screen-reader check remain for release acceptance.
- Verify the embedded Insights page-2 to 4-week transition in a signed-in browser or synthetic interactive harness. The key reset was validated structurally and by existing unit tests, but no interactive browser run was performed here.

## Validation

- `node --test functions/ai-incidents.test.js`
- `node --test functions/ai-incidents-repair-plan.test.js functions/insights-v2-issues.test.js`
- `node app/node_modules/vitest/vitest.mjs run app/src/pages/admin app/src/pages/insights`
- `app/node_modules/.bin/tsc --noEmit -p app/tsconfig.json`

`happy-dom` was added as a development dependency for DOM interaction tests.
