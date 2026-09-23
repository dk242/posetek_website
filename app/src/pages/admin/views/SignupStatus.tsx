import { useEffect, useRef, useState } from "react";
import { auth } from "../../../lib/firebase";
import { clubCall } from "../../../lib/organization-data";
import { invitationController, loadingInvitation } from "../lib/invitation";
import type { InvitationView } from "../lib/invitation";

interface SignupProps {
  playerId: string;
  playerName: string;
  registered?: boolean;
  /** Parent roster replacement/refresh invalidates the fetched invitation. */
  reloadKey?: unknown;
  variant?: "admin" | "club";
  disabled?: boolean;
}
export default function SignupStatus({ playerId, playerName, registered = false, reloadKey, variant = "admin", disabled = false }: SignupProps) {
  const [result, setResult] = useState<{ playerId: string; uid: string | null; reloadKey: unknown; view: InvitationView } | null>(null);
  const controller = useRef<ReturnType<typeof invitationController> | null>(null);
  useEffect(() => {
    const stop = auth.onAuthStateChanged(user => {
      controller.current?.dispose(); controller.current = null;
      const uid = user?.uid ?? null;
      setResult(null);
      if (!uid) {
        setResult({ playerId, uid, reloadKey, view: { invitation: null, pending: null, message: "Sign in again to manage this player’s invitation.", error: true } });
        return;
      }
      if (registered) return;
      const instance = invitationController(playerId, {
        read: id => clubCall("getPlayerSignupInvitation", { playerId: id }),
        ensure: id => clubCall("ensurePlayerSignupInvitation", { playerId: id }),
        copy: text => navigator.clipboard.writeText(text),
        isCurrent: () => auth.currentUser?.uid === uid,
      }, view => setResult({ playerId, uid, reloadKey, view }));
      controller.current = instance;
      void instance.load();
    });
    return () => { stop(); controller.current?.dispose(); controller.current = null; };
  }, [playerId, registered, reloadKey]);
  const matches = result?.playerId === playerId && result.uid === (auth.currentUser?.uid ?? null) && result.reloadKey === reloadKey;
  const view = registered ? { invitation: { status: "claimed" as const, playerId }, pending: null, message: "", error: false }
    : matches ? result.view : loadingInvitation();
  return <SignupInvitationControls playerName={playerName} view={view} variant={variant} disabled={disabled}
    onGenerate={() => void controller.current?.generate()} onRetry={() => void controller.current?.load()}
    onCopy={kind => void controller.current?.copy(kind)} />;
}

/** The same compact actions serve roster rows and the organization invitation card. */
export function SignupInvitationControls({ playerName, view, variant = "admin", disabled = false, onGenerate, onRetry, onCopy }: {
  playerName: string; view: InvitationView; variant?: "admin" | "club"; disabled?: boolean;
  onGenerate: () => void; onRetry: () => void; onCopy: (kind: "link" | "code") => void;
}) {
  const invitation = view.invitation;
  const buttonClass = variant === "admin" ? "quiet-button small admin-copy-code" : "quiet-button small";
  return <div className={variant === "admin" ? "admin-signup" : "club-player-invitation"}>
    {invitation?.status === "claimed" ? <span className="admin-code-unavailable">Account already claimed. The player can sign in with their existing account.</span> : <>
      {variant === "admin" && <span className="admin-chip warn">Awaiting signup</span>}
      {view.pending === "loading" && <span className="admin-code-unavailable" role="status">Checking invitation…</span>}
      {view.pending === "generating" && <span className="admin-code-unavailable" role="status">Generating code…</span>}
      {invitation?.status === "missing" && <button className={buttonClass} type="button" disabled={disabled || view.pending !== null} aria-label={`Generate signup code for ${playerName}`} onClick={onGenerate}>Generate code</button>}
      {invitation?.status === "ready" && <>
        <code className="admin-signup-code" data-clarity-mask="true" aria-label={`Signup code for ${playerName}`}>{invitation.code}</code>
        <button className={buttonClass} type="button" aria-label={`Copy signup link for ${playerName}`} disabled={disabled || view.pending !== null} onClick={() => onCopy("link")}>Copy signup link</button>
        <button className={buttonClass} type="button" aria-label={`Copy signup code for ${playerName}`} disabled={disabled || view.pending !== null} onClick={() => onCopy("code")}>Copy code</button>
      </>}
      {!invitation && view.error && <button className={buttonClass} type="button" disabled={disabled || view.pending !== null} onClick={onRetry}>Retry invitation</button>}
    </>}
    {view.message && <span className={view.error ? "admin-copy-error" : "admin-code-unavailable"} role="status">{view.message}</span>}
  </div>;
}
