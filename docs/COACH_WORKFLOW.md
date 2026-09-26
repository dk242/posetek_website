# Coach workflow and source of truth

September 25, 2026 source update. This document is a handoff, not a production
release receipt. No accounts, invitations, plans or production settings were
changed to verify this work.

## Working together

1. A PoseTek administrator or current organization manager creates the team,
   assigns the existing player records and issues email-bound coach invitations.
   A coach verifies their email and claims the invitation through `/join`.
2. The coach opens My teams and chooses an assigned team. The team workspace at
   `/dashboard` shows only its canonical roster. Roster, planner and Insights links
   preserve that organization and team.
3. **Prescribe / review** opens the existing personalized planner for one player.
   **Prescribe team plans** selects the loaded team for individual personalized
   drafts; it does not copy one prescription to everyone. Review each player's
   context and proposed plan before explicitly activating it.
4. A draft leaves the current active program intact. Activation publishes the
   existing shared player-readable plan used by the website and mobile app.
5. Players track their workouts. Coaches use Workout history for saved drills,
   reported sets, skips, endings and timer time, and Testing for measured progress.
   **Refresh team** rechecks current access and reloads activity. The checked time
   describes that roster load; this view is not a live attendance tracker.
6. Administrators retain organization-wide account, program and Insights
   oversight. Managers retain their current organization authority. There is no
   new mandatory admin-approval stage: coaches retain explicit activation of
   their own reviewed drafts under the existing policy.

## Authoritative records

| Concern | Source |
| --- | --- |
| Current coach authority | Active `organizations/{orgId}/members/{uid}` membership and assigned `teamIds` |
| Team ownership | Player `organizationId` and `teamId`; legacy mirrors cannot override migrated ownership |
| Program | Server-written `trainingPlans` with active status, activation date and revision |
| Plan review | The requester's safe `personalizedPlanDraftViews`, followed by server-checked explicit activation |
| Per-session prescription | The workout log's immutable `workoutSnapshot`, never today's edited program |
| Outcomes | Recorded `workoutLogs` with sets, skip reasons and ending state |
| Personal sessions | Server-owned `personalWorkoutLogs`, read only after `config/llm.personalWorkoutsEnabled === true` |
| Complete filtered reporting | Current-access `getClubInsightsV2` and its existing qualification/projection contract |

See [the shared planner contract](PERSONALIZED_PLANNER_WEB_CONTRACT.md),
[canonical account hierarchy](VACAVILLE_WEBSITE_UPDATE.md#canonical-account-hierarchy)
and [Insights semantics](insights/V2_CONTRACT.md).

The website does not own the gateway or Firebase rules. Their current canonical
repositories and release commands are in `AGENTS.md`; historical deployment
receipts are not current source or publishing instructions.

## Dashboard behavior

- Multiple assigned teams require a choice; a single team opens directly. An
  unassigned or unauthorized team is never silently substituted.
- Team switches, refresh, newer retries, sign-out and account changes invalidate
  older responses. Player retries also reload canonical team access.
- Failed reads stay **unavailable**, with retry. They never become zero activity
  or “No active program.” Aggregate activity and program totals remain hidden
  until every roster member loads; service limits remain visible.
- A ready draft is not an active program. Explicit activation date takes
  precedence over generation date when choosing among historical active records.
- Linked workout logs count once, using the same preference as Insights V2:
  pinned prescription first, then latest ending, then stable document ID.
- Valid `activeSeconds` produces timer time; only its absence/invalidity permits
  a bounded start-to-end elapsed estimate. The two are labeled separately.
  Missing duration remains unknown. An ending is required for “Completed.”
- Completing a session and completing every prescribed set remain distinct.
  Missing historical prescriptions are labeled unknown rather than reconstructed
  from the current program. Pain-related skip reasons remain visible when logged.
- Personal workouts have their own duplicate namespace and a **Personal workout**
  label. Their outcomes contribute to recorded activity, never to completion of
  the source assigned workout. Personal `stopped` and `pain` endings count as
  ended early; a pain ending is also shown explicitly. A false/missing feature
  flag does not query the new collection before its rules have been deployed.
- Legacy schema-1/2 week editing continues through the existing server
  `save_plan_weeks` job. Schema-3 workout mutation permissions are unchanged;
  coaches use the reviewed planner or request an individual adjustment from
  PoseTek. No direct browser plan writes were introduced.
- This pass adds no coach/player messaging and exposes no private coach notes,
  private AI context, or another coach's draft workspace.

## Design reference lock

Refero Design was used with its bundled craft references because live Refero
tools were unavailable. Primary reference: the existing PoseTek portal and coach
workspace. Preserve its dark green canvas, Inter/system typography, restrained
lime primary action, readable neutral data and existing surface/radius tokens.
Secondary reference: current Insights scope, freshness, failed-read and empty
states. No new imagery is necessary for a roster and execution-history view.

| Decision | Source and role | Purpose |
| --- | --- | --- |
| Training before testing | User's coach prescribing/progress workflow | Show the coach's next action first |
| Named team selector and scoped links | Canonical organization and Insights flows | Keep ownership visible during navigation |
| Stacked player records with labeled metrics | Existing mobile roster + Refero craft-details | Avoid horizontally scrolling performance tables on phones |
| Neutral metrics, lime primary prescription action | Existing portal + Refero color guidance | Reserve the strongest accent for action |
| 44px controls, visible focus, readable mobile inputs | Refero craft-details | Support touch and keyboard use |
| Pinned-history disclosure | Existing execution/Insights contract | Keep the prescribed work and actual outcome inspectable together |

## Validation and release boundary

Synthetic tests cover canonical multi-team selection, unauthorized teams, stale
auth/team responses, retry isolation, failed-versus-empty history, active-plan
selection, planning entry for all program schemas, pinned drill rendering,
completed-versus-skipped sets and timer/duplicate parity with the server's
Insights helper. Existing legacy save-job tests remain included.

Run `npm --prefix app test -- src/pages/coach-dashboard` and
`node app/node_modules/typescript/bin/tsc -b app`.
Use `/dashboard?preview=1` in Vite for fictional data; preview is development-only.
Review at 360/390/430px and desktop, including player history and keyboard focus.
An authenticated acceptance pass should cover two distinct teams, a shared-team
coach, revoked membership and a player transfer without claiming real invitations
or generating production plans as test data.

Website publication must use the guarded application release and verified
preview workflow. This source handoff does not claim deployment, native build,
physical-phone acceptance, or completion of the unpublished training-content gate.
