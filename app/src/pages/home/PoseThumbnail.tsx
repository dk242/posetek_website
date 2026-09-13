import { POSE_EDGES } from "./pitch/pose-model";
import snapshots from "./pose-thumbnails.json";
import type { PosePoint } from "./pose-demo";

type Snapshot = { points: (PosePoint | null)[]; aspect: number; ball: { x: number; y: number; radius: number } | null };
export function PoseThumbnail({ kind }: { kind: string }) {
  const snapshot = (snapshots as Record<string, Snapshot>)[kind];
  if (!snapshot) return null;
  const { points, aspect, ball } = snapshot;
  // Fit a recorded snapshot for card legibility without changing its anatomy.
  const bounds = points.filter((p): p is PosePoint => !!p);
  if (ball) bounds.push([ball.x-ball.radius/aspect,ball.y-ball.radius], [ball.x+ball.radius/aspect,ball.y+ball.radius]);
  const xs = bounds.map(p=>p[0]*aspect), ys = bounds.map(p=>p[1]);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const scale = Math.min(174/Math.max(.001,right-left),126/Math.max(.001,bottom-top));
  const project = (p: PosePoint) => [105+(p[0]*aspect-(left+right)/2)*scale,78+(p[1]-(top+bottom)/2)*scale];
  const projected = points.map(p=>p ? project(p) : null);
  const center = ball ? project([ball.x,ball.y]) : null;
  return <svg className="action-pose" viewBox="0 0 210 160" fill="none" aria-hidden="true">
    <ellipse cx="105" cy="148" rx="82" ry="7" stroke="currentColor" opacity=".13"/>
    <path d="M16 32v-14h14M180 18h14v14M16 128v14h14M180 142h14v-14" stroke="currentColor" opacity=".25"/>
    <g stroke="currentColor" strokeWidth="1.45" strokeLinecap="round">{POSE_EDGES.map(([a,b])=> {
      const p=projected[a], q=projected[b];
      return p && q ? <path key={`${a}-${b}`} d={`M${p[0]} ${p[1]}L${q[0]} ${q[1]}`}/> : null;
    })}</g>
    <g fill="currentColor">{projected.map((p,i)=>p && <circle key={i} cx={p[0]} cy={p[1]} r={i<11?.8:1.8}/>)}</g>
    {ball && center && <circle cx={center[0]} cy={center[1]} r={Math.max(3,ball.radius*scale)} fill="#102d20" stroke="currentColor"/>}
  </svg>;
}
