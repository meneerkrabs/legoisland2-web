#!/usr/bin/env node
// Streaming import of a LARGE mod (a multi-gigabyte HD texture pack) in node, with memory measured: nothing may be read whole into memory.
//   node tools/test-mods-large.mjs --pack "<folder with info.txt + _data>" [--zip] [--ratio-check]   a real pack (folder as picked, or zipped to /tmp first with --zip)
//   node tools/test-mods-large.mjs --synthetic [--gb 2.2] [--zip]                                     a generated pack under /tmp: real textures 4x upscaled + padding
//   node tools/test-mods-large.mjs --rar "<HD Texture.rar>" [--pack "<the same pack unpacked>"]        a real RAR (webfischi's 512 MB pack), unpacked file by file by src/mods/rar.ts;
//                                                                                                     with --pack the stored files are compared with the unpacked folder
// Both import into a directory store (tools/lib/fsmodstore.mjs, the OPFS layout) under /tmp, then compare files with their sources, open the z02LGI archive with the pack's
// files in it (needs the dev data in public/data/le2) and decode the replaced textures. Prints the peak resident memory. Never writes into the repo; the pack stays where it is.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ZipFileWriter } from './lib/zipwrite.mjs';
import { FsModStore } from './lib/fsmodstore.mjs';
import { importPicked, loadActiveMods } from '../src/mods/manage.ts';
import { ModLayer } from '../src/mods/overlay.ts';
import { Archive } from '../src/formats/archive.ts';
import { parseTga } from '../src/formats/tga.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const flag = (n) => args.includes(n);
const dataDir = path.join(here, '../public/data/le2/_data');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'le2-large-'));
const fail = [];
const expect = (name, cond, extra = '') => { console.log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };

function walk(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, `${rel}${e.name}/`)); else out.push({ abs: p, rel: rel + e.name, size: fs.statSync(p).size });
  }
  return out;
}

// ---- a synthetic pack: 4x upscaled real textures of z02LGI (box-free nearest + smoothing is not needed here) re-encoded as RLE-less TGA, a few .wib, padding
function encodeTga(w, h, rgba) {
  const out = Buffer.alloc(18 + w * h * 4);
  out[2] = 2; out.writeUInt16LE(w, 12); out.writeUInt16LE(h, 14); out[16] = 32; out[17] = 8;
  for (let i = 0; i < w * h; i++) { out[18 + i * 4] = rgba[i * 4 + 2]; out[19 + i * 4] = rgba[i * 4 + 1]; out[20 + i * 4] = rgba[i * 4]; out[21 + i * 4] = rgba[i * 4 + 3]; }
  return out;
}
async function makeSynthetic(gb) {
  const root = path.join('/tmp', 'le2-synth-pack', 'HD Synthetic');
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
  fs.mkdirSync(path.join(root, '_data/z02LGI/textures'), { recursive: true });
  fs.writeFileSync(path.join(root, 'info.txt'), 'HD Synthetic\r\ntest\r\n4x nearest upscale of real island textures plus padding\r\n');
  const arc = new Archive('z02LGI', fs.readFileSync(path.join(dataDir, 'z02LGI.bod')), fs.readFileSync(path.join(dataDir, 'z02LGI.bob')));
  let n = 0;
  for (const e of arc.entries) {
    if (!/^textures\/text\d+\.tga$/i.test(e.path) || n >= 60) continue;
    const im = parseTga(arc.read(e)), k = 4, w = im.width * k, h = im.height * k, up = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((y / k | 0) * im.width + (x / k | 0)) * 4, d = (y * w + x) * 4; up[d] = im.rgba[s]; up[d + 1] = im.rgba[s + 1]; up[d + 2] = im.rgba[s + 2]; up[d + 3] = im.rgba[s + 3]; }
    fs.writeFileSync(path.join(root, '_data/z02LGI', e.path), encodeTga(w, h, up));
    n++;
  }
  const pad = path.join(root, '_data/z02LGI/pad');
  fs.mkdirSync(pad, { recursive: true });
  const per = Math.floor((gb * 2 ** 30) / 4);
  for (let i = 0; i < 4; i++) { const fd = fs.openSync(path.join(pad, `pad${i}.bin`), 'w'); fs.ftruncateSync(fd, per); fs.closeSync(fd); }
  console.log(`synthetic pack: ${n} textures + ${(gb).toFixed(1)} GB padding in ${root}`);
  return root;
}

async function zipPack(root) {
  const zip = path.join(TMP, 'pack.zip');
  const w = new ZipFileWriter(zip);
  const parent = path.basename(root);
  for (const f of walk(root)) {
    if (f.size > (64 << 20)) await w.add(`${parent}/${f.rel}`, { size: f.size, chunks: fs.createReadStream(f.abs, { highWaterMark: 4 << 20 }) });
    else await w.add(`${parent}/${f.rel}`, fs.readFileSync(f.abs), f.size > 1024 ? 'deflate' : 'store');
  }
  w.finish();
  console.log(`zip written: ${(fs.statSync(zip).size / 1e9).toFixed(2)} GB`);
  return zip;
}

const rarFile = opt('--rar', '');
const root = flag('--synthetic') ? await makeSynthetic(Number(opt('--gb', '2.2'))) : opt('--pack');
if (!root && !rarFile) { console.error('usage: --pack <folder> | --synthetic [--gb n] [--zip] | --rar <file> [--pack <folder>]'); process.exit(2); }
const files = root ? walk(root) : [];
let totalBytes = files.reduce((n, f) => n + f.size, 0);
console.log(rarFile ? `RAR: ${rarFile} (${(fs.statSync(rarFile).size / 1e6).toFixed(0)} MB)${root ? `, compared with ${files.length} unpacked files` : ''}` : `pack: ${files.length} files, ${(totalBytes / 1e9).toFixed(2)} GB`);

let items;
if (rarFile) items = [{ path: path.basename(rarFile), file: await fs.openAsBlob(rarFile) }];
else if (flag('--zip')) { const z = await zipPack(root); items = [{ path: 'pack.zip', file: await fs.openAsBlob(z) }]; }
else items = await Promise.all(files.map(async (f) => ({ path: `${path.basename(root)}/${f.rel}`, file: await fs.openAsBlob(f.abs) })));

const store = new FsModStore(path.join(TMP, 'store'));
let peak = 0;
const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 50);
const t0 = Date.now();
let last = 0;
const res = await importPicked(items, store, (p) => { if (Date.now() - last > 3000) { last = Date.now(); console.log(`  ${(p.done / 1e9).toFixed(2)} / ${(p.total / 1e9).toFixed(2)} GB  ${p.label.slice(0, 70)}`); } });
clearInterval(timer);
console.log(`import: ${((Date.now() - t0) / 1000).toFixed(1)} s, peak RSS ${(peak / 2 ** 20).toFixed(0)} MB`);
expect('import: one mod, no errors', res.added.length === 1 && res.errors.length === 0, res.errors.join('; '));
if (rarFile && !totalBytes) totalBytes = res.added[0].files.reduce((n, f) => n + f.size, 0);
expect('import: every file stored with its size', files.length === 0 || (res.added[0].files.length === files.filter((f) => /^_data\//i.test(f.rel)).length && res.added[0].files.reduce((n, f) => n + f.size, 0) <= totalBytes));
expect(`memory: peak RSS ${(peak / 2 ** 20).toFixed(0)} MB stays far below the pack size`, peak < 900 * 2 ** 20 && peak < totalBytes / 2 + 400 * 2 ** 20);

// ---- compare with the sources (sample of 30 + every file < 1 MB hash would be too slow: sample)
const mod = res.added[0];
const sample = (rarFile && !files.length ? [] : [...mod.files].sort(() => Math.random() - 0.5).slice(0, rarFile ? 400 : 30));
let bad = 0;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
for (const f of sample) {
  const src = files.find((x) => `_data/${x.rel.replace(/^_data\//i, '')}`.toLowerCase() === f.path.toLowerCase());
  if (!src || src.size !== f.size) { bad++; continue; }
  if (src.size > 300 << 20) continue;
  if (sha(await store.readFile(mod.id, f.key)) !== sha(fs.readFileSync(src.abs))) bad++;
}
expect(`stored bytes equal the source files (${sample.length} sampled)`, bad === 0, `${bad} different`);

// ---- the archive with the pack's files in it
if (fs.existsSync(path.join(dataDir, 'z02LGI.bod'))) {
  const active = await loadActiveMods(store);
  const layer = new ModLayer(active);
  const arc = new Archive('z02LGI', fs.readFileSync(path.join(dataDir, 'z02LGI.bod')), fs.readFileSync(path.join(dataDir, 'z02LGI.bob')));
  const orig = new Archive('z02LGI', fs.readFileSync(path.join(dataDir, 'z02LGI.bod')), fs.readFileSync(path.join(dataDir, 'z02LGI.bob')));
  const ov = layer.archiveOverrides('z02LGI').filter((o) => !/^pad\//i.test(o.path));
  const m0 = process.memoryUsage().rss;
  let replaced = 0, added = 0, big = 0;
  const t1 = Date.now();
  for (const o of ov) { const r = arc.override(o.path, await o.load()); r ? replaced++ : added++; }
  console.log(`archive z02LGI: ${replaced} members replaced, ${added} added, ${((Date.now() - t1) / 1000).toFixed(1)} s, +${((process.memoryUsage().rss - m0) / 2 ** 20).toFixed(0)} MB resident`);
  let decoded = 0, wrong = 0;
  for (const o of ov) {
    if (!/\.tga$/i.test(o.path) || !orig.has(o.path)) continue;
    const n = parseTga(arc.read(o.path)), p = parseTga(orig.read(o.path));
    decoded++; if (n.width !== p.width * 4 || n.height !== p.height * 4) { wrong++; console.log(`  not 4x: ${o.path} ${p.width}x${p.height} -> ${n.width}x${n.height}`); } else if (arc.isUpscaled(arc.find(o.path), n.width, n.height)) big++;
  }
  expect('archive: replaced textures decode and are 4x the original size (the real pack has one 16x particle sheet)', decoded > 0 && wrong <= 1, `${decoded} decoded, ${wrong} with another size, ${big} flagged upscaled`);
  arc.clearOverrides();
  expect('archive: clearOverrides gives the original members back', arc.entries.length === orig.entries.length && ov.slice(0, 5).every((o) => !orig.has(o.path) || arc.read(o.path).length === orig.read(o.path).length));
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log(fail.length ? `\nFAILED: ${fail.join('; ')}` : '\nlarge-pack import ok');
process.exit(fail.length ? 1 : 0);
