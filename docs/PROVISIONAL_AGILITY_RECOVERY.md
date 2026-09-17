# Reviewed partial-shuttle evidence

This follow-up extends the separately labeled estimate contract to Agility. The
capture owner confirmed that an attempt saved under Sprint was the no-ball
out-and-back test. The original clip contains the outbound run, turn and part of
the return, but no finish. It is reclassified with the same rep identity and date;
its completion time remains unavailable as a measured result.

## Classification and preservation

The journaled transfer preserves fourteen original attempt files and three session
calibration files. Twenty destination objects include reviewed active metadata,
capture context and annotations, plus copies of the original analysis and
calibration. Sprint analysis is retained under `original_capture`, not promoted
into active Change of Direction measurements. Sixteen unsupported movement values
and nine inherited Sprint aliases are cleared. Session counts change atomically
with the rep's classification; the other genuine Sprint attempt is unchanged.

Because the moved attempt is incomplete, qualified measured coverage decreases by
one. Its former Sprint speed no longer competes for the Sprint personal best.
The remaining genuine Sprint result becomes authoritative. This is a correction
to test classification, separate from adding a provisional Agility marker.

All previous archive guards are preserved. The exact original and destination
movie paths add two guards, bringing the current video processor map to 32 in
`onvideoupload-00027-guw`. Preserve this map and all historical repair journals.

## Conditional estimate

The new method is `partial_shuttle_visual_start_v1`, paired only with
`changeOfDirection` and `agility`. Private records additionally require
`protocolConfirmed: true` and `startBoundary: "visualBracket"`. They bind the
reviewed source to the current reclassified rep and destination movie generation
and MD5. No source rep, frame event or metric is rewritten to contain the estimate.

The method uses decoded video timestamps and a visually bracketed movement start.
It fits recent high-confidence hip motion over five return windows of 0.25, 0.5,
0.75, 1 and 1.25 seconds. The central projection is the median of the resulting
constant-pace completion forecasts, using the midpoint of the start bracket and
rounding to a tenth of a second. The sensitivity range combines the bracket's
endpoints with plus/minus 20 percent future return speed and rounds outward.

The range is not a confidence interval or guaranteed bound. Continued acceleration,
slowing, stopping and start uncertainty can change the actual completion time.
This method has substantially more missing movement than the near-finish Dribbling
method. Its validator requires at least 60 percent of the straight marker course
to have been observed; Dribbling retains its separate 75 percent threshold. These
are conservative software eligibility checks, not scientific validation of a
complete test. No cohort-time substitution or Dribbling-to-Agility conversion is
used.

## Display, planning and supersession

Authenticated readers may return both estimates for the same player. A qualified
result suppresses only the matching drill's estimate. The other axis remains
available until its own valid test arrives or its review is withdrawn/expired.
Shared readers do not load these private documents. Current source identity,
access checks and the 180-day capture window remain enforced.

Both profile chart implementations show separate hollow markers and dashed lines,
explicit estimated labels, and the correct reference label for their scoring
context. Measured overall ratings, counts, rankings, Insights and personal
comparisons do not consume the estimates. Native display remains unchanged.

The planner includes both assumptions as optional low-confidence coaching context.
It adds Dribbling and Speed/Agility goals when slots are available, preserves the
user's existing goals, and rejects context that exceeds the existing 500-character
limit. It reloads current evidence before assessment or generation. Estimates do
not replace measured `statsProfile`, best results or verified deficits. Publishing
the data and interface does not create or activate a workout plan.

## Evidence and recovery

Detailed video evidence, independent calculation and migration reviews, source
hashes and the single-document append plan remain in ignored private recovery
directories. Estimate publication compares the current document version and keeps
every prior entry and raw field intact. It binds the new destination generation
only after migration verification. Before/after result inventories and source
checks distinguish the classification effect from the estimate publication.

Reversing the estimate requires a version-checked restoration of its before-image;
do not erase a later review. Classification rollback uses its separate
rep/session/artifact journal. Reverting a display or reader must preserve private
rules, canonical result services, native capture compatibility and all 32 guards.
The preceding [Dribbling release](PROVISIONAL_DRIBBLING_RECOVERY.md) remains an
immutable historical checkpoint for its deployment and data publication.
