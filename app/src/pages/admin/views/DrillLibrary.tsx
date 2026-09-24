// Drill library — "we can see all of the existing drills, the summaries, the
// videos associated with them, and all of the fields by clicking them. There is
// also a button at the top 'create new drill' … this page needs to have a
// search bar so you can search for drills by name and you should be able to
// sort by 'domain'."
//
// One `drillCatalog` read, filtered client-side: the catalog is ~120 documents,
// so a query per keystroke would cost more than it saves.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DOMAINS, domainLabel, domainSortIndex } from "../../../lib/contracts/types";
import { formatDoseText } from "../../../lib/contracts/drillV2";
import type { CatalogDrill } from "../../../lib/contracts/drillV2";
import { loadCatalog, loadCatalogVersion, presentSlots } from "../lib/catalog";
import { loadDrillAuthoring } from "../lib/trainingAuthoring";
import { filmingProgress, type DrillAuthoring } from "../lib/wholeBodyTraining";
import { TrainingReviewerDesignation } from "./TrainingReadinessPanel";

// A stable empty array: a fresh `[]` per render would make every memo below
// recompute on every keystroke.
const NO_DRILLS: CatalogDrill[] = [];

type Load =
  | { kind: "loading" }
  | { kind: "ready"; drills: CatalogDrill[]; version: string }
  | { kind: "error"; message: string };

export default function DrillLibrary() {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState("all");
  const [status, setStatus] = useState("all");
  const [filmingWeek, setFilmingWeek] = useState("all");
  const [authoring, setAuthoring] = useState<Record<string, DrillAuthoring>>({});
  const [authoringError, setAuthoringError] = useState("");

  useEffect(() => {
    document.title = "Drill library | PoseTek admin";
    Promise.all([loadCatalog(), loadCatalogVersion()])
      .then(([drills, version]) => setLoad({ kind: "ready", drills, version }))
      .catch(error => setLoad({ kind: "error", message: error?.message || "The drill catalog could not be loaded." }));
    void loadDrillAuthoring().then(result => setAuthoring(result.records)).catch(error => setAuthoringError(error?.message || "The filming queue could not be loaded."));
  }, []);

  const drills = load.kind === "ready" ? load.drills : NO_DRILLS;

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const drill of drills) map.set(drill.domain, (map.get(drill.domain) ?? 0) + 1);
    return map;
  }, [drills]);

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return drills
      .filter(drill => domain === "all" || drill.domain === domain)
      .filter(drill => status === "all" || drill.status === status)
      .filter(drill => filmingWeek === "all" || String(authoring[drill.drillId]?.filmingWeek) === filmingWeek)
      .filter(drill => !term
        || drill.name.toLowerCase().includes(term)
        || drill.drillId.toLowerCase().includes(term))
      // Domain first, in the contract's table order, then name — "sort by domain".
      .sort((a, b) =>
        domainSortIndex(a.domain) - domainSortIndex(b.domain) || a.name.localeCompare(b.name));
  }, [drills, search, domain, status, filmingWeek, authoring]);

  const unmigrated = drills.filter(drill => drill.needsMigration).length;

  return (
    <>
      <section className="admin-heading">
        <div>
          <p className="eyebrow">Drill library</p>
          <h1>{drills.length ? `${drills.length} drills` : "Drill library"}</h1>
          <p>{load.kind === "ready" ? `Catalog version ${load.version}` : "Loading the catalog…"}</p>
        </div>
        <div className="admin-heading-actions">
          <Link className="primary-cta" to="/admin/drills/new">
            <span className="material-symbols-outlined">add</span>Create new drill
          </Link>
        </div>
      </section>

      {unmigrated > 0 && (
        <div className="admin-banner warn">
          <span className="material-symbols-outlined">sync_problem</span>
          <p>
            {unmigrated} {unmigrated === 1 ? "drill has" : "drills have"} not been migrated to
            catalog v2 yet. They are shown with values derived from their v1 fields and are
            read-only here — the migration is the mobile side's to run.
          </p>
        </div>
      )}

      <div className="admin-toolbar training-library-toolbar">
        <label className="search-field">
          <span className="material-symbols-outlined">search</span>
          <input
            type="search"
            placeholder="Search drills by name or id"
            autoComplete="off"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </label>
        <label>
          <span className="material-symbols-outlined" aria-hidden="true">category</span>
          <select value={domain} onChange={event => setDomain(event.target.value)} aria-label="Sort by domain">
            <option value="all">All domains</option>
            {DOMAINS.map(value => (
              <option key={value} value={value}>
                {domainLabel(value)}{counts.get(value) ? ` (${counts.get(value)})` : ""}
              </option>
            ))}
            {[...counts.keys()]
              .filter(value => !(DOMAINS as readonly string[]).includes(value))
              .map(value => (
                <option key={value} value={value}>{domainLabel(value)} ({counts.get(value)})</option>
              ))}
          </select>
        </label>
        <select value={status} onChange={event => setStatus(event.target.value)} aria-label="Filter by status">
          <option value="all">Any status</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>
        <select value={filmingWeek} onChange={event => setFilmingWeek(event.target.value)} aria-label="Filter by filming week">
          <option value="all">All filming weeks</option>{[1, 2, 3, 4].map(week => <option key={week} value={week}>Filming week {week}</option>)}
        </select>
      </div>
      {authoringError && <p className="form-message" role="status">Filming queue unavailable: {authoringError}</p>}
      {Object.keys(authoring).length > 0 && <p className="admin-note">Four-week filming queue · 20 drills and 60 clips per week. Drafts stay unpublished until reviewed content and all three clips are approved.</p>}

      {load.kind === "loading" && (
        <div className="portal-loading"><span className="spinner" /><p>Loading the catalog…</p></div>
      )}
      {load.kind === "error" && <p className="form-message" role="alert">{load.message}</p>}

      {load.kind === "ready" && (
        <div className="admin-rows">
          {shown.length === 0 && <p className="admin-empty">No drills match that search.</p>}
          {shown.map(drill => (
            <Link key={drill.drillId} className="admin-row training-library-row" to={`/admin/drills/${drill.drillId}`}>
              <div className="admin-row-copy">
                <strong>{drill.name}</strong>
                <span className="admin-row-meta">
                  <span className="admin-chip accent">{domainLabel(drill.domain)}</span>
                  <span className="admin-chip">{drill.drillId}</span>
                  <span>Level {drill.difficultyLevel}</span>
                  <span>Ages {drill.minAge}–{drill.maxAge}</span>
                  <span>{formatDoseText(drill.dose) || "No structured dose"}</span>
                </span>
              </div>
              <div className="admin-row-actions">
                {drill.requiresPartner && <span className="admin-chip">Partner</span>}
                {authoring[drill.drillId] && <span className="admin-chip">Film week {authoring[drill.drillId].filmingWeek} · {filmingProgress(drill.media).approved}/3 clips approved</span>}
                {drill.positionSpecific && <span className="admin-chip">{drill.positionSpecific} only</span>}
                {presentSlots(drill.media).length > 0 && (
                  <span className="admin-chip">
                    <span className="material-symbols-outlined" aria-hidden="true">movie</span>
                    {presentSlots(drill.media).length}
                  </span>
                )}
                {drill.status !== "published" && (
                  <span className={`admin-chip ${drill.status === "archived" ? "danger" : "warn"}`}>{drill.status}</span>
                )}
                {drill.needsMigration && <span className="admin-chip warn">v1</span>}
                <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      <TrainingReviewerDesignation />
    </>
  );
}
