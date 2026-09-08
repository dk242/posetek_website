import { cloud, db, storage } from "../../../lib/firebase";
import { playerRow } from "./accounts";
import type { PlayerRow } from "./accounts";
import { submitLlmJob } from "../../athlete-portal/lib/loaders";
import type { ReviewFeedback, ReviewNotes, TechniqueAnnotation } from "./analysisReview";
import { artifactFolder, normalizeRep } from "../../athlete-portal/lib/metrics";
import { loadRepArtifacts } from "./repToolsData";
import type { RepArtifactBundle } from "./repToolsData";
import { drillByKey } from "../../athlete-portal/lib/drills";

export interface SourceIdentity { path: string; generation: string; md5Hash: string | null }
export type ObservedSource = Record<string, SourceIdentity | null>;
export async function loadAnnotationArtifacts(playerId: string, rep: any): Promise<RepArtifactBundle & { sourceIdentities: ObservedSource }> {
  const drill = drillByKey("shooting"), folder = artifactFolder(rep, drill, playerId);
  async function identities(): Promise<ObservedSource> {
    const entries = await Promise.all(["pose.json", "metadata.json", "reprocess_context.json"].map(async name => {
      try {
        const metadata = await storage.ref(`${folder}/${name}`).getMetadata();
        return [name, { path: metadata.fullPath, generation: String(metadata.generation), md5Hash: metadata.md5Hash || null }];
      } catch (error: any) { if (error.code === "storage/object-not-found") return [name, null]; throw error; }
    }));
    return Object.fromEntries(entries);
  }
  const before = await identities();
  const bundle = await loadRepArtifacts(drill, rep, playerId);
  const after = await identities();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("The recording changed while it was loading. Reload before annotating.");
  return { ...bundle, sourceIdentities: after };
}

export async function loadAnalysisReps(playerId: string): Promise<any[]> {
  const snapshot = await db.collection("players").doc(playerId).collection("reps").get();
  return snapshot.docs.map(normalizeRep).filter(rep => ["side_kick", "deadballShot", "shooting", "kick"].some(kind => [rep.repType, rep.drillType].includes(kind)));
}

export async function organizationAthletes(organizationId: string): Promise<PlayerRow[]> {
  const players = db.collection("players");
  const snapshots = await Promise.all([
    players.where("organizationId", "==", organizationId).get(),
    players.where("organization", "==", db.collection("organizations").doc(organizationId)).get(),
    players.where("organization", "==", organizationId).get(),
  ]);
  const rows = new Map<string, PlayerRow>();
  snapshots.forEach(snapshot => snapshot.docs.forEach(doc => rows.set(doc.id, playerRow(doc.id, doc.data()))));
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export interface ReviewTarget { targetId: string; targetType: "single" | "comparison"; result: any; head: any; review: any; history: any[] }
export async function loadReviewTarget(playerId: string, targetType: "single" | "comparison", targetId: string): Promise<ReviewTarget> {
  const player = db.collection("players").doc(playerId);
  const [current, head, history] = await Promise.all([
    player.collection(targetType === "single" ? "aiAnalyses" : "aiKickComparisons").doc(targetId).get(),
    player.collection("aiAnalysisReviewHeads").doc(`${targetType}_${targetId}`).get(),
    player.collection("aiAnalysisReviews").where("targetKey", "==", `${targetType}_${targetId}`).get(),
  ]);
  const reviews = history.docs.map(doc => ({ ...doc.data(), reviewId: doc.id })).sort((a: any, b: any) => b.revision - a.revision);
  let review: any = null;
  if (head.exists) {
    const selected = await player.collection("aiAnalysisReviews").doc(head.data()!.reviewId).get();
    if (!selected.exists || selected.data()?.revision !== head.data()?.revision || selected.data()?.targetKey !== `${targetType}_${targetId}`) throw new Error("The latest review is unavailable. Reload before editing.");
    review = { ...selected.data(), reviewId: selected.id };
    if (!reviews.some(row => row.reviewId === selected.id)) reviews.unshift(review);
  }
  return { targetId, targetType, result: current.exists ? current.data() : null, head: head.exists ? head.data() : null, review, history: reviews };
}
export async function loadComparisons(playerId: string): Promise<any[]> {
  const snapshot = await db.collection("players").doc(playerId).collection("aiKickComparisons").get();
  return snapshot.docs.map(doc => ({ ...doc.data(), comparisonId: doc.id }));
}
export async function generateAnalysis(playerId: string, capability: "kick_analysis" | "kick_foot_comparison", params: Record<string, string>, onStatus: (message: string) => void): Promise<any> {
  const ref = await submitLlmJob(playerId, capability, params);
  onStatus(`Queued analysis ${ref.id}. You can leave this page; processing continues.`);
  return new Promise((resolve, reject) => {
    const unsubscribe = ref.onSnapshot((snapshot: any) => {
      const job = snapshot.data() || {};
      if (job.status === "complete") { unsubscribe(); clearTimeout(timeout); resolve(job.result || job); }
      else if (job.status === "failed") { unsubscribe(); clearTimeout(timeout); reject(new Error(job.error?.detail || job.error?.message || "Analysis failed.")); }
      else if (job.status === "running") onStatus("Reading the kick evidence and preparing feedback…");
    }, (error: Error) => { unsubscribe(); clearTimeout(timeout); reject(error); });
    const timeout = setTimeout(() => { unsubscribe(); reject(new Error(`Still processing. Reload saved analyses later. Job: ${ref.id}`)); }, 12 * 60 * 1000);
  });
}
export interface SaveReviewInput { playerId: string; targetType: "single" | "comparison"; targetId: string; sourceJobId: string | null; baseRevision: number; feedback: ReviewFeedback; annotations: TechniqueAnnotation[]; notes: ReviewNotes; datasetApproved: boolean; publish: boolean; observedSources: Record<string, ObservedSource>; resetManualSource: boolean }
export async function saveAnalysisReview(payload: SaveReviewInput): Promise<any> {
  return (await cloud.httpsCallable("adminSaveAnalysisReview", { timeout: 120000 })(payload)).data;
}
export async function exportAnalysisReviews(playerIds: string[]): Promise<number> {
  let cursor: string | null = null;
  const rows: any[] = [];
  do {
    const result: any = (await cloud.httpsCallable("adminExportAnalysisReviews", { timeout: 120000 })({ playerIds, cursor })).data;
    rows.push(...result.examples); cursor = result.nextCursor;
  } while (cursor);
  const blob = new Blob([rows.map(row => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "")], { type: "application/x-ndjson" });
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = `kick-reviews-${new Date().toISOString().slice(0, 10)}.jsonl`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return rows.length;
}
