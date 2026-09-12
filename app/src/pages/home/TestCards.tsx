import { useState, type CSSProperties } from "react";
import { MagicCard } from "../../components/magicui/magic-card";
import { PoseThumbnail } from "./PoseThumbnail";
import recordings from "./pose-recordings.json";

const TESTS = [
  { key: "sprint", name: "Sprint", type: "Speed", color: "#6cd8e4", copy: "Acceleration. Top speed. Every stride.", metric: "Time · velocity · acceleration" },
  { key: "jump", name: "Vertical Jump", type: "Power", color: "#b7f34a", copy: "From takeoff to a controlled landing.", metric: "Height · takeoff · landing" },
  { key: "broadJump", name: "Broad Jump", type: "Power", color: "#b7f34a", copy: "See how far your power carries you.", metric: "Distance · flight · landing" },
  { key: "dribbling", name: "Dribbling", type: "Ball control", color: "#6cd8e4", copy: "Control the ball. Carry your speed.", metric: "Time · phase splits · ball distance" },
  { key: "changeOfDirection", name: "Change of Direction", type: "Agility", color: "#ffbd59", copy: "Brake, turn, and find the next gear.", metric: "Start · turn · return" },
  { key: "shooting", name: "Shooting", type: "Technique", color: "#ff9c8f", copy: "Explore the movement behind the strike.", metric: "Velocity · angle · mechanics" },
];

export function TestCards({ onWatch }: { onWatch: (key: string) => void }) {
  const [pinned, setPinned] = useState<string | null>(null);
  return <div className="test-grid compact-tests">
    {TESTS.map((test, index) => <MagicCard key={test.key} className="test-card" gradientColor="#b7f34112" gradientFrom={test.color} gradientTo="#284b38" gradientSize={240} gradientOpacity={.4}>
      <article className={pinned === test.key ? "pose-pinned" : ""} style={{ "--test-color": test.color } as CSSProperties}>
        <button className="test-preview-toggle" type="button" aria-label={`Preview ${test.name} pose`} aria-pressed={pinned === test.key}
          onClick={() => setPinned(pinned === test.key ? null : test.key)} onKeyDown={event=>{ if(event.key === "Escape") setPinned(null); }}>
          <span className="test-top"><span className="test-type">{test.type}</span><span className="test-number">0{index+1}</span></span>
          <h3>{test.name}</h3>
          <span className="test-summary">{test.copy}</span>
          <PoseThumbnail kind={test.key}/>
          <span className="test-preview-hint">{pinned === test.key ? "Pose selected" : "Explore pose"}<span aria-hidden="true">↗</span></span>
        </button>
        <div className="test-card-footer"><span>{test.metric}</span>{recordings.includes(test.key) ? <a href="#how-it-works" aria-label={`Watch ${test.name} pose recording`} onClick={()=>onWatch(test.key)}>Watch rep <span aria-hidden="true">↗</span></a> : <small>Action preview</small>}</div>
      </article>
    </MagicCard>)}
  </div>;
}
