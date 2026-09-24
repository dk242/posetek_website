import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TrainingContextFields from "./TrainingContextFields";
import { emptyTrainingContext } from "../lib/wholeBodyTraining";
describe("individual training intake", () => {
  it("labels individual confirmation and avoids offering self-certified independent clearance", () => {
    const html = renderToStaticMarkup(<TrainingContextFields value={emptyTrainingContext()} onChange={() => {}} playerName="Alex" />);
    expect(html).toContain("Training circumstances · Alex"); expect(html).toContain("do not grant clearance");
    expect(html).toContain("This is the complete weekly schedule for Alex"); expect(html).toContain('type="date"'); expect(html).not.toContain("independentCleared");
  });
});
