# Player mobile parity — 2026-09-11

Status: code complete; automated/source and localhost HTTP checks passed;
interactive browser and signed-in cross-client acceptance outstanding.

Scope: player Profile, AI Coach, Drills, Training and Leaderboards. Coach/admin
workflows stay on their existing routes. No web capture/processing, mobile source
changes, simulator work, dependency installs, remote push or deployment.

Source branch: `player-mobile-parity`, based on website `a99362b`.
Reviewed mobile source: `ead16a88b5fb1880c28d1f3c46c579c7900542c6`.
Architecture and upkeep: [Player experience](../docs/PLAYER_EXPERIENCE.md).

## Passed

- `npm --prefix app test`: 33 files, 628 tests passed, including 29 new player
  checks. The player subset was rerun after the final player UI adjustments.
- `npm --prefix app run build`: TypeScript and production Vite build passed;
  existing Firebase bundle size warning remains. Legacy assets copied normally.
- `npm --prefix app run lint`: exit 0, no errors. React hook/purity/ref/fast-refresh
  warnings exist in both existing and new components; this is not a warning-free
  lint claim.
- `npm --prefix app run check:player-parity`: 11 reviewed mobile sources match;
  bundled benchmark JSON is byte-identical.
- `git diff --check`: passed.
- Development server `http://127.0.0.1:5173/athlete?preview=1`: HTTP 200.
- Production server `http://127.0.0.1:4173/athlete?preview=1`:
  `node scripts/check-player-localhost.mjs` passed 9 route responses and byte
  comparisons for all 63 JavaScript/CSS assets against the production build.
- Available storage stayed at approximately 11 GiB. Existing web dependencies
  and build location were reused.

## Outstanding verification and observed runtime limits

Browser setup failed with `Importing module "node:process" is not allowed in
node_repl`. The supported Computer Use fallback failed with `Computer Use could
not load @oai/sky from the cua_node runtime`. No visual screenshots, browser tap
flows, viewport overflow checks or signed-in Firebase mutations were performed.
Server-render tests and HTTP responses are narrower checks, not browser evidence.

Local server binding initially failed with `listen EPERM 127.0.0.1:5173` in the
sandbox. The normal approved execution path permitted the localhost development
and production preview servers and their read-only HTTP checks. This did not
resolve the separate browser-runtime failures. No automatic approval rejection
occurred, and no browser-runtime restrictions were bypassed.

Still run the browser acceptance sequence in `docs/PLAYER_EXPERIENCE.md`, then
verify a test player's web/mobile log interoperability, generation/reconnect,
proposal save/start, AI history/memory, published video loading, saved analysis
and unchanged staff entry points. These checks remain pending; this receipt is
not production acceptance or a deployment record.
