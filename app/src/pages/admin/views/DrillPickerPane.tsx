// The editor's left pane: "they can search up drills on the left hand side,
// sort by domain, and drag in".
//
// Drag is offered, and so is a plain Add button on every row — a drag-only
// editor is unusable with a keyboard or a trackpad someone struggles with.
// Each row shows how the drill sits against THIS athlete (age, difficulty
// ceiling, partner, equipment) and how much of its weekly limit is left.

import { useMemo, useState } from "react";
import { fitFor } from "../../../lib/contracts/drillV2";
import type { AthleteContext, CatalogDrill } from "../../../lib/contracts/drillV2";
import { DOMAINS, domainLabel, domainSortIndex } from "../../../lib/contracts/types";

export const DRAG_DRILL_PREFIX = "posetek-drill:";
export const DRAG_BLOCK_PREFIX = "posetek-block:";

export interface PickerProps {
  drills: CatalogDrill[];
  athlete: AthleteContext;
  /** How many workouts this week already use each drill, target included. */
  exposures: Record<string, number>;
  onAdd: (drill: CatalogDrill) => void;
}

export default function DrillPickerPane({ drills, athlete, exposures, onAdd }: PickerProps) {
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState("all");
  const [eligibleOnly, setEligibleOnly] = useState(true);

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return drills
      .filter(drill => drill.status === "published")
      .filter(drill => domain === "all" || drill.domain === domain)
      .filter(drill => !term
        || drill.name.toLowerCase().includes(term)
        || drill.drillId.toLowerCase().includes(term))
      .filter(drill => {
        if (!eligibleOnly) return true;
        const fit = fitFor(drill, athlete);
        return fit.ageOk && fit.difficultyOk && fit.partnerOk && fit.positionOk;
      })
      .sort((a, b) => domainSortIndex(a.domain) - domainSortIndex(b.domain) || a.name.localeCompare(b.name))
      .slice(0, 200);
  }, [drills, search, domain, eligibleOnly, athlete]);

  return (
    <aside className="admin-picker" aria-label="Drill catalog">
      <label className="search-field">
        <span className="material-symbols-outlined">search</span>
        <input
          type="search"
          placeholder="Search drills"
          autoComplete="off"
          value={search}
          onChange={event => setSearch(event.target.value)}
        />
      </label>

      <label className="admin-field">
        <select value={domain} onChange={event => setDomain(event.target.value)} aria-label="Sort by domain">
          <option value="all">All domains</option>
          {DOMAINS.map(value => <option key={value} value={value}>{domainLabel(value)}</option>)}
        </select>
      </label>

      <label className="admin-checks">
        <span>
          <input type="checkbox" checked={eligibleOnly} onChange={event => setEligibleOnly(event.target.checked)} />{" "}
          Only drills this athlete is eligible for
        </span>
      </label>

      <div className="admin-picker-list">
        {shown.length === 0 && <p className="admin-empty">No drills match.</p>}
        {shown.map(drill => {
          const fit = fitFor(drill, athlete);
          const used = exposures[drill.drillId] ?? 0;
          const atLimit = used >= drill.maxFrequencyPerWeek;
          const blocked = atLimit;
          return (
            <div
              key={drill.drillId}
              className={`admin-picker-row${blocked ? " is-blocked" : ""}`}
              draggable={!blocked}
              onDragStart={event => {
                event.dataTransfer.setData("text/plain", `${DRAG_DRILL_PREFIX}${drill.drillId}`);
                event.dataTransfer.effectAllowed = "copy";
              }}
            >
              <div className="admin-picker-copy">
                <span className="admin-picker-name">{drill.name}</span>
                <span className="admin-picker-meta">
                  <span className="admin-chip accent">{domainLabel(drill.domain)}</span>
                  <span>L{drill.difficultyLevel}</span>
                  <span>{drill.minAge}–{drill.maxAge}</span>
                  {drill.requiresPartner && <span className="admin-chip">partner</span>}
                  <span className={atLimit ? "admin-chip danger" : "admin-chip"}>
                    {used}/{drill.maxFrequencyPerWeek} this week
                  </span>
                  {!fit.ageOk && <span className="admin-chip warn">age</span>}
                  {!fit.difficultyOk && <span className="admin-chip warn">too hard</span>}
                  {!fit.partnerOk && <span className="admin-chip warn">needs a partner</span>}
                  {!fit.positionOk && <span className="admin-chip warn">{drill.positionSpecific} only</span>}
                  {!fit.equipmentOk && <span className="admin-chip warn">equipment</span>}
                </span>
              </div>
              <button
                className="primary-cta small"
                type="button"
                disabled={blocked}
                title={atLimit ? `${drill.name} is already at its weekly limit of ${drill.maxFrequencyPerWeek}.` : undefined}
                onClick={() => onAdd(drill)}
              >
                {atLimit ? "At limit" : "Add"}
              </button>
            </div>
          );
        })}
      </div>
      <p className="admin-note">
        Drag a drill onto the workout, or use Add. A drill already at its weekly limit cannot be
        added — that limit is not overridable.
      </p>
    </aside>
  );
}
