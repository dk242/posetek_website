/**
 * Sample-only product logic recovered from product-demo-fcPr5ZHv.js in the
 * approved September 15 deployment. No API requests, persistence, or live plans.
 * The published dribbling/passing dose rules and transition semantics are retained.
 * The public showcase is limited to two drills with approved demonstration media.
 */
export type DemoFocus = "dribbling" | "passing";
export type DemoEnergy = "low" | "normal" | "high";
export interface WorkoutChoices {
  minutes: 15 | 20 | 30 | 45 | 60;
  energy: DemoEnergy;
  focus: DemoFocus;
}
export interface DemoDrill {
  id: string;
  name: string;
  focus: DemoFocus;
  setup: string;
  instruction: string;
  cue: string;
  sets: number;
  reps: number;
  unit: "shots" | "seconds";
  workSeconds: number;
  restSeconds: number;
}
export interface WorkoutSegment {
  kind: "work" | "rest";
  drill: number;
  set: number;
  seconds: number;
}
export interface DemoWorkout {
  choices: WorkoutChoices;
  title: string;
  intent: string;
  drills: DemoDrill[];
  segments: WorkoutSegment[];
  durationSeconds: number;
}
export interface WorkoutState {
  step: "intake" | "preparing" | "review" | "training" | "summary";
  workout: DemoWorkout | null;
  segment: number;
  remaining: number;
  elapsed: number;
  completedSets: number;
  paused: boolean;
  skippedTime: boolean;
}
export type WorkoutAction =
  | { type: "prepare"; choices: WorkoutChoices }
  | { type: "ready" | "edit" | "reset" | "start" | "pause" | "advance" | "finishDemo" }
  | { type: "tick"; seconds: number };

const drillCatalog: Record<DemoFocus, Omit<DemoDrill, "sets" | "reps" | "unit" | "workSeconds" | "restSeconds">> = {
  dribbling: {
    id: "DRB-006", name: "Figure-8 dribble", focus: "dribbling",
    setup: "Two cones, 2–5 m apart, and a ball.",
    instruction: "Dribble a figure eight around both cones. Use inside and outside touches in both directions.",
    cue: "Keep touches close through the turn. Lift your eyes between cones.",
  },
  passing: {
    id: "PAS-001", name: "Wall pass rhythm", focus: "passing",
    setup: "Stand 3–8 m from a wall with a target.",
    instruction: "Pass and receive repeatedly. Alternate feet, using one or two touches.",
    cue: "Plant beside the ball. First touch sets the next pass.",
  },
};
const workoutCopy: Record<DemoFocus, readonly [string, string]> = {
  dribbling: ["Own your next touch", "Controlled touches first. Build speed when the ball stays close."],
  passing: ["Find your passing rhythm", "Receive with purpose and make the next pass clean."],
};

export function focusFromRequest(request: string): DemoFocus {
  return /pass|receiv/i.test(request) ? "passing" : "dribbling";
}

export function createDemoWorkout(choices: WorkoutChoices): DemoWorkout {
  const extended = choices.minutes >= 30;
  const primarySets = choices.minutes === 15 ? 3 : choices.minutes >= 45 ? 5 : 4;
  const secondaryFocus: DemoFocus = choices.focus === "passing" ? "dribbling" : "passing";
  const drills: DemoDrill[] = [choices.focus, secondaryFocus].map((focus, index) => {
    const light = choices.energy === "low";
    const sets = Math.min(5, index === 0 ? primarySets : choices.minutes === 60 ? 5 : extended ? 4 : 3);
    const reps = focus === "passing" ? light ? 30 : extended || choices.energy === "high" ? 60 : 45
      : light ? 45 : choices.energy === "high" && extended ? 75 : 60;
    return { ...drillCatalog[focus], sets, reps, unit: "seconds", workSeconds: reps, restSeconds: 45 };
  });
  const segments: WorkoutSegment[] = [];
  drills.forEach((drill, drillIndex) => {
    for (let set = 1; set <= drill.sets; set++) {
      segments.push({ kind: "work", drill: drillIndex, set, seconds: drill.workSeconds });
      if (set < drill.sets) segments.push({ kind: "rest", drill: drillIndex, set, seconds: drill.restSeconds });
    }
  });
  return {
    choices: { ...choices }, title: workoutCopy[choices.focus][0], intent: workoutCopy[choices.focus][1],
    drills, segments, durationSeconds: segments.reduce((total, segment) => total + segment.seconds, 0),
  };
}

export function formatDose(drill: Pick<DemoDrill, "sets" | "reps" | "unit">): string {
  return `${drill.sets} × ${drill.reps}${drill.unit === "seconds" ? " sec" : ` ${drill.unit}`}`;
}
export function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}
export const initialWorkoutState: WorkoutState = {
  step: "intake", workout: null, segment: 0, remaining: 0, elapsed: 0,
  completedSets: 0, paused: false, skippedTime: false,
};

function advanceSegment(state: WorkoutState, skipped: boolean): WorkoutState {
  if (state.step !== "training" || !state.workout) return state;
  const completedSets = state.completedSets + Number(state.workout.segments[state.segment].kind === "work");
  const segment = state.segment + 1;
  return {
    ...state, completedSets, skippedTime: state.skippedTime || skipped,
    ...(segment >= state.workout.segments.length
      ? { step: "summary", remaining: 0, paused: false }
      : { segment, remaining: state.workout.segments[segment].seconds }),
  };
}

export function workoutReducer(state: WorkoutState, action: WorkoutAction): WorkoutState {
  switch (action.type) {
    case "prepare": return { ...initialWorkoutState, step: "preparing", workout: createDemoWorkout(action.choices) };
    case "ready": return state.step === "preparing" ? { ...state, step: "review" } : state;
    case "edit":
    case "reset": return { ...initialWorkoutState };
    case "start": return state.step === "review" && state.workout
      ? { ...state, step: "training", remaining: state.workout.segments[0].seconds } : state;
    case "pause": return state.step === "training" ? { ...state, paused: !state.paused } : state;
    case "advance": return advanceSegment(state, state.remaining > 0);
    case "finishDemo": return state.step === "training" && state.workout ? {
      ...state, step: "summary", remaining: 0, paused: false, skippedTime: true,
      completedSets: state.workout.drills.reduce((total, drill) => total + drill.sets, 0),
    } : state;
    case "tick": {
      if (state.step !== "training" || state.paused || !Number.isFinite(action.seconds) || action.seconds <= 0) return state;
      const remaining = Math.max(0, state.remaining - action.seconds);
      const ticked = { ...state, remaining, elapsed: state.elapsed + Math.min(state.remaining, action.seconds) };
      // Work waits for explicit completion. Rest advances automatically, without
      // carrying a delayed timer's excess seconds into the next working set.
      return remaining === 0 && state.workout?.segments[state.segment].kind === "rest"
        ? advanceSegment(ticked, false) : ticked;
    }
  }
}

export const sampleAthlete = {
  name: "Alex Johnson", initials: "AJ", role: "Midfielder", week: "Week 2 · Close control",
  metrics: [
    { key: "dribbling", label: "Dribbling", value: "6.18", unit: "sec", previous: "6.62 sec", trend: "0.44 sec faster", values: [6.62, 6.43, 6.31, 6.18] },
    { key: "speed", label: "Top speed", value: "8.2", unit: "m/s", previous: "7.9 m/s", trend: "+0.3 m/s", values: [7.9, 8, 8, 8.2] },
    { key: "training", label: "Sessions", value: "3", unit: "/ 4", previous: "2 / 4 last week", trend: "One session to go", values: [1, 2, 2, 3] },
  ],
};
export const coachQuestions = [
  {
    id: "progress", question: "How am I progressing?", metric: "dribbling", title: "Your control is getting quicker.",
    answer: "Your dribbling time moved from 6.62 to 6.18 seconds across four assessments: 0.44 seconds faster. Keep comparing the same setup as you build on that progress.",
    evidence: "Dribbling · last four assessments",
  },
  {
    id: "strength", question: "What is improving?", metric: "speed", title: "Your top speed is trending up.",
    answer: "Your latest top speed is 8.2 m/s, up from 7.9 m/s. You reached 8.0 m/s in the two assessments between them, so the latest result builds on that trend.",
    evidence: "Top speed · 7.9 → 8.2 m/s",
  },
  {
    id: "focus", question: "What should I focus on next?", metric: "training", title: "Keep the next session focused.",
    answer: "You have completed three of four planned sessions this week. Your active plan focuses on close control. A short dribbling session would keep your next workout connected to that plan.",
    evidence: "Active plan · Week 2 · Close control",
  },
];
export const coachWorkoutRequest = "Help me plan 20 minutes of dribbling training.";
