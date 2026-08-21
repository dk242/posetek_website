// Pure logic ported from athlete-drill-view.js. Numeric coercion, formatting and
// grouping mirror the legacy output exactly (units, toFixed digits, em-dash and
// even the Number(null) === 0 quirk in asNumber/formatPrimary).

/* eslint-disable @typescript-eslint/no-explicit-any */

import benchmarks from "../../lib/benchmarks";
import {
  configs,
  type DrillConfig,
  type DrillKey,
  type PageDrillConfig,
  type PageDrillKey,
} from "./drill-config";

export interface Rep {
  id: string;
  primary: number | null;
  createdAtMillis: number;
  sessionNumber: number;
  repNumber: number;
  absoluteRepNumber: number | null;
  _statsDrill: string;
  [key: string]: any;
}

export type FramePoint = { x: number; y: number; visibility: number | null } | null;
export type Frame = FramePoint[];

export function asNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function asInteger(value: unknown): number | null {
  const number = asNumber(value);
  return number === null ? null : Math.round(number);
}

export function timestampMillis(value: any): number {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value && typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatDate(millis: number): string {
  if (!millis) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(millis));
}

export function metersToFeet(value: number): number {
  return value * 3.28084;
}

export function metersToInches(value: number): number {
  return value * 39.37007874;
}

export function formatPrimary(drillKey: PageDrillKey, raw: unknown): string {
  const value = asNumber(raw);
  if (value === null) return "—";
  return drillKey === "broadJump" ? `${metersToFeet(value).toFixed(1)} ft` : `${value.toFixed(2)} s`;
}

export function formatSeconds(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)} s`;
}

export function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function averageField(reps: Rep[], field: string): number | null {
  return average(reps.map(rep => asNumber(rep[field])).filter((value): value is number => value !== null));
}

export function formatTrend(reps: Rep[], lowerIsBetter: boolean): string {
  const ordered = [...reps].reverse().map(rep => rep.primary).filter((value): value is number => value !== null);
  if (ordered.length < 2 || ordered[0] === 0) return "—";
  const first = ordered[0];
  const latest = ordered[ordered.length - 1];
  const improvement = lowerIsBetter ? first - latest : latest - first;
  const percent = Math.abs(improvement / first) * 100;
  if (percent < 0.05) return "No change";
  const arrow = improvement > 0 ? "↑" : "↓";
  return `${arrow} ${percent.toFixed(1)}%`;
}

export interface SessionGroup {
  sessionNumber: number;
  reps: Rep[];
  latestRep: Rep;
  createdAtMillis: number;
  best: number | null;
}

export function sessionGroups(reps: Rep[], lowerIsBetter: boolean): SessionGroup[] {
  const groups = new Map<number, Rep[]>();
  reps.forEach(rep => {
    const key = rep.sessionNumber;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(rep);
  });
  return [...groups.entries()]
    .map(([sessionNumber, groupReps]) => {
      const valid = groupReps.map(rep => rep.primary).filter((value): value is number => value !== null);
      return {
        sessionNumber,
        reps: groupReps,
        latestRep: groupReps[0],
        createdAtMillis: Math.max(...groupReps.map(rep => rep.createdAtMillis || 0)),
        best: valid.length ? (lowerIsBetter ? Math.min(...valid) : Math.max(...valid)) : null,
      };
    })
    .sort((a, b) => b.createdAtMillis - a.createdAtMillis);
}

export function repMetric(rep: Record<string, any>, fields: string[]): number | null {
  for (const field of fields) {
    const value = asNumber(rep[field]);
    if (value !== null) return value;
  }
  return null;
}

export function bestMetricValue(reps: Rep[], definition: { key: string; fields: string[] }): number | null {
  const metric = benchmarks.get(definition.key);
  const values = reps.map(rep => repMetric(rep, definition.fields)).filter((value): value is number => value !== null);
  if (!metric || !values.length) return null;
  return metric.direction === "lower" ? Math.min(...values) : Math.max(...values);
}

export interface SummaryMetricDef {
  icon: string;
  label: string;
  value: string;
}

export function summaryMetrics(drillKey: PageDrillKey, reps: Rep[], lowerIsBetter: boolean): SummaryMetricDef[] {
  const values = reps.map(rep => rep.primary).filter((value): value is number => value !== null);
  const best = values.length ? (lowerIsBetter ? Math.min(...values) : Math.max(...values)) : null;
  const mean = average(values);
  if (drillKey === "broadJump") {
    return [
      { icon: "straighten", label: "Avg Distance", value: formatPrimary(drillKey, mean) },
      { icon: "trophy", label: "Max Distance", value: formatPrimary(drillKey, best) },
      { icon: "directions_run", label: "Total Jumps", value: String(reps.length) },
      { icon: "trending_up", label: "Recent Trend", value: formatTrend(reps, lowerIsBetter) },
    ];
  }
  const averageDistance = averageField(reps, "totalDistance");
  return [
    { icon: "trophy", label: "Best Time", value: formatPrimary(drillKey, best) },
    { icon: "timer", label: "Avg Time", value: formatPrimary(drillKey, mean) },
    { icon: "straighten", label: "Avg Distance", value: averageDistance === null ? "—" : `${metersToFeet(averageDistance).toFixed(1)} ft` },
    { icon: "arrow_forward", label: "Accel Phase", value: formatSeconds(averageField(reps, "phase1Time")) },
    { icon: "switch_access_shortcut", label: "Turn Phase", value: formatSeconds(averageField(reps, "phase2Time")) },
    { icon: "arrow_back", label: "Return Phase", value: formatSeconds(averageField(reps, "phase3Time")) },
    { icon: "directions_run", label: "Total Runs", value: String(reps.length) },
    { icon: "trending_down", label: "Time Trend", value: formatTrend(reps, lowerIsBetter) },
  ];
}

// Rep normalization used for authenticated Firestore loads (loadReps).
export function normalizeAuthRep(docId: string, data: Record<string, any>, drillConfig: DrillConfig): Rep {
  const primaryFields = drillConfig.primaryFields || [drillConfig.primaryField as string];
  const primary = primaryFields.map(field => asNumber(data[field])).find(value => value !== null) ?? null;
  return {
    id: docId,
    ...data,
    _statsDrill: drillConfig.key,
    primary,
    createdAtMillis: timestampMillis(data.createdAt),
    sessionNumber: asInteger(data.sessionNumber) || 1,
    repNumber: asInteger(data.repNumber) || asInteger(data.absoluteRepNumber) || 1,
    absoluteRepNumber: asInteger(data.absoluteRepNumber),
  };
}

// Rep normalization used for ?share= payloads (startShared): note it reads ONLY the
// single primaryField, exactly like the legacy code.
export function normalizeSharedRep(rep: Record<string, any>, drillConfig: DrillConfig): Rep {
  return {
    ...(rep as Rep),
    _statsDrill: drillConfig.key,
    primary: drillConfig.primaryField !== undefined ? asNumber(rep[drillConfig.primaryField]) : null,
    createdAtMillis: asNumber(rep.createdAtMillis) || 0,
    sessionNumber: asInteger(rep.sessionNumber) || 1,
    repNumber: asInteger(rep.repNumber) || asInteger(rep.absoluteRepNumber) || 1,
    absoluteRepNumber: asInteger(rep.absoluteRepNumber),
  };
}

export function folderCandidates(rep: Rep, playerId: string, drillKey: string): string[] {
  const folders: string[] = [];
  const path = typeof rep.storagePath === "string" ? rep.storagePath.replace(/\\/g, "/") : "";
  if (path && !/^https?:/i.test(path)) {
    const clean = path.replace(/^gs:\/\/[^/]+\//i, "").split("?")[0].replace(/^\/+|\/+$/g, "");
    const pieces = clean.split("/");
    if (/\.(mov|mp4)$/i.test(pieces[pieces.length - 1] || "")) pieces.pop();
    if (pieces.length) folders.push(pieces.join("/"));
  }
  folders.push(`${playerId}/${drillKey}/session${rep.sessionNumber}/kick${rep.repNumber}`);
  return [...new Set(folders.filter(Boolean))];
}

export function normalizeFrames(value: unknown): Frame[] {
  if (!Array.isArray(value)) return [];
  return value.map(frame =>
    Array.isArray(frame)
      ? frame.map((point: unknown): FramePoint => {
          if (!Array.isArray(point) || point.length < 2) return null;
          const x = asNumber(point[0]);
          const y = asNumber(point[1]);
          const visibility = asNumber(point[3]);
          if (x === null || y === null || (visibility !== null && visibility < 0.1)) return null;
          return { x, y, visibility };
        })
      : [],
  );
}

export function validPoint(frame: Frame | undefined, index: number): { x: number; y: number; visibility: number | null } | null {
  const point = frame?.[index];
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}

export function hipCenter(frame: Frame | undefined): { x: number; y: number } | null {
  if (!frame?.length) return null;
  const indices = frame.length >= 30 ? [23, 24] : [11, 12];
  const left = validPoint(frame, indices[0]);
  const right = validPoint(frame, indices[1]);
  return left && right ? { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 } : null;
}

export function parsePoint(value: unknown): { x: number; y: number } | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = asNumber(value[0]);
  const y = asNumber(value[1]);
  return x === null || y === null ? null : { x, y };
}

export function mergedMetric(artifacts: Record<string, any>, rep: Record<string, any> | null | undefined, field: string): number | null {
  const meta = (artifacts["metadata.json"] || {}) as Record<string, any>;
  const artifactValue = asNumber(meta[field]);
  return artifactValue !== null ? artifactValue : asNumber(rep?.[field]);
}

export interface ShuttleBounds {
  start: number | null;
  end: number | null;
  phase1End: number | null;
  phase2End: number | null;
}

export function resolveShuttleBounds(meta: Record<string, any>, rep: Record<string, any>): ShuttleBounds {
  return {
    start: asInteger(meta.startFrame) ?? asInteger(rep.startFrame),
    end: asInteger(meta.endFrame) ?? asInteger(rep.endFrame),
    phase1End: asInteger(meta.phase1EndFrame) ?? asInteger(rep.phase1EndFrame),
    phase2End: asInteger(meta.phase2EndFrame) ?? asInteger(rep.phase2EndFrame),
  };
}

export interface ShuttlePhase {
  key: "outbound" | "turn" | "inbound";
  title: string;
  color: string;
}

export function shuttlePhaseAt(frameIndex: number, bounds: ShuttleBounds): ShuttlePhase | null {
  const { start, end, phase1End, phase2End } = bounds;
  if (
    [start, end, phase1End, phase2End].some(value => value === null) ||
    frameIndex < (start as number) ||
    frameIndex > (end as number)
  ) {
    return null;
  }
  if (frameIndex <= (phase1End as number)) return { key: "outbound", title: "Outbound", color: "#66c2ff" };
  if (frameIndex <= (phase2End as number)) return { key: "turn", title: "Turn", color: "#ffc969" };
  return { key: "inbound", title: "Return", color: "#71d39b" };
}

export interface MarkerDef {
  label: string;
  icon: string;
  frame: number | null;
}

export function markerDefs(drillKey: PageDrillKey, artifacts: Record<string, any>, rep: Rep): MarkerDef[] {
  if (drillKey === "broadJump") {
    const fit = (artifacts["foot_piecewise_fit.json"] || {}) as Record<string, any>;
    const keyFrames = (artifacts["key_frames.json"] || []) as any[];
    const takeoff = asInteger(fit.takeoffFrameIndex) ?? asInteger(keyFrames[0]) ?? asInteger(rep.takeoffFrame);
    const landing = asInteger(fit.landingFrameIndex) ?? asInteger(keyFrames[1]) ?? asInteger(rep.landingFrame);
    return [
      { label: "Takeoff", icon: "flight_takeoff", frame: takeoff },
      { label: "Landing", icon: "flight_land", frame: landing },
    ];
  }
  const meta = (artifacts["metadata.json"] || {}) as Record<string, any>;
  const start = asInteger(meta.startFrame) ?? asInteger(rep.startFrame);
  const turn = asInteger(meta.apexFrame) ?? asInteger(rep.apexFrame);
  const finish = asInteger(meta.endFrame) ?? asInteger(rep.endFrame);
  return [
    { label: "Start", icon: "flag", frame: start },
    { label: "Turn", icon: "switch_access_shortcut", frame: turn },
    { label: "Finish", icon: "sports_score", frame: finish },
  ];
}

export interface MetricCardDef {
  icon: string;
  label: string;
  value: string;
  dynamicId?: string;
}

export function repMetricCards(drillKey: PageDrillKey, artifacts: Record<string, any>, rep: Rep): MetricCardDef[] {
  const meta = (artifacts["metadata.json"] || {}) as Record<string, any>;
  if (drillKey === "broadJump") {
    const distance = mergedMetric(artifacts, rep, "broadJumpDistance");
    const height = mergedMetric(artifacts, rep, "jumpHeight");
    const fit = (artifacts["foot_piecewise_fit.json"] || {}) as Record<string, any>;
    const keyFrames = (artifacts["key_frames.json"] || []) as any[];
    const takeoff = asInteger(fit.takeoffFrameIndex) ?? asInteger(keyFrames[0]) ?? asInteger(rep.takeoffFrame);
    const landing = asInteger(fit.landingFrameIndex) ?? asInteger(keyFrames[1]) ?? asInteger(rep.landingFrame);
    const fps = asNumber(meta.framesPerSecond) || 120;
    const flight = takeoff !== null && landing !== null && landing > takeoff ? (landing - takeoff) / fps : null;
    const foot = meta.footSide || fit.footSide || "—";
    return [
      { icon: "straighten", label: "Distance", value: distance === null ? "—" : `${metersToFeet(distance).toFixed(1)} ft` },
      { icon: "height", label: "Peak height", value: height === null ? "—" : `${metersToInches(height).toFixed(1)} in` },
      { icon: "timer", label: "Flight time", value: flight === null ? "—" : `${flight.toFixed(2)} s` },
      { icon: "accessibility_new", label: "This frame", value: "—", dynamicId: "currentHeightValue" },
      { icon: "steps", label: "Tracked foot", value: String(foot).replace(/^./, value => value.toUpperCase()) },
    ];
  }

  const total = mergedMetric(artifacts, rep, "totalTime");
  const phase1 = mergedMetric(artifacts, rep, "phase1Time");
  const phase2 = mergedMetric(artifacts, rep, "phase2Time");
  const phase3 = mergedMetric(artifacts, rep, "phase3Time");
  const distance = mergedMetric(artifacts, rep, "totalDistance");
  const marker = mergedMetric(artifacts, rep, "markerDistance");
  return [
    { icon: "timer", label: "Total time", value: total === null ? "—" : `${total.toFixed(2)} s` },
    { icon: "arrow_forward", label: "Outbound", value: phase1 === null ? "—" : `${phase1.toFixed(2)} s` },
    { icon: "switch_access_shortcut", label: "Turn", value: phase2 === null ? "—" : `${phase2.toFixed(2)} s` },
    { icon: "arrow_back", label: "Return", value: phase3 === null ? "—" : `${phase3.toFixed(2)} s` },
    { icon: "straighten", label: "Total distance", value: distance === null ? "—" : `${metersToFeet(distance).toFixed(1)} ft` },
    { icon: "swap_horiz", label: "Gate width", value: marker === null ? "—" : `${metersToFeet(marker).toFixed(1)} ft` },
  ];
}

export function athleteDisplayName(data: Record<string, any> | null | undefined): string {
  const record = data || {};
  const name = [record.firstName, record.lastName].filter(Boolean).join(" ").trim();
  return name || record.name || "Athlete";
}

// Port of previewArtifacts() — synthetic pose/metadata for the local ?preview=1 mode.
export function previewArtifacts(config: PageDrillConfig, currentRep: Rep | null): Record<string, any> {
  const totalFrames = 96;
  const pose: number[][][] = [];
  const centers: number[][] = [];
  const feet: number[][] = [];
  const heights: number[] = [];
  for (let frame = 0; frame < totalFrames; frame += 1) {
    const progress = frame / (totalFrames - 1);
    const travel = config.key === "broadJump"
      ? 0.18 + progress * 0.62
      : (progress < 0.5 ? 0.18 + progress * 1.22 : 0.79 - (progress - 0.5) * 1.22);
    const lift = config.key === "broadJump" ? Math.sin(progress * Math.PI) * 0.18 : 0;
    const point = (x: number, y: number) => [x + travel - 0.5, y - lift, 0, 0.98];
    pose.push([
      point(0.50, 0.15), point(0.48, 0.14), point(0.52, 0.14), point(0.46, 0.15), point(0.54, 0.15),
      point(0.43, 0.31), point(0.57, 0.31), point(0.39, 0.44), point(0.61, 0.44), point(0.36, 0.56), point(0.64, 0.56),
      point(0.46, 0.55), point(0.54, 0.55), point(0.44, 0.73), point(0.56, 0.73), point(0.43, 0.92), point(0.57, 0.92),
    ]);
    centers.push([travel, 0.55 - lift]);
    feet.push([travel, 0.92 - lift]);
    heights.push(Math.max(0, lift * 1.55));
  }
  if (config.key === "broadJump") {
    return {
      folder: "preview",
      "pose.json": pose,
      "metadata.json": { broadJumpDistance: 1.82, jumpHeight: 0.29, ground_loc_y: 0.94, footSide: "right", resultsValid: true, framesPerSecond: 120 },
      "foot_piecewise_fit.json": { takeoffFrameIndex: 18, landingFrameIndex: 80, startFootXNorm: 0.27, endFootXNorm: 0.72, footSide: "right" },
      "key_frames.json": [18, 80],
      "foot_centers.json": feet,
      "com_midpoints.json": centers,
      "com_height.json": heights,
    };
  }
  const rep = currentRep || ({} as Rep);
  return {
    folder: "preview",
    "pose.json": pose,
    "metadata.json": {
      totalTime: asNumber(rep.totalTime) ?? 4.42,
      totalDistance: asNumber(rep.totalDistance) ?? 9.8,
      outboundDistance: asNumber(rep.outboundDistance) ?? 4.9,
      returnDistance: asNumber(rep.returnDistance) ?? 4.9,
      avgBallDistance: asNumber(rep.avgBallDistance),
      phase1Time: asNumber(rep.phase1Time) ?? 1.72,
      phase2Time: asNumber(rep.phase2Time) ?? 0.91,
      phase3Time: asNumber(rep.phase3Time) ?? 1.79,
      markerDistance: asNumber(rep.markerDistance) ?? 4.9,
      startFrame: 4, phase1EndFrame: 42, apexFrame: 48, phase2EndFrame: 56, endFrame: 92,
      framesPerSecond: 24, failedSteps: [],
    },
  };
}

// Port of the startPreview() synthetic reps.
export function previewStatsReps(): Rep[] {
  const previewValues: Record<DrillKey, number[]> = {
    shooting: [34.0, 32.2, 31.1, 30.4],
    sprint: [6.6, 6.3, 6.0, 5.8],
    jump: [0.50, 0.46, 0.42, 0.39],
    broadJump: [1.82, 1.68, 1.74, 1.59],
    changeOfDirection: [4.42, 4.58, 4.51, 4.77],
    dribbling: [8.64, 8.91, 9.12, 9.38],
  };
  return Object.values(configs).flatMap(drillConfig =>
    previewValues[drillConfig.key].map((primary, index) => ({
      id: `preview-${drillConfig.key}-${index + 1}`,
      _statsDrill: drillConfig.key,
      repType: drillConfig.key,
      drillType: drillConfig.key,
      [drillConfig.primaryFields?.[0] || drillConfig.primaryField || ""]: primary,
      primary,
      sessionNumber: index < 2 ? 2 : 1,
      repNumber: (index % 2) + 1,
      absoluteRepNumber: previewValues[drillConfig.key].length - index,
      createdAtMillis: Date.now() - index * 86400000 * 8,
      ...(drillConfig.key === "broadJump" ? { jumpHeight: 0.29, takeoffFrame: 18, landingFrame: 80 }
        : drillConfig.key === "dribbling" ? { totalTime: primary, totalDistance: 18.2, avgBallDistance: 0.72, phase1Time: 2.81, phase2Time: 2.94, phase3Time: 2.89, markerDistance: 4.9 }
        : drillConfig.key === "changeOfDirection" ? { totalTime: primary, totalDistance: 9.8, phase1Time: 1.72, phase2Time: 0.91, phase3Time: 1.79, markerDistance: 4.9 }
        : drillConfig.key === "sprint" ? { max_velocity: primary, maxVelocity: primary, max_acceleration: 6.5 - index * 0.2, totalTime: 1.76 + index * 0.08 }
        : drillConfig.key === "shooting" ? { velocity: primary }
        : { jumpHeight: primary }),
    }) as Rep),
  );
}
