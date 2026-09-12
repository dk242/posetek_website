// Read-only drift check. Updating the receipt requires a mobile/web contract
// review; this command deliberately cannot bless changed sources automatically.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mobile = resolve(process.argv[2] || resolve(root, '../PoseTek-mobile-app'));
const player = resolve(root, 'app/src/pages/athlete-portal/player');
const receipt = JSON.parse(await readFile(resolve(player, 'mobile-parity.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let failed = false;
for (const [path, expected] of Object.entries(receipt.sources)) {
  try {
    const actual = hash(await readFile(resolve(mobile, path)));
    if (actual !== expected) { failed = true; console.error(`Review mobile change: ${path}`); }
  } catch (error) {
    failed = true; console.error(`Cannot verify ${path}: ${error.code}. Supply the mobile checkout path as an argument.`);
  }
}
const benchmark = 'KickAI/Stats/Benchmarks/D1Benchmarks.json';
if (hash(await readFile(resolve(player, 'D1Benchmarks.json'))) !== receipt.sources[benchmark]) {
  failed = true; console.error('The web benchmark bundle differs from the reviewed mobile dataset.');
}
if (failed) process.exitCode = 1;
else console.log(`Player parity: ${Object.keys(receipt.sources).length} mobile sources unchanged; benchmark bundle identical. Reviewed mobile commit ${receipt.reviewedMobileCommit}.`);
