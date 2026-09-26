# Conversational workouts and shared player navigation

Design decision, September 25, 2026: retain the existing PoseTek player interface
as the visual reference. Use Inter, the dark green canvas, muted supporting text,
20px rounded cards, and lime for the primary action and selected tab. No new
image assets or external component library are needed. Refero's craft guidance
informs visible keyboard focus, explicit labels, 16px inputs, and 44px targets.

Training is the focused workout conversation. The opening question asks for the
athlete's focus and available time. Only missing conditions are requested.
Prescription cards show the calculated time, dose, rest and explanation. The
athlete changes these by messaging the AI, then explicitly publishes the reviewed
draft. Requested time is an approximate target, retaining the existing tolerance.

AI Coach uses the same generator and shows the actual server proposal. Its review
action opens that conversation in Training. The six equal bottom destinations
are Profile, AI Coach, Drills, Training, Community and Standings. Community uses
the same player shell; Activity, Find people and Sharing settings remain in a
content toolbar. Staff and scoped administrator previews keep their own access
boundaries. Safe-area padding and bottom clearance apply throughout.

Acceptance: inspect 360/390/430px and desktop, long messages, keyboard focus,
loading/errors, browser Back, private draft recovery, and workout pause/resume
across Community. Release evidence is recorded separately after verification.

## Local browser verification — September 25, 2026

The Vite preview at port 5187 was reviewed in Edge with synthetic `preview=1`
data. No real account or production workout was changed during this pass.

- Community and the workout conversation have no horizontal page overflow at
  360, 390 and 430px; the desktop layout retains the centered player content.
  All six bottom destinations remain visible in the confirmed order. At 360px,
  the targets measure approximately 56 by 53.5px, exceeding the 44px minimum.
- Community Activity, Find people and Sharing settings retain the bottom tabs.
  Browser Back restores the Activity panel. `/feed.html` aliases and the scoped
  administrator preview preserve their query context and read-only behavior.
- Opening AI Coach from an already mounted Personal workouts list, generating a
  workout, and selecting Review in Training opens that same draft with its
  prescription and publish action. Refinement retains the conversation.
- Two independent private drafts were created. Browser Back and Forward restore
  the matching request and prescription; returning to the Training URL without a
  conversation ID shows the Personal workouts list and removes the draft's
  prescription and Publish button. Forward restores the selected draft.
- Long user messages wrap normally with the speaker label above the message.
  The refinement field and Send changes button have visible 2px lime keyboard
  focus. In a reduced 390 by 480px browser viewport, the focused 52px Send changes
  target sits approximately 70px above the bottom navigation. This is a viewport
  and keyboard-focus simulation, not physical-device virtual-keyboard testing.

Ignored screenshots are in `.netlify/player-coach-review/`:
`community-navigation-{360,390,430}.png`,
`workout-conversation-{360,390,430,desktop}.png`, and
`workout-conversation-keyboard-clearance-390.png`. Production verification and
physical mobile acceptance remain separate release checks.

## Authenticated candidate acceptance — September 26, 2026

Candidate `6ab76982d74a19707a6f9d9a` uses website source `9b15c40` and the accepted
gateway `agent-gateway-sha-9639e76f5e3a`. A synthetic athlete created a standalone
workout with a 12-minute target; the calculated prescription was 8 minutes and
the conversation did not repeat already supplied intake questions. A rename
follow-up changed the title to **My Close Control Session**, preserving the drill
identities and dosage. Publish immediately opened the saved workout with Start.

After completing one of four sets, leaving for Community and returning to Training
restored the paused workout with 22 seconds elapsed, 48 seconds of rest remaining
and one of four sets complete. Save and finish produced **Finished** in Personal
workouts. These are browser interaction checks, not physical-phone lock or native
device acceptance.

An existing AI Coach prescription opened in Training with its original and
revision history, Published status and empty disabled revision composer. Sign-in
return preserved the AI Coach destination. Community Activity, People and Sharing
retained all six bottom destinations; browser Back restored the complete workout
conversation. The cold-URL regression harness also confirmed that a URL selecting
draft B cannot display previously stored draft A. Canonical proposals need no
redundant `playerId` field; server readback still validates owner, schema, checked
proposal, expiry format, conversation and any explicit scope.

The verified candidate was published September 26, 2026 at 12:31:38 AM PDT without
rebuilding. Its 1,048 artifact files match; the reconciled baseline protects 1,016
files. Production-alias synthetic sign-in returned to Training, showed the
Finished workout and earlier copy, and recovered the exact 12-minute target /
8-minute prescription and rename history. Community retained its six destinations,
Activity / Find people / Sharing settings toolbar and empty state. The account
was signed out after verification. A supplemental 390px production screenshot
uses `/feed?preview=1` sample data; it is not authenticated-account evidence.
Cleanup completed and independent scoped readback found zero remaining synthetic
accounts, documents or objects. See the
[release receipt](../deployment/CONVERSATIONAL_WORKOUTS_PRODUCTION.json).
