import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CoachDemo from "./CoachDemo.js";
import { CoachMetricChart } from "./CoachMetricChart";
import { sampleAthlete } from "./product-demo";

describe("sample Coach metric exploration", () => {
  it("exposes the three result cards as labelled buttons with a shared controlled chart", () => {
    const html = renderToStaticMarkup(<CoachDemo onOpenWorkout={() => undefined} />);
    for (const label of ["Dribbling", "Top speed", "Sessions"]) {
      expect(html).toMatch(new RegExp(`<button[^>]+aria-label="${label}"[^>]+aria-pressed="(?:true|false)"[^>]+aria-controls="[^"]+"`));
    }
    expect(html).toContain('data-metric="dribbling"');
    expect(html).toContain("Help me plan 20 minutes");
    expect(html).toContain("Why this recommendation?");
  });
  it.each(sampleAthlete.metrics)("provides a readable $label chart using every existing sample value", metric => {
    const html = renderToStaticMarkup(<CoachMetricChart id="sample-chart" metric={metric} />);
    expect(html).toContain('role="img"');
    expect(html).toContain(`${metric.label} trend`);
    for (const value of metric.values) {
      const formatted = metric.key === "training" ? String(value) : value.toFixed(metric.key === "dribbling" ? 2 : 1);
      expect(html).toContain(`: ${formatted} ${metric.key === "training" ? "sessions" : metric.unit}`);
    }
    expect(html).toContain(`Latest <b>${metric.value}</b> ${metric.unit}`);
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
  it("shows sessions against a fixed zero-to-four target instead of a misleading rescaled trend", () => {
    const html = renderToStaticMarkup(<CoachMetricChart id="sessions-chart" metric={sampleAthlete.metrics[2]} />);
    expect(html).toContain('text-anchor="end">0</text>');
    expect(html).toContain('text-anchor="end">4</text>');
    expect(html).toContain("Target: 4 sessions.");
    expect(html).toContain("C1–C4 · Sample checkpoints");
  });
});
