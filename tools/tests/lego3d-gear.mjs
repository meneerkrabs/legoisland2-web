// LEGO 3D characters generator, gear part (hair / headgear / accessories: tools/lego3d/pack/chars-gear.mjs, src/mods/lego3d/chars/static.ts): every replaced member is generated from the pack and the
// player's archive and checked: parses and validates, same groups (count, flags, GTOM / MATL), triangle budget (<= the original's, HR meshes <= 2x), the bounding box stays close to the original's,
// finite unit normals, UVs inside the original's range per rebuilt group, no degenerate triangles; a foreign (modded) member is left alone. Skips with a note without the pack / game folder.
// Tools held in the claw (round 11, docs/re/lego3d.md section 9): the recipe's grip numbers (handle along the ring's axis, the claws most models use hold it within 0.02), the handle of every
// GENERATED tool measured against the ring the pack records for the claws of its archive (<= 0.06 from the ring's axis, the ring being 0.16 in radius), no vertex normal turned > 60 degrees away from its face.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { parseMsh, validateMsh, groupMatrices } from '../../src/formats/msh.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.join(here, '../../src/mods/lego3d/data/lego3d.pack');
const box = (m) => { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let i = 0; i < m.positions.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], m.positions[i + c]); hi[c] = Math.max(hi[c], m.positions[i + c]); } return { lo, hi }; };

/** a mesh in its bone's frame (every group through its MATL, as the game draws it): triangles as [a, b, c] points */
function boneTris(m) {
  const M = groupMatrices(m), out = [];
  m.groups.forEach((g, gi) => {
    const T = M[gi], P = (v) => { const x = m.positions[v * 3], y = m.positions[v * 3 + 1], z = m.positions[v * 3 + 2]; return T ? [x * T[0] + y * T[4] + z * T[8] + T[12], x * T[1] + y * T[5] + z * T[9] + T[13], x * T[2] + y * T[6] + z * T[10] + T[14]] : [x, y, z]; };
    for (let k = 0; k < g.indexCount; k += 3) out.push([0, 1, 2].map((j) => P(m.indices[g.firstIndex + k + j] + g.firstVertex)));
  });
  return out;
}
/** the handle of a tool inside the ball of 2.6 ring radii around the ring's centre: principal axis + centroid of the surface (every triangle subdivided twice) */
function handleIn(tris, ring) {
  const pts = [];
  for (const [a, b, c] of tris) for (let i = 0; i < 4; i++) for (let j = 0; j < 4 - i; j++) { const u = (i + 0.4) / 4, v = (j + 0.4) / 4, w = 1 - u - v; if (w < 0) continue; const p = [0, 1, 2].map((k) => a[k] * w + b[k] * u + c[k] * v); if (Math.hypot(p[0] - ring.c[0], p[1] - ring.c[1], p[2] - ring.c[2]) <= 2.6 * ring.r) pts.push(p); }
  if (pts.length < 12) return null;
  const mu = [0, 1, 2].map((k) => pts.reduce((q, p) => q + p[k], 0) / pts.length), C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += (p[i] - mu[i]) * (p[j] - mu[j]);
  let v = [1, 0.7, 0.4];
  for (let it = 0; it < 60; it++) { const w = [0, 1, 2].map((i) => C[i][0] * v[0] + C[i][1] * v[1] + C[i][2] * v[2]), l = Math.hypot(...w) || 1; v = w.map((x) => x / l); }
  return { c: mu, a: v };
}

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
    let checked = 0, replaced = 0, worst = 0, tools = 0, worstLat = 0;
    const byKind = {};
    for (const a of ctx.archives) {
      if (!/^z\d\d/i.test(a.name)) continue;
      const r = await generateArchive(pack, a.name, a, async () => null, ['characters']);
      // the tools in the claw (recipes with a `grip`): the bar of every generated tool passes through the ring of a claw of this archive (the tool's own generated .msh measured against the ring that the pack records for the claw)
      const rings = [];
      for (const [member, hashes] of Object.entries(tables.members)) {
        const hk = Object.values(hashes).find((k) => k.startsWith('hand:'));
        if (!hk || !tables.statics[hk].ring || !/_hr[rl]hand\.msh$/i.test(member) || !a.find(member)) continue;
        rings.push(tables.statics[hk].ring);   // the ring of the claw the pack puts on this hand, in the bone's frame
      }
      for (const [member, hashes] of Object.entries(tables.members)) {
        const key = Object.values(hashes).find((k) => tables.statics[k]?.grip); if (!key) continue;
        if (!tables.statics[key].grip.zones.includes(a.name)) continue;   // the tool's file sits in other archives too, held by nobody there
        const hit = a.find(member), out = hit && r.files.get(hit.path); if (!out) continue;
        tools++;
        const tris = boneTris(parseMsh(out)), ests = rings.map((ring) => { const hd = handleIn(tris, ring); if (!hd) return null; const d = hd.c.map((x, i) => x - ring.c[i]), al = d[0] * ring.a[0] + d[1] * ring.a[1] + d[2] * ring.a[2]; return Math.hypot(d[0] - ring.a[0] * al, d[1] - ring.a[1] * al, d[2] - ring.a[2] * al); }).filter((x) => x !== null);
        if (!ests.length) { failures.push(`${a.name} ${member}: no claw ring of this archive reaches the tool's handle (a tool outside the hand)`); continue; }
        const lat = Math.min(...ests); worstLat = Math.max(worstLat, lat);
        if (lat > 0.06) failures.push(`${a.name} ${member}: the handle is ${lat.toFixed(3)} from the ring's axis of the nearest claw ring (limit 0.06; the ring is 0.16 in radius)`);
      }
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
        if (rec?.geoNormals) {   // shaded with its own crease normals: no vertex normal turns away from its own face by more than 60 degrees (the black side of round 11)
          let off = 0;
          for (const g of m1.groups) for (let t = 0; t < g.indexCount; t += 3) {
            const v = [0, 1, 2].map((j) => m1.indices[g.firstIndex + t + j] + g.firstVertex), P = v.map((i) => [m1.positions[i * 3], m1.positions[i * 3 + 1], m1.positions[i * 3 + 2]]);
            const e1 = P[1].map((x, i) => x - P[0][i]), e2 = P[2].map((x, i) => x - P[0][i]), n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(...n) || 1;
            for (const i of v) if ((n[0] * m1.normals[i * 3] + n[1] * m1.normals[i * 3 + 1] + n[2] * m1.normals[i * 3 + 2]) / l < 0.5) off++;
          }
          if (off) failures.push(`${a.name} ${member}: ${off} vertex normals turn more than 60 degrees away from their face`);
        }
        for (let t = 0; t < m1.indices.length; t += 3) {
          const i = [m1.indices[t], m1.indices[t + 1], m1.indices[t + 2]];
          if (i[0] === i[1] || i[1] === i[2] || i[0] === i[2]) { failures.push(`${a.name} ${member}: degenerate triangle ${t / 3}`); break; }
        }
      }
    }
    for (const [k, rec] of gear) {
      if (!rec.grip) continue;
      const main = [...rec.grip.uses].sort((x, y) => y.n - x.n)[0];
      if (rec.grip.angle > 3) failures.push(`${k}: handle ${rec.grip.angle} degrees off the ring's axis`);
      if (!main || main.lat > 0.02 || main.ax > 0.02) failures.push(`${k}: the claws most models use hold it off by lat ${main?.lat} ax ${main?.ax} (limit 0.02)`);
      for (const u of rec.grip.uses) if (u.lat > 0.2 || u.ax > 0.2) failures.push(`${k}: one use (slot ${u.slot}, ${u.n} models) misses the ring by lat ${u.lat} ax ${u.ax}`);
      if (!rec.geoNormals) failures.push(`${k}: a tool in the claw is shaded with its own crease normals (geoNormals)`);
    }
    notes.push(`${tools} tools in the claw: handle to the nearest claw ring at worst ${worstLat.toFixed(3)} (limit 0.06)`);
    notes.push(`${replaced} gear members replaced (${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(', ')}), worst triangle ratio ${worst.toFixed(2)}x, ${gear.length} recipes`);
    return { checked, failures, notes };
  },
};
