#!/usr/bin/env node
// Looks at a brick-built reconstruction offline (software rasteriser, colour = the game's texel colour of the group; translucent groups are drawn too):
//   node tools/lego3d/bldg-view.mjs out.png zone Mesh [--orig] [--pack FILE] [--views 35/25,215/25] [--size 500] [--box x0,y0,z0,x1,y1,z1]
// default: the generated mesh (pack -> generator, the browser's path); --orig the game's own mesh; --box zooms to a world box (close-ups).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive, memberOf, scene, textureOf } from './lib.mjs';
import { parseMsh, groupMatrices } from '../../src/formats/msh.ts';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { renderViews } from './raster.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); if (i < 0) return d; const v = a[i + 1]; a.splice(i, 2); return v; };
const flag = (n) => { const i = a.indexOf(n); if (i < 0) return false; a.splice(i, 1); return true; };
const orig = flag('--orig'), packFile = opt('--pack', path.join(here, '../../src/mods/lego3d/data/lego3d.pack')), size = +opt('--size', 500);
const views = opt('--views', '35/25,215/25,125/30,0/90').split(',').map((s) => { const [az, el] = s.split('/').map(Number); return { az, el: el ?? 0 }; });
const box = opt('--box', null)?.split(',').map(Number);
const [out, zone, nm] = a;
const arch = archive(zone), sc = scene(zone);
const idx = sc.meshPaths.findIndex((x) => x.toLowerCase().endsWith(`\\${nm.toLowerCase()}.msh`)), member = memberOf(sc.meshPaths[idx]);
const model = sc.models.find((m) => m.parts.some((p) => p && p.mesh === idx)), part = model.parts.find((p) => p && p.mesh === idx), tl = sc.texLists[part.texList];
let bytes = arch.read(arch.find(member));
if (!orig) {
  const pack = Pack.open(new Uint8Array(fs.readFileSync(packFile)));
  const r = await generateArchive(pack, zone, arch, async () => null, ['sets']);
  const key = [...r.files.keys()].find((k) => k.toLowerCase() === member.toLowerCase());
  if (key) bytes = r.files.get(key); else console.log('not replaced');
}
const m = parseMsh(bytes), gm = groupMatrices(m);
const xf = (M, p) => (M ? [p[0] * M[0] + p[1] * M[4] + p[2] * M[8] + M[12], p[0] * M[1] + p[1] * M[5] + p[2] * M[9] + M[13], p[0] * M[2] + p[1] * M[6] + p[2] * M[10] + M[14]] : p);
const parts = m.groups.map((g, gi) => {
  const pos = new Float32Array(g.vertexCount * 3);
  for (let v = 0; v < g.vertexCount; v++) { const p = xf(gm[gi], [m.positions[(g.firstVertex + v) * 3], m.positions[(g.firstVertex + v) * 3 + 1], m.positions[(g.firstVertex + v) * 3 + 2]]); pos.set(p, v * 3); }
  const t = textureOf(arch, tl[gi] ?? -1); const c = t ? [t.rgba[0], t.rgba[1], t.rgba[2]] : [160, 160, 160];
  return { pos, idx: Array.from(m.indices.subarray(g.firstIndex, g.firstIndex + g.indexCount)).map((i) => i), color: c };
});
console.log(`${nm}: ${m.indices.length / 3} triangles`);
renderViews(out, parts, { views, size, bbox: box ? { lo: box.slice(0, 3), hi: box.slice(3) } : null });
