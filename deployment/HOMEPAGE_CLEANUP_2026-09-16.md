# Homepage cleanup — September 16, 2026

## Approved direction
Preserve PoseTek's dark green canvas, lime actions, condensed display type, recorded evidence and scrolling layout. The profile component and its data stay unchanged; only the surrounding section number changes.

Section order: Tests → Player profile → Training → AI Coach → Technique → closing invitation. The hero question is “What should the player train next?”

## References and implementation decisions
- Existing PoseTek homepage owns palette, type, spacing and brand treatment; Refero motion and craft guidance informs clear focus states, uniform media sizing and progressive disclosure.
- Mobile reference: athelyticsOG/posetek-mobile-app main at 98d8a051f0580785b70610f5c1a29a5246e08bfb, verified against remote main. Its dirty local checkout was not modified. Saved professional phases overlay the player in one projection. Website data lacks professional ball boxes, so the display uses plant-foot anchoring and uniform torso scaling, with direction mirroring as needed. No joint deformation or invented moving professional sequence.
- Coach Board (https://www.coachboard.app/sports/football) informs distinct player, ball and movement paths.
- Coachbetter (https://www.coachbetter.com/solutions/for-coaches) informs session hierarchy and concise drill instructions. No third-party media is redistributed or service integrated.
- User confirmed recorded camera views for all six playbacks, pose-over-pose technique comparison, Setup → Movement → Finish drill demonstrations and renumbering the unchanged profile section.

## Viewer behavior
The hero contains the recorded skeletons only. Manual selection or orbit temporarily suspends automatic motion, which resumes after 1.5 seconds of inactivity, with a fresh six-second pose hold. Visible pause/play, mesh-layer and camera-preset buttons are removed. Reduced motion and offscreen suspension remain. Existing MHR source and historical assets are retained for provenance but are not imported into the current homepage renderer.

The six 2D recordings use one aspect-correct uniform fit per complete rep, including recorded markers and ball bounds. Canvas dimensions follow their card rather than determining its minimum width. This preserves full motion and calibration context: long sprint/dribbling runs necessarily show a smaller athlete than stationary tests. All original coordinates, saved values, timestamps and calibration remain unchanged. Markers are available for Sprint, Dribbling and Shooting only.

Technique displays one saved cue and measurement at a time. The ghost reference appears at Backswing and Contact; Follow-through explicitly has no saved reference. Additional measurements and joint inspection are available under Explore details. Training diagrams are illustrative instructions, not measured motion; optional animation follows the same paths as the diagram and stops offscreen. AI Coach retains full answers/evidence under an expandable explanation.

## Validation and release
Use the guarded production build and preserve all 171 application/public baseline files. Validate six recordings across full coordinate bounds and start/middle/end visual states, all three hero poses, every coaching stop and five drill diagrams, responsive layouts, keyboard interaction, reduced motion and fallback. Publish a reviewed draft unchanged and record its ID, checks and rollback in HOMEPAGE_CLEANUP_PRODUCTION.json. Commit source and handoff documentation to the shared repository; exclude build output and local captures.
