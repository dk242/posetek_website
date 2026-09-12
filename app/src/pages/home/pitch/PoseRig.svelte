<script lang="ts">
  import { T } from '@threlte/core';
  import { onDestroy } from 'svelte';
  import { CylinderGeometry, Matrix4, SphereGeometry, MeshBasicMaterial, InstancedMesh, Vector3, Quaternion } from 'three';
  import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
  import { POSE_EDGES, STRIKE_POSE } from './pose-model';
  const tubes = POSE_EDGES.map(([a,b]) => {
    const start = new Vector3(...STRIKE_POSE[a]), end = new Vector3(...STRIKE_POSE[b]);
    const direction = end.clone().sub(start);
    const tube = new CylinderGeometry(.006,.006,direction.length(),6);
    tube.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),direction.normalize()));
    tube.translate(...start.add(end).multiplyScalar(.5).toArray());
    return tube;
  });
  const bones = mergeGeometries(tubes)!;
  tubes.forEach(tube=>tube.dispose());
  const pointGeometry = new SphereGeometry(.022, 10, 8);
  const pointMaterial = new MeshBasicMaterial({ color: '#d2ff70' });
  function placePoints(mesh: InstancedMesh) {
    const matrix = new Matrix4();
    STRIKE_POSE.forEach(([x,y,z], index) => { matrix.makeTranslation(x,y,z); mesh.setMatrixAt(index, matrix); });
    mesh.instanceMatrix.needsUpdate = true;
  }
  onDestroy(() => { bones.dispose(); pointGeometry.dispose(); pointMaterial.dispose(); });
</script>

<T.Mesh geometry={bones}><T.MeshBasicMaterial color="#a3eada" transparent opacity={.8} /></T.Mesh>
<T.InstancedMesh args={[pointGeometry, pointMaterial, 33]} oncreate={placePoints} />
<T.Mesh position={[0,1.95,.025]} scale={[.13,.17,.12]}><T.SphereGeometry args={[1,14,8]} /><T.MeshBasicMaterial color="#a3eada" transparent opacity={.13} wireframe /></T.Mesh>
<T.Mesh position={[0,1.79,0]}><T.CylinderGeometry args={[.006,.006,.16,6]}/><T.MeshBasicMaterial color="#a3eada" transparent opacity={.45}/></T.Mesh>
