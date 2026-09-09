import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RationaleDialog from "./RationaleDialog";

function render(error: string | null = null) {
  return renderToStaticMarkup(<RationaleDialog
    playerName="Test athlete" workoutTitle="Ball work"
    diff={{ added: [], removed: [{ blockId: "b2", drillId: "DRB-002", domain: "dribbling" }],
      doseChanged: [], reordered: false, minutesDelta: -5, domainMinutesDelta: { dribbling: -5 } }}
    warnings={[]} minutesBefore={20} minutesAfter={15} inProgress={false} isNext
    saving={false} error={error} onCancel={() => {}} onSave={() => {}}
  />);
}

describe("workout save dialog", () => {
  it("offers an unchecked, labelled no-feedback checkbox and requires a choice before saving", () => {
    const html = render();
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('checked=""');
    expect(html).toContain("I have no feedback to provide here");
    expect(html).toContain('disabled="">Save the workout');
    expect(html).toContain("DRB-002");
  });
  it("shows save failures as an alert while preserving the removal summary", () => {
    const html = render("This athlete’s schedule changed. Reload and re-apply.");
    expect(html).toContain('role="alert"');
    expect(html).toContain("This athlete’s schedule changed.");
    expect(html).toContain("DRB-002");
    expect(html).toContain("Keep editing");
  });
});
