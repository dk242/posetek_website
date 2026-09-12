# PoseTek homepage release — September 11, 2026

Published URL: https://posetek.net

Production deploy: `6aa4970dc2d4c6a011354bf2`

Validated preview: https://6aa49606d51fa8cda446ed83--posetek.netlify.app

Previous production deploy (rollback): `6aa1ac07fce9960008a92538`

## Content and design

The homepage follows **PoseTek Draft B — Test to Next Step**, supplied in the
September 10 Outlook email “PoseTek pitch videos — Draft A and Draft B.”
The public copy condenses the sequence: six tests, movement review, benchmarks
in an athlete profile, a focused training plan, and retesting. The private draft
video is not published. Existing recorded pose data and sample skill metrics
remain intact; sample athlete and training illustrations are labeled.

The existing dark green/lime identity now uses condensed athletic headings,
shorter sections, a clearer booking action, and responsive navigation.

- Magic UI's official Magic Card and Blur Fade registry components provide
  restrained highlights and section entrances. Source and MIT license are in
  `app/src/components/magicui/`.
- Threlte renders the decorative soccer ball/pitch in a Svelte island. It loads
  during idle time when visible, unmounts offscreen or in hidden tabs, and uses
  an SVG fallback for reduced motion or rendering failure.
- Jitter's official motion references informed timing and hierarchy. No verified
  installable Jitter skill was available; the approved reference-based fallback
  was used.

Installed skills: `magicuidesign/magicui` (`skills/magic-ui`, main) and
`kjanat/skills` (`skills/threlte`, master), under the user's Codex skills directory.
Jitter reference: https://jitter.video/
Magic UI source: https://magicui.design/docs/components/magic-card
Threlte reference: https://threlte.xyz/docs/learn/basics/getting-started

## Application preservation

The workspace was fast-forwarded to current main, source commit
`a99362b75ae5930553e4673bf0f742fe1183755e`, before applying homepage changes.

The release builds an isolated public entry from root `index.html` and
`app/src/home-entry.tsx`. `scripts/build-production.mjs` verifies and preserves
all 157 existing deployed files using `deployment/homepage-baseline.json`.
Original file bytes are preferred because Netlify's pretty-URL processing
rewrites some served HTML. Windows CRLF normalization is accepted only when
the resulting bytes match the original checksum.

The previous application entry is served as `/application.html`, with a small
navigation bridge that enters the new homepage when an application link or
browser history returns to `/`. App routes and legacy pages retain their
existing code. Root `/` and `/index.html` serve the new homepage. Marketing
bundles live under `/marketing/assets/`.

This build intentionally freezes the application for this homepage release.
**Future application changes must update the baseline from a validated deploy,
or deliberately integrate the marketing entry into the normal application
build.** Editing application source alone will not change the preserved app.
The production guard fails if the published application no longer matches the
baseline. The default application development/build commands remain available.

## Validation

- TypeScript build passed; Svelte check: 0 errors and 0 warnings.
- Existing homepage/pose logic tests: 43 passed.
- New navigation bridge tests: 6 passed, including history and back-forward
  cache restoration.
- Preview and live HTTP checks: 2 homepage routes, 22 application routes, 63 script/style
  assets, and checksums for all 157 preserved files passed.
- Browser checks in Edge: homepage, test cards, analysis, athlete profile,
  training; widths 390, 768, 1024, and the normal desktop viewport fit without
  horizontal overflow. Mobile menu opens/closes, Escape restores focus,
  section selection closes the menu, drill selection and keyboard scrubbing
  work, skill selection updates metrics, and the 3D renderer stops offscreen.
- Booking form, sign-in page, return-to-home link, and personalized-program
  sign-in gate loaded without browser warnings or errors. No booking, payment,
  or authenticated data write was performed.
- Live homepage verified after publishing: correct Draft B headline, six test
  cards, booking links, active Threlte renderer, and no console errors.
- Static reduced-motion and renderer-failure handling were reviewed; those
  device conditions were not simulated in the browser.
- One existing upstream Magic Card lint warning remains for its theme-mount
  effect. Vite reports large chunks; the largest 3D chunk is loaded lazily.

Reproduce the release checks:

```sh
npm --prefix app ci
node scripts/build-production.mjs
npm --prefix app run check:svelte
npm --prefix app test -- src/pages/home/home-logic.test.ts src/pages/home/pose-demo.test.ts
node --test scripts/home-navigation.test.mjs
node scripts/test-production-entry.cjs https://posetek.net --http-only
```

Deployment uses the verified `production-dist` directory with
`netlify deploy --prod --dir production-dist --no-build` on the existing
PoseTek site. No backend, functions, authentication rules, or database changes
are part of this release.
