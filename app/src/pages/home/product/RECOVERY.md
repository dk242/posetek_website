# Public Workout and AI Coach demo recovery

These components preserve the user's approved September 15 public homepage demos
from Netlify deployment `6aa9b6f0d8faf6177db8fd97`. The original authored source was
unavailable. The immutable published JavaScript and CSS were captured under the
ignored `.netlify/deployed-reference/6aa9b6f0d8faf6177db8fd97/marketing/assets/`.

The user requested each demo in its own scrolling section, retaining the newer
interface and interactions. This is the reference lock: published emerald/lime
palette, compact app panels, sample labels, time/energy/focus intake, review,
execution, summary, profile evidence, and coach question/answer progression.
No replacement design, invented product metrics, live AI calls, or data writes
were introduced.

## Source and boundaries

This section records the initial recovery. The later annotation release
`6aaa2d81f7a768e5e5799ae1` intentionally adapts the workout catalog and interface:
five examples reference mobile drills DRB-006, DRB-009, PAS-001, SHT-003 and SHT-004;
the sample opens ready to Start or Customize. The initial element-tree and catalog
equality claims below apply to the recovery checkpoint, not all subsequent edits.
See `deployment/ANNOTATION_UPDATE_PRODUCTION.json` at the repository root for the
latest release and `product-demo.test.ts` / `product-ui.test.tsx` for current checks.

| Published asset | Editable source |
| --- | --- |
| `WorkoutDemo-cLuzxzv9.js` | `WorkoutDemo.js`, `WorkoutDemo.d.ts` |
| `CoachDemo-B4XwZJSc.js` | `CoachDemo.js`, `CoachDemo.d.ts` |
| `product-demo-fcPr5ZHv.js` | `product-demo.ts` |
| `product-demo-BXeuUJ-U.css` | `product-demo.css` |

The components retain the exact published element tree as readable JSX-runtime
calls, with named component state and hooks. `recover-components.mjs` extracts
only the product functions and resolves symbol renames with the TypeScript
checker. Bundled React, motion internals, theme helpers, and Tailwind merge code
are excluded. Components import the project's one React runtime and existing
`MagicCard`, `BlurFade`, and `TacticalIcon` implementations. No deployed entry
bundle is imported or mounted.

The sample reducer/catalog was converted to typed TypeScript. Dose formulas,
field diagrams, labels, athlete values, answers, and timings are unchanged.
Work sets still require explicit completion, expired rest advances automatically,
paused/hidden/offscreen timers stop, and skipped demo time is identified in the
summary. The supplied time is an availability limit; the UI explicitly describes
the generated session as a shorter sample with warm-up/setup/cooldown additional.

## Integration

```tsx
<WorkoutDemo active={workoutVisible} initialRequest={request.text} requestId={request.id} />
<CoachDemo active={coachVisible} onOpenWorkout={openWorkout} />
```

Keep both mounted to retain progress across scrolling. `active` suspends timer or
typing updates. The coach handoff passes
`Help me plan 20 minutes of dribbling training.`; update `request.text`, increment
`request.id`, and navigate/focus the standalone workout section.

`requestId` is an intentional behavior extension to the recovered workout:
an explicit repeated handoff can start another 20-minute sample even when its text
matches the previous request. Ordinary visibility changes never reset progress.
The original deployed interface was `{ active?, initialRequest? }`.

The other long-page adaptation is `workout-focus.ts`: an intentional user stage
change focuses the next heading and scrolls it only as far as needed into view.
The existing user-intent flag remains authoritative, so timer ticks, rest expiry,
and ordinary visibility changes do not scroll. Reduced-motion users receive an
instant scroll. `workout-section.css` supplies a 110px scroll margin so the sticky
navigation does not obscure that heading.

Styles are scoped to `.pt-home`; import occurs within each component. The base
`product-demo.css` retains the deployed rule order and values, with formatting
changes only. The documented scroll-margin adaptation is in its own stylesheet.

## Verification

- `npm --prefix app test -- src/pages/home/product` exercises dose choices, legal
  review/start transitions, timer expiry and pause, skipped-time accounting, complete
  workout progression, sample evidence, initial rendering, handoff prefill, and SVG
  geometry. These tests are not browser/visual evidence.
- `verify-recovery.mjs` is a historical equality check against the initial pinned
  deployment. It checked 45 published dose combinations and reducer flows, plus
  exact coach data/CSS. It now rejects intentional catalog changes in the annotation
  release and is not a current acceptance command. It needs the ignored capture;
  ordinary production builds and tests do not. Use the tests above for maintained
  behavior; preserve the verifier as recovery evidence.
- `recover-components.mjs` is provenance tooling, not a build step. Rerunning it
  replaces the recovered UI files; preserve subsequent intentional source edits.

Visual and keyboard/timer integration must also be checked in the assembled
homepage at desktop and mobile widths, including a second identical coach handoff.
