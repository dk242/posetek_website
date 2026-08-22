// Drill catalog browser: every drill in the catalog, filterable by category
// (the plan's training domains) and by name search. Picking a drill hands it
// to the dosage popup — this component never writes anything.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useRef, useState } from "react";
import { domainName, domainShortName } from "../../athlete-portal/lib/training";
import { loadDrillCatalog } from "../lib/data";
import { PREVIEW_CATALOG } from "../lib/preview";

interface DrillPickerProps {
  existingDrillIds: string[];
  preview?: boolean;
  onPick: (catalogDrill: any) => void;
  onClose: () => void;
}

type CatalogState =
  | { kind: "loading" }
  | { kind: "ready"; drills: any[] }
  | { kind: "error"; message: string };

export default function DrillPicker({ existingDrillIds, preview, onPick, onClose }: DrillPickerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<CatalogState>({ kind: "loading" });
  const [category, setCategory] = useState<string>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    if (preview) {
      setState({ kind: "ready", drills: PREVIEW_CATALOG });
      return;
    }
    loadDrillCatalog()
      .then(drills => setState({ kind: "ready", drills }))
      .catch(error => setState({ kind: "error", message: error?.message || "The drill catalog could not be loaded." }));
  }, [preview]);

  const categories = useMemo(() => {
    if (state.kind !== "ready") return [];
    const seen = new Map<string, number>();
    for (const drill of state.drills) {
      const domain = String(drill?.domain || "");
      if (!domain) continue;
      seen.set(domain, (seen.get(domain) ?? 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => domainName(a[0]).localeCompare(domainName(b[0])));
  }, [state]);

  const shown = useMemo(() => {
    if (state.kind !== "ready") return [];
    const term = search.trim().toLowerCase();
    return state.drills
      .filter(drill => category === "all" || String(drill?.domain || "") === category)
      .filter(drill => !term
        || String(drill?.name || "").toLowerCase().includes(term)
        || String(drill?.targetQuality || "").toLowerCase().includes(term))
      .sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
  }, [state, category, search]);

  return (
    <dialog className="portal-dialog drill-picker" ref={dialogRef} onCancel={onClose} onClose={onClose}>
      <div className="dialog-card wide">
        <header>
          <div>
            <p className="eyebrow">Drill catalog</p>
            <h2>Add a drill</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <label className="search-field picker-search">
          <span className="material-symbols-outlined">search</span>
          <input
            type="search"
            placeholder="Search drills"
            autoComplete="off"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </label>

        <div className="picker-categories" role="tablist" aria-label="Drill categories">
          <button type="button" className={`focus-chip toggle ${category === "all" ? "active" : ""}`} onClick={() => setCategory("all")}>
            All
          </button>
          {categories.map(([domain, count]) => (
            <button
              key={domain}
              type="button"
              className={`focus-chip toggle ${category === domain ? "active" : ""}`}
              onClick={() => setCategory(domain)}
            >
              {domainShortName(domain)} <span className="dim">{count}</span>
            </button>
          ))}
        </div>

        <div className="picker-list">
          {state.kind === "loading" && (
            <div className="portal-loading"><span className="spinner" /><p>Loading the catalog…</p></div>
          )}
          {state.kind === "error" && <p className="form-message">{state.message}</p>}
          {state.kind === "ready" && shown.length === 0 && (
            <p className="picker-empty">No drills match — try another category or search.</p>
          )}
          {state.kind === "ready" && shown.map(drill => {
            const already = existingDrillIds.includes(String(drill.drillId));
            return (
              <div key={drill.drillId} className="picker-row">
                <div className="picker-copy">
                  <strong>{String(drill.name || drill.drillId)}</strong>
                  <span className="drill-meta">
                    <span className="domain-chip">{domainShortName(String(drill.domain || ""))}</span>
                    {drill.dose?.doseText ? String(drill.dose.doseText) : ""}
                    {drill.estimatedMinutes?.min
                      ? ` · ~${drill.estimatedMinutes.min}–${drill.estimatedMinutes.max} min`
                      : ""}
                  </span>
                  {drill.execution && <span className="picker-execution">{String(drill.execution).slice(0, 160)}{String(drill.execution).length > 160 ? "…" : ""}</span>}
                </div>
                <button
                  className="primary-cta small"
                  type="button"
                  disabled={already}
                  onClick={() => onPick(drill)}
                >
                  {already ? "In week" : "Add"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </dialog>
  );
}
