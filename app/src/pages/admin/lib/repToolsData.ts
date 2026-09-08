// Firebase reads and the callable writes behind the rep tools.
//
// Reads go straight to Firestore/Storage — an admin may read every athlete
// record. Writes go through the `adminReviseRep` / `adminRestoreRepRevision`
// callables (functions/rep-revisions.js): the rules deny every client, admins
// included, a write to reps or to athlete recording folders, so the Admin SDK
// behind those callables is the only path that can overwrite a rep in place.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { cloud, db, storage } from "../../../lib/firebase";
import type { Drill } from "../../athlete-portal/lib/drills";
import { normalizeRep, sessionFolder } from "../../athlete-portal/lib/metrics";
import { artifactFolder } from "../../athlete-portal/lib/metrics";
import { parseArtifactJson } from "./repTools";
import type { RevisionPayload } from "./repTools";

export interface RepArtifactBundle {
  folder: string;
  sessionRoot: string;
  mediaUrl: string | null;
  mediaName: string | null;
  pose: any;
  metadata: any;
  reprocessContext: any;
  arucoCorners: any;
  markerConfig: any;
  adminAnnotations: any;
  ballBoxes: any;
  /** Artifact names found directly in the rep folder. */
  files: string[];
}

async function readJsonAt(ref: any): Promise<any> {
  try {
    const url = await ref.getDownloadURL();
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return parseArtifactJson(await response.text());
  } catch {
    return null;
  }
}

const MARKER_CONFIG_NAMES: Record<string, string> = {
  changeOfDirection: "change_of_direction_marker.json",
  dribbling: "dribbling_marker.json",
  sprint: "sprint_marker.json",
};

export async function loadRep(playerId: string, repId: string): Promise<any | null> {
  const doc = await db.collection("players").doc(playerId).collection("reps").doc(repId).get();
  return doc.exists ? normalizeRep(doc) : null;
}

export async function loadRepArtifacts(drill: Drill, rep: any, playerId: string): Promise<RepArtifactBundle> {
  const folder = artifactFolder(rep, drill, playerId);
  const base = storage.ref(folder);
  const sessionRoot = `${playerId}/${drill.storage}/${sessionFolder(rep)}`;
  const root = storage.ref(sessionRoot);

  let files: string[] = [];
  let mediaUrl: string | null = null;
  let mediaName: string | null = null;
  try {
    const listing = await base.listAll();
    files = listing.items.map(item => item.name);
    const movie = listing.items.find(item => /\.(mov|mp4)$/i.test(item.name));
    if (movie) {
      mediaUrl = await movie.getDownloadURL();
      mediaName = movie.name;
    }
  } catch (error) {
    console.warn("[rep tools] folder listing unavailable", folder, error);
  }

  const [pose, metadata, reprocessContext, adminAnnotations, ballBoxes, arucoCorners, markerConfig] = await Promise.all([
    readJsonAt(base.child("pose.json")),
    readJsonAt(base.child("metadata.json")),
    readJsonAt(base.child("reprocess_context.json")),
    readJsonAt(base.child("admin_annotations.json")),
    files.includes("ball_boxes.json") ? readJsonAt(base.child("ball_boxes.json")) : Promise.resolve(null),
    readJsonAt(root.child("aruco_corners.json")),
    MARKER_CONFIG_NAMES[drill.key] ? readJsonAt(root.child(MARKER_CONFIG_NAMES[drill.key])) : Promise.resolve(null),
  ]);

  return { folder, sessionRoot, mediaUrl, mediaName, pose, metadata, reprocessContext, arucoCorners, markerConfig, adminAnnotations, ballBoxes, files };
}

export interface RepRevisionRow {
  id: string;
  createdAtMillis: number;
  byEmail: string | null;
  note: string;
  fields: Record<string, any>;
  restored: boolean;
  previous: Record<string, any>;
}

export async function loadRepRevisions(playerId: string, repId: string): Promise<RepRevisionRow[]> {
  const snapshot = await db.collection("players").doc(playerId).collection("reps").doc(repId).collection("revisions").get();
  return snapshot.docs
    .map(doc => {
      const data: any = doc.data() || {};
      return {
        id: doc.id,
        createdAtMillis: Number(data.createdAtMillis || data.createdAt?.toMillis?.() || 0),
        byEmail: data.byEmail ? String(data.byEmail) : null,
        note: String(data.note || ""),
        fields: data.fields || {},
        restored: Boolean(data.restoredAtMillis),
        previous: data.previous || {},
      };
    })
    .sort((a, b) => b.createdAtMillis - a.createdAtMillis);
}

export interface ReviseResult {
  revisionId: string;
  folder: string;
  rep: any;
}

export async function pushRepRevision(payload: RevisionPayload): Promise<ReviseResult> {
  const result = await cloud.httpsCallable("adminReviseRep")(payload);
  return result.data as ReviseResult;
}

export async function restoreRepRevision(playerId: string, repId: string, revisionId: string): Promise<any> {
  const result = await cloud.httpsCallable("adminRestoreRepRevision")({ playerId, repId, revisionId });
  return result.data;
}
