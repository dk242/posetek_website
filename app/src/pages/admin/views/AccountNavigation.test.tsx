import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
vi.mock("../../../lib/firebase", () => ({ default: {}, auth: {}, db: {} }));
vi.mock("../../../lib/organization-data", () => ({ getClubContext: vi.fn() }));
import PlayerRosterRow from "./PlayerRosterRow";
import { TeamRoster } from "./MonitorAccounts";
import type { PlayerRow } from "../lib/accounts";
import type { HierarchyTeam } from "../lib/accountHierarchy";
const player: PlayerRow = { id: "athlete", name: "Example Athlete", email: "player@example.test", coachId: null, organizationId: "club", teamId: "team", registered: false, signupCode: "SAMPLE-CODE", raw: { organizationId: "club", teamId: "team" } };

describe("account navigation rendering", () => {
  it("preserves organization, team and coach context in profile and results links and keeps signup controls", () => {
    const html = renderToStaticMarkup(<MemoryRouter><PlayerRosterRow player={player} context={{ orgId: "club", teamId: "team", coachId: "coach" }} /></MemoryRouter>);
    expect(html).toContain('href="/admin/accounts/player/athlete?orgId=club&amp;teamId=team&amp;coachId=coach"');
    expect(html).toContain('href="/admin/accounts/player/athlete/results?orgId=club&amp;teamId=team&amp;coachId=coach"');
    expect(html).toContain("Checking invitation…");
    expect(html).not.toContain("SAMPLE-CODE");
    expect(html).not.toContain("coachId=coach/results");
  });
  it("opens the named team directly without a synthetic coach link or a projected roster count", () => {
    const row: HierarchyTeam = { team: { id: "team", name: "Girls-Coach Daniel", organizationId: "club", playerIds: ["stale", "wrong"], coachUIDs: ["old"] }, players: [player], coaches: [] };
    const html = renderToStaticMarkup(<MemoryRouter><TeamRoster row={row} selected={{ orgId: "club", teamId: "team" }} choose={() => {}} /></MemoryRouter>);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Girls-Coach Daniel");
    expect(html).toContain("1 athlete");
    expect(html).toContain("No linked coach account");
    expect(html).toContain("Example Athlete");
    expect(html).not.toContain("/accounts/coach/");
  });
});
