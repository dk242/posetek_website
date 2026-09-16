import type { Point3 } from './pose-model';

/** One stable camera volume keeps the airborne jump's ground clearance legible. */
export const STAGE_TARGET: Point3 = [0, 1.4, .02];
export const STAGE_FOV = 34;
export const STAGE_DISTANCE = 5.5;
export const STAGE_ELEVATION = .14;
export function stageCameraPosition(view: 'reset' | 'front' | 'side'): [number, number, number] {
  const angle = view === 'front' ? 0 : view === 'side' ? Math.PI / 2 : .48;
  const horizontal = Math.cos(STAGE_ELEVATION) * STAGE_DISTANCE;
  return [Math.sin(angle) * horizontal, STAGE_TARGET[1] + Math.sin(STAGE_ELEVATION) * STAGE_DISTANCE, STAGE_TARGET[2] + Math.cos(angle) * horizontal];
}
