// An athlete's recorded results inside the admin console: the same drill
// dashboard the athlete portal renders (chart, summary, sessions → reps), with
// every rep opening the rep tools instead of the read-only viewer.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import DrillDashboard from "../../athlete-portal/views/DrillDashboard";
import { DRILLS, drillByKey } from "../../athlete-portal/lib/drills";
import { fullName } from "../../athlete-portal/lib/metrics";
import { loadAdminResults, resultsPath } from "../lib/results";
import { accountContext, accountPlayerPath, accountQuery } from "../lib/accountHierarchy";
import { useAccountLoad } from "../lib/useAccountLoad";

export default function AdminResults() {
  const { playerId = "", drillKey = "" } = useParams();
  const navigate = useNavigate();
  const [query] = useSearchParams();
  const context = accountContext(query);
  const suffix = accountQuery(context);
  const loader = useCallback(() => loadAdminResults(playerId), [playerId]);
  const { state: load, refresh } = useAccountLoad(loader);
  const drill = drillByKey(drillKey || "changeOfDirection");

  useEffect(() => {
    document.title = "Recorded results | PoseTek admin";
  }, []);

  useEffect(() => {
    if (!drillKey) navigate(resultsPath(playerId, "changeOfDirection") + suffix, { replace: true });
  }, [drillKey, navigate, playerId, suffix]);

  const results = load.kind === "ready" ? load.data : null;

  return (
    <>
      <section className="admin-heading">
        <Link className="icon-button" to={accountPlayerPath(playerId, context)} aria-label="Back to the athlete">
          <span className="material-symbols-outlined">arrow_back</span>
        </Link>
        <div>
          <p className="eyebrow">Recorded results</p>
          <h1>{results ? fullName(results.athlete) : "Athlete"}</h1>
          <p>Open a session, then a rep, to inspect it and run the rep tools: fix event frames, annotate the athlete and the ball, and re-process.</p>
        </div>
      </section>

      {load.kind === "loading" && <div className="portal-loading"><span className="spinner" /><p>Loading results…</p></div>}
      {load.kind === "error" && <><p className="form-message" role="alert">{load.message}</p><button className="quiet-button" onClick={refresh}>Try again</button></>}

      {results && (
        <>
          <nav className="drill-tabs admin-drill-tabs" aria-label="Drill results">
            {DRILLS.map(item => (
              <Link
                key={item.key}
                className={`drill-tab${item.key === drill.key ? " active" : ""}`}
                to={resultsPath(playerId, item.key) + suffix}
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
            onOpenRep={(folder, repId) => {
              const target = new URLSearchParams(suffix);
              target.set("session", folder);
              navigate(`${resultsPath(playerId, drill.key, repId)}?${target}`);
            }}
          />
        </>
      )}
    </>
  );
}
