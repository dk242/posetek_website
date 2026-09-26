/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { AXES } from '../../../components/athlete-stats/profile';
import { hoursLine, planProgress, trainingTotals } from '../lib/logic';
import type { AthleteSummary } from '../lib/logic';
import type { AthleteLoad } from '../lib/workspace';
import { coachFollowUps } from '../lib/followUps';
import { OVERVIEW_DAYS } from '../lib/data';
import { toDate } from '../../athlete-portal/lib/training';

interface OverviewProps {
  orgLabel: string;
  summaries: AthleteSummary[];
  players: any[];
  loads: Record<string, AthleteLoad>;
  limited?: boolean;
  preview?: boolean;
  onSelect: (id: string) => void;
  onRetry: (id: string) => void;
  onPrescribe: (ids: string[]) => void;
}
export const playerName = (player: any) => `${player.firstName || ''} ${player.lastName || ''}`.trim() || 'Player';

export default function Overview({ orgLabel, summaries, players, loads, limited, preview, onSelect, onRetry, onPrescribe }: OverviewProps) {
  const [tab, setTab] = useState<'training' | 'performance'>('training');
  const [search, setSearch] = useState('');
  const complete = summaries.length === players.length && !limited;
  const recentComplete = complete && summaries.every(summary => summary.coverage !== 'recent-truncated');
  const plans = summaries.filter(summary => summary.plan).length;
  const windowStart = new Date(Date.now() - OVERVIEW_DAYS * 86400000);
  const recentTotals = (row: AthleteSummary) => trainingTotals(row.logs.filter(log => {
    const ended = toDate(log?.endedAt);
    return ended && ended >= windowStart && ended <= new Date();
  }), []);
  const completed = summaries.reduce((sum, row) => sum + recentTotals(row).workoutsCompleted, 0);
  const timer = summaries.reduce((sum, row) => sum + recentTotals(row).timerSeconds, 0);
  const estimate = summaries.reduce((sum, row) => sum + recentTotals(row).estimatedSeconds, 0);
  const unavailable = players.length - summaries.length;
  const followUps = coachFollowUps(summaries);
  const visible = players.filter(player => playerName(player).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  return <>
    <section className="coachdash-heading"><div><p className="eyebrow">{orgLabel}</p><h1>Team training</h1>
      <p className="coachdash-sub">A shared view of each player's program and recorded progress.</p></div>
      <button className="primary-cta" type="button" disabled={preview || !complete || !players.length} onClick={() => onPrescribe(summaries.map(row => row.athlete.id))}>Prescribe team plans</button>
    </section>
    <section className="coachdash-tiles" aria-label="Team totals">
      <article className="stat-tile"><p className="stat-label">Players</p><p className="stat-value">{players.length}{limited ? '+' : ''}</p></article>
      <article className="stat-tile"><p className="stat-label">Active programs</p><p className="stat-value">{complete ? plans : '—'}</p></article>
      <article className="stat-tile"><p className="stat-label">Completed workouts · 30 days</p><p className="stat-value">{recentComplete ? completed : '—'}</p></article>
      <article className="stat-tile"><p className="stat-label">Recorded timer time · 30 days</p><p className="stat-value">{recentComplete ? hoursLine(timer) : '—'}</p><p className="coachdash-sub">{recentComplete ? `${hoursLine(estimate)} elapsed estimates, reported separately` : 'Recent totals await complete coverage'}</p></article>
    </section>
    {!recentComplete && <p className="coachdash-notice" role="status">{unavailable > 0 ? `${unavailable} ${unavailable === 1 ? 'player overview is' : 'player overviews are'} still loading or unavailable. ` : ''}{summaries.some(row => row.coverage === 'recent-truncated') ? 'Some players exceeded the 50-log overview limit. ' : ''}Team totals stay hidden until coverage is complete.</p>}
    <section className="coachdash-followups" aria-label="Coach follow-ups">
      <h2>Follow-ups</h2>
      <p className="coachdash-sub">Assigned team · recorded endings in the last 30 days, plus current plan status · {windowStart.toLocaleDateString()}–{new Date().toLocaleDateString()}</p>
      {followUps.length ? <ul>{followUps.slice(0, 12).map((item, index) => <li key={`${item.playerId}-${item.kind}-${item.endedAt}-${index}`}>
        <button className="quiet-button" type="button" onClick={() => onSelect(item.playerId)}>{item.playerName}</button>
        <strong>{item.title}</strong><span>{item.detail}</span>
        {item.endedAt && <time dateTime={new Date(item.endedAt).toISOString()}>{new Date(item.endedAt).toLocaleDateString()}</time>}
      </li>)}</ul> : <p>{complete ? 'No follow-ups found in the checked data.' : 'Follow-ups appear as player overviews finish loading.'}</p>}
      {followUps.length > 12 && <p className="coachdash-sub">{followUps.length - 12} more follow-ups. Open a player from the roster to review details.</p>}
      {!complete && <p className="coachdash-sub">Coverage is incomplete. More follow-ups may appear after loading or retrying unavailable players.</p>}
      {summaries.some(row => row.coverage === 'recent-truncated') && <p className="coachdash-sub">Some recent logs exceed the overview limit; open that player's history for the full record.</p>}
    </section>
    <div className="coachdash-list-tools"><div className="segmented-control coachdash-tabs" aria-label="Team view">
      <button type="button" aria-pressed={tab === 'training'} className={tab === 'training' ? 'active' : ''} onClick={() => setTab('training')}>Training</button>
      <button type="button" aria-pressed={tab === 'performance'} className={tab === 'performance' ? 'active' : ''} onClick={() => setTab('performance')}>Testing</button>
    </div><label className="coachdash-search">Find a player<input type="search" value={search} placeholder="Search your team…" onChange={event => setSearch(event.target.value)} /></label></div>
    {players.length === 0 ? <section className="empty-card"><h2>No players on this team yet</h2><p>Your organization manager can assign existing players. Use Roster to review team setup.</p></section>
      : visible.length === 0 ? <p className="empty-card">No players match this search.</p>
      : <div className="coachdash-player-list">{visible.map(player => {
        const summary = summaries.find(row => row.athlete.id === player.id), state = loads[player.id];
        return <article className="coachdash-player-card" key={player.id}>
          <header><div><button className="coachdash-player-name" type="button" onClick={() => onSelect(player.id)}>{playerName(player)}<span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span></button>
            {player.registered === false && <span className="coachdash-sub">Signup pending</span>}</div>
            {summary && <span className={`plan-chip ${summary.plan ? 'on' : 'off'}`}>{summary.plan ? 'Active program' : 'No active program'}</span>}</header>
          {!summary ? <div className="coachdash-unavailable"><p role="status">{state?.kind === 'error' ? state.message : 'Loading player history…'}</p>
            <button className="quiet-button" type="button" disabled={state?.kind === 'loading'} onClick={() => onRetry(player.id)}>Retry {player.firstName || 'player'}</button></div>
            : <>{tab === 'training' ? <dl className="coachdash-player-metrics">
              <div><dt>Program</dt><dd>{planProgress(summary.plan)}</dd></div>
              <div><dt>Completed / started · 30 days</dt><dd>{summary.coverage === 'recent-truncated' ? '50+ logs; open history' : `${recentTotals(summary).workoutsCompleted} / ${recentTotals(summary).workoutsStarted}`}</dd></div>
              <div><dt>Timer time · 30 days</dt><dd>{summary.coverage === 'recent-truncated' ? 'Incomplete' : hoursLine(recentTotals(summary).timerSeconds)}</dd></div>
              <div><dt>Elapsed estimate · 30 days</dt><dd>{summary.coverage === 'recent-truncated' ? 'Incomplete' : hoursLine(recentTotals(summary).estimatedSeconds)}</dd></div>
            </dl> : <dl className="coachdash-player-metrics testing">{AXES.map(axis => {
              const value = summary.profile.axes.find(entry => entry.key === axis.key);
              return <div key={axis.key}><dt>{axis.label}</dt><dd>{summary.coverage !== 'all' ? 'Open player for results' : value?.score == null ? 'Not measured' : Math.round(value.score)}</dd></div>;
            })}</dl>}
            <footer><p className="coachdash-sub">{summary.coverage === 'all' ? 'Open player for all recorded history' : 'Overview uses the most recent 30 days of ended workout logs; other activity is not assessed here.'}</p>
              <div className="coachdash-row-actions"><button className="quiet-button" type="button" onClick={() => onSelect(player.id)}>View progress</button>
                <button className="quiet-button" type="button" disabled={preview} onClick={() => onPrescribe([player.id])}>Prescribe / review</button></div></footer>
          </>}
        </article>;
      })}</div>}
    <p className="coachdash-sub">The overview counts recorded workout endings in the last 30 days. It does not label players inactive from missing telemetry. Open a player for complete history and testing. Team Insights provides other date filters.</p>
  </>;
}
