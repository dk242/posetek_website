<script lang="ts">
  import { T } from '@threlte/core';
  import { onDestroy } from 'svelte';
  import { Color, Float32BufferAttribute, CylinderGeometry, Matrix4, SphereGeometry, MeshStandardMaterial, InstancedMesh, Vector3, Quaternion } from 'three';
  import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
  import { POSE_EDGES, SHOOTING_POSE } from './pose-model';
  const tubes = POSE_EDGES.map(([a,b]) => {
    const start = new Vector3(...SHOOTING_POSE[a]), end = new Vector3(...SHOOTING_POSE[b]);
    const direction = end.clone().sub(start);
    const radius = a < 11 ? .0035 : .009;
    const tube = new CylinderGeometry(radius,radius,direction.length(),8);
    const color = new Color(a > 10 && b > 10 && a % 2 === b % 2 ? a % 2 ? '#c4f96b' : '#82cdbc' : '#afdfc5');
    const colors = new Float32Array(tube.getAttribute('position').count * 3);
    for (let index = 0; index < colors.length; index += 3) color.toArray(colors, index);
    tube.setAttribute('color', new Float32BufferAttribute(colors, 3));
    tube.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),direction.normalize()));
    tube.translate(...start.add(end).multiplyScalar(.5).toArray());
    return tube;
  });
  const bones = mergeGeometries(tubes)!;
  tubes.forEach(tube=>tube.dispose());
  const pointGeometry = new SphereGeometry(1, 14, 10);
  const pointMaterial = new MeshStandardMaterial({ color: '#ffffff', roughness: .42, metalness: .12 });
  function placePoints(mesh: InstancedMesh) {
    const matrix = new Matrix4();
    SHOOTING_POSE.forEach(([x,y,z], index) => {
      const radius = index < 11 ? .01 : index > 16 && index < 23 ? .015 : .024;
      matrix.makeScale(radius,radius,radius).setPosition(x,y,z);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, new Color(index > 10 && index % 2 === 0 ? '#9be8d4' : '#d2ff70'));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  onDestroy(() => { bones.dispose(); pointGeometry.dispose(); pointMaterial.dispose(); });
</script>

<T.Mesh geometry={bones}><T.MeshStandardMaterial vertexColors roughness={.52} metalness={.1} /></T.Mesh>
<T.InstancedMesh args={[pointGeometry, pointMaterial, 33]} oncreate={placePoints} />
