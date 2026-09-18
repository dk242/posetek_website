import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getClubContext } from '../../../lib/organization-data';
import { auth, db } from '../../../lib/firebase';
import { fullName } from '../lib/metrics';
import BodyProfileView from '../views/BodyProfileView';
import type { PortalContext } from '../views/shared';
import type { PlayerProfile as Profile } from './scoring';
import type { Row } from './execution';
import TechniqueAnalysis from './TechniqueAnalysis';
import { activeProvisionalEstimates, provisionalScore, type ProvisionalEstimate } from '../../../lib/provisional-estimates';
import ProvisionalEstimateNote from '../../../components/athlete-stats/ProvisionalEstimateNote';
import { mergeProfileSessions, profileActivity, type ProfileSession } from './profile-activity';
import { NativeIcon } from './native-ui';
import { NATIVE_AXIS_ICONS, NATIVE_AXIS_ORDER, nativeBenchmarkBand, nativePreviewSessions } from './native-results';
import './native-results.css';
import { POSITION_LABELS, isPosition } from '../../../lib/contracts/types';

export function SkillProfile({ profile, estimate = null, estimates = estimate ? [estimate] : [] }: { profile: Profile; estimate?: ProvisionalEstimate | null; estimates?: ProvisionalEstimate[] }) {
  const [selection, setSelection] = useState(() => [...profile.axes].filter(a => a.score !== null).sort((a, b) => a.score! - b.score!)[0]?.key || 'striking');
  const axis = profile.axes.find(a => a.key === selection)!;
  const axes = [...profile.axes].sort((a, b) => NATIVE_AXIS_ORDER.indexOf(a.key) - NATIVE_AXIS_ORDER.indexOf(b.key));
  const band = nativeBenchmarkBand(profile.overall), axisBand = nativeBenchmarkBand(axis.score);
  const estimatedScores = Object.fromEntries(estimates.map(entry => [entry.axis,
    profile.axes.find(a => a.key === entry.axis)?.score === null
      ? provisionalScore(entry, profile.metrics.find(m => m.key === (entry.drill === 'dribbling' ? 'dribbleTotalTime' : 'codTotalTime'))?.reference ?? null) : null]));
  const point = (index: number, ratio: number) => {
    const angle = index * Math.PI * 2 / 5 - Math.PI / 2;
    return `${180 + Math.cos(angle) * 88 * ratio},${145 + Math.sin(angle) * 88 * ratio}`;
  };
  return <section className="player-skill-profile native-skill-profile"><div className="player-rating"><div><p className="eyebrow">Overall vs D1</p><div className="native-score-line"><strong>{profile.overall === null ? '—' : Math.round(profile.overall)}</strong>{band && <span className={`native-band native-band-${band.key}`}><NativeIcon name={band.icon} size={12} />{band.label}</span>}</div></div><small>{profile.totalReps} reps · {profile.totalSessions} sessions</small></div>
    <section className="portal-card native-skill-card"><div className="native-radar-legend"><h2>Your skill map</h2><small>{axes.filter(a => a.score !== null).length}/{axes.length} recorded</small><span><i />You</span><span><i className="reference" />D1</span></div><svg className="player-radar" viewBox="0 0 360 300" aria-label="Skill map, select a category below" role="group">
      {[0.25, 0.5, 0.75, 1].map(r => <polygon key={r} points={axes.map((_, i) => point(i, r)).join(' ')} fill="none" stroke="rgba(255,255,255,.09)" />)}
      {axes.map((a, i) => { const [x, y] = point(i, 1).split(','); return <line key={a.key} x1="180" y1="145" x2={x} y2={y} stroke={a.key === selection ? '#7cff1873' : '#ffffff20'} strokeDasharray={a.score === null ? '3 3' : undefined} />; })}
      <polygon points={axes.map((_, i) => point(i, 100 / 130)).join(' ')} fill="#ffffff0f" stroke="#ffffff8c" strokeDasharray="5 4" strokeWidth="1.5" />
      {axes.filter(a => a.score !== null).length >= 3 && <polygon points={axes.flatMap((a, i) => a.score === null ? [] : [point(i, Math.min(130, a.score) / 130)]).join(' ')} fill="#7cff1838" stroke="#7cff18" strokeWidth="2.5" />}
      {axes.map((a, i) => {
        const estimatedScore = estimatedScores[a.key];
        if (estimatedScore == null) return null;
        const [cx, cy] = point(i, Math.min(130, estimatedScore) / 130).split(',');
        return <g key={`estimated-${a.key}`} role="button" tabIndex={0} aria-label={`Estimated ${a.label} ${Math.round(estimatedScore)}`} onClick={() => setSelection(a.key)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelection(a.key); } }}>
          {[i - 1, i + 1].map(n => { const index = (n + 5) % 5, neighbor = axes[index], score = neighbor.score ?? estimatedScores[neighbor.key]; if (score == null) return null; const [x, y] = point(index, Math.min(130, score) / 130).split(','); return <line key={n} x1={x} y1={y} x2={cx} y2={cy} className="provisional-chart-line" />; })}
          <circle cx={cx} cy={cy} r="6" className="provisional-chart-marker" />
        </g>;
      })}
      {axes.map((a, i) => { const [x, y] = point(i, 1.42).split(',').map(Number); const [cx, cy] = point(i, Math.min(130, a.score || 0) / 130).split(','); const selected = selection === a.key; return <g key={a.key} role="button" tabIndex={0} aria-label={`Show ${a.label}`} aria-pressed={selected} onClick={() => setSelection(a.key)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelection(a.key); } }}><rect x={x - 39} y={y - 13} width="78" height="43" rx="9" fill={selected ? '#ffffff24' : 'transparent'} stroke={selected ? '#7cff18b3' : 'transparent'} /><text x={x} y={y + 2} textAnchor="middle" fill={a.score === null ? '#ffffff65' : '#fff'} fontSize="10" fontWeight="700">{a.label}</text><text x={x} y={y + 19} textAnchor="middle" fill={a.score === null ? '#ffffff65' : '#7cff18'} fontSize="14" fontWeight="800">{a.score === null ? estimatedScores[a.key] != null ? `${Math.round(estimatedScores[a.key]!)} est.` : '—' : Math.round(a.score)}</text>{a.score !== null && <circle cx={cx} cy={cy} r={selected ? 6.5 : 4} fill="#7cff18" stroke="#ffffffd9" strokeWidth={selected ? 2.5 : 1.5} />}</g>; })}
    </svg>
      {estimates.filter(entry => estimatedScores[entry.axis] != null).map(entry => <ProvisionalEstimateNote key={entry.id} estimate={entry} score={estimatedScores[entry.axis]} scoreLabel="vs your standard" />)}</section>
    <section className="portal-card native-axis-detail"><header><span className="native-icon-disc"><NativeIcon name={NATIVE_AXIS_ICONS[axis.key]} size={17} /></span><div><h2>{axis.label}</h2><small>{axis.repCount} {axis.repCount === 1 ? 'rep' : 'reps'}{axis.repCount > 0 && axis.repCount < 3 ? ' · limited data' : ''}</small></div><strong className={`native-band-${axisBand?.key || 'early'}`}>{axis.score === null ? '—' : Math.round(axis.score)}<small>vs D1</small></strong></header>{['speed', 'agility', 'ballControl'].includes(axis.key) && <p className="muted-copy">Completion time drives this rating.{axis.key === 'ballControl' ? ' Matching no-ball runs refine it when available.' : ''}</p>}
      {profile.metrics.filter(m => m.axis === axis.key).map(m => <div className="player-metric native-axis-metric" key={m.key}><div><span>{m.label}</span><strong>{m.best === null ? '—' : m.format(m.best)}</strong></div><div className="player-meter"><i style={{ width: `${m.score === null ? 0 : Math.min(100, m.score / 130 * 100)}%` }} /><b className="native-d1-tick" title="D1 reference: 100" /></div><small>{m.score === null ? 'Not recorded' : `${Math.round(m.score)} · 100 = standard`}{m.reference !== null ? ` · D1 ${m.format(m.reference)}` : ''}</small></div>)}
      {axis.key === 'striking' && <PersonalComparison label="Weak foot" value={profile.comparisons.kickRetention} detail={profile.comparisons.kickLeft && profile.comparisons.kickRight ? `Left ${(profile.comparisons.kickLeft * 2.23694).toFixed(1)} mph · Right ${(profile.comparisons.kickRight * 2.23694).toFixed(1)} mph` : 'Record both feet to compare.'} />}
      {axis.key === 'ballControl' && <><PersonalComparison label="Weak foot" value={profile.comparisons.dribbleRetention} detail={profile.comparisons.dribbleLeft && profile.comparisons.dribbleRight ? `Left ${profile.comparisons.dribbleLeft.toFixed(2)} s · Right ${profile.comparisons.dribbleRight.toFixed(2)} s` : 'Record both feet on a matching course.'} /><PersonalComparison label="Ball slowdown" value={profile.comparisons.slowdown} detail="Extra completion time compared with your matching no-ball run." /></>}
    </section><p className="muted-copy">D1 references are provisional. Missing measurements remain unscored. Personal comparisons are not D1 standards.</p>
  </section>;
}
function PersonalComparison({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  return <div className="player-metric"><div><span>{label}</span><strong>{value === null ? '—' : `${Math.round(value)}%`}</strong></div><small>{detail}</small></div>;
}

export default function PlayerProfile({ ctx, profile, onDrills }: { ctx: PortalContext; profile: Profile; onDrills: (rep?: Row) => void }) {
  const location = useLocation(), leaderboardParams = new URLSearchParams(location.search);
  leaderboardParams.set('view', 'leaderboards'); ['drill', 'session', 'rep'].forEach(key => leaderboardParams.delete(key));
  const [club, setClub] = useState<Row | null>(ctx.access === 'preview' ? { name: 'PoseTek FC' } : null), [clubError, setClubError] = useState('');
  const [body, setBody] = useState(false), [sessions, setSessions] = useState<ProfileSession[] | null>(null), [sessionError, setSessionError] = useState('');
  useEffect(() => {
    if (ctx.access === 'preview') return;
    let alive = true;
    setClub(null); setClubError('');
    if (ctx.athlete.organizationId) getClubContext(ctx.athlete.organizationId).then(c => { if (alive) setClub(c.organization); }).catch(() => { if (alive) setClubError('Club unavailable'); });
    const sources = new Map<string, Row[]>(), errors = new Set<string>();
    // Query only this resolved player's canonical ID and signed-in owner identity.
    const legacyIds = [...new Set([ctx.playerId!, auth.currentUser?.uid].filter((id): id is string => !!id))];
    const emit = () => {
      if (!alive) return;
      if (sources.has('current') || errors.has('current')) setSessions(mergeProfileSessions(sources.get('current') || [], [...sources].filter(([key]) => key !== 'current').flatMap(([, rows]) => rows)));
      setSessionError(errors.size ? 'Some session history could not refresh. Showing available sessions.' : '');
    };
    setSessions(null); setSessionError('');
    const watch = (key: string, query: ReturnType<typeof db.collection> | ReturnType<ReturnType<typeof db.collection>['where']>) => query.onSnapshot(s => {
      sources.set(key, s.docs.map(d => ({ ...d.data(), id: d.id }))); errors.delete(key); emit();
    }, () => { errors.add(key); emit(); });
    const stops = [watch('current', db.collection('players').doc(ctx.playerId!).collection('sessions')),
      ...legacyIds.map(id => watch(`legacy:${id}`, db.collection('sessions').where('playerUID', '==', id)))];
    return () => { alive = false; stops.forEach(stop => stop()); };
  }, [ctx.playerId, ctx.athlete.organizationId, ctx.access]);
  const activity = profileActivity(ctx.access === 'preview' ? nativePreviewSessions(ctx.allStatsReps()) : sessions || []), loadingSessions = sessions === null && ctx.access !== 'preview';
  const position = ctx.athlete.position;
  return <section className="player-profile native-profile"><div className="player-profile-hero native-profile-hero"><BodyProfileView ctx={ctx} compact onMore={() => setBody(v => !v)} /><div className="native-profile-identity-column"><section className={`portal-card player-club${!club ? ' native-no-club' : ''}`}>{club?.logoUrl ? <img src={club.logoUrl} alt={`${club.name} crest`} /> : <NativeIcon name="shield.lefthalf.filled" size={68} />}<h2>{club?.name || clubError || (ctx.athlete.organizationId ? 'Loading club…' : 'No club yet')}</h2></section><section className="portal-card player-identity"><p className="eyebrow">Athlete</p><h1>{fullName(ctx.athlete)}</h1><div className="native-position"><NativeIcon name="figure.soccer" size={18} /><div><strong>{isPosition(position) ? POSITION_LABELS[position] : position || 'Position not set'}</strong>{isPosition(position) && <small>{position}</small>}</div></div></section></div></div>
    {body && <section className="native-body-expanded"><button className="text-button" onClick={() => setBody(false)}>Close body scan</button><BodyProfileView ctx={ctx} /></section>}
    <SkillProfile profile={profile} estimates={activeProvisionalEstimates(ctx.provisionalEstimates, ctx.allResultReps?.() || ctx.allStatsReps())} />
    {sessionError && <p className="player-error" role="status">{sessionError}</p>}
    <section className="player-session-stats native-session-stats"><div className="native-summary-lime"><header><span className="native-icon-disc"><NativeIcon name="bolt.fill" size={13} /></span><span>Streak</span></header><strong>{loadingSessions ? '…' : activity.streak}<small>days</small></strong><small>Keep it going</small></div><div className="native-summary-cyan"><header><span className="native-icon-disc"><NativeIcon name="calendar" size={13} /></span><span>Total Sessions</span></header><strong>{loadingSessions ? '…' : activity.totalSessions}</strong><small>All time</small></div><div className="native-summary-orange"><header><span className="native-icon-disc"><NativeIcon name="star.fill" size={13} /></span><span>Favorite Drill</span></header><strong>{loadingSessions ? '…' : activity.favoriteName}</strong><small>{loadingSessions ? 'Loading…' : activity.favoriteReps ? `${activity.favoriteReps} reps completed` : 'No sessions yet'}</small></div></section>
    <Link className="native-standings-link" to={{ pathname: '/athlete', search: leaderboardParams.toString() }}><NativeIcon name="trophy.fill" size={18} /><span>View your team standings</span><NativeIcon name="chevron.right" size={13} /></Link>
    <TechniqueAnalysis playerId={ctx.playerId!} reps={ctx.allStatsReps()} preview={ctx.access === 'preview'} onReplay={onDrills} />
  </section>;
}
