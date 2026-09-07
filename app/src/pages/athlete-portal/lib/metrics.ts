// Pure helpers ported verbatim from athlete-portal.js. Numeric output (units,
// toFixed digits, em-dash placeholders) must mirror the legacy strings exactly.

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Drill } from "./drills";
import { DRILLS } from "./drills";

export const num = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const mean = (values: number[]): number | null =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

export const fullName = (athlete: any): string =>
  [athlete?.firstName, athlete?.lastName].filter(Boolean).join(" ") || athlete?.name || "Athlete";

export const repType = (rep: any): string => rep._statsDrill || rep.repType || rep.drillType || "";

export const createdMillis = (rep: any): number =>
  rep.createdAtMillis || rep.createdAt?.toMillis?.() || rep.timestamp?.toMillis?.() || 0;

export const sessionNumber = (rep: any): number =>
  num(rep.sessionNumber) || num(String(rep.currentSession || rep.sessionFolder || "").match(/\d+/)?.[0]) || 1;

export const repNumber = (rep: any): number =>
  num(rep.repNumber) || num(rep.kickNumber) || num(String(rep.repFolder || "").match(/\d+/)?.[0]) || 1;

export const sessionFolder = (rep: any): string =>
  rep.sessionFolder || (/^session\d+$/i.test(rep.currentSession || "") ? rep.currentSession : `session${sessionNumber(rep)}`);

export const repFolder = (rep: any): string => rep.repFolder || `kick${repNumber(rep)}`;

export const dateText = (millis: number): string =>
  millis
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(millis))
    : "Recorded session";

// finishLoad's drawer avatar initials.
export const avatarInitials = (name: string): string =>
  name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();

export function normalizeRep(doc: any): any {
  const raw = doc.data ? doc.data() : doc;
  return { id: doc.id || raw.id, ...raw, createdAtMillis: createdMillis(raw) };
}

export function metricRaw(rep: any, drill: Drill): number | null {
  return num(drill.metric === null ? undefined : rep[drill.metric]) ?? num(drill.fallback === undefined ? undefined : rep[drill.fallback]);
}

export function displayValue(raw: number | null, drill: Drill): number | null {
  if (raw === null) return null;
  if (drill.unit === "mph") return raw * 2.23694;
  if (drill.unit === "in") return raw * 39.37007874;
  if (drill.unit === "ft") return raw * 3.28084;
  return raw;
}

export function formatValue(raw: number | null, drill: Drill, digits?: number): string {
  const value = displayValue(raw, drill);
  if (value === null) return "—";
  const precision = digits ?? (drill.unit === "s" ? 2 : 1);
  return `${value.toFixed(precision)}${drill.unit ? ` ${drill.unit}` : ""}`;
}

export function accepted(rep: any, drill: Drill): boolean {
  return drill.types.includes(repType(rep));
}

export function mergeUnique(left: any[], right: any[]): any[] {
  const map = new Map<string, any>();
  [...left, ...right].forEach(rep => map.set(`${sessionFolder(rep)}/${repFolder(rep)}`, rep));
  return [...map.values()];
}

export interface SessionGroup {
  folder: string;
  items: any[];
  number: number;
  date: number;
}

export function sessionsFor(reps: any[]): SessionGroup[] {
  const groups = new Map<string, any[]>();
  reps.forEach(rep => {
    const key = sessionFolder(rep);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(rep);
  });
  return [...groups.entries()]
    .map(([folder, items]) => ({
      folder,
      items: items.sort((a, b) => repNumber(a) - repNumber(b)),
      number: num(folder.match(/\d+/)?.[0]) || sessionNumber(items[0]),
      date: Math.max(...items.map(createdMillis), 0),
    }))
    .sort((a, b) => b.date - a.date || b.number - a.number);
}

export function trendText(values: number[], drill: Drill): string {
  if (values.length < 2) return "—";
  const chronological = [...values].reverse();
  const first = chronological[0];
  const last = chronological[chronological.length - 1];
  if (!first) return "—";
  const pct = (last - first) / first * 100 * (drill.higher ? 1 : -1);
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

export interface MetricTile {
  label: string;
  value: string;
}

export function dashboardMetrics(drill: Drill, reps: any[]): MetricTile[] {
  if (drill.key === "freeRecord")
    return [
      { label: "Sessions", value: String(sessionsFor(reps).length) },
      { label: "Videos", value: String(reps.length) },
    ];
  const raw = reps.map(rep => metricRaw(rep, drill)).filter((v): v is number => v !== null);
  const best = raw.length ? (drill.higher ? Math.max(...raw) : Math.min(...raw)) : null;
  const metrics: MetricTile[] = [
    { label: drill.higher ? "Average" : "Avg Time", value: formatValue(mean(raw), drill) },
    { label: drill.higher ? "Personal Best" : "Best Time", value: formatValue(best, drill) },
    { label: "Total Reps", value: String(reps.length) },
    { label: "Recent Trend", value: trendText(raw, drill) },
  ];
  if (drill.key === "shooting") {
    const angles = reps.map(rep => num(rep.launch_angle) ?? num(rep.launchAngle)).filter((v): v is number => v !== null);
    metrics.splice(2, 0, { label: "Avg Launch Angle", value: angles.length ? `${mean(angles)!.toFixed(1)}°` : "—" });
  }
  if (drill.key === "dribbling") {
    const values = reps.map(rep => num(rep.avgBallDistance)).filter((v): v is number => v !== null);
    metrics.splice(2, 0, { label: "Ball Distance", value: values.length ? `${(mean(values)! * 39.3701).toFixed(1)} in` : "—" });
  }
  if (["dribbling", "changeOfDirection"].includes(drill.key)) {
    ([["Start / Out", "phase1Time"], ["Turn", "phase2Time"], ["End / Back", "phase3Time"]] as [string, string][]).forEach(([label, key]) => {
      const values = reps.map(rep => num(rep[key])).filter((v): v is number => v !== null);
      metrics.push({ label, value: values.length ? `${mean(values)!.toFixed(2)} s` : "—" });
    });
  }
  return metrics;
}

export function allStatsReps(reps: Record<string, any[]>): any[] {
  return DRILLS.filter(d => d.key !== "freeRecord").flatMap(drill =>
    reps[drill.key].map(rep => ({ ...rep, _statsDrill: drill.key })),
  );
}

export interface PosePoint {
  x: number | null;
  y: number | null;
}

export function parsePose(raw: any): PosePoint[][] {
  const source = Array.isArray(raw) ? raw : (Array.isArray(raw?.frames) ? raw.frames : []);
  return source.map((frame: any) => {
    const points = Array.isArray(frame) ? frame : (frame?.landmarks || frame?.pose || []);
    return points.map((point: any) =>
      Array.isArray(point) ? { x: num(point[0]), y: num(point[1]) } : { x: num(point?.x), y: num(point?.y) },
    );
  });
}

export interface FrameMarker {
  label: string;
  frame: number;
}

export function frameMarkers(drill: Drill, rep: any, meta: any): FrameMarker[] {
  const keys: [string, any][] =
    drill.key === "broadJump"
      ? [["Takeoff", meta.takeoffFrame ?? rep.takeoffFrame], ["Landing", meta.landingFrame ?? rep.landingFrame]]
      : ["dribbling", "changeOfDirection"].includes(drill.key)
        ? [["Start", meta.startFrame ?? rep.startFrame], ["Turn", meta.apexFrame ?? meta.phase1EndFrame ?? rep.apexFrame], ["End", meta.endFrame ?? rep.endFrame]]
        : drill.key === "sprint"
          ? [["Start", meta.startFrame], ["Finish", meta.endFrame ?? meta.finishFrame]]
          : drill.key === "jump"
            ? [["Peak", meta.peakFrame ?? meta.apexFrame]]
            : [];
  return keys.filter(([, frame]) => num(frame) !== null).map(([label, frame]) => ({ label, frame: Number(frame) }));
}

export function repMetricSpecs(drill: Drill, rep: any, meta: any): MetricTile[] {
  const value = (key: string, ...fallbacks: string[]): number | null =>
    num(meta[key]) ?? num(rep[key]) ?? fallbacks.map(k => num(meta[k]) ?? num(rep[k])).find(v => v !== null) ?? null;
  switch (drill.key) {
    case "shooting":
      return [
        { label: "Ball Velocity", value: formatValue(value("velocity"), drill) },
        { label: "Launch Angle", value: value("launch_angle", "launchAngle") === null ? "—" : `${value("launch_angle", "launchAngle")!.toFixed(1)}°` },
        { label: "Strike Foot", value: String(meta.strike_foot || rep.strike_foot || "—").replace(/^./, c => c.toUpperCase()) },
      ];
    case "sprint":
      return [
        { label: "Top Speed", value: formatValue(value("max_velocity", "maxVelocity"), drill) },
        { label: "Max Acceleration", value: value("max_acceleration", "maxAcceleration") === null ? "—" : `${value("max_acceleration", "maxAcceleration")!.toFixed(2)} m/s²` },
        { label: "Total Time", value: value("totalTime") === null ? "—" : `${value("totalTime")!.toFixed(2)} s` },
      ];
    case "jump":
      return [
        { label: "Jump Height", value: formatValue(value("jumpHeight"), drill) },
        { label: "Peak Frame", value: String(value("peakFrame", "apexFrame") ?? "—") },
      ];
    case "broadJump":
      return [
        { label: "Distance", value: formatValue(value("broadJumpDistance"), drill) },
        { label: "Peak Height", value: value("jumpHeight") === null ? "—" : `${(value("jumpHeight")! * 39.3701).toFixed(1)} in` },
        { label: "Tracked Foot", value: String(meta.footSide || "—") },
      ];
    case "dribbling":
    case "changeOfDirection":
      return [
        { label: "Total Time", value: value("totalTime") === null ? "—" : `${value("totalTime")!.toFixed(2)} s` },
        { label: "Out", value: value("phase1Time") === null ? "—" : `${value("phase1Time")!.toFixed(2)} s` },
        { label: "Turn", value: value("phase2Time") === null ? "—" : `${value("phase2Time")!.toFixed(2)} s` },
        { label: "Back", value: value("phase3Time") === null ? "—" : `${value("phase3Time")!.toFixed(2)} s` },
        { label: "Distance", value: value("totalDistance") === null ? "—" : `${(value("totalDistance")! * 3.28084).toFixed(1)} ft` },
        ...(drill.key === "dribbling"
          ? [{ label: "Ball Distance", value: value("avgBallDistance") === null ? "—" : `${(value("avgBallDistance")! * 39.3701).toFixed(1)} in` }]
          : []),
      ];
    default:
      return [
        { label: "Recording", value: `Rep ${repNumber(rep)}` },
        { label: "Pose Frames", value: String(meta.frameCount || "Available") },
      ];
  }
}

// authArtifacts' storage folder resolution (both the storagePath cleanup path
// and the constructed `${playerId}/${drill.storage}/…` path).
export function artifactFolder(rep: any, drill: Drill, playerId: string): string {
  if (rep.storagePath && typeof rep.storagePath === "string" && !/^https?:/i.test(rep.storagePath)) {
    const clean = rep.storagePath
      .replace(/^gs:\/\/[^/]+\//, "")
      .split("?")[0]
      .replace(/^\/+|\/+$/g, "")
      .split("/");
    if (/\.[a-z0-9]{2,5}$/i.test(clean[clean.length - 1] || "")) clean.pop();
    return clean.join("/");
  }
  return `${playerId}/${drill.storage}/${sessionFolder(rep)}${rep.sessionRoot ? "" : `/${repFolder(rep)}`}`;
}
