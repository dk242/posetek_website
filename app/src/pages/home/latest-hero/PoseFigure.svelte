<script lang="ts">
  import { T } from '@threlte/core';
  import { onDestroy, untrack } from 'svelte';
  import { DoubleSide } from 'three';
  import { heroPose, type HeroPoseId, type HeroLayer } from './pose-model';
  import { createBall } from '../pitch/ball';
  import PoseRig from './PoseRig.svelte';
  let { id, opacity = 1, layer = 'body' }: { id: HeroPoseId; opacity?: number; layer?: HeroLayer } = $props();
  const pose = untrack(() => heroPose(id));
  const ball = pose.ball ? createBall() : null;
  const shadow: [number, number, number] = [(pose.points[23][0] + pose.points[24][0]) / 2, .003, (pose.points[23][2] + pose.points[24][2]) / 2];
  const shadowUniforms = { strength: { value: 0 } };
  const shadowVertex = `varying vec2 shadowUv; void main() { shadowUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const shadowFragment = `
    varying vec2 shadowUv;
    uniform float strength;
    void main() {
      float distanceFromCenter = length((shadowUv - 0.5) * 2.0);
      float softness = exp(-distanceFromCenter * distanceFromCenter * 5.5);
      float edge = 1.0 - smoothstep(0.7, 1.0, distanceFromCenter);
      gl_FragColor = vec4(0.006, 0.018, 0.012, softness * edge * strength);
      #include <colorspace_fragment>
    }
  `;
  $effect(() => { shadowUniforms.strength.value = opacity * (id === 'jump' ? .33 : .7); });
  onDestroy(() => { ball?.hexagons.dispose(); ball?.pentagons.dispose(); ball?.edges.dispose(); });
</script>

<PoseRig points={pose.points} {opacity} {layer} />
{#if pose.ball && ball}
  <T.Group position={[...pose.ball.position]} scale={pose.ball.radius / 1.47}>
    <T.Mesh geometry={ball.hexagons}><T.MeshStandardMaterial color="#d9e4bf" roughness={.7} side={DoubleSide} transparent {opacity} /></T.Mesh>
    <T.Mesh geometry={ball.pentagons}><T.MeshStandardMaterial color="#11261a" roughness={.7} side={DoubleSide} transparent {opacity} /></T.Mesh>
    <T.LineSegments geometry={ball.edges}><T.LineBasicMaterial color="#829a68" transparent opacity={opacity * .35} /></T.LineSegments>
  </T.Group>
{/if}
<T.Mesh position={shadow} rotation.x={-Math.PI / 2} scale={id === 'jump' ? [1.08,.73,1] : [.88,.56,1]} renderOrder={-1}>
  <T.PlaneGeometry args={[2,2]} />
  <T.ShaderMaterial uniforms={shadowUniforms} vertexShader={shadowVertex} fragmentShader={shadowFragment} transparent depthWrite={false} />
</T.Mesh>
