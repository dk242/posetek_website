import React, {useEffect, useState} from 'react';
import {cancelRender, continueRender, delayRender, staticFile} from 'remotion';

type Point = [number, number, number] | null;
type XY = {x: number; y: number};
type CodRecord = {
  key: 'player' | 'reference'; fps: number;
  firstSourceFrame: number; turnSourceFrame: number; lastSourceFrame: number;
  frames: (Point[] | null)[];
  calibration: {metersPerNormalizedX: number; aspect: number; direction: number; turnHipX: number; ground: {left: XY; right: XY}};
};
type CodSource = {
  version: number; window: {before: number; after: number};
  bounds: {minX: number; maxX: number; minY: number; maxY: number};
  records: CodRecord[];
};
export const EXACT_COD_V3_DURATION = 246;
const W = 1728, H = 700;
const C = {line: '#254036', lime: '#b7f34a', mint: '#c1f5e5', ink: '#f0f5ed', muted: '#a9bdb1'};
const mono = '"IBM Plex Mono",monospace';
const EDGES = [[11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],[12,14],[14,16],[16,18],[16,20],[16,22],[18,20],[11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],[24,26],[26,28],[28,30],[30,32],[28,32],[0,7],[0,8],[7,11],[8,12]];
const valid = (p: Point): p is Exclude<Point, null> => Boolean(p && p.every(Number.isFinite) && p[2] >= .1 && p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1);

/** Playback advances only on the two motion intervals, at one source second
 * per output second. The saved apex and exit samples remain exact when paused. */
export function exactCodStateV3(frame: number) {
  if (frame < 18) return {time: -1.2, playing: false, phase: 'approach' as const, status: 'PAUSED · APPROACH'};
  if (frame < 54) return {time: -1.2 + (frame - 18) / 30, playing: true, phase: 'approach' as const, status: 'RECORDED MOTION · 1×'};
  if (frame < 126) return {time: 0, playing: false, phase: 'turn' as const, status: 'PAUSED · TURN'};
  if (frame < 168) return {time: (frame - 126) / 30, playing: true, phase: 'exit' as const, status: 'RECORDED MOTION · 1×'};
  return {time: 1.4, playing: false, phase: 'exit' as const, status: 'PAUSED · EXIT'};
}

export function exactCodSourceFrameV3(record: Pick<CodRecord, 'turnSourceFrame' | 'fps' | 'firstSourceFrame' | 'lastSourceFrame'>, time: number) {
  const index = record.turnSourceFrame + Math.round(time * record.fps);
  if (index < record.firstSourceFrame || index > record.lastSourceFrame) throw new Error('COD playback exceeds the verified source interval');
  return index;
}

let sourcePromise: Promise<CodSource> | null = null;
function useCodSource() {
  const [source, setSource] = useState<CodSource | null>(null);
  const [handle] = useState(() => delayRender('Recorded change-of-direction comparison'));
  useEffect(() => {
    let alive = true;
    sourcePromise ??= fetch(staticFile('investor-exact-v3/cod.json')).then(response => {
      if (!response.ok) throw new Error('Verified change-of-direction render asset unavailable');
      return response.json();
    }).then((data: CodSource) => {
      if (data.version !== 3 || data.records.length !== 2 || data.window.before !== 1.2 || data.window.after !== 1.4) throw new Error('Unexpected change-of-direction source contract');
      return data;
    });
    sourcePromise.then(data => {if (alive) setSource(data); continueRender(handle);}).catch(cancelRender);
    return () => {alive = false;};
  }, [handle]);
  return source;
}

export function exactCodWorldV3(record: CodRecord, point: Exclude<Point, null>): [number, number] {
  const c = record.calibration, g = c.ground;
  const groundY = g.left.y + (point[0] - g.left.x) * (g.right.y - g.left.y) / (g.right.x - g.left.x);
  return [(point[0] - c.turnHipX) * c.metersPerNormalizedX * c.direction, (groundY - point[1]) * c.metersPerNormalizedX / c.aspect];
}

/** Both recorded figures use one fixed camera and the same pixels per meter.
 * Registration translates each saved-turn hip midpoint to the same origin;
 * it never normalizes athlete size, course length, or the recorded motion. */
export const ExactChangeOfDirectionV3: React.FC<{frame: number}> = ({frame}) => {
  const source = useCodSource();
  if (!source) return null;
  const state = exactCodStateV3(frame), b = source.bounds;
  const left = 62, right = W - 62, top = 125, bottom = 565;
  const ppm = Math.min((right-left)/(b.maxX-b.minX), (bottom-top)/(b.maxY-b.minY));
  const centerX = (b.minX+b.maxX)/2, centerY = (b.minY+b.maxY)/2;
  const projectWorld = (x: number, y: number): [number, number] => [(left+right)/2+(x-centerX)*ppm, (top+bottom)/2-(y-centerY)*ppm];
  const project = (record: CodRecord, p: Exclude<Point,null>) => projectWorld(...exactCodWorldV3(record,p));
  const ground = projectWorld(0,0)[1], turnX = projectWorld(0,0)[0];
  const selected = source.records.map(record => {
    const sourceFrame = exactCodSourceFrameV3(record,state.time);
    const points = record.frames[sourceFrame-record.firstSourceFrame];
    if (!points) throw new Error('Displayed change-of-direction frame lacks an original tracked pose');
    return {record,points};
  });
  const phases = ['approach','turn','exit'] as const;
  const currentPhase = phases.indexOf(state.phase);
  return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{display:'block',fontFamily:'Inter,sans-serif'}}>
    <defs>
      <linearGradient id="exact-cod-v3-stage" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#0e2a1e"/><stop offset="1" stopColor="#061910"/></linearGradient>
    </defs>
    <rect x="1" y="1" width={W-2} height={H-2} rx="22" fill="url(#exact-cod-v3-stage)" stroke={C.line}/>
    <g transform="translate(54 49)">
      <circle cx="5" cy="-8" r="6" fill={C.lime}/><text x="23" fill={C.lime} fontSize="27" fontWeight="600">Example player</text>
      <circle cx="321" cy="-8" r="6" fill={C.mint} opacity=".6"/><text x="340" fill={C.mint} fontSize="27" fontWeight="600">D1 reference</text>
    </g>
    <text x={W-55} y="46" textAnchor="end" fill={state.playing?C.ink:C.muted} fontFamily={mono} fontSize="20" letterSpacing="1">{state.status}</text>
    <text x={W-55} y="80" textAnchor="end" fill={C.muted} fontFamily={mono} fontSize="18">ORIGINAL TIMING · SHARED SCALE</text>
    <path d={`M${left} ${ground} H${right} V${bottom} H${left}Z`} fill="#122c1c" opacity=".5"/>
    <line x1={left} x2={right} y1={ground} y2={ground} stroke="#62816a" strokeWidth="1.2"/>
    {Array.from({length:8},(_,i)=>i-6).map(m => {
      const x=projectWorld(m,0)[0];
      return x<left||x>right?null:<line key={m} x1={x} x2={x} y1={ground} y2={ground+9} stroke="#516e58" strokeWidth="1.2"/>;
    })}
    <line x1={turnX} x2={turnX} y1={top+6} y2={ground+10} stroke="#88a890" strokeWidth="1" strokeDasharray="4 10" opacity=".35"/>
    <text x={turnX} y={bottom+13} textAnchor="middle" fill={C.muted} fontFamily={mono} fontSize="16" letterSpacing="1.6">TURN</text>
    {selected.slice().reverse().map(({record,points}) => {
      const ghost=record.key==='reference',color=ghost?C.mint:C.lime;
      const hipLeft=points[23],hipRight=points[24];
      const hipX=valid(hipLeft)&&valid(hipRight)?(project(record,hipLeft)[0]+project(record,hipRight)[0])/2:null;
      return <g key={record.key}>
        {hipX!==null&&<ellipse cx={hipX} cy={ground+4} rx={ppm*.27} ry="7" fill="#020b07" opacity={ghost?.22:.40}/>}
        <g opacity={ghost?.52:1}>
          {EDGES.map(([a,b],i) => {
            const p=points[a],q=points[b];if(!valid(p)||!valid(q))return null;
            const [x,y]=project(record,p),[u,v]=project(record,q);
            const detail=(a>=15&&a<=22&&b>=15&&b<=22)||a<11;
            return <line key={i} x1={x} y1={y} x2={u} y2={v} stroke={color} strokeWidth={detail?1.8:4.0} strokeLinecap="round"/>;
          })}
          {points.map((p,i) => {
            if(!valid(p))return null;const [x,y]=project(record,p);
            return <circle key={i} cx={x} cy={y} r={i<11?1.8:i>16&&i<23?2.0:3.4} fill={color}/>;
          })}
        </g>
      </g>;
    })}
    <line x1="54" x2={W-54} y1="604" y2="604" stroke={C.line}/>
    <text x="54" y="650" fill={C.ink} fontSize="27" fontWeight="600">Aligned at turn</text>
    <g transform="translate(980 642)">
      {phases.map((phase,index) => <g key={phase} transform={`translate(${index*242} 0)`}>
        <circle cx="0" cy="-4" r={currentPhase===index?6:4} fill={currentPhase===index?C.lime:currentPhase>index?C.muted:C.line}/>
        <text x="20" y="3" fill={currentPhase===index?C.ink:C.muted} fontFamily={mono} fontSize="20">{phase.charAt(0).toUpperCase()+phase.slice(1)}</text>
        {index<2&&<line x1="142" x2="216" y1="-4" y2="-4" stroke={currentPhase>index?'#6a896b':C.line} strokeWidth="1.5"/>}
      </g>)}
    </g>
  </svg>;
};
