#!/usr/bin/env node
// Per-texture proof of the LEGO 3D textures generator: runs the browser generator (src/mods/lego3d/gen/textures.ts) over the game's archives and writes, per archive, a contact
// sheet (one row per texture: the original scaled 4x with nearest sampling | the generated 4x picture | the generated picture tiled 3 x 3 at half size, so the seam would show) to
// $LE2_LEGO3D/proof-textures/<archive>.png and a table (median colour error, luminance sd of both, seam ratio, periodicity) to proof-textures/proof.csv + proof.json.
//   node tools/lego3d/textures-proof.mjs [--only z02LGI,z05WAB] [--pack FILE] [--out DIR]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { parseTga } from '../../src/formats/tga.ts';
import { colourStats } from '../../src/mods/lego3d/gen/surf.ts';
import { archive, archiveNames, writePngBottomUp, WORK } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const PACK = opt('--pack', path.join(here, '../../src/mods/lego3d/data/lego3d.pack'));
const OUT = opt('--out', path.join(WORK, 'proof-textures'));
const only = (opt('--only', '') || '').split(',').filter(Boolean).map((s) => s.toLowerCase());
const pack = Pack.open(new Uint8Array(fs.readFileSync(PACK)));
fs.mkdirSync(OUT, { recursive: true });

const lum = (rgba, i) => 0.3 * rgba[i * 4] + 0.59 * rgba[i * 4 + 1] + 0.11 * rgba[i * 4 + 2];
function seamRatio(img) {
  // the wrap-around seam must be no rougher than the roughest ordinary neighbouring pair of columns / rows (a periodic picture's seam is such a pair)
  const { width: w, height: h, rgba } = img;
  const L = new Float32Array(w * h);
  for (let i = 0; i < L.length; i++) L[i] = lum(rgba, i);
  const dc = new Float64Array(w), dr = new Float64Array(h);
  for (let x = 0; x < w; x++) { let s = 0; for (let y = 0; y < h; y++) s += Math.abs(L[y * w + x] - L[y * w + ((x + 1) % w)]); dc[x] = s / h; }
  for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) s += Math.abs(L[y * w + x] - L[((y + 1) % h) * w + x]); dr[y] = s / w; }
  const worst = (d) => Math.max(...[...d].slice(0, -1)) + 1e-6;
  return Math.max((dc[w - 1] + 1e-6) / worst(dc), (dr[h - 1] + 1e-6) / worst(dr));
}
const rows = [];
for (const name of archiveNames()) {
  if (only.length && !only.includes(name.toLowerCase())) continue;
  const tn = `textures/arch/${name.toLowerCase()}.json`;
  if (!pack.has(tn)) continue;
  const a = archive(name), table = await pack.json(tn);
  const r = await generateArchive(pack, name, a, async (n) => archive(n), ['textures']);
  const cell = 256, W = cell * 2 + cell * 3 / 2 + 12;   // original | generated | tiled 3x3 at half size
  const items = [];
  for (const e of table.entries) {
    const n3 = String(e.id).padStart(3, '0');
    const orig = a.find(`textures/Text${n3}.tga`) ?? a.find(`textures/text${n3}.tga`);
    const out = r.files.get(orig.path);
    if (!out) { rows.push({ tex: `${name}#${e.id}`, design: e.d, error: 'not generated' }); continue; }
    const o = parseTga(a.read(orig)), g = parseTga(out);
    const so = colourStats(o.rgba), sg = colourStats(g.rgba);
    rows.push({ tex: `${name}#${e.id}`, design: e.d, orig: `${o.width}x${o.height}`, gen: `${g.width}x${g.height}`, medianOrig: so.median.join(','), medianGen: sg.median.join(','), medianErr: Math.max(...so.median.map((v, k) => Math.abs(v - sg.median[k]))), sdOrig: +so.lumSd.toFixed(1), sdGen: +sg.lumSd.toFixed(1), seam: +seamRatio(g).toFixed(2), phase: `${e.pu},${e.pv}`, bytes: out.length });
    items.push({ e, o, g });
  }
  if (!items.length) continue;
  // sheet: every row = max(4x height, 3 x 3 half) ; widths fixed
  const rowH = (it) => Math.max(it.g.height, Math.round((it.g.height * 3) / 2));
  const H = items.reduce((s, it) => s + rowH(it) + 4, 0);
  const sheet = new Uint8Array(W * H * 4).fill(40);
  let y0 = 0;
  const put = (x, y, rgba) => { if (x >= 0 && x < W && y >= 0 && y < H) { const q = (y * W + x) * 4; sheet[q] = rgba[0]; sheet[q + 1] = rgba[1]; sheet[q + 2] = rgba[2]; sheet[q + 3] = 255; } };
  for (const it of items) {
    const gw = it.g.width, gh = it.g.height;
    // rows of the sheet from the top = V descending: the TGA is bottom-up, the sheet written bottom-up as well (writePngBottomUp flips)
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const o = ((y >> 2) * it.o.width + (x >> 2)) * 4, g = (y * gw + x) * 4;
      put(x, y0 + y, it.o.rgba.subarray(o, o + 3));
      put(cell + 4 + x, y0 + y, it.g.rgba.subarray(g, g + 3));
    }
    const tw = (gw * 3) / 2 | 0, th = (gh * 3) / 2 | 0;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const sx = (((x * 2) % (gw * 3)) % gw), sy = (((y * 2) % (gh * 3)) % gh), g = (sy * gw + sx) * 4;
      put(cell * 2 + 8 + x, y0 + y, it.g.rgba.subarray(g, g + 3));
    }
    y0 += rowH(it) + 4;
  }
  writePngBottomUp(path.join(OUT, `${name}.png`), W, H, sheet);
  fs.writeFileSync(path.join(OUT, `${name}.txt`), items.map((it, i) => `${i}: ${name}#${it.e.id} ${it.e.d}`).join('\n'));
  console.log(name, items.length, 'textures ->', path.join(OUT, `${name}.png`));
}
fs.writeFileSync(path.join(OUT, 'proof.json'), JSON.stringify(rows, null, 1));
fs.writeFileSync(path.join(OUT, 'proof.csv'), ['tex,design,orig,gen,medianOrig,medianGen,medianErr,sdOrig,sdGen,seam,phase,bytes', ...rows.map((r) => [r.tex, r.design, r.orig, r.gen, `"${r.medianOrig}"`, `"${r.medianGen}"`, r.medianErr, r.sdOrig, r.sdGen, r.seam, `"${r.phase}"`, r.bytes].join(','))].join('\n'));
const ok = rows.filter((r) => !r.error);
console.log(`${ok.length} textures: max median error ${Math.max(...ok.map((r) => r.medianErr))}, max seam ratio ${Math.max(...ok.map((r) => r.seam))}, sd ratio range ${Math.min(...ok.map((r) => r.sdGen / (r.sdOrig + 0.5))).toFixed(2)}..${Math.max(...ok.map((r) => r.sdGen / (r.sdOrig + 0.5))).toFixed(2)}`);
