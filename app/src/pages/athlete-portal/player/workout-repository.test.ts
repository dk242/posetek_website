import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ docs: new Map<string, any>(), writes: [] as any[], rejectCommit: false, submit: vi.fn(), wait: vi.fn() }));
vi.mock('../lib/loaders', () => ({ submitLlmJob: fake.submit, waitForJob: fake.wait }));
vi.mock('../../../lib/firebase', () => {
  const ref = (path: string): any => ({ path, id: path.split('/').at(-1), collection: (key: string) => ref(`${path}/${key}`), doc: (key: string) => ref(`${path}/${key}`), get: async () => ({ id: path.split('/').at(-1), exists: fake.docs.has(path), data: () => fake.docs.get(path) }) });
  return {
    default: { firestore: { Timestamp: { now: () => 12345 }, FieldValue: { serverTimestamp: () => 'server-time' } } },
    db: {
      collection: (key: string) => ref(key),
      runTransaction: async (action: any) => {
        const staged: any[] = [];
        const result = await action({
          get: async (r: any) => {
            if (staged.length) throw new Error('Reads must precede writes');
            return { id: r.id, exists: fake.docs.has(r.path), data: () => fake.docs.get(r.path) };
          },
          set: (r: any, data: any) => staged.push({ path: r.path, data, kind: 'set' }),
          update: (r: any, data: any) => staged.push({ path: r.path, data, kind: 'update' }),
        });
        if (fake.rejectCommit) throw new Error('permission-denied');
        fake.writes.push(...staged);
        return result;
      },
    },
  };
});
import { startPlayerWorkout, mutatePlayerWorkout } from './workout-repository';
import { executable, initialLog, patchBlock } from './execution';

const block = { blockId: 'b', drillId: 'DRB-001', sets: 3 };
const workout = { workoutId: 'w', revision: 1, blocks: [block] };
const plan = { id: 'plan', schemaVersion: 3, status: 'active', weeks: [{ weekNumber: 1, workouts: [workout] }] };
const reviewed = executable(plan, workout, 1);
beforeEach(() => {
  fake.docs.clear(); fake.writes.length = 0; fake.rejectCommit = false;
  fake.submit.mockReset(); fake.wait.mockReset(); fake.submit.mockResolvedValue({ id: 'start-job' });
  fake.wait.mockResolvedValue({ result: { ready: true, planRevision: 1, workoutRevision: 1, scheduleRevision: 7 } });
  fake.docs.set('players/player-doc/trainingPlans/plan', plan);
  fake.docs.set('players/player-doc/workoutSchedule/current', { revision: 7 });
});

describe('acknowledged player workout transactions', () => {
  it('requires today’s confirmation for restricted workouts before any log writes', async () => {
    await expect(startPlayerWorkout('player-doc', { ...reviewed, requiresTrainingStartAuthorization: true })).rejects.toThrow('Confirm today');
    expect(fake.submit).not.toHaveBeenCalled(); expect(fake.writes).toEqual([]);
  });
  it('checks current clearance before starting and refuses schedule drift after validation', async () => {
    const restricted = { ...reviewed, requiresTrainingStartAuthorization: true, startConfirmation: { equipmentConfirmed: true, supervision: 'qualifiedCoach', painFlag: false } };
    fake.docs.set('players/player-doc/trainingPlans/plan', { ...plan, requiresTrainingStartAuthorization: true });
    await startPlayerWorkout('player-doc', restricted);
    expect(fake.submit).toHaveBeenCalledWith('player-doc', 'validate_workout_start', expect.objectContaining({ expectedScheduleRevision: 7, equipmentConfirmed: true, supervision: 'qualifiedCoach', painFlag: false }));
    fake.writes.length = 0; fake.wait.mockResolvedValue({ result: { ready: true, planRevision: 1, workoutRevision: 1, scheduleRevision: 6 } });
    await expect(startPlayerWorkout('player-doc', restricted)).rejects.toThrow('clearance or schedule changed'); expect(fake.writes).toEqual([]);
  });
  it('creates a snapshot and increments the shared schedule together under the player document ID', async () => {
    const log = await startPlayerWorkout('player-doc', reviewed);
    expect(log.timerStartedHere).toBe(true);
    expect(fake.writes[0].data).not.toHaveProperty('timerStartedHere');
    expect(log.workoutSnapshot.blocks).toEqual([block]);
    expect(fake.writes.map(w => w.path)).toEqual(['players/player-doc/workoutLogs/plan_w', 'players/player-doc/workoutSchedule/current']);
    expect(fake.writes[1].data.revision).toBe(8);
  });
  it('resumes pinned work without rewriting it even after the active plan changed', async () => {
    const saved = initialLog(reviewed, 100);
    fake.docs.set('players/player-doc/workoutLogs/plan_w', saved);
    fake.docs.delete('players/player-doc/trainingPlans/plan');
    expect(await startPlayerWorkout('player-doc', reviewed)).toEqual({ ...saved, timerStartedHere: false });
    expect(fake.writes).toEqual([]);
  });
  it('rejects revision drift without creating a log or advancing the schedule', async () => {
    fake.docs.set('players/player-doc/trainingPlans/plan', { ...plan, weeks: [{ weekNumber: 1, workouts: [{ ...workout, revision: 2 }] }] });
    await expect(startPlayerWorkout('player-doc', reviewed)).rejects.toThrow('changed');
    expect(fake.writes).toEqual([]);
  });
  it('splices against the freshest server log and increments the shared schedule', async () => {
    const saved = { ...initialLog(reviewed, 100), blocks: [{ blockId: 'other', setsCompleted: 2 }] };
    fake.docs.set('players/player-doc/workoutLogs/plan_w', saved);
    const updated = await mutatePlayerWorkout('player-doc', 'plan_w', old => ({ blocks: patchBlock(old, 'b', { blockId: 'b', setsCompleted: 1 }) }));
    expect(updated.blocks).toHaveLength(2);
    expect(updated.blocks[0]).toEqual(saved.blocks[0]);
    expect(fake.writes[1].data.revision).toBe(8);
  });
  it('rejects ended sessions and propagates failed commits without publishing progress', async () => {
    fake.docs.set('players/player-doc/workoutLogs/plan_w', { ...initialLog(reviewed, 100), endedAt: 200 });
    await expect(mutatePlayerWorkout('player-doc', 'plan_w', () => ({ blocks: [] }))).rejects.toThrow('no longer active');
    fake.docs.delete('players/player-doc/workoutLogs/plan_w'); fake.rejectCommit = true;
    await expect(startPlayerWorkout('player-doc', reviewed)).rejects.toThrow('permission-denied');
    expect(fake.writes).toEqual([]);
  });
});
