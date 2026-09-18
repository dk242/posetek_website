/** Recovered from deployment 6aa9b6f0d8faf6177db8fd97. See PROVENANCE.md. */
import * as React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { auth } from "../../lib/firebase";
import { callSocialV2 as callSocial } from "./api";
import { CommunityInbox, CommunityModeration, CommunitySettings, CommunitySheet, Discovery, PublishActivity, ReportContent, SocialProfile } from './CommunityPanels';
import { formatMeasurement, mergeActivities, initials, formatDate } from "./model";
import { socialMediaLease } from './media-lease';
import { athleteTabUrl, PlayerNavigation } from '../athlete-portal/player/player-navigation';
import "./feed.css";
import "../../styles/pose-portal.css";
import "./feed-cascade.css";
import '../../styles/player-finish.css';

var sampleContext = {
  uid: `sample`,
  playerId: `sample`,
  name: `Alex Morgan`,
  organizationId: `sample`,
  organizationName: `Vacaville United Soccer Club`,
  teamId: `sample-team`,
  teamName: `Boys · Coach Niall`,
  staff: false,
  admin: false,
  enabled: true,
  communityEnabled: true,
  preferences: {
    audience: `organization`,
    automatic: true,
    videos: true
  }
};
var sampleActivityDefaults = {
  playerId: `example`,
  authorUid: null,
  teamName: `Boys · Coach Niall`,
  mine: false,
  audience: `organization`,
  hidden: false,
  liked: false,
  comments: 0,
  partial: false,
  canViewVideo: false,
  score: null
};
var sampleActivities = [
  {
    ...sampleActivityDefaults,
    id: `sample-1`,
    authorName: `Jamie Rivera`,
    title: `Shooting session`,
    subtitle: `12 measured reps`,
    kind: `session`,
    occurredAt: Date.now() - 3600000,
    metrics: [
      {
        label: `Reps`,
        value: 12,
        unit: ``
      },
      {
        label: `Best`,
        value: 58.4,
        unit: `mph`
      },
      {
        label: `Average`,
        value: 53.2,
        unit: `mph`
      }
    ],
    chart: [
      43,
      48,
      46,
      51,
      50,
      55,
      53,
      51,
      56,
      54,
      58.4,
      57
    ],
    drill: `shooting`,
    repCount: 12,
    kudos: 8
  },
  {
    ...sampleActivityDefaults,
    id: `sample-2`,
    authorName: `Sam Chen`,
    title: `Build strength. Move faster.`,
    subtitle: `Split squat · Calf raises · Lateral bounds`,
    kind: `workout`,
    occurredAt: Date.now() - 7200000,
    metrics: [
      {
        label: `Drills`,
        value: 3,
        unit: ``
      },
      {
        label: `Sets`,
        value: 9,
        unit: ``
      },
      {
        label: `Active time`,
        value: 24,
        unit: `min`
      }
    ],
    chart: [],
    drill: null,
    repCount: 0,
    kudos: 5
  },
  {
    ...sampleActivityDefaults,
    id: `sample-3`,
    authorName: `Taylor Brooks`,
    teamName: `Girls · Coach Niall`,
    title: `Vertical jump session`,
    subtitle: `6 measured reps`,
    kind: `session`,
    occurredAt: Date.now() - 86400000,
    metrics: [
      {
        label: `Reps`,
        value: 6,
        unit: ``
      },
      {
        label: `Best`,
        value: 22.8,
        unit: `in`
      },
      {
        label: `Average`,
        value: 21.4,
        unit: `in`
      }
    ],
    chart: [
      20,
      21,
      20.8,
      22,
      22.8,
      21.9
    ],
    drill: `jump`,
    repCount: 6,
    kudos: 11
  }
];
var feedScopes = [
  [`all`, `Your circle`],
  [`team`, `My team`],
  [`community`, `Discover`],
  [`organization`, `My organization`],
  [`friends`, `Friends`],
  [`mine`, `My activity`]
];
var audienceLabels = {
  organization: `Organization + friends`,
  team: `Team only`,
  friends: `Friends only`,
  private: `Only me`,
  community: `PoseTek community`
};
function Icon({ name }) {
  return <span className={`material-symbols-outlined`} aria-hidden={`true`}>
    {name}
  </span>;
}
function FeedPage() {
  const workspace = React.useContext(PlayerNavigation);
  let location = useLocation();
  let navigate = useNavigate();
  let query = new URLSearchParams(location.search);
  let preview = query.get(`preview`) === `1`;
  let viewAsPlayerId = query.get(`viewAsPlayerId`) || void 0;
  let athletePreview = !!viewAsPlayerId;
  let organizationId = query.get(`organizationId`) || void 0;
  let linkedPlayer = query.get(`connect`) || void 0;
  let activityId = query.get(`activity`) || void 0;
  let memberId = query.get('member') || void 0;
  let requestedPanel = memberId ? 'profile' : query.get('panel') || (linkedPlayer ? 'people' : 'feed');
  let [context, setContext] = React.useState(preview ? sampleContext : null);
  let [status, setStatus] = React.useState(preview ? `ready` : `loading`);
  let [error, setError] = React.useState(``);
  let [scope, setScope] = React.useState(feedScopes.some(([key]) => key === query.get('scope')) ? query.get('scope') : 'all');
  let [panel, setPanelState] = React.useState(requestedPanel);
  let [activities, setActivities] = React.useState(preview ? sampleActivities : []);
  let [cursor, setCursor] = React.useState(null);
  let [loading, setLoading] = React.useState(false);
  let authRequest = React.useRef(0);
  let feedRequest = React.useRef(0);
  let contextRef = React.useRef(context);
  contextRef.current = context;
  let feedCache = React.useRef(new Map());
  const navigateFeed = (values) => {
    const next = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(values)) { if (value) next.set(key, value); else next.delete(key); }
    navigate(`/feed?${next}`);
  };
  const setPanel = value => {
    setPanelState(value);
    navigateFeed({ panel: value === 'feed' ? null : value, member: null, activity: null, connect: value === 'people' ? linkedPlayer : null });
  };
  const openPerson = playerId => navigateFeed({ member: playerId, activity: null, panel: null, connect: null });
  const openActivity = id => navigateFeed({ activity: id, member: null, panel: null, connect: null });
  const viewer = React.useMemo(() => ({ organizationId, viewAsPlayerId }), [organizationId, viewAsPlayerId]);
  React.useEffect(() => { setPanelState(requestedPanel); }, [requestedPanel]);
  React.useEffect(() => {
    const nextScope = new URLSearchParams(location.search).get('scope');
    setScope(feedScopes.some(([key]) => key === nextScope) ? nextScope : 'all');
  }, [location.search]);
  React.useEffect(() => {
    document.title = `Community | PoseTek`;
  }, []);
  /* oxlint-disable react/set-state-in-effect -- Preserve deployed state resets before loading a different viewer, audience, or directory. */
  /* oxlint-disable react-hooks/exhaustive-deps -- These refs are request counters, not DOM nodes; cleanup must invalidate their latest values. */
  React.useEffect(() => {
    if (preview)
      return;
    let t = true;
    let r = auth.onAuthStateChanged(r => {
      let i = ++authRequest.current;
      ++feedRequest.current;
      const sameViewer = contextRef.current?.uid === r?.uid;
      if (!sameViewer) {
        feedCache.current.clear(); setActivities([]); setContext(null); setError(''); setStatus('loading');
      }
      if (!r) {
        navigate(`/signin?returnTo=` + encodeURIComponent(location.pathname + location.search), {
          replace: true
        });
        return;
      }
      callSocial(`getSocialContext`, {
        organizationId: organizationId,
        viewAsPlayerId: viewAsPlayerId
      }).then(e => {
        if (t && authRequest.current === i) {
          setContext(old => {
            if (JSON.stringify(old) === JSON.stringify(e)) return old;
            feedCache.current.clear();
            return e;
          });
          setStatus(`ready`);
        }
      }).catch(e => {
        if (t && authRequest.current === i) {
          setActivities([]); setContext(null); feedCache.current.clear();
          setError(e.message);
          setStatus(`error`);
        }
      });
    });
    return () => {
      t = false;
      ++authRequest.current;
      ++feedRequest.current;
      r();
    };
  }, [
    preview,
    organizationId,
    viewAsPlayerId,
    navigate
  ]); /* oxlint-enable react/set-state-in-effect */
  /* oxlint-enable react-hooks/exhaustive-deps */
  let loadFeed = React.useCallback(async (e = null) => {
    if (preview) {
      setActivities(scope === 'mine' ? [{ ...sampleActivities[1], mine: true, playerId: 'sample', authorName: sampleContext.name }] : sampleActivities);
      return;
    }
    let t = ++feedRequest.current;
    setLoading(true);
    setError(``);
    try {
      let n = activityId ? {
        items: [await callSocial(`getSocialActivity`, {
          id: activityId,
          organizationId: organizationId,
          viewAsPlayerId: viewAsPlayerId
        })],
        cursor: null
      } : await callSocial(`getSocialFeed`, {
        scope: scope,
        cursor: e,
        organizationId: organizationId,
        viewAsPlayerId: viewAsPlayerId
      });
      if (t === feedRequest.current) {
        setActivities(t => {
          const items = e ? mergeActivities(t, n.items) : n.items;
          feedCache.current.set(`${scope}:${activityId || ''}`, { items, cursor: n.cursor });
          return items;
        });
        setCursor(n.cursor);
      }
    }
    catch (e) {
      if (t === feedRequest.current) {
        setActivities([]); feedCache.current.delete(`${scope}:${activityId || ''}`);
        setError(e.message);
      }
    }
    finally {
      if (t === feedRequest.current) {
        setLoading(false);
      }
    }
  }, [
    scope,
    preview,
    organizationId,
    activityId,
    viewAsPlayerId
  ]);
  /* oxlint-disable react/set-state-in-effect -- Preserve deployed state resets before loading a different viewer, audience, or directory. */
  /* oxlint-disable react-hooks/exhaustive-deps -- These refs are request counters, not DOM nodes; cleanup must invalidate their latest values. */
  React.useEffect(() => {
    if (context) {
      const cached = feedCache.current.get(`${scope}:${activityId || ''}`);
      if (cached) { setActivities(cached.items); setCursor(cached.cursor); }
      else { setActivities([]); setCursor(null); }
      loadFeed();
    }
    return () => {
      ++feedRequest.current;
    };
  }, [context, loadFeed]); /* oxlint-enable react/set-state-in-effect */
  /* oxlint-enable react-hooks/exhaustive-deps */
  let feedUrl = `/feed` + (location.search || ``);
  let athleteUrl = e => athletePreview ? feedUrl : athleteTabUrl(e, preview, context?.playerId || null, workspace.athleteSearch);
  const invalidateFeed = () => { ++feedRequest.current; feedCache.current.clear(); setActivities([]); setCursor(null); void loadFeed(); };
  let community = preview || context?.communityEnabled === true;
  let staffOnly = !!context && (context.staff || context.admin) && !context.playerId;
  let tabs = staffOnly ? [
    [
      feedUrl,
      `home`,
      `Home`
    ],
    [
      `/organization`,
      `groups`,
      `Club`
    ],
    [
      context?.admin ? `/admin` : `/roster`,
      `dashboard`,
      context?.admin ? `Admin` : `Roster`
    ]
  ] : [
    [
      feedUrl,
      `home`,
      `Feed`
    ],
    [
      athleteUrl(`training`),
      `fitness_center`,
      `Training`
    ],
    [
      athleteUrl(`drills`),
      `sports_soccer`,
      `Drills`
    ],
    [
      athleteUrl(`aiCoach`),
      `forum`,
      `Coach`
    ],
    [
      athleteUrl(`home`),
      `person`,
      `You`
    ]
  ];
  return <div className={`pt-pose social-app`}>
    <header className={`social-header`}>
      <Link className={`social-brand`} to={feedUrl}>
        {`POSETEK`}
        <span>
          {`●`}
        </span>
      </Link>
      <span className={`social-header-label`}>
        {`THE WORK. TOGETHER.`}
      </span>
      <div className={`social-header-actions`}>
        {community && context?.playerId && <button aria-label="Activity inbox" onClick={() => setPanel('inbox')}><Icon name="notifications" /></button>}
        <button aria-label={`Find people`} onClick={() => setPanel(`people`)}>
          <Icon name={`person_add`} />
        </button>
        <button aria-label={`Sharing settings`} onClick={() => setPanel(`settings`)}>
          <Icon name={`tune`} />
        </button>
        <Link className={`social-avatar small`} aria-label={`Your profile`} to={athleteUrl(`home`)}>
          {initials(context?.name || `You`)}
        </Link>
      </div>
    </header>
    <div className={`social-layout`}>
      <aside className={`social-sidebar`}>
        <div className={`social-club-mark`}>
          <Icon name={`sports_soccer`} />
        </div>
        <p className={`social-eyebrow`}>
          {`Your community`}
        </p>
        <h2>
          {context?.organizationName || `PoseTek athletes`}
        </h2>
        <p>
          {context?.teamName || `A little stronger, together.`}
        </p>
        <nav aria-label={`Community`}>
          <button aria-current={panel === `feed` ? `page` : void 0} onClick={() => setPanel(`feed`)}>
            <Icon name={`home`} />
            {`Activity feed`}
          </button>
          <button aria-current={panel === `people` ? `page` : void 0} onClick={() => setPanel(`people`)}>
            <Icon name={`group`} />
            {`People & friends`}
          </button>
          <button aria-current={panel === `settings` ? `page` : void 0} onClick={() => setPanel(`settings`)}>
            <Icon name={`tune`} />
            {`Sharing settings`}
          </button>
          {community && <button aria-current={panel === 'discover' ? 'page' : undefined} onClick={() => setPanel('discover')}><Icon name="explore" />Discover players</button>}
          {community && context?.playerId && <button aria-current={panel === 'inbox' ? 'page' : undefined} onClick={() => setPanel('inbox')}><Icon name="notifications" />Activity inbox</button>}
          {context?.admin && <button onClick={() => setPanel(`moderation`)}>
            <Icon name={`flag`} />
            {`Reports`}
          </button>}
        </nav>
        <Link className={`social-coach-link`} to={staffOnly ? `/organization` : athleteUrl(`aiCoach`)}>
          <Icon name={`auto_awesome`} />
          <span>
            {`Make your next rep count.`}
            <strong>
              {staffOnly ? `Open your organization ↗` : `Ask your AI Coach ↗`}
            </strong>
          </span>
        </Link>
        {context?.staff && <Link to={`/organization`}>
          {`Back to organization →`}
        </Link>}
        {!preview && <button className={`social-signout`} onClick={() => void auth.signOut()}>
          {`Sign out`}
        </button>}
      </aside>
      <main className={`social-main`}>
        {context?.adminViewer && <AdminDirectory organizationId={context.organizationId || ``} selectedPlayer={viewAsPlayerId || ``} onSwitch={() => {
          ++feedRequest.current;
          setActivities([]);
          setCursor(null);
          setScope(`all`);
          setPanel(`feed`);
        }} />}
        {athletePreview && <p className={`social-notice`} role={`status`}>
          {`Read-only athlete preview · `}
          {context?.name || `Loading athlete`}
          {` · Account actions are disabled. `}
          <Link to={`/admin`}>
            {`Back to admin`}
          </Link>
        </p>}
        {preview && <p className={`social-notice`}>
          {`Design preview · sample activity · no account changes`}
        </p>}
        {status === `loading` && <div className={`social-empty`} role={`status`}>
          {`Loading your community…`}
        </div>}
        {error && <div className={`social-error`} role={`alert`}>
          {error}
          <button onClick={() => status === `error` ? window.location.reload() : void loadFeed()}>
            {`Try again`}
          </button>
        </div>}
        {context && <>
          {panel === `feed` && <>
            <div className={`social-heading`}>
              <div>
                <p className={`social-eyebrow`}>
                  {`Show up. Put in the work.`}
                </p>
                <h1>
                  {`Better together`}
                  <span>
                    {`.`}
                  </span>
                </h1>
                <p>
                  {`The latest from your training community.`}
                </p>
              </div>
              <button aria-label={`Refresh activity`} disabled={loading} onClick={() => void loadFeed()}>
                <Icon name={`refresh`} />
              </button>
            </div>
            <div className={`social-mobile-links`}>
              <button onClick={() => setPanel(`people`)}>
                <Icon name={`group`} />
                {`Find friends`}
              </button>
              <Link to={staffOnly ? `/organization` : athleteUrl(`aiCoach`)}>
                <Icon name={`auto_awesome`} />
                {staffOnly ? `Organization` : `AI Coach`}
              </Link>
            </div>
            <nav className={`social-filters`} aria-label={`Activity audience`}>
              {feedScopes.filter(([e]) => community || e !== 'community').map(([e, t]) => <button aria-pressed={e === scope} onClick={() => {
                setScope(e);
                navigateFeed({ scope: e, activity: null, member: null, panel: null });
              }} key={e}>
                {t}
              </button>)}
            </nav>
            {community && scope === 'community' && <div className="social-mobile-links"><button onClick={() => setPanel('discover')}><Icon name="person_search" />Find community players</button><button onClick={() => setPanel('settings')}>Your community profile</button></div>}
            <div className={`social-feed`} aria-busy={loading}>
              {activities.map(e => <ActivityCard activity={e} organizationId={organizationId} preview={preview} communityEnabled={community} onBlocked={id => { feedCache.current.clear(); setActivities(old => old.filter(item => item.playerId !== id)); }} onChange={e => { feedCache.current.clear(); setActivities(t => t.map(t => t.id === e.id ? e : t)); }} onPerson={e => {
                if (community) { openPerson(e); return; }
                navigate(`/feed?` + new URLSearchParams({
                  connect: e,
                  ...organizationId ? {
                    organizationId: organizationId
                  } : {},
                  ...viewAsPlayerId ? {
                    viewAsPlayerId: viewAsPlayerId
                  } : {},
                  ...preview ? {
                    preview: `1`
                  } : {}
                }));
                setPanelState(`people`);
              }} key={`${context.uid}:${e.id}`} />)}
            </div>
            {loading && <div className={`social-skeleton`} role={`status`}>
              {`Loading activity…`}
            </div>}
            {!loading && !activities.length && !error && <div className={`social-empty`}>
              <Icon name={`sports_soccer`} />
              <h2>
                {`Your next chapter starts here.`}
              </h2>
              <p>
                {scope === `team` && !context.teamId && !context.staff ? `You are not assigned to a team yet. Your organization feed is still available.` : scope === `friends` ? `Connect with a friend to see their training here.` : `Finished workouts and measured sessions will appear here as your community trains.`}
              </p>
              <button onClick={() => setPanel(`people`)}>
                {`Meet your community`}
              </button>
            </div>}
            {cursor && <button className={`social-load`} disabled={loading} onClick={() => void loadFeed(cursor)}>
              {`Load more activity`}
            </button>}
            {!!activities.length && !cursor && !loading && <p className={`social-end`}>
              {`You’re all caught up. Time to put in the work.`}
            </p>}
          </>}
          {panel === `people` && <People context={context} linkedPlayer={linkedPlayer} preview={preview} organizationId={organizationId} onMutated={invalidateFeed} key={context.uid + (organizationId || ``) + (linkedPlayer || ``)} />}
          {panel === `settings` && <><SharingSettings context={context} preview={preview} organizationId={organizationId} onSave={e => setContext({
            ...context,
            preferences: e
          })} key={`${context.uid}:${organizationId || ``}`} />{community && context.playerId && <CommunitySettings viewer={viewer} preview={preview} onMutated={invalidateFeed} key={`settings:${context.uid}:${viewAsPlayerId || ''}`} />}</>}
          {panel === 'discover' && community && <Discovery viewer={viewer} preview={preview} onPerson={openPerson} key={`discovery:${context.uid}:${viewAsPlayerId || ''}`} />}
          {panel === 'profile' && memberId && community && <SocialProfile viewer={viewer} preview={preview} playerId={memberId} onActivity={openActivity} onMutated={invalidateFeed} onBack={() => setPanel('feed')} key={`profile:${context.uid}:${memberId}:${viewAsPlayerId || ''}`} />}
          {panel === 'inbox' && community && context.playerId && <CommunityInbox viewer={viewer} preview={preview} onPerson={openPerson} onActivity={openActivity} key={`inbox:${context.uid}:${viewAsPlayerId || ''}`} />}
          {['discover', 'profile', 'inbox'].includes(panel) && !community && <div className="social-empty"><h2>Community features are getting ready.</h2><p>Your existing team activity and training are available.</p><button onClick={() => setPanel('feed')}>Back to activity</button></div>}
          {panel === `moderation` && context.admin && <><Moderation organizationId={organizationId} />{community && <CommunityModeration viewer={viewer} />}</>}
        </>}
      </main>
      <aside className={`social-right`}>
        <p className={`social-eyebrow`}>
          {`Small steps. Real progress.`}
        </p>
        <h2>
          {`Your work inspires someone else.`}
        </h2>
        <p>
          {`A session. A new best. One more rep. Show your team what you’re working on.`}
        </p>
        <Link className={`social-primary`} to={staffOnly ? `/organization` : athleteUrl(`training`)}>
          {staffOnly ? `Open your organization` : `Open your training`}
          {` `}
          <span>
            {`↗`}
          </span>
        </Link>
        <div className={`social-right-note`}>
          <Icon name={`verified_user`} />
          <p>
            {`Your activity stays with your chosen audience. You’re in control of what you share.`}
          </p>
          <button onClick={() => setPanel(`settings`)}>
            {`Manage sharing →`}
          </button>
        </div>
      </aside>
    </div>
    <nav className={`social-bottom`} aria-label={staffOnly ? `Staff navigation` : `Player tabs`}>
      {tabs.map(([e, t, n]) => <Link to={e} aria-current={n === `Home` || n === 'Feed' ? `page` : void 0} onClick={event => {
        if (n === `Home` || n === 'Feed') {
          event.preventDefault();
          setPanel(`feed`);
        }
      }} key={n}>
        <Icon name={t} />
        <span>
          {n}
        </span>
      </Link>)}
    </nav>
  </div>;
}
function ActivityCard({ activity, organizationId, preview, onChange, onPerson, communityEnabled = false, onBlocked = () => {} }) {
  let viewAsPlayerId = new URLSearchParams(useLocation().search).get(`viewAsPlayerId`) || void 0;
  let [busy, setBusy] = React.useState(false);
  let [error, setError] = React.useState(``);
  let [commentsOpen, setCommentsOpen] = React.useState(false);
  let [mediaLease, setMediaLease] = React.useState(null);
  let [mediaBusy, setMediaBusy] = React.useState(false);
  const videoUrl = activity.canViewVideo ? mediaLease?.url || '' : '';
  const videoElement = React.useRef(null);
  let [videoNotice, setVideoNotice] = React.useState(``);
  let [reportReason, setReportReason] = React.useState(``);
  let [notice, setNotice] = React.useState(``);
  let [publishing, setPublishing] = React.useState(false);
  let [commentDraft, setCommentDraft] = React.useState('');
  let pendingCommentId = React.useRef('');
  let [selectedRep, setSelectedRep] = React.useState(activity.selectedRepId || '');
  let mediaRequest = React.useRef(0);
  let mounted = React.useRef(true);
  let viewerUid = auth.currentUser?.uid;
  React.useEffect(() => { setBusy(false); }, []);
  const clearMedia = React.useCallback(() => {
    ++mediaRequest.current;
    if (videoElement.current) { videoElement.current.pause(); videoElement.current.removeAttribute('src'); videoElement.current.load(); }
    setMediaLease(null); setMediaBusy(false);
  }, []);
  React.useEffect(() => {
    const hide = () => { if (document.hidden) clearMedia(); };
    window.addEventListener('posetek:player-route-leave', clearMedia);
    window.addEventListener('pagehide', clearMedia);
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('posetek:player-route-leave', clearMedia);
      window.removeEventListener('pagehide', clearMedia);
      document.removeEventListener('visibilitychange', hide);
      clearMedia();
    };
  }, [clearMedia, activity.id, activity.canViewVideo, activity.audience, activity.hidden, activity.selectedRepId, selectedRep]);
  React.useEffect(() => {
    if (!mediaLease) return;
    const timer = setTimeout(() => { clearMedia(); setVideoNotice('Video link expired. Tap Watch saved rep to reload it.'); }, Math.max(0, mediaLease.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [mediaLease, clearMedia]);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++mediaRequest.current;
    };
  }, []);
  let runAction = async (e) => {
    if (!busy) {
      if (preview || viewAsPlayerId) {
        setNotice(viewAsPlayerId ? `Athlete previews are read-only.` : `Sample preview. Sign in to interact with real activity.`);
        return;
      }
      setBusy(true);
      setError(``);
      try {
        await e();
      }
      catch (e) {
        if (mounted.current) {
          setError(e.message);
        }
      }
      finally {
        if (mounted.current) {
          setBusy(false);
        }
      }
    }
  };
  let refreshActivity = async () => {
    let n = await callSocial(`getSocialActivity`, {
      id: activity.id,
      organizationId: organizationId,
      viewAsPlayerId: viewAsPlayerId
    });
    if (mounted.current && auth.currentUser?.uid === viewerUid) {
      onChange(n);
    }
  };
  let chartMaximum = Math.max(...activity.chart, 1);
  return <article className={`social-card`}>
    <div className={`social-card-author`}>
      <button className={`social-avatar`} onClick={() => onPerson(activity.playerId)} aria-label={`View ${activity.authorName}`}>
        {initials(activity.authorName)}
      </button>
      <div>
        <button className={`social-author-name`} onClick={() => onPerson(activity.playerId)}>
          {activity.authorName}
        </button>
        <p>
          {activity.teamName || `PoseTek athlete`}
        </p>
        <time dateTime={new Date(activity.occurredAt).toISOString()}>
          {formatDate(activity.occurredAt)}
        </time>
      </div>
      <span className={`social-activity-icon`}>
        <Icon name={activity.kind === `workout` ? `fitness_center` : `sports_soccer`} />
      </span>
    </div>
    <h2>
      {activity.title}
    </h2>
    <p className={`social-card-subtitle`}>
      {activity.subtitle}
      {activity.partial ? ` · Finished with partial work` : ``}
    </p>
    {activity.caption && <p className="social-caption">{activity.caption}</p>}
    {activity.audience === 'community' && <p className="social-audience-label">{activity.communityPublished === false ? 'Not currently shared with the community' : 'Shared with signed-in PoseTek members'}</p>}
    <div className={`social-metrics`}>
      {activity.metrics.map(e => <div key={e.label}>
        <span>
          {e.label}
        </span>
        <strong>
          {formatMeasurement(e.value, e.unit)}
        </strong>
      </div>)}
    </div>
    {activity.score !== null && <div className={`social-score`}>
      <Icon name={`insights`} />
      <span>
        <strong>
          {Math.round(activity.score)}
          {` benchmark rating`}
        </strong>
        {` · 100 = reference median for this metric`}
      </span>
    </div>}
    {videoUrl ? <video ref={videoElement} className={`social-video`} src={videoUrl} controls={true} playsInline={true} preload={`metadata`} onError={() => {
      clearMedia();
      setVideoNotice(`Video link expired or unavailable. Tap Watch saved rep to retry.`);
    }} /> : activity.chart.length > 0 ? <div className={`social-chart`} role={`img`} aria-label={`Last ${activity.chart.length} rep results: ${activity.chart.map(e => e.toFixed(1)).join(`, `)}`}>
      <div className={`social-chart-heading`}>
        <span>
          {`EVERY REP COUNTS`}
        </span>
        <Icon name={`trending_up`} />
      </div>
      <div className={`social-bars`}>
        {activity.chart.map((e, t) => <span style={{
          height: `${Math.max(8, e / chartMaximum * 100)}%`
        }} key={t} />)}
      </div>
      <div className={`social-chart-footer`}>
        <span>
          {`Rep by rep`}
        </span>
        <span>
          {activity.chart.length}
          {` recorded results`}
        </span>
      </div>
    </div> : <div className={`social-workout-art`}>
      <Icon name={`fitness_center`} />
      <span>
        {`WORK PUT IN.`}
      </span>
      <small>
        {`One session closer.`}
      </small>
    </div>}
    {activity.canViewVideo && activity.availableReps?.length > 1 && <label className="social-rep-choice">Saved rep<select value={selectedRep} onChange={event => { clearMedia(); setSelectedRep(event.target.value); setVideoNotice(''); }}><option value="">Featured rep</option>{activity.availableReps.filter(rep => rep.canViewVideo).map(rep => <option key={rep.id} value={rep.id}>{rep.label}</option>)}</select></label>}
    {activity.canViewVideo && !videoUrl && <button className={`social-watch`} disabled={busy || mediaBusy} onClick={() => {
      if (!preview) {
        setMediaBusy(true);
        setError(``);
        const request = ++mediaRequest.current;
        (async () => {
          let n = await callSocial(`getSocialMedia`, {
            id: activity.id,
            organizationId: organizationId,
            viewAsPlayerId: viewAsPlayerId,
            ...(selectedRep ? { repId: selectedRep } : {})
          });
          if (mounted.current && auth.currentUser?.uid === viewerUid && request === mediaRequest.current) {
            const lease = socialMediaLease(n);
            setMediaLease(lease);
            setVideoNotice(lease ? `` : `No current saved video is available for this rep.`);
          }
        })().catch(e => { if (mounted.current && request === mediaRequest.current) setError(e.message); }).finally(() => { if (mounted.current && request === mediaRequest.current) setMediaBusy(false); });
      }
    }}>
      <Icon name={`play_circle`} />
      {`Watch saved rep`}
    </button>}
    {videoNotice && <p role={`status`}>
      {videoNotice}
    </p>}
    <div className={`social-engagement`}>
      <span className={`social-kudos-dot`}>
        {`↗`}
      </span>
      <span>
        {activity.kudos ? `${activity.kudos} gave kudos` : `Be the first to give kudos`}
      </span>
      <span>
        {activity.comments ? `${activity.comments} comments` : ``}
      </span>
    </div>
    <div className={`social-card-actions`}>
      <button disabled={busy || !!viewAsPlayerId} aria-pressed={activity.liked} onClick={() => void runAction(async () => {
        const before = activity;
        onChange({ ...activity, liked: !activity.liked, kudos: Math.max(0, activity.kudos + (activity.liked ? -1 : 1)) });
        try { await callSocial(`setSocialKudos`, {
          id: activity.id,
          liked: !activity.liked,
          organizationId: organizationId,
          viewAsPlayerId: viewAsPlayerId
        });
        await refreshActivity();
        } catch (error) { if (mounted.current && auth.currentUser?.uid === viewerUid) onChange(before); throw error; }
      })}>
        <Icon name={`thumb_up`} />
        {`Kudos`}
      </button>
      <button aria-expanded={commentsOpen} onClick={() => setCommentsOpen(!commentsOpen)}>
        <Icon name={`chat_bubble`} />
        {`Comment`}
      </button>
      <button onClick={() => void runAction(async () => {
        const url = `${window.location.origin}/feed?activity=${encodeURIComponent(activity.id)}`;
        if (navigator.share) {
          try { await navigator.share({ title: activity.title, url }); }
          catch (error) { if (error.name !== 'AbortError') throw error; }
        } else {
          await navigator.clipboard.writeText(url);
          setNotice(`Activity link copied. Your sharing settings still apply.`);
        }
      })}>
        <Icon name={`ios_share`} />
        {`Share`}
      </button>
    </div>
    {communityEnabled && activity.mine && <button className="community-publish social-watch" disabled={busy || !!viewAsPlayerId} onClick={() => setPublishing(true)}><Icon name="publish" />{activity.communityPublished ? 'Edit community post' : 'Share your progress'}</button>}
    <details className={`social-card-options`}>
      <summary>
        {`Activity options`}
      </summary>
      {activity.mine ? <>
        <label>
          {`Audience`}
          <select disabled={busy || !!viewAsPlayerId} value={activity.audience} onChange={n => void runAction(async () => {
            await callSocial(`setSocialVisibility`, {
              id: activity.id,
              audience: n.target.value,
              hidden: activity.hidden,
              organizationId: organizationId,
              viewAsPlayerId: viewAsPlayerId
            });
            await refreshActivity();
          })}>
            {Object.entries(audienceLabels).filter(([e]) => e !== 'community' || activity.audience === 'community').map(([e, t]) => <option value={e} key={e} disabled={e === 'community'}>
              {t}
            </option>)}
          </select>
        </label>
        <button disabled={busy || !!viewAsPlayerId} onClick={() => void runAction(async () => {
          await callSocial(`setSocialVisibility`, {
            id: activity.id,
            audience: activity.audience === 'community' ? 'private' : activity.audience,
            hidden: activity.audience === 'community' ? false : !activity.hidden,
            organizationId: organizationId,
            viewAsPlayerId: viewAsPlayerId
          });
          await refreshActivity();
        })}>
          {activity.audience === 'community' ? 'Withdraw community post' : activity.hidden ? `Show activity again` : `Hide activity from others`}
        </button>
      </> : <form onSubmit={n => {
        n.preventDefault();
        runAction(async () => {
          await callSocial(communityEnabled ? `reportSocialContent` : `reportSocialActivity`, {
            ...(communityEnabled ? { targetType: 'activity', activityId: activity.id } : { id: activity.id }),
            reason: reportReason,
            organizationId: organizationId,
            viewAsPlayerId: viewAsPlayerId
          });
          setReportReason(``);
          setNotice(`Report sent to PoseTek.`);
        });
      }}>
        <label>
          {`Report a problem`}
          <textarea required={true} maxLength={500} value={reportReason} onChange={e => setReportReason(e.target.value)} />
        </label>
        <button disabled={busy || !!viewAsPlayerId}>
          {`Send report`}
        </button>
      </form>}
      {!activity.mine && communityEnabled && <button disabled={busy || !!viewAsPlayerId} onClick={() => void runAction(async () => {
        await callSocial('socialConnection', { playerId: activity.playerId, action: 'block', organizationId, viewAsPlayerId });
        if (mounted.current && auth.currentUser?.uid === viewerUid) onBlocked(activity.playerId);
      })}>Block player</button>}
    </details>
    {commentsOpen && <CommunitySheet title="Comments" onClose={() => setCommentsOpen(false)}><Comments activity={activity} preview={preview} organizationId={organizationId} onChanged={refreshActivity} draft={commentDraft} onDraftChange={setCommentDraft} pendingIdRef={pendingCommentId} communityEnabled={communityEnabled} /></CommunitySheet>}
    {publishing && <PublishActivity activity={activity} viewer={{ organizationId, viewAsPlayerId }} preview={preview} onClose={() => setPublishing(false)} onSaved={() => void refreshActivity().catch(e => setError(e.message))} />}
    {notice && <p className={`social-notice`} role={`status`}>
      {notice}
    </p>}
    {error && <p className={`social-error`} role={`alert`}>
      {error}
    </p>}
  </article>;
}
function Comments({ activity, organizationId, preview, onChanged, draft = '', onDraftChange, pendingIdRef, communityEnabled = false }) {
  let viewAsPlayerId = new URLSearchParams(useLocation().search).get(`viewAsPlayerId`) || void 0;
  let [comments, setComments] = React.useState([]);
  let [cursor, setCursor] = React.useState(null);
  let [text, setTextState] = React.useState(draft);
  const setText = value => { setTextState(value); onDraftChange?.(value); };
  let [error, setError] = React.useState(``);
  let [busy, setBusy] = React.useState(false);
  let localPendingId = React.useRef(``);
  let pendingCommentId = pendingIdRef || localPendingId;
  let mounted = React.useRef(true);
  let requestEpoch = React.useRef(0);
  let loadComments = React.useCallback(async (r = null) => {
    if (preview)
      return;
    const epoch = requestEpoch.current;
    let i = await callSocial(`getSocialComments`, {
      id: activity.id,
      cursor: r,
      organizationId: organizationId,
      viewAsPlayerId: viewAsPlayerId
    });
    if (mounted.current && epoch === requestEpoch.current) {
      setComments(e => r ? [...e, ...i.items] : i.items);
      setCursor(i.cursor);
    }
  }, [
    preview,
    activity.id,
    organizationId,
    viewAsPlayerId
  ]);
  React.useEffect(() => {
    mounted.current = true;
    setBusy(false);
    loadComments().catch(e => {
      if (mounted.current) {
        setError(e.message);
      }
    });
    return () => {
      mounted.current = false;
      ++requestEpoch.current;
    };
  }, [loadComments]);
  let saveComment = async (e) => {
    const epoch = requestEpoch.current;
    const current = () => mounted.current && epoch === requestEpoch.current;
    setBusy(true);
    setError(``);
    try {
      await e(current);
      if (current()) { await loadComments(); await onChanged(); }
    }
    catch (e) {
      if (current()) {
        setError(e.message);
      }
    }
    finally {
      if (current()) {
        setBusy(false);
      }
    }
  };
  return <section className={`social-comments`} aria-label={`Comments`}>
    {comments.map(n => <div key={n.id}>
      <strong>
        {n.name}
      </strong>
      <p>
        {n.text}
      </p>
      <small>
        {formatDate(n.createdAt)}
      </small>
      {n.canDelete && <button disabled={busy || !!viewAsPlayerId} onClick={() => void saveComment(async () => {
        await callSocial(`saveSocialComment`, {
          id: activity.id,
          commentId: n.id,
          remove: true,
          organizationId: organizationId,
          viewAsPlayerId: viewAsPlayerId
        });
      })}>
        {`Delete`}
      </button>}
      {communityEnabled && <ReportContent viewer={{ organizationId, viewAsPlayerId }} preview={preview} target={{ targetType: 'comment', activityId: activity.id, commentId: n.id }} />}
    </div>)}
    {cursor && <button disabled={busy} onClick={() => void loadComments(cursor).catch(e => setError(e.message))}>
      {`More comments`}
    </button>}
    {!comments.length && <p>
      {`Start the encouragement.`}
    </p>}
    {activity.commentsEnabled === false ? <p>Comments are turned off for this activity.</p> : activity.canComment === false ? <p>You can read this discussion. Commenting is not available for this account.</p> : <form onSubmit={r => {
      r.preventDefault();
      if (preview || viewAsPlayerId) {
        setError(`Read-only preview. Comments are available on real activity after sign-in.`);
        return;
      }
      saveComment(async current => {
        pendingCommentId.current ||= crypto.randomUUID();
        await callSocial(`saveSocialComment`, {
          id: activity.id,
          commentId: pendingCommentId.current,
          text: text,
          organizationId: organizationId,
          viewAsPlayerId: viewAsPlayerId
        });
        if (current()) { setText(``); pendingCommentId.current = ``; }
      });
    }}>
      <label htmlFor={`comment-${activity.id}`}>
        {`Add a comment`}
      </label>
      <textarea id={`comment-${activity.id}`} disabled={busy} required={true} maxLength={1000} value={text} onChange={e => {
        pendingCommentId.current = ``;
        setText(e.target.value);
      }} />
      <button className={`social-primary`} disabled={busy || !!viewAsPlayerId || !text.trim()}>
        {`Post comment`}
      </button>
    </form>}
    {error && <p role={`alert`}>
      {error}
    </p>}
  </section>;
}
function People({ context, linkedPlayer, organizationId, preview, onMutated }) {
  let viewAsPlayerId = new URLSearchParams(useLocation().search).get(`viewAsPlayerId`) || void 0;
  let [people, setPeople] = React.useState([]);
  let [cursor, setCursor] = React.useState(null);
  let [search, setSearch] = React.useState(``);
  let [error, setError] = React.useState(``);
  let [busy, setBusy] = React.useState(false);
  let [notice, setNotice] = React.useState(``);
  let mounted = React.useRef(true);
  let loadPeople = React.useCallback(async (e = null) => {
    if (preview) {
      setPeople(sampleActivities.map(e => ({
        playerId: e.playerId + e.id,
        name: e.authorName,
        uid: `sample`,
        mine: false,
        sameTeam: true,
        relationship: `none`
      })));
      return;
    }
    let i = await callSocial(`getSocialPeople`, {
      cursor: e,
      playerId: linkedPlayer,
      organizationId: organizationId,
      viewAsPlayerId: viewAsPlayerId
    });
    if (mounted.current) {
      setPeople(t => e ? [...new Map([...t, ...i.people].map(e => [e.playerId, e])).values()] : i.people);
      setCursor(i.cursor);
    }
  }, [
    preview,
    linkedPlayer,
    organizationId,
    viewAsPlayerId
  ]);
  /* oxlint-disable react/set-state-in-effect -- Preserve deployed state resets before loading a different viewer, audience, or directory. */
  React.useEffect(() => {
    mounted.current = true;
    loadPeople().catch(e => {
      if (mounted.current) {
        setError(e.message);
      }
    });
    return () => {
      mounted.current = false;
    };
  }, [loadPeople]); /* oxlint-enable react/set-state-in-effect */
  React.useEffect(() => { setBusy(false); }, []);
  let changeConnection = async (e, t) => {
    if (preview || viewAsPlayerId) {
      setNotice(`Read-only preview. Connections are available after sign-in.`);
      return;
    }
    setBusy(true);
    setError(``);
    try {
      await callSocial(`socialConnection`, {
        playerId: e.playerId,
        action: t,
        organizationId: organizationId,
        viewAsPlayerId: viewAsPlayerId
      });
      if (mounted.current) onMutated?.();
      await loadPeople();
    }
    catch (e) {
      if (mounted.current) {
        setError(e.message);
      }
    }
    finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  };
  return <section className={`social-people`}>
    <p className={`social-eyebrow`}>
      {`Find your people`}
    </p>
    <h1>
      {`Stronger connections.`}
    </h1>
    <p>
      {`Your teammates, your club, and the friends who keep you going.`}
    </p>
    {context.playerId && <button onClick={() => {
      if (preview) {
        setNotice(`Sample preview — no connection link.`);
        return;
      }
      navigator.clipboard.writeText(`${window.location.origin}/feed?connect=${encodeURIComponent(context.playerId)}`).then(() => setNotice(`Connection link copied. Send it to a friend.`)).catch(() => setError(`Could not copy. Try again.`));
    }}>
      {`Copy my connection link`}
    </button>}
    <label>
      {`Find a person`}
      <input type={`search`} value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search loaded members by name`} />
    </label>
    {error && <p className={`social-error`} role={`alert`}>
      {error}
    </p>}
    {notice && <p role={`status`}>
      {notice}
    </p>}
    {people.filter(e => e.name.toLowerCase().includes(search.toLowerCase())).map(t => <article className={`social-person`} key={t.playerId}>
      <div className={`social-avatar`}>
        {initials(t.name)}
      </div>
      <div>
        <strong>
          {t.name}
        </strong>
        <small>
          {t.mine ? `You` : t.relationship === `accepted` ? `Friends` : t.sameTeam ? `Your teammate` : (t.canConnect ?? !!t.uid) ? `PoseTek athlete` : `Not signed up yet`}
        </small>
      </div>
      {!t.mine && (t.canConnect ?? !!t.uid) && context.playerId && <div className={`social-person-actions`}>
        {t.relationship === `none` && <button disabled={busy || !!viewAsPlayerId} onClick={() => void changeConnection(t, `request`)}>
          {`Connect`}
        </button>}
        {t.relationship === `received` && <>
          <button disabled={busy || !!viewAsPlayerId} onClick={() => void changeConnection(t, `accept`)}>
            {`Accept`}
          </button>
          <button disabled={busy || !!viewAsPlayerId} onClick={() => void changeConnection(t, `remove`)}>
            {`Decline`}
          </button>
        </>}
        {[`sent`, `accepted`].includes(t.relationship) && <button disabled={busy || !!viewAsPlayerId} onClick={() => void changeConnection(t, `remove`)}>
          {t.relationship === `sent` ? `Cancel request` : `Remove friend`}
        </button>}
        <details>
          <summary aria-label={`More options for ${t.name}`}>
            {`•••`}
          </summary>
          <button disabled={busy || !!viewAsPlayerId} onClick={() => void changeConnection(t, t.relationship === `blocked` ? `unblock` : `block`)}>
            {t.relationship === `blocked` ? `Unblock` : `Block`}
          </button>
        </details>
      </div>}
    </article>)}
    {cursor && <button disabled={busy} onClick={() => void loadPeople(cursor).catch(e => setError(e.message))}>
      {`Load more people`}
    </button>}
    {!people.length && !error && <p>
      {`No people to show yet.`}
    </p>}
  </section>;
}
function SharingSettings({ context, organizationId, preview, onSave }) {
  let viewAsPlayerId = new URLSearchParams(useLocation().search).get(`viewAsPlayerId`) || void 0;
  let [preferences, setPreferences] = React.useState(context.preferences);
  let [busy, setBusy] = React.useState(false);
  let [notice, setNotice] = React.useState(``);
  return <section className={`social-settings`}>
    <p className={`social-eyebrow`}>
      {`Your activity. Your choice.`}
    </p>
    <h1>
      {`Sharing settings`}
    </h1>
    <p>
      {`These defaults apply to activity without an individual audience override. Video sharing applies to all of your activity.`}
    </p>
    {context.playerId ? <form onSubmit={e => {
      e.preventDefault();
      if (preview || viewAsPlayerId) {
        setNotice(`Read-only preview — settings were not saved.`);
        return;
      }
      setBusy(true);
      callSocial(`saveSocialPreferences`, {
        ...preferences,
        organizationId: organizationId,
        viewAsPlayerId: viewAsPlayerId
      }).then(() => {
        setNotice(`Sharing settings saved.`);
        onSave(preferences);
      }).catch(e => setNotice(e.message)).finally(() => setBusy(false));
    }}>
      <fieldset disabled={busy || !!viewAsPlayerId}>
        <label>
          {`Default audience`}
          <select value={preferences.audience} onChange={e => setPreferences({
            ...preferences,
            audience: e.target.value
          })}>
            {Object.entries(audienceLabels).filter(([e]) => e !== 'community').map(([e, t]) => <option value={e} key={e}>
              {t}
            </option>)}
          </select>
        </label>
        <label className={`social-check`}>
          <input type={`checkbox`} checked={preferences.automatic} onChange={e => setPreferences({
            ...preferences,
            automatic: e.target.checked
          })} />
          {`Automatically share recorded sessions and finished workouts`}
        </label>
        <label className={`social-check`}>
          <input type={`checkbox`} checked={preferences.videos} onChange={e => setPreferences({
            ...preferences,
            videos: e.target.checked
          })} />
          {`Include saved rep videos`}
        </label>
        <p>
          {`Turning off sharing stops new video links immediately. A link already issued can remain playable for up to five minutes.`}
        </p>
        <button className={`social-primary`} disabled={busy || !!viewAsPlayerId}>
          {`Save preferences`}
        </button>
      </fieldset>
    </form> : <p>
      {`Activity sharing preferences belong to athlete accounts.`}
    </p>}
    {notice && <p role={`status`}>
      {notice}
    </p>}
  </section>;
}
function Moderation({ organizationId }) {
  let viewAsPlayerId = new URLSearchParams(useLocation().search).get(`viewAsPlayerId`) || void 0;
  let [reports, setReports] = React.useState([]);
  let [error, setError] = React.useState(``);
  let [busy, setBusy] = React.useState(false);
  let loadReports = React.useCallback(async () => {
    let n = await callSocial(`moderateSocialActivity`, {
      organizationId: organizationId,
      viewAsPlayerId: viewAsPlayerId
    });
    setReports(n.reports || []);
  }, [organizationId, viewAsPlayerId]);
  /* oxlint-disable react/set-state-in-effect -- Preserve deployed state resets before loading a different viewer, audience, or directory. */
  React.useEffect(() => {
    loadReports().catch(e => setError(e.message));
  }, [loadReports]); /* oxlint-enable react/set-state-in-effect */
  return <section>
    <h1>
      {`Activity reports`}
    </h1>
    {error && <p role={`alert`}>
      {error}
    </p>}
    {reports.map(n => <article className={`social-card`} key={n.id}>
      <p>
        {n.reason}
      </p>
      <Link to={`/feed?activity=${n.activityId}&organizationId=${organizationId || ``}`}>
        {`Review activity`}
      </Link>
      {[true, false].map(r => <button disabled={busy || !!viewAsPlayerId} onClick={() => {
        setBusy(true);
        callSocial(`moderateSocialActivity`, {
          id: n.activityId,
          hidden: r,
          organizationId: organizationId,
          viewAsPlayerId: viewAsPlayerId
        }).then(loadReports).catch(e => setError(e.message)).finally(() => setBusy(false));
      }} key={String(r)}>
        {r ? `Hide activity` : `Dismiss report / restore`}
      </button>)}
    </article>)}
    {!reports.length && <p>
      {`No open reports.`}
    </p>}
  </section>;
}
function AdminDirectory({ organizationId, selectedPlayer, onSwitch }) {
  let navigate = useNavigate();
  let [directory, setDirectory] = React.useState({
    organizations: [],
    players: []
  });
  let [error, setError] = React.useState(``);
  /* oxlint-disable react/set-state-in-effect -- Preserve deployed state resets before loading a different viewer, audience, or directory. */
  React.useEffect(() => {
    let t = true;
    setDirectory({
      organizations: [],
      players: []
    });
    setError(``);
    callSocial(`getSocialAdminDirectory`, {
      organizationId: organizationId
    }).then(e => {
      if (t) {
        setDirectory(e);
      }
    }).catch(e => {
      if (t) {
        setError(e.message);
      }
    });
    return () => {
      t = false;
    };
  }, [organizationId]); /* oxlint-enable react/set-state-in-effect */
  let switchPlayer = (e, t = ``) => {
    onSwitch();
    navigate(`/feed?` + new URLSearchParams({
      organizationId: e,
      ...t ? {
        viewAsPlayerId: t
      } : {}
    }));
  };
  return <section className={`social-admin-controls`} aria-label={`Admin feed preview`}>
    <Link to={`/admin`}>
      {`← Admin`}
    </Link>
    <div>
      <label>
        {`Organization`}
        <select aria-label={`Organization`} value={organizationId} onChange={e => switchPlayer(e.target.value)}>
          {directory.organizations.map(e => <option value={e.id} key={e.id}>
            {e.name}
          </option>)}
        </select>
      </label>
      <label>
        {`View as athlete`}
        <select aria-label={`View as athlete`} value={selectedPlayer} onChange={t => switchPlayer(organizationId, t.target.value)}>
          <option value={``}>
            {`Administrator view`}
          </option>
          {directory.players.map(e => <option value={e.id} disabled={!e.canPreview} key={e.id}>
            {e.name}
            {e.canPreview ? `` : ` · Signup pending`}
          </option>)}
        </select>
      </label>
    </div>
    {error && <p role={`alert`}>
      {error}
    </p>}
  </section>;
}
export { ActivityCard, FeedPage as default };
