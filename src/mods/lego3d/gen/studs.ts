// LEGO 3D generator "studs": real stud geometry BAKED into the game's own meshes wherever a surface carries a painted stud-plate texture (docs/re/lego3d.md).
//
// Why baked: the stud vertices live in the SAME group as the plate they stand on, so the engine transforms and lights them like the rest of the mesh with the game's own CPU vertex
// lighting (static meshes once, moving records every draw), every record that draws the mesh (vehicles, boats, trains, planes) carries them, and every level of detail the game
// already switches by distance (one mesh per LOD part) gets its own stud level: the near parts get studs, the far parts keep the painted ones.
//
// Two-layer rule: the pack holds a TABLE only (per archive: mesh member name, FNV-1a hash of the member, which groups use which stud texture, the stud lattice of that texture
// (studs per tile, offset), the part's switch-in distance). The positions of the studs are derived at run time from the player's own mesh and its UVs (every point of the texture's
// stud lattice that lies on the group's surface with the whole stud disc inside the coplanar surface); nothing of the game's meshes is stored.
//
// Safety: a member that an earlier generator wrote (`env.out`), whose hash differs from the table (a mod replaced it) or that does not parse is left alone; so is a group that has
// anything but a flat, square-mapped stud surface. Skinned meshes get their studs on the bone of the surface they stand on (weight 1) or none.
//
// Stud: a prism of `sides` sides, radius 0.3 pitch, height 0.2 pitch (LDraw stud.dat proportions: 12 x 4 LDU on a 20 LDU pitch), flat top (normal = surface normal), side normals
// radial (smooth); UV = the stud's centre in the group's stud texture (a flat colour there: the plate's colour). (3 * sides vertices, 3 * sides - 2 triangles.)
import { parseMsh, groupMatrices } from '../../../formats/msh.ts';
import type { Msh } from '../../../formats/msh.ts';
import type { Generator } from './types.ts';
import { fnv1a } from './surf.ts';

export interface StudMeshEntry {
  /** member path as the archive spells it */
  m: string;
  /** FNV-1a of the member */
  h: number;
  /** [group index, texture id] */
  g: [number, number][];
  /** switch-in distance of the part (the smallest over the models using it), 0 = nearest */
  l: number;
  /** 1: the only level of detail of its model */
  s: number;
}
export interface StudTable {
  v: number;
  archive: string;
  /** texture id -> [studs per tile along u, along v, lattice offset u, v (tile units: stud centres at (i + 0.5) / n + offset)] */
  tex: Record<string, [number, number, number, number]>;
  meshes: StudMeshEntry[];
}

/** the stud and the rules for how many triangles a mesh may spend on its studs (docs/re/lego3d.md section on studs) */
export const STUD = { radius: 0.3, height: 0.2, margin: 0.015 };
export const RULES = {
  /** parts that switch in at this distance or farther keep their painted studs only */
  none: 100,
  /** parts that switch in nearer than this get the richer levels */
  near: 40,
  /** triangle budget of the studs of one mesh: near parts / middle parts / the only LOD part of a model */
  budgetNear: 11000, budgetMid: 3500, budgetSingle: 20000,
  /** a model with one level of detail only (every distance): at most this many sides */
  singleMaxSides: 8,
  /** sides tried in this order */
  sides: [12, 8, 6, 4],
  /** a group may not exceed 16 bit indices */
  maxGroupVertices: 65535,
};

type V3 = [number, number, number];
const sub = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: ArrayLike<number>) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: ArrayLike<number>, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];

/** one placed stud: base centre, outward normal, texture-u axis in the plane, pitch, UV of the stud's centre, the mesh triangle it stands on */
export interface Stud { p: V3; n: V3; t1: V3; pitch: number; uc: number; vc: number; tri: number }

export interface PlaceStats { tris: number; used: number; skippedTri: number; candidates: number; offPlate: number; collided: number; hidden: number }
export interface PlaceOptions {
  /** studs per tile and lattice offset (StudTable.tex) */
  lattice: [number, number, number, number];
  /** triangles of the whole mesh in a common frame (groups moved by their static matrices) for the "is something standing on / over this stud" test, flat 9 floats per triangle with the group index, or null: no test */
  occluders?: { tris: Float32Array; group: Uint16Array; bbox: Float32Array } | null;
  /** the group's static matrix (row-major, translation in 12..14) or null */
  matrix?: Float32Array | null;
  /** accept triangles facing down (normal.y < -0.5): off by default (the undersides of plates) */
  allowDown?: boolean;
}

const SAMPLES = 12;

/** the studs of one group: every lattice point of the stud texture on the group's flat, square-mapped triangles whose whole disc lies on the (coplanar) surface and that nothing covers */
export function placeStuds(msh: Msh, gi: number, opt: PlaceOptions): { studs: Stud[]; stats: PlaceStats } {
  const g = msh.groups[gi];
  const stats: PlaceStats = { tris: g.indexCount / 3, used: 0, skippedTri: 0, candidates: 0, offPlate: 0, collided: 0, hidden: 0 };
  const [su, sv, ou, ov] = opt.lattice;
  interface T { P: V3[]; U: [number, number][]; N: V3; area: number; pitch: number; t1: V3; ti: number; plane: number }
  const tris: T[] = [];
  const planes: { N: V3; d: number; t1: V3; t2: V3; tris: number[] }[] = [];
  const planeKey = new Map<string, number>();
  for (let t = 0; t < g.indexCount; t += 3) {
    const vi = [0, 1, 2].map((k) => msh.indices[g.firstIndex + t + k] + g.firstVertex);
    const P = vi.map((i) => [msh.positions[i * 3], msh.positions[i * 3 + 1], msh.positions[i * 3 + 2]] as V3);
    const U = vi.map((i) => [msh.uvs[i * 2], msh.uvs[i * 2 + 1]] as [number, number]);
    const e1 = sub(P[1], P[0]), e2 = sub(P[2], P[0]), n = cross(e1, e2), nl = len(n);
    if (nl < 1e-9) { stats.skippedTri++; continue; }
    const N = scale(n, 1 / nl);
    if (!opt.allowDown && N[1] < -0.5) { stats.skippedTri++; continue; }
    const du1 = U[1][0] - U[0][0], dv1 = U[1][1] - U[0][1], du2 = U[2][0] - U[0][0], dv2 = U[2][1] - U[0][1], det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-12) { stats.skippedTri++; continue; }
    const dPdu = sub(scale(e1, dv2 / det), scale(e2, dv1 / det)), dPdv = sub(scale(e2, du1 / det), scale(e1, du2 / det));
    const lu = len(dPdu), lv = len(dPdv);
    if (lu < 1e-9 || lv < 1e-9) { stats.skippedTri++; continue; }
    const pu = lu / su, pv = lv / sv, ratio = pu / pv;
    // a round stud needs a square lattice: the mapping may not stretch or shear the picture
    if (ratio < 0.8 || ratio > 1.25 || Math.abs(dot(dPdu, dPdv)) / (lu * lv) > 0.25) { stats.skippedTri++; continue; }
    // texture-u axis in the plane
    const du = scale(dPdu, 1 / lu), t1raw = sub(du, scale(N, dot(du, N))), tl = len(t1raw);
    const t1: V3 = tl > 1e-9 ? scale(t1raw, 1 / tl) : [1, 0, 0];
    const dd = dot(N, P[0]);
    const key = `${Math.round(N[0] * 500)},${Math.round(N[1] * 500)},${Math.round(N[2] * 500)},${Math.round(dd * 200)}`;
    let pl = planeKey.get(key);
    if (pl === undefined) {
      pl = planes.length; planeKey.set(key, pl);
      planes.push({ N, d: dd, t1, t2: cross(N, t1), tris: [] });
    }
    planes[pl].tris.push(tris.length);
    tris.push({ P, U, N, area: nl / 2, pitch: Math.sqrt(pu * pv), t1, ti: t / 3, plane: pl });
  }
  const studs: Stud[] = [];
  // 2D (plane basis) copies of the triangles for the disc test
  for (const pl of planes) {
    const o = tris[pl.tris[0]].P[0];
    const to2 = (p: ArrayLike<number>): [number, number] => { const q = sub(p, o); return [dot(q, pl.t1), dot(q, pl.t2)]; };
    const t2d = pl.tris.map((ti) => tris[ti].P.map(to2));
    const inside = (x: number, y: number): boolean => {
      for (const t of t2d) {
        const [a, b, c] = t;
        if (x < Math.min(a[0], b[0], c[0]) - 1e-5 || x > Math.max(a[0], b[0], c[0]) + 1e-5 || y < Math.min(a[1], b[1], c[1]) - 1e-5 || y > Math.max(a[1], b[1], c[1]) + 1e-5) continue;
        const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
        if (Math.abs(d) < 1e-12) continue;
        const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d, l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d, l3 = 1 - l1 - l2;
        const e = 1e-4;
        if (l1 >= -e && l2 >= -e && l3 >= -e) return true;
      }
      return false;
    };
    const taken = new Map<string, number[]>();   // grid of accepted stud centres (2D)
    const centres: [number, number][] = [];
    for (const ti of pl.tris) {
      const T = tris[ti];
      const [U0, U1, U2] = T.U;
      const umin = Math.min(U0[0], U1[0], U2[0]), umax = Math.max(U0[0], U1[0], U2[0]), vmin = Math.min(U0[1], U1[1], U2[1]), vmax = Math.max(U0[1], U1[1], U2[1]);
      const i0 = Math.floor((umin - ou) * su - 0.5), i1 = Math.ceil((umax - ou) * su - 0.5), j0 = Math.floor((vmin - ov) * sv - 0.5), j1 = Math.ceil((vmax - ov) * sv - 0.5);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 20000) continue;   // a wildly tiled triangle: not a stud plate
      const d = (U1[1] - U2[1]) * (U0[0] - U2[0]) + (U2[0] - U1[0]) * (U0[1] - U2[1]);
      const R = STUD.radius * T.pitch;
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const uc = (i + 0.5) / su + ou, vc = (j + 0.5) / sv + ov;
        const l1 = ((U1[1] - U2[1]) * (uc - U2[0]) + (U2[0] - U1[0]) * (vc - U2[1])) / d, l2 = ((U2[1] - U0[1]) * (uc - U2[0]) + (U0[0] - U2[0]) * (vc - U2[1])) / d, l3 = 1 - l1 - l2;
        const e = 1e-6;
        if (l1 < -e || l2 < -e || l3 < -e) continue;
        stats.candidates++;
        const p: V3 = [l1 * T.P[0][0] + l2 * T.P[1][0] + l3 * T.P[2][0], l1 * T.P[0][1] + l2 * T.P[1][1] + l3 * T.P[2][1], l1 * T.P[0][2] + l2 * T.P[1][2] + l3 * T.P[2][2]];
        const c2 = to2(p);
        // the whole disc (a little more) on the surface
        const rr = R + STUD.margin * T.pitch;
        let ok = inside(c2[0], c2[1]);
        for (let k = 0; ok && k < SAMPLES; k++) { const a = (k * 2 * Math.PI) / SAMPLES; ok = inside(c2[0] + rr * Math.cos(a), c2[1] + rr * Math.sin(a)); }
        if (!ok) { stats.offPlate++; continue; }
        // not on top of / too close to a stud already placed on this plane (two triangles' lattices may disagree)
        const cell = 0.5 * T.pitch, gx = Math.floor(c2[0] / cell), gy = Math.floor(c2[1] / cell);
        let clash = false;
        for (let x = gx - 2; x <= gx + 2 && !clash; x++) for (let y = gy - 2; y <= gy + 2 && !clash; y++) {
          for (const q of taken.get(`${x},${y}`) ?? []) if (Math.hypot(centres[q][0] - c2[0], centres[q][1] - c2[1]) < 0.75 * T.pitch) { clash = true; break; }
        }
        if (clash) { stats.collided++; continue; }
        if (opt.occluders && covered(opt.occluders, opt.matrix ?? null, p, T.N, T.t1, T.pitch)) { stats.hidden++; continue; }
        const key = `${gx},${gy}`;
        (taken.get(key) ?? (taken.set(key, []), taken.get(key)!)).push(centres.length);
        centres.push(c2);
        studs.push({ p, n: T.N, t1: T.t1, pitch: T.pitch, uc, vc, tri: T.ti });
      }
    }
  }
  stats.used = studs.length;
  return { studs, stats };
}

/** is something (another surface of the mesh) in the way of the stud: rays along the surface normal from the centre and from points on a ring inside the disc */
function covered(occ: NonNullable<PlaceOptions['occluders']>, m: Float32Array | null | undefined, p: V3, N: V3, t1: V3, pitch: number): boolean {
  const tr = (q: V3): V3 => m ? [q[0] * m[0] + q[1] * m[4] + q[2] * m[8] + m[12], q[0] * m[1] + q[1] * m[5] + q[2] * m[9] + m[13], q[0] * m[2] + q[1] * m[6] + q[2] * m[10] + m[14]] : q;
  const rot = (q: V3): V3 => m ? [q[0] * m[0] + q[1] * m[4] + q[2] * m[8], q[0] * m[1] + q[1] * m[5] + q[2] * m[9], q[0] * m[2] + q[1] * m[6] + q[2] * m[10]] : q;
  const t2 = cross(N, t1);
  const Nw = rot(N), eps = 0.02 * pitch, reach = (STUD.height + 0.05) * pitch;
  const R = STUD.radius * pitch * 0.8;
  const org: V3[] = [p, ...[0, 1, 2, 3].map((k): V3 => { const a = (k * Math.PI) / 2; return [p[0] + R * (Math.cos(a) * t1[0] + Math.sin(a) * t2[0]), p[1] + R * (Math.cos(a) * t1[1] + Math.sin(a) * t2[1]), p[2] + R * (Math.cos(a) * t1[2] + Math.sin(a) * t2[2])]; })];
  const T = occ.tris, B = occ.bbox, n = occ.group.length;
  for (const o0 of org) {
    const o = tr(o0), s: V3 = [o[0] + Nw[0] * eps, o[1] + Nw[1] * eps, o[2] + Nw[2] * eps];
    const ex: V3 = [s[0] + Nw[0] * reach, s[1] + Nw[1] * reach, s[2] + Nw[2] * reach];
    const lo: V3 = [Math.min(s[0], ex[0]), Math.min(s[1], ex[1]), Math.min(s[2], ex[2])], hi: V3 = [Math.max(s[0], ex[0]), Math.max(s[1], ex[1]), Math.max(s[2], ex[2])];
    for (let t = 0; t < n; t++) {
      const b = t * 6;
      if (B[b] > hi[0] || B[b + 3] < lo[0] || B[b + 1] > hi[1] || B[b + 4] < lo[1] || B[b + 2] > hi[2] || B[b + 5] < lo[2]) continue;
      const q = t * 9;
      // Moller-Trumbore, both sides, hit within [0, reach]
      const e1x = T[q + 3] - T[q], e1y = T[q + 4] - T[q + 1], e1z = T[q + 5] - T[q + 2], e2x = T[q + 6] - T[q], e2y = T[q + 7] - T[q + 1], e2z = T[q + 8] - T[q + 2];
      const px = Nw[1] * e2z - Nw[2] * e2y, py = Nw[2] * e2x - Nw[0] * e2z, pz = Nw[0] * e2y - Nw[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det, tx = s[0] - T[q], ty = s[1] - T[q + 1], tz = s[2] - T[q + 2];
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (Nw[0] * qx + Nw[1] * qy + Nw[2] * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (tt >= 0 && tt <= reach) return true;
    }
  }
  return false;
}

/** the triangles of every group of a mesh, moved by the group's static matrix, with bounding boxes (for `covered`) */
export function occluders(msh: Msh): NonNullable<PlaceOptions['occluders']> {
  const mats = groupMatrices(msh);
  const n = msh.indices.length / 3;
  const tris = new Float32Array(n * 9), bbox = new Float32Array(n * 6), group = new Uint16Array(n);
  let o = 0;
  for (let gi = 0; gi < msh.groups.length; gi++) {
    const g = msh.groups[gi], m = mats[gi];
    for (let t = 0; t < g.indexCount; t += 3, o++) {
      const lo = [1e30, 1e30, 1e30], hi = [-1e30, -1e30, -1e30];
      for (let k = 0; k < 3; k++) {
        const v = msh.indices[g.firstIndex + t + k] + g.firstVertex, x = msh.positions[v * 3], y = msh.positions[v * 3 + 1], z = msh.positions[v * 3 + 2];
        const wx = m ? x * m[0] + y * m[4] + z * m[8] + m[12] : x, wy = m ? x * m[1] + y * m[5] + z * m[9] + m[13] : y, wz = m ? x * m[2] + y * m[6] + z * m[10] + m[14] : z;
        tris[o * 9 + k * 3] = wx; tris[o * 9 + k * 3 + 1] = wy; tris[o * 9 + k * 3 + 2] = wz;
        lo[0] = Math.min(lo[0], wx); lo[1] = Math.min(lo[1], wy); lo[2] = Math.min(lo[2], wz); hi[0] = Math.max(hi[0], wx); hi[1] = Math.max(hi[1], wy); hi[2] = Math.max(hi[2], wz);
      }
      bbox.set([lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]], o * 6);
      group[o] = gi;
    }
  }
  // the surface's own triangles (and coplanar neighbours) must not count as covering: they sit at distance 0 behind the ray's start (eps above the plane), so they are never hit
  return { tris, group, bbox };
}

/** sides for a mesh: the richest level whose triangles fit the budget of its part (0 = no studs) */
export function chooseSides(count: number, entry: { l: number; s: number }, maxSingle: number = RULES.singleMaxSides): { sides: number; budget: number } {
  const budget = entry.l >= RULES.none ? 0 : entry.s ? RULES.budgetSingle : entry.l < RULES.near ? RULES.budgetNear : RULES.budgetMid;
  if (!budget || !count) return { sides: 0, budget };
  for (const s of RULES.sides) if ((!entry.s || s <= maxSingle) && count * 3 * s <= budget && count * (2 * s + 1) <= RULES.maxGroupVertices) return { sides: s, budget };
  // even the 4-sided stud is too much: the 4-sided one anyway up to the vertex limit (the caller thins nothing: such a mesh keeps its painted studs)
  return { sides: 0, budget };
}

interface Add { pos: number[]; nrm: number[]; uv: number[]; idx: number[]; bone: number[] }
/**
 * The stud geometry of a list of studs: vertices relative to the group's end (indices count from `base`).
 * soft (default): a centre vertex (normal = the surface normal), a top ring whose normal leans 45 degrees out (the stud's top edge reads rounded) shared by the cap and the wall, a bottom ring
 * (radial normal): 2 * sides + 1 vertices, 3 * sides triangles. The engine lights every vertex on the CPU, so the vertex count is what costs per frame.
 * hard: flat top ring + wall rings with radial normals: 3 * sides vertices, 3 * sides - 2 triangles (sharp edge).
 */
export function studGeometry(studs: Stud[], sides: number, base: number, boneOf: ((s: Stud) => number) | null, soft = true): Add {
  const a: Add = { pos: [], nrm: [], uv: [], idx: [], bone: [] };
  const ring: [number, number][] = [];
  const rot = sides === 6 ? 0 : Math.PI / sides;
  for (let k = 0; k < sides; k++) ring.push([Math.cos(rot + (k * 2 * Math.PI) / sides), Math.sin(rot + (k * 2 * Math.PI) / sides)]);
  let v = base;
  const K = Math.SQRT1_2;
  for (const s of studs) {
    const t1 = s.t1, N = s.n, t2 = cross(N, t1), R = STUD.radius * s.pitch, H = STUD.height * s.pitch;
    const at = (c: number, sn: number, h: number): V3 => [s.p[0] + R * (c * t1[0] + sn * t2[0]) + N[0] * h, s.p[1] + R * (c * t1[1] + sn * t2[1]) + N[1] * h, s.p[2] + R * (c * t1[2] + sn * t2[2]) + N[2] * h];
    const bone = boneOf ? boneOf(s) : 0;
    const push = (p: V3, n: V3) => { a.pos.push(p[0], p[1], p[2]); a.nrm.push(n[0], n[1], n[2]); a.uv.push(s.uc, s.vc); a.bone.push(bone); };
    const radial = (c: number, sn: number): V3 => [c * t1[0] + sn * t2[0], c * t1[1] + sn * t2[1], c * t1[2] + sn * t2[2]];
    if (soft) {
      const cen = v, sideTop = v + 1, sideBot = v + 1 + sides;
      push(at(0, 0, H), N);
      for (const [c, sn] of ring) { const r = radial(c, sn); push(at(c, sn, H), [(N[0] + r[0]) * K, (N[1] + r[1]) * K, (N[2] + r[2]) * K]); }
      for (const [c, sn] of ring) push(at(c, sn, 0), radial(c, sn));
      for (let k = 0; k < sides; k++) a.idx.push(cen, sideTop + k, sideTop + ((k + 1) % sides));
      for (let k = 0; k < sides; k++) { const k2 = (k + 1) % sides; a.idx.push(sideBot + k, sideBot + k2, sideTop + k2, sideBot + k, sideTop + k2, sideTop + k); }
      v += 2 * sides + 1;
    } else {
      const topV = v, sideTop = v + sides, sideBot = v + 2 * sides;
      for (const [c, sn] of ring) push(at(c, sn, H), N);
      for (const [c, sn] of ring) push(at(c, sn, H), radial(c, sn));
      for (const [c, sn] of ring) push(at(c, sn, 0), radial(c, sn));
      for (let k = 1; k < sides - 1; k++) a.idx.push(topV, topV + k, topV + k + 1);
      for (let k = 0; k < sides; k++) { const k2 = (k + 1) % sides; a.idx.push(sideBot + k, sideBot + k2, sideTop + k2, sideBot + k, sideTop + k2, sideTop + k); }
      v += 3 * sides;
    }
  }
  return a;
}

/** `src` with `adds[g]` appended to the vertices / indices of group g; everything else of the file (colours, second UVs, GTOM / MATL, skin weights) is copied. Null when it does not fit. */
export function appendToGroups(src: Uint8Array, msh: Msh, adds: (Add | undefined)[]): Uint8Array | null {
  const n = msh.vertexCount, k = msh.indices.length, ng = msh.groups.length;
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const vertOff = 8, nrmOff = vertOff + 32 * n, indlOff = nrmOff + 12 * n, grplOff = indlOff + 8 + 2 * k, tailOff = grplOff + 8 + 20 * ng;
  const addV = adds.map((a) => (a ? a.pos.length / 3 : 0)), addI = adds.map((a) => (a ? a.idx.length : 0));
  const newN = n + addV.reduce((s, x) => s + x, 0), newK = k + addI.reduce((s, x) => s + x, 0);
  for (let gi = 0; gi < ng; gi++) if (msh.groups[gi].vertexCount + addV[gi] > 65535) return null;
  // old vertex index -> new
  const shift = new Uint32Array(ng + 1);
  let acc = 0;
  for (let gi = 0; gi < ng; gi++) { shift[gi] = acc; acc += addV[gi]; }
  const mapV = (v: number): number => { let g = ng - 1; while (g > 0 && msh.groups[g].firstVertex > v) g--; return v + shift[g]; };
  // tail chunks: copy, rebuilding SVWL / AVW2 when present
  const tailParts: Uint8Array[] = [];
  let p = tailOff;
  let svwlSkin: { bone: number[]; weight: number[] } | null = null;
  while (p < src.length) {
    const tag = String.fromCharCode(src[p], src[p + 1], src[p + 2], src[p + 3]), c = dv.getUint32(p + 4, true);
    if (tag === 'GTOM') { tailParts.push(src.subarray(p, p + 8 + 4 * c)); p += 8 + 4 * c; }
    else if (tag === 'MATL') { tailParts.push(src.subarray(p, p + 8 + 36 * c)); p += 8 + 36 * c; }
    else if (tag === 'SVWL') {
      const bone: number[] = [], weight: number[] = [];
      for (let i = 0; i < c; i++) { bone.push(dv.getInt32(p + 8 + i * 8, true)); weight.push(dv.getFloat32(p + 12 + i * 8, true)); }
      svwlSkin = { bone, weight };
      const q = p + 8 + 8 * c;   // AVW2
      const ne = dv.getUint32(q + 4, true);
      const out = new Uint8Array(8 + 8 * newN + 8 + 24 * ne), od = new DataView(out.buffer);
      od.setUint32(0, 0x4c575653, true); od.setUint32(4, newN, true);   // 'SVWL'
      // old vertices keep their bones at their new positions, studs get theirs
      let o = 8;
      for (let gi = 0; gi < ng; gi++) {
        const g = msh.groups[gi];
        for (let i = 0; i < g.vertexCount; i++) { od.setInt32(o, bone[g.firstVertex + i], true); od.setFloat32(o + 4, weight[g.firstVertex + i], true); o += 8; }
        const a = adds[gi];
        if (a) for (let i = 0; i < a.bone.length; i++) { od.setInt32(o, a.bone[i], true); od.setFloat32(o + 4, 1, true); o += 8; }
      }
      od.setUint32(o, 0x32575641, true); od.setUint32(o + 4, ne, true); o += 8;   // 'AVW2'
      for (let i = 0; i < ne; i++) {
        const s = q + 8 + i * 24;
        for (let f = 0; f < 3; f++) od.setFloat32(o + f * 4, dv.getFloat32(s + f * 4, true), true);
        od.setUint32(o + 12, mapV(dv.getUint32(s + 12, true)), true); od.setUint32(o + 16, dv.getUint32(s + 16, true), true); od.setFloat32(o + 20, dv.getFloat32(s + 20, true), true);
        o += 24;
      }
      tailParts.push(out);
      p = q + 8 + 24 * ne;
    } else return null;
  }
  void svwlSkin;
  const size = 8 + 32 * newN + 12 * newN + 8 + 2 * newK + 8 + 20 * ng + tailParts.reduce((s, x) => s + x.length, 0);
  const out = new Uint8Array(size), od = new DataView(out.buffer);
  let o = 0;
  const tag = (t: string) => { for (let i = 0; i < 4; i++) out[o++] = t.charCodeAt(i); };
  tag('VERT'); od.setUint32(o, newN, true); o += 4;
  for (let gi = 0; gi < ng; gi++) {
    const g = msh.groups[gi];
    out.set(src.subarray(vertOff + 32 * g.firstVertex, vertOff + 32 * (g.firstVertex + g.vertexCount)), o); o += 32 * g.vertexCount;
    const a = adds[gi];
    if (a) for (let i = 0; i < a.pos.length / 3; i++) {
      od.setFloat32(o, a.pos[i * 3], true); od.setFloat32(o + 4, a.pos[i * 3 + 1], true); od.setFloat32(o + 8, a.pos[i * 3 + 2], true);
      od.setUint32(o + 12, 0xffffffff, true);
      od.setFloat32(o + 16, a.uv[i * 2], true); od.setFloat32(o + 20, a.uv[i * 2 + 1], true); od.setFloat32(o + 24, a.uv[i * 2], true); od.setFloat32(o + 28, a.uv[i * 2 + 1], true);
      o += 32;
    }
  }
  for (let gi = 0; gi < ng; gi++) {
    const g = msh.groups[gi];
    out.set(src.subarray(nrmOff + 12 * g.firstVertex, nrmOff + 12 * (g.firstVertex + g.vertexCount)), o); o += 12 * g.vertexCount;
    const a = adds[gi];
    if (a) for (let i = 0; i < a.nrm.length; i++) { od.setFloat32(o, a.nrm[i], true); o += 4; }
  }
  tag('INDL'); od.setUint32(o, newK, true); o += 4;
  for (let gi = 0; gi < ng; gi++) {
    const g = msh.groups[gi];
    out.set(src.subarray(indlOff + 8 + 2 * g.firstIndex, indlOff + 8 + 2 * (g.firstIndex + g.indexCount)), o); o += 2 * g.indexCount;
    const a = adds[gi];
    if (a) for (const i of a.idx) { od.setUint16(o, i, true); o += 2; }
  }
  tag('GRPL'); od.setUint32(o, ng, true); o += 4;
  let fv = 0, fi = 0;
  for (let gi = 0; gi < ng; gi++) {
    const g = msh.groups[gi], vc = g.vertexCount + addV[gi], ic = g.indexCount + addI[gi];
    od.setUint32(o, dv.getUint32(grplOff + 8 + gi * 20, true), true); od.setUint32(o + 4, ic, true); od.setUint32(o + 8, fv, true); od.setUint32(o + 12, vc, true); od.setUint32(o + 16, fi, true);
    o += 20; fv += vc; fi += ic;
  }
  for (const t of tailParts) { out.set(t, o); o += t.length; }
  return o === size ? out : null;
}

export interface BakeResult { bytes: Uint8Array | null; studs: number; tris: number; groups: number; sides: number; why?: string; stats: PlaceStats[] }

/** the whole job for one mesh member: placement per stud group, level choice, geometry, new bytes */
export function bakeMesh(src: Uint8Array, entry: StudMeshEntry, table: StudTable, maxSingle: number = RULES.singleMaxSides, hard = false): BakeResult {
  const res: BakeResult = { bytes: null, studs: 0, tris: 0, groups: 0, sides: 0, stats: [] };
  let msh: Msh;
  try { msh = parseMsh(src); } catch (e) { res.why = `does not parse (${(e as Error).message})`; return res; }
  const skin = msh.svwl ? readSkin(msh) : null;
  if (msh.svwl && !skin) { res.why = 'skin data not understood'; return res; }
  const occ = occluders(msh), mats = groupMatrices(msh);
  const per: { gi: number; studs: Stud[] }[] = [];
  for (const [gi, texId] of entry.g) {
    if (gi >= msh.groups.length) continue;
    const lat = table.tex[String(texId)];
    if (!lat) continue;
    const { studs, stats } = placeStuds(msh, gi, { lattice: lat, occluders: occ, matrix: mats[gi] });
    res.stats.push(stats);
    let keep = studs;
    if (skin) keep = studs.filter((s) => skinOfTri(msh, skin, gi, s.tri) !== null);
    if (keep.length) per.push({ gi, studs: keep });
  }
  const total = per.reduce((s, x) => s + x.studs.length, 0);
  const { sides } = chooseSides(total, entry, maxSingle);
  res.sides = sides;
  if (!total) { res.why = 'no stud fits on the surface'; return res; }
  if (!sides) { res.why = `no budget (${total} studs, part at ${entry.l})`; return res; }
  const adds: (Add | undefined)[] = msh.groups.map(() => undefined);
  for (const { gi, studs } of per) {
    const g = msh.groups[gi];
    adds[gi] = studGeometry(studs, sides, g.vertexCount, skin ? (s) => skinOfTri(msh, skin, gi, s.tri) ?? 0 : null, !hard);
  }
  const bytes = appendToGroups(src, msh, adds);
  if (!bytes) { res.why = 'does not fit (vertex limit or unknown chunk)'; return res; }
  res.bytes = bytes; res.studs = total; res.groups = per.length; res.tris = total * (hard ? 3 * sides - 2 : 3 * sides);
  return res;
}

/** the primary bone and weight of every vertex (skinned meshes) */
function readSkin(msh: Msh): { bone: Int32Array; weight: Float32Array; extra: Set<number> } | null {
  try {
    const d = msh.svwl as Uint8Array, dv = new DataView(d.buffer, d.byteOffset, d.byteLength), n = msh.vertexCount;
    const bone = new Int32Array(n), weight = new Float32Array(n);
    for (let i = 0; i < n; i++) { bone[i] = dv.getInt32(i * 8, true); weight[i] = dv.getFloat32(i * 8 + 4, true); }
    const q = n * 8;
    if (String.fromCharCode(d[q], d[q + 1], d[q + 2], d[q + 3]) !== 'AVW2') return null;
    const ne = dv.getUint32(q + 4, true), extra = new Set<number>();
    for (let i = 0; i < ne; i++) extra.add(dv.getUint32(q + 8 + i * 24 + 12, true));
    return { bone, weight, extra };
  } catch { return null; }
}
/** the bone a stud on triangle `t` of group `gi` follows: all three vertices on one bone with weight 1 and no further influences, else null */
function skinOfTri(msh: Msh, skin: { bone: Int32Array; weight: Float32Array; extra: Set<number> }, gi: number, t: number): number | null {
  const g = msh.groups[gi];
  const v = [0, 1, 2].map((k) => msh.indices[g.firstIndex + t * 3 + k] + g.firstVertex);
  const b = skin.bone[v[0]];
  for (const x of v) if (skin.bone[x] !== b || Math.abs(skin.weight[x] - 1) > 1e-4 || skin.extra.has(x)) return null;
  return b;
}

export const generator: Generator = {
  id: 'studs',
  applies: (name, pack) => pack.has(`studs/arch/${name.toLowerCase()}.json`),
  async run(env) {
    const table = await env.pack.json<StudTable>(`studs/arch/${env.name.toLowerCase()}.json`);
    let meshes = 0, studs = 0, tris = 0, skipped = 0, bytes = 0;
    const t0 = Date.now();
    for (const e of table.meshes) {
      const hit = env.archive.find(e.m);
      if (!hit) { skipped++; continue; }
      if (env.out.has(hit.path) || [...env.out.keys()].some((k) => k.toLowerCase() === hit.path.toLowerCase())) { env.log(`${e.m}: replaced by an earlier generator, left alone`); skipped++; continue; }
      const cur = env.read(hit.path);
      if (!cur || fnv1a(cur) !== e.h) { env.log(`${e.m}: not the game's mesh (hash), left alone`); skipped++; continue; }
      try {
        const r = bakeMesh(cur, e, table, env.options.has('s0') ? 0 : env.options.has('s4') ? 4 : env.options.has('s6') ? 6 : RULES.singleMaxSides, env.options.has('hard'));
        if (!r.bytes) { env.log(`${e.m}: ${r.why}`); skipped++; continue; }
        env.put(hit.path, r.bytes);
        meshes++; studs += r.studs; tris += r.tris; bytes += r.bytes.length - cur.length;
      } catch (err) { env.log(`${e.m}: ${(err as Error).message}`); skipped++; }
    }
    env.stats['stud-meshes'] = meshes; env.stats.studs = studs; env.stats['stud-triangles'] = tris; env.stats['stud-skipped'] = skipped; env.stats['stud-bytes'] = bytes; env.stats['stud-ms'] = Date.now() - t0;
  },
};
