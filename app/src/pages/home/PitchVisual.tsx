import { useEffect, useRef, useState } from "react";
import { BALL_POSITION, POSE_EDGES, SHOOTING_POSE, type OrbitAction, type PitchHandle, type PitchView } from "./pitch/pose-model";

export function PitchVisual() {
  const hostRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const handle = useRef<PitchHandle | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rotating = typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const view = useRef<PitchView>({ rotating, command: 0, action: "reset" });
  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const setRotation = (rotating: boolean) => {
    view.current = { ...view.current, rotating };
    handle.current?.update(view.current);
    if (wrapperRef.current) wrapperRef.current.dataset.rotating = String(rotating);
  };
  const pauseRotation = () => { clearTimeout(resumeTimer.current); setRotation(false); };
  const resumeRotation = () => {
    clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => setRotation(!window.matchMedia("(prefers-reduced-motion: reduce)").matches), 1500);
  };
  const command = (action: OrbitAction) => {
    pauseRotation();
    view.current = { rotating: false, command: view.current.command + 1, action };
    handle.current?.update(view.current);
    resumeRotation();
  };

  useEffect(() => {
    const host = wrapperRef.current;
    if (!host) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    const update = () => setActive(visible && !document.hidden);
    const updateMotion = () => { clearTimeout(resumeTimer.current); setRotation(!motion.matches); };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); }, { threshold: .05 });
    observer.observe(host);
    motion.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", update);
    return () => { observer.disconnect(); motion.removeEventListener("change", updateMotion); document.removeEventListener("visibilitychange", update); };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!active || failed || !host) return;
    let cancelled = false;
    setRotation(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const load = async () => {
      try {
        const { mountPitch } = await import("./pitch/mount");
        if (cancelled) return;
        handle.current = mountPitch(host, view.current,
          () => { if (!cancelled) setReady(true); },
          () => { if (!cancelled) { setReady(false); setFailed(true); } },
          () => { if (!cancelled) pauseRotation(); },
          () => { if (!cancelled) resumeRotation(); },
          angle => { if (!cancelled && wrapperRef.current) wrapperRef.current.dataset.orbitAngle = angle.toFixed(3); });
      } catch { if (!cancelled) { setReady(false); setFailed(true); } }
    };
    const idle = window.requestIdleCallback?.(load, { timeout: 1800 });
    const timeout = idle === undefined ? window.setTimeout(load, 350) : undefined;
    return () => {
      cancelled = true;
      clearTimeout(resumeTimer.current);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timeout !== undefined) window.clearTimeout(timeout);
      handle.current?.destroy(); handle.current = null; setReady(false);
    };
  }, [active, failed]);

  const point = ([x,y,z]: readonly number[]) => [270 + x * 130 + z * 24, 360 - y * 132 + z * 12];
  return <div ref={wrapperRef} className="pitch-visual" data-renderer={ready ? "webgl" : "static"}>
    <div className="pose-explorer" role="group" aria-label="Interactive 33-keypoint soccer pose" aria-describedby="pose-explorer-help" tabIndex={0}
      onKeyDown={event => {
        const keys: Record<string, OrbitAction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", Home: "reset" };
        if (ready && keys[event.key]) { event.preventDefault(); command(keys[event.key]); }
      }}>
      <svg className="pitch-static" viewBox="0 0 540 440" fill="none" role="img" aria-label="Recorded shooting pose with 33 landmarks">
        <g stroke="#315f40" opacity=".55"><path d="M50 360 265 300 500 360 275 430zM100 345l220 66M155 331l220 66M210 316l220 66M104 377l215-61M160 395l215-61M217 412l215-61"/><ellipse cx="275" cy="363" rx="110" ry="34"/></g>
        <g stroke="#a3eada" strokeWidth="1.8">{POSE_EDGES.map(([a,b]) => { const p=point(SHOOTING_POSE[a]),q=point(SHOOTING_POSE[b]); return <path key={`${a}-${b}`} d={`M${p[0]} ${p[1]}L${q[0]} ${q[1]}`}/>; })}</g>
        <g fill="#d2ff70">{SHOOTING_POSE.map((p,i)=>{ const [x,y]=point(p); return <circle key={i} cx={x} cy={y} r={2.7}/>; })}</g>
        <g transform={`translate(${point(BALL_POSITION)[0]-382} ${point(BALL_POSITION)[1]-350})`}><circle cx="382" cy="350" r="18" fill="#c2d795" stroke="#b7f34a"/><path d="m382 337 12 9-5 14h-15l-5-14zM382 337v-9M394 346l9-3M389 360l6 7M374 360l-6 7M369 346l-9-3" stroke="#13291c" strokeWidth="2"/></g>
      </svg>
      <div ref={hostRef} className="pitch-scene" aria-hidden="true" />
    </div>
    <span className="pose-explorer-help" id="pose-explorer-help">{failed ? "Recorded pose / 33 keypoints" : "Drag to explore / arrow keys to rotate"}</span>
  </div>;
}
