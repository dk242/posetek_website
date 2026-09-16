<script lang="ts">
  import { T, useThrelte } from '@threlte/core';
  import { OrbitControls } from '@threlte/extras';
  import { onMount, untrack } from 'svelte';
  import { DoubleSide, Spherical, Vector3 } from 'three';
  import type { OrbitControls as Controls } from 'three/addons/controls/OrbitControls.js';
  import { get, type Writable } from 'svelte/store';
  import { HERO_FADE_MS, type HeroPoseId, type PitchView } from './pose-model';
  import PoseFigure from './PoseFigure.svelte';
  let { view, onReady, onInteract, onInteractionEnd, onAngle }: { view: Writable<PitchView>; onReady: () => void; onInteract: () => void; onInteractionEnd: () => void; onAngle: (angle: number) => void } = $props();
  const { invalidate } = useThrelte();
  let current = $state<HeroPoseId>(untrack(() => get(view).pose));
  const selectedPose = $derived($view.pose);
  const reducedMotion = $derived($view.reducedMotion);
  let previous = $state<HeroPoseId | null>(null);
  let blend = $state(1);
  $effect(() => {
    const next = selectedPose;
    const immediate = reducedMotion;
    return untrack(() => {
      if (next === current) { previous = null; blend = 1; invalidate(); return; }
      previous = immediate ? null : current;
      current = next;
      blend = immediate ? 1 : 0;
      invalidate();
      if (immediate) return;
      const start = performance.now();
      let frame = 0;
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / HERO_FADE_MS);
        blend = progress * progress * (3 - 2 * progress);
        if (progress === 1) previous = null;
        else frame = requestAnimationFrame(tick);
        invalidate();
      };
      frame = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frame);
    });
  });
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
      controls.target.set(0,1.35,.05); controls.object.position.set(2.8,2.25,4.85);
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
  onMount(() => {
    // A pose can be selected before the lazy scene loads with rotation paused.
    // Aim at the configured target without relying on the first auto-rotate tick.
    const id = requestAnimationFrame(() => { controls?.update(); invalidate(); onReady(); });
    return () => cancelAnimationFrame(id);
  });

</script>

<T.PerspectiveCamera makeDefault position={[2.8,2.25,4.85]} fov={34}>
  <OrbitControls bind:ref={controls} target={[0,1.35,.05]} autoRotate={$view.rotating} autoRotateSpeed={.65}
    enableDamping={false} enableZoom={false} enablePan={false} rotateSpeed={.65}
    minPolarAngle={.45} maxPolarAngle={1.55} onstart={onInteract} onend={onInteractionEnd} onchange={changed} />
</T.PerspectiveCamera>
<T.AmbientLight intensity={.85} />
<T.DirectionalLight position={[3,6,4]} intensity={3.2} color="#e5ffc0" />
<T.DirectionalLight position={[-4,2,-3]} intensity={2.1} color="#78e0d1" />
{#each (previous ? [previous, current] : [current]) as poseId (poseId)}
  <PoseFigure id={poseId} opacity={poseId === current ? blend : 1 - blend} />
{/each}
<T.GridHelper args={[6,24,'#3d6444','#153c2c']} />
<T.Mesh rotation.x={-Math.PI / 2} position.y={.005}><T.RingGeometry args={[1.39,1.4,96]} /><T.MeshBasicMaterial color="#77a551" transparent opacity={.5} side={DoubleSide} /></T.Mesh>
