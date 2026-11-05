#!/usr/bin/env node
// Finds the numbers of a plants-table model by hill climbing on the silhouette IoU (6 views, 160 px while searching, the gate's size for the report) against the game's own mesh:
//   node tools/lego3d/plants-fit.mjs pine|oak ZONE Meshes/X.Msh [--layers 8] [--iters 4000] [--n 10] [--seed 1]
// Prints the parameters to paste into tools/lego3d/plants-table.mjs and the IoU of the best build.
import { archive } from './lib.mjs';
import { parseMsh } from '../../src/formats/msh.ts';
import { silhouetteIoU } from './iou.mjs';
import { buildPlant, soupsOf } from './plants.mjs';
import { pineParts, oakParts, GATE } from './plants-table.mjs';
const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); return i < 0 ? d : a[i + 1]; };
const [kind, zone, member] = a;
const N = +opt('--layers', 8), iters = +opt('--iters', 4000), sides = +opt('--n', kind === 'oak' ? 10 : 8);
let seed = +opt('--seed', 1); const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const arch = archive(zone), g = parseMsh(arch.read(arch.find(member)));
const gs = g.groups.map((gr) => { const o = new Float32Array(gr.indexCount * 3); for (let i = 0; i < gr.indexCount; i++) { const v = g.indices[gr.firstIndex + i] + gr.firstVertex; for (let c = 0; c < 3; c++) o[i * 3 + c] = g.positions[v * 3 + c]; } return o; });
const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let i = 0; i < g.vertexCount; i++) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], g.positions[i * 3 + c]); hi[c] = Math.max(hi[c], g.positions[i * 3 + c]); }
const top = hi[1];
const views = GATE.views;
let make, P;
if (kind === 'pine') {
  make = (p) => pineParts({ y0: p.y0, y1: p.y1, R: p.R, bias: p.bias, layers: N, foot: p.foot, trunk: p.trunk, n: sides });
  P = { y0: 3.6, y1: top - 0.2, R: 5.1, bias: 0, foot: 1.35, trunk: 0.74 };
} else {
  make = (p) => oakParts({ body: p.body, trunk: p.tr, n: sides, layers: N });
  P = { body: [lo[1] + 5.4, top - 1, (hi[0] - lo[0]) / 2, (hi[2] - lo[2]) / (hi[0] - lo[0]), 0], tr: 0.9 };
}
const clone = (p) => JSON.parse(JSON.stringify(p));
const ev = (p, size = 160) => { const b = buildPlant({ parts: make(p) }); return { io: silhouetteIoU(gs, soupsOf(b.groups), { size, views }), tris: b.tris, b }; };
let best = ev(P).io.mean;
for (let it = 0; it < iters; it++) {
  const C = clone(P);
  if (kind === 'pine') {
    const k = ['y0', 'y1', 'R', 'bias', 'foot', 'trunk'][Math.floor(rnd() * 6)];
    C[k] += (rnd() - 0.5) * (k === 'bias' ? 0.2 : 0.4);
    if (C.y0 < 0.6 || C.y1 > top + 0.05 || C.y1 - C.y0 < 6 || C.R < 2 || C.foot < 0.5 || C.trunk < 0.3 || Math.abs(C.bias) > 1.2) continue;
  } else {
    if (rnd() < 0.75) { const k = Math.floor(rnd() * 5); C.body[k] += (rnd() - 0.5) * (k === 3 ? 0.04 : k === 4 ? 6 : 0.3); } else C.tr += (rnd() - 0.5) * 0.2;
    if (C.tr < 0.3) continue;
  }
  const s = ev(C).io.mean; if (s > best) { best = s; P = C; }
}
const f = ev(P, GATE.size);
console.log(`${kind} ${zone} ${member}: IoU ${f.io.iou.map((v) => v.toFixed(3)).join(' ')} min ${f.io.min.toFixed(3)} mean ${f.io.mean.toFixed(3)} triangles ${f.tris} (game ${g.indices.length / 3})`);
console.log(JSON.stringify(P, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v)));
