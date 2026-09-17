import { useEffect, useId, useRef, useState } from "react";
import type { DemoFocus } from "./product-demo";

type Point = readonly [number, number];
type Positions = { player: Point; ball: Point };
type Drill = {
  name: string;
  cues: readonly string[];
  run: string;
  ball: string;
  cones: readonly Point[];
  positions: (progress: number) => Positions;
  wall?: boolean;
};

// A Gerono figure eight: equal loops mirrored across both central axes, with
// exactly one crossing. Sampling the same route for the SVG and moving markers
// keeps the illustration and its animation in agreement.
const CENTER: Point = [180, 112];
export const figureEightRoute: readonly Point[] = Array.from({ length: 129 }, (_, index) => {
  const angle = index / 128 * Math.PI * 2;
  return [CENTER[0] + 108 * Math.sin(angle), CENTER[1] + 52 * Math.sin(2 * angle)];
});
const figureEightLengths = figureEightRoute.map((point, index) => index === 0 ? 0 :
  Math.hypot(point[0] - figureEightRoute[index - 1][0], point[1] - figureEightRoute[index - 1][1]));
const figureEightDistance = figureEightLengths.reduce((sum, length) => sum + length, 0);
const figureEightPath = figureEightRoute.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(3)} ${y.toFixed(3)}`).join("") + "Z";

function onFigureEight(distance: number): Point {
  let remaining = ((distance % figureEightDistance) + figureEightDistance) % figureEightDistance;
  for (let index = 1; index < figureEightRoute.length; index++) {
    const length = figureEightLengths[index];
    if (remaining <= length) {
      const from = figureEightRoute[index - 1], to = figureEightRoute[index];
      const fraction = remaining / length;
      return [from[0] + (to[0] - from[0]) * fraction, from[1] + (to[1] - from[1]) * fraction];
    }
    remaining -= length;
  }
  return CENTER;
}

export const diagrams: Record<string, Drill> = {
  "DRB-006": {
    name: "Figure-8 dribble",
    cues: [
      "Place two cones 2–5 m apart. Start with the ball close.",
      "Use short touches to trace a figure eight around both cones.",
      "Return to the start. Repeat with your other foot.",
    ],
    run: figureEightPath,
    ball: "",
    // The area centroid of each loop puts its cone visually in the middle.
    cones: [[180 - 108 * 3 * Math.PI / 16, 112], [180 + 108 * 3 * Math.PI / 16, 112]],
    positions: progress => ({ player: onFigureEight(progress * figureEightDistance), ball: onFigureEight(progress * figureEightDistance + 16) }),
  },
  "PAS-001": {
    name: "Wall pass rhythm",
    cues: [
      "Stand 3–8 m from a wall. Choose a target.",
      "Pass into the target. Stay ready as the ball returns.",
      "Cushion the return into your next pass.",
    ],
    run: "",
    ball: "M107 112L286 112L107 112",
    cones: [],
    wall: true,
    positions: progress => ({ player: [90, 112], ball: [107 + 179 * (1 - Math.abs(2 * progress - 1)), 112] }),
  },
};

/** Coaching illustration only. It does not represent measured athlete motion. */
export function DemoPitch({ focus, drillId, className = "" }: { focus: DemoFocus; drillId?: string; className?: string }) {
  const key = drillId && diagrams[drillId] ? drillId : focus === "passing" ? "PAS-001" : "DRB-006";
  return <DrillSteps key={key} drill={diagrams[key]} compact={className.includes("preview")} className={className} />;
}

function DrillSteps({ drill, compact, className }: { drill: Drill; compact: boolean; className: string }) {
  const id = useId(), root = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0), [playing, setPlaying] = useState(false), [progress, setProgress] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => { setReduced(media.matches); if (media.matches) setPlaying(false); };
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    if (!playing || reduced) return;
    let frame = 0;
    const start = performance.now(), stop = () => setPlaying(false);
    const observer = new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) stop(); });
    if (root.current) observer.observe(root.current);
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hidden);
    const tick = (time: number) => {
      const next = Math.min(1, (time - start) / 3600);
      setProgress(next);
      setStep(next >= 1 ? 2 : 1);
      if (next < 1) frame = requestAnimationFrame(tick);
      else stop();
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener("visibilitychange", hidden); };
  }, [playing, reduced]);

  const { player, ball } = drill.positions(progress);
  const choose = (next: number) => {
    setPlaying(false);
    setStep(next);
    setProgress(next === 0 ? 0 : next === 1 ? drill.wall ? .5 : .25 : 1);
  };

  return <div ref={root} className={"drill-explainer " + className}>
    {!compact && <div className="drill-explainer-title"><strong>{drill.name}</strong><span>Drill demonstration</span></div>}
    <svg className="pd-pitch drill-diagram" viewBox="0 0 360 230" role="img" aria-label={drill.name + ": " + drill.cues[step] + " Solid circle: player; white dot: ball; dashed line: movement."}>
      <defs>
        <marker id={id + "run"} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1L9 5L1 9" fill="none" stroke="#b7f34a" strokeWidth="1.5" /></marker>
        <marker id={id + "ball"} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1L9 5L1 9" fill="none" stroke="#e8f0e6" strokeWidth="1.5" /></marker>
      </defs>
      <rect x="10" y="12" width="340" height="200" rx="8" fill="#0b281e" stroke="#426451" />
      <path d="M24 43V26H41M319 26H336V43M24 182V198H41M319 198H336V182" fill="none" stroke="#71947d" />
      {drill.cones.map(([x, y]) => <path key={x + "-" + y} d={"M" + x + " " + (y - 7) + "l6 12h-12z"} fill="#ffbd59" />)}
      {drill.wall && <><path d="M291 60V164M298 60V164" stroke="#91b6ad" strokeWidth="4" /><rect x="280" y="97" width="12" height="30" fill="#6cd8e433" stroke="#6cd8e4" /></>}
      {drill.run && <path d={drill.run} fill="none" stroke="#b7f34a" strokeWidth="2" strokeDasharray="5 5" opacity={step ? 1 : .4} markerEnd={"url(#" + id + "run)"} />}
      {drill.ball && <path d={drill.ball} fill="none" stroke="#e8f0e6" strokeWidth="1.4" opacity={step ? .75 : .4} markerEnd={"url(#" + id + "ball)"} />}
      <circle cx={player[0]} cy={player[1]} r="9" fill="#6cd8e4" stroke="#dafbfa" strokeWidth="1.5" /><circle cx={ball[0]} cy={ball[1]} r="4" fill="#fff" stroke="#0b281e" strokeWidth="1.5" />
    </svg>
    {!compact && <>
      <div className="drill-legend"><span>● Player</span><span>● Ball</span><span>{drill.wall ? "→ Ball path" : "┄ Dribble path"}</span></div>
      <div className="drill-step-tabs" role="group" aria-label={drill.name + " demonstration steps"}>{["Setup", "Movement", "Finish"].map((label, index) => <button type="button" key={label} aria-pressed={step === index} onClick={() => choose(index)}>{index + 1}. {label}</button>)}</div>
      <p className="drill-step-cue" aria-live="polite">{drill.cues[step]}</p>
      {!reduced && <button type="button" className="drill-play" onClick={() => { if (!playing) setProgress(0); setPlaying(!playing); }}>{playing ? "Pause demonstration" : "Play demonstration"}</button>}
    </>}
  </div>;
}
