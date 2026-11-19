import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const media = JSON.parse(fs.readFileSync(new URL('../src/data/catalog-media.json', import.meta.url)));
const required = ['coil', 'galvanized', 'pipe', 'rebar', 'sheet', 'beam', 'port', 'drill', 'grinder', 'hammer', 'saw', 'sander', 'bits', 'solar', 'meter', 'helmet', 'gloves'];
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
const responsive = JSON.parse(fs.readFileSync(new URL('../src/data/catalog-images.json', import.meta.url)));
let derivatives=0;
for (const type of required) {
  const entry=responsive[type], original=media[type];
  if(!entry||entry.original!==original.src||entry.originalSha256!==original.sha256){errors.push(`${type}: optimized source mismatch`);continue;}
  if(!Array.isArray(entry.variants)||entry.variants.length<3){errors.push(`${type}: missing responsive widths`);continue;}
  let last=0;
  for(const v of entry.variants){
    if(!v.src.startsWith('/images/optimized/')||v.src.includes('..')){errors.push(`${type}: unsafe derivative path`);continue;}
    const file=path.resolve('public','.'+v.src);
    if(!fs.existsSync(file)){errors.push(`${type}: missing derivative`);continue;}
    const bytes=fs.readFileSync(file),hash=createHash('sha256').update(bytes).digest('hex');
    if(hash!==v.sha256||!v.src.includes(hash.slice(0,12))||bytes.length!==v.bytes)errors.push(`${type}: derivative checksum or size mismatch`);
    if(bytes.subarray(0,4).toString()!=='RIFF'||bytes.subarray(8,12).toString()!=='WEBP')errors.push(`${type}: expected WebP`);
    if(v.width<=last||v.width>entry.width||v.width>1280||v.height<1)errors.push(`${type}: invalid responsive dimensions`);
    last=v.width;derivatives++;
  }
}
if (errors.length) { console.error('Photo readiness check failed:\n' + errors.map(x => '- ' + x).join('\n')); process.exit(1); }
console.log(`All 17 original photos and ${derivatives} content-addressed WebP variants are verified with source/license metadata.`);
