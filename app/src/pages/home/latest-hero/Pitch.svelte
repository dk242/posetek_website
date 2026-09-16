<script lang="ts">
  import { Canvas } from '@threlte/core';
  import Scene from './Scene.svelte';
  import type { Writable } from 'svelte/store';
  import type { PitchView, Point3 } from './pose-model';
  let { view, onReady, onFailure, onInteract, onInteractionEnd, onAngle }: { view: Writable<PitchView>; onReady: () => void; onFailure: () => void; onInteract: () => void; onInteractionEnd: () => void; onAngle: (angle: number, position: Point3, target: Point3) => void } = $props();
</script>

<svelte:boundary onerror={() => onFailure()}>
  <Canvas dpr={[1, 1.75]} shadows={false} renderMode="on-demand">
    <Scene {view} {onReady} {onInteract} {onInteractionEnd} {onAngle} />
  </Canvas>
  {#snippet failed()}<span></span>{/snippet}
</svelte:boundary>
