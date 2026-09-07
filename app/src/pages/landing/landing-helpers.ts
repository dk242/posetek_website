// Pure helpers ported from kickai.html (the legacy sign-in page): validation
// messages, the coach-organization modal copy, post-auth destinations, the
// admission-callable payloads and the ?returnTo= allowlist. No Firebase, no
// DOM — everything here is covered by landing-helpers.test.ts.

export type SignupTab = "playerCode" | "organization" | "independent";
export type OrganizationRole = "player" | "coach";
export type CoachOrgAction = "create" | "join";
export interface CoachOrgChoice {
  action: CoachOrgAction;
  value: string;
}

// Generate a random alphanumeric code
export function generateCode(prefix = "", length = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  let result = prefix;
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// MARK: - Signup validation (legacy throw order and copy, byte for byte)

export interface NameAndPasswordFields {
  firstName: string;
  lastName: string;
  password: string;
  confirmPassword: string;
}

/** The two checks shared by the Organization and Coach tabs. */
export function validateNameAndPassword(fields: NameAndPasswordFields): string | null {
  if (!fields.firstName || !fields.lastName) return "Please enter your name";
  if (fields.password !== fields.confirmPassword) return "Passwords don't match";
  return null;
}

export interface OrgSignupFields extends NameAndPasswordFields {
  userType: string;
  orgCode: string;
}

/**
 * Everything handleOrgSignup checks before it opens the coach organization
 * modal / creates the Auth user. A coach passes here and then still has to
 * confirm the organization modal ("Organization setup cancelled" otherwise).
 */
export function validateOrgSignup(fields: OrgSignupFields): string | null {
  const shared = validateNameAndPassword(fields);
  if (shared) return shared;
  if (fields.userType === "player") return fields.orgCode ? null : "Organization code is required for players";
  if (fields.userType === "coach") return null;
  return "Choose player or coach";
}

export interface PlayerCodeSignupFields {
  code: string;
  password: string;
  confirmPassword: string;
}

export function validatePlayerCodeSignup(fields: PlayerCodeSignupFields): string | null {
  if (!fields.code) return "Enter your player code";
  if (fields.password !== fields.confirmPassword) return "Passwords don't match";
  return null;
}

export function validateIndependentSignup(fields: NameAndPasswordFields): string | null {
  return validateNameAndPassword(fields);
}

// MARK: - Coach organization modal copy (legacy goToStep2 / confirm handler)

export function coachOrgInputError(action: CoachOrgAction | null): string {
  return action === "create" ? "Organization name is required." : "Organization code is required.";
}

export interface CoachOrgStep2Copy {
  title: string;
  label: string;
  placeholder: string;
}

/** `null` is the modal's initial markup, before either choice was made. */
export function coachOrgStep2Copy(action: CoachOrgAction | null): CoachOrgStep2Copy {
  if (action === "join") return { title: "Join Organization", label: "Organization Code", placeholder: "Enter the code" };
  if (action === "create") return { title: "Organization Name", label: "Organization Name", placeholder: "e.g. Riverside FC" };
  return { title: "Organization Name", label: "Organization Name", placeholder: "" };
}

// MARK: - Post-auth destinations
// Legacy went to coachesview.html / profile.html; those pages are ported, so the
// SPA uses their clean routes with the legacy query strings intact.

/** legacy: coachesview.html?userType=coach */
export function coachHomeRoute(): string {
  return "/roster?userType=coach";
}

/** legacy sign-in: profile.html?player=<id>&userType=player */
export function playerHomeRoute(playerId: string): string {
  return "/athlete?player=" + encodeURIComponent(playerId) + "&userType=player";
}

/** legacy signup: profile.html?userType=player[&player=<id>] */
export function playerSignupRoute(playerId: string | null | undefined): string {
  return "/athlete?userType=player" + (playerId ? "&player=" + encodeURIComponent(playerId) : "");
}

// MARK: - Admission callables (functions/admission.js) — payload shapes

export function redeemPlayerSignupCodePayload(code: string): { code: string } {
  return { code };
}

export function joinOrganizationPayload(
  code: string,
  role: OrganizationRole,
  firstName: string,
  lastName: string,
): { code: string; role: OrganizationRole; firstName: string; lastName: string } {
  return { code, role, firstName, lastName };
}

export function createOrganizationPayload(
  name: string,
  firstName: string,
  lastName: string,
): { name: string; firstName: string; lastName: string } {
  return { name, firstName, lastName };
}

/** legacy: `result && result.data ? result.data.playerId : null` */
export function playerIdFromRedeemResult(result: unknown): string | null {
  const data = result && typeof result === "object" ? (result as { data?: unknown }).data : null;
  const playerId = data && typeof data === "object" ? (data as { playerId?: unknown }).playerId : null;
  return playerId ? String(playerId) : null;
}

// MARK: - ?returnTo=

// Athlete result links return here when the viewer is signed out. Only allow the
// same-origin result pages so an external URL cannot turn login into an open redirect.
// (Allowlist copied byte-for-byte from kickai.html.)
const RETURN_TO_ALLOWED = new Set([
  "profile.html",
  "coachesview.html",
  "broadJumpPage.html",
  "changeOfDirectionPage.html",
  "dribblingPage.html",
  "kickingview.html",
  "sprintPage.html",
  "StaticJumpPage.html",
  "freeRecordPage.html",
]);

// Clean SPA routes that alias the allowlisted legacy pages (see app/src/App.tsx).
// Ported pages redirect signed-out visitors here with these as returnTo values.
const RETURN_TO_ALLOWED_PATHS = new Set([
  "/athlete",
  "/roster",
  "/drills/broad-jump",
  "/drills/change-of-direction",
  "/drills/dribbling",
]);

export function getSafeReturnToUrl(
  search: string = window.location.search,
  baseHref: string = window.location.href,
  origin: string = window.location.origin,
): string | null {
  const raw = new URLSearchParams(search).get("returnTo");
  if (!raw) return null;
  try {
    const target = new URL(raw, baseHref);
    const fileName = target.pathname.split("/").pop() ?? "";
    const allowed = RETURN_TO_ALLOWED.has(fileName) || RETURN_TO_ALLOWED_PATHS.has(target.pathname);
    return target.origin === origin && allowed ? target.href : null;
  } catch {
    return null;
  }
}
