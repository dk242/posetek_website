import { useId } from "react";
import { resolveTeam, sampleTeams } from "./coach-samples";
import "./coaches-examples.css";

export function ClubExplorer({ teamId, onTeamChange }: { teamId: string; onTeamChange: (teamId: string) => void }) {
  const team = resolveTeam(teamId);
  const panelId = useId();
  return (
    <div className="cx-club" aria-label="Illustrative club workspace">
      <div className="cx-workspace-top"><span className="cx-club-crest" aria-hidden="true">N<span>FC</span></span><div><span className="cx-overline">Club overview</span><h3>Northfield FC</h3></div><span className="cx-example-label">Illustrative example</span></div>
      <div className="cx-team-options" role="group" aria-label="Choose a sample team">
        {sampleTeams.map(item => <button type="button" key={item.id} aria-pressed={team.id === item.id} aria-controls={panelId} onClick={() => onTeamChange(item.id)}><span>{item.name}</span><span className="cx-team-option-detail">{item.coach}<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.5" /></svg></span></button>)}
      </div>
      <div id={panelId} className="cx-team-panel">
        <div className="cx-team-context" aria-live="polite"><span className="cx-overline">Assigned coach</span><h4>{team.coach}</h4><p>{team.name} team</p><span className="cx-access-note"><svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="M10 2 3.5 4.5V10c0 4 6.5 7.5 6.5 7.5s6.5-3.5 6.5-7.5V4.5L10 2Z" stroke="currentColor" /><path d="m6.5 9.5 2.5 2.5 4.5-5" stroke="currentColor" /></svg>Coach access follows team assignment.</span></div>
        <div className="cx-roster"><div className="cx-roster-heading"><span>Player</span><span>Current focus</span></div>{team.players.map(player => <div className="cx-roster-row" key={player.id}><span className="cx-shirt-number" aria-hidden="true">{String(player.number).padStart(2, "0")}</span><div><strong>{player.name}</strong><span>{player.position}</span></div><span className="cx-focus-tag">{player.drillId === "DRB-006" ? "Close control" : "First touch"}</span></div>)}</div>
      </div>
      <div className="cx-workspace-foot"><span className="cx-small-dot" aria-hidden="true" /><p>Managers see the club. Coaches work with their assigned teams.</p><span>3 sample players shown</span></div>
    </div>
  );
}
