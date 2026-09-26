/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { AXES } from '../../../components/athlete-stats/profile';
import { hoursLine, lastActiveLine, planProgress } from '../lib/logic';
import type { AthleteSummary } from '../lib/logic';
import type { AthleteLoad } from '../lib/workspace';

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
  const plans = summaries.filter(summary => summary.plan).length;
  const completed = summaries.reduce((sum, row) => sum + row.totals.workoutsCompleted, 0);
  const timer = summaries.reduce((sum, row) => sum + row.totals.timerSeconds, 0);
  const estimate = summaries.reduce((sum, row) => sum + row.totals.estimatedSeconds, 0);
  const unavailable = players.length - summaries.length;
  const visible = players.filter(player => playerName(player).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  return <>
    <section className="coachdash-heading"><div><p className="eyebrow">{orgLabel}</p><h1>Team training</h1>
      <p className="coachdash-sub">A shared view of each player's program and recorded progress.</p></div>
      <button className="primary-cta" type="button" disabled={preview || !complete || !players.length} onClick={() => onPrescribe(summaries.map(row => row.athlete.id))}>Prescribe team plans</button>
    </section>
    <section className="coachdash-tiles" aria-label="Team totals">
      <article className="stat-tile"><p className="stat-label">Players</p><p className="stat-value">{players.length}{limited ? '+' : ''}</p></article>
      <article className="stat-tile"><p className="stat-label">Active programs</p><p className="stat-value">{complete ? plans : '—'}</p></article>
      <article className="stat-tile"><p className="stat-label">Completed workouts</p><p className="stat-value">{complete ? completed : '—'}</p></article>
      <article className="stat-tile"><p className="stat-label">Recorded timer time</p><p className="stat-value">{complete ? hoursLine(timer) : '—'}</p><p className="coachdash-sub">{complete ? `${hoursLine(estimate)} elapsed estimates, reported separately` : 'Totals await complete player history'}</p></article>
    </section>
    {unavailable > 0 && <p className="coachdash-notice" role="status">{unavailable} {unavailable === 1 ? 'player history is' : 'player histories are'} unavailable. Team totals stay hidden until every player loads.</p>}
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
              <div><dt>Completed / started</dt><dd>{summary.totals.workoutsCompleted} / {summary.totals.workoutsStarted}</dd></div>
              <div><dt>Timer time</dt><dd>{hoursLine(summary.totals.timerSeconds)}</dd></div>
              <div><dt>Elapsed estimate</dt><dd>{hoursLine(summary.totals.estimatedSeconds)}</dd></div>
            </dl> : <dl className="coachdash-player-metrics testing">{AXES.map(axis => {
              const value = summary.profile.axes.find(entry => entry.key === axis.key);
              return <div key={axis.key}><dt>{axis.label}</dt><dd>{value?.score == null ? 'Not measured' : Math.round(value.score)}</dd></div>;
            })}</dl>}
            <footer><p className="coachdash-sub">Last recorded activity · {lastActiveLine(summary.totals.lastActiveMillis)}{summary.totals.unknownDuration ? ` · ${summary.totals.unknownDuration} workout duration unknown` : ''}</p>
              <div className="coachdash-row-actions"><button className="quiet-button" type="button" onClick={() => onSelect(player.id)}>View progress</button>
                <button className="quiet-button" type="button" disabled={preview} onClick={() => onPrescribe([player.id])}>Prescribe / review</button></div></footer>
          </>}
        </article>;
      })}</div>}
    <p className="coachdash-sub">All recorded history. Completion reflects the player's workout log; it does not confirm every set was done. Team Insights provides date filters and complete reporting.</p>
  </>;
}
