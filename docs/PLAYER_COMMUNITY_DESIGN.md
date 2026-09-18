# Player experience: reference lock

The user's September 17 implementation instruction preserves the current layouts,
containers, content order and familiar flows. The accepted functional plan still
adds Feed / Training / Drills / Coach / You navigation and community tools. Visual
polish must fit the current geometry; no wholesale redesign is authorized.

## Research and decisions

Refero's public style references were reviewed directly (the live Refero MCP is
not configured). Existing PoseTek screens remain the dominant reference.

| Decision | Reference | Role and adaptation |
| --- | --- | --- |
| Keep current dark green, Inter, rounded containers and density | Existing phone player/feed screenshots; explicit user instruction | Existing geometry and brand stay fixed. |
| Crisp lime action/selection treatment | [Refero .SWOOSH](https://styles.refero.design/style/604af0f7-b4c3-4921-93af-9da03df81493) | Borrow accent discipline, not promotional typography, full-bleed layouts or 6px radii. Retain PoseTek lime. |
| Distinct green surfaces and quiet borders | [Refero Assurestor](https://styles.refero.design/style/0ed40a3a-2541-4ffa-acdd-f1170858bc5d) | Borrow surface separation within existing cards; no new decorative panels or gradients. |
| Legible contrast and compact controls | [Refero Modal](https://styles.refero.design/style/68c15685-5db9-4869-b71d-27240568c9d8) | Keep a restrained dark UI and reserve vivid fills for actions. |
| Brief feedback and reduced-motion fallback | Refero bundled motion and craft guides | 120ms control feedback, 200ms result transitions; no looping effects, parallax or autoplay. |
| Stable chronological feed and chosen audiences | Official Strava feed ordering and Instagram Following references in the approved plan | Preserve reading position, explicit refresh and user-selected scopes. |

## Build target

Preserve `.pt-player` and `.social-app` layout, container dimensions, padding,
rounded corners and main content order. Enhance surface contrast, typography,
numeric alignment, selected icons, focus and action feedback. Existing athlete
recordings provide the imagery. No synthetic product evidence or new imagery is
needed. Functional additions use existing cards, details panels and overlays.

Tokens: canvas remains the existing #081e17 family, card #123329, active surface
#1d4335, lime #b7f34a, text #f6faf8, muted #b4c9bd and translucent green borders.
Errors keep their semantic error color. Do not apply lime to all headings or
turn every card into an attention-grabbing highlight.

## Validation target

Compare the player/profile, training, workout, feed, community settings and
comment states at 360/390/430px and desktop. Check existing geometry, readable
numbers, complete controls, soft-keyboard access, focus, no overflow and reduced
motion. Browser evidence and test results belong in the implementation handoff.
