import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const media = JSON.parse(fs.readFileSync(new URL('../src/data/catalog-media.json', import.meta.url)));
const required = ['coil', 'galvanized', 'pipe', 'rebar', 'sheet', 'beam', 'port'];
const errors = [];
for (const type of required) {
  const asset = media[type];
  if (!asset) { errors.push(`${type}: missing photo and attribution`); continue; }
  for (const field of ['src', 'alt', 'author', 'source', 'license', 'licenseUrl']) if (typeof asset[field] !== 'string' || !asset[field].trim()) errors.push(`${type}: missing ${field}`);
  if (!asset.src?.startsWith('/images/') || asset.src.includes('..')) { errors.push(`${type}: photo must be a local image asset`); continue; }
  if (!asset.source?.startsWith('https://commons.wikimedia.org/')) errors.push(`${type}: expected documented Wikimedia source`);
  const file = path.resolve('public', '.' + asset.src);
  if (!fs.existsSync(file)) { errors.push(`${type}: missing local file`); continue; }
  const bytes = fs.readFileSync(file);
  if (!asset.sha256 || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) errors.push(`${type}: photo checksum differs from imported asset`);
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isPng = bytes.subarray(1, 4).toString() === 'PNG';
  const isWebp = bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if ((!isJpeg && !isPng && !isWebp) || bytes.length < 10000) errors.push(`${type}: photo is not a valid downloaded bitmap`);
}
if (errors.length) { console.error('Photo readiness check failed:\n' + errors.map(x => '- ' + x).join('\n')); process.exit(1); }
console.log('All 6 steel-category photographs and the port photograph exist locally with source/license metadata.');
