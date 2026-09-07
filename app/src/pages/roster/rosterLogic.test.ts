import { describe, expect, it } from "vitest";
import {
  filterPlayers,
  fullName,
  initials,
  isRegistered,
  makeCode,
  pendingCount,
  sortByName,
  summaryText,
} from "./rosterLogic";

describe("initials", () => {
  it("uppercases first letters of first and last name", () => {
    expect(initials({ firstName: "jordan", lastName: "rivera" })).toBe("JR");
  });
  it("uses a single name when only one is present", () => {
    expect(initials({ firstName: "a" })).toBe("A");
    expect(initials({ lastName: "b" })).toBe("B");
  });
  it("falls back to A when no names exist", () => {
    expect(initials({})).toBe("A");
    expect(initials({ name: "Only Display" })).toBe("A");
  });
});

describe("fullName", () => {
  it("joins first and last name with a space", () => {
    expect(fullName({ firstName: "Jordan", lastName: "Rivera" })).toBe("Jordan Rivera");
  });
  it("uses a single part when the other is missing", () => {
    expect(fullName({ firstName: "Jordan" })).toBe("Jordan");
    expect(fullName({ lastName: "Rivera" })).toBe("Rivera");
  });
  it("falls back to player.name then Athlete", () => {
    expect(fullName({ name: "Display Name" })).toBe("Display Name");
    expect(fullName({})).toBe("Athlete");
  });
});

describe("makeCode", () => {
  it("produces PLR + 4 chars from the legacy alphabet (no I, O, 0, 1)", () => {
    for (let i = 0; i < 100; i++) {
      expect(makeCode()).toMatch(/^PLR[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    }
  });
});

describe("isRegistered", () => {
  it("is true for registered === true", () => {
    expect(isRegistered({ registered: true })).toBe(true);
  });
  it("is true when a userUID is linked", () => {
    expect(isRegistered({ userUID: "abc" })).toBe(true);
    expect(isRegistered({ registered: false, userUID: "abc" })).toBe(true);
  });
  it("requires strict boolean true, like the legacy check", () => {
    expect(isRegistered({ registered: 1 })).toBe(false);
    expect(isRegistered({ registered: "true" })).toBe(false);
    expect(isRegistered({})).toBe(false);
  });
});

describe("pendingCount / summaryText", () => {
  const roster = [
    { firstName: "Jordan", lastName: "Rivera", registered: true, userUID: "u1" },
    { firstName: "Maya", lastName: "Thompson", registered: false, signupCode: "PLR7K9Q" },
    { firstName: "Eli", lastName: "Santos", registered: true, userUID: "u2" },
    { firstName: "Avery", lastName: "Chen", registered: false, signupCode: "PLR4M8T" },
  ];

  it("counts players without registration or a linked user", () => {
    expect(pendingCount(roster)).toBe(2);
    expect(pendingCount([])).toBe(0);
  });

  it("formats the summary with a middle dot and singular/plural", () => {
    expect(summaryText(roster)).toBe("4 players · 2 awaiting signup");
    expect(summaryText([])).toBe("0 players · 0 awaiting signup");
    expect(summaryText([{ registered: true }])).toBe("1 player · 0 awaiting signup");
  });
});

describe("filterPlayers", () => {
  const roster = [
    { id: "1", firstName: "Jordan", lastName: "Rivera", code: "PLRABCD" },
    { id: "2", firstName: "Maya", lastName: "Thompson", signupCode: "PLR7K9Q" },
    { id: "3", name: "Just Display" },
  ];

  it("returns everyone for an empty or whitespace query", () => {
    expect(filterPlayers(roster, "")).toHaveLength(3);
    expect(filterPlayers(roster, "   ")).toHaveLength(3);
  });

  it("matches full name case-insensitively", () => {
    expect(filterPlayers(roster, "jordan riv").map(p => p.id)).toEqual(["1"]);
    expect(filterPlayers(roster, "THOMPSON").map(p => p.id)).toEqual(["2"]);
    expect(filterPlayers(roster, "display").map(p => p.id)).toEqual(["3"]);
  });

  it("matches player.code but NOT signupCode (legacy behavior)", () => {
    expect(filterPlayers(roster, "plrabcd").map(p => p.id)).toEqual(["1"]);
    expect(filterPlayers(roster, "plr7k9q")).toHaveLength(0);
  });
});

describe("sortByName", () => {
  it("sorts by full name using localeCompare", () => {
    const sorted = sortByName([
      { id: "c", firstName: "Maya", lastName: "Thompson" },
      { id: "a", firstName: "Avery", lastName: "Chen" },
      { id: "b", firstName: "Eli", lastName: "Santos" },
    ]);
    expect(sorted.map(p => p.id)).toEqual(["a", "b", "c"]);
  });
});
