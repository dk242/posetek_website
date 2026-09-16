# Athlete viewer refinement — September 16, 2026

## Reference lock

Build target: the approved PoseTek scrolling homepage, with a materially better
anatomical figure and a more legible interactive 3D stage. Keep its dark green
canvas, condensed athletic headings, lime actions and restrained technical labels.

References reviewed:

- [Meta SAM 3D](https://ai.meta.com/research/sam3d/): body demonstration reviewed
  visually. Borrow continuous anatomical surfaces, clear body silhouettes and
  independent body/pose interpretation. Investigate Meta's licensed MHR template;
  do not describe template fitting as SAM image inference or a body scan.
- [Spline web experiences](https://spline.design/solutions/3d-web-experiences):
  borrow deliberate scene framing and lighting that gives the central subject
  depth. Retain PoseTek's identity rather than importing its typography or palette.
- [Model Viewer staging](https://modelviewer.dev/examples/stagingandcameras/):
  explicit camera control, a stable subject target, clear recenter action, and
  browser-native scrolling around the model.
- Refero Design bundled motion and craft guidance: fast control feedback,
  continuity between views, visible keyboard focus and accessible touch targets.

## Decision ledger

| Decision | Reference / constraint | Purpose |
| --- | --- | --- |
| Continuous anatomical body | Meta body demonstration + user feedback | Replace the segmented mannequin silhouette |
| Body + pose / pose-only modes | User's mesh and tracking brief | Let visitors understand the surface and underlying evidence |
| Grounded stage, soft contact shadow, restrained rim light | Meta spatial context + Spline lighting | Make depth and airborne position legible |
| Framed viewer with a compact tool strip | Existing PoseTek system + Refero hierarchy | Give controls a predictable home without crowding the figure |
| Front, side, reset views and drag orbit | Model Viewer camera patterns | Make the third dimension easy to explore |
| Existing recorded landmarks and held-pose timing | Source provenance and accepted prior revision | Preserve data while improving presentation |
| Local lazy-loaded geometry and on-demand rendering | Existing performance contract | Avoid new runtime services or private source uploads |

The body remains illustrative, fitted to recorded landmarks; the reference image
does not establish a calibrated surface or identity. Higgsfield was discovered
but was not connected when this pass began; do not claim its output was used.

## QA target

Validate the complete figure from all camera presets in Shooting, Sprint and
Vertical jump; inspect anatomy, joint alignment, materials, mode controls,
crossfades, initial loading, offscreen restore, static fallback, and 320/390/820px
layouts. Keep the public application baseline and release workflow intact.
