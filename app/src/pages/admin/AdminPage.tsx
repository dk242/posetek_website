// The admin console — brief §4 plus the website half of admin sign-in.
// Route: `/admin/*`. Two options, mirroring the mobile admin's tabs:
// **Drill library** and **Monitor accounts**.
//
// The guard below decides which screen to draw. It is not the security
// boundary: docs/rules/admin.rules, drill_catalog.rules, storage.rules and the
// 2026-09-05 llm.rules additions are, and every write on these screens is
// rejected by them for a non-admin.

import { Suspense, lazy } from "react";
import type { ReactNode } from "react";
import { Link, Route, Routes, useNavigate } from "react-router-dom";
import { auth } from "../../lib/firebase";
import { sendAdminVerification } from "./lib/identity";
import { useAdminSession } from "./lib/session";
import "../../styles/pose-portal.css";
import "./admin.scss";
import "./admin-surfaces.scss";
import AdminHeader from "./views/AdminHeader";

const OrganizationPage = lazy(() => import("../organization/OrganizationPage"));
const AdminHome = lazy(() => import("./views/AdminHome"));
const DrillLibrary = lazy(() => import("./views/DrillLibrary"));
const DrillDetail = lazy(() => import("./views/DrillDetail"));
const DrillForm = lazy(() => import("./views/DrillForm"));
const MonitorAccounts = lazy(() => import("./views/MonitorAccounts"));
const CoachDetail = lazy(() => import("./views/CoachDetail"));
const PlayerDetail = lazy(() => import("./views/PlayerDetail"));
const WorkoutEditor = lazy(() => import("./views/WorkoutEditor"));
const AdminResults = lazy(() => import("./views/AdminResults"));
const RepTools = lazy(() => import("./views/RepTools"));
const GeneratePrograms = lazy(() => import("./views/GeneratePrograms"));
const AnalysisWorkspace = lazy(() => import("./views/AnalysisWorkspace"));
const PersonalizedPrograms = lazy(() => import("./views/PersonalizedPrograms"));

export default function AdminPage() {
  const session = useAdminSession();
  const navigate = useNavigate();

  async function signOut() {
    await auth.signOut();
    navigate("/signin", { replace: true });
  }

  let body;
  if (session.kind === "checking") {
    body = (
      <div className="portal-loading">
        <span className="spinner" />
        <p>Checking your PoseTek admin sign-in…</p>
      </div>
    );
  } else if (session.kind === "signedOut") {
    body = (
      <GateCard
        icon="lock"
        title="Sign in with your PoseTek account"
        body="The admin console is for verified @posetek.net accounts."
        action={<Link className="primary-cta" to="/signin?returnTo=%2Fadmin">Go to sign in</Link>}
      />
    );
  } else if (session.kind === "notAdmin") {
    body = (
      <GateCard
        icon="block"
        title="This account is not a PoseTek admin"
        body={`${session.email || "This account"} is signed in, but only @posetek.net accounts reach the admin console. Coaches use the dashboard; athletes use the portal.`}
        action={
          <div className="admin-gate-actions">
            <Link className="quiet-button" to="/roster?userType=coach">Coach roster</Link>
            <Link className="quiet-button" to="/athlete">Athlete portal</Link>
            <button className="primary-cta" type="button" onClick={signOut}>Sign out</button>
          </div>
        }
      />
    );
  } else if (session.kind === "unverified") {
    body = <VerificationCard email={session.email} onSignOut={signOut} />;
  } else {
    body = (
      <Suspense fallback={<div className="portal-loading"><span className="spinner" /><p>Loading…</p></div>}>
        <Routes>
          <Route index element={<AdminHome />} />
          <Route path="drills" element={<DrillLibrary />} />
          <Route path="drills/new" element={<DrillForm mode="create" />} />
          <Route path="drills/:drillId" element={<DrillDetail />} />
          <Route path="drills/:drillId/edit" element={<DrillForm mode="edit" />} />
          <Route path="organizations" element={<OrganizationPage admin />} />
          <Route path="accounts" element={<MonitorAccounts />} />
          <Route path="accounts/coach/:coachId" element={<CoachDetail />} />
          <Route path="accounts/player/:playerId" element={<PlayerDetail />} />
          <Route path="accounts/player/:playerId/results" element={<AdminResults />} />
          <Route path="accounts/player/:playerId/results/:drillKey" element={<AdminResults />} />
          <Route path="accounts/player/:playerId/results/:drillKey/:repId" element={<RepTools />} />
          <Route path="programs" element={<GeneratePrograms />} />
          <Route path="analysis" element={<AnalysisWorkspace />} />
          <Route path="programs/personalized" element={<PersonalizedPrograms />} />
          <Route
            path="accounts/player/:playerId/plan/:planId/workout/:workoutId"
            element={<WorkoutEditor />}
          />
          <Route
            path="*"
            element={
              <GateCard
                icon="help"
                title="No such admin page"
                body="That address is not part of the admin console."
                action={<Link className="primary-cta" to="/admin">Admin home</Link>}
              />
            }
          />
        </Routes>
      </Suspense>
    );
  }

  return (
    <div className={`pt-pose portal-body pt-admin${session.kind === "ready" ? " admin-ready" : ""}`}>
      <AdminHeader ready={session.kind === "ready"}
        email={session.kind === "ready" ? session.identity.email : undefined} onSignOut={() => void signOut()} />
      <main className="admin-shell">{body}</main>
    </div>
  );
}

function GateCard({ icon, title, body, action }: { icon: string; title: string; body: string; action?: ReactNode }) {
  return (
    <section className="admin-gate">
      <div className="empty-card">
        <span className="material-symbols-outlined">{icon}</span>
        <h3>{title}</h3>
        <p>{body}</p>
        {action}
      </div>
    </section>
  );
}

// An @posetek.net address that has never been verified is NOT an admin, and it
// must not fall through to the coach/player cascade either (identity §1.3).
function VerificationCard({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  async function resend() {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const sent = await sendAdminVerification(user);
      window.alert(sent
        ? "Verification email sent. Open it, then sign in again."
        : "A verification email was already sent in the last ten minutes — check your inbox and spam folder.");
    } catch (error: any) {
      window.alert(error?.message || "The verification email could not be sent.");
    }
  }

  return (
    <GateCard
      icon="mark_email_unread"
      title="Verify your PoseTek email"
      body={`${email} is a PoseTek address, but it has not been verified yet. Verify it, then sign in again — admin access is granted by the verified address on your sign-in token, not by anything we could set for you here.`}
      action={
        <div className="admin-gate-actions">
          <button className="quiet-button" type="button" onClick={resend}>Resend the email</button>
          <button className="primary-cta" type="button" onClick={onSignOut}>Sign out</button>
        </div>
      }
    />
  );
}
