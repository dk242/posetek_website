/** Shared UI vocabulary. Player reports never grant verified training clearance. */
export const GYM_EQUIPMENT = [
  { id: "dumbbells", label: "Dumbbells" }, { id: "barbell", label: "Barbell" },
  { id: "weightPlates", label: "Weight plates" }, { id: "squatRack", label: "Squat rack" },
  { id: "trapBar", label: "Trap bar" }, { id: "kettlebell", label: "Kettlebell" },
  { id: "cableMachine", label: "Cable machine" }, { id: "resistanceBand", label: "Resistance band" },
  { id: "medicineBall", label: "Medicine ball" }, { id: "pullUpBar", label: "Pull-up bar" },
  { id: "legCurlMachine", label: "Leg curl machine" }, { id: "legPressMachine", label: "Leg press machine" },
  { id: "jumpRope", label: "Jump rope" }, { id: "sliders", label: "Sliders" },
] as const;
export const TRAINING_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const LOAD_FAMILIES = ["knee", "hip", "hamstring", "adductor", "calf", "trunk", "upperPush", "upperPull"] as const;
export const REQUIRED_FILM_SLOTS = ["primaryDemo", "teachingDetail", "errorCorrection"] as const;
export interface ExternalSession {
  day: number;
  activity: "practice" | "match" | "strength" | "other";
  durationMinutes: number;
  effort: "easy" | "moderate" | "hard";
}
export interface TrainingContext {
  schemaVersion: 1;
  startDate: string;
  sessionDays: number[];
  externalSchedule: ExternalSession[];
  scheduleConfirmed: boolean;
  equipmentConfirmed: boolean;
  resistanceExperience: "unknown" | "new" | "experienced";
  supervision: "unconfirmed" | "qualifiedCoach" | "unavailable";
}
export function emptyTrainingContext(): TrainingContext {
  return { schemaVersion: 1, startDate: "", sessionDays: [], externalSchedule: [], scheduleConfirmed: false,
    equipmentConfirmed: false, resistanceExperience: "unknown", supervision: "unconfirmed" };
}
export function trainingContextIssues(context: TrainingContext, sessionsPerWeek: number): string[] {
  const issues: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(context.startDate) || !Number.isFinite(Date.parse(`${context.startDate}T12:00:00Z`))) issues.push("Choose a training start date.");
  if (new Set(context.sessionDays).size !== sessionsPerWeek) issues.push(`Choose ${sessionsPerWeek} training days to match the weekly commitment.`);
  if (!context.scheduleConfirmed) issues.push("Confirm the complete weekly schedule for this player.");
  if (!context.equipmentConfirmed) issues.push("Confirm this player has the selected equipment.");
  if (context.externalSchedule.some(s => !Number.isInteger(s.durationMinutes) || s.durationMinutes < 1 || s.durationMinutes > 360)) issues.push("Outside sessions need a duration between 1 and 360 minutes.");
  return issues;
}
export interface EvidenceSource {
  id: string; title: string; url: string; evidenceType: string; population: string;
  applicability: string; limitations: string;
}
export interface DrillAuthoring {
  drillId?: string; revision: number; productionBatchId: string; filmingWeek: number;
  sources: EvidenceSource[]; filmingInstructions: Record<string, string>;
  productionNotes?: string; reviewNotes?: string; reviewStatus: "pending" | "approved";
  publicationHold?: string; [key: string]: unknown;
}
export function sourceLink(url: unknown): string | undefined {
  try { const parsed = new URL(String(url)); return parsed.protocol === "https:" ? parsed.href : undefined; } catch { return undefined; }
}
export function filmingProgress(media: Record<string, { storagePath?: string; status?: string | null } | null | undefined> | undefined) {
  return { uploaded: REQUIRED_FILM_SLOTS.filter(slot => Boolean(media?.[slot]?.storagePath)).length,
    approved: REQUIRED_FILM_SLOTS.filter(slot => Boolean(media?.[slot]?.storagePath) && media?.[slot]?.status === "approved").length };
}
