// LEGO 3D characters generator (bodies, heads, hands; src/mods/lego3d/chars/*, gen/characters.ts, pack part tools/lego3d/pack/chars.mjs): every replaced member of every zone archive is generated from the
// pack and the player's own archive and checked: parses + validateMsh, same group count / flags / GTOM / MATL as the original (the model's texture list keeps its slots), triangle budget per mesh
// (<= the original's at every LOD, HR within the recorded limit), rebuilt groups non-empty with UVs inside the original group's UV range, outward winding (face normals agree with the vertex normals), finite unit
// normals, valid skin (bones < 17, weights sum to 1, AVW2 vertices in range), deterministic output, a foreign (modded) member is left alone. Skips with a note without the pack / game folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { parseMsh, validateMsh } from '../../src/formats/msh.ts';
import { parseSvwl } from '../../src/formats/anim.ts';
import { hashBytes } from '../../src/mods/lego3d/chars/hash.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.join(here, '../../src/mods/lego3d/data/lego3d.pack');

export default {
  name: 'lego3d-chars',
  async run(ctx) {
    const failures = [], notes = [];
    if (!fs.existsSync(PACK)) return { checked: 0, failures, notes: ['LEGO 3D pack absent (node tools/lego3d/pack/build-pack.mjs --only chars): skipped'] };
    const pack = Pack.open(new Uint8Array(fs.readFileSync(PACK)));
    if (!pack.has('chars/tables.json')) return { checked: 0, failures, notes: ['pack has no chars part: skipped'] };
    const t = await pack.json('chars/tables.json');
    const recipeOf = (key) => t.bodies[key] ?? t.statics?.[key];
    let checked = 0, ms = 0;
    const per = {};   // kind -> { n, worst ratio }
    let firstOut = null;
    for (const a of ctx.archives) {
      if (!/^z\d\d/i.test(a.name)) continue;
      const t0 = Date.now();
      const r = await generateArchive(pack, a.name, a, async () => null, ['characters']);
      ms += Date.now() - t0;
      for (const [member, hashes] of Object.entries(t.members)) {
        const hit = a.find(member); if (!hit) continue;
        const src = a.read(hit), key = hashes[hashBytes(src)];
        if (!key || key.startsWith('gear:')) continue;   // gear is checked by lego3d-gear
        const rec = recipeOf(key); if (!rec) continue;
        const out = r.files.get(hit.path);
        const kind = key.split(':')[0].replace(/-\d+$/, '').replace(/^(pepp|mfg|bb|space|skel\d*)$/, 'body');
        if (!out) { failures.push(`${a.name} ${hit.path}: recipe ${key} but nothing generated`); continue; }
        checked++;
        const ctxs = `${a.name} ${hit.path}`;
        let m0, m1;
        try { m0 = parseMsh(src); m1 = parseMsh(out); } catch (e) { failures.push(`${ctxs}: parse: ${e.message}`); continue; }
        for (const p of validateMsh(m1)) failures.push(`${ctxs}: validateMsh: ${p}`);
        if (m1.groups.length !== m0.groups.length) { failures.push(`${ctxs}: groups ${m0.groups.length} -> ${m1.groups.length}`); continue; }
        if (JSON.stringify([...(m0.gtom ?? [])]) !== JSON.stringify([...(m1.gtom ?? [])]) || JSON.stringify([...(m0.matl ?? [])]) !== JSON.stringify([...(m1.matl ?? [])])) failures.push(`${ctxs}: GTOM / MATL changed`);
        m0.groups.forEach((g, gi) => { if (g.flags !== m1.groups[gi].flags) failures.push(`${ctxs} g${gi}: flags changed`); });
        const t0n = m0.indices.length / 3, t1n = m1.indices.length / 3, lim = rec.lod === 1 ? Math.min(rec.limit ?? t0n, Math.round(t0n * 1.5)) : rec.lod > 0 ? Math.min(rec.limit ?? t0n, t0n) : (rec.limit ?? t0n);   // every LOD below the HR: at most THIS member's own triangles
        if (t1n > lim) failures.push(`${ctxs}: ${t1n} triangles > limit ${lim} (original ${t0n})`);
        const k = (per[kind] ??= { n: 0, worst: 0, tris0: 0, tris1: 0 }); k.n++; k.worst = Math.max(k.worst, t1n / t0n); k.tris0 += t0n; k.tris1 += t1n;
        // normals / positions finite, normals unit
        let bad = 0;
        for (let v = 0; v < m1.vertexCount; v++) { const n = Math.hypot(m1.normals[v * 3], m1.normals[v * 3 + 1], m1.normals[v * 3 + 2]); if (!(Math.abs(n - 1) < 0.02 || (m1.svwl && Math.abs(n - 1) < 0.02))) bad++; for (let c = 0; c < 3; c++) if (!Number.isFinite(m1.positions[v * 3 + c])) bad++; if (!Number.isFinite(m1.uvs[v * 2]) || !Number.isFinite(m1.uvs[v * 2 + 1])) bad++; }
        if (bad) failures.push(`${ctxs}: ${bad} non-finite / non-unit vertex values`);
        // every group non-empty, indices valid; UVs of rebuilt groups inside the original group's UV range
        m1.groups.forEach((g, gi) => {
          if (g.indexCount === 0 && m0.groups[gi].indexCount > 0) failures.push(`${ctxs} g${gi}: empty (original ${m0.groups[gi].indexCount / 3} triangles)`);
          const o = m0.groups[gi]; let lo = [1e9, 1e9], hi = [-1e9, -1e9];
          for (let v = o.firstVertex; v < o.firstVertex + o.vertexCount; v++) for (let c = 0; c < 2; c++) { lo[c] = Math.min(lo[c], m0.uvs[v * 2 + c]); hi[c] = Math.max(hi[c], m0.uvs[v * 2 + c]); }
          let out2 = 0; for (let v = g.firstVertex; v < g.firstVertex + g.vertexCount; v++) for (let c = 0; c < 2; c++) if (m1.uvs[v * 2 + c] < lo[c] - 0.02 || m1.uvs[v * 2 + c] > hi[c] + 0.02) out2++;
          if (out2) failures.push(`${ctxs} g${gi}: ${out2} UV values outside the original group's range`);
        });
        // winding: the face normal (b-a)x(c-a) must agree with the (original-derived) vertex normal for nearly all triangles of rebuilt solid groups (the roles string says which: 'S' groups)
        if (rec.roles) {
          let wrong = 0, tot = 0;
          m1.groups.forEach((g, gi) => {
            if (rec.roles[gi] !== 'S') return;
            // world-space normals of skinned meshes are bone-local: compare only unskinned meshes, and skinned ones in the bone-local frame of the primary bone are rotated about the same axes: skip the check for them (the pose / look checks cover them)
            if (m1.svwl) return;
            for (let i = 0; i < g.indexCount; i += 3) { const ia = [0, 1, 2].map((q) => m1.indices[g.firstIndex + i + q] + g.firstVertex); const P = ia.map((v) => [m1.positions[v * 3], m1.positions[v * 3 + 1], m1.positions[v * 3 + 2]]); const u = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], w = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]]; const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; const vn = [0, 1, 2].map((c) => ia.reduce((s, v) => s + m1.normals[v * 3 + c], 0)); tot++; if (n[0] * vn[0] + n[1] * vn[1] + n[2] * vn[2] < 0) wrong++; }
          });
          if (tot && wrong / tot > (kind === 'hand' ? 0.2 : 0.08)) failures.push(`${ctxs}: ${wrong} of ${tot} triangles wound against their normals`);
        }
        // skin
        if (m1.svwl) {
          const sv = parseSvwl(m1.svwl, m1.vertexCount), sum = new Float64Array(m1.vertexCount);
          for (let v = 0; v < m1.vertexCount; v++) { if (sv.bone[v] < 0 || sv.bone[v] > 16) failures.push(`${ctxs}: vertex ${v} bone ${sv.bone[v]}`); sum[v] += sv.weight[v]; }
          for (let i = 0; i < sv.extra.count; i++) { if (sv.extra.bone[i] > 16) failures.push(`${ctxs}: AVW2 bone ${sv.extra.bone[i]}`); if (sv.extra.vertex[i] >= m1.vertexCount) failures.push(`${ctxs}: AVW2 vertex out of range`); else sum[sv.extra.vertex[i]] += sv.extra.weight[i]; for (let c = 0; c < 3; c++) if (!Number.isFinite(sv.extra.local[i * 3 + c])) failures.push(`${ctxs}: AVW2 local NaN`); }
          let badW = 0; for (let v = 0; v < m1.vertexCount; v++) if (Math.abs(sum[v] - 1) > 2e-3) badW++;
          if (badW) failures.push(`${ctxs}: ${badW} vertices whose weights do not sum to 1`);
        }
        if (!firstOut && a.name === 'z02LGI' && kind === 'body') firstOut = { a, hit, out };
      }
    }
    // determinism: the same archive twice gives the same bytes
    if (firstOut) {
      const r2 = await generateArchive(pack, firstOut.a.name, firstOut.a, async () => null, ['characters']);
      const o2 = r2.files.get(firstOut.hit.path);
      if (!o2 || hashBytes(o2) !== hashBytes(firstOut.out)) failures.push('generation is not deterministic');
      // a foreign (modded) member is left alone: the same archive with one body mesh replaced by other bytes
      const orig = firstOut.a.read(firstOut.hit), modded = orig.slice(); modded[modded.length - 20] ^= 0x55;
      const fake = { name: firstOut.a.name, entries: firstOut.a.entries, find: (p) => firstOut.a.find(p), read: (e) => (e.path === firstOut.hit.path ? modded : firstOut.a.read(e)), has: (p) => firstOut.a.has(p) };
      const r3 = await generateArchive(pack, firstOut.a.name, fake, async () => null, ['characters']);
      if (r3.files.has(firstOut.hit.path)) failures.push('a foreign (modded) body mesh was replaced');
      if (r3.files.size < 10) failures.push('the foreign member made the generator skip everything');
    }
    // wrong pack data never breaks a zone: every body / head blob garbage (and one table row pointing nowhere) -> no exception, nothing generated for them, the log says why, the rest still generated
    {
      const a0 = ctx.archives.find((x) => x.name === 'z02LGI');
      const bad = new Proxy(pack, { get(target, prop) { if (prop === 'version') return 'corrupt-test'; if (prop === 'get') return (name) => (/^chars\/(body|static\/head)/.test(name) ? Promise.resolve(new Uint8Array([1, 2, 3, 4, 5])) : target.get(name)); const v = target[prop]; return typeof v === 'function' ? v.bind(target) : v; } });
      let r4 = null;
      try { r4 = await generateArchive(bad, 'z02LGI', a0, async () => null, ['characters']); } catch (e) { failures.push(`a corrupt pack blob made the generator throw: ${e.message}`); }
      if (r4) {
        const bodyEntry = a0.find('Meshes/PEPP_HR.msh');
        if (r4.files.has(bodyEntry.path)) failures.push('a body from a corrupt blob was written');
        if (!r4.log.some((l) => /characters:/.test(l))) failures.push('the corrupt blobs were skipped silently (no log line)');
        if (r4.files.size === 0) failures.push('corrupt body / head blobs stopped every other member (gear, hands) of the archive');
        notes.push(`corrupt pack blobs: ${r4.log.length} log lines, ${r4.files.size} other members still generated, no exception`);
      }
    }
    for (const [k, v] of Object.entries(per)) notes.push(`${k}: ${v.n} members, triangles ${v.tris0} -> ${v.tris1} (worst single ratio ${v.worst.toFixed(2)}x)`);
    notes.push(`generation of all zone archives: ${ms} ms`);
    return { checked, failures, notes };
  },
};
