# Live feed backend source recovery

The backend for `https://posetek.net/feed` was recovered on September 16, 2026
from the **original deployed Firebase source archives**, using an existing
authorized Firebase CLI account. These are authored CommonJS modules and their
original tests, not a reconstruction from browser JavaScript.

The project is `kickai-69dd0`, the region is `us-central1`, and the deployed
functions use Firebase Gen 1 with Node.js 22. Recovery used read-only function
metadata and the Google Cloud Functions `generateDownloadUrl` API. No function
deployment or application-data operation was performed during recovery. Signed
download URLs, OAuth credentials, and the archive's `.runtimeconfig.json` were
excluded from Git. The archives remain in ignored `.netlify/feed-recovery/`.

## Code map

| File | Responsibility |
| --- | --- |
| `social.js` | Authenticated callable handlers, current audience checks, connections, reactions, comments, moderation, short-lived video links, and transactional activity rebuilds. |
| `social-projection.js` | Groups measured reps and completed workouts, converts units, computes benchmark comparisons, and creates deterministic activity IDs. |
| `social-benchmarks.json` | Original fallback D1 standards; byte-for-byte identical to `app/src/pages/athlete-portal/player/D1Benchmarks.json`. Its provenance says these are projected standards, not measured athlete data. |
| `social.test.js` | Original tests for projection, access, privacy changes, blocking, pagination, idempotency, media paths, and admin preview restrictions. |
| `player-invitations.js` | Protected signup invitation storage, redemption, and coach-created player linkage, recovered with the feed deployment. |
| `player-invitations.test.js` | Original invitation authorization, retry, and integration tests. |
| `index.js` | All callable and trigger exports, plus the existing non-feed backend. |
| `admission.js`, `clubs.js` | Existing modules with recovered optional invitation integration. |
| `test-support/fake-firestore.js` | Original query ordering, cursor, and array matching additions used by the recovered tests. |

The 14 callable exports are `getSocialAdminDirectory`, `getSocialContext`,
`getSocialFeed`, `getSocialActivity`, `saveSocialPreferences`,
`setSocialVisibility`, `getSocialPeople`, `socialConnection`, `setSocialKudos`,
`getSocialComments`, `saveSocialComment`, `reportSocialActivity`,
`moderateSocialActivity`, and `getSocialMedia`.

Four Firestore write triggers (`projectSocialReps`, `projectSocialWorkouts`,
`projectSocialSessions`, `projectSocialPlayer`) rebuild activities from current
authoritative player data. `closeSocialAccount` makes retained activity private
when Firebase Auth deletes its owner. Invitation exports are
`ensurePlayerSignupInvitation`, `createCoachPlayer`, and
`ensurePlayerInvitationOnWrite`; existing club invitation functions use the same
protected invitation helper.

## Exact deployment provenance

[`SOCIAL_RECOVERY.json`](SOCIAL_RECOVERY.json) records per-function versions,
deployment timestamps, relevant downloaded archive hashes, and separate
`originalSourceSha256` and `integratedFileSha256` hashes for each recovered file.
Every social function's source archive was downloaded and hashed; the results
fall into three source versions:

| Deployed exports | Archive SHA-256 |
| --- | --- |
| 13 callables other than `socialConnection`, plus the recovered player invitation exports | `734c7f635366a061763f812d1c6bda3db94d55f278f43727cd8e40214a99c17f` |
| `socialConnection` version 6 and all four projection triggers version 5 | `70b05f59908ce52b4f8fb11b304fe3747f7e174eeac292a6e178608108b2007f` |
| `closeSocialAccount` version 1 | `dee1846240cc21a483445678628f85c2a6b0326b1dbaa5709754904b388880b7` |

The committed recovery uses the latest archive, from the September 13, 2026
23:28 UTC function updates. Its `social.js` differs from the earlier callable
archive by one condition inside `rebuild()`: a connected athlete is eligible for
projection when their peer's organization is enabled by `allOrganizations`.
This version is already live on `socialConnection` (which calls `rebuild` after
acceptance) and all four projection triggers. The other callable handler bodies
are unchanged. The `closeSocialAccount` handler body is also unchanged from its
older deployment.

The repository's newer teammate tests in `admission.test.js` were kept intact.
The ten changed or missing source/test files listed in the JSON receipt match
the **selected latest archive** byte-for-byte; identical existing modules and
both dependency files were retained.

There is also an important source-version difference in `admission.js`. The
earlier `getSocialFeed` archive contains an `invitations.redeem(...)` block in
`attachPlayerByCode`; the selected later `socialConnection` archive already
removes it. The integrated file matches the later ZIP entry exactly, so this
was not a local removal. Direct ZIP-entry hashing confirmed the earlier file
hash is `2ed4e85114307f0864955dee497d61f31b4525c41cf15d11589feb0860707b77`
and the selected/integrated file hash is
`8f37981e0a7506a5954a36a888759073bb4a43d5861d8b08aee672f340b14288`.

The later version preserves the existing coach attachment contract: adding a
player to a coach's roster must not redeem the player's signup identity for
that coach. The earlier block also referenced `email`, which is not defined in
`attachPlayerByCode`. Athlete signup redemption remains in
`redeemPlayerSignupCode`, where it belongs. Both the existing roster-attachment
test and the recovered protected-invitation compatibility test passed. Archive
contents alone do not establish which source version an unrelated callable was
deployed from; the per-function deployment evidence above covers the recovered
feed and invitation exports.

## Configuration and development

The feed uses Firebase Auth, Firestore, Cloud Functions, and Cloud Storage.
Clients call the functions; direct client access to the `social*` collections is
denied by the recovered Firestore rules. Live rules and index definitions are
maintained in the repository-root Firebase configuration.

For an isolated development database, `socialSettings/feed` controls availability:
`enabled` enables non-admin feed access; `organizationIds` or `allOrganizations`
select organizations whose activity is projected; optional `historySince` is an
epoch-millisecond cutoff. Use synthetic organization/player records in emulators.
Production settings and athlete documents were not exported. The tests show
minimal synthetic records and use dependency injection, so they require no cloud
credentials.

Run from the repository root with Node.js 22:

```sh
node --test functions/*.test.js
```

All **120 backend tests passed** after integration, including the recovered social
and invitation tests and the retained teammate tests. To install the exact
backend dependency versions for local Firebase emulation:

```sh
npm --prefix functions ci
```

Local module discovery also loaded all **19 social callable/trigger exports**
without invoking any handler. Dependencies and both package files remain at their
existing locked versions.

An authorized maintainer can repeat read-only archive recovery with
[`scripts/recover-deployed-feed-backend.cjs`](../scripts/recover-deployed-feed-backend.cjs):

```sh
node scripts/recover-deployed-feed-backend.cjs --firebase-tools-dir "/path/to/node_modules/firebase-tools"
```

The script reuses a signed-in Firebase CLI account (tested with version 14.14.0)
and writes only to the ignored recovery directory. It downloads the currently
deployed revisions; compare its inventory with the committed historical receipt.
The archives may include runtime configuration and must not be committed or
extracted wholesale into tracked directories.

The feed has no new secret requirement. Existing payment handlers still depend
on separately provisioned Stripe configuration, and existing athlete-share
handlers require `ATHLETE_SHARE_SIGNING_KEY`; those values do not belong in Git.
This recovery does not redeploy those unrelated services.
