// Port of athlete-mobile-pages.js renderBodyProfile/setupBodyCanvas.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { fullName } from "../lib/metrics";
import {
  LIMBS,
  POSE_CONNECTIONS,
  heightText,
  nearestLimb,
  normalizePose,
  number,
  weightText,
} from "../lib/mobile";
import type { BodyPoint } from "../lib/mobile";
import { listBodyScans, storageJson } from "../lib/loaders";
import { PREVIEW_LIMB_LENGTHS, PREVIEW_LIMB_WEIGHTS, previewBodyPoints } from "../lib/preview";
import { EmptyState, LockedPage, PageHero } from "./shared";
import type { PortalContext } from "./shared";

interface ScanState {
  phase: "loading" | "none" | "error" | "ready";
  statusText: string;
  countText: string;
  points: BodyPoint[];
  maskUrl: string | null;
  lengths: Record<string, any>;
  weights: Record<string, any>;
}

export default function BodyProfileView({ ctx }: { ctx: PortalContext }) {
  if (ctx.access === "shared") {
    return <LockedPage title="Body Profile" copy="Body-scan measurements are private health-adjacent data." />;
  }
  return <BodyProfileContent ctx={ctx} />;
}

function BodyProfileContent({ ctx }: { ctx: PortalContext }) {
  const [scan, setScan] = useState<ScanState>(() =>
    ctx.access === "preview"
      ? {
          phase: "ready",
          statusText: "Latest scan · preview",
          countText: "1 scan",
          points: previewBodyPoints(),
          maskUrl: null,
          lengths: PREVIEW_LIMB_LENGTHS,
          weights: PREVIEW_LIMB_WEIGHTS,
        }
      : { phase: "loading", statusText: "Finding the latest scan…", countText: "—", points: [], maskUrl: null, lengths: {}, weights: {} },
  );
  const [selected, setSelected] = useState<string[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const drawRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (ctx.access === "preview") return;
    let cancelled = false;
    (async () => {
      const scans = await listBodyScans(ctx.playerId!);
      if (cancelled) return;
      const countText = `${scans.length}/${ctx.access === "athlete" || ctx.access === "preview" ? 3 : 2} scans`;
      if (!scans.length) {
        setScan(prev => ({ ...prev, phase: "none", statusText: "No body scans yet", countText }));
        return;
      }
      const latest = scans[0].ref;
      setScan(prev => ({ ...prev, statusText: `Latest scan · Scan ${scans[0].number}`, countText }));
      const [pose, lengths, weights, maskUrl] = await Promise.all([
        storageJson(latest.child("pose.json")),
        storageJson(latest.child("limb_length_library.json")).catch(() => ({})),
        storageJson(latest.child("limb_weights_library.json")).catch(() => ({})),
        latest.child("human_mask.png").getDownloadURL().catch(() => null),
      ]);
      if (cancelled) return;
      setScan(prev => ({
        ...prev,
        phase: "ready",
        points: normalizePose(pose),
        maskUrl,
        lengths: lengths || {},
        weights: weights || {},
      }));
    })().catch(error => {
      console.error("[body profile]", error);
      if (cancelled) return;
      setScan(prev => ({ ...prev, phase: "error", statusText: "Body scan unavailable" }));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mask image (drawn at .28 alpha under the skeleton).
  useEffect(() => {
    if (scan.phase !== "ready" || !scan.maskUrl) {
      imageRef.current = null;
      return;
    }
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => drawRef.current?.();
    image.src = scan.maskUrl;
    imageRef.current = image;
    return () => { image.onload = null; };
  }, [scan.phase, scan.maskUrl]);

  // setupBodyCanvas draw loop + ResizeObserver.
  useEffect(() => {
    if (scan.phase !== "ready" || !scan.points.length) return;
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    const points = scan.points;
    const mapPoint = (point: { x: number | null; y: number | null }) => ({
      x: (point.x ?? 0) * canvas.clientWidth,
      y: (point.y ?? 0) * canvas.clientHeight,
    });
    const draw = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2d.clearRect(0, 0, rect.width, rect.height);
      const image = imageRef.current;
      if (image && image.complete && image.naturalWidth) {
        ctx2d.globalAlpha = .28;
        ctx2d.drawImage(image, 0, 0, rect.width, rect.height);
        ctx2d.globalAlpha = 1;
      }
      POSE_CONNECTIONS.forEach(edge => {
        const a = points[edge[0]], b = points[edge[1]];
        if (!a || !b || a.x === null || b.x === null) return;
        const limb = LIMBS.find(item => item.edge[0] === edge[0] && item.edge[1] === edge[1]);
        const active = Boolean(limb && selected.includes(limb.name));
        const p = mapPoint(a), q = mapPoint(b);
        ctx2d.strokeStyle = active ? "#ffffff" : "#b7f34a";
        ctx2d.lineWidth = active ? 8 : 4;
        ctx2d.shadowColor = active ? "rgba(255,255,255,.75)" : "rgba(183,243,74,.45)";
        ctx2d.shadowBlur = active ? 14 : 7;
        ctx2d.beginPath();
        ctx2d.moveTo(p.x, p.y);
        ctx2d.lineTo(q.x, q.y);
        ctx2d.stroke();
      });
      ctx2d.shadowBlur = 0;
      ctx2d.fillStyle = "#f7fbf9";
      points.forEach(point => {
        if (point.x === null || point.y === null || point.visibility < .2) return;
        const p = mapPoint(point);
        ctx2d.beginPath();
        ctx2d.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx2d.fill();
      });
    };
    drawRef.current = draw;
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    draw();
    return () => {
      observer.disconnect();
      drawRef.current = null;
    };
  }, [scan, selected]);

  const onCanvasClick = (event: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !scan.points.length) return;
    const rect = canvas.getBoundingClientRect();
    const click = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const nearest = nearestLimb(scan.points, click, canvas.clientWidth, canvas.clientHeight);
    if (!nearest) return;
    setSelected(prev => prev.includes(nearest.name) ? prev.filter(name => name !== nearest.name) : [...prev, nearest.name]);
  };

  const selectedLimbs = selected.map(name => LIMBS.find(item => item.name === name)).filter((limb): limb is NonNullable<typeof limb> => Boolean(limb));
  const height = number(ctx.athlete?.height);
  const weightKg = number(ctx.athlete?.weight);
  const canvasReady = scan.phase === "ready" && scan.points.length > 0;

  return (
    <section className="mobile-page body-profile-page">
      <PageHero eyebrow="Mobile profile" title="Body Profile" description="Your latest 33-point body scan and physical measurements." icon="accessibility_new" />
      <section className="body-profile-grid">
        <article className="portal-card body-scan-card">
          <div className="card-heading">
            <div>
              <h2>{fullName(ctx.athlete)}</h2>
              <p id="bodyScanStatus">{scan.statusText}</p>
            </div>
            <span className="scan-count" id="bodyScanCount">{scan.countText}</span>
          </div>
          <div className="body-canvas-wrap" id="bodyCanvasWrap" ref={wrapRef}>
            {scan.phase === "none" ? (
              <EmptyState icon="accessibility_new" title="No scan available" message="Complete a body scan in the mobile app to build this profile." />
            ) : scan.phase === "error" ? (
              <EmptyState icon="cloud_off" title="Could not load the scan" message="The athlete record is available, but the latest body-scan files could not be opened." />
            ) : (
              <>
                <canvas id="bodyPoseCanvas" ref={canvasRef} aria-label="Interactive body scan" onClick={onCanvasClick} />
                {!canvasReady && <p>Loading body scan…</p>}
              </>
            )}
          </div>
          <p className="body-hint"><span className="material-symbols-outlined">touch_app</span>Tap a body segment to inspect its measurement.</p>
        </article>
        <div className="body-profile-details">
          <section className="portal-card">
            <div className="card-heading"><div><h2>Physical Profile</h2><p>From the athlete record</p></div></div>
            <div className="physical-stat-row">
              <article><small>Height</small><strong id="bodyHeight">{heightText(height)}</strong></article>
              <article><small>Weight</small><strong id="bodyWeight">{weightText(weightKg)}</strong></article>
            </div>
          </section>
          <section className="portal-card">
            <div className="card-heading">
              <div>
                <h2>Measurements</h2>
                <p id="measurementPrompt">{selectedLimbs.length ? `${selectedLimbs.length} selected` : "Select a body segment"}</p>
              </div>
              <button className="text-button" id="clearLimbs" type="button" onClick={() => setSelected([])}>Clear</button>
            </div>
            <div className="limb-measurements" id="limbMeasurements">
              {selectedLimbs.length ? selectedLimbs.map(limb => {
                const inches = number(scan.lengths[limb.length]);
                const pounds = number(scan.weights[limb.weight]);
                return (
                  <article key={limb.name}>
                    <strong>{limb.name}</strong>
                    <span>{inches === null ? "—" : `${(inches * 39.3701).toFixed(1)} in`}</span>
                    <span>{pounds === null ? "—" : `${(pounds * 2.20462).toFixed(1)} lbs`}</span>
                  </article>
                );
              }) : <p className="measurement-empty">Tap a highlighted limb on the scan.</p>}
            </div>
          </section>
          <section className="portal-card scan-note">
            <span className="material-symbols-outlined">photo_camera</span>
            <div>
              <h3>Capture on mobile</h3>
              <p>The body scan uses the iPhone capture flow for camera calibration and processing. New scans taken in the app appear here automatically.</p>
            </div>
          </section>
        </div>
      </section>
    </section>
  );
}
