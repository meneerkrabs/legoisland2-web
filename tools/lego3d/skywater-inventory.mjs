#!/usr/bin/env node
// Sky / sea / foam / flowing-water inventory of the LEGO 3D option: every record of every zone whose name or mesh says sky, sea, seabed, foam or water, with its meshes (triangles, groups), the texture of each group
// (size, mean alpha, mean colour) and what the generators write over it (member replaced? texture replaced?). Output answers: "what does the option touch of the sky and the water?"
//   node tools/lego3d/skywater-inventory.mjs [--zones z02LGI,...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive, archiveNames, memberOf, scene, textureOf } from './lib.mjs';
import { parseMsh } from '../../src/formats/msh.ts';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2); const zi = a.indexOf('--zones'); const only = zi >= 0 ? a[zi + 1].split(',') : [];
const NAME = /^(SSKY|SSEA|SEAB|SEAE|SKY\d?|SKY_|SEA\w?|WATR|WATE|RIVR|FALL|LAVA|WASH|FOAM)$/i;
const FILE = /sky|sea|wash|foam|water|river|fall|lava|pplane|horizon|cloud|star|moon|sun/i;
const pack = Pack.open(new Uint8Array(fs.readFileSync(path.join(here, '../../src/mods/lego3d/data/lego3d.pack'))));
for (const z of archiveNames().filter((n) => /^z\d/.test(n))) {
  if (only.length && !only.includes(z)) continue;
  let sc; try { sc = scene(z); } catch { continue; }
  const arch = archive(z);
  const gen = await generateArchive(pack, z, arch, async () => null, []);
  const genKey = (m) => [...gen.files.keys()].find((x) => x.toLowerCase() === m.toLowerCase());
  const seen = new Set();
  for (const r of sc.records) {
    if (!r.model) continue;
    const parts = r.model.parts.filter(Boolean);
    const files = parts.map((p) => (sc.meshPaths[p.mesh] ?? '').replace(/^.*[\\/]/, ''));
    if (!NAME.test(r.name.trim()) && !files.some((f) => FILE.test(f))) continue;
    const key = r.name.trim() + files.join(',');
    if (seen.has(key)) continue; seen.add(key);
    const out = [];
    for (const p of parts) {
      const path_ = sc.meshPaths[p.mesh]; const member = memberOf(path_); const e = arch.find(member); if (!e) { out.push(`${path_}: missing`); continue; }
      const m = parseMsh(arch.read(e)); const tl = sc.texLists[p.texList] ?? [];
      const mk = genKey(member);
      const gs = m.groups.map((g, gi) => {
        const id = tl[gi]; const t = id != null ? textureOf(arch, id) : null;
        let al = 0, rr = 0, gg = 0, bb = 0, n = 0; if (t) { for (let i = 0; i < t.rgba.length; i += 4) { rr += t.rgba[i]; gg += t.rgba[i + 1]; bb += t.rgba[i + 2]; al += t.rgba[i + 3]; n++; } }
        const tg = id != null ? [`textures/Text${String(id).padStart(3, '0')}.tga`, `textures/text${String(id).padStart(3, '0')}.tga`].map(genKey).find(Boolean) : null;
        return `g${gi}:${g.indexCount / 3}t tex${id ?? '-'}${t ? ` ${t.width}x${t.height} a${(al / n) | 0} rgb(${(rr / n) | 0},${(gg / n) | 0},${(bb / n) | 0})` : ''} fl${g.flags}${tg ? ` TEXREPL(${gen.by.get(tg)})` : ''}`;
      });
      out.push(`  lod${p.lod} ${path_.replace(/^.*[\\/]/, '')} ${m.indices.length / 3}t${mk ? ` MESHREPL(${gen.by.get(mk)})` : ''} [${gs.join('; ')}]`);
    }
    console.log(`${z} #${r.index} ${r.name.trim()}\n${out.join('\n')}`);
  }
}
