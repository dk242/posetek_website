# Dosage principles (guide §5–6; binding for plan/workout generation)

Source: PoseTek Drill Matrix Research & Implementation Guide v1.0 (2026-08-02). These are
prompt-level rules; hard numeric bounds come from each drill's catalog `dose` ranges and are
enforced by validators, not by the model.

## The progression rule

Progress **one variable at a time**: distance, speed, pressure, cue timing, opposition,
laterality, or position context. The 90 templates generate variants through these controlled
changes — week-over-week progression is a variant step (or the drill's own `progression` text),
never an invented new exercise.

## The stop rule (rides every session)

Stop the set when speed or technique quality drops materially (3–5% speed loss is a coaching
starting range, not a law), and stop the session for pain, marked movement avoidance, or a
sudden unexplained decline. Pain triggers human review — never a modified prescription.

## Per-domain dose principles

| Domain | Principle | Error to avoid |
|---|---|---|
| Sprint | Few fast reps, long recovery, stop before quality drops | Turning speed work into conditioning |
| Jump / plyometric | Count quality contacts; progress over weeks | Raising height/volume before landing competence |
| COD | Standardize approach speed when coaching mechanics; train both sides | Treating one plant angle as universal |
| Reactive agility | Cue must arrive late enough to force perception and choice | Calling a memorized cone route "agility" |
| Dribbling | Score retained control, errors, scanning, and time | Rewarding reckless raw speed |
| Passing/receiving | Progress feed variability and pressure only after stable contact | Equating gate accuracy with game vision |
| Shooting | Repeated shots; track speed–accuracy consistency | Judging from one strike |
| Strength/resilience | Technique-led progression under appropriate supervision | Prescribing maximal loads or diagnosing injury |
| Representative games | Constraints that invite, not force, the target action | Distorting the game until transfer is artificial |

## Session architecture

Order work as: warmup → highest-quality/CNS work (speed/power, full recovery) → technical
volume → game/transfer block. Never place max-quality work after game play. The age×level
matrix (`age_level_matrix.json`) gives each band's Play–Practice–Play percentages; respect
them in whole-session design.

## Weekly shape

- Respect each drill's `frequencyPerWeek` range from the catalog; do not exceed it.
- Keep ~48h between dense neuromuscular (max-intent sprint/plyo) sessions.
- 1–2 dedicated neuromuscular exposures/week for U11+ club athletes; games and technique carry
  the rest.
- A 6-week block ends in a retest week using the same standardized tests that seeded it
  (`test_protocols.json`; only `observableInApp` tests can be claimed as measured evidence).
- Do not schedule adult conditioning volumes for U6–U12; short fast efforts with full recovery.

## Ranking order when choosing work (guide §8)

1. Safety and validity gates (age, contraindication, maturity gate, delivery mode).
2. Repeated performance gap vs personal trend and matched cohort.
3. Age/maturity/competence eligibility.
4. Converging pose/ball features and side-specific data.
5. Practical context: solo/partner/coach, equipment, space, athlete preference.
