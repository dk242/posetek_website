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

The deployment archive must include `social-community.js`, `social.js`, `social-media-overlay.js`,
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
`communityPublished` and effective `poseOverlay:boolean` consent (default false).
Lists include only the selected/default rep choice;
detail includes up to 12 recent choices plus an older selected rep if needed.
`authorUid` is absent from V2. The existing media callable supplies five-minute
signed URLs only after exact capture resolution, canonical qualification,
current audience authorization and video consent; it rechecks after signing.
The current owner can inspect their own exact saved video before granting
sharing consent. Nonowners still require current audience access and video
consent; owner permission is also rechecked after signing.
No pose/artifact/private processing-context URL is exposed. Ambiguous or missing
video returns unavailable. Links already issued expire within five minutes.

### Optional feed pose overlay

`getSocialMedia` accepts optional boolean `includeOverlay`. Omission/false retains
the existing `{url,expiresAt}` response and performs no pose download. When true,
the response adds `overlay`, either `null` or this drawing-only projection:

```text
{ version: 1, coordinateSpace: "normalized", layout: "coco17" | "mediapipe33",
  sourceWidth: number, sourceHeight: number,
  frames: [{time: number, points: ([number, number] | null)[]}],
  markers: [{label: string, time: number}],
  footJoints: {left: number, right: number} }
```

Times are recorded video seconds, including any explicit pose/video start offset.
Points are bounded normalized 2D coordinates rounded to four decimals. Layout
fixes the point ordering; low-confidence, missing and out-of-frame points become
null. `footJoints` identifies ankle joints for the same time-bounded foot trails
used by replay; it does not claim a ball path or professional comparison. Markers
are a fixed label allowlist from canonical qualified rep fields, never arbitrary
metadata text or stale values replaced by an accepted revision. The client should
draw only within the supplied time range and hide gaps/unavailable points.

The server samples across the complete source, preserving endpoints, to at most
300 frames / 33 joints and 200 KiB of response JSON. Pose files have a separate
16 MiB source limit, accommodating native high-frame-rate double-precision pose
arrays; the canonical metadata/context JSON reader remains capped at 2 MiB.
The pose reader first validates object size and generation, then streams that
exact generation using an inclusive byte range of `0..16 MiB`. The extra byte is
an overflow sentinel: receiving more than 16 MiB destroys the stream and returns
unavailable. The final length must equal the inspected object size. Missing,
interrupted, truncated or invalid JSON also returns unavailable. This range
contract follows the installed Google Cloud Storage SDK; range checksum
validation is disabled, while generation pinning and exact byte counts remain
enforced. No unbounded fallback download is used.

The projector also enforces a 12,000-frame, 10-minute clock limit and positive
source dimensions no larger than 16,384 pixels. Each frame contains exactly 17
or 33 points; canonical ankles are indices 15/16 or 27/28 respectively.
Unsupported layouts/coordinates, absent dimensions,
malformed clocks, conflicting recorded FPS, uncertain trim offsets, and absent
exact sidecar-to-video identity return `overlay:null`; an otherwise authorized
video remains playable. A unique legacy video alone is insufficient evidence to
align a pose. The server does not guess FPS, dimensions, transforms or another
rep's artifact folder. No private metadata, athlete measurements, processing
context, artifact URLs, object paths or generation identifiers appear in output.

`setSocialVisibility` V2 accepts `poseOverlay:boolean`. Missing/false clears pose
sharing; true requires video sharing and a measured rep in the activity. Consent
is stored against the current account owner and selected rep. Changing the
selected rep through an older client does not carry consent forward. V2 activity
DTOs expose only effective `poseOverlay:boolean`, never these private binding
fields. Existing video-only posts default to false. The current owner may inspect
their own overlay before opting in; nonowners require both current video consent
and this explicit pose consent. Global video revocation also revokes shared pose
access under the existing video rules; explicit later publication can regrant
video sharing with a new pose choice.

The media service's internal recording hook reuses canonical qualification,
duplicate suppression, folder/capture resolution and video generation selection.
After optional pose projection it re-resolves that binding and then rechecks the
activity, account/audience, video and pose permissions, selected rep and expiry.
Client code requests overlays only for the active visible media, retains no
persistent artifact cache, and clears drawing data with the media lease at expiry,
sign-out, account change or access revocation. Before drawing, the client validates
the projection and its compatibility with the loaded video's aspect and duration.
Missing points and gaps greater than 0.25 seconds break interpolation/trails;
stale trails are hidden. Only one visible feed clip may autoplay, always muted;
reduced-motion and data-saving preferences use manual playback. A declined or
unavailable overlay does not prevent an otherwise authorized video from playing.
This change adds no callable,
Firestore/Storage rule, secret or dependency. Deploy the complete reviewed
Functions source when updating `getSocialMedia`, `setSocialVisibility`,
`getSocialFeed` and `getSocialActivity` together, or use the complete scoped target
list above. The latter two return the additive activity consent field. Native
private-media defaults are unchanged.

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

Earlier community integration, before the optional overlay extension: the
backend plus migration suite ran 284 tests
(281 passed, three existing private historical-fixture tests skipped), with
zero failures. Real isolated Firestore/Storage emulators passed 336 assertions.
The rule fixture now correctly expects the pre-existing verified-admin upload
permission for an existing player; Storage rules themselves are untouched.
Regression cases cover canonical qualification/duplicates/revisions, exact
media, feature gating, consent ownership, old clients, alias privacy, staff,
blocking, preview denial, racing membership/permission changes, idempotency,
inbox account transfer, moderation restore and migration resumption. Production
deployment, production migration and device validation were not performed by
this backend workstream.

The overlay follow-up's focused backend run passed **85 tests**, with no failures
or skips: `social.test.js`, `social-community.test.js`, `effective-results.test.js`
and `social-media-overlay.test.js`. It covers consent/defaults, exact rep/capture
binding, access and source changes during reads, expiry, bounded projection,
missing artifacts, a genuine-size 960-frame/33-joint/240-fps double-precision
fixture larger than 2 MiB, generation-pinned streams, invalid sizes, overflow,
interruption and truncated reads. The two frontend pure suites,
`media-playback.test.ts` and `pose-overlay.test.ts`, passed **55 tests**, covering
one playback winner, visibility/order/hysteresis, strict parsing, interpolation,
dropouts, trails and direct backend-to-client 17/33-point compatibility.
These are scoped regression results, not physical-device or deployed-media
acceptance. Confirm real authorized footage, consent revocation, account changes,
expiry, portrait/landscape alignment, scroll handoff and browser autoplay
behavior before release.
