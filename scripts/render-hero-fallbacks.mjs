/**
 * Offline, deterministic snapshots of the actual hero mesh, recorded landmarks,
 * ball geometry and reset camera. No browser, network, GPU, new dependency or
 * private source recording is required. Run after npm --prefix app ci:
 *   node scripts/render-hero-fallbacks.mjs
 *   node scripts/render-hero-fallbacks.mjs --check
 *
 * This small CPU rasterizer uses a depth buffer, interpolated surface normals,
 * local studio lighting and 2x antialiasing. Lighting approximates the WebGL
 * material; anatomy and projection use exactly the runtime source geometry.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appRequire = createRequire(resolve(root, 'app/package.json'));
const ts = appRequire('typescript');
const THREE = await import(pathToFileURL(resolve(dirname(appRequire.resolve('three')), 'three.module.js')).href);
const { Color, Matrix4, PerspectiveCamera, Vector3 } = THREE;
const sourceDirectory = 'app/src/pages/home/latest-hero';
const outputDirectory = resolve(root, sourceDirectory, 'fallback');
const width = 1000, height = 400, supersampling = 2;
const pixelWidth = width * supersampling, pixelHeight = height * supersampling;
const sourceDependencies = new Set();
const modules = new Map();

function loadTypeScript(relativePath) {
  const filename = resolve(root, relativePath);
  if (modules.has(filename)) return modules.get(filename).exports;
  sourceDependencies.add(relative(root, filename).replaceAll('\\', '/'));
  const source = readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
  const module = { exports: {} };
  modules.set(filename, module);
  const localRequire = createRequire(filename);
  const requireSource = request => {
    if (request === 'three') return THREE;
    if (request.startsWith('.')) {
      const path = resolve(dirname(filename), request);
      if (existsSync(`${path}.ts`)) return loadTypeScript(relative(root, `${path}.ts`));
      if (request.endsWith('.ts')) return loadTypeScript(relative(root, path));
      if (request.endsWith('.json')) sourceDependencies.add(relative(root, path).replaceAll('\\', '/'));
    }
    return localRequire(request);
  };
  // Compile only these known local source modules, resolving their existing app dependencies.
  new Function('require', 'module', 'exports', outputText)(requireSource, module, module.exports);
  return module.exports;
}
const { createAthleteBody } = loadTypeScript(`${sourceDirectory}/body-geometry.ts`);
const { HERO_POSES } = loadTypeScript(`${sourceDirectory}/pose-model.ts`);
const { STAGE_FOV, STAGE_TARGET, stageCameraPosition } = loadTypeScript(`${sourceDirectory}/stage-camera.ts`);
const { createBall } = loadTypeScript('app/src/pages/home/pitch/ball.ts');
const camera = new PerspectiveCamera(STAGE_FOV, width / height, .1, 100);
camera.position.set(...stageCameraPosition('reset'));
camera.lookAt(...STAGE_TARGET);
camera.updateMatrixWorld();

const sourceFiles = [
  'scripts/render-hero-fallbacks.mjs',
  ...sourceDependencies,
  ...['Scene.svelte', 'PoseRig.svelte', 'PoseFigure.svelte', 'AthleteStage.svelte'].map(name => `${sourceDirectory}/${name}`),
].sort();
const sourceHashes = Object.fromEntries(sourceFiles.map(path => [path, createHash('sha256').update(readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n')).digest('hex')]));
const manifestPath = resolve(outputDirectory, 'manifest.json');
if (process.argv.includes('--check')) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const stale = sourceFiles.filter(path => manifest.sourceSha256[path] !== sourceHashes[path]);
  for (const asset of manifest.assets) {
    const bytes = readFileSync(resolve(outputDirectory, asset.file));
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) stale.push(asset.file);
  }
  if (stale.length) throw new Error(`Hero fallback snapshots are stale; regenerate them. Changed: ${stale.join(', ')}`);
  console.log('Hero fallback source and asset hashes match.');
  process.exit(0);
}

function project(position) {
  const p = new Vector3(...position).project(camera);
  const cameraSpace = new Vector3(...position).applyMatrix4(camera.matrixWorldInverse);
  return [(p.x + 1) * pixelWidth / 2, (1 - p.y) * pixelHeight / 2, p.z, -1 / cameraSpace.z];
}
const lights = [
  { direction: new Vector3(-3, 5, 4).normalize(), color: new Color('#f0ffde'), intensity: 2.6 },
  { direction: new Vector3(3, 2, -3).normalize(), color: new Color('#a6e4d8'), intensity: 2.1 },
  { direction: new Vector3(4, 1, 3).normalize(), color: new Color('#b3cebf'), intensity: .5 },
];
const cameraDirection = camera.position.clone().sub(new Vector3(...STAGE_TARGET)).normalize();
function lighting(normal, base) {
  const n = new Vector3(...normal).normalize();
  const hemi = .22 + .18 * (n.y * .5 + .5);
  const illumination = [hemi * .88, hemi, hemi * .91];
  let highlight = 0;
  for (const light of lights) {
    const diffuse = Math.max(0, n.dot(light.direction)) * light.intensity / Math.PI;
    illumination[0] += light.color.r * diffuse;
    illumination[1] += light.color.g * diffuse;
    illumination[2] += light.color.b * diffuse;
    const halfway = light.direction.clone().add(cameraDirection).normalize();
    highlight += Math.pow(Math.max(0, n.dot(halfway)), 22) * light.intensity * .027;
  }
  return [base.r, base.g, base.b].map((value, channel) => {
    const linear = value * illumination[channel] + highlight;
    // Soft rolloff keeps the pearl surface readable without flattened white highlights.
    const mapped = linear / (1 + linear * .45);
    return Math.min(1, mapped <= .0031308 ? mapped * 12.92 : 1.055 * mapped ** (1 / 2.4) - .055);
  });
}
const smoothstep = (low, high, value) => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

function renderPose(pose) {
  const rgba = new Float32Array(pixelWidth * pixelHeight * 4);
  const depth = new Float32Array(pixelWidth * pixelHeight).fill(Infinity);
  // Ground is a camera ray / plane intersection, matching the finite WebGL stage.
  const source = camera.position.clone(), ground = new Vector3();
  const hipsX = (pose.points[23][0] + pose.points[24][0]) / 2;
  const hipsZ = (pose.points[23][2] + pose.points[24][2]) / 2;
  for (let y = 0; y < pixelHeight; y++) {
    for (let x = 0; x < pixelWidth; x++) {
      ground.set((x + .5) / pixelWidth * 2 - 1, 1 - (y + .5) / pixelHeight * 2, .5).unproject(camera).sub(source).normalize();
      const distance = (-.012 - source.y) / ground.y;
      if (distance < 0) continue;
      ground.multiplyScalar(distance).add(source);
      const radius = Math.hypot(ground.x, ground.z) / 2.35;
      if (radius >= 1) continue;
      const falloff = 1 - smoothstep(.18, 1, radius);
      const ring = 1 - smoothstep(.001, .005, Math.abs(radius - .62));
      const center = 1 - smoothstep(.001, .004, Math.abs(radius - .11));
      const detail = ring * .2 + center * .07;
      // Keep unassociated RGB dark and fade it along with alpha. This avoids a
      // bright hard ellipse in previews that show transparent PNG RGB directly,
      // and gives the page a quiet floor without washing out the contact shadow.
      const alpha = falloff * .12 + detail * .25;
      const point = (y * pixelWidth + x) * 4;
      rgba[point] = .065 * falloff;
      rgba[point + 1] = .16 * falloff;
      rgba[point + 2] = .115 * falloff;
      rgba[point + 3] = alpha;
      const shadowRadius = Math.hypot((ground.x - hipsX) / (pose.id === 'jump' ? 1.08 : .88), (ground.z - hipsZ) / (pose.id === 'jump' ? .73 : .56));
      const shadowAlpha = Math.exp(-(shadowRadius ** 2) * 5.5) * (1 - smoothstep(.7, 1, shadowRadius)) * (pose.id === 'jump' ? .33 : .7);
      const combined = shadowAlpha + alpha * (1 - shadowAlpha);
      if (combined > 0) {
        for (let channel = 0; channel < 3; channel++) rgba[point + channel] = (.05 * shadowAlpha + rgba[point + channel] * alpha * (1 - shadowAlpha)) / combined;
        rgba[point + 3] = combined;
      }
    }
  }
  function rasterize(geometry, hex, transform = new Matrix4()) {
    const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal');
    const base = new Color(hex), position = new Vector3(), normal = new Vector3();
    const vertices = Array.from({ length: p.count }, (_, index) => {
      position.fromBufferAttribute(p, index).applyMatrix4(transform);
      normal.fromBufferAttribute(n, index).transformDirection(transform);
      return [...project(position.toArray()), ...lighting(normal.toArray(), base)];
    });
    const indices = geometry.index?.array ?? Array.from({ length: p.count }, (_, i) => i);
    for (let triangle = 0; triangle < indices.length; triangle += 3) {
      const a = vertices[indices[triangle]], b = vertices[indices[triangle + 1]], c = vertices[indices[triangle + 2]];
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (area >= -1e-8) continue;
      const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(pixelWidth - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(pixelHeight - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const px = x + .5, py = y + .5;
        const wa = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
        const wb = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
        const wc = 1 - wa - wb;
        if (wa < 0 || wb < 0 || wc < 0) continue;
        const z = wa * a[2] + wb * b[2] + wc * c[2], offset = y * pixelWidth + x;
        if (z >= depth[offset]) continue;
        depth[offset] = z;
        const inverseW = wa * a[3] + wb * b[3] + wc * c[3];
        for (let channel = 0; channel < 3; channel++) rgba[offset * 4 + channel] = (wa * a[3] * a[4 + channel] + wb * b[3] * b[4 + channel] + wc * c[3] * c[4 + channel]) / inverseW;
        rgba[offset * 4 + 3] = .97;
      }
    }
  }
  const body = createAthleteBody(pose.points);
  rasterize(body, '#b8d3c2');
  body.dispose();
  if (pose.ball) {
    const ball = createBall();
    const matrix = new Matrix4().makeScale(...Array(3).fill(pose.ball.radius / 1.47)).setPosition(...pose.ball.position);
    rasterize(ball.hexagons, '#d9e4bf', matrix);
    rasterize(ball.pentagons, '#11261a', matrix);
    ball.hexagons.dispose(); ball.pentagons.dispose(); ball.edges.dispose();
  }
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sums = [0, 0, 0, 0];
    for (let dy = 0; dy < supersampling; dy++) for (let dx = 0; dx < supersampling; dx++) {
      const input = ((y * supersampling + dy) * pixelWidth + x * supersampling + dx) * 4;
      const alpha = rgba[input + 3];
      for (let channel = 0; channel < 3; channel++) sums[channel] += rgba[input + channel] * alpha;
      sums[3] += alpha;
    }
    const output = (y * width + x) * 4;
    if (sums[3] > 0) {
      // Modest color quantization reduces transfer size, retaining alpha antialiasing.
      for (let channel = 0; channel < 3; channel++) pixels[output + channel] = Math.round(sums[channel] / sums[3] * 127) * 2;
      pixels[output + 3] = Math.round(sums[3] / supersampling ** 2 * 255);
    }
  }
  return pixels;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
function chunk(type, data) {
  const name = Buffer.from(type), body = Buffer.concat([name, data]);
  let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  const result = Buffer.alloc(body.length + 8);
  result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, body.length + 4);
  return result;
}
function png(pixels) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const start = y * (width * 4 + 1); rows[start] = 1; // Sub filter compresses empty space and shading well.
    for (let x = 0; x < width * 4; x++) rows[start + x + 1] = (pixels[y * width * 4 + x] - (x < 4 ? 0 : pixels[y * width * 4 + x - 4])) & 255;
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('sRGB', Buffer.from([0])), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(outputDirectory, { recursive: true });
const projected = { width, height, poses: {} };
const assets = [];
const round = value => Math.round(value * 1000) / 1000;
for (const pose of HERO_POSES) {
  const bytes = png(renderPose(pose));
  const file = `${pose.id}.png`;
  writeFileSync(resolve(outputDirectory, file), bytes);
  const points = pose.points.map(point => project(point).slice(0, 2).map(value => round(value / supersampling)));
  const ballPoint = pose.ball ? project(pose.ball.position) : null;
  projected.poses[pose.id] = { points, ball: ballPoint ? { center: ballPoint.slice(0, 2).map(value => round(value / supersampling)), radius: round(pose.ball.radius * height / (2 * Math.tan(STAGE_FOV * Math.PI / 360)) * ballPoint[3]) } : null };
  assets.push({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  console.log(`${file}: ${(bytes.length / 1024).toFixed(1)} KiB`);
}
writeFileSync(resolve(outputDirectory, 'projection.json'), JSON.stringify(projected) + '\n');
const projectionBytes = readFileSync(resolve(outputDirectory, 'projection.json'));
assets.push({ file: 'projection.json', bytes: projectionBytes.length, sha256: createHash('sha256').update(projectionBytes).digest('hex') });
writeFileSync(manifestPath, JSON.stringify({ generator: 'scripts/render-hero-fallbacks.mjs', width, height, sourceSha256: sourceHashes, assets }, null, 2) + '\n');
const size = assets.reduce((sum, asset) => sum + asset.bytes, 0);
if (size > 150 * 1024) throw new Error(`Fallback asset budget exceeded: ${size} bytes.`);
console.log(`Total fallback assets: ${(size / 1024).toFixed(1)} KiB`);
