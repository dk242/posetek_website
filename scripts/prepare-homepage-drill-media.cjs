/**
 * Read only the two approved catalog demonstrations using an existing Firebase
 * CLI login. Originals stay ignored; output is public website media. Never writes
 * to Firebase, persists credentials, or creates token-bearing download URLs.
 * Usage: node scripts/prepare-homepage-drill-media.cjs [--inspect]
 * Requires firebase-tools, ffmpeg and ffprobe. FIREBASE_TOOLS_ROOT can override
 * the normal Windows global firebase-tools installation directory.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const bucket = 'kickai-69dd0.firebasestorage.app';
const project = 'kickai-69dd0';
const specifications = [
  { drillId: 'DRB-006', name: 'Figure-8 dribble', basename: 'figure-8', storagePath: 'drillCatalogMedia/app/DRB-006/primaryDemo.mp4', posterSeconds: 8 },
  { drillId: 'PAS-001', name: 'Wall pass rhythm', basename: 'wall-pass', storagePath: 'drillCatalogMedia/3.4/PAS-001/primary_demo.mov', posterSeconds: 2 },
];
const outDir = path.join(root, 'app/src/pages/home/product/media');
const sourceDir = path.join(root, '.netlify/drill-demo-source');
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const probe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
function decode(value) {
  if (value.mapValue) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k, v]) => [k, decode(v)]));
  if (value.arrayValue) return (value.arrayValue.values || []).map(decode);
  return value.stringValue ?? value.integerValue ?? value.doubleValue ?? value.booleanValue ?? value.timestampValue ?? null;
}
function describe(file) {
  const info = probe(file);
  const video = info.streams.find(stream => stream.codec_type === 'video');
  const audio = info.streams.find(stream => stream.codec_type === 'audio');
  return { sha256: sha256(file), bytes: fs.statSync(file).size, width: video.width, height: video.height, durationSeconds: Number(info.format.duration), videoCodec: video.codec_name, pixelFormat: video.pix_fmt, frameRate: video.avg_frame_rate, rotationDegrees: video.side_data_list?.find(item => item.rotation !== undefined)?.rotation ?? 0, audioCodec: audio?.codec_name ?? null };
}
async function main() {
  const cliRoot = process.env.FIREBASE_TOOLS_ROOT || path.join(process.env.APPDATA || '', 'npm/node_modules/firebase-tools');
  const auth = require(path.join(cliRoot, 'lib/auth.js'));
  const account = auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw new Error('An existing Firebase CLI login is required.');
  const credentials = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  const headers = { Authorization: `Bearer ${credentials.access_token}` };
  const request = async (url) => {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Read-only media request failed (${response.status}).`);
    return response;
  };
  const approved = [];
  for (const specification of specifications) {
    const document = await (await request(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/drillCatalog/${specification.drillId}`)).json();
    const data = decode({ mapValue: { fields: document.fields } });
    const slot = data.media?.primaryDemo;
    if (slot?.status !== 'approved' || slot?.storagePath !== specification.storagePath) throw new Error(`${specification.drillId} approved primaryDemo no longer matches the reviewed source.`);
    const metadataURL = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(specification.storagePath)}`;
    const metadata = await (await request(metadataURL)).json();
    if (slot.generation && String(slot.generation) !== metadata.generation) throw new Error(`${specification.drillId} catalog generation does not match its current Storage object.`);
    approved.push({ ...specification, generation: metadata.generation, sourceBytes: Number(metadata.size), approval: slot.status });
  }
  if (process.argv.includes('--inspect')) {
    console.log(JSON.stringify(approved, null, 2));
    return;
  }
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const records = [];
  for (const asset of approved) {
    const sourceName = `${asset.basename}-${asset.generation}${path.extname(asset.storagePath)}`;
    const sourceFile = path.join(sourceDir, sourceName);
    const mediaURL = `https://storage.googleapis.com/download/storage/v1/b/${bucket}/o/${encodeURIComponent(asset.storagePath)}?alt=media&generation=${asset.generation}`;
    const source = await request(mediaURL);
    fs.writeFileSync(sourceFile, Buffer.from(await source.arrayBuffer()));
    if (fs.statSync(sourceFile).size !== asset.sourceBytes) throw new Error(`${asset.drillId} source size mismatch.`);
    const outputFile = path.join(outDir, `${asset.basename}.mp4`);
    const filter = "scale=w='min(720,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1";
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', sourceFile, '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1', '-vf', filter, '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outputFile];
    execFileSync('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const posterFile = path.join(outDir, `${asset.basename}.jpg`);
    const posterArgs = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(asset.posterSeconds), '-i', outputFile, '-frames:v', '1', '-q:v', '3', posterFile];
    execFileSync('ffmpeg', posterArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    const output = describe(outputFile);
    if (output.videoCodec !== 'h264' || output.pixelFormat !== 'yuv420p' || Math.max(output.width, output.height) > 720 || (output.audioCodec && output.audioCodec !== 'aac')) throw new Error(`${asset.drillId} browser media validation failed.`);
    records.push({ drillId: asset.drillId, name: asset.name, source: { bucket, storagePath: asset.storagePath, generation: asset.generation, approval: asset.approval, ...describe(sourceFile) }, output: { file: `${asset.basename}.mp4`, ...output }, poster: { file: `${asset.basename}.jpg`, seconds: asset.posterSeconds, sha256: sha256(posterFile), bytes: fs.statSync(posterFile).size }, transcode: { program: 'ffmpeg', arguments: args.map(value => value === sourceFile ? `.netlify/drill-demo-source/${sourceName}` : value === outputFile ? `app/src/pages/home/product/media/${asset.basename}.mp4` : value) } });
    console.log(`${asset.drillId}: ${output.width} x ${output.height}, ${output.durationSeconds}s, ${output.bytes} bytes, ${output.videoCodec}/${output.audioCodec || 'no audio'}`);
  }
  fs.writeFileSync(path.join(outDir, 'provenance.json'), JSON.stringify({ preparedAt: new Date().toISOString(), purpose: 'User-authorized public homepage copies of the approved app primary demonstrations. Source records and access rules are unchanged.', tools: { ffmpeg: execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0], ffprobe: execFileSync('ffprobe', ['-version'], { encoding: 'utf8' }).split('\n')[0] }, notes: ['Only DRB-006 and PAS-001 were read.', 'FFmpeg autorotation is applied before proportional scaling; output metadata is stripped.', 'Audio is retained as AAC where present. No footage is cropped, stretched, or substituted.', 'Bearer credentials are kept in memory; Firebase token URLs are neither used nor persisted.'], assets: records }, null, 2) + '\n');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
