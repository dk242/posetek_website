# Privacy policy rewrite — 2026-09-20

Branch `worktree-privacy-policy-2026-09`, implementation commit `fe6348b`, based on
`origin/main` `61ef7cc`. Merged into local `main` with `--no-ff` on 2026-09-20 at
Nolan's request. **Source only: not pushed, not deployed.** The live
`posetek.net/privacy` still serves the September 17 policy.

## What changed

Four files, all under `app/src/pages/privacy/`. Routes (`/privacy`,
`/privacy.html`), hosting fallbacks and inbound links are unchanged.

- `PrivacyPage.tsx` — the 13-section policy supplied for App Store Connect, with a
  contents list, per-section anchors and deep-link scrolling on the lazy route.
- `privacy-sections.ts` — section order, anchors, dates and contact email. The
  anchors are public; do not rename them.
- `privacy.scss` — contents card, sub-headings, nested list, anchor offset.
- `privacy-page.test.tsx` — rejects leftover `[[placeholders]]`, broken anchors and
  loss of the usage-measurement disclosure.

## How the draft's placeholders were resolved

Verified against code, not assumed (iOS `KickAI` `f775f21`; agent-gateway registry):

| Draft item | Finding | Policy text |
|---|---|---|
| Microphone, voice input | No audio or speech code; usage string is empty | Omitted |
| Notifications | No `UNUserNotificationCenter` or messaging | Omitted |
| In-app purchases | No StoreKit | "The app does not offer in-app purchases" |
| In-app account deletion | Not present on any pushed branch | Deletion by email only |
| Delete individual videos | Not present | Bullet removed |
| AI providers | Vertex AI (Gemini) by default; Anthropic for coach chat and plan checks | Both named |
| Other providers | Stripe webhook in `functions/`; Microsoft Clarity on public and legacy pages | Both disclosed |
| Usage retention `[[14 months]]` | Firestore TTL is 90 days detail, 24 months daily summaries | Real values used |

Carried forward from the September 17 policy (`706f103`), because
`docs/insights/EXPANDED_INSIGHTS_HANDOFF.md` relies on the privacy page documenting
it: estimated active-use collection, its visibility to club staff, and its retention.

Answered by Nolan on 2026-09-20: App Store name is "PoseTek"; under-13 accounts are
set up through the club after the club collects parental consent; address is
3618 Cameron Avenue, Pleasanton, California (no ZIP supplied).

## Worktree validation

The primary checkout was held by another live session, so work ran in
`.claude/worktrees/privacy-policy-2026-09`. The primary `app/node_modules` was
reused through a read-only symlink with caches disabled, then unlinked; nothing was
installed. Every package these files import matches this branch's lockfile version.

Passed, scoped to the privacy folder: vitest 6/6; `tsc --noEmit` (privacy folder and
`lib/use-theme-color.ts`); oxlint; sass compile; `git diff --check`.

**Not run:** the full test suite, `check:svelte` and the Vite build. The primary
install predates svelte, tailwind, three, threlte and clsx, which this branch's
`vite.config.ts` loads, and no `npm ci` was done because of the storage constraint.

## Primary integration

Nolan authorized ending the other session and merging. That session (an idle VS Code
tab, no uncommitted changes, stashes or worktrees) was ended with SIGTERM and released
its own claim; this session then acquired the primary through the guard hook. Local
`main` was 51 commits behind and was fast-forwarded to `origin/main` `61ef7cc`; the
worktree was detached and the branch checked out in the primary.

Re-run in the primary, all passed: vitest privacy folder 6/6; scoped `tsc --noEmit`;
oxlint on the privacy folder; `node --test scripts/home-navigation.test.mjs` 6/6.

`npm --prefix app test` was attempted and stopped at configuration load with
`ERR_MODULE_NOT_FOUND: Cannot find package '@sveltejs/vite-plugin-svelte'`. This is a
missing dependency on this machine, not a test failure, and it affects `origin/main`
itself: the install predates the 51 fast-forwarded commits. A dry run reports 144
packages to add. Nothing was installed because of the storage constraint, so the
merge rests on the scoped checks above.

## Pending

1. Full gate, once Nolan approves syncing dependencies
   (`npm --prefix app install --ignore-scripts --no-audit --no-fund`, 144 packages):
   ```sh
   npm --prefix app test
   node app/node_modules/typescript/bin/tsc -b app
   npm --prefix app run lint
   npm --prefix app run check:svelte
   npm --prefix app run build
   ```
2. Local `main` is ahead of `origin/main` by this branch and its merge commit only;
   it has not been pushed.
3. Going live needs a deliberate application release with explicit approval.
   Production preserves the `privacypage-*` bundles byte-for-byte from
   `deployment/homepage-baseline.json`, so neither a merge nor a push changes the
   live page. Follow `docs/VACAVILLE_WEBSITE_UPDATE.md#deliberate-application-release`.
4. Open for counsel: Section 7 (children's privacy), and whether Microsoft Clarity
   session analytics fits the "we do not track users" statements. Retention figures
   of 30 days, 90-day backups and 24-month inactivity are commitments taken from the
   draft and are not enforced by code today.
5. Apple guideline 5.1.1(v) expects in-app account deletion for apps with account
   creation; the app does not have it yet.
