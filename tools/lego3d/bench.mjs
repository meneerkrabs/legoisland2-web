#!/usr/bin/env node
// CPU cost of posing the character meshes, original vs mod: per frame the game skins every visible skinned mesh on the CPU (skinPositions + skinNormals, then the vertex lighting).
//   LE2_MODS=<mod dir> node tools/lego3d/bench.mjs      (without LE2_MODS: the original; run twice and compare)
import { archive, scene } from './lib.mjs';
import { bindBones, readMesh, baseName } from './modelio.mjs';
import { skinPositions, skinNormals, parseBlk, sampleBlk } from '../../src/formats/anim.ts';
const blk = parseBlk(archive('z02LGI').read('anim/MFIG.blk'));
const bones = sampleBlk(blk.skeleton, blk.clips[13], 5);   // a walk frame
const out = [];
for (const n of ['PEPP_HR', 'PEPP_MR', 'PEPP_LR', 'PEPP_SLR']) {
  const r = readMesh('z02LGI', `_data\\z02LGI\\Meshes\\${n}.msh`);
  const P = new Float32Array(r.msh.vertexCount * 3), N = new Float32Array(r.msh.vertexCount * 3);
  for (let i = 0; i < 300; i++) { skinPositions(r.msh.positions, r.sv, bones, P); skinNormals(r.msh.normals, r.sv, bones, N); }
  const t0 = performance.now(), K = 3000;
  for (let i = 0; i < K; i++) { skinPositions(r.msh.positions, r.sv, bones, P); skinNormals(r.msh.normals, r.sv, bones, N); }
  const dt = (performance.now() - t0) / K;
  out.push({ mesh: n, verts: r.msh.vertexCount, tris: r.msh.indices.length / 3, extraInfluences: r.sv.extra.count, skinMicroseconds: +(dt * 1000).toFixed(1) });
}
console.log(process.env.LE2_MODS ? 'MOD' : 'ORIGINAL'); console.table(out);
