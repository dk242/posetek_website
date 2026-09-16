import type { ReactElement } from "react";

export interface CoachDemoProps {
  /** Suspend the answer animation while this section is offscreen. */
  active?: boolean;
  onOpenWorkout: (request: string) => void;
}
export default function CoachDemo(props: CoachDemoProps): ReactElement;
