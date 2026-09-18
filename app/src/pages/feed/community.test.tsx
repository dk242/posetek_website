import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createSocialApi } from './api';
import { CommunitySettings, PublishActivity } from './CommunityPanels';
import { communityCallableNames, type SocialActivity, type SocialRequests } from './contracts';
import { socialMediaLease } from './media-lease';
import { athleteTabUrl } from '../athlete-portal/player/player-navigation';
import { feedWorkspaceScope, normalizedPlayerPath, playerPaths, playerWorkspaceScope } from '../athlete-portal/player/PlayerWorkspace';

vi.mock('../../lib/firebase', () => ({
  auth: { currentUser: null, onAuthStateChanged: vi.fn() },
  cloud: { httpsCallable: vi.fn(() => { throw new Error('Unexpected network request'); }) },
}));

describe('community transport isolation', () => {
  it('keeps all new mutations read-only in staff athlete previews', async () => {
    const transport = { httpsCallable: vi.fn() }, api = createSocialApi(transport);
    const mutations = {
      saveSocialCommunityProfile: { displayName: 'Sample', discoverable: true, showClub: false },
      withdrawSocialCommunityPosts: {}, markSocialInboxRead: { ids: ['n1'] },
      reportSocialContent: { targetType: 'profile', playerId: 'p1', reason: 'Review' },
      moderateSocialContent: { reportId: 'r1', action: 'restoreProfile' },
    } satisfies Partial<SocialRequests>;
    for (const name of Object.keys(mutations) as (keyof typeof mutations)[]) {
      await expect(api(name, { ...mutations[name], viewAsPlayerId: 'p1', contractVersion: 2 })).rejects.toThrow('read-only');
    }
    expect(transport.httpsCallable).not.toHaveBeenCalled();
  });

  it('preserves explicit audience, selected rep, cursor and notification identities', async () => {
    const requests = {
      getSocialCommunityProfile: { playerId: 'p1' },
      saveSocialCommunityProfile: { displayName: 'Sample', discoverable: true, showClub: false },
      getSocialDiscovery: { query: 'Sa', cursor: 'p0' }, withdrawSocialCommunityPosts: {},
      getSocialInbox: { cursor: { id: 'n1', time: 100 } }, markSocialInboxRead: { ids: ['n1', 'n2'] },
      reportSocialContent: { targetType: 'comment', activityId: 'a1', commentId: 'c1', reason: 'Review' },
      moderateSocialContent: { reportId: 'r1', action: 'removeComment' },
    } satisfies Pick<SocialRequests, typeof communityCallableNames[number]>;
    const invoke = vi.fn(async () => ({ data: { ok: true } })), transport = { httpsCallable: vi.fn(() => invoke) };
    const api = createSocialApi(transport);
    for (const name of communityCallableNames) {
      await api(name, { ...requests[name], contractVersion: 2 });
      expect(transport.httpsCallable).toHaveBeenLastCalledWith(name);
      expect(invoke).toHaveBeenLastCalledWith({ ...requests[name], contractVersion: 2 });
    }
    const sharing = { id: 'a1', audience: 'community', hidden: false, caption: 'Practice', selectedRepId: 'rep7', videos: true, commentsEnabled: false, contractVersion: 2 } as const;
    await api('setSocialVisibility', sharing);
    expect(invoke).toHaveBeenLastCalledWith(sharing);
  });
});

describe('workspace identity and expiring media', () => {
  it('keeps the router’s trailing-slash and case-insensitive legacy routes', () => {
    for (const path of ['/athlete/', '/FEED/', '/Profile.html', '/feed.html/']) expect(playerPaths.has(normalizedPlayerPath(path))).toBe(true);
    expect(playerPaths.has(normalizedPlayerPath('/athletes'))).toBe(false);
  });
  it('keeps an implicit signed-in athlete implicit on return from Feed', () => {
    const before = '?view=aiCoach';
    const destination = athleteTabUrl('aiCoach', false, 'resolved-id', before);
    expect(destination).toBe('/athlete?view=aiCoach');
    expect(playerWorkspaceScope(new URL(destination, 'https://posetek.net').search)).toBe(playerWorkspaceScope(before));
  });
  it('preserves explicit athlete targets while removing old drill links for a different tab', () => {
    expect(athleteTabUrl('training', false, 'self', '?player=target&share=token&drill=sprint&session=s1&rep=r1')).toBe('/athlete?player=target&share=token&view=training');
    expect(athleteTabUrl('home', false, 'self', null)).toBe('/athlete?view=home&player=self');
    expect(feedWorkspaceScope('?panel=inbox&viewAsPlayerId=a')).not.toBe(feedWorkspaceScope('?panel=inbox&viewAsPlayerId=b'));
    expect(feedWorkspaceScope('?scope=mine')).toBe(feedWorkspaceScope('?panel=settings'));
  });
  it('rejects absent, expired and unsafe links and caps legacy media leases at five minutes', () => {
    expect(socialMediaLease({ url: 'https://storage.example/rep', expiresAt: 600_000 }, 100)).toEqual({ url: 'https://storage.example/rep', expiresAt: 300_100 });
    expect(socialMediaLease({ url: 'https://storage.example/rep', expiresAt: 100 }, 100)).toBeNull();
    expect(socialMediaLease({ url: 'https://storage.example/rep', expiresAt: null }, 100)).toBeNull();
    expect(socialMediaLease({ url: 'javascript:alert(1)', expiresAt: 500 }, 100)).toBeNull();
  });
});

describe('sharing consent', () => {
  it('keeps discovery and club disclosure separate and explains withdrawal', () => {
    const html = renderToStaticMarkup(<CommunitySettings viewer={{}} preview />);
    expect(html).toContain('Let PoseTek players discover my profile');
    expect(html).toContain('Show my club on my community profile');
    expect(html).toContain('Your existing community posts stay shared until you withdraw them.');
    expect(html).toContain('Withdraw my community posts');
  });
  it('requires a separate community publish and does not preselect video consent', () => {
    const activity = { id: 'a1', title: 'Shooting', subtitle: '1 qualified rep', audience: 'community', metrics: [], selectedRepId: 'rep1', availableReps: [{ id: 'rep1', label: 'Rep 1', canViewVideo: true }] } as unknown as SocialActivity;
    const html = renderToStaticMarkup(<MemoryRouter><PublishActivity activity={activity} viewer={{}} preview onSaved={() => {}} onClose={() => {}} /></MemoryRouter>);
    expect(html).toContain('Share to community');
    expect(html).toContain('Sharing this activity does not publish your other sessions or private profile.');
    expect(html).toMatch(/<input type="checkbox"\/>Include the selected saved video/);
  });
});
