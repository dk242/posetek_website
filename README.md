# PoseTek website

Shared source repository: [dk242/posetek_website](https://github.com/dk242/posetek_website).
Public website: [posetek.net](https://posetek.net).

This repository includes the scrolling homepage, all nine annotation updates,
the clearer pose, training and technique experience, the mobile app showcase,
and approved Figure-8 / Wall pass demo videos with interactive coach metrics.
The public [Coaches page](https://posetek.net/coaches) adds a tailored club/team
service, interactive sample profiles, and a Plan / Train / Retest walkthrough.
Both pages share persistent Players / Coaches navigation.
The latest release was published September 17, 2026 as `6aab9fbaa73be75422324ba4`.
Start with [the project context](POSETEK_PROJECT_CONTEXT.md) and
[the latest production receipt](deployment/COACHES_PAGE_PRODUCTION.json).
Recovered homepage modules include provenance beside their source.

The two public drill clips and posters are committed in
`app/src/pages/home/product/media/`; ordinary builds need no Firebase access.
See [the drill and coach update](deployment/DRILL_VIDEO_COACH_UPDATE.md) for
media provenance, responsive behavior and the read-only preparation script.

**Feed source available:** the complete feed feature stack is now committed:
recovered editable React frontend, original deployed Firebase backend, typed API
contracts, rules, indexes, navigation and tests. See [the feed development
handoff](docs/FEED_SOURCE_HANDOFF.md) for setup and source locations. Run the Vite
dev server and open `/feed?preview=1` for sample content. Root `feed.html` is an
older mockup; use `app/src/pages/feed/` for iterations.

## Set up a fresh clone

Use Node.js 22.18 or later in the Node 22 release line and npm 10. Run from the
repository root unless stated otherwise:

```powershell
git clone https://github.com/dk242/posetek_website.git
cd posetek_website
npm --prefix app ci --no-audit --no-fund
node scripts/capture-deployed-reference.mjs
npm --prefix app run build:marketing
node scripts/serve-homepage-preview.mjs
```

Open http://127.0.0.1:4174 for players or http://127.0.0.1:4174/coaches for coaches.
The one-time capture downloads the pinned public
reference into the ignored `.netlify/deployed-reference/` directory. It needs
internet access but no Netlify credentials. It supplies the existing application
and static assets used by the local homepage preview. Rebuild marketing after
editing homepage source; this preview server does not provide hot reload.

For comparison, `node scripts/serve-deployed-reference.mjs` serves the unchanged
September 15 tabbed reference at http://127.0.0.1:4173. Normal marketing builds
use committed source and do not require the reference capture.

## Work in the right source

| Area | Location |
| --- | --- |
| Homepage sections, copy, styles and interactive demos | `app/src/pages/home/` |
| Public entry and metadata | `index.html` |
| Coaches page, fictional examples, and development journey | `app/src/pages/coaches/` |
| Coaches entry and metadata | `coaches/index.html`, `app/src/coaches-entry.tsx` |
| Shared public audience navigation | `app/src/pages/home/MarketingHeader.tsx` |
| Application routes and screens | `app/src/App.tsx`, `app/src/pages/` |
| Backend functions | `functions/` |
| Feed frontend, API contracts and provenance | `app/src/pages/feed/` |
| Feed backend and provenance | `functions/social.js`, `functions/social-projection.js`, `functions/SOCIAL_RECOVERY.md` |
| Production assembly and verification | `scripts/`, `deployment/` |
| Player behavior and data contracts | [docs/PLAYER_EXPERIENCE.md](docs/PLAYER_EXPERIENCE.md) |

For application development, run `npm --prefix app run dev` and use the URL Vite
prints. This serves the application source, which is a different build from the
isolated public homepage. Mobile source remains a reference for shared behavior.

## Validate homepage changes

```powershell
npm --prefix app test -- src/pages/home src/pages/coaches
node --test scripts/home-navigation.test.mjs scripts/production-baseline.test.mjs scripts/homepage-preview.test.mjs
npm --prefix app run check:svelte
node app/node_modules/typescript/bin/tsc -b app
npm --prefix app run build:marketing
```

Review both audiences, affected interactions, and responsive layouts in the local
preview. The [coaches handoff](deployment/COACHES_PAGE_UPDATE.md) documents sample
data, service decisions, and the application preservation boundary.

## Production build

```powershell
node scripts/build-production.mjs
```

This builds `production-dist/`, verifies the live application against
`deployment/homepage-baseline.json`, and preserves all 171 application/public
files from deployment `6aa9b6f0d8faf6177db8fd97`. A fresh build downloads and
checksums baseline assets and uses matching tracked HTML where the host rewrites
served pages; internet access is required. The build stops if the live application
has drifted. Reconcile a reviewed baseline instead of bypassing the guard.

`netlify.toml` uses this production command and publishes `production-dist/`.
The repository root, `marketing-dist/`, and the ordinary application `dist/`
are not the complete homepage release artifact. Application source changes are
not automatically included in this preservation-based homepage build.

The latest release was a manual Netlify draft promoted after validation. Preserve
that draft-review and verification workflow for future releases. A Git push may
trigger Netlify when Git builds are enabled; check the site's deployment status
when publishing source changes.

## Collaborate

Pull the latest `main` before starting and use a branch for new work. Commit
website source, required data/assets, tests, lockfile changes and updated handoff
documentation to this repository, then push the branch so others can use it.
Keep generated output, dependency folders, local captures and credentials out of
Git. Check `git status` before switching branches when local work is present.

The original authored source for parts of the September 15 deployment was not
available. The maintained recovered modules in this repository are the accepted
implementation; reconcile any later source recovery with them rather than
replacing the published behavior.
