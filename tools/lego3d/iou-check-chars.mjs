#!/usr/bin/env node
// Silhouette IoU of the generated characters (body + both hands) against the game's own (body + both hands), posed with frames of the game's clips (docs/re/lego3d.md "Round 10" / "Round 12"):
//   node tools/lego3d/iou-check-chars.mjs [--pack FILE] [--poses 325] [--only pepp,mfg,...] [--json OUT]
// Per (layout, LOD): mean / min over the poses of the mean over 4 views (front, right, back, three-quarter from above) at 192 px. The bodies are skinned with skinPositions, the hands drawn as
// v * MATL * bone (what the game does). Needs the game folder and a pack.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { parseMsh, groupMatrices } from '../../src/formats/msh.ts';
import { parseSvwl, skinPositions } from '../../src/formats/anim.ts';
import { archive } from './lib.mjs';
import { loadInventory } from './chars-inventory.mjs';
import { poses as samplePoses } from './pack/chars-pose.mjs';
import { BONES } from './pack/chars-core.mjs';
import { silhouetteIoU } from './iou.mjs';
import { CASES } from './wrist-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const PACK = opt('--pack', path.join(here, '../../src/mods/lego3d/data/lego3d.pack'));
const NPOSE = +opt('--poses', 325);
const ONLY = (opt('--only', '') || '').split(',').filter(Boolean);
const VIEWS = [[0, 0], [90, 0], [180, 0], [35, 25]];

/** the posed triangles of a mesh: skinned (svwl) with the bone matrices M, or carried by one bone (a hand: v * MATL * bone) */
function posed(bytes, M, bone) {
  const m = parseMsh(bytes), out = [];
  let X;
  if (m.svwl) X = skinPositions(m.positions, parseSvwl(m.svwl, m.vertexCount), M);
  else {
    X = new Float32Array(m.vertexCount * 3);
    const G = groupMatrices(m), o = bone * 16;
    m.groups.forEach((g, gi) => {
      const T = G[gi];
      for (let v = g.firstVertex; v < g.firstVertex + g.vertexCount; v++) {
        let x = m.positions[v * 3], y = m.positions[v * 3 + 1], z = m.positions[v * 3 + 2];
        if (T) [x, y, z] = [x * T[0] + y * T[4] + z * T[8] + T[12], x * T[1] + y * T[5] + z * T[9] + T[13], x * T[2] + y * T[6] + z * T[10] + T[14]];
        X[v * 3] = x * M[o] + y * M[o + 4] + z * M[o + 8] + M[o + 12]; X[v * 3 + 1] = x * M[o + 1] + y * M[o + 5] + z * M[o + 9] + M[o + 13]; X[v * 3 + 2] = x * M[o + 2] + y * M[o + 6] + z * M[o + 10] + M[o + 14];
      }
    });
  }
  for (const g of m.groups) for (let t = 0; t < g.indexCount; t++) { const v = m.indices[g.firstIndex + t] + g.firstVertex; out.push(X[v * 3], X[v * 3 + 1], X[v * 3 + 2]); }
  return Float32Array.from(out);
}

const inv = loadInventory(), pack = Pack.open(new Uint8Array(fs.readFileSync(PACK)));
const all = samplePoses(5), step = Math.max(1, Math.floor(all.length / NPOSE)), P = [];
for (let i = 0; i < all.length; i += step) P.push(all[i]);
console.log(`pack ${PACK}, ${P.length} poses, ${VIEWS.length} views`);
const genCache = new Map(), results = {};
for (const c of CASES) {
  if (ONLY.length && !ONLY.includes(c.name)) continue;
  const mo = inv.models.find((m) => m.zone === c.zone && m.model === c.model), a = archive(c.zone);
  if (!genCache.has(c.zone)) genCache.set(c.zone, (await generateArchive(pack, c.zone, a, async () => null, ['characters'])).files);
  const gen = genCache.get(c.zone);
  for (const li of c.lods) {
    const parts = [mo.parts[li], ...[6, 8].map((s) => { const h = mo.attach.find((x) => x?.slot === s); return h?.parts[Math.min(li, h.parts.length - 1)]; })];
    const bones = [0, 14, 16];
    const get = (p, g) => { const e = a.find(p.member); return g && gen.has(e.path) ? gen.get(e.path) : a.read(e); };
    const iou = [];
    for (const M of P) {
      const A = parts.map((p, i) => posed(get(p, false), M, bones[i])), B = parts.map((p, i) => posed(get(p, true), M, bones[i]));
      iou.push(silhouetteIoU(A, B, { views: VIEWS, size: 192 }).mean);
    }
    const mean = iou.reduce((s, x) => s + x, 0) / iou.length, min = Math.min(...iou);
    results[`${c.name}-${li}`] = { mean: +mean.toFixed(4), min: +min.toFixed(4) };
    console.log(`${c.name.padEnd(6)} lod${li}: IoU mean ${mean.toFixed(3)} min ${min.toFixed(3)} over ${iou.length} poses`);
  }
}
const out = opt('--json', null); if (out) fs.writeFileSync(out, JSON.stringify(results, null, 1));
