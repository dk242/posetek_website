import { cloud } from "../../../lib/firebase";
import type { DrillAuthoring } from "./wholeBodyTraining";

export async function loadDrillAuthoring(drillId?: string): Promise<{ records: Record<string, DrillAuthoring>; canReview: boolean }> {
  return (await cloud.httpsCallable("trainingGetDrillAuthoring")(drillId ? { drillId } : {})).data;
}
export async function authoringAction(action: "trainingSaveDrillAuthoring" | "trainingReviewDrill" | "trainingPublishDrill" | "trainingApproveDrillMedia", payload: Record<string, unknown>) {
  return (await cloud.httpsCallable(action)(payload)).data;
}
export async function getTrainingReadiness(playerId: string) {
  return (await cloud.httpsCallable("trainingGetReadiness")({ playerId })).data;
}
export async function saveTrainingReadiness(playerId: string, baseRevision: number, readiness: Record<string, unknown>) {
  return (await cloud.httpsCallable("trainingSaveReadiness")({ playerId, baseRevision, readiness })).data;
}
export async function designateTrainingReviewer(uid: string, enabled: boolean, qualification: string, displayName: string) {
  return (await cloud.httpsCallable("trainingSetReviewer")({ uid, enabled, qualification, displayName })).data;
}
