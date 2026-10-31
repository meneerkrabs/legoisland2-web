#!/usr/bin/env node
// Skinning stress test: over many frames of many clips of MFIG.blk, how much do the triangles of a skinned body mesh stretch against the bind pose (max edge length ratio)?
//   [LE2_MODS=dir] node tools/lego3d/pose-check.mjs [mesh=PEPP_HR] [zone=z02LGI]
import { archive } from './lib.mjs';
import { readMesh } from './modelio.mjs';
import { parseBlk, sampleBlk, skinPositions } from '../../src/formats/anim.ts';
const [name = 'PEPP_HR', zone = 'z02LGI'] = process.argv.slice(2);
const blk = parseBlk(archive(zone).read('anim/MFIG.blk'));
const r = readMesh(zone, `_data\\${zone}\\Meshes\\${name}.msh`), m = r.msh;
const bind = skinPositions(m.positions, r.sv, sampleBlk(blk.skeleton, blk.clips[2], 0));
const edges = [];
for (const g of m.groups) for (let t = 0; t < g.indexCount; t += 3) { const v = [0, 1, 2].map((k) => m.indices[g.firstIndex + t + k] + g.firstVertex); for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) edges.push([v[a], v[b]]); }
const len = (P, a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
const l0 = edges.map(([a, b]) => len(bind, a, b));
const worst = []; let n = 0;
const STEP = process.argv.includes('--all') ? 1 : 5;
const worstAt = [];
for (let c = 3; c < blk.clips.length; c += STEP) {
  const clip = blk.clips[c];
  if (clip.boneCount !== blk.skeleton.boneCount) continue;
  for (const f of [0, Math.floor(clip.frameCount / 3), Math.floor((2 * clip.frameCount) / 3)]) {
    const P = skinPositions(m.positions, r.sv, sampleBlk(blk.skeleton, clip, f));
    let mx = 0;
    edges.forEach(([a, b], i) => { if (l0[i] > 0.05) mx = Math.max(mx, len(P, a, b) / l0[i]); });
    worst.push(mx); n++; worstAt.push([mx, c, f]);
  }
}
worst.sort((a, b) => a - b);
console.log(process.env.LE2_MODS ? 'MOD' : 'ORIGINAL', name, 'poses', n, 'max edge stretch: median', worst[worst.length >> 1].toFixed(2), 'p90', worst[Math.floor(worst.length * 0.9)].toFixed(2), 'max', worst[worst.length - 1].toFixed(2));

worstAt.sort((a, b) => b[0] - a[0]);
console.log('worst poses (stretch, clip, frame):', worstAt.slice(0, 5).map((w) => `${w[0].toFixed(1)}@${w[1]}:${w[2]}`).join('  '));
