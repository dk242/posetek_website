import { describe, expect, it } from "vitest";
import {
  LEADERBOARD_CATEGORIES,
  boardSummary,
  boardsFromPlayers,
  currentWeek,
  dateText,
  demoPlan,
  heightText,
  initials,
  nearestLimb,
  normalizePose,
  number,
  rankRows,
  statsSnapshot,
  timestamp,
  weightText,
} from "./mobile";
import type { BodyPoint } from "./mobile";
import { previewBoards, previewBodyPoints, previewData } from "./preview";

describe("number / initials", () => {
  it("parses finite numbers", () => {
    expect(number("4")).toBe(4);
    expect(number(undefined)).toBeNull();
    expect(number(NaN)).toBeNull();
  });
  it("initials mirrors legacy", () => {
    expect(initials("maya chen")).toBe("MC");
    expect(initials("a b c")).toBe("AB");
    expect(initials(null)).toBe("A");
  });
});

describe("timestamp / dateText", () => {
  it("unwraps Firestore Timestamps, Dates, and millis", () => {
    const date = new Date(2026, 0, 5);
    expect(timestamp({ toDate: () => date })).toBe(date);
    expect(timestamp(date)).toBe(date);
    expect(timestamp(date.valueOf())?.valueOf()).toBe(date.valueOf());
    expect(timestamp("zzz")).toBeNull();
    expect(timestamp(null)).toBeNull();
  });
  it("dateText falls back to Recently", () => {
    expect(dateText(null)).toBe("Recently");
  });
});

describe("body profile formatting", () => {
  it("heightText converts cm to feet/inches like legacy", () => {
    expect(heightText(178)).toBe("5′ 10″");
    expect(heightText(null)).toBe("—");
  });
  it("weightText converts kg to lbs like legacy", () => {
    expect(weightText(72)).toBe("159 lbs");
    expect(weightText(null)).toBe("—");
  });
});

describe("normalizePose", () => {
  it("parses array-of-arrays points", () => {
    expect(normalizePose([[1, 2, 3, .5]])).toEqual([{ id: 0, x: 1, y: 2, z: 3, visibility: .5 }]);
  });
  it("parses {landmarks: [...]}", () => {
    expect(normalizePose({ landmarks: [{ x: .1, y: .2, z: .3, visibility: .4 }] })).toEqual([
      { id: 0, x: .1, y: .2, z: .3, visibility: .4 },
    ]);
  });
  it("defaults visibility to 1 and missing coords to null", () => {
    expect(normalizePose([{ x: .1, y: .2 }])).toEqual([{ id: 0, x: .1, y: .2, z: null, visibility: 1 }]);
    expect(normalizePose(null)).toEqual([]);
  });
});

describe("nearestLimb", () => {
  const points: BodyPoint[] = [];
  points[11] = { id: 11, x: .38, y: .25, z: null, visibility: 1 };
  points[13] = { id: 13, x: .28, y: .42, z: null, visibility: 1 };
  it("finds the limb within the 34px threshold", () => {
    const limb = nearestLimb(points, { x: 33, y: 33.5 }, 100, 100);
    expect(limb?.name).toBe("Left upper arm");
  });
  it("returns null when nothing is close enough", () => {
    expect(nearestLimb(points, { x: 95, y: 95 }, 100, 100)).toBeNull();
  });
});

describe("currentWeek", () => {
  const daysAgo = (days: number) => {
    const d = new Date(Date.now() - days * 86400000);
    const pad = (v: number) => String(v).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  it("is 1 for invalid start dates", () => {
    expect(currentWeek({ startDate: "not-a-date", horizonWeeks: 6 })).toBe(1);
  });
  it("computes the elapsed week", () => {
    expect(currentWeek({ startDate: daysAgo(15), horizonWeeks: 6 })).toBe(3);
  });
  it("clamps to the horizon and to 1", () => {
    expect(currentWeek({ startDate: daysAgo(100), horizonWeeks: 6 })).toBe(6);
    expect(currentWeek({ startDate: daysAgo(-5), horizonWeeks: 6 })).toBe(1);
  });
  it("falls back to weeks length for the horizon", () => {
    expect(currentWeek({ startDate: daysAgo(100), weeks: [{}, {}, {}] })).toBe(3);
  });
});

describe("statsSnapshot", () => {
  it("clamps and rounds scores, omitting null ones", () => {
    const snapshot = statsSnapshot({
      totalReps: 5,
      totalSessions: 2,
      overall: 123.456,
      axes: [
        { key: "pace", repCount: 3, score: 88.888 },
        { key: "skill", repCount: 0, score: null },
      ],
    });
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.benchmarkProfile).toEqual({ ageBand: "senior", gender: "unspecified", isDefaulted: true });
    expect(snapshot.overallScore).toBe(123.46);
    expect(snapshot.axes[0]).toEqual({ axis: "pace", repCount: 3, missingDrills: [], score: 88.89 });
    expect(snapshot.axes[1]).toEqual({ axis: "skill", repCount: 0, missingDrills: [] });
    expect(snapshot.drills).toEqual([]);
  });
  it("omits overallScore when overall is null and clamps to [0, 400]", () => {
    expect("overallScore" in statsSnapshot({ totalReps: 0, totalSessions: 0, overall: null, axes: [] })).toBe(false);
    expect(statsSnapshot({ totalReps: 0, totalSessions: 0, overall: 999, axes: [] }).overallScore).toBe(400);
    expect(statsSnapshot({ totalReps: 0, totalSessions: 0, overall: -5, axes: [] }).overallScore).toBe(0);
  });
});

describe("rankRows / boardSummary", () => {
  it("assigns tied ranks within the .0001 tolerance", () => {
    const ranked = rankRows([
      { id: "a", name: "A", value: 10 },
      { id: "b", name: "B", value: 10.00005 },
      { id: "c", name: "C", value: 9 },
    ], false);
    expect(ranked.map(r => r.id)).toEqual(["b", "a", "c"]);
    expect(ranked.map(r => r.rank)).toEqual([1, 1, 3]);
  });
  it("sorts ascending when lower is better", () => {
    const ranked = rankRows([
      { id: "a", name: "A", value: 4.63 },
      { id: "b", name: "B", value: 4.08 },
    ], true);
    expect(ranked[0].id).toBe("b");
  });
  it("boardSummary computes rank and percentile like renderBoard", () => {
    const ranked = rankRows([
      { id: "one", name: "Maya Chen", value: 4.08 },
      { id: "me", name: "Jordan Rivera", value: 4.42 },
      { id: "three", name: "Alex Morgan", value: 4.63 },
      { id: "four", name: "Sam Lee", value: 4.81 },
    ], true);
    const { athlete, percentile } = boardSummary(ranked, true, "me");
    expect(athlete?.rank).toBe(2);
    expect(percentile).toBe(67);
  });
  it("boardSummary is null-safe without the athlete", () => {
    const { athlete, percentile } = boardSummary(rankRows([{ id: "x", name: "X", value: 1 }], false), false, "me");
    expect(athlete).toBeNull();
    expect(percentile).toBeNull();
  });
});

describe("boardsFromPlayers", () => {
  it("uses field fallbacks, drill-type matching, and unit conversion", () => {
    const boards = boardsFromPlayers([
      {
        id: "p1",
        name: "P One",
        reps: [
          { repType: "sprint", maxVelocity: 8 },
          { repType: "sprint", maxVelocity: 7 },
          { repType: "side_kick", velocity: 10 },
          { drillType: "deadballShot", velocity: 12 },
          { repType: "changeOfDirection", totalTime: 4.4 },
          { repType: "changeOfDirection", totalTime: 4.2 },
          { repType: "jump", jumpHeight: .5 },
        ],
      },
      { id: "p2", name: "P Two", reps: [] },
    ]);
    expect(boards.sprint).toHaveLength(1);
    expect(boards.sprint[0].value).toBeCloseTo(8 * 2.23694, 10);
    expect(boards.shooting[0].value).toBeCloseTo(12 * 2.23694, 10);
    expect(boards.changeOfDirection[0].value).toBe(4.2);
    expect(boards.jump[0].value).toBeCloseTo(.5 * 39.3701, 10);
    expect(boards.dribbling).toHaveLength(0);
  });
});

describe("demoPlan", () => {
  it("builds the six-week preview plan", () => {
    const plan = demoPlan();
    expect(plan.weeks).toHaveLength(6);
    expect(plan.weeks[5].theme).toBe("Retest and review");
    expect(plan.weeks[5].drills).toEqual([]);
    expect(plan.weeks[0].drills[0].drillId).toBe("SPD-010");
    expect(plan.horizonWeeks).toBe(6);
    expect(plan.status).toBe("active");
  });
});

describe("preview data", () => {
  it("previewData mirrors legacy loadPreview", () => {
    const data = previewData();
    expect(data.access).toBe("preview");
    expect(data.playerId).toBe("preview-player");
    expect(data.athlete).toEqual({ firstName: "Jordan", lastName: "Rivera", height: 178, weight: 72 });
    expect(data.reps.shooting).toHaveLength(3);
    expect(data.reps.shooting[0]).toMatchObject({ id: "deadballShot-1", repType: "deadballShot", velocity: 28.2, launch_angle: 18.4, strike_foot: "right", sessionNumber: 3, repNumber: 1 });
    expect(data.reps.shooting[2].sessionNumber).toBe(2);
    expect(data.reps.freeRecord.map((r: { sessionFolder: string }) => r.sessionFolder)).toEqual(["session2", "session1"]);
    expect(data.reps.freeRecord[0].repFolder).toBe("kick1");
    expect(data.reps.changeOfDirection[0]).toMatchObject({ totalTime: 4.42, startFrame: 10, apexFrame: 60, endFrame: 112 });
  });
  it("previewBoards keys match the leaderboard categories", () => {
    const boards = previewBoards("preview-player", "Jordan Rivera");
    expect(Object.keys(boards).sort()).toEqual(LEADERBOARD_CATEGORIES.map(c => c.key).sort());
    expect(boards.changeOfDirection[1]).toEqual({ id: "preview-player", name: "Jordan Rivera", value: 4.42 });
    expect(boards.sprint[0].value).toBeCloseTo(20.1, 10);
  });
  it("previewBodyPoints builds the 33-point demo pose", () => {
    const points = previewBodyPoints();
    expect(points).toHaveLength(33);
    expect(points[11]).toMatchObject({ x: .38, y: .25 });
    expect(points[0]).toMatchObject({ x: .5, y: .5, visibility: 1 });
  });
});
