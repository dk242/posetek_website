import { POSE_EDGES } from "./pitch/pose-model";

// Small action illustrations. Recorded clips use their original keypoint data.
const ACTIONS: Record<string, number[][]> = {
  sprint: [[98,25],[83,47],[110,46],[73,67],[127,35],[57,53],[138,53],[87,80],[107,82],[64,96],[128,103],[40,129],[143,86],[28,129],[155,87]],
  jump: [[99,39],[84,61],[113,61],[72,38],[122,38],[77,15],[118,15],[89,94],[109,94],[85,114],[115,114],[84,134],[119,134],[76,137],[128,137]],
  broadJump: [[114,26],[100,48],[118,48],[123,39],[138,37],[145,27],[158,25],[88,80],[107,82],[121,93],[137,97],[142,119],[153,120],[154,123],[165,122]],
  dribbling: [[105,28],[87,48],[112,46],[69,71],[133,66],[50,64],[141,83],[87,79],[107,79],[75,103],[128,102],[74,133],[128,129],[63,137],[140,131]],
  changeOfDirection: [[114,29],[96,52],[122,50],[76,68],[143,69],[61,91],[160,77],[87,83],[107,86],[60,113],[121,108],[37,138],[147,135],[25,138],[162,137]],
  shooting: [[94,24],[78,45],[108,46],[63,62],[130,69],[48,44],[144,81],[85,81],[105,81],[83,109],[128,94],[75,138],[152,116],[63,139],[166,118]],
};
export function PoseThumbnail({ kind }: { kind: string }) {
  const [head, ...body] = ACTIONS[kind] || ACTIONS.shooting;
  const points: number[][] = Array.from({ length: 33 }, () => [...head]);
  const headOffsets = [[0,0],[-2,-3],[-4,-3],[-6,-2],[2,-3],[4,-3],[6,-2],[-8,1],[8,1],[-3,5],[3,5]];
  headOffsets.forEach(([x,y],i) => { points[i] = [head[0]+x,head[1]+y]; });
  [11,12,13,14,15,16,23,24,25,26,27,28,31,32].forEach((index,i) => { points[index] = body[i]; });
  for (const [wrist,pinky,index,thumb] of [[15,17,19,21],[16,18,20,22]]) {
    const [x,y] = points[wrist]; points[pinky]=[x-3,y+5]; points[index]=[x+2,y+6]; points[thumb]=[x+4,y+1];
  }
  points[29]=[points[27][0]+3,points[27][1]+3]; points[30]=[points[28][0]-3,points[28][1]+3];
  const ball = kind === "shooting" ? [179,121] : kind === "dribbling" ? [152,131] : null;
  return <svg className="action-pose" viewBox="0 0 210 160" fill="none" aria-hidden="true">
    <ellipse className="pose-floor" cx="104" cy="146" rx="83" ry="10" stroke="currentColor" opacity=".13" />
    <path d="M18 145h177M105 3v8M8 81h8M194 81h8" stroke="currentColor" opacity=".2" />
    <g stroke="currentColor" strokeWidth="1.45" strokeLinecap="round">{POSE_EDGES.map(([a,b])=><path key={`${a}-${b}`} d={`M${points[a][0]} ${points[a][1]}L${points[b][0]} ${points[b][1]}`}/>)}</g>
    <g fill="currentColor">{points.map(([x,y],i)=><circle key={i} cx={x} cy={y} r={i<11?1:2.1}/>)}</g>
    {ball && <g><circle cx={ball[0]} cy={ball[1]} r="9" fill="#102d20" stroke="currentColor"/><path d={`m${ball[0]} ${ball[1]-5} 5 4-2 6h-6l-2-6z`} stroke="currentColor" strokeWidth=".7"/></g>}
  </svg>;
}
