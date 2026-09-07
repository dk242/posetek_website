import { describe, expect, it } from "vitest";
import { DRILLS, drillByKey } from "./drills";
import {
  accepted,
  allStatsReps,
  artifactFolder,
  avatarInitials,
  dashboardMetrics,
  dateText,
  displayValue,
  formatValue,
  frameMarkers,
  fullName,
  mean,
  mergeUnique,
  metricRaw,
  normalizeRep,
  num,
  parsePose,
  repFolder,
  repMetricSpecs,
  repNumber,
  sessionFolder,
  sessionNumber,
  sessionsFor,
  trendText,
} from "./metrics";

const shooting = drillByKey("shooting");
const sprint = drillByKey("sprint");
const jump = drillByKey("jump");
const broadJump = drillByKey("broadJump");
const dribbling = drillByKey("dribbling");
const changeOfDirection = drillByKey("changeOfDirection");
const freeRecord = drillByKey("freeRecord");

describe("num / mean", () => {
  it("parses numbers and rejects non-finite values", () => {
    expect(num(3.5)).toBe(3.5);
    expect(num("3.5")).toBe(3.5);
    expect(num(undefined)).toBeNull();
    expect(num("x")).toBeNull();
    expect(num(Infinity)).toBeNull();
    // Legacy quirk: Number(null) === 0, so null parses to 0.
    expect(num(null)).toBe(0);
  });
  it("mean of empty list is null", () => {
    expect(mean([])).toBeNull();
    expect(mean([1, 2, 3])).toBe(2);
  });
});

describe("rep identity helpers", () => {
  it("fullName falls back through name to Athlete", () => {
    expect(fullName({ firstName: "Jordan", lastName: "Rivera" })).toBe("Jordan Rivera");
    expect(fullName({ firstName: "Jordan" })).toBe("Jordan");
    expect(fullName({ name: "Solo" })).toBe("Solo");
    expect(fullName({})).toBe("Athlete");
    expect(fullName(null)).toBe("Athlete");
  });
  it("sessionNumber uses sessionNumber, then folder digits, then 1", () => {
    expect(sessionNumber({ sessionNumber: 4 })).toBe(4);
    expect(sessionNumber({ currentSession: "session7" })).toBe(7);
    expect(sessionNumber({ sessionFolder: "session12" })).toBe(12);
    expect(sessionNumber({})).toBe(1);
    expect(sessionNumber({ sessionNumber: 0, currentSession: "session3" })).toBe(3);
  });
  it("repNumber uses repNumber, kickNumber, then folder digits, then 1", () => {
    expect(repNumber({ repNumber: 2 })).toBe(2);
    expect(repNumber({ kickNumber: 5 })).toBe(5);
    expect(repNumber({ repFolder: "kick9" })).toBe(9);
    expect(repNumber({})).toBe(1);
  });
  it("sessionFolder/repFolder construct folder names", () => {
    expect(sessionFolder({ sessionFolder: "sessionX" })).toBe("sessionX");
    expect(sessionFolder({ currentSession: "session3" })).toBe("session3");
    expect(sessionFolder({ currentSession: "other" })).toBe("session1");
    expect(sessionFolder({ sessionNumber: 2 })).toBe("session2");
    expect(repFolder({ repFolder: "rep2" })).toBe("rep2");
    expect(repFolder({ repNumber: 3 })).toBe("kick3");
  });
  it("dateText placeholder for missing millis", () => {
    expect(dateText(0)).toBe("Recorded session");
  });
  it("avatarInitials takes up to two initials", () => {
    expect(avatarInitials("Jordan Rivera")).toBe("JR");
    expect(avatarInitials("Cher")).toBe("C");
    expect(avatarInitials("a b c")).toBe("AB");
  });
});

describe("normalizeRep", () => {
  it("unwraps Firestore-like docs and stamps createdAtMillis", () => {
    const doc = { id: "d1", data: () => ({ velocity: 1, createdAt: { toMillis: () => 42 } }) };
    const rep = normalizeRep(doc);
    expect(rep.id).toBe("d1");
    expect(rep.velocity).toBe(1);
    expect(rep.createdAtMillis).toBe(42);
  });
  it("passes plain objects through", () => {
    const rep = normalizeRep({ id: "p", createdAtMillis: 7 });
    expect(rep.id).toBe("p");
    expect(rep.createdAtMillis).toBe(7);
  });
});

describe("metric math", () => {
  it("metricRaw reads the drill metric with fallback", () => {
    expect(metricRaw({ velocity: 12.5 }, shooting)).toBe(12.5);
    expect(metricRaw({ maxVelocity: 8 }, sprint)).toBe(8);
    expect(metricRaw({ max_velocity: 9, maxVelocity: 8 }, sprint)).toBe(9);
    expect(metricRaw({ velocity: 1 }, freeRecord)).toBeNull();
  });
  it("displayValue converts units exactly like legacy", () => {
    expect(displayValue(10, shooting)).toBeCloseTo(22.3694, 10);
    expect(displayValue(1, jump)).toBeCloseTo(39.37007874, 10);
    expect(displayValue(1, broadJump)).toBeCloseTo(3.28084, 10);
    expect(displayValue(2.5, dribbling)).toBe(2.5);
    expect(displayValue(null, shooting)).toBeNull();
  });
  it("formatValue mirrors legacy digits, units, and em-dash", () => {
    expect(formatValue(10, shooting)).toBe("22.4 mph");
    expect(formatValue(null, shooting)).toBe("—");
    expect(formatValue(2.5, dribbling)).toBe("2.50 s");
    expect(formatValue(3, freeRecord)).toBe("3.0");
    expect(formatValue(10, shooting, 2)).toBe("22.37 mph");
    expect(formatValue(0.54, jump)).toBe("21.3 in");
    expect(formatValue(2.12, broadJump)).toBe("7.0 ft");
  });
  it("accepted matches drill types via repType fallbacks", () => {
    expect(accepted({ repType: "side_kick" }, shooting)).toBe(true);
    expect(accepted({ drillType: "shooting" }, shooting)).toBe(true);
    expect(accepted({ _statsDrill: "sprint", repType: "shooting" }, shooting)).toBe(false);
    expect(accepted({}, shooting)).toBe(false);
  });
});

describe("mergeUnique", () => {
  it("dedupes on session/rep folder with the right side winning", () => {
    const merged = mergeUnique(
      [{ sessionFolder: "session1", repFolder: "kick1", src: "fs" }],
      [
        { sessionFolder: "session1", repFolder: "kick1", src: "st" },
        { sessionFolder: "session2", repFolder: "kick1", src: "st" },
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0].src).toBe("st");
  });
});

describe("sessionsFor", () => {
  it("groups by folder, sorts items by rep and sessions by date desc", () => {
    const sessions = sessionsFor([
      { sessionFolder: "session2", repNumber: 2, createdAtMillis: 100 },
      { sessionFolder: "session2", repNumber: 1, createdAtMillis: 200 },
      { sessionFolder: "session1", repNumber: 1, createdAtMillis: 300 },
    ]);
    expect(sessions.map(s => s.folder)).toEqual(["session1", "session2"]);
    expect(sessions[0].number).toBe(1);
    expect(sessions[0].date).toBe(300);
    expect(sessions[1].number).toBe(2);
    expect(sessions[1].date).toBe(200);
    expect(sessions[1].items.map(r => r.repNumber)).toEqual([1, 2]);
  });
});

describe("trendText", () => {
  it("compares first vs last chronologically (values arrive newest-first)", () => {
    expect(trendText([30, 20, 10], shooting)).toBe("+200.0%");
    expect(trendText([28.2, 26.7, 25.9], shooting)).toBe("+8.9%");
    expect(trendText([4.42, 4.55, 4.68], changeOfDirection)).toBe("+5.6%");
    expect(trendText([10], shooting)).toBe("—");
    expect(trendText([], shooting)).toBe("—");
    expect(trendText([5, 0], shooting)).toBe("—");
  });
});

describe("dashboardMetrics", () => {
  it("freeRecord shows sessions and videos", () => {
    const metrics = dashboardMetrics(freeRecord, [
      { sessionFolder: "session1" },
      { sessionFolder: "session2" },
    ]);
    expect(metrics).toEqual([
      { label: "Sessions", value: "2" },
      { label: "Videos", value: "2" },
    ]);
  });
  it("shooting inserts Avg Launch Angle at index 2", () => {
    const reps = [
      { velocity: 28.2, launch_angle: 18.4 },
      { velocity: 26.7, launch_angle: 18.4 },
      { velocity: 25.9, launch_angle: 18.4 },
    ];
    const metrics = dashboardMetrics(shooting, reps);
    expect(metrics.map(m => m.label)).toEqual(["Average", "Personal Best", "Avg Launch Angle", "Total Reps", "Recent Trend"]);
    expect(metrics[0].value).toBe("60.2 mph");
    expect(metrics[1].value).toBe("63.1 mph");
    expect(metrics[2].value).toBe("18.4°");
    expect(metrics[3].value).toBe("3");
    expect(metrics[4].value).toBe("+8.9%");
  });
  it("dribbling inserts Ball Distance and appends phase metrics", () => {
    const reps = [{ totalTime: 5.08, avgBallDistance: .46, phase1Time: 1.92, phase2Time: 1.08, phase3Time: 2.08 }];
    const metrics = dashboardMetrics(dribbling, reps);
    expect(metrics.map(m => m.label)).toEqual([
      "Avg Time", "Best Time", "Ball Distance", "Total Reps", "Recent Trend", "Start / Out", "Turn", "End / Back",
    ]);
    expect(metrics[0].value).toBe("5.08 s");
    expect(metrics[1].value).toBe("5.08 s");
    expect(metrics[2].value).toBe("18.1 in");
    expect(metrics[4].value).toBe("—");
    expect(metrics[5].value).toBe("1.92 s");
    expect(metrics[6].value).toBe("1.08 s");
    expect(metrics[7].value).toBe("2.08 s");
  });
  it("uses em-dash when no values exist", () => {
    const metrics = dashboardMetrics(sprint, []);
    expect(metrics[0].value).toBe("—");
    expect(metrics[1].value).toBe("—");
    expect(metrics[2].value).toBe("0");
    expect(metrics[3].value).toBe("—");
  });
});

describe("parsePose", () => {
  it("parses arrays of [x, y] frames", () => {
    expect(parsePose([[[1, 2], [3, 4]]])).toEqual([[{ x: 1, y: 2 }, { x: 3, y: 4 }]]);
  });
  it("parses {frames: [{landmarks: [...]}]}", () => {
    expect(parsePose({ frames: [{ landmarks: [{ x: .1, y: .2 }] }] })).toEqual([[{ x: .1, y: .2 }]]);
  });
  it("parses {frames: [{pose: [[x, y]]}]}", () => {
    expect(parsePose({ frames: [{ pose: [[5, 6]] }] })).toEqual([[{ x: 5, y: 6 }]]);
  });
  it("handles missing input", () => {
    expect(parsePose(null)).toEqual([]);
    expect(parsePose({})).toEqual([]);
  });
});

describe("frameMarkers", () => {
  it("broadJump reads takeoff/landing with meta priority", () => {
    expect(frameMarkers(broadJump, { takeoffFrame: 22, landingFrame: 78 }, {})).toEqual([
      { label: "Takeoff", frame: 22 },
      { label: "Landing", frame: 78 },
    ]);
    expect(frameMarkers(broadJump, { takeoffFrame: 22 }, { takeoffFrame: 5 })[0]).toEqual({ label: "Takeoff", frame: 5 });
  });
  it("dribbling/changeOfDirection read start/turn/end", () => {
    expect(frameMarkers(changeOfDirection, { startFrame: 10, apexFrame: 60, endFrame: 112 }, {})).toEqual([
      { label: "Start", frame: 10 },
      { label: "Turn", frame: 60 },
      { label: "End", frame: 112 },
    ]);
    expect(frameMarkers(dribbling, {}, { startFrame: 1, phase1EndFrame: 2, endFrame: 3 })).toEqual([
      { label: "Start", frame: 1 },
      { label: "Turn", frame: 2 },
      { label: "End", frame: 3 },
    ]);
  });
  it("sprint only reads meta frames and filters missing ones", () => {
    expect(frameMarkers(sprint, { startFrame: 4 }, {})).toEqual([]);
    expect(frameMarkers(sprint, {}, { startFrame: 1, finishFrame: 9 })).toEqual([
      { label: "Start", frame: 1 },
      { label: "Finish", frame: 9 },
    ]);
    expect(frameMarkers(sprint, {}, { endFrame: 8, finishFrame: 9 })).toEqual([{ label: "Finish", frame: 8 }]);
  });
  it("jump reads peak, shooting has none", () => {
    expect(frameMarkers(jump, {}, { apexFrame: 33 })).toEqual([{ label: "Peak", frame: 33 }]);
    expect(frameMarkers(shooting, { startFrame: 1 }, { startFrame: 1 })).toEqual([]);
  });
});

describe("repMetricSpecs", () => {
  it("shooting", () => {
    expect(repMetricSpecs(shooting, { velocity: 12, launch_angle: 18.42, strike_foot: "right" }, {})).toEqual([
      { label: "Ball Velocity", value: "26.8 mph" },
      { label: "Launch Angle", value: "18.4°" },
      { label: "Strike Foot", value: "Right" },
    ]);
  });
  it("sprint prefers meta values", () => {
    expect(repMetricSpecs(sprint, {}, { max_velocity: 8, max_acceleration: 3.14159, totalTime: 3.9 })).toEqual([
      { label: "Top Speed", value: "17.9 mph" },
      { label: "Max Acceleration", value: "3.14 m/s²" },
      { label: "Total Time", value: "3.90 s" },
    ]);
  });
  it("jump", () => {
    expect(repMetricSpecs(jump, { jumpHeight: .54 }, { peakFrame: 12 })).toEqual([
      { label: "Jump Height", value: "21.3 in" },
      { label: "Peak Frame", value: "12" },
    ]);
    expect(repMetricSpecs(jump, {}, {})[1].value).toBe("—");
  });
  it("broadJump", () => {
    expect(repMetricSpecs(broadJump, { broadJumpDistance: 2.12, jumpHeight: .31 }, { footSide: "left" })).toEqual([
      { label: "Distance", value: "7.0 ft" },
      { label: "Peak Height", value: "12.2 in" },
      { label: "Tracked Foot", value: "left" },
    ]);
  });
  it("dribbling includes Ball Distance; changeOfDirection does not", () => {
    const rep = { totalTime: 5.08, phase1Time: 1.92, phase2Time: 1.08, phase3Time: 2.08, totalDistance: 9.8, avgBallDistance: .46 };
    expect(repMetricSpecs(dribbling, rep, {})).toEqual([
      { label: "Total Time", value: "5.08 s" },
      { label: "Out", value: "1.92 s" },
      { label: "Turn", value: "1.08 s" },
      { label: "Back", value: "2.08 s" },
      { label: "Distance", value: "32.2 ft" },
      { label: "Ball Distance", value: "18.1 in" },
    ]);
    expect(repMetricSpecs(changeOfDirection, rep, {})).toHaveLength(5);
  });
  it("freeRecord default branch", () => {
    expect(repMetricSpecs(freeRecord, { repNumber: 2 }, {})).toEqual([
      { label: "Recording", value: "Rep 2" },
      { label: "Pose Frames", value: "Available" },
    ]);
    expect(repMetricSpecs(freeRecord, {}, { frameCount: 120 })[1].value).toBe("120");
  });
});

describe("artifactFolder", () => {
  it("cleans a gs:// storagePath with query string and file name", () => {
    const rep = { storagePath: "gs://bucket/p1/deadballShot/session2/kick3/video.mov?alt=media" };
    expect(artifactFolder(rep, shooting, "px")).toBe("p1/deadballShot/session2/kick3");
  });
  it("trims slashes and keeps folder-only paths", () => {
    expect(artifactFolder({ storagePath: "/p1/jump/session1/kick2/" }, jump, "px")).toBe("p1/jump/session1/kick2");
  });
  it("ignores http(s) storagePath and constructs the folder", () => {
    const rep = { storagePath: "https://example.com/x", sessionNumber: 2, repNumber: 3 };
    expect(artifactFolder(rep, jump, "p9")).toBe("p9/jump/session2/kick3");
  });
  it("sessionRoot reps omit the rep folder", () => {
    const rep = { sessionFolder: "session4", sessionRoot: true };
    expect(artifactFolder(rep, freeRecord, "p9")).toBe("p9/freeRecord/session4");
  });
});

describe("allStatsReps", () => {
  it("excludes freeRecord and tags _statsDrill", () => {
    const reps = Object.fromEntries(DRILLS.map(d => [d.key, [] as any[]]));
    reps.shooting = [{ id: "s1", velocity: 1 }];
    reps.freeRecord = [{ id: "f1" }];
    const all = allStatsReps(reps);
    expect(all).toHaveLength(1);
    expect(all[0]._statsDrill).toBe("shooting");
    expect(all[0].id).toBe("s1");
  });
});
