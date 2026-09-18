/** Roster data never carries invitation secrets into shared account/planner state. */
export function playerSignup(data: unknown): { registered: boolean; signupCode: null } {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  return { registered: record.registered === true || Boolean(record.userUID) || Boolean(record.authenticationUID), signupCode: null };
}

export function withoutSignupSecrets<T extends Record<string, unknown>>(data: T): Omit<T, "signupCode" | "code"> {
  const { signupCode: _signupCode, code: _code, ...publicFields } = data;
  return publicFields;
}

export type PlayerInvitation =
  | { status: "ready"; playerId: string; code: string; signupUrl: string }
  | { status: "missing" | "claimed"; playerId: string };

/** Only the canonical fragment URL is accepted; never put a code in query/referrer data. */
export function playerInvitationUrl(code: string): string {
  if (!/^[A-Za-z0-9-]{6,64}$/.test(code)) throw new Error("The invitation could not be verified.");
  return `https://posetek.net/signin#playerCode=${encodeURIComponent(code)}`;
}

export function parsePlayerInvitation(value: unknown, playerId: string): PlayerInvitation {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (row.playerId !== playerId) throw new Error("The invitation could not be verified.");
  if (row.status === "claimed" || row.status === "missing") return { playerId, status: row.status };
  if (row.status !== "ready" || typeof row.code !== "string") throw new Error("The invitation could not be verified.");
  const signupUrl = playerInvitationUrl(row.code);
  if (row.signupUrl !== undefined && row.signupUrl !== signupUrl) throw new Error("The invitation could not be verified.");
  return { status: "ready", playerId, code: row.code, signupUrl };
}

/** Callable errors can contain arbitrary response text. Keep feedback useful and secret-free. */
export function invitationError(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String(error.code).replace(/^functions\//, "") : "";
  if (code === "permission-denied") return "You do not have permission to manage this player’s invitation.";
  if (code === "unauthenticated") return "Sign in again to manage this player’s invitation.";
  if (code === "failed-precondition") return "This invitation needs review. Contact PoseTek; an existing code has not been replaced.";
  if (code === "not-found") return "This player is no longer available.";
  return "The invitation could not be loaded. Try again.";
}
