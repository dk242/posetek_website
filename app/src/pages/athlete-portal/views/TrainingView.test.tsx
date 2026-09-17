import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
vi.mock("../../../lib/firebase", () => ({ default: {}, db: {}, auth: {} }));
vi.mock("./StaffTrainingView", () => ({ default: ({ playerId }: { playerId: string }) => <p data-staff-player={playerId}>Read-only training</p> }));
vi.mock("../../admin/views/PersonalizedPrograms", () => ({ default: ({ role }: { role: string }) => <p data-planner-role={role}>Planner</p> }));
vi.mock("../lib/loaders", () => ({ submitLlmJob: vi.fn(), waitForJob: vi.fn() }));
vi.mock("../lib/workout-store", () => ({ useWorkoutStore: () => ({ logs: {} }) }));
import TrainingView from "./TrainingView";
import type { PortalContext } from "./shared";

const context = (access: PortalContext["access"]): PortalContext => ({ access, playerId: "athlete", athlete: { organizationId: "club", teamId: "team" }, notify: () => {}, allStatsReps: () => [] });
describe("training planner entry roles", () => {
  it.each(["coach", "manager"] as const)("routes %s to staff planning with its athlete and team selection", access => {
    const html = renderToStaticMarkup(<MemoryRouter><TrainingView ctx={context(access)} /></MemoryRouter>);
    expect(html).toContain('href="/programs?players=athlete&amp;orgId=club&amp;teamId=team"');
    expect(html).toContain('data-staff-player="athlete"');
    expect(html).not.toContain('data-planner-role="athlete"');
    expect(html).not.toContain("Create workout");
  });
  it("routes admins through the admin planner", () => {
    const html = renderToStaticMarkup(<MemoryRouter><TrainingView ctx={context("admin")} /></MemoryRouter>);
    expect(html).toContain('href="/admin/programs?players=athlete&amp;orgId=club&amp;teamId=team"');
  });
  it("does not add staff planner links to athlete or shared access", () => {
    for (const access of ["athlete", "shared"] as const) {
      const html = renderToStaticMarkup(<MemoryRouter><TrainingView ctx={context(access)} /></MemoryRouter>);
      expect(html).not.toContain("Open personalized planner");
      expect(html).not.toContain("data-staff-player");
    }
  });
});
