// Signed-out preview data (?preview=1), following the roster/portal
// convention: realistic shapes, obviously fictional people. Everything is
// in-memory; writes fail harmlessly against security rules.

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { AthleteBundle } from "./data";

function isoDay(daysAgo: number): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 17, 0).valueOf();
}

function rep(statsDrill: string, fields: Record<string, number>, daysAgo: number, session: number, id: string): any {
  return { id, _statsDrill: statsDrill, repType: statsDrill, sessionNumber: session, createdAtMillis: isoDay(daysAgo), ...fields };
}

function sprintSet(base: number, startDay: number, session: number, prefix: string): any[] {
  return [0, 1, 2].map(index =>
    rep("sprint", { max_velocity: base + index * 0.12, max_acceleration: 4.4 + index * 0.2, totalTime: 2.4 - index * 0.05 }, startDay - index, session + index, `${prefix}-${index}`));
}

// Monday of the current week, so the mock plan's "current week" lands mid-plan.
function mockStartDate(): string {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) - 14);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

function planDrill(overrides: Record<string, any>): any {
  return {
    sets: 3, reps: 6, repUnit: "reps", restSeconds: 60, frequencyPerWeek: 2,
    intensityIntent: "moderate", estimatedMinutes: 12, cues: ["Quality over volume"], note: "",
    weeklyMinutes: 24, ...overrides,
  };
}

function mockWeek(weekNumber: number, wrinkle: number): any {
  const drills = [
    planDrill({ drillId: "WRM-002", name: "Dynamic warm-up", domain: "strengthResilience", sets: 1, reps: 6, repUnit: "minutes", restSeconds: 0, frequencyPerWeek: 3, estimatedMinutes: 6, weeklyMinutes: 18 }),
    planDrill({ drillId: "SPD-010", name: "Acceleration starts", domain: "linearSpeed", sets: 4 + (wrinkle % 2), reps: 3, restSeconds: 90, intensityIntent: "maxQuality", estimatedMinutes: 14, weeklyMinutes: 28 }),
    planDrill({ drillId: "DRB-004", name: "Tight-space control", domain: "dribbling", reps: 45, repUnit: "seconds", restSeconds: 45, frequencyPerWeek: 3, estimatedMinutes: 10, weeklyMinutes: 30 }),
    planDrill({ drillId: "PWR-006", name: "Depth-drop landings", domain: "verticalPower", reps: 5, repUnit: "contacts", restSeconds: 75, estimatedMinutes: 8, weeklyMinutes: 16 }),
  ];
  return {
    weekNumber,
    theme: ["Foundations", "Build", "Accelerate", "Sharpen", "Peak"][Math.min(weekNumber - 1, 4)],
    focus: "Quality acceleration work with the ball close by.",
    progressionNote: weekNumber > 1 ? "One more set of starts than last week." : "Learn the movements at an easy pace.",
    intensityNote: "Hard efforts short, rests honest.",
    allocations: [
      { domain: "linearSpeed", minutes: 42 },
      { domain: "dribbling", minutes: 30 },
      { domain: "verticalPower", minutes: 16 },
      { domain: "strengthResilience", minutes: 18 },
    ],
    targets: [
      { domain: "strengthResilience", exposures: 3 },
      { domain: "linearSpeed", exposures: 2 },
      { domain: "dribbling", exposures: 3 },
      { domain: "verticalPower", exposures: 2 },
    ],
    drills,
  };
}

const mockPlan: any = {
  id: "preview-plan",
  schemaVersion: 1,
  playerId: "preview-player",
  status: "active",
  generatedAt: new Date(),
  catalogVersion: "1.0.0",
  startDate: mockStartDate(),
  horizonWeeks: 6,
  intake: { goals: ["speedAgility", "dribbling"], daysPerWeek: 3, minutesPerSession: 60, setting: "solo", level: "club", painFlag: false },
  focusAreas: [
    { domain: "linearSpeed", rationale: "First-step speed is the clearest opportunity." },
    { domain: "dribbling", rationale: "Control at speed lags the rest of the profile." },
  ],
  weeks: [1, 2, 3, 4, 5].map(weekNumber => mockWeek(weekNumber, weekNumber)),
};

function mockLog(daysAgo: number, minutes: number, completed: boolean): any {
  const started = new Date(isoDay(daysAgo));
  return {
    id: `log-${daysAgo}`,
    planId: "preview-plan",
    weekNumber: 1,
    startedAt: started,
    endedAt: new Date(started.valueOf() + minutes * 60000),
    endReason: completed ? "completed" : "endedEarly",
    blocks: [],
  };
}

export const PREVIEW_PLAYERS: any[] = [
  { id: "preview-player", firstName: "Jordan", lastName: "Rivera", registered: true, age: 15 },
  { id: "preview-2", firstName: "Maya", lastName: "Thompson", registered: true, age: 14 },
  { id: "preview-3", firstName: "Eli", lastName: "Santos", registered: true, age: 16 },
  { id: "preview-4", firstName: "Avery", lastName: "Chen", registered: false, age: 13 },
];

// A small believable slice of the drill catalog for the preview's Add-drill flow.
export const PREVIEW_CATALOG: any[] = [
  {
    drillId: "SPD-002", name: "Wall drives", domain: "linearSpeed", intensityIntent: "moderate",
    cues: ["Punch the knee through", "Stay tall at the wall"], execution: "Lean into a wall at 45° and drive alternating knees with intent.",
    dose: { setsMin: 2, setsMax: 4, repsMin: 6, repsMax: 10, repUnit: "reps", restSecondsMin: 45, restSecondsMax: 60, frequencyPerWeekMin: 1, frequencyPerWeekMax: 3, doseText: "2–4 × 6–10 drives each side" },
    estimatedMinutes: { min: 6, max: 10 },
  },
  {
    drillId: "DRB-001", name: "Cone weave ladders", domain: "dribbling", intensityIntent: "moderate",
    cues: ["Small touches", "Head up between gates"], execution: "Weave a five-cone line with both feet, building speed run to run.",
    dose: { setsMin: 3, setsMax: 5, repsMin: 30, repsMax: 60, repUnit: "seconds", restSecondsMin: 30, restSecondsMax: 60, frequencyPerWeekMin: 2, frequencyPerWeekMax: 4, doseText: "3–5 × 30–60s weaves" },
    estimatedMinutes: { min: 8, max: 12 },
  },
  {
    drillId: "PAS-003", name: "Wall pass rhythm", domain: "passingReceiving", intensityIntent: "low",
    cues: ["Firm pass, soft touch", "Both feet"], execution: "Two-touch passing against a wall, alternating feet on a metronome rhythm.",
    dose: { setsMin: 3, setsMax: 4, repsMin: 20, repsMax: 30, repUnit: "passes", restSecondsMin: 30, restSecondsMax: 45, frequencyPerWeekMin: 2, frequencyPerWeekMax: 5, doseText: "3–4 × 20–30 passes" },
    estimatedMinutes: { min: 8, max: 12 },
  },
  {
    drillId: "SHO-005", name: "Placed finishes", domain: "shooting", intensityIntent: "high",
    cues: ["Plant foot points at target", "Strike through the ball"], execution: "Finish rolled balls into corners from the edge of the box.",
    dose: { setsMin: 2, setsMax: 3, repsMin: 6, repsMax: 10, repUnit: "shots", restSecondsMin: 60, restSecondsMax: 90, frequencyPerWeekMin: 1, frequencyPerWeekMax: 2, doseText: "2–3 × 6–10 shots" },
    estimatedMinutes: { min: 10, max: 15 },
  },
  {
    drillId: "PWR-011", name: "Broad jump series", domain: "horizontalPower", intensityIntent: "maxQuality",
    cues: ["Load the hips", "Stick the landing"], execution: "Maximal standing broad jumps with a full reset between reps.",
    dose: { setsMin: 3, setsMax: 4, repsMin: 3, repsMax: 5, repUnit: "reps", restSecondsMin: 60, restSecondsMax: 120, frequencyPerWeekMin: 1, frequencyPerWeekMax: 2, doseText: "3–4 × 3–5 jumps" },
    estimatedMinutes: { min: 8, max: 12 },
  },
];

export const PREVIEW_BUNDLES: Record<string, AthleteBundle> = {
  "preview-player": {
    reps: [
      ...sprintSet(5.6, 20, 1, "jr-s1"),
      ...sprintSet(5.9, 6, 4, "jr-s2"),
      rep("jump", { jumpHeight: 0.41 }, 12, 1, "jr-j1"),
      rep("jump", { jumpHeight: 0.44 }, 4, 2, "jr-j2"),
      rep("broadJump", { broadJumpDistance: 1.9 }, 12, 1, "jr-b1"),
      rep("dribbling", { totalTime: 7.1, avgBallDistance: 0.71, phase1Time: 2.7, phase2Time: 2.6, phase3Time: 1.8 }, 9, 1, "jr-d1"),
      rep("shooting", { velocity: 24.0 }, 15, 1, "jr-k1"),
    ],
    plans: [mockPlan],
    logs: [mockLog(9, 34, true), mockLog(6, 28, true), mockLog(2, 21, false)],
  },
  "preview-2": {
    reps: [
      ...sprintSet(6.1, 10, 1, "mt-s1"),
      rep("changeOfDirection", { totalTime: 5.1, phase1Time: 2.2, phase2Time: 1.3, phase3Time: 1.6 }, 8, 1, "mt-c1"),
      rep("jump", { jumpHeight: 0.47 }, 5, 1, "mt-j1"),
      rep("shooting", { velocity: 27.5 }, 3, 1, "mt-k1"),
    ],
    plans: [],
    logs: [mockLog(5, 25, true)],
  },
  "preview-3": {
    reps: [
      rep("dribbling", { totalTime: 6.4, avgBallDistance: 0.62, phase1Time: 2.5, phase2Time: 2.3, phase3Time: 1.6 }, 18, 1, "es-d1"),
      rep("dribbling", { totalTime: 6.1, avgBallDistance: 0.58, phase1Time: 2.4, phase2Time: 2.2, phase3Time: 1.5 }, 3, 2, "es-d2"),
      rep("broadJump", { broadJumpDistance: 2.2 }, 7, 1, "es-b1"),
    ],
    plans: [],
    logs: [],
  },
  "preview-4": { reps: [], plans: [], logs: [] },
};
