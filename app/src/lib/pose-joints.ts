import type { PosePoint } from './pose-playback';

const mpNames: Record<number, string> = { 0: 'Nose', 11: 'Left shoulder', 12: 'Right shoulder', 13: 'Left elbow', 14: 'Right elbow', 15: 'Left wrist', 16: 'Right wrist', 23: 'Left hip', 24: 'Right hip', 25: 'Left knee', 26: 'Right knee', 27: 'Left ankle', 28: 'Right ankle', 29: 'Left heel', 30: 'Right heel', 31: 'Left toe', 32: 'Right toe' };
const cocoNames: Record<number, string> = { 0: 'Nose', 5: 'Left shoulder', 6: 'Right shoulder', 7: 'Left elbow', 8: 'Right elbow', 9: 'Left wrist', 10: 'Right wrist', 11: 'Left hip', 12: 'Right hip', 13: 'Left knee', 14: 'Right knee', 15: 'Left ankle', 16: 'Right ankle' };
export function visiblePosePoint(point: PosePoint | undefined): boolean {
  return !!point && typeof point.x === 'number' && typeof point.y === 'number' && Number.isFinite(point.x) && Number.isFinite(point.y) &&
    point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1 &&
    (point.visibility == null || Number.isFinite(point.visibility) && point.visibility >= .1 && point.visibility <= 1);
}
export function poseJointOptions(pointCount: number) {
  return Object.entries(pointCount === 33 ? mpNames : pointCount === 17 ? cocoNames : {}).map(([index, label]) => ({ index: Number(index), label }));
}
