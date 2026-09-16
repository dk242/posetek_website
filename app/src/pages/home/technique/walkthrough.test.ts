import { describe, expect, it } from "vitest";
import { initialWalkthrough, nextWalkthrough, walkthroughSteps } from "./walkthrough";

describe("mobile-style forward walkthrough", () => {
  it("stops at exact recorded keyframes and keeps both contact cues", () => {
    expect(walkthroughSteps.map(step => step.phase.index)).toEqual([19, 26, 26, 51]);
    expect(walkthroughSteps.slice(1, 3).map(step => step.focusIndex)).toEqual([0, 1]);
    expect(walkthroughSteps[3].phase.referencePose).toBeNull();
  });
  it("advances same-frame evidence without playing backward, then finishes", () => {
    expect(nextWalkthrough({ status: "paused", step: 0 }, 19)).toEqual({ status: "approaching", step: 1 });
    expect(nextWalkthrough({ status: "paused", step: 1 }, 26)).toEqual({ status: "paused", step: 2 });
    expect(nextWalkthrough({ status: "paused", step: 2 }, 26)).toEqual({ status: "approaching", step: 3 });
    expect(nextWalkthrough({ status: "paused", step: 3 }, 51).status).toBe("finished");
    expect(initialWalkthrough.status).toBe("idle");
  });
});
