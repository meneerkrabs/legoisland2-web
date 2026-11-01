// LEGO 3D brick-built reconstructions (pack part "bldg": the Res-Q centre, the Gas N' Wash garage, the train carriage, the airstrip seaplane; second table `sets/arch/<archive>.b.json`, generator src/mods/lego3d/gen/sets.ts).
// ORACLES: what the engine reads besides the triangles is the player's own: group count / order / flags, GTOM + MATL, the texture list, kept groups byte-identical (moving sub-objects, pictures, translucent panes, placeholders),
// decals only lifted, `hold` triangles (the carriage's wheel discs) unchanged; the collision source (the last LOD of a record) never replaced and no .col / waypoint member written; the replacement is made of bricks:
// every new group is an outward-wound, unit-normal, finite-UV surface, vertex counts below the pack's 16-bit limit; the QUALITY GATE of docs/re/lego3d.md section 16: silhouette IoU against the game's own mesh >= 0.9 from 9 views
// (every LOD that is replaced), culling sphere radius within 20 % / centre 0.2 radii, world box within 0.5 units, triangle counts below 60k; deterministic; a foreign member is left alone.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { parseMsh, validateMsh, groupMatrices } from '../../src/formats/msh.ts';
import { hashMember } from '../../src/mods/lego3d/meshpack.ts';
import { silhouetteIoU } from '../lego3d/iou.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.join(here, '../../src/mods/lego3d/data/lego3d.pack');
const same = (a, b) => (a === null && b === null) || (a && b && a.length === b.length && a.every((v, i) => v === b[i]));
const xf = (M, p) => (M ? [p[0] * M[0] + p[1] * M[4] + p[2] * M[8] + M[12], p[0] * M[1] + p[1] * M[5] + p[2] * M[9] + M[13], p[0] * M[2] + p[1] * M[6] + p[2] * M[10] + M[14]] : p);
/** world soups per group (MATL applied) */
function soups(m) {
  const gm = groupMatrices(m);
  return m.groups.map((g, gi) => { const t = []; for (let i = 0; i < g.indexCount; i++) { const v = m.indices[g.firstIndex + i] + g.firstVertex; t.push(...xf(gm[gi], [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]])); } return Float32Array.from(t); });
}
const boundsOf = (arrs) => { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (const a of arrs) for (let i = 0; i < a.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], a[i + c]); hi[c] = Math.max(hi[c], a[i + c]); } return { lo, hi, centre: lo.map((l, i) => (l + hi[i]) / 2), radius: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 }; };

export default {
  name: 'lego3d-bldg',
  async run(ctx) {
    const failures = [], notes = [];
    if (!fs.existsSync(PACK)) return { checked: 0, failures, notes: ['LEGO 3D pack absent: skipped'] };
    const pack = Pack.open(new Uint8Array(fs.readFileSync(PACK)));
    const tables = pack.names('sets/arch/').filter((n) => n.endsWith('.b.json'));
    if (!tables.length) return { checked: 0, failures, notes: ['pack has no bldg part: skipped'] };
    let scenes = null;
    try {
      const { Pe, extractZone } = await import('../../src/formats/exe.ts');
      const exePath = path.join(ctx.dataRoot, 'LEGO eiland 2.exe');
      if (fs.existsSync(exePath)) { const pe = new Pe(new Uint8Array(fs.readFileSync(exePath))), starts = pe.functionStarts(); scenes = (z) => extractZone(pe, z, undefined, starts); }
    } catch (e) { notes.push(`scene tables unavailable: ${e}`); }
    let checked = 0, meshes = 0, worstIou = 1, trisO = 0, trisN = 0;
    const per = [];
    for (const tn of tables) {
      const table = await pack.json(tn), arch = ctx.archives.find((a) => a.name.toLowerCase() === table.archive.toLowerCase());
      if (!arch) { notes.push(`${table.archive}: archive not in the data folder, skipped`); continue; }
      const r = await generateArchive(pack, arch.name, arch, async () => null, ['sets']);
      const gen = (m) => [...r.files.keys()].find((k) => k.toLowerCase() === m.toLowerCase());
      const sc = scenes ? scenes(arch.name) : null;
      for (const k of r.files.keys()) if (/\.col$|waypoint/i.test(k)) failures.push(`${arch.name}: wrote ${k}`);
      if (sc) {   // the last LOD of every record (the .col source) is never in the table
        const mem = new Set(table.meshes.map((e) => e.member.toLowerCase()));
        for (const mdl of sc.models) { const last = [...mdl.parts].filter(Boolean).pop(); if (last) { const p = sc.meshPaths[last.mesh]; if (p && mdl.parts.filter(Boolean).length > 1 && mem.has(p.replace(/\\/g, '/').split('/').slice(2).join('/').toLowerCase())) failures.push(`${arch.name}: the collision-source LOD ${p} is replaced`); } }
      }
      for (const e of table.meshes) {
        checked++;
        const tag = `${arch.name}/${e.member}`, ent = arch.find(e.member);
        if (!ent) { failures.push(`${tag}: in the pack but not in the archive`); continue; }
        const orig = arch.read(ent);
        if (hashMember(orig) !== e.hash) { failures.push(`${tag}: the pack's hash is not the archive's member`); continue; }
        const key = gen(e.member);
        if (!key) { failures.push(`${tag}: not replaced although it matches the pack's hash`); continue; }
        meshes++;
        const om = parseMsh(orig), nm = parseMsh(r.files.get(key)), prob = validateMsh(nm);
        if (prob.length) { failures.push(`${tag}: invalid msh: ${prob.slice(0, 2).join('; ')}`); continue; }
        if (nm.groups.length !== om.groups.length) { failures.push(`${tag}: ${nm.groups.length} groups, the game's has ${om.groups.length}`); continue; }
        for (let g = 0; g < om.groups.length; g++) if (nm.groups[g].flags !== om.groups[g].flags) failures.push(`${tag}: group ${g} flags changed`);
        if (!same(nm.gtom ? [...nm.gtom] : null, om.gtom ? [...om.gtom] : null)) failures.push(`${tag}: GTOM differs`);
        if (!same(nm.matl ? [...nm.matl] : null, om.matl ? [...om.matl] : null)) failures.push(`${tag}: MATL differs`);
        const gm = groupMatrices(om);
        const slice = (m, gr) => ({ pos: m.positions.slice(gr.firstVertex * 3, (gr.firstVertex + gr.vertexCount) * 3), nrm: m.normals.slice(gr.firstVertex * 3, (gr.firstVertex + gr.vertexCount) * 3), uv: m.uvs.slice(gr.firstVertex * 2, (gr.firstVertex + gr.vertexCount) * 2), idx: m.indices.slice(gr.firstIndex, gr.firstIndex + gr.indexCount) });
        e.kinds.forEach((k, g) => {
          const a = slice(om, om.groups[g]), b = slice(nm, nm.groups[g]);
          if (k === 'keep') { if (!same([...a.pos], [...b.pos]) || !same([...a.idx], [...b.idx]) || !same([...a.uv], [...b.uv])) failures.push(`${tag}: kept group ${g} changed`); }
          else if (k === 'decal') { if (!same([...a.idx], [...b.idx]) || !same([...a.uv], [...b.uv]) || a.pos.length !== b.pos.length) failures.push(`${tag}: decal group ${g} topology / UV changed`); }
          else {
            if (!b.idx.length) { failures.push(`${tag}: group ${g} is empty`); return; }
            for (let v = 0; v < b.nrm.length; v += 3) { const l = Math.hypot(b.nrm[v], b.nrm[v + 1], b.nrm[v + 2]); if (!(l > 0.9 && l < 1.1)) { failures.push(`${tag}: group ${g} has a non-unit normal`); break; } }
            for (let i = 0; i < b.uv.length; i++) if (!Number.isFinite(b.uv[i])) { failures.push(`${tag}: group ${g} has a non-finite UV`); break; }
            // outward winding: the triangles that are brick faces (the first ones; later ones are the player's own gap triangles) face along their vertex normals
            let wrong = 0;
            for (let t = 0; t < b.idx.length; t += 3) {
              const i0 = b.idx[t] * 3, i1 = b.idx[t + 1] * 3, i2 = b.idx[t + 2] * 3;
              const u = [b.pos[i1] - b.pos[i0], b.pos[i1 + 1] - b.pos[i0 + 1], b.pos[i1 + 2] - b.pos[i0 + 2]], v = [b.pos[i2] - b.pos[i0], b.pos[i2 + 1] - b.pos[i0 + 1], b.pos[i2 + 2] - b.pos[i0 + 2]];
              const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
              if (n[0] * (b.nrm[i0] + b.nrm[i1] + b.nrm[i2]) + n[1] * (b.nrm[i0 + 1] + b.nrm[i1 + 1] + b.nrm[i2 + 1]) + n[2] * (b.nrm[i0 + 2] + b.nrm[i1 + 2] + b.nrm[i2 + 2]) < -1e-9) wrong++;
            }
            if (wrong > 0.02 * (b.idx.length / 3) + 4) failures.push(`${tag}: group ${g}: ${wrong} of ${b.idx.length / 3} triangles wound against their normals`);
          }
        });
        // hold boxes: triangles of the player's group inside the box are still there, unchanged
        for (const h of e.hold ?? []) {
          const og = om.groups[h.g], ng = nm.groups[h.g];
          if (!og || !ng) continue;
          const tri = (m, gr) => { const out = new Set(); for (let t = 0; t < gr.indexCount; t += 3) { const p = [0, 1, 2].map((q) => { const v = m.indices[gr.firstIndex + t + q] + gr.firstVertex; return xf(gm[h.g], [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]]); }); const c = [0, 1, 2].map((q) => (p[0][q] + p[1][q] + p[2][q]) / 3); if (c.every((v, q) => v >= h.box[q] && v <= h.box[q + 3])) out.add(p.map((x) => x.map((v) => v.toFixed(3)).join(',')).sort().join('|')); } return out; };
          const a = tri(om, og), b = tri(nm, ng);
          for (const k of a) if (!b.has(k)) { failures.push(`${tag}: a held triangle of group ${h.g} is gone`); break; }
        }
        // culling sphere (LOD 0 raw positions) and the world box
        const bo = boundsOf([om.positions]), bn = boundsOf([nm.positions]);
        const dr = Math.abs(bn.radius / bo.radius - 1), dc = Math.hypot(bn.centre[0] - bo.centre[0], bn.centre[1] - bo.centre[1], bn.centre[2] - bo.centre[2]) / bo.radius;
        if (dr > 0.2) failures.push(`${tag}: culling radius ${bn.radius.toFixed(2)} against ${bo.radius.toFixed(2)}`);
        if (dc > 0.2) failures.push(`${tag}: culling centre off by ${(dc * bo.radius).toFixed(2)}`);
        const so = soups(om), sn = soups(nm), wo = boundsOf(so), wn = boundsOf(sn);
        for (let c = 0; c < 3; c++) if (Math.abs(wn.lo[c] - wo.lo[c]) > 0.5 || Math.abs(wn.hi[c] - wo.hi[c]) > 0.5) failures.push(`${tag}: world box axis ${c} [${wn.lo[c].toFixed(2)}, ${wn.hi[c].toFixed(2)}] against [${wo.lo[c].toFixed(2)}, ${wo.hi[c].toFixed(2)}]`);
        // the quality gate
        const io = silhouetteIoU(so, sn, { size: 384 });
        worstIou = Math.min(worstIou, io.min);
        if (io.min < 0.9) failures.push(`${tag}: silhouette IoU ${io.min.toFixed(3)} (< 0.9) [${io.iou.map((v) => v.toFixed(3)).join(' ')}]`);
        const to = om.indices.length / 3, tn2 = nm.indices.length / 3;
        trisO += to; trisN += tn2;
        if (tn2 > 60000) failures.push(`${tag}: ${tn2} triangles (sanity cap 60k)`);
        per.push(`${path.basename(e.member, '.Msh')} ${to}->${tn2} IoU ${io.min.toFixed(3)}/${io.mean.toFixed(3)}`);
      }
      // foreign member left alone; deterministic
      const victim = table.meshes[0];
      const fake = { name: arch.name, find: (p) => arch.find(p), read: (en) => (en.path.toLowerCase() === victim.member.toLowerCase() ? new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) : arch.read(en)), entries: arch.entries };
      const rr = await generateArchive(pack, arch.name, fake, async () => null, ['sets']);
      if ([...rr.files.keys()].some((k) => k.toLowerCase() === victim.member.toLowerCase())) failures.push(`${victim.member}: a foreign member was replaced`);
      const r2 = await generateArchive(pack, arch.name, arch, async () => null, ['sets']);
      if (r2.files.size !== r.files.size) failures.push(`${arch.name}: second run produced another member count`);
      else for (const [k, v] of r.files) { const w = r2.files.get(k); if (!w || hashMember(w) !== hashMember(v)) { failures.push(`${arch.name}: not deterministic: ${k}`); break; } }
    }
    notes.push(`${meshes} meshes in ${tables.length} archives (${trisO} -> ${trisN} triangles), worst silhouette IoU ${worstIou.toFixed(3)}`);
    notes.push(per.join(' | '));
    return { checked, failures, notes };
  },
};
