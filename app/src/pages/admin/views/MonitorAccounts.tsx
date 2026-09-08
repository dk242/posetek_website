// Monitor accounts — "navigate into a coaches account -> player".
// Organizations first: a club's teams open straight to their athletes, so an
// admin can reach any athlete's recorded results in three clicks. Then the
// coaches under each organization, independent coaches, and a search across
// the roster for a player who is not where you expected (including players
// with no coach at all).
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
  loadTeamPlayers,
  loadTeams,
} from "../lib/accounts";
import type { CoachRow, OrganizationRow, PlayerRow, TeamRow } from "../lib/accounts";

// Stable empties, so the memos below do not recompute on every keystroke.
const NO_COACHES: CoachRow[] = [];
const NO_ORGS: OrganizationRow[] = [];
const NO_PLAYERS: PlayerRow[] = [];
const NO_TEAMS: TeamRow[] = [];

type Load =
  | { kind: "loading" }
  | { kind: "ready"; orgs: OrganizationRow[]; coaches: CoachRow[]; teams: TeamRow[]; players: PlayerRow[]; truncated: boolean }
  | { kind: "error"; message: string };

export default function MonitorAccounts() {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [search, setSearch] = useState("");

  useEffect(() => {
    document.title = "Monitor accounts | PoseTek admin";
    Promise.all([loadOrganizations(), loadCoaches(), loadPlayerIndex(), loadTeams().catch(() => NO_TEAMS)])
      .then(([orgs, coaches, index, teams]) =>
        setLoad({ kind: "ready", orgs, coaches, teams, players: index.players, truncated: index.truncated }))
      .catch(error => setLoad({ kind: "error", message: error?.message || "Accounts could not be loaded." }));
  }, []);

  const coaches = load.kind === "ready" ? load.coaches : NO_COACHES;
  const orgs = load.kind === "ready" ? load.orgs : NO_ORGS;
  const players = load.kind === "ready" ? load.players : NO_PLAYERS;
  const teams = load.kind === "ready" ? load.teams : NO_TEAMS;

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

  const teamsByOrg = useMemo(() => {
    const map = new Map<string, TeamRow[]>();
    for (const team of teams) map.set(team.organizationId, [...(map.get(team.organizationId) ?? []), team]);
    return map;
  }, [teams]);

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
          <p>Open an organization's team to reach its athletes, or a coach to see their roster. Every athlete page links to their recorded results and the rep tools.</p>
        </div>
        <div className="admin-heading-actions">
          <Link className="quiet-button" to="/admin/organizations">
            <span className="material-symbols-outlined">groups</span>Manage organizations and staff
          </Link>
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
                through their team or their coach's roster instead.
              </p>
            )}
            {search.trim().length >= 2 && (
              <div className="admin-rows">
                {matches.length === 0 && <p className="admin-empty">No athlete matches that.</p>}
                {matches.map(player => <PlayerRowLink key={player.id} player={player} />)}
              </div>
            )}
          </section>

          {orgs.map(org => (
            <section className="admin-card admin-org" key={org.id}>
              <header className="admin-org-head">
                {org.logoUrl && <img className="admin-org-logo" src={org.logoUrl} alt="" />}
                <h3>
                  {org.name}
                  {org.code && <span className="admin-chip">{org.code}</span>}
                  {org.schemaVersion === 2
                    ? <span className="admin-chip accent">club</span>
                    : <span className="admin-chip">legacy roster</span>}
                </h3>
              </header>
              {org.schemaVersion === 2 && (
                <TeamList teams={teamsByOrg.get(org.id) ?? []} index={players} />
              )}
              <h4 className="admin-subhead">Coaches</h4>
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

// MARK: - Teams → athletes

function TeamList({ teams, index }: { teams: TeamRow[]; index: PlayerRow[] }) {
  if (!teams.length) return <p className="admin-empty">No teams have been created in this club yet.</p>;
  return (
    <div className="admin-rows admin-teams">
      {teams.map(team => <TeamRowView key={team.id} team={team} index={index} />)}
    </div>
  );
}

function TeamRowView({ team, index }: { team: TeamRow; index: PlayerRow[] }) {
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<PlayerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || roster) return;
    let live = true;
    loadTeamPlayers(team, index)
      .then(rows => { if (live) setRoster(rows); })
      .catch(failure => { if (live) setError(failure?.message || "The team's athletes could not be loaded."); });
    return () => { live = false; };
  }, [open, roster, team, index]);

  return (
    <div className={`admin-team${open ? " open" : ""}`}>
      <button className="admin-row admin-team-toggle" type="button" aria-expanded={open} onClick={() => setOpen(current => !current)}>
        <span className="material-symbols-outlined" aria-hidden="true">{open ? "expand_more" : "chevron_right"}</span>
        <div className="admin-row-copy">
          <strong>{team.name}</strong>
          <span className="admin-row-meta">
            <span>{team.playerIds.length} {team.playerIds.length === 1 ? "athlete" : "athletes"}</span>
            <span>{team.coachUIDs.length} {team.coachUIDs.length === 1 ? "coach" : "coaches"}</span>
          </span>
        </div>
      </button>
      {open && (
        <div className="admin-team-players">
          {error && <p className="form-message" role="alert">{error}</p>}
          {!error && !roster && <p className="admin-note">Loading athletes…</p>}
          {roster && roster.length === 0 && <p className="admin-empty">No athletes on this team yet.</p>}
          {roster && roster.map(player => <PlayerRowLink key={player.id} player={player} compact />)}
        </div>
      )}
    </div>
  );
}

function PlayerRowLink({ player, compact = false }: { player: PlayerRow; compact?: boolean }) {
  return (
    <div className={`admin-row admin-player-row${compact ? " compact" : ""}`}>
      <Link className="admin-row-copy admin-row-link" to={`/admin/accounts/player/${encodeURIComponent(player.id)}`}>
        <strong>{player.name}</strong>
        <span className="admin-row-meta">
          <span>{player.email || "no email on file"}</span>
          {!player.coachId && !player.teamId && <span className="admin-chip warn">no coach</span>}
          {!player.registered && <span className="admin-chip">awaiting signup</span>}
        </span>
      </Link>
      <div className="admin-row-actions">
        <Link className="quiet-button small" to={`/admin/accounts/player/${encodeURIComponent(player.id)}/results`}>
          <span className="material-symbols-outlined">analytics</span>Results
        </Link>
        <Link className="icon-button" to={`/admin/accounts/player/${encodeURIComponent(player.id)}`} aria-label={`Open ${player.name}`}>
          <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span>
        </Link>
      </div>
    </div>
  );
}

// MARK: - Coaches

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
