import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketingHeader, TEAM_ENQUIRY_HREF } from "./MarketingHeader";

describe("marketing audience navigation", () => {
  it.each(["players", "coaches"] as const)("exposes real routes and one current page for %s", audience => {
    const html = renderToStaticMarkup(<MarketingHeader audience={audience} />);
    expect(html).toContain('role="group" aria-label="Explore PoseTek for"');
    expect(html).toContain(`<a href="/"${audience === "players" ? ' aria-current="page"' : ""}>Players</a>`);
    expect(html).toContain(`<a href="/coaches"${audience === "coaches" ? ' aria-current="page"' : ""}>Coaches</a>`);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("preserves player section and booking destinations", () => {
    const html = renderToStaticMarkup(<MarketingHeader audience="players" />);
    for (const hash of ["tests", "profile", "training", "ai-coach", "technique"]) expect(html).toContain(`href="#${hash}"`);
    expect(html).toContain('href="/bookPerformanceTest.html"');
    expect(html).not.toContain(TEAM_ENQUIRY_HREF);
  });

  it("offers team enquiries and coach sign-in without application imports", () => {
    const html = renderToStaticMarkup(<MarketingHeader audience="coaches" />);
    for (const hash of ["club", "players", "development", "contact"]) expect(html).toContain(`href="#${hash}"`);
    expect(html).toContain(`href="${TEAM_ENQUIRY_HREF}"`);
    expect(html).toContain("Talk about your team");
    expect(html).toContain('href="/signin">Coach sign in');
    expect(html).not.toContain('href="/bookPerformanceTest.html"');
  });

  it("connects the collapsed menu button to its disclosure", () => {
    const html = renderToStaticMarkup(<MarketingHeader audience="coaches" />);
    const controlled = html.match(/aria-controls="([^"]+)"/)?.[1];
    expect(controlled).toBeTruthy();
    expect(html).toContain(`id="${controlled}"`);
    expect(html).toContain('aria-label="Open navigation"');
    expect(html).toContain('aria-expanded="false"');
  });
});
