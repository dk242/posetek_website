# Catalog access requirements review data

Prepared September 26, 2026 from the existing catalog and checked against a fresh read-only production snapshot. This is a source-derived metadata proposal, not a qualified content approval or deployment receipt. See [the operating handoff](../../docs/TRAINING_ACCESS_CATALOG.md).

`requirements.json` accounts for all208 catalog records:54 normalized published,55 normalized unpublished,19 unsupported legacy/media records, and80 held whole-body drafts. Only the54 published records have proposed requirement maps. Every map includes quoted authored evidence, an exact source fingerprint, decisions, and explicit unresolved details. `equipment.json` maps all28 canonical equipment IDs without automatic substitutions. `source-hash-fixtures.json` fixes cross-language hashing behavior.

The following dimensions are minimum authored route/zone bounds, not a guarantee of a complete safe footprint. The full setup still applies, including unquantified landing, turning and stopping clearance. Omitted dimensions/materials are not guessed; unknown availability does not satisfy an explicit requirement. No surface material is explicitly authored for these54 entries, so no grass/turf/indoor-only restriction is invented.

| Drill | Name | Required equipment (all) | Authored space bounds | People including athlete | Hold for clarification |
|---|---|---|---|---:|---|
| BMA-501 | Standing on the ball | ball, cones | L ≥ 13.716 m; W ≥ 1.8288 m | 1 | — |
| BMA-502 | Settling under pressure | ball | Overhead clear | 1 | — |
| BMA-503 | Essential 180 turn | ball, cones, wall | L ≥ 1.524 m | 1 | — |
| COD-001 | Cone square movement game | cones | L ≥ 3 m; W ≥ 3 m | 1 | — |
| COD-002 | Deceleration gate | cones | L ≥ 2 m | 1 | — |
| COD-003 | 45-degree cut progression | cones | L ≥ 5 m | 1 | — |
| COD-004 | 90-degree cut progression | cones | L ≥ 5 m | 1 | — |
| COD-005 | 5-0-5 technique reps | cones, markers, timer | L ≥ 15 m | 1 | — |
| COD-010 | Ball COD shuttle | ball, cones |  | 1 | — |
| DRB-005 | Cone maze | ball, cones |  | 1 | — |
| DRB-006 | Figure-8 dribble | ball, cones | L ≥ 2 m | 1 | — |
| DRB-501 | One Touch exit | ball, cones, wall |  | 1 | — |
| DRB-502 | Breaking pressure via touch in | ball, cones, wall |  | 1 | — |
| DRB-503 | Breaking pressure via touch out | ball, cones, wall |  | 1 | — |
| DRB-504 | Creative outside the box finishing | ball, cones, goal | Goal area | 1 | — |
| DRB-505 | Dribbling out of pressure when receiving | ball, cones, wall | L ≥ 3.048 m; W ≥ 1.524 m | 1 | — |
| DRB-506 | Dribbling out of pressure on the half turn | ball, cones, wall | L ≥ 3.048 m; W ≥ 1.524 m | 1 | — |
| DRB-507 | Half turn under pressure | ball, cones, wall | L ≥ 1.524 m | 1 | — |
| DRB-508 | Full turn under pressure | ball, cones, wall | L ≥ 1.524 m; W ≥ 1.8288 m | 1 | — |
| HJP-002 | Standing broad jump reps | tapeMeasure, markers |  | 1 | — |
| HJP-003 | Triple broad jump | tapeMeasure |  | 1 | triple_jump_lane_length_unspecified |
| HJP-004 | Single-leg hop to stick | markers |  | 1 | — |
| HJP-005 | Lateral bound series | markers |  | 1 | — |
| HJP-006 | Broad jump to 5 m sprint | cones | L ≥ 5 m | 1 | — |
| PAS-001 | Wall pass rhythm | ball, wall, markers | L ≥ 3 m | 1 | — |
| SHT-003 | One-step laces strike | ball, goal |  | 1 | — |
| SHT-501 | Dribble into finish inside the box - far post | ball, cones, goal | W ≥ 9.144 m; Goal area | 1 | — |
| SHT-502 | Finishing far post outside the box angled | ball, cones, goal | Goal area | 1 | — |
| SHT-503 | Drive into finish inside the box | ball, cones, goal | Goal area | 1 | — |
| SHT-504 | Touch into finish inside the box - angled | ball, cones, goal | Goal area | 1 | — |
| SHT-505 | Settling into finish - top of the box | ball, cones, goal | Overhead clear; Goal area | 1 | — |
| SPD-002 | Falling start | cones | L ≥ 5 m | 1 | — |
| SPD-003 | Wall switch to sprint | wall, cones | L ≥ 5 m | 1 | — |
| SPD-004 | Push-up start | cones | L ≥ 10 m | 1 | — |
| SPD-006 | Build-and-fly sprint | cones | L ≥ 25 m | 1 | run_off_distance_unspecified |
| SPD-009 | Sprint-cut-sprint | cones | L ≥ 8 m; W ≥ 5 m | 1 | — |
| SPD-501 | A Series Circuit | None |  | 1 | — |
| STR-001 | Squat-to-box competency | box, bench |  | 1 | — |
| STR-002 | Split-squat isometric | None |  | 1 | — |
| STR-003 | Single-leg RDL reach | cones |  | 1 | — |
| STR-004 | Calf raise progression | None |  | 1 | stable_support_type_unspecified |
| STR-005 | Side-plank progression | mat |  | 1 | — |
| STR-006 | Hamstring bridge walkout | mat |  | 1 | — |
| STR-007 | Assisted Nordic progression | kneePad |  | 2 | — |
| STR-008 | Short-lever Copenhagen hold | bench, mat |  | 2 | — |
| STR-501 | Bear crawls | mat | L ≥ 1.524 m | 1 | — |
| STR-502 | Shoulder Taps | mat |  | 1 | — |
| VJP-001 | Jump and stick | markers | L ≥ 2 m; W ≥ 2 m | 1 | — |
| VJP-002 | Snap-down to vertical jump | None | Overhead clear | 1 | — |
| VJP-003 | Countermovement jump cluster | None |  | 1 | — |
| VJP-004 | Pogo series | cones, markers |  | 1 | — |
| VJP-005 | Low hurdle hops | hurdles |  | 1 | — |
| VJP-006 | Single-leg jump and stick | markers |  | 1 | — |
| VJP-007 | Lateral bound to vertical jump | markers | Overhead clear | 1 | — |
