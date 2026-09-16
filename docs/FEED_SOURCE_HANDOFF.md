# Live feed source gap

Verified September 16, 2026 against GitHub `main` at `3f7ecd2` and the public
assets served by [posetek.net/feed](https://posetek.net/feed).

## Why the live feed is missing from the repository

The live application was newer than the source checkout used for the homepage
work. Homepage releases preserve the existing compiled application, including
its feed, using `deployment/homepage-baseline.json`. They do not rebuild that
application from `app/src/`. The homepage source handoff therefore did not recover
or synchronize the live feed's original authored source or backend.

- Root `feed.html` is an older standalone mockup with `mockFeedData`; it is not
  the feed currently served by `/feed` or `/feed.html`.
- `app/src/App.tsx` has no feed import or route. The live application bundle has
  both `/feed` and `/feed.html` routes loading a `FeedPage` component.
- `app/scripts/copy-legacy.mjs` still copies the old mockup in ordinary application
  builds. Building that application is not proof of parity with the live feed.
- The preservation manifest includes `/assets/feedpage-cm50ztlq.js` and
  `/assets/feedpage-iidu16n6.css`. These files are compiled release assets, not
  editable React/TypeScript source checked into the repository.
- None of the fetched website branch tips/history or the two alternate website
  checkouts listed in `POSETEK_PROJECT_CONTEXT.md` contained the original feed
  module. This does not establish that it is absent from the publishing computer
  or another repository.

## Code available for inspection now

The client JavaScript and CSS are public and can be inspected by the app engineer:

- [Live feed JavaScript](https://posetek.net/assets/FeedPage-Cm50ZtLq.js)
- [Live feed CSS](https://posetek.net/assets/FeedPage-IidU16n6.css)
- [Live application router bundle](https://posetek.net/assets/index-UE68KFeB.js)
- [Sample feed preview](https://posetek.net/feed?preview=1)

At verification, all three bundles matched the unchanged September 15 reference
deployment `6aa9b6f0d8faf6177db8fd97` byte-for-byte. The immutable equivalents are
under `https://6aa9b6f0d8faf6177db8fd97--posetek.netlify.app/assets/` using the same
filenames. Their SHA-256 values are:

| File | SHA-256 |
| --- | --- |
| `FeedPage-Cm50ZtLq.js` | `ad8911444f7a33feb55162a9cf524b57b829b331e938162cad92b99198addce4` |
| `FeedPage-IidU16n6.css` | `1c186367afe64ff15227a5c06950195f1e8fbe1a62dbc2ec40e4fdde1715af1f` |
| `index-UE68KFeB.js` | `a83a615dd4687c458050dc5c0466fb9a73b71daec7c1eef3be5492a6571ed7a3` |

`node scripts/capture-deployed-reference.mjs` downloads these into the ignored
`.netlify/deployed-reference/6aa9b6f0d8faf6177db8fd97/assets/` directory. Formatting
a bundle makes its client logic readable, but does not recover original names,
types, source organization, tests, or server implementations. The old mockup and
the compiled client are not a complete implementation handoff.

## Required original source

Recover and commit the authored `FeedPage` module, its styles and helpers, route
and navigation integration, tests, and the associated Firebase backend changes
from the checkout used for the feed deployment. Reconcile them with current main
while retaining the accepted homepage changes.

The published client references the following callable function names. Their
implementations are absent from the current repository's `functions/` directory:

```text
getSocialActivity
getSocialAdminDirectory
getSocialComments
getSocialContext
getSocialFeed
getSocialMedia
getSocialPeople
moderateSocialActivity
reportSocialActivity
saveSocialComment
saveSocialPreferences
setSocialKudos
setSocialVisibility
socialConnection
```

These names are evidence from the client, not a verified server API specification.
Include the original function exports, implementation modules, relevant rules,
indexes, schemas, and tests in the source handoff. Public browser bundles cannot
recover server-only access checks or data-generation behavior.

Source parity remains unresolved. Publishing the older application build or
changing the preservation baseline does not resolve the missing-source problem.
