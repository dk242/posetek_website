<script lang="ts">
  import { Canvas } from '@threlte/core';
  import Scene from './Scene.svelte';
  import type { Writable } from 'svelte/store';
  import type { PitchView } from './pose-model';
  let { view, onReady, onFailure, onInteract, onAngle }: { view: Writable<PitchView>; onReady: () => void; onFailure: () => void; onInteract: () => void; onAngle: (angle: number) => void } = $props();
</script>

<svelte:boundary onerror={() => onFailure()}>
  <Canvas dpr={1.5} shadows={false} renderMode="on-demand">
    <Scene {view} {onReady} {onInteract} {onAngle} />
  </Canvas>
  {#snippet failed()}<span></span>{/snippet}
</svelte:boundary>
