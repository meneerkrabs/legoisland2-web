// Pack builder "bldg": the brick-built reconstructions of the game's own massing (docs/re/lego3d.md section 16): the Res-Q Emergency Response Centre and the Gas N' Wash garage of the island (z02LGI), the train
// carriage, ... For each LOD mesh of a model the game's flat-colour static groups are voxelised onto the LDraw brick grid (tools/lego3d/bldg.mjs), covered with real LDraw bricks and plates, and emitted
// as geometry in the group's own frame; everything else of the mesh (pictures, decals, translucent panes, the moving sub-objects of GTOM / MATL, thin parts such as an antenna) stays the player's own at run time.
//   Output: sets/arch/<archive>.b.json (the same table format as the vehicles, read by src/mods/lego3d/gen/sets.ts) + sets/b/<hash>.bin; the report of this build goes to <WORK>/bldg-report.json
// Nothing of the game's geometry is written: the pack holds the voxel shell's bricks only (positions on the grid of the game's own measurements, LDraw stud dimensions).
import fs from 'node:fs';
import path from 'node:path';
import { archive, scene, memberOf, textureOf, WORK } from '../lib.mjs';
import { gameGroups } from '../setlib.mjs';
import { voxelise, packBricks, emitSurface, signedVolume, soupOfBuf, searchOffset } from '../bldg.mjs';
import { parseMsh } from '../../../src/formats/msh.ts';
import { encodeMesh, hashMember } from '../../../src/mods/lego3d/meshpack.ts';

/** how far behind a face the cell centres are claimed (x the stud pitch): 0.75 measured best (thick shells over-fill steps and thin pieces); a spec may give one factor per LOD */
const thickF = (spec, li) => (Array.isArray(spec.thickF) ? spec.thickF[Math.min(li, spec.thickF.length - 1)] : spec.thickF ?? 0.75);

/** the models: per archive the LOD meshes to replace in LOD order (the last LOD of a record is its .col source and is never listed) */
export const BLDG = [
  { key: 'rescue', title: 'Res-Q Emergency Response Centre (the game\'s own massing)', zone: 'z02LGI', meshes: ['rescue_LOD1', 'rescue_LOD2', 'rescue_LOD3', 'rescue_LOD4'], pitch: [0.4, 0.16, 0.4], studs: [6, 0, 0, 0], tile: 1 },
  { key: 'seaplane_strip_z14', title: 'Island Hopper seaplane of the airstrip (the game\'s own massing)', zone: 'z14OSD', meshes: ['airstrip_seaplane_LOD1', 'airstrip_seaplane_LOD2', 'airstrip_seaplane_LOD3', 'airstrip_seaplane_LOD4'], pitch: [0.4, 0.16, 0.4], studs: [4, 4, 0, 0], tile: 1, minThick: 0.6 },
  { key: 'seaplane_strip_z23', title: 'Island Hopper seaplane of the airstrip (the game\'s own massing)', zone: 'z23DIP', meshes: ['airstrip_seaplane_LOD1', 'airstrip_seaplane_LOD2', 'airstrip_seaplane_LOD3', 'airstrip_seaplane_LOD4'], pitch: [0.4, 0.16, 0.4], studs: [4, 4, 0, 0], tile: 1, minThick: 0.6 },
  // the carriage: at the locomotive's / tender's brick scale (stud 0.8, plate 0.32 = the 7750 set at 0.04); the wheel discs stay the game's (round)
  { key: 'carriage', title: 'Passenger-less carriage wagon of the steam train (the game\'s own massing, 7750 brick scale)', zone: 'z02LGI', meshes: ['loco_carriage_lod1', 'loco_carriage_lod2', 'loco_carriage_lod3', 'loco_carriage_lod4'], pitch: [0.4, 0.16, 0.4], studs: [8, 0, 0, 0], tile: 0, minTris: 6, textured: true, thickF: [0.75, 0.75, 0.75, 1.05],
    hold: [[1.7, -0.05, 2.5, 2.7, 2.35, 5.3], [1.7, -0.05, -5.3, 2.7, 2.35, -2.5], [-2.7, -0.05, 2.5, -1.7, 2.35, 5.3], [-2.7, -0.05, -5.3, -1.7, 2.35, -2.5]] },
  { key: 'garage', title: 'Gas N\' Wash garage (the game\'s own massing)', zone: 'z02LGI', meshes: ['garage_LOD1', 'garage_LOD2', 'garage_LOD3', 'garage_LOD4'], pitch: [0.4, 0.16, 0.4], studs: [6, 0, 0, 0], tile: 1 },
];

const flatCache = new Map();
/** flat colour texture (every channel incl. alpha within 12): the groups that may become bricks */
function isFlat(a, id) {
  if (id < 0) return true;
  const k = `${a.name}:${id}`;
  if (flatCache.has(k)) return flatCache.get(k);
  const t = textureOf(a, id);
  let flat = false;
  if (t) {
    const px = t.rgba, mn = [255, 255, 255, 255], mx = [0, 0, 0, 0];
    for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 4; c++) { if (px[i + c] < mn[c]) mn[c] = px[i + c]; if (px[i + c] > mx[c]) mx[c] = px[i + c]; }
    flat = Math.max(...mx.map((v, c) => v - mn[c])) <= 12;
  }
  flatCache.set(k, flat);
  return flat;
}
const identity = (m) => !m || [...m].every((v, j) => Math.abs(v - (j % 5 === 0 ? 1 : 0)) < 1e-5);

/** connected pieces of a triangle soup (shared vertex positions): [{ soup, n (triangles), lo, hi }] */
export function components(t) {
  const nt = t.length / 9, par = Array.from({ length: nt }, (_, i) => i), find = (x) => (par[x] === x ? x : (par[x] = find(par[x])));
  const at = new Map();
  for (let i = 0; i < nt; i++) for (let k = 0; k < 3; k++) { const key = [0, 1, 2].map((c) => Math.round(t[i * 9 + k * 3 + c] * 500)).join(','); const o = at.get(key); if (o === undefined) at.set(key, i); else par[find(i)] = find(o); }
  const by = new Map();
  for (let i = 0; i < nt; i++) { const r = find(i); (by.get(r) ?? by.set(r, []).get(r)).push(i); }
  return [...by.values()].map((l) => {
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], soup = new Float32Array(l.length * 9);
    l.forEach((i, j) => { for (let k = 0; k < 9; k++) { soup[j * 9 + k] = t[i * 9 + k]; lo[k % 3] = Math.min(lo[k % 3], t[i * 9 + k]); hi[k % 3] = Math.max(hi[k % 3], t[i * 9 + k]); } });
    return { soup, n: l.length, lo, hi, size: hi.map((h, c) => h - lo[c]) };
  });
}

/** the groups that become bricks: static (identity MATL), opaque flat colour, real surfaces (not decals / placeholders), at least 12 triangles */
export function massGroups(a, gg, tl, minTris = 12, minThick = 0, textured = false) {
  const thin = (g) => { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let i = 0; i < g.tris.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], g.tris[i + c]); hi[c] = Math.max(hi[c], g.tris[i + c]); } return Math.min(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) < minThick; };
  return gg.filter((g) => g.kind === 'colour' && g.flags === 0 && identity(g.matrix) && g.nTris >= minTris && (textured || isFlat(a, tl[g.index] ?? -1)) && !(minThick > 0 && thin(g)));
}

/** triangles whose winding ((b-a) x (c-a)) opposes the vertex normals: 0 by construction, checked */
function windingErrors({ pos, nrm, idx }) {
  let bad = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const u = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], v = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (n[0] * (nrm[a] + nrm[b] + nrm[c]) + n[1] * (nrm[a + 1] + nrm[b + 1] + nrm[c + 1]) + n[2] * (nrm[a + 2] + nrm[b + 2] + nrm[c + 2]) < 0) bad++;
  }
  return bad;
}

/** one LOD mesh -> { groups (blob groups), kinds, report } */
export async function buildMesh({ a, msh, tl, spec, li, offset }) {
  const gg = gameGroups(msh), mass = massGroups(a, gg, tl, spec.minTris ?? 12, spec.minThick ?? 0, !!spec.textured);
  // pieces that stay the game's (the wheel discs of the carriage): left out of the voxel input, the generator keeps them (gap filling)
  const inBox = (t, o, b) => { const cx = (t[o] + t[o + 3] + t[o + 6]) / 3, cy = (t[o + 1] + t[o + 4] + t[o + 7]) / 3, cz = (t[o + 2] + t[o + 5] + t[o + 8]) / 3; return cx >= b[0] && cy >= b[1] && cz >= b[2] && cx <= b[3] && cy <= b[4] && cz <= b[5]; };
  const massSoups = mass.map((g) => { if (!spec.hold) return g.tris; const o = []; for (let q = 0; q < g.tris.length; q += 9) if (!spec.hold.some((b) => inBox(g.tris, q, b))) o.push(...g.tris.subarray(q, q + 9)); return Float32Array.from(o); });
  if (spec.search !== false) {   // the grid offset that gives the best silhouette against the game's surface of this LOD (a shift of at most half a cell between LODs)
    const keepSoups = gg.filter((g) => !mass.includes(g) && g.kind !== 'placeholder').map((g) => g.tris);
    offset = (await searchOffset(massSoups, keepSoups, gg.filter((g) => g.kind !== 'placeholder').map((g) => g.tris), { pitch: spec.pitch, thick: spec.thick ?? spec.pitch[0] * thickF(spec, li) })).offset;
  }
  let minY = 1e9; for (const g of mass) for (let i = 1; i < g.tris.length; i += 3) minY = Math.min(minY, g.tris[i]);
  const vox = voxelise(massSoups.map((t) => ({ tris: t })), { pitch: spec.pitch, thick: spec.thick ?? spec.pitch[0] * thickF(spec, li), offset, minY: minY - 1e-3 });
  const bricks = packBricks(vox);
  const studSides = spec.studs[Math.min(li, spec.studs.length - 1)];
  const geo = emitSurface(vox, { studSides, studs: studSides > 0, tileRadius: spec.tile ?? 1 });
  const groups = [], kinds = [], bom = {}, hold = [];
  if (spec.hold) mass.forEach((g) => { for (const b of spec.hold) hold.push({ g: g.index, box: b }); });
  for (const b of bricks) { const k = `${b.kind}:${b.part}`; bom[k] = (bom[k] ?? 0) + 1; }
  let tris = 0;
  gg.forEach((g, gi) => {
    const mi = mass.indexOf(g), buf = mi >= 0 ? geo.get(mi) : null;
    if (buf && buf.idx.length > 0) {
      if (buf.pos.length / 3 > 65535) throw new Error(`${spec.key} LOD ${li} group ${gi}: ${buf.pos.length / 3} vertices (limit 65535): fewer stud sides / more tiles`);
      if (windingErrors(buf) > 0) throw new Error(`${spec.key} LOD ${li} group ${gi}: triangles wound against their normals`);
      const flat = isFlat(a, tl[g.index] ?? -1);
      groups.push({ kind: 0, flags: flat ? 0 : 1, pos: buf.pos, nrm: buf.nrm, idx: buf.idx });
      kinds.push(flat ? 'flat' : 'uv'); tris += buf.idx.length / 3;
    } else { groups.push({ kind: 1 }); kinds.push(g.kind === 'decal' ? 'decal' : 'keep'); }
  });
  return { groups, kinds, tris, bom, vox, mass, gg, offset: vox.offset, bricks: bricks.length, hold };
}

export async function build(ctx) {
  const report = [], byArch = {}, blobs = new Map(), usedParts = new Set(['stud']);
  for (const spec of BLDG) {
    const a = archive(spec.zone), sc = scene(spec.zone);
    let offset = null;
    for (let li = 0; li < spec.meshes.length; li++) {
      const nm = spec.meshes[li];
      const idx = sc.meshPaths.findIndex((x) => x.toLowerCase().endsWith(`\\${nm.toLowerCase()}.msh`));
      if (idx < 0) throw new Error(`${spec.zone}: no mesh ${nm}`);
      const member = memberOf(sc.meshPaths[idx]), bytes = a.read(a.find(member)), msh = parseMsh(bytes);
      const model = sc.models.find((m) => m.parts.some((p) => p && p.mesh === idx)), part = model.parts.find((p) => p && p.mesh === idx), tl = sc.texLists[part.texList];
      const r = await buildMesh({ a, msh, tl, spec, li, offset });
      for (const k of Object.keys(r.bom)) usedParts.add(k.split(':')[1]);
      const blob = encodeMesh(r.groups), bh = hashMember(blob), bname = `sets/b/${bh}.bin`;
      blobs.set(bname, blob);
      (byArch[spec.zone] ??= []).push({ member, hash: hashMember(bytes), blob: bname, kinds: r.kinds, tris: r.tris, game: msh.indices.length / 3, set: `bldg:${spec.key}`, gap: spec.gap ?? 0.45, ...(r.hold.length ? { hold: r.hold } : {}) });
      report.push({ key: spec.key, mesh: nm, lodFrom: part.lod, game: msh.indices.length / 3, mine: r.tris, groups: r.kinds.join(','), bricks: r.bricks, bom: r.bom, offset: r.offset });
      ctx.log(`${spec.zone}/${nm} (LOD from ${part.lod}): ${msh.indices.length / 3} -> ${r.tris} triangles, ${r.bricks} bricks, kinds ${r.kinds.join(',')}`);
    }
  }
  for (const [name, b] of blobs) ctx.put(name, b);
  for (const [zone, list] of Object.entries(byArch)) ctx.put(`sets/arch/${zone.toLowerCase()}.b.json`, JSON.stringify({ v: 1, archive: zone, meshes: list }));
  // attribution: every LDraw part whose dimensions the bricks take (and the stud primitive)
  for (const p of usedParts) { try { const f = ctx.lib.flatten(`${p}.dat`, { res: 'low' }); ctx.use(f.infos); } catch (e) { ctx.log(`attribution: ${p}: ${e}`); } }
  fs.writeFileSync(path.join(WORK, 'bldg-report.json'), JSON.stringify(report, null, 1));
}
