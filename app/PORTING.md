# PoseTek React port — conventions

The legacy site is ~50 hand-written HTML pages at the repo root. This app ports them
page by page. Unported pages are copied verbatim into `dist/` by
`scripts/copy-legacy.mjs`; ported pages are listed in that script's `PORTED` set so
their URLs fall through to the SPA and are served by React Router.

**The goal of a port is behavior parity, not redesign.** Same markup structure, same
class names, same Firebase reads/writes, same URL/query-param handling.

## Layout

- `src/pages/<page>/<Name>Page.tsx` — one folder per page, plus its SCSS and any
  page-private components/helpers. A page owns its folder; never edit another page's
  folder or the shared files (`App.tsx`, `lib/`, `styles/base.css`).
- `src/lib/firebase.ts` — the ONLY Firebase entry point. Import `{ auth, db, storage, cloud }`.
  It uses the **compat API** (`firebase/compat/*`), so legacy code like
  `db.collection("players").doc(id).get()` ports unchanged. Do not switch to the
  modular API in this phase.
- `src/lib/benchmarks.ts` — ported `PoseTekBenchmarks` (done).
- `src/components/athlete-stats/AthleteStats.tsx` — shared `<AthleteStats>` component +
  `buildProfile()` (contract in the file header).
- Chart.js: `import Chart from "chart.js/auto";`

## Routing / URLs

- Every page answers on its clean route AND its legacy `.html` path (aliases in
  `App.tsx`, already wired). Query params (`?share=`, `?player=`, `?returnTo=`,
  `?view=`, `?drill=`) must keep their exact legacy meaning — links are in the wild.
- Internal navigation between PORTED pages uses clean routes via `useNavigate`/`<Link>`
  (e.g. `/roster`, `/athlete`, `/signin`), preserving query strings where the legacy
  page did. Links to UNPORTED legacy pages keep their `.html` href as a plain `<a>`.
- Legacy `history.replaceState` URL-sync logic may be kept as-is (it composes fine
  with React Router) or use `useSearchParams` — whichever gives closer parity.

## CSS scoping (mandatory)

All page styles are GLOBAL once bundled, and legacy stylesheets collide (bare `body`,
`h1`, shared class names). Therefore:

1. Page styles live in `src/pages/<page>/<page>.scss`, imported by the page component.
2. Wrap the ENTIRE legacy stylesheet in the page root class:
   ```scss
   .pt-<page> {
     /* legacy CSS pasted here, adjusted: */
     /* html, body  -> replace with plain `&` (or merge into the wrapper) */
     /* :root vars  -> declare on `&` */
     /* body.foo    -> `&.foo` */
   }
   ```
3. Hoist `@font-face`, `@keyframes`, and `@import` OUT of the wrapper to top level.
4. The page component's root element carries `className="pt-<page> …any legacy body classes…"`.
   Code that toggled classes/attributes on `document.body` toggles them on the page
   root instead (via state). Full-viewport layouts: the wrapper gets `min-height: 100vh`
   plus whatever `body` had.
5. Fonts: Inter + Material Symbols Outlined are loaded globally in `index.html`; do
   not re-add their `<link>`s. Other Google Fonts a page needs: add via SCSS
   `@import url(...)` at the top of the page's SCSS file (outside the wrapper).

## Porting rules

- JSX auto-escapes text — drop legacy `escape()` calls when interpolating in JSX.
  NEVER use `dangerouslySetInnerHTML` to shortcut a port; rebuild markup as JSX.
- Legacy string-template rendering becomes components/state. Legacy event wiring
  (`addEventListener`) becomes React props/effects. Chart.js and canvas/video viewer
  code keeps imperative logic inside `useEffect`/refs with proper cleanup (legacy
  `destroy()` calls map to effect cleanup functions).
- Keep pure logic (metric math, grouping, formatting, parsing) in plain exported
  functions (in the page folder or `src/lib/`) — NOT inside components — and add
  vitest tests for it in the same folder (`*.test.ts`). Mirror legacy numeric output
  exactly (units, `toFixed` digits, em-dash placeholders).
- Firestore/Storage/Functions calls: keep collection names, field fallbacks, query
  shapes, and error messages byte-identical. Auth redirects: unauthenticated users go
  to `/signin?returnTo=<encoded current path+search>` (legacy: `kickai.html?returnTo=`);
  the sign-in page must honor `returnTo` exactly like kickai.html does.
- Third-party scripts embedded in a page (e.g. Microsoft Clarity on kickai.html) are
  injected from a `useEffect` in that page only — not globally.
- TypeScript: strict mode is on. Firestore document data may be typed loosely
  (`Record<string, any>` / `any`) — parity beats type ceremony — but exported pure
  functions get real signatures. `tsc` must pass with zero errors.

## Accepted deviations (reviewed, deliberate)

- Unknown URLs return HTTP 200 with the React 404 page (SPA fallback); legacy
  Firebase Hosting returned a real 404 status. Revisit only if SEO requires it.
- Microsoft Clarity, once injected on a page that uses it, keeps tracking for
  the rest of the SPA session (scripts cannot be unloaded).
- Minted share links keep the documented legacy `.html` shapes
  (`profile.html?share=…`, `broadJumpPage.html?share=…`); the SPA serves those
  paths through its alias routes.

## Verification (every port task)

- `npx tsc -b` from `app/` — zero errors.
- `npx vitest run --dir src/pages/<page>` (or the lib folder you touched) — green.
- Do NOT run `vite build`, `npm install`, or any git command — the orchestrator does.
