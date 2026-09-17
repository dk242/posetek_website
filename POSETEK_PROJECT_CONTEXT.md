# PoseTek website project context

Reviewed on September 17, 2026. This guide summarizes the available repository and
release notes; it is not a claim that every historical discussion or private
business document is included.

## Readiness and source provenance

### Vacaville measurement recovery

The September 17 first pass repaired eleven failed September 16 attempts using
original recordings and audited revisions. The second pass corrected eight more
numerical results: four August change-of-direction times, one September 16
dribbling time and three broad jumps. A further mislabeled broad jump was
reclassified without a numeric result because its landing was not measurable.
Category migrations preserve the same rep IDs, recording dates and original
files, with explicit session and server-owned duplicate corrections. The user
confirmed the 5.875-inch black marker; the four first-pass jump repairs already
used that calibration and remain unchanged.

The first pass made no deployment changes. The second pass extended the existing
video processor's exact archive guard to 26 entries in verified revision
`onvideoupload-00025-vic`, with source unchanged. The later follow-up below expands
that map to 30 entries; preserve the full current map during later deployments.
The concurrent application/reader remediation has its
own release receipts and is not a website release performed by this data repair.
Twelve original failures and one newly identified incomplete broad jump still
require complete footage or retesting. See
[`docs/VACAVILLE_REP_RECOVERY.md`](docs/VACAVILLE_REP_RECOVERY.md) for evidence,
the **2026-09-17T21:08:20.691Z** final checkpoint, private evidence locations
and the expanded rollback boundary. Earlier release checkpoint totals below
remain records of their original observation.

### Current release: Reviewed provisional Dribbling evidence

Deployment `6aac666c61025a8e62e8c399` is live at https://posetek.net, published
September 17, 2026 at 3:22:58 PM PDT (`2026-09-17T22:22:58.156Z`). Application
source `e1c410153549a0e65dd36738d840391901059807` is pushed on
`codex/provisional-dribbling-recovery`. See
[`deployment/PROVISIONAL_DRIBBLING_PRODUCTION.json`](deployment/PROVISIONAL_DRIBBLING_PRODUCTION.json)
and [`docs/PROVISIONAL_DRIBBLING_RECOVERY.md`](docs/PROVISIONAL_DRIBBLING_RECOVERY.md).

Two reviewed near-finish Dribbling recordings now have explicitly labeled,
conditional estimates on authenticated skill maps and optional low-confidence
planning context. The estimates remain separate from measured results, overall
ratings, qualification, completion counts, rankings, Insights and shared results.
They disappear when a qualified Dribbling result becomes available. No Agility
estimate was published, and this release generated or activated no workout plan.

The authenticated `getAthleteEffectiveResults` reader is ACTIVE version 3. Its
source-only deployment preserved configuration, all 57 checked function IAM
policies, 56 unrelated central function definitions and rules releases. The
current video processor is `onvideoupload-00026-bup` with all 30 archive guards;
its source and the prior 26 entries remain intact. Two further mislabeled attempts
were moved to one Dribbling session with the same IDs and original recordings.
Both remain incomplete, and the successful original agility attempt is unchanged.
Two separately journaled private estimate documents add no measured results.

The verified website contains 494 local files matching the 495-file production
inventory. The reconciled protected baseline has 462 application/public files.
Approved Players and Coaches marketing bytes are unchanged. Production review
confirmed both labeled estimates, unchanged measured counts and an enabled
planner with the reversible estimate option. Baseline/release checks passed 19/19.
The initial frontend suite passed 928 tests with one five-second home-pose timeout;
that file passed all 10 tests in isolation. After a sixth provisional test was
added, its focused suite passed 6/6. TypeScript, 402 preview HTTP checks and 11
preview routes passed. Backend validation passed 37 workspace tests and 32
immutable-candidate tests, with one private fixture deliberately excluded from
the candidate and already passed in the workspace. These are separate checks,
not a claim that a final complete frontend suite was rerun. Native display and
the outstanding Mac/iPhone/TestFlight acceptance remain unchanged.

### Previous release: Testing audit remediation

Deployment `6aac59bb9c49063e622aa65a` was published at https://posetek.net on
September 17, 2026 at 2:22:42 PM PDT (`2026-09-17T21:22:42.725Z`). See
[`deployment/TESTING_AUDIT_PRODUCTION.json`](deployment/TESTING_AUDIT_PRODUCTION.json)
and [`docs/TESTING_AUDIT_BUILD_HANDOFF.md`](docs/TESTING_AUDIT_BUILD_HANDOFF.md).
Authenticated results, shared results and native team rankings use reviewed
qualification. Failed measurements remain unavailable, proven mirrors are
excluded, and explicit review nulls cannot be replaced by stale metadata.
Original or verified diagnostic media uses exact capture identity; replay respects
confidence, aspect ratio and recorded timestamps. Legacy clips without trustworthy
timing support manual pose inspection rather than invented synchronization.

The unchanged verified candidate contains 445 local files matching the 446-file
production inventory; its protected application baseline contained 413 files.
Approved Players and Coaches marketing bytes remain intact. The original workbook
is unchanged; its 264 overlapping issue rows have a separate private disposition
ledger. The independent post-repair checkpoint above has 258 qualifying results,
27 proven duplicates and all 40 qualifying vertical jumps with available peak
indices. Historical evidence gaps and retests remain explicit.

Native source is pushed at `e2c3736` on `codex/testing-audit-remediation` in
`athelyticsOG/posetek-mobile-app`, based on main `944177b` (which already includes
Insights usage). It retains source video for six tests, journals immutable capture
IDs and frozen ownership, commits idempotently after artifact acknowledgement,
and adds coach Finish plus a 60-second cutoff for COD/dribbling. The native handoff
is `docs/plans/TESTING_AUDIT_REMEDIATION_HANDOFF.md`. It remains code complete with
Mac compilation, XCTest, physical-iPhone acceptance and TestFlight outstanding.
No native rules, Apple signing settings or App Store Connect build were changed.

### Previous release: Expanded Insights

Deployment `6aabc66e9bcc60cc5c2ee12c` was published for https://posetek.net/insights,
published September 17, 2026 at 4:05:05 AM PDT (`2026-09-17T11:05:05.592Z`),
from application source `706f103`. See
[`deployment/EXPANDED_INSIGHTS_PRODUCTION.json`](deployment/EXPANDED_INSIGHTS_PRODUCTION.json)
and [`docs/insights/EXPANDED_INSIGHTS_HANDOFF.md`](docs/insights/EXPANDED_INSIGHTS_HANDOFF.md).

Overview, Testing, Workouts and Usage share current canonical scopes, filters,
local dates, pagination and player-return context. Verified testing uses accepted
revisions and processing evidence; charts distinguish recording documents,
recorded attempts, qualifying results and separate failure reports. The live
September 16 checkpoint matches 36 athletes, 20 boys/16 girls, 16 known ages,
10 fully/24 partially/two unrecorded, 325 documents and 244 qualified results.
Its 101 September 16 documents overlap 23 failure reports. Different explicit
session IDs prevent older calibration failures from disqualifying later captures.
Workout outcomes, prescribed sets, timer coverage and elapsed estimates are
separate from product usage. No original measurements or workouts were rewritten.

Eight additive generation-1 Node 22 functions are deployed and verified. V1 remains
available for compatibility. Server-owned version-2 projections and private
reporting metadata use new client-denied paths. Estimated active use is athlete
self-activity only; overlapping devices count once. Exact intervals expire after
90 days, aggregate summaries after 24 months, and all four TTL policies are active.
Historical absence remains Not collected. Keep these private-path rules and TTL
policies during a website/backend rollback; old rules do not protect new data.

Validation passed 893 frontend tests, 196 backend tests, TypeScript, 216 new rules
assertions, 205 existing planner rules assertions, seven actual Firestore SDK
integration tests and 19 release-tool tests. Fresh hosted admin/manager sessions,
four teams, Daniel's six players, filters, date modes, pagination, context return,
390px layouts and production smoke passed with no browser errors. All 350 local
files match the 351-file production inventory (one platform configuration file);
26 inherited HTML delivery transforms match prior production. The homepage,
Coaches page and 30 marketing assets are preserved. The new application baseline
contains 318 files.

Native usage is prepared and pushed at mobile commit
`4307f13b96a48c6dcc5af53e72a517f4e7773d2e` on
`codex/expanded-insights-usage`; original local mobile edits were preserved.
Eighteen XCTest cases and a shared scheme are supplied, but Xcode compilation,
device validation and TestFlight upload remain for Taiyo's Mac. No invitation or
message was sent to him. The native planner and existing app/widget identities
remain unchanged. The workbook and personalized gateway are unchanged.

### Previous release: Team Insights for admins and club staff

Deployment `6aabb282bcbad486db278962` is live at https://posetek.net, published
September 17, 2026 at 2:31:39 AM PDT (`2026-09-17T09:31:39.235Z`), from source
`55d46ea`. See [`deployment/TEAM_INSIGHTS_PRODUCTION.json`](deployment/TEAM_INSIGHTS_PRODUCTION.json)
and [`docs/insights/INTEGRATION.md`](docs/insights/INTEGRATION.md).

Taiyo's Team Insights prototype is integrated at `/insights`, with persistent
admin navigation and contextual links from canonical organization/team rosters
and coach dashboards. Admins select organizations, managers see every current
organization team, and coaches see only currently assigned teams. Independent
legacy coaches retain their existing dashboard. Organization/team context survives
player results and return navigation; stale roster mirrors cannot populate the
canonical coach dashboard.

The new `getClubInsights` callable (generation 1, Node 22, us-central1, version 1)
returns allowlisted aggregates with bounded reads and final current-access checks.
It counts recording documents, including failed/duplicate outputs, rather than
successful tests or app visits. Metric trends reject explicitly invalid or
incomplete results. Dates and Monday week boundaries use UTC; historical records
follow the current player profile. No athlete data, rules, planner, workbook or
native mobile changes were deployed in this release.

Validation passed 835 frontend tests, TypeScript, 19 handler/wrapper tests,
48 existing backend regressions, 18 release-tool tests and 25 release composition
checks. Live admin/manager reports reconciled all four club teams; cross-club and
signed-out requests were denied. Hosted admin and manager sign-ins, player links,
return context and 390px/26-week layouts passed. Coach restrictions and revocation
use synthetic fixtures. The exact preview was promoted; 302 local files match the
303-file published inventory. The homepage/Coaches page and 30 marketing assets
remain byte-for-byte preserved. That release's application baseline contains 270 files.

### Previous release: Vacaville account hierarchy and personalized web planning

Deployment `6aaba570721b0d41e0eabf90` is live at https://posetek.net, published
September 17, 2026 at 1:33:55 AM PDT (`2026-09-17T08:33:55.137Z`) from application
source `1cc6637`. The gateway, Firestore rules and personalized configuration are
also live; backend serving revision is `gatewayweb43b9da983c41`. The complete
release and recovery record is
[`deployment/VACAVILLE_WEBSITE_PRODUCTION.json`](deployment/VACAVILLE_WEBSITE_PRODUCTION.json).

The approved September 17 follow-up adds a canonical organization/staff/team
account hierarchy and one reviewed personalized-planner workflow across admin,
coach/manager and athlete web surfaces. Named team labels do not create staff
accounts. Current membership and player team ownership take priority over legacy
roster mirrors. That release kept the separate Insights prototype development-only;
the follow-up above now integrates it in production.

The reconciled workbook retains 36 athletes (16 girls, 20 boys): 10 fully tested,
24 partially tested and 2 with no recorded tests; none are classified as having
no successful tests. Its audit preserves 325 source records and prior contacts,
notes and historical sheets. The final OneDrive Operations workbook is
`PoseTek_Testing_Roster_Audit_2026-09-16_Updated.xlsx`; private contents remain outside Git.

Web users explicitly review and activate drafts. The four personalized
capabilities use an explicit unlimited daily policy, while authorization,
feature gates, private-context boundaries and operation ownership remain enforced.
Native mobile `generate_training_plan` behavior is unchanged. Release verification
did not submit plan-generation or activation requests.

Read [`docs/VACAVILLE_WEBSITE_UPDATE.md`](docs/VACAVILLE_WEBSITE_UPDATE.md) for the
superseding web rollout contract, validation status and guarded application
release command. `node scripts/build-application-release.mjs` creates the complete
`production-dist/` artifact; the ordinary homepage build still preserves the
pinned application. The optional `--marketing-snapshot` manifest was used here
to retain exact approved homepage, Coaches entry and 30 marketing asset bytes
from `6aab9fbaa73be75422324ba4`. Concurrent marketing commit `38a817e` remains in
the shared source and history.

The published inventory contains 261 files: all 260 local artifact files plus
platform-generated metadata. The reconciled preservation baseline contains 228
application/public files, including 57 genuinely new asset paths; compiled asset
counts also include reused paths. Frontend validation passed 811 tests across 59
files and TypeScript. The gateway passed 1,353 tests in each of two runs with six
explicit private-fixture skips; authorization checks passed 205 emulator
assertions and seven live permission checks. The production receipt records the
final release-helper counts and exact live browser/preservation checks. Preserve
existing receipts as historical records.

### Vacaville ownership and organization access repair

The September 16 collection cleanup was applied and independently verified on
September 17, 2026 UTC. It corrected organization/team assignments, consolidated
duplicate athlete profiles into the selected existing profile, transferred
misattributed recordings into another existing profile, and restored the director's
canonical manager access. The operator confirmed all four teams are visible in
the mobile app. Recorded measurements and timestamps were preserved; suspected
duplicate processing results remain flagged for a separate audit.

The website and mobile deployments were unchanged. A narrow archive guard was
deployed to the existing legacy Storage upload processor before copying video
objects; its private path/checksum coverage also protects rollback restores.
Read [`docs/VACAVILLE_DATA_REPAIR.md`](docs/VACAVILLE_DATA_REPAIR.md) for the generic
repair tool, verified aggregate results, guard revision and recovery requirements.
Private manifests, athlete data, signup codes, backups and runtime configuration
remain excluded from Git. Historical production and migration receipts remain
unchanged.

### Feed stack recovered for the shared repository

On September 16, 2026, the user requested the complete feed frontend/backend in
`dk242/posetek_website` for the app engineer. At `3f7ecd2`, the repository had only
an old feed mockup; homepage releases preserved the compiled live application
without recovering its source. The initial diagnosis is retained at `2264401`.

The feed feature stack is now recovered and integrated. Editable React source
in `app/src/pages/feed/` reconstructs the exact published component and styles,
with named components, typed contracts for all 14 callables, and source provenance.
Original frontend TSX/comments/history remain unavailable. No deployed React
runtime is imported. The frontend builds without the ignored reference capture.

The original authored backend was recovered from deployed Google Cloud Functions
source archives using the authorized Firebase account: 14 callables, four activity
projection triggers, account deletion, invitation helpers, and original tests.
Live Firestore/Storage rules and all 12 composite indexes are included. Credentials,
runtime config, source archives, production settings and athlete data are excluded.
The newer teammate admission tests and existing homepage changes are preserved.

Both `/feed` and `/feed.html`, player entry/navigation, and staff/admin feed links
are integrated. Root `feed.html` remains historical and is excluded from ordinary
application output. Preview with the Vite dev server at `/feed?preview=1`; read
[`docs/FEED_SOURCE_HANDOFF.md`](docs/FEED_SOURCE_HANDOFF.md) for setup, contracts,
checks, provenance and the release boundary. The normal dev app uses its existing
cloud Firebase configuration unless a developer explicitly changes it.

That source handoff did not deploy frontend/backend or modify production data;
its 171-file preservation baseline was historical. The later application release
above then reconciled that baseline to 228 files. Future application releases
still need a full application review and deliberate baseline reconciliation.

### Previous marketing release: public coaches and clubs page

Deployment `6aab9fbaa73be75422324ba4` was published September 17, 2026 at
1:10:47 AM PDT (08:10:47.595 UTC). `/coaches` is a separate marketing entry,
linked through a persistent Players / Coaches switch on both audience pages.
The player-page body is unchanged. The new page presents a tailored team-by-team
service: discuss the teams, arrange testing, and agree ongoing support.

Fictional Northfield FC examples connect club/team selection, individual profiles,
and Plan / Train / Retest. The phone uses the two approved drill clips. Admin
inspection informed the club hierarchy and assigned-team coach access; admin-only
editing tools are not advertised as coach capabilities. No private club/player
data, fixed packages, cadence promises, or guaranteed improvements are included.
Team enquiries open an email to `dylank@posetek.net` with a team-enquiry subject.

The draft was promoted unchanged. All 171 application/public baseline files and
the navigation bridge remain byte-for-byte preserved; no backend, database, rules,
or authentication changes were deployed. Coaches source lives in
`app/src/pages/coaches/`; metadata is in `coaches/index.html`. See
`deployment/COACHES_PAGE_UPDATE.md` and `deployment/COACHES_PAGE_PRODUCTION.json`
for decisions, verification, and rollback. The work was isolated from concurrent
admin/training changes in the local checkout and based on shared main `609faa0`.

### Previous revision: two drill videos and interactive coach results

Deployment `6aab2fc35884120dc73147f5` was published September 16, 2026 at
5:12:05 PM PDT (September 17, 00:12:05.241 UTC). The homepage sample now uses
only Figure-8 dribble (`DRB-006`) and Wall pass rhythm (`PAS-001`). Approved
Firebase library footage appears beside corrected diagrams on desktop, with
Overview / Demo switching below 760px and inside the phone. Clips preserve their
portrait proportions, start on request and pause when hidden. The phone selects
either drill and resets its local sample progress when selection changes.

Coach Dribbling, Top speed and Sessions cards select the corresponding sample
chart and answer, synchronized with the existing question chips. The figure-eight
route has mirrored loops; wall passes follow one centered straight axis. Mobile
source remains reference-only. The two public derivatives and their provenance
are committed; rebuilding the site requires no Firebase credentials.

The reviewed draft was promoted unchanged, with all 171 application/public
baseline files preserved. Teammate rules commit `abf4106` remains in the shared
history; this release did not deploy Firebase rules or modify catalog data.
Read `deployment/DRILL_VIDEO_COACH_UPDATE.md` and
`deployment/DRILL_VIDEO_COACH_PRODUCTION.json` for details and rollback.

### Previous revision: showing the mobile application

Deployment `6aab00ac8f7bad5e4a2afd2a` was published September 16, 2026 at
1:50:04 PM PDT (20:50:04.855 UTC). The hero now explicitly identifies PoseTek as a
mobile app and links to an upright phone beside the closing invitation. The phone
shows an interactive sample workout, grounded in the mobile source at
`98d8a051f0580785b70610f5c1a29a5246e08bfb`. It uses local sample data, prescribed
duration labels, and manual set/rest progression; it is a web illustration, not a
native screenshot or a saved workout. Existing demos and profile are unchanged.
Read `deployment/MOBILE_APP_SHOWCASE.md` for design decisions and
`deployment/MOBILE_APP_SHOWCASE_PRODUCTION.json` for validation and rollback.

### Previous revision: clearer poses, training and technique

Deployment `6aaafde5fa78fbd0fffdbf1e` was published September 16, 2026 at
1:38:15 PM PDT (20:38:15.094 UTC). The reviewed draft was promoted unchanged.
Read `deployment/HOMEPAGE_CLEANUP_PRODUCTION.json` and
`deployment/HOMEPAGE_CLEANUP_2026-09-16.md` for checks, references and rollback.

The hero asks “What should the player train next?” and shows skeletons only,
with manual rotation and automatic resumption. Mesh, visible camera presets and
pause controls are removed. All six recorded camera playbacks fit uniformly within
their cards, including full-rep motion and real calibration markers where present.
Training uses Setup / Movement / Finish diagrams; AI Coach explanations expand
on request. Technique is the final feature section, with a professional pose
overlaid at saved phases and one cue at a time. The player profile component and
data remain unchanged; its section number is now 02. Application assets remain
the guarded 171-file baseline, and recovered feed source is preserved.

### Previous revision: athletic male anatomy and finer tracking

Deployment `6aaa57d3fe77d22f67611c42` was published to https://posetek.net on
September 16, 2026 at 1:52:03 AM PDT (08:52:03.048 UTC). The validated draft was
promoted unchanged. All 197 local output files match the published inventory,
including the 171 preserved application/public files. Release checks and rollback
are recorded in `deployment/ATHLETIC_MALE_VIEWER_PRODUCTION.json`.

The user selected an **athletic male
anatomical model** in neutral sage and confirmed that all three recorded hero
poses must retain their existing coordinates. References inform body shape and
presentation only; they do not replace recorded evidence.

This revision refines the licensed MHR surface through a reproducible athletic
male rest-shape profile, reduces the tracking line and joint sizes, and replaces
the thick limb-based loading illustration with static renders of the fitted
mesh. The body remains illustrative, not a likeness or calibrated scan.

Recorded 2D pose strokes return to a fine treatment: 1.5 px primary lines,
1 px detail lines and 1.5 px dots, with the heavy outlines and torso fill removed.
Measurement overlays, data, playback and the improved phone metrics layout
remain intact. The hero keeps the same controls, held-pose timing and camera
persistence. Modified keyboard shortcuts retain their native browser behavior;
the tablet controls and two-line keyboard hint have separate vertical space.

Higgsfield installation was authorized and its install prompt confirmed, but
connection completion is still pending. No Higgsfield output is used at this
stage. The design decisions and public photo references are recorded in
`deployment/VIEWER_DESIGN_REFERENCE.md`.

### Historical release: anatomical viewer and clearer recorded tracking

Deployment `6aaa4f0b04a11116d8495374` was published to https://posetek.net on
September 16, 2026 at 1:12:19 AM PDT (08:12:19.763 UTC). The validated draft was
promoted unchanged. All 194 local output files match the published inventory,
including the 171 preserved application/public files. Release checks and rollback
are recorded in `deployment/ANATOMICAL_VIEWER_PRODUCTION.json`.
The reference lock and decision ledger are in
[`deployment/VIEWER_DESIGN_REFERENCE.md`](deployment/VIEWER_DESIGN_REFERENCE.md).
The approved scrolling structure, PoseTek green/lime identity, concise copy and
preserved-application release guard remain in place.

The hero now fits Meta's Apache-2.0 **Momentum Human Rig (MHR)** template locally
to the existing recorded landmarks. Its neutral continuous anatomical surface
has **4,899 vertices and 9,794 triangles**, replacing the earlier segmented
illustrative body. This is template fitting, not SAM 3D image inference, the
athlete's likeness, or a calibrated body scan. Attribution, retained license,
input hashes and reproduction steps are documented in
[`latest-hero/MHR_PROVENANCE.md`](app/src/pages/home/latest-hero/MHR_PROVENANCE.md).

The framed viewer provides **Body + pose** and **Pose only** modes, Front/Side/
Reset camera presets, drag and keyboard orbit, and camera persistence across
offscreen suspension. A finite stage, soft ground shadows and restrained
lighting make the figure's depth and airborne placement easier to see. The
three existing held poses, coordinates, shooting ball and cycle timing remain
unchanged. Reduced motion, visibility suspension and static fallbacks remain
part of the viewer contract.

Recorded 2D movement uses contrasting limb outlines, distinct primary joints,
quieter hand/foot and facial details, and a faint torso plane from exact supplied
landmarks. Playback has a larger target and explicit keyboard focus. Source
coordinates, frames, projection, calibration, telemetry and playback behavior
are unchanged; see
[`movement/PROVENANCE.md`](app/src/pages/home/movement/PROVENANCE.md).
Higgsfield was discovered but is not connected; no Higgsfield output is used.

### Historical release: three-pose hero and coherent homepage copy

Deployment `6aaa45aa0d612bd628335ecf` was published to https://posetek.net on
September 16, 2026 at 12:34:12 AM PDT (07:34:12.757 UTC). The validated draft was
promoted unchanged. See `deployment/HERO_REVISION_PRODUCTION.json` for checks and
rollback. All 193 local output files match the published inventory, including
the 171 unchanged application/public files. The established scrolling layout
and green/lime visual system remain the design reference, with Refero motion
and copy guidance.

The hero now has one exploration action, **“See your game differently,”** with a
circular downward arrow and a tracking line that responds to hover and focus.
The large hero booking button was removed; booking remains in the header and
closing section. Header navigation follows the section order: Tests, Technique,
Athlete profile, Training, AI Coach.

The viewer cycles Shooting → Sprint → Vertical jump at six-second intervals,
with a 450 ms crossfade. Shooting retains the prior reconstruction; sprint and
jump use derived world landmarks from the authorized recordings, verified
against source frames 312 and 158 respectively. Each skeleton has a translucent
illustrative body, not a likeness or calibrated body scan. Only shooting includes
a ball. Public assets contain derived coordinates and technical provenance;
private source recordings, account identifiers and access URLs remain excluded.
See `app/src/pages/home/latest-hero/PROVENANCE.md` for reconstruction details.

Manual pose selection pauses the cycle. Pause/Resume controls automatic cycling
and rotation; dragging and keyboard orbit remain available. Reduced motion
disables automatic motion and crossfades. Hidden/offscreen scenes suspend work,
interrupted drags reset on teardown, and the static fallback supports all poses.

Supporting copy now consistently explains testing → review → profile → training
→ retesting. Technique distinguishes three phases from four coaching stops and
labels its saved measurements “Recorded kick.” Workout context follows the
selected focus, identifies each independent two-drill sample, and distinguishes
available time from actual sample duration. Fixed week/progress claims were
removed; skipped demonstrations no longer claim completed drills. Sample profile
and AI Coach measurements and answers are unchanged.

### Shared repository handoff

The user requested that all website changes be committed to
`https://github.com/dk242/posetek_website.git` and made available to collaborators.
This revision includes the published homepage implementation, recovered source
and data, baseline protection, tests, provenance, and release documentation.
The latest fetched teammate commit, `a5fd57d` (admission-code casing tests), was
fast-forwarded into local `main` without changing the website work.

The root `README.md` now documents fresh-clone installation, the one-time public
reference capture, local preview, checks, and the production build. The editable
homepage no longer depends on unshared source changes in this working directory.
Ignored build output and the public-reference capture are reproducible and are
not source deliverables. Historical production receipts retain their original
manual-release and uncommitted-source descriptions as records of publication.

The handoff review found that Netlify rewrites 25 legacy HTML files when serving
the pinned deployment. Their exact tracked originals are now recorded as
`localPath` entries in the baseline; all original hashes and sizes are retained.
Verification without the local baseline cache resolved all 171 preserved files
from those 25 tracked sources and 146 pinned downloads, with zero mismatches.

### Historical release: nine annotations implemented

Deployment `6aaa2d81f7a768e5e5799ae1` was published to https://posetek.net on
September 15, 2026 at 10:50:58 PM PDT (September 16, 05:50:58.892 UTC).
The validated draft was promoted unchanged. See
`deployment/ANNOTATION_UPDATE_PRODUCTION.json` for verification and rollback.
All 171 application/public files remain unchanged; all 193 local output files
match the published inventory, plus one Netlify-generated metadata file.

The release established Hero → journey bar → six tests with one shared replay →
guided technique → athlete profile → ready-made workout → AI Coach/retesting →
booking. Copy is concise. The hero says “players”; only the keypoints art label
was removed, preserving the separate tracked-joints metric.

The user confirmed `athelyticsOG/posetek-mobile-app` main as the mobile reference,
inspected at `98d8a051f0580785b70610f5c1a29a5246e08bfb` through git objects without
changing its dirty local checkout. Technique follows its forward-play, pause,
Continue and same-frame cue behavior. Recorded pose data and measurements remain
unchanged. Professional references are static saved phases; no follow-through
reference or improved athlete recording is fabricated. Five workout examples
adapt its catalog: DRB-006, DRB-009, PAS-001, SHT-003, SHT-004. Plans open ready
to Start or Customize and distinguish actual sample duration from available time.

The Refero reference lock uses the approved scrolling PoseTek visual system,
mobile walkthrough/catalog behavior, and bundled motion, copy and icon guidance.
All nine original annotation quotations remain in
`deployment/HOMEPAGE_ANNOTATIONS_2026-09-15.md`; original browser notes were preserved.
These decisions supersede earlier page order and apostrophe preferences below.

### Historical copy revision before the annotation release

The user requested shorter supporting text beside each bold section heading.
Seven section descriptions in `HomePage.tsx` were reduced to 105 words in total
instead of 168 (38% shorter), preserving the testing-to-training narrative. This
copy revision was subsequently included in the annotation release above. The
marketing build passed and the revised copy was verified in the local browser.
The user also referenced nine saved Codex browser annotations in the original
preview tab. They remain attached to the chat draft; automated submission did not
complete. All nine comments and their highlighted targets have now been read
directly from the original preview and transcribed in
`deployment/HOMEPAGE_ANNOTATIONS_2026-09-15.md`. They cover merging the tests and
movement sections, improving technique playback and workout examples, combining
AI Coach with retesting at the end, moving the journey bar, and small hero/icon
changes. Annotation 8 changes `player’s` to `players`, superseding the earlier
apostrophe preference below. The release above now implements these annotation edits.

This folder was initially empty. Its source is based on a clone of
`https://github.com/dk242/posetek_website.git`, branch `main`, at commit
`c5af2e9` (September 13, 2026, captured shooting hero and recording carousel).
The repository history and its existing documentation are included. The published
scrolling update and subsequent annotation changes are included in the shared
repository handoff described above.

**The live homepage was newer than the original checkout.** On September 15,
`https://posetek.net/` showed a “Your game. In focus.” section with Movement,
Technique, Workout, and AI Coach tabs. The original checkout had separate assessment,
analysis/profile, and training sections. Matching page titles alone do not prove
that the versions match. No fetched branch or inspected local copy contained the
newer tabbed section. The user confirmed that the latest work was edited on
another computer or in another project folder, then explicitly chose to use
the deployed site as the reference rather than wait for that source.

**The working homepage now implements the user's scrolling update.** The user
asked to combine the September 13 page's long scrolling structure and product
explanation with September 15's newer visuals and functional demonstrations.
Movement analysis, technique analysis, AI Coach, and workout planning each have
their own section. The user authorized production publication, and the exact
validated draft was promoted to https://posetek.net on September 15, 2026 at
7:25:58 PM PDT (September 16, 02:25:58.402 UTC), deployment
`6aa9fd38c6863f74b02380e9`. This was a manual Netlify release, not a GitHub push.

The five public homepage assets from September 13 matched the initial source build
byte for byte. September 15's newer demonstrations were recovered from its pinned
public output: exact recording data, measurements, sample answers, and workout
logic are now in the editable project with provenance documents. The hero uses
maintained Svelte source adapted to the latest reconstruction. No deployed entry
bundle or duplicate React runtime is imported. Original authored source from the
other computer remains unavailable; recovered JavaScript is not that original source.

For the approved direction and checks, read
`deployment/SCROLLING_HOMEPAGE_UPDATE.md`. Build with
`npm --prefix app run build:marketing`, then run
`node scripts/serve-homepage-preview.mjs` for the update at http://127.0.0.1:4174.
On a fresh clone, first run `node scripts/capture-deployed-reference.mjs` to
download the public reference needed by the preview servers.
Port 4173 remains the unchanged September 15 tabbed reference. See the
[production receipt](deployment/SCROLLING_HOMEPAGE_PRODUCTION.json) for publication
and verification details. Live HTTP and published-file checks passed.

## Historical September 15 reference and application baseline

- Previous production/reference deployment: `6aa9b6f0d8faf6177db8fd97`,
  “Compact interactive homepage preview.” It remains unchanged as the tabbed
  comparison reference. Its rollback and baseline roles below describe that
  historical release; use the current production receipt for recovery now.
- Published: September 15, 2026, 2:44:08 PM PDT (21:44:08 UTC).
- Pinned URL: https://6aa9b6f0d8faf6177db8fd97--posetek.netlify.app
- Netlify reports no linked commit and no source archive for this release.
- Previous deployment: `6aa73378185ce440bbf18168`, “Correct mobile admin tab padding,”
  published September 13, 2026, 4:36:28 PM PDT (23:36:28 UTC).
- Capture: `.netlify/deployed-reference/6aa9b6f0d8faf6177db8fd97/`.
- Inventory: `reference-manifest.json` in that directory; 88 captured public files,
  5,487,022 bytes, zero capture failures, all local SHA-256 hashes verified.
- Scope: homepage and application entries, booking page, and statically discoverable
  same-origin bundles/assets. This is compiled output, not recovered original TSX
  or a complete backup of external services, user data, or every legacy page.
- Local preview: `node scripts/serve-deployed-reference.mjs`, then
  http://127.0.0.1:4173. The capture is ignored by Git and is not a deployment folder.
- Recapture: `node scripts/capture-deployed-reference.mjs` pins this same immutable
  release. Change its pinned deployment deliberately if adopting a newer reference.
- Browser review confirmed the local “Your game. In focus.” section and all four
  rendered panels: Movement (six recordings), Technique (recorded kick measurements),
  Workout (sample intake), and AI Coach (sample profile/questions/answer).
  No form was submitted, account used, or data changed.

## Historical production reconciliation (September 15)

During initial preparation, the old production baseline stopped the build with:
`Production application changed; reconcile homepage-baseline.json with its latest deployment.`
That mismatch was resolved for the authorized scrolling release using the full
Netlify file inventory for `6aa9b6f0d8faf6177db8fd97`, not the partial 88-file
browser-reference capture. `deployment/homepage-baseline.json` then specified
`applicationPath: "/application.html"` and 171 preserved application/public files.
All 171 retained files matched their pinned SHA-1 hashes and sizes. The application
entry and existing navigation bridge remain at their original paths without
reinjection or rewriting; only the marketing entry and marketing assets were replaced.

Netlify CLI-generated `/netlify.toml` metadata is tracked separately in the manifest
and excluded from served-asset preservation because the CLI regenerates it.
Its five effective header rules and one `/application.html` fallback redirect
were retained. The production guard now compares the live application entry
directly with the pinned modern baseline; it has not been bypassed. Legacy baseline
support remains tested. Preserve this guard and reconcile any future app drift.

Older copies remain untouched:

- `G:\My Drive\PoseTek Auto Editor\posetek_website`: older static homepage with
  existing uncommitted `index.html` changes. These were not copied over main.
- `C:\Users\dylan\OneDrive\Documents\GitHub\posetek_website`: another older checkout.
- A mobile reference exists at
  `C:\Users\dylan\OneDrive\Documents\GitHub\posetek-mobile-app`. Its currentness and
  parity have not been verified in this review. It is reference-only.

## Product and brand context

PoseTek connects soccer performance testing, movement analysis, an athlete
profile, focused training, and retesting for coaches, clubs, and players.
The documented homepage direction is **Draft B — Test to Next Step**:
six tests → review movement → compare with benchmarks → train → retest.
The private pitch video underlying that direction is not a public website asset.

The six tests are Sprint, Straight Vertical Jump, Standing Broad Jump,
Dribbling Shuttle, Change of Direction, and Side-View Shooting. Athlete profiles
organize results into Speed, Shooting, Power, Control, and Agility.

The established visual identity uses dark green, lime accents, condensed
athletic headings, Inter body copy, and IBM Plex Mono for technical labels.
The hero invites visitors to explore the system; booking remains available in
the header and closing section, and sign-in serves returning users. Use concise,
evidence-based copy. Sample athlete scores and training plans
must stay labeled as samples; do not turn them into customer outcome claims.
Experimental `hypothesis_*` page pricing and older offers are not verified current
commercial terms.

## Where homepage changes belong

| File or directory | Purpose |
| --- | --- |
| `index.html` | Public entry, SEO/social metadata, fonts, favicon, noscript fallback |
| `app/src/home-entry.tsx` | Isolated React homepage entry |
| `app/src/pages/home/HomePage.tsx` | Homepage copy, sections, navigation, booking/sign-in links |
| `app/src/pages/home/home.scss`, `magic.css` | Homepage styling, scoped to `.pt-home` |
| `app/src/pages/home/scrolling-home.scss`, `LazyHomepageDemo.tsx` | Scrolling layout and independent, persistent, visibility-aware lazy demos |
| `app/src/pages/home/TestCards.tsx`, `AthleteProfile.tsx` | Assessment cards and sample profile |
| `app/src/pages/home/movement/` | Recovered current movement controller, six exact recordings, telemetry, tests, and provenance |
| `app/src/pages/home/technique/` | Recovered current technique panel, 71 frames, phase measurements, references, and tests |
| `app/src/pages/home/product/` | Recovered current workout/coach UI, typed reducer/sample data, tests, and recovery tooling |
| `app/src/pages/home/PitchVisual.tsx`, `latest-hero/` | Shooting/sprint/jump hero, derived landmarks, illustrative bodies, cycle/orbit controls, Svelte/Threlte/Three renderer and static fallbacks |
| `app/src/pages/home/LazyPoseDemo.tsx`, `PoseDemo.tsx`, `use-pose-demo.ts`, `pitch/` | Earlier implementation reference; not the main page's active demo/hero imports |
| `app/src/pages/home/pose-*.json`, `landing-pose-demo-data.json` | Earlier recording data used by existing cards/tests; newer playback data lives in `movement/` |
| `app/src/App.tsx` | Application routes and legacy aliases |
| `app/vite.marketing.config.ts` | Isolated marketing build |
| `scripts/build-production.mjs` | Production verification and homepage/application assembly |
| `deployment/homepage-baseline.json` | Pinned application file hashes and deployment source |
| `scripts/serve-homepage-preview.mjs` | Local updated marketing preview over the captured current public app; not a deploy command |

This is now a React/TypeScript/Vite project with Svelte islands and legacy HTML
pages, not a single self-contained `index.html`. Future references to editing
“index.html” will usually mean the public homepage and its components.

## Preserve during future changes

- Keep existing clean routes and `.html` aliases, including booking, `/signin`,
  `/privacy`, and athlete deep links. Preserve `share`, `player`, `returnTo`,
  `view`, and `drill` query meanings.
- Retain keyboard controls, focus behavior, reduced-motion support, rendering
  suspension when hidden/offscreen, and the hero's render-failure fallback.
- Keep recorded measurements, units, frames, and checksum provenance intact.
  The hero retains the September 15 shooting reconstruction and adds source-derived
  sprint/jump world landmarks with estimated depth and illustrative bodies, not
  calibrated body scans. Earlier frame-464 source notes describe the prior hero;
  `latest-hero/PROVENANCE.md` and its data supersede them here.
- Preserve sample labels and the distinction between recorded data and illustrative
  content. Keep private video, account identifiers, and download URLs out of
  public bundles.
- Latest checked-in pose notes supersede earlier details: vertical-jump peak is
  0.554633 m / 21.8 in; dribbling ball trails break at occlusions; the recording
  carousel wraps Shooting to Sprint and previous/next retain pause state.
- The `player’s` apostrophe in the hero introduction is documented as an explicit
  earlier user request. Do not silently treat it as an accidental typo.
- Mobile remains the source of truth for shared player behavior and data
  contracts. Capture, calibration, processing, and new body scans remain mobile.
  Missing metrics remain unavailable, and player document IDs are not auth UIDs.
- Gateway-owned plans, proposals, AI history, analyses, and memory are not
  directly edited by public homepage work. Existing Firebase and athlete-share
  access contracts must remain compatible.

## Build and verification

Node 22.18.0 and npm 10.9.3 were available during review. Frontend dependencies
were installed from `app/package-lock.json` with
`npm --prefix app ci --ignore-scripts --no-audit --no-fund`.

Relevant local checks (run from the repository root):

```powershell
npm --prefix app test -- src/pages/home
node --test scripts/home-navigation.test.mjs scripts/production-baseline.test.mjs
npm --prefix app run check:svelte
node app/node_modules/typescript/bin/tsc -b app
npm --prefix app run build:marketing
```

The production command is `node scripts/build-production.mjs`. In the current
release architecture it verifies the live app against the September 17 baseline,
preserves 462 application/public files, serves the preserved application through `/application.html`, and
adds the isolated homepage at `/` and `/index.html` with assets under
`/marketing/assets/`. Output is `production-dist`. The ordinary application build
outputs `dist` and is a different path; editing app source alone does not replace
the preserved application in a homepage release.

Do not publish the repository root as if it were the old static site. For the
historical September 15 scrolling release, the verified
`production-dist` artifact was uploaded as a draft, reviewed, then promoted without
rebuilding to deployment `6aa9fd38c6863f74b02380e9`. No backend or authenticated data
change was made. Source was uncommitted at that manual release; it is now included
in the repository handoff together with the later annotation update.

Historical September 15 scrolling-release verification (build, hosted draft, and production):

- Production assembly passed with all 171 preserved files verified.
- Five baseline integration tests and six navigation tests passed; the baseline
  tests cover modern/legacy preservation, drift rejection, corruption rejection,
  and marketing overlap rejection.
- Hosted draft HTTP checks passed for two homepage routes, all 171 preserved
  files, 22 application routes, and 74 application assets.
- Hosted draft browser checks covered the AI Coach's 20-minute workout handoff,
  workout start, and pause, with no browser errors.
- Live HTTP checks passed for the same two homepage routes, 171 preserved files,
  22 application routes, and 74 application assets.
- Live browser smoke checks confirmed movement recording switching, technique
  phase selection, the sign-in screen, and the booking calendar. No form or
  account action was performed.
- The published Netlify inventory contains 195 files. All 194 `production-dist`
  files matched their published SHA-1 hashes and sizes; the additional file is
  platform-generated `netlify.toml`. All 171 preserved application/public files
  remained unchanged.
- The earlier homepage validation remains documented in
  `deployment/SCROLLING_HOMEPAGE_UPDATE.md`; the broader interactive acceptance
  pass was on the hosted draft, followed by the listed live smoke checks.

Initial preparation verification (before the scrolling update):

- Static review: all 48 homepage relative imports resolve; 12 homepage IDs are
  unique; fragment destinations, booking/logo files, sign-in/privacy routes, and
  all six recording/card/thumbnail keys match.
- Homepage tests: 56 passed. Home-navigation tests: 6 passed.
- Svelte: zero errors and zero warnings. TypeScript build passed. Standalone
  marketing build passed and produced `marketing-dist/index.html`; Vite reports
  a large lazy-loaded 3D chunk, which is an existing build warning.
- Production build initially stopped by the baseline mismatch described above;
  the later authorized release resolved it through the modern manifest.
- Initial sandboxed checks encountered subprocess `EPERM`; the local checks were
  rerun with the necessary process access. This was an execution-environment issue.
- Local browser review of the captured deployment confirmed all four current
  showcase panels render. This is not a full responsive, accessibility, backend,
  or authenticated application acceptance test.

## Context documents and precedence

1. `deployment/PROVISIONAL_DRIBBLING_PRODUCTION.json` and
   `docs/PROVISIONAL_DRIBBLING_RECOVERY.md`: current application/backend release,
   conditional-estimate contract, validation, privacy and recovery.
   `deployment/TESTING_AUDIT_PRODUCTION.json` and
   `docs/TESTING_AUDIT_BUILD_HANDOFF.md` record the preceding testing remediation.
   `deployment/VACAVILLE_WEBSITE_PRODUCTION.json` and `docs/VACAVILLE_WEBSITE_UPDATE.md`
   retain the earlier application build and hierarchy/planning handoff.
   `deployment/COACHES_PAGE_PRODUCTION.json` records the preserved marketing release.
   `deployment/ATHLETIC_MALE_VIEWER_PRODUCTION.json` is a historical viewer receipt;
   `deployment/VIEWER_DESIGN_REFERENCE.md` records the viewer design decisions.
   `deployment/ANNOTATION_UPDATE_PRODUCTION.json` is the historical annotation
   release; `deployment/HOMEPAGE_ANNOTATIONS_2026-09-15.md` records all nine requests.
2. `deployment/SCROLLING_HOMEPAGE_UPDATE.md` and
   `deployment/SCROLLING_HOMEPAGE_PRODUCTION.json`: earlier scrolling direction,
   recovery boundaries, behavior adaptations, reconciliation, and release receipt.
3. `deployment/INTERACTIVE_HOMEPAGE_RELEASE.md`: previous checked-in homepage
   behavior; cumulative notes, with newest sections superseding earlier ones.
4. `deployment/HOMEPAGE_RELEASE.md`: Draft B direction, public entry isolation,
   asset preservation, and recorded release checks.
5. `docs/PLAYER_EXPERIENCE.md`: current player surfaces, ownership, mobile parity,
   and acceptance requirements.
6. `app/PORTING.md`: routing, scoped CSS, shared Firebase/identity conventions.
7. `ATHLETE_RESULTS_LINKS.md`, `functions/CLUB_CONTRACT.md`: share and organization
   contracts when a requested change actually touches those features.
8. `docs/planner/`, `app/PLANNER_PERSONALIZATION_PLAN.md`, and `deployments/`:
   feature plans and historical integration/validation receipts.
9. `docs/FEED_SOURCE_HANDOFF.md`, `app/src/pages/feed/PROVENANCE.md`, and
   `functions/SOCIAL_RECOVERY.md`: recovered feed stack, setup, contracts and
   source provenance. This source handoff is not a production release.

Earlier September 9 integration notes describe a unified build with no homepage
bridge; the later homepage release notes and current build script supersede
those build instructions. Old static-site agent descriptions, `images/README.md`,
and parts of `STATIC_JUMP_UPDATES.md` are historical. Previous release test claims
are historical evidence, not a substitute for checking the next changed version.

## Website, UI, and 3D capabilities on this computer

| Skill or tool | Availability and role |
| --- | --- |
| Refero Design | Installed personal skill; primary UI/design methodology, typography, color, responsive layout, accessibility, motion, and copy |
| Figma | Available plugin skills/tools for design files, components, design systems, and code translation |
| ImageGen | Available raster-image generation/editing; not a 3D mesh generator |
| Computer Use | Available browser inspection and interaction testing |
| Netlify | Available configuration, preview, and deployment capabilities |
| Sites | Available complete-site building/hosting workflow; this project currently uses its own React/Netlify setup |
| Visualize | Available inline interactive explanatory tools and diagrams |
| Magic UI | Components are already in this repository; older notes mention a standalone skill that is not installed on this computer |
| Threlte / Three.js | Dependencies already in this project for interactive 3D rendering; no standalone Threlte skill currently installed |
| Meshy | User asked to include it in the 3D tool review; no Meshy skill or direct tool is currently available here |
| Meta SAM 3D | Official browser playground/model repositories exist; no direct local skill/model runtime installed here |

Meta SAM 3D Objects reconstructs textured objects from images; SAM 3D Body focuses
on human mesh/pose reconstruction. See the official
[Objects repository](https://github.com/facebookresearch/sam-3d-objects),
[Body repository](https://github.com/facebookresearch/sam-3d-body), and
[playground](https://www.aidemos.meta.com/segment-anything/editor/convert-image-to-3d).
No new 3D tooling was installed during this review. The user mentioned Meshy,
Threlte, and Meta tools; this was an inventory request, not an installation request.

## Next step

Continue the user's next prompts from the published scrolling implementation and
annotation updates in this repository. Commit website changes here and keep the
shared repository updated for collaborators. Keep the September 15 capture as the unchanged
comparison reference. If newer original source becomes available, reconcile it
with the recovered modules instead of replacing the user's accepted changes.
For any further release, verify the current application against the reconciled
baseline, rebuild, preview, and validate the intended changes before publishing.
