// Monitor accounts — "navigate into a coaches account -> player".
// Organizations and their coaches, independent coaches, and a search across the
// roster for a player who is not under the coach you expected (including
// players with no coach at all).
//
// This is the navigation the identity contract §4 describes, not an
// account-health dashboard.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  PLAYER_INDEX_LIMIT,
  loadCoaches,
  loadOrganizations,
  loadPlayerIndex,
} from "../lib/accounts";
import type { CoachRow, OrganizationRow, PlayerRow } from "../lib/accounts";

// Stable empties, so the memos below do not recompute on every keystroke.
const NO_COACHES: CoachRow[] = [];
const NO_ORGS: OrganizationRow[] = [];
const NO_PLAYERS: PlayerRow[] = [];

type Load =
  | { kind: "loading" }
  | { kind: "ready"; orgs: OrganizationRow[]; coaches: CoachRow[]; players: PlayerRow[]; truncated: boolean }
  | { kind: "error"; message: string };

export default function MonitorAccounts() {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [search, setSearch] = useState("");

  useEffect(() => {
    document.title = "Monitor accounts | PoseTek admin";
    Promise.all([loadOrganizations(), loadCoaches(), loadPlayerIndex()])
      .then(([orgs, coaches, index]) =>
        setLoad({ kind: "ready", orgs, coaches, players: index.players, truncated: index.truncated }))
      .catch(error => setLoad({ kind: "error", message: error?.message || "Accounts could not be loaded." }));
  }, []);

  const coaches = load.kind === "ready" ? load.coaches : NO_COACHES;
  const orgs = load.kind === "ready" ? load.orgs : NO_ORGS;
  const players = load.kind === "ready" ? load.players : NO_PLAYERS;

  const coachesByOrg = useMemo(() => {
    const map = new Map<string, CoachRow[]>();
    for (const coach of coaches) {
      const key = coach.organizationId ?? "__independent__";
      map.set(key, [...(map.get(key) ?? []), coach]);
    }
    // A coach listed on the organization document but without the back-pointer
    // still belongs to it — both relations exist in real data.
    for (const org of orgs) {
      for (const coachId of org.coachIds) {
        const coach = coaches.find(entry => entry.id === coachId || entry.userUID === coachId);
        if (!coach) continue;
        const current = map.get(org.id) ?? [];
        if (!current.some(entry => entry.id === coach.id)) map.set(org.id, [...current, coach]);
        const independents = map.get("__independent__") ?? [];
        if (!coach.organizationId) {
          map.set("__independent__", independents.filter(entry => entry.id !== coach.id));
        }
      }
    }
    return map;
  }, [coaches, orgs]);

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term.length < 2) return [];
    return players
      .filter(player => player.name.toLowerCase().includes(term) || player.email.toLowerCase().includes(term))
      .slice(0, 40);
  }, [players, search]);

  return (
    <>
      <section className="admin-heading">
        <div>
          <p className="eyebrow">Monitor accounts</p>
          <h1>Organizations, coaches and athletes</h1>
          <p>Open a coach to see their roster, then an athlete to see and edit their program.</p>
        </div>
      </section>

      {load.kind === "loading" && <div className="portal-loading"><span className="spinner" /><p>Loading accounts…</p></div>}
      {load.kind === "error" && <p className="form-message" role="alert">{load.message}</p>}

      {load.kind === "ready" && (
        <>
          <section className="admin-card">
            <h3>Find an athlete</h3>
            <div className="admin-toolbar">
              <label className="search-field">
                <span className="material-symbols-outlined">search</span>
                <input
                  type="search"
                  placeholder="Search athletes by name or email"
                  autoComplete="off"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                />
              </label>
            </div>
            {load.truncated && (
              <p className="admin-note">
                Searching the first {PLAYER_INDEX_LIMIT} athletes. If someone is missing, open them
                through their coach's roster instead.
              </p>
            )}
            {search.trim().length >= 2 && (
              <div className="admin-rows">
                {matches.length === 0 && <p className="admin-empty">No athlete matches that.</p>}
                {matches.map(player => (
                  <Link key={player.id} className="admin-row" to={`/admin/accounts/player/${player.id}`}>
                    <div className="admin-row-copy">
                      <strong>{player.name}</strong>
                      <span className="admin-row-meta">
                        <span>{player.email || "no email on file"}</span>
                        {!player.coachId && <span className="admin-chip warn">no coach</span>}
                        {!player.registered && <span className="admin-chip">awaiting signup</span>}
                      </span>
                    </div>
                    <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {orgs.map(org => (
            <section className="admin-card" key={org.id}>
              <h3>{org.name} {org.code && <span className="admin-chip">{org.code}</span>}</h3>
              <CoachList coaches={coachesByOrg.get(org.id) ?? []} />
            </section>
          ))}

          <section className="admin-card">
            <h3>Independent coaches</h3>
            <CoachList coaches={(coachesByOrg.get("__independent__") ?? []).filter(coach => !coach.organizationId)} />
          </section>
        </>
      )}
    </>
  );
}

function CoachList({ coaches }: { coaches: CoachRow[] }) {
  if (!coaches.length) return <p className="admin-empty">No coaches here.</p>;
  return (
    <div className="admin-rows">
      {coaches.map(coach => (
        <Link key={coach.id} className="admin-row" to={`/admin/accounts/coach/${coach.id}`}>
          <div className="admin-row-copy">
            <strong>{coach.name}</strong>
            <span className="admin-row-meta">
              <span>{coach.email || "no email"}</span>
              <span>{coach.members.length} on the roster</span>
              <span className="admin-chip">
                Max difficulty {coach.maxDrillDifficulty ?? "all (1–5)"}
              </span>
            </span>
          </div>
          <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span>
        </Link>
      ))}
    </div>
  );
}
