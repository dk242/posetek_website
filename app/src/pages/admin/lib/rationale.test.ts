import { describe, expect, it } from "vitest";
import { NO_FEEDBACK_RATIONALE, workoutRationale } from "./rationale";

describe("workout feedback choice", () => {
  it("requires explicit opt-out for blank feedback", () => {
    expect(workoutRationale("   ")).toBeNull();
    expect(workoutRationale("   ", true)).toBe(NO_FEEDBACK_RATIONALE);
    // Unchecking restores the requirement without losing the text draft.
    expect(workoutRationale("   ", false)).toBeNull();
  });
  it("uses written feedback when the checkbox is not selected", () => {
    expect(workoutRationale("  Reduce load.  ")).toBe("Reduce load.");
    expect(workoutRationale("Reduce load.", true)).toBe(NO_FEEDBACK_RATIONALE);
    expect(workoutRationale("Reduce load.", false)).toBe("Reduce load.");
  });
  it("keeps existing text bounds and a declaration compatible with deployed rules", () => {
    expect(workoutRationale("ab")).toBeNull();
    expect(workoutRationale("abc")).toBe("abc");
    expect(workoutRationale("x".repeat(2000))).toHaveLength(2000);
    expect(workoutRationale("x".repeat(2001))).toBeNull();
    expect(NO_FEEDBACK_RATIONALE.length).toBeGreaterThanOrEqual(3);
    expect(NO_FEEDBACK_RATIONALE.length).toBeLessThanOrEqual(2000);
  });
});
