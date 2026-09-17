import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClubExplorer } from "./ClubExplorer";
import { PlayerEvidence } from "./PlayerEvidence";
import { profileAreas, resolvePlayer, resolveTeam, sampleTeams } from "./coach-samples";

describe("coaches illustrative data", () => {
  it("keeps nine unique players in three distinct team contexts with usable profile and session values", () => {
    expect(sampleTeams.map(team => team.name)).toEqual(["U13", "U15", "U17"]);
    const allPlayers = sampleTeams.flatMap(team => team.players);
    expect(new Set(allPlayers.map(player => player.id)).size).toBe(9);
    for (const team of sampleTeams) {
      expect(team.players).toHaveLength(3);
      for (const player of team.players) {
        expect(player.scores).toHaveLength(profileAreas.length);
        expect(player.scores.every(score => score >= 0 && score <= 100)).toBe(true);
        expect(player.latestDribbleSeconds).toBeGreaterThan(0);
        expect(player.priorDribbleSeconds).toBeGreaterThan(player.latestDribbleSeconds);
        expect(["DRB-006", "PAS-001"]).toContain(player.drillId);
        expect(player.completedSessions).toBeLessThanOrEqual(player.plannedSessions);
      }
    }
  });
  it("resolves stale player selection within the new team instead of showing another team's player", () => {
    expect(resolvePlayer("u17", "u13-alex")).toBe(sampleTeams[2].players[0]);
    expect(resolvePlayer("u15", "u15-casey")).toBe(sampleTeams[1].players[2]);
    expect(resolveTeam("unknown")).toBe(sampleTeams[0]);
    expect(resolvePlayer("unknown", "unknown")).toBe(sampleTeams[0].players[0]);
  });
});

describe("coaches sample views", () => {
  it.each(sampleTeams)("shows only the selected $name roster and explains role boundaries", team => {
    const html = renderToStaticMarkup(<ClubExplorer teamId={team.id} onTeamChange={() => undefined} />);
    expect(html).toContain("Northfield FC");
    expect(html).toContain("Illustrative example");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    for (const player of team.players) expect(html).toContain(player.name);
    for (const otherTeam of sampleTeams.filter(item => item.id !== team.id)) {
      for (const player of otherTeam.players) expect(html).not.toContain(player.name);
    }
    expect(html).toContain("Managers see the club. Coaches work with their assigned teams.");
  });
  it.each(sampleTeams.flatMap(team => team.players.map(player => ({ team, player }))))("keeps $player.name's evidence and next step aligned", ({ team, player }) => {
    const html = renderToStaticMarkup(<PlayerEvidence teamId={team.id} playerId={player.id} onPlayerChange={() => undefined} />);
    expect(html).toContain(player.latestDribbleSeconds.toFixed(2));
    expect(html).toContain(player.focus);
    expect(html).toContain(player.drillId === "DRB-006" ? "Figure-8 dribble" : "Wall pass rhythm");
    expect(html).toContain('role="img"');
    expect(html).toContain("Illustrative example");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    for (const [index, area] of profileAreas.entries()) expect(html).toContain(`${area}: ${player.scores[index]} out of 100`);
    for (const otherPlayer of team.players.filter(item => item.id !== player.id)) expect(html).not.toContain(otherPlayer.focus);
  });
});
