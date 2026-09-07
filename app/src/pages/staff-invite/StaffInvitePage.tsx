import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { auth } from "../../lib/firebase";
import { clubCall } from "../../lib/organization-data";
import "../../styles/pose-portal.css";
import "../organization/organization.scss";

// Invitation claim is resumable. Verification or a failed code never deletes
// an existing Auth account, and the server assigns the invited role.
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
  useEffect(() => auth.onAuthStateChanged(setUser), []);
  useEffect(() => { document.title = "Claim staff invitation | PoseTek"; }, []);
  async function authenticate() {
    if (mode === "create" && password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const credential = mode === "create"
        ? await auth.createUserWithEmailAndPassword(email.trim(), password)
        : await auth.signInWithEmailAndPassword(email.trim(), password);
      setPassword(""); setConfirm("");
      if (!credential.user?.emailVerified) {
        await credential.user?.sendEmailVerification();
        setNotice("Open the verification email, then return here and claim your invitation. Your account has been saved.");
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Sign-in could not be completed."); }
    finally { setBusy(false); }
  }
  async function claim() {
    setBusy(true); setError(""); setNotice("");
    try {
      const current = auth.currentUser;
      if (!current) throw new Error("Sign in before claiming your invitation.");
      await current.reload();
      await current.getIdToken(true);
      if (!auth.currentUser?.emailVerified) throw new Error("Verify your email using the link in your inbox, then try again.");
      await clubCall("redeemClubStaffInvitation", { code: code.trim() });
      setCode(""); navigate("/organization", { replace: true });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The invitation could not be claimed."); }
    finally { setBusy(false); }
  }
  async function resend() {
    setBusy(true); setError("");
    try { await auth.currentUser?.sendEmailVerification(); setNotice("Verification email sent. Open the link, then return here."); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The email could not be sent."); }
    finally { setBusy(false); }
  }
  return <div className="pt-pose portal-body pt-club"><header className="portal-header"><Link className="portal-brand" to="/signin"><span className="portal-brand-mark">P</span>POSETEK</Link></header><main className="club-shell club-signup"><p className="eyebrow">Coaches and organization managers</p><h1>Join your organization</h1><p>Use the email address and invitation code provided by your administrator. Your invitation includes your role and teams.</p>
    {error && <p className="club-message error" role="alert">{error}</p>}{notice && <p className="club-message" role="status">{notice}</p>}
    <section className="club-card"><label>Staff invitation code<input autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={100} value={code} onChange={event => setCode(event.target.value)} placeholder="CLUB-…" /></label>
      {!user ? <form onSubmit={event => { event.preventDefault(); void authenticate(); }}><label>Account<select value={mode} onChange={event => setMode(event.target.value as "create" | "signin")}><option value="create">Create an account</option><option value="signin">Use my existing account</option></select></label><label>Invited email<input type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label><label>Password<input type="password" required minLength={6} autoComplete={mode === "create" ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} /></label>{mode === "create" && <label>Confirm password<input type="password" required minLength={6} autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} /></label>}<button className="primary-cta" disabled={busy}>{mode === "create" ? "Create account and verify email" : "Sign in"}</button></form>
        : <><p>Signed in as <strong>{user.email}</strong></p><p>After verifying your email, claim the invitation to link this account.</p><button className="primary-cta" disabled={busy || !code.trim()} onClick={() => void claim()}>I verified my email — claim invitation</button><p><button className="quiet-button" disabled={busy} onClick={() => void resend()}>Resend verification email</button></p><button className="quiet-button" disabled={busy} onClick={() => { void auth.signOut(); }}>Use another account</button></>}
    </section><p>Players use their player code on the <Link className="club-inline-link" to="/signin">regular signup page</Link>.</p></main></div>;
}
