import { describe, expect, it } from "vitest";
import {
  MAX_DRILLS_PER_WEEK,
  addDrillToWeek,
  defaultDoseFor,
  derivedTargets,
  doseDraftFrom,
  doseErrors,
  drillRowFromCatalog,
  isRetestWeek,
  removeDrillFromWeek,
  updateDrillDose,
  weekMinuteTotal,
  weeklyMinutes,
  withEditedWeek,
} from "./planEdit";

const catalogDrill = {
  drillId: "SPD-010",
  name: "Acceleration starts",
  domain: "linearSpeed",
  intensityIntent: "maxQuality",
  cues: ["Push the ground away", "Stay low", "Drive the arms", "Eyes forward", "A fifth cue that must be dropped"],
  dose: {
    setsMin: 3, setsMax: 5,
    repsMin: 3, repsMax: 5,
    repUnit: "reps",
    restSecondsMin: 45, restSecondsMax: 90,
    frequencyPerWeekMin: 1, frequencyPerWeekMax: 3,
    doseText: "3–5 × 3–5 starts, full recovery",
  },
  estimatedMinutes: { min: 10, max: 16 },
};

const week = {
  weekNumber: 2,
  focus: "Accelerate",
  progressionNote: "More of it",
  targets: [{ domain: "linearSpeed", exposures: 2 }],
  drills: [
    {
      drillId: "SPD-001", name: "Wall drives", domain: "linearSpeed",
      sets: 3, reps: 6, repUnit: "reps", restSeconds: 60,
      frequencyPerWeek: 2, intensityIntent: "moderate", estimatedMinutes: 10,
      cues: [], note: "", weeklyMinutes: 20,
    },
    {
      drillId: "DRB-004", name: "Tight-space control", domain: "dribbling",
      sets: 3, reps: 45, repUnit: "seconds", restSeconds: 45,
      frequencyPerWeek: 3, intensityIntent: "moderate", estimatedMinutes: 12,
      cues: [], note: "", weeklyMinutes: 36,
    },
  ],
};

describe("defaultDoseFor", () => {
  it("takes the midpoint of every workbook range", () => {
    const dose = defaultDoseFor(catalogDrill);
    expect(dose).toEqual({
      sets: 4, reps: 4, repUnit: "reps", restSeconds: 68, frequencyPerWeek: 2, estimatedMinutes: 13,
    });
  });

  it("falls back to sane values when ranges are missing", () => {
    const dose = defaultDoseFor({ dose: {}, estimatedMinutes: {} });
    expect(dose.sets).toBe(3);
    expect(dose.reps).toBe(6);
    expect(dose.repUnit).toBe("reps");
    expect(dose.restSeconds).toBe(60);
    expect(dose.frequencyPerWeek).toBe(2);
    expect(dose.estimatedMinutes).toBe(10);
  });

  it("keeps unfamiliar rep units when they are in the schema vocabulary", () => {
    const dose = defaultDoseFor({ ...catalogDrill, dose: { ...catalogDrill.dose, repUnit: "contacts" } });
    expect(dose.repUnit).toBe("contacts");
  });
});

describe("doseErrors", () => {
  it("accepts a valid draft", () => {
    expect(doseErrors(defaultDoseFor(catalogDrill))).toEqual([]);
  });

  it("flags out-of-schema values", () => {
    const errors = doseErrors({ sets: 0, reps: 4, repUnit: "reps", restSeconds: 700, frequencyPerWeek: 8, estimatedMinutes: 91 });
    expect(errors.some(error => error.includes("Sets"))).toBe(true);
    expect(errors.some(error => error.includes("Rest"))).toBe(true);
    expect(errors.some(error => error.includes("Days per week"))).toBe(true);
    expect(errors.some(error => error.includes("Minutes"))).toBe(true);
  });
});

describe("drillRowFromCatalog", () => {
  it("builds a full _PLAN_DRILL row with weeklyMinutes and capped cues", () => {
    const row = drillRowFromCatalog(catalogDrill, defaultDoseFor(catalogDrill));
    expect(row.drillId).toBe("SPD-010");
    expect(row.domain).toBe("linearSpeed");
    expect(row.intensityIntent).toBe("maxQuality");
    expect(row.cues).toHaveLength(4);
    expect(row.weeklyMinutes).toBe(13 * 2);
    expect(row.note).toBe("Added by your coach");
    for (const key of ["drillId", "name", "domain", "sets", "reps", "repUnit", "restSeconds",
      "frequencyPerWeek", "intensityIntent", "estimatedMinutes", "cues", "note"]) {
      expect(row).toHaveProperty(key);
    }
  });

  it("defaults an unknown intensity to moderate", () => {
    const row = drillRowFromCatalog({ ...catalogDrill, intensityIntent: "brutal" }, defaultDoseFor(catalogDrill));
    expect(row.intensityIntent).toBe("moderate");
  });
});

describe("week operations", () => {
  it("adds a drill and re-derives targets from frequency sums", () => {
    const row = drillRowFromCatalog(catalogDrill, defaultDoseFor(catalogDrill));
    const edited = addDrillToWeek(week, row);
    expect(edited.drills).toHaveLength(3);
    expect(edited.targets).toEqual([
      { domain: "linearSpeed", exposures: 2 + 2 },
      { domain: "dribbling", exposures: 3 },
    ]);
    // Source week untouched.
    expect(week.drills).toHaveLength(2);
  });

  it("refuses duplicates and a ninth drill", () => {
    const row = drillRowFromCatalog(catalogDrill, defaultDoseFor(catalogDrill));
    const withRow = addDrillToWeek(week, row);
    expect(() => addDrillToWeek(withRow, row)).toThrow(/already/);
    const full = { ...week, drills: Array.from({ length: MAX_DRILLS_PER_WEEK }, (_, index) => ({ ...week.drills[0], drillId: `X-${index}` })) };
    expect(() => addDrillToWeek(full, row)).toThrow(/at most/);
  });

  it("removes a drill and drops its domain from targets", () => {
    const edited = removeDrillFromWeek(week, "DRB-004");
    expect(edited.drills).toHaveLength(1);
    expect(edited.targets).toEqual([{ domain: "linearSpeed", exposures: 2 }]);
  });

  it("updates a dose and recomputes weeklyMinutes", () => {
    const edited = updateDrillDose(week, "SPD-001", {
      sets: 4, reps: 8, repUnit: "reps", restSeconds: 90, frequencyPerWeek: 3, estimatedMinutes: 15,
    });
    const drill = edited.drills.find((entry: { drillId: string }) => entry.drillId === "SPD-001");
    expect(drill.sets).toBe(4);
    expect(drill.weeklyMinutes).toBe(45);
    expect(edited.targets[0]).toEqual({ domain: "linearSpeed", exposures: 3 });
  });

  it("round-trips a drill row into a dose draft", () => {
    const draft = doseDraftFrom(week.drills[1]);
    expect(draft).toEqual({ sets: 3, reps: 45, repUnit: "seconds", restSeconds: 45, frequencyPerWeek: 3, estimatedMinutes: 12 });
  });
});

describe("plan helpers", () => {
  const plan = { horizonWeeks: 6, weeks: [week, { weekNumber: 3, drills: [] }] };

  it("swaps the edited week by weekNumber", () => {
    const edited = { ...week, focus: "Changed" };
    const weeks = withEditedWeek(plan, edited);
    expect(weeks.find((entry: { weekNumber: number }) => entry.weekNumber === 2).focus).toBe("Changed");
    expect(weeks).toHaveLength(2);
  });

  it("marks only the final horizon week as retest", () => {
    expect(isRetestWeek(plan, 6)).toBe(true);
    expect(isRetestWeek(plan, 5)).toBe(false);
  });

  it("totals weekly minutes across drills", () => {
    expect(weekMinuteTotal(week)).toBe(20 + 36);
    expect(weeklyMinutes({ estimatedMinutes: 10, frequencyPerWeek: 2 })).toBe(20);
  });

  it("derives targets in first-seen domain order", () => {
    expect(derivedTargets(week).map(target => target.domain)).toEqual(["linearSpeed", "dribbling"]);
  });
});
