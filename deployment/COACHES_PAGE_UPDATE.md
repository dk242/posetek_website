# Coaches and clubs page — September 17, 2026

## Approved service and reference lock

PoseTek offers a tailored team-by-team service for team coaches and club managers. Clubs contact PoseTek to discuss their teams, arrange testing, and agree ongoing support. Testing leads to individual insight, focused training, and evidence at retesting. The page does not advertise fixed prices, testing frequency, turnaround promises, or guaranteed improvements.

The existing player homepage is the visual reference: dark green surfaces, lime accents, condensed athletic headings, concise copy, and focused interactive sections. Refero guidance informs hierarchy, responsive behavior, keyboard focus, reduced motion, and clear product illustrations. The new visuals are editable web components grounded in verified workflows, not reproductions of the older admin screens.

Admin inspection confirmed the club → teams → players structure. Managers oversee the club; coaches access their assigned teams and review player progress. PoseTek/admin program support is distinct from the coach's review and the player's training. Admin editing tools are not presented as coach capabilities. Commercial packages were not documented; the tailored enquiry approach was explicitly confirmed by the user.

## Public experience and sample data

- `/coaches` is a separate public marketing entry with its own title, description, and canonical URL. `/coaches/` and `/coaches/index.html` serve the same page.
- Persistent Players / Coaches links use real URLs and an active-page indicator, including on phones. The player-page body and its existing demonstrations remain unchanged.
- The hero introduces the team approach. Club selection updates the assigned coach and compact roster; player selection reveals a five-area profile, one test result, and an individual training focus. All six tests are named, with a link to the existing player testing experience.
- Plan / Train / Retest follows the selected player. Changing teams selects that team's first sample player; changing players resets the journey to Plan. Train uses an upright phone and the existing approved Figure-8 dribble (`DRB-006`) or Wall pass rhythm (`PAS-001`) demonstration. Retest compares the same player's earlier and latest dribbling result.
- The primary enquiry link is `mailto:dylank@posetek.net?subject=PoseTek%20team%20enquiry`; coach sign-in remains `/signin`.

Northfield FC, its U13/U15/U17 teams, coaches, nine players, scores, results, and session counts are fictional marketing examples. Visible labels identify them as illustrative; retest changes are not promised outcomes. The phone is a web preview, and no workout or selection is saved. No private athlete records, credentials, or admin screenshots are published.

## Source and release boundary

| Area | Files |
| --- | --- |
| Entry and metadata | `coaches/index.html`, `app/src/coaches-entry.tsx` |
| Page composition and styling | `app/src/pages/coaches/CoachesPage.tsx`, `coaches.scss` |
| Club, player, and development interactions | `ClubExplorer.tsx`, `PlayerEvidence.tsx`, `DevelopmentJourney.tsx`, `coaches-examples.css` in the same folder |
| Fictional data and consistency checks | `app/src/pages/coaches/coach-samples.ts`, `coach-samples.test.tsx` |
| Shared audience navigation | `app/src/pages/home/MarketingHeader.tsx`, `marketing-header.css`, `marketing-header.test.tsx` |
| Approved drill media | `app/src/pages/home/product/DrillMedia.tsx`, `drill-media.ts`, `media/provenance.json` |
| Build, preview, routes, and preservation checks | `app/vite.marketing.config.ts`, `netlify.toml`, `scripts/build-production.mjs`, `scripts/serve-homepage-preview.mjs`, `scripts/test-production-entry.cjs` |

Coaches components import public visual components and local sample data only. They do not import authenticated admin code or Firebase clients. This release changes no backend API, database, permissions, authentication, or mobile source. The application navigation bridge and guarded 171-file baseline remain the release boundary.

## Validation and publishing workflow

The source checks passed: 141 tests in 19 home/coaches test files, 15 navigation/build/preview script tests, TypeScript, and Svelte checks. Browser review and production verification are recorded separately in [`COACHES_PAGE_PRODUCTION.json`](COACHES_PAGE_PRODUCTION.json); this document alone does not confirm publication.

For local review, run `npm --prefix app run build:marketing`, then `node scripts/serve-homepage-preview.mjs`. Review both audience pages, selection consistency, the three development states, phone media, keyboard controls, reduced motion, contact links, and desktop/tablet/phone layouts.

Release through `node scripts/build-production.mjs`, which checks the live application and preserves all 171 baseline files. Deploy `production-dist/` as a draft, verify routes, metadata, media, and artifact hashes, then promote that exact reviewed artifact. Record its IDs, checks, and publication result in the production receipt. Commit source, required assets, and handoff documentation while preserving teammates' work; avoid an unintended second Git-triggered deployment.

The rollback target preceding this update is Netlify deployment `6aab2fc35884120dc73147f5`, the September 16 player homepage with approved drill videos and interactive coach metrics. Restoring that immutable deployment removes the new coaches page and audience navigation without rebuilding application assets. Before restoring, confirm that no later authorized production release would be overwritten.
