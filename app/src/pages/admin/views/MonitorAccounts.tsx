import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PLAYER_INDEX_LIMIT, loadClubAccountData, loadCoaches, loadOrganizations, loadPlayerIndex } from "../lib/accounts";
import type { CoachRow, OrganizationRow, PlayerRow } from "../lib/accounts";
import { accountContext, accountQuery, hasClubIdentity, legacyCoachGroups, staffName } from "../lib/accountHierarchy";
import type { AccountContext, ClubStaff, HierarchyTeam } from "../lib/accountHierarchy";
import { useAccountLoad } from "../lib/useAccountLoad";
import PlayerRosterRow, { AccountAvatar } from "./PlayerRosterRow";

async function directory() {
  const [orgs, coaches, index] = await Promise.all([loadOrganizations(), loadCoaches(), loadPlayerIndex()]);
  return { orgs, coaches, index };
}

export default function MonitorAccounts() {
  const { state, refresh } = useAccountLoad(directory);
  const [query, setQuery] = useSearchParams();
  const [search, setSearch] = useState("");
  const selected = accountContext(query);
  useEffect(() => { document.title = "Monitor accounts | PoseTek admin"; }, []);
  const groups = useMemo(() => state.kind === "ready" ? legacyCoachGroups(state.data.orgs, state.data.coaches) : null, [state]);
  const matches = state.kind === "ready" && search.trim().length >= 2
    ? state.data.index.players.filter(player => `${player.name} ${player.email}`.toLowerCase().includes(search.trim().toLowerCase())) : [];
  const choose = (context: AccountContext) => setQuery(accountQuery(context));
  return <>
    <section className="admin-heading"><div><p className="eyebrow">Monitor accounts</p><h1>Organizations, coaches and athletes</h1>
      <p>Open an organization to see its managers, assigned coaches and team rosters. Athlete profiles lead to recorded results and rep tools.</p></div>
      <div className="admin-heading-actions"><button className="quiet-button" onClick={refresh}>Refresh</button>
        <Link className="quiet-button" to={`/admin/organizations${accountQuery({ orgId: selected.orgId, teamId: selected.teamId })}`}>Manage organizations and staff</Link></div></section>
    {state.kind === "loading" && <p role="status">Loading accounts…</p>}
    {state.kind === "error" && <LoadError message={state.message} retry={refresh} />}
    {state.kind === "ready" && groups && <>
      <section className="admin-card"><h2>Find an athlete</h2><label className="search-field"><span className="material-symbols-outlined" aria-hidden="true">search</span>
        <span className="admin-sr-only">Search athletes by name or email</span><input type="search" placeholder="Search athletes by name or email" value={search} onChange={event => setSearch(event.target.value)} /></label>
        {state.data.index.truncated && <p className="admin-note">Searching the first {PLAYER_INDEX_LIMIT} athletes. Open an organization or coach for athletes outside this search.</p>}
        {search.trim().length >= 2 && <div className="admin-rows">{!matches.length && <p className="admin-empty">No athlete matches that.</p>}
          {matches.length > 40 && <p className="admin-note">Showing the first 40 matches. Refine the name or email to narrow the search.</p>}
          {matches.slice(0, 40).map(player => <PlayerRosterRow key={player.id} player={player} context={{ orgId: player.organizationId || undefined, teamId: player.teamId || undefined }} />)}</div>}</section>
      {selected.orgId && !state.data.orgs.some(org => org.id === selected.orgId) && <p className="form-message" role="alert">That organization is no longer available. Choose another organization below.</p>}
      {state.data.orgs.map(org => <section className="admin-card admin-org" key={org.id}>
        <button type="button" className="admin-row admin-team-toggle" aria-expanded={selected.orgId === org.id} onClick={() => choose(selected.orgId === org.id ? {} : { orgId: org.id })}>
          {org.logoUrl ? <img className="admin-org-logo" src={org.logoUrl} alt="" /> : <AccountAvatar name={org.name} />}
          <span className="admin-row-copy"><strong>{org.name}</strong><span className="admin-row-meta">{org.schemaVersion === 2 ? "Organization teams and staff" : "Legacy organization"}{org.code && ` · ${org.code}`}</span></span>
          <span className="material-symbols-outlined" aria-hidden="true">{selected.orgId === org.id ? "expand_more" : "chevron_right"}</span></button>
        {selected.orgId === org.id && (org.schemaVersion === 2 ? <ClubOrganization key={org.id} org={org} selected={selected} choose={choose} />
          : <><h3 className="admin-subhead">Coaches</h3><CoachList coaches={groups.groups.get(org.id) || []} orgId={org.id} /></>)}
      </section>)}
      {!state.data.orgs.length && <p className="admin-empty">No organizations have been created yet.</p>}
      <section className="admin-card"><h2>Independent coaches</h2><CoachList coaches={groups.independent} /></section>
      {groups.unknown.length > 0 && <section className="admin-card"><h2>Coaches with an unavailable organization</h2><p className="admin-note">Their existing account is preserved. Open the roster to inspect its legacy players.</p><CoachList coaches={groups.unknown} /></section>}
      <UnlinkedPlayers players={state.data.index.players} coaches={[...groups.groups.values()].flat().concat(groups.independent, groups.unknown)} organizations={state.data.orgs} truncated={state.data.index.truncated} />
    </>}
  </>;
}

function ClubOrganization({ org, selected, choose }: { org: OrganizationRow; selected: AccountContext; choose: (context: AccountContext) => void }) {
  const loader = useCallback(() => loadClubAccountData(org.id), [org.id]);
  const { state, refresh } = useAccountLoad(loader);
  if (state.kind === "loading") return <p role="status">Loading {org.name}…</p>;
  if (state.kind === "error") return <LoadError message={state.message} retry={refresh} />;
  const { context, hierarchy } = state.data;
  return <>
    <p className="admin-note">{hierarchy.players.length} athletes · {hierarchy.teams.length} teams · {hierarchy.coaches.length} active coaches</p>
    {hierarchy.limits.map(message => <p className="form-message" role="status" key={message}>{message}</p>)}
    <h3 className="admin-subhead">Organization managers</h3>
    {hierarchy.managers.length ? hierarchy.managers.map(member => <StaffRow key={member.userUID} member={member} orgId={org.id} detail="Access to all teams" />) : <p className="admin-empty">No active organization managers.</p>}
    <h3 className="admin-subhead">Coaches</h3>
    {hierarchy.coaches.length ? hierarchy.coaches.map(({ member, teams, players }) => <StaffRow key={member.userUID} member={member} orgId={org.id}
      detail={`${players.length} athletes · ${teams.map(row => row.team.name).join(", ") || "No teams assigned"}`} />) : <p className="admin-empty">No coach accounts are assigned yet. The team rosters below remain available.</p>}
    {hierarchy.teams.some(row => row.coaches.length > 0) && <><h3 className="admin-subhead">Teams with assigned coaches</h3>
      {hierarchy.teams.filter(row => row.coaches.length > 0).map(row => <TeamRoster key={row.team.id} row={row} selected={selected} choose={choose} />)}</>}
    {hierarchy.unassignedTeams.length > 0 && <><h3 className="admin-subhead">Teams without a linked coach</h3><p className="admin-note">Team names may include a coach’s name. A name on a team does not create an account or grant access.</p>
      {hierarchy.unassignedTeams.map(row => <TeamRoster key={row.team.id} row={row} selected={selected} choose={choose} />)}</>}
    {!hierarchy.teams.length && <p className="admin-empty">No teams have been created in this organization.</p>}
    {selected.teamId && !hierarchy.teams.some(row => row.team.id === selected.teamId) && <p className="form-message" role="alert">That team is no longer in this organization. Choose a current team.</p>}
    {hierarchy.unassignedPlayers.length > 0 && <section><h3 className="admin-subhead">Unassigned players</h3><p className="admin-note">These players belong to the organization but have no current team. Assign a team in organization management.</p>
      {hierarchy.unassignedPlayers.map(player => <PlayerRosterRow key={player.id} player={player} context={{ orgId: org.id }} />)}</section>}
    {hierarchy.inactiveStaff.length > 0 && <><h3 className="admin-subhead">Inactive staff</h3>{hierarchy.inactiveStaff.map(member => <StaffRow key={member.userUID} member={member} orgId={org.id} detail={`${member.status || "Invalid membership"} · no active roster access`} />)}</>}
    {context.invitations.length > 0 && <><h3 className="admin-subhead">Staff invitations</h3>{context.invitations.map(invite => <div className="admin-row" key={invite.id}><div className="admin-row-copy"><strong>{[invite.firstName, invite.lastName].filter(Boolean).join(" ") || invite.email}</strong>
      <span className="admin-row-meta">{invite.email} · {invite.role} · {invite.status}</span></div></div>)}</>}
    <Link className="quiet-button" to={`/admin/organizations${accountQuery({ orgId: org.id, teamId: selected.teamId })}`}>Manage teams and staff access</Link>
  </>;
}

export function TeamRoster({ row, selected, choose }: { row: HierarchyTeam; selected: AccountContext; choose: (context: AccountContext) => void }) {
  const open = selected.teamId === row.team.id;
  const context = { ...selected, orgId: row.team.organizationId, teamId: row.team.id };
  return <div className={`admin-team${open ? " open" : ""}`}>
    <button type="button" className="admin-row admin-team-toggle" aria-expanded={open} onClick={() => choose({ ...context, teamId: open ? undefined : row.team.id })}>
      <span className="material-symbols-outlined" aria-hidden="true">{open ? "expand_more" : "chevron_right"}</span><span className="admin-row-copy"><strong>{row.team.name}</strong>
        <span className="admin-row-meta">{row.players.length} {row.players.length === 1 ? "athlete" : "athletes"} · {row.coaches.map(staffName).join(", ") || "No linked coach account"}</span></span></button>
    {open && <div className="admin-team-players">{!row.players.length && <p className="admin-empty">No athletes on this team yet.</p>}
      {row.players.map(player => <PlayerRosterRow key={player.id} player={player} compact context={context} />)}</div>}
  </div>;
}

function StaffRow({ member, orgId, detail }: { member: ClubStaff; orgId: string; detail: string }) {
  return <Link className="admin-row" to={`/admin/accounts/coach/${encodeURIComponent(member.userUID)}${accountQuery({ orgId })}`}><AccountAvatar name={staffName(member)} />
    <span className="admin-row-copy"><strong>{staffName(member)}</strong><span className="admin-row-meta">{member.email || "No email on file"} · {member.role}</span><span className="admin-row-meta">{detail}</span></span>
    <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span></Link>;
}
function CoachList({ coaches, orgId }: { coaches: CoachRow[]; orgId?: string }) {
  if (!coaches.length) return <p className="admin-empty">No coaches here.</p>;
  return <div className="admin-rows">{coaches.map(coach => <Link key={coach.id} className="admin-row" to={`/admin/accounts/coach/${encodeURIComponent(coach.id)}${accountQuery({ orgId })}`}>
    <AccountAvatar name={coach.name} /><span className="admin-row-copy"><strong>{coach.name}</strong><span className="admin-row-meta">{coach.email || "No email on file"} · Legacy roster</span></span>
    <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span></Link>)}</div>;
}
function UnlinkedPlayers({ players, coaches, organizations, truncated }: { players: PlayerRow[]; coaches: CoachRow[]; organizations: OrganizationRow[]; truncated: boolean }) {
  const unlinked = players.filter(player => hasClubIdentity(player)
    ? !organizations.some(org => org.schemaVersion === 2 && org.id === player.organizationId)
    : !coaches.some(coach => coach.members.includes(player.id) || coach.id === player.coachId || coach.userUID === player.coachId));
  if (!unlinked.length) return null;
  return <section className="admin-card"><h2>Players needing an account assignment</h2><p className="admin-note">{truncated ? `From the first ${PLAYER_INDEX_LIMIT} athletes: ` : ""}These profiles have no linked coach or a missing organization. Their results remain available.</p>
    {unlinked.map(player => <PlayerRosterRow key={player.id} player={player} />)}</section>;
}
export function LoadError({ message, retry }: { message: string; retry: () => void }) {
  return <div><p className="form-message" role="alert">{message}</p><button className="quiet-button" onClick={retry}>Try again</button></div>;
}
