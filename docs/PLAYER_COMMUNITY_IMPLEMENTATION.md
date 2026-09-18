# Player web and community implementation

This is the implementation handoff for the September 17–18, 2026 player-experience work. It is a **release candidate**, not a production receipt. Production remains the invitation-link release recorded in `deployment/PLAYER_INVITATION_LINKS_PRODUCTION.json` until a new verified receipt replaces it.

The first-pass preview and its source `30952de` remain historical in
`deployment/PLAYER_COMMUNITY_CANDIDATE.json`. The second pass is a new runtime
candidate, recorded separately in `deployment/PLAYER_NATIVE_PARITY_CANDIDATE.json`.
Preview data is synthetic and does not modify accounts; approved public drill
demonstrations are explicitly labeled separately from sample activity figures.

Current review: [Drills and player screens](https://6aacdc5a9d67561b3914ffbc--posetek.netlify.app/athlete?preview=1&view=drills)
and [scrolling feed](https://6aacdc5a9d67561b3914ffbc--posetek.netlify.app/feed?preview=1).
Runtime source is `fb5f0fe93378aac0354f17f990c23b89e3d2bda9`. All 699 deployed
files and five entry routes were verified; production remains unchanged.

## Confirmed product decisions

- The approved second pass uses the active native application's screen structures and visual roles. It supersedes the earlier container-preservation instruction. The source/Refero lock is in `PLAYER_COMMUNITY_DESIGN.md`; page-by-page findings are in `PLAYER_COMMUNITY_NATIVE_AUDIT.md`.
- Five shared tabs: Profile, AI Coach, Drills, Training, Feed. Normal sign-in opens Profile; explicit result/invitation links retain their destination. Team standings live in Profile. Drills opens its chooser; AI Coach cannot trap the user away from Drills or Training.
- The phone website supports saved results, guided training and coaching. Capture, calibration, processing and new body scans stay native.
- Community discovery is available to signed-in members regardless of age. Only claimed, opted-in player profiles appear in discovery. Community identity is the player's chosen display name and optional club, separate from their private profile.
- Each community post requires explicit publication. A caption, selected qualified rep, selected saved video and comments setting are optional. No automatic community publishing, direct messages, new uploads, push/email notifications or algorithmic ranking were added.
- Existing team/organization/friend sharing remains. Unspecified preferences fail private. Turning discovery off and withdrawing existing posts are separate, clearly labeled controls.
- Web planning retains draft review and explicit activation. Native planning permissions, schema and daily limits remain unchanged. Existing active plans and private intake contexts are preserved.
- Feed autoplay selects one visible clip, starts muted and pauses when another clip becomes active. Rep results stay below the video. Reduced-motion/data-saving preferences use manual play. Media leases and current-access checks still apply.
- Pose effects require explicit consent for the featured saved rep. Only exact-recording normalized skeleton data, short foot trails and saved markers are returned; gaps remain gaps. Missing or mismatched tracking leaves video playable without effects. No ball path or unsaved tracking is fabricated.
- Training adds separate set/drill work timing alongside rest and session timing. It survives scoped local recovery, excludes rest and pauses across navigation. Completing time alone never logs a set.

## Differences addressed

| Area | Previous gap | Candidate behavior |
| --- | --- | --- |
| Navigation | Feed was separate; AI Coach/Training/Drills could conflict | Shared five-tab workspace retains drafts and filters; explicit views override stale drill parameters; Drills opens its menu; global and contextual coaching are separate |
| Training | Paused actions, incomplete runtime restoration, old-plan recovery gaps | Paused controls cannot record sets; account/player/log/revision-scoped runtime saves exact drill/rest/timing; unfinished immutable snapshots remain resumable |
| Progress | Cross-plan ad-hoc work and allocation-only native logs were undercounted | Calendar-window credit and native minute fallback match the reviewed mobile behavior |
| Plan review | Limited explanation and history context | Native-style detail/history sheets, prior programs, recorded-session links and source-grounded explanations |
| Profile | Incomplete current/legacy session aggregation | Canonical session history merged without counting duplicate representations |
| Standings | Exact ties could receive different percentile behavior | Stable tie ordering, midpoint percentiles and distributions only with enough players |
| Technique | Saved reports lacked guided, marked-frame inspection | Optional original-frame findings, joint emphasis, saved opposite-foot comparisons and published source-job-bound corrections |
| Feed evidence | Raw summaries could count failed or duplicate reps; media could pick the wrong MP4 | Qualified canonical projection and exact capture association; no inferred media fallback |
| Community | No broad, deliberate player publishing/discovery workflow | Minimal profiles, opt-in discovery, explicit composer, selected saved rep, kudos, comments, connections and activity inbox |
| Controls | Limited comment/profile moderation and revocation handling | Author comment removal/disable, post withdrawal, blocking/reporting and admin restriction/recovery; source data remains intact |
| Media lifecycle | Playback hid rep evidence and required a separate start | Muted scrolling playback, visible rep chart, optional consented pose/trails; five-minute leases and pause/clear on route leave, hide, permission/rep change and expiry |

## Code ownership and boundaries

- Shell and native design: `PlayerWorkspace.tsx`, `player-navigation.ts`, `PlayerExperience.tsx`, `native-ui.tsx`, `native-tokens.css`, `native-results.css`, `native-training.css`, `pages/feed/native-feed.css`.
- Training: `PlayerTraining.tsx`, `PlayerWorkout.tsx`, `workout-runtime.ts`, `training-details.tsx`, the existing workout repository and progress helpers. The athlete wrapper reuses `PersonalizedPrograms`.
- Results: `profile-activity.ts`, `TechniqueReplay.tsx`, `technique-evidence.ts`, `use-published-feedback.ts` and the existing standings/pose components.
- Social backend: see `functions/SOCIAL_COMMUNITY.md` for callable versions, private collections, migration and deployment scope.
- `mobile-parity.json` pins the clean native candidate `e2c37363ca0f29e068dcb65fbd373d94f3120fad`. All 11 existing pinned contracts were checked. Only the gateway permission documentation changed; its clarification distinguishes recording rules from gateway capabilities. Text hashes now normalize CRLF to LF. Benchmark values are unchanged.

## Validation and release gates

The final second-pass integrated frontend suite passed 1,107 tests in 83 files,
including the late-acknowledged workout-start fix. The backend
and migration suite passed 298 tests with three existing private fixtures skipped.
The 11-source native parity check, TypeScript and 19 release-guard tests passed.
Lint has no errors and retains warnings. Exact final counts and build/deployment
identifiers belong in the second-pass candidate receipt. The first pass's 336
Firestore/Storage emulator assertions are historical coverage; this pass changes
no rules and does not claim a new emulator run.

Executed phone-browser checks use synthetic preview data: Coach draft → Feed → Coach retains text; My activity remains selected across tab changes; explicit community composer shows audience and refuses sample writes; a partly completed workout returns from Feed paused at the same drill with confirmed set progress; Keep training resumes it. These checks do not claim real-account or physical-device coverage.

Second-pass local checks cover native tabs, Drills chooser/dashboard, AI draft
retention, Training overview/workout/rest/navigation, scrolling single-clip
playback, muted return and chart placement. Independent reviews fixed optional
overlay validation/dropout issues, featured-rep refresh, stale media duration,
native 240fps pose input size and malformed timer caches. Real account, physical
keyboard, exact private video/pose and native-device acceptance remain pending.

The production migration dry-run was attempted with standard application-default credentials and stopped before reading a page because those credentials were unavailable. No migration checkpoint or data mutation was produced. An authenticated release operator must complete this step; a Netlify login alone does not authorize Firestore/Storage migration.

Before broad community activation:

1. Deploy only the documented social targets and narrowly additive Firestore rules/indexes, with the new collection-deny rules in place before the backend. Keep the community gate off. Never deploy native rules or unrelated functions.
2. Run the resumable canonical projection migration with a private checkpoint and verify coverage. Existing schema-1 summaries are deliberately hidden from v2 until repaired.
3. Exercise signed-in pilot accounts across organizations: opt in/out, publish/unpublish, comments/kudos, block, report, staff moderation, privacy revocation and exact media. Verify offline failures do not queue writes.
   Include pose consent/revocation, a native 240fps artifact larger than 2 MiB,
   timing/aspect mismatch, missing tracking, expiry, account switching and mute
   behavior on scrolling return. Deploy the documented overlay-enabled social
   targets; a static Netlify preview alone cannot provide the new backend response.
4. Validate iOS Safari and Android Chrome, soft keyboard, safe areas, reload/recovery and web/native workout-log interoperability. Taiyo's separate Mac/iPhone/TestFlight acceptance remains outstanding for the native candidate.
5. Publish the exact verified website candidate, reconcile the protected baseline and record the immutable deployment. Enable community only after migration and pilot acceptance.

The ordinary production build preserves application bytes and will not publish these changes. Use `node scripts/build-application-release.mjs --marketing-snapshot <verified-manifest>` so the approved Players and Coaches marketing bytes remain exact. Keep generated bundles, captures, migration journals and credentials outside Git.

## Recovery

Disable the community gate first if a community issue appears; existing training remains available. Restore the previous immutable website deployment if necessary. Do not restore malformed legacy projections or delete athlete source results to undo feed work. Backend rollback must follow its scoped handoff and preserve the current gateway, video archive guards, invitations, reviewed estimates and twelve active cohort plans.
