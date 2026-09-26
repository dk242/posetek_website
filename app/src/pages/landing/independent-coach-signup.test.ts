import { describe, expect, it, vi } from 'vitest';
import { finishIndependentCoachSignup, type IndependentCoachIntent } from './independent-coach-signup';

const intent: IndependentCoachIntent = { uid: 'coach-1', email: 'coach@example.test', firstName: 'Casey', lastName: 'Coach' };
function setup() {
  let uid = intent.uid;
  let pending: IndependentCoachIntent | null = null;
  let profile: IndependentCoachIntent | null = null;
  let writeFault: 'before' | 'after' | null = null;
  const verify = vi.fn(async () => {});
  const steps = {
    currentUid: () => uid,
    remember: (next: IndependentCoachIntent) => { pending = next; },
    writeProfile: vi.fn(async (next: IndependentCoachIntent) => {
      if (writeFault === 'before') { writeFault = null; throw new Error('pre-commit failure'); }
      if (!profile) profile = next;
      if (writeFault === 'after') { writeFault = null; throw new Error('response lost'); }
    }),
    clear: () => { pending = null; },
    verify,
  };
  return { steps, verify, get pending() { return pending; }, get profile() { return profile; }, fail: (fault: 'before' | 'after') => { writeFault = fault; }, switchUid: () => { uid = 'someone-else'; }, setProfile: (existing: IndependentCoachIntent) => { profile = existing; } };
}

describe('independent coach signup recovery', () => {
  it.each(['before', 'after'] as const)('keeps same-UID intent and finishes one profile after %s write failure', async fault => {
    const h = setup(); h.fail(fault);
    await expect(finishIndependentCoachSignup(intent, h.steps)).rejects.toThrow();
    expect(h.pending).toEqual(intent);
    expect(await finishIndependentCoachSignup(intent, h.steps)).toEqual({ verificationSent: true });
    expect(h.profile).toEqual(intent);
    expect(h.pending).toBeNull();
  });
  it('keeps a durable profile when verification email fails', async () => {
    const h = setup(); h.verify.mockRejectedValueOnce(new Error('email outage'));
    expect(await finishIndependentCoachSignup(intent, h.steps)).toEqual({ verificationSent: false });
    expect(h.profile).toEqual(intent);
    expect(h.pending).toBeNull();
  });
  it('refuses a different UID and preserves an existing populated profile', async () => {
    const h = setup(); const populated = { ...intent, firstName: 'Original' };
    h.setProfile(populated);
    expect(await finishIndependentCoachSignup(intent, h.steps)).toEqual({ verificationSent: true });
    expect(h.profile).toEqual(populated);
    h.switchUid();
    await expect(finishIndependentCoachSignup(intent, h.steps)).rejects.toThrow('original account');
    expect(h.steps.writeProfile).toHaveBeenCalledTimes(1);
  });
});
