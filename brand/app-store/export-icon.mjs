import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// The outline-only SVG is the brand master; no fonts or network are needed.
const asset = name => new URL(`../../images/brand/${name}`, import.meta.url);
const source = await readFile(asset('posetek-app-icon.svg'));
const image = sharp(source).resize(1024, 1024).flatten({ background: '#04130e' }).removeAlpha().toColourspace('srgb');
await image.clone().png().toFile(fileURLToPath(asset('posetek-app-icon-1024.png')));
await image.clone().jpeg({ quality: 98, chromaSubsampling: '4:4:4' }).toFile(fileURLToPath(asset('posetek-app-photo-1024.jpg')));
console.log('Exported 1024 × 1024 RGB PNG and JPEG app icon assets.');
