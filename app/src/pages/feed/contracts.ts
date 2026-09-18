/** Client contracts verified against the recovered deployed functions/social.js.
 * Times are epoch milliseconds; callable results are the Firebase `data` payload.
 * Firestore is never accessed directly by this feature. See PROVENANCE.md.
 */
export type SocialAudience = "organization" | "team" | "friends" | "private" | "community";
export type FeedScope = "all" | "team" | "organization" | "friends" | "mine" | "community";
export type ConnectionAction = "request" | "accept" | "remove" | "block" | "unblock";
export type ConnectionRelationship = "none" | "sent" | "received" | "accepted" | "blocked";

export interface SocialPreferences {
  audience: Exclude<SocialAudience, 'community'>;
  automatic: boolean;
  videos: boolean;
}

export interface SocialViewer {
  contractVersion?: 2;
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
  communityEnabled?: boolean;
}

export interface SocialMetric { label: string; value: number; unit: string }
export interface SocialActivity {
  id: string;
  playerId: string;
  authorName: string;
  authorUid?: string | null;
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
  /** Explicit per-post consent; older video-only posts default to false. */
  poseOverlay?: boolean;
  mine: boolean;
  audience: SocialAudience;
  hidden: boolean;
  kudos: number;
  liked: boolean;
  comments: number;
  caption?: string;
  selectedRepId?: string | null;
  availableReps?: { id: string; label: string; canViewVideo: boolean }[];
  commentsEnabled?: boolean;
  canComment?: boolean;
  communityPublished?: boolean;
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
  canConnect?: boolean;
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
  getSocialFeed: SocialViewer & { scope?: FeedScope; cursor?: TimeCursor | null; playerId?: string };
  getSocialActivity: ActivityRequest;
  getSocialComments: ActivityRequest & { cursor?: TimeCursor | null };
  getSocialPeople: SocialViewer & { cursor?: string | null; playerId?: string };
  getSocialMedia: ActivityRequest & { repId?: string; includeOverlay?: boolean };
  getSocialAdminDirectory: { organizationId?: string };
  setSocialKudos: ActivityRequest & { liked: boolean };
  saveSocialComment: ActivityRequest & { commentId: string } &
    ({ text: string; remove?: false } | { remove: true });
  setSocialVisibility: ActivityRequest & { audience: SocialAudience; hidden: boolean; caption?: string; selectedRepId?: string | null; videos?: boolean; poseOverlay?: boolean; commentsEnabled?: boolean };
  socialConnection: SocialViewer & { playerId: string; action: ConnectionAction };
  saveSocialPreferences: SocialViewer & SocialPreferences;
  reportSocialActivity: ActivityRequest & { reason: string };
  moderateSocialActivity: SocialViewer & ({ id?: never; hidden?: never } | { id: string; hidden: boolean });
  getSocialCommunityProfile: SocialViewer & { playerId?: string };
  saveSocialCommunityProfile: SocialViewer & { displayName: string; discoverable: boolean; showClub: boolean };
  getSocialDiscovery: SocialViewer & { query?: string; cursor?: string | null };
  withdrawSocialCommunityPosts: SocialViewer;
  getSocialInbox: SocialViewer & { cursor?: TimeCursor | null };
  markSocialInboxRead: SocialViewer & { ids: string[] };
  reportSocialContent: SocialViewer & { targetType: 'activity' | 'comment' | 'profile'; activityId?: string; commentId?: string; playerId?: string; reason: string };
  moderateSocialContent: SocialViewer & { reportId?: string; action?: 'hideActivity' | 'removeComment' | 'suspendProfile' | 'restoreProfile' | 'dismiss' };
}

export interface CommunityProfile {
  playerId: string;
  displayName: string;
  displayNameConfigured?: boolean;
  discoverable: boolean;
  showClub?: boolean;
  clubName: string;
  relationship: ConnectionRelationship;
  mine: boolean;
  suspended: boolean;
  communityPostsWithdrawnAt: number | null;
}
export interface InboxItem {
  id: string;
  type: 'request' | 'accepted' | 'kudos' | 'comment';
  actor: { playerId: string | null; displayName: string };
  activityId?: string;
  createdAt: number;
  read: boolean;
}
export interface CommunityReport {
  id: string;
  targetType: 'activity' | 'comment' | 'profile';
  activityId?: string;
  commentId?: string;
  playerId?: string;
  reason: string;
  createdAt: number;
  resolved?: boolean;
  targetSuspended?: boolean;
}

export interface SocialResponses {
  getSocialContext: SocialContext;
  getSocialFeed: { items: SocialActivity[]; cursor: TimeCursor | null };
  getSocialActivity: SocialActivity;
  getSocialComments: { items: SocialComment[]; cursor: TimeCursor | null };
  getSocialPeople: { people: SocialPerson[]; cursor: string | null };
  getSocialMedia: { url: string | null; expiresAt: number | null; overlay?: SocialPoseOverlay | null };
  getSocialAdminDirectory: SocialAdminDirectory;
  getSocialCommunityProfile: CommunityProfile;
  saveSocialCommunityProfile: CommunityProfile;
  getSocialDiscovery: { people: CommunityProfile[]; cursor: string | null };
  withdrawSocialCommunityPosts: MutationResult;
  getSocialInbox: { items: InboxItem[]; cursor: TimeCursor | null; unreadCount: number; unreadCountIsLowerBound: boolean };
  markSocialInboxRead: MutationResult;
  reportSocialContent: MutationResult;
  moderateSocialContent: { reports: CommunityReport[] } | MutationResult;
  setSocialKudos: MutationResult;
  saveSocialComment: MutationResult;
  setSocialVisibility: MutationResult;
  socialConnection: MutationResult;
  saveSocialPreferences: MutationResult;
  reportSocialActivity: MutationResult;
  moderateSocialActivity: { reports: SocialReport[]; ok?: never } | { reports?: never; ok: true };
}

/** Sanitized display-only evidence, aligned to the authorized recording. */
export interface SocialPoseOverlay {
  version: 1;
  coordinateSpace: 'normalized';
  layout: 'coco17' | 'mediapipe33';
  sourceWidth: number;
  sourceHeight: number;
  frames: { time: number; points: ([number, number] | null)[] }[];
  markers: { label: string; time: number }[];
  footJoints: { left: number; right: number };
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

export const communityCallableNames = [
  'getSocialCommunityProfile', 'saveSocialCommunityProfile', 'getSocialDiscovery',
  'withdrawSocialCommunityPosts', 'getSocialInbox', 'markSocialInboxRead',
  'reportSocialContent', 'moderateSocialContent',
] as const satisfies readonly SocialCallableName[];
