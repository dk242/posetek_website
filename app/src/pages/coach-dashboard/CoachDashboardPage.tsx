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
import { loadAthleteBundle, loadCoachContext, startPlanJob } from "./lib/data";
import type { AthleteBundle, PlanJobState } from "./lib/data";
import { PREVIEW_BUNDLES, PREVIEW_PLAYERS } from "./lib/preview";
import Overview from "./views/Overview";
import AthleteDetail from "./views/AthleteDetail";
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
  const [bundles, setBundles] = useState<Record<string, AthleteBundle>>({});
  const [jobs, setJobs] = useState<Record<string, PlanJobState>>({});

  const signingOutRef = useRef(false);
  const unsubscribersRef = useRef<(() => void)[]>([]);

  const selectedId = searchParams.get("athlete");

  const reloadAthlete = useCallback(async (playerId: string) => {
    const bundle = await loadAthleteBundle(playerId);
    setBundles(current => ({ ...current, [playerId]: bundle }));
    return bundle;
  }, []);

  const boot_ = useCallback(async (user: any) => {
    setBoot({ kind: "loading", note: "Loading your roster…" });
    const context = await loadCoachContext(user, new URLSearchParams(window.location.search).get("team"));
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
    setBundles(Object.fromEntries(loaded));
    setBoot({ kind: "ready" });
  }, []);

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
        if (!signingOutRef.current) navigate("/signin", { replace: true });
        return;
      }
      boot_(user).catch(error => {
        console.error("[dashboard]", error);
        setBoot({ kind: "error", message: error.message || "Please refresh and try again." });
      });
    });
    const subscriptions = unsubscribersRef.current;
    return () => {
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

  const onJobChange = useCallback((state: PlanJobState) => {
    setJobs(current => ({ ...current, [state.playerId]: state }));
    if (state.status === "complete") {
      reloadAthlete(state.playerId).catch(error => console.warn("[dashboard] reload failed", error));
    }
  }, [reloadAthlete]);

  // One athlete's plan job (detail view button, and the bulk action per row).
  const createPlanFor = useCallback(async (playerId: string) => {
    const player = players.find(entry => entry.id === playerId);
    const bundle = bundles[playerId];
    if (!player || !bundle) return;
    try {
      const stop = await startPlanJob(playerId, bundle, player, onJobChange);
      unsubscribersRef.current.push(stop);
    } catch (error: any) {
      onJobChange({ playerId, jobId: null, status: "failed", message: error?.message || "The job could not be submitted." });
    }
  }, [players, bundles, onJobChange]);

  // "Create workout plans for all athletes" — every roster athlete without an
  // active plan and no job already in flight.
  const createPlansForAll = useCallback(async () => {
    const targets = summaries.filter(summary => {
      const job = jobs[summary.athlete.id];
      const busy = job && ["submitting", "pending", "running"].includes(job.status);
      return !summary.plan && !busy;
    });
    for (const target of targets) {
      // Sequential submits keep Firestore happy and make progress readable;
      // the gateway works the jobs concurrently regardless.
      await createPlanFor(target.athlete.id);
    }
  }, [summaries, jobs, createPlanFor]);

  async function handleSignOut() {
    signingOutRef.current = true;
    await auth.signOut();
    navigate("/signin");
  }

  const selectAthlete = useCallback((id: string | null) => {
    const params: Record<string, string> = {};
    const team = searchParams.get("team");
    if (team) params.team = team;
    if (preview) params.preview = "1";
    if (id) params.athlete = id;
    setSearchParams(params, { replace: false });
  }, [setSearchParams, preview, searchParams]);

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
        <Link className="portal-brand" to="/dashboard" aria-label="PoseTek dashboard">
          <span className="portal-brand-mark">P</span>
          <span>POSETEK</span>
        </Link>
        <nav className="coachdash-nav">
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
