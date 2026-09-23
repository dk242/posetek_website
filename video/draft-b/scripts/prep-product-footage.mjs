import {access, mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Private local footage only. No network requests or media are stored in Git.
// Place the two supplied originals in public/product/ using these generic names.
// Usage:
//   node scripts/prep-product-footage.mjs --verify-only
//   node scripts/prep-product-footage.mjs --audio-only
//   node scripts/prep-product-footage.mjs             (prepare missing files)
//   node scripts/prep-product-footage.mjs --overwrite (rebuild derivatives)
// --audio-only intentionally replaces only demo-audio.wav; originals are never
// overwritten. FFmpeg and ffprobe must be available on PATH.
const args = new Set(process.argv.slice(2));
for (const arg of args) {
  if (!['--verify-only', '--audio-only', '--overwrite'].includes(arg)) {
    throw new Error('Unknown argument: ' + arg);
  }
}
if (args.has('--verify-only') && (args.has('--audio-only') || args.has('--overwrite'))) {
  throw new Error('--verify-only cannot be combined with a rendering option.');
}
const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../public/product');
const ffmpeg = process.env.FFMPEG_BINARY || 'ffmpeg';
const ffprobe = process.env.FFPROBE_BINARY || 'ffprobe';
const sourceHashes = {
  'screen-original.mov': 'c69ba5543d1833c13173f9b33fdc1da775ee2d3af19ee5721a6e105730dcfabb',
  'field-original.mov': '07562cc5ce9a5b65d8e7a61db42e7889efba55ef18d103f0a7c03521c3828775',
};
const fieldFilter = 'scale=1080:1920:flags=lanczos,zscale=t=linear:npl=1000,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:desat=0.5,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,eq=gamma=1.05,setsar=1,fps=30';
const screenCuts = [
  {start: 21.5, end: 40.5, duration: 19},
  {start: 53, end: 59, duration: 6},
];
const fieldCut = {start: 11.75, end: 30.75, duration: 19};
const path = name => resolve(directory, name);
const execute = (program, parameters) => {
  const result = spawnSync(program, parameters, {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(program + ' failed:\n' + result.stderr);
  return result;
};
const sha256 = async name => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path(name))) hash.update(chunk);
  return hash.digest('hex');
};
const exists = async name => {
  try {await access(path(name)); return true;} catch {return false;}
};
const probe = name => JSON.parse(execute(ffprobe, [
  '-v', 'error', '-show_entries',
  'format=duration:stream=codec_name,codec_type,width,height,sample_rate,channels,avg_frame_rate,nb_frames,pix_fmt,color_space,color_transfer,color_primaries:stream_side_data=rotation',
  '-of', 'json', path(name),
]).stdout);
const inventory = async name => ({
  file: name,
  bytes: (await stat(path(name))).size,
  sha256: await sha256(name),
  probe: probe(name),
});
await mkdir(directory, {recursive: true});
const sources = [];
for (const [name, expected] of Object.entries(sourceHashes)) {
  const item = await inventory(name);
  if (item.sha256 !== expected) throw new Error('Original source hash mismatch: ' + name);
  sources.push({...item, expectedSha256: expected, hashVerified: true});
}

const recipes = [
  {
    output: 'screen.mp4',
    inputs: ['screen-original.mov'],
    description: 'Clockwise transpose of the encoded 444x960 screen recording to 960x444 at 30fps; source app audio retained.',
    parameters: ['-i', 'screen-original.mov', '-map', '0:v:0', '-map', '0:a:0',
      '-vf', 'transpose=1,setsar=1,fps=30', '-c:v', 'libx264', '-crf', '18',
      '-preset', 'fast', '-c:a', 'copy', '-map_metadata', '-1', '-movflags', '+faststart', 'screen.mp4'],
  },
  {
    output: 'screen-demo.mp4',
    inputs: ['screen.mp4'],
    description: 'Two sequential excerpts at original playback speed; only processing dead space is omitted.',
    parameters: ['-i', 'screen.mp4', '-filter_complex',
      '[0:v:0]split=2[va][vb];[va]trim=start=21.5:end=40.5,setpts=PTS-STARTPTS[v1];[vb]trim=start=53:end=59,setpts=PTS-STARTPTS[v2];[v1][v2]concat=n=2:v=1:a=0,setsar=1,fps=30[v]',
      '-map', '[v]', '-an', '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
      '-map_metadata', '-1', '-movflags', '+faststart', 'screen-demo.mp4'],
  },
  {
    output: 'field-demo.mp4',
    inputs: ['field-original.mov'],
    description: 'FFmpeg honors the source -90 degree display rotation before scaling and SDR tone mapping. Entire selected jump is preserved at 1x speed.',
    parameters: ['-ss', '11.75', '-i', 'field-original.mov', '-t', '19',
      '-map', '0:v:0', '-an', '-vf', fieldFilter, '-c:v', 'libx264',
      '-crf', '18', '-preset', 'fast', '-color_primaries', 'bt709',
      '-color_trc', 'bt709', '-colorspace', 'bt709', '-map_metadata', '-1',
      '-movflags', '+faststart', 'field-demo.mp4'],
  },
  {
    output: 'demo-audio.wav',
    inputs: ['screen-original.mov'],
    description: 'Only original screen/app audio, matching both screen cuts. One-pass loudnorm targets -16 LUFS, -2 dBTP, LRA 9; explicit 48kHz PCM24 output.',
    parameters: ['-i', 'screen-original.mov', '-filter_complex',
      '[0:a:0]asplit=2[aa][ab];[aa]atrim=start=21.5:end=40.5,asetpts=PTS-STARTPTS[a1];[ab]atrim=start=53:end=59,asetpts=PTS-STARTPTS[a2];[a1][a2]concat=n=2:v=0:a=1,loudnorm=I=-16:TP=-2:LRA=9[a]',
      '-map', '[a]', '-vn', '-ar', '48000', '-c:a', 'pcm_s24le', '-map_metadata', '-1', 'demo-audio.wav'],
  },
];
const generated = [];
if (!args.has('--verify-only')) {
  for (const recipe of recipes) {
    if (args.has('--audio-only') && recipe.output !== 'demo-audio.wav') continue;
    if (!args.has('--audio-only') && !args.has('--overwrite') && await exists(recipe.output)) continue;
    console.log('Preparing ' + recipe.output);
    const filenames = new Set([...recipe.inputs, recipe.output]);
    const parameters = recipe.parameters.map(value => filenames.has(value) ? path(value) : value);
    execute(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...parameters]);
    generated.push(recipe.output);
  }
}

const checks = [];
const check = (name, passed, observed) => checks.push({name, passed, observed});
const outputs = [];
for (const recipe of recipes) outputs.push(await inventory(recipe.output));
const item = name => outputs.find(output => output.file === name);
const stream = (name, type) => item(name).probe.streams.find(s => s.codec_type === type);
const video = (name, width, height, frames) => {
  const s = stream(name, 'video');
  check(name + ' video format', s?.codec_name === 'h264' && s.width === width && s.height === height && s.avg_frame_rate === '30/1',
    {codec: s?.codec_name, width: s?.width, height: s?.height, frameRate: s?.avg_frame_rate});
  if (frames) check(name + ' frame count', Number(s?.nb_frames) === frames, Number(s?.nb_frames));
};
video('screen.mp4', 960, 444);
video('screen-demo.mp4', 960, 444, 750);
video('field-demo.mp4', 1080, 1920, 570);
for (const [name, duration] of [['screen-demo.mp4', 25], ['field-demo.mp4', 19], ['demo-audio.wav', 25]]) {
  const actual = Number(item(name).probe.format.duration);
  check(name + ' duration', Math.abs(actual - duration) < 0.001, actual);
}
for (const name of ['screen-demo.mp4', 'field-demo.mp4']) {
  check(name + ' has no embedded audio', !stream(name, 'audio'), !stream(name, 'audio'));
}
const field = stream('field-demo.mp4', 'video');
check('field SDR color', field.color_space === 'bt709' && field.color_transfer === 'bt709' && field.color_primaries === 'bt709',
  {space: field.color_space, transfer: field.color_transfer, primaries: field.color_primaries});
const nativeAudio = stream('demo-audio.wav', 'audio');
check('native audio format', nativeAudio.codec_name === 'pcm_s24le' && nativeAudio.sample_rate === '48000' && nativeAudio.channels === 2,
  {codec: nativeAudio.codec_name, sampleRate: nativeAudio.sample_rate, channels: nativeAudio.channels});
const meter = execute(ffmpeg, ['-hide_banner', '-i', path('demo-audio.wav'), '-af',
  'loudnorm=I=-16:TP=-2:LRA=9:print_format=json', '-f', 'null', '-']).stderr;
const measured = JSON.parse(meter.slice(meter.lastIndexOf('{'), meter.lastIndexOf('}') + 1));
const audioLevels = {integratedLufs: Number(measured.input_i), truePeakDbtp: Number(measured.input_tp), loudnessRangeLu: Number(measured.input_lra)};
check('native audio true peak', audioLevels.truePeakDbtp <= -1.9, audioLevels.truePeakDbtp);
// Keep the native app prompts separate from the generated narrator's captions.
// These cue positions match the film's two-cut demo, beginning at second 21.
const nativeCues = [
  {start: 1.3, end: 2.6, text: 'Person is in view.'},
  {start: 4.82, end: 7.7, text: 'You are in position. Put your hands up when ready.'},
  {start: 9.2, end: 10.35, text: 'Starting drill.'},
  {start: 11.88, end: 12.55, text: '3'},
  {start: 12.94, end: 13.6, text: '2'},
  {start: 13.94, end: 14.6, text: '1'},
  {start: 19.9, end: 20.95, text: 'Processing complete.'},
  {start: 21.42, end: 23.25, text: 'Your broad jump was 4.8 feet.'},
  {start: 23.64, end: 24.7, text: 'Ready for next rep.'},
];
const narrationCaptions = JSON.parse(await readFile(resolve(directory, '../audio-product-v1/captions.json'), 'utf8'));
const allCaptions = [...narrationCaptions, ...nativeCues.map(cue => ({
  ...cue, start: Number((cue.start + 21).toFixed(3)), end: Number((cue.end + 21).toFixed(3)),
}))].sort((a, b) => a.start - b.start);
for (let i = 0; i < allCaptions.length; i++) {
  const cue = allCaptions[i];
  if (!(cue.start >= 0 && cue.start < cue.end && cue.end <= 150)) throw new Error('Invalid caption interval.');
  if (i && allCaptions[i - 1].end > cue.start) throw new Error('Overlapping final captions.');
}
const stamp = value => {
  const ms = Math.round(value * 1000);
  const pad = (n, width = 2) => String(n).padStart(width, '0');
  return pad(Math.floor(ms / 3600000)) + ':' + pad(Math.floor(ms / 60000) % 60) + ':' + pad(Math.floor(ms / 1000) % 60) + ',' + pad(ms % 1000, 3);
};
const captionDirectory = resolve(directory, '../../output/product');
await mkdir(captionDirectory, {recursive: true});
await writeFile(resolve(captionDirectory, 'native-captions.json'), JSON.stringify({
  filmOffsetSeconds: 21, source: 'Original app speech, with recognition timestamps reviewed for the two-cut edit.', cues: nativeCues,
}, null, 2) + '\n');
await writeFile(resolve(captionDirectory, 'PoseTek-Product-Demonstration-V1.srt'),
  allCaptions.map((cue, i) => String(i + 1) + '\n' + stamp(cue.start) + ' --> ' + stamp(cue.end) + '\n' + cue.text).join('\n\n') + '\n');
const receipt = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  mode: args.has('--verify-only') ? 'verify existing derivatives' : args.has('--audio-only') ? 'regenerate native audio; inspect existing video derivatives' : 'prepare missing or explicitly replaced derivatives',
  generatedThisRun: generated,
  toolVersions: {
    ffmpeg: execute(ffmpeg, ['-version']).stdout.split(/\r?\n/)[0],
    ffprobe: execute(ffprobe, ['-version']).stdout.split(/\r?\n/)[0],
  },
  sources,
  edit: {
    screenCuts,
    fieldCut,
    appAudioSource: 'screen-original.mov',
    playbackSpeed: 1,
    originalJumpPreserved: true,
    omittedScreenInterval: {start: 40.5, end: 53, description: 'Processing dead space omitted before the spoken result.'},
    alignment: {
      method: 'Manual visual hand-raise alignment supplied by the editor.',
      screenMinusFieldSeconds: 9.75,
      framePerfectSynchronizationVerified: false,
      audioCorrelation: 'Inconclusive; weak, inconsistent waveform and envelope correlations do not validate synchronization.',
    },
    integration: 'Play screen-demo.mp4 and demo-audio.wav together for 25 seconds at film seconds 21-46. field-demo.mp4 covers their first 19 seconds; the film determines its result-section layout for the final 6 seconds.',
  },
  recipes,
  outputs,
  audioLevels,
  captions: {file: 'output/product/PoseTek-Product-Demonstration-V1.srt', nativeCueFile: 'output/product/native-captions.json', narratorCues: narrationCaptions.length, nativeCues: nativeCues.length, totalCues: allCaptions.length, overlapVerifiedAbsent: true},
  checks,
  passed: checks.every(c => c.passed),
  limitations: [
    'Existing video derivatives were inspected, not regenerated or compared pixel-by-pixel against these reconstructed recipes.',
    'Source hashes, media formats and exact clip lengths are verified; these checks do not independently verify every edit boundary or visual synchronization.',
    'The declared full-jump preservation and manual alignment rely on the editor visual review. No frame-perfect synchronization or manual audio-listening claim is made.',
    'Output byte hashes can differ with encoder versions; the receipt records the exact observed artifacts and tool versions.',
  ],
};
await writeFile(path('footage-manifest.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({receipt: 'public/product/footage-manifest.json', generated, audioLevels, passed: receipt.passed, failedChecks: checks.filter(c => !c.passed)}, null, 2));
if (!receipt.passed) process.exitCode = 1;

