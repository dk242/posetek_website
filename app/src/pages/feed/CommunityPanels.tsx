import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { auth } from '../../lib/firebase';
import { callSocialV2 as api } from './api';
import { formatDate, formatMeasurement, initials } from './model';
import type { CommunityProfile, CommunityReport, InboxItem, SocialActivity, SocialAudience, SocialViewer, TimeCursor } from './contracts';
import './community.css';

type ViewerProps = { viewer: SocialViewer; preview: boolean };
const sampleProfiles: CommunityProfile[] = [
  { playerId: 'example', displayName: 'Jamie R.', discoverable: true, showClub: true, clubName: 'PoseTek FC', relationship: 'none', mine: false, suspended: false, communityPostsWithdrawnAt: null },
  { playerId: 'example-2', displayName: 'Sam C.', discoverable: true, showClub: false, clubName: '', relationship: 'accepted', mine: false, suspended: false, communityPostsWithdrawnAt: null },
];
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Could not complete that action. Please try again.';
export const communityAudienceLabels: Record<SocialAudience, string> = {
  private: 'Only me', team: 'Team only', organization: 'Organization + friends', friends: 'Friends only', community: 'PoseTek community',
};

function useCurrentViewer() {
  const uid = auth.currentUser?.uid;
  const mounted = useRef(true);
  const epoch = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  return useCallback(() => {
    const started = epoch.current;
    return () => mounted.current && started === epoch.current && auth.currentUser?.uid === uid;
  }, [uid]);
}
function Notice({ error, notice }: { error?: string; notice?: string }) {
  return <>{error && <p className="social-error" role="alert">{error}</p>}{notice && <p className="social-notice" role="status">{notice}</p>}</>;
}

export function CommunitySheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);
  return <dialog ref={dialog} className="community-sheet" aria-label={title} onCancel={onClose}>
    <header><h2>{title}</h2><button type="button" onClick={onClose} aria-label={`Close ${title}`}>×</button></header>
    {children}
  </dialog>;
}

export function PublishActivity({ activity, viewer, preview, onClose, onSaved }: ViewerProps & { activity: SocialActivity; onClose: () => void; onSaved: () => void }) {
  const [detail, setDetail] = useState(activity), [detailReady, setDetailReady] = useState(preview), [retry, setRetry] = useState(0);
  const [communityProfile, setCommunityProfile] = useState<CommunityProfile | null>(preview ? { ...sampleProfiles[0], mine: true, displayNameConfigured: true } : null);
  const [displayName, setDisplayName] = useState('');
  const [audience, setAudience] = useState<SocialAudience>(activity.audience);
  const [caption, setCaption] = useState(activity.caption || '');
  const [rep, setRep] = useState(activity.selectedRepId || '');
  const [videos, setVideos] = useState(false);
  const [poseOverlay, setPoseOverlay] = useState(false);
  const [comments, setComments] = useState(activity.commentsEnabled !== false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const captureViewer = useCurrentViewer();
  const selected = detail.availableReps?.find(item => item.id === rep);
  useEffect(() => { setBusy(false); }, []);
  useEffect(() => {
    if (preview) return;
    const current = captureViewer();
    setDetailReady(false);
    void Promise.all([api('getSocialActivity', { ...viewer, id: activity.id }), api('getSocialCommunityProfile', viewer)]).then(([value, profile]) => {
      if (current()) { setDetail(value); setCommunityProfile(profile); setDisplayName(profile.displayName); setDetailReady(true); setError(''); }
    }).catch(e => { if (current()) setError(messageOf(e)); });
  }, [preview, activity.id, viewer.organizationId, viewer.viewAsPlayerId, captureViewer, retry]);
  const canVideo = !!selected?.canViewVideo;
  return <CommunitySheet title="Share your progress" onClose={onClose}>
    <form onSubmit={async event => {
      const current = captureViewer();
      event.preventDefault();
      if (preview || viewer.viewAsPlayerId) { setNotice('Sample and athlete previews are read-only. Nothing was published.'); return; }
      if (busy || !detailReady || (audience === 'community' && !communityProfile?.displayNameConfigured)) return;
      setBusy(true); setError('');
      try {
        await api('setSocialVisibility', { ...viewer, id: activity.id, audience, hidden: false, caption: caption.trim(), selectedRepId: rep || null, videos: videos && canVideo, poseOverlay: videos && canVideo && poseOverlay, commentsEnabled: comments });
        if (current()) { onSaved(); onClose(); }
      } catch (e) { if (current()) setError(messageOf(e)); }
      finally { if (current()) setBusy(false); }
    }}>
      <section className="community-post-preview"><p className="social-eyebrow">Post preview</p><h3>{activity.title}</h3><p>{activity.subtitle}</p>
        <p>{activity.metrics.map(metric => `${metric.label} ${formatMeasurement(metric.value, metric.unit)}`).join(' · ')}</p>
        {caption && <p className="community-caption">{caption}</p>}
      </section>
      <label>Caption <span className="community-muted">Optional</span><textarea maxLength={500} value={caption} onChange={event => setCaption(event.target.value)} placeholder="What did you work on?" /></label>
      <label>Who can see this?<select value={audience} onChange={event => setAudience(event.target.value as SocialAudience)}>{Object.entries(communityAudienceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {audience === 'community' && detailReady && (communityProfile?.displayNameConfigured ? <p className="community-muted">Posting as <strong>{communityProfile.displayName}</strong></p> : <section className="community-post-preview">
        <h3>Choose your community name</h3><label>Display name<input maxLength={60} value={displayName} onChange={event => setDisplayName(event.target.value)} /></label>
        <p className="community-muted">Save a name before your first post. Your profile stays out of discovery and your club stays hidden until you choose otherwise in settings.</p>
        <button type="button" disabled={busy || !displayName.trim() || !!viewer.viewAsPlayerId} onClick={async () => {
          if (preview) return;
          const current = captureViewer(); setBusy(true); setError('');
          try { const profile = await api('saveSocialCommunityProfile', { ...viewer, displayName: displayName.trim(), discoverable: false, showClub: false }); if (current()) setCommunityProfile(profile); }
          catch (e) { if (current()) setError(messageOf(e)); } finally { if (current()) setBusy(false); }
        }}>Save community name</button>
      </section>)}
      <p className="community-muted">{audience === 'community' ? 'Signed-in PoseTek members can see this post. Sharing this activity does not publish your other sessions or private profile.' : 'Only the selected audience can open this post. A copied link does not change access.'}</p>
      {!detailReady && !error && <p role="status">Loading your available reps…</p>}
      {!detailReady && error && <button type="button" onClick={() => { setError(''); setRetry(value => value + 1); }}>Reload activity</button>}
      {!!detail.availableReps?.length && <label>Featured rep<select value={rep} disabled={!detailReady} onChange={event => { setRep(event.target.value); setVideos(false); setPoseOverlay(false); }}><option value="">Summary only</option>{detail.availableReps.map(item => <option key={item.id} value={item.id}>{item.label}{item.canViewVideo ? '' : ' · video unavailable'}</option>)}</select></label>}
      <label className="community-check"><input type="checkbox" checked={videos && canVideo} disabled={!canVideo} onChange={event => { setVideos(event.target.checked); if (!event.target.checked) setPoseOverlay(false); }} />Include the selected saved video</label>
      <label className="community-check"><input type="checkbox" checked={videos && canVideo && poseOverlay} disabled={!videos || !canVideo} onChange={event => setPoseOverlay(event.target.checked)} />Include saved pose outline and movement trails</label>
      <p className="community-muted">Pose effects are shown only when this recording has matching saved tracking data.</p>
      <label className="community-check"><input type="checkbox" checked={comments} onChange={event => setComments(event.target.checked)} />Allow comments from people who can see this post</label>
      <Notice error={error} notice={notice} />
      <button className="social-primary" disabled={busy || !detailReady || !!viewer.viewAsPlayerId || (audience === 'community' && !communityProfile?.displayNameConfigured)}>{busy ? 'Saving…' : audience === 'community' ? 'Share to community' : 'Save sharing'}</button>
    </form>
  </CommunitySheet>;
}

export function Discovery({ viewer, preview, onPerson }: ViewerProps & { onPerson: (playerId: string) => void }) {
  const [query, setQuery] = useState(''), [search, setSearch] = useState('');
  const [people, setPeople] = useState<CommunityProfile[]>(preview ? sampleProfiles : []);
  const [cursor, setCursor] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const captureViewer = useCurrentViewer(), sequence = useRef(0);
  const load = useCallback(async (after: string | null = null) => {
    const current = captureViewer();
    const request = ++sequence.current;
    if (preview) { setPeople(sampleProfiles.filter(person => person.displayName.toLowerCase().includes(search.toLowerCase()))); return; }
    setBusy(true); setError('');
    try {
      const result = await api('getSocialDiscovery', { ...viewer, query: search, cursor: after });
      if (current() && request === sequence.current) { setPeople(old => after ? [...old, ...result.people.filter(p => !old.some(o => o.playerId === p.playerId))] : result.people); setCursor(result.cursor); }
    } catch (e) { if (current() && request === sequence.current) setError(messageOf(e)); }
    finally { if (current() && request === sequence.current) setBusy(false); }
  }, [preview, search, viewer.organizationId, viewer.viewAsPlayerId, captureViewer]);
  useEffect(() => { void load(); return () => { ++sequence.current; }; }, [load]);
  return <section className="social-panel community-discovery">
    <p className="social-eyebrow">Discover</p><h1>Your next connection.</h1><p>Find players who choose to be part of the PoseTek community.</p>
    <form className="community-search" onSubmit={event => { event.preventDefault(); setSearch(query.trim()); }}><label>Search community<input type="search" value={query} maxLength={60} onChange={event => setQuery(event.target.value)} autoComplete="off" /></label><button className="social-primary">Search</button></form>
    <Notice error={error} />
    <div className="community-people" aria-busy={busy}>{people.map(person => <button className="community-person" key={person.playerId} onClick={() => onPerson(person.playerId)}><span className="social-avatar" aria-hidden="true">{initials(person.displayName)}</span><span><strong>{person.displayName}</strong><small>{person.clubName || 'PoseTek player'}</small></span><span aria-hidden="true">↗</span></button>)}</div>
    {busy && <p role="status">Finding players…</p>}{!busy && !people.length && <p>No discoverable players match yet. Try another name.</p>}
    {cursor && <button disabled={busy} onClick={() => void load(cursor)}>More players</button>}
  </section>;
}

export function ReportContent({ viewer, preview, target }: ViewerProps & { target: { targetType: 'profile' | 'comment' | 'activity'; playerId?: string; activityId?: string; commentId?: string } }) {
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const captureViewer = useCurrentViewer();
  useEffect(() => { setBusy(false); }, []);
  return <details className="community-report"><summary>Report {target.targetType}</summary><form onSubmit={async event => {
    const current = captureViewer();
    event.preventDefault(); if (preview || viewer.viewAsPlayerId) { setNotice('Preview only. No report was sent.'); return; }
    if (busy) return; setBusy(true); setError('');
    try { await api('reportSocialContent', { ...viewer, ...target, reason: reason.trim() }); if (current()) { setNotice('Your report was sent to PoseTek.'); setReason(''); } }
    catch (e) { if (current()) setError(messageOf(e)); } finally { if (current()) setBusy(false); }
  }}><label>What should we review?<textarea required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label><button disabled={busy || !reason.trim() || !!viewer.viewAsPlayerId}>Send report</button><Notice error={error} notice={notice} /></form></details>;
}

export function SocialProfile({ playerId, viewer, preview, onActivity, onBack, onMutated }: ViewerProps & { playerId: string; onActivity: (id: string) => void; onBack: () => void; onMutated?: () => void }) {
  const [profile, setProfile] = useState<CommunityProfile | null>(preview ? sampleProfiles.find(p => p.playerId === playerId) || sampleProfiles[0] : null);
  const [items, setItems] = useState<SocialActivity[]>([]), [cursor, setCursor] = useState<TimeCursor | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const captureViewer = useCurrentViewer();
  const load = useCallback(async (after: TimeCursor | null = null) => {
    const current = captureViewer();
    if (preview) return;
    setBusy(true); setError('');
    try {
      const [person, feed] = await Promise.all([api('getSocialCommunityProfile', { ...viewer, playerId }), api('getSocialFeed', { ...viewer, playerId, scope: 'community', cursor: after })]);
      if (current()) { setProfile(person); setItems(old => after ? [...old, ...feed.items.filter(i => !old.some(o => o.id === i.id))] : feed.items); setCursor(feed.cursor); }
    } catch (e) { if (current()) { setError(messageOf(e)); setProfile(null); setItems([]); } }
    finally { if (current()) setBusy(false); }
  }, [preview, playerId, viewer.organizationId, viewer.viewAsPlayerId, captureViewer]);
  useEffect(() => { void load(); }, [load]);
  const connect = async (action: 'request' | 'accept' | 'remove' | 'block' | 'unblock') => {
    const current = captureViewer();
    if (preview || viewer.viewAsPlayerId) { setNotice('Preview only. Sign in to manage real connections.'); return; }
    if (busy) return; setBusy(true); setError('');
    try { await api('socialConnection', { ...viewer, playerId, action }); if (current()) { onMutated?.(); if (action === 'block') onBack(); else await load(); } }
    catch (e) { if (current()) setError(messageOf(e)); } finally { if (current()) setBusy(false); }
  };
  return <section className="social-panel"><button onClick={onBack}>← Community</button><Notice error={error} notice={notice} />
    {!profile && busy && <p role="status">Loading player…</p>}
    {profile && <><div className="community-profile-heading"><span className="social-avatar" aria-hidden="true">{initials(profile.displayName)}</span><div><p className="social-eyebrow">Community profile</p><h1>{profile.displayName}</h1>{profile.clubName && <p>{profile.clubName}</p>}</div></div>
      {!profile.mine && <div className="community-actions"><button className="social-primary" disabled={busy || profile.relationship === 'sent' || !!viewer.viewAsPlayerId} onClick={() => void connect(profile.relationship === 'received' ? 'accept' : profile.relationship === 'accepted' ? 'remove' : 'request')}>{profile.relationship === 'sent' ? 'Request sent' : profile.relationship === 'received' ? 'Accept connection' : profile.relationship === 'accepted' ? 'Remove connection' : 'Connect'}</button><button disabled={busy || !!viewer.viewAsPlayerId} onClick={() => void connect('block')}>Block</button></div>}
      <p className="community-muted">Only activity shared with the community appears here.</p>
      <div className="community-profile-activity">{items.map(item => <button key={item.id} onClick={() => onActivity(item.id)}><strong>{item.title}</strong><small>{formatDate(item.occurredAt)}</small><span>{item.subtitle}</span></button>)}</div>
      {!items.length && !busy && <p>No community activity to show yet.</p>}
      {cursor && <button disabled={busy} onClick={() => void load(cursor)}>More activity</button>}
      {!profile.mine && <ReportContent viewer={viewer} preview={preview} target={{ targetType: 'profile', playerId }} />}
    </>}
  </section>;
}

export function CommunitySettings({ viewer, preview, onMutated }: ViewerProps & { onMutated?: () => void }) {
  const [profile, setProfile] = useState<CommunityProfile | null>(preview ? { ...sampleProfiles[0], playerId: 'sample', displayName: 'Jordan R.', mine: true, discoverable: false } : null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [withdrawing, setWithdrawing] = useState(false);
  const captureViewer = useCurrentViewer();
  useEffect(() => {
    const current = captureViewer();
    setBusy(false);
    if (!preview) void api('getSocialCommunityProfile', viewer).then(value => { if (current()) setProfile(value); }).catch(e => { if (current()) setError(messageOf(e)); });
  }, [preview, viewer.organizationId, viewer.viewAsPlayerId, captureViewer]);
  const save = async (withdraw = false) => {
    const current = captureViewer();
    if (preview || viewer.viewAsPlayerId) { setNotice('Preview only. No sharing settings were changed.'); return; }
    if (!profile || busy) return; setBusy(true); setError('');
    try {
      if (withdraw) await api('withdrawSocialCommunityPosts', viewer);
      else await api('saveSocialCommunityProfile', { ...viewer, displayName: profile.displayName.trim(), discoverable: profile.discoverable, showClub: !!profile.showClub });
      if (current()) { onMutated?.(); setNotice(withdraw ? 'Your community posts have been withdrawn.' : 'Community profile saved.'); setWithdrawing(false); }
    } catch (e) { if (current()) setError(messageOf(e)); } finally { if (current()) setBusy(false); }
  };
  return <section className="social-panel community-settings"><h2>Your community profile</h2><p>You choose whether players can discover you. Every community post is shared separately.</p><Notice error={error} notice={notice} />
    {!profile && !error && <p role="status">Loading your settings…</p>}
    {profile && <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <label>Display name<input required minLength={1} maxLength={60} autoComplete="nickname" value={profile.displayName} onChange={event => setProfile({ ...profile, displayName: event.target.value })} /></label>
      <label className="community-check"><input type="checkbox" checked={profile.discoverable} onChange={event => setProfile({ ...profile, discoverable: event.target.checked })} />Let PoseTek players discover my profile</label>
      <label className="community-check"><input type="checkbox" checked={!!profile.showClub} onChange={event => setProfile({ ...profile, showClub: event.target.checked })} />Show my club on my community profile</label>
      {profile.suspended && <p className="social-notice">Your community profile is currently restricted. Your personal training remains available.</p>}
      <button className="social-primary" disabled={busy || !!viewer.viewAsPlayerId}>Save community profile</button>
      <p className="community-muted">Turning discovery off removes you from search. Your existing community posts stay shared until you withdraw them.</p>
      {!withdrawing ? <button type="button" onClick={() => setWithdrawing(true)}>Withdraw my community posts</button> : <div className="social-notice"><p>Remove your existing posts from the community? Your original results and workouts will stay saved.</p><button type="button" disabled={busy || !!viewer.viewAsPlayerId} onClick={() => void save(true)}>Withdraw posts</button><button type="button" onClick={() => setWithdrawing(false)}>Cancel</button></div>}
    </form>}
  </section>;
}

const inboxLabels = { request: 'would like to connect', accepted: 'accepted your connection', kudos: 'gave your activity kudos', comment: 'commented on your activity' };
export function CommunityInbox({ viewer, preview, onPerson, onActivity }: ViewerProps & { onPerson: (id: string) => void; onActivity: (id: string) => void }) {
  const [items, setItems] = useState<InboxItem[]>(() => preview ? [{ id: 'sample-notification', type: 'request', actor: { playerId: 'example', displayName: 'Jamie R.' }, createdAt: Date.now(), read: false }] : []);
  const [cursor, setCursor] = useState<TimeCursor | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const captureViewer = useCurrentViewer();
  const load = useCallback(async (after: TimeCursor | null = null) => {
    const current = captureViewer();
    if (preview) return; setBusy(true); setError('');
    try { const result = await api('getSocialInbox', { ...viewer, cursor: after }); if (current()) { setItems(old => after ? [...old, ...result.items.filter(i => !old.some(o => o.id === i.id))] : result.items); setCursor(result.cursor); } }
    catch (e) { if (current()) setError(messageOf(e)); } finally { if (current()) setBusy(false); }
  }, [preview, viewer.organizationId, viewer.viewAsPlayerId, captureViewer]);
  useEffect(() => { void load(); }, [load]);
  const open = async (item: InboxItem) => {
    const current = captureViewer();
    try { if (!preview && !viewer.viewAsPlayerId) await api('markSocialInboxRead', { ...viewer, ids: [item.id] }); }
    catch (e) { if (current()) setError(messageOf(e)); return; }
    if (current()) { setItems(old => old.map(i => i.id === item.id ? { ...i, read: true } : i)); if (item.activityId) onActivity(item.activityId); else if (item.actor.playerId) onPerson(item.actor.playerId); }
  };
  return <section className="social-panel"><p className="social-eyebrow">Activity</p><h1>Your community inbox.</h1><p>Connections and encouragement, in one place.</p><button disabled={busy} onClick={() => void load()}>Refresh inbox</button><Notice error={error} />
    <div className="community-inbox" aria-busy={busy}>{items.map(item => <button key={item.id} className={item.read ? 'is-read' : 'is-unread'} onClick={() => void open(item)}><span className="social-avatar" aria-hidden="true">{initials(item.actor.displayName)}</span><span><strong>{item.actor.displayName}</strong> {inboxLabels[item.type]}<small>{formatDate(item.createdAt)}</small></span>{!item.read && <span className="community-unread" aria-label="Unread" />}</button>)}</div>
    {busy && <p role="status">Loading activity…</p>}{!busy && !items.length && <p>You’re all caught up. New connections and interactions will appear here.</p>}{cursor && <button disabled={busy} onClick={() => void load(cursor)}>Earlier activity</button>}
  </section>;
}

export function CommunityModeration({ viewer }: { viewer: SocialViewer }) {
  const [reports, setReports] = useState<CommunityReport[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const captureViewer = useCurrentViewer();
  useEffect(() => { setBusy(false); }, []);
  const load = useCallback(async () => { const current = captureViewer(); const result = await api('moderateSocialContent', viewer); if (current() && 'reports' in result) setReports(result.reports); }, [viewer.organizationId, viewer.viewAsPlayerId, captureViewer]);
  useEffect(() => { const current = captureViewer(); void load().catch(e => { if (current()) setError(messageOf(e)); }); }, [load, captureViewer]);
  const moderate = async (report: CommunityReport, action: 'hideActivity' | 'removeComment' | 'suspendProfile' | 'restoreProfile' | 'dismiss') => {
    const current = captureViewer();
    if (busy) return; setBusy(true); setError('');
    try { await api('moderateSocialContent', { ...viewer, reportId: report.id, action }); if (current()) await load(); }
    catch (e) { if (current()) setError(messageOf(e)); } finally { if (current()) setBusy(false); }
  };
  return <section className="social-panel"><h2>Community reports</h2><Notice error={error} />
    {reports.filter(r => !r.resolved || r.targetSuspended).map(report => <article className="community-report-row" key={report.id}>
      <strong>{report.targetType}{report.targetSuspended ? ' · restricted' : ''}</strong><p>{report.reason}</p><small>{formatDate(report.createdAt)}</small>
      <div className="community-actions">
        {report.targetSuspended ? <button disabled={busy} onClick={() => void moderate(report, 'restoreProfile')}>Restore profile</button> : <button disabled={busy} onClick={() => void moderate(report, report.targetType === 'comment' ? 'removeComment' : report.targetType === 'profile' ? 'suspendProfile' : 'hideActivity')}>{report.targetType === 'comment' ? 'Remove comment' : report.targetType === 'profile' ? 'Restrict profile' : 'Hide activity'}</button>}
        {!report.resolved && <button disabled={busy} onClick={() => void moderate(report, 'dismiss')}>Dismiss report</button>}
      </div>
    </article>)}
    {!reports.some(r => !r.resolved || r.targetSuspended) && <p>No open community reports.</p>}
  </section>;
}
