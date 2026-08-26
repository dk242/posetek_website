(function () {
  "use strict";

  const data = window.PoseTekLandingPoseData;
  const canvas = document.getElementById("landingPoseCanvas");
  if (!data || !canvas || data.layout !== "mediapipe33" || !Array.isArray(data.sequences)) return;

  const context = canvas.getContext("2d");
  const playButton = document.getElementById("posePlayButton");
  const playIcon = document.getElementById("posePlayIcon");
  const scrubber = document.getElementById("poseScrubber");
  const timer = document.getElementById("poseTimer");
  const phaseChip = document.getElementById("posePhaseChip");
  const sequenceLabel = document.getElementById("poseSequenceLabel");
  const drillTitle = document.getElementById("poseDrillTitle");
  const metricGrid = document.getElementById("poseMetricGrid");
  const drillButtons = Array.from(document.querySelectorAll("[data-pose-drill]"));
  const telemetryDrill = document.getElementById("telemetryDrill");
  const telemetryResult = document.getElementById("telemetryResult");
  const telemetryResultLabel = document.getElementById("telemetryResultLabel");
  const telemetryPhase = document.getElementById("telemetryPhase");
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  const mediaPipe33Edges = [
    [11, 12], [12, 24], [24, 23], [23, 11],
    [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
    [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
    [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
    [24, 26], [26, 28], [28, 30], [28, 32], [30, 32]
  ];

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
    viewport: { width: 1, height: 1, ratio: 1, scale: 1, offsetX: 0, offsetY: 0 }
  };

  function currentSequence() {
    return data.sequences[state.sequenceIndex];
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safe / 60);
    const remainder = safe - minutes * 60;
    return `${minutes}:${remainder.toFixed(2).padStart(5, "0")}`;
  }

  function updateFlap(element, value) {
    if (!element || element.textContent === value) return;
    if (reducedMotionQuery.matches) {
      element.textContent = value;
      return;
    }
    element.classList.remove("is-flipping");
    requestAnimationFrame(() => {
      element.classList.add("is-flipping");
      window.setTimeout(() => { element.textContent = value; }, 80);
      window.setTimeout(() => { element.classList.remove("is-flipping"); }, 190);
    });
  }

  function mapPoint(point) {
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
    const view = state.viewport;
    const contentHeight = view.scale;
    const contentWidth = data.sourceAspectRatio * view.scale;
    return {
      x: view.offsetX + point[0] * contentWidth,
      y: view.offsetY + point[1] * contentHeight
    };
  }

  function validPoint(frame, index) {
    return Array.isArray(frame?.[index]) ? frame[index] : null;
  }

  function hipCenter(frame) {
    const left = validPoint(frame, 23);
    const right = validPoint(frame, 24);
    if (!left || !right) return null;
    return [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
  }

  function phaseForChangeOfDirection(sequence, frameIndex) {
    if (frameIndex <= sequence.markers.startEnd) return { title: "Start", color: "#66c2ff" };
    if (frameIndex <= sequence.markers.turnEnd) return { title: "Turn", color: "#ffc969" };
    return { title: "End", color: "#71d39b" };
  }

  function phaseForBroadJump(sequence, frameIndex) {
    if (frameIndex < sequence.markers.takeoff) return { title: "Load", color: "#66c2ff" };
    if (frameIndex <= sequence.markers.landing) return { title: "Flight", color: "#b7f34a" };
    return { title: "Landing", color: "#ffc969" };
  }

  function drawPath(points, color, width, dashed) {
    const mappedPoints = points.map(mapPoint).filter(Boolean);
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

  function drawBroadJumpOverlay(sequence) {
    const overlay = sequence.overlays;
    const groundStart = mapPoint([0, overlay.groundY]);
    const groundEnd = mapPoint([1, overlay.groundY]);
    context.save();
    context.strokeStyle = "rgba(0,0,0,.75)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(groundStart.x, groundStart.y);
    context.lineTo(groundEnd.x, groundEnd.y);
    context.stroke();
    context.restore();

    [[overlay.takeoffX, "#71d39b"], [overlay.landingX, "#ff7d7d"]].forEach(([x, color]) => {
      const top = mapPoint([x, 0]);
      const bottom = mapPoint([x, 1]);
      drawPath([[x, 0], [x, 1]], color, 2, [7, 5]);
      context.save();
      context.fillStyle = color;
      context.beginPath();
      context.arc(bottom.x, bottom.y, 3, 0, Math.PI * 2);
      context.fill();
      context.restore();
    });

    const low = Math.max(0, state.frame - 24);
    drawPath(overlay.com.slice(low, state.frame + 1).filter(Boolean), "#66d6e8", 2);
    drawPath(overlay.foot.slice(low, state.frame + 1).filter(Boolean), "#ffad5c", 2);

    [[overlay.com[state.frame], "#66d6e8", 4], [overlay.foot[state.frame], "#ffad5c", 3.5]].forEach(([point, color, radius]) => {
      const mapped = mapPoint(point);
      if (!mapped) return;
      context.fillStyle = color;
      context.beginPath();
      context.arc(mapped.x, mapped.y, radius, 0, Math.PI * 2);
      context.fill();
    });

    const start = mapPoint([overlay.takeoffX, overlay.groundY]);
    const end = mapPoint([overlay.landingX, overlay.groundY]);
    const label = sequence.metrics[0][1];
    const centerX = (start.x + end.x) / 2;
    const labelY = Math.max(state.viewport.offsetY + 22, start.y - 17);
    context.save();
    context.fillStyle = "rgba(0,0,0,.72)";
    context.fillRect(centerX - 33, labelY - 14, 66, 22);
    context.fillStyle = "#f7fbf9";
    context.font = "700 11px 'IBM Plex Mono', monospace";
    context.textAlign = "center";
    context.fillText(label, centerX, labelY + 1);
    context.restore();
  }

  function drawChangeOfDirectionOverlay(sequence) {
    const phaseRanges = [
      { start: 0, end: sequence.markers.startEnd, color: "#66c2ff" },
      { start: sequence.markers.startEnd + 1, end: sequence.markers.turnEnd, color: "#ffc969" },
      { start: sequence.markers.turnEnd + 1, end: sequence.markers.end, color: "#71d39b" }
    ];
    phaseRanges.forEach(range => {
      const upper = Math.min(state.frame, range.end);
      if (upper < range.start) return;
      const centers = [];
      for (let index = range.start; index <= upper; index += 1) centers.push(hipCenter(sequence.frames[index]));
      drawPath(centers.filter(Boolean), range.color, 2.5);
    });
    const center = mapPoint(hipCenter(sequence.frames[state.frame]));
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

  function drawSkeleton(frame) {
    context.save();
    context.strokeStyle = "rgba(247,251,249,.96)";
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    mediaPipe33Edges.forEach(([firstIndex, secondIndex]) => {
      const first = mapPoint(validPoint(frame, firstIndex));
      const second = mapPoint(validPoint(frame, secondIndex));
      if (!first || !second) return;
      context.moveTo(first.x, first.y);
      context.lineTo(second.x, second.y);
    });
    context.stroke();
    frame.forEach(point => {
      const mapped = mapPoint(point);
      if (!mapped) return;
      context.fillStyle = "#b7f34a";
      context.beginPath();
      context.arc(mapped.x, mapped.y, 1.5, 0, Math.PI * 2);
      context.fill();
    });
    context.restore();
  }

  function updateDynamicLabels(sequence) {
    const elapsed = state.frame / data.fps;
    const total = Math.max(0, (sequence.frames.length - 1) / data.fps);
    const phase = sequence.key === "broadJump"
      ? phaseForBroadJump(sequence, state.frame)
      : phaseForChangeOfDirection(sequence, state.frame);
    timer.textContent = `${formatTime(elapsed)} / ${formatTime(total)}`;
    phaseChip.textContent = `${phase.title} · ${elapsed.toFixed(2)} s`;
    phaseChip.style.setProperty("--phase-color", phase.color);
    if (telemetryPhase && telemetryPhase.textContent !== phase.title) telemetryPhase.textContent = phase.title;
    scrubber.value = String(state.frame);
    scrubber.setAttribute("aria-valuetext", `${phase.title}, ${elapsed.toFixed(2)} seconds`);
  }

  function drawFrame() {
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

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const scale = Math.min(width / data.sourceAspectRatio, height);
    state.viewport = {
      width,
      height,
      ratio,
      scale,
      offsetX: (width - data.sourceAspectRatio * scale) / 2,
      offsetY: (height - scale) / 2
    };
    drawFrame();
  }

  function updatePlayControl() {
    playIcon.textContent = state.playing ? "Ⅱ" : "▶";
    playButton.setAttribute("aria-label", state.playing ? "Pause pose playback" : "Play pose playback");
    playButton.setAttribute("aria-pressed", String(state.playing));
  }

  function stopAnimation() {
    if (state.animationId) cancelAnimationFrame(state.animationId);
    state.animationId = 0;
    state.playing = false;
    state.lastTimestamp = 0;
    updatePlayControl();
  }

  function requestTick() {
    if (!state.animationId && state.playing && state.visible && !document.hidden) {
      state.animationId = requestAnimationFrame(tick);
    }
  }

  function startAnimation() {
    if (!state.visible || document.hidden) return;
    state.playing = true;
    state.lastTimestamp = 0;
    updatePlayControl();
    requestTick();
  }

  function selectSequence(index, autoplay) {
    state.sequenceIndex = (index + data.sequences.length) % data.sequences.length;
    state.frame = 0;
    state.accumulator = 0;
    state.endHold = 0;
    const sequence = currentSequence();
    if (reducedMotionQuery.matches && !autoplay) {
      state.frame = sequence.key === "broadJump" ? sequence.markers.takeoff : sequence.markers.turn;
    }
    drillTitle.textContent = sequence.title;
    sequenceLabel.textContent = sequence.label;
    const isBroadJump = sequence.key === "broadJump";
    updateFlap(telemetryDrill, isBroadJump ? "Broad jump" : "Agility");
    updateFlap(telemetryResult, isBroadJump ? sequence.metrics[0][1] : sequence.metrics[sequence.metrics.length - 1][1]);
    if (telemetryResultLabel) telemetryResultLabel.textContent = isBroadJump ? "Distance" : "Total";
    scrubber.max = String(sequence.frames.length - 1);
    metricGrid.replaceChildren(...sequence.metrics.map(([label, value]) => {
      const article = document.createElement("article");
      const labelElement = document.createElement("span");
      const valueElement = document.createElement("strong");
      labelElement.textContent = label;
      valueElement.textContent = value;
      article.append(labelElement, valueElement);
      return article;
    }));
    drillButtons.forEach(button => {
      const active = button.dataset.poseDrill === sequence.key;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    drawFrame();
    if (autoplay) startAnimation();
  }

  function tick(timestamp) {
    state.animationId = 0;
    if (!state.playing || !state.visible || document.hidden) return;
    if (!state.lastTimestamp) state.lastTimestamp = timestamp;
    const delta = Math.min(100, timestamp - state.lastTimestamp);
    state.lastTimestamp = timestamp;
    const sequence = currentSequence();
    if (state.frame >= sequence.frames.length - 1) {
      state.endHold += delta;
      if (state.endHold >= 650) selectSequence(state.sequenceIndex + 1, false);
    } else {
      state.accumulator += delta * data.fps / 1000;
      const advance = Math.floor(state.accumulator);
      if (advance > 0) {
        state.accumulator -= advance;
        state.frame = Math.min(sequence.frames.length - 1, state.frame + advance);
        drawFrame();
      }
    }
    requestTick();
  }

  playButton.addEventListener("click", () => {
    if (state.playing) {
      state.userPaused = true;
      stopAnimation();
      return;
    }
    if (state.frame >= currentSequence().frames.length - 1) state.frame = 0;
    state.userPaused = false;
    state.endHold = 0;
    drawFrame();
    startAnimation();
  });

  scrubber.addEventListener("input", event => {
    state.userPaused = true;
    stopAnimation();
    state.frame = Math.max(0, Math.min(currentSequence().frames.length - 1, Number(event.target.value) || 0));
    drawFrame();
  });

  drillButtons.forEach(button => button.addEventListener("click", () => {
    const index = data.sequences.findIndex(sequence => sequence.key === button.dataset.poseDrill);
    if (index < 0) return;
    stopAnimation();
    state.userPaused = reducedMotionQuery.matches;
    selectSequence(index, !state.userPaused);
  }));

  const observer = new IntersectionObserver(entries => {
    state.visible = Boolean(entries[0]?.isIntersecting);
    if (!state.visible) {
      if (state.animationId) cancelAnimationFrame(state.animationId);
      state.animationId = 0;
      state.lastTimestamp = 0;
      return;
    }
    if (!state.userPaused) startAnimation();
  }, { threshold: 0.2 });
  observer.observe(canvas);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (state.animationId) cancelAnimationFrame(state.animationId);
      state.animationId = 0;
      state.lastTimestamp = 0;
    } else if (!state.userPaused) {
      startAnimation();
    }
  });

  reducedMotionQuery.addEventListener?.("change", event => {
    if (event.matches) {
      state.userPaused = true;
      stopAnimation();
    }
  });

  const resizeObserver = new ResizeObserver(resizeCanvas);
  resizeObserver.observe(canvas);
  selectSequence(0, false);
  resizeCanvas();
})();
