// Batch program generation — the pure half. Nothing here touches Firestore, so
// it tests without a mock; the reads and the job submission live in
// programBatch.ts. LLM_GATEWAY_CONTRACT.md §5 / PLAYER_PROFILE_INPUTS_CONTRACT.md
// §5 own the intake shape; this module only decides who can be selected, how a
// batch is described, and how many jobs run at once.

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The six measured drills, keyed the way the stats component tags reps (`_statsDrill`). */
export const MEASURED_DRILL_KEYS = ["shooting", "sprint", "jump", "broadJump", "dribbling", "changeOfDirection"] as const;
export type MeasuredDrillKey = (typeof MEASURED_DRILL_KEYS)[number];

export const DRILL_SHORT_LABELS: Record<MeasuredDrillKey, string> = {
  shooting: "Shot",
  sprint: "Sprint",
  jump: "Jump",
  broadJump: "Broad",
  dribbling: "Dribble",
  changeOfDirection: "COD",
};

/** The gateway's intake equipment vocabulary (`program_profile.EQUIPMENT`), verbatim. */
export const EQUIPMENT_OPTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "ball", label: "Ball" },
  { id: "cones", label: "Cones" },
  { id: "markers", label: "Markers" },
  { id: "wall", label: "Wall" },
  { id: "goal", label: "Goal" },
  { id: "hurdles", label: "Hurdles" },
  { id: "box", label: "Box" },
  { id: "sledOrBand", label: "Sled or band" },
  { id: "timer", label: "Timer" },
  { id: "bench", label: "Bench" },
  { id: "mat", label: "Mat" },
  { id: "kneePad", label: "Knee pad" },
  { id: "tapeMeasure", label: "Tape measure" },
  { id: "cueDevice", label: "Cue device" },
];

/** `auto` keeps the level the single-athlete form derives from the stats profile. */
export const LEVEL_OPTIONS = ["auto", "foundation", "club", "performance"] as const;
export type LevelChoice = (typeof LEVEL_OPTIONS)[number];

/** How many generation jobs the console keeps in flight at once. */
export const BATCH_CONCURRENCY = 3;

export function testedDrills(reps: any[]): MeasuredDrillKey[] {
  const present = new Set(reps.map(rep => String(rep?._statsDrill || rep?.repType || rep?.drillType || "")));
  return MEASURED_DRILL_KEYS.filter(key => present.has(key));
}

export function isFullyTested(reps: any[]): boolean {
  return testedDrills(reps).length === MEASURED_DRILL_KEYS.length;
}

export interface AthleteEvidence {
  tested: MeasuredDrillKey[];
  repCount: number;
  age: number | null;
  ageStale: boolean;
  position: string | null;
  /** `schemaVersion` of the active plan a new program would supersede, else null. */
  activePlanVersion: number | null;
}

export type Selectable = { ok: true } | { ok: false; reason: string };

/**
 * An athlete with no age on file is not selectable: the engine's safety
 * default treats an unknown age as 10, which is the wrong program for anyone
 * this console is likely to see. Set the age on the athlete page first.
 */
export function selectable(evidence: AthleteEvidence | null | undefined): Selectable {
  if (!evidence) return { ok: false, reason: "Still loading this athlete's evidence." };
  if (evidence.age === null) {
    return { ok: false, reason: "No age on file — the engine would treat them as 10. Set it on the athlete page first." };
  }
  return { ok: true };
}

/** Overrides the derived intake level when the admin picked one; `auto` returns the params untouched. */
export function applyLevel(params: Record<string, any>, level: LevelChoice): Record<string, any> {
  if (level === "auto") return params;
  return { ...params, intake: { ...(params.intake ?? {}), level } };
}

export interface BatchShape {
  horizonWeeks: number;
  sessionsPerWeek: number;
  minutesPerSession: number;
}

export function describeBatch(count: number, shape: BatchShape): string {
  const athletes = `${count} athlete${count === 1 ? "" : "s"}`;
  const weekly = shape.sessionsPerWeek * shape.minutesPerSession;
  return `${athletes} × ${shape.horizonWeeks} week${shape.horizonWeeks === 1 ? "" : "s"} × ${shape.sessionsPerWeek} session${shape.sessionsPerWeek === 1 ? "" : "s"} of ${shape.minutesPerSession} min (${weekly} min a week each).`;
}

/**
 * Runs `runOne` over every item with at most `concurrency` in flight. A
 * rejection is swallowed so one athlete's failure never stops the rest — the
 * caller records per-item outcomes through its own callbacks.
 */
export async function runBatch<T>(items: T[], concurrency: number, runOne: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const width = Math.max(1, Math.min(concurrency, queue.length));
  async function worker(): Promise<void> {
    while (queue.length) {
      const item = queue.shift() as T;
      try {
        await runOne(item);
      } catch {
        // Reported by the caller's per-item state; the batch keeps going.
      }
    }
  }
  await Promise.all(Array.from({ length: width }, worker));
}

export interface RosterEntry {
  id: string;
  name: string;
  teamId: string | null;
}

/** Team name first, then athlete name; athletes with no team sort last. */
export function sortRoster<T extends RosterEntry>(players: T[], teamNames: Map<string, string>): T[] {
  const teamKey = (player: T): string => (player.teamId && teamNames.get(player.teamId)) || "￿";
  return [...players].sort((a, b) => teamKey(a).localeCompare(teamKey(b)) || a.name.localeCompare(b.name));
}
