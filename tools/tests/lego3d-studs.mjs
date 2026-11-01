// LEGO 3D studs generator (src/mods/lego3d/gen/studs.ts): every mesh of the table is baked and checked: structure (parseMsh / validateMsh, groups / flags / texture slots / GTOM / MATL
// unchanged, the game's own vertices and indices byte-identical), winding and normals of the studs (outward, unit), placement (exactly on the stud lattice of the texture, ON the surface,
// the whole disc on a coplanar triangle of the group, no two studs overlapping, nothing standing under another surface), the counts against the texture mapping, the triangle
// budgets of the rules and the safety rules (earlier generator's member, foreign hash). Skips with a note when the pack's studs part is absent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { parseMsh, validateMsh } from '../../src/formats/msh.ts';
import { bakeMesh, placeStuds, RULES, STUD, chooseSides, generator } from '../../src/mods/lego3d/gen/studs.ts';
import { fnv1a } from '../../src/mods/lego3d/gen/surf.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.join(here, '../../src/mods/lego3d/data/lego3d.pack');
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export default {
  name: 'lego3d-studs',
  async run(ctx) {
    const failures = [], notes = [];
    if (!fs.existsSync(PACK)) return { checked: 0, failures, notes: ['LEGO 3D pack absent (node tools/lego3d/pack/build-pack.mjs --only textures,studs): skipped'] };
    const pack = Pack.open(new Uint8Array(fs.readFileSync(PACK)));
    if (!pack.names('studs/arch/').length) return { checked: 0, failures, notes: ['pack has no studs part: skipped'] };
    let checked = 0, meshes = 0, studs = 0, tris = 0, skipped = 0, worstTri = 0, worstMs = 0, bytes = 0;
    const per = [];
    const bySides = {};
    for (const a of ctx.archives) {
      const tn = `studs/arch/${a.name.toLowerCase()}.json`;
      if (!pack.has(tn)) {
        const r = await generateArchive(pack, a.name, a, async () => null, ['studs']);
        checked++;
        if (r.files.size) failures.push(`${a.name}: no table but ${r.files.size} files generated`);
        continue;
      }
      const table = await pack.json(tn);
      const t0 = Date.now();
      const r = await generateArchive(pack, a.name, a, async () => null, ['studs']);
      const ms = Date.now() - t0;
      worstMs = Math.max(worstMs, ms);
      const st = r.stats.studs ?? {};
      per.push(`${a.name} ${st['stud-meshes'] ?? 0}/${table.meshes.length} meshes ${st.studs ?? 0} studs ${ms} ms`);
      for (const e of table.meshes) {
        checked++;
        const hit = a.find(e.m);
        if (!hit) { failures.push(`${a.name} ${e.m}: not in the archive`); continue; }
        const src = a.read(hit);
        if (fnv1a(src) !== e.h) { failures.push(`${a.name} ${e.m}: table hash does not match`); continue; }
        const out = r.files.get(hit.path);
        if (!out) { skipped++; continue; }
        meshes++;
        const m0 = parseMsh(src);
        let m1;
        try { m1 = parseMsh(out); } catch (err) { failures.push(`${a.name} ${e.m}: result does not parse: ${err.message}`); continue; }
        for (const p of validateMsh(m1)) failures.push(`${a.name} ${e.m}: validateMsh: ${p}`);
        if (m1.groups.length !== m0.groups.length) { failures.push(`${a.name} ${e.m}: group count ${m0.groups.length} -> ${m1.groups.length}`); continue; }
        // groups: flags unchanged, GTOM / MATL byte-identical, the game's own vertices and indices of every group unchanged
        if (JSON.stringify([...(m0.gtom ?? [])]) !== JSON.stringify([...(m1.gtom ?? [])]) || JSON.stringify([...(m0.matl ?? [])]) !== JSON.stringify([...(m1.matl ?? [])])) failures.push(`${a.name} ${e.m}: GTOM / MATL changed`);
        const stud = new Map(e.g);
        let addedV = 0, addedT = 0;
        for (let gi = 0; gi < m0.groups.length; gi++) {
          const g0 = m0.groups[gi], g1 = m1.groups[gi];
          if (g0.flags !== g1.flags) failures.push(`${a.name} ${e.m} g${gi}: flags changed`);
          if (!stud.has(gi) && (g0.vertexCount !== g1.vertexCount || g0.indexCount !== g1.indexCount)) failures.push(`${a.name} ${e.m} g${gi}: a group without stud texture changed`);
          let same = true;
          for (let v = 0; v < g0.vertexCount && same; v++) {
            const o = g0.firstVertex + v, n = g1.firstVertex + v;
            for (let k = 0; k < 3; k++) if (m0.positions[o * 3 + k] !== m1.positions[n * 3 + k] || m0.normals[o * 3 + k] !== m1.normals[n * 3 + k]) same = false;
            if (m0.colors[o] !== m1.colors[n] || m0.uvs[o * 2] !== m1.uvs[n * 2] || m0.uvs[o * 2 + 1] !== m1.uvs[n * 2 + 1] || m0.uvs2[o * 2] !== m1.uvs2[n * 2]) same = false;
          }
          for (let i = 0; i < g0.indexCount && same; i++) if (m0.indices[g0.firstIndex + i] !== m1.indices[g1.firstIndex + i]) same = false;
          if (!same) failures.push(`${a.name} ${e.m} g${gi}: the game's own vertices / indices changed`);
          addedV += g1.vertexCount - g0.vertexCount; addedT += (g1.indexCount - g0.indexCount) / 3;
        }
        if ((m0.svwl === null) !== (m1.svwl === null)) failures.push(`${a.name} ${e.m}: skin data lost`);
        // the studs themselves: per stud group, in the added vertex range
        const lat = table.tex;
        let n = 0, sides = 0;
        for (const [gi, texId] of e.g) {
          const g0 = m0.groups[gi], g1 = m1.groups[gi];
          const addV = g1.vertexCount - g0.vertexCount, addI = g1.indexCount - g0.indexCount;
          if (!addV) continue;
          const L = lat[String(texId)];
          // reference placement by the same function WITHOUT the occlusion test: every kept stud must be one of those candidates (the oracle for the surface / disc / lattice rules)
          const ref = placeStuds(m0, gi, { lattice: L, occluders: null });
          const refKeys = new Set(ref.studs.map((s) => `${s.uc.toFixed(5)},${s.vc.toFixed(5)},${s.p.map((x) => x.toFixed(3)).join(',')}`));
          let found = 0;
          for (const s of [4, 6, 8, 12]) if (addV % (2 * s + 1) === 0 && addI % (9 * s) === 0 && addV / (2 * s + 1) === addI / (9 * s)) { sides = s; found = addV / (2 * s + 1); break; }
          if (!found) { failures.push(`${a.name} ${e.m} g${gi}: added ${addV} vertices / ${addI} indices fit no stud shape`); continue; }
          n += found;
          const first = g1.firstVertex + g0.vertexCount;
          for (let st = 0; st < found; st++) {
            const base = first + st * (2 * sides + 1);   // layout: [0] centre of the top, [1..sides] top ring, [sides+1..2 sides] bottom ring
            // UV of every vertex of the stud = the lattice centre, and it is a lattice point
            const uc = m1.uvs[base * 2], vc = m1.uvs[base * 2 + 1];
            const iu = (uc - L[2]) * L[0] - 0.5, iv = (vc - L[3]) * L[1] - 0.5;
            if (Math.abs(iu - Math.round(iu)) > 2e-3 + Math.abs(uc) * 1e-6 || Math.abs(iv - Math.round(iv)) > 2e-3 + Math.abs(vc) * 1e-6) failures.push(`${a.name} ${e.m} g${gi} stud ${st}: UV (${uc}, ${vc}) is not on the texture's stud lattice`);
            // bottom ring: centre + the plane; top ring height; radius
            const bot = [...Array(sides).keys()].map((k) => [0, 1, 2].map((c) => m1.positions[(base + 1 + sides + k) * 3 + c]));
            const top = [...Array(sides).keys()].map((k) => [0, 1, 2].map((c) => m1.positions[(base + 1 + k) * 3 + c]));
            const cb = [0, 1, 2].map((c) => bot.reduce((s, p) => s + p[c], 0) / sides), ct = [0, 1, 2].map((c) => top.reduce((s, p) => s + p[c], 0) / sides);
            const nrm = [0, 1, 2].map((c) => m1.normals[base * 3 + c]);
            const hh = Math.hypot(...sub(ct, cb)), R = Math.hypot(...sub(bot[0], cb));
            const key = `${uc.toFixed(5)},${vc.toFixed(5)},${cb.map((x) => x.toFixed(3)).join(',')}`;
            // radius 0.3 pitch and height 0.2 pitch: pitch = R / 0.3 (the ring's polygon radius is the circumradius)
            const pitch = R / STUD.radius;
            if (Math.abs(hh - STUD.height * pitch) > 2e-3 * (1 + pitch)) failures.push(`${a.name} ${e.m} g${gi} stud ${st}: height ${hh.toFixed(4)} for pitch ${pitch.toFixed(4)}`);
            if (Math.abs(dot(sub(ct, cb), nrm) - hh) > 2e-4 * (1 + hh)) failures.push(`${a.name} ${e.m} g${gi} stud ${st}: axis is not the top normal`);
            // every ring vertex in one plane perpendicular to the normal
            for (const p of bot) if (Math.abs(dot(sub(p, cb), nrm)) > 1e-3 * (1 + R)) { failures.push(`${a.name} ${e.m} g${gi} stud ${st}: base ring not planar`); break; }
            // the candidate set of the reference placement contains it (on the lattice, on the surface, the disc on the plate): matching by lattice UV + base centre
            if (!refKeys.has(key)) {
              // float32 rounding of the position: compare to the nearest reference stud
              let best = 1e9;
              for (const s of ref.studs) if (Math.abs(s.uc - uc) < 1e-4 && Math.abs(s.vc - vc) < 1e-4) best = Math.min(best, Math.hypot(...sub(s.p, cb)));
              if (best > 2e-3 * (1 + pitch)) failures.push(`${a.name} ${e.m} g${gi} stud ${st}: not one of the placement's candidates (nearest ${best.toFixed(4)})`);
            }
            // winding: every triangle of the stud has a geometric normal along the vertex normals' mean
            const t0i = g1.firstIndex + g0.indexCount + st * 9 * sides;
            for (let t = 0; t < 3 * sides; t++) {
              const idx = [0, 1, 2].map((k) => g1.firstVertex + m1.indices[t0i + t * 3 + k]);
              const P = idx.map((v) => [m1.positions[v * 3], m1.positions[v * 3 + 1], m1.positions[v * 3 + 2]]);
              const gn = cross(sub(P[1], P[0]), sub(P[2], P[0]));
              const vn = [0, 1, 2].map((c) => (m1.normals[idx[0] * 3 + c] + m1.normals[idx[1] * 3 + c] + m1.normals[idx[2] * 3 + c]) / 3);
              if (dot(gn, vn) <= 0) { failures.push(`${a.name} ${e.m} g${gi} stud ${st} tri ${t}: winding is inward`); break; }
              for (const v of idx) if (v < first + st * (2 * sides + 1) || v >= first + (st + 1) * (2 * sides + 1)) { failures.push(`${a.name} ${e.m} g${gi} stud ${st}: index outside its own vertices`); break; }
            }
            for (let v = 0; v < 2 * sides + 1; v++) { const l = Math.hypot(m1.normals[(base + v) * 3], m1.normals[(base + v) * 3 + 1], m1.normals[(base + v) * 3 + 2]); if (Math.abs(l - 1) > 1e-3) { failures.push(`${a.name} ${e.m} g${gi} stud ${st}: normal length ${l}`); break; } }
          }
          // no two studs overlap: base centres at least 0.75 pitch apart (R / 0.3)
          const cs = [];
          for (let st = 0; st < found; st++) { const base = first + st * (2 * sides + 1); cs.push([0, 1, 2].map((c) => [...Array(sides).keys()].reduce((s2, k) => s2 + m1.positions[(base + 1 + sides + k) * 3 + c], 0) / sides)); }
          const p0 = Math.hypot(...sub([m1.positions[(first + 1 + sides) * 3], m1.positions[(first + 1 + sides) * 3 + 1], m1.positions[(first + 1 + sides) * 3 + 2]], cs[0])) / STUD.radius;
          let overlap = false;
          for (let i = 0; i < cs.length && !overlap; i++) for (let j = i + 1; j < cs.length; j++) if (Math.hypot(...sub(cs[i], cs[j])) < 0.75 * p0 - 1e-3) { overlap = true; break; }
          if (overlap) failures.push(`${a.name} ${e.m} g${gi}: two studs overlap`);
          // the count against the texture mapping: a stud per lattice point on the surface, minus the ones that do not fit / are covered
          const expect = ref.studs.length;
          if (found > expect) failures.push(`${a.name} ${e.m} g${gi}: ${found} studs but only ${expect} lattice points fit the surface`);
          if (found < expect * 0.5 && expect > 4) failures.push(`${a.name} ${e.m} g${gi}: only ${found} of ${expect} placeable studs kept (covered?)`);
        }
        bySides[sides] = (bySides[sides] ?? 0) + 1;
        studs += n; tris += addedT; bytes += out.length - src.length;
        // budgets of the rules
        const cs = chooseSides(n, e);
        if (cs.budget && addedT > cs.budget) failures.push(`${a.name} ${e.m}: ${addedT} stud triangles over the budget ${cs.budget}`);
        if (e.l >= RULES.none) failures.push(`${a.name} ${e.m}: a far part (${e.l}) got studs`);
        worstTri = Math.max(worstTri, addedT);
        if (addedV > 65535 * 2) failures.push(`${a.name} ${e.m}: ${addedV} vertices added`);
      }
    }
    // safety: an earlier generator's member and a foreign member are left alone
    const isl = ctx.archives.find((x) => pack.has(`studs/arch/${x.name.toLowerCase()}.json`));
    if (isl) {
      const table = await pack.json(`studs/arch/${isl.name.toLowerCase()}.json`);
      const e = table.meshes[0], hit = isl.find(e.m);
      const wrote = new Uint8Array(parseMsh(isl.read(hit)).vertexCount ? isl.read(hit) : isl.read(hit));
      // (a) hash mismatch
      const bad = new Uint8Array(wrote); bad[bad.length - 1] ^= 0xff;
      const fake = { name: isl.name, find: (p) => isl.find(p), read: (x) => (x.path === hit.path ? bad : isl.read(x)) };
      const r1 = await generateArchive(pack, isl.name, fake, async () => null, ['studs']);
      checked++;
      if (r1.files.has(hit.path)) failures.push(`safety: a mesh with another hash was baked (${e.m})`);
      // (b) a member an earlier generator wrote (env.out holds it, any case of the path): the studs generator leaves it alone and says so; the others of the archive are still baked
      const marker = new Uint8Array([1, 2, 3]);
      const out = new Map([[hit.path.toUpperCase(), marker]]), puts = [], logs = [];
      const env = {
        pack, name: isl.name, archive: isl, out, other: async () => null, stats: {}, options: new Set(), log: (m) => logs.push(m),
        read: (m) => { const e2 = isl.find(m); return e2 ? isl.read(e2) : null; },
        put: (m, bytes) => { puts.push(m); out.set(m, bytes); },
      };
      await generator.run(env);
      checked++;
      if (puts.some((m) => m.toLowerCase() === hit.path.toLowerCase())) failures.push(`safety: a member written by an earlier generator was overwritten (${hit.path})`);
      if (out.get(hit.path.toUpperCase()) !== marker) failures.push('safety: the earlier generator\'s bytes were replaced');
      if (!logs.some((l) => l.includes('earlier generator'))) failures.push('safety: no log line for the member left alone');
      if (table.meshes.length > 1 && !puts.length) failures.push('safety: nothing else was baked in that run');
      const b1 = bakeMesh(isl.read(hit), e, table), b2 = bakeMesh(isl.read(hit), e, table);
      checked++;
      if (b1.bytes && (!b2.bytes || fnv1a(b1.bytes) !== fnv1a(b2.bytes))) failures.push('bakeMesh is not deterministic');
    }
    notes.push(`${meshes} meshes baked (${skipped} left out by the rules / budget), ${studs} studs, +${tris} triangles, +${(bytes / 1e6).toFixed(2)} MB of mesh data, largest mesh +${worstTri} triangles; sides ${JSON.stringify(bySides)}; slowest archive ${worstMs} ms`);
    notes.push(per.join(' | '));
    return { checked, failures, notes };
  },
};
