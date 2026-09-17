import { useMemo, useState } from "react";
import { MetricTrendChart, WeeklyRepsChart } from "./InsightsCharts";
import {
  drillLabel,
  formatMetric,
  lastActiveText,
  metricLabel,
  metricUnit,
  metricValue,
  sortPlayers,
  teamSummary,
  teamWeeklyReps,
  totalReps,
  trendOf,
  weekLabel,
} from "./lib/insights";
import type { ClubInsights, InsightMetric, InsightPlayer } from "./lib/insights";

function TrendBadge({ metric }: { metric: InsightMetric }) {
  const trend = trendOf(metric);
  if (!trend) return null;
  const direction = trend.improved === null ? "flat" : trend.improved ? "up" : "down";
  const text = trend.improved === null ? "No change yet" : trend.improved ? "Improving" : "Declining";
  return <span className={`insights-trend ${direction}`}>
    <span aria-hidden="true">{direction === "up" ? "▲" : direction === "down" ? "▼" : "•"}</span>
    {formatMetric(metric.field, trend.first)} → {formatMetric(metric.field, trend.last)} <em>{text}</em>
  </span>;
}

function MetricPanel({ metric, labels }: { metric: InsightMetric; labels: string[] }) {
  const values = useMemo(() => metric.weeklyBest.map(value => value === null ? null : metricValue(metric.field, value)), [metric]);
  return <figure className="insights-metric">
    <figcaption><strong>{metricLabel(metric)}</strong><TrendBadge metric={metric} /></figcaption>
    <MetricTrendChart label={metricLabel(metric)} unit={metricUnit(metric.field)} labels={labels} values={values} />
  </figure>;
}

function PlayerDetail({ player, labels }: { player: InsightPlayer; labels: string[] }) {
  const drills = Object.entries(player.drillCounts).sort((a, b) => b[1] - a[1]);
  return <div className="insights-detail">
    <div className="insights-drills">{drills.length ? drills.map(([drill, count]) => <span key={drill}>{drillLabel(drill)} <strong>{count}</strong> documents</span>) : <span>No dated recording documents in this window.</span>}</div>
    {player.repsTruncated && <p className="insights-note" role="status">Partial history: this player’s counts, weekly bests and latest recording reflect only {player.recordedDocumentsRead ?? "the inspected"} documents. The latest records may be outside this sample.</p>}
    {player.undatedReps > 0 && <p className="insights-note">{player.undatedReps} recording documents have no usable date and are not counted in the weekly figures.</p>}
    {!!player.futureDatedReps && <p className="insights-note">{player.futureDatedReps} future-dated recording documents are excluded from activity, latest-recording dates and metric trends.</p>}
    <div className="insights-metric-grid">{player.metrics.map(metric => <MetricPanel key={`${metric.drill}:${metric.field}`} metric={metric} labels={labels} />)}</div>
    {!player.metrics.length && drills.length > 0 && <p className="insights-note">No usable progress metrics in these recording documents.</p>}
  </div>;
}

export default function InsightsReport({ insights, initialOpenPlayer = "", playerLink }: { insights: ClubInsights; initialOpenPlayer?: string; playerLink?: (id: string) => string }) {
  const [sort, setSort] = useState<"name" | "reps" | "lastActive">("reps");
  const [openPlayer, setOpenPlayer] = useState(initialOpenPlayer);
  const labels = useMemo(() => insights.weeks.map(weekLabel), [insights]);
  const weekly = useMemo(() => teamWeeklyReps(insights), [insights]);
  const summary = teamSummary(insights);
  const players = sortPlayers(insights.players, sort);
  const selected = insights.players.find(player => player.id === openPlayer);

  return <>
    {insights.historyTruncated && <p className="insights-note" role="status">Partial history: some players reached the {insights.repLimitPerPlayer ?? "recording"}-document read limit. Counts, weekly bests, undated totals and latest-recording dates reflect only inspected documents, not complete or necessarily recent history.</p>}
    <section className="insights-tiles" aria-label="Team summary">
      <div className="insights-tile"><span>Players</span><strong>{summary.players}</strong></div>
      <div className="insights-tile"><span>Players recording this week</span><strong>{summary.activeThisWeek}</strong><em>of {summary.players}</em></div>
      <div className="insights-tile"><span>Recording documents this week</span><strong>{summary.repsThisWeek}</strong></div>
      <div className="insights-tile"><span>No recordings in {insights.weeks.length} weeks</span><strong>{summary.inactiveInWindow}</strong></div>
    </section>

    <section className="insights-card">
      <div className="insights-section-title"><h2>Recording documents per week</h2><span>{summary.repsInWindow} total</span></div>
      <WeeklyRepsChart labels={labels} values={weekly} />
    </section>

    <section className="insights-card">
      <div className="insights-section-title"><h2>Players</h2>
        <label className="insights-sort">Sort<select value={sort} onChange={event => setSort(event.target.value as typeof sort)}><option value="reps">Most recording documents</option><option value="lastActive">Most recent</option><option value="name">Name</option></select></label>
      </div>
      {players.length ? <div className="insights-table-wrap"><table className="insights-table">
        <thead><tr><th scope="col">Player</th><th scope="col">Latest recording (UTC)</th><th scope="col">Documents</th>{labels.map((label, index) => <th scope="col" key={insights.weeks[index]} className="week">{label}</th>)}</tr></thead>
        <tbody>{players.map(player => {
          const open = openPlayer === player.id;
          return <tr key={player.id} className={open ? "open" : undefined}>
            <th scope="row"><button type="button" aria-expanded={open} aria-controls="insights-player-detail" onClick={() => setOpenPlayer(open ? "" : player.id)}>{player.firstName} {player.lastName}</button></th>
            <td>{lastActiveText(player.lastActiveMillis, insights.generatedAtMillis)}</td>
            <td>{totalReps(player)}</td>
            {player.weeklyReps.map((count, index) => <td key={insights.weeks[index]} className={`week${count ? " active" : ""}`}>{count || "·"}</td>)}
          </tr>;
        })}</tbody>
      </table></div> : <p>No players are assigned to this team.</p>}
    </section>
    {selected && <section className="insights-card" id="insights-player-detail" aria-live="polite">
      <div className="insights-section-title"><h2>{selected.firstName} {selected.lastName}</h2><button type="button" className="quiet-button" onClick={() => setOpenPlayer("")}>Close</button></div>
      {playerLink && <a className="quiet-button" href={playerLink(selected.id)}>Open player results</a>}
      <PlayerDetail player={selected} labels={labels} />
    </section>}
    {insights.rosterTruncated && <p className="insights-note" role="status">Only the first {insights.players.length} players on this team are shown.</p>}
    <p className="insights-note">Counts are recording documents, including failed or duplicate outputs; they are not successful-test totals or app visits. Historical records follow the current player profile, including pre-transfer history. Metric trends use available positive primary results and exclude explicitly invalid or incomplete processing. Recording dates and weeks use UTC; weeks start Monday. Updated {new Date(insights.generatedAtMillis).toLocaleString()}.</p>
  </>;
}
