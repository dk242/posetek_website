import { blockTrainingRationale, evidenceBasisLabel, type TrainingPriority } from "../lib/personalizedLogic";

const roleLabel = { primary: "Priority", support: "Support", maintain: "Maintain" };
const minutes = (value: number) => Number.isInteger(value) ? value : value.toFixed(1);

/** Explanations come from the saved assessment, never reconstructed from scores. */
export function PriorityCards({ priorities }: { priorities: TrainingPriority[] }) {
  if (!priorities.length) return null;
  return <ol className="personalized-priorities" aria-label="Training priorities">
    {priorities.map(priority => <li key={priority.id} className={`personalized-priority is-${priority.evidenceBasis}`}>
      <div className="personalized-priority-heading"><span className="personalized-priority-rank" aria-label={`Rank ${priority.rank}`}>{priority.rank}</span>
        <div><span className="personalized-meta">{roleLabel[priority.role]}</span><h4>{priority.label}</h4></div>
      </div>
      <div className="personalized-priority-tags"><span className="admin-chip">{evidenceBasisLabel(priority.evidenceBasis)}</span>
        {priority.confidence && <span className="personalized-meta">{priority.confidence} confidence</span>}
      </div>
      <p>{priority.reason}</p>
      {priority.limitation && <p className="personalized-priority-limit">{priority.limitation}</p>}
      {priority.weeklyTargetMinutes !== null && <p className="personalized-priority-time"><strong>{minutes(priority.weeklyTargetMinutes)} min / week</strong><span>{priority.domain && priorities.filter(row => row.domain === priority.domain).length > 1
        ? "Shared domain target — shown for each related priority, not added together"
        : "Target before fitting complete drill doses"}</span></p>}
      {priority.eligibleDrillCount === 0 && <p className="personalized-notice">No eligible drill is currently available for this priority. Review curriculum coverage before using the plan.</p>}
      {priority.progressCheck && <div className="personalized-progress-check"><strong>How to check progress</strong><p>{priority.progressCheck}</p></div>}
    </li>)}
  </ol>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function ExerciseReason({ block }: { block: any }) {
  const rationale = blockTrainingRationale(block);
  const legacyReason = typeof block?.whyIncluded === "string" ? block.whyIncluded : "";
  if (!rationale && !legacyReason) return null;
  return <div className="personalized-exercise-reason">
    {rationale && <span className="admin-chip">{evidenceBasisLabel(rationale.evidenceBasis)}</span>}
    <p><strong>Why this exercise:</strong> {rationale?.reason || legacyReason}</p>
    {rationale?.progressCheck && <p><strong>Progress check:</strong> {rationale.progressCheck}</p>}
  </div>;
}
