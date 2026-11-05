#!/usr/bin/env node
// Environment inventory of the LEGO 3D option (docs/re/lego3d.md section 19): every vegetation and rock record of every zone (trees, palms, bushes, flowers, reeds, seaweed, cacti, boulders, rock faces, caves, crystals,
// mushrooms, vines, lily pads ...) grouped by category and by the mesh set of its model, with the game's LOD meshes (switch-in distance, triangles, vertices, groups, the texture each group uses, alpha cut-outs) and what
// the generators write over each one (pack -> generator, the browser's path: `by` = generator, triangles after) and which of the group textures the `textures` generator replaces.
//   node tools/lego3d/env-inventory.mjs [--md] [--json out.json] [--zones z02LGI,...] [--opts -plants]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive, archiveNames, memberOf, scene, textureOf } from './lib.mjs';
import { parseMsh } from '../../src/formats/msh.ts';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { hashMember } from '../../src/mods/lego3d/meshpack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const ji = args.indexOf('--json'); const jsonOut = ji >= 0 ? args.splice(ji, 2)[1] : null;
const zi = args.indexOf('--zones'); const zonesOnly = zi >= 0 ? args.splice(zi, 2)[1].split(',') : [];
const md = args.includes('--md');
const oi = args.indexOf('--opts'); const genOpts = oi >= 0 ? args.splice(oi, 2)[1].split(',') : [];   // generator switches like the option's ?lego3d=: e.g. -plants (the build without the plants generator)
/** category by the LOD 0 mesh file name (first match wins) */
export const CATS = [
  ['pine', /pinetree|^pine_/i], ['oak', /oaktree/i], ['palm', /palm/i], ['tree parts', /^tree_|canopy_|terrain_fronds/i], ['bush', /bush/i], ['flower', /^flow|flower|^fat_flow|^leaf_/i],
  ['reed', /bullrush/i], ['seaweed', /^(weed|weet|weid)/i], ['lily pad', /lilypad/i], ['vine', /vine/i], ['grass', /grass_edge|tumble_sprite/i],
  ['cactus', /cactus|^cd\d|^cl\d|cacspin|smashedcac/i], ['mushroom', /mushroom/i], ['crystal', /crystal|^crys_/i], ['bamboo', /bamboo|bammboo/i],
  ['boulder / rock', /rock|bolder|boulder|^bol\d/i], ['rock mass', /caves\.|volcano|^volc_|^volv_|^range_|terrain_main|^stump|^logs_|swing_log/i], ['haystack', /haystack/i], ['fruit', /coconut|pineapple|^bann|banann|^meln|melon/i],
];
const catOf = (f) => (CATS.find(([, re]) => re.test(f)) ?? [null])[0];
const pack = Pack.open(new Uint8Array(fs.readFileSync(path.join(here, '../../src/mods/lego3d/data/lego3d.pack'))));
const rows = [];
for (const z of archiveNames().filter((n) => /^z\d/.test(n))) {
  if (zonesOnly.length && !zonesOnly.includes(z)) continue;
  let sc; try { sc = scene(z); } catch { continue; }
  const arch = archive(z);
  const gen = await generateArchive(pack, z, arch, async () => null, genOpts);
  const genKey = (m) => [...gen.files.keys()].find((x) => x.toLowerCase() === m.toLowerCase());
  const seen = new Map();
  for (const r of sc.records) {
    if (!r.model) continue;
    const parts = r.model.parts.filter(Boolean).map((p) => ({ lod: p.lod, texList: p.texList, path: sc.meshPaths[p.mesh], file: (sc.meshPaths[p.mesh] ?? '').replace(/^.*[\\/]/, '') }));
    if (!parts.length) continue;
    const cat = catOf(parts[0].file); if (!cat) continue;
    const key = parts.map((p) => p.file).join(',');
    if (seen.has(key)) { const s = seen.get(key); s.count++; if (!s.records.includes(r.name.trim())) s.records.push(r.name.trim()); s.sample.push(r.index); continue; }
    const lods = parts.map((p) => {
      const member = memberOf(p.path), e = arch.find(member);
      const o = { lod: p.lod, file: p.file, hash: null, tris: null, verts: null, groups: [], after: null, by: null, afterTris: null, box: null };
      if (e) {
        const bytes = arch.read(e); o.hash = hashMember(bytes);
        const m = parseMsh(bytes); o.tris = m.indices.length / 3; o.verts = m.vertexCount;
        const tl = sc.texLists[p.texList] ?? [];
        { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let i = 0; i < m.vertexCount; i++) for (let c = 0; c < 3; c++) { const v = m.positions[i * 3 + c]; if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; } o.box = hi.map((h, c) => +(h - lo[c]).toFixed(2)); o.lo = lo.map((v) => +v.toFixed(2)); }
        m.groups.forEach((g, gi) => {
          const id = tl[gi]; const t = id != null ? textureOf(arch, id) : null;
          let cut = null, size = null;
          if (t) { let n = 0; for (let i = 3; i < t.rgba.length; i += 4) if (t.rgba[i] < 250) n++; cut = +(n / (t.rgba.length / 4)).toFixed(2); size = `${t.width}x${t.height}`; }
          const tg = id != null ? [`textures/Text${String(id).padStart(3, '0')}.tga`, `textures/text${String(id).padStart(3, '0')}.tga`].map(genKey).find(Boolean) : null;
          o.groups.push({ tris: g.indexCount / 3, flags: g.flags, tex: id ?? null, size, cut, texBy: tg ? gen.by.get(tg) : null });
        });
        o.moving = !!(m.gtom && m.matl);
        const k = genKey(member);
        if (k) { const mm = parseMsh(gen.files.get(k)); o.afterTris = mm.indices.length / 3; o.by = gen.by.get(k); }
      }
      return o;
    });
    const row = { zone: z, cat, records: [r.name.trim()], count: 1, sample: [r.index], att: r.model.attach.length, lods };
    seen.set(key, row); rows.push(row);
  }
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
const sumBy = (rows) => { const c = {}; for (const r of rows) for (const l of r.lods) { c[l.by ?? 'none'] = (c[l.by ?? 'none'] ?? 0) + 1; } return c; };
if (md) {
  console.log('| category | zone | records (n) | LODs: dist: mesh tris/verts (groups: tex, cutout share) | generators on it |\n|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.cat} | ${r.zone} | ${r.records.slice(0, 3).join(' ')}${r.records.length > 3 ? ` +${r.records.length - 3}` : ''} (${r.count}) | ${r.lods.map((l) => `${l.lod}: ${l.file} ${l.tris}/${l.verts} ${l.box ? l.box.join('x') : ''} (${l.groups.map((g) => `${g.tex}${g.cut ? ` c${g.cut}` : ''}${g.flags & 2 ? ' T' : ''}`).join(',')})`).join('; ')} | ${r.lods.map((l) => (l.by ? `${l.by}->${l.afterTris}` : '-')).join(' ')}${r.lods.some((l) => l.groups.some((g) => g.texBy)) ? ' tex:' + [...new Set(r.lods.flatMap((l) => l.groups.filter((g) => g.texBy).map((g) => g.tex)))].join(',') : ''} |`);
} else for (const r of rows) console.log(r.zone, r.cat.padEnd(14), r.records.join(',').padEnd(18), r.count, r.lods.map((l) => `${l.lod}:${l.file}:${l.tris}${l.by ? '->' + l.afterTris + l.by : ''}`).join(' '));
console.error('rows', rows.length, 'distinct meshes (by LOD0 file)', new Set(rows.map((r) => r.lods[0].file.toLowerCase())).size, 'generator hits on LODs', JSON.stringify(sumBy(rows)));
