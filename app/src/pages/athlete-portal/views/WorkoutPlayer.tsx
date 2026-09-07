// The guided workout player, ported from the app's WorkoutPlayerView /
// WorkoutPlayerController: one page per block, free navigation, per-set
// check-offs written to the log as they happen, an elapsed timer, and a
// between-sets rest countdown. Ends in a summary that writes endedAt/endReason.
//
// Every state read goes through the Firestore-backed log, so closing the tab
// mid-workout loses nothing — reopening resumes from the log, not from memory.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  allBlocksAccounted,
  blockDoseLine,
  blockKindLabel,
  blockLogOf,
  blockLogRow,
  blockStatus,
  domainExposures,
  domainIcon,
  domainName,
  elapsedString,
  endReasonFor,
  hasPainSkip,
  initialPageIndex,
  orderedBlocks,
  restString,
  setsCompleted as setsCompletedOf,
  skipReasonLabel,
  skippedLogRow,
  targetSets as targetSetsOf,
  SKIP_REASONS,
  SKIP_REASON_PAIN,
  STATUS_DONE,
  STATUS_PARTIAL,
  STATUS_SKIPPED,
} from "../lib/training";
import { loadCatalogDrill } from "../lib/workout-store";
import type { WorkoutStore } from "../lib/workout-store";

interface PlayerProps {
  workout: any;
  store: WorkoutStore;
  // The already-active training session, if any, stamped into the log at Begin
  // so recorded measured drills dedupe against this workout's check-offs.
  linkedTrainingSessionId?: string | null;
  onExit: () => void;
}

export default function WorkoutPlayer({ workout, store, linkedTrainingSessionId, onExit }: PlayerProps) {
  const blocks = useMemo(() => orderedBlocks(workout), [workout]);
  const log = store.logFor(workout.id);

  const [index, setIndex] = useState(() => initialPageIndex(blocks, log));
  const [showSummary, setShowSummary] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showPainCard, setShowPainCard] = useState(false);
  const [restRemaining, setRestRemaining] = useState<number | null>(null);
  // State for what the summary renders; a ref alongside it so the idempotence
  // guard is exact even if `finish` fires twice before a re-render.
  const [didEnd, setDidEnd] = useState(false);
  const didEndRef = useRef(false);

  // Local fallback for elapsed time while the server timestamp is pending, and
  // the base for the visible clock: this *sitting*, not the log's original
  // startedAt — resuming a morning workout in the evening shouldn't open on a
  // nine-hour clock.
  const [openedAt] = useState(() => Date.now());
  const startedAtMillis = log?.startedAt?.toDate?.()?.valueOf() ?? log?.startedAt?.valueOf?.() ?? openedAt;
  const timerBase = Math.max(startedAtMillis, openedAt);

  const { beginWorkout } = store;
  // begin() no-ops until the store's first logs snapshot (its "does a log
  // already exist" check needs data) — retry the moment it lands.
  useEffect(() => {
    if (store.logsLoaded) beginWorkout(workout, linkedTrainingSessionId);
  }, [store.logsLoaded, beginWorkout, workout, linkedTrainingSessionId]);

  const stopRest = useCallback(() => setRestRemaining(null), []);

  // Between-sets rest, auto-started on a set tick when the block prescribes it.
  // Dismissible — a countdown is a hint, not a lock, but restSeconds is real
  // coaching content the athlete should feel.
  useEffect(() => {
    if (restRemaining === null || restRemaining <= 0) return;
    const timer = setTimeout(
      () => setRestRemaining(value => (value !== null && value > 1 ? value - 1 : null)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [restRemaining]);

  const goTo = useCallback((next: number) => {
    setIndex(next);
    stopRest();
  }, [stopRest]);

  const currentBlock = blocks[index];

  const advance = useCallback(() => {
    if (index < blocks.length - 1) goTo(index + 1);
    else setShowSummary(true);
  }, [index, blocks.length, goTo]);

  // Sets the block's completed-set count directly (the tick row is
  // tap-to-toggle so a fat-fingered extra tick can be backed out). Also the
  // un-skip path: writing a set count over a skipped block returns it to
  // partial/done.
  const setSets = useCallback((sets: number, block: any) => {
    const currentLog = store.logFor(workout.id);
    const previous = setsCompletedOf(block, currentLog);
    const target = targetSetsOf(block);
    const clamped = Math.min(Math.max(sets, 0), target);
    const status = blockStatus(block, currentLog);
    if (clamped === previous && status !== null && status !== STATUS_SKIPPED) return;

    if (clamped === 0) {
      // Backed out to untouched (or un-skipped with nothing done): remove the
      // row rather than leave a 0-set one that would still count as an exposure.
      store.removeBlock(workout.id, block.blockId);
    } else {
      store.updateBlock(workout.id, blockLogRow(block, clamped));
    }

    const rest = Number(block?.restSeconds) || 0;
    if (clamped > previous && clamped < target && rest > 0) setRestRemaining(rest);
    else stopRest();
  }, [store, workout.id, stopRest]);

  const skip = useCallback((block: any, reason: string) => {
    const currentLog = store.logFor(workout.id);
    store.updateBlock(workout.id, skippedLogRow(block, setsCompletedOf(block, currentLog), reason));
    stopRest();
    if (reason === SKIP_REASON_PAIN) setShowPainCard(true);
    else advance();
  }, [store, workout.id, stopRest, advance]);

  // Writes endedAt/endReason once. Safe from both the summary's Finish button
  // and the pain card's End workout.
  const finish = useCallback(() => {
    if (!didEndRef.current) {
      didEndRef.current = true;
      setDidEnd(true);
      store.endWorkout(workout.id, endReasonFor(blocks, store.logFor(workout.id)));
    }
    onExit();
  }, [store, workout.id, blocks, onExit]);

  if (showSummary) {
    return (
      <WorkoutSummary
        blocks={blocks}
        log={log}
        timerBase={timerBase}
        onFinish={finish}
        onKeepTraining={() => setShowSummary(false)}
        didEnd={didEnd}
      />
    );
  }

  return (
    <div className="workout-player">
      <header className="player-bar">
        <button type="button" className="player-back" onClick={onExit} aria-label="Back to training">
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <ElapsedChip fromMillis={timerBase} />
        <span className="player-position">Drill {Math.min(index + 1, blocks.length)} of {blocks.length}</span>
        <button type="button" className="text-button" onClick={() => setShowEndConfirm(true)}>End</button>
      </header>

      {/* One tappable segment per block, colored by outcome — the player's map
          and its direct-jump lever. */}
      <div className="player-strip" role="tablist" aria-label="Workout drills">
        {blocks.map((block, blockIndex) => {
          const status = blockStatus(block, log);
          const tone = status === STATUS_DONE ? "done"
            : status === STATUS_SKIPPED ? "skipped"
              : status === STATUS_PARTIAL ? "partial" : "";
          return (
            <button
              key={block.blockId}
              type="button"
              role="tab"
              aria-selected={blockIndex === index}
              aria-label={`Drill ${blockIndex + 1}: ${block.name || block.drillId}`}
              className={`strip-segment ${tone} ${blockIndex === index ? "current" : ""}`}
              onClick={() => goTo(blockIndex)}
            />
          );
        })}
      </div>

      {currentBlock ? (
        <BlockPage
          key={currentBlock.blockId}
          block={currentBlock}
          log={log}
          restRemaining={restRemaining}
          onDismissRest={stopRest}
          onSetSets={sets => setSets(sets, currentBlock)}
          onSkip={reason => skip(currentBlock, reason)}
        />
      ) : (
        <div className="mobile-empty"><p>This workout has no drills.</p></div>
      )}

      <footer className="player-controls">
        <button
          type="button"
          className="player-chevron"
          disabled={index === 0}
          onClick={() => goTo(index - 1)}
          aria-label="Previous drill"
        >
          <span className="material-symbols-outlined">chevron_left</span>
        </button>
        <PrimaryAction
          block={currentBlock}
          log={log}
          isLast={index === blocks.length - 1}
          onCompleteSet={() => currentBlock && setSets(setsCompletedOf(currentBlock, log) + 1, currentBlock)}
          onAdvance={advance}
        />
        <button
          type="button"
          className="player-chevron"
          onClick={advance}
          aria-label="Next drill"
        >
          <span className="material-symbols-outlined">chevron_right</span>
        </button>
      </footer>

      {showEndConfirm ? (
        <div className="hub-scrim" role="dialog" aria-modal="true" aria-label="End this workout?">
          <div className="hub-dialog">
            <h3>End this workout?</h3>
            <p>Whatever you've completed so far is saved and counts toward your week.</p>
            <button type="button" className="primary-cta" onClick={() => { setShowEndConfirm(false); setShowSummary(true); }}>
              End and see summary
            </button>
            <button type="button" className="hub-secondary" onClick={() => setShowEndConfirm(false)}>Keep training</button>
          </div>
        </div>
      ) : null}

      {/* Pain is a first-class exit: the stop rule, then End workout offered
          prominently. */}
      {showPainCard ? (
        <div className="hub-scrim" role="dialog" aria-modal="true" aria-label="Stop here">
          <div className="hub-dialog pain-card">
            <h3><span className="material-symbols-outlined">medical_services</span> Stop here — that's the right call</h3>
            <p>
              Pain is a stop sign, not something to push through. Tell a parent or coach, and get it looked at by an
              athletic trainer, physio, or doctor before you load that area again.
            </p>
            <button type="button" className="primary-cta" onClick={() => { setShowPainCard(false); finish(); }}>
              End workout
            </button>
            <button type="button" className="hub-secondary" onClick={() => { setShowPainCard(false); advance(); }}>
              Keep going with other drills
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ElapsedChip({ fromMillis }: { fromMillis: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="player-timer">
      <span className="material-symbols-outlined">timer</span>
      {elapsedString(fromMillis, now)}
    </span>
  );
}

function PrimaryAction({ block, log, isLast, onCompleteSet, onAdvance }: {
  block: any;
  log: any;
  isLast: boolean;
  onCompleteSet: () => void;
  onAdvance: () => void;
}) {
  if (!block) return <span />;
  const target = targetSetsOf(block);
  const done = setsCompletedOf(block, log);
  if (blockStatus(block, log) === STATUS_SKIPPED) {
    return <button type="button" className="primary-cta" onClick={onAdvance}>{isLast ? "See summary" : "Next drill"}</button>;
  }
  if (done < target) {
    return (
      <button type="button" className="primary-cta" onClick={onCompleteSet}>
        <span className="material-symbols-outlined">check</span>
        Complete set {Math.min(done + 1, target)} of {target}
      </button>
    );
  }
  return (
    <button type="button" className="primary-cta" onClick={onAdvance}>
      {isLast ? "Finish workout" : "Next drill"}
    </button>
  );
}

// MARK: - One block, one page

function BlockPage({ block, log, restRemaining, onDismissRest, onSetSets, onSkip }: {
  block: any;
  log: any;
  restRemaining: number | null;
  onDismissRest: () => void;
  onSetSets: (sets: number) => void;
  onSkip: (reason: string) => void;
}) {
  const [catalogDrill, setCatalogDrill] = useState<any>(null);
  const [skipOpen, setSkipOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadCatalogDrill(block.drillId).then(drill => { if (!cancelled) setCatalogDrill(drill); });
    return () => { cancelled = true; };
  }, [block.drillId]);

  const target = targetSetsOf(block);
  const done = setsCompletedOf(block, log);
  const status = blockStatus(block, log);
  const restSeconds = Number(block?.restSeconds) || 0;
  const cues: string[] = block.cues || [];

  return (
    <div className="player-page">
      <div className="block-headline">
        <div className="block-tags">
          <span className="kind-chip">{blockKindLabel(block.kind)}</span>
          <span className="block-domain">{domainName(block.domain)}</span>
          {Number(block.estimatedMinutes) > 0 ? <span className="block-minutes">~{block.estimatedMinutes} min</span> : null}
        </div>
        <h2>{block.name || block.drillId}</h2>
        <p className="block-dose">{blockDoseLine(block)}</p>
        {block.whyIncluded ? <p className="block-why">{block.whyIncluded}</p> : null}
      </div>

      <section className="portal-card sets-card">
        <div className="card-heading">
          <p className="eyebrow">Sets</p>
          {restRemaining !== null ? (
            <button type="button" className="rest-chip" onClick={onDismissRest}
              aria-label={`Rest timer, ${restRemaining} seconds left. Click to dismiss.`}>
              <span className="material-symbols-outlined">hourglass_top</span>
              Rest {restString(restRemaining)}
              <span className="material-symbols-outlined">close</span>
            </button>
          ) : null}
        </div>
        <div className="set-ticks">
          {Array.from({ length: target }, (_, offset) => offset + 1).map(setNumber => (
            <button
              key={setNumber}
              type="button"
              // Tap-to-toggle: clicking the last filled circle backs a mistaken
              // tick out; clicking any other sets progress to that number.
              onClick={() => onSetSets(setNumber === done ? setNumber - 1 : setNumber)}
              className={`set-tick ${setNumber <= done ? "filled" : ""}`}
              aria-label={`Set ${setNumber}${setNumber <= done ? ", completed" : ""}`}
              aria-pressed={setNumber <= done}
            >
              {setNumber <= done ? <span className="material-symbols-outlined">check</span> : setNumber}
            </button>
          ))}
        </div>
        {restSeconds > 0 ? (
          <p className="rest-note">Rest {restSeconds}s between sets — full recovery is part of the work.</p>
        ) : null}
      </section>

      {cues.length ? (
        <section className="portal-card">
          <p className="eyebrow">Cues</p>
          <ul className="cue-list">
            {cues.map((cue, cueIndex) => (
              <li key={cueIndex}><span className="material-symbols-outlined">check_circle</span>{cue}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="portal-card">
        <p className="eyebrow">How to do it</p>
        {catalogDrill ? (
          <div className="teaching-lines">
            {catalogDrill.setup ? <TeachingLine icon="grid_on" label="Set up" text={catalogDrill.setup} /> : null}
            {catalogDrill.execution ? <TeachingLine icon="sprint" label="Do it" text={catalogDrill.execution} /> : null}
            {catalogDrill.successCriteria ? <TeachingLine icon="target" label="Done well" text={catalogDrill.successCriteria} /> : null}
          </div>
        ) : (
          <p className="muted-copy">Follow the dose and cues above — full setup notes for {block.drillId} aren't available here.</p>
        )}
      </section>

      {block.isMeasuredDrill ? (
        <p className="hub-note">
          <span className="material-symbols-outlined">videocam</span>
          Measured drill — either tick your sets here or record it in the PoseTek app (recorded reps count toward your
          targets automatically). Do one or the other, not both.
        </p>
      ) : null}

      {status === STATUS_SKIPPED ? (
        <section className="portal-card skipped-note">
          <span className="material-symbols-outlined">skip_next</span>
          <span>Skipped{skipReasonLabel(blockLogOf(log, block.blockId)?.skipReason) ? ` — ${skipReasonLabel(blockLogOf(log, block.blockId)?.skipReason)}` : ""}</span>
          <button type="button" className="text-button" onClick={() => onSetSets(done)}>Undo</button>
        </section>
      ) : (
        <button type="button" className="hub-secondary" onClick={() => setSkipOpen(true)}>
          <span className="material-symbols-outlined">skip_next</span>
          Skip this drill
        </button>
      )}

      {skipOpen ? (
        <div className="hub-scrim" role="dialog" aria-modal="true" aria-label={`Skip ${block.name || "this drill"}?`}>
          <div className="hub-dialog">
            <h3>Skip {block.name || "this drill"}?</h3>
            {SKIP_REASONS.map(reason => (
              <button
                key={reason.id}
                type="button"
                className="hub-secondary"
                onClick={() => { setSkipOpen(false); onSkip(reason.id); }}
              >
                {reason.label}
              </button>
            ))}
            <button type="button" className="text-button" onClick={() => setSkipOpen(false)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TeachingLine({ icon, label, text }: { icon: string; label: string; text: string }) {
  return (
    <article className="teaching-line">
      <span className="material-symbols-outlined">{icon}</span>
      <div>
        <small>{label}</small>
        <p>{text}</p>
      </div>
    </article>
  );
}

// MARK: - Summary

function WorkoutSummary({ blocks, log, timerBase, onFinish, onKeepTraining, didEnd }: {
  blocks: any[];
  log: any;
  timerBase: number;
  onFinish: () => void;
  onKeepTraining: () => void;
  didEnd: boolean;
}) {
  const accounted = allBlocksAccounted(blocks, log);
  const exposures = domainExposures(blocks, log);
  // This sitting's active time — resumes don't book the away-gap here. (Weekly
  // time trained still uses the log's full wall-clock span.)
  const endedAt = log?.endedAt?.toDate?.()?.valueOf() ?? log?.endedAt?.valueOf?.() ?? null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [endedAt]);
  const minutesActive = Math.max(Math.floor(((endedAt ?? now) - timerBase) / 60000), 0);

  return (
    <div className="workout-player summary">
      <section className="portal-card">
        <p className="eyebrow">{accounted ? "Workout complete" : "Ending early"}</p>
        <h2>{accounted ? "Nice work." : "Good work — it all counts."}</h2>
        <p className="muted-copy">{minutesActive} min active</p>
      </section>

      <section className="portal-card">
        <p className="eyebrow">Drills</p>
        <div className="summary-rows">
          {blocks.map(block => {
            const status = blockStatus(block, log);
            const done = setsCompletedOf(block, log);
            const target = targetSetsOf(block);
            const icon = status === STATUS_DONE ? "check_circle"
              : status === STATUS_PARTIAL ? "contrast"
                : status === STATUS_SKIPPED ? "skip_next" : "radio_button_unchecked";
            const line = status === STATUS_DONE || status === STATUS_PARTIAL
              ? `${done} of ${target} sets`
              : status === STATUS_SKIPPED
                ? (done > 0 ? `Skipped after ${done} set${done === 1 ? "" : "s"}` : "Skipped")
                : "Not started";
            return (
              <article key={block.blockId} className={`summary-row ${status || "untouched"}`}>
                <span className="material-symbols-outlined">{icon}</span>
                <div>
                  <strong>{block.name || block.drillId}</strong>
                  <small>{line}</small>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {exposures.length ? (
        <section className="portal-card">
          <p className="eyebrow">This session added</p>
          <div className="summary-rows">
            {exposures.map(exposure => (
              <article key={exposure.domain} className="summary-row done">
                <span className="material-symbols-outlined">{domainIcon(exposure.domain)}</span>
                <div>
                  <strong>{domainName(exposure.domain)} — {exposure.count} exposure{exposure.count === 1 ? "" : "s"}</strong>
                </div>
              </article>
            ))}
          </div>
          <p className="muted-copy">Your week's targets update from this log.</p>
        </section>
      ) : null}

      {hasPainSkip(log) ? (
        <section className="portal-card pain-card">
          <h3><span className="material-symbols-outlined">medical_services</span> You stopped something for pain</h3>
          <p>Tell a parent or coach, and get it looked at before you train that area again.</p>
        </section>
      ) : null}

      <button type="button" className="primary-cta" onClick={onFinish}>
        <span className="material-symbols-outlined">flag</span>
        Finish
      </button>
      {!accounted && !didEnd ? (
        <button type="button" className="hub-secondary" onClick={onKeepTraining}>Keep training</button>
      ) : null}
    </div>
  );
}
