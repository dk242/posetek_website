import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseProvisionalEstimates, provisionalDribbling, provisionalScore, type ProvisionalEstimate } from './provisional-estimates';
import AthleteStats from '../components/athlete-stats/AthleteStats';
import { buildProfile } from '../components/athlete-stats/profile';
import { playerProfile, intakeSnapshot } from '../pages/athlete-portal/player/scoring';
import { personalizedParams } from '../pages/admin/lib/personalizedLogic';
import { DEFAULT_INTAKE } from '../pages/admin/lib/planJobs';
import { SkillProfile } from '../pages/athlete-portal/player/PlayerProfile';

const recordedAtMillis = Date.now() - 86400000;
const source = { id: 'incomplete', repType: 'dribbling', createdAtMillis: recordedAtMillis,
  totalTime: null, resultStatus: { qualified: false, duplicate: false, reason: 'noPrimaryResult' } };
const estimate: ProvisionalEstimate = { id: 'review-one', repId: source.id, drill: 'dribbling', axis: 'ballControl',
  kind: 'conditionalEstimate', method: 'constant_return_pace_v1', estimatedTotalSeconds: 9.3,
  lowerSeconds: 9.2, upperSeconds: 9.4, observedCourseFraction: .955,
  recordedAtMillis, reviewedAtMillis: recordedAtMillis + 1000, confidence: 'low',
  assumption: 'Maintains the observed return pace to the finish.', limitation: 'Finish was not recorded.' };

describe('reviewed provisional dribbling', () => {
  it('uses only supported separately supplied estimates matched to an incomplete recording', () => {
    expect(provisionalDribbling([estimate], [source])).toEqual(estimate);
    expect(provisionalDribbling([estimate], [])).toBeNull();
    expect(provisionalDribbling([estimate], [{ ...source, createdAtMillis: recordedAtMillis - 1 }])).toBeNull();
    expect(provisionalDribbling([estimate], [{ ...source, resultStatus: { ...source.resultStatus, duplicate: true } }])).toBeNull();
    expect(parseProvisionalEstimates([{ ...estimate, axis: 'agility' }, { ...estimate, lowerSeconds: 10 }, { ...estimate, estimatedTotalSeconds: '9.3' }])).toEqual([]);
    expect(provisionalScore(estimate, 6.04)).toBeCloseTo(64.9462);
  });
  it('a valid retest supersedes the estimate without changing measured scoring', () => {
    const measured = { ...source, id: 'retest', totalTime: 8, resultStatus: { qualified: true, duplicate: false } };
    expect(provisionalDribbling([estimate], [source, measured])).toBeNull();
    expect(buildProfile([source]).axes.find(a => a.key === 'ballControl')?.score).toBeNull();
    expect(buildProfile([source, measured])).toEqual(buildProfile([measured]));
    expect(intakeSnapshot(playerProfile([source])).drills).toEqual([]);
  });
  it('renders a hollow estimated marker while retaining missing measured coverage', () => {
    const html = renderToStaticMarkup(<AthleteStats reps={[]} estimateReps={[source]} provisionalEstimates={[estimate]} />);
    expect(html).toContain('65 est.');
    expect(html).toContain('provisional-chart-marker');
    expect(html).toContain('About 9.3 s');
    expect(html).toContain('0/5 recorded');
    expect(html).toContain('not a confidence interval');
    expect(renderToStaticMarkup(<AthleteStats reps={[]} estimateReps={[source]} />)).not.toContain('About 9.3 s');
  });
  it('the self-player chart displays the estimate separately from its verified overall', () => {
    const profile = playerProfile([source]);
    const html = renderToStaticMarkup(<SkillProfile profile={profile} estimate={estimate} />);
    expect(html).toContain('provisional-chart-marker');
    expect(html).toContain('65 est.');
    expect(html).toContain('About 9.3 s');
    expect(profile.overall).toBeNull();
    const measured = { ...source, id: 'retest', totalTime: 8, resultStatus: { qualified: true, duplicate: false } };
    const retested = renderToStaticMarkup(<SkillProfile profile={playerProfile([measured])} estimate={estimate} />);
    expect(retested).not.toContain('About 9.3 s');
    expect(retested).not.toContain('provisional-chart-marker');
  });
  it('planning carries explicit assumptions and a bounded goal, never fabricated best results', () => {
    const baseline = personalizedParams([], {}, null, DEFAULT_INTAKE);
    const planned = personalizedParams([], {}, null, DEFAULT_INTAKE, [], 'Prepare for practice.', [estimate], [source]);
    expect(planned.statsProfile).toEqual(baseline.statsProfile);
    expect(planned.intake.level).toBe(baseline.intake.level);
    expect(planned.intake.goals).toEqual(['dribbling']);
    expect(planned.intake.freeTextGoals).toContain('One-time dribbling estimate: ~9.3s');
    expect(planned.intake.freeTextGoals).toContain('not a measured test or agility result');
    expect(planned.intake.freeTextGoals).toContain('Prepare for practice.');
    expect(planned.intake.freeTextGoals.length).toBeLessThanOrEqual(500);
    expect(personalizedParams([], {}, null, DEFAULT_INTAKE, ['passing', 'shooting'], '', [estimate], [source]).intake.goals).toEqual(['passing', 'shooting']);
    expect(() => personalizedParams([], {}, null, DEFAULT_INTAKE, [], 'x'.repeat(500), [estimate], [source])).toThrow('Shorten');
  });
  it('planning drops provisional context after a valid test and preserves unrelated coach goals', () => {
    const measured = { ...source, id: 'retest', totalTime: 8, resultStatus: { qualified: true, duplicate: false } };
    const output = personalizedParams([measured], {}, null, DEFAULT_INTAKE, ['passing'], 'Coach context', [estimate], [source, measured]);
    expect(output.intake.goals).toEqual(['passing']);
    expect(output.intake.freeTextGoals).toBe('Coach context');
  });
});
