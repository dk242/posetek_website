<script lang="ts">
  import { T } from '@threlte/core';
  import { Color, DoubleSide } from 'three';
  // A finite stage with a feathered edge; no image request or frame loop.
  const uniforms = {
    baseColor: { value: new Color('#3a6654') },
    lineColor: { value: new Color('#87ae94') },
  };
  const vertexShader = `
    varying vec2 stageUv;
    void main() {
      stageUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const fragmentShader = `
    varying vec2 stageUv;
    uniform vec3 baseColor;
    uniform vec3 lineColor;
    void main() {
      vec2 p = (stageUv - 0.5) * 2.0;
      float radius = length(p);
      float falloff = 1.0 - smoothstep(0.18, 1.0, radius);
      float ring = 1.0 - smoothstep(0.001, 0.005, abs(radius - 0.62));
      float center = 1.0 - smoothstep(0.001, 0.004, abs(radius - 0.11));
      float detail = ring * 0.2 + center * 0.07;
      vec3 color = mix(baseColor, lineColor, min(1.0, detail * 4.0));
      gl_FragColor = vec4(color, falloff * 0.19 + detail);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;
</script>

<T.Mesh rotation.x={-Math.PI / 2} position.y={-.012} renderOrder={-2}>
  <T.PlaneGeometry args={[4.7, 4.7]} />
  <T.ShaderMaterial {uniforms} {vertexShader} {fragmentShader} transparent depthWrite={false} side={DoubleSide} />
</T.Mesh>
