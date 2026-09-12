# Player experience

The player route is a mobile-first React surface with Profile, AI Coach, Drills,
Training and Leaderboards. `AthletePortalPage` selects it only for resolved
`athlete` access and the explicit sample preview. Coach, organization, admin and
shared-results access continue through their existing surfaces. Identity remains
in `lib/identity.ts` and the portal loader: a player document ID is not assumed to
be an authentication UID.

## Responsibilities

| Area | Implementation | Shared behavior |
| --- | --- | --- |
| Player navigation | `player/PlayerExperience.tsx` | Five tabs, browser history, old profile/results deep links; chats and an opened Training tab retain state across tab changes |
| Profile | `PlayerProfile.tsx`, `scoring.ts` | Club, physical measurements/body scan, five-axis rating, metric availability, matched-course and weak-foot comparisons, session activity |
| Technique | `TechniqueAnalysis.tsx` | Single-kick analysis jobs, saved reports, published feedback tied to the current source job, saved valid left/right comparisons |
| Drills | Existing `DrillDashboard` and `SessionView` | Cloud metric results, progress, pose/replay artifacts and optional saved videos; no capture or processing |
| Training program | `PlayerTraining.tsx`, `ProgramIntake.tsx` | V3 intake, accepted-job recovery, plan reveal, week/workout review, adjustments, extra workouts, progress and interleaved history; older programs retain their existing reader |
| Execution | `execution.ts`, `workout-repository.ts`, `use-player-workouts.ts` | Confirmed v2 logs, pinned prescriptions, revision checks, schedule transactions and retryable saves |
| Guided workout | `PlayerWorkout.tsx`, `clock.ts`, `DrillMedia.tsx` | Sets/undo, rest, pause/resume, skipping and pain stop, end summary, catalog demonstrations/instructions and drill chat |
| AI Coach | `CoachChat.tsx`, `gateway.ts` | Creator-scoped history, terminal SSE handling, checked proposals, unsent Training handoffs and explicit memory controls |
| Leaderboards | `PlayerLeaderboards.tsx`, `scoring.ts` | Authorized team callable, Overall plus measured categories, ties, own rank and distribution |

All player code is under `app/src/pages/athlete-portal/player/`. Shared staff
scoring and editing logic are not replaced by player-specific behavior.

## Data ownership and consistency

The gateway owns training plans, planned workouts, proposals, AI transcripts,
analyses and coach memory. The web creates jobs or sends chat requests through
the existing gateway transport. It does not write AI conversation messages or
apply edits directly to a plan. Feature gates use `config/llm.globalEnabled`,
capability configuration, `programV3Enabled`, and `coachWorkspaceEnabled`.

Starting a workout reads the server prescription and rejects a changed revision.
An existing log resumes its immutable snapshot even if the plan has since
changed. Every v2 log mutation and its `workoutSchedule/current.revision + 1`
write share a Firestore transaction. UI progress changes only after acknowledgement;
failed saves preserve the last confirmed state. Finished logs cannot reopen.
Local clocks are account/player/log scoped, survive reload and cap inactivity at
30 minutes. Paused rest retains its remaining duration.

Weekly progress uses the mobile plan-week fold: one domain exposure per workout,
integer half minutes for partial blocks, and deduplicated linked/free recorded
sessions. Started plan slots retain their prescribed week. Ad-hoc progress uses
the program timezone and calendar window.

Profile, intake and player Overall scoring use one pure implementation and the
mobile benchmark dataset. Sprint rating/ranking requires completion time. Missing
measurements or benchmark cells remain unavailable. Matching courses use the
mobile five-percent tolerance. Teammate projections use the default benchmark
profile because their private age/gender fields are not in the callable response.

Drill demonstrations use the shared catalog normalizer and four published media
slots. Media replacements invalidate pending URL reads. Recording, calibration,
processing and new body scans remain in the mobile app.

## Preventing drift

The mobile repository is the source of truth for the player behavior and its
binding contracts. `player/mobile-parity.json` records the reviewed source hashes;
the JSON benchmark bundle is byte-identical to the mobile source.

Run `npm --prefix app run check:player-parity` with the mobile checkout beside this
repo, or `node scripts/check-player-parity.mjs /path/to/mobile`. A changed or
unavailable mobile source fails the check. Review the affected contract/code,
update the player implementation and behavior tests, then update the receipt.
Do not refresh hashes simply to silence drift. This check detects changes; it
does not replace semantic review or cross-client acceptance testing.

Relevant mobile references are `docs/LLM_GATEWAY_CONTRACT.md`,
`docs/TRAINING_PROGRAM_V3_CONTRACT.md`, `docs/PLAYER_PROFILE_INPUTS_CONTRACT.md`,
`KickAI/Stats/`, and `KickAI/TrainingPlans/`. Changes to shared payloads must land
compatibly in both clients and the gateway. No function/rules changes are part of
this player port.

## Validation

Run the parity check, `npm --prefix app test`, `npm --prefix app run lint`, and
`npm --prefix app run build`. The player tests cover terminal streams, feature
gates, snapshots/revisions, transaction failure, clocks, score/rank parity,
weekly evidence and server rendering of all five sample routes. Existing staff
tests remain part of the full suite.

Local sample: `npm --prefix app run dev -- --host 127.0.0.1`, then
`http://127.0.0.1:5173/athlete?preview=1`. Sample mode never writes athlete data;
live plan generation, media and AI calls require a signed-in player.

Browser acceptance must cover 360/390px and a desktop viewport: five tabs,
no horizontal overflow, keyboard/soft-keyboard controls, start → set → pause →
reload/resume → skip → finish, history, approved media, chat history/stop,
proposal save/start and memory controls. A signed-in pass must additionally
confirm web/mobile log interoperability, gateway errors/reconnect and unchanged
coach/admin entry points. See `deployments/player-mobile-parity-2026-09-11.md`
for executed checks and outstanding verification; source completion does not
imply those live checks passed.
