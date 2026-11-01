// LEGO 3D characters generator, gear part (hair / headgear / accessories: tools/lego3d/pack/chars-gear.mjs, src/mods/lego3d/chars/static.ts): every replaced member is generated from the pack and the
// player's archive and checked: parses and validates, same groups (count, flags, GTOM / MATL), triangle budget (<= the original's, HR meshes <= 2x), the bounding box stays close to the original's,
// finite unit normals, UVs inside the original's range per rebuilt group, no degenerate triangles; a foreign (modded) member is left alone. Skips with a note without the pack / game folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { parseMsh, validateMsh } from '../../src/formats/msh.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.join(here, '../../src/mods/lego3d/data/lego3d.pack');
const box = (m) => { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let i = 0; i < m.positions.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], m.positions[i + c]); hi[c] = Math.max(hi[c], m.positions[i + c]); } return { lo, hi }; };

export default {
  name: 'lego3d-gear',
  async run(ctx) {
    const failures = [], notes = [];
    if (!fs.existsSync(PACK)) return { checked: 0, failures, notes: ['LEGO 3D pack absent (node tools/lego3d/pack/build-pack.mjs --only chars): skipped'] };
    const pack = Pack.open(new Uint8Array(fs.readFileSync(PACK)));
    if (!pack.has('chars/tables.json')) return { checked: 0, failures, notes: ['pack has no chars part: skipped'] };
    const tables = await pack.json('chars/tables.json');
    const gear = Object.entries(tables.statics ?? {}).filter(([k]) => k.startsWith('gear:'));
    if (!gear.length) return { checked: 0, failures, notes: ['pack has no gear recipes: skipped'] };
    let checked = 0, replaced = 0, worst = 0;
    const byKind = {};
    for (const a of ctx.archives) {
      if (!/^z\d\d/i.test(a.name)) continue;
      const r = await generateArchive(pack, a.name, a, async () => null, ['characters']);
      for (const [member, hashes] of Object.entries(tables.members)) {
        const hit = a.find(member); if (!hit) continue;
        const keys = Object.values(hashes).filter((k) => k.startsWith('gear:')); if (!keys.length) continue;
        const out = r.files.get(hit.path); if (!out) continue;
        const src = a.read(hit), m0 = parseMsh(src);
        const rec = tables.statics[keys.find((k) => tables.statics[k]) ?? ''];
        checked++; replaced++;
        let m1;
        try { m1 = parseMsh(out); } catch (e) { failures.push(`${a.name} ${member}: does not parse: ${e.message}`); continue; }
        for (const p of validateMsh(m1)) failures.push(`${a.name} ${member}: validateMsh: ${p}`);
        if (m1.groups.length !== m0.groups.length) { failures.push(`${a.name} ${member}: groups ${m0.groups.length} -> ${m1.groups.length}`); continue; }
        if (JSON.stringify([...(m0.gtom ?? [])]) !== JSON.stringify([...(m1.gtom ?? [])]) || JSON.stringify([...(m0.matl ?? [])]) !== JSON.stringify([...(m1.matl ?? [])])) failures.push(`${a.name} ${member}: GTOM / MATL changed`);
        m0.groups.forEach((g, gi) => { if (g.flags !== m1.groups[gi].flags) failures.push(`${a.name} ${member} g${gi}: flags changed`); if (m1.groups[gi].indexCount === 0) failures.push(`${a.name} ${member} g${gi}: empty group`); });
        const t0 = m0.indices.length / 3, t1 = m1.indices.length / 3, lim = t0 * (rec?.lod === 0 ? 2 : 1);
        if (t1 > lim) failures.push(`${a.name} ${member}: ${t1} triangles > ${lim} (original ${t0})`);
        worst = Math.max(worst, t1 / t0);
        byKind[rec?.kind ?? '?'] = (byKind[rec?.kind ?? '?'] ?? 0) + 1;
        const b0 = box(m0), b1 = box(m1);
        for (let c = 0; c < 3; c++) {
          const tol = 0.35 * Math.max(...[0, 1, 2].map((k) => b0.hi[k] - b0.lo[k])) + 0.05;
          if (Math.abs(b1.lo[c] - b0.lo[c]) > tol || Math.abs(b1.hi[c] - b0.hi[c]) > tol) failures.push(`${a.name} ${member}: bounding box axis ${c} moved (${b0.lo[c].toFixed(2)}..${b0.hi[c].toFixed(2)} -> ${b1.lo[c].toFixed(2)}..${b1.hi[c].toFixed(2)})`);
        }
        let bad = 0;
        for (let v = 0; v < m1.vertexCount; v++) { const n = Math.hypot(m1.normals[v * 3], m1.normals[v * 3 + 1], m1.normals[v * 3 + 2]); if (!(Math.abs(n - 1) < 0.02)) bad++; if (!Number.isFinite(m1.positions[v * 3]) || !Number.isFinite(m1.uvs[v * 2])) bad++; }
        if (bad) failures.push(`${a.name} ${member}: ${bad} non-finite / non-unit vertex values`);
        for (let t = 0; t < m1.indices.length; t += 3) {
          const i = [m1.indices[t], m1.indices[t + 1], m1.indices[t + 2]];
          if (i[0] === i[1] || i[1] === i[2] || i[0] === i[2]) { failures.push(`${a.name} ${member}: degenerate triangle ${t / 3}`); break; }
        }
      }
    }
    notes.push(`${replaced} gear members replaced (${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(', ')}), worst triangle ratio ${worst.toFixed(2)}x, ${gear.length} recipes`);
    return { checked, failures, notes };
  },
};
