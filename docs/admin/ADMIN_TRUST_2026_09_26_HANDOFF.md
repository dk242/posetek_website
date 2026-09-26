# Admin dashboard trust follow-up — September 26, 2026

This branch is website source only. It was not deployed and did not modify production data.

## Implemented

- Embedded Insights remounts for every query change. The URL includes scope, date range, timezone, testing window and player filters, so a cursor from page 2 cannot be sent with a changed report. The existing request guard cancels late responses from the previous component.
- Athlete recorded-result cards show loading, unavailable with a focused retry, or actual counts. A failed coach-note or plan-adjustment read is also labeled unavailable with retry.
- The two sparklines that graphed recording volume beside player and fully-tested totals were removed.
- Admin header labels Technique review, Drill library and AI incidents as global tools; their retained URL scope no longer claims to govern those screens.
- The not-tested attention count links to the same Insights scope/date with the matching testing-status filter. Rep-review and unmatched-failure counts open their matching record-level issue queues.
- The incident create trigger server-stamps `isTest` using `config/llm.testUids`, and a client-only failure keyed by its UUID folds a later user report into the same canonical document, even if the report arrived first. Ownership mismatch is rejected. Folded halves are excluded from incident counts even when their canonical document is outside the loaded window.
- The 25-record issue queues derive from the same authorized, filtered projection as the Insights counts and reconcile their dated total. Staff can switch to date-missing and future-date queues. Fresh projections include source IDs; older projections without IDs are labeled and link to the athlete's results.
- AI incidents now use an administrator-authorized callable that scans retained incident pages on the server, applies the full filter and reference/name search, and returns 50 rows plus complete filtered counts and breakdowns. Cursor order is creation time and ID; cursors bind the filter and grouping. The UI submits search explicitly, so typing does not trigger repeated full scans.
- The incident drawer now has initial focus, contained Tab/Shift+Tab, Escape, background inertness, a labeled heading, and focus restoration. Insights tabs use roving tab focus and arrow/Home/End keys. A DOM interaction test covers these behaviors.

## Remaining before production release

- Unmatched failure rows show their failure-case ID, but the athlete results view has no failure-case detail route yet.
- `functions/ai-incidents-repair-plan.js` computes read-only, idempotent proposed patches for legacy client-only report pairs and `isTest` labels. It rejects UID mismatches and ambiguous existing reports. There is no Firestore write path, and no historical production data was changed. A reviewed migration and live snapshot audit remain necessary before applying any plan.
- Incident paging currently scans all retained incident documents server-side for accurate filters and counts, with a hard 50,000-document bound. A material increase in traffic would need an indexed search and aggregate projection. This branch adds no Firestore index or mobile rules change.
- The new website UI depends on `listAiIncidents`; deploy that callable before publishing the UI. It has not been deployed from this branch.
- A signed-in browser and screen-reader check remain for release acceptance.
- Verify the embedded Insights page-2 to 4-week transition in a signed-in browser or synthetic interactive harness. The key reset was validated structurally and by existing unit tests, but no interactive browser run was performed here.

## Validation

- `node --test functions/ai-incidents.test.js`
- `node --test functions/ai-incidents-repair-plan.test.js functions/insights-v2-issues.test.js`
- `node --test functions/ai-incidents-list.test.js` (620 synthetic incidents, folded halves, test labels, old references, cursor changes)
- `node app/node_modules/vitest/vitest.mjs run app/src/pages/admin app/src/pages/insights`
- `app/node_modules/.bin/tsc --noEmit -p app/tsconfig.app.json`

`happy-dom` was added as a development dependency for DOM interaction tests.
