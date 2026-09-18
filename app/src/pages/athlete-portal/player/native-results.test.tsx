import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../../../lib/firebase', () => ({ auth: { currentUser: { uid: 'owner' } }, db: {}, cloud: {}, storage: {} }));
import { drillByKey } from '../lib/drills';
import { nativeBenchmarkBand, nativeChartPoints, nativeSupportingPoints, nativePreviewSessions, nativeDashboardRows, nativeDashboardMetrics } from './native-results';
import { SkillProfile } from './PlayerProfile';
import { playerProfile } from './scoring';
import PlayerDrillMenu from './PlayerDrillMenu';
import NativeDrillDashboard from '../views/NativeDrillDashboard';
import PosePlayback from '../../../components/PosePlayback';
import { previewData } from '../lib/preview';
import { profileActivity } from './profile-activity';

describe('native results presentation preserves measured evidence', () => {
  const shooting = drillByKey('shooting');
  const rows = [
    { id: 'a', repType: 'deadballShot', sessionNumber: 1, repNumber: 1, velocity: 20, createdAtMillis: Date.UTC(2026, 8, 16) },
    { id: 'b', repType: 'deadballShot', sessionNumber: 1, repNumber: 2, velocity: 30, createdAtMillis: Date.UTC(2026, 8, 16) },
    { id: 'bad', repType: 'deadballShot', sessionNumber: 1, repNumber: 3, velocity: 900, createdAtMillis: Date.UTC(2026, 8, 16), resultStatus: { qualified: false } },
    { id: 'c', repType: 'deadballShot', sessionNumber: 2, repNumber: 1, velocity: 40, createdAtMillis: Date.UTC(2026, 5, 16) },
  ];
  it('keeps unavailable attempts out of session means and selected-rep charts', () => {
    expect(nativeChartPoints(shooting, rows, null).map(point => point.value)).toEqual([40, 25]);
    expect(nativeChartPoints(shooting, rows, 'session1').map(point => point.value)).toEqual([20, 30]);
    expect(nativeChartPoints(shooting, [{ ...rows[0], velocity: null }], null)).toEqual([]);
  });
  it('shows measured rep scatter for at most five sessions and no duplicate selected-session layer', () => {
    const supporting = nativeSupportingPoints(shooting, rows, null);
    expect(supporting.map(point => [point.x, point.value])).toEqual([[0, 40], [1, 20], [1, 30]]);
    expect(supporting.some(point => point.repId === 'bad')).toBe(false);
    expect(nativeSupportingPoints(shooting, rows, 'session1')).toEqual([]);
    const sessions = Array.from({ length: 6 }, (_, i) => ({ ...rows[0], id: String(i), sessionNumber: i + 1 }));
    expect(nativeSupportingPoints(shooting, sessions.slice(0, 5), null)).toHaveLength(5);
    expect(nativeSupportingPoints(shooting, sessions, null)).toEqual([]);
  });
  it('derives preview favorite and totals from the same sample history', () => {
    const data = previewData(), reps = Object.values(data.reps).flat();
    const activity = profileActivity(nativePreviewSessions(reps));
    expect(activity.totalSessions).toBe(playerProfile(reps).totalSessions);
    expect(activity.totalSessions).toBeGreaterThan(0);
    expect(activity.favoriteName).not.toBe('—');
    expect(activity.favoriteReps).toBeGreaterThan(0);
  });
  it('filters chart windows without filtering out unknown dates in all-time history', () => {
    const unknown = { ...rows[0], id: 'unknown', createdAtMillis: undefined };
    const future = { ...rows[0], id: 'future', createdAtMillis: Date.UTC(2027, 0, 1) };
    expect(nativeDashboardRows([...rows, unknown, future], 'week', new Date(Date.UTC(2026, 8, 18))).map(row => row.id)).toEqual(['bad', 'b', 'a']);
    expect(nativeDashboardRows([unknown], 'all')).toHaveLength(1);
    expect(nativeChartPoints(shooting, [unknown], null)[0].label).toBe('Session 1');
  });
  it('uses native open-ended benchmark bands without scoring missing data', () => {
    expect(nativeBenchmarkBand(null)).toBeNull();
    expect([64, 65, 84, 85, 99, 100, 140].map(score => nativeBenchmarkBand(score)?.label)).toEqual(['Early stage', 'Developing', 'Developing', 'Approaching', 'Approaching', 'At standard', 'At standard']);
    const html = renderToStaticMarkup(<SkillProfile profile={playerProfile([])} />);
    expect(html).toContain('0/5 recorded'); expect(html).not.toContain('At standard');
    expect(html.indexOf('Show Power')).toBeLessThan(html.indexOf('Show Speed'));
    expect(html.indexOf('Show Speed')).toBeLessThan(html.indexOf('Show Agility'));
    expect(html).toContain('D1 reference: 100');
  });
  it('uses native qualified-only metric contents, foot counts and half-split trends', () => {
    const metrics = nativeDashboardMetrics(shooting, rows.map((row, i) => ({ ...row, strike_foot: i % 2 ? 'left' : 'right', launch_angle: i === 0 ? 160 : i === 1 ? 179.5 : 10 })));
    expect(metrics.find(item => item.label === 'Total Kicks')?.value).toBe('3');
    expect(metrics.find(item => item.label === 'Avg Launch Angle')?.value).toBe('15.0°');
    expect(metrics.find(item => item.label === 'Dominant Foot')?.value).toBe('Left');
    expect(metrics.find(item => item.label === 'Recent Trend')?.value).toBe('↘ -37.5%');
    const timed = nativeDashboardMetrics(drillByKey('dribbling'), [{ id: '1', totalTime: 10, avgBallDistance: 1, createdAtMillis: 1 }, { id: '2', totalTime: 8, avgBallDistance: 1, createdAtMillis: 2 }]);
    expect(timed.find(item => item.label === 'Time Trend')?.value).toBe('↘ 20.0% faster');
    expect(timed.find(item => item.label === 'Ball Distance')?.value).toBe('3.3 ft');
  });
  it('makes session selection and opening a recording distinct actions', () => {
    const html = renderToStaticMarkup(<NativeDrillDashboard drill={shooting} reps={rows} onOpenRep={() => {}} />);
    expect(html).toContain('aria-label="Open Session 1"');
    expect(html).toContain('aria-label="Result time range"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('Average measured result per session');
  });
  it('offers all drill destinations and honest app-only settings', () => {
    const html = renderToStaticMarkup(<PlayerDrillMenu onSelect={() => {}} />);
    expect((html.match(/class="native-drill-choice"/g) || [])).toHaveLength(8);
    for (const label of ['Shooting', 'Sprint', 'Jump', 'Broad Jump', 'Dribbling', 'Change of Direction', 'Free Record', 'Drill Settings']) expect(html).toContain(label);
    expect(html).toContain('Recording settings belong to the PoseTek mobile app.');
  });
  it('allows manual frame steps but does not invent a playback clock', () => {
    const html = renderToStaticMarkup(<PosePlayback nativeControls frames={[[{ x: .5, y: .5, visibility: 1 }]]} metadata={{}} title="Saved frame" />);
    expect(html).toContain('aria-label="Previous frame"');
    expect(html).toContain('aria-label="Next frame"');
    expect(html).toContain('Frame timing unavailable');
    expect(html).toContain('aria-label="Play" disabled');
  });
});
