import firebase, { db } from '../../../lib/firebase';
import { freshWorkout, initialLog, resumeWorkout } from './execution';
import type { Row } from './execution';

// Shared schedule counter serializes execution with gateway Apply. Every read
// precedes writes, and callers publish only the transaction's confirmed result.
export async function startPlayerWorkout(playerId: string, reviewed: Row, onCreated?: (created: boolean) => void): Promise<Row> {
  const player = db.collection('players').doc(playerId);
  const logRef = player.collection('workoutLogs').doc(reviewed.id);
  const scheduleRef = player.collection('workoutSchedule').doc('current');
  let created = false;
  const result = await db.runTransaction(async tx => {
    created = false; // A retried transaction may find another device's committed log.
    const old = await tx.get(logRef);
    if (old.exists) { resumeWorkout(reviewed, { ...old.data(), id: old.id }); return old.data()!; }
    const plan = await tx.get(player.collection('trainingPlans').doc(reviewed.planId));
    const schedule = await tx.get(scheduleRef);
    const adhoc = reviewed.source === 'adhoc' ? await tx.get(player.collection('plannedWorkouts').doc(reviewed.workoutId)) : null;
    const revision = schedule.data()?.revision;
    if (!Number.isInteger(revision)) throw new Error('Training is not ready to start. Refresh and try again.');
    const ready = freshWorkout({ ...plan.data(), id: plan.id }, reviewed, adhoc ? { ...adhoc.data(), id: adhoc.id } : undefined);
    const value = initialLog(ready, firebase.firestore.Timestamp.now());
    tx.set(logRef, value);
    tx.update(scheduleRef, { revision: revision + 1, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    created = true;
    return value;
  });
  onCreated?.(created);
  return result;
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
