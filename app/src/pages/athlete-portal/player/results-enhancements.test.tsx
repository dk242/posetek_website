import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../../../lib/firebase', () => ({ auth: { currentUser: { uid: 'owner' } }, db: {}, cloud: {}, storage: {} }));
import { boardSummary, rankRows } from '../lib/mobile';
import { playerDistribution, playerStandings } from './PlayerLeaderboards';
import { mergeProfileSessions, normalizeProfileSession, profileActivity } from './profile-activity';
import { boundFeedback, clipJoints, comparisonEvidenceSteps, evidenceFrame, singleEvidenceSteps, supportedComparison } from './technique-evidence';
import { poseJointOptions, visiblePosePoint } from '../../../lib/pose-joints';
import PosePlayback from '../../../components/PosePlayback';

describe('native leaderboard parity', () => {
  it('gives tied teammates half-credit, excluding self', () => {
    const rows = rankRows([{ id: 'a', name: 'Alex', value: 4 }, { id: 'b', name: 'Blair', value: 4 }], true);
    expect(boardSummary(rows, true, 'a').percentile).toBe(50);
    expect(boardSummary(rows, true, 'b').percentile).toBe(50);
    const three = rankRows([...rows, { id: 'c', name: 'Cam', value: 5 }], true);
    expect(boardSummary(three, true, 'a').percentile).toBe(75);
    expect(boardSummary(three, true, 'c').percentile).toBe(0);
    expect(boardSummary([rows[0]], true, 'a').percentile).toBeNull();
  });
  it('orders exact ties by name then ID, and uses competition ranks', () => {
    const rows = [{ id: 'c', name: 'Sam', value: 10 }, { id: 'b', name: 'Sam', value: 10 }, { id: 'a', name: 'Alex', value: 10 }, { id: 'd', name: 'Dee', value: 9 }];
    const sorted = rankRows(rows, false);
    expect(sorted.map(row => row.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(sorted.map(row => row.rank)).toEqual([1, 1, 1, 4]);
    expect(rankRows([...rows].reverse(), false)).toEqual(sorted);
  });
  it('does not graph sparse or zero-spread fields', () => {
    expect(playerDistribution([{ value: 1 }, { value: 2 }]).plottable).toBe(false);
    expect(playerDistribution([{ value: 1 }, { value: 1 }, { value: 1 }]).plottable).toBe(false);
    expect(playerDistribution([{ value: 1 }, { value: 2 }, { value: 3 }])).toMatchObject({ mean: 2, plottable: true });
  });
  it('never ranks unavailable results, duplicates or boolean measurements', () => {
    const rows = playerStandings([
      { id: 'failed', reps: [{ repType: 'sprint', totalTime: 1, resultStatus: { qualified: false } }] },
      { id: 'duplicate', reps: [{ repType: 'sprint', totalTime: 1, resultStatus: { qualified: true, duplicate: true } }] },
      { id: 'bool', reps: [{ repType: 'sprint', totalTime: true }] },
      { id: 'valid', reps: [{ repType: 'sprint', totalTime: 4, resultStatus: { qualified: true } }] },
    ], 'sprint');
    expect(rows.map(row => row.id)).toEqual(['valid']);
  });
});

describe('canonical profile session activity', () => {
  it('uses current session fields and merges legacy mirrors only within a drill', () => {
    const merged = mergeProfileSessions([{ id: 's', sessionType: 'deadballShot', sessionNumber: 2, repCount: 4, timestamp: new Date(2026, 8, 17) }], [
      { id: 'old', drillType: 'side_kick', currentSession: 'session2', numberKicks: 3 },
      { id: 'other-drill', type: 'jump', currentSession: 'session2', numberReps: 1 },
      { id: 'history', type: 'side_kick', currentSession: 'session_1', numberReps: 8 },
      { id: 'history', type: 'side_kick', currentSession: 'session_1', numberReps: 8 },
    ]);
    expect(merged).toHaveLength(3);
    expect(merged.find(row => row.id === 's')?.repCount).toBe(4);
    expect(profileActivity(merged, new Date(2026, 8, 17, 12))).toMatchObject({ totalSessions: 3, favoriteName: 'Shooting', favoriteReps: 12, streak: 1 });
  });
  it('does not collapse unrelated current documents or identity-free legacy sessions', () => {
    const current = [{ id: 'c1', sessionType: 'sprint' }, { id: 'c2', sessionType: 'sprint' }];
    const legacy = [{ id: 'l1', type: 'sprint' }, { id: 'l2', type: 'sprint' }];
    expect(mergeProfileSessions(current, legacy)).toHaveLength(4);
  });
  it('counts local recording days, excludes future/unknown dates and supports yesterday', () => {
    const rows = mergeProfileSessions([16, 17, 19].map(day => ({ id: `s${day}`, sessionType: 'jump', createdAt: new Date(2026, 8, day, 10) })), [{ id: 'unknown', type: 'jump' }]);
    expect(profileActivity(rows, new Date(2026, 8, 18, 12)).streak).toBe(2);
    expect(profileActivity(rows, new Date(2026, 8, 21, 12)).streak).toBe(0);
  });
  it('reads historical dates and counts without substituting missing measurements', () => {
    expect(normalizeProfileSession({ id: 'old', type: 'changeOfDirection', currentSession: 'session-3', currentDate: '2026-09-17', currentTime: '14:30:00', numberKicks: 7 }, true)).toMatchObject({ drill: 'changeOfDirection', folder: 'session3', repCount: 7, time: new Date(2026, 8, 17, 14, 30).getTime() });
    expect(normalizeProfileSession({ id: 'empty' })).toBeNull();
    expect(profileActivity([]).favoriteName).toBe('—');
    expect(normalizeProfileSession({ id: 'unknown', type: 'jump', timestamp: false })?.time).toBeNull();
  });
});

const source = { playerId: 'p', repId: 'kick', jobId: 'job', keyFrames: { backswing: 3, contact: 7, followThrough: 9 }, metrics: [{ id: 'm', frameKey: 'contact', valid: true, jointIds: [23, 25, 27] }], focusAreas: [{ observationId: 'f', rank: 1, title: 'Plant', frameKey: 'contact', cue: 'Hold steady', jointIds: [23, 25, 27], metricIds: ['m'] }] };
const correction = { playerId: 'p', targetType: 'single', targetId: 'kick', sourceJobId: 'job', feedback: { summary: 'Reviewed', focusAreas: [{ id: 'f', rank: 1, title: 'Reviewed finding', evidenceIds: ['m'] }] } };
const comparison = { id: 'pair', comparisonId: 'pair', playerId: 'p', jobId: 'compare-job', leftRepId: 'l', rightRepId: 'r', leftKeyFrames: { contact: 7 }, rightKeyFrames: { contact: 4 }, differences: [{ id: 'contact.knee', frameKey: 'contact', metric: 'knee_angle', left: 100, right: 110, delta: 10, comparable: true, units: 'degrees' }], focusAreas: [{ rank: 1, title: 'Knee position', evidenceIds: ['contact.knee'] }] };

describe('source-bound technique evidence', () => {
  it('accepts only published corrections bound to the current source job and player', () => {
    const target = { playerId: 'p', type: 'single' as const, id: 'kick' };
    expect(boundFeedback(correction, source, target)).toBe(correction);
    expect(boundFeedback(correction, { ...source, jobId: 'new-job' }, target)).toBeNull();
    expect(boundFeedback({ ...correction, playerId: 'other' }, source, target)).toBeNull();
    expect(boundFeedback(correction, null, target)).toBeNull();
    expect(boundFeedback({ ...correction, sourceJobId: null }, null, target)).not.toBeNull();
    expect(boundFeedback({ ...correction, sourceJobId: null }, source, target)).toBeNull();
  });
  it('supports comparison corrections only for the exact saved pair and source job', () => {
    const published = { ...correction, targetType: 'comparison', targetId: 'pair', sourceJobId: 'compare-job' };
    expect(boundFeedback(published, comparison, { playerId: 'p', type: 'comparison', id: 'pair' })).toBe(published);
    expect(boundFeedback(published, { ...comparison, jobId: 'old' }, { playerId: 'p', type: 'comparison', id: 'pair' })).toBeNull();
  });
  it('maps MediaPipe highlights to the actual COCO joints and drops unsupported foot tips', () => {
    expect(clipJoints([11, 23, 25, 27, 31, 999], 17)).toEqual([5, 11, 13, 15]);
    expect(clipJoints([11, 23, 31], 33)).toEqual([11, 23, 31]);
    expect(clipJoints([11], 20)).toEqual([]);
  });
  it('uses bounded source keyframes and never clamps or guesses missing evidence frames', () => {
    expect(singleEvidenceSteps(source, null, 'kick', 10, 17)[0]).toMatchObject({ frame: 7, joints: [11, 13, 15] });
    expect(singleEvidenceSteps(source, null, 'kick', 7, 33)).toEqual([]);
    expect(singleEvidenceSteps({ ...source, keyFrames: {} }, null, 'kick', 10, 33)).toEqual([]);
    for (const value of [-1, 10, 1.5, '3', null, Infinity]) expect(evidenceFrame(value, 10)).toBeNull();
  });
  it('uses reviewed citations and only the selected rep’s bounded manual annotations', () => {
    const feedback = { ...correction, annotations: [{ id: 'a', repId: 'kick', frame: 5, limbs: ['leftShin'], comment: 'Here' }, { id: 'b', repId: 'other', frame: 1 }, { id: 'c', repId: 'kick', frame: 99 }] };
    const steps = singleEvidenceSteps(source, feedback, 'kick', 10, 17);
    expect(steps.map(step => step.frame)).toEqual([5, 7]);
    expect(steps[0].joints).toEqual([13, 15]);
    expect(steps[1].title).toBe('Reviewed finding');
  });
  it('uses authoritative current evidence eligibility and the event’s own frame', () => {
    const current = { ...source, evidence: { rows: [{ id: 'event.knee.deg', eligible: true, frameKey: 'backswing', frame: 2, jointIds: [23, 25, 27], repId: 'kick' }] }, focusAreas: [{ title: 'Peak bend', frameKey: 'backswing', evidenceIds: ['event.knee.deg'] }] };
    expect(singleEvidenceSteps(current, null, 'kick', 10, 33)[0]).toMatchObject({ frame: 2, joints: [23, 25, 27] });
    expect(singleEvidenceSteps({ ...current, evidence: { rows: [{ ...current.evidence.rows[0], eligible: false, valid: true }] } }, null, 'kick', 10, 33)).toEqual([]);
    expect(singleEvidenceSteps({ ...current, evidence: { rows: [{ ...current.evidence.rows[0], frame: null }] } }, null, 'kick', 10, 33)).toEqual([]);
    expect(singleEvidenceSteps({ ...current, evidence: { rows: [{ ...current.evidence.rows[0], repId: 'other' }] } }, null, 'kick', 10, 33)).toEqual([]);
  });
  it('opens saved comparison evidence at each foot’s own frame and requires both frames', () => {
    expect(comparisonEvidenceSteps(comparison, null, 'left', 10, 8, 33)[0]).toMatchObject({ frame: 7, counterpartFrame: 4 });
    expect(comparisonEvidenceSteps(comparison, null, 'right', 8, 10, 33)[0]).toMatchObject({ frame: 4, counterpartFrame: 7 });
    expect(comparisonEvidenceSteps(comparison, null, 'left', 10, 4, 33)).toEqual([]);
    const missing = { ...comparison, differences: [{ ...comparison.differences[0], comparable: false }] };
    expect(comparisonEvidenceSteps(missing, null, 'left', 10, 8, 33)).toEqual([]);
  });
  it('requires explicit event frames and preserves supplied event indexes over phase indexes', () => {
    const event = { ...comparison, differences: [{ ...comparison.differences[0], id: 'event.knee', leftFrame: 2, rightFrame: 3 }], focusAreas: [{ evidenceIds: ['event.knee'] }] };
    expect(comparisonEvidenceSteps(event, null, 'left', 10, 8, 33)[0]).toMatchObject({ frame: 2, counterpartFrame: 3 });
    expect(comparisonEvidenceSteps({ ...event, differences: [{ ...event.differences[0], rightFrame: undefined }] }, null, 'left', 10, 8, 33)).toEqual([]);
  });
  it('accepts only distinct left/right saved sources for the selected player', () => {
    const reps = [{ id: 'l', strike_foot: 'left' }, { id: 'r', strike_foot: 'right' }];
    expect(supportedComparison(comparison, 'p', reps)).toBe(true);
    expect(supportedComparison(comparison, 'other', reps)).toBe(false);
    expect(supportedComparison(comparison, 'p', [{ id: 'l', strike_foot: 'right' }, reps[1]])).toBe(false);
    expect(supportedComparison({ ...comparison, rightRepId: 'l' }, 'p', reps)).toBe(false);
  });
});

describe('recorded pose inspection', () => {
  it('keeps invalid and low confidence points out of overlays', () => {
    expect(visiblePosePoint({ x: .4, y: .3, visibility: .8 })).toBe(true);
    for (const point of [{ x: .4, y: .3, visibility: .01 }, { x: NaN, y: .3 }, { x: .2, y: 1.1 }, { x: null, y: .2 }, { x: .3, y: .2, visibility: 2 }]) expect(visiblePosePoint(point)).toBe(false);
  });
  it('offers only known-layout joint controls and preserves unknown-timing copy', () => {
    expect(poseJointOptions(17).find(joint => joint.index === 11)?.label).toBe('Left hip');
    expect(poseJointOptions(33).find(joint => joint.index === 11)?.label).toBe('Left shoulder');
    expect(poseJointOptions(20)).toEqual([]);
    const frame = Array.from({ length: 17 }, () => ({ x: .5, y: .5, visibility: 1 }));
    const html = renderToStaticMarkup(<PosePlayback frames={[frame]} metadata={{}} title="Evidence" />);
    expect(html).toContain('Frame timing unavailable');
    expect(html).toContain('Inspect joints');
    expect(html).toContain('Left hip');
  });
});
