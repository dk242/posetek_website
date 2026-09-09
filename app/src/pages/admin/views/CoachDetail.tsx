// One coach: their roster, and the team-wide technical eligibility rating.
//
// PLAYER_PROFILE_INPUTS_CONTRACT.md §7 — `coaches/{id}.maxDrillDifficulty` is
// an optional integer 1–5 that only an admin sets. Unset means all five levels;
// a player's own override beats it.

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { db } from "../../../lib/firebase";
import { loadCoachRoster, saveCoachRating } from "../lib/accounts";
import type { CoachRow, PlayerRow } from "../lib/accounts";
import PlayerRosterRow from "./PlayerRosterRow";

export default function CoachDetail() {
  const { coachId = "" } = useParams();
  const [coach, setCoach] = useState<CoachRow | null>(null);
  const [roster, setRoster] = useState<PlayerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.title = "Coach | PoseTek admin";
    let live = true;
    (async () => {
      try {
        const doc = await db.collection("coaches").doc(coachId).get();
        if (!doc.exists) throw new Error("That coach account no longer exists.");
        const data: any = doc.data() || {};
        const row: CoachRow = {
          id: doc.id,
          userUID: String(data.userUID || doc.id),
          name: [data.firstName, data.lastName].filter(Boolean).join(" ").trim() || "Coach",
          email: String(data.email || ""),
          members: Array.isArray(data.members) ? data.members.map((entry: unknown) => String(entry)) : [],
          organizationId: typeof data.organization?.id === "string" ? data.organization.id : null,
          organizationCode: data.organizationCode ? String(data.organizationCode) : null,
          maxDrillDifficulty:
            typeof data.maxDrillDifficulty === "number" ? data.maxDrillDifficulty : null,
        };
        if (!live) return;
        setCoach(row);
        setRoster(await loadCoachRoster(row));
      } catch (error: any) {
        if (live) setMessage(error?.message || "That coach could not be loaded.");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [coachId]);

  async function setRating(value: number | null) {
    setSaving(true);
    setMessage(null);
    try {
      await saveCoachRating(coachId, value);
      setCoach(current => (current ? { ...current, maxDrillDifficulty: value } : current));
      setMessage(
        value === null
          ? "Cleared. This team is eligible for all five difficulty levels again."
          : `Saved. This team's drills are capped at difficulty ${value}; a player's own override still wins.`,
      );
    } catch (error: any) {
      setMessage(error?.message || "That rating could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="portal-loading"><span className="spinner" /><p>Loading the coach…</p></div>;
  if (!coach) return <p className="form-message" role="alert">{message}</p>;

  return (
    <>
      <section className="admin-heading">
        <Link className="icon-button" to="/admin/accounts" aria-label="Back to accounts">
          <span className="material-symbols-outlined">arrow_back</span>
        </Link>
        <div>
          <p className="eyebrow">Coach</p>
          <h1>{coach.name}</h1>
          <p>{coach.email || "No email on file"} · {roster.length} athletes</p>
        </div>
      </section>

      {message && <div className="admin-banner good"><span className="material-symbols-outlined">info</span><p>{message}</p></div>}

      <section className="admin-card">
        <h3>Maximum drill difficulty</h3>
        <p className="admin-note">
          Applies to this coach's whole team. Unset means all levels. An individual athlete's
          override, set on their own page, beats this.
        </p>
        <div className="admin-checks">
          <button
            className={`quiet-button${coach.maxDrillDifficulty === null ? " active" : ""}`}
            type="button" disabled={saving} onClick={() => setRating(null)}
          >
            All levels (1–5)
          </button>
          {[1, 2, 3, 4, 5].map(level => (
            <button
              key={level}
              className={`quiet-button${coach.maxDrillDifficulty === level ? " active" : ""}`}
              type="button" disabled={saving} onClick={() => setRating(level)}
            >
              Up to {level}
            </button>
          ))}
        </div>
      </section>

      <section className="admin-card">
        <h3>Roster</h3>
        {roster.length === 0 && <p className="admin-empty">No athletes on this roster yet.</p>}
        <div className="admin-rows">
          {roster.map(player => (
            <PlayerRosterRow key={player.id} player={player}>
              {player.raw?.position && <span className="admin-chip">{String(player.raw.position)}</span>}
              {typeof player.raw?.maxDrillDifficulty === "number" && (
                <span className="admin-chip accent">Own cap {player.raw.maxDrillDifficulty}</span>
              )}
            </PlayerRosterRow>
          ))}
        </div>
      </section>
    </>
  );
}
