# Instep (laces) drive — biomechanical model and coaching evidence

Corpus of record for the `kick_analysis` capability. Authored in-repo from a 2026-08-03 literature
sweep; unlike the drill-matrix assets there is no upstream workbook, so this file is edited here
directly and reviewed like code. Evidence grades: **established** (multiple independent studies
agree), **probable** (consistent but thinner), **contested** (the literature genuinely disagrees),
**single-study**.

Reading this against our metric table: `knee_angle` / `hip_angle` are **interior** angles where
180 = fully straight, so a source's "55° of knee flexion" is ≈125° here. `trunk_lean` is positive
**toward the target**, so the skilled backward lean is **negative**. All `*_x` offsets are positive
toward the target; all `*_y` offsets are positive upward.

---

## 0. Measurement guardrails — read before trusting any number below

These are the limits of what our single sagittal camera and 2D pose pipeline can honestly claim.
Several of them contradict things it would be natural to say from the metric table alone.

1. **Prefer the pro-clip comparison to absolute literature thresholds.** No study validates
   markerless 2D sagittal pose against 3D motion capture *for kicking*. Adjacent-task errors run
   roughly 4° hip / 5.6° knee / 7.4° ankle. Absolute angles here may carry a systematic offset, so
   an athlete-vs-pro **delta** measured through one pipeline is more trustworthy than either
   absolute value against a published mean. Angle conventions also differ wildly between studies
   (published "max knee flexion" appears as 93°, 96°, and 118° for the same event).
2. **Never coach "you pulled out of the kick" from a pre-contact slowdown.** The classic finding
   that the shank decelerates just before impact is largely a *filtering artifact*: it disappears
   at 1000 Hz and is reproduced on demand by downsampling to 250 Hz with a 10 Hz low-pass. Our
   pipeline is exactly the kind that manufactures it. Treat `peakShankAngularVel` timing near
   contact as low-confidence.
3. **Contact is not resolvable.** Foot–ball contact lasts 9.0±0.4 ms — between 0.3 and 2.4 frames
   depending on capture rate. Our "contact frame" is really the last pre-contact frame. Never infer
   in-contact ankle rigidity, contact duration, or strike location to millimetre precision; the
   foot moves several centimetres between frames.
4. **The pelvis's decisive event is ~50 ms before contact** — about 12 frames at 240 fps but only
   3 at 60 fps. Downgrade confidence in any near-contact angular-velocity claim on slower captures.
5. **Sagittal capture cannot measure** approach angle, pelvic *transverse* rotation, hip–shoulder
   separation, lateral trunk inclination, or lateral plant-foot offset. Where this corpus quotes
   values for those (the 27–37 cm lateral plant band, the 38–42° tension-arc separation, the 30–45°
   approach), they are **context for interpretation, never fault signatures**. In particular
   `hip_openness` is a weak sagittal proxy for pelvic rotation, not a measurement of it.
6. **Effect sizes in this literature are small.** The strongest single knee-kinematic correlate of
   real kicking distance is r = 0.283 — about 8% of variance. Frame any single-metric deviation as
   a *candidate contributor*, never a cause. Trust multi-metric patterns over any one row.
7. **Youth norms here are elite academy boys.** The U9–U20 series is Brazilian academy players.
   A recreational ten-year-old compared against it will look deficient at almost everything. Use
   the age trend and the *shape* of the pattern, not the absolute value, for a non-academy athlete.
   The two youth sources also disagree by ~40% on ball/foot ratio (1.10 vs 1.54), so treat that
   metric's youth values as unsettled.
8. **Normalize by stature before judging any speed or distance.** Absolute foot speed, stride
   length and COM excursion compared against adult templates guarantee that every smaller athlete
   reads as deficient. Prefer the height-normalized form wherever one exists.
9. **The professional reference clip is a male right-footed kicker.** Sex differences are
   documented in trunk lean sign, hip extension (−12° male vs −31° female), and follow-through
   strategy. Do not report a female athlete's deviation from this reference as a fault without
   saying the reference may not fit.
10. **Record intent.** A placement-focused rep legitimately shows lower speed, a shorter
    follow-through, and reduced joint velocities. Without knowing intent, a submaximal rep looks
    identical to a technique fault.

### Prioritising and reporting

- **Fix upstream first.** When several faults co-occur, prefer the earliest in the chain
  (approach/plant → sequencing → contact posture → follow-through); downstream symptoms often
  resolve on their own.
- **"Nothing to fix" is a valid outcome.** If no fault family fires and no metric deviates
  meaningfully, say so and reinforce what the athlete did well. Do not manufacture three focus
  areas to fill a template.
- Never report an `unevaluated` fault family as clean — it is unknown, and the honest phrasing is
  that the data did not support checking it.

---

## 1. The kick as a velocity amplifier

The instep drive exists to make one number large: **foot speed at ball contact**, which correlates
with ball speed at r > 0.74 and is the single strongest determinant of outcome (established;
Zernicke & Roberts' regression `Vball = 1.23·Vfoot + 2.72`). Everything upstream is machinery for
that, and the ball leaves at roughly **1.4× foot speed**.

The amplification is achieved by **proximal-to-distal sequencing** (established): peak angular
velocity is reached first by the thigh (~500–630°/s), then the shank (~1600–2500°/s, two to three
times larger), then the foot. At impact the thigh's angular velocity is near **zero** while the
shank is at peak — the thigh decelerates and the shank whips through.

Two honest caveats. Whether thigh deceleration *causes* shank acceleration is **contested**;
motion-dependent (interactive) moments contribute about 20% of knee-extension moment work, so the
"whip" is real but not purely a muscular hand-off. And the classic claim that the shank
*decelerates* just before impact is largely a **measurement artifact** of low sampling rates
(probable) — do not coach against it.

Deeper still, the energy sequence may **begin at the upper trunk**, not the hip: the ordering of
first positive proximal-power peaks runs thoraco-lumbar → lumbo-pelvic → hip → knee → ankle
(single-study). The trunk accounts for ~27% of the kick's total mechanical energy expenditure,
with moments comparable to the knee.

**What this means for feedback.** Sequencing beats posture. A contact-frame symptom (slow foot, a
straight leg, a weak strike) is usually produced upstream, so read `jointAngleSequencing.events`
before concluding anything from a single key frame.

## 2. Phase by phase

### Approach (not directly visible in our sagittal metrics)

- **Angled, 30–45°, self-selected ~43°** beats a straight approach by 3–7.5% ball speed
  (established for angled-vs-straight; the exact optimum within 30–60° is **contested**, and elite
  3D studies have measured approaches as shallow as 18°). The mechanical purpose is lateral body
  inclination toward the non-kicking side, which lets the foot get under the ball.
- **Speed is modest**: 2.8–3.7 m/s over 2–4 steps (~3.3 typical). Each player has an individual
  optimum and running *faster* than it reduces ball speed (established).
- **Last stride length** is the most consistently ball-speed-related approach variable in youth
  (r climbing from .36 at U9 to .79 at U15) and lengthens for maximal kicks.
- A running approach beats a stationary one by ~31%.

### Plant / support leg

- **Fore-aft: level with or slightly ahead of ball centre** (~0.10 m ahead in elite adults).
  Planting *behind* the ball leaves weight behind the strike and lofts it; anterior-posterior
  placement governs **launch angle** more than speed.
- **Lateral placement is contested.** Elite adults measure 0.27–0.37 m to the side; the textbook
  prescription is 15–20 cm; and one youth study found *closer* placement predicted *faster* kicks.
  This is a genuine empirical blind spot — do not coach a specific lateral distance with confidence.
- **Support knee** flexes from ~154° interior at touchdown to ~138° at contact, extending just
  before impact. A **more extended, stiffer support leg** is associated with faster foot speed and
  better accuracy (probable; +1.2 m/s when deliberately increased).
- Support-leg joint moments **exceed** the kicking leg's (hip 4.0, knee 3.2, ankle 2.2 N·m/kg), and
  ground reaction forces run 15–20 N/kg vertical. The plant leg is doing the harder job.
- Single-leg balance over the support leg correlates with **accuracy** but not velocity; providing
  external postural support raises ball velocity most in less-skilled kickers (probable).

### Backswing / tension arc

- The **tension arc** — simultaneous kicking-hip over-extension, knee flexion, trunk twist away
  from the kicking side, and contralateral arm abduction — is the established qualitative
  description of end-of-backswing.
- **Hip–shoulder separation 38–42° in maximal kicks vs 6–12° in submaximal** — the clearest
  maximal-effort discriminator in the upper body (probable).
- **Kicking knee folds to 90–120° of flexion** (60–90° interior) at ~64% of the kick cycle.
- Skilled players use **+53% more trunk axial rotation** and **+62% higher peak trunk rotation
  velocity** than novices; trunk rotation velocity correlates with ball velocity at r = 0.57
  (established).
- ⚠️ **Contested:** the *elastic* storage-and-release interpretation of the tension arc is **not**
  kinetically confirmed — only the hip shows the eccentric-then-concentric power signature. Treat
  the arc as a positioning and sequencing description, not a spring.

### Contact

- **Knee is NOT straight**: ~120–140° interior (40–60° flexion). Full extension arrives during
  follow-through. A straight leg at contact means the athlete reached.
- **Trunk leans backward 12–18°** (negative here) and laterally 10–16° toward the non-kicking side.
  More backward lean → higher launch angle (13° low vs 17° high trajectory). Magnitudes vary widely
  by skill and sex, so this is **contested** as a normative target.
- **Pelvis squares to the target**, closing from ~21° open at touchdown to ~6° at contact, with a
  rapid tilt/rotation change in the last ~50 ms — actively driven, not passive carry-through.
- **Non-kicking arm abducted ~48°**, carrying angular momentum opposing the kicking leg's.
- **Strike 20–40 mm below ball centre** for maximum velocity; contact lasts 9–10 ms. Impact
  efficiency improves with a rigid ankle, though "lock your ankle" as an *instruction* is
  **contested**.

### Follow-through

- ~25% of the kick (0.150 s), ending with the kicking hip at 85–97° flexion and the knee
  near-extended, the athlete carried past the ball.
- **A truncated follow-through usually indicates an accuracy-constrained or submaximal kick, not a
  discrete defect** (established). Check intent before coaching it.
- Braking is trunk-mediated, and segment deceleration begins *before* contact.

## 3. What actually drives ball speed, ranked

1. **Foot speed at contact** — established, r > 0.74.
2. **Proximal-to-distal sequencing quality** — established; this is what converts a fast body into
   a fast foot. Lower thigh–shank cross-correlation (segments *not* moving in lockstep) associates
   with higher ball speed.
3. **Impact quality** (`Vball/Vfoot`) — most of the youth ball-speed gain across ages comes from
   this, not from faster feet: the ratio climbs 0.99 (U9) → 1.26 (U20).
4. **Approach: running, angled, long last stride** — established.
5. **Trunk rotation range and velocity** — established as a correlate.
6. **Support-leg stiffness/extension** — probable.
7. Knee extension velocity alone is a **weak** predictor of kicking distance (r = 0.283) — do not
   coach the knee in isolation.

**Verdict on "a shorter kick correlates with more power":** the literature does **not** support
shorter backswing *amplitude* producing more power (contested → leaning against). Elite players
achieve **larger** swing amplitude in a **shorter** swing *time*. The reconciliation: more range is
beneficial at the trunk/hip-shoulder and last-stride level and in total knee fold; what
distinguishes skilled kickers is that peak velocities occur **closer to impact**, i.e. better
timing, not less motion.

## 4. Speed vs accuracy

- In adults an accuracy constraint costs ~15% of maximal ball speed (established); the most
  accurate kicks land near 85% of max.
- **In youth the trade-off is only partial** — the correlation between ball velocity and radial
  error is negative or absent at every youth age band. Kicking harder does not generally cost
  placement. Do not coach youth athletes to slow down for accuracy.
- Skilled players beat novices on speed **and** accuracy simultaneously; between skill levels the
  two are not traded off.
- Accuracy is served by: approach line straightness (the strongest kinematic predictor of accuracy,
  R² = 0.77; zero misses below 4.7°), support-foot placement, support-leg balance, and ankle
  neuromuscular control.

## 5. Youth-specific calibration

- **Ball speed roughly doubles U9 → U20** (48.5 → 98.7 km/h by 3D kinematics; radar-behind-goal
  numbers run far higher — never mix methods when comparing).
- **Technique does not develop linearly.** The U13→U15 window shows the largest gains; U15→U17 the
  smallest. Biological maturity does **not** predict kicking performance.
- **Accuracy is transiently impaired around the growth spurt (U13–U15)** and improves reliably only
  at U17–U20 — the opposite of the intuitive assumption. Frame an accuracy dip at that age as
  expected, not as regression.
- **Plant-foot distance to the ball does not change with age** — a pure technique variable, fair to
  coach at any age. Velocity variables are maturation-loaded; this one is not.
- In prepubescent players ball speed is limited more by posterior-chain muscle stiffness/elasticity
  and trunk activation than by anything usually coached as technique (single-study).
- **Training that transfers:** plyometrics (established, g ≈ 0.98, youth respond as well as adults),
  whole-action simulation, weighted-ball kicking, explicit structured skill practice. **Does not
  transfer:** isolated part-practice, generic sprint/jump power work, small-sided games alone for
  stationary-ball accuracy.

### Safety

- **Apophyseal injury is the characteristic kicking injury of youth soccer** (established). The
  anterior inferior iliac spine (rectus femoris origin) is the most common site (43%), and kicking
  is the direct mechanism of ~50% of AIIS avulsions via forceful rectus femoris contraction during
  simultaneous hip flexion and knee extension — exactly the maximal instep action.
- Osgood-Schlatter affects 10–20% of adolescent players, concentrated within ±6 months of peak
  height velocity. Injury burden peaks U15–U17 and in the six months after PHV.
- **Adductor/groin injury** is the other classic kicking injury: kicking is a primary mechanism and
  low eccentric adduction strength is the main modifiable risk factor (probable).
- **Low back pain** is the one kicking injury with a partly sagittal kinematic signature in
  adolescents, and trunk joints carry ~27% of the kick's mechanical energy. Do not coach a youth
  athlete to "arch more" to get backward lean.
- Weekly organised-sport hours exceeding the athlete's age in years raises serious overuse risk.
- Supervised youth resistance training is **safe** — zero growth-plate fractures across the
  literature. The growth-plate fear is not evidence-based; **high-volume maximal kicking** is the
  real load concern.
- **Warm-up state changes the metrics more than most technique effects**: static stretching cost
  ~1.5 m/s of ball velocity while dynamic stretching added ~4.5 m/s. A cold or statically stretched
  athlete's numbers are not a technique readout.

**Feedback rules:** never prescribe high-volume maximal-effort kicking to a youth athlete; keep
recommendations to technique quality rather than repetition count; and never coach *through*
reported pain — the app has no pain screening, and maximal kicking is itself the injury mechanism.

## 7. Anti-cues — things that sound right and are not supported

Never say these, however standard they sound in coaching language.

- **"Straighten / snap the knee through the ball."** The knee is 40–60° flexed at contact in every
  dataset, and the knee-extensor moment has already collapsed by then. Full extension belongs to
  follow-through.
- **"Lock the plant leg."** The support knee is ~42° flexed at contact and only begins extending
  just before it. A bent support knee is correct.
- **"Actively brake your thigh to whip the shank."** Whether thigh deceleration *causes* shank
  acceleration is disputed; the deceleration may itself be an effect. Coach the sequence order, not
  the braking.
- **"You pulled out of the kick"** from an apparent pre-contact slowdown — a filtering artifact our
  own pipeline can manufacture.
- **"Plant 6–8 inches from the ball."** This textbook figure conflicts by roughly 2× with every
  measured elite value and was never experimentally confirmed. The lateral distance is genuinely
  unsettled and is not sagittally measurable anyway.
- **"Arch your back more"** to produce backward lean — trunk load is implicated in youth low back
  pain.
- **Anything about approach angle** judged from our video: the plane is unmeasurable from the side.
- **"Take a longer last stride"** without a ceiling. Longer correlates with power, but approach
  speed has a documented subject-specific optimum, and an unbounded instruction coaches over-reach.
- **Tension arc as stored elastic energy.** Only the hip shows the eccentric-then-concentric power
  signature; treat the arc as positioning and sequencing.

### Known gaps in this corpus

Recorded so nobody mistakes silence for evidence. There are **no** youth reference values for any
joint angle, trunk, pelvis, arm, hip-openness or COM metric — only ball speed, foot speed, their
ratio, last stride, plant distance and radial error. Fatigue, warm-up state, ball size, and rep-to-
rep variability are unmodelled covariates that the app will routinely encounter. Lateral accuracy
faults (hook/slice) have no detectable signature in a sagittal view. Several load-bearing values
trace to secondary reviews or grey literature rather than verified primaries.

## 6. Cueing — what the evidence actually supports

This is the section most likely to be misapplied, because the popular version overstates it.

- The external-focus advantage is **real in adults but contested overall**: the headline
  meta-analysis reports g = 0.26 performance / 0.58 retention, but a bias-corrected re-analysis
  puts the honest average near **zero**.
- **It does not reliably transfer to youth.** In a large multi-site youth trial, the *neutral
  control* cue was most often best (external d = −0.03 to 0.07; an internal jump cue d = −0.30).
- **For the instep kick specifically**: in *skilled* adolescents external focus improved accuracy,
  but in *novice* adolescents an **internal** focus produced more accurate kicks and less antagonist
  co-contraction. The adult rule inverts for beginners.
- External focus is also a **poor basis for technique change** — internal focus is better at moving
  a named segment in a desired direction, which is precisely what most of our fault families ask for.
- **Analogies** (one meaningful chunk, e.g. "crack a whip") lower verbal-analytic load and survive
  pressure and dual-task load better than explicit instruction (probable).
- A **holistic** focus ("explosive", "smooth") performs about as well as external and better than
  internal (probable).
- **Distal external focus** (target, ball flight) beats proximal for experienced performers;
  in novices the distance does not reliably matter, and low-skilled performers may do better with a
  proximal focus.
- Coaches default to internal language ~85% of the time, so varied phrasing genuinely adds value.
- Cues must be **short** — multi-part cues load working memory and degrade youth performance.
- Deliver **before** the attempt to prime or **after** to reinforce, never mid-movement.

**Practical policy for this app.** Do not mechanically prefer external-focus phrasing. Vary the
style — external, analogy, holistic, and plain direct instruction all have support — and prefer
whichever most clearly communicates the specific change. For a young or clearly novice athlete,
a direct, concrete instruction naming the body part is defensible and may be better. Keep cues
short, one idea each, and never repeat a phrasing the athlete has already been given.
