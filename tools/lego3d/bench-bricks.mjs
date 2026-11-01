#!/usr/bin/env node
// CPU cost of drawing the replaced bricks: the engine lights and transforms every vertex of every visible brick on the CPU (src/fx/bricks/draw.ts BrickBatchCpu.add), so the cost is per vertex.
// Times the same add() on the game's meshes and on the generated ones (all replaced bricks, one pass = one of each), min of several repeats.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive } from './lib.mjs';
import { readBrickLod } from '../../src/formats/bricks.ts';
import { BrickBatchCpu } from '../../src/fx/bricks/draw.ts';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const a = archive('Bricks');
const pack = Pack.open(new Uint8Array(fs.readFileSync(path.join(here, '../../src/mods/lego3d/data/lego3d.pack'))));
const r = await generateArchive(pack, 'Bricks', a, async () => null, ['bricks']);
const index = await pack.json('bricks/index.json');
const groupOf = (k) => { const n = k.match(/^lods\/(.+)_lod\d\.msh$/)[1], b = index.bricks[n]; return b.tier === 'class' ? `class:${b.cls}` : b.tier; };
const prep = { lights: [{ kind: 0, dirObj: [0, 0, 0], halfObj: [0, 0, 0], posObj: [0, 0, 0], color: [0.4, 0.4, 0.4], range: 0 }, { kind: 1, dirObj: [0.3, 0.8, 0.5], halfObj: [0.1, 0.9, 0.4], posObj: [0, 0, 0], color: [0.7, 0.7, 0.7], range: 0 }] };
const W = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 2, 1, 1]);
for (const lod of [0, 1]) {
  const orig = [], mine = [], grp = [];
  for (const k of r.files.keys()) { const m = k.match(/^lods\/(.+)_lod(\d)\.msh$/); if (!m || +m[2] !== lod) continue; orig.push(readBrickLod(a.read(a.find(k)))); mine.push(readBrickLod(r.files.get(k))); grp.push(groupOf(k)); }
  const time = (set) => {
    let best = 1e9;
    for (let rep = 0; rep < 7; rep++) {
      const c = new BrickBatchCpu(), t0 = process.hrtime.bigint();
      for (let pass = 0; pass < 20; pass++) for (const m of set) { if (c.full(m.vertexCount, m.indices.length)) c.reset(); c.add(m, W, m.vertexCount, [0.1, 0.1], [0.2, 0.2], prep); }
      best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6 / 20);
    }
    return best;
  };
  const sum = (set, f) => set.reduce((s, m) => s + f(m), 0);
  const to = time(orig), tm = time(mine);
  for (const g of [...new Set(grp)].sort()) {   // per class: one of each brick of the class per pass
    const sel = (set) => set.filter((_, i) => grp[i] === g), go = sel(orig), gm = sel(mine), a1 = time(go), b1 = time(gm);
    console.log(`  LOD ${lod} ${g.padEnd(16)} x${String(go.length).padStart(3)}  vertices ${String(sum(go, (m) => m.vertexCount)).padStart(6)} -> ${String(sum(gm, (m) => m.vertexCount)).padStart(6)}  triangles ${String(sum(go, (m) => m.indices.length / 3)).padStart(6)} -> ${String(sum(gm, (m) => m.indices.length / 3)).padStart(6)}  CPU ${a1.toFixed(3)} -> ${b1.toFixed(3)} ms (${((b1 / a1 - 1) * 100).toFixed(0)} %)`);
  }
  console.log(`LOD ${lod}: ${orig.length} bricks, vertices ${sum(orig, (m) => m.vertexCount)} -> ${sum(mine, (m) => m.vertexCount)}, triangles ${sum(orig, (m) => m.indices.length / 3)} -> ${sum(mine, (m) => m.indices.length / 3)}, CPU per pass of one of each: ${to.toFixed(2)} ms -> ${tm.toFixed(2)} ms (${((tm / to - 1) * 100).toFixed(0)} %)`);
}
