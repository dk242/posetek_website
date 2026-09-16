/** Called only after an intentional next/back/start/reset action, never a tick. */
export function focusWorkoutHeading(container: ParentNode | null): void {
  const heading = container?.querySelector<HTMLElement>(".pd-workout-main .pd-heading h4");
  if (!heading) return;
  heading.focus({ preventScroll: true });
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  heading.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "instant" : "auto" });
}
