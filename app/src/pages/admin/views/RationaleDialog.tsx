// "The admin also gets prompted 'why did you make the adjustments that you
// made?' and whatever the coach writes in gets saved."
//
// Each edit records feedback or an explicit no-feedback declaration, together
// with exactly what is about to change and who it changes it for.

import { useMemo, useState } from "react";
import { domainLabel } from "../../../lib/contracts/types";
import type { AdjustmentDiff } from "../../../lib/contracts/types";
import type { Issue } from "../lib/editor";
import { NO_FEEDBACK_RATIONALE, RATIONALE_MAX, workoutRationale } from "../lib/rationale";

interface Props {
  playerName: string;
  workoutTitle: string;
  diff: AdjustmentDiff;
  warnings: Issue[];
  minutesBefore: number;
  minutesAfter: number;
  /** True when this workout has an open log — the athlete is mid-session. */
  inProgress: boolean;
  isNext: boolean;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (rationale: string, noFeedback: boolean) => void;
}

export default function RationaleDialog({
  playerName, workoutTitle, diff, warnings, minutesBefore, minutesAfter,
  inProgress, isNext, saving, error, onCancel, onSave,
}: Props) {
  const [rationale, setRationale] = useState("");
  const [noFeedback, setNoFeedback] = useState(false);
  const trimmed = rationale.trim();
  const valid = workoutRationale(rationale, noFeedback) !== null;

  const summary = useMemo(() => {
    const parts: string[] = [];
    if (diff.added.length) parts.push(`${diff.added.length} drill${diff.added.length === 1 ? "" : "s"} added`);
    if (diff.removed.length) parts.push(`${diff.removed.length} removed`);
    if (diff.doseChanged.length) parts.push(`${diff.doseChanged.length} dose${diff.doseChanged.length === 1 ? "" : "s"} changed`);
    if (diff.reordered) parts.push("reordered");
    return parts.length ? parts.join(", ") : "copy or intent only";
  }, [diff]);

  return (
    <div className="admin-dialog-backdrop" role="dialog" aria-modal="true" aria-label="Why did you make these adjustments?">
      <div className="admin-dialog">
        <h3>Why did you make the adjustments that you made?</h3>
        <p>
          Feedback is saved with the edit to help improve future workouts. Share what you
          were trying to fix, or select that you have no feedback to provide.
        </p>

        <section className="admin-card">
          <h3>{workoutTitle}</h3>
          <p className="admin-note">{summary} · {minutesBefore} → {minutesAfter} min</p>
          {diff.added.length > 0 && (
            <p className="admin-note">
              Added: {diff.added.map(entry => `${entry.drillId} (${domainLabel(entry.domain)})`).join(", ")}
            </p>
          )}
          {diff.removed.length > 0 && (
            <p className="admin-note">
              Removed: {diff.removed.map(entry => `${entry.drillId} (${domainLabel(entry.domain)})`).join(", ")}
            </p>
          )}
          {Object.keys(diff.domainMinutesDelta).length > 0 && (
            <p className="admin-note">
              Minutes by area:{" "}
              {Object.entries(diff.domainMinutesDelta)
                .map(([domain, delta]) => `${domainLabel(domain)} ${delta > 0 ? "+" : ""}${delta}`)
                .join(" · ")}
            </p>
          )}
        </section>

        <div className={`admin-banner ${inProgress ? "warn" : "good"}`}>
          <span className="material-symbols-outlined">{inProgress ? "pending_actions" : "smartphone"}</span>
          <p>
            {inProgress
              ? `${playerName} has this workout open right now. Their session keeps the version they started — this edit applies from their next start, and nothing they have already done changes.`
              : isNext
                ? `This changes the next workout for ${playerName}. It shows in their app as soon as you save.`
                : `This changes an upcoming workout for ${playerName}. It shows in their app as soon as you save.`}
          </p>
        </div>

        {warnings.length > 0 && (
          <>
            <p className="admin-note">
              You are saving through {warnings.length} warning{warnings.length === 1 ? "" : "s"}. They
              are recorded with the edit:
            </p>
            <ul className="admin-issues">
              {warnings.map((warning, index) => (
                <li key={index} className="admin-issue warning">{warning.message}</li>
              ))}
            </ul>
          </>
        )}

        <label className="admin-field" style={{ marginTop: 14 }}>
          <span>Your feedback</span>
          <textarea
            value={rationale}
            maxLength={RATIONALE_MAX}
            disabled={noFeedback || saving}
            autoFocus
            placeholder="Swapped the second dribbling block for a change-of-direction drill — he is well ahead on ball control and 22nd percentile on agility, and the session was running four minutes long."
            onChange={event => setRationale(event.target.value)}
          />
        </label>
        <p className="admin-counter">{trimmed.length} / {RATIONALE_MAX}</p>
        <div className="admin-checks">
          <label>
            <input
              type="checkbox"
              checked={noFeedback}
              disabled={saving}
              onChange={event => setNoFeedback(event.target.checked)}
            />
            {NO_FEEDBACK_RATIONALE}
          </label>
        </div>
        {noFeedback && <p className="admin-note">Your no-feedback choice will be saved with this edit.</p>}

        {error && <p className="form-message" role="alert">{error}</p>}

        <div className="admin-dialog-actions">
          <button className="quiet-button" type="button" disabled={saving} onClick={onCancel}>Keep editing</button>
          <button className="primary-cta" type="button" disabled={!valid || saving} onClick={() => onSave(trimmed, noFeedback)}>
            {saving ? "Saving…" : "Save the workout"}
          </button>
        </div>
        {!valid && (
          <p className="admin-note">
            Write at least 3 characters of feedback, or select that you have none.
          </p>
        )}
      </div>
    </div>
  );
}
