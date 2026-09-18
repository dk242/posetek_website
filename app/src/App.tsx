import { Suspense, lazy } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import UsageTracking from "./lib/insight-usage/UsageTracking";
import PlayerWorkspace, { normalizedPlayerPath, playerPaths } from './pages/athlete-portal/player/PlayerWorkspace';

const HomePage = lazy(() => import("./pages/home/HomePage"));
const LandingPage = lazy(() => import("./pages/landing/LandingPage"));
const OrganizationPage = lazy(() => import("./pages/organization/OrganizationPage"));
const StaffInvitePage = lazy(() => import("./pages/staff-invite/StaffInvitePage"));
const RosterPage = lazy(() => import("./pages/roster/RosterPage"));
const CoachDashboardPage = lazy(() => import("./pages/coach-dashboard/CoachDashboardPage"));
const DrillSharePage = lazy(() => import("./pages/drill-share/DrillSharePage"));
const InsightsPage = lazy(() => import("./pages/insights/InsightsPage"));
const AdminPage = lazy(() => import("./pages/admin/AdminPage"));
const ProgramsPage = lazy(() => import("./pages/programs/ProgramsPage"));
const PrivacyPage = lazy(() => import("./pages/privacy/PrivacyPage"));
const NotFoundPage = lazy(() => import("./pages/not-found/NotFoundPage"));

function Fallback() {
  return (
    <div className="app-route-loading" role="status" aria-live="polite">
      <span className="app-route-spinner" aria-hidden="true" />
    </div>
  );
}

// Every page answers on BOTH its clean route and its legacy *.html URL so links
// already in the wild (emails, texts, the mobile app, unported legacy pages)
// keep working. Query strings (?share=…, ?player=…, ?returnTo=…) pass through
// untouched because these are aliases, not redirects.
export default function App() {
  return (
    <BrowserRouter>
      <UsageTracking />
      <Suspense fallback={<Fallback />}>
        <ApplicationRoutes />
      </Suspense>
    </BrowserRouter>
  );
}

function ApplicationRoutes() {
  const location = useLocation();
  if (playerPaths.has(normalizedPlayerPath(location.pathname))) return <PlayerWorkspace />;
  return (
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/index.html" element={<HomePage />} />

          <Route path="/signin" element={<LandingPage />} />
          <Route path="/kickai.html" element={<LandingPage />} />


          <Route path="/organization" element={<OrganizationPage />} />
          <Route path="/join" element={<StaffInvitePage />} />

          <Route path="/roster" element={<RosterPage />} />
          <Route path="/coachesview.html" element={<RosterPage />} />

          <Route path="/dashboard" element={<CoachDashboardPage />} />
          <Route path="/programs" element={<ProgramsPage />} />
          <Route path="/insights" element={<InsightsPage />} />

          {/* The admin console mounts its own nested routes; `/*` is what lets
              it own /admin/drills, /admin/accounts and everything under them. */}
          <Route path="/admin/*" element={<AdminPage />} />


          <Route path="/drills/broad-jump" element={<DrillSharePage drill="broadJump" />} />
          <Route path="/broadJumpPage.html" element={<DrillSharePage drill="broadJump" />} />
          <Route path="/drills/change-of-direction" element={<DrillSharePage drill="changeOfDirection" />} />
          <Route path="/changeOfDirectionPage.html" element={<DrillSharePage drill="changeOfDirection" />} />
          <Route path="/drills/dribbling" element={<DrillSharePage drill="dribbling" />} />
          <Route path="/dribblingPage.html" element={<DrillSharePage drill="dribbling" />} />

          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/privacy.html" element={<PrivacyPage />} />

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
  );
}
