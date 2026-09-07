// Live view of the active plan's `plannedWorkouts` plus the athlete's own
// `workoutLogs`, and the write path for the latter — the web counterpart of the
// app's `WorkoutStore`. Logs are the one client-owned doc in the trio; planned
// workouts and plans are gateway-written and read-only here.
//
// Listeners are scoped to the *plan*, not the current week, so the hub's week
// selector can show progress for any week of the block. Volume is bounded: one
// plan's workouts and logs.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import firebase, { db } from "../../../lib/firebase";
import type { BlockLogRow } from "./training";

export interface WorkoutStore {
  workouts: any[];
  logs: Record<string, any>;
  // True once the logs listener has delivered its first snapshot (the cache
  // counts). `beginWorkout` refuses to write before this: "no log exists" is
  // only meaningful once we have actually looked.
  logsLoaded: boolean;
  error: string | null;
  logFor: (workoutId: string) => any | null;
  beginWorkout: (workout: any, linkedTrainingSessionId?: string | null) => void;
  updateBlock: (workoutId: string, row: BlockLogRow) => void;
  removeBlock: (workoutId: string, blockId: string) => void;
  endWorkout: (workoutId: string, reason: string) => void;
  // Adds a workout the listener has not delivered yet (a freshly built one) so
  // the popup can open on it immediately.
  noteWorkout: (workout: any) => void;
}

const logsPath = (playerId: string) =>
  db.collection("players").doc(playerId).collection("workoutLogs");

export function useWorkoutStore(
  playerId: string | null,
  planId: string | null,
  // Preview/demo mode keeps the whole store in memory — no reads, no writes.
  // `seedWorkouts` must be referentially stable (memoize it); the workout list
  // is derived from it rather than copied into state.
  options: { live?: boolean; seedWorkouts?: any[] } = {},
): WorkoutStore {
  const live = options.live !== false;
  const seedWorkouts = options.seedWorkouts;

  const [liveWorkouts, setLiveWorkouts] = useState<any[]>([]);
  // Workouts handed to the store before the listener delivers them (a session
  // just built, or the preview's demo one).
  const [notedWorkouts, setNotedWorkouts] = useState<any[]>([]);
  const [logs, setLogs] = useState<Record<string, any>>({});
  // Which plan the logs listener has delivered a first snapshot for. Tracking
  // the id rather than a boolean means switching plans re-arms the create-only
  // guard by derivation, with no synchronous reset inside the effect.
  const [loadedPlanId, setLoadedPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const logsLoaded = !live || (planId !== null && loadedPlanId === planId);

  // The listener's set is authoritative; anything noted locally that it has not
  // caught up with yet rides alongside it.
  const workouts = useMemo(() => {
    const base = live ? liveWorkouts : (seedWorkouts || []);
    const extra = notedWorkouts.filter(noted => !base.some(item => item.id === noted.id));
    return extra.length ? [...base, ...extra] : base;
  }, [live, liveWorkouts, seedWorkouts, notedWorkouts]);

  // Latest-value refs, deliberately assigned during render rather than in an
  // effect: `beginWorkout` runs from the player's own effect, and child effects
  // run before the parent's, so an effect-assigned ref would still hold the
  // previous render's logs at exactly the moment the create-only guard reads it.
  const logsRef = useRef(logs);
  logsRef.current = logs;
  const logsLoadedRef = useRef(logsLoaded);
  logsLoadedRef.current = logsLoaded;

  useEffect(() => {
    if (!live || !playerId || !planId) return;
    const player = db.collection("players").doc(playerId);

    const stopWorkouts = player.collection("plannedWorkouts")
      .where("planId", "==", planId)
      .onSnapshot(snapshot => {
        setLiveWorkouts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, listenerError => {
        console.error("[workouts]", listenerError);
        setError(listenerError.message || "The planned workouts could not be loaded.");
      });

    const stopLogs = player.collection("workoutLogs")
      .where("planId", "==", planId)
      .onSnapshot(snapshot => {
        const next: Record<string, any> = {};
        for (const doc of snapshot.docs) {
          // `estimate` matters: a just-begun log's `startedAt` is a pending
          // serverTimestamp, and the default behavior returns null for it —
          // the first set-ticks (which guard on the log existing) would be
          // silently discarded until the server ack.
          next[doc.id] = { id: doc.id, ...doc.data({ serverTimestamps: "estimate" }) };
        }
        setLogs(next);
        setLoadedPlanId(planId);
      }, listenerError => {
        console.error("[workoutLogs]", listenerError);
        setError(listenerError.message || "Your workout history could not be loaded.");
      });

    return () => { stopWorkouts(); stopLogs(); };
  }, [live, playerId, planId]);

  const logFor = useCallback((workoutId: string) => logsRef.current[workoutId] || null, []);

  const noteWorkout = useCallback((workout: any) => {
    setNotedWorkouts(current =>
      current.some(item => item.id === workout.id) ? current : [...current, workout]);
  }, []);

  // Create-only, offline-safe. A transaction would guarantee create-only but
  // requires server contact — offline, the whole workout would silently record
  // nothing. Instead the write is a plain `set` (queued offline like every
  // other write) guarded by `logsLoaded`, with an optimistic local log seeded
  // so the first set-ticks are never dropped.
  const beginWorkout = useCallback((workout: any, linkedTrainingSessionId?: string | null) => {
    if (!workout?.id) return;
    if (live && (!playerId || !logsLoadedRef.current)) return;
    if (logsRef.current[workout.id]) return;

    const optimistic: any = {
      id: workout.id,
      schemaVersion: 1,
      planId: workout.planId,
      weekNumber: workout.weekNumber || 1,
      startedAt: new Date(),
      blocks: [],
    };
    if (linkedTrainingSessionId) optimistic.linkedTrainingSessionId = linkedTrainingSessionId;
    setLogs(current => (current[workout.id] ? current : { ...current, [workout.id]: optimistic }));

    if (!live || !playerId) return;
    const payload: any = {
      schemaVersion: 1,
      planId: workout.planId,
      weekNumber: workout.weekNumber || 1,
      startedAt: firebase.firestore.FieldValue.serverTimestamp(),
      blocks: [],
    };
    if (linkedTrainingSessionId) payload.linkedTrainingSessionId = linkedTrainingSessionId;
    logsPath(playerId).doc(workout.id).set(payload).catch(writeError => {
      setError(writeError.message || "The workout could not be started.");
    });
  }, [live, playerId]);

  // Records one block's outcome, rewriting the whole `blocks` array — Firestore
  // has no atomic single-element array update and the schema requires `blocks`
  // to stay a list.
  const writeBlocks = useCallback((workoutId: string, blocks: any[]) => {
    setLogs(current => {
      const existing = current[workoutId];
      if (!existing) return current;
      return { ...current, [workoutId]: { ...existing, blocks } };
    });
    if (!live || !playerId) return;
    logsPath(playerId).doc(workoutId).update({ blocks }).catch(writeError => {
      setError(writeError.message || "Your progress could not be saved.");
    });
  }, [live, playerId]);

  const updateBlock = useCallback((workoutId: string, row: BlockLogRow) => {
    const existing = logsRef.current[workoutId];
    if (!existing) return;
    const blocks = [...(existing.blocks || [])];
    const index = blocks.findIndex((block: any) => block?.blockId === row.blockId);
    if (index >= 0) blocks[index] = row;
    else blocks.push(row);
    writeBlocks(workoutId, blocks);
  }, [writeBlocks]);

  // Removes a block's row entirely — "backed out to untouched". A 0-set
  // `partial` row would still count as a full weekly exposure and drill
  // completion, so a mistaken tick that gets untapped must leave no row behind,
  // not a hollow one.
  const removeBlock = useCallback((workoutId: string, blockId: string) => {
    const existing = logsRef.current[workoutId];
    if (!existing) return;
    const blocks = (existing.blocks || []).filter((block: any) => block?.blockId !== blockId);
    if (blocks.length === (existing.blocks || []).length) return;
    writeBlocks(workoutId, blocks);
  }, [writeBlocks]);

  // Ends the workout — "completed" | "endedEarly" | "abandoned". Partial credit
  // is first-class: whatever blocks were logged stand as-is.
  const endWorkout = useCallback((workoutId: string, reason: string) => {
    setLogs(current => {
      const existing = current[workoutId];
      if (!existing) return current;
      return { ...current, [workoutId]: { ...existing, endedAt: new Date(), endReason: reason } };
    });
    if (!live || !playerId) return;
    logsPath(playerId).doc(workoutId).update({
      endedAt: firebase.firestore.FieldValue.serverTimestamp(),
      endReason: reason,
    }).catch(writeError => {
      setError(writeError.message || "The workout could not be closed out.");
    });
  }, [live, playerId]);

  return useMemo(() => ({
    workouts, logs, logsLoaded, error,
    logFor, beginWorkout, updateBlock, removeBlock, endWorkout, noteWorkout,
  }), [workouts, logs, logsLoaded, error, logFor, beginWorkout, updateBlock, removeBlock, endWorkout, noteWorkout]);
}

// MARK: - Drill catalog

const catalogCache = new Map<string, any>();

// The catalog row behind a workout block, for the player's "How to do it" card.
// Cached across mounts; a miss is not an error (the block already carries its
// own dose and cues).
export async function loadCatalogDrill(drillId: string): Promise<any | null> {
  if (!drillId) return null;
  if (catalogCache.has(drillId)) return catalogCache.get(drillId);
  try {
    const doc = await db.collection("drillCatalog").doc(drillId).get();
    const drill = doc.exists ? { id: doc.id, ...doc.data() } : null;
    catalogCache.set(drillId, drill);
    return drill;
  } catch (error) {
    console.warn("[drillCatalog]", error);
    return null;
  }
}
