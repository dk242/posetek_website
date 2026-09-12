import { useEffect, useRef, useState, type ComponentType } from "react";
import type { PoseDemoRequest } from "./pose-demo";

/** Load recorded coordinates when the section approaches the viewport. */
export function LazyPoseDemo({ requestedDrill }: { requestedDrill: PoseDemoRequest | null }) {
  const host = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [Demo, setDemo] = useState<ComponentType<{ requestedDrill?: PoseDemoRequest | null }> | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setNear(true); observer.disconnect(); }
    }, { rootMargin: "500px" });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!near && !requestedDrill) return;
    let cancelled = false;
    import("./PoseDemo").then(module => { if (!cancelled) { setDemo(() => module.PoseDemo); setFailed(false); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [near, requestedDrill, attempt]);
  return <div ref={host} className="pose-demo-slot">
    {Demo ? <Demo requestedDrill={requestedDrill}/> : <div className="pose-demo-placeholder" aria-busy={!failed}>
      <span className="eyebrow">Movement, frame by frame</span><span className="placeholder-pose" aria-hidden="true">33</span>
      <p>{failed ? "The movement demo couldn't load." : "Preparing the recorded pose demos…"}</p>
      {failed && <button className="button-text" type="button" onClick={()=>setAttempt(value=>value+1)}>Try again</button>}
    </div>}
  </div>;
}
