import { describe, expect, it, vi } from "vitest";
import { readPlayerInvitationLink, capturePlayerInvitationLink, initialPlayerInvitationLink, forgetPlayerInvitationLink, createInvitedPlayer } from "./player-invitation-link";

const code = "PLR-SYNTHETIC-INVITATION";
describe("private player invitation links", () => {
  it.each([`#playerCode=${code}`, `?playerCode=${code}`])("prefills supported links and removes the secret: %s", suffix => {
    const result = readPlayerInvitationLink(`https://posetek.net/signin${suffix}`);
    expect(result.invitation).toEqual({ present: true, code });
    expect(result.cleanUrl).toBe("https://posetek.net/signin");
  });
  it("keeps a same-origin return target and handles the legacy page", () => {
    const result = readPlayerInvitationLink(`https://posetek.net/kickai.html?returnTo=%2Fathlete%3Fplayer%3Dcanonical#playerCode=${code.toLowerCase()}`);
    expect(result.invitation.code).toBe(code.toLowerCase());
    expect(new URL(result.cleanUrl).searchParams.get("returnTo")).toBe("/athlete?player=canonical");
  });
  it.each(["?playerCode=", "#playerCode=%3Cscript%3E", `?playerCode=${code}#playerCode=OTHER-CODE`, `?playerCode=${"A".repeat(65)}`])("rejects empty/malformed/conflicting links without leaving secrets: %s", suffix => {
    const result = readPlayerInvitationLink(`https://posetek.net/signin${suffix}`);
    expect(result.invitation).toEqual({ present: true, code: "" });
    expect(result.cleanUrl).toBe("https://posetek.net/signin");
  });
  it("does not open Player signup for normal sign-in or staff invitation URLs", () => {
    expect(readPlayerInvitationLink("https://posetek.net/signin?returnTo=%2Ffeed").invitation.present).toBe(false);
    expect(readPlayerInvitationLink("https://posetek.net/join?playerCode=SAMPLE-CODE").invitation.present).toBe(false);
  });
  it("captures before render without persistent browser storage", () => {
    const replaceState = vi.fn();
    capturePlayerInvitationLink({ location: { href: `https://posetek.net/signin#playerCode=${code}` }, history: { state: { previous: true }, replaceState } } as any);
    expect(initialPlayerInvitationLink()).toEqual({ present: true, code });
    expect(replaceState).toHaveBeenCalledWith({ previous: true }, "", "https://posetek.net/signin");
    forgetPlayerInvitationLink();
    expect(initialPlayerInvitationLink().code).toBe("");
  });
});

function steps() {
  const user = { uid: "new-user" };
  let active: typeof user | null = null;
  return { currentUser: vi.fn((): typeof user | null => active), validate: vi.fn(async () => true), create: vi.fn(async () => { active = user; return user; }), verify: vi.fn(async () => {}), redeem: vi.fn(async () => ({ data: { playerId: "canonical-player" } })), discard: vi.fn(async () => { active = null; }), resolve: vi.fn(async (): Promise<string | null> => null), created: vi.fn() };
}
const input = { code, email: " player@example.test ", password: "synthetic-password" };
describe("player signup preflight and account safety", () => {
  it("rejects invalid or used code without creating an account or sending verification", async () => {
    const calls = steps(); calls.validate.mockResolvedValue(false);
    await expect(createInvitedPlayer(input, calls)).rejects.toThrow("already been used");
    expect(calls.create).not.toHaveBeenCalled(); expect(calls.verify).not.toHaveBeenCalled(); expect(calls.redeem).not.toHaveBeenCalled();
  });
  it("fails closed on validation/network errors", async () => {
    const calls = steps(); calls.validate.mockRejectedValue(new Error("Network unavailable"));
    await expect(createInvitedPlayer(input, calls)).rejects.toThrow("Network unavailable");
    expect(calls.create).not.toHaveBeenCalled();
  });
  it("never creates/replaces an account while already signed in", async () => {
    const calls = steps(); calls.currentUser.mockReturnValue({ uid: "existing-user" });
    await expect(createInvitedPlayer(input, calls)).rejects.toThrow("already signed in");
    expect(calls.validate).not.toHaveBeenCalled(); expect(calls.create).not.toHaveBeenCalled(); expect(calls.discard).not.toHaveBeenCalled();
  });
  it("rechecks sign-in after validation", async () => {
    const calls = steps(); calls.currentUser.mockReturnValueOnce(null).mockReturnValue({ uid: "existing-user" });
    await expect(createInvitedPlayer(input, calls)).rejects.toThrow("sign-in changed");
    expect(calls.create).not.toHaveBeenCalled();
  });
  it("validates, creates, verifies and redeems into the canonical profile", async () => {
    const calls = steps();
    expect(await createInvitedPlayer(input, calls)).toBe("canonical-player");
    expect(calls.create).toHaveBeenCalledWith("player@example.test", input.password);
    expect(calls.validate.mock.invocationCallOrder[0]).toBeLessThan(calls.create.mock.invocationCallOrder[0]);
    expect(calls.verify.mock.invocationCallOrder[0]).toBeLessThan(calls.redeem.mock.invocationCallOrder[0]);
    expect(calls.discard).not.toHaveBeenCalled();
  });
  it("cleans only this new account if an invitation is claimed concurrently", async () => {
    const calls = steps(); calls.redeem.mockRejectedValue(Object.assign(new Error("Already used"), { code: "functions/not-found" }));
    await expect(createInvitedPlayer(input, calls)).rejects.toThrow("Already used");
    expect(calls.discard).toHaveBeenCalledWith({ uid: "new-user" });
  });
  it("never deletes the account after successful redemption with an unexpected response", async () => {
    const calls = steps(); calls.redeem.mockResolvedValue({ data: {} } as any);
    await expect(createInvitedPlayer(input, calls)).rejects.toThrow("account was created");
    expect(calls.discard).not.toHaveBeenCalled();
  });
  it("reconciles a successful claim whose response was lost without deleting the account", async () => {
    const calls = steps(); calls.redeem.mockRejectedValue(new Error("Network error")); calls.resolve.mockResolvedValue("canonical-player");
    expect(await createInvitedPlayer(input, calls)).toBe("canonical-player");
    expect(calls.discard).not.toHaveBeenCalled();
  });
  it("retains an account when the claim outcome is unknown, and resumes without another Auth creation", async () => {
    const calls = steps(); calls.redeem.mockRejectedValueOnce(new Error("Network error"));
    await expect(createInvitedPlayer(input, calls)).rejects.toThrow("linking could not be confirmed");
    expect(calls.discard).not.toHaveBeenCalled();
    expect(await createInvitedPlayer(input, calls, { uid: "new-user" })).toBe("canonical-player");
    expect(calls.create).toHaveBeenCalledTimes(1); expect(calls.verify).toHaveBeenCalledTimes(2);
  });
  it("does not claim under an account switched during email verification", async () => {
    const calls = steps(); calls.verify.mockImplementation(async () => { calls.currentUser.mockReturnValue({ uid: "different-user" }); });
    await expect(createInvitedPlayer(input, calls)).rejects.toThrow("sign-in changed");
    expect(calls.redeem).not.toHaveBeenCalled();
  });
  it("retains an already-linked account if identity changes after redemption", async () => {
    const calls = steps(); calls.redeem.mockImplementation(async () => { calls.currentUser.mockReturnValue({ uid: "different-user" }); return { data: { playerId: "canonical-player" } }; });
    await expect(createInvitedPlayer(input, calls)).rejects.toThrow("account was created");
    expect(calls.discard).not.toHaveBeenCalled();
  });
  it("never deletes a retained account when sign-in changes during resumed resolution", async () => {
    const calls = steps(); calls.currentUser.mockReturnValue({ uid: "new-user" });
    calls.resolve.mockImplementation(async () => { calls.currentUser.mockReturnValue({ uid: "different-user" }); return "canonical-player"; });
    await expect(createInvitedPlayer(input, calls, { uid: "new-user" })).rejects.toThrow("sign-in changed");
    expect(calls.discard).not.toHaveBeenCalled(); expect(calls.redeem).not.toHaveBeenCalled();
  });
});
