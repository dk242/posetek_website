import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import FeedPage, { ActivityCard } from "./FeedPage";
import { createSocialApi } from "./api";
import { socialCallableNames } from "./contracts";
import type { SocialActivity, SocialRequests, SocialResponses, SocialCallableName } from "./contracts";
import { formatMeasurement, initials, mergeActivities } from "./model";

// No test connects to Firebase, reads an account, or performs a network write.
vi.mock("../../lib/firebase", () => ({
  auth: { currentUser: null, onAuthStateChanged: vi.fn(), signOut: vi.fn() },
  cloud: { httpsCallable: vi.fn(() => { throw new Error("Unexpected Firebase call in offline test"); }) },
}));

const activity: SocialActivity = {
  id: "activity-1", playerId: "player-1", authorUid: "user-1", authorName: "Alex Sample",
  teamName: "Example team", title: "Shooting session", subtitle: "2 measured reps",
  kind: "session", occurredAt: 1789603200000,
  metrics: [{ label: "Best", value: 58.4, unit: "mph" }], chart: [53.2, 58.4],
  score: 108.3, partial: false, drill: "shooting", repCount: 2, canViewVideo: true,
  mine: true, audience: "team", hidden: false, kudos: 8, liked: false, comments: 3,
};

function renderPage(path: string): string {
  return renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><FeedPage /></MemoryRouter>);
}

describe("feed offline rendering", () => {
  it("keeps the live design preview, sample evidence, filters and navigation", () => {
    const html = renderPage("/feed?preview=1");
    expect(html).toContain("Design preview · sample activity · no account changes");
    expect(html).toContain("Jamie Rivera");
    expect(html).toContain("Sam Chen");
    expect(html).toContain("Taylor Brooks");
    expect(html).toContain("58.4 mph");
    expect(html).toContain('aria-label="Activity audience"');
    expect(html).toContain('href="/athlete?view=training&amp;preview=1"');
    expect(html.match(/class="social-card"/g)).toHaveLength(3);
    expect(html).not.toContain("Sign out");
  });

  it("does not render sample athlete data on authenticated routes before auth resolves", () => {
    const html = renderPage("/feed?organizationId=club-1");
    expect(html).toContain("Loading your community");
    expect(html).not.toContain("Jamie Rivera");
    expect(html).not.toContain("Sam Chen");
    expect(html).not.toContain("Taylor Brooks");
  });

  it("connection deep links open the people panel", () => {
    const html = renderPage("/feed?preview=1&connect=player-2");
    expect(html).toContain("Stronger connections.");
    expect(html).toContain("Search loaded members by name");
    expect(html).not.toContain('class="social-card"');
  });

  it("retains athlete-preview warnings and stays within the preview on player tabs", () => {
    const html = renderPage("/feed?preview=1&viewAsPlayerId=player-1&organizationId=club-1");
    expect(html).toContain("Read-only athlete preview");
    expect(html).toContain("Account actions are disabled.");
    expect(html).not.toContain('href="/athlete');
    expect(html).toContain('href="/admin"');
  });

  it("exposes chart evidence and disables writes while viewing another athlete", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/feed?viewAsPlayerId=player-1"]}>
        <ActivityCard activity={activity} organizationId="club-1" preview={false} onChange={() => {}} onPerson={() => {}} />
      </MemoryRouter>,
    );
    expect(html).toContain('aria-label="Last 2 rep results: 53.2, 58.4"');
    expect(html).toContain("108");
    expect(html).toContain("benchmark rating");
    expect(html).toContain('disabled="" aria-pressed="false"');
    expect(html).toContain('<select disabled=""');
    expect(html).toContain('aria-label="Play video"');
    expect(html).toContain('aria-label="Video progress"');
    expect(html.indexOf('class="feed-media"')).toBeLessThan(html.indexOf('social-chart-under-video'));
    expect(html).toContain("Hide activity from others");
  });
});

describe("social callable transport", () => {
  it("preserves names, payloads, pagination cursors and unwrapped responses", async () => {
    const requests = {
      getSocialContext: { organizationId: "club-1" },
      getSocialFeed: { scope: "friends", cursor: { time: 1234, id: "last" } },
      getSocialActivity: { id: "activity-1" },
      getSocialComments: { id: "activity-1", cursor: { time: 5678, id: "comment-1" } },
      getSocialPeople: { playerId: "player-1", cursor: "player-2" },
      getSocialMedia: { id: "activity-1", repId: "rep-1" },
      getSocialAdminDirectory: { organizationId: "club-1" },
      setSocialKudos: { id: "activity-1", liked: true },
      saveSocialComment: { id: "activity-1", commentId: "uuid-1", text: "Great session!" },
      setSocialVisibility: { id: "activity-1", audience: "friends", hidden: false },
      socialConnection: { playerId: "player-2", action: "accept" },
      saveSocialPreferences: { audience: "team", automatic: true, videos: false },
      reportSocialActivity: { id: "activity-1", reason: "Please review" },
      moderateSocialActivity: { id: "activity-1", hidden: true },
    } satisfies Pick<SocialRequests, typeof socialCallableNames[number]>;
    const payload = { ok: true };
    const invoke = vi.fn(async () => ({ data: payload }));
    const httpsCallable = vi.fn(() => invoke);
    const api = createSocialApi({ httpsCallable });
    for (const name of socialCallableNames) {
      expect(await api(name, requests[name])).toBe(payload);
      expect(httpsCallable).toHaveBeenLastCalledWith(name);
      expect(invoke).toHaveBeenLastCalledWith(requests[name]);
    }
    expect(httpsCallable).toHaveBeenCalledTimes(14);
  });

  it("rejects every mutation for athlete previews before contacting the backend", async () => {
    const httpsCallable = vi.fn();
    const api = createSocialApi({ httpsCallable });
    const requests = {
      setSocialKudos: { id: "activity-1", liked: true },
      saveSocialComment: { id: "activity-1", commentId: "uuid-1", remove: true },
      setSocialVisibility: { id: "activity-1", audience: "private", hidden: true },
      socialConnection: { playerId: "player-2", action: "block" },
      saveSocialPreferences: { audience: "private", automatic: false, videos: false },
      reportSocialActivity: { id: "activity-1", reason: "Please review" },
      moderateSocialActivity: { id: "activity-1", hidden: true },
    } satisfies Partial<SocialRequests>;
    for (const name of Object.keys(requests) as (keyof typeof requests)[]) {
      await expect(api(name, { ...requests[name], viewAsPlayerId: "player-1" })).rejects.toThrow("read-only");
    }
    expect(httpsCallable).not.toHaveBeenCalled();
  });

  it("keeps preview reads and moderation listing available to server authorization", async () => {
    const result: SocialResponses["getSocialActivity"] = activity;
    const invoke = vi.fn(async () => ({ data: result }));
    const httpsCallable = vi.fn(() => invoke);
    const api = createSocialApi({ httpsCallable });
    expect(await api("getSocialActivity", { id: activity.id, viewAsPlayerId: "player-1" })).toBe(result);
    await api("moderateSocialActivity", { viewAsPlayerId: "player-1" });
    expect(httpsCallable).toHaveBeenCalledTimes(2);
  });

  it("propagates permission and availability failures to the UI", async () => {
    const denied = new Error("This activity is no longer available to you.");
    const api = createSocialApi({ httpsCallable: () => async () => { throw denied; } });
    await expect(api("getSocialActivity", { id: "gone" })).rejects.toBe(denied);
  });

  it("documents every callable used by the recovered UI with no deployed runtime dependency", () => {
    const source = readFileSync(new URL("./FeedPage.jsx", import.meta.url), "utf8");
    const used = [...new Set([...source.matchAll(/callSocial\(`([^`]+)`/g)].map(match => match[1]))].sort();
    expect(used).toEqual(socialCallableNames.filter(name => name !== 'reportSocialActivity' && name !== 'getSocialMedia').sort());
    const mediaSource = readFileSync(new URL('./FeedMedia.tsx', import.meta.url), 'utf8');
    expect(mediaSource).toContain("callSocialV2('getSocialMedia'");
    expect(mediaSource).toContain('includeOverlay: true');
    expect(source).toContain('communityEnabled ? `reportSocialContent` : `reportSocialActivity`');
    expect(source).not.toMatch(/from ["'](?:https?:|.*(?:index-|firebase-|rolldown-runtime-))/);
    const names: SocialCallableName[] = [...socialCallableNames];
    expect(names).toHaveLength(14);
  });
});

describe("feed presentation and pagination", () => {
  it("preserves integer counts and measurement-specific precision", () => {
    expect(formatMeasurement(12, "")).toBe("12");
    expect(formatMeasurement(58.46, "mph")).toBe("58.5 mph");
    expect(formatMeasurement(3.456, "s")).toBe("3.46 s");
  });

  it("merges overlapping pages without duplicates or discarding refreshed card counts", () => {
    const old = [{ id: "one", kudos: 1 }, { id: "two", kudos: 2 }];
    const next = [{ id: "two", kudos: 3 }, { id: "three", kudos: 4 }];
    expect(mergeActivities(old, next)).toEqual([old[0], next[0], next[1]]);
    expect(old[1].kudos).toBe(2);
  });

  it("uses at most two name initials and accepts extra whitespace", () => {
    expect(initials("  Alex   Morgan  Sample ")).toBe("AM");
    expect(initials("You")).toBe("Y");
    expect(initials("")).toBe("");
  });
});
