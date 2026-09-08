import { DRILL_SHORT_LABELS, MEASURED_DRILL_KEYS } from "../lib/programBatchLogic";
import type { AthleteEvidence } from "../lib/programBatchLogic";

/** Both planner rosters describe the same loaded profile and recorded testing. */
export default function AthleteEvidenceBadges({ evidence, loading, error }: {
  evidence?: AthleteEvidence | null;
  loading?: boolean;
  error?: string;
}) {
  if (error) return <span className="admin-chip danger" title={error}>Evidence unavailable</span>;
  if (loading) return <span className="admin-chip">Checking evidence…</span>;
  if (!evidence) return null;
  const missing = MEASURED_DRILL_KEYS.filter(key => !evidence.tested.includes(key));

  return <>
    {evidence.position
      ? <span className="admin-chip">{evidence.position}</span>
      : <span className="admin-chip warn" title="The engine uses the position-neutral base.">No position</span>}
    {evidence.age === null
      ? <span className="admin-chip danger">No age</span>
      : <span className={`admin-chip${evidence.ageStale ? " warn" : ""}`} title={evidence.ageStale ? "Recorded more than a year ago." : undefined}>Age {evidence.age}{evidence.ageStale ? " · stale" : ""}</span>}
    <span className={`admin-chip${missing.length ? " warn" : " accent"}`}
      title={missing.length ? `Missing ${missing.map(key => DRILL_SHORT_LABELS[key]).join(", ")}` : `${evidence.repCount} reps across all six drills`}>
      {evidence.tested.length}/{MEASURED_DRILL_KEYS.length} tested
    </span>
    {evidence.activePlanVersion !== null && <span className="admin-chip warn">v{evidence.activePlanVersion} plan active</span>}
  </>;
}
