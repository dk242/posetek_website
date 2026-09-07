// Roster overview: summary tiles, the bulk plan-creation action, and the
// per-athlete table with a Performance / Training tab switch.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMemo, useState } from "react";
import { AXES } from "../../../components/athlete-stats/profile";
import { domainShortName } from "../../athlete-portal/lib/training";
import type { AthleteSummary } from "../lib/logic";
import { hoursLine, lastActiveLine, planProgress } from "../lib/logic";
import type { PlanJobState } from "../lib/data";

interface OverviewProps {
  orgLabel: string;
  summaries: AthleteSummary[];
  jobs: Record<string, PlanJobState>;
  onSelect: (playerId: string) => void;
  onCreateAll: () => void;
}

const JOB_BUSY = ["submitting", "pending", "running"];

function initials(athlete: any): string {
  const name = `${athlete?.firstName || ""} ${athlete?.lastName || ""}`.trim() || String(athlete?.name || "A");
  return name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}

function fullName(athlete: any): string {
  return `${athlete?.firstName || ""} ${athlete?.lastName || ""}`.trim() || String(athlete?.name || "Athlete");
}

// Score cell: number + a single-hue mini bar against the shared radar ceiling.
// Identity is carried by the column header and the printed value, never color.
function ScoreCell({ score }: { score: number | null }) {
  if (score === null) return <td className="score-cell empty">—</td>;
  const width = Math.min(Math.max(score / 130, 0), 1) * 100;
  return (
    <td className="score-cell">
      <span className="score-value">{Math.round(score)}</span>
      <span className="score-track" aria-hidden="true">
        <span className="score-fill" style={{ width: `${width}%` }} />
      </span>
    </td>
  );
}

function JobChip({ job }: { job: PlanJobState | null }) {
  if (!job) return null;
  if (JOB_BUSY.includes(job.status)) {
    return <span className="job-chip busy"><span className="spinner tiny" />Building plan…</span>;
  }
  if (job.status === "failed") {
    return <span className="job-chip failed" title={job.message}><span className="material-symbols-outlined">error</span>Failed</span>;
  }
  return <span className="job-chip done"><span className="material-symbols-outlined">check_circle</span>Plan ready</span>;
}

export default function Overview({ orgLabel, summaries, jobs, onSelect, onCreateAll }: OverviewProps) {
  const [tab, setTab] = useState<"performance" | "training">("performance");

  const totals = useMemo(() => {
    const activePlans = summaries.filter(summary => summary.plan).length;
    const sessions = summaries.reduce((sum, summary) => sum + summary.profile.totalSessions, 0);
    const seconds = summaries.reduce((sum, summary) => sum + summary.totals.trainingSeconds, 0);
    return { athletes: summaries.length, activePlans, sessions, seconds };
  }, [summaries]);

  const withoutPlan = summaries.filter(summary => {
    const job = jobs[summary.athlete.id];
    return !summary.plan && !(job && JOB_BUSY.includes(job.status));
  }).length;
  const anyBusy = summaries.some(summary => {
    const job = jobs[summary.athlete.id];
    return job && JOB_BUSY.includes(job.status);
  });

  return (
    <>
      <section className="coachdash-heading">
        <div>
          <p className="eyebrow">{orgLabel}</p>
          <h1>Coach dashboard</h1>
          <p className="coachdash-sub">
            {totals.athletes === 1 ? "1 athlete" : `${totals.athletes} athletes`} · {totals.activePlans} active {totals.activePlans === 1 ? "plan" : "plans"}
          </p>
        </div>
        <button
          className="primary-cta coachdash-create-all"
          type="button"
          disabled={withoutPlan === 0}
          onClick={onCreateAll}
          title={withoutPlan === 0 ? "Every athlete already has a plan or one being built" : undefined}
        >
          <span className="material-symbols-outlined">auto_awesome</span>
          {anyBusy
            ? "Building plans…"
            : withoutPlan > 0
              ? `Create workout plans for all athletes (${withoutPlan})`
              : "All athletes have plans"}
        </button>
      </section>

      <section className="coachdash-tiles">
        <article className="stat-tile">
          <p className="stat-label">Athletes</p>
          <p className="stat-value">{totals.athletes}</p>
        </article>
        <article className="stat-tile">
          <p className="stat-label">Active plans</p>
          <p className="stat-value">{totals.activePlans}<span className="stat-denominator">/{totals.athletes}</span></p>
        </article>
        <article className="stat-tile">
          <p className="stat-label">Recorded sessions</p>
          <p className="stat-value">{totals.sessions}</p>
        </article>
        <article className="stat-tile">
          <p className="stat-label">Workout time logged</p>
          <p className="stat-value">{hoursLine(totals.seconds)}</p>
        </article>
      </section>

      <div className="segmented-control coachdash-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "performance"} className={tab === "performance" ? "active" : ""} onClick={() => setTab("performance")}>
          Performance
        </button>
        <button type="button" role="tab" aria-selected={tab === "training"} className={tab === "training" ? "active" : ""} onClick={() => setTab("training")}>
          Training
        </button>
      </div>

      <section className="coachdash-table-card">
        {summaries.length === 0 ? (
          <div className="empty-card">
            <span className="material-symbols-outlined">group_add</span>
            <h3>No players yet</h3>
            <p>Add athletes from the roster to see them here.</p>
          </div>
        ) : tab === "performance" ? (
          <table className="coachdash-table">
            <thead>
              <tr>
                <th className="name-col">Athlete</th>
                <th>Overall</th>
                {AXES.map(axis => <th key={axis.key}>{axis.label}</th>)}
                <th>Sessions</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map(summary => (
                <tr key={summary.athlete.id} onClick={() => onSelect(summary.athlete.id)} tabIndex={0}
                    onKeyDown={event => { if (event.key === "Enter") onSelect(summary.athlete.id); }}>
                  <td className="name-col">
                    <span className="player-avatar">{initials(summary.athlete)}</span>
                    <span className="name-copy">
                      <strong>{fullName(summary.athlete)}</strong>
                      <span className="name-meta">{summary.profile.totalReps} reps recorded</span>
                    </span>
                  </td>
                  <ScoreCell score={summary.profile.overall} />
                  {summary.profile.axes.map(axis => <ScoreCell key={axis.key} score={axis.score} />)}
                  <td className="numeric">{summary.profile.totalSessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="coachdash-table">
            <thead>
              <tr>
                <th className="name-col">Athlete</th>
                <th>Program</th>
                <th>Focus</th>
                <th>Workout time</th>
                <th>Workouts</th>
                <th>Sessions</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map(summary => {
                const job = jobs[summary.athlete.id] || null;
                return (
                  <tr key={summary.athlete.id} onClick={() => onSelect(summary.athlete.id)} tabIndex={0}
                      onKeyDown={event => { if (event.key === "Enter") onSelect(summary.athlete.id); }}>
                    <td className="name-col">
                      <span className="player-avatar">{initials(summary.athlete)}</span>
                      <span className="name-copy">
                        <strong>{fullName(summary.athlete)}</strong>
                        <span className="name-meta">{summary.athlete.registered === false ? "Invite pending" : "Active"}</span>
                      </span>
                    </td>
                    <td>
                      {job && (JOB_BUSY.includes(job.status) || job.status === "failed")
                        ? <JobChip job={job} />
                        : <span className={`plan-chip ${summary.plan ? "on" : "off"}`}>{planProgress(summary.plan)}</span>}
                    </td>
                    <td>
                      <span className="focus-chips">
                        {summary.focus.length === 0 && <span className="focus-none">—</span>}
                        {summary.focus.map(area => (
                          <span key={area.domain} className={`focus-chip ${area.source}`} title={area.source === "suggested" ? "Suggested from weakest measured areas" : "From the training plan"}>
                            {domainShortName(area.domain)}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="numeric">{hoursLine(summary.totals.trainingSeconds)}</td>
                    <td className="numeric">{summary.totals.workoutsCompleted}<span className="dim">/{summary.totals.workoutsStarted}</span></td>
                    <td className="numeric">{summary.profile.totalSessions}</td>
                    <td className="numeric">{lastActiveLine(summary.totals.lastActiveMillis)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
