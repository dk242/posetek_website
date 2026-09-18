# Player web and community implementation

This is the implementation handoff for the September 17–18, 2026 player-experience work. It is a **release candidate**, not a production receipt. Production remains the invitation-link release recorded in `deployment/PLAYER_INVITATION_LINKS_PRODUCTION.json` until a new verified receipt replaces it.

Hosted review: [player preview](https://6aacc04ea454c9210b8fd34c--posetek.netlify.app/athlete?preview=1) and [community preview](https://6aacc04ea454c9210b8fd34c--posetek.netlify.app/feed?preview=1). These links use synthetic data and do not modify accounts. The build uses source `30952de4387a346c86475b1eb4fc2f1d7e2a0298`; subsequent handoff/type-only commits do not change its runtime bytes. See `deployment/PLAYER_COMMUNITY_CANDIDATE.json` for the immutable preview and verification record.

## Confirmed product decisions

- Keep the existing screen layouts, containers and content hierarchy. Add a restrained visual finish through green surfaces, lime accents, quiet borders, stronger numeric typography, focus states and short feedback. The research lock is in `PLAYER_COMMUNITY_DESIGN.md`.
- Five player tabs: Feed, Training, Drills, Coach, You. Normal player sign-in opens You; explicit invitation and result links retain their destination. Team standings live within You.
- The phone website supports saved results, guided training and coaching. Capture, calibration, processing and new body scans stay native.
- Community discovery is available to signed-in members regardless of age. Only claimed, opted-in player profiles appear in discovery. Community identity is the player's chosen display name and optional club, separate from their private profile.
- Each community post requires explicit publication. A caption, selected qualified rep, selected saved video and comments setting are optional. No automatic community publishing, direct messages, new uploads, push/email notifications or algorithmic ranking were added.
- Existing team/organization/friend sharing remains. Unspecified preferences fail private. Turning discovery off and withdrawing existing posts are separate, clearly labeled controls.
- Web planning retains draft review and explicit activation. Native planning permissions, schema and daily limits remain unchanged. Existing active plans and private intake contexts are preserved.

## Differences addressed

| Area | Previous gap | Candidate behavior |
| --- | --- | --- |
| Navigation | Feed was a separate mounted page; returning could discard drafts | Shared workspace retains route-family state, scroll position and feed filters; effects stop when hidden; identity and staff-preview changes reset the appropriate state |
| Training | Paused actions, incomplete runtime restoration, old-plan recovery gaps | Paused controls cannot record sets; account/player/log/revision-scoped runtime saves exact drill/rest/timing; unfinished immutable snapshots remain resumable |
| Progress | Cross-plan ad-hoc work and allocation-only native logs were undercounted | Calendar-window credit and native minute fallback match the reviewed mobile behavior |
| Plan review | Limited explanation and history context | Saved plan details, prior programs, recorded-session links and source-grounded explanations within existing containers |
| Profile | Incomplete current/legacy session aggregation | Canonical session history merged without counting duplicate representations |
| Standings | Exact ties could receive different percentile behavior | Stable tie ordering, midpoint percentiles and distributions only with enough players |
| Technique | Saved reports lacked guided, marked-frame inspection | Optional original-frame findings, joint emphasis, saved opposite-foot comparisons and published source-job-bound corrections |
| Feed evidence | Raw summaries could count failed or duplicate reps; media could pick the wrong MP4 | Qualified canonical projection and exact capture association; no inferred media fallback |
| Community | No broad, deliberate player publishing/discovery workflow | Minimal profiles, opt-in discovery, explicit composer, selected saved rep, kudos, comments, connections and activity inbox |
| Controls | Limited comment/profile moderation and revocation handling | Author comment removal/disable, post withdrawal, blocking/reporting and admin restriction/recovery; source data remains intact |
| Media lifecycle | Loaded feed videos could outlive permission refresh or tab visibility | Five-minute maximum leases, pause/clear on route leave, hide, permission/rep change and expiry; reopening requests current access |

## Code ownership and boundaries

- Shell, feed UI and finish: `PlayerWorkspace.tsx`, `player-navigation.ts`, `PlayerExperience.tsx`, `pages/feed/`, `styles/player-finish.css`.
- Training: `PlayerTraining.tsx`, `PlayerWorkout.tsx`, `workout-runtime.ts`, `training-details.tsx`, the existing workout repository and progress helpers. The athlete wrapper reuses `PersonalizedPrograms`.
- Results: `profile-activity.ts`, `TechniqueReplay.tsx`, `technique-evidence.ts`, `use-published-feedback.ts` and the existing standings/pose components.
- Social backend: see `functions/SOCIAL_COMMUNITY.md` for callable versions, private collections, migration and deployment scope.
- `mobile-parity.json` pins the clean native candidate `e2c37363ca0f29e068dcb65fbd373d94f3120fad`. All 11 existing pinned contracts were checked. Only the gateway permission documentation changed; its clarification distinguishes recording rules from gateway capabilities. Text hashes now normalize CRLF to LF. Benchmark values are unchanged.

## Validation and release gates

The final integrated frontend suite passed 1,030 tests in 79 files. The backend/migration suite passed 281 tests, with three existing private historical fixtures skipped. Isolated Firestore/Storage emulators passed 336 assertions. TypeScript, the 11-source mobile parity check, 19 release-guard tests and the guarded application build passed. Lint completed with no errors and existing-style warnings (172 total); the build retains its large-chunk warnings. Exact source/deployment identifiers belong in the candidate receipt.

Executed phone-browser checks use synthetic preview data: Coach draft → Feed → Coach retains text; My activity remains selected across tab changes; explicit community composer shows audience and refuses sample writes; a partly completed workout returns from Feed paused at the same drill with confirmed set progress; Keep training resumes it. These checks do not claim real-account or physical-device coverage.

Local views were inspected at 360 and 390 CSS pixels and desktop. The hosted candidate's profile, feed and sharing settings were inspected at 430 CSS pixels, with no page overflow or browser console errors. Temporary viewport overrides were restored. Independent backend review and focused regressions covered legacy endpoint compatibility, account reassignment and concurrent membership/suspension changes; the identified issues were fixed before the final suite.

The production migration dry-run was attempted with standard application-default credentials and stopped before reading a page because those credentials were unavailable. No migration checkpoint or data mutation was produced. An authenticated release operator must complete this step; a Netlify login alone does not authorize Firestore/Storage migration.

Before broad community activation:

1. Deploy only the documented social targets and narrowly additive Firestore rules/indexes, with the new collection-deny rules in place before the backend. Keep the community gate off. Never deploy native rules or unrelated functions.
2. Run the resumable canonical projection migration with a private checkpoint and verify coverage. Existing schema-1 summaries are deliberately hidden from v2 until repaired.
3. Exercise signed-in pilot accounts across organizations: opt in/out, publish/unpublish, comments/kudos, block, report, staff moderation, privacy revocation and exact media. Verify offline failures do not queue writes.
4. Validate iOS Safari and Android Chrome, soft keyboard, safe areas, reload/recovery and web/native workout-log interoperability. Taiyo's separate Mac/iPhone/TestFlight acceptance remains outstanding for the native candidate.
5. Publish the exact verified website candidate, reconcile the protected baseline and record the immutable deployment. Enable community only after migration and pilot acceptance.

The ordinary production build preserves application bytes and will not publish these changes. Use `node scripts/build-application-release.mjs --marketing-snapshot <verified-manifest>` so the approved Players and Coaches marketing bytes remain exact. Keep generated bundles, captures, migration journals and credentials outside Git.

## Recovery

Disable the community gate first if a community issue appears; existing training remains available. Restore the previous immutable website deployment if necessary. Do not restore malformed legacy projections or delete athlete source results to undo feed work. Backend rollback must follow its scoped handoff and preserve the current gateway, video archive guards, invitations, reviewed estimates and twelve active cohort plans.
