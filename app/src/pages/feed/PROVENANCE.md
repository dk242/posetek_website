# Feed frontend recovery

Recovered September 16, 2026 for the user's request to make the complete feed
stack available to the app engineer in `dk242/posetek_website`.

The original authored frontend file was unavailable. `FeedPage.jsx` is editable
React source recovered from the exact published `/feed` component, not a mockup,
screenshot recreation, or import of the deployed application runtime. The backend
was subsequently recovered separately from Google Cloud's deployed source
archives; see `functions/SOCIAL_RECOVERY.md` at the repository root.

## Pinned source and verification

The public feed assets match the unchanged September 15 application baseline,
deployment `6aa9b6f0d8faf6177db8fd97`:

| Asset | SHA-256 |
| --- | --- |
| [FeedPage-Cm50ZtLq.js](https://6aa9b6f0d8faf6177db8fd97--posetek.netlify.app/assets/FeedPage-Cm50ZtLq.js) | `ad8911444f7a33feb55162a9cf524b57b829b331e938162cad92b99198addce4` |
| [FeedPage-IidU16n6.css](https://6aa9b6f0d8faf6177db8fd97--posetek.netlify.app/assets/FeedPage-IidU16n6.css) | `1c186367afe64ff15227a5c06950195f1e8fbe1a62dbc2ec40e4fdde1715af1f` |

`recover-feed.mjs` checks both hashes before generating source. It uses the
TypeScript parser and symbol table to restore JSX and rename bindings without
executing downloaded JavaScript. React, router and Firebase imports resolve to
the existing application's dependencies. The compiled component's 14 callable
names and request fields remain unchanged. The original lazy-load dependency on
the shared portal theme is explicit as `../../styles/pose-portal.css`.

The script formats CSS without changing its selectors, declarations, media
queries, or values. It expands sequence statements and compiled boolean literals
and restores named components and state. `model.ts` contains the four unchanged
formatting/pagination helpers. The typed `api.ts` transport unwraps callable
results as the deployed client did, and additionally rejects athlete-preview
mutations before transport. The server enforces the same read-only rule.

Browser comparison exposed a stylesheet-order dependency: the published router
loads the feed CSS before the shared portal CSS, whose inherited button/input
font overrides the equally specific feed rules. The recovered imports preserve
that order. `feed-cascade.css` repeats only those inherited values with the same
selector specificity, keeping the observed 15px regular filter text and portal
font family stable even when a different route loaded the shared theme first.
The recovered `feed.css` remains unchanged apart from formatting.

## Files to edit

| File | Responsibility |
| --- | --- |
| `FeedPage.jsx` | `FeedPage`, `ActivityCard`, `Comments`, `People`, `SharingSettings`, `Moderation`, `AdminDirectory`, and the existing sample preview |
| `feed.css` | Feed layout, cards, controls, responsive behavior and theme overrides |
| `feed-cascade.css` | Published portal font inheritance, independent of route loading order |
| `contracts.ts` | All 14 callable request/response types, view context, activity/comment/people data and cursors |
| `api.ts` | Firebase callable transport and client-side preview mutation guard |
| `model.ts` | Measurements, dates, avatar initials and deduplicated pagination |
| `FeedPage.d.ts` | Typed public React component signatures for other TypeScript modules |
| `feed.test.tsx` | Offline rendering, contract transport, preview protection and pagination checks |

Contract types are based on the deployed client and recovered `functions/social.js`:
feed/comment cursors are `{ time, id }`, people cursors are player IDs, timestamps
are epoch milliseconds, and media responses include the server's five-minute
expiry. Firebase authentication and `us-central1` callable selection remain in
`app/src/lib/firebase.ts`. No direct Firestore access is added to the feed UI.

## Reference lock and decision ledger

The task is source recovery for an existing product, so the supplied
`https://posetek.net/feed` is the visual and behavior reference. No redesign is
introduced. Keep its dark green/lime portal identity, three-column desktop
layout, compact cards with measured evidence, mobile bottom navigation, and
audience/privacy controls. The existing sample data is clearly labeled as sample
data and must not be presented as a real account's activity.

| Decision | Evidence | Reason |
| --- | --- | --- |
| Keep all layout, copy and responsive CSS | Pinned component and stylesheet above | Let the app engineer iterate from the actual feed |
| Use the shared portal tokens | Published router's `pose-portal-BL__fjGJ.css` lazy-load dependency | Preserve standalone direct-route styling |
| Preserve sample and athlete preview guards | Published query handling and action handlers | Sample preview never changes an account; admin previews stay read-only |
| Preserve auth/feed request counters and mounted checks | Published effects and async callbacks | Discard obsolete results after account, filter or route changes |
| Publish typed callable contracts alongside JSX | Deployed `social.js` and frontend call sites | Give web and mobile clients one reviewable integration reference |

## Preview and validation

With the application dev server running, visit `/feed?preview=1` for offline
sample content. `/feed?preview=1&connect=sample` opens the sample people panel.
The real feed requires Firebase authentication and server authorization.
`viewAsPlayerId` is an administrator-only server feature and disables writes.
`/feed.html` is a route alias integrated in `App.tsx`.

The offline test suite renders the real recovered components and checks their
sample/loading states, connection deep links, athlete-preview navigation,
disabled account actions, chart labels, and owner controls. It exercises all 14
callable payloads through an injected transport, rejects all seven preview write
paths, propagates server failures, and verifies overlapping pagination. Firebase
is mocked; these tests do not access live accounts or data.

Run from repository root:

```powershell
npm --prefix app test -- --run src/pages/feed/feed.test.tsx
npm --prefix app run lint -- src/pages/feed
```

The recovery also passed the application's TypeScript check. Full application
build and browser checks belong to the repository handoff validation. No frontend
or backend production deployment is part of this source recovery.

## Reproduce the initial recovery

The committed files work without the ignored reference capture. To audit the
recovery, first obtain the pinned capture using the root README instructions,
then run:

```powershell
node app/src/pages/feed/recover-feed.mjs
```

This overwrites **only `FeedPage.jsx` and `feed.css` in this directory**. Do not run
it as installation or after making product edits: it intentionally restores the
historical recovered UI. It does not replace the typed helpers, callables, tests,
or application routing. Preserve future intentional changes in source control.

Recovery cannot restore original frontend authoring comments, original TypeScript
annotations, or development history. The JSX is maintained source reconstructed
from the deployed artifact; it does not claim to be the missing original TSX.
