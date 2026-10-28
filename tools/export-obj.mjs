#!/usr/bin/env node
// Optional checking aid: export a zone (every placed object at LOD0 with its per-group matrices and texture names) or a single
// mesh as Wavefront OBJ + MTL (+ PNG textures) under /tmp. Never writes into the repo.
//   node tools/export-obj.mjs <zone> [--mesh meshes/SeaBed.msh] [--out /tmp/le2-obj] [--data public/data/le2]
// Coordinates are the game's (left-handed, +Y up); to view in a right-handed tool, mirror one axis (the file is written as is,
// but faces are emitted with reversed winding so that a tool that mirrors Z shows them front-facing).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Archive } from '../src/formats/archive.ts';
import { Pe, extractZone } from '../src/formats/exe.ts';
import { parseMsh, groupMatrices } from '../src/formats/msh.ts';
import { parseTga } from '../src/formats/tga.ts';
import { parseWib } from '../src/formats/wib.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const only = opt('--mesh', '');
const out = opt('--out', '/tmp/le2-obj');
const dataRoot = opt('--data', path.join(here, '../public/data/le2'));
const zone = args[0];
if (!zone) { console.error('usage: node tools/export-obj.mjs <zone> [--mesh member] [--out dir]'); process.exit(1); }
if (!path.resolve(out).startsWith('/tmp/')) { console.error('refusing to write outside /tmp'); process.exit(1); }
fs.mkdirSync(path.join(out, 'tex'), { recursive: true });

const D = path.join(dataRoot, '_data');
const arch = new Archive(zone, fs.readFileSync(path.join(D, zone + '.bod')), fs.readFileSync(path.join(D, zone + '.bob')));

const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); Buffer.from(d).copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
function writePng(file, w, h, rgba) { // rgba rows are bottom-up (file order): flip for PNG
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + (h - 1 - y) * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', [])]));
}
const texDone = new Set();
function tex(id) {
  const name = `t${String(id).padStart(3, '0')}`;
  if (texDone.has(id)) return name;
  texDone.add(id);
  const n = String(id).padStart(3, '0');
  try {
    const t = arch.find(`textures/Text${n}.tga`);
    if (t) { const im = parseTga(arch.read(t)); writePng(path.join(out, 'tex', name + '.png'), im.width, im.height, im.rgba); }
    else { const w = arch.find(`textures/Text${n}.wib`); if (w) { const wi = parseWib(arch.read(w)); writePng(path.join(out, 'tex', name + '.png'), wi.width, wi.height, wi.frames[0]); } }
  } catch { /* skip */ }
  return name;
}

const obj = [], mtl = new Map();
let vBase = 0;
const rowv = (m, x, y, z) => [x * m[0] + y * m[4] + z * m[8] + m[12], x * m[1] + y * m[5] + z * m[9] + m[13], x * m[2] + y * m[6] + z * m[10] + m[14]];
const mul = (a, b) => { const o = new Float32Array(16); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c]; return o; };
const ident = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function emit(name, member, world, texList) {
  const e = arch.find(member);
  if (!e) return;
  const m = parseMsh(arch.read(e));
  const gm = groupMatrices(m);
  obj.push(`o ${name}`);
  m.groups.forEach((g, gi) => {
    const w = gm[gi] ? mul(gm[gi], world) : world;
    const id = texList?.[gi] ?? -1;
    const mat = id >= 0 ? tex(id) : 'untextured';
    mtl.set(mat, id);
    obj.push(`usemtl ${mat}`);
    for (let v = g.firstVertex; v < g.firstVertex + g.vertexCount; v++) {
      const p = rowv(w, m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]);
      obj.push(`v ${p[0].toFixed(4)} ${p[1].toFixed(4)} ${p[2].toFixed(4)}`);
      obj.push(`vt ${m.uvs[v * 2].toFixed(5)} ${m.uvs[v * 2 + 1].toFixed(5)}`);
      const n = rowv([w[0], w[1], w[2], 0, w[4], w[5], w[6], 0, w[8], w[9], w[10], 0, 0, 0, 0, 1], m.normals[v * 3], m.normals[v * 3 + 1], m.normals[v * 3 + 2]);
      obj.push(`vn ${n[0].toFixed(4)} ${n[1].toFixed(4)} ${n[2].toFixed(4)}`);
    }
    for (let i = g.firstIndex; i < g.firstIndex + g.indexCount; i += 3) {
      const a = vBase + m.indices[i] + 1, b = vBase + m.indices[i + 1] + 1, c = vBase + m.indices[i + 2] + 1;
      obj.push(`f ${a}/${a}/${a} ${c}/${c}/${c} ${b}/${b}/${b}`); // reversed winding (see header)
    }
    vBase += g.vertexCount;
  });
}

if (only) emit(only, only, ident, null);
else {
  const pe = new Pe(fs.readFileSync(path.join(dataRoot, 'LEGO eiland 2.exe')));
  const sc = extractZone(pe, zone);
  const rel = (p) => p.split('\\').slice(2).join('/');
  for (const r of sc.records) {
    const p = r.model?.parts.find(Boolean);
    if (!p || r.name === 'SSKY' || r.name === 'SSEA') continue;
    emit(`${r.index}_${r.name}`, rel(sc.meshPaths[p.mesh]), r.matrix, sc.texLists[p.texList]);
  }
}
const base = only ? path.basename(only).replace(/\.msh$/i, '') : zone;
fs.writeFileSync(path.join(out, base + '.obj'), `mtllib ${base}.mtl\n` + obj.join('\n') + '\n');
fs.writeFileSync(path.join(out, base + '.mtl'), [...mtl.keys()].map((k) => `newmtl ${k}\nKd 1 1 1\n${k.startsWith('t') ? `map_Kd tex/${k}.png\n` : ''}`).join('\n'));
console.log(`wrote ${path.join(out, base + '.obj')} (${vBase} vertices, ${texDone.size} textures)`);
