import { TacticalIcon } from "./TacticalIcon";
import { type CSSProperties } from "react";

const TESTS = [
  { key: "sprint", name: "Sprint", type: "Speed", color: "#6cd8e4", copy: "Acceleration. Top speed. Every stride.", metric: "Time · velocity · acceleration" },
  { key: "jump", name: "Vertical Jump", type: "Power", color: "#b7f34a", copy: "From takeoff to a controlled landing.", metric: "Height · takeoff · landing" },
  { key: "broadJump", name: "Broad Jump", type: "Power", color: "#b7f34a", copy: "See how far your power carries you.", metric: "Distance · flight · landing" },
  { key: "dribbling", name: "Dribbling", type: "Ball control", color: "#6cd8e4", copy: "Control the ball. Carry your speed.", metric: "Time · phase splits · ball distance" },
  { key: "changeOfDirection", name: "Change of Direction", type: "Agility", color: "#ffbd59", copy: "Brake, turn, and find the next gear.", metric: "Start · turn · return" },
  { key: "shooting", name: "Shooting", type: "Technique", color: "#ff9c8f", copy: "Explore the movement behind the strike.", metric: "Velocity · angle · mechanics" },
];

export function TestCards({ onWatch, selectedDrill }: { onWatch: (key: string) => void; selectedDrill: string }) {
  return <div className="test-choices" role="group" aria-label="Choose a performance test">
    {TESTS.map((test, index) => <button key={test.key} type="button" className="test-choice" aria-pressed={selectedDrill === test.key} onClick={() => onWatch(test.key)} style={{ "--test-color": test.color } as CSSProperties}>
      <span className="test-choice-index">0{index + 1}</span>
      <span><strong>{test.name}</strong><span className="test-choice-copy">{test.copy}</span></span>
      <TacticalIcon kind="play" />
    </button>)}
  </div>;
}
