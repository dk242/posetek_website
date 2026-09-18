import { invitationError, parsePlayerInvitation } from "./signup";
import type { PlayerInvitation } from "./signup";

export interface InvitationView {
  invitation: PlayerInvitation | null;
  pending: "loading" | "generating" | "copying" | null;
  message: string;
  error: boolean;
}
export const loadingInvitation = (): InvitationView => ({ invitation: null, pending: "loading", message: "", error: false });
export interface InvitationPort {
  read(playerId: string): Promise<unknown>;
  ensure(playerId: string): Promise<unknown>;
  copy(text: string): Promise<void>;
  isCurrent(): boolean;
}

/** Lives only inside its mounted control. Disposal invalidates every outstanding response. */
export function invitationController(playerId: string, port: InvitationPort, publish: (view: InvitationView) => void) {
  let view = loadingInvitation(), generation = 0, alive = true;
  const current = (ticket: number) => alive && generation === ticket && port.isCurrent();
  const set = (next: InvitationView) => { view = next; publish(next); };
  async function request(create: boolean) {
    if (!alive || !port.isCurrent() || (create && (view.pending !== null || view.invitation?.status !== "missing"))) return;
    const ticket = ++generation;
    set({ invitation: null, pending: create ? "generating" : "loading", message: "", error: false });
    try {
      const result = await (create ? port.ensure(playerId) : port.read(playerId));
      if (!current(ticket)) return;
      // ensure retains its older success shape for native callers.
      const normalized = create && result && typeof result === "object" && !("status" in result)
        ? { ...result, status: "ready" } : result;
      const invitation = parsePlayerInvitation(normalized, playerId);
      set({ invitation, pending: null, message: create && invitation.status === "ready" ? "Signup link ready to copy." : "", error: false });
    } catch (error) {
      if (!current(ticket)) return;
      // An account may be claimed between lookup and generation. Re-read only
      // this precondition case; permission/network failures remain failures.
      if (create && error && typeof error === "object" && "code" in error
        && ["failed-precondition", "functions/failed-precondition"].includes(String(error.code))) {
        try {
          const refreshed = parsePlayerInvitation(await port.read(playerId), playerId);
          if (!current(ticket)) return;
          if (refreshed.status === "claimed") {
            set({ invitation: refreshed, pending: null, message: "", error: false });
            return;
          }
        } catch (refreshError) {
          if (current(ticket)) set({ invitation: null, pending: null, message: invitationError(refreshError), error: true });
          return;
        }
      }
      if (current(ticket)) set({ invitation: null, pending: null, message: invitationError(error), error: true });
    }
  }
  return {
    load: () => request(false),
    generate: () => request(true),
    async copy(kind: "link" | "code") {
      if (!alive || !port.isCurrent() || view.pending !== null || view.invitation?.status !== "ready") return;
      const ticket = ++generation;
      set({ invitation: null, pending: "copying", message: "Checking invitation…", error: false });
      let invitation: PlayerInvitation;
      try {
        const result = await port.read(playerId);
        if (!current(ticket)) return;
        invitation = parsePlayerInvitation(result, playerId);
      } catch (error) {
        if (current(ticket)) set({ invitation: null, pending: null, message: invitationError(error), error: true });
        return;
      }
      if (!current(ticket)) return;
      if (invitation.status !== "ready") {
        set({ invitation, pending: null, message: "", error: false });
        return;
      }
      try {
        await port.copy(kind === "link" ? invitation.signupUrl : invitation.code);
        if (current(ticket)) set({ invitation, pending: null, message: kind === "link" ? "Signup link copied." : "Signup code copied.", error: false });
      } catch {
        if (current(ticket)) set({ invitation, pending: null, message: "Couldn’t copy. Select the code and share it with the player for signup at posetek.net/signin.", error: true });
      }
    },
    dispose() { alive = false; ++generation; view = loadingInvitation(); },
  };
}
