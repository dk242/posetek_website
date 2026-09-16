<script lang="ts">
  import { T, useThrelte } from '@threlte/core';
  import { OrbitControls } from '@threlte/extras';
  import { onMount, untrack } from 'svelte';
  import { Spherical, Vector3 } from 'three';
  import type { OrbitControls as Controls } from 'three/addons/controls/OrbitControls.js';
  import { get, type Writable } from 'svelte/store';
  import { HERO_FADE_MS, type HeroPoseId, type PitchView, type Point3 } from './pose-model';
  import PoseFigure from './PoseFigure.svelte';
  import AthleteStage from './AthleteStage.svelte';
  import { STAGE_TARGET, STAGE_FOV, stageCameraPosition } from './stage-camera';
  let { view, onReady, onInteract, onInteractionEnd, onAngle }: { view: Writable<PitchView>; onReady: () => void; onInteract: () => void; onInteractionEnd: () => void; onAngle: (angle: number, position: Point3, target: Point3) => void } = $props();
  const { invalidate } = useThrelte();
  const initialView = untrack(() => get(view));
  const initialPosition: [number, number, number] = initialView.camera ? [...initialView.camera.position] : stageCameraPosition('reset');
  const initialTarget: [number, number, number] = [...(initialView.camera?.target ?? STAGE_TARGET)];
  let current = $state<HeroPoseId>(initialView.pose);
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
  // Incoming commands describe already-applied interactions. Replay only a new
  // command; the saved camera restores the result of every prior drag and key.
  let lastCommand = initialView.command;
  function changed() {
    if (!controls) return;
    const { x, y, z } = controls.object.position;
    const { x: tx, y: ty, z: tz } = controls.target;
    onAngle(controls.getAzimuthalAngle(), [x, y, z], [tx, ty, tz]);
  }
  function interactionEnded() { changed(); onInteractionEnd(); }
  $effect(() => {
    const { command, action } = $view;
    if (!controls || command === lastCommand) return;
    lastCommand = command;
    if (action === 'reset' || action === 'front' || action === 'side') {
      controls.target.set(...STAGE_TARGET);
      controls.object.position.set(...stageCameraPosition(action));
    } else {
      const offset = controls.object.position.clone().sub(controls.target);
      const orbit = new Spherical().setFromVector3(offset);
      if (action === 'left') orbit.theta -= Math.PI / 8;
      if (action === 'right') orbit.theta += Math.PI / 8;
      if (action === 'up') orbit.phi = Math.max(.75, orbit.phi - .15);
      if (action === 'down') orbit.phi = Math.min(1.55, orbit.phi + .15);
      controls.object.position.copy(new Vector3().setFromSpherical(orbit).add(controls.target));
    }
    controls.update(); invalidate();
  });
  onMount(() => {
    // A pose can be selected before the lazy scene loads with rotation paused.
    // Aim at the configured target without relying on the first auto-rotate tick.
    const id = requestAnimationFrame(() => { controls?.update(); changed(); invalidate(); onReady(); });
    return () => cancelAnimationFrame(id);
  });

</script>

<T.PerspectiveCamera makeDefault position={initialPosition} fov={STAGE_FOV}>
  <OrbitControls bind:ref={controls} target={initialTarget} autoRotate={$view.rotating} autoRotateSpeed={.42}
    enableDamping={false} enableZoom={false} enablePan={false} rotateSpeed={.65}
    minPolarAngle={.75} maxPolarAngle={1.55} onstart={onInteract} onend={interactionEnded} onchange={changed} />
</T.PerspectiveCamera>
<T.HemisphereLight args={['#e8f6e7', '#244135', 1.3]} />
<T.DirectionalLight position={[-3,5,4]} intensity={2.6} color="#f0ffde" />
<T.DirectionalLight position={[3,2,-3]} intensity={2.1} color="#a6e4d8" />
<T.DirectionalLight position={[4,1,3]} intensity={.5} color="#b3cebf" />
{#each (previous ? [previous, current] : [current]) as poseId (poseId)}
  <PoseFigure id={poseId} opacity={poseId === current ? blend : 1 - blend} layer={$view.layer} />
{/each}
<AthleteStage />
