import capturedPose from "./shooting-pose.json";
import sprintPose from "./sprint-pose.json";
import jumpPose from "./jump-pose.json";
/** Accepted September 15 reconstruction, recovered without rounding.
 * MediaPipe world depth and ball/support-foot ground placement are estimates.
 * This is not a metrically calibrated 3D body scan.
 */
export type Point3 = readonly [number, number, number];
export const SHOOTING_POSE: readonly Point3[] = capturedPose.points.map(([x,y,z])=>[x,y,z]);
export const BALL_POSITION: Point3 = [capturedPose.ballPosition[0],capturedPose.ballPosition[1],capturedPose.ballPosition[2]];
export const BALL_RADIUS = capturedPose.ballRadius;
export const SUPPORT_FOOT: Point3 = [(SHOOTING_POSE[30][0] + SHOOTING_POSE[32][0]) / 2, 0, (SHOOTING_POSE[30][2] + SHOOTING_POSE[32][2]) / 2];
export type HeroPoseId = 'shooting' | 'sprint' | 'jump';
export interface HeroPose {
  id: HeroPoseId;
  label: string;
  detail: string;
  points: readonly Point3[];
  ball: { position: Point3; radius: number } | null;
}
export const HERO_POSES: readonly HeroPose[] = [
  { id: 'shooting', label: 'Shooting', detail: 'The shape of a strike', points: SHOOTING_POSE, ball: { position: BALL_POSITION, radius: BALL_RADIUS } },
  { id: 'sprint', label: 'Sprint', detail: 'The shape of speed', points: sprintPose.points.map(([x,y,z]) => [x,y,z]), ball: null },
  { id: 'jump', label: 'Vertical jump', detail: 'The shape of power', points: jumpPose.points.map(([x,y,z]) => [x,y,z]), ball: null },
];
export const HERO_HOLD_MS = 6000;
export const HERO_FADE_MS = 450;
export function heroPose(id: HeroPoseId) { return HERO_POSES.find(pose => pose.id === id)!; }
export function nextHeroPose(id: HeroPoseId): HeroPoseId {
  return HERO_POSES[(HERO_POSES.findIndex(pose => pose.id === id) + 1) % HERO_POSES.length].id;
}
export function shouldAnimateHero(active: boolean, cycling: boolean, reducedMotion: boolean, interacting: boolean) {
  return active && cycling && !reducedMotion && !interacting;
}
export const POSE_EDGES: readonly (readonly [number, number])[] = [
  [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],
  [11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],
  [12,14],[14,16],[16,18],[16,20],[16,22],[18,20],
  [11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],
  [24,26],[26,28],[28,30],[30,32],[28,32],
];
export type OrbitAction = 'left' | 'right' | 'up' | 'down' | 'reset' | 'front' | 'side';
export type HeroLayer = 'body' | 'skeleton';
export interface PitchView { pose: HeroPoseId; layer: HeroLayer; reducedMotion: boolean; rotating: boolean; command: number; action: OrbitAction; camera?: { position: Point3; target: Point3 }; }
export interface PitchHandle { update: (view: PitchView) => void; destroy: () => void; }
