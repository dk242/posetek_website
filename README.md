# PoseTek website

Shared source repository: [dk242/posetek_website](https://github.com/dk242/posetek_website).
Public website: [posetek.net](https://posetek.net).

This repository includes the scrolling homepage and all nine annotation updates
published on September 15, 2026 as deployment `6aaa2d81f7a768e5e5799ae1`.
Start with [the project context](POSETEK_PROJECT_CONTEXT.md) and
[the latest production receipt](deployment/ANNOTATION_UPDATE_PRODUCTION.json).
Recovered homepage modules include provenance beside their source.

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

Open http://127.0.0.1:4174. The one-time capture downloads the pinned public
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
| Application routes and screens | `app/src/App.tsx`, `app/src/pages/` |
| Backend functions | `functions/` |
| Production assembly and verification | `scripts/`, `deployment/` |
| Player behavior and data contracts | [docs/PLAYER_EXPERIENCE.md](docs/PLAYER_EXPERIENCE.md) |

For application development, run `npm --prefix app run dev` and use the URL Vite
prints. This serves the application source, which is a different build from the
isolated public homepage. Mobile source remains a reference for shared behavior.

## Validate homepage changes

```powershell
npm --prefix app test -- src/pages/home
node --test scripts/home-navigation.test.mjs scripts/production-baseline.test.mjs
npm --prefix app run check:svelte
node app/node_modules/typescript/bin/tsc -b app
npm --prefix app run build:marketing
```

Review affected interactions and responsive layouts in the local preview.

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
