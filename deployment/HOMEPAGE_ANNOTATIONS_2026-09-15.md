# PoseTek browser annotations — September 15, 2026

All nine saved comments were read from the original Codex browser preview at
http://127.0.0.1:4174/. Send did not complete, so they were recovered from the
numbered pins, their comment boxes, and their blue highlighted targets.
Spelling in the quoted comments is preserved. Target descriptions are an
interpretation of the visible selection. All nine changes are now implemented
and published in deployment `6aaa2d81f7a768e5e5799ae1`, September 15, 2026,
10:50:58 PM PDT. The quotations below preserve the original requests.

On the user's follow-up, the full text of the longer original comment boxes
(2, 4, 5, and 6) was reopened and checked against this transcript. The complete
editable text, including the content outside the small visible scroll area,
matched the quotations below. No additional sentences were missing.

## 1. Hero art label 33 KEYPOINTS / FULL PERSPECTIVE. Separate from the 33 / Tracked joints metric.

> We can take out the 33 key points perspective text

## 2. Entire six-tests assessment section.

> This section of the page can be combined with movement analysis where we need to come up with a creative way to shows the six tests and their descriptions along with the visuals

## 3. Entire movement analysis section.

> Check comment two for the change on this page.

## 4. Entire technique analysis section: The rep. The detail. The difference., including the kick demo.

> For this page please check the repo posetek-mobile-all on the main branch to see how the movement analysis actually transpires as we need to have the video play forwards stopping at the key moments that you have already but show the instances of improvement along with the better professional rep.

## 5. Workout planner heading, supporting copy, and interactive training demo.

> I fee like the interactive demo can pull from better examples and have better visuals displaying the workout planner

## 6. Entire AI Coach section; combine with Train. Retest. See what changes. and place at the end.

> This should be the last slide along with the train retest, see what changes as it displays the improvement and trends. Find a way to combine these two sections of the page

## 7. Technique demo’s Compare reference phase button.

> The icon to the left of compare needs to be cleaner

## 8. Hero eyebrow FOR CLUBS, COACHES, AND PLAYER’S.

> needs to say players not player's

## 9. The Test → Review → Compare → Train → Retest journey bar currently below the six-test cards; move it above the tests section.

> This should be above this section as that makes more sense

## Existing separate copy revision

Seven section descriptions in `app/src/pages/home/HomePage.tsx` were already
shortened from 168 to 105 total words. That revision is local, built, and checked;
it was incorporated into the published annotation update, including merged sections.

## Implementation context

- The hero label in comment 1 is `33 KEYPOINTS / FULL PERSPECTIVE`, distinct from
  the separate `33 / Tracked joints` metric.
- Comment 8 explicitly supersedes the historical instruction to use `player’s`.
- Comments 2 and 3 refer to `#tests` and `#how-it-works` together.
- Comment 4 is attached to `#technique`, despite calling it movement analysis.
  The requested mobile repository is a reference; preserve existing contracts.
  Keep the existing key stopping moments, show the video playing forward, and
  preserve the request to show "instances of improvement" alongside the better
  professional rep. Do not narrow that wording to generic coaching suggestions.
- Comment 5 is attached to `#training`, not the athlete profile.
- Comment 6 is attached to `#ai-coach` and references combining it with `#retest`.
- Comment 7 highlights the technique demo’s `Compare reference phase` button.
- Comment 9 highlights the journey row below the six-test cards. “Above this
  section” is understood as above the tests section; keep this spatial context
  with the user's exact wording.

## Completed implementation

- 1 and 8: removed only the art keypoints label and corrected “players”.
- 2 and 3: six descriptive choices control one recorded replay. Selection follows
  carousel navigation too. Mobile choices appear above the replay.
- 4: Start, quarter-speed playback, four exact stops, Continue, Replay, joint
  highlights, saved measurements/cues and static professional phase references.
  Both contact cues share frame 472 without replaying; manual controls remain.
- 5: ready-made plans with Customize/Start, five mobile-catalog drill examples,
  individual setup diagrams, work/rest timing, pause, summary and sample labels.
- 6: AI Coach and retesting share the final product section. Existing result
  trends and next-focus questions remain; planner handoff scrolls upward.
- 7: comparison uses an aligned split-panel outline icon.
- 9: journey bar precedes tests; section numbers and anchors are coherent.

Validation: 87 homepage tests, 11 navigation/baseline tests, TypeScript, Svelte
(zero diagnostics), guarded build, desktop/mobile browser checks and hosted
draft/live HTTP verification passed. See `ANNOTATION_UPDATE_PRODUCTION.json`.
