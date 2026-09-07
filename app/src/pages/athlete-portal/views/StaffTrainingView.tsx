/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { db } from "../../../lib/firebase";
import { isV3Plan } from "../../../lib/contracts/types";
import TrainingViewV3 from "./TrainingViewV3";
import { EmptyState, PortalLoading } from "./shared";

// Organization oversight reads plans and athlete evidence. Only the athlete's
// own training flow can start/complete workouts; admin editing has its own page.
export default function StaffTrainingView({ playerId }: { playerId: string }) {
  const [data, setData] = useState<{ plans: any[]; logs: any[] } | null>(null);
  const [planId, setPlanId] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const player = db.collection("players").doc(playerId);
    Promise.all([player.collection("trainingPlans").get(), player.collection("workoutLogs").get()]).then(([plans, logs]) => {
      if (!active) return;
      const rows: any[] = plans.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      rows.sort((a, b) => Number(b.status === "active") - Number(a.status === "active"));
      setData({ plans: rows, logs: logs.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
      setPlanId(rows[0]?.id || "");
    }).catch(failure => { if (active) setError(failure.message || "Training plans could not be loaded."); });
    return () => { active = false; };
  }, [playerId]);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <PortalLoading message="Loading athlete training plans…" />;
  if (!data.plans.length) return <EmptyState icon="assignment" title="No training plan yet" message="This athlete has no recorded training plans." />;
  const plan = data.plans.find(entry => entry.id === planId) || data.plans[0];
  return <section className="mobile-page"><label>Training plan<select value={plan.id} onChange={event => setPlanId(event.target.value)}>{data.plans.map(entry => <option key={entry.id} value={entry.id}>{entry.title || entry.name || "Training plan"} · {entry.status || "Recorded"}</option>)}</select></label>
    {isV3Plan(plan) ? <TrainingViewV3 key={plan.id} plan={plan} logs={data.logs} /> : <section className="portal-card"><h2>{plan.title || plan.name || "Training plan"}</h2>{(Array.isArray(plan.weeks) ? plan.weeks : []).map((week: any, index: number) => <section key={index}><h3>Week {week.weekNumber || index + 1}</h3><p>{week.goal || week.focus || ""}</p>{(Array.isArray(week.drills) ? week.drills : []).map((drill: any, drillIndex: number) => <p key={drillIndex}><strong>{drill.name || drill.drillName || drill.drillId || "Drill"}</strong> {drill.sets ? `${drill.sets} sets` : ""} {drill.reps ? `· ${drill.reps} reps` : ""}</p>)}</section>)}</section>}
  </section>;
}
