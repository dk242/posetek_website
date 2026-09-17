import { useState } from "react";
import { DrillMedia } from "./product/DrillMedia";
import type { DemoDrillId } from "./product/drill-media";
import { createDemoWorkout } from "./product/product-demo";

const drills = createDemoWorkout({ minutes: 15, energy: "normal", focus: "dribbling" }).drills;

/** Source-grounded illustration of the mobile workout player, using sample data only. */
export function MobileAppPreview() {
  const [selected, setSelected] = useState(0);
  const drill = drills[selected];
  const [completed, setCompleted] = useState(0);
  const [resting, setResting] = useState(false);
  const finished = completed === drill.sets;
  const advance = () => {
    if (finished) { setCompleted(0); setResting(false); }
    else if (resting) setResting(false);
    else { setCompleted(value => value + 1); setResting(completed + 1 < drill.sets); }
  };
  return <figure className="mobile-app-preview">
    <div className="app-device" role="group" aria-label="PoseTek mobile workout preview">
      <div className="app-device-screen">
        <div className="app-device-status" aria-hidden="true"><span>9:41</span><span className="app-device-island" /><svg viewBox="0 0 46 14"><path d="M1 12V9M6 12V6M11 12V3M16 12V1" stroke="currentColor" strokeWidth="3"/><rect x="26" y="2" width="17" height="10" rx="2" fill="none" stroke="currentColor"/><path d="M44 5v4" stroke="currentColor"/><rect x="28" y="4" width="13" height="6" rx="1" fill="currentColor"/></svg></div>
        <div className="app-device-header"><span className="app-device-logo">P</span><span>PoseTek</span><span>Workout</span></div>
        <div className="app-device-content">
          <div className="app-device-context"><span>Sample drill</span><span>{drill.focus === "passing" ? "Passing" : "Ball control"}</span></div>
          <label className="app-device-drill-label" htmlFor="phone-preview-drill">Choose a drill</label>
          <select id="phone-preview-drill" className="app-device-drill-select" value={selected} onChange={event => { setSelected(Number(event.target.value)); setCompleted(0); setResting(false); }}>{drills.map((item,index) => <option key={item.id} value={index}>{item.name}</option>)}</select>
          <div className="app-device-media"><DrillMedia drillId={drill.id as DemoDrillId} compact /><span>{drill.focus === "passing" ? "Cushion the return into your next pass." : "Keep the ball close through the turn."}</span></div>
          <div className="app-device-progress" aria-live="polite">
            <div><strong>{finished ? "Drill complete" : resting ? "Recover for the next set" : `Set ${completed + 1} of ${drill.sets}`}</strong><span>{finished ? "Nice work. Build on it." : resting ? `${drill.restSeconds} sec rest` : `${drill.workSeconds} sec per set`}</span></div>
            <div className="app-device-sets" aria-label={`${completed} of ${drill.sets} sets complete`}>{Array.from({ length: drill.sets }, (_, index) => <span key={index} className={index < completed ? "is-complete" : index === completed ? "is-current" : ""}>{index < completed ? "✓" : index + 1}</span>)}</div>
          </div>
          <button className="app-device-action" type="button" onClick={advance}>{finished ? "Replay preview" : resting ? "End rest" : `Complete set ${completed + 1} of ${drill.sets}`}<span aria-hidden="true">{finished ? "↺" : "→"}</span></button>
          <span className="app-device-note">Tap through a sample · No workout is recorded</span>
        </div>
        <div className="app-device-home" aria-hidden="true" />
      </div>
    </div>
    <figcaption>THE POSETEK MOBILE APP <span>Workout screen · Interactive preview</span></figcaption>
  </figure>;
}
