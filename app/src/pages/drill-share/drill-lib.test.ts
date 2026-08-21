// Tests for the pure helpers ported from athlete-drill-view.js. Expected values
// mirror the legacy runtime output exactly, including its coercion quirks.

import { describe, expect, it } from "vitest";
import {
  asInteger,
  asNumber,
  athleteDisplayName,
  averageField,
  average,
  bestMetricValue,
  folderCandidates,
  formatPrimary,
  formatSeconds,
  formatTrend,
  hipCenter,
  markerDefs,
  mergedMetric,
  metersToFeet,
  metersToInches,
  normalizeAuthRep,
  normalizeFrames,
  normalizeSharedRep,
  parsePoint,
  previewArtifacts,
  previewStatsReps,
  repMetric,
  repMetricCards,
  resolveShuttleBounds,
  sessionGroups,
  shuttlePhaseAt,
  summaryMetrics,
  timestampMillis,
  validPoint,
  type Rep,
} from "./drill-lib";
import { buildPageUrl, configs, pageConfigs, routeFor } from "./drill-config";

function rep(overrides: Partial<Rep> & Record<string, unknown> = {}): Rep {
  return {
    id: "r1",
    primary: null,
    createdAtMillis: 0,
    sessionNumber: 1,
    repNumber: 1,
    absoluteRepNumber: null,
    _statsDrill: "broadJump",
    ...overrides,
  };
}

describe("asNumber / asInteger", () => {
  it("passes finite numbers through", () => {
    expect(asNumber(3.5)).toBe(3.5);
    expect(asNumber("2.25")).toBe(2.25);
  });
  it("mirrors the legacy Number() coercion quirks", () => {
    expect(asNumber(null)).toBe(0); // Number(null) === 0, like the legacy helper
    expect(asNumber("")).toBe(0);
    expect(asNumber(undefined)).toBeNull();
    expect(asNumber("abc")).toBeNull();
    expect(asNumber(NaN)).toBeNull();
    expect(asNumber(Infinity)).toBeNull();
  });
  it("rounds integers", () => {
    expect(asInteger("17.6")).toBe(18);
    expect(asInteger(undefined)).toBeNull();
    expect(asInteger(null)).toBe(0);
  });
});

describe("timestampMillis", () => {
  it("uses toMillis when available", () => {
    expect(timestampMillis({ toMillis: () => 1234 })).toBe(1234);
  });
  it("converts seconds", () => {
    expect(timestampMillis({ seconds: 12 })).toBe(12000);
  });
  it("parses date strings and falls back to 0", () => {
    expect(timestampMillis("2026-01-02T00:00:00Z")).toBe(Date.parse("2026-01-02T00:00:00Z"));
    expect(timestampMillis(undefined)).toBe(0);
    expect(timestampMillis("not a date")).toBe(0);
  });
});

describe("unit conversions and formatting", () => {
  it("converts meters", () => {
    expect(metersToFeet(1)).toBeCloseTo(3.28084, 5);
    expect(metersToInches(1)).toBeCloseTo(39.37007874, 5);
  });
  it("formats broad jump primaries in feet with 1 decimal", () => {
    expect(formatPrimary("broadJump", 1.82)).toBe("6.0 ft");
    expect(formatPrimary("broadJump", undefined)).toBe("—");
  });
  it("formats timed primaries in seconds with 2 decimals", () => {
    expect(formatPrimary("changeOfDirection", 4.415)).toBe("4.42 s");
    expect(formatPrimary("dribbling", "8.5")).toBe("8.50 s");
  });
  it("keeps the legacy null-becomes-zero quirk", () => {
    expect(formatPrimary("broadJump", null)).toBe("0.0 ft");
    expect(formatPrimary("dribbling", null)).toBe("0.00 s");
  });
  it("formats seconds with an em-dash placeholder", () => {
    expect(formatSeconds(null)).toBe("—");
    expect(formatSeconds(1.234)).toBe("1.23 s");
  });
});

describe("average / averageField", () => {
  it("averages values and returns null for empty input", () => {
    expect(average([2, 4])).toBe(3);
    expect(average([])).toBeNull();
  });
  it("averages a rep field, skipping unparsable values", () => {
    const reps = [rep({ totalDistance: 10 }), rep({ totalDistance: "20" }), rep({ totalDistance: "x" })];
    expect(averageField(reps, "totalDistance")).toBe(15);
  });
});

describe("formatTrend", () => {
  it("needs at least two valid values", () => {
    expect(formatTrend([rep({ primary: 5 })], false)).toBe("—");
  });
  it("returns — when the first chronological value is zero", () => {
    // reps are stored newest-first; reversed for the trend
    expect(formatTrend([rep({ primary: 5 }), rep({ primary: 0 })], false)).toBe("—");
  });
  it("shows an up arrow for improvement (higher is better)", () => {
    const reps = [rep({ primary: 6 }), rep({ primary: 5 })]; // newest first: 5 -> 6
    expect(formatTrend(reps, false)).toBe("↑ 20.0%");
  });
  it("shows an up arrow for improvement (lower is better)", () => {
    const reps = [rep({ primary: 4 }), rep({ primary: 5 })]; // newest first: 5 -> 4
    expect(formatTrend(reps, true)).toBe("↑ 20.0%");
  });
  it("shows a down arrow for regression", () => {
    const reps = [rep({ primary: 4 }), rep({ primary: 5 })];
    expect(formatTrend(reps, false)).toBe("↓ 20.0%");
  });
  it("reports no change below the 0.05% threshold", () => {
    const reps = [rep({ primary: 100.0001 }), rep({ primary: 100 })];
    expect(formatTrend(reps, false)).toBe("No change");
  });
});

describe("sessionGroups", () => {
  const reps = [
    rep({ id: "a", sessionNumber: 2, primary: 4.2, createdAtMillis: 400 }),
    rep({ id: "b", sessionNumber: 2, primary: 4.8, createdAtMillis: 300 }),
    rep({ id: "c", sessionNumber: 1, primary: 5.1, createdAtMillis: 200 }),
    rep({ id: "d", sessionNumber: 1, primary: null, createdAtMillis: 100 }),
  ];
  it("groups by session, keeps the first rep as latestRep and sorts newest first", () => {
    const groups = sessionGroups(reps, true);
    expect(groups.map(group => group.sessionNumber)).toEqual([2, 1]);
    expect(groups[0].latestRep.id).toBe("a");
    expect(groups[0].createdAtMillis).toBe(400);
    expect(groups[0].reps).toHaveLength(2);
  });
  it("computes best respecting direction", () => {
    expect(sessionGroups(reps, true)[0].best).toBe(4.2);
    expect(sessionGroups(reps, false)[0].best).toBe(4.8);
  });
  it("returns null best when no primaries are valid", () => {
    const groups = sessionGroups([rep({ id: "x", sessionNumber: 3, primary: null, createdAtMillis: 10 })], true);
    expect(groups[0].best).toBeNull();
  });
});

describe("repMetric / bestMetricValue", () => {
  it("returns the first parsable field", () => {
    expect(repMetric({ a: "x", b: 2, c: 3 }, ["a", "b", "c"])).toBe(2);
    expect(repMetric({}, ["a"])).toBeNull();
  });
  it("selects min for lower-is-better benchmarks", () => {
    const reps = [rep({ totalTime: 4.9 }), rep({ totalTime: 4.5 })];
    expect(bestMetricValue(reps, { key: "codTotalTime", fields: ["totalTime"] })).toBe(4.5);
  });
  it("selects max for higher-is-better benchmarks", () => {
    const reps = [rep({ broadJumpDistance: 1.7 }), rep({ broadJumpDistance: 1.9 })];
    expect(bestMetricValue(reps, { key: "broadJumpDistance", fields: ["broadJumpDistance"] })).toBe(1.9);
  });
  it("returns null for unknown metrics or empty values", () => {
    expect(bestMetricValue([rep()], { key: "nope", fields: ["x"] })).toBeNull();
    expect(bestMetricValue([], { key: "codTotalTime", fields: ["totalTime"] })).toBeNull();
  });
});

describe("summaryMetrics", () => {
  it("builds the 4 broad jump cards", () => {
    const reps = [
      rep({ primary: 1.9, createdAtMillis: 200 }),
      rep({ primary: 1.7, createdAtMillis: 100 }),
    ];
    const cards = summaryMetrics("broadJump", reps, false);
    expect(cards.map(card => card.label)).toEqual(["Avg Distance", "Max Distance", "Total Jumps", "Recent Trend"]);
    expect(cards[0].value).toBe("5.9 ft");
    expect(cards[1].value).toBe("6.2 ft");
    expect(cards[2].value).toBe("2");
  });
  it("builds the 8 shuttle cards including phase averages", () => {
    const reps = [
      rep({ primary: 4.4, totalDistance: 10, phase1Time: 1.5, phase2Time: 1.0, phase3Time: 1.9 }),
      rep({ primary: 4.8, totalDistance: 9, phase1Time: 1.7, phase2Time: 1.2, phase3Time: 1.9 }),
    ];
    const cards = summaryMetrics("changeOfDirection", reps, true);
    expect(cards.map(card => card.label)).toEqual([
      "Best Time", "Avg Time", "Avg Distance", "Accel Phase", "Turn Phase", "Return Phase", "Total Runs", "Time Trend",
    ]);
    expect(cards[0].value).toBe("4.40 s");
    expect(cards[1].value).toBe("4.60 s");
    expect(cards[2].value).toBe("31.2 ft");
    expect(cards[3].value).toBe("1.60 s");
  });
});

describe("rep normalization", () => {
  it("normalizes an authenticated rep with fallbacks", () => {
    const config = configs.sprint;
    const normalized = normalizeAuthRep("doc1", { maxVelocity: "7.5", absoluteRepNumber: 3 }, config);
    expect(normalized.id).toBe("doc1");
    expect(normalized._statsDrill).toBe("sprint");
    expect(normalized.primary).toBe(7.5); // second primaryFields entry
    expect(normalized.sessionNumber).toBe(1);
    expect(normalized.repNumber).toBe(3); // falls back to absoluteRepNumber
    expect(normalized.absoluteRepNumber).toBe(3);
    expect(normalized.createdAtMillis).toBe(0);
  });
  it("normalizes a shared rep using only the single primaryField", () => {
    const config = pageConfigs.changeOfDirection;
    const normalized = normalizeSharedRep({ id: "s1", totalTime: 4.4, createdAtMillis: 123, sessionNumber: "2", repNumber: 1 }, config);
    expect(normalized.primary).toBe(4.4);
    expect(normalized.createdAtMillis).toBe(123);
    expect(normalized.sessionNumber).toBe(2);
  });
  it("gives shared stats-only reps a null primary (no primaryField)", () => {
    const normalized = normalizeSharedRep({ id: "s2", velocity: 30 }, configs.shooting);
    expect(normalized.primary).toBeNull();
  });
});

describe("folderCandidates", () => {
  it("always includes the conventional folder", () => {
    expect(folderCandidates(rep({ sessionNumber: 2, repNumber: 3 }), "p1", "broadJump"))
      .toEqual(["p1/broadJump/session2/kick3"]);
  });
  it("prefers a cleaned storagePath, dropping video filenames and gs:// prefixes", () => {
    const candidate = folderCandidates(
      rep({ storagePath: "gs://bucket/p1/broadJump/session1/kick1/video.MOV", sessionNumber: 1, repNumber: 1 }),
      "p1",
      "broadJump",
    );
    expect(candidate).toEqual(["p1/broadJump/session1/kick1"]);
  });
  it("normalizes backslashes and strips query strings", () => {
    const candidate = folderCandidates(
      rep({ storagePath: "\\p2\\dribbling\\session4\\kick2\\clip.mp4?alt=media", sessionNumber: 1, repNumber: 1 }),
      "p2",
      "dribbling",
    );
    expect(candidate[0]).toBe("p2/dribbling/session4/kick2");
    expect(candidate[1]).toBe("p2/dribbling/session1/kick1");
  });
  it("ignores http(s) storage paths", () => {
    const candidate = folderCandidates(
      rep({ storagePath: "https://example.com/x/y.mov", sessionNumber: 5, repNumber: 6 }),
      "p3",
      "changeOfDirection",
    );
    expect(candidate).toEqual(["p3/changeOfDirection/session5/kick6"]);
  });
});

describe("normalizeFrames / points", () => {
  it("returns [] for non-arrays", () => {
    expect(normalizeFrames(null)).toEqual([]);
    expect(normalizeFrames({})).toEqual([]);
  });
  it("nulls short, unparsable and low-visibility points", () => {
    const frames = normalizeFrames([[[0.1, 0.2, 0, 0.9], [0.3], [0.4, 0.5, 0, 0.05], ["x", 0.5]], "junk"]);
    expect(frames).toHaveLength(2);
    expect(frames[0][0]).toEqual({ x: 0.1, y: 0.2, visibility: 0.9 });
    expect(frames[0][1]).toBeNull();
    expect(frames[0][2]).toBeNull(); // visibility below 0.1
    expect(frames[0][3]).toBeNull();
    expect(frames[1]).toEqual([]);
  });
  it("keeps points without visibility values", () => {
    const frames = normalizeFrames([[[0.1, 0.2]]]);
    expect(frames[0][0]).toEqual({ x: 0.1, y: 0.2, visibility: null });
  });
  it("validPoint rejects missing points", () => {
    const frame = normalizeFrames([[[0.1, 0.2, 0, 0.9]]])[0];
    expect(validPoint(frame, 0)).toEqual({ x: 0.1, y: 0.2, visibility: 0.9 });
    expect(validPoint(frame, 5)).toBeNull();
    expect(validPoint(undefined, 0)).toBeNull();
  });
  it("parsePoint parses [x, y] arrays", () => {
    expect(parsePoint([0.4, 0.6])).toEqual({ x: 0.4, y: 0.6 });
    expect(parsePoint([0.4])).toBeNull();
    expect(parsePoint("nope")).toBeNull();
  });
  it("hipCenter picks indices by skeleton size", () => {
    const frame17 = Array.from({ length: 17 }, (_, index) =>
      index === 11 ? { x: 0.2, y: 0.4, visibility: 1 } : index === 12 ? { x: 0.4, y: 0.6, visibility: 1 } : null,
    );
    expect(hipCenter(frame17)).toEqual({ x: 0.30000000000000004, y: 0.5 });
    expect(hipCenter([])).toBeNull();
    expect(hipCenter(undefined)).toBeNull();
  });
});

describe("mergedMetric", () => {
  it("prefers artifact metadata and falls back to the rep", () => {
    const artifacts = { "metadata.json": { totalTime: 4.2 } };
    expect(mergedMetric(artifacts, rep({ totalTime: 5 }), "totalTime")).toBe(4.2);
    expect(mergedMetric({}, rep({ totalTime: 5 }), "totalTime")).toBe(5);
    expect(mergedMetric({}, rep(), "totalTime")).toBeNull();
  });
});

describe("shuttle bounds and phases", () => {
  const bounds = resolveShuttleBounds(
    { startFrame: 4, phase1EndFrame: 42, phase2EndFrame: 56, endFrame: 92 },
    rep(),
  );
  it("resolves bounds from metadata with rep fallback", () => {
    expect(bounds).toEqual({ start: 4, end: 92, phase1End: 42, phase2End: 56 });
    const fallback = resolveShuttleBounds({}, rep({ startFrame: 1, endFrame: 9, phase1EndFrame: 3, phase2EndFrame: 6 }));
    expect(fallback).toEqual({ start: 1, end: 9, phase1End: 3, phase2End: 6 });
  });
  it("maps frames to phases", () => {
    expect(shuttlePhaseAt(3, bounds)).toBeNull();
    expect(shuttlePhaseAt(4, bounds)).toMatchObject({ key: "outbound", title: "Outbound", color: "#66c2ff" });
    expect(shuttlePhaseAt(42, bounds)).toMatchObject({ key: "outbound" });
    expect(shuttlePhaseAt(43, bounds)).toMatchObject({ key: "turn", title: "Turn", color: "#ffc969" });
    expect(shuttlePhaseAt(57, bounds)).toMatchObject({ key: "inbound", title: "Return", color: "#71d39b" });
    expect(shuttlePhaseAt(93, bounds)).toBeNull();
  });
  it("returns null when any bound is missing", () => {
    expect(shuttlePhaseAt(5, resolveShuttleBounds({}, rep()))).toBeNull();
  });
});

describe("markerDefs / repMetricCards", () => {
  it("builds broad jump markers with artifact-first fallbacks", () => {
    const markers = markerDefs("broadJump", { "foot_piecewise_fit.json": { takeoffFrameIndex: 18, landingFrameIndex: 80 } }, rep());
    expect(markers).toEqual([
      { label: "Takeoff", icon: "flight_takeoff", frame: 18 },
      { label: "Landing", icon: "flight_land", frame: 80 },
    ]);
    const fromKeyFrames = markerDefs("broadJump", { "key_frames.json": [10, 20] }, rep());
    expect(fromKeyFrames[0].frame).toBe(10);
    const fromRep = markerDefs("broadJump", {}, rep({ takeoffFrame: 5, landingFrame: 7 }));
    expect(fromRep.map(marker => marker.frame)).toEqual([5, 7]);
  });
  it("builds shuttle markers with disabled (null) frames when unknown", () => {
    const markers = markerDefs("changeOfDirection", {}, rep());
    expect(markers.map(marker => marker.label)).toEqual(["Start", "Turn", "Finish"]);
    expect(markers.every(marker => marker.frame === null)).toBe(true);
  });
  it("builds broad jump metric cards with legacy formatting", () => {
    const artifacts = {
      "metadata.json": { broadJumpDistance: 1.82, jumpHeight: 0.29, framesPerSecond: 120, footSide: "right" },
      "foot_piecewise_fit.json": { takeoffFrameIndex: 18, landingFrameIndex: 80 },
    };
    const cards = repMetricCards("broadJump", artifacts, rep());
    expect(cards.map(card => card.label)).toEqual(["Distance", "Peak height", "Flight time", "This frame", "Tracked foot"]);
    expect(cards[0].value).toBe("6.0 ft");
    expect(cards[1].value).toBe("11.4 in");
    expect(cards[2].value).toBe(`${((80 - 18) / 120).toFixed(2)} s`);
    expect(cards[3]).toMatchObject({ value: "—", dynamicId: "currentHeightValue" });
    expect(cards[4].value).toBe("Right");
  });
  it("builds shuttle metric cards with em-dash placeholders", () => {
    const cards = repMetricCards("dribbling", { "metadata.json": { totalTime: 8.64, totalDistance: 18.2 } }, rep());
    expect(cards.map(card => card.label)).toEqual(["Total time", "Outbound", "Turn", "Return", "Total distance", "Gate width"]);
    expect(cards[0].value).toBe("8.64 s");
    expect(cards[1].value).toBe("—");
    expect(cards[4].value).toBe("59.7 ft");
    expect(cards[5].value).toBe("—");
  });
});

describe("athleteDisplayName", () => {
  it("joins first/last, falls back to name, then Athlete", () => {
    expect(athleteDisplayName({ firstName: "Jordan", lastName: "Athlete" })).toBe("Jordan Athlete");
    expect(athleteDisplayName({ firstName: "Jordan" })).toBe("Jordan");
    expect(athleteDisplayName({ name: "Solo" })).toBe("Solo");
    expect(athleteDisplayName({})).toBe("Athlete");
    expect(athleteDisplayName(null)).toBe("Athlete");
  });
});

describe("preview data", () => {
  it("builds 96-frame broad jump artifacts", () => {
    const artifacts = previewArtifacts(pageConfigs.broadJump, null);
    expect(artifacts["pose.json"]).toHaveLength(96);
    expect(artifacts["metadata.json"].broadJumpDistance).toBe(1.82);
    expect(artifacts["key_frames.json"]).toEqual([18, 80]);
    expect(artifacts["com_height.json"]).toHaveLength(96);
  });
  it("uses rep metrics in shuttle preview metadata", () => {
    const artifacts = previewArtifacts(pageConfigs.dribbling, rep({ totalTime: 9.9, phase1Time: 3.1 }));
    expect(artifacts["metadata.json"].totalTime).toBe(9.9);
    expect(artifacts["metadata.json"].phase1Time).toBe(3.1);
    expect(artifacts["metadata.json"].phase2Time).toBe(0.91);
  });
  it("builds four preview reps per drill", () => {
    const reps = previewStatsReps();
    expect(reps).toHaveLength(24);
    const broadJumps = reps.filter(item => item._statsDrill === "broadJump");
    expect(broadJumps).toHaveLength(4);
    expect(broadJumps[0].primary).toBe(1.82);
    expect(broadJumps[0].broadJumpDistance).toBe(1.82);
    expect(broadJumps[0].sessionNumber).toBe(2);
    expect(broadJumps[3].sessionNumber).toBe(1);
  });
});

describe("buildPageUrl / routeFor", () => {
  it("maps ported pages to clean routes and leaves others root-relative", () => {
    expect(routeFor("broadJumpPage.html")).toBe("/drills/broad-jump");
    expect(routeFor("profile.html")).toBe("/athlete");
    expect(routeFor("kickingview.html")).toBe("/kickingview.html");
  });
  it("uses share token when present", () => {
    const url = buildPageUrl("dribblingPage.html", { view: "results" }, { preview: false, shareToken: "tok123", playerId: null, viewerRole: "shared" });
    expect(url).toBe("/drills/dribbling?share=tok123&view=results");
  });
  it("uses preview=1 in preview mode", () => {
    const url = buildPageUrl("broadJumpPage.html", {}, { preview: true, shareToken: null, playerId: "p", viewerRole: "coach" });
    expect(url).toBe("/drills/broad-jump?preview=1");
  });
  it("uses player + userType for authenticated viewers", () => {
    const url = buildPageUrl("changeOfDirectionPage.html", { view: "results" }, { preview: false, shareToken: null, playerId: "p9", viewerRole: "coach" });
    expect(url).toBe("/drills/change-of-direction?player=p9&userType=coach&view=results");
  });
  it("defaults userType to player and skips empty extras", () => {
    const url = buildPageUrl("kickingview.html", { tab: "kick", skip: "" }, { preview: false, shareToken: null, playerId: null, viewerRole: undefined });
    expect(url).toBe("/kickingview.html?userType=player&tab=kick");
  });
});
