# Player signup links

Player invitations claim an existing athlete profile. They do not create a new
roster entry, change results, move teams, or create a training plan.

Live release `6aac924a597bd46f15cf468a` was published September 17, 2026 at
6:31:29 PM PDT. The [production receipt](../deployment/PLAYER_INVITATION_LINKS_PRODUCTION.json)
records the five scoped callables, preserved 21 issued codes, browser acceptance,
and reconciled 612-file application baseline. Real recipient account creation,
redemption and verification-email delivery were not performed during acceptance.

## Staff workflow

In **Admin → Monitor accounts** or **Admin → Organizations → team**, each unclaimed
player's invitation is checked through an authorized backend reader.

- **Copy signup link** re-reads the current invitation and copies its link.
- **Copy code** re-reads the same invitation and copies just the code.
- **Generate code** appears only after the reader confirms a missing invitation.
  It creates one if still missing, or preserves one issued concurrently.
- Claimed accounts show existing-account sign-in guidance and no generation action.
- A failed or unauthorized read is an error, never evidence that a code is missing.
  A broken code/index mapping requires review; normal actions do not replace it.

Normal organization issuance now preserves an existing valid code. Explicit
`ensurePlayerSignupInvitation({rotate:true})` remains a deliberate backend
replacement operation for compatibility; these controls never request it.

## Athlete workflow

Copied links use `https://posetek.net/signin#playerCode=<code>`. The fragment is
not sent in the HTTP request. The sign-in page consumes it into temporary memory,
removes it from the address bar, opens **Create Account → Player**, and fills the
Player Code field. Previously returned `?playerCode=` links are accepted and
scrubbed too, although their initial HTTP request necessarily contains the query.
New links always use fragments.

The athlete enters email, password and password confirmation. A preflight rejects
missing, invalid, ambiguous, or used codes before creating an Auth account.
Signup sends the usual verification email and redemption atomically binds the
existing canonical player to the authenticated user. Successful invited signup
opens that player's `/athlete?player=<canonical ID>` page. Ordinary player signup
keeps its feed destination; ordinary login keeps its same-origin return behavior.
`/join` remains the coach/manager invitation route.

Preflight does not reserve a code. If a competing claim wins, the backend remains
authoritative. A lost redemption response is reconciled against the newly created
user's owned profile before cleanup. An uncertain outcome retains the new account
for a retry in the same open page; it is not deleted blindly. Account switches
are checked before claiming and before navigation. No existing signed-in account
is silently replaced or given a second athlete profile.

## Service and privacy boundary

- `getPlayerSignupInvitation({playerId})`: authenticated, authorized, read-only;
  returns `ready`, `missing`, or `claimed`. Only `ready` includes code and URL.
- `ensurePlayerSignupInvitation({playerId})`: authorized, preserves a valid current
  invitation or creates/migrates a missing protected invitation.
- `validatePlayerSignupInvitation({code})`: returns only a boolean; no athlete
  name, contact, UID, or code is returned. The lookup is read-only. Its separate
  abuse guard permits 60 checks per request IP per 15 minutes.
- Rate metadata uses a SHA-512 key in the already-private `admissionAttempts`
  collection. Records contain count, window start, operation kind and logical
  expiry only. No raw IP, code or athlete identity is stored. No TTL policy is
  added; expiry resets the counter but is not a claim of physical deletion.
- Protected invitation and uppercase-code hash index must agree on player ID.
  Legacy version-2 codes must match exactly one player; migration preserves bytes.
  Claimed accounts return no invitation even if stale fields exist.
- Invitation codes are excluded from shared roster/planner data, browser storage,
  application logs and session replay. The sign-in page does not load Clarity;
  staff code elements use its masking attribute. The application retains its
  no-referrer policy. Codes belong only in authorized staff UI and recipient links.

## UI reference and release boundary

This is a direct extension of the existing product: the sign-in modal, compact
Monitor accounts status controls, organization roster rows and invitation card
are the design references. Existing dark-green/lime styling, labels, keyboard
controls and mobile form attributes remain. The Refero craft references for
forms, focus and concise action copy informed the additions; no visual redesign
or marketing changes are included.

Deployment is limited to the reviewed invitation callables and deliberate website
artifact. No native source/rules, gateway, test records, player claims, invitation
rotation, athlete emails, or training plans are part of deployment verification.
Synthetic cases cover creation/redemption; real recipient codes are never redeemed
for testing. Private operator snapshots, codes, source archives and receipts stay
outside Git. See the accompanying production receipt for completed verification
and exact release versions.
