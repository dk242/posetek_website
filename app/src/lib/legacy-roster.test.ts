import { describe, expect, it, vi } from "vitest";
import { readAccessibleLegacyRoster } from "./legacy-roster";

describe("legacy roster after club migration", () => {
  it("keeps the two remaining players when thirty migrated documents deny access", async () => {
    const ids = [...Array.from({ length: 30 }, (_, index) => `migrated-${index}`), "remaining-a", "remaining-b"];
    const read = vi.fn(async (id: string) => {
      if (id.startsWith("migrated")) throw { code: "permission-denied" };
      return { id };
    });
    expect(await readAccessibleLegacyRoster(ids, read)).toEqual([{ id: "remaining-a" }, { id: "remaining-b" }]);
    expect(read).toHaveBeenCalledTimes(32);
  });

  it("skips deleted references without changing the order of successful reads", async () => {
    const result = await readAccessibleLegacyRoster(["first", "missing", "last"], async id => {
      if (id === "missing") throw { code: "not-found" };
      return id;
    });
    expect(result).toEqual(["first", "last"]);
  });

  it.each(["unavailable", "unauthenticated", "deadline-exceeded", "internal"])("does not hide %s as an empty roster", async code => {
    const failure = { code };
    await expect(readAccessibleLegacyRoster(["player"], async () => { throw failure; })).rejects.toBe(failure);
  });
});
