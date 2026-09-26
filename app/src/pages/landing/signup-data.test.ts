import { describe, expect, it, vi, beforeEach } from 'vitest';
const state = vi.hoisted(() => ({ profile: null as Record<string, unknown> | null, writes: 0, fail: '' }));
vi.mock('../../lib/firebase', () => ({
  default: { firestore: { FieldValue: { serverTimestamp: () => 'server-time' } } },
  cloud: {},
  db: {
    collection: (name: string) => ({ doc: (uid: string) => ({ name, uid }) }),
    runTransaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      const result = await callback({
        get: async () => ({ exists: !!state.profile, data: () => state.profile }),
        set: (_ref: unknown, data: Record<string, unknown>) => {
          if (state.fail === 'before') { state.fail = ''; throw new Error('write rejected'); }
          state.profile = data; state.writes++;
        },
      });
      if (state.fail === 'after') { state.fail = ''; throw new Error('response lost after commit'); }
      return result;
    },
  },
}));
import { createCoachDocument } from './signup-data';

beforeEach(() => { state.profile = null; state.writes = 0; state.fail = ''; });

describe('independent coach profile transaction', () => {
  it.each(['before', 'after'])('retries the same UID after %s commit fault without duplicate write', async fault => {
    state.fail = fault;
    await expect(createCoachDocument('coach-1', 'coach@example.test', 'Casey', 'Coach')).rejects.toThrow();
    await createCoachDocument('coach-1', 'coach@example.test', 'Casey', 'Coach');
    expect(state.writes).toBe(1);
    expect(state.profile).toMatchObject({ userUID: 'coach-1', firstName: 'Casey' });
  });
  it('never overwrites a populated profile, including an existing organization', async () => {
    state.profile = { userUID: 'coach-1', firstName: 'Original', organizationCode: 'ORGEXISTING' };
    await createCoachDocument('coach-1', 'coach@example.test', 'Changed', 'Coach');
    expect(state.writes).toBe(0);
    expect(state.profile.firstName).toBe('Original');
    expect(state.profile.organizationCode).toBe('ORGEXISTING');
  });
  it('rejects a foreign profile at the UID path', async () => {
    state.profile = { userUID: 'someone-else' };
    await expect(createCoachDocument('coach-1', 'coach@example.test', 'Casey', 'Coach')).rejects.toThrow('another account');
    expect(state.writes).toBe(0);
  });
});
