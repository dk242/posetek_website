import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { auth } from "../../lib/firebase";
import { clubCall, getClubContext } from "../../lib/organization-data";
import { accountError, authErrorCode } from "../landing/account-entry";
import { activeStaffOrganization, claimStaffInvitation, staffActionSettings, staffOrganizationRoute, STAFF_INVITATION_PATTERN } from "./staff-invitation";
import "../../styles/pose-portal.css";
import "../organization/organization.scss";
import "./staff-invite.scss";

// Codes remain only in this component's memory. Authentication is retained after
// failed claims; only the server can assign membership and team access.
export default function StaffInvitePage() {
  const navigate = useNavigate();
  const [user, setUser] = useState(auth.currentUser);
  const [mode, setMode] = useState<"create" | "signin">("create");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [organization, setOrganization] = useState<{ id: string; name: string } | null>(null);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = auth.onAuthStateChanged(current => {
      const revision = ++epoch.current;
      setUser(current); setOrganization(null); setError(""); setNotice("");
      if (!current) return;
      void getClubContext().then(context => {
        if (mounted.current && epoch.current === revision && auth.currentUser?.uid === current.uid) {
          setOrganization(activeStaffOrganization(context));
        }
      }).catch(() => { /* Claim performs a fresh authoritative check and displays any failure. */ });
    });
    return () => { mounted.current = false; ++epoch.current; unsubscribe(); };
  }, []);
  useEffect(() => { document.title = "Activate staff access | PoseTek"; }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  function currentRequest(uid: string) {
    const revision = epoch.current;
    return () => mounted.current && epoch.current === revision && auth.currentUser?.uid === uid;
  }
  async function authenticate() {
    if (mode === "create" && !STAFF_INVITATION_PATTERN.test(code.trim())) { setError("Enter your staff invitation code before creating an account. Your organization admin supplies this code."); return; }
    if (mode === "create" && password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true); setError(""); setNotice("");
    const initialRevision = epoch.current;
    let isCurrent = () => mounted.current && epoch.current === initialRevision;
    try {
      const credential = mode === "create"
        ? await auth.createUserWithEmailAndPassword(email.trim(), password)
        : await auth.signInWithEmailAndPassword(email.trim(), password);
      if (!credential.user || auth.currentUser?.uid !== credential.user.uid || !mounted.current) return;
      isCurrent = currentRequest(credential.user.uid);
      setPassword(""); setConfirm("");
      if (!credential.user.emailVerified) {
        await credential.user.sendEmailVerification(staffActionSettings(window.location.origin));
        if (isCurrent()) setNotice("Your account is saved. Open the verification email, then return to this page to claim staff access. Keep your invitation code handy.");
      } else if (isCurrent()) setNotice("You are signed in. Enter your invitation code to activate the access assigned to you.");
    } catch (failure) {
      if (!isCurrent()) return;
      if (authErrorCode(failure) === "email-already-in-use") { setMode("signin"); setConfirm(""); }
      setError(accountError(failure, "Your account may have been saved, but we could not complete sign-in or send verification. Check the signed-in email below and try again."));
    } finally { if (mounted.current) setBusy(false); }
  }
  async function claim() {
    const current = auth.currentUser;
    if (!current) { setError("Sign in before claiming your invitation."); return; }
    const isCurrent = currentRequest(current.uid);
    setBusy(true); setError(""); setNotice(""); setOrganization(null);
    try {
      const result = await claimStaffInvitation(code, {
        isCurrent,
        refreshVerified: async () => { await current.reload(); if (!isCurrent()) return false; await current.getIdToken(true); return current.emailVerified; },
        redeem: value => clubCall("redeemClubStaffInvitation", { code: value }),
        context: getClubContext,
      });
      if (!isCurrent()) return;
      if (result.kind === "claimed") {
        setCode(""); navigate(staffOrganizationRoute(result.organization.id), { replace: true });
      } else {
        setOrganization(result.organization);
        setError(result.message);
        setNotice("We could not confirm this invitation. Your account currently has active access to " + result.organization.name + ". You can open that organization below.");
      }
    } catch (failure) { if (isCurrent()) setError(failure instanceof Error ? failure.message : "The invitation could not be claimed. Please try again."); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function resend() {
    const current = auth.currentUser;
    if (!current) return;
    const isCurrent = currentRequest(current.uid);
    setBusy(true); setError(""); setNotice("");
    try {
      await current.sendEmailVerification(staffActionSettings(window.location.origin));
      if (isCurrent()) setNotice("Verification email sent. Its Continue link returns here. Re-enter your invitation code if this page reloads.");
    } catch (failure) { if (isCurrent()) setError(accountError(failure, "The verification email could not be sent. Please try again.")); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function resetPassword() {
    if (!email.trim()) { setError("Enter your invited email above, then choose Reset password."); emailRef.current?.focus(); return; }
    const revision = epoch.current;
    setBusy(true); setError(""); setNotice("");
    try {
      await auth.sendPasswordResetEmail(email.trim(), staffActionSettings(window.location.origin));
      if (mounted.current && epoch.current === revision) setNotice("If this email has an account, a password reset link is on its way. After resetting, return here and sign in.");
    } catch (failure) { if (mounted.current && epoch.current === revision) setError(accountError(failure, "The password reset email could not be sent. Please try again.")); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function switchAccount() {
    setBusy(true);
    try { await auth.signOut(); setPassword(""); setConfirm(""); setMode("signin"); }
    catch (failure) { if (mounted.current) setError(accountError(failure, "Could not sign out. Please try again.")); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <div className="pt-pose portal-body pt-club staff-activation" data-clarity-mask="true">
    <header className="portal-header"><Link className="portal-brand" to="/signin"><span className="portal-brand-mark">P</span>POSETEK</Link><Link className="club-inline-link" to="/signin">Sign in</Link></header>
    <main className="club-shell club-signup">
      <p className="eyebrow">Invited coaches &amp; organization admins</p><h1>Activate your staff access</h1>
      <p>Your organization admin or PoseTek supplies your invitation code. It assigns your role and teams. Organization admins (managers) oversee their own organization.</p>
      <ol className="activation-steps" aria-label="Staff activation steps"><li>Use your invited email</li><li>Verify your email</li><li>Claim staff access</li></ol>
      {error && <p className="club-message error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
      {notice && <p className="club-message" role="status">{notice}</p>}
      {organization && <section className="club-card activation-existing"><h2>Your current organization</h2><p>You have active staff access to <strong>{organization.name}</strong>.</p><Link className="primary-cta" to={staffOrganizationRoute(organization.id)}>Open organization</Link></section>}
      <section className="club-card" aria-label="Staff invitation activation" aria-busy={busy}>
        <label>Staff invitation code<input name="staff-invitation" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={100} disabled={busy} value={code} onChange={event => setCode(event.target.value)} placeholder="CLUB-…" aria-describedby="staff-code-help" /></label>
        <p className="activation-help" id="staff-code-help">Use the full code shared with you. Keep it handy: it is not saved in this browser or included in email links.</p>
        {!user ? <form onSubmit={event => { event.preventDefault(); void authenticate(); }}>
          <label>Account<select disabled={busy} value={mode} onChange={event => { setMode(event.target.value as "create" | "signin"); setError(""); }}><option value="create">Create an account with my invited email</option><option value="signin">Sign in to my existing account</option></select></label>
          <label>Invited email<input ref={emailRef} name="email" type="email" inputMode="email" spellCheck={false} required autoComplete="email" disabled={busy} value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label>Password<input name="password" type="password" required minLength={6} autoComplete={mode === "create" ? "new-password" : "current-password"} disabled={busy} value={password} onChange={event => setPassword(event.target.value)} /></label>
          {mode === "create" && <label>Confirm password<input name="confirm-password" type="password" required minLength={6} autoComplete="new-password" disabled={busy} value={confirm} onChange={event => setConfirm(event.target.value)} /></label>}
          <button className="primary-cta" disabled={busy}>{busy ? "Please wait…" : mode === "create" ? "Create account and verify email" : "Sign in to activate"}</button>
          <button type="button" className="quiet-button" disabled={busy} onClick={() => { void resetPassword(); }}>Reset password</button>
        </form> : <>
          <p>Signed in as <strong>{user.email}</strong></p><p>Use the exact email that was invited. After verifying it, claim your invitation to activate staff access.</p>
          <button className="primary-cta" disabled={busy || !code.trim()} onClick={() => { void claim(); }}>{busy ? "Please wait…" : "Claim staff access"}</button>
          <div className="activation-actions"><button className="quiet-button" disabled={busy} onClick={() => { void resend(); }}>Resend verification email</button><button className="quiet-button" disabled={busy} onClick={() => { void switchAccount(); }}>Use another account</button></div>
        </>}
      </section>
      <p className="activation-footer">Joining as a player? <Link className="club-inline-link" to="/signin">Use your player signup code</Link>. Already activated? <Link className="club-inline-link" to="/signin">Sign in to PoseTek</Link>.</p>
    </main>
  </div>;
}
