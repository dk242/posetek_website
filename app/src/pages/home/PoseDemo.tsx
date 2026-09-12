import { useEffect, useRef } from "react";
import { elapsedSeconds, lastFrameIndex, phaseChipText, phaseForFrame, timerText, type PoseDemoData, type PoseDemoRequest } from "./pose-demo";
import { usePoseDemo } from "./use-pose-demo";
import poseDemoData from "./landing-pose-demo-data.json";
const POSE_DATA: PoseDemoData = poseDemoData;

// First-paint text for the nodes the demo controller drives directly (timer,
// phase chip, phase telemetry — see use-pose-demo.ts). Computed once from the
// first sequence, matching the legacy static markup, and never re-rendered so
// React does not overwrite the controller's per-frame writes.
const INITIAL_SEQUENCE = POSE_DATA.sequences[0];
const INITIAL_PHASE = phaseForFrame(INITIAL_SEQUENCE, 0);
const INITIAL_FPS = INITIAL_SEQUENCE.fps ?? POSE_DATA.fps;
const INITIAL_TIMER = timerText(0, INITIAL_SEQUENCE, INITIAL_FPS);
const INITIAL_PHASE_CHIP = phaseChipText(INITIAL_PHASE, elapsedSeconds(0, INITIAL_FPS));

const LABELS: Record<string, string> = { sprint: "Sprint", jump: "Vertical jump", broadJump: "Broad jump", dribbling: "Dribbling", changeOfDirection: "Agility", shooting: "Shooting" };
const DRILL_BUTTONS = POSE_DATA.sequences.map((sequence,index) => ({ key: sequence.key, number: String(index+1).padStart(2,"0"), label: LABELS[sequence.key] || sequence.title }));

export function PoseDemo({ requestedDrill }: { requestedDrill?: PoseDemoRequest | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const playIconRef = useRef<HTMLSpanElement>(null);
  const scrubberRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<HTMLElement>(null);
  const phaseChipRef = useRef<HTMLSpanElement>(null);
  const telemetryPhaseRef = useRef<HTMLElement>(null);
  const { sequenceIndex, togglePlay, scrub, selectDrill } = usePoseDemo(POSE_DATA, {
    canvas: canvasRef,
    playButton: playButtonRef,
    playIcon: playIconRef,
    scrubber: scrubberRef,
    timer: timerRef,
    phaseChip: phaseChipRef,
    telemetryPhase: telemetryPhaseRef,
  });

  const sequence = POSE_DATA.sequences[sequenceIndex];
  const selectDrillRef = useRef(selectDrill);
  useEffect(() => { selectDrillRef.current = selectDrill; }, [selectDrill]);
  useEffect(() => { if (requestedDrill) selectDrillRef.current(requestedDrill.key); }, [requestedDrill]);


return (
          <div className="performance-stage reveal" aria-label="PoseTek performance analysis demo">
            <div className="session-mock">
              <div className="session-head"><span className="mini-mark">P</span><span><strong id="poseDrillTitle">{sequence.title}</strong><small id="poseSessionLabel">Recorded pose · identity removed</small></span><span className="sample-label">Recorded demo</span></div>
              <div className="pose-drill-switcher" role="group" aria-label="Choose a recorded pose demo" style={{ gridTemplateColumns: `repeat(${Math.min(3, DRILL_BUTTONS.length)}, minmax(0, 1fr))` }}>
                {DRILL_BUTTONS.map(button => {
                  const active = sequence.key === button.key;
                  return (
                    <button
                      key={button.key}
                      className={active ? "active" : ""}
                      type="button"
                      data-pose-drill={button.key}
                      aria-pressed={active}
                      onClick={() => selectDrill(button.key)}
                    >
                      <span>{button.number}</span>{button.label}
                    </button>
                  );
                })}
              </div>
              <div className="session-video">
                <div className="field-lines" aria-hidden="true" />
                <canvas id="landingPoseCanvas" ref={canvasRef} role="img" aria-label="Recorded anonymized MediaPipe pose playback" />
                <span className="video-chip">RECORDED POSE</span>
                <span className="pose-readout" aria-live="polite"><strong id="poseSequenceLabel">{sequence.label}</strong><small>33 joints tracked</small></span>
                <span className="pose-phase" id="posePhaseChip" ref={phaseChipRef}>{INITIAL_PHASE_CHIP}</span>
                <div className="pose-controls">
                  <button
                    className="pose-play"
                    id="posePlayButton"
                    ref={playButtonRef}
                    type="button"
                    aria-label="Play pose playback"
                    aria-pressed={false}
                    onClick={togglePlay}
                  >
                    <span id="posePlayIcon" ref={playIconRef} aria-hidden="true">▶</span>
                  </button>
                  <input
                    className="pose-scrubber"
                    id="poseScrubber"
                    ref={scrubberRef}
                    type="range"
                    min="0"
                    max={lastFrameIndex(sequence)}
                    defaultValue="0"
                    step="1"
                    aria-label="Pose playback position"
                    onInput={scrub}
                  />
                  <small className="pose-time" id="poseTimer" ref={timerRef}>{INITIAL_TIMER}</small>
                </div>
              </div>
              <div className="session-metrics" id="poseMetricGrid" style={{ gridTemplateColumns: `repeat(${sequence.metrics.length}, minmax(0, 1fr))` }}>
                {sequence.metrics.map(([label, value]) => (
                  <article key={label}><span>{label}</span><strong>{value}</strong></article>
                ))}
              </div>
            </div>
          </div>
);
}
