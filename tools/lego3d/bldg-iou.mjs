#!/usr/bin/env node
// Quality gate of the brick-built reconstructions: the generated mesh (pack -> generator, the browser's path) against the game's own mesh: silhouette IoU from 9 views (world space, MATL applied, every group),
// triangle counts, and the bounding box change.   node tools/lego3d/bldg-iou.mjs [--pack FILE] zone Mesh.Msh [Mesh2.Msh ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive, memberOf, scene } from './lib.mjs';
import { parseMsh, groupMatrices } from '../../src/formats/msh.ts';
import { transformPoint } from '../../src/render/math.ts';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { silhouetteIoU } from './iou.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const pi = args.indexOf('--pack'); const packFile = pi >= 0 ? args.splice(pi, 2)[1] : path.join(here, '../../src/mods/lego3d/data/lego3d.pack');
const [zone, ...names] = args;
const a = archive(zone), sc = scene(zone);
const pack = Pack.open(new Uint8Array(fs.readFileSync(packFile)));
const r = await generateArchive(pack, zone, a, async () => null, ['sets']);
const soups = (msh) => { const gm = groupMatrices(msh); return msh.groups.map((g, gi) => { const t = []; for (let i = 0; i < g.indexCount; i++) { const v = msh.indices[g.firstIndex + i] + g.firstVertex, p = [msh.positions[v * 3], msh.positions[v * 3 + 1], msh.positions[v * 3 + 2]]; t.push(...(gm[gi] ? transformPoint(gm[gi], p) : p)); } return Float32Array.from(t); }); };
for (const nm of names) {
  const idx = sc.meshPaths.findIndex((x) => x.toLowerCase().endsWith(`\\${nm.toLowerCase()}`)), member = memberOf(sc.meshPaths[idx]);
  const key = [...r.files.keys()].find((k) => k.toLowerCase() === member.toLowerCase());
  if (!key) { console.log(nm, 'not replaced'); continue; }
  const A = parseMsh(a.read(a.find(member))), B = parseMsh(r.files.get(key));
  const io = silhouetteIoU(soups(A), soups(B), { size: 512 });
  console.log(`${nm}: ${A.indices.length / 3} -> ${B.indices.length / 3} triangles (${(B.indices.length / A.indices.length).toFixed(1)}x), groups ${A.groups.length}/${B.groups.length}, silhouette IoU min ${io.min.toFixed(3)} mean ${io.mean.toFixed(3)} [${io.iou.map((v) => v.toFixed(3)).join(' ')}]`);
}
console.log('generator log:', r.log.join(' | ') || '-', JSON.stringify(r.stats.sets));
