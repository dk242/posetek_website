export const PHASES = ["approach", "backswing", "contact", "followThrough"] as const;
export type Phase = typeof PHASES[number];
export const LIMBS: Record<string, { label: string; joints: [number, number] }> = {
  leftUpperArm: { label: "Left upper arm", joints: [11, 13] }, leftForearm: { label: "Left forearm", joints: [13, 15] },
  rightUpperArm: { label: "Right upper arm", joints: [12, 14] }, rightForearm: { label: "Right forearm", joints: [14, 16] },
  leftThigh: { label: "Left thigh", joints: [23, 25] }, leftShin: { label: "Left shin", joints: [25, 27] },
  rightThigh: { label: "Right thigh", joints: [24, 26] }, rightShin: { label: "Right shin", joints: [26, 28] },
  hips: { label: "Hips", joints: [23, 24] }, shoulders: { label: "Shoulders", joints: [11, 12] }, trunk: { label: "Trunk", joints: [11, 23] },
  leftFoot: { label: "Left foot", joints: [29, 31] }, rightFoot: { label: "Right foot", joints: [30, 32] },
};
export interface ReviewFocus { id: string; rank: number; title: string; observation: string; cue: string; whyItMatters: string; evidenceIds: string[] }
export interface ReviewFeedback { summary: string; focusAreas: ReviewFocus[] }
export interface TechniqueAnnotation { id: string; repId: string; phase: Phase; frame: number; limbs: string[]; point: { x: number; y: number } | null; comment: string }
export interface ReviewNotes { incorrect: string; missedPriorities: string; other: string }
export function feedbackFromResult(result: any): ReviewFeedback {
  const observations = new Map<string, any>((result?.observations || []).map((row: any) => [row.id, row]));
  return {
    summary: typeof result?.summary === "string" ? result.summary : "",
    focusAreas: (result?.focusAreas || []).slice().sort((a: any, b: any) => a.rank - b.rank).map((row: any, index: number) => ({
      id: `focus_${index + 1}`, rank: index + 1, title: String(row.title || ""),
      observation: String(row.observation || observations.get(row.observationId)?.observation || row.evidence || ""),
      cue: String(row.cue || ""), whyItMatters: String(row.whyItMatters || ""), evidenceIds: row.evidenceIds || row.metricIds || [],
    })),
  };
}
export function reorderedFocus(rows: ReviewFocus[], index: number, direction: -1 | 1): ReviewFocus[] {
  const next = rows.slice(), target = index + direction;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next.map((row, i) => ({ ...row, rank: i + 1 }));
}
export function reliableFoot(rep: any): "left" | "right" | null {
  return ["left", "right"].includes(rep?.strike_foot) ? rep.strike_foot : null;
}
export function phaseFrame(result: any, metadata: any, phase: Phase): number | null {
  const value = result?.keyFrames?.[phase] ?? (phase === "contact" ? metadata?.contact_frame : phase === "backswing" ? metadata?.transition_frame : null);
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}
export function annotationPoint(row: any): { x: number; y: number } | null {
  const x = Array.isArray(row) ? row[0] : row?.x, y = Array.isArray(row) ? row[1] : row?.y;
  const visibility = Array.isArray(row) ? row[3] : row?.visibility;
  return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y) && !(typeof visibility === "number" && visibility < 0.1) ? { x, y } : null;
}
export function sourceEvidence(result: any): any[] {
  return Array.isArray(result?.differences) ? result.differences : Array.isArray(result?.evidence?.rows) ? result.evidence.rows : result?.metrics || [];
}
export function eligibleEvidence(row: any): boolean {
  return typeof row.eligible === "boolean" ? row.eligible : typeof row.comparable === "boolean" ? row.comparable : row.valid === true;
}
export function poseJoint(pose: any, mediaPipeIndex: number): { x: number; y: number } | null {
  if (!Array.isArray(pose)) return null;
  if (pose.length >= 33) return annotationPoint(pose[mediaPipeIndex]);
  if (pose.length !== 17) return null;
  const coco: Record<number, number> = { 11: 5, 12: 6, 13: 7, 14: 8, 15: 9, 16: 10, 23: 11, 24: 12, 25: 13, 26: 14, 27: 15, 28: 16 };
  return coco[mediaPipeIndex] === undefined ? null : annotationPoint(pose[coco[mediaPipeIndex]]);
}
export function manualArtifactsChanged(previous: any, observed: Record<string, any>): boolean {
  if (previous?.source?.mode !== "manual") return false;
  return Object.entries(observed).some(([repId, state]) => ["pose.json", "metadata.json", "reprocess_context.json"].some(name => {
    const before = previous.manualSource?.[repId]?.artifacts?.[name], after = state.identities?.[name];
    return String(before?.generation || "") !== String(after?.generation || "") || String(before?.md5Hash || "") !== String(after?.md5Hash || "");
  }));
}
