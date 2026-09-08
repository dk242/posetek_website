import { describe, expect, it } from "vitest";
import { playerSignup } from "./signup";

describe("admin signup details", () => {
  it("prefers the signup code and trims surrounding whitespace", () => {
    expect(playerSignup({ signupCode: "  PLR7K9Q  ", code: "OLD123" }))
      .toEqual({ registered: false, signupCode: "PLR7K9Q" });
  });

  it.each([undefined, null, "", "   ", 123, {}, []])("falls back from an unusable signupCode (%j)", signupCode => {
    expect(playerSignup({ signupCode, code: " LEGACY7 " }).signupCode).toBe("LEGACY7");
  });

  it.each([undefined, null, {}, { signupCode: " ", code: 123 }, { code: [] }])("handles missing or malformed codes (%j)", data => {
    expect(playerSignup(data)).toEqual({ registered: false, signupCode: null });
  });

  it.each([{ registered: true }, { userUID: "owner" }, { authenticationUID: "owner" }])("hides stale codes for claimed players (%j)", ownership => {
    expect(playerSignup({ ...ownership, signupCode: "STALE1", code: "STALE2" }))
      .toEqual({ registered: true, signupCode: null });
  });

  it("keeps existing registration semantics for unclaimed records", () => {
    expect(playerSignup({ registered: false, userUID: "", authenticationUID: null, code: "PENDING" }))
      .toEqual({ registered: false, signupCode: "PENDING" });
  });
});
