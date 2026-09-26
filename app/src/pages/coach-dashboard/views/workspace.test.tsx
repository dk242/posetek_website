import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Overview from './Overview';
import AthleteDetail from './AthleteDetail';
import WorkoutHistory from './WorkoutHistory';
import { athleteSummary } from '../lib/logic';

const player = { id: 'p', firstName: 'Sam', lastName: 'Example' };
const noop = () => {};
describe('coach source-of-truth presentation', () => {
  it('starts with training and does not label failed reads as missing plans or zero activity', () => {
    const html = renderToStaticMarkup(<Overview orgLabel="Assigned team" players={[player]} summaries={[]}
      loads={{ p: { kind: 'error', message: 'History unavailable' } }} onRetry={noop} onSelect={noop} onPrescribe={noop} />);
    expect(html).toContain('aria-pressed="true" class="active">Training');
    expect(html).toContain('History unavailable'); expect(html).toContain('Retry Sam');
    expect(html).toContain('Team totals stay hidden'); expect(html).not.toContain('No active program');
    expect(html).not.toContain('0 / 0'); expect(html).toContain('disabled=""');
  });
  it.each([null, { id: 'old', schemaVersion: 1, status: 'active', weeks: [] },
    { id: 'new', schemaVersion: 3, status: 'active', weeks: [] }])('offers reviewed planning for every active-plan state (%s)', plan => {
    const html = renderToStaticMarkup(<AthleteDetail summary={athleteSummary(player, [], plan ? [plan] : [], [])}
      job={null} onBack={noop} onCreatePlan={noop} />);
    expect(html).toContain('Prescribe / review plan'); expect(html).toContain('Workout history');
    if (plan?.schemaVersion === 1) {
      expect(html).toContain('This older plan is available to review');
      expect(html).not.toContain('Add drill');
      expect(html).not.toContain('Adjust ');
    }
  });
  it('renders a confirmed empty history truthfully', () => {
    const html = renderToStaticMarkup(<Overview orgLabel="Team" players={[player]} summaries={[athleteSummary(player, [], [], [])]}
      loads={{ p: { kind: 'ready', bundle: { plans: [], reps: [], logs: [] } } }} onRetry={noop} onSelect={noop} onPrescribe={noop} />);
    expect(html).toContain('No active program'); expect(html).toContain('0 / 0');
    expect(html).not.toContain('Team totals stay hidden');
  });
  it('shows pinned prescriptions and separates session completion from skipped sets', () => {
    const html = renderToStaticMarkup(<WorkoutHistory logs={[{ id: 'one', planId: 'p', workoutId: 'w', activeSeconds: 120,
      startedAt: new Date('2026-09-20'), endedAt: new Date('2026-09-20T02:00:00Z'), endReason: 'completed',
      workoutSnapshot: { title: 'Saved workout', blocks: [{ blockId: 'b', name: 'Saved drill', sets: 3 }] },
      blocks: [{ blockId: 'b', status: 'skipped', setsCompleted: 0, skipReason: 'pain' }] }]} />);
    expect(html).toContain('Saved workout'); expect(html).toContain('Saved drill'); expect(html).toContain('2 min timer');
    expect(html).toContain('Completed'); expect(html).toContain('Not all completed'); expect(html).toContain('Reason: pain');
  });
  it('does not substitute the current program when an old execution snapshot is missing', () => {
    const html = renderToStaticMarkup(<WorkoutHistory logs={[{ id: 'legacy', startedAt: new Date(), blocks: [] }]} />);
    expect(html).toContain('No ending recorded'); expect(html).toContain('Current program details are not substituted');
    expect(html).toContain('Prescription unknown');
  });
});
