// Port of athlete-mobile-pages.js renderTraining / renderTrainingPlan /
// workoutMarkup / bindWorkoutActions / showWorkoutBuilder / renderTrainingIntake.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import firebase, { db } from "../../../lib/firebase";
import { buildProfile } from "../../../components/athlete-stats/AthleteStats";
import { submitLlmJob, waitForJob } from "../lib/loaders";
import { currentWeek, dateText, demoPlan, number, statsSnapshot, timestamp } from "../lib/mobile";
import { EmptyState, LockedPage, PageHero, PortalLoading } from "./shared";
import type { PortalContext } from "./shared";

const domainText = (value: any, fallback: string) => String(value || fallback).replace(/([A-Z])/g, " $1");

type TrainingData =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "intake" }
  | { phase: "plan"; plan: any; workouts: any[]; logs: any[] };

export default function TrainingView({ ctx }: { ctx: PortalContext }) {
  if (ctx.access === "shared") {
    return <LockedPage title="Training" copy="Training plans and workout history are private athlete records." />;
  }
  return <TrainingContent ctx={ctx} />;
}

function TrainingContent({ ctx }: { ctx: PortalContext }) {
  const [data, setData] = useState<TrainingData>({ phase: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const jobUnsubsRef = useRef<(() => void)[]>([]);
  const registerJobUnsub = (unsubscribe: () => void) => jobUnsubsRef.current.push(unsubscribe);
  const reload = () => {
    setData({ phase: "loading" });
    setReloadKey(key => key + 1);
  };

  useEffect(() => () => {
    jobUnsubsRef.current.splice(0).forEach(unsubscribe => {
      try { unsubscribe(); } catch { /* already detached */ }
    });
  }, []);

  useEffect(() => {
    if (ctx.access === "preview") {
      setData({ phase: "plan", plan: demoPlan(), workouts: [], logs: [] });
      return;
    }
    let cancelled = false;
    Promise.all([
      db.collection("players").doc(ctx.playerId!).collection("trainingPlans").get(),
      db.collection("players").doc(ctx.playerId!).collection("plannedWorkouts").get(),
      db.collection("players").doc(ctx.playerId!).collection("workoutLogs").get(),
    ]).then(([plansSnap, workoutsSnap, logsSnap]) => {
      if (cancelled) return;
      const plans = plansSnap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a: any, b: any) => (timestamp(b.generatedAt)?.valueOf() || 0) - (timestamp(a.generatedAt)?.valueOf() || 0));
      const active = plans.find((plan: any) => plan.status === "active") || null;
      const workouts = workoutsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const logs = logsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (active) setData({ phase: "plan", plan: active, workouts, logs });
      else setData({ phase: "intake" });
    }).catch(error => {
      console.error("[training]", error);
      if (!cancelled) setData({ phase: "error", message: error.message || "The training records could not be loaded." });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  return (
    <section className="mobile-page training-page">
      <PageHero eyebrow="Personalized development" title="Training" description="Your active plan, this week's work, and completed sessions." icon="fitness_center" />
      <div id="trainingContent">
        {data.phase === "loading" ? (
          <PortalLoading message="Loading training plan…" />
        ) : data.phase === "error" ? (
          <EmptyState icon="cloud_off" title="Training is unavailable" message={data.message} />
        ) : data.phase === "intake" ? (
          <TrainingIntake ctx={ctx} onReload={reload} registerJobUnsub={registerJobUnsub} />
        ) : (
          <TrainingPlan ctx={ctx} plan={data.plan} workouts={data.workouts} logs={data.logs} onReload={reload} registerJobUnsub={registerJobUnsub} />
        )}
      </div>
    </section>
  );
}

interface PlanProps {
  ctx: PortalContext;
  plan: any;
  workouts: any[];
  logs: any[];
  onReload: () => void;
  registerJobUnsub: (unsubscribe: () => void) => void;
}

function TrainingPlan({ ctx, plan, workouts, logs, onReload, registerJobUnsub }: PlanProps) {
  const [builderOpen, setBuilderOpen] = useState(false);
  const weekNumber = currentWeek(plan);
  const weeks = [...(plan.weeks || [])].sort((a: any, b: any) => (number(a.weekNumber) ?? 0) - (number(b.weekNumber) ?? 0));
  const week = weeks.find((item: any) => number(item.weekNumber) === weekNumber) || weeks[0] || {};
  const weekWorkouts = workouts.filter(item => item.planId === plan.id && number(item.weekNumber) === weekNumber);
  const logMap = new Map(logs.map(log => [log.id, log]));

  const logRef = (workoutId: string) => db.collection("players").doc(ctx.playerId!).collection("workoutLogs").doc(workoutId);

  const beginWorkout = async (workout: any) => {
    await logRef(workout.id).set({
      schemaVersion: 1,
      planId: workout.planId,
      weekNumber: number(workout.weekNumber) || 1,
      startedAt: firebase.firestore.FieldValue.serverTimestamp(),
      blocks: [],
    });
    ctx.notify("Workout started");
    onReload();
  };

  const endWorkout = async (workout: any) => {
    await logRef(workout.id).update({
      endedAt: firebase.firestore.FieldValue.serverTimestamp(),
      endReason: "completed",
    });
    ctx.notify("Workout completed");
    onReload();
  };

  const completeBlock = async (workout: any, blockId: string) => {
    const log = logMap.get(workout.id) || {};
    const block = (workout.blocks || []).find((item: any) => item.blockId === blockId);
    const blocks = [
      ...(log.blocks || []).filter((item: any) => item.blockId !== block.blockId),
      { blockId: block.blockId, drillId: block.drillId || "", domain: block.domain || "", targetSets: number(block.sets) || 0, setsCompleted: number(block.sets) || 0, status: "done" },
    ];
    await logRef(workout.id).update({ blocks });
    ctx.notify(`${block.name || "Block"} completed`);
    onReload();
  };

  return (
    <>
      <section className="training-summary portal-card">
        <div>
          <p className="eyebrow">Week {weekNumber} of {number(plan.horizonWeeks) || weeks.length}</p>
          <h2>{week.theme || "Your training week"}</h2>
          <p>{week.focus || plan.assessment?.summary || "Build consistency and retest your progress."}</p>
        </div>
        <div className="week-ring"><strong>{weekNumber}</strong><small>week</small></div>
      </section>
      <div className="training-grid">
        <section className="portal-card">
          <div className="card-heading">
            <div>
              <h2>This week</h2>
              <p>{week.progressionNote || "Complete the planned exposures at a sustainable intensity."}</p>
            </div>
            <button className="primary-mini" id="buildWorkout" type="button" onClick={() => setBuilderOpen(true)}>Create workout</button>
          </div>
          <div className="training-targets">
            {(week.targets || []).length ? (week.targets || []).map((target: any, index: number) => (
              <article key={index}>
                <span>{domainText(target.domain, "Training")}</span>
                <strong>{number(target.exposures) || 0}×</strong>
                <small>{target.note || "weekly exposure"}</small>
              </article>
            )) : <EmptyState icon="target" title="No targets listed" message="Open the full plan below for this week's drills." />}
          </div>
        </section>
        <section className="portal-card">
          <div className="card-heading"><div><h2>Focus areas</h2><p>Why this plan was built</p></div></div>
          <div className="focus-list">
            {(plan.focusAreas || []).length ? (plan.focusAreas || []).map((item: any, index: number) => (
              <article key={index}>
                <span className="material-symbols-outlined">center_focus_strong</span>
                <div>
                  <strong>{domainText(item.domain, "Development")}</strong>
                  <p>{item.rationale || ""}</p>
                </div>
              </article>
            )) : <p className="muted-copy">{plan.assessment?.summary || "Personalized from your current stats."}</p>}
          </div>
        </section>
      </div>
      <section className="portal-card planned-workouts">
        <div className="card-heading"><div><h2>Workouts</h2><p>Generated from the current plan</p></div></div>
        <div id="workoutList">
          {builderOpen ? (
            <WorkoutBuilder ctx={ctx} plan={plan} onReload={onReload} registerJobUnsub={registerJobUnsub} />
          ) : weekWorkouts.length ? (
            weekWorkouts.map(workout => (
              <WorkoutCard
                key={workout.id}
                workout={workout}
                log={logMap.get(workout.id)}
                onBegin={() => beginWorkout(workout)}
                onEnd={() => endWorkout(workout)}
                onCompleteBlock={blockId => completeBlock(workout, blockId)}
              />
            ))
          ) : (
            <EmptyState icon="exercise" title="No workout built yet" message="Create a workout based on your available time and energy." />
          )}
        </div>
      </section>
      <section className="portal-card full-plan">
        <div className="card-heading">
          <div>
            <h2>Full {number(plan.horizonWeeks) || weeks.length}-week plan</h2>
            <p>{plan.intake?.daysPerWeek ? `${plan.intake.daysPerWeek} days per week · ${plan.intake.minutesPerSession || 60} minutes` : "Week-by-week progression"}</p>
          </div>
        </div>
        <div className="plan-weeks">
          {weeks.map((item: any) => (
            <details key={String(number(item.weekNumber))} open={number(item.weekNumber) === weekNumber || undefined}>
              <summary>
                <span>Week {number(item.weekNumber)}</span>
                <strong>{item.theme || "Training week"}</strong>
                <span className="material-symbols-outlined">expand_more</span>
              </summary>
              <div>
                <p>{item.focus || item.progressionNote || ""}</p>
                <div className="plan-drills">
                  {(item.drills || []).length ? (item.drills || []).map((drill: any, index: number) => (
                    <article key={index}>
                      <div>
                        <strong>{drill.name || drill.drillId || "Drill"}</strong>
                        <small>{String(drill.domain || "").replace(/([A-Z])/g, " $1")}</small>
                      </div>
                      <span>{number(drill.sets) || 0} × {number(drill.reps) || 0} {drill.repUnit || "reps"}</span>
                    </article>
                  )) : <p className="muted-copy">Retest week · complete the measured drills in Drill Results.</p>}
                </div>
              </div>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}

interface WorkoutCardProps {
  workout: any;
  log: any;
  onBegin: () => void;
  onEnd: () => void;
  onCompleteBlock: (blockId: string) => void;
}

function WorkoutCard({ workout, log, onBegin, onEnd, onCompleteBlock }: WorkoutCardProps) {
  const ended = Boolean(log?.endedAt);
  const started = Boolean(log?.startedAt);
  const blocks = [...(workout.blocks || [])].sort((a: any, b: any) => (number(a.order) ?? 0) - (number(b.order) ?? 0));
  return (
    <article className="workout-card" data-workout={workout.id}>
      <header>
        <div>
          <span>{number(workout.estimatedMinutes) || number(workout.params?.timeAvailableMinutes) || 30} min</span>
          <strong>{workout.intro || "Personalized workout"}</strong>
        </div>
        <span className={`workout-status ${ended ? "done" : started ? "active" : ""}`}>{ended ? "Completed" : started ? "In progress" : "Ready"}</span>
      </header>
      <div className="workout-blocks">
        {blocks.map((block: any) => {
          const blockLog = (log?.blocks || []).find((item: any) => item.blockId === block.blockId);
          return (
            <article key={block.blockId} className={`workout-block ${blockLog?.status === "done" ? "done" : ""}`}>
              <span className="block-kind">{block.kind || "main"}</span>
              <div>
                <strong>{block.name || block.drillId || "Training block"}</strong>
                <small>{number(block.sets) || 0} sets · {number(block.reps) || 0} {block.repUnit || "reps"} · {number(block.restSeconds) || 0}s rest</small>
              </div>
              {started && !ended ? (
                <button
                  type="button"
                  data-complete-block={block.blockId}
                  aria-label={`Mark ${block.name || "block"} complete`}
                  onClick={() => onCompleteBlock(block.blockId)}
                >
                  <span className="material-symbols-outlined">{blockLog?.status === "done" ? "check_circle" : "radio_button_unchecked"}</span>
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
      <footer>
        {!started ? (
          <button className="primary-mini" type="button" data-begin-workout onClick={onBegin}>Begin workout</button>
        ) : !ended ? (
          <button className="primary-mini" type="button" data-end-workout onClick={onEnd}>Finish workout</button>
        ) : (
          <span>Finished {dateText(log.endedAt)}</span>
        )}
      </footer>
    </article>
  );
}

interface BuilderProps {
  ctx: PortalContext;
  plan: any;
  onReload: () => void;
  registerJobUnsub: (unsubscribe: () => void) => void;
}

function WorkoutBuilder({ ctx, plan, onReload, registerJobUnsub }: BuilderProps) {
  const [minutes, setMinutes] = useState("30");
  const [energy, setEnergy] = useState("normal");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setStatus("Building a workout from your plan…");
    setBusy(true);
    try {
      const job = await submitLlmJob(ctx.playerId!, "build_workout", {
        planId: plan.id,
        timeAvailableMinutes: Number(minutes),
        energy,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      await waitForJob(job.id, setStatus, registerJobUnsub);
      ctx.notify("Workout ready");
      onReload();
    } catch (error: any) {
      setStatus(error.message || "Could not build the workout.");
      setBusy(false);
    }
  };

  return (
    <form className="workout-builder" id="workoutBuilder" onSubmit={onSubmit}>
      <h3>Build today's workout</h3>
      <label>
        Time available
        <select name="minutes" value={minutes} onChange={event => setMinutes(event.target.value)}>
          <option>15</option>
          <option>30</option>
          <option>45</option>
          <option>60</option>
          <option>75</option>
        </select>
      </label>
      <label>
        Energy
        <select name="energy" value={energy} onChange={event => setEnergy(event.target.value)}>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </select>
      </label>
      <button className="primary-cta" type="submit" disabled={busy}>Build workout</button>
      <p id="workoutBuilderStatus">{status}</p>
    </form>
  );
}

const GOAL_OPTIONS: [string, string][] = [
  ["speedAgility", "Speed & agility"],
  ["dribbling", "Dribbling"],
  ["passing", "Passing"],
  ["firstTouch", "First touch"],
  ["shooting", "Shooting"],
  ["strengthPower", "Strength & power"],
];

interface IntakeProps {
  ctx: PortalContext;
  onReload: () => void;
  registerJobUnsub: (unsubscribe: () => void) => void;
}

function TrainingIntake({ ctx, onReload, registerJobUnsub }: IntakeProps) {
  const [goals, setGoals] = useState<string[]>([]);
  const [days, setDays] = useState("3");
  const [setting, setSetting] = useState("solo");
  const [weeks, setWeeks] = useState("6");
  const [freeText, setFreeText] = useState("");
  const [pain, setPain] = useState(false);
  const [status, setStatus] = useState("");

  const toggleGoal = (value: string, checked: boolean) => {
    if (!checked) {
      setGoals(prev => prev.filter(goal => goal !== value));
      return;
    }
    if (goals.length >= 2) {
      ctx.notify("Choose up to two goals");
      return;
    }
    setGoals(prev => [...prev, value]);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    // Legacy read the checked boxes in DOM order.
    const chosen = GOAL_OPTIONS.filter(([value]) => goals.includes(value)).map(([value]) => value);
    if (!chosen.length) {
      setStatus("Choose at least one training goal.");
      return;
    }
    if (pain) {
      setStatus("Pause training and check with a qualified medical professional before generating a plan.");
      return;
    }
    setStatus("Reviewing results and building your plan week by week…");
    try {
      const profile = buildProfile(ctx.allStatsReps());
      const intake = {
        goals: chosen,
        freeTextGoals: freeText.trim() || null,
        daysPerWeek: Number(days),
        minutesPerSession: 60,
        setting,
        equipment: ["ball", "cones", "markers", "goal", "timer", "wall"],
        // Legacy: `profile.overall >= 100` — null compares false on both branches.
        level: (profile.overall ?? 0) >= 100 ? "performance" : (profile.overall ?? 0) >= 75 ? "club" : "foundation",
        horizonWeeks: Number(weeks),
        painFlag: false,
      };
      const job = await submitLlmJob(ctx.playerId!, "generate_training_plan", {
        statsProfile: statsSnapshot(profile),
        intake,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      await waitForJob(job.id, setStatus, registerJobUnsub);
      ctx.notify("Training plan ready");
      onReload();
    } catch (error: any) {
      setStatus(error.message || "Could not generate the plan.");
    }
  };

  return (
    <section className="portal-card training-intake">
      <div className="intake-intro">
        <span className="material-symbols-outlined">auto_awesome</span>
        <h2>Build your training plan</h2>
        <p>Answer a few questions. PoseTek combines your goals with the athlete's measured results to create a 4–12 week program.</p>
      </div>
      <form id="trainingIntakeForm" onSubmit={onSubmit}>
        <fieldset>
          <legend>Choose up to two goals</legend>
          <div className="goal-options">
            {GOAL_OPTIONS.map(([value, label]) => (
              <label key={value}>
                <input
                  type="checkbox"
                  name="goals"
                  value={value}
                  checked={goals.includes(value)}
                  onChange={event => toggleGoal(value, event.target.checked)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          Training days per week
          <input type="range" name="days" min={1} max={6} value={days} onChange={event => setDays(event.target.value)} />
          <output id="daysOutput">{days} days</output>
        </label>
        <label>
          Training setting
          <select name="setting" value={setting} onChange={event => setSetting(event.target.value)}>
            <option value="solo">Solo</option>
            <option value="partner">With a partner</option>
            <option value="halfAndHalf">Half solo, half partner</option>
            <option value="team">Team</option>
          </select>
        </label>
        <label>
          Program length
          <select name="weeks" value={weeks} onChange={event => setWeeks(event.target.value)}>
            <option value="4">4 weeks</option>
            <option value="6">6 weeks</option>
            <option value="8">8 weeks</option>
            <option value="12">12 weeks</option>
          </select>
        </label>
        <label>
          Anything else you want to improve?
          <textarea name="freeText" maxLength={500} placeholder="Optional" value={freeText} onChange={event => setFreeText(event.target.value)} />
        </label>
        <label className="pain-check">
          <input type="checkbox" name="pain" checked={pain} onChange={event => setPain(event.target.checked)} />
          <span>I currently have pain that affects training</span>
        </label>
        <button className="primary-cta" type="submit">Generate my plan</button>
        <p id="planGenerationStatus">{status}</p>
      </form>
    </section>
  );
}
