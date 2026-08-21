// Port of the legacy renderRep()/playback code. The static structure is JSX; the
// per-frame updates (canvas, chips, slider, dynamic COM metric) stay imperative via
// refs, exactly mirroring the legacy DOM writes, with cleanup on unmount.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useRef, useState } from "react";
import type { PageDrillConfig } from "./drill-config";
import {
  asNumber,
  markerDefs,
  metersToInches,
  normalizeFrames,
  repMetricCards,
  resolveShuttleBounds,
  shuttlePhaseAt,
  type Rep,
} from "./drill-lib";
import { drawPoseFrame } from "./drawing";

export interface RepViewerProps {
  config: PageDrillConfig;
  rep: Rep;
  artifacts: Record<string, any>;
}

export default function RepViewer({ config, rep, artifacts }: RepViewerProps) {
  const frames = useMemo(() => normalizeFrames(artifacts["pose.json"]), [artifacts]);
  const meta = (artifacts["metadata.json"] || {}) as Record<string, any>;

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sliderRef = useRef<HTMLInputElement | null>(null);
  const frameChipRef = useRef<HTMLSpanElement | null>(null);
  const phaseChipRef = useRef<HTMLSpanElement | null>(null);
  const frameCountRef = useRef<HTMLSpanElement | null>(null);
  const currentHeightRef = useRef<HTMLSpanElement | null>(null);

  const frameRef = useRef(0);
  const playingRef = useRef(false);
  const speedRef = useRef(0.5);
  const animationRef = useRef(0);
  const lastTickRef = useRef(0);
  const frameAccumulatorRef = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(0.5);

  function updateDynamicMetrics() {
    if (config.key !== "broadJump") return;
    const heightSeries = artifacts["com_height.json"];
    const currentHeight = Array.isArray(heightSeries) ? asNumber(heightSeries[frameRef.current]) : null;
    if (currentHeightRef.current) {
      currentHeightRef.current.textContent = currentHeight === null ? "—" : `${metersToInches(currentHeight).toFixed(1)} in`;
    }
  }

  function updatePhaseChip() {
    const chip = phaseChipRef.current;
    if (!chip) return;
    if (config.key === "broadJump") {
      const heights = artifacts["com_height.json"];
      const value = Array.isArray(heights) ? asNumber(heights[frameRef.current]) : null;
      chip.classList.toggle("hidden", value === null);
      if (value !== null) {
        chip.style.color = "#fff";
        chip.textContent = `COM ${metersToInches(value).toFixed(1)} in`;
      }
      return;
    }
    const bounds = resolveShuttleBounds(meta, rep);
    const phase = shuttlePhaseAt(frameRef.current, bounds);
    const start = bounds.start;
    const fps = asNumber(meta.framesPerSecond) || 120;
    chip.classList.toggle("hidden", !phase);
    if (phase) {
      const elapsed = start === null ? 0 : Math.max(0, frameRef.current - start) / fps;
      chip.style.color = phase.color;
      chip.textContent = `${phase.title} · ${elapsed.toFixed(2)} s`;
    }
  }

  function drawFrame() {
    const canvas = canvasRef.current;
    if (canvas) {
      drawPoseFrame({ canvas, frames, frameIndex: frameRef.current, drillKey: config.key, artifacts, rep });
    }
    updatePhaseChip();
  }

  function setFrame(frame: number) {
    const max = Math.max(0, frames.length - 1);
    frameRef.current = Math.max(0, Math.min(max, Number.isFinite(frame) ? Math.round(frame) : 0));
    if (sliderRef.current) sliderRef.current.value = String(frameRef.current);
    if (frameChipRef.current) frameChipRef.current.textContent = `Frame ${frameRef.current + 1}`;
    if (frameCountRef.current) frameCountRef.current.textContent = `Frame ${frameRef.current + 1}`;
    updateDynamicMetrics();
    drawFrame();
  }

  function playbackTick(now: number) {
    if (!playingRef.current) return;
    const fps = asNumber(meta.framesPerSecond) || 120;
    const elapsed = Math.min(100, now - lastTickRef.current) / 1000;
    lastTickRef.current = now;
    frameAccumulatorRef.current += elapsed * fps * speedRef.current;
    const advance = Math.floor(frameAccumulatorRef.current);
    if (advance > 0) {
      frameAccumulatorRef.current -= advance;
      if (frameRef.current + advance >= frames.length) {
        setFrame(frames.length - 1);
        stopPlayback();
        return;
      }
      setFrame(frameRef.current + advance);
    }
    animationRef.current = requestAnimationFrame(playbackTick);
  }

  function togglePlayback() {
    if (!frames.length) return;
    const next = !playingRef.current;
    playingRef.current = next;
    setPlaying(next);
    if (next) {
      if (frameRef.current >= frames.length - 1) setFrame(0);
      lastTickRef.current = performance.now();
      frameAccumulatorRef.current = 0;
      animationRef.current = requestAnimationFrame(playbackTick);
    } else {
      cancelAnimationFrame(animationRef.current);
    }
  }

  function stopPlayback() {
    playingRef.current = false;
    setPlaying(false);
    cancelAnimationFrame(animationRef.current);
  }

  function cycleSpeed() {
    const speeds = [0.25, 0.5, 1];
    const next = speeds[(speeds.indexOf(speedRef.current) + 1) % speeds.length];
    speedRef.current = next;
    setSpeed(next);
  }

  useEffect(() => {
    updateDynamicMetrics();
    drawFrame();
    let observer: ResizeObserver | null = null;
    if (stageRef.current && window.ResizeObserver) {
      observer = new ResizeObserver(() => drawFrame());
      observer.observe(stageRef.current);
    }
    return () => {
      playingRef.current = false;
      cancelAnimationFrame(animationRef.current);
      observer?.disconnect();
    };
    // Mount-only: a new rep/artifact load remounts this component (keyed by parent).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markers = markerDefs(config.key, artifacts, rep);
  const cards = repMetricCards(config.key, artifacts, rep);
  const coachNote = config.key === "broadJump"
    ? "Use Takeoff and Landing to inspect launch angle, arm swing, full hip extension, and whether the athlete can hold the landing without falling backward."
    : "Use Start, Turn, and Finish to inspect braking steps, hip height at the plant, outside-foot position, and the first two acceleration steps out of the turn.";

  return (
    <div className="viewer-layout">
      <div>
        <div className="viewer-stage" id="viewerStage" ref={stageRef}>
          <canvas id="poseCanvas" aria-label="Pose playback for the selected rep" ref={canvasRef} />
          <span className="viewer-title">{config.title}</span>
          <span id="frameChip" className="frame-chip" ref={frameChipRef}>Frame 1</span>
          <span id="phaseChip" className="phase-chip hidden" ref={phaseChipRef} />
        </div>
        <div className="playback-controls">
          <button
            id="playButton"
            className="control-button"
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            onClick={togglePlayback}
          >
            <span className="material-symbols-outlined">{playing ? "pause" : "play_arrow"}</span>
          </button>
          <div className="scrubber-wrap">
            <input
              id="frameSlider"
              className="frame-slider"
              type="range"
              min={0}
              max={Math.max(0, frames.length - 1)}
              defaultValue={0}
              aria-label="Frame"
              ref={sliderRef}
              onInput={event => setFrame(Number((event.target as HTMLInputElement).value))}
            />
            <div className="frame-meta">
              <span id="frameCount" ref={frameCountRef}>Frame 1</span>
              <span>{frames.length} total</span>
            </div>
          </div>
          <button id="speedButton" className="speed-button" type="button" aria-label="Playback speed" onClick={cycleSpeed}>
            {speed}×
          </button>
        </div>
        <div id="markerRow" className="marker-row">
          {markers.map(marker => (
            <button
              key={marker.label}
              className="marker-button"
              type="button"
              data-frame={marker.frame === null ? "" : marker.frame}
              disabled={marker.frame === null}
              onClick={() => {
                if (marker.frame !== null) setFrame(marker.frame);
              }}
            >
              <span className="material-symbols-outlined">{marker.icon}</span> {marker.label}
            </button>
          ))}
        </div>
        {frames.length ? null : (
          <div className="coach-note">
            <strong>Pose playback unavailable</strong>
            <p>The summary metrics are available, but this rep's pose.json artifact could not be loaded. Raw video uploads are optional for locally processed drills.</p>
          </div>
        )}
      </div>
      <aside>
        <div id="metricGrid" className="metric-grid">
          {cards.map(card => (
            <article key={card.label} className="metric-card">
              <span className="material-symbols-outlined">{card.icon}</span>
              <span
                id={card.dynamicId || undefined}
                ref={card.dynamicId ? currentHeightRef : undefined}
                className="metric-value"
              >
                {card.value}
              </span>
              <span className="metric-label">{card.label}</span>
            </article>
          ))}
        </div>
        <div className="coach-note">
          <strong>What to review</strong>
          <p>{coachNote}</p>
        </div>
      </aside>
    </div>
  );
}
