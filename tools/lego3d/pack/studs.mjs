// Pack builder "studs" (docs/re/lego3d.md): per zone archive the TABLE of which meshes carry a painted stud-plate texture on which groups, so the assembler (src/mods/lego3d/gen/studs.ts)
// can bake real studs into the player's own meshes at run time. The table holds the member name and the FNV-1a hash of the game's mesh (a name, not content), the group indices and
// texture ids, the stud lattice of each stud texture (studs per tile and offset: numbers measured by the textures builder) and the part's switch-in distance. No vertex, UV or
// triangle of the game is stored. Needs the textures part (run `--only textures` first): the lattice of a texture is its measured phase.
//   node tools/lego3d/pack/build-pack.mjs --only studs
import fs from 'node:fs';
import path from 'node:path';
import { archive, archiveNames, scene, memberOf, WORK } from '../lib.mjs';
import { fnv1a } from '../../../src/mods/lego3d/gen/surf.ts';

const SPAN = { plain: 1, ring: 1, cross: 2, shaded: 1 };

export async function build(ctx) {
  const texDir = path.join(WORK, 'pack-parts/textures/files/textures/arch');
  if (!fs.existsSync(texDir)) throw new Error('run the textures builder first (node tools/lego3d/pack/build-pack.mjs --only textures)');
  let nMesh = 0, nGroups = 0, conflicts = 0;
  const report = [];
  for (const an of archiveNames()) {
    if (!/^z\d\d/i.test(an)) continue;
    const tf = path.join(texDir, `${an.toLowerCase()}.json`);
    if (!fs.existsSync(tf)) continue;
    const tex = {};
    for (const e of JSON.parse(fs.readFileSync(tf, 'utf8')).entries) {
      if (!(e.d in SPAN)) continue;
      tex[e.id] = [e.nu * SPAN[e.d], e.nv * SPAN[e.d], +(e.pu / e.nu).toFixed(5), +(e.pv / e.nv).toFixed(5)];
    }
    let sc; try { sc = scene(an); } catch { continue; }
    const arch = archive(an);
    const uses = new Map();   // member (lower) -> { member, groups: Map(gi -> Set(tex)), l, single }
    const visit = (part, model) => {
      const mp = sc.meshPaths[part.mesh]; if (!mp) return;
      const member = memberOf(mp), key = member.toLowerCase();
      const tl = sc.texLists[part.texList] ?? [];
      let u = uses.get(key); if (!u) { u = { member, groups: new Map(), l: 1e9, single: true }; uses.set(key, u); }
      tl.forEach((t, gi) => { let s = u.groups.get(gi); if (!s) u.groups.set(gi, s = new Set()); s.add(t); });
      u.l = Math.min(u.l, part.lod ?? 0);
      if (model.parts.filter(Boolean).length > 1) u.single = false;
    };
    for (const model of sc.models) { for (const p of model.parts) if (p) visit(p, model); for (const a of model.attach) if (a) for (const p of a.child.parts) if (p) visit(p, a.child); }
    const meshes = [];
    for (const u of uses.values()) {
      const g = [];
      for (const [gi, set] of [...u.groups].sort((a, b) => a[0] - b[0])) {
        const studIds = [...set].filter((t) => tex[t]);
        if (!studIds.length) continue;
        if (set.size > 1) { conflicts++; report.push(`${an} ${u.member} group ${gi}: textures ${[...set].join(',')} (one of them a stud plate) - left out`); continue; }
        g.push([gi, studIds[0]]);
      }
      if (!g.length) continue;
      const e = arch.find(u.member); if (!e) continue;
      meshes.push({ m: e.path, h: fnv1a(arch.read(e)), g, l: u.l === 1e9 ? 0 : u.l, s: u.single ? 1 : 0 });
      nGroups += g.length;
    }
    if (!meshes.length) continue;
    meshes.sort((a, b) => (a.m < b.m ? -1 : 1));
    ctx.put(`studs/arch/${an.toLowerCase()}.json`, JSON.stringify({ v: 1, archive: an, tex, meshes }));
    nMesh += meshes.length;
  }
  fs.writeFileSync(path.join(WORK, 'studs-report.txt'), report.join('\n'));
  ctx.log(`${nMesh} meshes, ${nGroups} stud groups, ${conflicts} conflicting groups left out`);
}
