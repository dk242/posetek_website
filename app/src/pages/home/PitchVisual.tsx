import { useEffect, useRef, useState } from "react";
import { HERO_POSES, HERO_HOLD_MS, heroPose, nextHeroPose, shouldAnimateHero, type HeroLayer, type HeroPoseId, type OrbitAction, type PitchHandle, type PitchView } from "./latest-hero/pose-model";
import { PoseFallback } from "./latest-hero/PoseFallback";
import "./latest-hero/hero-viewer.css";

export function PitchVisual() {
  const hostRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const handle = useRef<PitchHandle | null>(null);
  const interactionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [selected, setSelected] = useState<HeroPoseId>("shooting");
  const layer: HeroLayer = "skeleton";
  const [cycling, setCycling] = useState(true);
  const [interacting, setInteracting] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const rotating = shouldAnimateHero(active, cycling, reducedMotion, interacting);
  const view = useRef<PitchView>({ pose: selected, layer, reducedMotion, rotating: false, command: 0, action: "reset" });
  const pose = heroPose(selected);

  const interactionStart = () => { clearTimeout(interactionTimer.current); setInteracting(true); };
  const interactionEnd = () => {
    clearTimeout(interactionTimer.current);
    interactionTimer.current = setTimeout(() => setInteracting(false), 1500);
  };
  const command = (action: OrbitAction) => {
    interactionStart();
    view.current = { ...view.current, rotating: false, command: view.current.command + 1, action };
    handle.current?.update(view.current);
    interactionEnd();
  };
  const selectPose = (id: HeroPoseId) => { interactionStart(); setCycling(false); setSelected(id); interactionEnd(); };

  useEffect(() => {
    view.current = { ...view.current, pose: selected, layer, reducedMotion, rotating };
    handle.current?.update(view.current);
  }, [selected, layer, reducedMotion, rotating]);

  useEffect(() => {
    if (!rotating || failed || !ready) return;
    const timer = setTimeout(() => setSelected(nextHeroPose(selected)), HERO_HOLD_MS);
    return () => clearTimeout(timer);
  }, [rotating, selected, failed, ready]);

  useEffect(() => {
    const host = wrapperRef.current;
    if (!host) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    const update = () => setActive(visible && !document.hidden);
    const updateMotion = () => setReducedMotion(motion.matches);
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); }, { threshold: .05 });
    observer.observe(host);
    motion.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect(); motion.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", update); clearTimeout(interactionTimer.current);
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!active || failed || !host) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { mountPitch } = await import("./latest-hero/mount");
        if (cancelled) return;
        handle.current = mountPitch(host, view.current,
          () => { if (!cancelled) setReady(true); },
          () => { if (!cancelled) { setReady(false); setFailed(true); } },
          () => { if (!cancelled) interactionStart(); },
          () => { if (!cancelled) interactionEnd(); },
          (angle, position, target) => {
            if (cancelled) return;
            view.current = { ...view.current, camera: { position, target } };
            if (wrapperRef.current) wrapperRef.current.dataset.orbitAngle = angle.toFixed(3);
          });
      } catch { if (!cancelled) { setReady(false); setFailed(true); } }
    };
    const idle = window.requestIdleCallback?.(load, { timeout: 1800 });
    const timeout = idle === undefined ? window.setTimeout(load, 350) : undefined;
    return () => {
      cancelled = true;
      // OrbitControls can be destroyed mid-drag without firing its end event.
      clearTimeout(interactionTimer.current);
      setInteracting(false);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timeout !== undefined) window.clearTimeout(timeout);
      handle.current?.destroy(); handle.current = null; setReady(false);
    };
  }, [active, failed]);

  return <div ref={wrapperRef} className="pitch-visual hero-pose-viewer" data-renderer={ready ? "webgl" : "static"} data-pose={selected} data-layer={layer} data-rotating={rotating}>
    <div className="hero-viewer-heading"><span><i aria-hidden="true" />Movement in 3D</span><span className="hero-viewer-count">0{HERO_POSES.findIndex(item => item.id === selected) + 1}<span> / 03</span></span></div>
    <div className="hero-pose-caption" aria-live={cycling && !reducedMotion ? "off" : "polite"}><strong>{pose.label}</strong><span>{pose.detail}</span></div>
    <div className="pose-explorer" role="group" aria-label={`${failed ? 'Static' : 'Interactive'} reconstructed ${pose.label.toLowerCase()} pose`} aria-describedby="pose-explorer-help" tabIndex={0}
      onKeyDown={event => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const keys: Record<string, OrbitAction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", Home: "reset" };
        if (ready && keys[event.key]) { event.preventDefault(); command(keys[event.key]); }
      }}>
      <PoseFallback pose={pose} layer={layer} />
      <div ref={hostRef} className="pitch-scene" aria-hidden="true" />
    </div>
    <div className="hero-view-tools"><span className="hero-orbit-hint"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><ellipse cx="12" cy="12" rx="10" ry="4"/><path d="m18 5 4 6-6 1M5 8l-3 3"/></svg>{failed ? 'Static preview' : 'Drag to rotate'}</span><button type="button" aria-pressed={!cycling} onClick={() => setCycling(value => !value)}>{cycling ? "Pause animation" : "Play animation"}</button></div>
    <div className="hero-pose-controls">
      <div className="hero-pose-choices" role="group" aria-label="Choose a 3D pose">{HERO_POSES.map((item, index) => <button type="button" key={item.id} aria-pressed={selected === item.id} onClick={() => selectPose(item.id)}><span aria-hidden="true">0{index + 1}</span><span>{item.label}</span><i aria-hidden="true" /></button>)}</div>

    </div>
    <span className="pose-explorer-help" id="pose-explorer-help"><span>{failed ? "Select a pose to explore" : "Arrow keys rotate · Home resets"}</span><span>Recorded landmarks · Estimated depth</span></span>
  </div>;
}
