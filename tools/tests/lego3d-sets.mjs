// LEGO 3D sets generator (src/mods/lego3d/gen/sets.ts): the game's vehicle meshes rebuilt from the LDraw OMR set models. ORACLE: everything the engine reads from these meshes besides the triangles must be
// what the original has, and what the triangles must satisfy for the gameplay data that is computed from them:
//   * the member set: only the visual meshes of the table are written (never a .col file, a waypoint file, the far LOD that a record's .col is made from, a mesh of another model)
//   * GTOM + MATL identical (the sub-objects the code moves: wheels, rotors, doors, the seat: parts.ts, heli.ts, car.ts ...), group count / order / flags identical (the texture list of the LOD part
//     and the vehicle "looks" are positional), kept groups (placeholders, decals) byte-identical in geometry, decals lifted by <= 0.45 only
//   * the culling sphere the renderer takes from the LOD 0 raw positions (centre / radius), the box with the MATL matrices applied, the volume sign (winding), unit normals, UVs inside the original's range
//   * triangle budgets (LOD 0: <= max(5x, 1600) (the build ceiling is 4.5x of the set geometry, the kept groups come on top); other LODs <= 1.1x), determinism, the safety rules (a member that is not the game's own is left alone), other archives get nothing.
// Skips with a note when the pack (node tools/lego3d/pack/build-pack.mjs --only sets) or the game's executable (scene tables) is absent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { parseMsh, validateMsh, groupMatrices } from '../../src/formats/msh.ts';
import { hashMember } from '../../src/mods/lego3d/meshpack.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.join(here, '../../src/mods/lego3d/data/lego3d.pack');

function bounds(pos) {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < pos.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], pos[i + c]); hi[c] = Math.max(hi[c], pos[i + c]); }
  return { lo, hi, centre: lo.map((l, i) => (l + hi[i]) / 2), radius: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 };
}
/** world-space triangles of a mesh (MATL matrix of each group applied): flat array */
function worldPositions(m) {
  const gm = groupMatrices(m), out = [];
  m.groups.forEach((g, gi) => {
    for (let v = 0; v < g.vertexCount; v++) {
      const k = (g.firstVertex + v) * 3, p = [m.positions[k], m.positions[k + 1], m.positions[k + 2]], M = gm[gi];
      out.push(...(M ? [p[0] * M[0] + p[1] * M[4] + p[2] * M[8] + M[12], p[0] * M[1] + p[1] * M[5] + p[2] * M[9] + M[13], p[0] * M[2] + p[1] * M[6] + p[2] * M[10] + M[14]] : p));
    }
  });
  return out;
}
function signedVolume(m) {
  const gm = groupMatrices(m);
  let vol = 0;
  m.groups.forEach((g, gi) => {
    const M = gm[gi];
    const P = (i) => { const k = (g.firstVertex + m.indices[g.firstIndex + i]) * 3, p = [m.positions[k], m.positions[k + 1], m.positions[k + 2]]; return M ? [p[0] * M[0] + p[1] * M[4] + p[2] * M[8] + M[12], p[0] * M[1] + p[1] * M[5] + p[2] * M[9] + M[13], p[0] * M[2] + p[1] * M[6] + p[2] * M[10] + M[14]] : p; };
    for (let i = 0; i < g.indexCount; i += 3) { const a = P(i), b = P(i + 1), c = P(i + 2); vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; }
  });
  return vol;
}
const same = (a, b) => (a === null && b === null) || (a && b && a.length === b.length && a.every((v, i) => v === b[i]));

export default {
  name: 'lego3d-sets',
  async run(ctx) {
    const failures = [], notes = [];
    if (!fs.existsSync(PACK)) return { checked: 0, failures, notes: ['LEGO 3D pack absent (node tools/lego3d/pack/build-pack.mjs --only sets): skipped'] };
    const pack = Pack.open(new Uint8Array(fs.readFileSync(PACK)));
    const tables = pack.names('sets/arch/');
    if (!tables.length) return { checked: 0, failures, notes: ['pack has no sets part: skipped'] };
    let scenes = null;
    try {
      const { Pe, extractZone } = await import('../../src/formats/exe.ts');
      const exePath = path.join(ctx.dataRoot, 'LEGO eiland 2.exe');
      if (fs.existsSync(exePath)) { const pe = new Pe(new Uint8Array(fs.readFileSync(exePath))), starts = pe.functionStarts(); scenes = (z) => extractZone(pe, z, undefined, starts); }
    } catch (e) { notes.push(`scene tables unavailable: ${e}`); }
    if (!scenes) notes.push('no game executable next to the data: record / texture-list checks skipped');
    let checked = 0, replaced = 0, trisO = 0, trisN = 0, bytes = 0, ms = 0, worstRadius = 0, worstCentre = 0, worstDecal = 0;
    const perModel = {};
    for (const tn of tables) {
      const table = await pack.json(tn), arch = ctx.archives.find((a) => a.name.toLowerCase() === table.archive.toLowerCase());
      if (!arch) { notes.push(`${table.archive}: archive not in the data folder, skipped`); continue; }
      const t0 = Date.now();
      const r = await generateArchive(pack, arch.name, arch, async () => null, ['sets']);
      ms += Date.now() - t0;
      const gen = (m) => [...r.files.keys()].find((k) => k.toLowerCase() === m.toLowerCase());
      const sc = scenes ? scenes(arch.name) : null;
      const tableMembers = new Set(table.meshes.map((e) => e.member.toLowerCase()));
      // the member set: only the table's meshes
      for (const k of r.files.keys()) { if (!tableMembers.has(k.toLowerCase())) failures.push(`${arch.name}: unexpected output member ${k}`); if (/\.col$|waypoint/i.test(k)) failures.push(`${arch.name}: wrote ${k}`); }
      // the far LOD of every record's model (the one its .col is made from) is never replaced
      if (sc) for (const mdl of sc.models) { const last = [...mdl.parts].filter(Boolean).pop(); if (last) { const p = sc.meshPaths[last.mesh]; if (p && tableMembers.has(p.replace(/\\/g, '/').split('/').slice(2).join('/').toLowerCase()) && mdl.parts.filter(Boolean).length > 1) failures.push(`${arch.name}: the far mesh ${p} is replaced`); } }
      for (const e of table.meshes) {
        checked++;
        const ent = arch.find(e.member);
        if (!ent) { failures.push(`${e.member}: in the pack but not in the archive`); continue; }
        const orig = arch.read(ent);
        if (hashMember(orig) !== e.hash) { failures.push(`${e.member}: the pack's hash is not the archive's member`); continue; }
        const key = gen(e.member);
        if (!key) { failures.push(`${e.member}: not replaced although it matches the pack's hash`); continue; }
        replaced++;
        const nb = r.files.get(key); bytes += nb.length;
        const om = parseMsh(orig), nm = parseMsh(nb), prob = validateMsh(nm);
        if (prob.length) { failures.push(`${e.member}: invalid msh: ${prob.slice(0, 2).join('; ')}`); continue; }
        const tag = `${arch.name}/${e.member}`;
        let lodFrom = 0;
        if (sc) { const idx2 = sc.meshPaths.findIndex((p) => p && p.replace(/\\/g, '/').split('/').slice(2).join('/').toLowerCase() === e.member.toLowerCase()); const part2 = sc.models.flatMap((m) => m.parts.filter(Boolean)).find((p) => p.mesh === idx2); lodFrom = part2?.lod ?? 0; }
        // structure: groups, flags, GTOM, MATL
        if (nm.groups.length !== om.groups.length) { failures.push(`${tag}: ${nm.groups.length} groups, the game's has ${om.groups.length}`); continue; }
        for (let g = 0; g < om.groups.length; g++) if (nm.groups[g].flags !== om.groups[g].flags) failures.push(`${tag}: group ${g} flags ${nm.groups[g].flags} != ${om.groups[g].flags}`);
        if (!same(nm.gtom ? [...nm.gtom] : null, om.gtom ? [...om.gtom] : null)) failures.push(`${tag}: GTOM differs`);
        if (!same(nm.matl ? [...nm.matl] : null, om.matl ? [...om.matl] : null)) failures.push(`${tag}: MATL differs`);
        // texture list: one texture per group of this LOD part
        if (sc) {
          const idx = sc.meshPaths.findIndex((p) => p && p.replace(/\\/g, '/').split('/').slice(2).join('/').toLowerCase() === e.member.toLowerCase());
          const part = sc.models.flatMap((m) => m.parts.filter(Boolean)).find((p) => p.mesh === idx);
          const tl = part ? sc.texLists[part.texList] : null;
          if (tl && tl.length < nm.groups.length) failures.push(`${tag}: ${nm.groups.length} groups but the texture list has ${tl.length}`);
          if (!part) failures.push(`${tag}: no record / model uses this mesh`);
        }
        // groups: kept / decal / geometry
        e.kinds.forEach((k, g) => {
          const og = om.groups[g], ng = nm.groups[g];
          const slice = (m, gr) => ({ pos: m.positions.slice(gr.firstVertex * 3, (gr.firstVertex + gr.vertexCount) * 3), nrm: m.normals.slice(gr.firstVertex * 3, (gr.firstVertex + gr.vertexCount) * 3), uv: m.uvs.slice(gr.firstVertex * 2, (gr.firstVertex + gr.vertexCount) * 2), idx: m.indices.slice(gr.firstIndex, gr.firstIndex + gr.indexCount) });
          const a = slice(om, og), b = slice(nm, ng);
          if (k === 'keep') { if (!same([...a.pos], [...b.pos]) || !same([...a.idx], [...b.idx]) || !same([...a.uv], [...b.uv])) failures.push(`${tag}: kept group ${g} changed`); }
          else if (k === 'decal') {
            if (!same([...a.idx], [...b.idx]) || !same([...a.uv], [...b.uv]) || a.pos.length !== b.pos.length) failures.push(`${tag}: decal group ${g} topology / UV changed`);
            else for (let i = 0; i < a.pos.length; i += 3) worstDecal = Math.max(worstDecal, Math.hypot(a.pos[i] - b.pos[i], a.pos[i + 1] - b.pos[i + 1], a.pos[i + 2] - b.pos[i + 2]));
          } else {
            if (!ng.indexCount) failures.push(`${tag}: group ${g} is empty`);
            for (let v = 0; v < b.nrm.length; v += 3) { const l = Math.hypot(b.nrm[v], b.nrm[v + 1], b.nrm[v + 2]); if (!(l > 0.9 && l < 1.1)) { failures.push(`${tag}: group ${g} has a non-unit normal`); break; } }
            for (let i = 0; i < b.uv.length; i++) if (!Number.isFinite(b.uv[i])) { failures.push(`${tag}: group ${g} has a non-finite UV`); break; }
            if (k === 'flat') {   // a flat colour: UV (0.5, 0.5); the triangles carried over from the player's own meshes (a cut-off picture, gap filling) have the player's own UV: inside the original group's range
              const lo = [1e9, 1e9], hi = [-1e9, -1e9];
              for (let i = 0; i < a.uv.length; i += 2) for (let c = 0; c < 2; c++) { lo[c] = Math.min(lo[c], a.uv[i + c]); hi[c] = Math.max(hi[c], a.uv[i + c]); }
              for (let i = 0; i < b.uv.length; i += 2) {
                if (b.uv[i] === 0.5 && b.uv[i + 1] === 0.5) continue;
                if (b.uv[i] < lo[0] - 1e-3 || b.uv[i] > hi[0] + 1e-3 || b.uv[i + 1] < lo[1] - 1e-3 || b.uv[i + 1] > hi[1] + 1e-3) { failures.push(`${tag}: flat group ${g} has a UV outside the original's range`); break; }
              }
            }
            else {   // a picture: the UV of the nearest point of the original group, so inside the original's range (+ the interpolation margin)
              const lo = [1e9, 1e9], hi = [-1e9, -1e9];
              for (let i = 0; i < a.uv.length; i += 2) for (let c = 0; c < 2; c++) { lo[c] = Math.min(lo[c], a.uv[i + c]); hi[c] = Math.max(hi[c], a.uv[i + c]); }
              for (let i = 0; i < b.uv.length; i += 2) for (let c = 0; c < 2; c++) if (b.uv[i + c] < lo[c] - 1e-3 || b.uv[i + c] > hi[c] + 1e-3) { failures.push(`${tag}: picture group ${g} has a UV outside the original's range`); i = 1e9; break; }
            }
          }
        });
        // culling sphere (renderer: centre / radius of the LOD 0 raw positions) and the box in world space
        const bo = bounds(om.positions), bn = bounds(nm.positions);
        const dr = Math.abs(bn.radius / bo.radius - 1), dc = Math.hypot(bn.centre[0] - bo.centre[0], bn.centre[1] - bo.centre[1], bn.centre[2] - bo.centre[2]) / bo.radius;
        worstRadius = Math.max(worstRadius, dr); worstCentre = Math.max(worstCentre, dc);
        if (dr > 0.2) failures.push(`${tag}: culling radius ${bn.radius.toFixed(2)} against ${bo.radius.toFixed(2)}`);
        if (dc > 0.2) failures.push(`${tag}: culling centre off by ${(dc * bo.radius).toFixed(2)}`);
        const wo = bounds(worldPositions(om)), wn = bounds(worldPositions(nm));
        for (let c = 0; c < 3; c++) if (Math.abs(wn.lo[c] - wo.lo[c]) > 0.15 * (wo.hi[c] - wo.lo[c]) + 0.8 || Math.abs(wn.hi[c] - wo.hi[c]) > 0.15 * (wo.hi[c] - wo.lo[c]) + 0.8) { failures.push(`${tag}: world box axis ${c} [${wn.lo[c].toFixed(2)}, ${wn.hi[c].toFixed(2)}] against [${wo.lo[c].toFixed(2)}, ${wo.hi[c].toFixed(2)}]`); break; }
        // moving parts (MATL matrix other than identity, per GTOM index): the part's local box is the game's within 12 % (+ 0.15): wheels / rotors / doors keep their axle and their size
        if (nm.gtom && nm.matl) {
          const boxOfPart = (m, k) => { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; m.groups.forEach((gr, gi) => { if (m.gtom[gi] !== k || gr.indexCount <= 9) return; for (let v = 0; v < gr.vertexCount; v++) for (let c = 0; c < 3; c++) { const x = m.positions[(gr.firstVertex + v) * 3 + c]; lo[c] = Math.min(lo[c], x); hi[c] = Math.max(hi[c], x); } }); return { lo, hi }; };
          const ng = Math.max(...nm.gtom) + 1;
          for (let k = 1; k < ng; k++) {
            const a2 = boxOfPart(om, k), b2 = boxOfPart(nm, k);
            if (a2.lo[0] > a2.hi[0] || b2.lo[0] > b2.hi[0]) continue;
            for (let c = 0; c < 3; c++) { const sz = a2.hi[c] - a2.lo[c], tolr = lodFrom >= 80 ? [0.35, 0.5] : [0.12, 0.15]; if (Math.abs(b2.lo[c] - a2.lo[c]) > tolr[0] * sz + tolr[1] || Math.abs(b2.hi[c] - a2.hi[c]) > tolr[0] * sz + tolr[1]) { failures.push(`${tag}: moving part ${k} axis ${c} [${b2.lo[c].toFixed(2)}, ${b2.hi[c].toFixed(2)}] against the game's [${a2.lo[c].toFixed(2)}, ${a2.hi[c].toFixed(2)}]`); break; } }
          }
        }
        // winding: the volume has the original's sign
        const vo = signedVolume(om), vn = signedVolume(nm);
        if (Math.sign(vo) !== Math.sign(vn)) failures.push(`${tag}: signed volume ${vn.toFixed(2)} against ${vo.toFixed(2)} (winding)`);
        // the signed volume (closed-shell measure, hollow insides and thin rotors count too) of the replacement is of the game's order: x0.4 .. x3.5; the ratios per model are in the notes (the LOD pop is judged on them)
        if (vo && (vn / vo > 4 || vn / vo < (lodFrom >= 80 ? 0.25 : 0.4))) failures.push(`${tag}: volume ${vn.toFixed(1)} against ${vo.toFixed(1)} (x${(vn / vo).toFixed(2)})`);
        (perModel[`vol ${path.basename(e.member)}`] ??= []).push(`x${(vn / vo).toFixed(2)}`);
        // budgets
        const to = om.indices.length / 3, tn2 = nm.indices.length / 3;
        trisO += to; trisN += tn2;
        // ROUND 2 rule: no triangle ceiling for what is seen close (LOD 0 and LODs that start within 45 units: the set's full detail after hidden-face removal); the far LODs (>= 80 units) must stay
        // within 12x the game's count (silhouette-preserving figure) and every mesh below a sanity cap of 60k; the numbers per mesh are in the notes
        const limit = lodFrom >= 80 ? Math.max(to * 12, 600) : 60000;
        if (tn2 > limit + 1) failures.push(`${tag}: ${tn2} triangles against the game's ${to} (limit ${Math.round(limit)})`);
        (perModel[path.basename(e.member)] ??= []).push(`${to}->${tn2}@${lodFrom}`);
      }
      // other members: a foreign mesh is left alone, and the generator does not need the table's archive to be complete
      const victim = table.meshes[0];
      const fake = { name: arch.name, find: (p) => arch.find(p), read: (en) => (en.path.toLowerCase() === victim.member.toLowerCase() ? new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) : arch.read(en)), entries: arch.entries };
      const rr = await generateArchive(pack, arch.name, fake, async () => null, ['sets']);
      if ([...rr.files.keys()].some((k) => k.toLowerCase() === victim.member.toLowerCase())) failures.push(`${victim.member}: a foreign member was replaced`);
      checked++;
      const r2 = await generateArchive(pack, arch.name, arch, async () => null, ['sets']);
      if (r2.files.size !== r.files.size) failures.push(`${arch.name}: second run produced another member count`);
      else for (const [k, v] of r.files) { const w = r2.files.get(k); if (!w || hashMember(w) !== hashMember(v)) { failures.push(`${arch.name}: not deterministic: ${k}`); break; } }
    }
    for (const a of ctx.archives) {
      if (tables.some((t) => t.endsWith(`/${a.name.toLowerCase()}.json`))) continue;
      const rr = await generateArchive(pack, a.name, a, async () => null, ['sets']);
      if (rr.files.size) failures.push(`${a.name}: the sets generator wrote ${rr.files.size} members without a table`);
      checked++; break;
    }
    const sets = pack.names('sets/b/'), size = (await Promise.all(sets.map((n) => pack.get(n)))).reduce((s, b) => s + b.length, 0);
    if (size > 8e6) failures.push(`set data ${size} bytes: over the 8 MB budget`);
    notes.push(`${replaced} meshes replaced in ${tables.length} archives (${trisO} -> ${trisN} triangles), generated in ${ms} ms, output ${(bytes / 1024).toFixed(0)} kB, set data in the pack ${(size / 1024).toFixed(0)} kB; worst culling radius change ${(worstRadius * 100).toFixed(1)} %, centre ${worstCentre.toFixed(3)} radii; decals lifted by at most ${worstDecal.toFixed(3)}`);
    notes.push(Object.entries(perModel).map(([k, v]) => `${k}: ${v.join(' ')}`).join(' | '));
    return { checked, failures, notes };
  },
};
