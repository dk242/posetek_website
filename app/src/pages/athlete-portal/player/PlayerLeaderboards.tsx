import { useEffect, useState } from 'react';
import { cloud } from '../../../lib/firebase';
import { fullName } from '../lib/metrics';
import { rankRows, boardSummary } from '../lib/mobile';
import { playerProfile, drillKey } from './scoring';
import type { Row } from './execution';

export const PLAYER_BOARDS = [
  { key: 'overall', label: 'Overall', metric: '', lower: false, factor: 1, unit: '' },
  { key: 'changeOfDirection', label: 'Agility', metric: 'totalTime', lower: true, factor: 1, unit: 's' },
  { key: 'sprint', label: 'Sprint', metric: 'totalTime', lower: true, factor: 1, unit: 's' },
  { key: 'jump', label: 'Jump', metric: 'jumpHeight', lower: false, factor: 39.3701, unit: 'in' },
  { key: 'shooting', label: 'Shooting', metric: 'velocity', lower: false, factor: 2.23694, unit: 'mph' },
  { key: 'dribbling', label: 'Dribbling', metric: 'totalTime', lower: true, factor: 1, unit: 's' },
];
export function playerStandings(players: Row[], key: string, dataset?: Row) {
  const category = PLAYER_BOARDS.find(b => b.key === key)!;
  return rankRows(players.flatMap(p => {
    let value: number | null;
    if (key === 'overall') value = playerProfile(p.reps || [], {}, dataset).overall;
    else {
      const values = (p.reps || []).filter((r: Row) => drillKey(r) === key).map((r: Row) => Number(r[category.metric])).filter((n: number) => Number.isFinite(n) && n > 0);
      value = values.length ? (category.lower ? Math.min(...values) : Math.max(...values)) * category.factor : null;
    }
    return value === null ? [] : [{ id: p.id, name: fullName(p), value }];
  }), category.lower);
}

export default function PlayerLeaderboards({ playerId, preview, reps, athlete, dataset }: { playerId: string; preview: boolean; reps: Row[]; athlete: Row; dataset: Row }) {
  const [players, setPlayers] = useState<Row[] | null>(preview ? [athlete, { id: 'preview-peer-a', firstName: 'Alex', lastName: 'Rivera' }, { id: 'preview-peer-b', firstName: 'Sam', lastName: 'Lee' }].map((p, i) => ({ ...p, id: i === 0 ? playerId : p.id, reps: reps.map(r => ({ ...r, totalTime: r.totalTime ? r.totalTime * (1 + i * .07) : undefined, velocity: r.velocity ? r.velocity * (1 - i * .04) : undefined })) })) : null);
  const [selected, setSelected] = useState('overall'), [error, setError] = useState(''), [all, setAll] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (preview) return;
    let active = true; setError('');
    cloud.httpsCallable('getTeamLeaderboard')({}).then(r => { if (active) setPlayers((r.data as Row).athletes || []); }).catch(e => { if (active) setError(e.message || 'Standings are unavailable.'); });
    return () => { active = false; };
  }, [playerId, preview, retry]);
  const board = PLAYER_BOARDS.find(b => b.key === selected)!, rows = playerStandings(players || [], selected, dataset);
  const { athlete: own, percentile } = boardSummary(rows, board.lower, playerId);
  const format = (n: number) => `${n.toFixed(selected === 'overall' ? 0 : board.unit === 's' ? 2 : 1)} ${board.unit}`;
  const mean = rows.length ? rows.reduce((s, r) => s + r.value, 0) / rows.length : 0;
  const sd = rows.length ? Math.sqrt(rows.reduce((s, r) => s + (r.value - mean) ** 2, 0) / rows.length) : 0;
  const ownX = own && sd > 0 ? 180 + Math.max(-3, Math.min(3, (own.value - mean) / sd * (board.lower ? -1 : 1))) * 48 : 180;
  return <section className="player-leaderboards"><p className="eyebrow">Your team</p><h1>Leaderboards</h1><nav className="player-week-rail" aria-label="Leaderboard categories">{PLAYER_BOARDS.map(b => <button key={b.key} aria-pressed={selected === b.key} onClick={() => { setSelected(b.key); setAll(false); }}>{b.label}</button>)}</nav>
    {error ? <section className="portal-card"><p role="alert">{error}</p><button onClick={() => setRetry(v => v + 1)}>Try again</button></section> : players === null ? <p>Loading your team…</p> : !rows.length ? <section className="portal-card"><h2>No standings yet</h2><p>{players.length ? 'Your team needs a recorded result in this category.' : 'Join a team to compare your progress.'}</p></section> : <>
      <div className="player-podium">{rows.slice(0, 3).map(r => <article key={r.id} className={r.id === playerId ? 'you' : ''}><span>#{r.rank}</span><strong>{r.name}</strong><b>{format(r.value)}</b></article>)}</div>
      <section className="portal-card"><h2>Your place</h2><p>{own ? `#${own.rank} of ${rows.length} · ${format(own.value)}` : 'Record a result to join this board.'}</p><p>{percentile === null ? 'More teammates are needed for a percentile.' : `${percentile}th team percentile`}</p>
        {sd > 0 && rows.length > 1 && <svg viewBox="0 0 360 125" role="img" aria-label="Team distribution, your position highlighted"><path d={Array.from({ length: 61 }, (_, i) => { const z = -3 + i / 10; return `${i ? 'L' : 'M'}${180 + z * 48},${110 - Math.exp(-z * z / 2) * 88}`; }).join(' ')} fill="none" stroke="#b7f34a" strokeWidth="2" />{own && <><line x1={ownX} x2={ownX} y1="10" y2="113" stroke="white" strokeDasharray="3 3" /><text x={ownX} y="10" fill="white" textAnchor="middle" fontSize="10">You</text></>}</svg>}
      </section><section className="portal-card"><button className="player-list-button" onClick={() => setAll(v => !v)}>{all ? 'Close standings' : `All ${rows.length} athletes`}<span>⌄</span></button>{all && rows.map(r => <div className="player-standing" key={r.id}><span>#{r.rank}</span><strong>{r.name}{r.id === playerId ? ' · You' : ''}</strong><b>{format(r.value)}</b></div>)}</section>
      {selected === 'overall' && <p className="muted-copy">Overall uses the same scoring rules as Profile. Team projections use the common senior reference because teammate age and gender are private.</p>}
    </>}
  </section>;
}
