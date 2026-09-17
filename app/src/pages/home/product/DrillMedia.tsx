import { useEffect, useId, useRef, useState } from "react";
import { DemoPitch } from "./DrillDiagram";
import { drillMedia, type DemoDrillId, type DrillMediaAsset } from "./drill-media";
import "./drill-media.css";

export function DrillMedia({ drillId, compact = false, active = true }: { drillId: DemoDrillId; compact?: boolean; active?: boolean }) {
  return <DrillMediaContent key={drillId} drillId={drillId} compact={compact} active={active} />;
}

function DrillMediaContent({ drillId, compact, active }: { drillId: DemoDrillId; compact: boolean; active: boolean }) {
  const [pane, setPane] = useState<"overview" | "demo">("overview");
  const [narrow, setNarrow] = useState(false);
  const id = useId();
  const asset = drillMedia[drillId];
  useEffect(() => {
    const query = matchMedia("(max-width: 759px)");
    const update = () => setNarrow(query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const switched = compact || narrow;
  return <div className={`drill-media${compact ? " drill-media-compact" : ""}`}>
    <div className="drill-media-switch" role="group" aria-label={`${asset.name} media`} hidden={!switched}>
      {(["overview", "demo"] as const).map(value => <button type="button" key={value} aria-pressed={pane === value} aria-controls={`${id}-${value}`} onClick={() => setPane(value)}>{value === "overview" ? "Overview" : "Demo"}</button>)}
    </div>
    <div className="drill-media-pair">
      <div id={`${id}-overview`} hidden={switched && pane !== "overview"}>
        <DemoPitch drillId={drillId} focus={drillId === "PAS-001" ? "passing" : "dribbling"} className={compact ? "phone-preview" : ""} />
      </div>
      <div id={`${id}-demo`} className="drill-video-panel" hidden={switched && pane !== "demo"}>
        {!compact && <div className="drill-video-heading"><strong>See the drill</strong><span>From the PoseTek drill library</span></div>}
        <DrillVideo asset={asset} active={active && (!switched || pane === "demo")} />
        {!compact && <p className="drill-video-caption">Watch the movement, then use the overview to set up.</p>}
      </div>
    </div>
  </div>;
}

function DrillVideo({ asset, active }: { asset: DrillMediaAsset; active: boolean }) {
  const video = useRef<HTMLVideoElement>(null), host = useRef<HTMLDivElement>(null);
  const id = useId();
  const [requested, setRequested] = useState(false), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const pendingPlay = useRef(false);
  const visible = useRef(false);
  useEffect(() => {
    const pause = () => video.current?.pause();
    const observer = new IntersectionObserver(([entry]) => { visible.current = entry.isIntersecting; if (!entry.isIntersecting) { pendingPlay.current = false; pause(); } }, { threshold: 0.1 });
    if (host.current) observer.observe(host.current);
    const hidden = () => { if (document.hidden) { pendingPlay.current = false; pause(); } };
    const otherPlayer = (event: Event) => { if ((event as CustomEvent).detail !== id) { pendingPlay.current = false; pause(); } };
    document.addEventListener("visibilitychange", hidden);
    document.addEventListener("posetek:drill-video-play", otherPlayer);
    return () => { pause(); observer.disconnect(); document.removeEventListener("visibilitychange", hidden); document.removeEventListener("posetek:drill-video-play", otherPlayer); };
  }, [id]);
  useEffect(() => { if (!active) { video.current?.pause(); pendingPlay.current = false; } }, [active]);
  const start = () => { pendingPlay.current = true; setFailed(false); setAttempt(value => value + 1); setRequested(true); };
  return <div className="drill-video-surface" ref={host}>
    {!requested && <button type="button" className="drill-video-start" onClick={start} aria-label={`Play ${asset.name} demonstration video`}>
      <img src={asset.poster} loading="lazy" alt={`${asset.name} demonstration`} />
      <span className="drill-video-start-label"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7z" fill="currentColor"/></svg>Watch demo</span>
    </button>}
    {requested && !failed && <video key={attempt} ref={video} src={asset.video} poster={asset.poster} controls playsInline muted preload="metadata" aria-label={`${asset.name} demonstration video`}
      onLoadedData={() => { if (pendingPlay.current && active && visible.current && !document.hidden) { pendingPlay.current = false; void video.current?.play().catch(() => {}); } }}
      onPlay={() => { if (!active || !visible.current || document.hidden) video.current?.pause(); else document.dispatchEvent(new CustomEvent("posetek:drill-video-play", { detail: id })); }}
      onError={() => { pendingPlay.current = false; setFailed(true); }} />}
    {failed && <div className="drill-video-error" role="status"><p>The demo couldn’t load. You can still use the overview.</p><button type="button" onClick={start}>Retry video</button></div>}
  </div>;
}
