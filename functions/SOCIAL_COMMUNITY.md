# Community backend handoff

This additive implementation preserves the existing 14 social callables and
legacy organization/team/friends access. It introduces opted-in discovery for
authenticated users of any age, explicit publication per activity, and an inbox
for connection requests, acceptance, kudos and comments. It does not add direct
messages, push notifications, email, global automatic publication or age gates.

## Release gates and deployment boundary

`socialSettings/feed.communityEnabled` must be explicitly `true`; omission is
false. Keep it false while integrating, migrating and validating the release.
The existing `enabled`, organization pilot configuration and `historySince`
fields retain their meanings. Existing preference documents retain legacy
defaults; only absent preference documents start private, automatic sharing off,
and videos off. Existing automatic settings never publish to community.

Deploy the Firestore rules additions **before any new backend runs**. They deny
all direct client access to `socialCommunityProfiles`, `socialInbox` (including
nested items), and `socialModerationAudit`, even to authenticated admins. Without
these exclusions the historical catch-all rule would allow these new roots.
The new inbox is written by legacy interactions even while discovery is gated.
Deploy the additive Firestore indexes and wait until ready. Storage rules are
unchanged; do not deploy native repository rules.

Use the repository's reviewed immutable Functions source/package workflow. The
scoped Firebase targets are the following names, each prefixed `functions:`:

```text
getSocialAdminDirectory,getSocialContext,getSocialFeed,getSocialActivity,
saveSocialPreferences,setSocialVisibility,getSocialPeople,socialConnection,
setSocialKudos,getSocialComments,saveSocialComment,reportSocialActivity,
moderateSocialActivity,getSocialMedia,getSocialCommunityProfile,
saveSocialCommunityProfile,getSocialDiscovery,withdrawSocialCommunityPosts,
getSocialInbox,markSocialInboxRead,reportSocialContent,moderateSocialContent,
projectSocialReps,projectSocialWorkouts,projectSocialSessions,projectSocialPlayer,
projectSocialResultCorrections,projectSocialRepRevision,projectSocialFailureEvidence,
projectSocialProcessingEvidence,projectSocialProcessingEvidenceRemoved,
closeSocialAccount
```

All are in `us-central1`; callables and projection triggers use the existing
Node 22 package. The two new Storage observers watch only processing evidence
JSON creation/deletion and rebuild summaries. They are **not** the protected
`onVideoUpload` processor. Never deploy an unrestricted `--only functions` for
this release. Do not change the shared planner gateway, capture processor,
native app, benchmark/qualification definitions, archived videos, or reviewed
cohort plans.

The deployment archive must include `social-community.js`, `social.js`,
`social-projection.js`, `social-benchmarks.json`, and their existing transitive
modules: `effective-results.js`, `processing-evidence.js`,
`insights-v2-qualification.js`, `insights-v2-projection.js`,
`provisional-estimates.js`, `athlete-storage-paths.js`, `club-access.js` and all
dependencies those modules require. Keep the complete reviewed functions source
package; selecting deployment targets is separate from omitting source modules.
No new secret or dependency is required. The internal media service gains an
optional no-sign/short-TTL mode; the existing effective-results callable keeps
its previous 15-minute default and artifact behavior.

## Canonical projection and migration

Session summaries now have `schemaVersion: 2` and use the shared qualified,
deduplicated effective results, accepted revisions, correction documents and
processing evidence. Raw measurements, failed/incomplete attempts and proven
duplicate mirrors do not become measured feed results. Workout summaries keep
their existing source semantics. Activity IDs remain deterministic, retaining
per-activity settings, comments and kudos across ordinary reprojection.
Invalid/deleted activity summaries become unavailable; child engagement remains
retained but inaccessible without a parent. No source results are rewritten.

The read API fails closed on old session summaries until migration. Allow for
temporarily absent session cards between backend deployment and migration; do
not enable community until the complete migration and checks succeed.

From reviewed source with privileged application-default credentials, run:

```powershell
node scripts/rebuild-social-projections.cjs --project kickai-69dd0 --limit 20
node scripts/rebuild-social-projections.cjs --project kickai-69dd0 --limit 20 --apply
```

The first command is read-only. Each invocation processes one page and resumes
its separate dry-run or apply checkpoint in ignored `.netlify/`. Repeat a mode
until its output says `complete:true`. Standard output contains only project,
mode, player count, completion and checkpoint path. Private checkpoints contain
IDs and numeric result counts, never athlete names, result payloads or URLs;
keep them outside Git. Review counts from the dry-run before an authorized
apply. The script preprojects claimed players outside the old pilot even with
the community gate off; this grants no sharing consent. It does not alter
preferences, profiles, settings, source records or existing engagement.

`--checkpoint <path>` and `--start-after <playerId>` support a reviewed recovery.
Use a fresh checkpoint to intentionally restart a completed pass. A failure
records the failed ID but advances only through the last successful player.
Resume retries that player. Per-player safety limits remain 2,000 reps, workout
logs, sessions or failure records, 400 activities and 450 replacement writes;
oversized histories stop explicitly and require a reviewed paginated extension.
Do not skip failed players and describe the migration as complete. Evidence
reads are bounded to eight concurrent requests per player.

After migration, validate authenticated owner/nonowner, unrelated organization,
unclaimed account, staff, admin preview and blocked-account cases against the
deployed callables. Validate a real authorized phone session and exact media
selection. Finish device/isolation acceptance before enabling the feature flag.

## V2 contracts and privacy

Clients send `contractVersion: 2`. `getSocialContext` adds `communityEnabled`.
`getSocialFeed` adds scope `community` and an optional profile `playerId` filter.
The existing All view retains its original scope. V1 list responses omit
community-only posts; V1 detail/comments requests on such posts require an
update, including if an old organization post has subsequently been published.

V2 activity fields add `caption` (500 characters), `selectedRepId`,
`availableReps: [{id,label,canViewVideo}]`, `commentsEnabled`, `canComment`, and
`communityPublished`. Lists include only the selected/default rep choice;
detail includes up to 12 recent choices plus an older selected rep if needed.
`authorUid` is absent from V2. The existing media callable supplies five-minute
signed URLs only after exact capture resolution, canonical qualification,
current audience authorization and video consent; it rechecks after signing.
No pose/artifact/private processing-context URL is exposed. Ambiguous or missing
video returns unavailable. Links already issued expire within five minutes.

`setSocialVisibility` accepts V2 caption, selected rep, `videos`, and
`commentsEnabled` alongside its existing audience/hidden fields. Community
publication requires explicit video/comment booleans and a saved display name;
it records the current account owner. A rebound account inherits neither the
old alias/discovery nor publication consent. Selecting a different rep requires
membership in that activity. Turning global videos off revokes earlier video
consent; a later explicit community publication can grant it again.

| Callable | Input and result |
| --- | --- |
| `getSocialCommunityProfile` | Optional `playerId`; returns flat profile below. Owners may read their saved settings while the gate is off. |
| `saveSocialCommunityProfile` | `displayName` (1–60), `discoverable`, `showClub`; returns flat profile. |
| `getSocialDiscovery` | Optional `query` (60), player-ID `cursor`; returns `{people,cursor}`. |
| `withdrawSocialCommunityPosts` | No additional input; revokes existing community posts. |
| `getSocialInbox` | Optional `{time,id}` cursor; returns `{items,cursor,unreadCount,unreadCountIsLowerBound}`. |
| `markSocialInboxRead` | `ids`, 1–50; marks only caller-owned events read. |
| `reportSocialContent` | `targetType` activity/comment/profile, relevant `activityId`/`commentId`/`playerId`, `reason` (1–500). |
| `moderateSocialContent` | No action lists reports. Otherwise `reportId`, `action`: hideActivity/removeComment/suspendProfile/restoreProfile/dismiss. Admin only. |

Profiles contain only `{playerId,displayName,discoverable,clubName,relationship,
mine,suspended,showClub,communityPostsWithdrawnAt}`. No UID, age/DOB, contact data,
private measurements or roster payload is returned. The owner's response also
has `displayNameConfigured`, so the first-post composer requires saving a chosen
name without confusing the abbreviated fallback with prior consent. Discovery scans up to 100
opted-in profiles per call, returns at most 20 matching accessible people and
may return an empty page with a continuation. Turning discovery off removes
directory results, while direct profiles remain available from authorized
published posts or accepted connections. Withdraw is separate. A legacy
people lookup retains roster fields only for established organization or
accepted-connection access; unrelated/pending community people return minimal
name/alias with `uid:null` and additive `canConnect`.

Any claimed player can interact with an accessible community activity, subject
to current author settings, blocks and suspension. Existing active staff/admin
engagement on legacy audiences is preserved. Comment removal supports the
comment author, activity owner or admin. Community comments use a current
consented alias or safe abbreviated fallback, including historical comments
created before community publication. Permission, membership, account binding,
comments settings, blocks and suspension are rechecked inside write transactions.

Inbox items are `{id,type,actor:{playerId,displayName},activityId?,createdAt,read}`.
Staff actor `playerId` is null with display name `PoseTek staff`. Events are
idempotent within the source transaction and filtered against current content,
blocks, account ownership and connection state. No raw actor UID is returned.
The unread count covers the returned visible page; when `unreadCountIsLowerBound`
is true, do not display it as an exact total. Resolved suspension reports stay
listed with `targetSuspended:true` so admins can restore them. Moderation report
responses omit reporter/moderator UID. All mutations reject athlete-preview mode.

## Rollback and validation

First set `communityEnabled:false` to stop discovery/new publishing and deny
nonowner community access. This retains consent and engagement for recovery.
Restore reviewed frontend bytes and scoped social function versions if needed.
Keep the new Firestore deny rules and additive indexes in place on rollback;
removing the denies exposes retained server-owned social collections. Do not
revert raw athlete data: migration only updated derived summaries. To correct a
projection bug, fix/redeploy the projector and run a fresh reviewed migration.
If rolling code back to pre-community versions, disable/delete only the five
new projection observers using the reviewed release workflow; preserve the
original four projectors, auth deletion handler and protected processor. A
code rollback does not erase community records or moderation decisions.

Local validation: the complete backend plus migration suite passed 282 tests
(279 passed, three existing private historical-fixture tests skipped), with
zero failures. Real isolated Firestore/Storage emulators passed 336 assertions.
The rule fixture now correctly expects the pre-existing verified-admin upload
permission for an existing player; Storage rules themselves are untouched.
Regression cases cover canonical qualification/duplicates/revisions, exact
media, feature gating, consent ownership, old clients, alias privacy, staff,
blocking, preview denial, racing membership/permission changes, idempotency,
inbox account transfer, moderation restore and migration resumption. Production
deployment, production migration and device validation were not performed by
this backend workstream.
