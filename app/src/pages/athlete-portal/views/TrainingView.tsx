// The training tab: a state router over the athlete's plans plus the
// consolidated hub itself, ported from the app's TrainingHubView.
//
// The old "Full plan" section is gone, its content folded into one page: the
// block rail doubles as a week selector, the drills list lives behind an
// expander with per-drill progress, and History / Plan details are one click
// away. The workout flow stays in the tab — building a session and the
// today's-workout popup render as overlays over this screen — and only the
// guided player takes over the pane.
//
// "Today's workout" is *derived*, never stored: the newest planned workout
// generated today for the current week. Workouts stay disposable; the button
// flips back to "Create workout" at midnight because yesterday's answers about
// time and energy expired.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { db } from "../../../lib/firebase";
import { buildProfile } from "../../../components/athlete-stats/AthleteStats";
import { submitLlmJob, waitForJob } from "../lib/loaders";
import { dateText, number, statsSnapshot, timestamp } from "../lib/mobile";
import { createdMillis, repType, sessionFolder } from "../lib/metrics";
import {
  blockKindLabel,
  blockDoseLine,
  blockLogOf,
  buildWeekProgress,
  currentWeekNumber,
  daysLeftInWeek,
  demoWorkout,
  domainIcon,
  domainName,
  domainShortName,
  drillProgressFor,
  focusChoices,
  humanized,
  orderedBlocks,
  orderedWeeks,
  planHorizonWeeks,
  prescriptionDoseLine,
  todaysWorkout,
  toDate,
  weekBudgetMinutes,
  weekOf,
  weekWindow,
  weekWindowLabel,
  workoutStatus,
  ADJUSTMENT_MAX_CHARS,
  STATUS_DONE,
  STATUS_SKIPPED,
} from "../lib/training";
import type { ProgressRep, WeekProgress } from "../lib/training";
import { useWorkoutStore } from "../lib/workout-store";
import type { WorkoutStore } from "../lib/workout-store";
import WorkoutPlayer from "./WorkoutPlayer";
import { EmptyState, LockedPage, PageHero, PortalLoading } from "./shared";
import type { PortalContext } from "./shared";
import "./training-hub.css";

type TrainingData =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "intake" }
  | { phase: "plan"; plan: any };

export default function TrainingView({ ctx }: { ctx: PortalContext }) {
  if (ctx.access === "shared") {
    return <LockedPage title="Training" copy="Training plans and workout history are private athlete records." />;
  }
  return <TrainingContent ctx={ctx} />;
}

function TrainingContent({ ctx }: { ctx: PortalContext }) {
  const preview = ctx.access === "preview";
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
    if (preview) {
      setData({ phase: "plan", plan: previewPlan() });
      return;
    }
    let cancelled = false;
    db.collection("players").doc(ctx.playerId!).collection("trainingPlans").get()
      .then(plansSnap => {
        if (cancelled) return;
        const plans = plansSnap.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .sort((a: any, b: any) => (timestamp(b.generatedAt)?.valueOf() || 0) - (timestamp(a.generatedAt)?.valueOf() || 0));
        const active = plans.find((plan: any) => plan.status === "active") || null;
        if (active) setData({ phase: "plan", plan: active });
        else setData({ phase: "intake" });
      })
      .catch(error => {
        console.error("[training]", error);
        if (!cancelled) setData({ phase: "error", message: error.message || "The training records could not be loaded." });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, preview]);

  const plan = data.phase === "plan" ? data.plan : null;
  // Stable identity: the store derives its workout list from this rather than
  // copying it into state.
  const seedWorkouts = useMemo(
    () => (preview && plan ? [demoWorkout(plan.id, currentWeekNumber(plan))] : undefined),
    [preview, plan],
  );
  const store = useWorkoutStore(ctx.playerId, plan?.id ?? null, { live: !preview, seedWorkouts });

  return (
    <section className="mobile-page training-page">
      <PageHero
        eyebrow="Personalized development"
        title="Training"
        description="Your active plan, today's workout, and the week's progress."
        icon="fitness_center"
      />
      <div id="trainingContent">
        {data.phase === "loading" ? (
          <PortalLoading message="Loading training plan…" />
        ) : data.phase === "error" ? (
          <EmptyState icon="cloud_off" title="Training is unavailable" message={data.message} />
        ) : data.phase === "intake" ? (
          <TrainingIntake ctx={ctx} onReload={reload} registerJobUnsub={registerJobUnsub} />
        ) : (
          <TrainingHub ctx={ctx} plan={data.plan} store={store} onReload={reload} registerJobUnsub={registerJobUnsub} />
        )}
      </div>
    </section>
  );
}

// MARK: - The hub

interface HubProps {
  ctx: PortalContext;
  plan: any;
  store: WorkoutStore;
  onReload: () => void;
  registerJobUnsub: (unsubscribe: () => void) => void;
}

type Overlay =
  | { kind: "createWorkout"; weekNumber: number }
  | { kind: "workoutDetail"; workout: any };

type Panel = "history" | "planDetails" | "weekDetail";

function TrainingHub({ ctx, plan, store, onReload, registerJobUnsub }: HubProps) {
  const weeks = useMemo(() => orderedWeeks(plan), [plan]);
  const currentWeek = useMemo(() => currentWeekNumber(plan), [plan]);
  const [selectedWeek, setSelectedWeek] = useState(currentWeek);
  const [drillsExpanded, setDrillsExpanded] = useState(false);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [playerWorkout, setPlayerWorkout] = useState<any>(null);

  // A week the plan doesn't have (stale selection after a plan swap) falls back
  // to the current week.
  const week = weekOf(plan, selectedWeek) || weekOf(plan, currentWeek);
  const shownWeek = week ? number(week.weekNumber)! : currentWeek;
  const isCurrentWeek = shownWeek === currentWeek;

  // Recorded reps are the other half of weekly evidence: a measured drill done
  // outside any workout still counts once per recording session.
  const reps: ProgressRep[] = useMemo(() => ctx.allStatsReps().map((rep: any) => ({
    id: rep.id,
    // `_statsDrill` is the portal's normalized drill key, which is already the
    // vocabulary MEASURED_DRILL_DOMAINS is keyed on.
    repType: rep._statsDrill || repType(rep),
    createdAtMillis: createdMillis(rep),
    sessionFolder: sessionFolder(rep),
  })), [ctx]);

  const logs = useMemo(() => Object.values(store.logs), [store.logs]);
  const progress = useMemo(
    () => buildWeekProgress({ plan, weekNumber: shownWeek, logs, reps }),
    [plan, shownWeek, logs, reps],
  );

  const todays = useMemo(
    () => todaysWorkout(store.workouts, currentWeek),
    [store.workouts, currentWeek],
  );

  if (playerWorkout) {
    return (
      <WorkoutPlayer
        workout={playerWorkout}
        store={store}
        onExit={() => setPlayerWorkout(null)}
      />
    );
  }

  if (panel === "history") {
    return <TrainingHistory plan={plan} store={store} onBack={() => setPanel(null)} />;
  }
  if (panel === "planDetails") {
    return <PlanDetails plan={plan} onBack={() => setPanel(null)} onStartNewPlan={onReload} />;
  }
  if (panel === "weekDetail" && week) {
    return <WeekDetail plan={plan} week={week} isCurrent={isCurrentWeek} onBack={() => setPanel(null)} />;
  }

  return (
    <>
      {/* The block rail is the week selector: picking a week re-renders the
          week card, the targets, and the drills expander in place. */}
      <section className="hub-rail-wrap">
        <p className="hub-section-title">The block</p>
        <div className="hub-rail">
          {weeks.map((item: any) => {
            const weekNumber = number(item.weekNumber) ?? 0;
            return (
              <button
                key={weekNumber}
                type="button"
                className={`week-chip ${weekNumber === shownWeek ? "selected" : ""} ${weekNumber === currentWeek ? "current" : ""}`}
                onClick={() => { setSelectedWeek(weekNumber); setDrillsExpanded(false); }}
                aria-pressed={weekNumber === shownWeek}
              >
                <span className="chip-week">Week {weekNumber}{weekNumber === currentWeek ? <i className="now-dot" /> : null}</span>
                <span className="chip-theme">{item.theme || "Training week"}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="portal-card week-card">
        <div className="card-heading">
          <p className="eyebrow">Week {shownWeek} of {planHorizonWeeks(plan)}</p>
          {isCurrentWeek ? (
            <span className="days-left">{daysLeftInWeek(plan, shownWeek) === 1 ? "1 day left" : `${daysLeftInWeek(plan, shownWeek)} days left`}</span>
          ) : (
            <span className="week-window">{weekWindow(plan, shownWeek) ? weekWindowLabel(weekWindow(plan, shownWeek)!) : ""}</span>
          )}
        </div>
        <button type="button" className="week-headline" onClick={() => setPanel("weekDetail")} disabled={!week}>
          <h2>{week?.theme || `Week ${shownWeek}`}</h2>
          <span className="material-symbols-outlined">chevron_right</span>
        </button>
        {week?.focus ? <p className="week-focus">{week.focus}</p> : null}
      </section>

      {/* Full-width primary action directly under the week card. Building a
          workout is for *today*, so a non-current week hides it. */}
      {isCurrentWeek ? (
        todays ? (
          <TodaysWorkoutButton
            workout={todays}
            log={store.logFor(todays.id)}
            onOpen={() => setOverlay({ kind: "workoutDetail", workout: todays })}
          />
        ) : (
          <button type="button" className="primary-cta hub-cta" onClick={() => setOverlay({ kind: "createWorkout", weekNumber: currentWeek })}>
            <span className="material-symbols-outlined">bolt</span>
            Create workout
          </button>
        )
      ) : null}

      <WeekTargetsCard plan={plan} week={week} progress={progress} />

      {week?.drills?.length ? (
        <DrillsCard
          week={week}
          progress={progress}
          expanded={drillsExpanded}
          onToggle={() => setDrillsExpanded(value => !value)}
        />
      ) : null}

      <div className="hub-links">
        <button type="button" className="hub-link" onClick={() => setPanel("history")}>
          <span className="material-symbols-outlined">history</span>
          History
          <span className="material-symbols-outlined chevron">chevron_right</span>
        </button>
        <button type="button" className="hub-link" onClick={() => setPanel("planDetails")}>
          <span className="material-symbols-outlined">description</span>
          Plan details
          <span className="material-symbols-outlined chevron">chevron_right</span>
        </button>
      </div>

      {overlay ? (
        <HubOverlay
          title={overlay.kind === "createWorkout" ? "Create workout" : "Today's workout"}
          onDismiss={() => setOverlay(null)}
        >
          {overlay.kind === "createWorkout" ? (
            <CreateWorkoutCard
              ctx={ctx}
              plan={plan}
              weekNumber={overlay.weekNumber}
              store={store}
              registerJobUnsub={registerJobUnsub}
              onBuilt={workout => setOverlay({ kind: "workoutDetail", workout })}
            />
          ) : (
            <WorkoutDetailCard
              ctx={ctx}
              plan={plan}
              workout={overlay.workout}
              store={store}
              registerJobUnsub={registerJobUnsub}
              onStart={workout => { setOverlay(null); setPlayerWorkout(workout); }}
              onCreateAnother={() => setOverlay({ kind: "createWorkout", weekNumber: currentWeek })}
            />
          )}
        </HubOverlay>
      ) : null}
    </>
  );
}

// Flips from "Create workout" to "Today's workout" once a session built today
// exists; the label adapts to its log (start / resume / completed / ended early).
function TodaysWorkoutButton({ workout, log, onOpen }: { workout: any; log: any; onOpen: () => void }) {
  const status = workoutStatus(log);
  return (
    <button type="button" className="primary-cta hub-cta todays-workout" onClick={onOpen}
      aria-label={`Today's workout: ${status.line}`}>
      <span className="cta-copy">
        <strong>Today's workout</strong>
        <small>{orderedBlocks(workout).length} drills · ~{number(workout.estimatedMinutes) || 30} min · {status.line}</small>
      </span>
      <span className="material-symbols-outlined">{status.icon}</span>
    </button>
  );
}

function WeekTargetsCard({ plan, week, progress }: { plan: any; week: any; progress: WeekProgress }) {
  const budget = weekBudgetMinutes(plan, week);
  const trained = progress.minutesTrained;
  const fraction = budget > 0 ? Math.min(trained / budget, 1) : 0;

  return (
    <section className="portal-card targets-card">
      <p className="eyebrow">This week's targets</p>
      {progress.domainProgress.length ? (
        <div className={`domain-rings ${progress.domainProgress.length <= 3 ? "row" : "grid"}`}>
          {progress.domainProgress.map(domain => (
            <DomainRing
              key={domain.domain}
              title={domainShortName(domain.domain)}
              done={domain.exposuresDone}
              target={domain.exposuresTarget}
            />
          ))}
        </div>
      ) : (
        <p className="hub-note"><span className="material-symbols-outlined">info</span>This week has no domain targets set.</p>
      )}

      <div className="time-trained">
        <div className="time-heading">
          <span className="material-symbols-outlined">schedule</span>
          <span>Time trained</span>
          <strong>{trained} min{budget > 0 ? <small> of ~{budget}</small> : null}</strong>
        </div>
        {budget > 0 ? (
          <div className="meter"><i style={{ width: `${Math.max(fraction * 100, fraction > 0 ? 4 : 0)}%` }} /></div>
        ) : null}
      </div>
    </section>
  );
}

// One target domain's weekly completion. The exact count is always spelled out
// under the ring so meaning never depends on reading a fill level.
function DomainRing({ title, done, target }: { title: string; done: number; target: number }) {
  const fraction = target > 0 ? Math.min(done / target, 1) : (done > 0 ? 1 : 0);
  const isMet = target > 0 && done >= target;
  const degrees = Math.round(fraction * 360);
  const fill = { "--ring-fill": `conic-gradient(var(--lime) ${degrees}deg, rgba(255,255,255,.09) 0deg)` } as CSSProperties;
  return (
    <div className="domain-ring" aria-label={`${title}: ${done} of ${target} exposures${isMet ? ", complete" : ""}`}>
      <div className={`ring ${isMet ? "met" : ""}`} style={fill}>
        <span>{isMet ? <span className="material-symbols-outlined">check</span> : `${Math.round(fraction * 100)}%`}</span>
      </div>
      <strong>{title}</strong>
      <small>{done}/{target}</small>
    </div>
  );
}

// Collapsed it reads as one summary line; expanded it shows every drill with
// its completion chip (done/partial counts come from this week's logs).
function DrillsCard({ week, progress, expanded, onToggle }: {
  week: any;
  progress: WeekProgress;
  expanded: boolean;
  onToggle: () => void;
}) {
  const drills = week.drills || [];
  const doneCount = drills.filter((drill: any) => drillProgressFor(progress, String(drill.drillId))?.state.kind === "done").length;

  return (
    <section className="portal-card drills-card">
      <button type="button" className="drills-toggle" onClick={onToggle} aria-expanded={expanded}>
        <p className="eyebrow">This week's drills</p>
        <span className={`done-count ${doneCount >= drills.length ? "all" : ""}`}>{doneCount} of {drills.length} done</span>
        <span className={`material-symbols-outlined chevron ${expanded ? "open" : ""}`}>expand_more</span>
      </button>
      {expanded ? (
        <div className="drill-rows">
          {drills.map((drill: any, index: number) => {
            const state = drillProgressFor(progress, String(drill.drillId))?.state;
            const chip = state?.kind === "notStarted" || !state ? "0" : `${state.completed}/${state.target}`;
            return (
              <article key={drill.drillId || index} className="drill-row">
                <span className="drill-icon material-symbols-outlined">{domainIcon(drill.domain)}</span>
                <div>
                  <strong>{drill.name || drill.drillId || "Drill"}</strong>
                  <small>{prescriptionDoseLine(drill)}</small>
                </div>
                <span className={`completion-chip ${state?.kind === "done" ? "done" : state?.kind === "partial" ? "partial" : ""}`}>{chip}</span>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

// MARK: - Overlay shell

// The in-page modal: scrim plus a bounded card. It lives inside the training
// pane so the portal chrome stays visible — the point of not using a full
// takeover for a two-question form.
function HubOverlay({ title, onDismiss, children }: { title: string; onDismiss: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onDismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div className="hub-scrim" onClick={onDismiss}>
      <div className="hub-overlay-card" role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}>
        <header>
          <h3>{title}</h3>
          <button type="button" className="overlay-close" onClick={onDismiss} aria-label="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>
        <div className="overlay-body">{children}</div>
      </div>
    </div>
  );
}

// MARK: - Create workout (3 questions -> build_workout)

const ENERGY_CHOICES: { id: string; label: string; detail: string }[] = [
  { id: "low", label: "Running on empty", detail: "Keep it light — technique over intensity" },
  { id: "normal", label: "Normal", detail: "A standard session from this week's plan" },
  { id: "high", label: "Fresh", detail: "Ready for max-quality work" },
];

// The gateway accepts any positive minutes; these mirror the plan intake's
// session lengths minus the 75-minute slot — a "right now" tool doesn't need
// the plan's longest setting.
const TIME_CHOICES = [15, 30, 45, 60];

interface BuilderProps {
  ctx: PortalContext;
  plan: any;
  store: WorkoutStore;
  registerJobUnsub: (unsubscribe: () => void) => void;
}

// Runs build_workout. The finished job carries the result inline — the same map
// (minus the `generatedAt` server timestamp) that was persisted to
// `plannedWorkouts/{workoutId}` — so no second Firestore read is needed. The
// store's listener delivers the durable copy a moment later.
async function runWorkoutBuild(
  ctx: PortalContext,
  params: any,
  onStatus: (text: string) => void,
  registerJobUnsub: (unsubscribe: () => void) => void,
): Promise<any> {
  const jobRef = await submitLlmJob(ctx.playerId!, "build_workout", params);
  const job = await waitForJob(jobRef.id, onStatus, registerJobUnsub);
  const result = job?.result;
  if (!result || !Array.isArray(result.blocks)) {
    throw new Error("The workout was built but could not be read.");
  }
  // `generatedAt` is stamped server-side on the doc, not on the inline result.
  // Filling it in locally keeps the just-built session eligible as "today's
  // workout" in the moment before the listener's copy arrives.
  return { ...result, id: result.workoutId || jobRef.id, generatedAt: result.generatedAt || new Date() };
}

function CreateWorkoutCard({ ctx, plan, weekNumber, store, registerJobUnsub, onBuilt }: BuilderProps & {
  weekNumber: number;
  onBuilt: (workout: any) => void;
}) {
  const [minutes, setMinutes] = useState<number | null>(null);
  const [energy, setEnergy] = useState<string | null>(null);
  const [focus, setFocus] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const week = weekOf(plan, weekNumber);
  const choices = focusChoices(week);

  const submit = async () => {
    if (minutes === null || energy === null) return;
    // The preview athlete has no gateway access: hand back the demo session
    // rather than queueing a job that would be rejected.
    if (ctx.access === "preview") {
      const workout = demoWorkout(plan.id, weekNumber);
      store.noteWorkout(workout);
      onBuilt(workout);
      return;
    }
    setBusy(true);
    setError("");
    setStatus("Pulling one session out of this week's targets…");
    try {
      const workout = await runWorkoutBuild(ctx, {
        planId: plan.id,
        timeAvailableMinutes: minutes,
        energy,
        // Week order, not click order — deterministic params for a selection.
        focusDomains: choices.filter(domain => focus.includes(domain)),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }, setStatus, registerJobUnsub);
      store.noteWorkout(workout);
      ctx.notify("Workout ready");
      onBuilt(workout);
    } catch (buildError: any) {
      setError(buildError.message || "Could not build the workout.");
      setBusy(false);
    }
  };

  if (busy) {
    return (
      <div className="overlay-working">
        <span className="spinner" />
        <p>{status}</p>
        <p className="muted-copy">Pulling one session out of week {weekNumber}'s targets.</p>
      </div>
    );
  }

  return (
    <div className="create-workout">
      {error ? <p className="hub-error"><span className="material-symbols-outlined">error</span>{error}</p> : null}

      <fieldset>
        <p className="eyebrow">Question 1 of 3</p>
        <legend>How much time do you have?</legend>
        <div className="pill-row">
          {TIME_CHOICES.map(choice => (
            <button key={choice} type="button" className={`pill ${minutes === choice ? "selected" : ""}`} onClick={() => setMinutes(choice)}>
              {choice} min
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <p className="eyebrow">Question 2 of 3</p>
        <legend>How's your energy?</legend>
        <div className="option-rows">
          {ENERGY_CHOICES.map(choice => (
            <button key={choice.id} type="button" className={`option-row ${energy === choice.id ? "selected" : ""}`} onClick={() => setEnergy(choice.id)}>
              <span className="material-symbols-outlined">{energy === choice.id ? "check_circle" : "radio_button_unchecked"}</span>
              <span><strong>{choice.label}</strong><small>{choice.detail}</small></span>
            </button>
          ))}
        </div>
      </fieldset>

      {choices.length ? (
        <fieldset>
          <p className="eyebrow">Question 3 of 3 — optional</p>
          <legend>Anything you want to focus on?</legend>
          <div className="option-rows">
            {choices.map(domain => (
              <button
                key={domain}
                type="button"
                className={`option-row ${focus.includes(domain) ? "selected" : ""}`}
                onClick={() => setFocus(current => current.includes(domain) ? current.filter(item => item !== domain) : [...current, domain])}
              >
                <span className="material-symbols-outlined">{focus.includes(domain) ? "check_circle" : "radio_button_unchecked"}</span>
                <span><strong>{domainName(domain)}</strong></span>
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      <button type="button" className="primary-cta" disabled={minutes === null || energy === null} onClick={submit}>
        <span className="material-symbols-outlined">bolt</span>
        Build my workout
      </button>
    </div>
  );
}

// MARK: - Today's workout popup (adjust, or proceed)

// The full session sheet, a free-text "tell your coach what to change" rebuild
// loop, and the start/resume CTA. Adjustments re-run build_workout with
// adjustmentRequest/previousWorkoutId — every adjustment is a fresh
// gateway-written doc, and this card swaps to the newest one.
function WorkoutDetailCard({ ctx, plan, workout, store, registerJobUnsub, onStart, onCreateAnother }: BuilderProps & {
  workout: any;
  onStart: (workout: any) => void;
  onCreateAnother: () => void;
}) {
  const [current, setCurrent] = useState(workout);
  const [adjustment, setAdjustment] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const log = store.logFor(current.id);
  // The log is final once endReason lands, whatever the reason — an
  // ended-early workout keeps its partial credit and is honestly labeled,
  // never resumed and never called complete.
  const isEnded = Boolean(log?.endReason);
  const wasCompleted = log?.endReason === "completed";
  const isInProgress = Boolean(log) && !log?.endReason;

  const submitAdjustment = async (event: FormEvent) => {
    event.preventDefault();
    const text = adjustment.trim().slice(0, ADJUSTMENT_MAX_CHARS);
    if (!text) return;
    setAdjusting(true);
    setError("");
    setStatus("Rebuilding your session…");
    try {
      const rebuilt = await runWorkoutBuild(ctx, {
        planId: plan.id,
        timeAvailableMinutes: Math.max(number(current.params?.timeAvailableMinutes) || 0, 1),
        energy: current.params?.energy || "normal",
        focusDomains: current.params?.focusDomains || [],
        adjustmentRequest: text,
        previousWorkoutId: current.id,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }, setStatus, registerJobUnsub);
      store.noteWorkout(rebuilt);
      setCurrent(rebuilt);
      setAdjustment("");
      ctx.notify("Workout updated");
    } catch (adjustError: any) {
      setError(adjustError.message || "Could not adjust the workout.");
    } finally {
      setAdjusting(false);
    }
  };

  return (
    <div className="workout-detail">
      <p className="eyebrow">Week {number(current.weekNumber) || 1} · about {number(current.estimatedMinutes) || 30} min</p>
      {current.intro ? <p className="detail-intro">{current.intro}</p> : null}
      {isInProgress ? (
        <p className="hub-note"><span className="material-symbols-outlined">play_circle</span>You've started this workout — your progress so far is saved.</p>
      ) : null}

      <div className="detail-blocks">
        {orderedBlocks(current).map((block: any) => {
          const blockState = blockLogOf(log, block.blockId)?.status;
          return (
            <article key={block.blockId} className="detail-block">
              <span className="block-order">{number(block.order) ?? "•"}</span>
              <div>
                <strong>{block.name || block.drillId}</strong>
                <small>{blockDoseLine(block)}</small>
                {block.whyIncluded ? <p>{block.whyIncluded}</p> : null}
              </div>
              {blockState === STATUS_DONE ? (
                <span className="material-symbols-outlined done">check_circle</span>
              ) : blockState === STATUS_SKIPPED ? (
                <span className="material-symbols-outlined skipped">skip_next</span>
              ) : (
                <span className="kind-chip">{blockKindLabel(block.kind)}</span>
              )}
            </article>
          );
        })}
      </div>

      {current.stopRule ? (
        <p className="hub-note"><span className="material-symbols-outlined">back_hand</span>{current.stopRule}</p>
      ) : null}

      {isEnded ? (
        <div className="ended-section">
          <p className={wasCompleted ? "ended done" : "ended early"}>
            <span className="material-symbols-outlined">{wasCompleted ? "check_circle" : "flag_circle"}</span>
            {wasCompleted ? "Completed today — nice work." : "Ended early — what you did still counts."}
          </p>
          <button type="button" className="hub-secondary" onClick={onCreateAnother}>
            <span className="material-symbols-outlined">bolt</span>
            Create another workout
          </button>
        </div>
      ) : (
        <>
          <div className="adjust-section">
            <p className="eyebrow">Want it different?</p>
            {error ? <p className="hub-error"><span className="material-symbols-outlined">error</span>{error}</p> : null}
            {ctx.access === "preview" ? (
              <p className="hub-note">
                <span className="material-symbols-outlined">lock</span>
                Sign in to tell your coach what to change — "only 20 minutes, no goal today" rebuilds the session around
                your words.
              </p>
            ) : adjusting ? (
              <p className="adjust-working"><span className="spinner" />{status}</p>
            ) : (
              <form className="adjust-composer" onSubmit={submitAdjustment}>
                <textarea
                  value={adjustment}
                  maxLength={ADJUSTMENT_MAX_CHARS}
                  rows={2}
                  placeholder={`Tell your coach what to change — "only 20 minutes, no goal today"`}
                  onChange={event => setAdjustment(event.target.value.slice(0, ADJUSTMENT_MAX_CHARS))}
                />
                <button type="submit" disabled={!adjustment.trim()} aria-label="Send adjustment">
                  <span className="material-symbols-outlined">arrow_upward</span>
                </button>
              </form>
            )}
          </div>
          <button type="button" className="primary-cta" onClick={() => onStart(current)}>
            <span className="material-symbols-outlined">{isInProgress ? "play_arrow" : "sprint"}</span>
            {isInProgress ? "Resume workout" : "Start workout"}
          </button>
        </>
      )}
    </div>
  );
}

// MARK: - Secondary panels (the app's pushes)

function PanelHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="panel-header">
      <button type="button" className="panel-back" onClick={onBack} aria-label="Back to training">
        <span className="material-symbols-outlined">arrow_back</span>
      </button>
      <h2>{title}</h2>
    </header>
  );
}

function WeekDetail({ plan, week, isCurrent, onBack }: { plan: any; week: any; isCurrent: boolean; onBack: () => void }) {
  const window = weekWindow(plan, number(week.weekNumber) ?? 1);
  const allocations = week.allocations || [];
  const totalMinutes = allocations.reduce((total: number, item: any) => total + (number(item.minutes) ?? 0), 0);

  return (
    <div className="hub-panel">
      <PanelHeader title={`Week ${number(week.weekNumber)}`} onBack={onBack} />
      <section className="portal-card">
        <p className="eyebrow">{isCurrent ? "This week" : window ? weekWindowLabel(window) : "Upcoming"}</p>
        <h2>{week.theme || "Training week"}</h2>
        {week.focus ? <p className="muted-copy">{week.focus}</p> : null}
        {week.progressionNote ? <p className="muted-copy">{week.progressionNote}</p> : null}
        {week.intensityNote ? <p className="muted-copy">{week.intensityNote}</p> : null}
      </section>

      {allocations.length ? (
        <section className="portal-card">
          <p className="eyebrow">Where the week's minutes go</p>
          <div className="allocation-rows">
            {allocations.map((allocation: any) => {
              const minutes = number(allocation.minutes) ?? 0;
              const share = totalMinutes > 0 ? Math.round(minutes / totalMinutes * 100) : 0;
              return (
                <article key={allocation.domain} className="allocation-row">
                  <span className="material-symbols-outlined">{domainIcon(allocation.domain)}</span>
                  <div>
                    <strong>{domainName(allocation.domain)}</strong>
                    <div className="meter"><i style={{ width: `${share}%` }} /></div>
                  </div>
                  <span className="allocation-minutes">{minutes} min</span>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="portal-card">
        <p className="eyebrow">Targets</p>
        {(week.targets || []).length ? (
          <div className="target-rows">
            {(week.targets || []).map((target: any) => (
              <article key={target.domain} className="target-row">
                <span className="material-symbols-outlined">{domainIcon(target.domain)}</span>
                <div>
                  <strong>{domainName(target.domain)}</strong>
                  <small>{target.note || "weekly exposure"}</small>
                </div>
                <span className="target-count">{number(target.exposures) ?? 0}×</span>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted-copy">Retest week — complete the measured drills in the PoseTek app.</p>
        )}
      </section>

      {(week.drills || []).length ? (
        <section className="portal-card">
          <p className="eyebrow">Prescribed drills</p>
          <div className="drill-rows">
            {(week.drills || []).map((drill: any, index: number) => (
              <article key={drill.drillId || index} className="drill-row">
                <span className="drill-icon material-symbols-outlined">{domainIcon(drill.domain)}</span>
                <div>
                  <strong>{drill.name || drill.drillId}</strong>
                  <small>{prescriptionDoseLine(drill)}</small>
                  {drill.note ? <p className="muted-copy">{drill.note}</p> : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

// The plan's rationale: what it read in the athlete's results and why it chose
// what it chose.
function PlanDetails({ plan, onBack, onStartNewPlan }: { plan: any; onBack: () => void; onStartNewPlan: () => void }) {
  const generated = toDate(plan.generatedAt);
  return (
    <div className="hub-panel">
      <PanelHeader title="Plan details" onBack={onBack} />

      <section className="portal-card">
        <p className="eyebrow">{planHorizonWeeks(plan)}-week plan</p>
        <h2>{plan.assessment?.summary || "Personalized from your measured results."}</h2>
        <p className="muted-copy">
          {plan.intake?.daysPerWeek
            ? `${plan.intake.daysPerWeek} days per week · ${plan.intake.minutesPerSession || 60} minutes per session`
            : "Week-by-week progression"}
          {generated ? ` · built ${dateText(plan.generatedAt)}` : ""}
        </p>
      </section>

      {(plan.focusAreas || []).length ? (
        <section className="portal-card">
          <p className="eyebrow">Focus areas</p>
          <div className="focus-list">
            {(plan.focusAreas || []).map((area: any, index: number) => (
              <article key={area.domain || index}>
                <span className="material-symbols-outlined">{domainIcon(area.domain)}</span>
                <div>
                  <strong>{domainName(area.domain)}</strong>
                  <p>{area.rationale || ""}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {(plan.assessment?.findings || []).length ? (
        <section className="portal-card">
          <p className="eyebrow">What your results said</p>
          <div className="finding-rows">
            {(plan.assessment.findings || []).map((finding: any, index: number) => (
              <article key={finding.ruleId || index} className="finding-row">
                <span className={`confidence ${finding.confidence || "moderate"}`}>{finding.confidence || "moderate"}</span>
                <p>{finding.statement}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {(plan.assessment?.dataGaps || []).length ? (
        <section className="portal-card">
          <p className="eyebrow">What it couldn't see</p>
          <ul className="gap-list">
            {(plan.assessment.dataGaps || []).map((gap: string, index: number) => (
              <li key={index}>{humanized(gap)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {plan.retest ? (
        <section className="portal-card">
          <p className="eyebrow">Retest</p>
          <p>
            Week {number(plan.retest.weekNumber) ?? planHorizonWeeks(plan)} —{" "}
            {(plan.retest.drills || []).map((drill: string) => humanized(drill)).join(", ") || "measured drills"}
          </p>
          {plan.retest.note ? <p className="muted-copy">{plan.retest.note}</p> : null}
        </section>
      ) : null}

      {(plan.disclaimers || []).length ? (
        <section className="portal-card">
          <p className="eyebrow">Before you train</p>
          <ul className="gap-list">
            {(plan.disclaimers || []).map((line: string, index: number) => <li key={index}>{line}</li>)}
          </ul>
        </section>
      ) : null}

      <button type="button" className="hub-secondary" onClick={onStartNewPlan}>
        <span className="material-symbols-outlined">refresh</span>
        Reload plan
      </button>
    </div>
  );
}

// Every workout this plan has logged, newest first — done, partial, and ended
// early all shown honestly.
function TrainingHistory({ plan, store, onBack }: { plan: any; store: WorkoutStore; onBack: () => void }) {
  const rows = useMemo(() => {
    const byId = new Map(store.workouts.map(workout => [workout.id, workout]));
    return Object.values(store.logs)
      .map((log: any) => ({ log, workout: byId.get(log.id) || null }))
      .sort((a, b) => (toDate(b.log.startedAt)?.valueOf() ?? 0) - (toDate(a.log.startedAt)?.valueOf() ?? 0));
  }, [store.logs, store.workouts]);

  return (
    <div className="hub-panel">
      <PanelHeader title="History" onBack={onBack} />
      {rows.length ? (
        <section className="portal-card">
          <p className="eyebrow">{planHorizonWeeks(plan)}-week block</p>
          <div className="history-rows">
            {rows.map(({ log, workout }) => {
              const status = workoutStatus(log);
              const blocks = log.blocks || [];
              const done = blocks.filter((block: any) => block.status !== STATUS_SKIPPED).length;
              return (
                <article key={log.id} className={`history-row ${status.kind}`}>
                  <span className="material-symbols-outlined">{status.icon}</span>
                  <div>
                    <strong>{workout?.intro || `Week ${number(log.weekNumber) ?? 1} workout`}</strong>
                    <small>
                      {dateText(log.startedAt)} · {status.line}
                      {blocks.length ? ` · ${done} of ${workout ? orderedBlocks(workout).length : blocks.length} drills trained` : ""}
                    </small>
                  </div>
                  <span className="history-week">W{number(log.weekNumber) ?? 1}</span>
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <EmptyState icon="history" title="No workouts yet" message="Sessions you run from the Training page show up here." />
      )}
    </div>
  );
}

// MARK: - Intake

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
  const [age, setAge] = useState("");
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
      const intake: any = {
        goals: chosen,
        freeTextGoals: freeText.trim() || null,
        daysPerWeek: Number(days),
        minutesPerSession: 60,
        setting,
        equipment: ["ball", "cones", "markers", "goal", "timer", "wall"],
        // Banded on the same thresholds the Stats tab uses, matching the app's
        // PlanLevelInference. A null overall compares false on both branches.
        level: (profile.overall ?? 0) >= 85 ? "performance" : (profile.overall ?? 0) >= 65 ? "club" : "foundation",
        horizonWeeks: Number(weeks),
        painFlag: false,
      };
      // Age gates drill eligibility and maturity floors server-side. Sent only
      // when given; otherwise the gateway falls back to the athlete's profile.
      const parsedAge = Number(age);
      if (age.trim() && Number.isInteger(parsedAge) && parsedAge >= 5 && parsedAge <= 80) intake.age = parsedAge;

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
          Age (optional — it keeps the drills age-appropriate)
          <input type="number" name="age" min={5} max={80} value={age} placeholder="e.g. 15" onChange={event => setAge(event.target.value)} />
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

// MARK: - Preview

// The signed-out preview plan: same shape the hub renders for real, with a
// week's worth of allocations and a built workout so the player is explorable.
function previewPlan(): any {
  const today = new Date();
  const startDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return {
    id: "preview-plan",
    status: "active",
    startDate,
    horizonWeeks: 6,
    intake: { daysPerWeek: 3, minutesPerSession: 60 },
    assessment: { summary: "Build first-step speed while maintaining power and ball control." },
    focusAreas: [
      { domain: "linearSpeed", rationale: "Your acceleration has the clearest opportunity for improvement." },
      { domain: "strengthResilience", rationale: "Power work supports sprint and jump performance." },
    ],
    weeks: Array.from({ length: 6 }, (_, index) => ({
      weekNumber: index + 1,
      theme: index === 5 ? "Retest and review" : `Build the base ${index + 1}`,
      focus: "Quality movement, controlled volume, and consistent technique.",
      progressionNote: "Complete each exposure with full recovery.",
      allocations: [
        { domain: "linearSpeed", minutes: 60 },
        { domain: "strengthResilience", minutes: 45 },
        { domain: "dribbling", minutes: 30 },
      ],
      targets: [
        { domain: "linearSpeed", exposures: 2, note: "short, high-quality efforts" },
        { domain: "strengthResilience", exposures: 1, note: "explosive movement" },
        { domain: "dribbling", exposures: 2, note: "close control at speed" },
      ],
      drills: index === 5 ? [] : [
        { drillId: "SPD-010", name: "Acceleration starts", domain: "linearSpeed", sets: 4, reps: 3, repUnit: "reps", restSeconds: 60, frequencyPerWeek: 2, estimatedMinutes: 12 },
        { drillId: "DRB-004", name: "Tight-space control", domain: "dribbling", sets: 3, reps: 45, repUnit: "seconds", restSeconds: 45, frequencyPerWeek: 2, estimatedMinutes: 10 },
      ],
    })),
  };
}
