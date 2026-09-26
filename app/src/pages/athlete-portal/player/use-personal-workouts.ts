import { useEffect, useRef, useState } from 'react';
import firebase, { auth, db } from '../../../lib/firebase';
import { normalizeCatalogDrill } from '../../../lib/contracts/drillV2';
import type { CatalogDrill } from '../../../lib/contracts/drillV2';
import type { Row } from './execution';
import type { PlayerWorkoutStore } from './use-player-workouts';
import { ensurePersonalSubmission, latestPersonalRevision, personalCapabilityEnabled, personalExecution, personalExecutionId, personalGenerationErrors, personalJobKey, personalLogRows, personalWorkoutsEnabled, restorePersonalJob } from './personal-workouts';
import type { PendingPersonalJob, PersonalCapability } from './personal-workouts';

const sampleCatalog = [
  { drillId: 'DRB-005', name: 'Cone maze', domain: 'dribbling', equipment: ['ball', 'cones'] },
  { drillId: 'PAS-001', name: 'Wall pass rhythm', domain: 'passing', equipment: ['ball', 'wall'] },
  { drillId: 'BMA-001', name: 'Close-control touches', domain: 'ballMastery', equipment: ['ball'] },
].map(d => normalizeCatalogDrill(d.drillId, { ...d, schemaVersion: 2, status: 'published', minAge: 5, maxAge: 80, difficultyLevel: 1, maxFrequencyPerWeek: 7, dose: { setsMin: 1, setsMax: 4, repsMin: 20, repsMax: 90, repUnit: 'seconds', restSecondsMin: 15, restSecondsMax: 60 }, howTo: { setup: 'Use an open, safe space.', steps: ['Keep each repetition controlled.'] } }));

export function usePersonalWorkouts(playerId: string, preview: boolean, config: Row | null) {
  const enabled = personalWorkoutsEnabled(config, preview);
  const [workouts, setWorkouts] = useState<Row[]>([]), [logs, setLogs] = useState<Record<string, Row>>({});
  const [catalog, setCatalog] = useState<CatalogDrill[]>(preview ? sampleCatalog : []);
  const [scheduleRevision, setScheduleRevision] = useState<number | null>(preview ? 0 : null);
  const [loaded, setLoaded] = useState(preview), [saving, setSaving] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [pending, setPending] = useState<PendingPersonalJob | null>(null), [proposal, setProposal] = useState<Row | null>(null);
  const [lastResult, setLastResult] = useState<{ capability: PersonalCapability; result: Row } | null>(null);
  const current = useRef({ workouts, logs, scheduleRevision }); current.current = { workouts, logs, scheduleRevision };
  const busy = useRef(false), generation = useRef(0), subscriptions = useRef<(() => void)[]>([]);
  const uid = auth.currentUser?.uid || '', key = personalJobKey(uid, playerId), proposalKey = `${key}:proposal`;
  const savePending = (p: PendingPersonalJob | null) => {
    if (p) localStorage.setItem(key, JSON.stringify(p)); else localStorage.removeItem(key);
    setPending(p);
  };
  const readPending = () => { try { return restorePersonalJob(JSON.parse(localStorage.getItem(key) || 'null'), uid, playerId); } catch { return null; } };
  const accept = (capability: PersonalCapability, result: Row) => {
    const effective = { ...result };
    if (result.workout?.schemaVersion === 1 && result.workoutId) {
      effective.workout = latestPersonalRevision(current.current.workouts.find(w => w.workoutId === result.workoutId), { ...result.workout, id: result.workoutId });
      current.current.workouts = [...current.current.workouts.filter(w => w.workoutId !== result.workoutId), effective.workout];
      setWorkouts(current.current.workouts);
    }
    if (result.log?.schemaVersion === 1) {
      const id = result.log.workoutId;
      effective.log = latestPersonalRevision(current.current.logs[id], result.log);
      current.current.logs = { ...current.current.logs, [id]: effective.log };
      setLogs(current.current.logs);
    }
    if (Number.isInteger(result.scheduleRevision)) { effective.scheduleRevision = Math.max(current.current.scheduleRevision || 0, result.scheduleRevision); current.current.scheduleRevision = effective.scheduleRevision; setScheduleRevision(effective.scheduleRevision); }
    if (capability === 'generate_personal_workout' && result.proposalId) {
      if (!preview) localStorage.setItem(proposalKey, JSON.stringify({ uid, playerId, result }));
      setProposal(result);
    }
    setLastResult({ capability, result: effective });
    return effective;
  };
  const runPending = async (record: PendingPersonalJob): Promise<Row> => {
    if (busy.current) throw new Error('Wait for the current workout action to finish.');
    if (!personalCapabilityEnabled(config, record.capability, preview) || !uid || auth.currentUser?.uid !== record.uid) throw new Error('This workout action is unavailable. Return to Training and sign in again.');
    busy.current = true; setSaving(true); setError(''); setStatus('Checking your request…');
    const token = generation.current;
    let terminal = false;
    try {
      // Persist the chosen ID before the create. A lost acknowledgement can
      // therefore be recovered without submitting a second accepted action.
      const ref = db.collection('llmJobs').doc(record.jobId);
      await ensurePersonalSubmission(record, { persist: savePending, exists: async () => {
        const found = await ref.get({ source: 'server' }), job = found.data();
        if (found.exists && (job?.requestedByUid !== uid || job?.playerId !== playerId || job?.capability !== record.capability || job?.params?.requestId !== record.params.requestId)) throw new Error('The saved request does not match this workout action.');
        return found.exists;
      },
        create: async () => { await ref.set({ schemaVersion: 1, capability: record.capability, playerId,
          params: record.params, requestedByUid: uid, clientVersion: 'web-personal-workouts-v1', status: 'pending', createdAt: firebase.firestore.FieldValue.serverTimestamp() }); } });
      if (generation.current !== token || auth.currentUser?.uid !== uid) throw new Error('The selected player changed.');
      const result = await new Promise<Row>((resolve, reject) => {
        const stop = ref.onSnapshot(snapshot => {
          const job = snapshot.data();
          if (!job) return;
          if (job.status === 'failed') { terminal = true; stop(); reject(new Error(job.error?.detail || job.error?.message || 'This workout could not be checked. Review your details and try again.')); }
          else if (job.status === 'complete') { terminal = true; stop(); resolve(job.result || {}); }
          else if (generation.current === token) setStatus(job.status === 'running' ? record.capability === 'generate_personal_workout' ? 'Building a workout to review…' : 'Checking and saving…' : 'Request received. Waiting for a check…');
        }, e => { stop(); reject(e); });
        subscriptions.current.push(() => { stop(); reject(new Error('The selected player changed.')); });
      });
      if (generation.current !== token || auth.currentUser?.uid !== uid) throw new Error('The selected player changed.');
      const effective = accept(record.capability, result);
      savePending(null); setStatus(''); return effective;
    } catch (e: any) {
      if (generation.current === token) {
        if (terminal || e.definitiveRejection) { try { savePending({ ...record, terminalFailed: true }); } catch { /* preserve the existing recovery receipt */ } }
        setError(e.message || 'Connection interrupted. Retry the saved request to recover its result.');
      }
      throw e;
    } finally { if (generation.current === token) { busy.current = false; setSaving(false); } }
  };
  useEffect(() => {
    const token = ++generation.current;
    busy.current = false; setSaving(false); setStatus('');
    if (!enabled) { current.current = { workouts: [], logs: {}, scheduleRevision: null }; setWorkouts([]); setLogs({}); setScheduleRevision(null); setLoaded(false); setProposal(null); setPending(null); setLastResult(null); return; }
    if (preview) { setCatalog(sampleCatalog); setLoaded(true); setScheduleRevision(0); return; }
    current.current = { workouts: [], logs: {}, scheduleRevision: null };
    setWorkouts([]); setLogs({}); setLoaded(false); setScheduleRevision(null); setProposal(null); setPending(null); setLastResult(null); setError('');
    const player = db.collection('players').doc(playerId);
    const stops = [
      player.collection('personalWorkouts').onSnapshot(s => { current.current.workouts = s.docs.map(d => latestPersonalRevision(current.current.workouts.find(w => w.workoutId === d.id), { ...d.data(), id: d.id })); setWorkouts(current.current.workouts); setLoaded(true); }, e => setError(e.message)),
      player.collection('personalWorkoutLogs').onSnapshot(s => { current.current.logs = Object.fromEntries(s.docs.map(d => [d.id, latestPersonalRevision(current.current.logs[d.id], { ...d.data(), id: d.id })])); setLogs(current.current.logs); }, e => setError(e.message)),
      player.collection('workoutSchedule').doc('current').onSnapshot(d => { current.current.scheduleRevision = Math.max(current.current.scheduleRevision || 0, Number(d.data()?.revision || 0)); setScheduleRevision(current.current.scheduleRevision); }, e => setError(e.message)),
      db.collection('drillCatalog').where('status', '==', 'published').onSnapshot(s => setCatalog(s.docs.map(d => normalizeCatalogDrill(d.id, d.data()))), e => setError(e.message)),
    ];
    try {
      const saved = JSON.parse(localStorage.getItem(proposalKey) || 'null');
      if (saved?.uid === uid && saved?.playerId === playerId && saved.result?.proposalId) setProposal(saved.result);
    } catch { /* A corrupt unsaved proposal is never treated as an executable workout. */ }
    const recovery = readPending();
    if (recovery) { setPending(recovery); if (!recovery.terminalFailed) void runPending(recovery).catch(() => {}); }
    return () => { if (generation.current === token) generation.current++; stops.forEach(s => s()); subscriptions.current.splice(0).forEach(s => s()); busy.current = false; };
  }, [playerId, preview, enabled, uid]);
  const perform = async (capability: PersonalCapability, params: Row): Promise<Row> => {
    if (!personalCapabilityEnabled(config, capability, preview)) throw new Error('This workout action is not enabled yet.');
    if (preview) throw new Error('Sample workout actions must use the in-memory preview.');
    const signature = JSON.stringify({ capability, params });
    const old = readPending();
    if (old && !old.terminalFailed && old.signature !== signature) throw new Error('Recover the previous request before making another change.');
    const record: PendingPersonalJob = old?.signature === signature && !old.terminalFailed ? old : {
      schemaVersion: 1, uid, playerId, capability, signature,
      jobId: db.collection('llmJobs').doc().id,
      params: { ...params, requestId: old?.signature === signature ? old.params.requestId : crypto.randomUUID() },
    };
    return runPending(record);
  };
  const clearProposal = () => { setProposal(null); if (!preview) try { localStorage.removeItem(proposalKey); } catch { /* Server checks remain authoritative. */ } };
  const save = async (params: Row) => {
    if (preview) {
      const workoutId = params.workoutId || `sample-${crypto.randomUUID()}`, revision = Number(params.expectedRevision || 0) + 1;
      const workout = { ...params.workout, schemaVersion: 1, source: 'personal', playerId, workoutId, revision, status: 'ready', scheduledDate: params.scheduledDate, timezone: params.timezone, intake: params.intake, sourceWorkout: params.sourceWorkout || null };
      const result = accept('save_personal_workout', { workoutId, revision, workout, scheduleRevision: (current.current.scheduleRevision || 0) + 1 }); clearProposal(); return result;
    }
    const result = await perform('save_personal_workout', params); clearProposal(); return result;
  };
  const start = async (workout: Row, confirmation: Row) => {
    const token = generation.current;
    if (!personalCapabilityEnabled(config, 'start_personal_workout', preview)) throw new Error('Starting personal workouts is not enabled.');
    if (confirmation.equipmentConfirmed !== true || confirmation.painFlag !== false) throw new Error('Confirm today’s equipment and pain-free training before continuing.');
    let result: Row;
    if (preview) {
      const old = current.current.logs[workout.workoutId];
      if (old?.endedAt) throw new Error('This workout is finished. Customize a new copy to train again.');
      result = { log: old || { schemaVersion: 1, source: 'personal', workoutId: workout.workoutId, workoutRevision: workout.revision, workoutSnapshot: workout, revision: 1, startedAt: new Date(), endedAt: null, elapsedSeconds: 0, activeSeconds: 0, blocks: [] } };
      result = accept('start_personal_workout', result);
    } else {
      // Resuming an immutable personal log is not a second start/reservation.
      // Refresh its confirmed revision and elapsed baseline before opening it.
      const saved = await db.collection('players').doc(playerId).collection('personalWorkoutLogs').doc(workout.workoutId).get({ source: 'server' });
      if (generation.current !== token || auth.currentUser?.uid !== uid) throw new Error('The selected player changed. Return to Training.');
      if (saved.exists) {
        const log = saved.data()!;
        if (log.endedAt) throw new Error('This workout is finished. Customize a new copy to train again.');
        result = accept('start_personal_workout', { log });
      } else result = await perform('start_personal_workout', { workoutId: workout.workoutId, expectedRevision: workout.revision, expectedScheduleRevision: current.current.scheduleRevision, equipmentConfirmed: confirmation.equipmentConfirmed, painFlag: confirmation.painFlag });
    }
    return personalExecution(workout, result.log);
  };
  const updateLog = async (id: string, blocks: Row[], elapsedSeconds: number | undefined, endReason?: string) => {
    const workoutId = id.startsWith('personal_') ? id.slice('personal_'.length) : id;
    const old = current.current.logs[workoutId];
    if (!old || old.endedAt) throw new Error('This workout is not active.');
    const seconds = Math.max(Number(old.elapsedSeconds || 0), Math.floor(elapsedSeconds ?? Number(old.elapsedSeconds || 0)));
    const reason = endReason ? blocks.some(b => b.skipReason === 'pain') ? 'pain' : endReason === 'completed' ? 'completed' : 'stopped' : undefined;
    if (preview) { accept('update_personal_workout_log', { log: { ...old, blocks, revision: old.revision + 1, elapsedSeconds: seconds, activeSeconds: seconds, ...(reason ? { endReason: reason, endedAt: new Date() } : {}) } }); return; }
    await perform('update_personal_workout_log', { workoutId, expectedLogRevision: old.revision, blocks: personalLogRows(blocks), elapsedSeconds: seconds, ...(reason ? { endReason: reason } : {}) });
  };
  const adapter: PlayerWorkoutStore = {
    workouts, logs: Object.fromEntries(Object.entries(logs).map(([id, log]) => [personalExecutionId(id), log])), logsLoaded: loaded, saving, error: error || null,
    logFor: id => current.current.logs[id.startsWith('personal_') ? id.slice('personal_'.length) : id] || null,
    start: w => start(w, { equipmentConfirmed: false, painFlag: true }),
    saveBlock: async (id, blockId, row, elapsedSeconds) => { try { const old = adapter.logFor(id); await updateLog(id, [...(old?.blocks || []).filter((b: Row) => b.blockId !== blockId), ...(row ? [row] : [])], elapsedSeconds); } catch (e: any) { setError(e.message); throw e; } },
    finish: async (id, reason, seconds) => { try { await updateLog(id, adapter.logFor(id)?.blocks || [], seconds, reason); } catch (e: any) { setError(e.message); throw e; } },
    beginWorkout: () => {}, updateBlock: () => {}, removeBlock: () => {}, endWorkout: () => {}, noteWorkout: () => {},
  };
  return { enabled, workouts, logs, catalog, scheduleRevision, loaded, saving, error, status, pending, proposal, lastResult, clearProposal, save, start, adapter,
    consumeResult: () => setLastResult(null),
    generate: (params: Row) => { const errors = personalGenerationErrors(params.intake, params.timeAvailableMinutes, params.requestText); return errors.length ? Promise.reject(new Error(errors.join(' '))) : perform('generate_personal_workout', params); },
    recover: () => pending ? runPending(pending).catch(() => {}) : Promise.resolve(),
    setError,
  };
}
export type PersonalWorkoutStore = ReturnType<typeof usePersonalWorkouts>;
