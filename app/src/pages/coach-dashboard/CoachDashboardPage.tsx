// Coach dashboard — desktop-first roster analytics + per-athlete program
// management. Route: /dashboard (?athlete=<id> deep-links a detail view).
//
// Data flow: one CoachContext load, then per-athlete bundles (reps + plans +
// workout logs) fetched in parallel and summarized by pure logic in lib/.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { auth } from "../../lib/firebase";
import { athleteSummary, summarySort } from "./lib/logic";
import type { AthleteSummary } from "./lib/logic";
import { loadAthleteBundle, loadCoachContext } from "./lib/data";
import type { AthleteBundle, PlanJobState } from "./lib/data";
import { PREVIEW_BUNDLES, PREVIEW_PLAYERS } from "./lib/preview";
import Overview from "./views/Overview";
import AthleteDetail from "./views/AthleteDetail";
import { createInsightsRequestGuard, dashboardPlayerQuery, insightsLink } from "../insights/lib/navigation";
import "../../styles/pose-portal.css";
import "./coach-dashboard.scss";

type Boot =
  | { kind: "loading"; note: string }
  | { kind: "ready" }
  | { kind: "error"; message: string };

export default function CoachDashboardPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [boot, setBoot] = useState<Boot>({ kind: "loading", note: "Checking your sign-in…" });
  const [orgLabel, setOrgLabel] = useState("Coach dashboard");
  const [players, setPlayers] = useState<any[]>([]);
  const [clubSelection, setClubSelection] = useState<{ orgId: string; teamId: string } | null>(null);
  const bootGuard = useRef(createInsightsRequestGuard(() => auth.currentUser?.uid)).current;
  const [bundles, setBundles] = useState<Record<string, AthleteBundle>>({});
  const [jobs] = useState<Record<string, PlanJobState>>({});

  const signingOutRef = useRef(false);
  const unsubscribersRef = useRef<(() => void)[]>([]);

  const selectedId = searchParams.get("athlete");

  const reloadAthlete = useCallback(async (playerId: string) => {
    const bundle = await loadAthleteBundle(playerId);
    setBundles(current => ({ ...current, [playerId]: bundle }));
    return bundle;
  }, []);

  const boot_ = useCallback(async (user: any) => {
    const isCurrent = bootGuard.begin(user.uid);
    setPlayers([]); setBundles({}); setClubSelection(null);
    setBoot({ kind: "loading", note: "Loading your roster…" });
    try {
    const query = new URLSearchParams(window.location.search);
    const context = await loadCoachContext(user, query.get("teamId") || query.get("team"), query.get("orgId") || undefined);
    if (!isCurrent()) return;
    setClubSelection(context.organizationId && context.teamId ? { orgId: context.organizationId, teamId: context.teamId } : null);
    setOrgLabel(context.orgLabel);
    setPlayers(context.players);
    setBoot({ kind: "loading", note: "Crunching athlete data…" });
    // All bundles in parallel — a failed athlete shows as empty rather than
    // sinking the whole dashboard.
    const loaded = await Promise.all(context.players.map(async (player: any) => {
      try {
        return [player.id, await loadAthleteBundle(player.id)] as const;
      } catch (error) {
        console.warn("[dashboard] bundle failed", player.id, error);
        return [player.id, { reps: [], plans: [], logs: [] }] as const;
      }
    }));
    if (!isCurrent()) return;
    setBundles(Object.fromEntries(loaded));
    setBoot({ kind: "ready" });
    } catch (error: any) {
      if (!isCurrent()) return;
      setPlayers([]); setBundles({}); setClubSelection(null);
      setBoot({ kind: "error", message: error.message || "Please refresh and try again." });
    }
  }, [bootGuard]);

  const preview = searchParams.get("preview") === "1";

  useEffect(() => {
    document.title = "Dashboard | PoseTek";
    if (preview) {
      setOrgLabel("Vacaville Training");
      setPlayers([...PREVIEW_PLAYERS]);
      setBundles({ ...PREVIEW_BUNDLES });
      setBoot({ kind: "ready" });
      return;
    }
    const unsubscribe = auth.onAuthStateChanged(user => {
      if (!user) {
        bootGuard.cancel(); setClubSelection(null); setPlayers([]); setBundles({});
        if (!signingOutRef.current) navigate("/signin", { replace: true });
        return;
      }
      void boot_(user);
    });
    const subscriptions = unsubscribersRef.current;
    return () => {
      bootGuard.cancel();
      unsubscribe();
      subscriptions.forEach(stop => stop());
    };
    // Boot once per mount, like the roster page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summaries: AthleteSummary[] = useMemo(
    () => summarySort(players.map(player => {
      const bundle = bundles[player.id] || { reps: [], plans: [], logs: [] };
      return athleteSummary(player, bundle.reps, bundle.plans, bundle.logs);
    })),
    [players, bundles],
  );

  // Website requests open the shared draft/review flow; native generation is unchanged.
  const createPlanFor = useCallback(async (playerId: string) => {
    if (!players.some(player => player.id === playerId) || preview) return;
    const params = new URLSearchParams({ players: playerId });
    const player = players.find(row => row.id === playerId);
    if (player.organizationId) params.set("orgId", player.organizationId);
    if (player.teamId) params.set("teamId", player.teamId);
    navigate("/programs?" + params);
  }, [players, preview, navigate]);

  const createPlansForAll = useCallback(async () => {
    if (preview) return;
    const ids = summaries.filter(summary => !summary.plan).map(summary => summary.athlete.id);
    navigate("/programs?" + new URLSearchParams({ players: ids.join(","), ...(clubSelection || {}) }));
  }, [summaries, preview, navigate, clubSelection]);

  async function handleSignOut() {
    signingOutRef.current = true;
    await auth.signOut();
    navigate("/signin");
  }

  const selectAthlete = useCallback((id: string | null) => {
    setSearchParams(dashboardPlayerQuery(searchParams.toString(), clubSelection, id), { replace: false });
  }, [setSearchParams, searchParams, clubSelection]);

  const selected = selectedId ? summaries.find(summary => summary.athlete.id === selectedId) : null;

  let body;
  if (boot.kind === "loading") {
    body = (
      <div className="portal-loading">
        <span className="spinner" />
        <p>{boot.note}</p>
      </div>
    );
  } else if (boot.kind === "error") {
    body = (
      <div className="error-card">
        <span className="material-symbols-outlined">error</span>
        <h3>Dashboard unavailable</h3><Link className="quiet-button" to="/organization">Open organization</Link>
        <p>{boot.message}</p>
      </div>
    );
  } else if (selected) {
    body = (
      <AthleteDetail
        summary={selected}
        job={jobs[selected.athlete.id] || null}
        preview={preview}
        onBack={() => selectAthlete(null)}
        onCreatePlan={() => createPlanFor(selected.athlete.id)}
        onPlanChanged={() => reloadAthlete(selected.athlete.id)}
        onPreviewEdit={(planId, weeks) => {
          const playerId = selected.athlete.id;
          setBundles(current => {
            const bundle = current[playerId];
            if (!bundle) return current;
            return {
              ...current,
              [playerId]: {
                ...bundle,
                plans: bundle.plans.map((plan: any) => plan.id === planId ? { ...plan, weeks } : plan),
              },
            };
          });
        }}
      />
    );
  } else {
    body = (
      <Overview
        orgLabel={orgLabel}
        summaries={summaries}
        jobs={jobs}
        onSelect={selectAthlete}
        onCreateAll={createPlansForAll}
      />
    );
  }

  return (
    <div className="pt-pose portal-body pt-coachdash">
      <header className="portal-header">
        <Link className="quiet-button" to="/feed">Community feed</Link>
        <Link className="portal-brand" to="/dashboard" aria-label="PoseTek dashboard">
          <span className="portal-brand-mark">P</span>
          <span>POSETEK</span>
        </Link>
        <nav className="coachdash-nav">
          {clubSelection && !preview && <Link className="quiet-button" to={insightsLink(clubSelection, "dashboard")}><span className="material-symbols-outlined">monitoring</span><span>Team Insights</span></Link>}
          <Link className="quiet-button" to="/roster?userType=coach">
            <span className="material-symbols-outlined">groups</span>
            <span>Roster</span>
          </Link>
        </nav>
        <button className="quiet-button coachdash-signout" type="button" onClick={handleSignOut}>
          <span className="material-symbols-outlined">logout</span>
          <span>Sign Out</span>
        </button>
      </header>
      <main className="coachdash-shell">{body}</main>
    </div>
  );
}
