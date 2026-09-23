import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InsightsControls } from "./InsightsPage";
import { expandedRequest } from "./lib/expandedQuery";
import { previewInsights } from "./lib/preview";

describe("Insights controls", () => {
  it("uses period segments, a custom-date disclosure and a labelled refresh action", () => {
    const request = expandedRequest("weeks=8", new Date("2026-09-17T04:00:00Z"));
    const data = previewInsights(request);
    const html = renderToStaticMarkup(<InsightsControls choices={data.choices} request={request} scope={data.scope} loading={false} onChange={() => {}} onRefresh={() => {}} />);
    for (const period of ["4w", "8w", "12w", "26w"]) expect(html).toContain(`>${period}</button>`);
    expect(html).toContain('aria-pressed="true">8w');
    expect(html).toContain("<summary>Custom</summary>");
    expect(html).toContain('aria-label="Refresh Insights"');
    expect(html).toContain("Timezone");
  });

  it("lets the embedded admin shell own organization and team scope", () => {
    const request = expandedRequest("", new Date("2026-09-17T04:00:00Z"));
    const data = previewInsights(request);
    const html = renderToStaticMarkup(<InsightsControls choices={data.choices} request={request} scope={data.scope} loading={false} hideScope onChange={() => {}} onRefresh={() => {}} />);
    expect(html).not.toContain(">Organization<select");
    expect(html).not.toContain(">Team<select");
    expect(html).toContain("Timezone");
  });
});
