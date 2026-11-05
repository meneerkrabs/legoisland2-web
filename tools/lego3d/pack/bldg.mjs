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
import { fitSlopes, surfaceIndex, fitFrames, paneRects, components6, partContacts } from '../bldg-parts.mjs';
import { findLeaves, buildLeaf, fitDoorFrames, slopedPanes, fitRoofWindows, roofGlass, tiltedQuads, fitRoundCorners } from '../bldg-feat.mjs';
import { fitWedges, wallTriangles } from '../bldg-wedge.mjs';
import { parseMsh } from '../../../src/formats/msh.ts';
import { encodeMesh, hashMember } from '../../../src/mods/lego3d/meshpack.ts';

/** how far behind a face the cell centres are claimed (x the stud pitch): 0.75 measured best (thick shells over-fill steps and thin pieces); a spec may give one factor per LOD */
const thickF = (spec, li) => (Array.isArray(spec.thickF) ? spec.thickF[Math.min(li, spec.thickF.length - 1)] : spec.thickF ?? 0.75);

/** the models: per archive the LOD meshes to replace in LOD order (the last LOD of a record is its .col source and is never listed) */
export const BLDG = [
  { key: 'rescue', title: 'Res-Q Emergency Response Centre (the game\'s own massing)', zone: 'z02LGI', meshes: ['rescue_LOD1', 'rescue_LOD2', 'rescue_LOD3', 'rescue_LOD4'], pitch: [0.4, 0.16, 0.4], studs: [6, 0, 0, 0], tile: 1, under: [true, false], wedges: { plates: 2, tiles: 1 } },
  { key: 'seaplane_strip_z14', title: 'Island Hopper seaplane of the airstrip (the game\'s own massing)', zone: 'z14OSD', meshes: ['airstrip_seaplane_LOD1', 'airstrip_seaplane_LOD2', 'airstrip_seaplane_LOD3', 'airstrip_seaplane_LOD4'], pitch: [0.4, 0.16, 0.4], studs: [4, 4, 0, 0], tile: 1, minThick: 0.6 },
  { key: 'seaplane_strip_z23', title: 'Island Hopper seaplane of the airstrip (the game\'s own massing)', zone: 'z23DIP', meshes: ['airstrip_seaplane_LOD1', 'airstrip_seaplane_LOD2', 'airstrip_seaplane_LOD3', 'airstrip_seaplane_LOD4'], pitch: [0.4, 0.16, 0.4], studs: [4, 4, 0, 0], tile: 1, minThick: 0.6 },
  // the flying seaplanes of the minigames (z22BIP canyon, z38PAR parachute / rings): the set fit (5935 Island Hopper, IoU 0.76 / 0.82, an open frame: tail boom a thin rod, the fuselage hollow, a detached tail cap) is replaced by the
  // brick reconstruction of the game's own massing like the airstrip plane (section 17); one LOD each, the props / wings the game moves stay the game's
  { key: 'seaplane_z22', title: 'Island Hopper seaplane of the canyon flight (the game\'s own massing)', zone: 'z22BIP', meshes: ['seaplane'], pitch: [0.4, 0.16, 0.4], studs: [4], tile: 1, minThick: 0.6 },
  { key: 'seaplane_z38', title: 'Island Hopper seaplane of the parachute zone (the game\'s own massing)', zone: 'z38PAR', meshes: ['seaplane'], pitch: [0.4, 0.16, 0.4], studs: [4], tile: 1, minThick: 0.6 },
  // the carriage: at the locomotive's / tender's brick scale (stud 0.8, plate 0.32 = the 7750 set at 0.04); the wheel discs stay the game's (round)
  { key: 'carriage', title: 'Passenger-less carriage wagon of the steam train (the game\'s own massing, 7750 brick scale)', zone: 'z02LGI', meshes: ['loco_carriage_lod1', 'loco_carriage_lod2', 'loco_carriage_lod3', 'loco_carriage_lod4'], pitch: [0.4, 0.16, 0.4], studs: [8, 0, 0, 0], tile: 0, minTris: 6, textured: true, thickF: [0.75, 0.75, 0.75, 1.05],
    hold: [[1.7, -0.05, 2.5, 2.7, 2.35, 5.3], [1.7, -0.05, -5.3, 2.7, 2.35, -2.5], [-2.7, -0.05, 2.5, -1.7, 2.35, 5.3], [-2.7, -0.05, -5.3, -1.7, 2.35, -2.5]] },
  { key: 'garage', title: 'Gas N\' Wash garage (the game\'s own massing)', zone: 'z02LGI', meshes: ['garage_LOD1', 'garage_LOD2', 'garage_LOD3', 'garage_LOD4'], pitch: [0.4, 0.16, 0.4], studs: [4, 0, 0, 0], tile: 1, under: [true, false] },
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

/** a flat-colour translucent texture (the game's glass: rgb uniform, alpha 100..254): the groups with it are panes / lamp covers, not pictures */
const glassCache = new Map();
export function isGlassTexture(a, id) {
  if (id < 0) return false;
  const k = `${a.name}:${id}`;
  if (glassCache.has(k)) return glassCache.get(k);
  const t = textureOf(a, id);
  let glass = false;
  if (t) {
    const px = t.rgba, mn = [255, 255, 255, 255], mx = [0, 0, 0, 0];
    for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 4; c++) { if (px[i + c] < mn[c]) mn[c] = px[i + c]; if (px[i + c] > mx[c]) mx[c] = px[i + c]; }
    glass = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) <= 12 && mn[3] >= 100 && mx[3] < 255;
  }
  glassCache.set(k, glass);
  return glass;
}

/** triangles of a soup (local coordinates) that have no partner facing the other way in the same plane (a face drawn from both sides has one): what a two-sided copy has to add (same test as `addBackFaces` of the generator) */
export function unpairedTriangles(local) {
  const nt = local.length / 9, sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const T = Array.from({ length: nt }, (_, t) => { const P = [0, 1, 2].map((k) => [local[t * 9 + k * 3], local[t * 9 + k * 3 + 1], local[t * 9 + k * 3 + 2]]), n = cross(sub(P[1], P[0]), sub(P[2], P[0])), l = Math.hypot(...n); return { P, n: l > 1e-12 ? n.map((x) => x / l) : [0, 0, 0], l }; });
  let un = 0;
  for (let t = 0; t < nt; t++) {
    const a = T[t]; if (a.l < 1e-12) continue;
    const c = [0, 1, 2].map((q) => (a.P[0][q] + a.P[1][q] + a.P[2][q]) / 3);
    let back = false;
    for (let u = 0; u < nt && !back; u++) {
      if (u === t) continue; const b = T[u];
      if (b.l < 1e-12 || dot(a.n, b.n) > -0.999 || Math.abs(dot(sub(c, b.P[0]), b.n)) > 0.002) continue;
      back = [0, 1, 2].every((k) => dot(cross(sub(b.P[(k + 1) % 3], b.P[k]), sub(c, b.P[k])), b.n) >= -1e-6);
    }
    if (!back) un++;
  }
  return un;
}

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
    offset = (await searchOffset(massSoups, keepSoups, gg.filter((g) => g.kind !== 'placeholder').map((g) => g.tris), { pitch: spec.pitch, thick: spec.thick ?? spec.pitch[0] * thickF(spec, li) }, spec.steps ? { steps: spec.steps, size: spec.searchSize ?? 256 } : undefined)).offset;
  }
  let minY = 1e9; for (const g of mass) for (let i = 1; i < g.tris.length; i += 3) minY = Math.min(minY, g.tris[i]);
  const vox = voxelise(massSoups.map((t) => ({ tris: t })), { pitch: spec.pitch, thick: spec.thick ?? spec.pitch[0] * thickF(spec, li), offset, minY: minY - 1e-3 });
  const placements = [], comp0 = components6(vox);
  // doors (docs section 16.7): the moving leaves are rebuilt from bricks in their own frame, the jambs / lintel / threshold of their openings from 1 x N parts in the wall
  let leaves = [], glass = { groups: new Map(), count: 0 };
  if (spec.doors !== false && li < 2) {
    leaves = findLeaves(gg, (g) => isFlat(a, tl[g.index] ?? -1));
    const zmid = vox.origin[2] + (vox.dims[2] * vox.pitch[2]) / 2;
    for (const lf of leaves) { const zc = (lf.box.lo[2] + lf.box.hi[2]) / 2; lf.outer = Math.sign(lf.pane ? zc - (lf.pane.box.lo[2] + lf.pane.box.hi[2]) / 2 : zc - zmid) || 1; }
    placements.push(...fitDoorFrames(vox, leaves, { log: spec.log }));
  }
  // window frames in the openings of the game's translucent panes (the panes themselves stay the game's, behind the frames)
  if (spec.frames !== false && li < 2) {
    const panes = gg.filter((g) => !mass.includes(g) && ((g.kind === 'colour' && (g.flags & 3)) || (g.kind === 'decal' && (g.flags & 2))));
    const comps = panes.flatMap((g) => components(g.tris).map((c) => ({ ...c, gi: g.index })));
    const pr = paneRects(comps);
    placements.push(...fitFrames(vox, pr.rects, { log: spec.log }));
    // sloped roof windows (docs section 16.7): slope-brick frames around the game's sloped panes, in the colour of the game's frame ring around them
    if (spec.roofWindows !== false) {
      const sp = slopedPanes(tiltedQuads(pr.other));
      const colourOf = (p) => {
        const ctr = [(p.comp.lo[0] + p.comp.hi[0]) / 2, (p.comp.lo[1] + p.comp.hi[1]) / 2, (p.comp.lo[2] + p.comp.hi[2]) / 2];
        let best = -1, bs = 0;
        massSoups.forEach((t, s) => {
          let area = 0;
          for (let o = 0; o < t.length; o += 9) {
            const u = [t[o + 3] - t[o], t[o + 4] - t[o + 1], t[o + 5] - t[o + 2]], v = [t[o + 6] - t[o], t[o + 7] - t[o + 1], t[o + 8] - t[o + 2]];
            const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n);
            if (l < 1e-9 || (n[0] * p.n[0] + n[1] * p.n[1] + n[2] * p.n[2]) / l < 0.95) continue;
            const c = [(t[o] + t[o + 3] + t[o + 6]) / 3, (t[o + 1] + t[o + 4] + t[o + 7]) / 3, (t[o + 2] + t[o + 5] + t[o + 8]) / 3];
            if (Math.hypot(c[0] - ctr[0], c[1] - ctr[1], c[2] - ctr[2]) < 2.2) area += l / 2;
          }
          if (area > bs) { bs = area; best = s; }
        });
        return best < 0 ? null : best;
      };
      placements.push(...fitRoofWindows(vox, sp, colourOf, { log: spec.log, windowPart: process.env.BLDG_RWPART ? { id: '4447', rows: +process.env.BLDG_RWPART } : null }));
      if (spec.glass !== false) glass = roofGlass(sp);   // real LDraw glass (4448) over the game's sloped panes (the pane stays under it)
    }
  }
  if (spec.slopes !== false) placements.push(...fitSlopes(vox, { surf: surfaceIndex(massSoups), log: spec.log, dbg: spec.dbg }));   // real LDraw slope bricks where the game's surface slopes (the cells leave the voxel model)
  if (process.env.BLDG_ROUND || spec.roundCorners) placements.push(...fitRoundCorners(vox, massSoups, { log: spec.log }));   // experiment of section 16.8
  // cut-corner plates / tiles on the 45-degree walls (docs section 16.10): spec.wedges = { plates: first N LODs, tiles: first N LODs }; development switch BLDG_WEDGE = 0 (off) | plates | tiles
  const wedges = { 0: null, plates: { plates: 2, tiles: 0 }, tiles: { plates: 2, tiles: 1 } }[process.env.BLDG_WEDGE ?? ''] ?? (process.env.BLDG_WEDGE === undefined ? spec.wedges : null);
  if (wedges && li < wedges.plates) placements.push(...fitWedges(vox, wallTriangles(massSoups), { tiles: li < wedges.tiles, log: spec.log ?? ((m) => console.log(`  [${spec.key} LOD ${li + 1}] ${m}`)) }));
  const comp1 = components6(vox), contacts = partContacts(vox, placements);
  const bricks = packBricks(vox);
  const studSides = spec.studs[Math.min(li, spec.studs.length - 1)];
  const geo = emitSurface(vox, { studSides, studs: studSides > 0, tileRadius: spec.tile ?? 1, placements, under: !process.env.BLDG_NOUNDER && spec.under?.[Math.min(li, spec.under.length - 1)] ? { bricks, rim: 0.06, depth: 0.12 } : null });
  const leafBuilds = leaves.map((lf) => ({ lf, b: buildLeaf(vox, lf, { studSides: Math.max(4, studSides) }) }));
  const groups = [], kinds = [], bom = {}, hold = [];
  for (const { b } of leafBuilds) { for (const k of b.bricks) { const kk = `${k.kind}:${k.part}`; bom[kk] = (bom[kk] ?? 0) + 1; } for (const pl of b.placements) { const kk = `part:${pl.part}`; bom[kk] = (bom[kk] ?? 0) + 1; } }
  if (glass.count) bom['part:4448'] = glass.count;
  if (spec.hold) mass.forEach((g) => { for (const b of spec.hold) hold.push({ g: g.index, box: b }); });
  for (const b of bricks) { const k = `${b.kind}:${b.part}`; bom[k] = (bom[k] ?? 0) + 1; }
  for (const pl of placements) { const k = `part:${pl.part}`; bom[k] = (bom[k] ?? 0) + 1; }
  let tris = 0;
  gg.forEach((g, gi) => {
    if (glass.groups.has(gi)) {   // the game's pane group stays; the glass pieces are appended to it at run time (kind 'glass')
      const gb = glass.groups.get(gi);
      groups.push({ kind: 0, flags: 0, pos: gb.pos, nrm: gb.nrm, idx: gb.idx });
      kinds.push('glass'); tris += gb.idx.length / 3;
      return;
    }
    const mi = mass.indexOf(g), lb = leafBuilds.find((x) => x.lf.g === gi), buf = lb ? lb.b.geo.get(0) : mi >= 0 ? geo.get(mi) : null;
    if (buf && buf.idx.length > 0) {
      if (buf.pos.length / 3 > 65535) throw new Error(`${spec.key} LOD ${li} group ${gi}: ${buf.pos.length / 3} vertices (limit 65535): fewer stud sides / more tiles`);
      if (windingErrors(buf) > 0) throw new Error(`${spec.key} LOD ${li} group ${gi}: triangles wound against their normals`);
      const flat = isFlat(a, tl[g.index] ?? -1);
      groups.push({ kind: 0, flags: flat ? 0 : 1, pos: buf.pos, nrm: buf.nrm, idx: buf.idx, partFrom: buf.partFrom });
      kinds.push(flat ? 'flat' : 'uv'); tris += buf.idx.length / 3;
    } else {
      // the game's translucent glass (panes, lamp covers) is a one-sided surface: from inside the building it is not there (docs section 16.9): the generator appends a reversed copy of every unpaired triangle ('pane')
      const pane = spec.twoSided !== false && (g.flags & 3) && isGlassTexture(a, tl[g.index] ?? -1) && unpairedTriangles(g.local) > 0;
      groups.push({ kind: 1 }); kinds.push(pane ? 'pane' : g.kind === 'decal' ? 'decal' : 'keep');
    }
  });
  return { groups, kinds, tris, bom, vox, mass, gg, offset: vox.offset, bricks: bricks.length + placements.length + leafBuilds.reduce((s2, x) => s2 + x.b.bricks.length + x.b.placements.length, 0), placements, hold, leaves: leafBuilds.map(({ lf, b }) => ({ g: lf.g, pane: lf.pane?.g ?? null, hinge: lf.hinge, outer: lf.outer, opening: lf.opening ? [lf.opening.widthStuds, lf.opening.heightPlates] : null, bricks: b.bricks.length, parts: b.placements.map((p) => p.part), components: components6(b.vox).components, tris: b.geo.get(0)?.idx.length / 3, ...b.info })), assembly: { before: comp0.components, after: comp1.components, parts: placements.length, loose: contacts.loose, resting: contacts.below } };
}

export async function build(ctx) {
  const report = [], byArch = {}, blobs = new Map(), usedParts = new Set(['stud']);
  const only = (process.env.BLDG_ONLY ?? '').split(',').filter(Boolean);   // development: BLDG_ONLY=rescue,garage builds just these models (the pack of such a build is incomplete)
  for (const spec0 of BLDG) {
    if (only.length && !only.includes(spec0.key)) continue;
    // development: BLDG_STUDS=garage:4,rescue:6 overrides the stud sides of LOD 1 (the comparison of section 16.8)
    const ov = Object.fromEntries((process.env.BLDG_STUDS ?? '').split(',').filter(Boolean).map((x) => x.split(':')));
    const spec = ov[spec0.key] !== undefined ? { ...spec0, studs: [+ov[spec0.key], ...spec0.studs.slice(1)] } : spec0;
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
      (byArch[spec.zone] ??= []).push({ member, hash: hashMember(bytes), blob: bname, kinds: r.kinds, tris: r.tris, game: msh.indices.length / 3, set: `bldg:${spec.key}`, gap: spec.gap ?? 0.45, asm: r.assembly, ...(r.leaves.length ? { leaves: r.leaves } : {}), parts: r.placements.map((p) => `${p.part}@${p.i},${p.j},${p.k}r${p.r}g${p.g}`), ...(r.hold.length ? { hold: r.hold } : {}) });
      report.push({ key: spec.key, mesh: nm, lodFrom: part.lod, game: msh.indices.length / 3, mine: r.tris, groups: r.kinds.join(','), bricks: r.bricks, bom: r.bom, offset: r.offset, assembly: r.assembly });
      ctx.log(`${spec.zone}/${nm} (LOD from ${part.lod}): ${msh.indices.length / 3} -> ${r.tris} triangles, ${r.bricks} bricks, kinds ${r.kinds.join(',')}`);
    }
  }
  for (const [name, b] of blobs) ctx.put(name, b);
  for (const [zone, list] of Object.entries(byArch)) ctx.put(`sets/arch/${zone.toLowerCase()}.b.json`, JSON.stringify({ v: 1, archive: zone, meshes: list }));
  // attribution: every LDraw part whose dimensions the bricks take (and the stud primitive)
  for (const p of usedParts) { try { const f = ctx.lib.flatten(`${p}.dat`, { res: 'low' }); ctx.use(f.infos); } catch (e) { ctx.log(`attribution: ${p}: ${e}`); } }
  fs.writeFileSync(path.join(WORK, 'bldg-report.json'), JSON.stringify(report, null, 1));
}
