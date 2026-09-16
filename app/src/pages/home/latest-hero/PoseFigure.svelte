<script lang="ts">
  import { T } from '@threlte/core';
  import { onDestroy, untrack } from 'svelte';
  import { DoubleSide } from 'three';
  import { heroPose, type HeroPoseId } from './pose-model';
  import { createBall } from '../pitch/ball';
  import PoseRig from './PoseRig.svelte';
  let { id, opacity = 1 }: { id: HeroPoseId; opacity?: number } = $props();
  const pose = untrack(() => heroPose(id));
  const ball = pose.ball ? createBall() : null;
  const shadow: [number, number, number] = [(pose.points[23][0] + pose.points[24][0]) / 2, .003, (pose.points[23][2] + pose.points[24][2]) / 2];
  onDestroy(() => { ball?.hexagons.dispose(); ball?.pentagons.dispose(); ball?.edges.dispose(); });
</script>

<PoseRig points={pose.points} {opacity} />
{#if pose.ball && ball}
  <T.Group position={[...pose.ball.position]} scale={pose.ball.radius / 1.47}>
    <T.Mesh geometry={ball.hexagons}><T.MeshStandardMaterial color="#b9d58a" roughness={.65} side={DoubleSide} transparent {opacity} /></T.Mesh>
    <T.Mesh geometry={ball.pentagons}><T.MeshStandardMaterial color="#11261a" roughness={.7} side={DoubleSide} transparent {opacity} /></T.Mesh>
    <T.LineSegments geometry={ball.edges}><T.LineBasicMaterial color="#b7f34a" transparent opacity={opacity * .6} /></T.LineSegments>
  </T.Group>
{/if}
<T.Mesh position={shadow} rotation.x={-Math.PI / 2} scale={[.3,.22,1]}>
  <T.CircleGeometry args={[1,32]} />
  <T.MeshBasicMaterial color="#020c07" transparent opacity={opacity * (id === 'jump' ? .22 : .48)} depthWrite={false} />
</T.Mesh>
