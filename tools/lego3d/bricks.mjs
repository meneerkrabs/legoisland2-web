#!/usr/bin/env node
// Brick library of the game (Bricks archive, lods/<brick>_lod0..2.msh) rebuilt from LDraw parts. The bricks are exactly LDU x 0.04 (x, z: 20 LDU = 0.8; y: 24 LDU = 0.96, stud 4 LDU = 0.16), so a part is only
// rotated into place (best of 24 rotations by chamfer distance against the original LOD 0), scaled by 0.04 and centred on the original's bounding box. The engine draws a brick with ONE palette
// cell (the game's own Text000.tga colours), so the meshes carry no texture mapping.
//   node tools/lego3d/bricks.mjs [--mod DIR] [--only fat2x2,fat4x2] [--all] [--verify]
import fs from 'node:fs';
import path from 'node:path';
import { LDrawLib } from './ldraw.mjs';
import { LDRAW, archive, EXTRACT, WORK } from './lib.mjs';
import { parseMsh, validateMsh } from '../../src/formats/msh.ts';
import { writeMsh } from './mshwrite.mjs';
import { bboxPts, rotations24, applyRot, chamfer, samplePts, weldSmooth, pruneHidden } from './geom.mjs';
import { BRICK_MAP } from './brickmap.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const MOD = opt('--mod', path.join(EXTRACT, 'mods/lego3d-pilot'));
const ONLY = opt('--only', '');
const PILOT = 'fat1x1,fat2x1,fat4x1,fat6x1,fat8x1,fat2x2,fat4x2,thin1x1,thin2x1,thin4x1,thin2x2,thin4x2,fat2x2_45slope,fat1x2_45slope'.split(',');
const lib = new LDrawLib(path.join(LDRAW, 'lib/ldraw'));
const arch = archive('Bricks');
const S = 0.04;
const rep = [];
const names = args.includes('--all') ? Object.keys(BRICK_MAP) : (ONLY ? ONLY.split(',') : PILOT);
const outDir = path.join(MOD, '_data', 'Bricks', 'lods');
if (!args.includes('--verify')) fs.mkdirSync(outDir, { recursive: true });
const origTris = (m) => { const o = []; for (const g of m.groups) for (let i = 0; i < g.indexCount; i++) { const v = m.indices[g.firstIndex + i] + g.firstVertex; o.push(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]); } return Float32Array.from(o); };
for (const name of names) {
  const ld = BRICK_MAP[name];
  if (!ld) { rep.push({ name, status: 'no part' }); continue; }
  const e0 = arch.find(`lods/${name}_lod0.msh`) ?? arch.find(`lods/${name}_lod1.msh`);
  if (!e0) { rep.push({ name, status: 'no lod' }); continue; }
  const ref = parseMsh(arch.read(e0)), refT = origTris(ref), refB = bboxPts(ref.positions);
  const f = lib.flatten(`${ld}.dat`, { res: 'std' });
  // best rotation of the negated part (LDraw -> game: p = -(x, y, z) then rotation), scaled by S and centred on the reference box
  let best = null;
  const neg = Float32Array.from(f.tris, (v) => -v * S);
  const ctr = (b) => b.lo.map((l, i) => (l + b.hi[i]) / 2);
  for (const rot of rotations24()) {
    const r = new Float32Array(neg.length);
    for (let i = 0; i < neg.length; i += 3) r.set(applyRot(rot, [neg[i], neg[i + 1], neg[i + 2]]), i);
    const b = bboxPts(r), c = ctr(b), rc = ctr(refB);
    // align bbox centres, then compare the shapes
    const sh = r.map((v, i) => v - c[i % 3] + rc[i % 3]);
    const d = chamfer(samplePts(sh), samplePts(refT));
    if (!best || d < best.d) best = { d, rot, shift: [rc[0] - c[0], rc[1] - c[1], rc[2] - c[2]], size: b.size };
  }
  const dim = refB.size.map((v, i) => Math.abs(v - best.size[i]));
  const ok = best.d / Math.max(...refB.size) < 0.08 && dim.every((x) => x < 0.045);
  rep.push({ name, part: ld, chamfer: +best.d.toFixed(4), sizeErr: Math.max(...dim).toFixed(3), status: ok ? 'ok' : 'MISMATCH' });
  if (!ok || args.includes('--verify')) continue;
  for (let l = 0; l < 3; l++) {
    const e = arch.find(`lods/${name}_lod${l}.msh`);
    if (!e) continue;
    if (l === 2) continue;   // the far box (12 triangles) stays the game's own: no file in the mod (and none of the game's data in it)
    const fl = l === 0 ? f : lib.flatten(`${ld}.dat`, { res: 'low' });
    const tri = new Float32Array(fl.tris.length);
    for (let i = 0; i < tri.length; i += 9) for (let k = 0; k < 3; k++) {
      const p = applyRot(best.rot, [-fl.tris[i + k * 3] * S, -fl.tris[i + k * 3 + 1] * S, -fl.tris[i + k * 3 + 2] * S]);
      const j = k === 1 ? 2 : k === 2 ? 1 : k;   // the mapping is a reflection: reverse the winding
      tri[i + j * 3] = p[0] + best.shift[0]; tri[i + j * 3 + 1] = p[1] + best.shift[1]; tri[i + j * 3 + 2] = p[2] + best.shift[2];
    }
    const w = weldSmooth(pruneHidden(tri, tri, 4), 35);   // inner walls and the tubes under the brick are never seen
    const bytes = writeMsh([{ flags: 0, pos: w.pos, nrm: w.nrm, uv: new Float32Array(w.pos.length / 3 * 2), idx: w.idx }], { identityMatl: false });
    const m = parseMsh(bytes), pr = validateMsh(m);
    if (pr.length) console.log('PROBLEMS', name, l, pr);
    fs.writeFileSync(path.join(outDir, `${name}_lod${l}.msh`), bytes);
    rep[rep.length - 1][`lod${l}`] = `${m.vertexCount}v/${m.indices.length / 3}t (was ${parseMsh(arch.read(e)).vertexCount}v)`;
  }
}
console.table(rep);
fs.writeFileSync(path.join(WORK, 'bricks-report.json'), JSON.stringify(rep, null, 1));
