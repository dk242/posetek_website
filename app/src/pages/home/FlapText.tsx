// Port of legacy `updateFlap()` from landing-pose-demo.js: the split-flap text
// swap on the hero telemetry board. Same timings (class added on the next
// animation frame, text swapped at 80ms, class cleared at 190ms), same no-op
// when the text is unchanged, and the same reduced-motion bypass. Like the
// legacy function it writes textContent directly: the JSX child is the
// first-paint value only, so React never overwrites a swap in progress.
import { useEffect, useRef, useState } from "react";

export function FlapText({ id, value }: { id: string; value: string }) {
  const ref = useRef<HTMLElement>(null);
  const [initialValue] = useState(value);

  useEffect(() => {
    const element = ref.current;
    if (!element || element.textContent === value) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      element.textContent = value;
      return;
    }
    element.classList.remove("is-flipping");
    let swapTimer = 0;
    let clearTimer = 0;
    const frame = requestAnimationFrame(() => {
      element.classList.add("is-flipping");
      swapTimer = window.setTimeout(() => {
        element.textContent = value;
      }, 80);
      clearTimer = window.setTimeout(() => element.classList.remove("is-flipping"), 190);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(swapTimer);
      window.clearTimeout(clearTimer);
      element.classList.remove("is-flipping");
    };
  }, [value]);

  return <strong id={id} ref={ref}>{initialValue}</strong>;
}
