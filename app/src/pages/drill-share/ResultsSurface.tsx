// Port of renderShell()'s results surface: page intro + drill catalog, validation
// banner, Chart.js history chart, summary metrics, D1 comparison, session list and
// the session/rep viewer panel (artifact loading + selection).

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Chart from "chart.js/auto";
import benchmarks from "../../lib/benchmarks";
import {
  buildPageUrl,
  drillBenchmarks,
  drillCatalog,
  isPortedPage,
  type PageDrillConfig,
  type PageUrlState,
} from "./drill-config";
import {
  bestMetricValue,
  formatDate,
  formatPrimary,
  metersToFeet,
  sessionGroups,
  summaryMetrics,
  type Rep,
} from "./drill-lib";
import { loadArtifacts } from "./drill-data";
import RepViewer from "./RepViewer";

export interface ResultsSurfaceProps {
  config: PageDrillConfig;
  reps: Rep[];
  active: boolean;
  athleteName: string;
  urlState: PageUrlState;
  playerId: string | null;
  shareToken: string | null;
  preview: boolean;
  initialParams: URLSearchParams;
}

interface ArtifactsBundle {
  seq: number;
  artifacts: Record<string, any>;
  rep: Rep;
}

export default function ResultsSurface({
  config,
  reps,
  active,
  athleteName,
  urlState,
  playerId,
  shareToken,
  preview,
  initialParams,
}: ResultsSurfaceProps) {
  const [currentRepId, setCurrentRepId] = useState<string | null>(null);
  const [artifactsBundle, setArtifactsBundle] = useState<ArtifactsBundle | null>(null);
  const [subtitle, setSubtitle] = useState("Loading rep artifacts…");
  const [banner, setBanner] = useState<string | null>(null);
  const seqRef = useRef(0);
  const chartRef = useRef<Chart<"line", number[], string> | null>(null);
  const chartCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const sessions = useMemo(() => sessionGroups(reps, config.lowerIsBetter), [reps, config.lowerIsBetter]);
  const summary = useMemo(() => summaryMetrics(config.key, reps, config.lowerIsBetter), [config, reps]);

  async function selectRep(repId: string) {
    const rep = reps.find(item => item.id === repId);
    if (!rep) return;
    const seq = ++seqRef.current;
    setCurrentRepId(repId);
    setArtifactsBundle(null);
    setSubtitle(`Session ${rep.sessionNumber} · Rep ${rep.repNumber} · ${formatDate(rep.createdAtMillis)}`);

    const requestedUrl = new URL(window.location.href);
    if (!shareToken) requestedUrl.searchParams.set("player", String(playerId));
    requestedUrl.searchParams.set("session", `session${rep.sessionNumber}`);
    requestedUrl.searchParams.set("rep", `kick${rep.repNumber}`);
    window.history.replaceState({}, "", requestedUrl);

    const artifacts = await loadArtifacts({ rep, config, playerId, shareToken, preview });
    if (seq !== seqRef.current) return;
    setArtifactsBundle({ seq, artifacts, rep });
  }

  // Chart is created lazily the first time the results view is shown, like the
  // legacy setActiveView() → renderChart() path.
  useEffect(() => {
    if (!active || !reps.length || chartRef.current) return;
    const canvas = chartCanvasRef.current;
    if (!canvas) return;
    const chronological = [...reps].reverse().filter(rep => rep.primary !== null);
    const chartValues = chronological.map(rep =>
      config.key === "broadJump" ? metersToFeet(rep.primary as number) : (rep.primary as number),
    );
    chartRef.current = new Chart(canvas, {
      type: "line",
      data: {
        labels: chronological.map(rep => `S${rep.sessionNumber} R${rep.repNumber}`),
        datasets: [{
          label: config.chartLabel,
          data: chartValues,
          borderColor: "#7cff18",
          backgroundColor: "rgba(124,255,24,0.12)",
          pointBackgroundColor: "#7cff18",
          pointBorderColor: "#041610",
          pointRadius: 4,
          pointHoverRadius: 6,
          borderWidth: 2.6,
          tension: 0.28,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        plugins: { legend: { display: false }, tooltip: { displayColors: false } },
        scales: {
          x: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "rgba(255,255,255,0.55)" } },
          y: {
            beginAtZero: false,
            grid: { color: "rgba(255,255,255,0.07)" },
            ticks: { color: "rgba(255,255,255,0.55)" },
            title: { display: true, text: config.chartLabel, color: "rgba(255,255,255,0.55)" },
          },
        },
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reps]);

  useEffect(() => () => {
    chartRef.current?.destroy();
    chartRef.current = null;
  }, []);

  // Port of setActiveView() → selectInitialRep(): pick the rep matching the initial
  // ?session=/?rep=/?kick= params (digits only) the first time results are shown.
  useEffect(() => {
    if (!active || !reps.length || currentRepId !== null) return;
    const sessionParam = String(initialParams.get("session") || "").replace(/\D/g, "");
    const repParam = String(initialParams.get("rep") || initialParams.get("kick") || "").replace(/\D/g, "");
    const match = reps.find(rep =>
      (!sessionParam || rep.sessionNumber === Number(sessionParam)) &&
      (!repParam || rep.repNumber === Number(repParam)),
    );
    void selectRep((match || reps[0]).id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reps, currentRepId]);

  // Port of renderRep()'s validation-banner update: recomputed only once a rep's
  // artifacts finish loading (the banner keeps its previous state while loading).
  useEffect(() => {
    if (!artifactsBundle) return;
    const meta = (artifactsBundle.artifacts["metadata.json"] || {}) as Record<string, any>;
    const failedSteps = Array.isArray(meta.failedSteps) ? meta.failedSteps : [];
    const hasWarning = meta.resultsValid === false || failedSteps.length > 0;
    if (!hasWarning) {
      setBanner(null);
      return;
    }
    setBanner(
      config.key === "broadJump"
        ? "Foot tracking flagged this rep. The displayed distance may be unreliable."
        : `Processing flagged this rep${failedSteps.length ? `: ${failedSteps.join(", ")}` : ". Some metrics may be missing."}`,
    );
  }, [artifactsBundle, config.key]);

  const definitions = drillBenchmarks[config.key] || [];

  return (
    <>
      <section className="page-intro">
        <div className="intro-copy">
          <p className="eyebrow">{config.eyebrow}</p>
          <div className="title-row">
            <span className="drill-icon material-symbols-outlined">{config.drillIcon}</span>
            <div>
              <h1>{config.title}</h1>
              <p className="athlete-line">
                <strong>{athleteName}</strong> · {reps.length ? `Latest test ${formatDate(reps[0].createdAtMillis)}` : "Awaiting first test"}
              </p>
            </div>
          </div>
        </div>
        <nav className="drill-switcher drill-catalog" aria-label="Athlete tests">
          {drillCatalog.map(drill => {
            const href = buildPageUrl(drill.page, drill.extra || {}, urlState);
            const className = drill.key === config.key ? "active" : "";
            return isPortedPage(drill.page) ? (
              <Link key={drill.key} className={className} to={href}>{drill.label}</Link>
            ) : (
              <a key={drill.key} className={className} href={href}>{drill.label}</a>
            );
          })}
        </nav>
      </section>
      <div id="validationBanner" className={`validation-banner${banner ? "" : " hidden"}`}>
        <span className="material-symbols-outlined">warning</span>
        <span id="validationMessage">{banner || ""}</span>
      </div>
      {reps.length ? (
        <>
          <section className="panel chart-panel">
            <div className="panel-header">
              <div><h2 className="panel-title">{config.chartTitle}</h2></div>
              <span className="range-chip"><span className="material-symbols-outlined">calendar_month</span>All time</span>
            </div>
            <div className="chart-wrap"><canvas id="historyChart" ref={chartCanvasRef} /></div>
          </section>
          <section className="summary-grid" aria-label="Performance summary">
            {summary.map(item => (
              <article key={item.label} className="summary-card">
                <span className="metric-icon material-symbols-outlined">{item.icon}</span>
                <span className="summary-value">{item.value}</span>
                <span className="summary-label">{item.label}</span>
              </article>
            ))}
          </section>
          {definitions.length ? (
            <section className="panel d1-comparison-panel">
              <div className="panel-header">
                <div><p className="eyebrow">Senior benchmark</p><h2 className="panel-title">Compare with D1 standards</h2></div>
                <span className="range-chip">Generation {benchmarks.generation}</span>
              </div>
              <div className="d1-comparison-grid">
                {definitions.map(definition => {
                  const metric = benchmarks.get(definition.key);
                  if (!metric) return null;
                  const best = bestMetricValue(reps, definition);
                  const score = best === null ? null : benchmarks.score(definition.key, best);
                  return (
                    <article key={definition.key} className="d1-comparison-row">
                      <span><strong>{metric.label}</strong><small>Best result</small></span>
                      <span className="d1-athlete-value">{best === null ? "—" : benchmarks.format(definition.key, best)}</span>
                      <span><strong>{benchmarks.format(definition.key, metric.reference)}</strong><small>D1 standard</small></span>
                      <span className="d1-score">{score === null ? "—" : `${Math.round(score)}%`}</span>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}
          <section className="sessions-section">
            <div className="section-heading"><h2>Latest sessions</h2><span>{sessions.length} total</span></div>
            <div id="historyList" className="history-list">
              {sessions.map(session => (
                <button
                  key={session.sessionNumber}
                  className={`history-row${session.latestRep.id === currentRepId ? " active" : ""}`}
                  type="button"
                  data-rep-id={session.latestRep.id}
                  onClick={() => void selectRep(session.latestRep.id)}
                >
                  <span className="history-calendar material-symbols-outlined">calendar_month</span>
                  <span className="history-copy">
                    <strong>{formatDate(session.createdAtMillis)}</strong>
                    <small>{session.reps.length} {session.reps.length === 1 ? "rep" : "reps"}</small>
                  </span>
                  <span className="history-session">Session {session.sessionNumber}</span>
                  <span className="history-value">{formatPrimary(config.key, session.best)}</span>
                  <span className="history-go">View</span>
                </button>
              ))}
            </div>
          </section>
          <section className="panel session-panel" id="repPanel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Session viewer</p>
                <h2 className="panel-title">Rep Analysis</h2>
                <p id="repSubtitle" className="panel-subtitle">{subtitle}</p>
              </div>
            </div>
            <div id="repStrip" className="rep-strip">
              {reps.map(rep => (
                <button
                  key={rep.id}
                  className={`rep-button${rep.id === currentRepId ? " active" : ""}`}
                  type="button"
                  data-rep-id={rep.id}
                  onClick={() => void selectRep(rep.id)}
                >
                  {`S${rep.sessionNumber} · R${rep.repNumber}`}
                </button>
              ))}
            </div>
            <div id="repLoading" className={`loading-screen${artifactsBundle ? " hidden" : ""}`} style={{ minHeight: 300 }}>
              <div><div className="spinner" /><p>Loading pose and metrics…</p></div>
            </div>
            <div id="repContent" className={artifactsBundle ? "" : "hidden"}>
              {artifactsBundle && (
                <RepViewer
                  key={artifactsBundle.seq}
                  config={config}
                  rep={artifactsBundle.rep}
                  artifacts={artifactsBundle.artifacts}
                />
              )}
            </div>
          </section>
        </>
      ) : (
        <section className="empty-panel">
          <h2>No results yet</h2>
          <p>{config.emptyText}</p>
        </section>
      )}
    </>
  );
}
