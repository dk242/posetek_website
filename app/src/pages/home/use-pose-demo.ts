// Imperative half of the legacy landing-pose-demo.js port: canvas drawing, the
// requestAnimationFrame loop and the visibility / resize / reduced-motion
// listeners. Elements arrive through refs instead of getElementById and the
// hook tears everything down on unmount.
//
// React state only mirrors the current sequence index — it drives the drill
// title, label, metric grid, switcher buttons and telemetry flaps in
// HomePage.tsx. The per-frame hot path (canvas, timer, phase chip, scrubber
// value + aria-valuetext, phase telemetry, play button state) writes to the DOM
// directly, exactly like the legacy script, so a 60fps tick never re-renders
// the page. Those elements are rendered once with constant initial text so
// React never overwrites what the controller wrote.
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import {
  END_HOLD_MS,
  INITIAL_VIEWPORT,
  MEDIAPIPE33_EDGES,
  advanceFrame,
  backingStoreSize,
  broadJumpLabelY,
  changeOfDirectionPhaseRanges,
  clampFrame,
  elapsedSeconds,
  fitViewport,
  frameDelta,
  hipCenter,
  isPoseDemoData,
  lastFrameIndex,
  mapPoint,
  phaseChipText,
  phaseForChangeOfDirection,
  phaseForFrame,
  restingFrame,
  scrubberValueText,
  timerText,
  trailRange,
  validPoint,
  wrapSequenceIndex,
  type CanvasPoint,
  type PoseDemoData,
  type PoseFrame,
  type PosePoint,
  type PoseSequence,
  type PoseViewport,
} from "./pose-demo";

export interface PoseDemoElements {
  canvas: HTMLCanvasElement;
  playButton: HTMLButtonElement;
  playIcon: HTMLElement;
  scrubber: HTMLInputElement;
  timer: HTMLElement;
  phaseChip: HTMLElement;
  telemetryPhase: HTMLElement | null;
}

export interface PoseDemoController {
  /** Legacy `posePlayButton` click. */
  togglePlay(): void;
  /** Legacy `poseScrubber` input. */
  scrub(value: string): void;
  /** Legacy `[data-pose-drill]` click. */
  selectDrill(key: string): void;
  destroy(): void;
}

const isPoint = (point: PosePoint | null): point is PosePoint => Boolean(point);
const isCanvasPoint = (point: CanvasPoint | null): point is CanvasPoint => point !== null;

/**
 * Wires the demo exactly like the legacy IIFE did. Returns null (and does
 * nothing) when the data or canvas is unusable — legacy left the static markup
 * untouched in that case.
 */
export function createPoseDemoController(
  data: PoseDemoData,
  elements: PoseDemoElements,
  onSequenceChange: (index: number) => void,
): PoseDemoController | null {
  if (!isPoseDemoData(data)) return null;
  const { canvas, playButton, playIcon, scrubber, timer, phaseChip, telemetryPhase } = elements;
  const maybeContext = canvas.getContext("2d");
  if (!maybeContext) return null;
  const context: CanvasRenderingContext2D = maybeContext;
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  const state = {
    sequenceIndex: 0,
    frame: 0,
    playing: false,
    visible: false,
    userPaused: reducedMotionQuery.matches,
    lastTimestamp: 0,
    accumulator: 0,
    endHold: 0,
    animationId: 0,
    viewport: { ...INITIAL_VIEWPORT } as PoseViewport,
  };

  const currentSequence = (): PoseSequence => data.sequences[state.sequenceIndex];
  const project = (point: PosePoint | null | undefined): CanvasPoint | null =>
    mapPoint(point, state.viewport, data.sourceAspectRatio);

  function drawPath(points: (PosePoint | null)[], color: string, width: number, dashed?: number[]): void {
    const mappedPoints = points.map(project).filter(isCanvasPoint);
    if (mappedPoints.length < 2) return;
    context.save();
    if (dashed) context.setLineDash(dashed);
    context.strokeStyle = color;
    context.lineWidth = width;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(mappedPoints[0].x, mappedPoints[0].y);
    mappedPoints.slice(1).forEach(point => context.lineTo(point.x, point.y));
    context.stroke();
    context.restore();
  }

  function drawBroadJumpOverlay(sequence: PoseSequence): void {
    const overlay = sequence.overlays;
    if (!overlay) return;
    const groundStart = project([0, overlay.groundY]);
    const groundEnd = project([1, overlay.groundY]);
    if (!groundStart || !groundEnd) return;
    context.save();
    context.strokeStyle = "rgba(0,0,0,.75)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(groundStart.x, groundStart.y);
    context.lineTo(groundEnd.x, groundEnd.y);
    context.stroke();
    context.restore();

    ([[overlay.takeoffX, "#71d39b"], [overlay.landingX, "#ff7d7d"]] as const).forEach(([x, color]) => {
      const bottom = project([x, 1]);
      drawPath([[x, 0], [x, 1]], color, 2, [7, 5]);
      if (!bottom) return;
      context.save();
      context.fillStyle = color;
      context.beginPath();
      context.arc(bottom.x, bottom.y, 3, 0, Math.PI * 2);
      context.fill();
      context.restore();
    });

    const trail = trailRange(state.frame);
    drawPath(overlay.com.slice(trail.start, trail.end).filter(isPoint), "#66d6e8", 2);
    drawPath(overlay.foot.slice(trail.start, trail.end).filter(isPoint), "#ffad5c", 2);

    ([[overlay.com[state.frame], "#66d6e8", 4], [overlay.foot[state.frame], "#ffad5c", 3.5]] as const).forEach(
      ([point, color, radius]) => {
        const mapped = project(point);
        if (!mapped) return;
        context.fillStyle = color;
        context.beginPath();
        context.arc(mapped.x, mapped.y, radius, 0, Math.PI * 2);
        context.fill();
      },
    );

    const start = project([overlay.takeoffX, overlay.groundY]);
    const end = project([overlay.landingX, overlay.groundY]);
    if (!start || !end) return;
    const label = sequence.metrics[0][1];
    const centerX = (start.x + end.x) / 2;
    const labelY = broadJumpLabelY(state.viewport.offsetY, start.y);
    context.save();
    context.fillStyle = "rgba(0,0,0,.72)";
    context.fillRect(centerX - 33, labelY - 14, 66, 22);
    context.fillStyle = "#f7fbf9";
    context.font = "700 11px 'IBM Plex Mono', monospace";
    context.textAlign = "center";
    context.fillText(label, centerX, labelY + 1);
    context.restore();
  }

  function drawChangeOfDirectionOverlay(sequence: PoseSequence): void {
    changeOfDirectionPhaseRanges(sequence).forEach(range => {
      const upper = Math.min(state.frame, range.end);
      if (upper < range.start) return;
      const centers: (PosePoint | null)[] = [];
      for (let index = range.start; index <= upper; index += 1) centers.push(hipCenter(sequence.frames[index]));
      drawPath(centers.filter(isPoint), range.color, 2.5);
    });
    const center = project(hipCenter(sequence.frames[state.frame]));
    if (!center) return;
    const phase = phaseForChangeOfDirection(sequence, state.frame);
    context.fillStyle = phase.color;
    context.beginPath();
    context.arc(center.x, center.y, 4.5, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#fff";
    context.lineWidth = 1;
    context.stroke();
  }

  function drawSkeleton(frame: PoseFrame): void {
    context.save();
    context.strokeStyle = "rgba(247,251,249,.96)";
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    MEDIAPIPE33_EDGES.forEach(([firstIndex, secondIndex]) => {
      const first = project(validPoint(frame, firstIndex));
      const second = project(validPoint(frame, secondIndex));
      if (!first || !second) return;
      context.moveTo(first.x, first.y);
      context.lineTo(second.x, second.y);
    });
    context.stroke();
    frame.forEach(point => {
      const mapped = project(point);
      if (!mapped) return;
      context.fillStyle = "#b7f34a";
      context.beginPath();
      context.arc(mapped.x, mapped.y, 1.5, 0, Math.PI * 2);
      context.fill();
    });
    context.restore();
  }

  function updateDynamicLabels(sequence: PoseSequence): void {
    const elapsed = elapsedSeconds(state.frame, data.fps);
    const phase = phaseForFrame(sequence, state.frame);
    timer.textContent = timerText(state.frame, sequence, data.fps);
    phaseChip.textContent = phaseChipText(phase, elapsed);
    phaseChip.style.setProperty("--phase-color", phase.color);
    if (telemetryPhase && telemetryPhase.textContent !== phase.title) telemetryPhase.textContent = phase.title;
    scrubber.value = String(state.frame);
    scrubber.setAttribute("aria-valuetext", scrubberValueText(phase, elapsed));
  }

  function drawFrame(): void {
    const sequence = currentSequence();
    const frame = sequence.frames[state.frame] || sequence.frames[0];
    const view = state.viewport;
    context.setTransform(view.ratio, 0, 0, view.ratio, 0, 0);
    context.clearRect(0, 0, view.width, view.height);
    if (sequence.key === "broadJump") drawBroadJumpOverlay(sequence);
    else drawChangeOfDirectionOverlay(sequence);
    drawSkeleton(frame);
    updateDynamicLabels(sequence);
  }

  function resizeCanvas(): void {
    const rect = canvas.getBoundingClientRect();
    state.viewport = fitViewport(rect.width, rect.height, window.devicePixelRatio, data.sourceAspectRatio);
    const pixels = backingStoreSize(state.viewport);
    if (canvas.width !== pixels.width || canvas.height !== pixels.height) {
      canvas.width = pixels.width;
      canvas.height = pixels.height;
    }
    drawFrame();
  }

  function updatePlayControl(): void {
    playIcon.textContent = state.playing ? "Ⅱ" : "▶";
    playButton.setAttribute("aria-label", state.playing ? "Pause pose playback" : "Play pose playback");
    playButton.setAttribute("aria-pressed", String(state.playing));
  }

  function stopAnimation(): void {
    if (state.animationId) cancelAnimationFrame(state.animationId);
    state.animationId = 0;
    state.playing = false;
    state.lastTimestamp = 0;
    updatePlayControl();
  }

  function requestTick(): void {
    if (!state.animationId && state.playing && state.visible && !document.hidden) {
      state.animationId = requestAnimationFrame(tick);
    }
  }

  function startAnimation(): void {
    if (!state.visible || document.hidden) return;
    state.playing = true;
    state.lastTimestamp = 0;
    updatePlayControl();
    requestTick();
  }

  function selectSequence(index: number, autoplay: boolean): void {
    state.sequenceIndex = wrapSequenceIndex(index, data.sequences.length);
    state.accumulator = 0;
    state.endHold = 0;
    const sequence = currentSequence();
    state.frame = restingFrame(sequence, reducedMotionQuery.matches, autoplay);
    // Legacy set `scrubber.max` here too. React also renders it from state, but
    // the imperative write lands before drawFrame() sets the value below, so a
    // reduced-motion resting frame beyond the previous max isn't clamped.
    scrubber.max = String(lastFrameIndex(sequence));
    // Title, label, metric grid, switcher state and telemetry flaps render from
    // React state (legacy rewrote those nodes here).
    onSequenceChange(state.sequenceIndex);
    drawFrame();
    if (autoplay) startAnimation();
  }

  function tick(timestamp: number): void {
    state.animationId = 0;
    if (!state.playing || !state.visible || document.hidden) return;
    if (!state.lastTimestamp) state.lastTimestamp = timestamp;
    const delta = frameDelta(timestamp, state.lastTimestamp);
    state.lastTimestamp = timestamp;
    const sequence = currentSequence();
    if (state.frame >= lastFrameIndex(sequence)) {
      state.endHold += delta;
      if (state.endHold >= END_HOLD_MS) selectSequence(state.sequenceIndex + 1, false);
    } else {
      const next = advanceFrame(state.frame, state.accumulator, delta, data.fps, lastFrameIndex(sequence));
      state.accumulator = next.accumulator;
      if (next.advanced) {
        state.frame = next.frame;
        drawFrame();
      }
    }
    requestTick();
  }

  const observer = new IntersectionObserver(
    entries => {
      state.visible = Boolean(entries[0]?.isIntersecting);
      if (!state.visible) {
        if (state.animationId) cancelAnimationFrame(state.animationId);
        state.animationId = 0;
        state.lastTimestamp = 0;
        return;
      }
      if (!state.userPaused) startAnimation();
    },
    { threshold: 0.2 },
  );
  observer.observe(canvas);

  const onVisibilityChange = (): void => {
    if (document.hidden) {
      if (state.animationId) cancelAnimationFrame(state.animationId);
      state.animationId = 0;
      state.lastTimestamp = 0;
    } else if (!state.userPaused) {
      startAnimation();
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  const onMotionPreferenceChange = (event: MediaQueryListEvent): void => {
    if (event.matches) {
      state.userPaused = true;
      stopAnimation();
    }
  };
  reducedMotionQuery.addEventListener?.("change", onMotionPreferenceChange);

  const resizeObserver = new ResizeObserver(() => resizeCanvas());
  resizeObserver.observe(canvas);
  selectSequence(0, false);
  resizeCanvas();

  return {
    togglePlay() {
      if (state.playing) {
        state.userPaused = true;
        stopAnimation();
        return;
      }
      if (state.frame >= lastFrameIndex(currentSequence())) state.frame = 0;
      state.userPaused = false;
      state.endHold = 0;
      drawFrame();
      startAnimation();
    },
    scrub(value: string) {
      state.userPaused = true;
      stopAnimation();
      state.frame = clampFrame(value, lastFrameIndex(currentSequence()));
      drawFrame();
    },
    selectDrill(key: string) {
      const index = data.sequences.findIndex(sequence => sequence.key === key);
      if (index < 0) return;
      stopAnimation();
      state.userPaused = reducedMotionQuery.matches;
      selectSequence(index, !state.userPaused);
    },
    destroy() {
      if (state.animationId) cancelAnimationFrame(state.animationId);
      state.animationId = 0;
      state.playing = false;
      observer.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reducedMotionQuery.removeEventListener?.("change", onMotionPreferenceChange);
    },
  };
}

export interface PoseDemoRefs {
  canvas: RefObject<HTMLCanvasElement | null>;
  playButton: RefObject<HTMLButtonElement | null>;
  playIcon: RefObject<HTMLSpanElement | null>;
  scrubber: RefObject<HTMLInputElement | null>;
  timer: RefObject<HTMLElement | null>;
  phaseChip: RefObject<HTMLSpanElement | null>;
  telemetryPhase: RefObject<HTMLElement | null>;
}

/**
 * Mounts the controller against the page's ref'd elements (one ref per legacy
 * element id) and mirrors the current sequence index into React state.
 */
export function usePoseDemo(data: PoseDemoData, refs: PoseDemoRefs) {
  const { canvas, playButton, playIcon, scrubber, timer, phaseChip, telemetryPhase } = refs;
  const controllerRef = useRef<PoseDemoController | null>(null);
  const [sequenceIndex, setSequenceIndex] = useState(0);

  useEffect(() => {
    const canvasElement = canvas.current;
    const playButtonElement = playButton.current;
    const playIconElement = playIcon.current;
    const scrubberElement = scrubber.current;
    const timerElement = timer.current;
    const phaseChipElement = phaseChip.current;
    if (
      !canvasElement || !playButtonElement || !playIconElement || !scrubberElement || !timerElement || !phaseChipElement
    ) {
      return;
    }
    const controller = createPoseDemoController(
      data,
      {
        canvas: canvasElement,
        playButton: playButtonElement,
        playIcon: playIconElement,
        scrubber: scrubberElement,
        timer: timerElement,
        phaseChip: phaseChipElement,
        telemetryPhase: telemetryPhase.current,
      },
      setSequenceIndex,
    );
    if (!controller) return;
    controllerRef.current = controller;
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, [data, canvas, playButton, playIcon, scrubber, timer, phaseChip, telemetryPhase]);

  return {
    sequenceIndex,
    togglePlay: () => controllerRef.current?.togglePlay(),
    scrub: (event: FormEvent<HTMLInputElement>) => controllerRef.current?.scrub(event.currentTarget.value),
    selectDrill: (key: string) => controllerRef.current?.selectDrill(key),
  };
}
