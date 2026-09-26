import firebase, { db } from '../../../lib/firebase';
import { freshWorkout, initialLog, resumeWorkout } from './execution';
import type { Row } from './execution';
import { submitLlmJob, waitForJob } from '../lib/loaders';

export function needsTrainingStartCheck(workout: Row) {
  return workout.requiresTrainingStartAuthorization === true || (workout.blocks || []).some((block: Row) => block.trainingPolicyVersion === 'whole-body-v1');
}

// Shared schedule counter serializes execution with gateway Apply. Every read
// precedes writes, and callers publish only the transaction's confirmed result.
export async function startPlayerWorkout(playerId: string, reviewed: Row): Promise<Row> {
  const player = db.collection('players').doc(playerId);
  const logRef = player.collection('workoutLogs').doc(reviewed.id);
  const scheduleRef = player.collection('workoutSchedule').doc('current');
  let approval: Row | null = null;
  if (needsTrainingStartCheck(reviewed)) {
    const confirmation = reviewed.startConfirmation;
    if (confirmation?.equipmentConfirmed !== true || !['qualifiedCoach', 'unavailable'].includes(confirmation?.supervision) || confirmation?.painFlag !== false) throw new Error('Confirm today’s equipment, supervision and pain status before starting.');
    if (reviewed.source !== 'plan') throw new Error('This gym workout needs a current plan review before starting.');
    const [plan, schedule] = await Promise.all([player.collection('trainingPlans').doc(reviewed.planId).get({ source: 'server' }), scheduleRef.get({ source: 'server' })]);
    const stops: (() => void)[] = [];
    try {
      const ref = await submitLlmJob(playerId, 'validate_workout_start', { planId: reviewed.planId, workoutId: reviewed.workoutId,
        expectedPlanRevision: plan.data()?.planRevision || 1, expectedWorkoutRevision: reviewed.workoutRevision,
        expectedScheduleRevision: schedule.data()?.revision, equipmentConfirmed: confirmation.equipmentConfirmed,
        supervision: confirmation.supervision, painFlag: confirmation.painFlag });
      const result = await waitForJob(ref.id, () => {}, stop => stops.push(stop));
      approval = result.result;
      if (approval?.ready !== true) throw new Error('Training clearance could not be verified. Ask your coach to review this session.');
    } finally { stops.forEach(stop => stop()); }
  }
  return db.runTransaction(async tx => {
    const old = await tx.get(logRef);
    if (old.exists && !needsTrainingStartCheck(old.data()?.workoutSnapshot || reviewed)) { resumeWorkout(reviewed, { ...old.data(), id: old.id }); return { ...old.data(), timerStartedHere: false }; }
    const plan = await tx.get(player.collection('trainingPlans').doc(reviewed.planId));
    const schedule = await tx.get(scheduleRef);
    const adhoc = reviewed.source === 'adhoc' ? await tx.get(player.collection('plannedWorkouts').doc(reviewed.workoutId)) : null;
    const revision = schedule.data()?.revision;
    if (!Number.isInteger(revision)) throw new Error('Training is not ready to start. Refresh and try again.');
    const ready = freshWorkout({ ...plan.data(), id: plan.id }, reviewed, adhoc ? { ...adhoc.data(), id: adhoc.id } : undefined);
    if (needsTrainingStartCheck(ready) && (!approval || approval.planRevision !== (plan.data()?.planRevision || 1) || approval.workoutRevision !== ready.workoutRevision || approval.scheduleRevision !== revision)) throw new Error('Training clearance or schedule changed. Review the session and try starting again.');
    if (old.exists) { resumeWorkout(ready, { ...old.data(), id: old.id }); return { ...old.data(), timerStartedHere: false }; }
    const value = initialLog(ready, firebase.firestore.Timestamp.now());
    tx.set(logRef, value);
    tx.update(scheduleRef, { revision: revision + 1, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    return { ...value, timerStartedHere: true };
  });
}

export async function mutatePlayerWorkout(playerId: string, id: string, patch: (old: Row) => Row): Promise<Row> {
  const player = db.collection('players').doc(playerId);
  const ref = player.collection('workoutLogs').doc(id), scheduleRef = player.collection('workoutSchedule').doc('current');
  return db.runTransaction(async tx => {
    const doc = await tx.get(ref), schedule = await tx.get(scheduleRef);
    const old = doc.data(), revision = schedule.data()?.revision;
    if (!old || old.schemaVersion !== 2 || old.endedAt || !Number.isInteger(revision)) throw new Error('This workout is no longer active. Refresh training.');
    const changes = patch(old);
    tx.update(ref, changes);
    tx.update(scheduleRef, { revision: revision + 1, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    return { ...old, ...changes };
  });
}
