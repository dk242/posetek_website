import { useState } from "react";
import { createRoot } from "react-dom/client";
import "./src/styles/pose-portal.css";
import "./src/pages/insights/insights.scss";
import InsightsReport from "./src/pages/insights/InsightsReport";
import type { ClubInsights, InsightPlayer } from "./src/pages/insights/lib/insights";

const DAY = 86400000;
const WEEK = 7 * DAY;
const THIS_WEEK = Date.UTC(2026, 8, 14);
const NOW = Date.UTC(2026, 8, 16, 18);

function seeded(seed: number) {
  let state = seed;
  return () => (state = (state * 16807) % 2147483647) / 2147483647;
}

function team(teamId: string, teamName: string, names: string[], seed: number, weekCount: number): ClubInsights {
  const random = seeded(seed);
  const weeks = Array.from({ length: weekCount }, (_, i) => THIS_WEEK - (weekCount - 1 - i) * WEEK);
  const players: InsightPlayer[] = names.map((full, p) => {
    const [firstName, lastName] = full.split(" ");
    const engagement = p === names.length - 1 ? 0 : 1 - p * 0.12;
    const weeklyReps = weeks.map(() => Math.max(0, Math.round((random() * 6 + 1) * engagement - (random() < 0.2 ? 3 : 0))));
    const active = weeklyReps.some(Boolean);
    const series = (base: number, step: number, noise: number, digits: number) =>
      weeklyReps.map((count, i) => count ? Number((base + step * i * (0.6 + random() * 0.8) + (random() - 0.5) * noise).toFixed(digits)) : null);
    const improving = p % 3 !== 2;
    return {
      id: `${teamId}-${p}`, firstName, lastName,
      undatedReps: p === 0 ? 3 : 0,
      lastActiveMillis: active ? Date.UTC(2026, 8, 16) - Math.round(random() * 10) * DAY : null,
      weeklyReps,
      drillCounts: active ? { sprint: Math.round(12 * engagement), dribbling: Math.round(6 * engagement), jump: 4, shooting: p % 2 ? 5 : 0 } : {},
      metrics: active ? [
        { drill: "dribbling", field: "totalTime", lowerIsBetter: true, weeklyBest: series(6.7, improving ? -0.07 : 0.04, 0.15, 2) },
        { drill: "jump", field: "jump_height_m", lowerIsBetter: false, weeklyBest: series(0.38 + p * 0.01, improving ? 0.006 : -0.003, 0.02, 3) },
        { drill: "sprint", field: "max_velocity", lowerIsBetter: false, weeklyBest: series(7.2 + p * 0.1, improving ? 0.08 : -0.03, 0.2, 2) },
        ...(p % 2 ? [{ drill: "shooting", field: "velocity", lowerIsBetter: false, weeklyBest: series(22, 0.3, 1.5, 1) }] : []),
      ] : [],
    };
  });
  return { organizationId: "demo-club", teamId, teamName, generatedAtMillis: NOW, rosterTruncated: false, weeks, players };
}

const TEAMS = [
  { id: "u15", name: "U15 Blue", players: ["Zoe Park", "Ada Stone", "Ben Ruiz", "Mia Chen", "Leo Diaz", "Noah Kim", "Ivy Nash"], seed: 11 },
  { id: "u17", name: "U17 Red", players: ["Sam Cole", "Ava Reed", "Eli Grant", "Lily Moss", "Max Ford"], seed: 29 },
];

function Preview() {
  const [teamId, setTeamId] = useState(TEAMS[0].id);
  const [weeks, setWeeks] = useState(8);
  const selected = TEAMS.find(entry => entry.id === teamId)!;
  const insights = team(selected.id, selected.name, selected.players, selected.seed, weeks);
  return <div className="pt-pose portal-body pt-insights">
    <header className="portal-header">
      <span className="portal-brand"><span className="portal-brand-mark">P</span>POSETEK</span>
      <span className="quiet-button">Sample data preview</span>
    </header>
    <main className="insights-shell">
      <section className="insights-heading">
        <p className="eyebrow">Team insights</p>
        <h1>{insights.teamName}</h1>
        <p>Who is recording, how often, and whether each player’s best results are moving the right way.</p>
      </section>
      <section className="insights-card insights-filters">
        <label>Team<select value={teamId} onChange={event => setTeamId(event.target.value)}>{TEAMS.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
        <label>Period<select value={weeks} onChange={event => setWeeks(Number(event.target.value))}>{[4, 8, 12, 26].map(count => <option key={count} value={count}>Last {count} weeks</option>)}</select></label>
      </section>
      <InsightsReport key={`${teamId}:${weeks}`} insights={insights} />
    </main>
  </div>;
}

createRoot(document.getElementById("root")!).render(<Preview />);
