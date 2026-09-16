import { techniqueData } from "./technique-model";

/** Forward-only stops, matching the mobile walkthrough's same-frame cue behavior. */
export const walkthroughSteps = techniqueData.phases.flatMap(phase => {
  const focuses = techniqueData.focusAreas.map((focus, index) => ({ focus, index }))
    .filter(({ focus }) => focus.frameKey === phase.key);
  return focuses.length ? focuses.map(({ focus, index }) => ({
    phase, focusIndex: index as number | null, title: focus.title, cue: focus.cue,
    metricId: focus.metricIds.find(id => phase.metrics.some(metric => metric.id === id)),
  })) : [{
    phase, focusIndex: null as number | null, title: phase.title,
    cue: phase.key === "backswing"
      ? "Compare the kicking knee at the same phase before reviewing the saved improvement cues at contact."
      : "Review how the kicking leg finishes. No professional reference was captured for this phase.",
    metricId: phase.metrics[0]?.id,
  }];
});

export type WalkthroughState = { status: "idle" | "approaching" | "paused" | "finished"; step: number };
export const initialWalkthrough: WalkthroughState = { status: "idle", step: 0 };
export function nextWalkthrough(current: WalkthroughState, frame: number): WalkthroughState {
  const step = current.step + 1;
  if (step >= walkthroughSteps.length) return { ...current, status: "finished" };
  return { step, status: walkthroughSteps[step].phase.index <= frame ? "paused" : "approaching" };
}
