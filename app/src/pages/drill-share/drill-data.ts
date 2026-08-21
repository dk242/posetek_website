// Firebase access ported from athlete-drill-view.js. Collection names, field
// fallbacks, query shapes and error messages are byte-identical to the legacy file.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { cloud, db, storage } from "../../lib/firebase";
import { configs, type DrillConfig, type PageDrillConfig } from "./drill-config";
import { folderCandidates, normalizeAuthRep, previewArtifacts, type Rep } from "./drill-lib";

export interface ViewerInfo {
  role: "coach" | "player" | "shared";
  uid?: string;
  docId?: string;
  data: Record<string, any>;
}

export interface PlayerInfo {
  id: string;
  data: Record<string, any>;
}

async function firstQuery(collectionName: string, field: string, value: unknown) {
  if (!value) return null;
  const snapshot = await db.collection(collectionName).where(field, "==", value).limit(1).get();
  return snapshot.empty ? null : snapshot.docs[0];
}

export async function resolveViewer(user: { uid: string; email?: string | null }): Promise<ViewerInfo> {
  let coachDoc: any = await db.collection("coaches").doc(user.uid).get();
  if (!coachDoc.exists) coachDoc = await firstQuery("coaches", "userUID", user.uid);
  if (coachDoc && coachDoc.exists) {
    return { role: "coach", uid: user.uid, docId: coachDoc.id, data: coachDoc.data() || {} };
  }

  const candidates: [string, string][] = [];
  if (user.email) {
    candidates.push(["signupEmail", user.email]);
    const lower = user.email.toLowerCase();
    if (lower !== user.email) candidates.push(["signupEmail", lower]);
  }
  candidates.push(["authenticationUID", user.uid], ["userUID", user.uid]);

  let playerDoc: any = null;
  for (const [field, value] of candidates) {
    playerDoc = await firstQuery("players", field, value);
    if (playerDoc) break;
  }
  if (!playerDoc) {
    const direct = await db.collection("players").doc(user.uid).get();
    if (direct.exists) playerDoc = direct;
  }
  if (!playerDoc || !playerDoc.exists) {
    throw new Error("Your login is valid, but it is not linked to an athlete profile yet. Ask your coach to connect this Auth ID to the player profile.");
  }
  return { role: "player", uid: user.uid, docId: playerDoc.id, data: playerDoc.data() || {} };
}

export async function resolveAuthorizedPlayer(viewer: ViewerInfo, requestedId: string | null): Promise<PlayerInfo> {
  if (viewer.role === "player") {
    if (requestedId && requestedId !== viewer.docId) {
      throw new Error("This link belongs to a different athlete account. Sign in with the account associated with this result.");
    }
    return { id: viewer.docId as string, data: viewer.data };
  }

  if (!requestedId) {
    throw new Error("This coach link is missing a player. Open the athlete from your roster, then copy their results link.");
  }

  const playerDoc = await db.collection("players").doc(requestedId).get();
  if (!playerDoc.exists) throw new Error("The athlete profile in this link no longer exists.");
  const playerData = playerDoc.data() || {};
  const members = Array.isArray(viewer.data.members) ? viewer.data.members : [];
  const linkedCoachIds = [playerData.coachUID, playerData.coachId, playerData.coachDocId].filter(Boolean);
  const authorized = members.includes(requestedId) || linkedCoachIds.includes(viewer.uid) || linkedCoachIds.includes(viewer.docId);
  if (!authorized) throw new Error("This athlete is not on your roster, so their results cannot be opened from this account.");
  return { id: playerDoc.id, data: playerData };
}

export async function loadReps(playerId: string, drillConfig: DrillConfig): Promise<Rep[]> {
  const repsRef = db.collection("players").doc(playerId).collection("reps");
  const accepted = drillConfig.acceptedRepTypes || [drillConfig.key];
  const snapshots = await Promise.all(accepted.flatMap(type => [
    repsRef.where("repType", "==", type).get(),
    repsRef.where("drillType", "==", type).get(),
  ]));

  const seen = new Set<string>();
  const reps: Rep[] = [];
  snapshots.flatMap(snapshot => snapshot.docs).forEach(doc => {
    if (seen.has(doc.id)) return;
    seen.add(doc.id);
    reps.push(normalizeAuthRep(doc.id, doc.data() || {}, drillConfig));
  });
  reps.sort((a, b) => (b.createdAtMillis - a.createdAtMillis) || ((b.absoluteRepNumber || 0) - (a.absoluteRepNumber || 0)));
  return reps;
}

export async function loadStatsReps(playerId: string): Promise<Rep[]> {
  const repGroups = await Promise.all(Object.values(configs).map(drillConfig => loadReps(playerId, drillConfig)));
  return repGroups.flat();
}

async function fetchStorageJson(path: string) {
  const url = await storage.ref(path).getDownloadURL();
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export interface LoadArtifactsOptions {
  rep: Rep;
  config: PageDrillConfig;
  playerId: string | null;
  shareToken: string | null;
  preview: boolean;
}

export async function loadArtifacts({ rep, config, playerId, shareToken, preview }: LoadArtifactsOptions): Promise<Record<string, any>> {
  if (preview) return previewArtifacts(config, rep);
  if (shareToken) {
    const getArtifacts = cloud.httpsCallable("getAthleteSharedRepArtifacts");
    const response = await getArtifacts({
      token: shareToken,
      drill: config.key,
      repId: rep.id,
    });
    const urls = ((response as any)?.data?.artifactUrls || {}) as Record<string, string>;
    const pairs = await Promise.all(config.artifacts.map(async fileName => {
      const url = urls[fileName];
      if (!url) return [fileName, null] as const;
      try {
        const artifactResponse = await fetch(url, { cache: "no-store", referrerPolicy: "no-referrer" });
        if (!artifactResponse.ok) throw new Error(`HTTP ${artifactResponse.status}`);
        return [fileName, await artifactResponse.json()] as const;
      } catch {
        return [fileName, null] as const;
      }
    }));
    return { folder: "shared", ...Object.fromEntries(pairs) };
  }
  const folders = folderCandidates(rep, playerId as string, config.key);
  for (const folder of folders) {
    try {
      const pairs = await Promise.all(config.artifacts.map(async fileName => {
        try {
          return [fileName, await fetchStorageJson(`${folder}/${fileName}`)] as const;
        } catch {
          return [fileName, null] as const;
        }
      }));
      const artifacts = Object.fromEntries(pairs) as Record<string, any>;
      if (artifacts["pose.json"] || artifacts["metadata.json"]) return { folder, ...artifacts };
    } catch {
      /* Try the next compatible folder. */
    }
  }
  return { folder: folders[0] || "" };
}
