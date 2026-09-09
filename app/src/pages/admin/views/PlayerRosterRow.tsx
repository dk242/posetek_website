import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { PlayerRow } from "../lib/accounts";
import SignupStatus from "./SignupStatus";

export function AccountAvatar({ name }: { name: string }) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : (words[0] || "?").slice(0, 2);
  return <span className="admin-avatar" aria-hidden="true">{initials.toUpperCase()}</span>;
}

/** Navigation and clipboard actions are siblings, never nested interactive controls. */
export default function PlayerRosterRow({ player, compact = false, children }: {
  player: PlayerRow;
  compact?: boolean;
  children?: ReactNode;
}) {
  const path = `/admin/accounts/player/${encodeURIComponent(player.id)}`;
  return (
    <div className={`admin-row admin-player-row${compact ? " compact" : ""}`}>
      <AccountAvatar name={player.name} />
      <div className="admin-player-copy">
        <Link className="admin-row-copy admin-row-link" to={path}>
          <strong>{player.name}</strong>
          <span className="admin-row-meta">
            <span>{player.email || "No email on file"}</span>
            {!player.coachId && !player.teamId && <span className="admin-chip warn">No coach</span>}
            {children}
          </span>
        </Link>
        <SignupStatus registered={player.registered} signupCode={player.signupCode} playerName={player.name} />
      </div>
      <div className="admin-row-actions">
        <Link className="quiet-button small" to={`${path}/results`} aria-label={`Results for ${player.name}`}>
          <span className="material-symbols-outlined" aria-hidden="true">analytics</span>Results
        </Link>
        <Link className="icon-button" to={path} aria-label={`Open ${player.name}`}>
          <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span>
        </Link>
      </div>
    </div>
  );
}
