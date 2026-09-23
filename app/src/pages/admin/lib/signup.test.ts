import { describe, expect, it } from "vitest";
import { invitationError, parsePlayerInvitation, playerInvitationUrl, playerSignup, withoutSignupSecrets } from "./signup";

const code = "PLR-Synthetic123";
describe("private player invitations", () => {
  it("excludes roster secrets from shared account data", () => {
    expect(playerSignup({ signupCode: code, code: "LEGACY7" })).toEqual({ registered: false, signupCode: null });
    expect(withoutSignupSecrets({ signupCode: code, code: "LEGACY7", firstName: "Example", organizationId: "club" }))
      .toEqual({ firstName: "Example", organizationId: "club" });
  });
  it.each([{ registered: true }, { userUID: "owner" }, { authenticationUID: "owner" }])("retains claimed account semantics (%j)", ownership => {
    expect(playerSignup({ ...ownership, signupCode: code })).toEqual({ registered: true, signupCode: null });
  });
  it.each([undefined, null, {}, { registered: false, userUID: "", authenticationUID: null }])("handles unclaimed or missing roster data (%j)", data => {
    expect(playerSignup(data)).toEqual({ registered: false, signupCode: null });
  });
  it("preserves mixed case and constructs only a canonical fragment link", () => {
    expect(playerInvitationUrl(code)).toBe("https://posetek.net/signin#playerCode=PLR-Synthetic123");
    expect(parsePlayerInvitation({ playerId: "player", status: "ready", code }, "player"))
      .toEqual({ playerId: "player", status: "ready", code, signupUrl: playerInvitationUrl(code) });
  });
  it.each(["short", "ABC 123", "ABC123#evil", "ABC123?evil", "javascript:alert(1)", "ABC123\n", "x".repeat(65)])("rejects malformed codes", value => {
    expect(() => playerInvitationUrl(value)).toThrow("could not be verified");
  });
  it.each(["https://evil.example/signin#playerCode=PLR-Synthetic123", "https://posetek.net/signin?playerCode=PLR-Synthetic123", "https://posetek.net/signin#playerCode=OTHER123", "https://posetek.net/signin/#playerCode=PLR-Synthetic123"])("rejects an unexpected returned URL", signupUrl => {
    expect(() => parsePlayerInvitation({ playerId: "player", status: "ready", code, signupUrl }, "player")).toThrow();
  });
  it("checks returned player identity and strips secrets from missing/claimed responses", () => {
    expect(() => parsePlayerInvitation({ playerId: "other", status: "ready", code }, "player")).toThrow();
    for (const status of ["missing", "claimed"] as const) expect(parsePlayerInvitation({ playerId: "player", status, code }, "player")).toEqual({ playerId: "player", status });
    expect(() => parsePlayerInvitation({ playerId: "player", status: "unknown" }, "player")).toThrow();
  });
  it("renders authorization failures truthfully without echoing response secrets", () => {
    expect(invitationError({ code: "functions/permission-denied", message: code })).toContain("do not have permission");
    expect(invitationError({ code: "functions/unauthenticated", message: code })).toContain("Sign in again");
    expect(invitationError({ code: "functions/failed-precondition", message: code })).toContain("has not been replaced");
    expect(invitationError(new Error(code))).not.toContain(code);
  });
});
