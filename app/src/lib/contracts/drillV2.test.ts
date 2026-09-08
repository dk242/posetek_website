// Reading both catalog schemas, and the dose/rest formatter.
// DRILL_CATALOG_V2_CONTRACT.md §1.2, §2, §3, §4.1.

import { describe, expect, it } from "vitest";
import {
  coachCommentsFromLegacy,
  derivedDifficulty,
  domainFromLegacy,
  fitFor,
  formatDoseText,
  formatRestText,
  normalizeCatalogDrill,
  stepsFromExecution,
} from "./drillV2";
import { ageBand, domainLabel, domainSortIndex, resolveEligibility } from "./types";

describe("legacy domain mapping (§2)", () => {
  it("splits passing and receiving on targetQuality", () => {
    expect(domainFromLegacy("passingReceiving", "passing")).toBe("passing");
    expect(domainFromLegacy("passingReceiving", "receiving")).toBe("receiving");
    expect(domainFromLegacy("passingReceiving", null)).toBe("passing");
  });

  it("folds both power domains into plyometrics", () => {
    expect(domainFromLegacy("verticalPower")).toBe("plyometrics");
    expect(domainFromLegacy("horizontalPower")).toBe("plyometrics");
  });

  it("maps the remaining seven", () => {
    expect(domainFromLegacy("linearSpeed")).toBe("speed");
    expect(domainFromLegacy("codAgility")).toBe("agility");
    expect(domainFromLegacy("dribbling")).toBe("dribbling");
    expect(domainFromLegacy("shooting")).toBe("shooting");
    expect(domainFromLegacy("strengthResilience")).toBe("strength");
    expect(domainFromLegacy("representativeGames")).toBe("games");
  });

  it("sorts in the contract's table order and labels every value", () => {
    expect(domainSortIndex("ballMastery")).toBe(0);
    expect(domainSortIndex("games")).toBe(9);
    expect(domainLabel("plyometrics")).toBe("Plyometrics");
    expect(domainLabel("games")).toBe("Small-sided games");
    expect(domainLabel("linearSpeed")).toBe("Linear speed"); // unmigrated value, humanized
  });
});

describe("difficulty derivation (§3)", () => {
  // The six worked examples in the contract, re-derived here.
  it("reproduces the contract's worked examples", () => {
    expect(derivedDifficulty(["foundation", "club", "performance"], "any")).toBe(2); // SPD-002
    expect(derivedDifficulty(["foundation"], "any")).toBe(1); // DRB-001
    expect(derivedDifficulty(["club", "performance"], "any")).toBe(3); // COD-004
    expect(derivedDifficulty(["club", "performance"], "circaPostPHV")).toBe(4); // SPD-005
    expect(derivedDifficulty(["performance"], "postPHVPreferred")).toBe(5); // VJP-008
    expect(derivedDifficulty(["club", "performance"], "postPHVPreferred")).toBe(4); // STR-007
  });

  it("caps at 5", () => {
    expect(derivedDifficulty(["performance"], "postPHVMostly")).toBe(5);
  });
});

describe("copy migration (§4.1)", () => {
  it("splits execution prose into ordered steps", () => {
    expect(stepsFromExecution("Face the wall. Pass with the inside of the foot; return with one touch."))
      .toEqual(["Face the wall.", "Pass with the inside of the foot", "return with one touch."]);
  });

  it("keeps one long sentence as one step", () => {
    expect(stepsFromExecution("Dribble the ball through the cones as quickly as you can while keeping it close"))
      .toHaveLength(1);
  });

  it("orders cues, then the success criterion, then the safety note", () => {
    expect(coachCommentsFromLegacy({
      cues: ["Head up", "Small touches"],
      successCriteria: "you clear the gate without a heavy touch",
      safetyNote: "stop if anything hurts",
    })).toEqual([
      "Head up",
      "Small touches",
      "You've got it when: you clear the gate without a heavy touch",
      "Safety: stop if anything hurts",
    ]);
  });
});

describe("normalizeCatalogDrill", () => {
  const legacy = {
    name: "Wall pass rhythm",
    domain: "passingReceiving",
    targetQuality: "passing",
    minAge: 9,
    maxAge: 19,
    eligibleLevels: ["foundation", "club"],
    maturityGate: "any",
    equipment: ["ball", "wall", "partner"],
    playersMin: 2,
    setup: "Stand 5 m from a flat wall.",
    execution: "Pass into the wall. Control the return with one touch.",
    cues: ["Head up"],
    successCriteria: "ten clean returns in a row",
    dose: { setsMin: 2, setsMax: 4, repsMin: 10, repsMax: 20, repUnit: "passes", frequencyPerWeekMax: 3 },
  };

  it("normalizes a v1 document read-only and flags it for migration", () => {
    const drill = normalizeCatalogDrill("PAS-003", legacy);
    expect(drill.needsMigration).toBe(true);
    expect(drill.drillId).toBe("PAS-003");
    expect(drill.domain).toBe("passing");
    expect(drill.legacyDomain).toBe("passingReceiving");
    expect(drill.difficultyLevel).toBe(1);
    expect(drill.equipment).toEqual(["ball", "wall"]); // `partner` leaves equipment
    expect(drill.requiresPartner).toBe(true);
    expect(drill.howTo.setup).toBe("Stand 5 m from a flat wall.");
    expect(drill.howTo.steps).toHaveLength(2);
    expect(drill.coachComments).toEqual(["Head up", "You've got it when: ten clean returns in a row"]);
    expect(drill.maxFrequencyPerWeek).toBe(3);
    expect(drill.status).toBe("published");
  });

  it("uses a v2 document's own fields verbatim", () => {
    const drill = normalizeCatalogDrill("DRB-501", {
      schemaVersion: 2,
      drillId: "DRB-501",
      name: "Figure-8 dribble",
      domain: "dribbling",
      minAge: 8, maxAge: 18,
      difficultyLevel: 4,
      equipment: [],
      requiresPartner: false,
      positionSpecific: "GK",
      howTo: { setup: "Two cones, 2 m apart.", steps: ["Weave the ball around both cones."] },
      dose: { setsMin: 4, setsMax: 4, repsMin: 30, repsMax: 30, repUnit: "seconds" },
      maxFrequencyPerWeek: 2,
      coachComments: [],
      adaptiveLevers: [],
      status: "draft",
      catalogVersion: "1.0.5",
      howToSource: "admin",
      coachCommentsSource: "admin",
    });
    expect(drill.needsMigration).toBe(false);
    expect(drill.difficultyLevel).toBe(4);
    expect(drill.positionSpecific).toBe("GK");
    expect(drill.status).toBe("draft");
    expect(drill.coachComments).toEqual([]); // an authored empty list is authoritative
    expect(drill.howToSource).toBe("admin");
  });

  it("takes the document id as the drill id even when the field disagrees", () => {
    expect(normalizeCatalogDrill("SPD-002", { schemaVersion: 2, drillId: "WRONG" }).drillId).toBe("SPD-002");
  });

  it("keeps positionSpecific only when it is a known position (§1)", () => {
    const v2 = (extra: Record<string, unknown>) =>
      normalizeCatalogDrill("DRB-501", { schemaVersion: 2, drillId: "DRB-501", ...extra });
    expect(v2({}).positionSpecific).toBeNull();
    expect(v2({ positionSpecific: null }).positionSpecific).toBeNull();
    expect(v2({ positionSpecific: "SW" }).positionSpecific).toBeNull();
    expect(v2({ positionSpecific: "GK" }).positionSpecific).toBe("GK");
    expect(normalizeCatalogDrill("PAS-003", legacy).positionSpecific).toBeNull();
  });
});

describe("fitFor", () => {
  const drill = normalizeCatalogDrill("SPD-005", {
    schemaVersion: 2, drillId: "SPD-005", name: "Resisted acceleration",
    domain: "speed", minAge: 14, maxAge: 19, difficultyLevel: 4,
    equipment: ["sledOrBand"], requiresPartner: true,
    howTo: { setup: "", steps: ["Go"] }, dose: {}, maxFrequencyPerWeek: 2,
    coachComments: [], adaptiveLevers: [], status: "published",
    catalogVersion: "1.0.4", howToSource: "migrated", coachCommentsSource: "migrated",
  });

  it("flags each constraint independently", () => {
    expect(fitFor(drill, { age: 12, maxDrillDifficulty: 5, setting: "partner", equipment: ["sledOrBand"] }))
      .toMatchObject({ ageOk: false, difficultyOk: true, partnerOk: true, equipmentOk: true });
    expect(fitFor(drill, { age: 16, maxDrillDifficulty: 3, setting: "partner", equipment: ["sledOrBand"] }))
      .toMatchObject({ ageOk: true, difficultyOk: false });
    expect(fitFor(drill, { age: 16, maxDrillDifficulty: 5, setting: "solo", equipment: ["sledOrBand"] }))
      .toMatchObject({ partnerOk: false });
    expect(fitFor(drill, { age: 16, maxDrillDifficulty: 5, setting: "partner", equipment: ["ball"] }))
      .toMatchObject({ equipmentOk: false });
  });

  it("does not judge age when the athlete's age is unknown", () => {
    expect(fitFor(drill, { age: null, maxDrillDifficulty: 5, setting: "partner", equipment: [] }).ageOk).toBe(true);
  });

  it("passes any-position drills to everyone and position-specific drills only to that position", () => {
    const anyone = { age: 16, maxDrillDifficulty: 5, setting: "partner", equipment: ["sledOrBand"] };
    expect(fitFor(drill, anyone).positionOk).toBe(true);
    expect(fitFor(drill, { ...anyone, position: "ST" }).positionOk).toBe(true);
    const keeper = normalizeCatalogDrill("SHT-501", { schemaVersion: 2, drillId: "SHT-501", positionSpecific: "GK" });
    expect(fitFor(keeper, { ...anyone, position: "GK" }).positionOk).toBe(true);
    expect(fitFor(keeper, { ...anyone, position: "ST" }).positionOk).toBe(false);
    // No position on file is not a match — the pool narrows rather than guessing.
    expect(fitFor(keeper, anyone).positionOk).toBe(false);
    expect(fitFor(keeper, { ...anyone, position: null }).positionOk).toBe(false);
  });
});

describe("technical eligibility (profile inputs §7)", () => {
  it("resolves player over coach over 5, and treats an invalid rating as absent", () => {
    expect(resolveEligibility({}, {}, null)).toMatchObject({ maxDrillDifficulty: 5, source: "default" });
    expect(resolveEligibility({}, { maxDrillDifficulty: 2 }, "c1")).toMatchObject({ maxDrillDifficulty: 2, source: "coach" });
    expect(resolveEligibility({ maxDrillDifficulty: 4 }, { maxDrillDifficulty: 2 }, "c1")).toMatchObject({ maxDrillDifficulty: 4, source: "player" });
    expect(resolveEligibility({ maxDrillDifficulty: 3 }, null, null)).toMatchObject({ maxDrillDifficulty: 3, source: "player" });
    expect(resolveEligibility({ maxDrillDifficulty: 9 }, { maxDrillDifficulty: 2 }, "c1")).toMatchObject({ maxDrillDifficulty: 2, source: "coach" });
    expect(resolveEligibility({ maxDrillDifficulty: "3" }, {}, null)).toMatchObject({ maxDrillDifficulty: 5, source: "default" });
  });
});

describe("age bands (profile inputs §2)", () => {
  it("uses the workbook bands", () => {
    expect(ageBand(7)).toBe("U6-U8");
    expect(ageBand(12)).toBe("U11-U12");
    expect(ageBand(15)).toBe("U15-U16");
    expect(ageBand(19)).toBe("U17-U19");
    expect(ageBand(24)).toBe("senior");
    expect(ageBand(null)).toBeNull();
  });
});

describe("dose and rest text (§1.2)", () => {
  it("formats ranges, single values and per-side", () => {
    expect(formatDoseText({ setsMin: 2, setsMax: 4, repsMin: 2, repsMax: 3, repUnit: "reps" }))
      .toBe("2-4 sets x 2-3 reps");
    expect(formatDoseText({ setsMin: 4, setsMax: 4, repsMin: 30, repsMax: 30, repUnit: "seconds" }))
      .toBe("4 sets x 30 s");
    expect(formatDoseText({ setsMin: 1, setsMax: 1, repsMin: 12, repsMax: 12, repUnit: "minutes" }))
      .toBe("1 set x 12 min");
    expect(formatDoseText({ setsMin: 3, setsMax: 3, repsMin: 8, repsMax: 8, repUnit: "reps", perSide: true }))
      .toBe("3 sets x 8 reps each side");
  });

  it("formats rest, including the between-sets override and the scope", () => {
    expect(formatRestText({ restSecondsMin: 60, restSecondsMax: 120 })).toBe("60-120 s");
    expect(formatRestText({ restSecondsMin: 45, restSecondsMax: 45 })).toBe("45 s");
    expect(formatRestText({ restSecondsMin: 25, restSecondsMax: 25, restScope: "reps", restBetweenSetsSecondsMin: 210, restBetweenSetsSecondsMax: 210 }))
      .toBe("25 s between reps, 210 s between sets");
  });

  it("falls back to the workbook prose when no range is structured", () => {
    expect(formatRestText({ restText: "Natural retrieval" })).toBe("Natural retrieval");
  });
});
