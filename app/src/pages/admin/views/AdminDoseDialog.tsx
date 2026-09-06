// Set the dose for one block, inside the catalog drill's own ranges.
//
// The minutes shown update as you type and come from the shared formula
// (DRILL_CATALOG_V2 §9) — the same arithmetic the athlete's phone and the
// gateway run, so this screen cannot quietly disagree with them.

import { useMemo, useState } from "react";
import { blockEstimatedMinutes, blockInputErrors } from "../../../lib/contracts/expectedMinutes";
import { isContinuousUnit } from "../../../lib/contracts/types";
import type { BlockV3 } from "../../../lib/contracts/types";
import { BLOCK_KINDS, MAX_WHY_CHARS, doseBoundsFor } from "../lib/editor";
import type { DosePatch } from "../lib/editor";
import type { CatalogDrill } from "../../../lib/contracts/drillV2";

interface Props {
  block: BlockV3;
  drill: CatalogDrill | undefined;
  onCancel: () => void;
  onSave: (patch: DosePatch) => void;
}

export default function AdminDoseDialog({ block, drill, onCancel, onSave }: Props) {
  const [draft, setDraft] = useState<BlockV3>(block);
  const bounds = useMemo(
    () => (drill ? doseBoundsFor(drill) : { sets: { min: 1, max: 10 }, reps: { min: 1, max: 600 }, restSeconds: { min: 0, max: 600 } }),
    [drill],
  );
  const continuous = isContinuousUnit(draft.repUnit);
  const errors = useMemo(() => {
    const list = blockInputErrors(draft);
    if (draft.sets < bounds.sets.min || draft.sets > bounds.sets.max) {
      list.push(`Sets must be ${bounds.sets.min}–${bounds.sets.max} for this drill.`);
    }
    if (draft.reps < bounds.reps.min || draft.reps > bounds.reps.max) {
      list.push(`The per-set amount must be ${bounds.reps.min}–${bounds.reps.max} for this drill.`);
    }
    if (draft.restSeconds < bounds.restSeconds.min || draft.restSeconds > bounds.restSeconds.max) {
      list.push(`Rest must be ${bounds.restSeconds.min}–${bounds.restSeconds.max} s for this drill.`);
    }
    return list;
  }, [draft, bounds]);

  const minutes = errors.length ? null : blockEstimatedMinutes(draft);
  const set = (patch: Partial<BlockV3>) => setDraft(current => ({ ...current, ...patch }));

  return (
    <div className="admin-dialog-backdrop" role="dialog" aria-modal="true" aria-label={`Dose for ${block.name}`}>
      <div className="admin-dialog">
        <h3>{block.name}</h3>
        <p>
          {drill ? `Catalog range: ${bounds.sets.min}–${bounds.sets.max} sets × ${bounds.reps.min}–${bounds.reps.max} ${draft.repUnit}, rest ${bounds.restSeconds.min}–${bounds.restSeconds.max}s.` : "This drill is not in the catalog, so its ranges are unknown."}
        </p>

        <div className="admin-form">
          <div className="admin-field-row">
            <label className="admin-field">
              <span>Sets</span>
              <input type="number" min={bounds.sets.min} max={bounds.sets.max} value={draft.sets}
                     onChange={event => set({ sets: Number(event.target.value) })} />
            </label>
            <label className="admin-field">
              <span>{continuous ? `${draft.repUnit} per set` : `${draft.repUnit} per set`}</span>
              <input type="number" min={bounds.reps.min} max={bounds.reps.max} value={draft.reps}
                     onChange={event => set({ reps: Number(event.target.value) })} />
            </label>
            <label className="admin-field">
              <span>Rest (s)</span>
              <input type="number" min={bounds.restSeconds.min} max={bounds.restSeconds.max} value={draft.restSeconds}
                     onChange={event => set({ restSeconds: Number(event.target.value) })} />
            </label>
          </div>

          <div className="admin-field-row">
            <label className="admin-field">
              <span>Rest applies</span>
              <select
                value={continuous ? "sets" : draft.restScope}
                disabled={continuous}
                onChange={event => set({ restScope: event.target.value as "reps" | "sets" })}
              >
                <option value="sets">between sets</option>
                <option value="reps">between reps</option>
              </select>
            </label>
            <label className="admin-field">
              <span>Rest between sets (s, optional)</span>
              <input
                type="number" min={0}
                value={draft.restBetweenSetsSeconds ?? ""}
                onChange={event => set({
                  restBetweenSetsSeconds: event.target.value === "" ? null : Number(event.target.value),
                })}
              />
            </label>
            <label className="admin-field">
              <span>Familiarization reps</span>
              <input type="number" min={0} disabled={continuous} value={draft.familiarizationReps}
                     onChange={event => set({ familiarizationReps: Number(event.target.value) })} />
            </label>
            <label className="admin-field">
              <span>Block</span>
              <select value={draft.kind} onChange={event => set({ kind: event.target.value as BlockV3["kind"] })}>
                {BLOCK_KINDS.map(kind => <option key={kind} value={kind}>{kind}</option>)}
              </select>
            </label>
          </div>

          <label className="admin-field">
            <span>Why it is in this workout (the athlete reads this)</span>
            <input value={draft.whyIncluded} maxLength={MAX_WHY_CHARS}
                   onChange={event => set({ whyIncluded: event.target.value })} />
          </label>

          {continuous && (
            <p className="admin-note">
              A {draft.repUnit} value is the length of one continuous set, so rest sits between sets
              and familiarization reps do not apply.
            </p>
          )}

          <p className="admin-note">
            {minutes === null ? "—" : `This block is about ${minutes} minute${minutes === 1 ? "" : "s"}.`}
            {draft.perSide ? " Each side, so the whole block counts twice." : ""}
          </p>

          {errors.length > 0 && (
            <ul className="admin-issues">
              {errors.map((error, index) => <li key={index} className="admin-issue error">{error}</li>)}
            </ul>
          )}
        </div>

        <div className="admin-dialog-actions">
          <button className="quiet-button" type="button" onClick={onCancel}>Cancel</button>
          <button
            className="primary-cta"
            type="button"
            disabled={errors.length > 0}
            onClick={() => onSave({
              sets: draft.sets,
              reps: draft.reps,
              restSeconds: draft.restSeconds,
              restScope: continuous ? "sets" : draft.restScope,
              restBetweenSetsSeconds: draft.restBetweenSetsSeconds,
              familiarizationReps: continuous ? 0 : draft.familiarizationReps,
              kind: draft.kind,
              whyIncluded: draft.whyIncluded,
            })}
          >
            Set the dose
          </button>
        </div>
      </div>
    </div>
  );
}
