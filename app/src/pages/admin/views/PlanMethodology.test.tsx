import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("../../../lib/firebase", () => ({ db: {} }));
vi.mock("../../athlete-portal/lib/loaders", () => ({ submitLlmJob: vi.fn() }));
import { PriorityCards, ExerciseReason } from "./PlanMethodology";
import { methodologyPriorities, METHODOLOGY_VERSION } from "../lib/personalizedLogic";

describe("methodology review content", () => {
  it("distinguishes measured priorities from conditional ones and displays their timing and check", () => {
    const base = { rank: 1, domain: "agility", objectiveId: "turn", role: "primary", confidence: "low", reason: "Practice a controlled change of direction.",
      weeklyTargetMinutes: 24, targetPct: 20, progressCheck: "Record a complete shuttle.", eligibleDrillCount: 2 };
    const priorities = methodologyPriorities({ methodologyVersion: METHODOLOGY_VERSION, priorities: [
      { ...base, id: "estimated", label: "Controlled turns", evidenceBasis: "conditionalEstimate", limitation: "No measured finish." },
      { ...base, rank: 2, id: "measured", label: "Acceleration", evidenceBasis: "measured", domain: "speed" },
    ] });
    const html = renderToStaticMarkup(<PriorityCards priorities={priorities} />);
    expect(html).toContain("Conditional estimate"); expect(html).toContain("Measured test");
    expect(html).toContain("No measured finish."); expect(html).toContain("24 min / week");
    expect(html).toContain("Record a complete shuttle."); expect(html).toContain("Target before fitting complete drill doses");
    expect(html).not.toContain("percentile");
  });
  it("renders saved exercise reasoning and progress beside the dose without making up legacy checks", () => {
    const html = renderToStaticMarkup(<ExerciseReason block={{ trainingRationale: { methodologyVersion: METHODOLOGY_VERSION,
      evidenceBasis: "goal", reason: "Rehearse the chosen first-touch goal.", progressCheck: "Repeat the same target drill." } }} />);
    expect(html).toContain("Selected goal"); expect(html).toContain("Why this exercise:"); expect(html).toContain("Repeat the same target drill.");
    const legacy = renderToStaticMarkup(<ExerciseReason block={{ whyIncluded: "Keep the original saved reason." }} />);
    expect(legacy).toContain("Keep the original saved reason."); expect(legacy).not.toContain("Progress check:");
    expect(renderToStaticMarkup(<ExerciseReason block={{}} />)).toBe("");
  });
  it("shows unsupported curriculum honestly and does not label unknown time as zero", () => {
    const priorities = methodologyPriorities({ methodologyVersion: METHODOLOGY_VERSION, priorities: [{ id: "passing", rank: 1,
      label: "Passing practice", reason: "Selected goal.", role: "support", evidenceBasis: "goal", eligibleDrillCount: 0 }] });
    const html = renderToStaticMarkup(<PriorityCards priorities={priorities} />);
    expect(html).toContain("No eligible drill"); expect(html).not.toContain("0 min / week");
  });
  it("labels a repeated domain allocation as shared rather than two additive time budgets", () => {
    const base = { rank: 1, domain: "plyometrics", objectiveId: "vertical", label: "Jump height", role: "support",
      evidenceBasis: "measured", reason: "Develop takeoff force.", weeklyTargetMinutes: 20 };
    const priorities = methodologyPriorities({ methodologyVersion: METHODOLOGY_VERSION, priorities: [
      { ...base, id: "vertical" }, { ...base, id: "horizontal", rank: 2, objectiveId: "horizontal", label: "Jump distance" },
    ] });
    const html = renderToStaticMarkup(<PriorityCards priorities={priorities} />);
    expect(html.match(/Shared domain target/g)).toHaveLength(2);
    expect(html).toContain("not added together"); expect(html).not.toContain("40 min");
  });
});
