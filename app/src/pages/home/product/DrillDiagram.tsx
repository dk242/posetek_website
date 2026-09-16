import { useId } from "react";
import type { DemoFocus } from "./product-demo";

const diagrams = {
  "DRB-006": { name: "Figure-8 dribble", label: "2–5 m between cones", path: "M95 160C25 115 90 45 160 108S295 170 275 90S165 60 160 108S115 175 95 160", cones: [[95, 100], [245, 100]], player: [82, 152], ball: [104, 157] },
  "DRB-009": { name: "Weak-foot gate circuit", label: "Weak foot · turn · pass", path: "M65 163L110 92Q155 35 190 90L235 146L296 83", cones: [[92, 90], [124, 108], [183, 136], [211, 118], [274, 82], [302, 103]], player: [57, 165], ball: [76, 151] },
  "PAS-001": { name: "Wall pass rhythm", label: "3–8 m to wall target", path: "M100 150L270 82L118 115", cones: [], player: [89, 151], ball: [123, 138] },
  "SHT-003": { name: "One-step laces strike", label: "One step · clean contact", path: "M105 164L146 141L287 90", cones: [], player: [102, 164], ball: [148, 141] },
  "SHT-004": { name: "Four-corner accuracy grid", label: "Pick a target before each shot", path: "M100 158L282 71", cones: [], player: [84, 169], ball: [111, 153] },
};

/** Diagram geometry depicts setup and intent, not fabricated measured movement. */
export function DemoPitch({ focus, drillId, className = "" }: { focus: DemoFocus; drillId?: string; className?: string }) {
  const marker = useId();
  const key = drillId && drillId in diagrams ? drillId as keyof typeof diagrams : focus === "passing" ? "PAS-001" : focus === "shooting" ? "SHT-003" : "DRB-006";
  const diagram = diagrams[key];
  const shooting = key.startsWith("SHT");
  return <svg className={`pd-pitch drill-diagram ${className}`} viewBox="0 0 360 240" role="img" aria-label={`${diagram.name}: ${diagram.label}. Solid circle: player; white dot: ball; dashed line: movement.`}>
    <defs><marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M1 1L9 5L1 9" fill="none" stroke="#b7f34a" strokeWidth="1.5" /></marker></defs>
    <rect x="12" y="14" width="336" height="190" rx="10" fill="#0a281d" stroke="#345447" />
    <path d="M28 44V30H42M318 30H332V44M28 174V188H42M318 188H332V174" fill="none" stroke="#5d7b65" />
    <text x="30" y="52" className="diagram-label">{diagram.label}</text>
    {diagram.cones.map(([x,y]) => <path key={`${x}-${y}`} d={`M${x} ${y - 7}l6 12h-12z`} fill="#ffbd59" stroke="#ffdb9a" />)}
    {key === "DRB-006" && <path d="M104 110H236" stroke="#789184" strokeDasharray="2 5" />}
    {key === "PAS-001" && <><path d="M280 63V166M287 63V166" stroke="#6cd8e4" strokeWidth="3" /><rect x="269" y="73" width="14" height="29" rx="3" fill="#6cd8e422" stroke="#6cd8e4" /></>}
    {shooting && <><path d="M273 62H322V154H273Z M273 108H322M298 62V154" stroke="#739384" fill="#173b2c" />{(key === "SHT-004" ? [[283,73],[313,73],[283,143],[313,143]] : [[294,90]]).map(([x,y],i) => <g key={i}><circle cx={x} cy={y} r="8" fill="#b7f34a22" stroke="#b7f34a" /><text x={x} y={y + 3} textAnchor="middle" className="diagram-target">{i + 1}</text></g>)}</>}
    <path d={diagram.path} fill="none" stroke="#b7f34a" strokeWidth="2" strokeDasharray="5 5" markerEnd={`url(#${marker})`} />
    <circle cx={diagram.player[0]} cy={diagram.player[1]} r="11" fill="#6cd8e4" stroke="#c7f5f7" strokeWidth="2" />
    <circle cx={diagram.ball[0]} cy={diagram.ball[1]} r="5" fill="#fff" stroke="#0a281d" strokeWidth="2" />
    <g className="diagram-legend"><circle cx="31" cy="223" r="4" fill="#6cd8e4" /><text x="41" y="227">Player</text><circle cx="100" cy="223" r="3" fill="#fff" /><text x="110" y="227">Ball</text><path d="M156 223h22" stroke="#b7f34a" strokeDasharray="3 3" /><text x="187" y="227">Movement</text><path d="M281 218l4 8h-8z" fill="#ffbd59" /><text x="291" y="227">Cone</text></g>
  </svg>;
}
