// Rendering a `schemaVersion: 3` training plan in the athlete portal.
//
// A v3 plan is weeks of PREDEFINED WORKOUTS (TRAINING_PROGRAM_V3_CONTRACT.md
// §4/§5), not the weeks of prescriptions the v1 hub renders. Without this
// branch a v3 plan would parse as an empty plan on this page — the legacy
// reader tolerates a missing `drills` array and shows nothing.
//
// Read-only on purpose: the athlete's chat-to-adjust flow and the guided
// workout player for v3 belong to the mobile app (agent 04). This page's job is
// to show the plan honestly rather than to pretend there isn't one.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMemo, useState } from "react";
import { blockDoseLine } from "../../../lib/contracts/drillV2";
import {
  currentWeekNumber,
  nextWorkout,
  orderedBlocks,
  orderedWeeks,
  orderedWorkouts,
  planHorizonWeeks,
  stateOf,
  weekDrillIds,
  weekWindow,
  weekWindowLabel,
  workoutStates,
} from "../../../lib/contracts/planV3";
import { domainLabel } from "../../../lib/contracts/types";
import { EmptyState } from "./shared";

export default function TrainingViewV3({ plan, logs }: { plan: any; logs: any[] }) {
  const weeks = useMemo(() => orderedWeeks(plan), [plan]);
  const thisWeek = useMemo(() => currentWeekNumber(plan), [plan]);
  const [selected, setSelected] = useState(thisWeek);
  const states = useMemo(
    () => workoutStates([String(plan?.planId ?? ""), String(plan?.id ?? "")], logs),
    [plan, logs],
  );
  const next = useMemo(() => nextWorkout(plan, logs), [plan, logs]);

  const week = weeks.find((entry: any) => Number(entry.weekNumber) === selected) ?? weeks[0] ?? null;
  if (!week) {
    return <EmptyState icon="assignment" title="No weeks in this plan" message="This plan has no weeks yet." />;
  }
  const window = weekWindow(plan, Number(week.weekNumber));
  const drills = weekDrillIds(week);

  return (
    <div className="training-grid">
      <nav className="plan-weeks" aria-label="Plan weeks">
        {weeks.map((entry: any) => {
          const number = Number(entry.weekNumber);
          const done = orderedWorkouts(entry)
            .filter(workout => stateOf(states, String(workout.workoutId)).kind === "finished").length;
          return (
            <button
              key={number}
              type="button"
              className={`week-ring${number === selected ? " active" : ""}${number === thisWeek ? " current" : ""}`}
              onClick={() => setSelected(number)}
            >
              <strong>W{number}</strong>
              <span>{done}/{orderedWorkouts(entry).length}</span>
            </button>
          );
        })}
      </nav>

      <section className="workout-card">
        <p className="eyebrow">
          Week {week.weekNumber} of {planHorizonWeeks(plan)}
          {window ? ` · ${weekWindowLabel(window)}` : ""}
        </p>
        <h3>{week.theme || `Week ${week.weekNumber}`}</h3>
        {week.focus && <p>{week.focus}</p>}
        {(week.targets || []).length > 0 && (
          <div className="training-targets">
            {(week.targets || []).map((target: any) => (
              <span key={target.domain} className="status-chip">
                {domainLabel(target.domain)} ×{target.exposures}
              </span>
            ))}
          </div>
        )}
      </section>

      {next && Number(week.weekNumber) === thisWeek && (
        <section className="workout-card">
          <p className="eyebrow">{next.reason === "resume" ? "Pick up where you left off" : "Next workout"}</p>
          <h3>{next.workout.title || next.workout.workoutId}</h3>
          <p>{next.workout.intent}</p>
          <p className="muted-copy">About {next.workout.estimatedMinutes} minutes.</p>
        </section>
      )}

      {drills.length > 0 && (
        <section className="workout-card">
          <p className="eyebrow">This week's drills</p>
          <div className="training-targets">
            {drills.map(drillId => <span key={drillId} className="status-chip">{drillId}</span>)}
          </div>
        </section>
      )}

      {orderedWorkouts(week).map(workout => {
        const state = stateOf(states, String(workout.workoutId));
        return (
          <article className="workout-card" key={workout.workoutId}>
            <header>
              <p className="eyebrow">
                {state.kind === "finished"
                  ? state.endReason === "completed" ? "Completed" : "Ended early"
                  : state.kind === "inProgress" ? "In progress"
                    : next?.workout?.workoutId === workout.workoutId ? "Next" : "Coming up"}
              </p>
              <h3>{workout.title || workout.workoutId}</h3>
            </header>
            <p>{workout.intent}</p>
            <p className="muted-copy">
              About {workout.estimatedMinutes} minutes · {(workout.blocks || []).length} drills
            </p>
            <div className="workout-blocks">
              {orderedBlocks(workout).map((block: any) => (
                <div className="workout-block" key={block.blockId}>
                  <span className="block-kind">{block.kind}</span>
                  <strong>{block.name}</strong>
                  <span className="muted-copy">
                    {domainLabel(String(block.domain || ""))} · {blockDoseLine(block)}
                  </span>
                  {block.whyIncluded && <span className="muted-copy">{block.whyIncluded}</span>}
                </div>
              ))}
            </div>
          </article>
        );
      })}

      <p className="muted-copy">
        Start and adjust these workouts in the PoseTek app.
      </p>
    </div>
  );
}
