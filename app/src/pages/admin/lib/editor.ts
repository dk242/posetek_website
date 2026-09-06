// The workout editor's pure core: the working draft, its operations, the
// validation split, and the before/after diff that becomes the ground-truth
// record.
//
// TRAINING_PROGRAM_V3_CONTRACT.md §5 (the block shape and the invariants every
// writer must hold), §8.3 (the adjustment record) and §13 (what an admin may
// never override); DRILL_CATALOG_V2_CONTRACT.md §9 (the time formula).
//
// Nothing in this file touches Firestore. The transaction in plans.ts calls
// `validateDraft` again against freshly read catalog and profile documents —
// validation at draft time alone is not sufficient (§13).

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  blockEstimatedMinutes,
  blockInputErrors,
  catalogTimeDefaults,
  workoutEstimatedMinutes,
} from "../../../lib/contracts/expectedMinutes";
import type { CatalogDrill } from "../../../lib/contracts/drillV2";
import type { CatalogDose } from "../../../lib/contracts/types";
import { fitFor } from "../../../lib/contracts/drillV2";
import type { AthleteContext } from "../../../lib/contracts/drillV2";
import { scheduledExposures } from "../../../lib/contracts/planV3";
import type { AdjustmentDiff, BlockV3, WeekV3, WorkoutSnapshot, WorkoutV3 } from "../../../lib/contracts/types";

export const MIN_BLOCKS = 1;
export const MAX_BLOCKS = 12;
export const BLOCK_KINDS = ["warmup", "main", "cooldown"] as const;
export const MAX_WHY_CHARS = 240;
export const MAX_INTENT_CHARS = 400;
export const MAX_TITLE_CHARS = 80;

// MARK: - The draft

export interface WorkoutDraft {
  planId: string;
  weekNumber: number;
  workoutId: string;
  order: number;
  title: string;
  intent: string;
  focusDomains: string[];
  budgetMinutes: number;
  blocks: BlockV3[];
  /** Monotonic; a removed b8 is never reissued to a different drill (01A F09). */
  nextBlockSequence: number;
  /** The revision this edit was made against — the transaction's compare-and-set. */
  baseRevision: number;
  basePlanRevision: number;
}

function nextSequenceOf(workout: any): number {
  const stored = Number(workout?.nextBlockSequence);
  if (Number.isInteger(stored) && stored >= 1) return stored;
  // A generator document that predates the counter: start above every existing
  // id so restoration can never reuse a retired one.
  const highest = (workout?.blocks || []).reduce((max: number, block: any) => {
    const match = /^b(\d+)$/.exec(String(block?.blockId ?? ""));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return highest + 1;
}

function normalizeBlock(block: any, order: number): BlockV3 {
  const repUnit = String(block?.repUnit ?? "reps");
  return {
    blockId: String(block?.blockId ?? `b${order}`),
    order,
    kind: (BLOCK_KINDS as readonly string[]).includes(String(block?.kind)) ? block.kind : "main",
    drillId: String(block?.drillId ?? ""),
    name: String(block?.name ?? block?.drillId ?? ""),
    domain: String(block?.domain ?? ""),
    sets: Number(block?.sets) || 1,
    reps: Number(block?.reps) || 1,
    repUnit,
    perSide: block?.perSide === true,
    restSeconds: Number(block?.restSeconds) || 0,
    restScope: block?.restScope === "reps" ? "reps" : "sets",
    restBetweenSetsSeconds:
      block?.restBetweenSetsSeconds === null || block?.restBetweenSetsSeconds === undefined
        ? null
        : Number(block.restBetweenSetsSeconds),
    familiarizationReps: Number(block?.familiarizationReps) || 0,
    estimatedMinutes: Number(block?.estimatedMinutes) || 0,
    whyIncluded: String(block?.whyIncluded ?? ""),
  };
}

export function draftFromWorkout(
  planId: string,
  weekNumber: number,
  workout: any,
  planRevision: number,
): WorkoutDraft {
  const blocks = [...(workout?.blocks || [])]
    .sort((a: any, b: any) => (Number(a?.order) || 0) - (Number(b?.order) || 0))
    .map((block: any, index: number) => normalizeBlock(block, index + 1));
  return {
    planId,
    weekNumber,
    workoutId: String(workout?.workoutId ?? ""),
    order: Number(workout?.order) || 1,
    title: String(workout?.title ?? ""),
    intent: String(workout?.intent ?? ""),
    focusDomains: (workout?.focusDomains || []).map((domain: any) => String(domain)),
    budgetMinutes: Number(workout?.budgetMinutes) || 60,
    blocks: recomputed(blocks),
    nextBlockSequence: nextSequenceOf(workout),
    baseRevision: Number(workout?.revision) || 1,
    basePlanRevision: planRevision,
  };
}

/** Renumber `order` 1..n and recompute every block's minutes from its own inputs. */
function recomputed(blocks: BlockV3[]): BlockV3[] {
  return blocks.map((block, index) => ({
    ...block,
    order: index + 1,
    estimatedMinutes: blockEstimatedMinutes(block),
  }));
}

export function draftMinutes(draft: WorkoutDraft): number {
  return workoutEstimatedMinutes(draft.blocks.map(block => block.estimatedMinutes));
}

// MARK: - Dose bounds and defaults

export interface DoseBounds {
  sets: { min: number; max: number };
  reps: { min: number; max: number };
  restSeconds: { min: number; max: number };
}

function boundOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
}

/**
 * The catalog's own ranges are the editor's bounds — a dose outside them is
 * refused, never warned about (program §5). Absent bounds fall back to the
 * widest values the formula's input contract accepts.
 */
export function doseBoundsFor(drill: CatalogDrill): DoseBounds {
  const dose: CatalogDose = drill.dose ?? {};
  const setsMin = Math.max(boundOr(dose.setsMin, 1), 1);
  const repsMin = Math.max(boundOr(dose.repsMin, 1), 1);
  const restMin = Math.max(boundOr(dose.restSecondsMin, 0), 0);
  return {
    sets: { min: setsMin, max: Math.max(boundOr(dose.setsMax, 10), setsMin) },
    reps: { min: repsMin, max: Math.max(boundOr(dose.repsMax, 600), repsMin) },
    restSeconds: { min: restMin, max: Math.max(boundOr(dose.restSecondsMax, 600), restMin) },
  };
}

function midpoint(min: number, max: number): number {
  return Math.round((min + max) / 2);
}

export function blockFromDrill(drill: CatalogDrill, blockId: string, order: number): BlockV3 {
  const bounds = doseBoundsFor(drill);
  const repUnit = String(drill.dose?.repUnit ?? "reps");
  const time = catalogTimeDefaults(drill.dose as Record<string, unknown>, repUnit);
  const block: BlockV3 = {
    blockId,
    order,
    kind: "main",
    drillId: drill.drillId,
    name: drill.name,
    domain: String(drill.domain),
    sets: midpoint(bounds.sets.min, bounds.sets.max),
    reps: midpoint(bounds.reps.min, bounds.reps.max),
    repUnit,
    perSide: drill.dose?.perSide === true,
    restSeconds: time.restSeconds,
    restScope: time.restScope,
    restBetweenSetsSeconds: time.restBetweenSetsSeconds,
    familiarizationReps: time.familiarizationReps,
    estimatedMinutes: 0,
    whyIncluded: "",
  };
  return { ...block, estimatedMinutes: blockEstimatedMinutes(block) };
}

// MARK: - Operations (each returns a NEW draft)

export function addBlock(draft: WorkoutDraft, drill: CatalogDrill, index?: number): WorkoutDraft {
  if (draft.blocks.length >= MAX_BLOCKS) {
    throw new Error(`A workout holds at most ${MAX_BLOCKS} blocks — remove one first.`);
  }
  if (drill.status !== "published") {
    throw new Error(`${drill.name} is ${drill.status}, so it cannot be prescribed to an athlete.`);
  }
  const blockId = `b${draft.nextBlockSequence}`;
  const block = blockFromDrill(drill, blockId, draft.blocks.length + 1);
  const blocks = [...draft.blocks];
  blocks.splice(index === undefined ? blocks.length : Math.max(0, Math.min(index, blocks.length)), 0, block);
  return { ...draft, blocks: recomputed(blocks), nextBlockSequence: draft.nextBlockSequence + 1 };
}

export function removeBlock(draft: WorkoutDraft, blockId: string): WorkoutDraft {
  return { ...draft, blocks: recomputed(draft.blocks.filter(block => block.blockId !== blockId)) };
}

export function moveBlock(draft: WorkoutDraft, blockId: string, toIndex: number): WorkoutDraft {
  const from = draft.blocks.findIndex(block => block.blockId === blockId);
  if (from === -1) return draft;
  const blocks = [...draft.blocks];
  const [block] = blocks.splice(from, 1);
  blocks.splice(Math.max(0, Math.min(toIndex, blocks.length)), 0, block);
  return { ...draft, blocks: recomputed(blocks) };
}

export interface DosePatch {
  sets?: number;
  reps?: number;
  restSeconds?: number;
  restScope?: "reps" | "sets";
  restBetweenSetsSeconds?: number | null;
  familiarizationReps?: number;
  kind?: (typeof BLOCK_KINDS)[number];
  whyIncluded?: string;
}

export function setDose(draft: WorkoutDraft, blockId: string, patch: DosePatch): WorkoutDraft {
  const blocks = draft.blocks.map(block =>
    block.blockId === blockId
      ? { ...block, ...patch, whyIncluded: (patch.whyIncluded ?? block.whyIncluded).slice(0, MAX_WHY_CHARS) }
      : block,
  );
  return { ...draft, blocks: recomputed(blocks) };
}

export interface MetaPatch {
  title?: string;
  intent?: string;
  budgetMinutes?: number;
  focusDomains?: string[];
}

export function setMeta(draft: WorkoutDraft, patch: MetaPatch): WorkoutDraft {
  return {
    ...draft,
    title: (patch.title ?? draft.title).slice(0, MAX_TITLE_CHARS),
    intent: (patch.intent ?? draft.intent).slice(0, MAX_INTENT_CHARS),
    budgetMinutes: patch.budgetMinutes ?? draft.budgetMinutes,
    focusDomains: (patch.focusDomains ?? draft.focusDomains).slice(0, 4),
  };
}

// MARK: - Validation

export type IssueCode =
  | "blockCount" | "duplicateBlockId" | "unknownDrill" | "formula" | "doseRange" | "frequency"
  | "notPublished" | "age" | "difficulty" | "partner" | "equipment" | "budget";

export interface Issue {
  code: IssueCode;
  severity: "error" | "warning";
  blockId?: string;
  drillId?: string;
  message: string;
}

export interface ValidationContext {
  drills: Map<string, CatalogDrill>;
  athlete: AthleteContext;
  week: WeekV3 | null;
  /**
   * Exposures this plan week already owes OUTSIDE its scheduled workouts:
   * started/completed ad-hoc logs and `status: ready` reservations inside the
   * week window, per drill id (program §13).
   */
  extraExposures: Record<string, number>;
}

function budgetToleranceMinutes(budget: number): number {
  return Math.max(Math.round(budget * 0.1), 5);
}

/**
 * Errors block the save and can never be overridden. Warnings are recorded in
 * the adjustment's `warningsOverridden` when the admin saves anyway.
 *
 * `maxFrequencyPerWeek` is deliberately an ERROR: 01A F10 and program §13 make
 * it the one limit an admin may not override.
 */
export function validateDraft(draft: WorkoutDraft, context: ValidationContext): Issue[] {
  const issues: Issue[] = [];

  if (draft.blocks.length < MIN_BLOCKS) {
    issues.push({ code: "blockCount", severity: "error", message: "A workout needs at least one drill." });
  }
  if (draft.blocks.length > MAX_BLOCKS) {
    issues.push({ code: "blockCount", severity: "error", message: `A workout holds at most ${MAX_BLOCKS} drills.` });
  }

  const seen = new Set<string>();
  for (const block of draft.blocks) {
    if (seen.has(block.blockId)) {
      issues.push({ code: "duplicateBlockId", severity: "error", blockId: block.blockId, message: `Two blocks share the id ${block.blockId}.` });
    }
    seen.add(block.blockId);

    for (const message of blockInputErrors(block)) {
      issues.push({ code: "formula", severity: "error", blockId: block.blockId, drillId: block.drillId, message: `${block.name}: ${message}` });
    }

    const drill = context.drills.get(block.drillId);
    if (!drill) {
      issues.push({ code: "unknownDrill", severity: "error", blockId: block.blockId, drillId: block.drillId, message: `${block.drillId} is not in the drill catalog.` });
      continue;
    }

    const bounds = doseBoundsFor(drill);
    if (block.sets < bounds.sets.min || block.sets > bounds.sets.max) {
      issues.push({ code: "doseRange", severity: "error", blockId: block.blockId, drillId: block.drillId, message: `${drill.name}: sets must be ${bounds.sets.min}–${bounds.sets.max}.` });
    }
    if (block.reps < bounds.reps.min || block.reps > bounds.reps.max) {
      issues.push({ code: "doseRange", severity: "error", blockId: block.blockId, drillId: block.drillId, message: `${drill.name}: the per-set amount must be ${bounds.reps.min}–${bounds.reps.max}.` });
    }
    if (block.restSeconds < bounds.restSeconds.min || block.restSeconds > bounds.restSeconds.max) {
      issues.push({ code: "doseRange", severity: "error", blockId: block.blockId, drillId: block.drillId, message: `${drill.name}: rest must be ${bounds.restSeconds.min}–${bounds.restSeconds.max} s.` });
    }

    const fit = fitFor(drill, context.athlete);
    if (!fit.publishedOk) {
      issues.push({ code: "notPublished", severity: "warning", blockId: block.blockId, drillId: block.drillId, message: `${drill.name} is ${drill.status} — athletes cannot see it.` });
    }
    if (!fit.ageOk) {
      issues.push({ code: "age", severity: "warning", blockId: block.blockId, drillId: block.drillId, message: `${drill.name} is written for ages ${drill.minAge}–${drill.maxAge}.` });
    }
    if (!fit.difficultyOk) {
      issues.push({ code: "difficulty", severity: "warning", blockId: block.blockId, drillId: block.drillId, message: `${drill.name} is difficulty ${drill.difficultyLevel}; this athlete is set to ${context.athlete.maxDrillDifficulty}.` });
    }
    if (!fit.partnerOk) {
      issues.push({ code: "partner", severity: "warning", blockId: block.blockId, drillId: block.drillId, message: `${drill.name} needs a partner; this plan is set to “${context.athlete.setting}”.` });
    }
    if (!fit.equipmentOk) {
      const missing = drill.equipment.filter(item => !context.athlete.equipment.includes(item));
      issues.push({ code: "equipment", severity: "warning", blockId: block.blockId, drillId: block.drillId, message: `${drill.name} needs ${missing.join(", ")}, which this athlete did not list.` });
    }
  }

  // Frequency: distinct scheduled workout identities in this plan week with the
  // target replaced (never counted twice), plus ad-hoc evidence in the window.
  const replacement = { workoutId: draft.workoutId, blocks: draft.blocks };
  const counted = new Set<string>();
  for (const block of draft.blocks) {
    if (counted.has(block.drillId)) continue;
    counted.add(block.drillId);
    const drill = context.drills.get(block.drillId);
    if (!drill) continue;
    const scheduled = context.week ? scheduledExposures(context.week, block.drillId, replacement) : 1;
    const extra = Number(context.extraExposures[block.drillId] ?? 0);
    const total = scheduled + extra;
    if (total > drill.maxFrequencyPerWeek) {
      issues.push({
        code: "frequency",
        severity: "error",
        blockId: block.blockId,
        drillId: block.drillId,
        message: `${drill.name} would appear ${total} times this week; its limit is ${drill.maxFrequencyPerWeek}. This limit cannot be overridden.`,
      });
    }
  }

  const minutes = draftMinutes(draft);
  const tolerance = budgetToleranceMinutes(draft.budgetMinutes);
  if (Math.abs(minutes - draft.budgetMinutes) > tolerance) {
    issues.push({
      code: "budget",
      severity: "warning",
      message: minutes > draft.budgetMinutes
        ? `This workout is ~${minutes} min against a ${draft.budgetMinutes} min budget.`
        : `This workout is only ~${minutes} min against a ${draft.budgetMinutes} min budget.`,
    });
  }

  return issues;
}

export function errorsOf(issues: Issue[]): Issue[] {
  return issues.filter(issue => issue.severity === "error");
}

export function warningsOf(issues: Issue[]): Issue[] {
  return issues.filter(issue => issue.severity === "warning");
}

// MARK: - Snapshots and the diff (§8.3)

export function snapshotOf(workout: any): WorkoutSnapshot {
  return {
    title: String(workout?.title ?? ""),
    intent: String(workout?.intent ?? ""),
    focusDomains: (workout?.focusDomains || []).map((domain: any) => String(domain)),
    budgetMinutes: Number(workout?.budgetMinutes) || 0,
    estimatedMinutes: Number(workout?.estimatedMinutes) || 0,
    blocks: [...(workout?.blocks || [])]
      .sort((a: any, b: any) => (Number(a?.order) || 0) - (Number(b?.order) || 0))
      .map((block: any, index: number) => normalizeBlock(block, index + 1)),
  };
}

export function snapshotOfDraft(draft: WorkoutDraft): WorkoutSnapshot {
  return {
    title: draft.title,
    intent: draft.intent,
    focusDomains: draft.focusDomains,
    budgetMinutes: draft.budgetMinutes,
    estimatedMinutes: draftMinutes(draft),
    blocks: draft.blocks,
  };
}

const DOSE_KEYS = [
  "sets", "reps", "repUnit", "perSide", "restSeconds", "restScope",
  "restBetweenSetsSeconds", "familiarizationReps",
] as const;

function domainMinutes(blocks: BlockV3[]): Record<string, number> {
  const minutes: Record<string, number> = {};
  for (const block of blocks) {
    if (!block.domain) continue;
    minutes[block.domain] = (minutes[block.domain] ?? 0) + (Number(block.estimatedMinutes) || 0);
  }
  return minutes;
}

/**
 * `before` and `after` are kept verbatim by the caller; this is the derived
 * summary a future evaluation reads first. Dose changes carry the full set of
 * formula inputs, a superset of the contract's illustrative three keys, so a
 * replay never has to guess which unstated input moved.
 */
export function diffWorkouts(before: WorkoutSnapshot, after: WorkoutSnapshot): AdjustmentDiff {
  const beforeById = new Map(before.blocks.map(block => [block.blockId, block]));
  const afterById = new Map(after.blocks.map(block => [block.blockId, block]));

  const added = after.blocks
    .filter(block => !beforeById.has(block.blockId))
    .map(block => ({ blockId: block.blockId, drillId: block.drillId, domain: block.domain }));
  const removed = before.blocks
    .filter(block => !afterById.has(block.blockId))
    .map(block => ({ blockId: block.blockId, drillId: block.drillId, domain: block.domain }));

  const doseChanged: AdjustmentDiff["doseChanged"] = [];
  for (const block of after.blocks) {
    const original = beforeById.get(block.blockId);
    if (!original) continue;
    const from: Record<string, unknown> = {};
    const to: Record<string, unknown> = {};
    for (const key of DOSE_KEYS) {
      if (original[key] !== block[key]) {
        from[key] = original[key];
        to[key] = block[key];
      }
    }
    if (Object.keys(from).length) doseChanged.push({ blockId: block.blockId, drillId: block.drillId, from, to });
  }

  const survivingBefore = before.blocks.filter(block => afterById.has(block.blockId)).map(block => block.blockId);
  const survivingAfter = after.blocks.filter(block => beforeById.has(block.blockId)).map(block => block.blockId);
  const reordered = survivingBefore.join("|") !== survivingAfter.join("|");

  const beforeDomains = domainMinutes(before.blocks);
  const afterDomains = domainMinutes(after.blocks);
  const domainMinutesDelta: Record<string, number> = {};
  for (const domain of new Set([...Object.keys(beforeDomains), ...Object.keys(afterDomains)])) {
    const delta = (afterDomains[domain] ?? 0) - (beforeDomains[domain] ?? 0);
    if (delta !== 0) domainMinutesDelta[domain] = delta;
  }

  return {
    added,
    removed,
    doseChanged,
    reordered,
    minutesDelta: after.estimatedMinutes - before.estimatedMinutes,
    domainMinutesDelta,
  };
}

export function isUnchanged(diff: AdjustmentDiff, before: WorkoutSnapshot, after: WorkoutSnapshot): boolean {
  return !diff.added.length
    && !diff.removed.length
    && !diff.doseChanged.length
    && !diff.reordered
    && before.title === after.title
    && before.intent === after.intent
    && before.budgetMinutes === after.budgetMinutes
    && before.focusDomains.join("|") === after.focusDomains.join("|")
    && before.blocks.map(block => `${block.blockId}:${block.kind}:${block.whyIncluded}`).join("|")
       === after.blocks.map(block => `${block.blockId}:${block.kind}:${block.whyIncluded}`).join("|");
}

// MARK: - The persisted workout

/** The workout body the transaction splices into `weeks`. Timestamps are the caller's. */
export function workoutFromDraft(
  draft: WorkoutDraft,
  previous: WorkoutV3 | any,
  editorUid: string,
  editedAt: unknown,
): WorkoutV3 {
  const { previousRevision: _dropped, ...priorBody } = (previous || {}) as any;
  return {
    ...priorBody,
    workoutId: draft.workoutId,
    order: draft.order,
    title: draft.title,
    intent: draft.intent,
    focusDomains: draft.focusDomains,
    budgetMinutes: draft.budgetMinutes,
    estimatedMinutes: draftMinutes(draft),
    blocks: draft.blocks,
    revision: Number(previous?.revision || draft.baseRevision) + 1,
    editedBy: "admin",
    editedAt,
    editorUid,
    nextBlockSequence: draft.nextBlockSequence,
    // One level only, and never a nested previousRevision (§5, §13).
    previousRevision: {
      revision: Number(previous?.revision) || draft.baseRevision,
      editedBy: String(previous?.editedBy ?? "generator"),
      editedAt: previous?.editedAt ?? null,
      editorUid: previous?.editorUid ?? null,
      title: String(previous?.title ?? ""),
      order: Number(previous?.order) || draft.order,
      intent: String(previous?.intent ?? ""),
      focusDomains: (previous?.focusDomains || []).map((domain: any) => String(domain)),
      budgetMinutes: Number(previous?.budgetMinutes) || 0,
      estimatedMinutes: Number(previous?.estimatedMinutes) || 0,
      nextBlockSequence: nextSequenceOf(previous),
      check: previous?.check ?? null,
      blocks: (previous?.blocks || []).map((block: any, index: number) => normalizeBlock(block, index + 1)),
    },
    // The generator's time and adversarial checks no longer describe this
    // workout. Re-running them is not in this wave (§6).
    check: null,
  };
}
