/** Art-directed strike pose in MediaPipe's 33-landmark order.
 * This is an illustration, not a reconstructed measurement of an athlete. */
export type Point3 = readonly [number, number, number];
export const STRIKE_POSE: readonly Point3[] = [
  [0,1.96,.17], [-.025,1.985,.155], [-.048,1.985,.145], [-.075,1.979,.12],
  [.025,1.985,.155], [.048,1.985,.145], [.075,1.979,.12], [-.105,1.965,.04], [.105,1.965,.04],
  [-.028,1.924,.14], [.028,1.924,.14],
  [-.24,1.69,0], [.24,1.66,0], [-.48,1.48,.14], [.48,1.43,-.19],
  [-.62,1.64,.27], [.62,1.25,-.27], [-.65,1.66,.30], [.66,1.20,-.29],
  [-.65,1.71,.30], [.68,1.22,-.27], [-.60,1.71,.28], [.64,1.27,-.22],
  [-.16,1.06,0], [.16,1.05,.025], [-.22,.60,.04], [.35,.70,.36],
  [-.24,.12,-.055], [.55,.33,.80], [-.25,.06,-.11], [.53,.29,.76],
  [-.25,.055,.15], [.61,.24,1.00],
];
export const POSE_EDGES: readonly (readonly [number, number])[] = [
  [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],
  [11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],
  [12,14],[14,16],[16,18],[16,20],[16,22],[18,20],
  [11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],
  [24,26],[26,28],[28,30],[30,32],[28,32],
];
export type OrbitAction = 'left' | 'right' | 'up' | 'down' | 'reset';
export interface PitchView { rotating: boolean; command: number; action: OrbitAction; }
export interface PitchHandle { update: (view: PitchView) => void; destroy: () => void; }
