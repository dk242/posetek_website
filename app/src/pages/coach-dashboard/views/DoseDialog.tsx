// Dosage popup: prefilled with the standard values (catalog defaults on add,
// the current prescription on adjust) so a coach can just click through.

import { useEffect, useRef, useState } from "react";
import type { DoseDraft } from "../lib/planEdit";
import { DOSE_BOUNDS, doseErrors } from "../lib/planEdit";

interface DoseDialogProps {
  title: string;
  confirmLabel: string;
  initial: DoseDraft;
  /** The workbook's original dose prose, shown as guidance when adding. */
  doseText?: string;
  onCancel: () => void;
  onSave: (dose: DoseDraft) => void;
}

export default function DoseDialog({ title, confirmLabel, initial, doseText, onCancel, onSave }: DoseDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<DoseDraft>(initial);
  const errors = doseErrors(draft);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const set = (key: keyof DoseDraft) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setDraft(current => ({ ...current, [key]: Number(event.target.value) }));
  };

  return (
    <dialog className="portal-dialog dose-dialog" ref={dialogRef} onCancel={onCancel} onClose={onCancel}>
      <form
        className="dialog-card"
        method="dialog"
        onSubmit={event => {
          event.preventDefault();
          if (!errors.length) onSave(draft);
        }}
      >
        <header>
          <div>
            <p className="eyebrow">Dosage</p>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close" onClick={onCancel}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        {doseText ? <p className="dose-guidance">Standard: {doseText}</p> : null}

        <div className="dose-grid">
          <label>
            Sets
            <input type="number" min={DOSE_BOUNDS.sets.min} max={DOSE_BOUNDS.sets.max} step={1}
                   value={draft.sets} onChange={set("sets")} />
          </label>
          <label>
            {draft.repUnit === "reps" ? "Reps" : `Per set (${draft.repUnit})`}
            <input type="number" min={DOSE_BOUNDS.reps.min} step={1}
                   value={draft.reps} onChange={set("reps")} />
          </label>
          <label>
            Rest (sec)
            <input type="number" min={DOSE_BOUNDS.restSeconds.min} max={DOSE_BOUNDS.restSeconds.max} step={5}
                   value={draft.restSeconds} onChange={set("restSeconds")} />
          </label>
          <label>
            Days / week
            <input type="number" min={DOSE_BOUNDS.frequencyPerWeek.min} max={DOSE_BOUNDS.frequencyPerWeek.max} step={1}
                   value={draft.frequencyPerWeek} onChange={set("frequencyPerWeek")} />
          </label>
          <label>
            Minutes / session
            <input type="number" min={DOSE_BOUNDS.estimatedMinutes.min} max={DOSE_BOUNDS.estimatedMinutes.max} step={1}
                   value={draft.estimatedMinutes} onChange={set("estimatedMinutes")} />
          </label>
        </div>

        {errors.length > 0 && <p className="form-message" role="alert">{errors[0]}</p>}

        <footer className="dose-actions">
          <button className="quiet-button" type="button" onClick={onCancel}>Cancel</button>
          <button className="primary-cta" type="submit" disabled={errors.length > 0}>{confirmLabel}</button>
        </footer>
      </form>
    </dialog>
  );
}
