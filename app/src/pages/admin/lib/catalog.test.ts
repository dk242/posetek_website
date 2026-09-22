import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateDrill, type DrillWrite } from './catalog';

const harness = vi.hoisted(() => ({ save: vi.fn(), transaction: vi.fn(), currentVersion: '1.0.8' }));
vi.mock('../../../lib/firebase', () => ({
  default: {}, auth: { currentUser: { uid: 'admin-test' } }, storage: {},
  cloud: { httpsCallable: (name: string) => { if (name !== 'trainingSaveDrill') throw new Error(name); return harness.save; } },
  db: { collection: () => ({ doc: () => ({ get: async () => ({ data: () => ({ productionBatchId: 'whole-body-2026-09', catalogVersion: harness.currentVersion }) }) }) }), runTransaction: harness.transaction },
}));

const write: DrillWrite = { name: 'Goblet squat', domain: 'strength', minAge: 10, maxAge: 18,
  difficultyLevel: 2, equipment: ['dumbbells'], requiresPartner: false, positionSpecific: null,
  howTo: { setup: 'Prepare the reviewed load.', steps: ['Use the reviewed range.'] }, dose: { sets: 2, reps: 6 },
  maxFrequencyPerWeek: 2, coachComments: [], adaptiveLevers: [], status: 'draft' };

beforeEach(() => { harness.save.mockReset(); harness.transaction.mockReset(); harness.save.mockResolvedValue({ data: { catalogVersion: '1.0.9' } }); });

describe('managed drill content concurrency', () => {
  it('sends the version the editor loaded, even when a newer document is fetched for routing', async () => {
    await expect(updateDrill('STR-501', write, '1.0.3')).resolves.toBe('1.0.9');
    expect(harness.save).toHaveBeenCalledWith({ drillId: 'STR-501', write, expectedCatalogVersion: '1.0.3' });
    expect(harness.transaction).not.toHaveBeenCalled();
  });
  it('requires a loaded version instead of silently treating current data as the edited version', async () => {
    await expect(updateDrill('STR-501', write)).rejects.toThrow('Reload this drill');
    expect(harness.save).not.toHaveBeenCalled();
    expect(harness.transaction).not.toHaveBeenCalled();
  });
  it('surfaces server stale-edit refusals without falling back to a direct catalog write', async () => {
    harness.save.mockRejectedValue(new Error('This drill changed. Reload before saving.'));
    await expect(updateDrill('STR-501', write, '1.0.3')).rejects.toThrow('This drill changed');
    expect(harness.transaction).not.toHaveBeenCalled();
  });
});
