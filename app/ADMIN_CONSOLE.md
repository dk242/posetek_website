# Admin web console — plan and review notes

Agent 05 of the Vacaville week-2 wave (`PoseTek-mobile-app/Agentic Work/05-admin-web-console.md`).
Brief §4 plus the website half of admin sign-in.

**Contracts this code is written against** (in `PoseTek-mobile-app/docs/`, index at
`Agentic Work/CONTRACTS_INDEX.md`): `ADMIN_IDENTITY_CONTRACT.md`, `DRILL_CATALOG_V2_CONTRACT.md`,
`TRAINING_PROGRAM_V3_CONTRACT.md`, `PLAYER_PROFILE_INPUTS_CONTRACT.md`, `LLM_GATEWAY_CONTRACT.md`
§2/§4/§5, and the reviewable rule fragments in `docs/rules/`. A field name here cannot change on
one side alone — see the report at `Agentic Work/reports/05-report.md`.

`app/PORTING.md` still governs style: page folders own their files, `src/lib/` is shared, CSS is
scoped under a `.pt-<page>` root class, pure logic lives in exported functions with vitest tests,
`tsc -b` must be clean.

---

## 1. Plan

### 1.1 Shared contract module — `src/lib/contracts/`

New, imported by the admin console **and** the athlete portal and coach dashboard so neither
breaks on a `schemaVersion: 3` plan.

1. `types.ts` — the v2 domain vocabulary (ten values, contract sort order) and labels, the
   position enum, the drill/plan/workout/block/adjustment TypeScript shapes, `planSchemaVersion()`
   and `isV3Plan()`.
2. `expectedMinutes.ts` — the shared expected-time formula (catalog contract §9), integer
   arithmetic in deciseconds, plus §11's input-validity guards (duration/distance units reject
   `restScope: "reps"`; `blockDeciseconds > 54000` is rejected before the 90-minute clamp is
   used). **No other minute arithmetic is allowed anywhere in this app.**
3. `__fixtures__/expected_minutes_fixture.json` — copied byte-for-byte from
   `docs/fixtures/expected_minutes_fixture.json` (27 block rows, 3 workout rows).
4. `drillV2.ts` — reads a `drillCatalog` document of either schema into one view model. v2
   documents are used as-is; v1 documents are normalized read-only (domain via §2's mapping,
   `difficultyLevel` via §3's derivation, `howTo`/`coachComments` via §4.1) and flagged
   `needsMigration` — the web console never writes a v1 document (agent 02 owns the migration).
   Also the deterministic `doseText`/`restText` formatter (catalog §1.2).
5. `planV3.ts` — the "next workout" rule (§7), week/workout lookup, log folding
   (`logId = "{planId}_{workoutId}"`), derived week `targets`, `actualMinutesByDomain` and
   `transitionMinutes`.

### 1.2 Admin sign-in and the guard

6. `src/pages/admin/lib/identity.ts` — `isAdminEmail()` / `isAdmin()` exactly as the identity
   contract §1.2 spells them, `refreshAdminClaims()` (`reload()` then
   `getIdTokenResult(true)` — a browser verification is invisible to a cached token),
   `upsertAdminProfile()` writing `admins/{uid}` (§2.1), and the 10-minute-per-device
   verification-email throttle (§1.3).
7. `LandingPage.handleLogin` gains the admin branch **first**, immediately after
   `signInWithEmailAndPassword` and before the `coaches`/`players` queries. Verified → `/admin`.
   Unverified `@posetek.net` → send verification (throttled), show the "verify then sign in
   again" message, `auth.signOut()`, and **never** fall through to the coach/player cascade.
   Coach and athlete sign-ins are untouched below that branch.
8. `src/pages/admin/AdminPage.tsx` — one route element mounted at `/admin/*` with its own nested
   `<Routes>`. It resolves the admin session on `onAuthStateChanged` and renders
   `checking | signed-out | not-admin | unverified | ready`. The guard is UI routing only; the
   Firestore/Storage rules are the boundary.

### 1.3 Admin home and Drill library

9. `views/AdminHome.tsx` — the two options, Drill library and Monitor accounts, mirroring the
   mobile tabs.
10. `views/DrillLibrary.tsx` — every catalog document, search by name, sort/filter by domain in
    the contract's table order, status filter, a pinned **Create new drill**. Client-side over
    one `drillCatalog` read (117 drills; a virtualized list is not warranted at this size).
11. `views/DrillDetail.tsx` — every v2 field, and playback of each media slot resolved through
    `storage.ref(storagePath).getDownloadURL()` at render time (never persisted — the URL
    expires); a slot with a `status` other than absent/`approved` shows as unavailable; text
    stays visible while media loads.
12. `views/DrillForm.tsx` — create and edit against the v2 vocabularies. Create allocates the id
    in the §8 transaction (`drillCatalogMeta/idCounters`, verify non-existence, increment) and
    bumps `drillCatalogMeta/current.catalogVersion`'s patch component in the **same**
    transaction (§7); edit does the same bump. Media upload is a file picker to
    `drillCatalogMedia/app/{DRILL_ID}/{slot}.{ext}` with the §6.2 document update and a
    `mediaPublishedAt` bump (no version bump for a media-only change).

### 1.4 Monitor accounts

13. `views/MonitorAccounts.tsx` — organizations → their coaches, independent coaches, and a
    player search across the roster (capped read, filtered client-side).
14. `views/CoachDetail.tsx` — the coach's roster, and the team **Maximum drill difficulty**
    (`coaches/{id}.maxDrillDifficulty`, optional 1–5, PROFILE_INPUTS §7).
15. `views/PlayerDetail.tsx` — profile inputs (position, birth date/age, player
    `maxDrillDifficulty` override with the resolved effective value shown), the private coach
    note at `players/{id}/privateProfile/coachFeedback`, plan status, **every workout listed
    vertically** across weeks with dose, expected time and done/next/upcoming status from
    `workoutLogs`, and a **Generate plan** action that submits the v3
    `generate_training_plan` job and watches it to a terminal status.

### 1.5 The workout editor and the ground-truth record

16. `lib/editor.ts` (pure) — the working draft: add block (click-add and drag), remove, reorder,
    set dose within the catalog's ranges, set intent/title/budget, `nextBlockSequence` allocation
    that never reuses a retired `blockId`, live per-block and workout minutes through the shared
    formula, the validation split, and the `before`/`after` diff.
    - **Hard, never overridable:** `maxFrequencyPerWeek` (contract §13 — no admin override),
      dose outside the catalog's ranges, formula-input validity and the 90-real-minute ceiling,
      block ordering/uniqueness, 1–12 blocks, a drill missing from the catalog, adding a drill
      that is not `published`, and a document over 900 KiB.
    - **Overridable warnings, recorded in `warningsOverridden`:** age eligibility, difficulty
      above the resolved `maxDrillDifficulty`, `requiresPartner` against `intake.setting`,
      equipment outside the intake list, budget over/under, and an existing block whose drill has
      since left `published`.
17. `views/WorkoutEditor.tsx` — left pane `AdminDrillPicker` (search, sort/filter by domain,
    difficulty and age-eligibility indicators for *this* player), right pane the workout's
    blocks. HTML5 drag-and-drop **plus** a click-add button on every row and keyboard move
    up/down on every block, so the editor is usable without a pointer.
18. `lib/plans.ts` — the save. One `db.runTransaction`:
    - re-read the plan, locate the workout by immutable `workoutId`, **abort if
      `workout.revision !== baseRevision`** (the caller reloads and re-applies);
    - build the new `weeks` from *that fresh snapshot*, splicing only the edited workout, so a
      sibling workout edited meanwhile is not reverted (01A F08);
    - re-read `players/{id}` and the assigned coach and re-resolve `maxDrillDifficulty`; re-read
      every referenced `drillCatalog` document and revalidate status/dose/age/difficulty/partner
      and time against current state;
    - recompute the week's `targets`, `actualMinutesByDomain` and `transitionMinutes`;
    - set the workout's `revision + 1`, `editedBy: "admin"`, `editorUid`, `editedAt`,
      `previousRevision` (one level, including `title`, `order`, `nextBlockSequence` and
      `check`), and `check: null`;
    - increment `players/{id}/workoutSchedule/current.revision` by exactly 1 in the same
      transaction (the rule requires it, and it is the shared frequency counter);
    - write the plan (`weeks`, `planRevision + 1`, `lastEdit`, `updatedAt`) **and** create
      `players/{id}/planAdjustments/{planId}_r{newPlanRevision}` in the same transaction, which
      is what the coupled `getAfter` rules demand.
19. `views/RationaleDialog.tsx` — **Save** asks "why did you make the adjustments that you
    made?" first. Nothing is written when the answer is empty (3–2000 characters, the rule's own
    bounds). The dialog also shows the athlete-visible effect ("this changes the next workout for
    <player>") and, when the target workout has an open log, that the athlete's in-progress
    session keeps its frozen snapshot and the edit applies from their next start.

### 1.6 Reconciling the existing write paths

20. `coach-dashboard/lib/planEdit.ts` + `data.ts` + `views/AthleteDetail.tsx`: the legacy
    whole-week writer (`withEditedWeek` → `savePlanWeeks`) **must never touch a v3 document**
    (01A F19, program §13). `savePlanWeeks` refuses a v3 plan at the write, `AthleteDetail`
    renders a v3 plan read-only with a pointer to the admin console, and `isRetestWeek` is
    scoped to legacy plans (v3 has no retest week). There is **one** editor and **one** admin
    write path to `trainingPlans`; the coach dashboard keeps its v1/v2 editor unchanged.
21. `athlete-portal/views/TrainingView.tsx` branches on `schemaVersion` and renders a v3 plan
    through a new read-only `TrainingViewV3` (weekly blocks, the week's goal, the next workout
    with its blocks and doses, this week's drills, the week's targets). The v1 hub, the
    `build_workout` "create workout" flow and the workout player are untouched and never run
    against a v3 plan.

### 1.7 Tests

22. vitest: the formula against the shared fixture (25 legal rows asserted, the two named
    invalid-input rows asserted as **refusals** per catalog §11, all 3 workout rows), the diff,
    the next-workout rule, the editor's dose bounds and validation split, the v1→v2 catalog
    normalizer, `isAdminEmail`, and the adjustment-record builder.

---

## 2. Risks

- **Rules are the boundary, not the nav.** Every admin write must be denied for a non-admin.
  The rules are *not deployed* — the live project is still wide open — so the console "works"
  for everyone until the lockdown ruleset lands. Verification belongs on the emulator; see the
  report.
- **`players/{id}/workoutSchedule/current` is client-uncreatable** (`allow create: if false`).
  The gateway creates it on first v3 generation. Until agent 03 does, the save transaction
  cannot satisfy the coupled rule, and the editor says so instead of failing obscurely.
- **`serverTimestamp()` cannot be used inside an array.** Every timestamp written inside
  `weeks[]` (workout `editedAt`, `previousRevision.editedAt`) is a client `Timestamp.now()`;
  the authoritative `updatedAt` and `createdAt` at document level stay server-stamped, which is
  what the rules compare against `request.time`.
- **Two writers, one document.** The concurrency rule is enforced by the per-workout `revision`
  compare-and-set inside the transaction, not by rules — rules cannot address an array element.
- **v1 catalog documents.** The library reads them; it refuses to write them. If agent 02's
  migration has not run, editing is unavailable per drill and the UI says why.
- **The original generation context** (`players/{id}/trainingPlanContexts/{planId}`) is
  gateway-written and does not exist yet. `generatorIntent` is recorded as `null` with an
  explicit `generatorIntentSource: "unavailable"` rather than being back-filled from the current
  intent (which after one edit would be the *editor's* intent, 01A F14). "Reset to original" is
  offered only when the context is readable.

## 3. Open questions (defaults taken — see the report)

1. **Where coach feedback is typed** — default **both**, per PROFILE_INPUTS §3. Implemented here
   on the Monitor accounts player page (`authorRole: "admin"`).
2. **Do coaches get the editor** — default **no**: admin-only web plan editing, per the index's
   documented default. The coach dashboard keeps its legacy v1/v2 week editor and becomes
   read-only for v3 plans.
3. **Editing a workout the athlete has started today** — default **replace for the next start**:
   program §6/§13 already freezes the executable snapshot in the open log, so an edit never
   changes what the athlete is doing right now. The editor warns when a log is open.
4. **Web upload vs phone capture** — default **both**: catalog §6.2 says the app films and the
   web uploads files to the same path and the same document shape. The web console uses a file
   picker.

## 4. Review notes

See §5 of `PoseTek-mobile-app/Agentic Work/reports/05-report.md` for what was verified and what
is still unverified (rules on an emulator, live data, cross-client parity with 02/03/04).

---

## 5. Rep tools (2026-09-08)

Admin "debug" tools for reps that did not process correctly the first time — fix the event
frames, annotate the athlete's center of mass and the ball, see the re-processed rep, and push it
over the original. Built under Monitor accounts.

### Navigation

- `views/MonitorAccounts.tsx` now lists **every organization first**: a club (`schemaVersion: 2`)
  shows its `teams`, each team expands to its athletes (`lib/accounts.ts` `loadTeams` /
  `loadTeamPlayers` — the player's `teamId` plus the team's `playerIds` projection), and every
  athlete row carries a direct **Results** link. Coaches and independent coaches follow as before.
- `views/PlayerDetail.tsx` gained a **Recorded results** card (one tile per drill with its rep
  count) and a header link to the results page.
- `views/AdminResults.tsx` — `/admin/accounts/player/:playerId/results/:drillKey`. The athlete
  portal's own `DrillDashboard` (chart, summary, sessions → reps) with every rep opening the rep
  tools instead of the read-only viewer. Reads through `lib/results.ts`, byte-identical to the
  portal's loader.
- `views/RepTools.tsx` — `/admin/accounts/player/:playerId/results/:drillKey/:repId`.

### The rep tools page

1. **Scrub** the saved `.mov` frame by frame (transport buttons, slider, ← → keys, shift for a
   bigger step, space plays). The frame counter is `floor(currentTime × fps)`; seeks land on
   `(frame + 0.5) / fps`. fps is `metadata.json → framesPerSecond` (what the phone measured),
   else the `reprocess_context.json` capture block, else pose frames over duration.
2. **Event frames** — for change of direction / dribbling: start, turn start (`phase1EndFrame`),
   turn apex (`apexFrame`), turn end (`phase2EndFrame`), end. "Use current" stamps the frame
   being viewed. Other drills expose their own frame fields (sprint start/finish, jump takeoff /
   peak / landing, broad jump takeoff/landing, shooting contact/transition).
3. **Annotate** — pick a stride (default 3: mark every third frame, the two skipped frames are
   interpolated linearly) and a range (start → end frames, or the whole clip). Click the
   athlete's center of mass; the tool records the point in normalized video coordinates and
   jumps to the next frame in the queue until the range is done. Same for the ball center.
   Undo (backspace) steps back one mark; Skip leaves a gap; Continue resumes a stopped pass.
   The hip midpoint from `pose.json` and the phone's `ball_boxes.json` are offered as
   alternative tracks so distances can be re-derived without annotating.
4. **Re-processed rep** — `lib/repTools.ts` re-derives the shuttle drills exactly as
   `KickAI/DrillProcessing/CodProcessingMath.swift` does: every time is frames over fps; phase
   times need `start ≤ turn start ≤ turn end ≤ end`; percentages are shares of the phase sum;
   distances convert the track through the gate (`arucoGate` in metadata.json, else the session's
   `aruco_corners.json` when `calibrationGeometryTrusted` is not false, else the tapped
   `{drill}_marker.json` points) with `x = 0` at the start marker; outbound = apex − start,
   return = apex − end; dribbling's `avgBallDistance` = mean |ball.x − com.x| over the window.
   The "Find apex / Find end / Find turn phases (90%)" buttons apply the phone's own event
   detectors to the annotated track. Non-shuttle drills are not re-derived on the web — their
   values are typed directly. The before/after table highlights what changes.
5. **Push** — a confirmation dialog, then the `adminReviseRep` callable overwrites the rep
   **in place**: same `repId`, `sessionNumber`, `repNumber`, `absoluteRepNumber`, `sessionId`,
   `storagePath` and `createdAt`; `repCount` is never touched. It writes the allow-listed fields
   to `players/{id}/reps/{repId}`, merges the same values into the rep folder's `metadata.json`
   (the phone's session viewer reads its numbers from there), clears `failedSteps` /
   `processingStatus` when the rep now has a total time, and writes `admin_annotations.json`
   (marks, gate, fps, frames, sources). A provenance block `adminRevision` lands on both.
6. **Revisions** — every push first snapshots the previous document to
   `players/{id}/reps/{repId}/revisions/{revisionId}` and the previous `metadata.json` to
   `{repFolder}/admin_revisions/{revisionId}/`. **Restore** (`adminRestoreRepRevision`) puts both
   back; a revision restores once.

### Recorded-rep foot labels

The **Values** card exposes **Dribbling foot** (`dribble_foot`) and **Shooting foot**
(`strike_foot`), each with Left foot, Right foot, and Unassigned. Unassigned writes an
explicit `null`. The rep document seeds the selector, including an explicit clear;
metadata is a fallback only when the document has no field. The chosen foot appears
in the before/after table and goes through the existing revision callable to both
the rep and `metadata.json`. Starting side remains a separate gate-position setting.

A foot-only edit preserves the stored measurements, processing flags, and annotation
file, including older reps whose available artifacts cannot reproduce their timing.
Measurement edits preserve a foot that was not changed. The shuttle preview also
preserves distances when no new athlete or ball track is supplied.

`getTeamLeaderboard` includes `dribble_foot` and numeric `markerDistance` in its
existing metric projection, alongside `strike_foot`, so the mobile athlete leaderboard
can compare both feet and match dribbling against change of direction course lengths.

### Kicks (deadball shot)

- **Range.** The ball pass defaults to `contact − 10 → contact + 60` (the resting ball, then the
  phone's own fit window) rather than the whole clip; the range is editable (from/to with
  "Use current") and a pass can be stopped and continued. The shuttle drills default to
  start → end; everything else to the whole clip.
- **Velocity and launch angle are fitted from the ball marks**, never typed once a track exists:
  `deriveKickMetrics` mirrors `KickProcessingMath.trackBallTrajectory` — a least-squares line
  through the ball center over the frames after contact (window 60, adjustable), the slope ×
  fps as normalized speed, speed in m/s = normalized speed × frame width × `m_per_px`
  (metadata's value, else recomputed from its `arucoMarkers` corners with the 5.875 in marker),
  and the phone's 44.704 m/s validity limit (over it, both values are nulled as the phone does).
  Without a marker scale the angle is still derived and the original velocity kept.
  "Find contact" sets the contact frame to the last frame the ball is at rest.
- **One deliberate difference from the phone:** it computes `atan2(−vy, vx)` and stores the
  absolute value, so a ball travelling right to left comes out as 180° minus the real angle
  (a phone bug to look at). The web measures the angle against the direction of travel and
  writes `direction` from the fit's sign; the preview says so when it applies.
- **The push also rewrites `ball_information.json` and `ball_trajectory.json`** (the phone's
  deadball viewer reads them) through the callable's per-drill artifact allow-list, backed up
  and restored with the rest of the revision.

### Why a callable

The live Firestore ruleset (`e84fb428…`) and Storage ruleset (`9f5bcd27…`) deny every client,
admins included, any write to `players/{id}/reps` and to athlete recording prefixes — that is
`docs/rules/admin.rules` ("no admin write to reps") as deployed. Rather than widen the rules, the
write runs in `functions/rep-revisions.js` with the Admin SDK, gated on the same verified
`@posetek.net` predicate the rules use (`club-access.js` `isClubAdmin`). Field names and value
shapes are allow-listed per drill (`FIELD_RULES`); anything else is refused before a byte is
written, and an artifact-write failure rolls the document back. Every file the callable writes
keeps the Firebase download token the phone's upload minted (or mints one): the web SDK's
`getDownloadURL()` refuses an object without one, and Admin SDK writes carry none by default.

### Verification

- `npm --prefix app test` — 503 passing, including `src/pages/admin/lib/repTools.test.ts`
  (gate resolution, meters sign convention, interpolation, the apex / end / 90% detectors, the
  all-or-nothing timing rule, dribbling ball distance, the payload, and both foot selectors'
  initialization, replacement, clear, and measurement preservation).
- `node --test functions/*.test.js` — 64 passing, including `functions/rep-revisions.test.js`
  (admin gate, in-place overwrite with identity fields kept, allow-list refusals, storage-path
  escape refused, rollback when the artifact write fails, restore once, foot field validation
  and persistence to both rep and metadata) and `functions/team-leaderboard.test.js` (foot/course projection).
- `npm --prefix app run build` — clean.
- **Pending release**: deploy the latest `adminReviseRep` and `getTeamLeaderboard` to
  `kickai-69dd0/us-central1` before releasing the website foot selectors and mobile comparisons.
  Preserve the existing deferred deployment queue for the earlier `adminRestoreRepRevision`
  and download-token fixes; this change did not deploy or push anything.
- **Browser validation pending**: the Browser runtime failed during initialization with
  `Importing module "node:process" is not allowed in node_repl`; its troubleshooting API
  was unavailable before setup. A real admin rep save/reload/clear/restore pass remains
  unrun, preferably on Safari for a saved HEVC `.mov` rep.
