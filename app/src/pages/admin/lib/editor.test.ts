// The editor's pure core. These are the cases that decide whether an admin edit
// is safe: the block-id counter that must never be reused, the one limit that
// cannot be overridden, the warning/error split, and the diff that becomes the
// ground-truth record.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, expect, it } from "vitest";
import { normalizeCatalogDrill } from "../../../lib/contracts/drillV2";
import type { CatalogDrill } from "../../../lib/contracts/drillV2";
import {
  addBlock,
  diffWorkouts,
  doseBoundsFor,
  draftFromWorkout,
  draftMinutes,
  errorsOf,
  isUnchanged,
  moveBlock,
  removeBlock,
  setDose,
  setMeta,
  snapshotOf,
  snapshotOfDraft,
  validateDraft,
  warningsOf,
  workoutFromDraft,
} from "./editor";

function drill(overrides: Record<string, any> = {}): CatalogDrill {
  return normalizeCatalogDrill(String(overrides.drillId ?? "DRB-006"), {
    schemaVersion: 2,
    drillId: overrides.drillId ?? "DRB-006",
    name: overrides.name ?? "Figure-8 dribble",
    domain: overrides.domain ?? "dribbling",
    minAge: overrides.minAge ?? 8,
    maxAge: overrides.maxAge ?? 19,
    difficultyLevel: overrides.difficultyLevel ?? 2,
    equipment: overrides.equipment ?? ["ball", "cones"],
    requiresPartner: overrides.requiresPartner ?? false,
    howTo: { setup: "", steps: ["Weave."] },
    dose: overrides.dose ?? { setsMin: 2, setsMax: 4, repsMin: 6, repsMax: 10, repUnit: "reps", restSecondsMin: 30, restSecondsMax: 60 },
    maxFrequencyPerWeek: overrides.maxFrequencyPerWeek ?? 2,
    coachComments: [],
    adaptiveLevers: [],
    status: overrides.status ?? "published",
    catalogVersion: "1.0.4",
    howToSource: "migrated",
    coachCommentsSource: "migrated",
  });
}

function workoutDoc(blocks: any[], overrides: Record<string, any> = {}) {
  return {
    workoutId: "w1s1",
    order: 1,
    title: "Ball work",
    intent: "Dribbling and passing.",
    focusDomains: ["dribbling"],
    budgetMinutes: 60,
    estimatedMinutes: 0,
    blocks,
    revision: 1,
    editedBy: "generator",
    ...overrides,
  };
}

function blockDoc(blockId: string, order: number, drillId: string, domain: string, overrides: Record<string, any> = {}) {
  return {
    blockId, order, kind: "main", drillId, name: drillId, domain,
    sets: 3, reps: 8, repUnit: "reps", perSide: false,
    restSeconds: 45, restScope: "sets", restBetweenSetsSeconds: null, familiarizationReps: 0,
    estimatedMinutes: 0, whyIncluded: "",
    ...overrides,
  };
}

const ATHLETE = { age: 15, maxDrillDifficulty: 5, setting: "solo", equipment: ["ball", "cones", "goal"] };

describe("draftFromWorkout", () => {
  it("renumbers order, recomputes minutes and carries the revision it read", () => {
    const draft = draftFromWorkout("plan1", 1, workoutDoc([
      blockDoc("b2", 5, "DRB-006", "dribbling"),
      blockDoc("b1", 2, "PAS-003", "passing"),
    ], { revision: 3 }), 7);
    expect(draft.blocks.map(block => block.blockId)).toEqual(["b1", "b2"]);
    expect(draft.blocks.map(block => block.order)).toEqual([1, 2]);
    expect(draft.blocks[0].estimatedMinutes).toBeGreaterThan(0);
    expect(draft.baseRevision).toBe(3);
    expect(draft.basePlanRevision).toBe(7);
  });

  it("starts the block counter above every existing id when the workout has none", () => {
    const draft = draftFromWorkout("plan1", 1, workoutDoc([blockDoc("b8", 1, "DRB-006", "dribbling")]), 1);
    expect(draft.nextBlockSequence).toBe(9);
  });

  it("honors a persisted counter so a retired id is never reissued", () => {
    // b8 was removed earlier; the counter remembers, `max(survivors)+1` would not.
    const draft = draftFromWorkout("plan1", 1, workoutDoc(
      [blockDoc("b1", 1, "DRB-006", "dribbling")],
      { nextBlockSequence: 9 },
    ), 1);
    expect(draft.nextBlockSequence).toBe(9);
    expect(addBlock(draft, drill()).blocks[1].blockId).toBe("b9");
  });
});

describe("draft operations", () => {
  const base = draftFromWorkout("plan1", 1, workoutDoc([
    blockDoc("b1", 1, "DRB-006", "dribbling"),
    blockDoc("b2", 2, "PAS-003", "passing"),
  ], { nextBlockSequence: 3 }), 1);

  it("adds a drill at the end or at an index, and advances the counter", () => {
    const added = addBlock(base, drill({ drillId: "SPD-002", domain: "speed" }));
    expect(added.blocks.map(block => block.blockId)).toEqual(["b1", "b2", "b3"]);
    expect(added.nextBlockSequence).toBe(4);

    const inserted = addBlock(base, drill({ drillId: "SPD-002", domain: "speed" }), 0);
    expect(inserted.blocks.map(block => block.blockId)).toEqual(["b3", "b1", "b2"]);
    expect(inserted.blocks.map(block => block.order)).toEqual([1, 2, 3]);
  });

  it("refuses to prescribe a drill that is not published", () => {
    expect(() => addBlock(base, drill({ drillId: "DRB-900", status: "draft" }))).toThrow(/cannot be prescribed/);
    expect(() => addBlock(base, drill({ drillId: "DRB-901", status: "archived" }))).toThrow(/cannot be prescribed/);
  });

  it("removes and reorders, renumbering order each time", () => {
    expect(removeBlock(base, "b1").blocks.map(block => block.blockId)).toEqual(["b2"]);
    const moved = moveBlock(base, "b2", 0);
    expect(moved.blocks.map(block => block.blockId)).toEqual(["b2", "b1"]);
    expect(moved.blocks.map(block => block.order)).toEqual([1, 2]);
  });

  it("recomputes minutes from the shared formula on every dose change", () => {
    const before = draftMinutes(base);
    const after = draftMinutes(setDose(base, "b1", { sets: 4, reps: 10, restSeconds: 60 }));
    expect(after).toBeGreaterThan(before);
  });

  it("caps the title, the intent and the focus domains", () => {
    const long = setMeta(base, { title: "x".repeat(200), intent: "y".repeat(900), focusDomains: ["a", "b", "c", "d", "e"] });
    expect(long.title).toHaveLength(80);
    expect(long.intent).toHaveLength(400);
    expect(long.focusDomains).toHaveLength(4);
  });
});

describe("doseBoundsFor", () => {
  it("uses the catalog's ranges, widening only where a bound is absent", () => {
    expect(doseBoundsFor(drill())).toEqual({
      sets: { min: 2, max: 4 }, reps: { min: 6, max: 10 }, restSeconds: { min: 30, max: 60 },
    });
    expect(doseBoundsFor(drill({ dose: {} }))).toEqual({
      sets: { min: 1, max: 10 }, reps: { min: 1, max: 600 }, restSeconds: { min: 0, max: 600 },
    });
  });
});

describe("validateDraft", () => {
  const week = {
    weekNumber: 1,
    workouts: [
      workoutDoc([blockDoc("b1", 1, "DRB-006", "dribbling")], { workoutId: "w1s1" }),
      workoutDoc([blockDoc("b1", 1, "DRB-006", "dribbling")], { workoutId: "w1s2" }),
    ],
  };

  function context(overrides: Record<string, any> = {}) {
    return {
      drills: new Map<string, CatalogDrill>([["DRB-006", drill()], ["PAS-003", drill({ drillId: "PAS-003", domain: "passing" })]]),
      athlete: ATHLETE,
      week,
      extraExposures: {},
      ...overrides,
    } as any;
  }

  it("passes a workout inside every bound", () => {
    const draft = draftFromWorkout("plan1", 1, week.workouts[0], 1);
    expect(errorsOf(validateDraft(setMeta(draft, { budgetMinutes: draftMinutes(draft) }), context()))).toEqual([]);
  });

  it("makes the weekly frequency limit an ERROR, never an overridable warning", () => {
    // DRB-006 is capped at 2/week and already sits in both of this week's
    // workouts; a third block of it in a third slot is over the limit.
    const third = { ...week, workouts: [...week.workouts, workoutDoc([], { workoutId: "w1s3" })] };
    const draft = addBlock(
      draftFromWorkout("plan1", 1, third.workouts[2], 1),
      drill(),
    );
    const issues = validateDraft(draft, context({ week: third }));
    const frequency = issues.filter(issue => issue.code === "frequency");
    expect(frequency).toHaveLength(1);
    expect(frequency[0].severity).toBe("error");
    expect(frequency[0].message).toMatch(/cannot be overridden/);
  });

  it("is replacement-aware: keeping a drill in the workout being edited is not a third use", () => {
    const draft = draftFromWorkout("plan1", 1, week.workouts[1], 1);
    expect(validateDraft(draft, context()).filter(issue => issue.code === "frequency")).toEqual([]);
  });

  it("counts ad-hoc evidence in the same week window", () => {
    const draft = draftFromWorkout("plan1", 1, week.workouts[1], 1);
    const issues = validateDraft(draft, context({ extraExposures: { "DRB-006": 1 } }));
    expect(issues.filter(issue => issue.code === "frequency")).toHaveLength(1);
  });

  it("treats age, difficulty, partner and equipment as warnings the admin may accept", () => {
    const hard = drill({ drillId: "SPD-005", domain: "speed", difficultyLevel: 5, minAge: 16, maxAge: 19, requiresPartner: true, equipment: ["sledOrBand"] });
    const draft = addBlock(draftFromWorkout("plan1", 1, workoutDoc([]), 1), hard);
    const issues = validateDraft(draft, context({
      drills: new Map([["SPD-005", hard]]),
      athlete: { ...ATHLETE, maxDrillDifficulty: 3 },
      week: { weekNumber: 1, workouts: [] },
    }));
    const codes = warningsOf(issues).map(issue => issue.code);
    expect(codes).toEqual(expect.arrayContaining(["age", "difficulty", "partner", "equipment"]));
    expect(errorsOf(issues).filter(issue => ["age", "difficulty", "partner", "equipment"].includes(issue.code))).toEqual([]);
  });

  it("refuses a dose outside the catalog's own ranges", () => {
    const draft = setDose(draftFromWorkout("plan1", 1, week.workouts[0], 1), "b1", { sets: 9 });
    const issues = errorsOf(validateDraft(draft, context()));
    expect(issues.some(issue => issue.code === "doseRange")).toBe(true);
  });

  it("refuses an empty workout and an unknown drill", () => {
    const empty = draftFromWorkout("plan1", 1, workoutDoc([]), 1);
    expect(errorsOf(validateDraft(empty, context())).some(issue => issue.code === "blockCount")).toBe(true);

    const unknown = draftFromWorkout("plan1", 1, workoutDoc([blockDoc("b1", 1, "GONE-001", "speed")]), 1);
    expect(errorsOf(validateDraft(unknown, context())).some(issue => issue.code === "unknownDrill")).toBe(true);
  });

  it("warns when the workout misses its budget by more than the tolerance", () => {
    const draft = setMeta(draftFromWorkout("plan1", 1, week.workouts[0], 1), { budgetMinutes: 90 });
    expect(warningsOf(validateDraft(draft, context())).some(issue => issue.code === "budget")).toBe(true);
  });
});

describe("diffWorkouts", () => {
  const before = snapshotOf(workoutDoc([
    blockDoc("b1", 1, "DRB-006", "dribbling", { estimatedMinutes: 5 }),
    blockDoc("b2", 2, "PAS-003", "passing", { estimatedMinutes: 6 }),
  ], { estimatedMinutes: 12 }));

  it("records an added and a removed drill with their domains", () => {
    const after = snapshotOf(workoutDoc([
      blockDoc("b1", 1, "DRB-006", "dribbling", { estimatedMinutes: 5 }),
      blockDoc("b3", 2, "SPD-002", "speed", { estimatedMinutes: 8 }),
    ], { estimatedMinutes: 14 }));
    const diff = diffWorkouts(before, after);
    expect(diff.added).toEqual([{ blockId: "b3", drillId: "SPD-002", domain: "speed" }]);
    expect(diff.removed).toEqual([{ blockId: "b2", drillId: "PAS-003", domain: "passing" }]);
    expect(diff.minutesDelta).toBe(2);
    expect(diff.domainMinutesDelta).toEqual({ passing: -6, speed: 8 });
  });

  it("records every changed formula input, not only sets and reps", () => {
    const after = snapshotOf(workoutDoc([
      blockDoc("b1", 1, "DRB-006", "dribbling", { sets: 5, restSeconds: 30, restScope: "reps", estimatedMinutes: 9 }),
      blockDoc("b2", 2, "PAS-003", "passing", { estimatedMinutes: 6 }),
    ], { estimatedMinutes: 16 }));
    const [change] = diffWorkouts(before, after).doseChanged;
    expect(change.blockId).toBe("b1");
    expect(change.from).toEqual({ sets: 3, restSeconds: 45, restScope: "sets" });
    expect(change.to).toEqual({ sets: 5, restSeconds: 30, restScope: "reps" });
  });

  it("detects a reorder of the surviving blocks", () => {
    const after = snapshotOf(workoutDoc([
      blockDoc("b2", 1, "PAS-003", "passing", { estimatedMinutes: 6 }),
      blockDoc("b1", 2, "DRB-006", "dribbling", { estimatedMinutes: 5 }),
    ], { estimatedMinutes: 12 }));
    expect(diffWorkouts(before, after).reordered).toBe(true);
    expect(diffWorkouts(before, before).reordered).toBe(false);
  });

  it("knows when nothing actually changed", () => {
    expect(isUnchanged(diffWorkouts(before, before), before, before)).toBe(true);
    const retitled = { ...before, title: "Something else" };
    expect(isUnchanged(diffWorkouts(before, retitled), before, retitled)).toBe(false);
  });
});

describe("workoutFromDraft", () => {
  const previous = workoutDoc([blockDoc("b1", 1, "DRB-006", "dribbling")], {
    revision: 2,
    editedBy: "athlete",
    check: { timeStatus: "ok", intentStatus: "pass" },
    previousRevision: { revision: 1, blocks: [] },
    nextBlockSequence: 4,
  });

  it("bumps the revision, stamps the admin, and keeps exactly one level of history", () => {
    const draft = draftFromWorkout("plan1", 1, previous, 5);
    const next = workoutFromDraft(setMeta(draft, { title: "Reworked" }), previous, "admin-uid", "T");
    expect(next.revision).toBe(3);
    expect(next.editedBy).toBe("admin");
    expect(next.editorUid).toBe("admin-uid");
    expect(next.previousRevision?.revision).toBe(2);
    expect(next.previousRevision?.previousRevision).toBeUndefined();
    expect(next.previousRevision?.check).toEqual({ timeStatus: "ok", intentStatus: "pass" });
    expect(next.previousRevision?.nextBlockSequence).toBe(4);
  });

  it("clears the generator's check, which no longer describes this workout", () => {
    const draft = draftFromWorkout("plan1", 1, previous, 5);
    expect(workoutFromDraft(draft, previous, "admin-uid", "T").check).toBeNull();
  });

  it("recomputes estimatedMinutes from the blocks it is writing", () => {
    const draft = draftFromWorkout("plan1", 1, previous, 5);
    const next = workoutFromDraft(draft, previous, "admin-uid", "T");
    expect(next.estimatedMinutes).toBe(draftMinutes(draft));
    expect(next.estimatedMinutes).toBe(snapshotOfDraft(draft).estimatedMinutes);
  });
});
