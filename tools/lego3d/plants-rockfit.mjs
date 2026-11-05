#!/usr/bin/env node
// The rock experiment of docs/re/lego3d.md section 19: every connected stone of a game rock mesh is replaced by the LDraw rock part (of a list) and turn about y (30 degree steps) that gives the best silhouette IoU
// of that stone alone (box = the stone's box, non-uniform scale), then all stones together are built and measured against the whole mesh (6 views, 384 px, the plants gate).
//   node tools/lego3d/plants-rockfit.mjs ZONE Meshes/X.Msh [parts 30294c01,35646,...] [maxCost 0.02]
import { archive } from './lib.mjs';
import { parseMsh } from '../../src/formats/msh.ts';
import { silhouetteIoU } from './iou.mjs';
import { buildPlant, soupsOf, fitInstance } from './plants.mjs';
import { GATE } from './plants-table.mjs';
const [zone, member, partList, mc] = process.argv.slice(2);
const PARTS = (partList || '30294c01,35646,42284,42291,30153').split(',');
const m = parseMsh(archive(zone).read(archive(zone).find(member)));
const key = (i) => [0, 1, 2].map((c) => Math.round(m.positions[i * 3 + c] * 1000)).join(',');
const par = new Map(); const find = (k) => { while (par.get(k) !== k) { par.set(k, par.get(par.get(k))); k = par.get(k); } return k; };
const tris = []; for (const g of m.groups) for (let i = 0; i < g.indexCount; i += 3) tris.push([0, 1, 2].map((k) => m.indices[g.firstIndex + i + k] + g.firstVertex));
for (const t of tris) for (const v of t) { const k = key(v); if (!par.has(k)) par.set(k, k); }
for (const t of tris) { const a0 = find(key(t[0])); for (const v of t.slice(1)) { const b = find(key(v)); if (a0 !== b) par.set(b, a0); } }
const comps = new Map(); for (const t of tris) { const r = find(key(t[0])); (comps.get(r) ?? comps.set(r, []).get(r)).push(t); }
const res = [];
for (const [ci, ts] of [...comps.values()].entries()) {
  const soup = new Float32Array(ts.length * 9), lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  ts.forEach((t, i) => t.forEach((v, k) => { for (let c = 0; c < 3; c++) { const x = m.positions[v * 3 + c]; soup[i * 9 + k * 3 + c] = x; lo[c] = Math.min(lo[c], x); hi[c] = Math.max(hi[c], x); } }));
  let best = null;
  for (const part of PARTS) for (let rot = 0; rot < 360; rot += 30) {
    const inst = { part, rotY: rot, box: { x: [lo[0], hi[0]], y: [lo[1], hi[1]], z: [lo[2], hi[2]] }, res: 'low' };
    const io = silhouetteIoU([soup], [fitInstance(inst).tris], { size: 128, views: GATE.views });
    if (!best || io.mean > best.mean) best = { part, rot, mean: io.mean, min: io.min, box: inst.box };
  }
  res.push(best); console.log(`stone ${ci} (${ts.length} triangles): ${best.part} turned ${best.rot}: IoU ${best.mean.toFixed(3)} (min ${best.min.toFixed(3)})`);
}
const b = buildPlant({ parts: res.map((r) => ({ part: r.part, rotY: r.rot, box: r.box, res: 'low', maxCost: +(mc || 0.02), crease: 60, group: 0 })) });
const g0 = new Float32Array(m.indices.length * 3); for (let i = 0; i < m.indices.length; i++) for (let c = 0; c < 3; c++) g0[i * 3 + c] = m.positions[m.indices[i] * 3 + c];
const io = silhouetteIoU([g0], soupsOf(b.groups), { size: GATE.size, views: GATE.views });
console.log(`ALL: IoU ${io.iou.map((v) => v.toFixed(3)).join(' ')} min ${io.min.toFixed(3)} mean ${io.mean.toFixed(3)}; triangles ${m.indices.length / 3} -> ${b.tris} (${b.perPart.map((p) => `${p.part}:${p.tris}`).join(' ')})`);
