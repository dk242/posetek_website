<script lang="ts">
  import { T, useThrelte } from '@threlte/core';
  import { OrbitControls } from '@threlte/extras';
  import { onMount, onDestroy } from 'svelte';
  import { DoubleSide, Spherical, Vector3 } from 'three';
  import type { OrbitControls as Controls } from 'three/addons/controls/OrbitControls.js';
  import type { Writable } from 'svelte/store';
  import type { PitchView } from './pose-model';
  import { createBall } from './ball';
  import PoseRig from './PoseRig.svelte';
  let { view, onReady, onInteract, onAngle }: { view: Writable<PitchView>; onReady: () => void; onInteract: () => void; onAngle: (angle: number) => void } = $props();
  const { invalidate } = useThrelte();
  const ball = createBall();
  let controls = $state<Controls>();
  let lastCommand = 0;
  let lastNotice = 0;
  function changed() {
    const now = performance.now();
    if (controls && now - lastNotice > 200) { onAngle(controls.getAzimuthalAngle()); lastNotice = now; }
  }
  $effect(() => {
    const { command, action } = $view;
    if (!controls || command === lastCommand) return;
    lastCommand = command;
    if (action === 'reset') {
      controls.target.set(0,1,.2); controls.object.position.set(2.5,2.05,3.6);
    } else {
      const offset = controls.object.position.clone().sub(controls.target);
      const orbit = new Spherical().setFromVector3(offset);
      if (action === 'left') orbit.theta -= Math.PI / 8;
      if (action === 'right') orbit.theta += Math.PI / 8;
      if (action === 'up') orbit.phi = Math.max(.45, orbit.phi - .15);
      if (action === 'down') orbit.phi = Math.min(1.55, orbit.phi + .15);
      controls.object.position.copy(new Vector3().setFromSpherical(orbit).add(controls.target));
    }
    controls.update(); invalidate();
  });
  onMount(() => { const id = requestAnimationFrame(onReady); return () => cancelAnimationFrame(id); });
  onDestroy(() => { ball.hexagons.dispose(); ball.pentagons.dispose(); ball.edges.dispose(); });
</script>

<T.PerspectiveCamera makeDefault position={[2.5,2.05,3.6]} fov={34}>
  <OrbitControls bind:ref={controls} target={[0,1,.2]} autoRotate={$view.rotating} autoRotateSpeed={.65}
    enableDamping={false} enableZoom={false} enablePan={false} rotateSpeed={.65}
    minPolarAngle={.45} maxPolarAngle={1.55} onstart={onInteract} onchange={changed} />
</T.PerspectiveCamera>
<T.AmbientLight intensity={2.5} />
<T.DirectionalLight position={[3,6,4]} intensity={4} color="#dbffac" />
<PoseRig />
<T.Group position={[.64,.20,1.19]} scale={.137}>
  <T.Mesh geometry={ball.hexagons}><T.MeshStandardMaterial color="#b9d58a" roughness={.65} side={DoubleSide} /></T.Mesh>
  <T.Mesh geometry={ball.pentagons}><T.MeshStandardMaterial color="#11261a" roughness={.7} side={DoubleSide} /></T.Mesh>
  <T.LineSegments geometry={ball.edges}><T.LineBasicMaterial color="#b7f34a" transparent opacity={.6} /></T.LineSegments>
</T.Group>
<T.GridHelper args={[6,24,'#3d6444','#153c2c']} />
<T.Mesh rotation.x={-Math.PI / 2} position.y={.005}><T.RingGeometry args={[1.39,1.4,96]} /><T.MeshBasicMaterial color="#77a551" transparent opacity={.5} side={DoubleSide} /></T.Mesh>
