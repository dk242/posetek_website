// The admin predicate, with no Firebase import so it stays cheap to test.
// ADMIN_IDENTITY_CONTRACT.md §1.2 — the same expression the Firestore and
// Storage rules evaluate on the ID token.

/** Anchored, dot-escaped: `nolan@posetek.net.evil.com` does not match. */
const ADMIN_EMAIL = /^[a-z0-9._%+-]+@posetek\.net$/;

/** Lower-case first, so `Nolan@PoseTek.net` is an admin address. */
export function isAdminEmail(email: unknown): boolean {
  return typeof email === "string" && ADMIN_EMAIL.test(email.trim().toLowerCase());
}
