/** Client contracts verified against the recovered deployed functions/social.js.
 * Times are epoch milliseconds; callable results are the Firebase `data` payload.
 * Firestore is never accessed directly by this feature. See PROVENANCE.md.
 */
export type SocialAudience = "organization" | "team" | "friends" | "private";
export type FeedScope = "all" | "team" | "organization" | "friends" | "mine";
export type ConnectionAction = "request" | "accept" | "remove" | "block" | "unblock";
export type ConnectionRelationship = "none" | "sent" | "received" | "accepted" | "blocked";

export interface SocialPreferences {
  audience: SocialAudience;
  automatic: boolean;
  videos: boolean;
}

export interface SocialViewer {
  /** Organization override is honored by the server only for administrators. */
  organizationId?: string;
  /** Administrator-only athlete impersonation. Every mutation is forbidden. */
  viewAsPlayerId?: string;
}

export interface SocialContext {
  uid: string;
  playerId: string | null;
  name: string;
  organizationId: string | null;
  organizationName: string;
  teamId: string | null;
  teamName: string;
  staff: boolean;
  admin: boolean;
  enabled: boolean;
  preferences: SocialPreferences;
  adminViewer?: boolean;
  previewPlayerId?: string | null;
}

export interface SocialMetric { label: string; value: number; unit: string }
export interface SocialActivity {
  id: string;
  playerId: string;
  authorName: string;
  authorUid: string | null;
  teamName: string;
  title: string;
  subtitle: string;
  kind: "session" | "workout";
  occurredAt: number;
  metrics: SocialMetric[];
  chart: number[];
  score: number | null;
  partial: boolean;
  drill: string | null;
  repCount: number;
  canViewVideo: boolean;
  mine: boolean;
  audience: SocialAudience;
  hidden: boolean;
  kudos: number;
  liked: boolean;
  comments: number;
}

export interface TimeCursor { time: number; id: string }
export interface SocialComment {
  id: string;
  uid: string;
  name: string;
  text: string;
  createdAt: number;
  canDelete: boolean;
}
export interface SocialPerson {
  playerId: string;
  name: string;
  uid: string | null;
  mine: boolean;
  sameTeam: boolean;
  relationship: ConnectionRelationship;
}
export interface SocialReport {
  id: string;
  activityId: string;
  reporterUid: string;
  reason: string;
  createdAt: number;
  resolved: boolean;
}
export interface SocialAdminDirectory {
  organizations: { id: string; name: string }[];
  players: { id: string; name: string; canPreview: boolean }[];
}

interface ActivityRequest extends SocialViewer { id: string }
type MutationResult = { ok: true };

export interface SocialRequests {
  getSocialContext: SocialViewer;
  getSocialFeed: SocialViewer & { scope?: FeedScope; cursor?: TimeCursor | null };
  getSocialActivity: ActivityRequest;
  getSocialComments: ActivityRequest & { cursor?: TimeCursor | null };
  getSocialPeople: SocialViewer & { cursor?: string | null; playerId?: string };
  getSocialMedia: ActivityRequest & { repId?: string };
  getSocialAdminDirectory: { organizationId?: string };
  setSocialKudos: ActivityRequest & { liked: boolean };
  saveSocialComment: ActivityRequest & { commentId: string } &
    ({ text: string; remove?: false } | { remove: true });
  setSocialVisibility: ActivityRequest & { audience: SocialAudience; hidden: boolean };
  socialConnection: SocialViewer & { playerId: string; action: ConnectionAction };
  saveSocialPreferences: SocialViewer & SocialPreferences;
  reportSocialActivity: ActivityRequest & { reason: string };
  moderateSocialActivity: SocialViewer & ({ id?: never; hidden?: never } | { id: string; hidden: boolean });
}

export interface SocialResponses {
  getSocialContext: SocialContext;
  getSocialFeed: { items: SocialActivity[]; cursor: TimeCursor | null };
  getSocialActivity: SocialActivity;
  getSocialComments: { items: SocialComment[]; cursor: TimeCursor | null };
  getSocialPeople: { people: SocialPerson[]; cursor: string | null };
  getSocialMedia: { url: string | null; expiresAt: number | null };
  getSocialAdminDirectory: SocialAdminDirectory;
  setSocialKudos: MutationResult;
  saveSocialComment: MutationResult;
  setSocialVisibility: MutationResult;
  socialConnection: MutationResult;
  saveSocialPreferences: MutationResult;
  reportSocialActivity: MutationResult;
  moderateSocialActivity: { reports: SocialReport[]; ok?: never } | { reports?: never; ok: true };
}

export type SocialCallableName = keyof SocialRequests;
export type SocialApi = <Name extends SocialCallableName>(
  name: Name,
  data: SocialRequests[Name],
) => Promise<SocialResponses[Name]>;

export const socialCallableNames = [
  "getSocialContext", "getSocialFeed", "getSocialActivity", "getSocialComments",
  "getSocialPeople", "getSocialMedia", "getSocialAdminDirectory", "setSocialKudos",
  "saveSocialComment", "setSocialVisibility", "socialConnection", "saveSocialPreferences",
  "reportSocialActivity", "moderateSocialActivity",
] as const satisfies readonly SocialCallableName[];
