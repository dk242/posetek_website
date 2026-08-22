// One athlete: Stats (the shared AthleteStats block) and Program (the active
// training plan, viewable and editable week by week).

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMemo, useState } from "react";
import AthleteStats from "../../../components/athlete-stats/AthleteStats";
import {
  currentWeekNumber,
  domainName,
  domainShortName,
  orderedWeeks,
  planHorizonWeeks,
  prescriptionDoseLine,
  weekWindow,
  weekWindowLabel,
} from "../../athlete-portal/lib/training";
import type { AthleteSummary } from "../lib/logic";
import { hoursLine, planProgress } from "../lib/logic";
import type { PlanJobState } from "../lib/data";
import { savePlanWeeks } from "../lib/data";
import {
  MAX_DRILLS_PER_WEEK,
  addDrillToWeek,
  defaultDoseFor,
  doseDraftFrom,
  drillRowFromCatalog,
  isRetestWeek,
  removeDrillFromWeek,
  updateDrillDose,
  weekMinuteTotal,
  withEditedWeek,
} from "../lib/planEdit";
import type { DoseDraft } from "../lib/planEdit";
import DoseDialog from "./DoseDialog";
import DrillPicker from "./DrillPicker";

interface AthleteDetailProps {
  summary: AthleteSummary;
  job: PlanJobState | null;
  preview?: boolean;
  onBack: () => void;
  onCreatePlan: () => void;
  onPlanChanged: () => Promise<unknown>;
  /** Preview mode only: apply an edited weeks array in memory. */
  onPreviewEdit?: (planId: string, weeks: any[]) => void;
}

const JOB_BUSY = ["submitting", "pending", "running"];

function fullName(athlete: any): string {
  return `${athlete?.firstName || ""} ${athlete?.lastName || ""}`.trim() || String(athlete?.name || "Athlete");
}

export default function AthleteDetail({ summary, job, preview, onBack, onCreatePlan, onPlanChanged, onPreviewEdit }: AthleteDetailProps) {
  const [tab, setTab] = useState<"stats" | "program">("program");
  const plan = summary.plan;

  return (
    <>
      <section className="coachdash-heading detail">
        <div className="detail-title">
          <button className="icon-button" type="button" aria-label="Back to dashboard" onClick={onBack}>
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div>
            <p className="eyebrow">Athlete</p>
            <h1>{fullName(summary.athlete)}</h1>
            <p className="coachdash-sub">
              {summary.profile.totalSessions} sessions · {hoursLine(summary.totals.trainingSeconds)} of logged workouts · {planProgress(plan)}
            </p>
          </div>
        </div>
        <div className="segmented-control coachdash-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "program"} className={tab === "program" ? "active" : ""} onClick={() => setTab("program")}>
            Program
          </button>
          <button type="button" role="tab" aria-selected={tab === "stats"} className={tab === "stats" ? "active" : ""} onClick={() => setTab("stats")}>
            Stats
          </button>
        </div>
      </section>

      {tab === "stats" ? (
        <section className="coachdash-stats-wrap">
          <AthleteStats athlete={summary.athlete} athleteName={fullName(summary.athlete)} reps={summary.reps} />
        </section>
      ) : plan ? (
        <ProgramEditor key={plan.id} summary={summary} plan={plan} preview={preview} onPlanChanged={onPlanChanged} onPreviewEdit={onPreviewEdit} />
      ) : (
        <NoProgramCard job={job} onCreatePlan={onCreatePlan} />
      )}
    </>
  );
}

function NoProgramCard({ job, onCreatePlan }: { job: PlanJobState | null; onCreatePlan: () => void }) {
  const busy = job && JOB_BUSY.includes(job.status);
  return (
    <section className="coachdash-empty-program">
      <div className="empty-card">
        <span className="material-symbols-outlined">assignment</span>
        <h3>No training plan yet</h3>
        {busy ? (
          <>
            <p>The training engine is building this athlete's plan. This takes a couple of minutes — it will appear here when it lands.</p>
            <p className="job-chip busy"><span className="spinner tiny" />{job?.status === "running" ? "Building the plan…" : "Waiting for the training engine…"}</p>
          </>
        ) : (
          <>
            <p>Create a personalized multi-week program from this athlete's measured stats.</p>
            {job?.status === "failed" && <p className="form-message">{job.message}</p>}
            <button className="primary-cta" type="button" onClick={onCreatePlan}>
              <span className="material-symbols-outlined">auto_awesome</span>Create workout plan
            </button>
          </>
        )}
      </div>
    </section>
  );
}

// MARK: - Program editor

type DoseTarget =
  | { kind: "edit"; drill: any }
  | { kind: "add"; catalogDrill: any };

function ProgramEditor({ summary, plan, preview, onPlanChanged, onPreviewEdit }: {
  summary: AthleteSummary;
  plan: any;
  preview?: boolean;
  onPlanChanged: () => Promise<unknown>;
  onPreviewEdit?: (planId: string, weeks: any[]) => void;
}) {
  const weeks = useMemo(() => orderedWeeks(plan), [plan]);
  const horizon = planHorizonWeeks(plan);
  const nowWeek = currentWeekNumber(plan);
  const [selectedWeek, setSelectedWeek] = useState(nowWeek);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [doseTarget, setDoseTarget] = useState<DoseTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const week = weeks.find((entry: any) => Number(entry?.weekNumber) === selectedWeek) || null;
  const retest = isRetestWeek(plan, selectedWeek);
  const weekDates = weekWindow(plan, selectedWeek);
  const editable = !retest && week;

  async function commitWeek(editedWeek: any) {
    const weeks = withEditedWeek(plan, editedWeek);
    if (preview) {
      onPreviewEdit?.(plan.id, weeks);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await savePlanWeeks(summary.athlete.id, plan.id, weeks);
      await onPlanChanged();
    } catch (writeError: any) {
      setError(writeError?.message || "The change could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function handleDoseSave(dose: DoseDraft) {
    if (!doseTarget || !week) return;
    try {
      const edited = doseTarget.kind === "edit"
        ? updateDrillDose(week, doseTarget.drill.drillId, dose)
        : addDrillToWeek(week, drillRowFromCatalog(doseTarget.catalogDrill, dose));
      setDoseTarget(null);
      setPickerOpen(false);
      void commitWeek(edited);
    } catch (editError: any) {
      setError(editError?.message || "That change is not allowed.");
      setDoseTarget(null);
    }
  }

  function handleRemove(drill: any) {
    if (!week) return;
    if (!window.confirm(`Remove “${drill.name}” from week ${selectedWeek}?`)) return;
    void commitWeek(removeDrillFromWeek(week, drill.drillId));
  }

  const focusAreas = plan.focusAreas || [];
  const intake = plan.intake || {};

  return (
    <section className="program-editor">
      <header className="program-header">
        <div>
          <p className="eyebrow">Training plan · {String(plan.status || "active")}</p>
          <h2>{horizon}-week program</h2>
          <p className="coachdash-sub">
            Started {String(plan.startDate || "—")} · {intake.daysPerWeek || "?"} days/week · level {String(intake.level || "—")}
          </p>
        </div>
        {focusAreas.length > 0 && (
          <div className="focus-chips large">
            {focusAreas.map((area: any) => (
              <span key={area.domain} className="focus-chip plan" title={area.rationale || ""}>
                {domainName(String(area.domain || ""))}
              </span>
            ))}
          </div>
        )}
      </header>

      <nav className="week-strip" aria-label="Plan weeks">
        {Array.from({ length: horizon }, (_, index) => index + 1).map(weekNumber => {
          const has = weeks.some((entry: any) => Number(entry?.weekNumber) === weekNumber);
          return (
            <button
              key={weekNumber}
              type="button"
              className={[
                "week-pill",
                weekNumber === selectedWeek ? "active" : "",
                weekNumber === nowWeek ? "current" : "",
                isRetestWeek(plan, weekNumber) ? "retest" : "",
              ].join(" ").trim()}
              disabled={!has && !isRetestWeek(plan, weekNumber)}
              onClick={() => setSelectedWeek(weekNumber)}
            >
              <span className="week-pill-label">W{weekNumber}</span>
              {weekNumber === nowWeek && <span className="week-pill-now">now</span>}
              {isRetestWeek(plan, weekNumber) && <span className="week-pill-now">retest</span>}
            </button>
          );
        })}
      </nav>

      {error && <p className="form-message program-error" role="alert">{error}</p>}

      {retest ? (
        <article className="week-card retest">
          <header>
            <h3>Week {selectedWeek} — Retest week</h3>
            {weekDates && <p className="coachdash-sub">{weekWindowLabel(weekDates)}</p>}
          </header>
          <p>
            The final week re-measures all six drills — sprint, vertical jump, broad jump, change of
            direction, dribbling, and shooting — so progress is measured, not guessed. It has no
            prescribed drills and is not editable.
          </p>
        </article>
      ) : !week ? (
        <article className="week-card">
          <p>This week has no entry in the plan document.</p>
        </article>
      ) : (
        <article className="week-card">
          <header>
            <div>
              <h3>Week {selectedWeek}{week.theme ? ` — ${week.theme}` : ""}</h3>
              {weekDates && <p className="coachdash-sub">{weekWindowLabel(weekDates)} · ~{weekMinuteTotal(week)} min planned</p>}
            </div>
            <button
              className="primary-cta small"
              type="button"
              disabled={saving || (week.drills || []).length >= MAX_DRILLS_PER_WEEK}
              onClick={() => setPickerOpen(true)}
            >
              <span className="material-symbols-outlined">add</span>Add drill
            </button>
          </header>

          {week.focus && <p className="week-note"><strong>Focus:</strong> {week.focus}</p>}
          {week.progressionNote && <p className="week-note"><strong>Progression:</strong> {week.progressionNote}</p>}
          {week.intensityNote && <p className="week-note dim">{week.intensityNote}</p>}

          {(week.allocations || []).length > 0 && (
            <div className="allocation-row" aria-label="Minutes per training area">
              {(week.allocations || []).map((allocation: any) => (
                <div key={allocation.domain} className="allocation">
                  <span className="allocation-label">{domainShortName(String(allocation.domain || ""))}</span>
                  <span className="allocation-track" aria-hidden="true">
                    <span
                      className="allocation-fill"
                      style={{ width: `${Math.min((Number(allocation.minutes) || 0) / 90, 1) * 100}%` }}
                    />
                  </span>
                  <span className="allocation-minutes">{Number(allocation.minutes) || 0}m</span>
                </div>
              ))}
            </div>
          )}

          <ul className="drill-list">
            {(week.drills || []).map((drill: any) => (
              <li key={drill.drillId} className="drill-row">
                <div className="drill-copy">
                  <strong>{drill.name}</strong>
                  <span className="drill-meta">
                    <span className="domain-chip">{domainShortName(String(drill.domain || ""))}</span>
                    {prescriptionDoseLine(drill)}
                    {drill.estimatedMinutes ? ` · ~${drill.estimatedMinutes} min` : ""}
                  </span>
                  {drill.note && <span className="drill-note">{drill.note}</span>}
                </div>
                <div className="drill-actions">
                  <button className="icon-button" type="button" aria-label={`Adjust ${drill.name}`} disabled={saving}
                          onClick={() => setDoseTarget({ kind: "edit", drill })}>
                    <span className="material-symbols-outlined">tune</span>
                  </button>
                  <button className="icon-button danger" type="button" aria-label={`Remove ${drill.name}`} disabled={saving}
                          onClick={() => handleRemove(drill)}>
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                </div>
              </li>
            ))}
            {(week.drills || []).length === 0 && (
              <li className="drill-row empty">No drills in this week yet — add the first one.</li>
            )}
          </ul>
          {saving && <p className="coachdash-sub saving-note"><span className="spinner tiny" /> Saving…</p>}
        </article>
      )}

      {pickerOpen && editable && (
        <DrillPicker
          existingDrillIds={(week?.drills || []).map((drill: any) => String(drill.drillId))}
          preview={preview}
          onPick={catalogDrill => setDoseTarget({ kind: "add", catalogDrill })}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {doseTarget && (
        <DoseDialog
          title={doseTarget.kind === "edit" ? `Adjust ${doseTarget.drill.name}` : `Add ${doseTarget.catalogDrill.name}`}
          confirmLabel={doseTarget.kind === "edit" ? "Save dosage" : "Add to week"}
          initial={doseTarget.kind === "edit" ? doseDraftFrom(doseTarget.drill) : defaultDoseFor(doseTarget.catalogDrill)}
          doseText={doseTarget.kind === "add" ? String(doseTarget.catalogDrill?.dose?.doseText || "") : ""}
          onCancel={() => setDoseTarget(null)}
          onSave={handleDoseSave}
        />
      )}
    </section>
  );
}
