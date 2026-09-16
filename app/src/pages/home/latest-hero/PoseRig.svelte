<script lang="ts">
  import { T } from '@threlte/core';
  import { onDestroy, untrack } from 'svelte';
  import { Color, Float32BufferAttribute, CylinderGeometry, Matrix4, SphereGeometry, MeshBasicMaterial, InstancedMesh, Vector3, Quaternion } from 'three';
  import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
  import { POSE_EDGES, type Point3, type HeroLayer } from './pose-model';
  import { createAthleteBody } from './body-geometry';
  let { points, opacity = 1, layer = 'body' }: { points: readonly Point3[]; opacity?: number; layer?: HeroLayer } = $props();
  // Each keyed figure owns immutable geometry; changing the view only changes materials.
  const body = untrack(() => createAthleteBody(points));
  const tubes = POSE_EDGES.filter(([a, b]) => a >= 11 && b >= 11).map(([a,b]) => {
    const start = new Vector3(...points[a]), end = new Vector3(...points[b]);
    const direction = end.clone().sub(start);
    const hand = a >= 15 && a <= 22 && b >= 15 && b <= 22;
    const radius = hand ? .002 : .003;
    const tube = new CylinderGeometry(radius, radius, direction.length(), 8);
    const color = new Color(a % 2 === b % 2 ? a % 2 ? '#d8fba2' : '#c1f5e5' : '#ecf6d9');
    const colors = new Float32Array(tube.getAttribute('position').count * 3);
    for (let index = 0; index < colors.length; index += 3) color.toArray(colors, index);
    tube.setAttribute('color', new Float32BufferAttribute(colors, 3));
    tube.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,1,0), direction.normalize()));
    tube.translate(...start.add(end).multiplyScalar(.5).toArray());
    return tube;
  });
  const bones = mergeGeometries(tubes)!;
  tubes.forEach(tube => tube.dispose());
  const pointGeometry = new SphereGeometry(1, 12, 8);
  const pointMaterial = new MeshBasicMaterial({ color: '#ffffff', transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  function placePoints(mesh: InstancedMesh) {
    const matrix = new Matrix4();
    points.forEach(([x,y,z], index) => {
      const radius = index < 11 ? .0025 : index > 16 && index < 23 ? .005 : .009;
      matrix.makeScale(radius, radius, radius).setPosition(x,y,z);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, new Color(index > 10 && index % 2 === 0 ? '#c1f5e5' : '#ddffac'));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  $effect(() => { pointMaterial.opacity = opacity; });
  onDestroy(() => { bones.dispose(); pointGeometry.dispose(); pointMaterial.dispose(); body.dispose(); });
</script>

<T.Mesh geometry={body} visible={layer === 'body'} renderOrder={1}>
  <T.MeshStandardMaterial color="#b8d3c2" transparent opacity={opacity * .97} roughness={.62} metalness={.02} depthWrite={opacity > .99} />
</T.Mesh>
<T.Mesh geometry={bones} renderOrder={3}>
  <T.MeshBasicMaterial vertexColors transparent {opacity} depthTest={false} depthWrite={false} toneMapped={false} />
</T.Mesh>
<T.InstancedMesh args={[pointGeometry, pointMaterial, 33]} renderOrder={4} oncreate={placePoints} />
