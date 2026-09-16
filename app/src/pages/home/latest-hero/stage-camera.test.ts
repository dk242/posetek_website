import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { HERO_POSES } from './pose-model';
import { STAGE_FOV, STAGE_TARGET, stageCameraPosition } from './stage-camera';

describe('athlete stage framing', () => {
  it('keeps every recorded landmark and the ball inside the mobile and desktop presets', () => {
    for (const aspect of [.9, 1.2, 2]) {
      for (const preset of ['reset', 'front', 'side'] as const) {
        const camera = new PerspectiveCamera(STAGE_FOV, aspect, .1, 100);
        camera.position.set(...stageCameraPosition(preset));
        camera.lookAt(...STAGE_TARGET);
        camera.updateMatrixWorld();
        for (const pose of HERO_POSES) {
          const positions = [...pose.points, ...(pose.ball ? [pose.ball.position] : [])];
          for (const position of positions) {
            // Extra silhouette room beyond the tracker, including the top of the head.
            for (const yOffset of [-.12, .12]) {
              const projected = new Vector3(...position).add(new Vector3(0, yOffset, 0)).project(camera);
              expect(Math.abs(projected.x), `${pose.id}/${preset}/${aspect} x`).toBeLessThan(.9);
              expect(Math.abs(projected.y), `${pose.id}/${preset}/${aspect} y`).toBeLessThan(.95);
              expect(projected.z).toBeGreaterThan(-1);
              expect(projected.z).toBeLessThan(1);
            }
          }
        }
      }
    }
  });
});
