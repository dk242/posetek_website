// Cross-repo contract vocabulary and document shapes.
//
// Source of truth (PoseTek-mobile-app/docs/, indexed by Agentic Work/CONTRACTS_INDEX.md):
//   DRILL_CATALOG_V2_CONTRACT.md      §1 the drill document, §2 the domain taxonomy, §3 difficulty
//   TRAINING_PROGRAM_V3_CONTRACT.md   §1 plan, §4 week, §5 workout/block, §8.3 the adjustment record
//   PLAYER_PROFILE_INPUTS_CONTRACT.md §1 position, §7 technical eligibility
//
// A field name here cannot change on one side alone. Firestore documents stay
// loosely typed at the read boundary (parity beats type ceremony, PORTING.md);
// these interfaces describe what this app WRITES and what its pure functions
// take, which is where a wrong field name is expensive.

/* eslint-disable @typescript-eslint/no-explicit-any */

// MARK: - Domains (catalog contract §2)

// Ten values. The array order IS the sort order for the library and the
// editor's domain filter — clients do not invent another one.
export const DOMAINS = [
  "ballMastery",
  "dribbling",
  "passing",
  "receiving",
  "shooting",
  "speed",
  "agility",
  "plyometrics",
  "strength",
  "games",
] as const;

export type Domain = (typeof DOMAINS)[number];

const DOMAIN_LABELS: Record<string, string> = {
  ballMastery: "Ball mastery",
  dribbling: "Dribbling",
  passing: "Passing",
  receiving: "Receiving",
  shooting: "Shooting",
  speed: "Speed",
  agility: "Agility",
  plyometrics: "Plyometrics",
  strength: "Strength",
  games: "Small-sided games",
};

// Domain code prefixes for new drill ids (catalog §8).
export const DOMAIN_CODES: Record<Domain, string> = {
  ballMastery: "BMA",
  dribbling: "DRB",
  passing: "PAS",
  receiving: "RCV",
  shooting: "SHT",
  speed: "SPD",
  agility: "AGL",
  plyometrics: "PLY",
  strength: "STR",
  games: "SSG",
};

export function isDomain(value: unknown): value is Domain {
  return typeof value === "string" && (DOMAINS as readonly string[]).includes(value);
}

// Unknown ids (a legacy v1 domain on an unmigrated document) pass through
// humanized rather than being dropped, so the library never shows a blank chip.
export function domainLabel(domain: string): string {
  if (DOMAIN_LABELS[domain]) return DOMAIN_LABELS[domain];
  if (!domain) return "";
  // Same shape as the athlete portal's `humanized()`: "linearSpeed" -> "Linear speed".
  return domain
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toLowerCase()
    .replace(/^./, character => character.toUpperCase());
}

export function domainSortIndex(domain: string): number {
  const index = (DOMAINS as readonly string[]).indexOf(domain);
  return index === -1 ? DOMAINS.length : index;
}

// MARK: - Equipment and rep units (catalog §1, §1.2)

export const EQUIPMENT = [
  "ball", "cones", "markers", "wall", "goal", "hurdles", "box",
  "sledOrBand", "timer", "bench", "mat", "kneePad", "tapeMeasure", "cueDevice",
] as const;

export const REP_UNITS = [
  "reps", "seconds", "minutes", "meters", "contacts", "cues", "passes", "shots",
] as const;

export type RepUnit = (typeof REP_UNITS)[number];

// Units whose `reps` value is the duration/distance of ONE continuous set
// (catalog §11). `restScope: "reps"` is invalid for these — there is no
// separate effort count to rest between.
export const CONTINUOUS_UNITS: readonly RepUnit[] = ["seconds", "minutes", "meters"];

export function isContinuousUnit(unit: string): boolean {
  return (CONTINUOUS_UNITS as readonly string[]).includes(unit);
}

export const DRILL_STATUSES = ["draft", "published", "archived"] as const;
export type DrillStatus = (typeof DRILL_STATUSES)[number];

export const MEDIA_SLOTS = ["primaryDemo", "teachingDetail", "errorCorrection", "birdsEye"] as const;
export type MediaSlot = (typeof MEDIA_SLOTS)[number];

export const MEDIA_SLOT_LABELS: Record<MediaSlot, string> = {
  primaryDemo: "Primary demo",
  teachingDetail: "Teaching detail",
  errorCorrection: "Error correction",
  birdsEye: "Bird's eye",
};

// MARK: - Positions and age bands (profile inputs §1, §2)

export const POSITIONS = ["GK", "CB", "FB", "DM", "CM", "AM", "W", "ST"] as const;
export type Position = (typeof POSITIONS)[number];

export const POSITION_LABELS: Record<Position, string> = {
  GK: "Goalkeeper",
  CB: "Centre back",
  FB: "Full back / wing back",
  DM: "Defensive midfielder",
  CM: "Central midfielder",
  AM: "Attacking midfielder",
  W: "Winger",
  ST: "Striker",
};

export function isPosition(value: unknown): value is Position {
  return typeof value === "string" && (POSITIONS as readonly string[]).includes(value);
}

// Workbook age bands (profile inputs §2) — deliberately NOT the Stats tab's
// benchmark bands; the two coexist.
export function ageBand(age: number | null): string | null {
  if (age === null || !Number.isFinite(age)) return null;
  if (age <= 8) return "U6-U8";
  if (age <= 10) return "U9-U10";
  if (age <= 12) return "U11-U12";
  if (age <= 14) return "U13-U14";
  if (age <= 16) return "U15-U16";
  if (age <= 19) return "U17-U19";
  return "senior";
}

// MARK: - Technical eligibility (profile inputs §7)

export interface TechnicalEligibility {
  maxDrillDifficulty: number;
  source: "player" | "coach" | "default";
  coachId: string | null;
}

function validRating(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

// A valid player value overrides a valid assigned-coach value; otherwise 5.
// An invalid stored rating behaves as absent (and the caller reports the gap).
export function resolveEligibility(player: any, coach: any, coachId: string | null): TechnicalEligibility {
  const playerRating = validRating(player?.maxDrillDifficulty);
  if (playerRating !== null) return { maxDrillDifficulty: playerRating, source: "player", coachId };
  const coachRating = validRating(coach?.maxDrillDifficulty);
  if (coachRating !== null) return { maxDrillDifficulty: coachRating, source: "coach", coachId };
  return { maxDrillDifficulty: 5, source: "default", coachId };
}

// MARK: - Drill catalog v2 (catalog §1)

export interface CatalogDose {
  setsMin?: number | null;
  setsMax?: number | null;
  repsMin?: number | null;
  repsMax?: number | null;
  repUnit?: string | null;
  perSide?: boolean | null;
  doseText?: string | null;
  restSecondsMin?: number | null;
  restSecondsMax?: number | null;
  restText?: string | null;
  restScope?: "reps" | "sets" | null;
  restBetweenSetsSecondsMin?: number | null;
  restBetweenSetsSecondsMax?: number | null;
  familiarizationReps?: number | null;
  doseNote?: string | null;
  [key: string]: unknown;
}

export interface CatalogMediaAsset {
  storagePath: string;
  contentType?: string | null;
  bytes?: number | null;
  generation?: string | null;
  status?: string | null;
  uploadedBy?: string | null;
  uploadedAt?: unknown;
}

export type CatalogMedia = Partial<Record<MediaSlot, CatalogMediaAsset | null>>;

export interface DrillV2 {
  schemaVersion: 2;
  drillId: string;
  name: string;
  domain: Domain | string;
  minAge: number;
  maxAge: number;
  difficultyLevel: number;
  equipment: string[];
  requiresPartner: boolean;
  /** Catalog §1: null (the default) is any position; a Position restricts prescription to it. */
  positionSpecific?: Position | null;
  howTo: { setup: string; steps: string[] };
  dose: CatalogDose;
  maxFrequencyPerWeek: number;
  coachComments: string[];
  adaptiveLevers: string[];
  media?: CatalogMedia;
  status: DrillStatus;
  catalogVersion: string;
  howToSource: "migrated" | "admin";
  coachCommentsSource: "migrated" | "admin";
  [key: string]: unknown;
}

// MARK: - Training program v3 (program §1, §4, §5)

export interface BlockV3 {
  blockId: string;
  order: number;
  kind: "warmup" | "main" | "cooldown";
  drillId: string;
  name: string;
  domain: string;
  sets: number;
  reps: number;
  repUnit: RepUnit | string;
  perSide: boolean;
  restSeconds: number;
  restScope: "reps" | "sets";
  restBetweenSetsSeconds: number | null;
  familiarizationReps: number;
  estimatedMinutes: number;
  whyIncluded: string;
}

export interface WorkoutCheck {
  timeStatus?: string;
  deltaMinutes?: number;
  intentStatus?: string;
  checkedAt?: unknown;
  notes?: string[];
}

export interface WorkoutV3 {
  workoutId: string;
  order: number;
  title: string;
  intent: string;
  focusDomains: string[];
  budgetMinutes: number;
  estimatedMinutes: number;
  blocks: BlockV3[];
  revision: number;
  editedBy: "generator" | "athlete" | "admin";
  editedAt?: unknown;
  editorUid?: string | null;
  previousRevision?: Record<string, any> | null;
  nextBlockSequence?: number;
  check?: WorkoutCheck | null;
  [key: string]: unknown;
}

export interface WeekV3 {
  weekNumber: number;
  theme?: string;
  focus?: string;
  progressionNote?: string | null;
  focusSplit?: Record<string, number>;
  allocations?: { domain: string; minutes: number }[];
  targets?: { domain: string; exposures: number }[];
  actualMinutesByDomain?: Record<string, number>;
  transitionMinutes?: number;
  workouts: WorkoutV3[];
  [key: string]: unknown;
}

export interface PlanV3 {
  id?: string;
  schemaVersion: 3;
  planId?: string;
  playerId?: string;
  status?: string;
  startDate?: string;
  timezone?: string;
  horizonWeeks?: number;
  sessionsPerWeek?: number;
  minutesPerSession?: number;
  weeklyBudgetMinutes?: number;
  planRevision?: number;
  lastEdit?: Record<string, any> | null;
  intake?: Record<string, any>;
  assessment?: Record<string, any>;
  focusAreas?: { domain: string; rationale?: string }[];
  weeks: WeekV3[];
  generationContextRef?: string | null;
  [key: string]: unknown;
}

// Readers branch on `schemaVersion` FIRST (program §10). A v1 plan and the
// additive v2 fields both report 1; anything unrecognized reports 0 so the
// caller can show "unreadable" rather than crash.
export function planSchemaVersion(plan: any): number {
  const raw = plan?.schemaVersion;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return 1; // pre-schemaVersion documents are v1
  if (value === 1 || value === 2) return 1;
  if (value === 3) return 3;
  return 0;
}

export function isV3Plan(plan: any): boolean {
  return planSchemaVersion(plan) === 3;
}

// MARK: - The ground-truth record (program §8.3)

export interface AdjustmentDiff {
  added: { blockId: string; drillId: string; domain: string }[];
  removed: { blockId: string; drillId: string; domain: string }[];
  doseChanged: {
    blockId: string;
    drillId: string;
    from: Record<string, unknown>;
    to: Record<string, unknown>;
  }[];
  reordered: boolean;
  minutesDelta: number;
  domainMinutesDelta: Record<string, number>;
}

export interface WorkoutSnapshot {
  title: string;
  intent: string;
  focusDomains: string[];
  budgetMinutes: number;
  estimatedMinutes: number;
  blocks: BlockV3[];
}
