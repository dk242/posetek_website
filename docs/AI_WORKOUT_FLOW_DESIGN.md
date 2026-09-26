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
