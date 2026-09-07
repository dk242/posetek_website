// Port of broadJumpPage.html / changeOfDirectionPage.html / dribblingPage.html +
// the boot/auth/share/copy-link/tab logic of athlete-drill-view.js. One component
// serves all three drills; App.tsx passes the drill key exactly like the legacy
// <body data-drill="..."> attribute did.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { auth, cloud } from "../../lib/firebase";
import { useThemeColor } from "../../lib/use-theme-color";
// drill-share.scss is imported BEFORE AthleteStats (and its stylesheet) so the
// bundle keeps the legacy cascade order: athlete-drill-view.css loaded first,
// athlete-stats-view.css second — stats rules win equal-specificity ties.
import "./drill-share.scss";
import AthleteStats from "../../components/athlete-stats/AthleteStats";
import {
  buildPageUrl,
  configs,
  pageConfigs,
  type PageDrillKey,
  type PageUrlState,
} from "./drill-config";
import {
  asNumber,
  athleteDisplayName,
  normalizeSharedRep,
  previewStatsReps,
  type Rep,
} from "./drill-lib";
import { loadStatsReps, resolveAuthorizedPlayer, resolveViewer, type ViewerInfo } from "./drill-data";
import ResultsSurface from "./ResultsSurface";

interface PlayerState {
  id: string | null;
  data: Record<string, any>;
}

type Boot =
  | { phase: "loading"; message: string }
  | { phase: "error"; title: string; message: string }
  | { phase: "ready" };

export default function DrillSharePage({ drill }: { drill: "broadJump" | "changeOfDirection" | "dribbling" }) {
  // Key by drill AND router location so every router navigation — including
  // clicking the brand or the already-active catalog entry — fully remounts and
  // re-boots, matching the legacy full page loads. In-page URL sync
  // (setActiveView/selectRep) uses history.replaceState, which does not touch
  // the router location, so it never triggers a remount.
  const location = useLocation();
  return <DrillShareApp key={`${drill}|${location.key}`} drill={drill} />;
}

function DrillShareApp({ drill }: { drill: PageDrillKey }) {
  const config = pageConfigs[drill];
  const navigate = useNavigate();

  // Load-time snapshot of the query string, like the legacy top-level `params`.
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  const preview = isLocal && params.get("preview") === "1";
  const shareToken = preview ? null : params.get("share");

  const [boot, setBoot] = useState<Boot>({ phase: "loading", message: "Loading athlete results…" });
  const [viewer, setViewer] = useState<ViewerInfo | null>(null);
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [reps, setReps] = useState<Rep[]>([]);
  const [statsReps, setStatsReps] = useState<Rep[]>([]);
  const [activeView, setActiveViewState] = useState<"stats" | "results">(
    params.get("view") === "results" ? "results" : "stats",
  );
  const shareExpiresAtMillisRef = useRef<number | null>(null);

  const [copyLabel, setCopyLabel] = useState("Copy secure results link");
  const [copyBusy, setCopyBusy] = useState(false);
  const copyTimerRef = useRef<number | undefined>(undefined);

  useThemeColor("#041610"); // legacy drill pages: <meta name="theme-color" content="#041610">

  useEffect(() => {
    document.title = `${config.title} | PoseTek`;
  }, [config.title]);

  // Legacy set color-scheme:dark at the html level (dark viewport scrollbar), and
  // every navigation was a full page load landing at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
    const root = document.documentElement;
    const previous = root.style.colorScheme;
    root.style.colorScheme = "dark";
    return () => {
      root.style.colorScheme = previous;
    };
  }, []);

  useEffect(() => () => window.clearTimeout(copyTimerRef.current), []);

  useEffect(() => {
    let cancelled = false;

    async function start(user: { uid: string; email?: string | null }) {
      try {
        setBoot({ phase: "loading", message: "Resolving athlete profile…" });
        const resolvedViewer = await resolveViewer(user);
        const resolvedPlayer = await resolveAuthorizedPlayer(resolvedViewer, params.get("player"));
        if (cancelled) return;
        setBoot({ phase: "loading", message: `Loading ${config.title.toLowerCase()} results…` });
        const allReps = await loadStatsReps(resolvedPlayer.id);
        if (cancelled) return;
        setViewer(resolvedViewer);
        setPlayer(resolvedPlayer);
        setStatsReps(allReps);
        setReps(allReps.filter(rep => rep._statsDrill === config.key));
        setBoot({ phase: "ready" });
      } catch (error: any) {
        console.error(`[${config.key}]`, error);
        if (!cancelled) {
          setBoot({ phase: "error", title: "Unable to open these results", message: error?.message || "The athlete data could not be loaded." });
        }
      }
    }

    async function startShared(token: string) {
      try {
        setBoot({ phase: "loading", message: `Opening shared ${config.title.toLowerCase()} results…` });
        const getShare = cloud.httpsCallable("getAthleteResultsShare");
        const payloads = await Promise.all(Object.values(configs).map(async drillConfig => {
          try {
            const response = await getShare({ token, drill: drillConfig.key });
            return { drillConfig, payload: ((response as any)?.data || {}) as Record<string, any>, error: null as any };
          } catch (error) {
            return { drillConfig, payload: null as Record<string, any> | null, error };
          }
        }));
        const currentResult = payloads.find(item => item.drillConfig.key === config.key);
        if (currentResult?.error) throw currentResult.error;
        const currentPayload = currentResult?.payload || {};
        if (cancelled) return;
        setViewer({ role: "shared", data: {} });
        setPlayer({ id: null, data: currentPayload.athlete || {} });
        shareExpiresAtMillisRef.current = asNumber(currentPayload.expiresAtMillis);
        const allReps = payloads.flatMap(({ drillConfig, payload }) =>
          (Array.isArray(payload?.reps) ? payload.reps : []).map((rep: Record<string, any>) => normalizeSharedRep(rep, drillConfig)),
        );
        setStatsReps(allReps);
        setReps(allReps.filter(rep => rep._statsDrill === config.key));
        setBoot({ phase: "ready" });
      } catch (error: any) {
        console.error(`[${config.key}] shared link failed`, error);
        const detail = error?.message && error.message !== "internal"
          ? error.message
          : "Ask the coach to send a new athlete results link.";
        if (!cancelled) {
          setBoot({ phase: "error", title: "This results link is unavailable", message: detail });
        }
      }
    }

    function startPreview() {
      const allReps = previewStatsReps();
      setViewer({ role: "coach", uid: "preview", docId: "preview-coach", data: { members: ["preview-player"] } });
      setPlayer({ id: "preview-player", data: { firstName: "Jordan", lastName: "Athlete", height: 178, weight: 72.5 } });
      setStatsReps(allReps);
      setReps(allReps.filter(rep => rep._statsDrill === config.key));
      setBoot({ phase: "ready" });
    }

    if (preview) {
      startPreview();
      return () => { cancelled = true; };
    }
    if (shareToken) {
      void startShared(shareToken);
      return () => { cancelled = true; };
    }
    const unsubscribe = auth.onAuthStateChanged(user => {
      if (cancelled) return;
      if (!user) {
        if (isLocal) {
          setBoot({ phase: "error", title: "Sign-in required", message: "Local preview is ready, but athlete data requires a signed-in Firebase account." });
        } else {
          navigate(`/signin?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`, { replace: true });
        }
        return;
      }
      void start(user);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // Boot exactly once per drill mount (the component is keyed by drill).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setActiveView(view: string, updateUrl = true) {
    const next = view === "stats" ? "stats" : "results";
    setActiveViewState(next);
    if (updateUrl) {
      const nextUrl = new URL(window.location.href);
      if (next === "results") nextUrl.searchParams.set("view", "results");
      else nextUrl.searchParams.delete("view");
      window.history.replaceState({}, "", nextUrl);
    }
  }

  async function copyResultUrl(url: string) {
    try {
      await navigator.clipboard.writeText(String(url));
      setCopyLabel("Secure link copied");
    } catch {
      window.prompt("Copy this athlete results link:", String(url));
    }
    window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopyLabel("Copy secure results link"), 1800);
  }

  async function copyAthleteLink() {
    if (!player) return;
    if (preview) {
      // Minted links keep the documented legacy .html shape (ATHLETE_RESULTS_LINKS.md);
      // the SPA serves those paths via its alias routes.
      const previewUrl = new URL(`/${config.page}`, window.location.origin);
      previewUrl.search = "?preview=1";
      await copyResultUrl(previewUrl.toString());
      return;
    }
    if (viewer?.role !== "coach") return;
    setCopyBusy(true);
    setCopyLabel("Creating secure link…");
    try {
      const createShare = cloud.httpsCallable("createAthleteResultsShare");
      const response = await createShare({ playerDocId: player.id });
      const token = (response as any)?.data?.token;
      if (!token) throw new Error("The secure link could not be created.");
      const url = new URL(`/${config.page}`, window.location.origin);
      url.search = "";
      url.searchParams.set("share", token);
      await copyResultUrl(url.toString());
    } catch (error: any) {
      console.error("[athlete-share] create failed", error);
      window.alert(error?.message || "The secure results link could not be created.");
    } finally {
      setCopyBusy(false);
    }
  }

  const ready = boot.phase === "ready";
  const urlState: PageUrlState = {
    preview,
    shareToken,
    playerId: player?.id ?? null,
    viewerRole: viewer?.role,
  };
  // Legacy renderShell() repoints the brand link at the current drill page once
  // data is loaded; before that it keeps the static profile.html target.
  const brandTo = ready ? buildPageUrl(config.page, {}, urlState) : "/athlete";
  const showCopyButton = ready && viewer?.role === "coach";
  const name = athleteDisplayName(player?.data);

  return (
    <div className="pt-drill" data-drill={drill}>
      <header className="site-header">
        <Link className="brand" to={brandTo}>
          <span className="brand-mark">P</span>
          <span className="brand-word">POSETEK</span>
        </Link>
        <nav className="header-view-tabs" aria-label="Athlete pages">
          {([["stats", "Athlete Home"], ["results", "Drill Results"]] as const).map(([view, label]) => (
            <button
              key={view}
              type="button"
              data-page-view={view}
              className={ready && activeView === view ? "active" : ""}
              aria-current={ready ? (activeView === view ? "page" : "false") : undefined}
              onClick={() => {
                if (ready) setActiveView(view);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <button
            id="copyLinkButton"
            className={`action-button primary${showCopyButton ? "" : " hidden"}`}
            type="button"
            disabled={copyBusy}
            onClick={() => void copyAthleteLink()}
          >
            <span className="material-symbols-outlined">link</span>
            <span className="label">{copyLabel}</span>
          </button>
        </div>
      </header>
      <main id="app" className="page-shell" aria-live="polite">
        {boot.phase === "loading" && (
          <section className="loading-screen">
            <div>
              <div className="spinner" />
              <p>{boot.message}</p>
            </div>
          </section>
        )}
        {boot.phase === "error" && (
          <section className="error-panel">
            <h2>{boot.title}</h2>
            <p>{boot.message}</p>
          </section>
        )}
        {ready && player && (
          <>
            <div id="resultsSurface" className={activeView !== "results" ? "hidden" : ""}>
              <ResultsSurface
                config={config}
                reps={reps}
                active={activeView === "results"}
                athleteName={name}
                urlState={urlState}
                playerId={player.id}
                shareToken={shareToken}
                preview={preview}
                initialParams={params}
              />
            </div>
            <div id="statsSurface" className={activeView !== "stats" ? "hidden" : ""}>
              <AthleteStats reps={statsReps} athleteName={name} athlete={player.data || {}} />
            </div>
          </>
        )}
      </main>
      <footer className="footer">© 2026 PoseTek · Private athlete results shared through a secure link.</footer>
    </div>
  );
}
