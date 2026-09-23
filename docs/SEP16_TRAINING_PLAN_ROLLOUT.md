# September 16 testing cohort — active plans

All twelve canonical Vacaville participants who tested on September 16 now have
one reviewed active personalized plan each. Final readback was
`2026-09-18T01:24:20.280434Z` (September 17, 6:24 PM PDT). The user explicitly
authorized both generation and activation. See the
[sanitized activation receipt](../deployment/SEP16_TRAINING_PLANS_ACTIVATED.json).

The cohort was reconciled against the workbook’s September 16 coverage, original
local recording dates and current membership: six players on each of two teams.
Demo profiles and players who did not test that day were excluded. Generation used
each athlete’s current qualified results and existing coach eligibility. The
reviewed pilot was reused, and existing successful activations were preserved.

Each plan contains two weeks and two solo sessions per week: 48 workouts total.
Goals were left unchecked for automatic priorities, reviewed estimates were
enabled, and equipment was ball, cones, markers, goal, timer and wall. Sixty
minutes is a target with the inherited time tolerance; actual saved sessions are
60–66 minutes, including transitions. Conditional estimates remain labeled and
separate from measurements. General practice is identified as such, and a strong
test profile need not receive an invented weakness or technical diagnosis.

Seven profiles had no age. The user’s “same age as the others” guidance was
translated into planning age 15 for one player and 16 for six players. These
values are used only as planning inputs and in saved plans and their private
contexts. Independent checks
confirmed `ageSource=intake`, the intended U15–U16 eligibility band and unchanged
profiles. No birthday, recorded profile age or missing position was invented.
The other five used their existing recorded age sources.

The seven intake requests used the current frontend qualification and parameter
builders, the normal authenticated create-only pending-job contract, fixed
cohort IDs and durable job identities. Each exact returned draft was independently
reviewed before activation. A prior unused draft using the old methodology and
missing-age fallback was preserved in its entirety; it was not activated.

Final verification matched all twelve active public plans and private contexts
to their exact reviewed drafts, confirmed schema-3 compatibility and one atomic
activation per player, and found exactly one active plan under each canonical
player document. The original four completed activations remained unchanged.
Profiles, reps, sessions, reviewed estimates, workout logs and reservations are
unchanged. Only the expected activation schedule revisions advanced. Original
failed generation jobs and the older unused draft, view and context remain intact.

The existing invitation claim flow attaches the login to the same canonical
player document. Athlete web and native plan readers then query that player’s
active training plan. This rollout did not send invitations, claim accounts or
grant new access. It verified persisted data and reader/claim contracts, not an
installed-phone login. The separate invitation-interface rollout has its own
source, release boundary and acceptance checks.

Private identities, original snapshots, exact draft reviews, request hashes,
activation selections, preservation receipts and the coach summary remain in
the ignored `.netlify/sep16-plan-rollout/` directory. They are not included in
Git. Gateway rollback is independent of these saved data activations; never
delete athlete data, recordings, estimates, historical drafts or workout logs
to reverse a code release or change the active plan.
