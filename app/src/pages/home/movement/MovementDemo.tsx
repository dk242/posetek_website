import { PoseDemo } from "./RecoveredMovement.js";
import "./movement.css";

export interface MovementDemoProps {
  onDrillChange?: (key: string) => void;
  hideChoices?: boolean;
  requestedDrill?: { key: string } | null;
  active?: boolean;
}

/** Complete recorded movement demo from the accepted September 15 release. */
export function MovementDemo(props: MovementDemoProps) {
  return <PoseDemo {...props} />;
}
