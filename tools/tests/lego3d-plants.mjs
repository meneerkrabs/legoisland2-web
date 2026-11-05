// LEGO 3D plants generator (src/mods/lego3d/gen/plants.ts, docs/re/lego3d.md section 19): the game's pine and oak meshes rebuilt from LDraw parts. ORACLES: what the engine reads from these meshes besides the
// triangles is what the original has (group count / order / flags: the texture list of the LOD part is positional; no GTOM / MATL / skin; the culling sphere the renderer takes from the LOD 0 raw positions within 20 %
// of the radius and 0.2 radii of the centre), the silhouette gate (IoU >= 0.9 over 6 views against the game's own mesh: the footprint and height), valid meshes (unit normals, finite UVs, outward winding = a
// positive volume), triangle budgets, texture mapping (the UVs the game's own picture needs: inside the range the mapping of the game's mesh spans), determinism, the safety rules (a member that is not the
// game's own is left alone, only the table's members are written, nothing is written without the pack part / with `-plants`). Skips with a note when the pack part (node tools/lego3d/pack/build-pack.mjs --only plants)
// is absent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { parseMsh, validateMsh } from '../../src/formats/msh.ts';
import { hashMember } from '../../src/mods/lego3d/meshpack.ts';
import { silhouetteIoU } from '../lego3d/iou.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.join(here, '../../src/mods/lego3d/data/lego3d.pack');
const GATE = { min: 0.9, views: [[0, 0], [45, 0], [90, 0], [0, 90], [35, 25], [215, 25]], size: 384 };
const BUDGET = { pine_mr: 350, oak_mr: 350, oak_lr: 260 };

function bounds(pos) {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < pos.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], pos[i + c]); hi[c] = Math.max(hi[c], pos[i + c]); }
  return { lo, hi, centre: lo.map((l, i) => (l + hi[i]) / 2), radius: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 };
}
const soups = (m) => m.groups.map((g) => { const o = new Float32Array(g.indexCount * 3); for (let i = 0; i < g.indexCount; i++) { const v = m.indices[g.firstIndex + i] + g.firstVertex; for (let c = 0; c < 3; c++) o[i * 3 + c] = m.positions[v * 3 + c]; } return o; });
/** signed volume of the triangle soup (positive when the triangles wind outward, like the game's) */
function volume(m) {
  let vol = 0;
  for (const g of m.groups) for (let i = 0; i < g.indexCount; i += 3) {
    const p = [0, 1, 2].map((k) => { const v = m.indices[g.firstIndex + i + k] + g.firstVertex; return [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]]; });
    vol += (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) / 6;
  }
  return vol;
}

export default {
  name: 'lego3d-plants',
  async run(ctx) {
    const failures = [], notes = [];
    if (!fs.existsSync(PACK)) return { checked: 0, failures, notes: ['LEGO 3D pack absent: skipped'] };
    const pack = Pack.open(new Uint8Array(fs.readFileSync(PACK)));
    const names = pack.names('plants/arch/');
    if (!names.length) return { checked: 0, failures, notes: ['pack has no plants part (node tools/lego3d/pack/build-pack.mjs --only plants): skipped'] };
    let checked = 0, members = 0, ioMin = 1;
    const iouSeen = new Map(), perModel = {};
    for (const n of names) {
      const zone = path.basename(n, '.json'), arch = ctx.archives.find((a) => a.name.toLowerCase() === zone);
      if (!arch) continue;
      const table = await pack.json(n), r = await generateArchive(pack, arch.name, arch, async () => null, ['plants']);
      const expected = new Set(table.entries.map((e) => arch.find(e.member)?.path.toLowerCase()));
      // 1) only the table's members are written, by the plants generator
      for (const k of r.files.keys()) { if (!expected.has(k.toLowerCase())) failures.push(`${arch.name}: unexpected output member ${k}`); if (r.by.get(k) !== 'plants') failures.push(`${arch.name}: ${k} written by ${r.by.get(k)}`); }
      checked++;
      for (const e of table.entries) {
        const ent = arch.find(e.member), tag = `${arch.name}/${e.member}`;
        if (!ent) { failures.push(`${tag}: not in the archive`); continue; }
        const key = [...r.files.keys()].find((k) => k.toLowerCase() === ent.path.toLowerCase());
        if (!key) { failures.push(`${tag}: not written`); continue; }
        members++;
        const orig = arch.read(ent), om = parseMsh(orig), nm = parseMsh(r.files.get(key));
        const bad = validateMsh(nm); if (bad.length) failures.push(`${tag}: invalid mesh ${bad.join('; ')}`);
        if (hashMember(orig) !== e.hash) failures.push(`${tag}: the table's hash is not the archive's mesh`);
        // 2) what the engine reads besides the triangles
        if (nm.groups.length !== om.groups.length) failures.push(`${tag}: ${om.groups.length} groups became ${nm.groups.length}`);
        else nm.groups.forEach((g, i) => { if (g.flags !== om.groups[i].flags) failures.push(`${tag}: group ${i} flags ${om.groups[i].flags} -> ${g.flags}`); });
        if (nm.gtom || nm.matl || nm.svwl) failures.push(`${tag}: GTOM / MATL / skin data appeared`);
        const bo = bounds(om.positions), bn = bounds(nm.positions);
        if (Math.abs(bn.radius / bo.radius - 1) > 0.2) failures.push(`${tag}: culling radius ${bo.radius.toFixed(2)} -> ${bn.radius.toFixed(2)}`);
        if (Math.hypot(...bn.centre.map((c, i) => c - bo.centre[i])) > 0.2 * bo.radius) failures.push(`${tag}: culling centre moved ${bo.centre.map((v) => v.toFixed(2))} -> ${bn.centre.map((v) => v.toFixed(2))}`);
        for (let i = 0; i < 3; i++) if (Math.abs((bn.hi[i] - bn.lo[i]) / (bo.hi[i] - bo.lo[i]) - 1) > 0.12 + (i === 1 ? 0 : 0.03)) failures.push(`${tag}: box axis ${i} ${(bo.hi[i] - bo.lo[i]).toFixed(2)} -> ${(bn.hi[i] - bn.lo[i]).toFixed(2)}`);
        // 3) the surface: unit normals, finite UVs, outward winding, colours white like the game's
        let nrmBad = 0, uvBad = 0;
        for (let i = 0; i < nm.vertexCount; i++) { if (Math.abs(Math.hypot(nm.normals[i * 3], nm.normals[i * 3 + 1], nm.normals[i * 3 + 2]) - 1) > 0.02) nrmBad++; if (!Number.isFinite(nm.uvs[i * 2]) || !Number.isFinite(nm.uvs[i * 2 + 1]) || Math.abs(nm.uvs[i * 2]) > 3 || Math.abs(nm.uvs[i * 2 + 1]) > 3) uvBad++; if (nm.colors[i] !== 0xffffffff) { failures.push(`${tag}: vertex colour ${nm.colors[i].toString(16)}`); break; } }
        if (nrmBad) failures.push(`${tag}: ${nrmBad} normals are not unit length`);
        if (uvBad) failures.push(`${tag}: ${uvBad} UVs out of range / not finite`);
        if (!(volume(nm) > 0)) failures.push(`${tag}: volume ${volume(nm).toFixed(2)} (winding is not outward)`);
        // 4) the gate and the budget (once per model and game mesh)
        const k = `${e.model}|${e.hash}`;
        if (!iouSeen.has(k)) {
          const io = silhouetteIoU(soups(om), soups(nm), GATE);
          iouSeen.set(k, io.min); ioMin = Math.min(ioMin, io.min);
          if (io.min < GATE.min) failures.push(`${tag}: silhouette IoU ${io.min.toFixed(3)} below ${GATE.min}`);
          const t = nm.indices.length / 3; (perModel[e.model] ??= []).push([om.indices.length / 3, t, +io.min.toFixed(3), +io.mean.toFixed(3)]);
          if (t > (BUDGET[e.model] ?? 400)) failures.push(`${tag}: ${t} triangles over the budget ${BUDGET[e.model]}`);
        }
        // 5) the texture mapping: the UVs span what the game's mapping spans on the same mesh (the picture is the game's: same repeat)
        for (const [gi, g] of nm.groups.entries()) {
          const uo = [1e9, -1e9, 1e9, -1e9], un = [1e9, -1e9, 1e9, -1e9];
          const rng = (m, gr, o) => { for (let v = gr.firstVertex; v < gr.firstVertex + gr.vertexCount; v++) { o[0] = Math.min(o[0], m.uvs[v * 2]); o[1] = Math.max(o[1], m.uvs[v * 2]); o[2] = Math.min(o[2], m.uvs[v * 2 + 1]); o[3] = Math.max(o[3], m.uvs[v * 2 + 1]); } };
          rng(om, om.groups[gi], uo); rng(nm, g, un);
          if (un[0] < uo[0] - 0.25 || un[1] > uo[1] + 0.25 || un[2] < uo[2] - 0.25 || un[3] > uo[3] + 0.25) failures.push(`${tag}: group ${gi} UV range ${un.map((v) => v.toFixed(2))} outside the game's ${uo.map((v) => v.toFixed(2))} (+-0.25)`);
        }
      }
      // 5b) the level-of-detail pop: the near and the far mesh of one tree (MR / LR) differ in silhouette no more than the game's own pair does (+ 0.03), and in volume by no more than the game's ratio (+ 0.1)
      for (const [nearRe, farName] of [[/^meshes\/MRPineTree\.msh$/i, 'Meshes/LRPineTree.Msh'], [/^meshes\/Pine_MR\.msh$/i, 'Meshes/Pine_LR.Msh'], [/^meshes\/MR_OakTree\.msh$/i, 'Meshes/LR_OakTree.Msh']]) {
        const e1 = table.entries.find((x) => nearRe.test(x.member)), e2 = table.entries.find((x) => x.member.toLowerCase() === farName.toLowerCase());
        if (!e1 || !e2) continue;
        const k = `pop|${e1.hash}|${e2.hash}`; if (iouSeen.has(k)) continue;
        const get = (e, gen) => parseMsh(gen ? r.files.get([...r.files.keys()].find((q) => q.toLowerCase() === arch.find(e.member).path.toLowerCase())) : arch.read(arch.find(e.member)));
        const go = silhouetteIoU(soups(get(e1, false)), soups(get(e2, false)), GATE), nw = silhouetteIoU(soups(get(e1, true)), soups(get(e2, true)), GATE);
        iouSeen.set(k, nw.min);
        if (nw.min < go.min - 0.03) failures.push(`${arch.name}: LOD pop ${e1.member} -> ${farName}: silhouette IoU ${nw.min.toFixed(3)}, the game's pair ${go.min.toFixed(3)}`);
        const vr = (m) => Math.abs(volume(m)), rn = vr(get(e1, true)) / vr(get(e2, true)), rg = vr(get(e1, false)) / vr(get(e2, false));
        if (Math.abs(rn - 1) > Math.abs(rg - 1) + 0.1) failures.push(`${arch.name}: LOD pop ${e1.member} -> ${farName}: volume ratio ${rn.toFixed(2)}, the game's ${rg.toFixed(2)}`);
        notes.push(`LOD pop ${e1.member} -> ${farName}: silhouette IoU min ${nw.min.toFixed(3)} (the game's pair ${go.min.toFixed(3)}), volume ratio ${rn.toFixed(2)} (${rg.toFixed(2)})`);
      }
      // 6) the safety rules: a mod's own mesh (another hash) is left alone; `-plants` and a table-less archive write nothing
      const e0 = table.entries[0], ent0 = arch.find(e0.member), orig0 = arch.read(ent0);
      try {
        const alt = Uint8Array.from(orig0); alt[alt.length >> 1] ^= 1;
        arch.override(ent0.path, alt);
        const r2 = await generateArchive(pack, arch.name, arch, async () => null, ['plants']);
        if ([...r2.files.keys()].some((k) => k.toLowerCase() === ent0.path.toLowerCase())) failures.push(`${arch.name}: a foreign mesh (other hash) was replaced`);
      } finally { arch.clearOverrides(); }
      if (zone === 'z02lgi') {
        const off = await generateArchive(pack, arch.name, arch, async () => null, ['-plants']);
        if ([...off.by.values()].includes('plants')) failures.push('-plants still writes plants members');
        const again = await generateArchive(pack, arch.name, arch, async () => null, ['plants']);
        for (const [k, v] of r.files) { const w = again.files.get(k); if (!w || w.length !== v.length || w.some((b, i) => b !== v[i])) { failures.push(`${k}: not deterministic`); break; } }
        // with the whole option: the studs / glass / sets / textures generators never write one of the plants' members (each member once)
        const all = await generateArchive(pack, arch.name, arch, async () => null, []);
        for (const k of r.files.keys()) if (all.by.get(k) !== 'plants') failures.push(`${k}: written by ${all.by.get(k)} when every generator runs`);
      }
    }
    for (const [m, v] of Object.entries(perModel)) notes.push(`${m}: game tris -> ${v.map((x) => `${x[0]}->${x[1]} (IoU ${x[2]} / ${x[3]})`).join(', ')}`);
    notes.push(`${members} members in ${checked} archives, worst silhouette IoU ${ioMin.toFixed(3)}`);
    return { checked: members, failures, notes };
  },
};
