import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AdminBreadcrumbs from "./AdminBreadcrumbs";

describe("admin account breadcrumbs", () => {
  it("maps a deep rep route back through the scoped player results hierarchy", () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/admin/accounts/player/player-1/results/change-of-direction/rep-9?orgId=club&teamId=u15"]}><AdminBreadcrumbs /></MemoryRouter>);
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('href="/admin/accounts?orgId=club&amp;teamId=u15"');
    expect(html).toContain('href="/admin/accounts/player/player-1/results/change-of-direction?orgId=club&amp;teamId=u15"');
    expect(html).toContain("change of direction");
    expect(html).toContain('aria-current="page">Rep');
  });

  it("stays absent outside player detail routes", () => {
    expect(renderToStaticMarkup(<MemoryRouter initialEntries={["/admin/drills"]}><AdminBreadcrumbs /></MemoryRouter>)).toBe("");
  });
});
