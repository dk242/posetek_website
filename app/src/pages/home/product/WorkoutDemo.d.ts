import type { ReactElement } from "react";
import type { DemoFocus } from "./product-demo";

export interface WorkoutDemoProps {
  /** Suspend timers while offscreen; this never resets progress. */
  active?: boolean;
  /** Sample coach request, shown to the visitor and used to prefill focus. */
  initialRequest?: string;
  /** Change for an intentional new handoff, including repeated identical text. */
  requestId?: number | string;
}
export default function WorkoutDemo(props: WorkoutDemoProps): ReactElement;
export function DemoPitch(props: { focus: DemoFocus; drillId?: string; className?: string }): ReactElement;
