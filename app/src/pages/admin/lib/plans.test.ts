import { beforeEach, describe, expect, it, vi } from "vitest";
import firebase from "firebase/compat/app";
import "firebase/compat/firestore";
import { normalizeCatalogDrill } from "../../../lib/contracts/drillV2";
import { addBlock, draftFromWorkout, moveBlock, removeBlock, setDose } from "./editor";
import { saveWorkoutEdit } from "./plans";
import type { SaveWorkoutEdit } from "./plans";
import { NO_FEEDBACK_RATIONALE } from "./rationale";

const harness = vi.hoisted(() => ({ runTransaction: vi.fn(), uid: "admin-test" }));
vi.mock("../../../lib/firebase", async () => {
  const { default: sdk } = await import("firebase/compat/app");
  await import("firebase/compat/firestore");
  // Real SDK serialization, but no reads or commits ever reach a server.
  const app = sdk.initializeApp({ projectId: "demo-workout-save" }, "workout-save-test");
  const db = app.firestore();
  return {
    default: sdk,
    auth: { get currentUser() { return harness.uid ? { uid: harness.uid } : null; } },
    db: { collection: db.collection.bind(db), runTransaction: harness.runTransaction },
  };
});

const playerPath = "players/player1";
const planPath = `${playerPath}/trainingPlans/plan1`;
const counterPath = `${playerPath}/workoutSchedule/current`;
const adjustmentPath = `${playerPath}/planAdjustments/plan1_r2`;
const rawDrill = {
  schemaVersion: 2, name: "Ball control", domain: "dribbling", status: "published",
  minAge: 5, maxAge: 99, difficultyLevel: 2, maxFrequencyPerWeek: 7,
  dose: { setsMin: 1, setsMax: 4, repsMin: 1, repsMax: 20, repUnit: "reps" },
  updatedAt: firebase.firestore.Timestamp.fromMillis(123456),
};
const blocks = ["b1", "b2"].map((blockId, index) => ({
  blockId, order: index + 1, drillId: `DRB-00${index + 1}`, name: "Ball control",
  domain: "dribbling", sets: 3, reps: 8, repUnit: "reps", restSeconds: 0,
}));
const workout = {
  workoutId: "w1s1", order: 1, title: "Ball work", intent: "Control", blocks,
  revision: 1, budgetMinutes: 30, focusDomains: ["dribbling"],
};

let documents: Map<string, firebase.firestore.DocumentData>;
let writes: Map<string, firebase.firestore.DocumentData>;
let input: SaveWorkoutEdit;

beforeEach(() => {
  harness.uid = "admin-test";
  documents = new Map<string, firebase.firestore.DocumentData>([
    [playerPath, { position: "ST", age: 15 }],
    [planPath, { schemaVersion: 3, status: "active", planRevision: 1,
      weeks: [{ weekNumber: 1, workouts: [workout, { ...workout, workoutId: "w1s2", title: "Sibling" }] }] }],
    [counterPath, { revision: 4 }],
    ["drillCatalog/DRB-001", rawDrill],
  ]);
  writes = new Map();
  harness.runTransaction.mockImplementation(async callback => {
    const db = firebase.app("workout-save-test").firestore();
    const batch = db.batch();
    const pending = new Map();
    const result = await callback({
      get: async (ref: firebase.firestore.DocumentReference) => {
        expect(pending.size).toBe(0); // All transaction reads precede writes.
        return { id: ref.id, exists: documents.has(ref.path), data: () => documents.get(ref.path) };
      },
      update: (ref: firebase.firestore.DocumentReference, data: firebase.firestore.DocumentData) => {
        batch.update(ref, data); // SDK rejects invalid Firestore values synchronously.
        pending.set(ref.path, data);
      },
      set: (ref: firebase.firestore.DocumentReference, data: firebase.firestore.DocumentData) => {
        batch.set(ref, data);
        pending.set(ref.path, data);
      },
    });
    writes = pending; // A failed transaction never publishes partial writes.
    return result;
  });
  input = {
    playerId: "player1", planId: "plan1",
    draft: removeBlock(draftFromWorkout("plan1", 1, workout, 1), "b2"),
    rationale: "Reduce the session volume.", warningsOverridden: [],
    frequency: { scheduleExists: true, scheduleRevision: 4, extraExposures: {} },
    setting: "solo", equipment: [], generatorIntent: null, generatorCheck: null,
    generationContextRef: null,
  };
});

describe("admin workout transaction", () => {
  it("saves drill removal with a serializable audit and the schedule counter atomically", async () => {
    await expect(saveWorkoutEdit(input)).resolves.toMatchObject({ newWorkoutRevision: 2, newPlanRevision: 2 });
    expect(writes.size).toBe(3);
    const saved = writes.get(planPath)!;
    expect(saved.weeks[0].workouts[0].blocks.map((block: { blockId: string }) => block.blockId)).toEqual(["b1"]);
    expect(saved.weeks[0].workouts[0].previousRevision.blocks).toHaveLength(2);
    expect(saved.weeks[0].workouts[1].title).toBe("Sibling");
    expect(writes.get(counterPath)?.revision).toBe(5);
    expect(writes.get(adjustmentPath)?.diff.removed).toEqual([
      { blockId: "b2", drillId: "DRB-002", domain: "dribbling" },
    ]);
    expect(writes.get(adjustmentPath)).toMatchObject({
      rationale: "Reduce the session volume.", feedbackProvided: true,
    });
  });

  it("captures the freshly validated raw catalog row, retaining Firestore timestamps", async () => {
    const fresh = { ...rawDrill, name: "Updated catalog name" };
    documents.set("drillCatalog/DRB-001", fresh);
    await saveWorkoutEdit(input);
    const captured = writes.get(adjustmentPath)?.catalogRows["DRB-001"];
    expect(captured).toEqual(fresh);
    expect(captured.updatedAt).toBeInstanceOf(firebase.firestore.Timestamp);
    expect(captured).not.toHaveProperty("legacyDomain");
    expect(captured).not.toHaveProperty("media");
  });

  it("saves with no written feedback when explicitly selected", async () => {
    await saveWorkoutEdit({ ...input, rationale: "", noFeedback: true });
    expect(writes.get(adjustmentPath)).toMatchObject({
      rationale: NO_FEEDBACK_RATIONALE, feedbackProvided: false,
    });
    expect(writes.size).toBe(3);
  });

  it("does not record text left in the disabled feedback field as provided feedback", async () => {
    await saveWorkoutEdit({ ...input, noFeedback: true });
    expect(writes.get(adjustmentPath)).toMatchObject({
      rationale: NO_FEEDBACK_RATIONALE, feedbackProvided: false,
    });
  });

  it.each(["", "  ", "ab", "x".repeat(2001)])("refuses invalid feedback unless explicitly opted out (%#)", async rationale => {
    await expect(saveWorkoutEdit({ ...input, rationale, noFeedback: false })).rejects.toMatchObject({ code: "validation" });
    expect(writes.size).toBe(0);
  });

  it("rejects a stale workout without publishing any writes", async () => {
    input.draft.baseRevision = 0;
    await expect(saveWorkoutEdit(input)).rejects.toMatchObject({ code: "workoutChanged" });
    expect(writes.size).toBe(0);
  });

  it("rejects a changed schedule even when feedback is opted out", async () => {
    documents.set(counterPath, { revision: 5 });
    await expect(saveWorkoutEdit({ ...input, rationale: "", noFeedback: true })).rejects.toMatchObject({ code: "scheduleMoved" });
    expect(writes.size).toBe(0);
  });

  it("keeps a concurrently edited sibling workout from the transaction snapshot", async () => {
    const plan = documents.get(planPath)!;
    plan.planRevision = 2;
    plan.weeks[0].workouts[1] = { ...workout, workoutId: "w1s2", revision: 2, title: "Concurrent sibling edit" };
    await expect(saveWorkoutEdit(input)).resolves.toMatchObject({ newPlanRevision: 3 });
    expect(writes.get(planPath)?.weeks[0].workouts[1]).toMatchObject({ title: "Concurrent sibling edit", revision: 2 });
  });

  it("still refuses deleting the last drill with the no-feedback choice", async () => {
    await expect(saveWorkoutEdit({
      ...input, draft: removeBlock(input.draft, "b1"), rationale: "", noFeedback: true,
    })).rejects.toMatchObject({ code: "validation" });
    expect(writes.size).toBe(0);
  });

  it("saves a replacement drill with a fresh block ID and records both sides of the change", async () => {
    documents.set("drillCatalog/DRB-003", rawDrill);
    const draft = addBlock(input.draft, normalizeCatalogDrill("DRB-003", rawDrill));
    await saveWorkoutEdit({ ...input, draft });
    expect(writes.get(planPath)?.weeks[0].workouts[0].blocks.map((block: { blockId: string }) => block.blockId))
      .toEqual(["b1", "b3"]);
    expect(writes.get(adjustmentPath)?.diff).toMatchObject({
      added: [{ blockId: "b3", drillId: "DRB-003", domain: "dribbling" }],
      removed: [{ blockId: "b2", drillId: "DRB-002", domain: "dribbling" }],
    });
  });

  it("saves reordered drills without changing their identities", async () => {
    documents.set("drillCatalog/DRB-002", rawDrill);
    const draft = moveBlock(draftFromWorkout("plan1", 1, workout, 1), "b2", 0);
    await saveWorkoutEdit({ ...input, draft });
    const saved = writes.get(planPath)?.weeks[0].workouts[0].blocks;
    expect(saved.map((block: { blockId: string; order: number }) => [block.blockId, block.order]))
      .toEqual([["b2", 1], ["b1", 2]]);
    expect(writes.get(adjustmentPath)?.diff).toMatchObject({ reordered: true, added: [], removed: [] });
  });

  it("saves edited sets and reps and preserves the original dose in the audit", async () => {
    const draft = setDose(input.draft, "b1", { sets: 4, reps: 12 });
    await saveWorkoutEdit({ ...input, draft });
    expect(writes.get(planPath)?.weeks[0].workouts[0].blocks[0]).toMatchObject({ sets: 4, reps: 12 });
    expect(writes.get(adjustmentPath)?.diff.doseChanged).toEqual([
      { blockId: "b1", drillId: "DRB-001", from: { sets: 3, reps: 8 }, to: { sets: 4, reps: 12 } },
    ]);
  });
});
