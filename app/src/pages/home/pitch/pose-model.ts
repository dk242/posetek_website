import capturedPose from "./shooting-pose.json";
/** A captured mid-swing frame. Depth is MediaPipe's estimate, not calibrated 3D. */
export type Point3 = readonly [number, number, number];
export const SHOOTING_POSE: readonly Point3[] = capturedPose.points.map(([x,y,z])=>[x,y,z]);
export const BALL_POSITION: Point3 = [capturedPose.ballPosition[0],capturedPose.ballPosition[1],capturedPose.ballPosition[2]];
export const BALL_RADIUS = capturedPose.ballRadius;
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
