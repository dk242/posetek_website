import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import AdminHeader from "./AdminHeader";
import AdminHome from "./AdminHome";

describe("combined admin navigation", () => {
  it("preserves existing sections and exposes Team Insights in the compact header", () => {
    const html = renderToStaticMarkup(<MemoryRouter><AdminHeader ready email="admin@example.test" onSignOut={() => {}} /></MemoryRouter>);
    for (const path of ["feeds", "drills", "organizations", "accounts", "programs", "analysis"]) {
      expect(html).toContain(`href="/admin/${path}"`);
    }
    expect((html.match(/class="admin-nav-short"/g) ?? []).length).toBe(6);
    expect(html).toContain('href="/insights?from=accounts"');
    expect(html).toContain('aria-label="Technique review"');
  });
  it("offers one personalized planner and the saved kick review workspace from home", () => {
    const html = renderToStaticMarkup(<MemoryRouter><AdminHome /></MemoryRouter>);
    for (const path of ["programs", "analysis"]) {
      expect(html).toContain(`href="/admin/${path}"`);
    }
    expect((html.match(/href="\/admin\/analysis"/g) ?? []).length).toBe(1);
    expect((html.match(/href="\/admin\/programs"/g) ?? []).length).toBe(1);
    expect(html).not.toContain("programs/personalized");
    expect(html).not.toContain("Generate programs");
    expect(html).toContain('href="/insights?from=accounts"');
    expect(html).toContain("Team Insights");
  });
  it("does not expose ready-only navigation while signed out", () => {
    const html = renderToStaticMarkup(<MemoryRouter><AdminHeader ready={false} onSignOut={() => {}} /></MemoryRouter>);
    expect(html).not.toContain('href="/admin/analysis"');
    expect(html).not.toContain('href="/admin/feeds"');
    expect(html).not.toContain('aria-label="Admin sections"');
    expect(html).not.toContain('href="/insights');
  });
  it("carries the selected canonical organization and team from the admin header to Insights", () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={["/admin/accounts?orgId=club&teamId=team"]}><AdminHeader ready onSignOut={() => {}} /></MemoryRouter>);
    expect(html).toContain('href="/insights?orgId=club&amp;teamId=team&amp;from=accounts"');
  });
});
