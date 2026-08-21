// Pure helpers ported verbatim from kickai.html (the legacy landing/sign-in page).

// Generate a random alphanumeric code
export function generateCode(prefix = "", length = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  let result = prefix;
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

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

export function redirectAfterAuth(fallback: string): void {
  window.location.href = getSafeReturnToUrl() || fallback;
}
