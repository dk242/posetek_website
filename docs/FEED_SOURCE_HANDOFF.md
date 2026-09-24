# Feed frontend and backend handoff

Recovered September 16, 2026 for app development in
[`dk242/posetek_website`](https://github.com/dk242/posetek_website).

The complete feed feature stack is now in this repository: editable React UI,
typed callable contracts, original deployed backend modules, routing/navigation,
Firestore and Storage rules, indexes, tests, and recovery provenance. The frontend
is reconstructed from the published component; the backend is original authored
source recovered from deployed Firebase source archives. Original frontend TSX,
comments, and development history remain unavailable.

## Why it was missing

At commit `3f7ecd2`, the repository had only the old root `feed.html` mockup.
The live application was newer. Homepage releases preserved its compiled files
instead of rebuilding it from `app/src/`, so synchronizing the homepage did not
bring the feed implementation into Git. The initial gap report is retained in
Git history at `2264401`.

Recovery now replaces that missing-source dependency for feed development.
Root `feed.html` remains historical material and is excluded from ordinary
application output. Both `/feed` and `/feed.html` load the recovered React page.

## Start here

From a fresh clone, use Node.js 22.18 or later in the Node 22 release line and npm 10:

```powershell
git clone https://github.com/dk242/posetek_website.git
cd posetek_website
npm --prefix app ci --no-audit --no-fund
npm --prefix functions ci --no-audit --no-fund
npm --prefix app run dev -- --host 127.0.0.1 --port 4180
```

Open **http://127.0.0.1:4180/feed?preview=1**. This uses the existing synthetic
sample activity and does not change accounts. No reference capture or recovery
script is needed to build or edit the committed feed source. Fonts load from
the existing external font provider.

The real feed uses the existing Firebase project `kickai-69dd0`, Firebase Auth,
and callable functions in `us-central1`. Without `preview=1`, an authorized
account and the server's feed-availability settings are required. The normal
Vite app uses the configured cloud backend; it is not automatically connected
to emulators. Do not use real account mutations to test local changes.

## Source map

| Area | Source |
| --- | --- |
| Feed, activity cards, comments, people, sharing settings, moderation, admin directory | [`app/src/pages/feed/FeedPage.jsx`](../app/src/pages/feed/FeedPage.jsx) |
| Layout and responsive styles | [`feed.css`](../app/src/pages/feed/feed.css), `feed-cascade.css`, shared [`pose-portal.css`](../app/src/styles/pose-portal.css) |
| All 14 callable request/response types | [`contracts.ts`](../app/src/pages/feed/contracts.ts) |
| Callable transport and preview guard | [`api.ts`](../app/src/pages/feed/api.ts) |
| Formatting and pagination helpers | [`model.ts`](../app/src/pages/feed/model.ts) |
| Authenticated feed API, privacy, connections, kudos, comments, moderation, video links | [`functions/social.js`](../functions/social.js) |
| Activity projection, units, deterministic IDs and benchmarks | [`social-projection.js`](../functions/social-projection.js), [`social-benchmarks.json`](../functions/social-benchmarks.json) |
| Callable and trigger exports | [`functions/index.js`](../functions/index.js) |
| Protected player invitation helpers restored with deployment source | [`player-invitations.js`](../functions/player-invitations.js), `admission.js`, `clubs.js` |
| Access rules | `PoseTek-mobile-app/firebase/firestore.rules`, `storage.rules` (canonical; published only from that repo) |
| Indexes | `firestore.indexes.json`, `firebase.json` |

Player sign-in/signup, player bottom navigation, coach/roster/organization
links, and the admin Community feeds tab lead to the feed. The existing
`/athlete?view=aiCoach` entry remains supported. The app engineer can use the
typed contracts and server implementation directly when porting the feature.

## Backend contract

Clients use authenticated Firebase `httpsCallable` requests and read the returned
`data` payload. They do not read or write `social*` Firestore collections directly.

| Purpose | Callables |
| --- | --- |
| Viewer and activity | `getSocialContext`, `getSocialFeed`, `getSocialActivity` |
| People and connections | `getSocialPeople`, `socialConnection` |
| Reactions and comments | `setSocialKudos`, `getSocialComments`, `saveSocialComment` |
| Sharing and media | `saveSocialPreferences`, `setSocialVisibility`, `getSocialMedia` |
| Reporting and admin | `reportSocialActivity`, `moderateSocialActivity`, `getSocialAdminDirectory` |

Feed/comment cursors are `{ time, id }`; people cursors are player IDs.
Timestamps are epoch milliseconds. Video URLs expire after five minutes.
`viewAsPlayerId` is an administrator-only, read-only preview; the server rejects
mutations in that mode. Organization overrides also require server authorization.

Four Firestore triggers (`projectSocialReps`, `projectSocialWorkouts`,
`projectSocialSessions`, `projectSocialPlayer`) project activities from player
records. `closeSocialAccount` handles Auth account deletion. For synthetic
backend fixtures and the `socialSettings/feed` configuration fields, see
[`functions/SOCIAL_RECOVERY.md`](../functions/SOCIAL_RECOVERY.md) and the recovered
social tests. Production settings, athlete records, and videos were not exported.

## Validation

Run from the repository root:

```powershell
npm --prefix app test
npm --prefix app run build
node --test functions/*.test.js
```

For the real Firestore/Storage rule tests, install the Firebase CLI and Java 21,
then run with Java on PATH (see `app/rules-tests/README.md`):

```sh
node scripts/run-rules-tests.mjs socialRules
```

The explicit `demo-posetek-feed` project and loopback-only emulator ports keep
these synthetic checks isolated. The suite verifies direct access denial for
all seven social collection roots, nested comments/kudos, protected invitations,
and owner/admin/unauthorized recording access.

Recovery validation passed **703 frontend tests**, **120 backend tests**, and
**250 emulator rule assertions**, plus TypeScript and the complete application
build. Browser review passed at 1440px desktop and 390px phone widths, including
the `/feed.html` alias, audience filters, sample kudos/comments/settings/connection
guards, and feed-to-profile-to-feed navigation. No browser errors were recorded.
The production assembly passed its 171-file application baseline check; recovery
does not relax that guard. Authenticated production mutations were not exercised.

A clean export of the staged source also passed fresh app/backend dependency
installation, the full app build, and all 120 backend tests on Node 22.18.0 /
npm 10.9.3. It used no copied dependencies or deployed-reference capture.

Fresh backend installation reported 29 dependency audit findings (3 low,
13 moderate, 11 high, 2 critical). The existing backend manifest/lockfile were
retained to match the deployed source; dependency upgrades are a separate review.
These are package audit findings, not a determination of exploitability in the
feed. The fresh app dependency installation reported zero audit findings.

## Provenance and release boundary

- [`Frontend provenance`](../app/src/pages/feed/PROVENANCE.md) records exact public
  asset hashes, the JSX recovery process, and intentional integration adjustments.
- [`Backend provenance`](../functions/SOCIAL_RECOVERY.md) and its JSON receipt
  record all 19 deployed social exports, original archives, versions, hashes, and
  the selected latest source. Existing teammate tests were preserved.
- [`Rules/index provenance`](FEED_RULES_RECOVERY.json) records the recovered active
  rules and 12 live composite indexes. All four preexisting index definitions
  were retained. Firestore's implicit trailing `__name__` field is omitted from
  the deployable index configuration.

Credentials, signed download URLs, `.runtimeconfig.json`, local archives,
dependencies, and generated output are excluded from Git. Existing unrelated
payment/share services retain their separately provisioned secret requirements.

This is a source handoff, with no production frontend, backend, rules, or index
deployment. `npm --prefix app run build` produces the editable application in
`dist/`; the separate Netlify homepage release still preserves the older live
application. A future application release must review the complete application
diff and deliberately reconcile the preservation baseline before publishing.
