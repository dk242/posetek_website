import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TrainingLoadInstructions from "./TrainingLoadInstructions";
describe("reviewer-set loading display", () => {
  it("shows the actual prescription without deriving progression", () => {
    const html = renderToStaticMarkup(<TrainingLoadInstructions block={{ trainingPolicyVersion: "whole-body-v1", loadingInstructions: "4 kg under coach supervision; no independent increase." }} />);
    expect(html).toContain("4 kg under coach supervision; no independent increase."); expect(html).toContain("Coach-set loading:");
  });
  it("does not invent a load for existing plans or unweighted exercises", () => { expect(renderToStaticMarkup(<TrainingLoadInstructions block={{}} />)).toBe(""); });
});
