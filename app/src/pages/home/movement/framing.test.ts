import { describe, expect, it } from 'vitest';
import data from './recorded-movement.json';
import { fitRecording, recordingBounds } from './framing';

describe('whole-recording camera fit', () => {
  for (const sequence of data.sequences) {
    it(`contains every ${sequence.key} frame and marker without stretching`, () => {
      const aspect = sequence.sourceAspectRatio ?? data.sourceAspectRatio;
      const bounds = recordingBounds(sequence, aspect);
      for (const [width,height] of [[256,240],[326,260],[720,365]]) {
        const view = fitRecording(width,height,2,bounds);
        const points = [...sequence.frames.flat(), ...(sequence.calibration?.markers.flatMap(m => m.corners) ?? [])];
        for (const p of points) {
          const x = p[0]*aspect*view.scale+view.offsetX, y=p[1]*view.scale+view.offsetY;
          expect(x).toBeGreaterThanOrEqual(21.99); expect(x).toBeLessThanOrEqual(width-21.99);
          expect(y).toBeGreaterThanOrEqual(37.99); expect(y).toBeLessThanOrEqual(height-37.99);
        }
        // Equal distances in source-image units remain equal on the canvas.
        expect((1/aspect)*aspect*view.scale).toBeCloseTo(view.scale,10);
      }
    });
  }
  it('handles an empty recording without invalid camera values', () => {
    expect(Object.values(fitRecording(320,240,1,recordingBounds({frames:[]},16/9))).every(Number.isFinite)).toBe(true);
  });
});
