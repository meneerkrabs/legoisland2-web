#!/usr/bin/env node
// Looks at character meshes (original or the mod's through LE2_MODS) in any pose, coloured by group (texture median colour when the texture is flat):
//   [LE2_MODS=dir] node tools/lego3d/viewmesh.mjs out.png zone model-regexp [--lod 0] [--pose clip:frame] [--views 0,90,180,35/20] [--size 400] [--back]
// `model-regexp` picks the first model of the zone whose first part mesh matches; body + attachments are drawn with the bind (or posed) bone matrices.
import { scene, archive, textureOf } from './lib.mjs';
import { modelParts, baseName } from './modelio.mjs';
import { renderViews } from './raster.mjs';
const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); if (i < 0) return d; const v = a[i + 1]; a.splice(i, 2); return v; };
const li = +opt('--lod', 0), size = +opt('--size', 400), pose = opt('--pose', '') ? opt('--pose', '').split(':').map(Number) : null;
const views = opt('--views', '0,90,180,35/20').split(',').map((s) => { const [az, el] = s.split('/').map(Number); return { az, el: el ?? 0 }; });
const back = a.includes('--back'); if (back) a.splice(a.indexOf('--back'), 1);
const [out, zone, rx] = a;
const sc = scene(zone), re = new RegExp(rx, 'i'), arch = archive(zone);
const model = sc.models.find((m) => m.parts.some((p) => re.test(baseName(sc.meshPaths[p.mesh] ?? ''))));
if (!model) { console.error('no model'); process.exit(1); }
const parts = modelParts(zone, model, li, sc, pose);
const PAL = [[200, 60, 60], [60, 140, 220], [230, 200, 60], [90, 190, 90], [180, 90, 200], [240, 140, 50], [120, 120, 120], [60, 200, 200], [240, 120, 160]];
const median = (g) => { const t = textureOf(arch, g.tex); if (!t) return null; const n = t.width * t.height, r = [], gg = [], b = []; for (let i = 0; i < n; i += Math.max(1, n >> 9)) { r.push(t.rgba[i * 4]); gg.push(t.rgba[i * 4 + 1]); b.push(t.rgba[i * 4 + 2]); } const m = (x) => x.sort((p, q) => p - q)[x.length >> 1]; return [m(r), m(gg), m(b)]; };
const rparts = parts.map((p) => {
  const cols = new Array(p.indices.length / 3);
  p.groups.forEach((g, gi) => { const c = (g.tex >= 0 ? median(g) : null) ?? PAL[gi % PAL.length]; for (let t = g.first / 3; t < (g.first + g.count) / 3; t++) cols[t] = c; });
  return { pos: p.positions, idx: p.indices, color: (t) => cols[t] ?? [200, 200, 200] };
});
renderViews(out, rparts, { views, size, showBack: true });
console.log('wrote', out, parts.map((p) => `${p.name}:${p.indices.length / 3}t`).join(' '));
