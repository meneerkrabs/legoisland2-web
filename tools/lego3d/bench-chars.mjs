#!/usr/bin/env node
// CPU cost of posing the LEGO 3D character bodies against the originals (the game skins every visible skinned mesh on the CPU: skinPositions + skinNormals, then the vertex lighting), per LOD of every replaced body,
// minimum / median of 5 timed rounds in microseconds per mesh, plus the vertex and triangle counts. Run on a quiet machine, original and mod back to back.
//   node tools/lego3d/bench-chars.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive } from './lib.mjs';
import { parseMsh } from '../../src/formats/msh.ts';
import { parseSvwl, skinPositions, skinNormals, parseBlk, sampleBlk } from '../../src/formats/anim.ts';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const pack = Pack.open(new Uint8Array(fs.readFileSync(path.join(here, '../../src/mods/lego3d/data/lego3d.pack'))));
const rep = archive('z02LGI');
const gen = await generateArchive(pack, 'z02LGI', rep, async (n) => archive(n), ['characters']);
const blk = parseBlk(rep.read('anim/MFIG.blk'));
const bones = sampleBlk(blk.skeleton, blk.clips[13], 5);   // a walk frame
const time = (bytes) => {
  const m = parseMsh(bytes), sv = parseSvwl(m.svwl, m.vertexCount);
  const P = new Float32Array(m.vertexCount * 3), N = new Float32Array(m.vertexCount * 3);
  for (let i = 0; i < 400; i++) { skinPositions(m.positions, sv, bones, P); skinNormals(m.normals, sv, bones, N); }
  const rounds = [];
  for (let r = 0; r < 5; r++) { const t0 = performance.now(), K = 2500; for (let i = 0; i < K; i++) { skinPositions(m.positions, sv, bones, P); skinNormals(m.normals, sv, bones, N); } rounds.push(((performance.now() - t0) / K) * 1000); }
  rounds.sort((a, b) => a - b);
  return { verts: m.vertexCount, tris: m.indices.length / 3, extra: sv.extra.count, min: rounds[0], med: rounds[2] };
};
const rows = [];
for (const [layout, names] of Object.entries({ pepp: ['PEPP_HR', 'PEPP_MR', 'PEPP_LR', 'PEPP_SLR'], mfg: ['MFG_HR', 'MFG_MR', 'MFG_LR', 'MFG_SLR', 'MFG_BGR'], bb: ['BB_HR', 'BB_MR', 'BB_LR', 'BB_SLR', 'BB_BGR'] })) {
  for (const n of names) {
    const e = rep.find(`Meshes/${n}.msh`), o = time(rep.read(e)), mm = gen.files.get(e.path), m = mm ? time(mm) : null;
    rows.push({ mesh: n, 'verts orig': o.verts, 'verts mod': m?.verts ?? '(orig)', 'tris orig': o.tris, 'tris mod': m?.tris ?? '(orig)', 'extra infl. orig': o.extra, 'extra mod': m?.extra ?? '-', 'us orig (min)': +o.min.toFixed(1), 'us mod (min)': m ? +m.min.toFixed(1) : '-', 'us orig (med)': +o.med.toFixed(1), 'us mod (med)': m ? +m.med.toFixed(1) : '-' });
  }
}
console.table(rows);
