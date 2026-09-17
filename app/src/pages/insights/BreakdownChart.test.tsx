import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityChart, BreakdownChart } from "./BreakdownChart";

describe("expanded Insights charts", () => {
  it("exposes every donut category as a keyboard-operable filter with count and state", () => {
    const html = renderToStaticMarkup(<BreakdownChart title="Testing coverage" slices={[{ key: "full", label: "Fully tested", value: 10 }, { key: "partial", label: "Partially tested", value: 24 }, { key: "none", label: "No recorded tests", value: 2 }]} selected="full" onSelect={() => {}} />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Clear filter");
    expect(html).toContain("28%");
    expect(html).toContain("24");
    expect(html).toContain("select a category to filter players");
  });
  it("keeps empty denominators explicit", () => {
    const html = renderToStaticMarkup(<BreakdownChart title="Division" slices={[{ key: "unknown", label: "Unknown", value: 0 }]} />);
    expect(html).toContain("No matching players in this scope.");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });
  it("distinguishes uncollected usage from measured zero in the accessible chart table", () => {
    const html = renderToStaticMarkup(<ActivityChart title="Engaged time" labels={["Sep 7", "Sep 14"]} unit="minutes" series={[{ label: "Website", values: [null, 0] }, { label: "iOS app", values: [null, null] }]} />);
    expect(html).toContain("View chart data");
    expect(html).toContain("Not collected</td><td>Not collected");
    expect(html).toContain("<td>0</td><td>Not collected</td>");
    expect(html).not.toContain('class="insights-uncollected"');
  });
});
