import { mount, unmount } from "svelte";
import Pitch from "./Pitch.svelte";
import { writable } from "svelte/store";
import type { PitchHandle, PitchView, Point3 } from "./pose-model";

export function mountPitch(target: HTMLElement, initial: PitchView, onReady: () => void, onFailure: () => void, onInteract: () => void, onInteractionEnd: () => void, onAngle: (angle: number, position: Point3, target: Point3) => void): PitchHandle {
  const view = writable(initial);
  const instance = mount(Pitch, { target, props: { view, onReady, onFailure, onInteract, onInteractionEnd, onAngle } });
  const lost = (event: Event) => { event.preventDefault(); onFailure(); };
  target.addEventListener("webglcontextlost", lost, true);
  return { update: next => view.set(next), destroy: () => {
    target.removeEventListener("webglcontextlost", lost, true);
    void unmount(instance);
  } };
}
