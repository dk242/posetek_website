import { accountError, authErrorCode } from "../landing/account-entry";

export const STAFF_INVITATION_PATTERN = /^CLUB-[A-F0-9]{32}$/i;
export const STAFF_ACTIVATION_STALE = "Staff activation changed. Please try again.";
export interface StaffContext {
  role: string;
  organization: { id: string; name: string } | null;
}
export function activeStaffOrganization(context: StaffContext): { id: string; name: string } | null {
  return (context.role === "manager" || context.role === "coach") && context.organization?.id ? context.organization : null;
}
export function staffActionSettings(origin: string): { url: string } {
  // Invitation codes, email addresses and arbitrary returnTo values never enter email links.
  return { url: new URL("/join", origin).href };
}
export function staffOrganizationRoute(organizationId: string): string {
  return "/organization?orgId=" + encodeURIComponent(organizationId);
}
export function staffInvitationError(error: unknown): string {
  const code = authErrorCode(error);
  if (code === "not-found") return "This invitation is invalid, expired or already claimed. Check the code with your organization admin. If you already activated access, sign in to open your organization.";
  if (code === "permission-denied") return "Use the email address your organization admin invited. Choose Use another account if you are signed in with a different email.";
  if (code === "already-exists") return "This account already has staff access, or the organization has reached its staff limit. Ask your organization admin to check.";
  if (code === "failed-precondition") {
    const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
    return /verify your email/i.test(message) ? "Verify your email using the link in your inbox, then claim your invitation."
      : "This account is already linked to a player, roster or organization, or its invitation needs review. Ask PoseTek to reconcile access; your account has been kept.";
  }
  return accountError(error, "We could not confirm this invitation. Your account has been kept. Check your connection and try claiming again.");
}

export interface StaffClaimDependencies {
  isCurrent(): boolean;
  refreshVerified(): Promise<boolean>;
  redeem(code: string): Promise<{ organizationId: string; role: string }>;
  context(organizationId?: string): Promise<StaffContext>;
}
export type StaffClaimResult = { kind: "claimed"; organization: { id: string; name: string } }
  | { kind: "existing"; organization: { id: string; name: string }; message: string };

/** A rejected/lost acknowledgement never becomes claimed-success based on unrelated membership. */
export async function claimStaffInvitation(code: string, deps: StaffClaimDependencies): Promise<StaffClaimResult> {
  const current = () => { if (!deps.isCurrent()) throw new Error(STAFF_ACTIVATION_STALE); };
  current();
  if (!STAFF_INVITATION_PATTERN.test(code.trim())) throw new Error("Enter the full staff invitation code supplied by your organization admin (CLUB-…).");
  const verified = await deps.refreshVerified();
  current();
  if (!verified) throw new Error("Verify your email using the link in your inbox, then claim your invitation.");
  try {
    const result = await deps.redeem(code.trim());
    current();
    const context = await deps.context(result.organizationId);
    current();
    const organization = activeStaffOrganization(context);
    if (!organization || organization.id !== result.organizationId || context.role !== result.role) throw new Error("Membership could not be confirmed.");
    return { kind: "claimed", organization };
  } catch (failure) {
    current();
    let existing: StaffContext | null = null;
    try { existing = await deps.context(); } catch { /* Keep the original error and allow a safe retry. */ }
    current();
    const organization = existing && activeStaffOrganization(existing);
    if (organization) return { kind: "existing", organization, message: staffInvitationError(failure) };
    throw new Error(staffInvitationError(failure));
  }
}
