import { describe, expect, it } from "vitest";
import {
  findNextSection,
  findPreviousSection,
  nextSlideIndex,
  scrollIndicatorVisibility,
} from "./home-logic";

describe("nextSlideIndex", () => {
  it("advances by one", () => {
    expect(nextSlideIndex(0, 5)).toBe(1);
    expect(nextSlideIndex(3, 5)).toBe(4);
  });

  it("wraps back to the first slide", () => {
    expect(nextSlideIndex(4, 5)).toBe(0);
  });
});

describe("scrollIndicatorVisibility", () => {
  // heroHeight 1000 → pastHero threshold is scrollY > 450
  it("hides both buttons before passing 45% of the hero", () => {
    expect(scrollIndicatorVisibility(0, 1000, 3000)).toEqual({ up: false, down: false });
    expect(scrollIndicatorVisibility(450, 1000, 3000)).toEqual({ up: false, down: false }); // strict >
  });

  it("shows both buttons past the hero with room left to scroll", () => {
    expect(scrollIndicatorVisibility(451, 1000, 3000)).toEqual({ up: true, down: true });
  });

  it("hides the down button within 80px of the bottom", () => {
    expect(scrollIndicatorVisibility(2920, 1000, 3000)).toEqual({ up: true, down: false }); // strict <
    expect(scrollIndicatorVisibility(2919, 1000, 3000)).toEqual({ up: true, down: true });
  });
});

describe("findPreviousSection", () => {
  const offsets = [0, 800, 1600, 2400];

  it("returns the last section whose top is above scrollY - 80", () => {
    expect(findPreviousSection(offsets, 1700)).toBe(2); // 1600 < 1620
    expect(findPreviousSection(offsets, 1650)).toBe(1); // 1600 !< 1570, 800 < 1570
  });

  it("returns -1 when already at the top", () => {
    expect(findPreviousSection(offsets, 0)).toBe(-1);
    expect(findPreviousSection(offsets, 80)).toBe(-1); // 0 !< 0 (strict <)
  });
});

describe("findNextSection", () => {
  const offsets = [0, 800, 1600, 2400];

  it("returns the first section whose top is below scrollY + 80", () => {
    expect(findNextSection(offsets, 0)).toBe(1); // 800 > 80
    expect(findNextSection(offsets, 750)).toBe(2); // 800 !> 830, 1600 > 830
  });

  it("returns -1 when no section lies further down", () => {
    expect(findNextSection(offsets, 2400)).toBe(-1);
    expect(findNextSection(offsets, 2320)).toBe(-1); // 2400 !> 2400 (strict >)
  });
});
