// Invitation secrets stay in memory. New links use fragments, which are not
// sent to the server; legacy query links are removed before React/analytics run.
export type PlayerInvitationLink = { present: boolean; code: string };
let captured: PlayerInvitationLink = { present: false, code: "" };

export function readPlayerInvitationLink(href: string): { invitation: PlayerInvitationLink; cleanUrl: string } {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const values = [...url.searchParams.getAll("playerCode"), ...fragment.getAll("playerCode")];
  const present = values.length > 0 && ["/signin", "/kickai.html"].includes(url.pathname);
  if (!present) return { invitation: { present: false, code: "" }, cleanUrl: url.href };
  const normalized = values.map(value => value.trim());
  const code = normalized.every(value => value === normalized[0]) && /^[A-Za-z0-9-]{6,64}$/.test(normalized[0]) ? normalized[0] : "";
  url.searchParams.delete("playerCode");
  fragment.delete("playerCode");
  url.hash = fragment.toString();
  return { invitation: { present, code }, cleanUrl: url.href };
}

export function capturePlayerInvitationLink(browser: Pick<Window, "location" | "history">): void {
  const result = readPlayerInvitationLink(browser.location.href);
  if (result.invitation.present) {
    captured = result.invitation;
    browser.history.replaceState(browser.history.state, "", result.cleanUrl);
  }
}

export function initialPlayerInvitationLink(): PlayerInvitationLink { return captured; }
export function forgetPlayerInvitationLink(): void { captured = { present: false, code: "" }; }

export const unavailablePlayerInvitation = "This player code is invalid or has already been used. If you already created your account, sign in. Otherwise, ask your coach for your current signup link.";

type SignupUser = { uid: string };
export interface PlayerSignupSteps<U extends SignupUser> {
  currentUser(): U | null;
  validate(code: string): Promise<boolean>;
  create(email: string, password: string): Promise<U>;
  verify(user: U): Promise<void>;
  redeem(code: string): Promise<{ data?: { playerId?: string } }>;
  discard(user: U): Promise<void>;
  resolve(user: U): Promise<string | null>;
  created?(user: U): void;
}

// Preflight prevents invalid/used invitations from creating an Auth account.
// Redemption remains authoritative if another claim wins after the preflight.
export async function createInvitedPlayer<U extends SignupUser>(
  input: { code: string; email: string; password: string }, steps: PlayerSignupSteps<U>, pending?: U | null,
): Promise<string> {
  if (pending) {
    if (steps.currentUser()?.uid !== pending.uid) throw new Error("Your sign-in changed. Sign in with the account you just created to continue.");
    const playerId = await steps.resolve(pending);
    if (steps.currentUser()?.uid !== pending.uid) throw new Error("Your sign-in changed. Sign in with the account you just created to continue.");
    if (playerId) return playerId;
  } else if (steps.currentUser()) throw new Error("You are already signed in. Sign out before creating another account.");
  const code = input.code.trim();
  if (!/^[A-Za-z0-9-]{6,64}$/.test(code) || !await steps.validate(code)) throw new Error(unavailablePlayerInvitation);
  // Auth may have changed while the read-only preflight was pending.
  if (pending ? steps.currentUser()?.uid !== pending.uid : steps.currentUser()) throw new Error("Your sign-in changed. Sign out before creating another account.");
  let created: U | null = pending || null;
  let redeemed = false;
  let attempted = false;
  try {
    if (!created) {
      created = await steps.create(input.email.trim(), input.password);
      steps.created?.(created);
    }
    await steps.verify(created);
    if (steps.currentUser()?.uid !== created.uid) throw new Error("Your sign-in changed. Sign in with the account you just created to continue.");
    attempted = true;
    const result = await steps.redeem(code);
    redeemed = true;
    if (steps.currentUser()?.uid !== created.uid) throw new Error("Your account was created. Sign in with that account to open your athlete profile.");
    const playerId = result.data?.playerId;
    if (typeof playerId !== "string" || !playerId) throw new Error("Your account was created. Sign in to open your athlete profile.");
    return playerId;
  } catch (error) {
    // A lost response may follow a successful claim. Reconcile ownership before
    // cleanup, and retain the new account if the outcome cannot be established.
    if (created && attempted && !redeemed) {
      let resolved: string | null;
      try { resolved = await steps.resolve(created); }
      catch { throw new Error("Your account was created, but its profile link could not be confirmed. Keep this page open and try Create Account again when your connection is available."); }
      if (resolved && steps.currentUser()?.uid === created.uid) return resolved;
      if (resolved) throw new Error("Your account was created. Sign in with that account to open your athlete profile.");
      const code = (error as { code?: string })?.code || "";
      if (!["functions/not-found", "functions/invalid-argument", "functions/failed-precondition", "functions/permission-denied"].includes(code)) {
        throw new Error("Your account was created, but linking could not be confirmed. Keep this page open and try Create Account again when your connection is available.");
      }
    }
    // Never delete an existing account or one whose profile was already claimed.
    if (created && !pending && !redeemed) await steps.discard(created);
    throw error;
  }
}
