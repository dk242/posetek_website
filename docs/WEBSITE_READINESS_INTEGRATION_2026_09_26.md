# Website readiness candidate — September 26, 2026

This branch combines the isolated website admin, coach, account-entry, booking-enquiry and release-guard changes. It is a candidate, not a production receipt. No production deployment, Firestore data migration or mobile change was made.

## Branches and release order

1. Review and release `codex/gateway-coach-validation-20260926` from the canonical backend repository using its documented gateway release process. It disables unsafe legacy schema 1/2 `save_plan_weeks` writes, including queued jobs. The website must not precede this protection.
2. Deploy the website Firebase Functions from this candidate before its UI, especially the new verified-admin `listAiIncidents` callable and incident test classification changes. Check existing function configuration and a signed-in administrator against production rules.
3. Compose and review a deliberate application release from this website candidate. `build-production.mjs` intentionally preserves the existing live application bytes and therefore only previews the isolated marketing changes; it does not publish the new admin/coach UI. The reviewed booking-enquiry replacement is packaged by `build-application-release.mjs`.
4. Accept the candidate in signed-in admin/coach/player browsers at narrow and desktop widths, including scope changes, issue queues, incident paging/search, roster switch, independent coach admission and resumed legacy signup. Confirm the function-first ordering before any publish.

## Candidate behavior and limits

- Admin Insights cursor/scope reliability, honest loading and result states, record-level issue queues and keyboard interactions improve. AI incidents have complete server-side filters/search/counts and 50-row pages, with a bounded 50,000-retained-document scan. Legacy incident repairs are a read-only plan and were not applied.
- Coach overview streams bounded 30-day rows with four concurrent athlete reads and discloses incomplete coverage. Follow-ups rely on recorded plan and workout facts; the candidate never labels missing telemetry as inactivity. Historical plans stay readable while the unsafe week editor is retired.
- Booking is an honest email enquiry handoff, not a reservation or purchase. The landing page and account-entry recovery are improved, but live signup fault injection and business terms still need acceptance.
- Protected legacy content remains pinned to manifest size and SHA-1. A narrow recovery reconstructs LF/CRLF checkout aliases and the historical index alias only when the complete restored file matches its original manifest entry.

## Integration verification

- App TypeScript/production build passed; 104 Vitest files and 1,230 tests passed.
- Backend suite: 351 passed, 3 skipped, 0 failed.
- Release composition tests: 12 passed. Protected baseline tests: 12 passed. Marketing preview test: 1 passed.
- Browser checks on local isolated output at 390 and 1,440 pixels: booking/hero interactions and auth dialog keyboard behavior, 3 passed.
- `build-production.mjs` verified all 1,078 preserved application/public files against the pinned manifest. The one-line integration fixture update supplies the reviewed booking file required by the composed guard.
- `build-application-release.mjs` composed the actual unreleased candidate successfully, preserving 1,076 unchanged files and adding 58 application assets while replacing only the reviewed application entry and booking enquiry.

The [product analytics audit](insights/PRODUCT_ANALYTICS_AUDIT_2026_09_26.md) is read-only and separate from this implementation. It finds a live custom foreground-usage pipeline but no established Firebase Analytics event stream. No new analytics or admin observability instrumentation is implemented in this branch; first-screen outcome, meaningful-action definition, event policy and privacy boundaries need agreement before that work starts.
