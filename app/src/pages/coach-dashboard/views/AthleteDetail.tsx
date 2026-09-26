// One athlete: stats, workout history, and readable training plans.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import AthleteStats from "../../../components/athlete-stats/AthleteStats";
import { domainShortName, orderedWeeks, planHorizonWeeks, prescriptionDoseLine, toDate } from "../../athlete-portal/lib/training";
import type { AthleteSummary } from "../lib/logic";
import { hoursLine, planProgress } from "../lib/logic";
import type { PlanJobState } from "../lib/data";
import { isV3Plan } from "../../../lib/contracts/types";
import { blockDoseLine } from "../../../lib/contracts/drillV2";
import { orderedBlocks, orderedWorkouts, orderedWeeks as orderedV3Weeks } from "../../../lib/contracts/planV3";
import WorkoutHistory from './WorkoutHistory';

interface AthleteDetailProps {
  summary: AthleteSummary;
  job: PlanJobState | null;
  preview?: boolean;
  onBack: () => void;
  onCreatePlan: () => void;
}

const JOB_BUSY = ["submitting", "pending", "running"];

function fullName(athlete: any): string {
  return `${athlete?.firstName || ""} ${athlete?.lastName || ""}`.trim() || String(athlete?.name || "Athlete");
}

export default function AthleteDetail({ summary, job, preview, onBack, onCreatePlan }: AthleteDetailProps) {
  const [tab, setTab] = useState<"stats" | "program" | "history">("program");
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
              {summary.totals.workoutsCompleted} completed workouts · {hoursLine(summary.totals.timerSeconds)} timer time · {planProgress(plan)}
            </p>
          </div>
        </div>
        <button type="button" className="primary-cta" disabled={preview} onClick={onCreatePlan}>Prescribe / review plan</button>
        <div className="segmented-control coachdash-tabs" role="group" aria-label="Player progress">
          <button type="button" aria-pressed={tab === "program"} className={tab === "program" ? "active" : ""} onClick={() => setTab("program")}>
            Program
          </button>
          <button type="button" aria-pressed={tab === 'history'} className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Workout history</button>
          <button type="button" aria-pressed={tab === "stats"} className={tab === "stats" ? "active" : ""} onClick={() => setTab("stats")}>
            Stats
          </button>
        </div>
      </section>

      {tab === 'history' ? <WorkoutHistory logs={summary.logs} /> : tab === "stats" ? (
        <section className="coachdash-stats-wrap">
          <AthleteStats athlete={summary.athlete} athleteName={fullName(summary.athlete)} reps={summary.reps} provisionalEstimates={summary.provisionalEstimates} estimateReps={summary.allResultReps} />
        </section>
      ) : plan && isV3Plan(plan) ? (
        <V3ProgramView plan={plan} />
      ) : plan ? (
        <ProgramEditor key={plan.id} plan={plan} preview={preview} onCreatePlan={onCreatePlan} />
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

// MARK: - Historical schema 1/2 plans

function ProgramEditor({ plan, preview, onCreatePlan }: {
  plan: any;
  preview?: boolean;
  onCreatePlan: () => void;
}) {
  const weeks = orderedWeeks(plan);
  return <section className="program-editor">
    <header className="program-header"><div>
      <p className="eyebrow">Historical training plan · {String(plan.status || "active")}</p>
      <h2>{planHorizonWeeks(plan)}-week program</h2>
    </div></header>
    <p className="week-note">This older plan is available to review. To change prescriptions, create a new reviewed plan.</p>
    <button type="button" className="primary-cta small" disabled={preview} onClick={onCreatePlan}>Prescribe / review plan</button>
    {weeks.map((week: any) => <article className="week-card" key={String(week.weekNumber)}>
      <h3>Week {week.weekNumber}{week.theme ? ` — ${week.theme}` : ""}</h3>
      <ul className="drill-list">{(week.drills || []).map((drill: any, index: number) => <li className="drill-row" key={`${drill.drillId}-${index}`}>
        <div className="drill-copy"><strong>{drill.name}</strong><span className="drill-meta">{prescriptionDoseLine(drill)}</span></div>
      </li>)}</ul>
    </article>)}
  </section>;
}

// MARK: - Version 3 plans (read-only here)

// A v3 plan is weeks of PREDEFINED WORKOUTS, not weeks of prescriptions, and it
// carries per-workout revisions plus a required `planAdjustments` record on
// every edit (TRAINING_PROGRAM_V3_CONTRACT.md §5/§6). The coach dashboard's
// week editor cannot express that, and using it here would silently revert
// concurrent edits — so v3 plans are shown, not edited. Editing lives in the
// admin console's workout editor, which is the one authorized write path.
function V3ProgramView({ plan }: { plan: any }) {
  return (
    <section className="program-editor">
      <header className="program-header">
        <div>
          <p className="eyebrow">Active training program</p>
          <h2>{plan.horizonWeeks || (plan.weeks || []).length}-week program</h2>
          <p className="coachdash-sub">
            Started {String(plan.startDate || "—")} · {plan.sessionsPerWeek ?? "?"} sessions/week ·{" "}
            {plan.minutesPerSession ?? "?"} min each · plan revision {plan.planRevision ?? 1}
          </p>
          {toDate(plan.activatedAt) && <p className="coachdash-sub">Reviewed plan activated {toDate(plan.activatedAt)!.toLocaleDateString()}</p>}
        </div>
      </header>

      <article className="week-card">
        <p>
          This is the active program the player sees. Use Prescribe / review plan to prepare a new
          draft, compare it with this program and explicitly activate it when ready. Creating a draft
          keeps the current program in place. Ask PoseTek for an individual workout adjustment.
        </p>
      </article>

      {orderedV3Weeks(plan).map((week: any) => (
        <article className="week-card" key={week.weekNumber}>
          <header>
            <div>
              <h3>Week {week.weekNumber}{week.theme ? ` — ${week.theme}` : ""}</h3>
              {week.focus && <p className="coachdash-sub">{week.focus}</p>}
            </div>
          </header>
          {orderedWorkouts(week).map((workout: any) => (
            <div key={workout.workoutId}>
              <p className="week-note">
                <strong>{workout.title || workout.workoutId}</strong> · ~{workout.estimatedMinutes} min
                {workout.intent ? ` — ${workout.intent}` : ""}
              </p>
              <ul className="drill-list">
                {orderedBlocks(workout).map((block: any) => (
                  <li key={block.blockId} className="drill-row">
                    <div className="drill-copy">
                      <strong>{block.name}</strong>
                      <span className="drill-meta">
                        <span className="domain-chip">{domainShortName(String(block.domain || ""))}</span>
                        {blockDoseLine(block)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </article>
      ))}
    </section>
  );
}
