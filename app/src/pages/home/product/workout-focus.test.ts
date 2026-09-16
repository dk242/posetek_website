import { afterEach, describe, expect, it, vi } from "vitest";
import { focusWorkoutHeading } from "./workout-focus";

afterEach(() => vi.unstubAllGlobals());

describe("workout section navigation", () => {
  it.each([false, true])("reveals the newly focused heading, with reduced motion %s", reducedMotion => {
    const order: string[] = [];
    const focus = vi.fn(() => order.push("focus"));
    const scrollIntoView = vi.fn(() => order.push("reveal"));
    const querySelector = vi.fn(() => ({ focus, scrollIntoView }));
    vi.stubGlobal("window", { matchMedia: () => ({ matches: reducedMotion }) });
    focusWorkoutHeading({ querySelector } as unknown as ParentNode);
    expect(order).toEqual(["focus", "reveal"]);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: reducedMotion ? "instant" : "auto" });
  });
  it("leaves the page untouched when no next-stage heading is mounted", () => {
    expect(() => focusWorkoutHeading(null)).not.toThrow();
    expect(() => focusWorkoutHeading({ querySelector: () => null } as unknown as ParentNode)).not.toThrow();
  });
});
