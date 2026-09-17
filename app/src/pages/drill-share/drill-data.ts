// Dedicated authenticated drill pages use the same identity and current club
// membership checks as the athlete portal. Shared links retain their own protocol.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { visibleAttempts, sameResultStatus } from "../../lib/result-values";
import { cloud, db } from "../../lib/firebase";
import { findCoach, findPlayer, ownsPlayer } from "../../lib/identity";
import { loadClubMembership } from "../../lib/organization-data";
import { canAccessClubPlayer } from "../../lib/organization";
import { refreshAdminIdentity } from "../admin/lib/identity";
import { configs, type DrillConfig, type PageDrillConfig } from "./drill-config";
import { normalizeAuthRep, previewArtifacts, type Rep } from "./drill-lib";

export interface ViewerInfo {
  role: "admin" | "manager" | "coach" | "player" | "shared";
  uid?: string;
  docId?: string;
  data: Record<string, any>;
}

export interface PlayerInfo {
  id: string;
  data: Record<string, any>;
}

export async function resolveAuthenticatedDrillPlayer(
  user: { uid: string; email?: string | null; isAnonymous?: boolean }, requestedId: string | null,
): Promise<{ viewer: ViewerInfo; player: PlayerInfo }> {
  if (!user.uid || user.isAnonymous) throw new Error("Sign in to view athlete results.");
  const identity = await refreshAdminIdentity(user);
  if (identity.uid !== user.uid) throw new Error("Your account changed. Reload these results.");
  const playerDoc = requestedId
    ? await db.collection("players").doc(requestedId).get()
    : await findPlayer(db, user.uid);
  if (!playerDoc?.exists) throw new Error("This athlete profile could not be found. Open the athlete from your roster, then copy their results link.");
  const playerData = playerDoc.data() || {};
  const player = { id: playerDoc.id, data: playerData };
  if (identity.isAdmin) return { viewer: { role: "admin", uid: user.uid, data: {} }, player };
  if (ownsPlayer(playerDoc, user.uid)) return { viewer: { role: "player", uid: user.uid, docId: playerDoc.id, data: playerData }, player };
  // A migrated athlete is authorized only by current canonical membership;
  // stale legacy roster mirrors never substitute for a revoked assignment.
  if (Object.hasOwn(playerData, "organizationId")) {
    if (typeof playerData.organizationId !== "string" || !playerData.organizationId) throw new Error("You do not have permission to view this athlete.");
    const membership = await loadClubMembership(user.uid, playerData.organizationId);
    if (!canAccessClubPlayer(membership, playerData)) throw new Error("You do not have permission to view this athlete.");
    return { viewer: { role: membership!.role, uid: user.uid, data: {} }, player };
  }
  const coachDoc = await findCoach(db, user.uid);
  const coachData = coachDoc?.data() || {};
  const members = Array.isArray(coachData.members) ? coachData.members : [];
  const linkedCoachIds = [playerData.coachUID, playerData.coachId, playerData.coachDocId].filter(Boolean);
  const authorized = Boolean(coachDoc && (members.includes(playerDoc.id) || linkedCoachIds.includes(user.uid) || linkedCoachIds.includes(coachDoc.id)));
  if (!authorized) throw new Error("This athlete is not on your roster, so their results cannot be opened from this account.");
  return { viewer: { role: "coach", uid: user.uid, docId: coachDoc!.id, data: coachData }, player };
}

export async function loadReps(playerId: string, drillConfig: DrillConfig): Promise<Rep[]> {
  const response = await cloud.httpsCallable("getAthleteEffectiveResults")({ playerId, drill: drillConfig.key });
  const reps = visibleAttempts(((response.data as any).reps || []) as Record<string, any>[])
    .map(rep => normalizeAuthRep(rep.id, rep, drillConfig));
  return reps.sort((a, b) => b.createdAtMillis - a.createdAtMillis || (b.absoluteRepNumber || 0) - (a.absoluteRepNumber || 0));
}

export async function loadStatsReps(playerId: string): Promise<Rep[]> {
  const response = await cloud.httpsCallable("getAthleteEffectiveResults")({ playerId });
  return visibleAttempts(((response.data as any).reps || []) as Record<string, any>[]).flatMap(rep => {
    const config = Object.values(configs).find(config => config.acceptedRepTypes.includes(rep.repType || rep.drillType));
    return config ? [normalizeAuthRep(rep.id, rep, config)] : [];
  }).sort((a, b) => b.createdAtMillis - a.createdAtMillis);
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
  const response = shareToken
    ? await cloud.httpsCallable("getAthleteSharedRepArtifacts")({ token: shareToken, drill: config.key, repId: rep.id })
    : await cloud.httpsCallable("getAthleteRepMedia")({ playerId, drill: config.key, repId: rep.id });
  const payload = (response.data || {}) as any;
  if (rep.resultStatus && payload.resultStatus && !sameResultStatus(rep.resultStatus, payload.resultStatus)) {
    throw new Error("This result changed. Refresh the athlete results to view the latest revision.");
  }
  const urls = payload.artifactUrls || {};
  const pairs = await Promise.all(config.artifacts.map(async fileName => {
    const url = urls[fileName];
    if (!url) return [fileName, null];
    try {
      const artifactResponse = await fetch(url, { cache: "no-store", referrerPolicy: "no-referrer" });
      if (!artifactResponse.ok) throw new Error(`HTTP ${artifactResponse.status}`);
      return [fileName, await artifactResponse.json()];
    } catch { return [fileName, null]; }
  }));
  return { ...Object.fromEntries(pairs), mediaUrl: payload.mediaUrl || null, mediaSource: payload.source || "unavailable", resultStatus: payload.resultStatus };
}
