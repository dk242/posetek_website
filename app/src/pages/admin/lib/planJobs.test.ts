import { describe, expect, it, vi } from "vitest";
import { DEFAULT_INTAKE, planV3JobParams } from "./planJobs";

// Test the outgoing request without connecting to Firebase or creating a plan.
vi.mock("../../../lib/firebase", () => ({ db: {} }));
vi.mock("../../athlete-portal/lib/loaders", () => ({ submitLlmJob: vi.fn() }));

describe("admin plan generation request", () => {
  it.each(["shooting", "side_kick", "deadballShot"])(
    "sends normalized %s results under the gateway's kick identifier",
    repType => {
      const reps = [
        { _statsDrill: "shooting", repType, velocity: 28.2, sessionNumber: 1 },
        { _statsDrill: "sprint", repType: "sprint", max_velocity: 6, sessionNumber: 1 },
      ];
      const params = planV3JobParams(reps, { position: "CB" }, 16, {
        ...DEFAULT_INTAKE, minutesPerSession: 90,
      });

      expect(params.planVersion).toBe(3);
      expect(params.intake).toMatchObject({ age: 16, position: "CB", minutesPerSession: 90 });
      expect(params.statsProfile.drills).toEqual(expect.arrayContaining([
        expect.objectContaining({
          drill: "kick",
          metrics: [expect.objectContaining({ metric: "ballSpeed", bestCanonical: 28.2 })],
        }),
        expect.objectContaining({
          drill: "sprint",
          metrics: [expect.objectContaining({ metric: "sprintMaxSpeed", bestCanonical: 6 })],
        }),
      ]));
      expect(params.statsProfile.drills).toHaveLength(2);
      expect(reps[0]).toMatchObject({ _statsDrill: "shooting", repType, velocity: 28.2 });
    },
  );
});
