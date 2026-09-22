import React from 'react';
import shooting from '../../../app/src/pages/home/latest-hero/shooting-pose.json';
import sprint from '../../../app/src/pages/home/latest-hero/sprint-pose.json';
import jump from '../../../app/src/pages/home/latest-hero/jump-pose.json';
import {POSE_EDGES} from '../../../app/src/pages/home/latest-hero/pose-model';

type V3 = readonly [number, number, number];
type Projected = {x: number; y: number; z: number; scale: number};
export type PoseVisualProps = {
  frame: number;
  width?: number;
  height?: number;
  pose?: 'shooting' | 'sprint' | 'jump';
  compact?: boolean;
};

const sub = (a: V3, b: V3): V3 => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const dot = (a: V3, b: V3) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a: V3, b: V3): V3 => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = (a: V3): V3 => {
  const d = Math.sqrt(dot(a,a));
  return [a[0]/d,a[1]/d,a[2]/d];
};
const clamp = (v: number) => Math.max(0,Math.min(1,v));
const ease = (v: number) => {const x=clamp(v);return x*x*(3-2*x);};
const n = (v: number) => v.toFixed(2);
const pathOf = (points: Projected[], close = false) => points.map((p,i)=>`${i?'L':'M'}${n(p.x)},${n(p.y)}`).join(' ')+(close?'Z':'');

// These are exactly the connections selected by the current website PoseRig.
const skeletonEdges = [...POSE_EDGES.filter(([a,b])=>a>=11&&b>=11),[0,7],[0,8],[7,11],[8,12]];
const poseSources = {shooting,sprint,jump};

/** A deterministic perspective view of the website's recorded held pose.
 * Only the camera moves. Source landmarks and estimated ball placement are
 * immutable. Estimated depth is a visual reconstruction, not a body scan.
 */
export const PoseVisual: React.FC<PoseVisualProps> = ({
  frame, width=1080, height=1100, pose='shooting', compact=false,
}) => {
  const points: V3[] = poseSources[pose].points.map(([x,y,z])=>[x,y,z]);
  const progress = ease(frame/120);
  const angle = .40 + progress*.18;
  const distance = compact ? 5.8 : 5.5;
  const elevation = .14;
  const target: V3 = [0,1.4,.02];
  const eye: V3 = [Math.sin(angle)*Math.cos(elevation)*distance,1.4+Math.sin(elevation)*distance,.02+Math.cos(angle)*Math.cos(elevation)*distance];
  const forward=unit(sub(target,eye));
  const right=unit(cross(forward,[0,1,0]));
  const up=unit(cross(right,forward));
  // The portrait opening needs a slightly tighter camera crop than the website
  // panel. Scale about the ground so the feet retain their composition anchor;
  // the underlying landmarks, support foot and ball remain unchanged.
  const framing=pose==='shooting'&&!compact?1.16:1;
  const focal=height*framing/(2*Math.tan(34*Math.PI/360));
  const centerX=width*(framing>1?.45:.5);
  const centerY=height*(.87+(.49-.87)*framing);
  const project=(point: V3):Projected=>{
    const p=sub(point,eye);const z=dot(p,forward);const scale=focal/z;
    return {x:centerX+dot(p,right)*scale,y:centerY-dot(p,up)*scale,z,scale};
  };
  const projected=points.map(project);
  const id=`pose-${pose}-${width}-${height}`;
  const ring=(r:number,y=0)=>Array.from({length:97},(_,i)=>project([Math.cos(i*Math.PI/48)*r,y,Math.sin(i*Math.PI/48)*r]));
  const hip=points[23].map((v,i)=>(v+points[24][i])/2) as unknown as V3;
  const floor=project([hip[0],0,hip[2]]);
  const floorCenter=project([0,0,0]);
  const shadowWidth=floor.scale*(pose==='jump'?1.18:.91);
  const floorPath=pathOf(ring(2.30),true);
  const strokeBase=height/1100;
  const shapes: {depth:number; element:React.ReactNode}[]=[];
  skeletonEdges.forEach(([a,b],i)=>{
    const start=projected[a],end=projected[b];
    const hand=a>=15&&a<=22&&b>=15&&b<=22;
    const color=a%2===b%2 ? a%2 ? '#d8fba2':'#c1f5e5':'#ecf6d9';
    const opacity=.90+.10*clamp((6.2-(start.z+end.z)/2)/1.6);
    shapes.push({depth:(start.z+end.z)/2,element:
      <path key={`edge-${i}`} d={`M${n(start.x)},${n(start.y)}L${n(end.x)},${n(end.y)}`} stroke={color} strokeWidth={(hand||a<11?2.2:3.6)*strokeBase} strokeLinecap="round" opacity={opacity} />});
  });
  projected.forEach((p,i)=>{
    const radius=(i<11?.004:i>16&&i<23?.005:.009)*p.scale;
    const color=i>10&&i%2===0?'#c1f5e5':'#ddffac';
    shapes.push({depth:p.z-.003,element:<circle key={`joint-${i}`} cx={p.x} cy={p.y} r={radius} fill={color}/>});
  });
  if(pose==='shooting'){
    const ball=project([shooting.ballPosition[0],shooting.ballPosition[1],shooting.ballPosition[2]]);
    const radius=shooting.ballRadius*ball.scale;
    const pentagon=Array.from({length:5},(_,i)=>{
      const a=-Math.PI/2+i*Math.PI*2/5;
      return `${Math.cos(a)*radius*.40},${Math.sin(a)*radius*.40}`;
    }).join(' ');
    const ballShadow=project([shooting.ballPosition[0],0,shooting.ballPosition[2]]);
    shapes.push({depth:ball.z,element:<g key="ball">
      <ellipse cx={ballShadow.x} cy={ballShadow.y+2} rx={radius*1.1} ry={radius*.20} fill="#000b07" opacity=".45"/>
      <g transform={`translate(${ball.x} ${ball.y})`}>
        <circle r={radius} fill={`url(#${id}-ball)`}/>
        <clipPath id={`${id}-ballclip`}><circle r={radius}/></clipPath>
        <g clipPath={`url(#${id}-ballclip)`} transform={`rotate(${-10+progress*5})`}>
          <polygon points={pentagon} fill="#17382c"/>
          {Array.from({length:5},(_,i)=>{
            const a=-90+i*72;
            return <g key={i} transform={`rotate(${a})`}>
              <path d={`M${radius*.40},0L${radius*.75},0`} stroke="#587464" strokeWidth={1.1*strokeBase}/>
              <path d={`M${radius*.76},0L${radius*.92},${radius*.21}L${radius*1.12},${radius*.14}L${radius*1.12},${-radius*.14}L${radius*.92},${-radius*.21}Z`} fill="#17382c"/>
            </g>;
          })}
        </g>
        <circle r={radius} fill="none" stroke="#c4d8ba" strokeWidth="1.1" opacity=".75"/>
      </g>
    </g>});
  }
  shapes.sort((a,b)=>b.depth-a.depth);
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" xmlns="http://www.w3.org/2000/svg" style={{overflow:'visible',display:'block'}} aria-label={`${pose} recorded pose visualization`}>
    <defs>
      <radialGradient id={`${id}-ground`}><stop offset="0" stopColor="#38654f" stopOpacity=".26"/><stop offset=".56" stopColor="#234c39" stopOpacity=".15"/><stop offset="1" stopColor="#102d20" stopOpacity="0"/></radialGradient>
      <radialGradient id={`${id}-shadow`}><stop offset="0" stopColor="#000c07" stopOpacity={pose==='jump'?'.32':'.75'}/><stop offset="1" stopColor="#000c07" stopOpacity="0"/></radialGradient>
      <radialGradient id={`${id}-ball`} cx="30%" cy="22%" r="86%"><stop stopColor="#f0f5d9"/><stop offset=".65" stopColor="#c7d8b5"/><stop offset="1" stopColor="#718b6f"/></radialGradient>
      <radialGradient id={`${id}-feather`}><stop offset=".30" stopColor="white"/><stop offset="1" stopColor="black"/></radialGradient>
      <mask id={`${id}-stage-mask`}><ellipse cx={floorCenter.x} cy={floorCenter.y} rx={focal*2.25/5.5} ry={height*.24} fill={`url(#${id}-feather)`}/></mask>
    </defs>
    <path d={floorPath} fill={`url(#${id}-ground)`}/>
    <g mask={`url(#${id}-stage-mask)`}>
      {Array.from({length:9},(_,i)=>{
        const offset=(i-4)*.5;
        return <g key={i} stroke="#779c80" strokeWidth={.7*strokeBase} opacity={i===4?.22:.11}>
          <path d={pathOf([project([offset,0,-2.4]),project([offset,0,2.4])])}/>
          <path d={pathOf([project([-2.4,0,offset]),project([2.4,0,offset])])}/>
        </g>;
      })}
      <path d={pathOf(ring(1.46),true)} stroke="#88ae80" strokeWidth={1.4*strokeBase} opacity=".28"/>
      <path d={pathOf(ring(.26),true)} stroke="#88ae80" strokeWidth={.85*strokeBase} opacity=".18"/>
    </g>
    <ellipse cx={floor.x} cy={floor.y} rx={shadowWidth} ry={shadowWidth*.18} fill={`url(#${id}-shadow)`}/>
    {shapes.map(s=>s.element)}
  </svg>;
};

export default PoseVisual;
