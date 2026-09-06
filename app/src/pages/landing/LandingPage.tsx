// Port of kickai.html — the product landing + sign-in page (the auth target of
// the whole site). Behavior parity with the legacy page: same markup/classes,
// same Firebase reads/writes, same error messages, and identical ?returnTo=
// handling (see landing-helpers.ts). Post-auth navigation uses full
// window.location assignments to the same relative .html URLs the legacy page
// used; the SPA serves alias routes for the ported ones.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import firebase, { auth, db } from "../../lib/firebase";
import { useThemeColor } from "../../lib/use-theme-color";
import { getSafeReturnToUrl, redirectAfterAuth } from "./landing-helpers";
import { refreshAdminIdentity, sendAdminVerification, upsertAdminProfile } from "../admin/lib/identity";
import {
  createCoachDocument,
  createOrganization,
  createPlayerDocument,
  findOrganizationByCode,
  findPlayerByCode,
} from "./signup-data";
import "./landing.scss";

type SignupTab = "playerCode" | "organization" | "independent";
type CoachOrgAction = "create" | "join";
interface CoachOrgChoice {
  action: CoachOrgAction;
  value: string;
}

// Legacy showModal/hideModal toggled scrolling on document.body.
function lockScroll() {
  document.body.style.overflow = "hidden";
}
function unlockScroll() {
  document.body.style.overflow = "auto";
}

export default function LandingPage() {
  useThemeColor(null); // legacy kickai.html had no theme-color meta
  // Auth state (drives the Login/Logout nav button, like legacy onAuthStateChanged)
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Modal visibility
  const [loginOpen, setLoginOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [coachOrgOpen, setCoachOrgOpen] = useState(false);

  // Signup tabs
  const [activeTab, setActiveTab] = useState<SignupTab>("playerCode");

  // Login form
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginSuccess, setLoginSuccess] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Player-code signup form
  const [playerCode, setPlayerCode] = useState("");
  const [playerEmail, setPlayerEmail] = useState("");
  const [playerPassword, setPlayerPassword] = useState("");
  const [playerConfirmPassword, setPlayerConfirmPassword] = useState("");
  const [playerCodeError, setPlayerCodeError] = useState("");
  const [playerCodeSuccess, setPlayerCodeSuccess] = useState("");
  const [playerCodeLoading, setPlayerCodeLoading] = useState(false);

  // Organization signup form
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [userType, setUserType] = useState("");
  const [orgCode, setOrgCode] = useState("");
  const [orgSignupError, setOrgSignupError] = useState("");
  const [orgSignupSuccess, setOrgSignupSuccess] = useState("");
  const [orgSignupLoading, setOrgSignupLoading] = useState(false);

  // Independent (coach) signup form
  const [indFirstName, setIndFirstName] = useState("");
  const [indLastName, setIndLastName] = useState("");
  const [indEmail, setIndEmail] = useState("");
  const [indPassword, setIndPassword] = useState("");
  const [indConfirmPassword, setIndConfirmPassword] = useState("");
  const [independentError, setIndependentError] = useState("");
  const [independentSuccess, setIndependentSuccess] = useState("");
  const [independentLoading, setIndependentLoading] = useState(false);

  // Forgot-password modal (promise-based, like legacy showForgotPasswordModal)
  const [forgotEmail, setForgotEmail] = useState("");
  const forgotResolver = useRef<((value: string | null) => void) | null>(null);
  const forgotInputRef = useRef<HTMLInputElement>(null);

  // Coach organization setup modal (promise-based, like legacy showCoachOrgModal)
  const [coachOrgStep, setCoachOrgStep] = useState<1 | 2>(1);
  const [coachOrgAction, setCoachOrgAction] = useState<CoachOrgAction | null>(null);
  const [coachOrgInput, setCoachOrgInput] = useState("");
  const [coachOrgError, setCoachOrgError] = useState("");
  const coachOrgResolver = useRef<((value: CoachOrgChoice | null) => void) | null>(null);
  const coachOrgInputRef = useRef<HTMLInputElement>(null);
  // Post-signup redirect timer: legacy full page loads implicitly cancelled it;
  // in the SPA it must not fire after the user navigates away from this page.
  const redirectTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(redirectTimerRef.current), []);

  // Microsoft Clarity — injected from this page only (legacy had it inline in
  // kickai.html's <head>). Guarded so React StrictMode's double effect run (and
  // revisiting the page) cannot inject it twice.
  useEffect(() => {
    document.title = "PoseTek - Soccer Performance Analytics";
    const w = window as any;
    if (w.clarity || document.querySelector('script[src^="https://www.clarity.ms/tag/"]')) return;
    w.clarity =
      w.clarity ||
      function () {
        // eslint-disable-next-line prefer-rest-params
        (w.clarity.q = w.clarity.q || []).push(arguments);
      };
    const t = document.createElement("script");
    t.async = true;
    t.src = "https://www.clarity.ms/tag/w8lex8gzl7";
    const y = document.getElementsByTagName("script")[0];
    if (y && y.parentNode) y.parentNode.insertBefore(t, y);
    else document.head.appendChild(t);
  }, []);

  // Restore body scroll if the page unmounts with a modal open.
  useEffect(() => {
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Check auth state to update UI (and auto-open login when a safe returnTo is present)
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user: any) => {
      setCurrentUser(user);
      if (!user && getSafeReturnToUrl()) {
        lockScroll();
        setLoginOpen(true);
      }
    });
    return unsubscribe;
  }, []);

  // Close login/signup modals with Escape key (legacy document keydown handler)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (loginOpen) {
          unlockScroll();
          setLoginOpen(false);
        }
        if (signupOpen) {
          unlockScroll();
          setSignupOpen(false);
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [loginOpen, signupOpen]);

  function openLoginModal() {
    lockScroll();
    setLoginOpen(true);
  }
  function closeLoginModal() {
    unlockScroll();
    setLoginOpen(false);
  }
  function openSignupModal() {
    lockScroll();
    setSignupOpen(true);
    // Reset to first tab when opening modal (legacy clicked the first .tab)
    setActiveTab("playerCode");
  }
  function closeSignupModal() {
    unlockScroll();
    setSignupOpen(false);
  }

  // Promise-based forgot password modal
  function showForgotPasswordModal(prefillEmail?: string): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      forgotResolver.current = resolve;
      setForgotEmail(prefillEmail || "");
      lockScroll();
      setForgotOpen(true);
      setTimeout(() => {
        if (!prefillEmail) forgotInputRef.current?.focus();
      }, 300);
    });
  }
  function finishForgotModal(value: string | null) {
    unlockScroll();
    setForgotOpen(false);
    const resolve = forgotResolver.current;
    forgotResolver.current = null;
    if (resolve) resolve(value);
  }
  function handleForgotConfirm() {
    const val = forgotEmail.trim();
    if (val) finishForgotModal(val);
  }

  // Promise-based coach org modal
  function showCoachOrgModal(): Promise<CoachOrgChoice | null> {
    return new Promise<CoachOrgChoice | null>((resolve) => {
      coachOrgResolver.current = resolve;
      setCoachOrgStep(1);
      setCoachOrgAction(null);
      setCoachOrgInput("");
      setCoachOrgError("");
      lockScroll();
      setCoachOrgOpen(true);
    });
  }
  function finishCoachOrgModal(value: CoachOrgChoice | null) {
    unlockScroll();
    setCoachOrgOpen(false);
    const resolve = coachOrgResolver.current;
    coachOrgResolver.current = null;
    if (resolve) resolve(value);
  }
  function goToCoachOrgStep2(action: CoachOrgAction) {
    setCoachOrgAction(action);
    setCoachOrgError("");
    setCoachOrgInput("");
    setCoachOrgStep(2);
    setTimeout(() => coachOrgInputRef.current?.focus(), 150);
  }
  function handleCoachOrgConfirm() {
    const val = coachOrgInput.trim();
    if (!val) {
      setCoachOrgError(
        coachOrgAction === "create" ? "Organization name is required." : "Organization code is required.",
      );
      return;
    }
    finishCoachOrgModal({ action: coachOrgAction as CoachOrgAction, value: val });
  }

  // Login handler (legacy loginForm submit)
  async function handleLogin() {
    const email = loginEmail;
    const password = loginPassword;

    try {
      setLoginLoading(true);
      const userCredential = await auth.signInWithEmailAndPassword(email, password);
      const user: any = userCredential.user;

      // PoseTek admin branch — FIRST, before any coach/player query
      // (ADMIN_IDENTITY_CONTRACT.md §2.2). An @posetek.net address must never
      // fall through to the cascade below: its Auth-UID fallback would resolve
      // a staff account as a player and point every upload at players/{adminUid}.
      const identity = await refreshAdminIdentity(user);
      if (identity.adminDomain) {
        if (!identity.isAdmin) {
          // A domain match on an UNVERIFIED address is not admin (§1.3): send
          // the verification (at most one per ten minutes), say so, sign out.
          let sent = false;
          try {
            sent = await sendAdminVerification(user);
          } catch {
            sent = false;
          }
          await auth.signOut();
          setLoginError(
            sent
              ? "Verify your PoseTek email, then sign in again — we just sent you a link."
              : "Verify your PoseTek email, then sign in again. A verification link was already sent recently; check your inbox and spam folder.",
          );
          return;
        }
        await upsertAdminProfile(identity);
        window.location.href = "/admin";
        return;
      }

      // Check both coach and player documents for the user's UID
      const coachQuery = await db.collection("coaches").where("userUID", "==", user.uid).limit(1).get();

      let playerQuery = await db.collection("players").where("authenticationUID", "==", user.uid).limit(1).get();
      if (playerQuery.empty) {
        playerQuery = await db.collection("players").where("userUID", "==", user.uid).limit(1).get();
      }
      if (playerQuery.empty && user.email) {
        playerQuery = await db.collection("players").where("signupEmail", "==", user.email).limit(1).get();
      }

      if (coachQuery.empty && playerQuery.empty) {
        throw new Error("Account not found in system");
      }

      // Determine user type and redirect accordingly
      if (!coachQuery.empty) {
        const coachDoc = coachQuery.docs[0];

        // Update last login
        await db.collection("coaches").doc(coachDoc.id).update({
          lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
        });
        redirectAfterAuth("coachesview.html?userType=coach");
      } else {
        // Player logic
        const playerDoc = playerQuery.docs[0];
        await db.collection("players").doc(playerDoc.id).update({
          lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
        });
        redirectAfterAuth("profile.html?player=" + playerDoc.id + "&userType=player");
      }
    } catch (error: any) {
      setLoginError(error.message);
    } finally {
      setLoginLoading(false);
    }
  }

  // Resend verification email
  async function handleResendVerification() {
    const user = auth.currentUser;
    if (user) {
      setLoginLoading(true);
      try {
        await user.sendEmailVerification();
        setLoginSuccess("Verification email resent!");
      } catch (error: any) {
        setLoginError(error.message);
      } finally {
        setLoginLoading(false);
      }
    }
  }

  // Password Reset
  async function handleForgotPassword() {
    const existing = loginEmail.trim();
    const email = existing || (await showForgotPasswordModal());
    if (email) {
      setLoginLoading(true);
      try {
        await auth.sendPasswordResetEmail(email);
        setLoginSuccess("Password reset email sent. Please check your inbox.");
      } catch (error: any) {
        setLoginError(error.message);
      } finally {
        setLoginLoading(false);
      }
    }
  }

  // Organization signup handler
  async function handleOrgSignup() {
    const firstNameVal = firstName.trim();
    const lastNameVal = lastName.trim();
    const email = signupEmail;
    const password = signupPassword;
    const confirmPasswordVal = confirmPassword;
    const userTypeVal = userType;
    const orgCodeVal = orgCode;

    try {
      setOrgSignupLoading(true);
      setOrgSignupError("");
      setOrgSignupSuccess("");

      if (!firstNameVal || !lastNameVal) throw new Error("Please enter your name");
      if (password !== confirmPasswordVal) throw new Error("Passwords don't match");

      // Create user in Firebase Auth
      const userCredential = await auth.createUserWithEmailAndPassword(email, password);
      const user: any = userCredential.user;
      await user.sendEmailVerification();

      let orgRef: any = null;

      if (userTypeVal === "player") {
        if (!orgCodeVal) throw new Error("Organization code is required for players");

        // Find organization by code
        const org = await findOrganizationByCode(orgCodeVal);
        if (!org) throw new Error("Organization not found - check your code");
        orgRef = org.ref;

        // Create player document
        await createPlayerDocument(user.uid, email, firstNameVal, lastNameVal, null, orgRef);

        // Add player to organization's players list
        await orgRef.update({
          players: firebase.firestore.FieldValue.arrayUnion(user.uid),
        });

        // Redirect to profile
        window.location.href = "profile.html?userType=player";
      } else if (userTypeVal === "coach") {
        const coachSetup = await showCoachOrgModal();
        if (!coachSetup) throw new Error("Organization setup cancelled");

        if (coachSetup.action === "create") {
          orgRef = await createOrganization(coachSetup.value, user.uid);
        } else {
          const org = await findOrganizationByCode(coachSetup.value);
          if (!org) throw new Error("Organization not found — check your code");
          orgRef = org.ref;
        }

        // Create coach document
        await createCoachDocument(user.uid, email, firstNameVal, lastNameVal, orgRef);

        // Add coach to organization's coaches list
        await orgRef.update({
          coaches: firebase.firestore.FieldValue.arrayUnion(user.uid),
        });

        // Redirect to coach dashboard
        window.location.href = "coachesview.html?userType=coach";
      }
    } catch (error: any) {
      console.error("Signup error:", error);
      setOrgSignupError(error.message);
    } finally {
      setOrgSignupLoading(false);
    }
  }

  // Player code signup handler
  async function handlePlayerCodeSignup() {
    const code = playerCode.trim();
    const email = playerEmail;
    const password = playerPassword;
    const confirmPasswordVal = playerConfirmPassword;

    try {
      setPlayerCodeLoading(true);
      setPlayerCodeError("");
      setPlayerCodeSuccess("");

      console.log("[handlePlayerCodeSignup] Code entered (raw):", code);
      if (password !== confirmPasswordVal) throw new Error("Passwords don't match");

      const player = await findPlayerByCode(code);
      console.log("[handlePlayerCodeSignup] Player lookup result:", player);
      if (!player) throw new Error("Invalid player code");

      console.log("[handlePlayerCodeSignup] registered field value:", player.registered, "| type:", typeof player.registered);
      if (player.registered === true) throw new Error("Player already signed up");

      console.log("[handlePlayerCodeSignup] Creating Firebase Auth user...");
      const userCredential = await auth.createUserWithEmailAndPassword(email, password);
      const user: any = userCredential.user;
      console.log("[handlePlayerCodeSignup] Auth user created, uid:", user.uid);
      await user.sendEmailVerification();

      console.log("[handlePlayerCodeSignup] Updating player doc id:", player.id);
      await db.collection("players").doc(player.id).update({
        authenticationUID: user.uid,
        userUID: user.uid,
        registered: true,
        email: email,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      console.log("[handlePlayerCodeSignup] Player doc updated successfully");

      setPlayerCodeSuccess("Account created successfully!");

      redirectTimerRef.current = window.setTimeout(() => {
        window.location.href = "profile.html?userType=player";
      }, 1500);
    } catch (error: any) {
      console.error("Signup error:", error);
      setPlayerCodeError(error.message);
    } finally {
      setPlayerCodeLoading(false);
    }
  }

  // Independent signup handler
  async function handleIndependentSignup() {
    const firstNameVal = indFirstName.trim();
    const lastNameVal = indLastName.trim();
    const email = indEmail;
    const password = indPassword;
    const confirmPasswordVal = indConfirmPassword;

    try {
      setIndependentLoading(true);
      setIndependentError("");
      setIndependentSuccess("");

      if (!firstNameVal || !lastNameVal) throw new Error("Please enter your name");
      if (password !== confirmPasswordVal) throw new Error("Passwords don't match");

      // Create user in Firebase Auth
      const userCredential = await auth.createUserWithEmailAndPassword(email, password);
      const user: any = userCredential.user;
      await user.sendEmailVerification();

      await createCoachDocument(user.uid, email, firstNameVal, lastNameVal);
      window.location.href = "coachesview.html?userType=coach";
    } catch (error: any) {
      console.error("Signup error:", error);
      setIndependentError(error.message);
    } finally {
      setIndependentLoading(false);
    }
  }

  return (
    <div className="pt-landing">
      <header>
        <nav>
          <Link to="/" className="logo" style={{ textDecoration: "none" }}>
            PoseTek
          </Link>
          <div className="nav-buttons">
            <button
              className="nav-btn"
              id="authBtn"
              onClick={() => {
                if (currentUser) {
                  // Deliberate fix vs legacy: kickai.html kept a second always-on
                  // click handler that flashed the login modal during sign-out.
                  auth.signOut().then(() => {
                    window.location.reload();
                  });
                } else {
                  openLoginModal();
                }
              }}
            >
              {currentUser ? "Logout" : "Login"}
            </button>
          </div>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="hero-image"></div>
          <div className="hero-content">
            <h1>Precision Training for Athletes</h1>
            <p className="subtitle">Elevate your game with AI-powered biomechanical analysis</p>
            <a href="#" className="cta-button" id="getStartedBtn" onClick={() => openSignupModal()}>
              Get Started
            </a>
          </div>
        </section>
      </main>

      {/* Login Modal */}
      <div className={`modal-overlay${loginOpen ? " active" : ""}`} id="loginModal">
        <div className="auth-modal">
          <div className="modal-content-wrapper">
            <div className="modal-header">
              <h3 className="modal-title">Login to PoseTek</h3>
              <button className="close-btn" id="closeModal" onClick={closeLoginModal}>
                &times;
              </button>
            </div>
            <div className="verification-banner" id="verificationBanner">
              <p>Your email is not verified</p>
              <a
                id="resendVerification"
                onClick={(e) => {
                  e.preventDefault();
                  void handleResendVerification();
                }}
              >
                Resend verification email
              </a>
            </div>
            <form
              id="loginForm"
              onSubmit={(e) => {
                e.preventDefault();
                void handleLogin();
              }}
            >
              <div className="form-group">
                <label htmlFor="email">Email</label>
                <input
                  type="email"
                  id="email"
                  placeholder="Enter your email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  type="password"
                  id="password"
                  placeholder="Enter your password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                />
              </div>
              <div className="checkbox-group">
                <input type="checkbox" id="rememberMe" />
                <label htmlFor="rememberMe">Remember me</label>
              </div>
              <div className="error-message" id="loginError" style={{ display: loginError ? "block" : "none" }}>
                {loginError}
              </div>
              <div className="success-message" id="loginSuccess" style={{ display: loginSuccess ? "block" : "none" }}>
                {loginSuccess}
              </div>
              <button type="submit" className="submit-btn" id="loginSubmit" disabled={loginLoading}>
                <span style={{ opacity: loginLoading ? 0.5 : 1 }}>Login</span>
                <span className="spinner" id="loginSpinner" style={{ display: loginLoading ? "block" : "none" }}></span>
              </button>
              <div className="auth-links">
                <a
                  href="#"
                  id="forgotPassword"
                  onClick={(e) => {
                    e.preventDefault();
                    void handleForgotPassword();
                  }}
                >
                  Forgot password?
                </a>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* Signup Modal */}
      <div className={`modal-overlay${signupOpen ? " active" : ""}`} id="signupModal">
        <div className="auth-modal">
          <div className="modal-content-wrapper">
            <div className="modal-header">
              <h3 className="modal-title">Create Account</h3>
              <button className="close-btn" id="closeSignupModal" onClick={closeSignupModal}>
                &times;
              </button>
            </div>

            <div className="tab-container">
              <div
                className={`tab${activeTab === "playerCode" ? " active" : ""}`}
                data-tab="playerCode"
                onClick={() => setActiveTab("playerCode")}
              >
                Player
              </div>
              <div
                className={`tab${activeTab === "organization" ? " active" : ""}`}
                data-tab="organization"
                onClick={() => setActiveTab("organization")}
              >
                Organization
              </div>
              <div
                className={`tab${activeTab === "independent" ? " active" : ""}`}
                data-tab="independent"
                onClick={() => setActiveTab("independent")}
              >
                Coach
              </div>
            </div>

            {/* Player Tab */}
            <div className={`tab-content${activeTab === "playerCode" ? " active" : ""}`} id="playerCodeTab">
              <form
                id="playerCodeForm"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handlePlayerCodeSignup();
                }}
              >
                <div className="form-group">
                  <label htmlFor="playerCode">Player Code</label>
                  <input
                    type="text"
                    id="playerCode"
                    placeholder="Enter login code"
                    required
                    value={playerCode}
                    onChange={(e) => setPlayerCode(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="playerEmail">Email</label>
                  <input
                    type="email"
                    id="playerEmail"
                    placeholder="Enter your email"
                    required
                    value={playerEmail}
                    onChange={(e) => setPlayerEmail(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="playerPassword">Password</label>
                  <input
                    type="password"
                    id="playerPassword"
                    placeholder="Create password"
                    required
                    minLength={6}
                    value={playerPassword}
                    onChange={(e) => setPlayerPassword(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="playerConfirmPassword">Confirm Password</label>
                  <input
                    type="password"
                    id="playerConfirmPassword"
                    placeholder="Confirm password"
                    required
                    value={playerConfirmPassword}
                    onChange={(e) => setPlayerConfirmPassword(e.target.value)}
                  />
                </div>
                <div
                  className="error-message"
                  id="playerCodeError"
                  style={{ display: playerCodeError ? "block" : "none" }}
                >
                  {playerCodeError}
                </div>
                <div
                  className="success-message"
                  id="playerCodeSuccess"
                  style={{ display: playerCodeSuccess ? "block" : "none" }}
                >
                  {playerCodeSuccess}
                </div>
                <button type="submit" className="submit-btn" id="playerCodeSubmit" disabled={playerCodeLoading}>
                  <span style={{ opacity: playerCodeLoading ? 0.5 : 1 }}>Create Account</span>
                  <span
                    className="spinner"
                    id="playerCodeSpinner"
                    style={{ display: playerCodeLoading ? "block" : "none" }}
                  ></span>
                </button>
              </form>
            </div>

            {/* Organization Tab */}
            <div className={`tab-content${activeTab === "organization" ? " active" : ""}`} id="organizationTab">
              <form
                id="orgSignupForm"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleOrgSignup();
                }}
              >
                <div className="name-fields">
                  <div className="form-group">
                    <label htmlFor="firstName">First Name</label>
                    <input
                      type="text"
                      id="firstName"
                      placeholder="First name"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="lastName">Last Name</label>
                    <input
                      type="text"
                      id="lastName"
                      placeholder="Last name"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="signupEmail">Email</label>
                  <input
                    type="email"
                    id="signupEmail"
                    placeholder="Enter your email"
                    required
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="signupPassword">Password (min 6 characters)</label>
                  <input
                    type="password"
                    id="signupPassword"
                    placeholder="Create a password"
                    required
                    minLength={6}
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="confirmPassword">Confirm Password</label>
                  <input
                    type="password"
                    id="confirmPassword"
                    placeholder="Confirm your password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="userType">I am a:</label>
                  <select id="userType" required value={userType} onChange={(e) => setUserType(e.target.value)}>
                    <option value="">Select account type</option>
                    <option value="player">Player</option>
                    <option value="coach">Coach</option>
                  </select>
                </div>
                <div className="form-group" id="orgCodeGroup">
                  <label htmlFor="orgCode">Organization Code (if joining existing)</label>
                  <input
                    type="text"
                    id="orgCode"
                    placeholder="Enter organization code"
                    value={orgCode}
                    onChange={(e) => setOrgCode(e.target.value)}
                  />
                </div>
                <div className="error-message" id="orgSignupError" style={{ display: orgSignupError ? "block" : "none" }}>
                  {orgSignupError}
                </div>
                <div
                  className="success-message"
                  id="orgSignupSuccess"
                  style={{ display: orgSignupSuccess ? "block" : "none" }}
                >
                  {orgSignupSuccess}
                </div>
                <button type="submit" className="submit-btn" id="orgSignupSubmit" disabled={orgSignupLoading}>
                  <span style={{ opacity: orgSignupLoading ? 0.5 : 1 }}>Sign Up</span>
                  <span
                    className="spinner"
                    id="orgSignupSpinner"
                    style={{ display: orgSignupLoading ? "block" : "none" }}
                  ></span>
                </button>
              </form>
            </div>

            {/* Coach Tab */}
            <div className={`tab-content${activeTab === "independent" ? " active" : ""}`} id="independentTab">
              <form
                id="independentSignupForm"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleIndependentSignup();
                }}
              >
                <div className="name-fields">
                  <div className="form-group">
                    <label htmlFor="indFirstName">First Name</label>
                    <input
                      type="text"
                      id="indFirstName"
                      placeholder="First name"
                      required
                      value={indFirstName}
                      onChange={(e) => setIndFirstName(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="indLastName">Last Name</label>
                    <input
                      type="text"
                      id="indLastName"
                      placeholder="Last name"
                      required
                      value={indLastName}
                      onChange={(e) => setIndLastName(e.target.value)}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="indEmail">Email</label>
                  <input
                    type="email"
                    id="indEmail"
                    placeholder="Enter your email"
                    required
                    value={indEmail}
                    onChange={(e) => setIndEmail(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="indPassword">Password</label>
                  <input
                    type="password"
                    id="indPassword"
                    placeholder="Create password"
                    required
                    minLength={6}
                    value={indPassword}
                    onChange={(e) => setIndPassword(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="indConfirmPassword">Confirm Password</label>
                  <input
                    type="password"
                    id="indConfirmPassword"
                    placeholder="Confirm password"
                    required
                    value={indConfirmPassword}
                    onChange={(e) => setIndConfirmPassword(e.target.value)}
                  />
                </div>
                <div
                  className="error-message"
                  id="independentError"
                  style={{ display: independentError ? "block" : "none" }}
                >
                  {independentError}
                </div>
                <div
                  className="success-message"
                  id="independentSuccess"
                  style={{ display: independentSuccess ? "block" : "none" }}
                >
                  {independentSuccess}
                </div>
                <button type="submit" className="submit-btn" id="independentSubmit" disabled={independentLoading}>
                  <span style={{ opacity: independentLoading ? 0.5 : 1 }}>Sign Up</span>
                  <span
                    className="spinner"
                    id="independentSpinner"
                    style={{ display: independentLoading ? "block" : "none" }}
                  ></span>
                </button>
              </form>
            </div>

            <div className="auth-links">
              <a
                href="#"
                id="showLogin"
                onClick={(e) => {
                  e.preventDefault();
                  closeSignupModal();
                  openLoginModal();
                }}
              >
                Already have an account? Login
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Forgot Password Modal */}
      <div className={`modal-overlay${forgotOpen ? " active" : ""}`} id="forgotPasswordModal">
        <div className="auth-modal" style={{ maxWidth: "420px" }}>
          <div className="modal-content-wrapper">
            <div className="modal-header">
              <h3 className="modal-title">Reset Password</h3>
              <button className="close-btn" id="closeForgotModal" onClick={() => finishForgotModal(null)}>
                &times;
              </button>
            </div>
            <p style={{ color: "rgba(255,255,255,0.7)", marginBottom: "1.5rem", fontSize: "0.95rem" }}>
              Enter your email and we'll send you a reset link.
            </p>
            <div className="form-group">
              <label htmlFor="forgotEmailInput">Email Address</label>
              <input
                type="email"
                id="forgotEmailInput"
                placeholder="Enter your email"
                autoComplete="email"
                ref={forgotInputRef}
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
              />
            </div>
            <div className="mini-modal-buttons">
              <button className="mini-cancel-btn" id="forgotCancelBtn" onClick={() => finishForgotModal(null)}>
                Cancel
              </button>
              <button className="submit-btn" id="forgotConfirmBtn" style={{ flex: 1 }} onClick={handleForgotConfirm}>
                Send Reset Email
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Coach Organization Setup Modal */}
      <div className={`modal-overlay${coachOrgOpen ? " active" : ""}`} id="coachOrgModal">
        <div className="auth-modal" style={{ maxWidth: "420px" }}>
          <div className="modal-content-wrapper">
            {/* Step 1: Choose action */}
            <div id="coachOrgStep1" style={{ display: coachOrgStep === 1 ? "block" : "none" }}>
              <div className="modal-header">
                <h3 className="modal-title">Organization Setup</h3>
                <button className="close-btn" id="closeCoachOrgModal" onClick={() => finishCoachOrgModal(null)}>
                  &times;
                </button>
              </div>
              <p style={{ color: "rgba(255,255,255,0.7)", marginBottom: "1.5rem", fontSize: "0.95rem" }}>
                As a coach, how would you like to get started?
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <button className="org-choice-btn" id="coachCreateOrgBtn" onClick={() => goToCoachOrgStep2("create")}>
                  <span className="org-choice-icon">＋</span>
                  <div>
                    <div className="org-choice-title">Create a new organization</div>
                    <div className="org-choice-sub">Set up your own team or club</div>
                  </div>
                </button>
                <button className="org-choice-btn" id="coachJoinOrgBtn" onClick={() => goToCoachOrgStep2("join")}>
                  <span className="org-choice-icon">→</span>
                  <div>
                    <div className="org-choice-title">Join an existing organization</div>
                    <div className="org-choice-sub">Enter a code to join a club</div>
                  </div>
                </button>
              </div>
            </div>
            {/* Step 2: Input org name or join code */}
            <div id="coachOrgStep2" style={{ display: coachOrgStep === 2 ? "block" : "none" }}>
              <div className="modal-header">
                <h3 className="modal-title" id="coachOrgStep2Title">
                  {coachOrgAction === "join" ? "Join Organization" : "Organization Name"}
                </h3>
                <button className="close-btn" id="closeCoachOrgModal2" onClick={() => finishCoachOrgModal(null)}>
                  &times;
                </button>
              </div>
              <div className="form-group">
                <label id="coachOrgInputLabel" htmlFor="coachOrgInput">
                  {coachOrgAction === "join" ? "Organization Code" : "Organization Name"}
                </label>
                <input
                  type="text"
                  id="coachOrgInput"
                  placeholder={
                    coachOrgAction === "join" ? "Enter the code" : coachOrgAction === "create" ? "e.g. Riverside FC" : ""
                  }
                  ref={coachOrgInputRef}
                  value={coachOrgInput}
                  onChange={(e) => setCoachOrgInput(e.target.value)}
                />
              </div>
              <div id="coachOrgInputError" className="error-message" style={{ display: coachOrgError ? "block" : "none" }}>
                {coachOrgError}
              </div>
              <div className="mini-modal-buttons">
                <button
                  className="mini-cancel-btn"
                  id="coachOrgBackBtn"
                  onClick={() => {
                    setCoachOrgStep(1);
                  }}
                >
                  ← Back
                </button>
                <button className="submit-btn" id="coachOrgConfirmBtn" style={{ flex: 1 }} onClick={handleCoachOrgConfirm}>
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer
        style={{
          textAlign: "center",
          padding: "1.5rem",
          fontSize: "0.82rem",
          color: "rgba(255,255,255,0.4)",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          marginTop: "2rem",
        }}
      >
        © 2026 PoseTek &nbsp;·&nbsp;{" "}
        <Link to="/privacy" style={{ color: "#4c8c6a", textDecoration: "none" }}>
          Privacy Policy
        </Link>
      </footer>
    </div>
  );
}
