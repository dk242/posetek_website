import { cloud } from "../../lib/firebase";
import type { SocialApi, SocialCallableName, SocialRequests, SocialResponses } from "./contracts";

/** Narrow transport boundary lets web and app clients share contracts, and tests
 * exercise the exact callable payloads without creating Firebase data.
 */
export interface SocialTransport {
  httpsCallable(name: string): (data: unknown) => Promise<{ data: unknown }>;
}

const mutationNames = new Set<SocialCallableName>([
  "setSocialKudos", "saveSocialComment", "setSocialVisibility", "socialConnection",
  "saveSocialPreferences", "reportSocialActivity",
]);

export function createSocialApi(transport: SocialTransport): SocialApi {
  return async <Name extends SocialCallableName>(name: Name, data: SocialRequests[Name]) => {
    const viewer = data as { viewAsPlayerId?: string; id?: string };
    const mutation = mutationNames.has(name) || (name === "moderateSocialActivity" && !!viewer.id);
    // Defense in depth for new consumers. The recovered backend also enforces
    // this rule; removing disabled buttons can never authorize an admin preview write.
    if (viewer.viewAsPlayerId && mutation) throw new Error("Athlete previews are read-only.");
    const response = await transport.httpsCallable(name)(data);
    return response.data as SocialResponses[Name];
  };
}

export const callSocial = createSocialApi(cloud);
