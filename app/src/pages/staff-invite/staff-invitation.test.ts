import { describe, expect, it, vi } from "vitest";
import { activeStaffOrganization, claimStaffInvitation, staffActionSettings, staffInvitationError, staffOrganizationRoute, STAFF_ACTIVATION_STALE } from "./staff-invitation";
import type { StaffClaimDependencies } from "./staff-invitation";

const code = "CLUB-" + "A".repeat(32);
const organization = { id: "club-one", name: "Synthetic Club" };
const member = { role: "coach", organization };
const failure = (code: string, message = "") => ({ code: "functions/" + code, message });
function dependencies() {
  return {
    isCurrent: vi.fn(() => true),
    refreshVerified: vi.fn(async () => true),
    redeem: vi.fn(async () => ({ organizationId: organization.id, role: "coach" })),
    context: vi.fn<StaffClaimDependencies["context"]>(async () => member),
  };
}
describe("staff activation contract", () => {
  it("confirms the returned organization and role using authoritative current membership", async () => {
    const deps = dependencies();
    await expect(claimStaffInvitation(" " + code + " ", deps)).resolves.toEqual({ kind: "claimed", organization });
    expect(deps.redeem).toHaveBeenCalledExactlyOnceWith(code);
    expect(deps.context).toHaveBeenCalledExactlyOnceWith(organization.id);
  });
  it("does not create a claim before a valid-shaped staff code and verified email", async () => {
    const deps = dependencies();
    await expect(claimStaffInvitation("PLR-123456", deps)).rejects.toThrow("full staff invitation code");
    expect(deps.refreshVerified).not.toHaveBeenCalled();
    deps.refreshVerified.mockResolvedValue(false);
    await expect(claimStaffInvitation(code, deps)).rejects.toThrow("Verify your email");
    expect(deps.redeem).not.toHaveBeenCalled();
  });
  it("recovers a lost claim acknowledgement as existing access, never a claimed-success assertion", async () => {
    const deps = dependencies();
    deps.redeem.mockRejectedValue(failure("unavailable"));
    await expect(claimStaffInvitation(code, deps)).resolves.toMatchObject({ kind: "existing", organization });
    expect(deps.context).toHaveBeenCalledExactlyOnceWith();
  });
  it("can offer unrelated existing membership without saying that the invitation succeeded", async () => {
    const deps = dependencies();
    const another = { id: "another-club", name: "Existing Club" };
    deps.redeem.mockRejectedValue(failure("permission-denied"));
    deps.context.mockResolvedValue({ role: "manager", organization: another });
    const result = await claimStaffInvitation(code, deps);
    expect(result).toMatchObject({ kind: "existing", organization: another, message: expect.stringContaining("email address") });
  });
  it("does not grant access from a successful response when current membership is missing", async () => {
    const deps = dependencies();
    deps.context.mockResolvedValue({ role: "none", organization: null });
    await expect(claimStaffInvitation(code, deps)).rejects.toThrow("could not confirm");
  });
  it("does not claim successful activation when the readback has another role or organization", async () => {
    const deps = dependencies();
    deps.context.mockResolvedValue({ role: "manager", organization });
    expect((await claimStaffInvitation(code, deps)).kind).toBe("existing");
    deps.context.mockResolvedValue({ role: "coach", organization: { id: "other", name: "Other" } });
    expect((await claimStaffInvitation(code, deps)).kind).toBe("existing");
  });
  it("keeps expired invitations recoverable when no membership exists", async () => {
    const deps = dependencies();
    deps.redeem.mockRejectedValue(failure("not-found"));
    deps.context.mockResolvedValue({ role: "none", organization: null });
    await expect(claimStaffInvitation(code, deps)).rejects.toThrow("invalid, expired or already claimed");
  });
  it("keeps the original actionable error if membership reconciliation is unavailable", async () => {
    const deps = dependencies();
    deps.redeem.mockRejectedValue(failure("permission-denied"));
    deps.context.mockRejectedValue(failure("unavailable"));
    await expect(claimStaffInvitation(code, deps)).rejects.toThrow("email address");
  });
  it.each(["before", "verify", "redeem", "context", "recover"])("ignores stale account responses at %s", async stage => {
    const deps = dependencies();
    let current = stage !== "before";
    deps.isCurrent.mockImplementation(() => current);
    if (stage === "verify") deps.refreshVerified.mockImplementation(async () => { current = false; return true; });
    if (stage === "redeem") deps.redeem.mockImplementation(async () => { current = false; return { organizationId: organization.id, role: "coach" }; });
    if (stage === "context") deps.context.mockImplementation(async () => { current = false; return member; });
    if (stage === "recover") {
      deps.redeem.mockRejectedValue(failure("unavailable"));
      deps.context.mockImplementation(async () => { current = false; return member; });
    }
    await expect(claimStaffInvitation(code, deps)).rejects.toThrow(STAFF_ACTIVATION_STALE);
    if (stage === "before" || stage === "verify") expect(deps.redeem).not.toHaveBeenCalled();
  });
});
describe("activation guidance and privacy", () => {
  it("uses a code-free activation return for both verification and password reset", () => {
    expect(staffActionSettings("https://posetek.example")).toEqual({ url: "https://posetek.example/join" });
    expect(staffOrganizationRoute("club & team")).toBe("/organization?orgId=club%20%26%20team");
  });
  it("only offers organization access to canonical manager/coach contexts", () => {
    for (const role of ["none", "player", "admin", "independent"]) expect(activeStaffOrganization({ role, organization })).toBeNull();
    expect(activeStaffOrganization({ role: "coach", organization: null })).toBeNull();
    expect(activeStaffOrganization(member)).toEqual(organization);
  });
  it("distinguishes wrong email, role conflicts and verification without echoing code values", () => {
    expect(staffInvitationError(failure("permission-denied", code))).toMatch(/Use another account/);
    expect(staffInvitationError(failure("failed-precondition", "Verify your email"))).toMatch(/Verify your email/);
    expect(staffInvitationError(failure("failed-precondition", "linked to another roster"))).toMatch(/Ask PoseTek to reconcile/);
    expect(staffInvitationError(failure("not-found", code))).not.toContain(code);
  });
});
