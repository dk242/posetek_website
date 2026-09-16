# Athlete viewer refinement — September 16, 2026

## Reference lock

Build target: the approved PoseTek scrolling homepage, with a recognizable
athletic male mannequin and a more legible interactive 3D stage. The approved
revision calls for a lean athletic silhouette, natural-looking torso and limbs,
and thinner tracking lines. Keep the dark green canvas, condensed athletic
headings, lime actions and restrained technical labels.

References reviewed:

- [Meta SAM 3D](https://ai.meta.com/research/sam3d/): body demonstration reviewed
  visually. Borrow continuous anatomical surfaces, clear body silhouettes and
  independent body/pose interpretation. Use Meta's licensed MHR template;
  do not describe template fitting as SAM image inference or a body scan.
- [Meta Momentum Human Rig](https://github.com/facebookresearch/MHR): the
  Apache-2.0 anatomical template supplies the continuous surface. Shape fitting
  remains illustrative and must keep the existing recorded landmarks fixed.
- [Brightline sprint photograph](https://www.brightline.org/resources/survive-then-thrive-four-ways-to-emerge-stronger-from-a-corporate-crisis/):
  reference the male athlete's full-stride silhouette and limb proportions.
- [Mick Hughes countermovement-jump sequence](https://www.mickhughes.physio/single-post/countermovement-jump-assessment-for-aclr-athletes):
  reference the appearance of an athletic figure across jump phases.
- [Orange & Black SoccerCast strike photograph](https://orangeandblacksoccercast.com/news-1/2023/2/21/ocsc-squeak-by-uci-to-move-to-2-0-in-preseason):
  reference the athletic silhouette and anatomy visible during a football strike.
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
| Continuous athletic male mannequin | Meta MHR + reviewed athlete silhouettes + user feedback | Improve anatomical proportions without replacing recorded poses |
| Thin primary lines and quiet detail | User's approved thinning revision | Keep the pose legible without heavy outlines or an oversized skeleton |
| Body + pose / pose-only modes | User's mesh and tracking brief | Let visitors understand the surface and underlying evidence |
| Grounded stage, soft contact shadow, restrained rim light | Meta spatial context + Spline lighting | Make depth and airborne position legible |
| Framed viewer with a compact tool strip | Existing PoseTek system + Refero hierarchy | Give controls a predictable home without crowding the figure |
| Front, side, reset views and drag orbit | Model Viewer camera patterns | Make the third dimension easy to explore |
| Existing recorded landmarks and held-pose timing | Source provenance and accepted prior revision | Preserve data while improving presentation |
| Local lazy-loaded geometry and on-demand rendering | Existing performance contract | Avoid new runtime services or private source uploads |
| Static fallback rendered from the actual fitted mesh | Approved visual consistency requirement | Replace the earlier thick SVG figure with the same anatomical silhouette |

The photographs guide anatomy and movement appearance only. They provide no new
coordinates, measured technique, body scan or identity, and are not redistributed
as website assets. The body remains an illustrative mannequin fitted around the
unchanged recorded landmarks.

For the recorded 2D viewer, use 1.5 px primary strokes, 1 px detail strokes and
uniform 1.5 px landmark dots. Remove the heavy outlines and torso fill while
retaining the quieter face presentation. Calibration, telemetry, measurement
overlays and source coordinates remain unchanged.

Static fallback images now render the actual fitted mesh with matching projected
tracking, replacing the earlier thick SVG body. Their source and asset hashes
are checked by `scripts/render-hero-fallbacks.mjs --check`. Higgsfield's
installation request is confirmed, but installation/connection completion is
still pending. No Higgsfield output has been used.

## QA target

Validate the complete figure from all camera presets in Shooting, Sprint and
Vertical jump; inspect athletic proportions, joint alignment, thin tracking,
materials, mode controls, crossfades, initial loading, offscreen restore and the
actual-mesh static fallback. Check the recorded 2D lines and metrics at
320/390/820px layouts. Keep the public application baseline and release workflow
intact.
