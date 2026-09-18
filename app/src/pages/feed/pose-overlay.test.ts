import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import type { SocialPoseOverlay } from './contracts';
import { footTrail, poseAtTime, poseConnections, validatedOverlay } from './pose-overlay';

const { projectOverlay } = createRequire(import.meta.url)('../../../../functions/social-media-overlay.js');

type Point = [number, number] | null;
function overlay(layout: SocialPoseOverlay['layout'] = 'mediapipe33', times = [0, .1, .2]): SocialPoseOverlay {
  const count = layout === 'coco17' ? 17 : 33;
  return { version: 1, coordinateSpace: 'normalized', layout, sourceWidth: 1920, sourceHeight: 1080,
    frames: times.map((time, i) => ({ time, points: Array.from({ length: count }, () => [.2 + (i % 5) * .1, .4] as [number, number]) })),
    markers: [{ label: 'Peak', time: times[Math.floor(times.length / 2)] }],
    footJoints: layout === 'coco17' ? { left: 15, right: 16 } : { left: 27, right: 28 } };
}
const withFramePoints = (points: Point[][]) => ({ ...overlay(), frames: points.map((value, i) => ({ time: i * .1, points: value })) });

describe('feed overlay contract', () => {
  it.each([17, 33])('accepts the actual backend projection for %i-point recordings', count => {
    const raw = Array.from({ length: 960 }, () => Array.from({ length: count }, () => [.25, .75, .9, .9]));
    const server = projectOverlay(raw, { playerId: 'p', rep: { id: 'r' }, effectiveRep: { repType: 'jump', peakFrame: 100, resultStatus: { qualified: true, duplicate: false } },
      movieName: 'p/jump/session1/kick1/clip.mov', movieGeneration: '7', evidence: {
        metadata: { frameWidth: 640, frameHeight: 360, framesPerSecond: 240 },
        context: { rep: { playerDocId: 'p', repId: 'r', videoStoragePath: 'p/jump/session1/kick1/clip.mov' }, capture: { clipFramesPerSecondUsed: 240 } },
      } });
    const parsed = validatedOverlay(server);
    expect(parsed).not.toBeNull();
    expect(parsed?.frames).toHaveLength(300);
    expect(parsed?.frames.at(-1)?.time).toBe(3.9958);
    expect(parsed?.markers).toEqual([{ label: 'Peak', time: .4167 }]);
    expect(parsed?.footJoints).toEqual(count === 17 ? { left: 15, right: 16 } : { left: 27, right: 28 });
  });

  it.each(['coco17', 'mediapipe33'] as const)('accepts the backend %s shape, normalized points and exact ankle indices', layout => {
    const value = overlay(layout);
    value.frames[0].points[0] = null;
    const parsed = validatedOverlay(value);
    expect(parsed).toEqual(value);
    expect(parsed?.frames[0].points).toHaveLength(layout === 'coco17' ? 17 : 33);
    expect(parsed?.footJoints).toEqual(layout === 'coco17' ? { left: 15, right: 16 } : { left: 27, right: 28 });
    expect(poseConnections[layout].every(edge => edge.every(index => index >= 0 && index < value.frames[0].points.length))).toBe(true);
  });

  it.each([
    ['null', null], ['undefined', undefined], ['empty object', {}], ['wrong version', { ...overlay(), version: 2 }],
    ['pixels', { ...overlay(), coordinateSpace: 'pixels' }], ['unknown layout', { ...overlay(), layout: 'pose18' }],
    ['inherited constructor', { ...overlay(), layout: 'constructor' }], ['inherited prototype', { ...overlay(), layout: '__proto__' }],
    ['zero width', { ...overlay(), sourceWidth: 0 }], ['invalid height', { ...overlay(), sourceHeight: Infinity }],
    ['oversized dimensions', { ...overlay(), sourceWidth: 16385 }],
    ['empty frames', { ...overlay(), frames: [] }], ['null frame', { ...overlay(), frames: [null] }],
    ['wrong point count', withFramePoints([[[.2, .4]]])],
    ['mixed skeleton counts', withFramePoints([overlay('coco17').frames[0].points, overlay().frames[1].points])],
    ['missing foot map', { ...overlay(), footJoints: null }], ['invalid joint index', { ...overlay(), footJoints: { left: -1, right: 33 } }],
    ['swapped foot indices', { ...overlay(), footJoints: { left: 28, right: 27 } }],
    ['wrong joint meaning', { ...overlay(), footJoints: { left: 11, right: 12 } }],
  ])('rejects %s safely so optional overlays cannot break video playback', (_label, value) => {
    expect(() => validatedOverlay(value)).not.toThrow();
    expect(validatedOverlay(value)).toBeNull();
  });

  it.each([
    ['negative', [-.1, .5]], ['outside image', [.5, 1.1]], ['nonfinite', [NaN, .5]],
    ['boolean', [true, .5]], ['numeric string', ['.2', .5]], ['extra dimension', [.2, .5, .8]], ['object', { x: .2, y: .5 }],
  ])('rejects %s coordinates in the sanitized transport', (_label, point) => {
    const value = overlay(); value.frames[1].points[2] = point as Point;
    expect(validatedOverlay(value)).toBeNull();
  });

  it.each([[-.1, 0, .1], [0, 0, .1], [.2, .1, .3], [0, NaN, .2], [0, Infinity, .2], [0, 1, 601]].map(times => ({ times })))('rejects clocks without finite bounded strictly increasing video time: $times', ({ times }) => {
    expect(validatedOverlay(overlay('mediapipe33', times))).toBeNull();
  });

  it('enforces the response frame bound while accepting both endpoints of a full-sized overlay', () => {
    const times = Array.from({ length: 300 }, (_, i) => i / 30);
    expect(validatedOverlay(overlay('mediapipe33', times))?.frames).toHaveLength(300);
    expect(validatedOverlay(overlay('mediapipe33', [...times, 10]))).toBeNull();
  });

  it('drops malformed optional markers while retaining a valid skeleton and clock', () => {
    const value = { ...overlay(), markers: [null, { label: 'Peak', time: .1 }, { label: 'Outside', time: 1 }, { label: 'Early', time: -1 }, { label: 'x'.repeat(61), time: .1 }] };
    expect(() => validatedOverlay(value)).not.toThrow();
    expect(validatedOverlay(value)?.markers).toEqual([{ label: 'Peak', time: .1 }]);
    expect(validatedOverlay({ ...overlay(), markers: null })?.markers).toEqual([]);
  });

  it('accepts the shared upper dimension and clock boundaries', () => {
    expect(validatedOverlay({ ...overlay('coco17', [599.8, 599.9, 600]), sourceWidth: 16384, sourceHeight: 16384 })).not.toBeNull();
  });
});

describe('pose synchronization', () => {
  it('uses video seconds including a nonzero offset, with smooth in-range interpolation', () => {
    const value = overlay('mediapipe33', [2, 2.1, 2.2]);
    expect(poseAtTime(value, 2)).toEqual(value.frames[0].points);
    expect(poseAtTime(value, 2.1)).toEqual(value.frames[1].points);
    expect(poseAtTime(value, 2.05)?.[0]?.[0]).toBeCloseTo(.25, 6);
    expect(poseAtTime(value, 2.05)?.[0]?.[1]).toBeCloseTo(.4, 6);
    expect(poseAtTime(value, 0)).toBeNull();
    expect(poseAtTime(value, 3)).toBeNull();
    expect(poseAtTime(value, NaN)).toBeNull();
  });

  it('does not invent a joint when either endpoint lacks tracking', () => {
    const value = overlay(); value.frames[1].points[27] = null;
    expect(poseAtTime(value, .05)?.[27]).toBeNull();
    expect(poseAtTime(value, .15)?.[27]).toBeNull();
    expect(poseAtTime(value, .15)?.[28]?.[0]).toBeCloseTo(.35, 6);
    expect(poseAtTime(value, .2)?.[27]).toEqual(value.frames[2].points[27]);
  });

  it('hides the pose inside a large unsupported gap and does not extrapolate beyond the clip', () => {
    const value = overlay('mediapipe33', [0, .1, 1]);
    expect(poseAtTime(value, .5)).toBeNull();
    expect(poseAtTime(value, 1)).toEqual(value.frames[2].points);
    expect(poseAtTime(value, 1.2)).toBeNull();
    expect(poseAtTime(value, -.2)).toBeNull();
  });

  it('supports a single recorded frame without producing nonfinite interpolated points', () => {
    const value = overlay('coco17', [.2]);
    expect(poseAtTime(value, .2)).toEqual(value.frames[0].points);
    expect(poseAtTime(value, 2)).toBeNull();
  });
});

describe('truthful movement trails', () => {
  it('retains only the latest short history, never future points', () => {
    const value = overlay('mediapipe33', [0, .1, .2, .3, .4, .5]);
    expect(footTrail(value, .4, 27)).toEqual(value.frames.slice(1, 5).map(frame => frame.points[27]));
  });

  it('starts a new segment after a missing ankle instead of bridging the dropout', () => {
    const value = overlay('mediapipe33', [0, .1, .2, .3]); value.frames[1].points[27] = null;
    expect(footTrail(value, .3, 27)).toEqual(value.frames.slice(2).map(frame => frame.points[27]));
    expect(footTrail(value, .1, 27)).toEqual([]);
  });

  it('starts a new segment after a large time gap even when both joints are present', () => {
    const value = overlay('mediapipe33', [0, .29, .32]);
    expect(footTrail(value, .32, 27)).toEqual(value.frames.slice(1).map(frame => frame.points[27]));
  });

  it('does not draw an earlier segment when the latest joint is unavailable', () => {
    const value = overlay(); value.frames[2].points[27] = null;
    expect(footTrail(value, .2, 27)).toEqual([]);
    expect(footTrail(value, 2, 27)).toEqual([]);
    expect(footTrail(value, .2, 28)).toEqual(value.frames.map(frame => frame.points[28]));
  });

  it('hides a stale trail when no recent recorded frame supports it', () => {
    const value = overlay();
    expect(footTrail(value, .29, 27)).toEqual([]);
    expect(footTrail(value, NaN, 27)).toEqual([]);
  });
});
