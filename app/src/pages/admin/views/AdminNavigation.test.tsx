import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import AdminHeader from "./AdminHeader";
import AdminHome from "./AdminHome";

describe("combined admin navigation", () => {
  it("preserves the refreshed four-section header and technique-review shortcut", () => {
    const html = renderToStaticMarkup(<MemoryRouter><AdminHeader ready email="admin@example.test" onSignOut={() => {}} /></MemoryRouter>);
    for (const path of ["drills", "organizations", "accounts", "programs", "analysis"]) {
      expect(html).toContain(`href="/admin/${path}"`);
    }
    expect((html.match(/class="admin-nav-short"/g) ?? []).length).toBe(4);
    expect(html).toContain('aria-label="Technique review"');
  });
  it("offers both planners and the saved kick review workspace from home", () => {
    const html = renderToStaticMarkup(<MemoryRouter><AdminHome /></MemoryRouter>);
    for (const path of ["programs", "programs/personalized", "analysis"]) {
      expect(html).toContain(`href="/admin/${path}"`);
    }
    expect((html.match(/href="\/admin\/analysis"/g) ?? []).length).toBe(1);
  });
  it("does not expose ready-only navigation while signed out", () => {
    const html = renderToStaticMarkup(<MemoryRouter><AdminHeader ready={false} onSignOut={() => {}} /></MemoryRouter>);
    expect(html).not.toContain('href="/admin/analysis"');
    expect(html).not.toContain('aria-label="Admin sections"');
  });
});
