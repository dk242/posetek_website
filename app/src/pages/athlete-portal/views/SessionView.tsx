// Port of athlete-portal.js renderSession/loadRepViewer/setupViewer. The
// imperative canvas/video sync lives in an effect whose cleanup mirrors the
// legacy destroyViewer().

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useState } from "react";
import type { Drill } from "../lib/drills";
import type { Access } from "../lib/loaders";
import { authArtifacts, fetchJson, sharedArtifacts } from "../lib/loaders";
import {
  frameMarkers,
  num,
  parsePose,
  repMetricSpecs,
  repNumber,
  sessionFolder,
  sessionNumber,
} from "../lib/metrics";
import type { FrameMarker, MetricTile, PosePoint } from "../lib/metrics";
import { PortalLoading } from "./shared";

interface SessionViewProps {
  drill: Drill;
  folder: string;
  selectedId: any;
  reps: any[];
  access: Access;
  playerId: string | null;
  shareToken: string | null;
  onBack: () => void;
  onSelectRep: (repId: any) => void;
}

export default function SessionView({ drill, folder, selectedId, reps, access, playerId, shareToken, onBack, onSelectRep }: SessionViewProps) {
  const sessionReps = reps
    .filter(rep => sessionFolder(rep) === folder)
    .sort((a, b) => repNumber(a) - repNumber(b));
  const selected = sessionReps.find(rep => String(rep.id) === String(selectedId)) || sessionReps[0];

  return (
    <section className="session-view">
      <div className="session-toolbar">
        <button className="quiet-button back-to-dashboard" type="button" id="backToDashboard" onClick={onBack}>
          <span className="material-symbols-outlined">arrow_back</span>
          <span>{drill.label}</span>
        </button>
        <strong>Session {num(folder.match(/\d+/)?.[0]) || (selected ? sessionNumber(selected) : 1)}</strong>
      </div>
      <nav className="rep-segments" aria-label="Session reps">
        {sessionReps.map(rep => (
          <button
            key={String(rep.id)}
            className={`rep-segment${rep === selected ? " active" : ""}`}
            type="button"
            data-session-rep={rep.id}
            onClick={() => onSelectRep(rep.id)}
          >
            Rep {repNumber(rep)}
          </button>
        ))}
      </nav>
      <section id="repViewer">
        {selected ? (
          <RepViewer
            key={`${drill.key}:${String(selected.id)}`}
            drill={drill}
            rep={selected}
            access={access}
            playerId={playerId}
            shareToken={shareToken}
          />
        ) : null}
      </section>
    </section>
  );
}

interface ViewerData {
  mediaUrl: string | null;
  frames: PosePoint[][];
  metrics: MetricTile[];
  markers: FrameMarker[];
}

interface RepViewerProps {
  drill: Drill;
  rep: any;
  access: Access;
  playerId: string | null;
  shareToken: string | null;
}

function RepViewer({ drill, rep, access, playerId, shareToken }: RepViewerProps) {
  const [data, setData] = useState<ViewerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sliderRef = useRef<HTMLInputElement | null>(null);
  const playRef = useRef<HTMLButtonElement | null>(null);
  const speedRef = useRef<HTMLButtonElement | null>(null);
  const viewerRef = useRef<{ setFrame: (next: unknown) => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const payload = access === "shared"
        ? await sharedArtifacts(drill, rep, shareToken)
        : await authArtifacts(drill, rep, playerId!);
      const urls = payload.artifactUrls || {};
      const [pose, metadata] = await Promise.all([
        fetchJson(urls["pose.json"]).catch(() => null),
        fetchJson(urls["metadata.json"]).catch(() => null),
      ]);
      if (cancelled) return;
      setData({
        mediaUrl: payload.mediaUrl || null,
        frames: parsePose(pose),
        metrics: repMetricSpecs(drill, rep, metadata || {}),
        markers: frameMarkers(drill, rep, metadata || {}),
      });
    })().catch(err => {
      console.error("[rep viewer]", err);
      if (!cancelled) setError(err?.message || "The rep files could not be opened.");
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // setupViewer — imperative canvas/video/slider wiring, verbatim from legacy.
  useEffect(() => {
    if (!data) return;
    const frames = data.frames;
    const canvas = canvasRef.current, stage = stageRef.current, slider = sliderRef.current;
    const play = playRef.current, speedButton = speedRef.current;
    if (!canvas || !stage || !slider || !play || !speedButton) return;
    const video = videoRef.current;
    let frame = 0, playing = false, rate = 1;
    let timer: ReturnType<typeof setInterval> | undefined;
    const rates = [.25, .5, 1, 2];

    function draw(index: number, dpr: number, width: number, height: number) {
      const ctx = canvas!.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const points = frames[index] || [];
      if (!points.length) return;
      let content = { x: 0, y: 0, w: width, h: height };
      if (video?.videoWidth) {
        const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
        content = {
          x: (width - video.videoWidth * scale) / 2,
          y: (height - video.videoHeight * scale) / 2,
          w: video.videoWidth * scale,
          h: video.videoHeight * scale,
        };
      }
      const max = Math.max(...points.flatMap(p => [p.x || 0, p.y || 0]), 1);
      const absolute = max > 2;
      const map = (p: PosePoint) => ({
        x: content.x + (absolute ? ((p.x as number) / (video?.videoWidth || max)) : (p.x as number)) * content.w,
        y: content.y + (absolute ? ((p.y as number) / (video?.videoHeight || max)) : (p.y as number)) * content.h,
      });
      const edges: [number, number][] = points.length <= 20
        ? [[0, 1], [0, 2], [1, 3], [2, 4], [5, 6], [5, 7], [7, 9], [6, 8], [8, 10], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]]
        : [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 29], [29, 31], [24, 26], [26, 28], [28, 30], [30, 32]];
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#b7f34a";
      ctx.shadowColor = "rgba(183,243,74,.5)";
      ctx.shadowBlur = 7;
      edges.forEach(([a, b]) => {
        const p = points[a], q = points[b];
        if (p && q && p.x !== null && p.y !== null && q.x !== null && q.y !== null) {
          const m = map(p), n = map(q);
          ctx.beginPath();
          ctx.moveTo(m.x, m.y);
          ctx.lineTo(n.x, n.y);
          ctx.stroke();
        }
      });
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#f7fbf9";
      points.forEach(p => {
        if (p && p.x !== null && p.y !== null) {
          const m = map(p);
          ctx.beginPath();
          ctx.arc(m.x, m.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    function resize() {
      const rect = stage!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.round(rect.width * dpr);
      canvas!.height = Math.round(rect.height * dpr);
      canvas!.style.width = `${rect.width}px`;
      canvas!.style.height = `${rect.height}px`;
      draw(frame, dpr, rect.width, rect.height);
    }

    function setFrame(next: unknown, seek = true) {
      frame = Math.max(0, Math.min(frames.length - 1, Number(next) || 0));
      slider!.value = String(frame);
      if (video && seek && video.duration && frames.length > 1) video.currentTime = frame / (frames.length - 1) * video.duration;
      draw(frame, Math.min(window.devicePixelRatio || 1, 2), stage!.clientWidth, stage!.clientHeight);
    }

    function toggle() {
      if (video) {
        if (video.paused) video.play();
        else video.pause();
        return;
      }
      playing = !playing;
      const icon = play!.querySelector("span");
      if (icon) icon.textContent = playing ? "pause" : "play_arrow";
      clearInterval(timer);
      if (playing) timer = setInterval(() => {
        if (frame >= frames.length - 1) {
          playing = false;
          clearInterval(timer);
          const endIcon = play!.querySelector("span");
          if (endIcon) endIcon.textContent = "play_arrow";
          return;
        }
        setFrame(frame + 1, false);
      }, 1000 / (30 * rate));
    }

    const onSliderInput = () => setFrame(slider.value);
    const onSpeedClick = () => {
      rate = rates[(rates.indexOf(rate) + 1) % rates.length];
      speedButton.textContent = `${rate}×`;
      if (video) video.playbackRate = rate;
      if (playing) {
        playing = false;
        toggle();
      }
    };
    play.addEventListener("click", toggle);
    slider.addEventListener("input", onSliderInput);
    speedButton.addEventListener("click", onSpeedClick);

    const videoHandlers: [string, EventListener][] = [];
    if (video) {
      const onLoaded = () => resize();
      const onTime = () => {
        if (frames.length > 1 && video.duration) setFrame(Math.round(video.currentTime / video.duration * (frames.length - 1)), false);
      };
      const onPlay = () => {
        const icon = play.querySelector("span");
        if (icon) icon.textContent = "pause";
      };
      const onPause = () => {
        const icon = play.querySelector("span");
        if (icon) icon.textContent = "play_arrow";
      };
      videoHandlers.push(["loadedmetadata", onLoaded], ["timeupdate", onTime], ["play", onPlay], ["pause", onPause]);
      videoHandlers.forEach(([name, handler]) => video.addEventListener(name, handler));
    }

    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();
    viewerRef.current = { setFrame };

    return () => {
      viewerRef.current = null;
      clearInterval(timer);
      observer.disconnect();
      play.removeEventListener("click", toggle);
      slider.removeEventListener("input", onSliderInput);
      speedButton.removeEventListener("click", onSpeedClick);
      if (video) {
        videoHandlers.forEach(([name, handler]) => video.removeEventListener(name, handler));
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
    };
  }, [data]);

  if (error !== null) {
    return (
      <div className="error-card">
        <span className="material-symbols-outlined">error</span>
        <h3>Analysis unavailable</h3>
        <p>{error}</p>
      </div>
    );
  }
  if (!data) return <PortalLoading message="Loading rep analysis…" />;

  return (
    <>
      <section className="pose-card">
        <div className="pose-stage" id="poseStage" ref={stageRef}>
          <span className="viewer-badge">{drill.label.toUpperCase()}</span>
          {data.mediaUrl ? <video id="poseVideo" ref={videoRef} playsInline preload="metadata" src={data.mediaUrl} /> : null}
          <canvas id="poseCanvas" ref={canvasRef} />
          {!data.mediaUrl && !data.frames.length ? <p className="viewer-empty">No video or pose data is available for this rep.</p> : null}
        </div>
        <div className="playback-bar">
          <button className="play-button" id="playButton" type="button" aria-label="Play" ref={playRef}>
            <span className="material-symbols-outlined">play_arrow</span>
          </button>
          <input
            id="frameSlider"
            ref={sliderRef}
            type="range"
            min={0}
            max={Math.max(0, data.frames.length - 1)}
            defaultValue={0}
            aria-label="Frame"
          />
          <button className="speed-button" id="speedButton" type="button" ref={speedRef}>1×</button>
        </div>
      </section>
      {data.markers.length ? (
        <div className="frame-markers">
          {data.markers.map(marker => (
            <button
              key={marker.label}
              className="frame-marker"
              type="button"
              data-frame={marker.frame}
              onClick={() => viewerRef.current?.setFrame(marker.frame)}
            >
              {marker.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="rep-metrics">
        {data.metrics.map(item => (
          <article key={item.label} className="rep-metric">
            <small>{item.label}</small>
            <strong>{item.value}</strong>
          </article>
        ))}
      </div>
    </>
  );
}
