import { BufferGeometry, Float32BufferAttribute, IcosahedronGeometry, Vector3 } from "three";

/** Truncate each icosahedron edge at one third: 12 pentagons + 20 hexagons. */
export function createBall() {
  const source = new IcosahedronGeometry(1, 0);
  const positions = source.getAttribute("position");
  const vertices: Vector3[] = [];
  const faces: number[][] = [];
  const indexOf = (v: Vector3) => {
    let index = vertices.findIndex(p => p.distanceToSquared(v) < 1e-8);
    if (index < 0) { index = vertices.length; vertices.push(v); }
    return index;
  };
  for (let i = 0; i < positions.count; i += 3) faces.push([0, 1, 2].map(j => indexOf(new Vector3().fromBufferAttribute(positions, i + j))));
  source.dispose();
  const neighbors = vertices.map(() => new Set<number>());
  for (const [a, b, c] of faces) { neighbors[a].add(b).add(c); neighbors[b].add(a).add(c); neighbors[c].add(a).add(b); }
  const point = (a: number, b: number) => vertices[a].clone().multiplyScalar(2).add(vertices[b]).divideScalar(3).normalize().multiplyScalar(1.47);
  const hexagons = faces.map(([a, b, c]) => [point(a, b), point(b, a), point(b, c), point(c, b), point(c, a), point(a, c)]);
  const pentagons = vertices.map((v, i) => {
    const pts = [...neighbors[i]].map(n => point(i, n));
    const center = pts.reduce((a, p) => a.add(p), new Vector3()).divideScalar(pts.length);
    const u = pts[0].clone().sub(center).normalize();
    const w = v.clone().normalize().cross(u);
    return pts.sort((a, b) => Math.atan2(a.clone().sub(center).dot(w), a.clone().sub(center).dot(u)) - Math.atan2(b.clone().sub(center).dot(w), b.clone().sub(center).dot(u)));
  });
  const geometry = (polygons: Vector3[][]) => {
    const values: number[] = [];
    for (const pts of polygons) {
      for (let i = 1; i < pts.length - 1; i++) values.push(...pts[0].toArray(), ...pts[i].toArray(), ...pts[i + 1].toArray());
    }
    const result = new BufferGeometry();
    result.setAttribute("position", new Float32BufferAttribute(values, 3));
    result.computeVertexNormals();
    return result;
  };
  const lines: number[] = [];
  for (const polygon of [...hexagons, ...pentagons]) polygon.forEach((p, i) => lines.push(...p.toArray(), ...polygon[(i + 1) % polygon.length].toArray()));
  const edges = new BufferGeometry();
  edges.setAttribute("position", new Float32BufferAttribute(lines, 3));
  return { hexagons: geometry(hexagons), pentagons: geometry(pentagons), edges };
}
