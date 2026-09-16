import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CoachDemo from "./CoachDemo.js";
import WorkoutDemo, { DemoPitch } from "./WorkoutDemo.js";
import { coachWorkoutRequest } from "./product-demo";

describe("recovered demo integration", () => {
  it("opens a ready-made sample with start and customization", () => {
    const html = renderToStaticMarkup(<WorkoutDemo />);
    expect(html).not.toContain("How much time do you have?");
    expect(html).toContain("Figure-8 dribble");
    expect(html).toContain("Interactive demo");
    expect(html).toContain("Sample active plan");
    expect(html).toContain("Customize");
    expect(html).toContain("Start sample workout");
  });
  it("opens the coach handoff as a matching ready-made plan", () => {
    const html = renderToStaticMarkup(<WorkoutDemo initialRequest={coachWorkoutRequest} requestId={1} />);
    expect(html).toContain("Own your next touch");
    expect(html).toContain("20 min available");
    expect(html).toContain("Start sample workout");
    expect(html).not.toContain("How much time do you have?");
  });
  it("renders the full sample answer and all three question controls without tab gating", () => {
    const html = renderToStaticMarkup(<CoachDemo onOpenWorkout={() => undefined} />);
    expect(html).toContain("Alex Johnson");
    expect(html).toContain("Sample athlete");
    expect(html).toContain("0.44 seconds faster");
    expect(html).toContain("What should I focus on next?");
    expect(html).toContain("Help me plan 20 minutes");
    expect(html).toContain('aria-live="polite"');
  });
  it("uses a drill-specific setup with accessible player, ball and movement descriptions", () => {
    const html = renderToStaticMarkup(<DemoPitch focus="shooting" />);
    expect(html).toContain("One-step laces strike:");
    expect(html).toContain("Solid circle: player; white dot: ball; dashed line: movement.");
    expect(html).toContain("marker-end");
    expect(html).not.toContain("setChoices");
  });
});
