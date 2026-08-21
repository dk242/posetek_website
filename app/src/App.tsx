import { Suspense, lazy } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

const HomePage = lazy(() => import("./pages/home/HomePage"));
const LandingPage = lazy(() => import("./pages/landing/LandingPage"));
const RosterPage = lazy(() => import("./pages/roster/RosterPage"));
const AthletePortalPage = lazy(() => import("./pages/athlete-portal/AthletePortalPage"));
const DrillSharePage = lazy(() => import("./pages/drill-share/DrillSharePage"));
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
      <Suspense fallback={<Fallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/index.html" element={<HomePage />} />

          <Route path="/signin" element={<LandingPage />} />
          <Route path="/kickai.html" element={<LandingPage />} />

          <Route path="/roster" element={<RosterPage />} />
          <Route path="/coachesview.html" element={<RosterPage />} />

          <Route path="/athlete" element={<AthletePortalPage />} />
          <Route path="/profile.html" element={<AthletePortalPage />} />

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
      </Suspense>
    </BrowserRouter>
  );
}
