// An athlete's recorded results inside the admin console: the same drill
// dashboard the athlete portal renders (chart, summary, sessions → reps), with
// every rep opening the rep tools instead of the read-only viewer.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import DrillDashboard from "../../athlete-portal/views/DrillDashboard";
import { DRILLS, drillByKey } from "../../athlete-portal/lib/drills";
import { fullName } from "../../athlete-portal/lib/metrics";
import { loadAdminResults, resultsPath } from "../lib/results";
import type { AdminResults as Results } from "../lib/results";

type Load =
  | { kind: "loading" }
  | { kind: "ready"; results: Results }
  | { kind: "error"; message: string };

export default function AdminResults() {
  const { playerId = "", drillKey = "" } = useParams();
  const navigate = useNavigate();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const drill = drillByKey(drillKey || "changeOfDirection");

  useEffect(() => {
    document.title = "Recorded results | PoseTek admin";
    let live = true;
    loadAdminResults(playerId)
      .then(results => { if (live) setLoad({ kind: "ready", results }); })
      .catch(error => { if (live) setLoad({ kind: "error", message: error?.message || "The athlete's results could not be loaded." }); });
    return () => { live = false; };
  }, [playerId]);

  useEffect(() => {
    if (!drillKey) navigate(resultsPath(playerId, "changeOfDirection"), { replace: true });
  }, [drillKey, navigate, playerId]);

  const results = load.kind === "ready" ? load.results : null;

  return (
    <>
      <section className="admin-heading">
        <Link className="icon-button" to={`/admin/accounts/player/${encodeURIComponent(playerId)}`} aria-label="Back to the athlete">
          <span className="material-symbols-outlined">arrow_back</span>
        </Link>
        <div>
          <p className="eyebrow">Recorded results</p>
          <h1>{results ? fullName(results.athlete) : "Athlete"}</h1>
          <p>Open a session, then a rep, to inspect it and run the rep tools: fix event frames, annotate the athlete and the ball, and re-process.</p>
        </div>
      </section>

      {load.kind === "loading" && <div className="portal-loading"><span className="spinner" /><p>Loading results…</p></div>}
      {load.kind === "error" && <p className="form-message" role="alert">{load.message}</p>}

      {results && (
        <>
          <nav className="drill-tabs admin-drill-tabs" aria-label="Drill results">
            {DRILLS.map(item => (
              <Link
                key={item.key}
                className={`drill-tab${item.key === drill.key ? " active" : ""}`}
                to={resultsPath(playerId, item.key)}
              >
                <span className="material-symbols-outlined">{item.icon}</span>
                {item.short || item.label}
                <span className="count">{results.reps[item.key]?.length ?? 0}</span>
              </Link>
            ))}
          </nav>
          <DrillDashboard
            key={drill.key}
            drill={drill}
            reps={results.reps[drill.key] ?? []}
            athlete={results.athlete}
            onOpenRep={(folder, repId) => navigate(`${resultsPath(playerId, drill.key, repId)}?session=${encodeURIComponent(folder)}`)}
          />
        </>
      )}
    </>
  );
}
