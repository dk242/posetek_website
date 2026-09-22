# Whole-body library expansion: 80 new draft packages

This batch adds a broader set of whole-body training options to PoseTek's existing ball and field library. It is source content for draft creation and filming, not an athlete workout plan and not a production publication receipt.

The plan is 20 complete exercise packages each week. A package contains a primary demonstration, teaching detail and error correction: 60 required clips per week, 240 across four weeks.

| Filming week | Dates in America/Los_Angeles | Strength | Isometric | Plyometric | Speed/COD | Ball | Packages |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 | September 21–27, 2026 | 7 | 3 | 4 | 3 | 3 | 20 |
| 2 | September 28–October 4, 2026 | 7 | 3 | 4 | 3 | 3 | 20 |
| 3 | October 5–11, 2026 | 7 | 3 | 4 | 3 | 3 | 20 |
| 4 | October 12–18, 2026 | 7 | 3 | 4 | 3 | 3 | 20 |
| Total | Four weeks | 28 | 12 | 16 | 12 | 12 | 80 |

## Files and review status

- `exercises.mjs` contains the original exercise instructions, cues, regressions, progressions and distinctness rationales. Each record has three or more actual steps.
- `manifest.json` is the import-ready schema-2 draft content and private authoring record. The immutable keys are `wb-001` through `wb-080`. Proposed catalog IDs are advisory until the importer reserves them against fresh live counters.
- `FILMING_MATRIX.md` provides the four weekly lists and a complete filming card for each exercise. `filming-matrix.csv` provides the same review/production information in a sortable table.
- `sources.json` distinguishes primary studies, official consensus and official coaching guidance, including populations and limitations.
- `deduplication-reference.json` contains only names, IDs and statuses from the captured 128-entry live catalog and 85-row matrix, plus provenance hashes. Private raw snapshots and recordings are not included.
- `production-id-map.json` records the verified live IDs assigned during the September 21 import. All 80 match the advisory IDs in the filming matrix and CSV. The live catalog version is `1.0.91`; all 128 prior records were preserved.
- [Demo references](DEMO_REFERENCES.md) links external video demonstrations for filming preparation, grouped into the four weeks. `demo-references.json` contains the same links and matching notes, generated from the three research group files by `node content/training-expansion/build-demo-references.cjs`. These are separate from the original import manifest and its evidence sources.

The admin production panel displays these links under **Watch before filming**.
A movement reference matches the named movement; a component reference illustrates
part of an authored sequence or a related setup. Follow the specific adaptation
notes and PoseTek instructions, rather than copying a source's load or dose.
Every link records how it was checked; page/description checks do not imply full
playback or qualified technique review. These links are private production metadata
and do not fill athlete media slots or approve content. Record original PoseTek clips.

Every record has `status: draft`, `trainingPolicy.reviewStatus: pending`, an empty media map, and the publication hold “Awaiting content review and three approved videos.” Research desk review has occurred. Qualified human technique/dose/readiness approval and video review have not occurred. No reviewer identity or approval date is fabricated.

The live inventory was larger than the older 90-entry executable fixture. All 128 live entries were considered, including archived/draft records and legacy records with no explicit status. Existing records are not edited. Related new variants include a specific progression or new movement constraint in their distinctness notes; they are not counted merely because their names differ. A proposed forward power-skip entry was replaced after the live A Series Circuit was inspected.

## Evidence and athlete eligibility

The six performance anchors remain shot speed, sprint time, vertical jump, broad jump, no-ball shuttle time and dribbling time. A test result can justify a domain priority; it cannot diagnose a muscle weakness, joint restriction, landing fault, maturity status or medical condition.

An objective relationship is a planning relationship. “Direct” means the task practises the supported performance domain, not that an isolated trial proves the authored drill's effect. “Support” identifies a coaching inference from physical preparation or a training program. “General” intentionally carries no six-test objective. Upper-body and trunk development, isometric options, and broader ball receiving/passing skills remain useful without inventing test transfer.

Most intervention evidence is program-level and includes small, male-heavy samples. Official skill guidance supports a teaching rationale, not a quantified performance promise. No entry claims that its exact dose is proven, that an outcome is guaranteed, or that exercise treats pain or prevents a particular injury.

All new exercises require coach clearance for ages 10–18. Age and access to a standard gym do not establish readiness. Loaded exercises require a coach-entered individual load or assistance instruction. Activation and workout starts involving any of these 80 exercises, including ball and field work, remain held until the mobile acceptance gate is verified. Unknown readiness does not grant eligibility. Saved plans are not rewritten by the library expansion.

The numeric dose and exposure limits are conservative authoring proposals awaiting human review. Schema sets count complete prescribed sets; `perSide` doubles repetitions, contacts or hold seconds, not the sets field. Coaches must account for team training, gym work, other sports and matches. A maximum frequency per exercise is not permission to stack every exercise at that frequency. No automatic maximal loads, 1RM inference, depth jumps or Olympic lifts are included.

Apparatus details are part of readiness: a cable machine requires the stated attachment and setup; benches/boxes must be secure; machines must fit the athlete; rebound balls and walls must suit the task. Equipment-token matching alone does not certify a setup. Partner requirements describe the exercise itself and do not replace supervision requirements.

## Reproduction and checks

Run these from the repository root:

```text
node content/training-expansion/build-manifest.mjs
node content/training-expansion/validate-manifest.mjs
node content/training-expansion/validate-manifest.test.mjs
```

The content test runs directly in one process, which avoids the Windows test runner's child-process `EPERM` in this workspace. It verifies the complete manifest and intentionally rejects premature publication, invented review/source claims, duplicate legacy names, incompatible continuous-dose rest, incomplete three-clip packages, unknown equipment and undercounted unilateral exposure.

Rebuilding uses the sanitized comparison snapshot and makes no network or application writes. Refreshing that comparison snapshot requires explicit local input arguments to the builder; the private raw paths must remain outside Git. Actual import must independently check fresh live names/IDs, reserve IDs transactionally, create only, persist the manifest-to-catalog mapping and read back all 80 drafts. This folder alone does not establish that an import or website/backend release occurred.
