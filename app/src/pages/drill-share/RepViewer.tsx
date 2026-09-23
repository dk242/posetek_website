/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import PosePlayback from "../../components/PosePlayback";
import { resultLabel } from "../../lib/result-values";
import type { PageDrillConfig } from "./drill-config";
import { asNumber, markerDefs, metersToInches, normalizeFrames, repMetricCards, type Rep } from "./drill-lib";
import { drawBroadJumpOverlay, drawShuttleOverlay } from "./drawing";

interface RepViewerProps { config: PageDrillConfig; rep: Rep; artifacts: Record<string, any>; initialSpeed?: number; onSpeedChange?: (speed: number) => void }
export default function RepViewer({ config, rep, artifacts, initialSpeed, onSpeedChange }: RepViewerProps) {
  const meta = artifacts["metadata.json"] || {};
  const normalized = useMemo(() => normalizeFrames(artifacts["pose.json"], meta), [artifacts, meta]);
  const frames = useMemo(() => normalized.map(frame => frame.map(point => point || { x: null, y: null })), [normalized]);
  const [frame, setFrame] = useState(0);
  const cards = repMetricCards(config.key, artifacts, rep);
  const heights = artifacts["com_height.json"];
  const height = Array.isArray(heights) ? asNumber(heights[frame]) : null;
  return <div className="viewer-layout">
    <div>
      {resultLabel(rep) ? <p role="status">{resultLabel(rep)}</p> : null}
      <PosePlayback frames={frames} metadata={meta} mediaUrl={artifacts.mediaUrl} mediaSource={artifacts.mediaSource}
        markers={markerDefs(config.key, artifacts, rep)} title={config.title} initialSpeed={initialSpeed} onSpeedChange={onSpeedChange} onFrameChange={setFrame}
        overlay={(context, width, height, current) => config.key === "broadJump"
          ? drawBroadJumpOverlay(context, width, height, current, artifacts, rep)
          : drawShuttleOverlay(context, width, height, normalized, current, artifacts, rep)} />
    </div>
    <aside><div className="metric-grid">{cards.map(card => <article key={card.label} className="metric-card">
      <span className="material-symbols-outlined">{card.icon}</span>
      <span className="metric-value">{card.dynamicId ? height === null ? "—" : `${metersToInches(height).toFixed(1)} in` : card.value}</span>
      <span className="metric-label">{card.label}</span>
    </article>)}</div><div className="coach-note"><strong>What to review</strong><p>{config.key === "broadJump"
      ? "Use Takeoff and Landing to inspect launch angle, arm swing, hip extension, and the landing."
      : "Use Start, Turn, and Finish to inspect braking steps, the plant, and acceleration out of the turn."}</p></div></aside>
  </div>;
}
