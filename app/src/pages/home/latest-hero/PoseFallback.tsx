import { POSE_EDGES, type HeroLayer, type HeroPose } from "./pose-model";
import projection from "./fallback/projection.json";


/** Recorded landmarks at the shared reset-camera projection, without Three.js.
 * The wide viewBox crops side space as the panel narrows, preserving camera height.
 */
export function PoseFallback({ pose }: { pose: HeroPose; layer?: HeroLayer }) {
  const { points, ball } = projection.poses[pose.id];
  return <svg className="pitch-static" viewBox={`0 0 ${projection.width} ${projection.height}`} preserveAspectRatio="xMidYMid slice" fill="none" role="img" aria-label={`${pose.label}: recorded tracking skeleton`}>
    <g strokeWidth=".72" strokeLinecap="round">{[...POSE_EDGES.filter(([a,b]) => a >= 11 && b >= 11), [0,7], [0,8], [7,11], [8,12]].map(([a,b]) => <path key={`${a}-${b}`} d={`M${points[a]}L${points[b]}`} stroke={a % 2 === b % 2 ? a % 2 ? '#d8fba2' : '#c1f5e5' : '#ecf6d9'} />)}</g>
    <g>{points.map(([x,y], i) => <circle key={i} cx={x} cy={y} r={i < 11 ? .25 : i > 16 && i < 23 ? .45 : 1.05} fill={i > 10 && i % 2 === 0 ? '#c1f5e5' : '#ddffac'} />)}</g>
    {ball && <circle cx={ball.center[0]} cy={ball.center[1]} r={ball.radius} fill="#d9e4bf" stroke="#829a68" strokeWidth=".6" />}
  </svg>;
}
