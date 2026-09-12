import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../../../lib/firebase', () => ({ default: {}, auth: { currentUser: { uid: 'auth-player' } }, db: {}, cloud: {}, storage: {} }));
import type { Row } from './execution';
import { executable, freshWorkout, initialLog, patchBlock, resumeWorkout } from './execution';
import { newClock, elapsed, pauseClock, resumeClock, restSeconds, reconcileClock, interactClock, IDLE_MS } from './clock';
import { playerProfile, intakeSnapshot, comparisons, profileCell } from './scoring';
import { playerStandings } from './PlayerLeaderboards';
import { weekProgress } from './progress';
import { capabilityEnabled, parseFrame, streamCoach, validHandoff } from './gateway';
import { previewProgram } from './PlayerTraining';
import { playerRoute } from './PlayerExperience';
import PlayerExperience from './PlayerExperience';
import { previewData } from '../lib/preview';

const plan = (): Row => ({ ...previewProgram(), id: 'p', startDate: '2026-09-07', timezone: 'America/Los_Angeles' });
const workout = () => executable(plan(), plan().weeks[0].workouts[0], 1);
afterEach(() => { vi.unstubAllGlobals(); });

describe('mobile execution contract', () => {
  it('uses namespaced v2 log IDs and pins the executable snapshot', () => {
    const w = workout(), l = initialLog(w, new Date());
    expect(w.id).toBe('p_w1s1'); expect(l.schemaVersion).toBe(2); expect(l.workoutSnapshot.blocks).toEqual(w.blocks);
  });
  it('requires review after a prescription revision and preserves an already started snapshot', () => {
    const w = workout(), edited = plan(); edited.weeks[0].workouts[0].revision = 2;
    expect(() => freshWorkout(edited, w)).toThrow('changed');
    const log = { ...initialLog(w, new Date()), id: w.id };
    const later = { ...w, blocks: [], workoutRevision: 2 };
    expect(resumeWorkout(later, log).blocks).toEqual(w.blocks);
    expect(resumeWorkout(later, log).workoutRevision).toBe(1);
  });
  it('does not reopen a finished session or start from an inactive plan', () => {
    expect(() => resumeWorkout(workout(), { ...initialLog(workout(), 0), endedAt: new Date() })).toThrow('ended');
    expect(() => freshWorkout({ ...plan(), status: 'superseded' }, workout())).toThrow('active');
  });
  it('rejects stale ad-hoc weeks and accepts a current ready workout', () => {
    const p = plan(), a = { ...p.weeks[0].workouts[0], id: 'adhoc', workoutId: 'adhoc', weekNumber: 1, planId: p.id, status: 'ready' };
    const w = executable(p, a, 1, 'adhoc');
    expect(freshWorkout(p, w, a, new Date('2026-09-10T12:00:00Z')).id).toBe('adhoc');
    expect(() => freshWorkout(p, w, a, new Date('2026-09-20T12:00:00Z'))).toThrow('no longer ready');
  });
  it('splices only the intended block and undo removes all evidence', () => {
    const w = workout(), old = { ...initialLog(w, 0), blocks: [{ blockId: 'b1', status: 'done' }, { blockId: 'b2', status: 'partial' }] };
    expect(patchBlock(old, 'b1', null)).toEqual([{ blockId: 'b2', status: 'partial' }]);
    expect(() => patchBlock(old, 'not-in-snapshot', null)).toThrow('not in');
  });
});

describe('clock matches mobile suspension and pause behavior', () => {
  it('caps an overnight gap at 30 minutes and requires explicit resume', () => {
    const c = newClock(1000), later = IDLE_MS * 20;
    expect(elapsed(c, later)).toBe(1800);
    expect(interactClock(c, later).runningSince).toBeNull();
    expect(elapsed(resumeClock(reconcileClock(c, later), later), later + 1000)).toBe(1801);
  });
  it('freezes rest when paused and retains sub-second remainder', () => {
    const c = { ...newClock(1000), restUntil: 61000 };
    const paused = pauseClock(c, 15500);
    expect(restSeconds(paused, 90000)).toBe(46);
    const resumed = resumeClock(paused, 90000);
    expect(restSeconds(resumed, 90500)).toBe(45);
    expect(elapsed(resumed, 91000)).toBe(15.5);
  });
});

describe('profile and leaderboard parity', () => {
  it('does not rank a speed-only sprint and ranks fastest completion first', () => {
    const players = [{ id: 'speed-only', reps: [{ repType: 'sprint', max_velocity: 20 }] }, { id: 'slow', reps: [{ repType: 'sprint', totalTime: 4 }] }, { id: 'fast', reps: [{ repType: 'sprint', totalTime: 2 }] }];
    expect(playerStandings(players, 'sprint').map(p => p.id)).toEqual(['fast', 'slow']);
    expect(playerProfile(players[0].reps).overall).toBeNull();
  });
  it('uses the same Overall score, missing-data handling and tie rank as Profile', () => {
    const reps = [{ repType: 'sprint', totalTime: 2, max_velocity: 7, max_acceleration: 4 }];
    const score = playerProfile(reps).overall;
    const rows = playerStandings([{ id: 'a', reps }, { id: 'b', reps }], 'overall');
    expect(rows.map(r => r.rank)).toEqual([1, 1]); expect(rows[0].value).toBe(score);
    expect(playerProfile([]).metrics.every(m => m.best === null)).toBe(true);
  });
  it('matches courses within five percent, caps slowdown penalty and never mixes distances', () => {
    const reps = [{ id: 'd', repType: 'dribbling', totalTime: 6, markerDistance: 10, dribble_foot: 'right' }, { id: 'l', repType: 'dribbling', totalTime: 8, markerDistance: 10.4, dribble_foot: 'left' }, { id: 'c', repType: 'changeOfDirection', totalTime: 4, markerDistance: 10.4 }];
    const c = comparisons(reps); expect(c.dribbleRetention).toBe(75); expect(c.slowdown).toBe(50); expect(c.multiplier).toBeCloseTo(.8 + .2 * 4 / 6);
    expect(comparisons(reps.map(r => r.id === 'c' ? { ...r, markerDistance: 12 } : r)).multiplier).toBe(1);
  });
  it('uses age/gender dataset cells and supplies primary metrics to intake', () => {
    expect(profileCell({ age: 15, gender: 'female' })).toBe('u16|female');
    const p = playerProfile([{ repType: 'deadballShot', velocity: 25 }]);
    const s = intakeSnapshot(p);
    expect(s.drills[0].drill).toBe('kick'); expect(s.drills[0].metrics[0].bestCanonical).toBe(25);
    expect(playerProfile([{ repType: 'jump', jumpHeight: .4 }], {}, { cells: {} }).overall).toBeNull();
  });
});

describe('v3 weekly evidence', () => {
  it('counts one exposure per domain per workout and half minutes for partial work', () => {
    const p = plan(), w = workout(), l = { ...initialLog(w, new Date('2026-09-08T12:00:00Z')), id: w.id, blocks: [{ blockId: 'b1', drillId: 'a', domain: 'dribbling', status: 'done', estimatedMinutes: 9 }, { blockId: 'b2', drillId: 'b', domain: 'dribbling', status: 'partial', estimatedMinutes: 9 }] };
    const progress = weekProgress(p, p.weeks[0], [l, l], [], []);
    expect(progress.domains.find(d => d.domain === 'dribbling')?.done).toBe(1); expect(progress.minutes).toBe(13);
  });
  it('deduplicates app recordings linked to a logged workout while counting free sessions', () => {
    const p = plan(), w = workout(), l = { ...initialLog(w, 0), id: w.id, linkedTrainingSessionId: 'linked', blocks: [{ blockId: 'b1', domain: 'dribbling', status: 'done', estimatedMinutes: 5 }] };
    const reps = [1, 2, 3].map((n) => ({ id: `r${n}`, repType: 'dribbling', sessionNumber: n === 3 ? 2 : 1, createdAtMillis: new Date('2026-09-08T12:00:00Z').getTime() }));
    const progress = weekProgress(p, p.weeks[0], [l], reps, [{ id: 'linked', sessionRefs: [{ drillType: 'dribbling', sessionNumber: 1, sessionDocId: 's1' }] }]);
    expect(progress.domains.find(d => d.domain === 'dribbling')?.done).toBe(2);
  });
  it('ignores wrong-plan, forged log IDs, skipped work and ad-hoc work outside the calendar week', () => {
    const p = plan(), w = workout(), base = { ...initialLog(w, new Date('2026-09-25T12:00:00Z')), id: w.id, blocks: [{ status: 'done', domain: 'dribbling', estimatedMinutes: 50 }] };
    const progress = weekProgress(p, p.weeks[0], [{ ...base, planId: 'other' }, { ...base, id: 'wrong' }, { ...base, id: 'adhoc', source: 'adhoc' }], [], []);
    expect(progress.minutes).toBe(0); expect(progress.domains.every(d => !d.done)).toBe(true);
  });
});

describe('gateway terminal state and feature gates', () => {
  it('uses globalEnabled and preserves legacy default capability behavior', () => {
    expect(capabilityEnabled(null, 'pose_chat')).toBe(false);
    expect(capabilityEnabled({}, 'pose_chat')).toBe(true);
    expect(capabilityEnabled({ globalEnabled: false }, 'pose_chat')).toBe(false);
    for (const quota of [0, true, '3', -1, 1.5]) expect(capabilityEnabled({ capabilities: { workout_chat: { enabled: true, dailyLimitPerUser: quota } } }, 'workout_chat')).toBe(false);
    expect(capabilityEnabled({ capabilities: { workout_chat: { enabled: true, dailyLimitPerUser: 3 } } }, 'workout_chat')).toBe(true);
  });
  it('parses multiline SSE and ignores heartbeat comments', () => {
    expect(parseFrame(': heartbeat')).toBeNull();
    expect(parseFrame('event: delta\r\ndata: {\r\ndata: "text":"hello"}')).toEqual({ event: 'delta', data: { text: 'hello' } });
  });
  it('rejects an unterminated response and a terminal error after a draft', async () => {
    const firebase = await import('../../../lib/firebase'); (firebase.auth.currentUser as any).getIdToken = async () => 'test-token';
    for (const ending of ['', 'event: error\ndata: {"message":"failed"}\n\n']) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('event: draft\ndata: {"draftId":"draft"}\n\n' + ending)));
      await expect(streamCoach({ playerId: 'p' }, new AbortController().signal, () => {})).rejects.toThrow();
    }
  });
  it('completes only on done and accepts handoffs for this player only', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('event: done\ndata: {"messageId":"m"}\n\n')));
    await expect(streamCoach({ playerId: 'p' }, new AbortController().signal, () => {})).resolves.toBeUndefined();
    expect(validHandoff({ type: 'workout_request', playerId: 'p', request: '20 minutes', destination: 'workout_builder' }, 'p')).toBe(true);
    expect(validHandoff({ type: 'workout_request', playerId: 'other', request: '20 minutes', destination: 'workout_builder' }, 'p')).toBe(false);
  });
});

describe('player route and preview rendering', () => {
  it('keeps legacy profile and saved session links meaningful', () => {
    expect(playerRoute('?view=profile').view).toBe('home');
    expect(playerRoute('?drill=sprint&session=session3&rep=r2')).toMatchObject({ view: 'drills', drill: 'sprint', session: 'session3', rep: 'r2' });
  });
  it.each(['home', 'aiCoach', 'training', 'leaderboards', 'drills'])('renders %s with five player tabs and no staff controls', view => {
    const data = previewData();
    const ctx = { ...data, notify: () => {}, allStatsReps: () => Object.values(data.reps).flat() };
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={[`/athlete?preview=1&view=${view}`]}><PlayerExperience ctx={ctx} initialReps={data.reps} /></MemoryRouter>);
    expect(html).toContain('Player tabs'); expect(html).not.toContain('Coach view'); expect(html).toContain('no account changes');
    if (view === 'training') { expect(html).toContain('Next'); expect(html).toContain('Keep the ball close'); }
    if (view === 'home') expect(html).toContain('Your skill map');
  });
});
