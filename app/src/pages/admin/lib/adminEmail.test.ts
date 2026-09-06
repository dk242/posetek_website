// The admin predicate — ADMIN_IDENTITY_CONTRACT.md §1 and its §5 test matrix.
// The same cases are asserted in the Swift client and modelled against the
// rules expression; if this drifts, the UI routes someone the rules will deny.

import { describe, expect, it } from "vitest";
import { isAdminEmail } from "./adminEmail";

describe("isAdminEmail", () => {
  it("accepts a posetek.net address in any casing", () => {
    expect(isAdminEmail("nolan@posetek.net")).toBe(true);
    expect(isAdminEmail("Nolan@PoseTek.net")).toBe(true);
    expect(isAdminEmail("  dylan@posetek.net  ")).toBe(true);
    expect(isAdminEmail("first.last+tag@posetek.net")).toBe(true);
  });

  it("rejects a lookalike domain", () => {
    expect(isAdminEmail("nolan@posetek.net.evil.com")).toBe(false);
    expect(isAdminEmail("nolan@notposetek.net")).toBe(false);
    expect(isAdminEmail("nolan@posetek.com")).toBe(false);
    expect(isAdminEmail("nolan@posetekxnet")).toBe(false);
    expect(isAdminEmail("evil.com/nolan@posetek.net")).toBe(false);
  });

  it("rejects a missing or non-string address (phone auth has no email)", () => {
    expect(isAdminEmail(undefined)).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail("")).toBe(false);
    expect(isAdminEmail(42)).toBe(false);
  });
});
