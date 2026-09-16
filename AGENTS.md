# PoseTek website context

Read `POSETEK_PROJECT_CONTEXT.md` before working on this website. It records the
source version, project background, key files, release workflow, and review results.

`README.md` contains fresh-clone setup, preview, validation, and collaboration steps.

The shared website repository is `https://github.com/dk242/posetek_website.git`.
The user requires website changes to be committed here and the repository updated
for collaborators. Preserve teammates' commits, include required source and assets,
and update the handoff docs with confirmed project decisions. Keep generated output,
local reference captures, dependencies, and credentials out of Git.

The latest recorded production release is `6aaa2d81f7a768e5e5799ae1`, published
September 15, 2026 at 10:50:58 PM PDT. It includes the scrolling homepage and all
nine annotation updates. Read `deployment/ANNOTATION_UPDATE_PRODUCTION.json` for
the current receipt, `deployment/HOMEPAGE_ANNOTATIONS_2026-09-15.md` for the requested
changes, and `deployment/SCROLLING_HOMEPAGE_UPDATE.md` for recovery and earlier
release decisions. Continue from the source included in this repository.

At the initial September 15 review, GitHub main was older than the live homepage.
The user chose the deployed site as the reference. Recovered modules have provenance
beside their code; the other computer's original authored source remains unavailable.
The unchanged deployment `6aa9b6f0d8faf6177db8fd97` remains the tabbed comparison
reference and preserved-application baseline. On a fresh clone, run
`node scripts/capture-deployed-reference.mjs` before using either preview server.
The ignored capture lives in `.netlify/deployed-reference/6aa9b6f0d8faf6177db8fd97/`.

Run `npm --prefix app run build:marketing` and
`node scripts/serve-homepage-preview.mjs` to review current source at port 4174.
Run `node scripts/serve-deployed-reference.mjs` for the unchanged reference at
port 4173. The production build preserves 171 application/public assets byte-for-byte,
including `/application.html` and its navigation bridge. Keep the live-application
guard enforced and verify the baseline again before another release.

Homepage work primarily belongs in `app/src/pages/home/`; root `index.html`
contains the public entry and metadata. Use the latest applicable release notes,
preserve existing routes and data contracts, and treat mobile source as reference-only.

Update the context guide as the source discrepancy is resolved and new project
decisions are confirmed. Do not infer current offers or production behavior from
older experiment pages or historical test receipts. Preserve historical receipts
as records of their releases.
