import { describe, expect, it } from "vitest";
import {
  coachQuestions, coachWorkoutRequest, createDemoWorkout, focusFromRequest,
  formatDose, formatDuration, initialWorkoutState, sampleAthlete, workoutReducer,
  type WorkoutChoices, type WorkoutState,
} from "./product-demo";

const choices: WorkoutChoices = { minutes: 20, energy: "normal", focus: "dribbling" };
function startWorkout(): WorkoutState {
  const prepared = workoutReducer(initialWorkoutState, { type: "prepare", choices });
  return workoutReducer(workoutReducer(prepared, { type: "ready" }), { type: "start" });
}

describe("the published sample workout", () => {
  it("keeps the coach's 20-minute request as a seven-set dribbling/passing sample", () => {
    const plan = createDemoWorkout(choices);
    expect(focusFromRequest(coachWorkoutRequest)).toBe("dribbling");
    expect(plan.drills.map(drill => [drill.id, formatDose(drill), drill.restSeconds])).toEqual([
      ["DRB-006", "4 × 60 sec", 45], ["PAS-001", "3 × 45 sec", 45],
    ]);
    expect(plan.durationSeconds).toBe(600);
    expect(plan.segments.at(-1)).toEqual({ kind: "work", drill: 1, set: 3, seconds: 45 });
  });

  it("puts passing first when requested and retains lighter work and rest doses", () => {
    const plan = createDemoWorkout({ minutes: 15, energy: "low", focus: "passing" });
    expect(plan.drills.map(drill => [drill.id, drill.sets, drill.workSeconds, drill.restSeconds])).toEqual([
      ["PAS-001", 3, 30, 45], ["DRB-006", 3, 45, 45],
    ]);
    expect(focusFromRequest("Help with receiving and passing")).toBe("passing");
    expect(focusFromRequest("Improve my finishing")).toBe("dribbling");
  });

  it("uses only the two approved demonstrations across every time, energy and priority choice", () => {
    for (const focus of ["dribbling", "passing"] as const) {
      for (const minutes of [15, 20, 30, 45, 60] as const) {
        for (const energy of ["low", "normal", "high"] as const) {
          const plan = createDemoWorkout({ focus, minutes, energy });
          expect(plan.drills.map(drill => drill.id)).toEqual(focus === "passing"
            ? ["PAS-001", "DRB-006"] : ["DRB-006", "PAS-001"]);
          expect(plan.drills[0].focus).toBe(focus);
          expect(plan.drills.every(drill => drill.unit === "seconds" && drill.sets >= 3 && drill.sets <= 5)).toBe(true);
          expect(plan.durationSeconds).toBe(plan.segments.reduce((sum, segment) => sum + segment.seconds, 0));
          expect(plan.segments.at(-1)?.kind).toBe("work");
        }
      }
    }
  });

  it("retains longer high-energy work doses without exceeding the five-set limit", () => {
    const plan = createDemoWorkout({ focus: "dribbling", minutes: 60, energy: "high" });
    expect(plan.drills.map(drill => [drill.id, drill.sets, drill.workSeconds, drill.restSeconds])).toEqual([
      ["DRB-006", 5, 75, 45], ["PAS-001", 5, 60, 45],
    ]);
  });

  it("requires plan review before starting, and does not tick before training", () => {
    expect(workoutReducer(initialWorkoutState, { type: "start" })).toBe(initialWorkoutState);
    const prepared = workoutReducer(initialWorkoutState, { type: "prepare", choices });
    expect(prepared.step).toBe("preparing");
    expect(workoutReducer(prepared, { type: "start" })).toBe(prepared);
    expect(workoutReducer(prepared, { type: "tick", seconds: 20 })).toBe(prepared);
    expect(workoutReducer(prepared, { type: "ready" }).step).toBe("review");
  });

  it("waits for explicit set completion at zero; rest advances without consuming the next set", () => {
    let state = workoutReducer(startWorkout(), { type: "tick", seconds: 100 });
    expect([state.segment, state.remaining, state.elapsed, state.completedSets]).toEqual([0, 0, 60, 0]);
    state = workoutReducer(state, { type: "advance" });
    expect([state.segment, state.remaining, state.completedSets, state.skippedTime]).toEqual([1, 45, 1, false]);
    state = workoutReducer(state, { type: "tick", seconds: 100 });
    expect([state.segment, state.remaining, state.elapsed, state.completedSets]).toEqual([2, 60, 105, 1]);
  });

  it("suspends paused timers and rejects invalid or backwards time deltas", () => {
    let state = workoutReducer(startWorkout(), { type: "tick", seconds: 0.25 });
    expect(state.remaining).toBe(59.75);
    state = workoutReducer(state, { type: "pause" });
    expect(workoutReducer(state, { type: "tick", seconds: 5 })).toBe(state);
    state = workoutReducer(state, { type: "pause" });
    for (const seconds of [NaN, Infinity, -1, 0]) {
      expect(workoutReducer(state, { type: "tick", seconds })).toBe(state);
    }
  });

  it("reports skipped time honestly without inventing elapsed training time", () => {
    let state = workoutReducer(startWorkout(), { type: "tick", seconds: 2.5 });
    state = workoutReducer(state, { type: "advance" });
    expect([state.completedSets, state.skippedTime, state.elapsed]).toEqual([1, true, 2.5]);
    state = workoutReducer(state, { type: "finishDemo" });
    expect([state.step, state.completedSets, state.elapsed, state.skippedTime]).toEqual(["summary", 7, 2.5, true]);
  });

  it("can finish the entire sample with the exact work/rest duration and no final rest", () => {
    let state = startWorkout();
    for (let safety = 0; state.step === "training" && safety < 30; safety++) {
      const wasWorking = state.workout!.segments[state.segment].kind === "work";
      state = workoutReducer(state, { type: "tick", seconds: state.remaining });
      if (wasWorking) state = workoutReducer(state, { type: "advance" });
    }
    expect([state.step, state.completedSets, state.elapsed, state.skippedTime, state.paused]).toEqual(["summary", 7, 600, false, false]);
    expect(workoutReducer(state, { type: "tick", seconds: 10 })).toBe(state);
    expect(workoutReducer(state, { type: "reset" })).toEqual(initialWorkoutState);
  });

  it("keeps exact sample evidence behind each coach answer", () => {
    for (const question of coachQuestions) {
      expect(sampleAthlete.metrics.some(metric => metric.key === question.metric)).toBe(true);
    }
    expect(coachQuestions[0].answer).toContain("6.62 to 6.18 seconds");
    expect(coachQuestions[1].answer).toContain("8.2 m/s, up from 7.9 m/s");
    expect(coachQuestions[2].answer).toContain("three of four planned sessions");
    expect(formatDuration(59.75)).toBe("1:00");
    expect(formatDuration(-1)).toBe("0:00");
  });
});
