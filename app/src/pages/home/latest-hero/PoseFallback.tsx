import { POSE_EDGES, type HeroLayer, type HeroPose } from "./pose-model";

/** Lightweight equivalent for the initial paint, unavailable WebGL, or context loss. */
export function PoseFallback({ pose, layer = 'body' }: { pose: HeroPose; layer?: HeroLayer }) {
  const point = ([x,y,z]: readonly number[]) => [260 + x * 108 + z * 28, 348 - y * 108 + z * 9];
  const points = pose.points.map(point);
  const limbs = [[11,13,17], [13,15,12], [12,14,17], [14,16,12], [23,25,25], [25,27,17], [24,26,25], [26,28,17], [27,31,13], [28,32,13]];
  const neck = [(points[11][0]+points[12][0])/2, (points[11][1]+points[12][1])/2];
  const head = [(points[7][0]+points[8][0])/2, (points[7][1]+points[8][1])/2];
  return <svg className="pitch-static" viewBox="0 0 540 400" fill="none" role="img" aria-label={`${pose.label}: ${layer === 'body' ? 'illustrative athlete with ' : ''}recorded tracking skeleton`}>
    <g stroke="#315f40" opacity=".55"><path d="M50 348 260 289 495 348 270 400zM100 333l220 66M155 319l220 66M104 365l215-61M160 383l215-61"/><ellipse cx="270" cy="350" rx="108" ry="30"/></g>
    <g stroke="#b6cdc0" strokeOpacity={layer === 'body' ? '.36' : '0'} strokeLinecap="round" opacity={layer === 'body' ? 1 : 0}>
      <path d={`M${points[11]}L${points[12]}L${points[24]}L${points[23]}Z`} fill="#72bdac" fillOpacity=".16" strokeWidth="16" strokeLinejoin="round"/>
      <path d={`M${neck}L${head}`} strokeWidth="13" />
      {limbs.map(([a,b,width]) => <path key={`${a}-${b}`} d={`M${points[a]}L${points[b]}`} strokeWidth={width} />)}
      <ellipse cx={head[0]} cy={head[1]-6} rx="13" ry="17" fill="#72bdac" fillOpacity=".18" strokeWidth="1"/>
    </g>
    <g stroke="#a3eada" strokeWidth="1.4">{POSE_EDGES.map(([a,b]) => <path key={`${a}-${b}`} d={`M${points[a]}L${points[b]}`}/>)}</g>
    <g fill="#d2ff70">{points.map(([x,y], i) => <circle key={i} cx={x} cy={y} r={i < 11 ? 1.5 : 2.5}/>)}</g>
    {pose.ball && <circle cx={point(pose.ball.position)[0]} cy={point(pose.ball.position)[1]} r={pose.ball.radius * 108} fill="#b7d187" stroke="#b7f34a" />}
  </svg>;
}
