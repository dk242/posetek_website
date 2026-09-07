// Reading `drillCatalog` documents of either schema into one view model, and
// the deterministic dose/rest text formatter.
//
// DRILL_CATALOG_V2_CONTRACT.md §1 (the document), §2 (the domain taxonomy and
// the legacy mapping), §3 (difficulty and its migration derivation), §4.1
// (field-by-field migration).
//
// **The website reads both schemas and writes only v2.** Agent 02 owns the
// live migration; normalizing a v1 document here is a read-only convenience so
// the library is usable before that runs, and `needsMigration` is what stops
// the editor from writing a half-migrated document back.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { isContinuousUnit, isDomain } from "./types";
import type { CatalogDose, CatalogMedia, DrillStatus } from "./types";

// Declared field by field rather than as `Omit<DrillV2, …>`: DrillV2 carries a
// string index signature for the untouched publisher fields, and Omit over such
// a type collapses every named property to `unknown`.
export interface CatalogDrill {
  schemaVersion: number;
  /** True when the stored document is still v1 — read it, never write it. */
  needsMigration: boolean;
  /** The v1 domain, kept for documents that have not cut over. */
  legacyDomain?: string;
  drillId: string;
  name: string;
  domain: string;
  minAge: number;
  maxAge: number;
  difficultyLevel: number;
  equipment: string[];
  requiresPartner: boolean;
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
  createdAt?: unknown;
  updatedAt?: unknown;
  updatedBy?: unknown;
  mediaPublishedAt?: unknown;
}

// MARK: - Legacy domain mapping (§2)

const LEGACY_DOMAINS: Record<string, string> = {
  dribbling: "dribbling",
  shooting: "shooting",
  linearSpeed: "speed",
  codAgility: "agility",
  verticalPower: "plyometrics",
  horizontalPower: "plyometrics",
  strengthResilience: "strength",
  representativeGames: "games",
};

export function domainFromLegacy(legacyDomain: string, targetQuality?: string | null): string {
  if (legacyDomain === "passingReceiving") {
    return targetQuality === "receiving" ? "receiving" : "passing";
  }
  return LEGACY_DOMAINS[legacyDomain] ?? legacyDomain;
}

// MARK: - Difficulty derivation (§3)

/**
 * The migration's deterministic derivation. Reproduced here only so an
 * unmigrated document shows a plausible difficulty in the library; agent 02's
 * run is what writes the value.
 */
export function derivedDifficulty(eligibleLevels: unknown, maturityGate: unknown): number {
  const levels = Array.isArray(eligibleLevels) ? eligibleLevels.map(String) : [];
  const foundation = levels.includes("foundation");
  const club = levels.includes("club");
  const performance = levels.includes("performance");
  let base: number;
  if (foundation && !performance) base = 1;
  else if (foundation && performance) base = 2;
  else if (!foundation && club) base = 3;
  else if (levels.length === 1 && performance) base = 4;
  else base = 2;
  const bump = ["circaPostPHV", "postPHVPreferred", "postPHVMostly"].includes(String(maturityGate)) ? 1 : 0;
  return Math.min(base + bump, 5);
}

// MARK: - Copy migration (§4.1)

/** v1 `execution` prose → ordered athlete-facing steps; a single long sentence stays one step. */
export function stepsFromExecution(execution: unknown): string[] {
  const text = String(execution ?? "").trim();
  if (!text) return [];
  return text
    .split(/(?<=\.)\s+|;\s+/)
    .map(part => part.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function coachCommentsFromLegacy(raw: any): string[] {
  const comments: string[] = (Array.isArray(raw?.cues) ? raw.cues : []).map((cue: unknown) => String(cue));
  const success = String(raw?.successCriteria ?? "").trim();
  if (success) comments.push(`You've got it when: ${success}`);
  const safety = String(raw?.safetyNote ?? "").trim();
  if (safety) comments.push(`Safety: ${safety}`);
  return comments.slice(0, 8);
}

export function leversFromLegacy(raw: any): string[] {
  const levers: string[] = [];
  const regression = String(raw?.regression ?? "").trim();
  if (regression) levers.push(`Easier: ${regression}`);
  const progression = String(raw?.progression ?? "").trim();
  if (progression) levers.push(`Harder: ${progression}`);
  for (const lever of Array.isArray(raw?.adaptiveLevers) ? raw.adaptiveLevers : []) {
    const text = String(lever).trim();
    if (text && !levers.includes(text)) levers.push(text);
  }
  return levers.slice(0, 6);
}

// MARK: - Normalization

function intOr(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(entry => String(entry)) : [];
}

function normalizeStatus(value: unknown): DrillStatus {
  return value === "draft" || value === "archived" || value === "published" ? value : "published";
}

/**
 * One view model for a `drillCatalog/{id}` document of either schema.
 * `id` is authoritative for `drillId` — the document id IS the drill id (§1).
 */
export function normalizeCatalogDrill(id: string, raw: any): CatalogDrill {
  const schemaVersion = intOr(raw?.schemaVersion, 1);
  const v2 = schemaVersion === 2;
  const legacyDomain = String(raw?.legacyDomain ?? (v2 ? "" : raw?.domain ?? ""));
  const dose: CatalogDose = (raw?.dose && typeof raw.dose === "object" ? raw.dose : {}) as CatalogDose;

  const domain = v2 && isDomain(raw?.domain)
    ? String(raw.domain)
    : domainFromLegacy(String(raw?.domain ?? ""), raw?.targetQuality ?? null);

  const equipment = stringList(raw?.equipment).filter(entry => v2 || entry !== "partner");
  const requiresPartner = v2
    ? raw?.requiresPartner === true
    : stringList(raw?.equipment).includes("partner") || intOr(raw?.playersMin, 1) >= 2;

  const howTo = v2 && raw?.howTo && typeof raw.howTo === "object"
    ? { setup: String(raw.howTo.setup ?? ""), steps: stringList(raw.howTo.steps) }
    : { setup: String(raw?.setup ?? ""), steps: stepsFromExecution(raw?.execution) };

  const coachComments = v2 ? stringList(raw?.coachComments) : coachCommentsFromLegacy(raw);
  const adaptiveLevers = v2 ? stringList(raw?.adaptiveLevers) : leversFromLegacy(raw);

  const difficultyLevel = v2
    ? Math.min(Math.max(intOr(raw?.difficultyLevel, 3), 1), 5)
    : derivedDifficulty(raw?.eligibleLevels, raw?.maturityGate);

  const maxFrequencyPerWeek = Math.min(
    Math.max(intOr(v2 ? raw?.maxFrequencyPerWeek : dose?.frequencyPerWeekMax, 2), 1),
    7,
  );

  return {
    schemaVersion,
    needsMigration: !v2,
    drillId: id,
    name: String(raw?.name ?? id),
    domain,
    legacyDomain: legacyDomain || undefined,
    minAge: intOr(raw?.minAge, 5),
    maxAge: intOr(raw?.maxAge, 99),
    difficultyLevel,
    equipment,
    requiresPartner,
    howTo,
    dose,
    maxFrequencyPerWeek,
    coachComments,
    adaptiveLevers,
    media: (raw?.media && typeof raw.media === "object" ? raw.media : undefined) as CatalogMedia | undefined,
    status: normalizeStatus(raw?.status),
    catalogVersion: String(raw?.catalogVersion ?? ""),
    howToSource: raw?.howToSource === "admin" ? "admin" : "migrated",
    coachCommentsSource: raw?.coachCommentsSource === "admin" ? "admin" : "migrated",
    createdAt: raw?.createdAt,
    updatedAt: raw?.updatedAt,
    updatedBy: raw?.updatedBy,
    mediaPublishedAt: raw?.mediaPublishedAt,
  };
}

// MARK: - Eligibility for one athlete (program §5 invariants)

export interface AthleteFit {
  ageOk: boolean;
  difficultyOk: boolean;
  partnerOk: boolean;
  equipmentOk: boolean;
  publishedOk: boolean;
}

export interface AthleteContext {
  age: number | null;
  maxDrillDifficulty: number;
  /** intake.setting: solo | partner | halfAndHalf */
  setting: string;
  equipment: string[];
}

export function fitFor(drill: CatalogDrill, athlete: AthleteContext): AthleteFit {
  const age = athlete.age;
  return {
    ageOk: age === null || (age >= drill.minAge && age <= drill.maxAge),
    difficultyOk: drill.difficultyLevel <= athlete.maxDrillDifficulty,
    partnerOk: !drill.requiresPartner || athlete.setting === "partner" || athlete.setting === "halfAndHalf",
    equipmentOk: !athlete.equipment.length || drill.equipment.every(item => athlete.equipment.includes(item)),
    publishedOk: drill.status === "published",
  };
}

// MARK: - Dose and rest text (§1.2)

const UNIT_TEXT: Record<string, string> = {
  reps: "reps",
  seconds: "s",
  minutes: "min",
  meters: "m",
  contacts: "contacts",
  cues: "cues",
  passes: "passes",
  shots: "shots",
};

function rangeText(min: unknown, max: unknown): string | null {
  const lo = typeof min === "number" && Number.isFinite(min) ? Math.round(min) : null;
  const hi = typeof max === "number" && Number.isFinite(max) ? Math.round(max) : null;
  if (lo === null && hi === null) return null;
  if (lo === null) return String(hi);
  if (hi === null || hi === lo) return String(lo);
  return `${lo}-${hi}`;
}

/**
 * "2-4 sets x 2-3 reps" — the display string of record, regenerated from the
 * structured fields whenever an admin edits the dose.
 *
 * The exact casing and separators are shared with agent 02's Swift formatter;
 * the cases asserted in drillV2.test.ts are the ones both sides must match.
 */
export function formatDoseText(dose: CatalogDose): string {
  const sets = rangeText(dose.setsMin, dose.setsMax);
  const reps = rangeText(dose.repsMin, dose.repsMax);
  const unit = UNIT_TEXT[String(dose.repUnit ?? "reps")] ?? String(dose.repUnit ?? "");
  const parts: string[] = [];
  if (sets) parts.push(`${sets} ${sets === "1" ? "set" : "sets"}`);
  if (reps) parts.push(`${reps} ${unit}`.trim());
  let text = parts.join(" x ");
  if (dose.perSide === true && text) text += " each side";
  return text;
}

/** "60-120 s", "60 s", or the drill's unstructured prose when no range exists. */
export function formatRestText(dose: CatalogDose): string {
  const rest = rangeText(dose.restSecondsMin, dose.restSecondsMax);
  if (!rest) return String(dose.restText ?? "").trim();
  const between = rangeText(dose.restBetweenSetsSecondsMin, dose.restBetweenSetsSecondsMax);
  const scope = dose.restScope === "reps" ? " between reps" : "";
  return between ? `${rest} s${scope}, ${between} s between sets` : `${rest} s${scope}`;
}

/** One line for a prescribed block: "4 x 30 s · 45 s rest · ~5 min". */
export function blockDoseLine(block: {
  sets: number; reps: number; repUnit: string; perSide?: boolean;
  restSeconds?: number; restScope?: string; estimatedMinutes?: number;
}): string {
  const unit = UNIT_TEXT[block.repUnit] ?? block.repUnit;
  const continuous = isContinuousUnit(block.repUnit);
  const work = `${block.sets} x ${block.reps} ${unit}`;
  const side = block.perSide ? " each side" : "";
  const rest = block.restSeconds
    ? ` · ${block.restSeconds}s rest${block.restScope === "reps" && !continuous ? "/rep" : ""}`
    : "";
  const minutes = block.estimatedMinutes ? ` · ~${block.estimatedMinutes} min` : "";
  return `${work}${side}${rest}${minutes}`;
}
