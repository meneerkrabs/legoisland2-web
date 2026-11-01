// LEGO 3D generator "sets": game vehicle meshes (jet ski, ambulance ...) rebuilt from the LDraw OMR set models they are versions of (docs/re/lego3d.md section 3.3).
//
// Two-layer rule: the pack (tools/lego3d/pack/sets.mjs) holds, per game mesh, LDraw-derived geometry per colour group in the group's own frame, and the hash of the GAME's original mesh. Everything the
// engine reads besides the triangles comes from the PLAYER'S OWN mesh at run time and is carried over unchanged: the number and order of the groups (the texture list of the LOD part and the vehicle
// "looks" index groups by position), the group flags, GTOM + MATL (the sub-objects the code moves: wheels, rotors, doors, the seat), the decal groups and placeholder groups (copied, the decals lifted
// onto the new hull), and the UVs of groups that show a picture (taken from the nearest point of the player's own group). A mesh that is not the game's own (hash) is left alone.
// Collision (.col), waypoints, the far LOD meshes and every record stay exactly as they are: only the visual meshes named in the pack's table are replaced.
import { parseMsh, groupMatrices } from '../../../formats/msh.ts';
import type { Msh } from '../../../formats/msh.ts';
import type { Generator } from './types.ts';
import { decodeMesh, hashMember } from '../meshpack.ts';
import { writeMsh } from '../mshio.ts';
import type { MshOutGroup } from '../mshio.ts';

const GAP = 0.4, DECAL_LIFT = 0.03, DECAL_REACH = 0.2, PIC_DEPTH = 0.4;   // a decal is pulled onto hull within 0.2 only: further away (an open cockpit side) it stays where the game has it, not on an interior face
export interface SetMeshEntry { member: string; hash: string; blob: string; kinds: string[]; tris: number; game: number; set: string; gap?: number }
export interface SetTable { v: number; archive: string; meshes: SetMeshEntry[] }

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** closest point of triangle abc to p (Ericson, Real-Time Collision Detection): { q, bary [u, v, w], d2 } */
export function closestOnTri(p: V3, a: V3, b: V3, c: V3): { q: V3; w: V3; d2: number } {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  let w: V3;
  if (d1 <= 0 && d2 <= 0) w = [1, 0, 0];
  else {
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) w = [0, 1, 0];
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); w = [1 - v, v, 0]; }
      else {
        const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) w = [0, 0, 1];
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); w = [1 - t, 0, t]; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / (d4 - d3 + (d5 - d6)); w = [0, 1 - t, t]; }
            else { const den = 1 / (va + vb + vc), v = vb * den, t = vc * den; w = [1 - v - t, v, t]; }
          }
        }
      }
    }
  }
  const q: V3 = [a[0] * w[0] + b[0] * w[1] + c[0] * w[2], a[1] * w[0] + b[1] * w[1] + c[1] * w[2], a[2] * w[0] + b[2] * w[1] + c[2] * w[2]];
  const d = sub(p, q);
  return { q, w, d2: dot(d, d) };
}

/** 4x4 row-vector matrix inverse (the MATL matrices are rotation + translation (+ scale)): Gauss-Jordan */
function inv4(m: ArrayLike<number>): Float32Array | null {
  const a: number[][] = [];
  for (let r = 0; r < 4; r++) { a.push([]); for (let c = 0; c < 4; c++) a[r].push(m[r * 4 + c]); for (let k = 0; k < 4; k++) a[r].push(k === r ? 1 : 0); }
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    const t = a[c]; a[c] = a[p]; a[p] = t;
    const d = a[c][c];
    if (Math.abs(d) < 1e-12) return null;
    for (let k = 0; k < 8; k++) a[c][k] /= d;
    for (let r = 0; r < 4; r++) if (r !== c) { const f = a[r][c]; for (let k = 0; k < 8; k++) a[r][k] -= f * a[c][k]; }
  }
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[r * 4 + c] = a[r][4 + c];
  return out;
}
const isIdentity = (M: ArrayLike<number>) => { for (let i = 0; i < 16; i++) if (Math.abs(M[i] - (i % 5 === 0 ? 1 : 0)) > 1e-4) return false; return true; };
const xform = (m: ArrayLike<number>, p: V3): V3 => [p[0] * m[0] + p[1] * m[4] + p[2] * m[8] + m[12], p[0] * m[1] + p[1] * m[5] + p[2] * m[9] + m[13], p[0] * m[2] + p[1] * m[6] + p[2] * m[10] + m[14]];

/** least-squares affine map position -> uv over the vertices of a group (ridge-regularised: a planar picture has a free direction); null when it does not explain the uvs (residual > 0.04) */
export interface UvAffine { f: (p: V3) => [number, number]; raw: (p: V3) => [number, number]; range: [number, number, number, number] }
export function fitUvAffine(pos: ArrayLike<number>, uv: ArrayLike<number>, first: number, n: number, ids: number[] | null = null): UvAffine | null {
  if (ids) n = ids.length;
  if (n < 3) return null;
  const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], B = [[0, 0, 0, 0], [0, 0, 0, 0]];
  for (let i = 0; i < n; i++) {
    const v = ids ? ids[i] : first + i, r = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], 1];
    for (let a = 0; a < 4; a++) { for (let b = 0; b < 4; b++) A[a][b] += r[a] * r[b]; B[0][a] += r[a] * uv[v * 2]; B[1][a] += r[a] * uv[v * 2 + 1]; }
  }
  for (let a = 0; a < 3; a++) A[a][a] += 1e-6 * n;
  // solve A x = B[k] (Gauss-Jordan, 4x4)
  const sol = [0, 1].map((k) => {
    const M = A.map((row, i) => [...row, B[k][i]]);
    for (let c = 0; c < 4; c++) {
      let p = c; for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      const t = M[c]; M[c] = M[p]; M[p] = t;
      if (Math.abs(M[c][c]) < 1e-12) return null;
      const pv = M[c][c];
      for (let j = c; j < 5; j++) M[c][j] /= pv;
      for (let r = 0; r < 4; r++) if (r !== c) { const f = M[r][c]; for (let j = c; j < 5; j++) M[r][j] -= f * M[c][j]; }
    }
    return [M[0][4], M[1][4], M[2][4], M[3][4]];
  });
  if (!sol[0] || !sol[1]) return null;
  let u0 = 1e9, u1 = -1e9, w0 = 1e9, w1 = -1e9;
  for (let i = 0; i < n; i++) { const v = ids ? ids[i] : first + i; u0 = Math.min(u0, uv[v * 2]); u1 = Math.max(u1, uv[v * 2]); w0 = Math.min(w0, uv[v * 2 + 1]); w1 = Math.max(w1, uv[v * 2 + 1]); }
  const raw = (p: V3): [number, number] => [sol[0]![0] * p[0] + sol[0]![1] * p[1] + sol[0]![2] * p[2] + sol[0]![3], sol[1]![0] * p[0] + sol[1]![1] * p[1] + sol[1]![2] * p[2] + sol[1]![3]];
  for (let i = 0; i < n; i++) { const v = ids ? ids[i] : first + i, q = raw([pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]); if (Math.abs(q[0] - uv[v * 2]) > 0.04 || Math.abs(q[1] - uv[v * 2 + 1]) > 0.04) return null; }
  // outside the game's own uv range the picture would wrap: clamped to it
  return { f: (p: V3) => { const q = raw(p); return [Math.max(u0, Math.min(u1, q[0])), Math.max(w0, Math.min(w1, q[1]))]; }, raw, range: [u0, u1, w0, w1] };
}

/** the spatially connected pieces of a picture group (two side windows, two signs): each with its own affine uv map and the triangles (for the nearest-piece test) */
function picPieces(m: Msh, d: { fv: number; nv: number; ni: number; fi: number }, M: ArrayLike<number> | null): { aff: UvAffine; tris: { a: V3; b: V3; c: V3 }[] }[] {
  const nt = d.ni / 3, parent = Array.from({ length: nt }, (_, i) => i), find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const at = new Map<string, number>();
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const v = m.indices[d.fi + t * 3 + k] + d.fv, key = `${Math.round(m.positions[v * 3] * 1000)},${Math.round(m.positions[v * 3 + 1] * 1000)},${Math.round(m.positions[v * 3 + 2] * 1000)}`;
    const o = at.get(key); if (o === undefined) at.set(key, t); else parent[find(t)] = find(o);
  }
  const comps = new Map<number, number[]>();
  for (let t = 0; t < nt; t++) { const r = find(t); const l = comps.get(r); if (l) l.push(t); else comps.set(r, [t]); }
  const out: { aff: UvAffine; tris: { a: V3; b: V3; c: V3 }[] }[] = [];
  for (const list of comps.values()) {
    const ids: number[] = [], tris: { a: V3; b: V3; c: V3 }[] = [];
    for (const t of list) {
      const P = [0, 1, 2].map((k) => { const v = m.indices[d.fi + t * 3 + k] + d.fv; ids.push(v); const l: V3 = [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]]; return M ? xform(M, l) : l; });
      tris.push({ a: P[0], b: P[1], c: P[2] });
    }
    const aff = fitUvAffine(m.positions, m.uvs, 0, 0, ids);
    if (!aff) return [];   // a piece that is not a flat picture: the whole group falls back to nearest-point uvs
    out.push({ aff, tris });
  }
  return out;
}

/** clips a triangle (positions, normals, raw uv per vertex) to the uv rectangle: { inside: polygons, outside: polygons } (Sutherland-Hodgman per side, the cut-off parts are collected) */
type PV = { p: V3; n: V3; u: number; w: number };
function clipUvRect(tri: PV[], range: [number, number, number, number], tol: number): { inside: PV[][]; outside: PV[][] } {
  const outside: PV[][] = [];
  let poly = tri;
  const sides: ((q: PV) => number)[] = [(q) => q.u - (range[0] - tol), (q) => range[1] + tol - q.u, (q) => q.w - (range[2] - tol), (q) => range[3] + tol - q.w];
  for (const dist of sides) {
    if (poly.length < 3) break;
    const inn: PV[] = [], out: PV[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], da = dist(a), db = dist(b);
      if (da >= 0) inn.push(a); else out.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db), x: PV = { p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t], n: [a.n[0] + (b.n[0] - a.n[0]) * t, a.n[1] + (b.n[1] - a.n[1]) * t, a.n[2] + (b.n[2] - a.n[2]) * t], u: a.u + (b.u - a.u) * t, w: a.w + (b.w - a.w) * t };
        inn.push(x); out.push(x);
      }
    }
    if (out.length >= 3) outside.push(out);
    poly = inn;
  }
  return { inside: poly.length >= 3 ? [poly] : [], outside };
}

/** uniform grid over triangles for nearest-distance queries (hull coverage test) */
class TriIndex {
  private cell: number; private cells = new Map<number, number[]>(); tris: { a: V3; b: V3; c: V3; tag: number }[] = [];
  constructor(cell: number) { this.cell = cell; }
  private key(x: number, y: number, z: number) { return ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512); }
  add(a: V3, b: V3, c: V3, tag = 0) {
    const id = this.tris.length; this.tris.push({ a, b, c, tag });
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(a[k], b[k], c[k]) / this.cell)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(a[k], b[k], c[k]) / this.cell));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const k = this.key(x, y, z); const l = this.cells.get(k); if (l) l.push(id); else this.cells.set(k, [id]); }
  }
  /** the nearest triangle within r of p (r <= cell): its tag, closest point, barycentric weights, squared distance */
  nearest(p: V3, r: number): { tag: number; tri: number; q: V3; w: V3; d2: number } | null {
    const cx = Math.floor(p[0] / this.cell), cy = Math.floor(p[1] / this.cell), cz = Math.floor(p[2] / this.cell);
    let best: { tag: number; tri: number; q: V3; w: V3; d2: number } | null = null, bd = r * r;
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) {
      const l = this.cells.get(this.key(x, y, z)); if (!l) continue;
      for (const id of l) { const t = this.tris[id], c = closestOnTri(p, t.a, t.b, t.c); if (c.d2 < bd) { bd = c.d2; best = { tag: t.tag, tri: id, q: c.q, w: c.w, d2: c.d2 }; } }
    }
    return best;
  }
  /** is some triangle within r of p? (r <= cell) */
  near(p: V3, r: number): boolean {
    const cx = Math.floor(p[0] / this.cell), cy = Math.floor(p[1] / this.cell), cz = Math.floor(p[2] / this.cell), r2 = r * r;
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) {
      const l = this.cells.get(this.key(x, y, z)); if (!l) continue;
      for (const id of l) { const t = this.tris[id]; if (closestOnTri(p, t.a, t.b, t.c).d2 <= r2) return true; }
    }
    return false;
  }
}

/** vertices whose normal came out (near) zero (a collapsed sliver in the pack's quantised normals): the normal of a face that uses them */
function fixNormals(pos: ArrayLike<number>, nrm: Float32Array, idx: ArrayLike<number>): Float32Array {
  let bad = false;
  for (let v = 0; v < nrm.length / 3; v++) if (Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]) < 0.5) { bad = true; break; }
  if (!bad) return nrm;
  const out = Float32Array.from(nrm);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const n = cross(sub([pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]], [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]]), sub([pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]], [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]])), l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-12) continue;
    for (const v of [a, b, c]) if (Math.hypot(out[v * 3], out[v * 3 + 1], out[v * 3 + 2]) < 0.5) { out[v * 3] = n[0] / l; out[v * 3 + 1] = n[1] / l; out[v * 3 + 2] = n[2] / l; }
  }
  for (let v = 0; v < out.length / 3; v++) if (Math.hypot(out[v * 3], out[v * 3 + 1], out[v * 3 + 2]) < 0.5) { out[v * 3] = 0; out[v * 3 + 1] = 1; out[v * 3 + 2] = 0; }   // unreferenced vertex
  return out;
}

/** the player's group g of `m`: positions (local), uvs and triangles (local indices) */
function groupData(m: Msh, g: number) {
  const gr = m.groups[g], fv = gr.firstVertex;
  return { fv, nv: gr.vertexCount, ni: gr.indexCount, fi: gr.firstIndex };
}

export const generator: Generator = {
  id: 'sets',
  applies: (name, pack) => pack.has(`sets/arch/${name.toLowerCase()}.json`),
  async run(env) {
    let table: SetTable;
    try { table = await env.pack.json<SetTable>(`sets/arch/${env.name.toLowerCase()}.json`); } catch (e) { env.log(`no set table: ${String(e)}`); return; }
    let replaced = 0, left = 0, missing = 0, trisBefore = 0, trisAfter = 0;
    for (const e of table.meshes) {
      const cur = env.read(e.member);
      if (!cur) { missing++; continue; }
      if (hashMember(cur) !== e.hash) { left++; continue; }   // a mod's own mesh (or another version): left alone
      try {
        const m = parseMsh(cur), blob = decodeMesh(await env.pack.get(e.blob));
        if (blob.length !== m.groups.length) { env.log(`${e.member}: ${blob.length} pack groups for ${m.groups.length} groups`); continue; }
        const mats = groupMatrices(m);
        const groups: MshOutGroup[] = [];
        const moves: { gi: number; P: V3[]; N: V3[] }[] = [];
        const hull: { a: V3; b: V3; c: V3; n: V3 }[] = [];   // the new geometry in world space (for lifting the decals)
        const movePicOutside = () => {
          if (!moves.length) return;
          const oth = new TriIndex(1.0);
          m.groups.forEach((og2, gj) => {
            const k2 = e.kinds[gj];
            if ((k2 !== 'flat' && k2 !== 'uv') || og2.indexCount <= 9) return;   // only groups that are replaced take the cut-off triangles (kept groups stay byte-identical)
            const d2 = groupData(m, gj), M2 = mats[gj];
            for (let i = 0; i < d2.ni; i += 3) { const P = [0, 1, 2].map((q) => { const v = m.indices[d2.fi + i + q] + d2.fv, l: V3 = [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]]; return M2 ? xform(M2, l) : l; }); oth.add(P[0], P[1], P[2], gj * 100000 + (d2.fi + i)); }
          });
          for (const mv of moves) {
            const M = mats[mv.gi], W = mv.P.map((q) => (M ? xform(M, q) : q));
            const c: V3 = [(W[0][0] + W[1][0] + W[2][0]) / 3, (W[0][1] + W[1][1] + W[2][1]) / 3, (W[0][2] + W[1][2] + W[2][2]) / 3];
            const hit = oth.nearest(c, 1.0);
            if (!hit) continue;
            const gj = Math.floor(hit.tag / 100000), fi2 = hit.tag % 100000, tg = groups[gj], iM = mats[gj] ? inv4(mats[gj]!) : null;
            const t2 = [0, 1, 2].map((q) => m.indices[fi2 + q] + groupData(m, gj).fv);
            const uu = m.uvs[t2[0] * 2] * hit.w[0] + m.uvs[t2[1] * 2] * hit.w[1] + m.uvs[t2[2] * 2] * hit.w[2], vv = m.uvs[t2[0] * 2 + 1] * hit.w[0] + m.uvs[t2[1] * 2 + 1] * hit.w[1] + m.uvs[t2[2] * 2 + 1] * hit.w[2];
            const base = (tg.pos as ArrayLike<number>).length / 3, pos2 = Array.from(tg.pos as ArrayLike<number>), nrm2 = Array.from(tg.nrm as ArrayLike<number>), uv2 = Array.from(tg.uv as ArrayLike<number>);
            for (let q = 0; q < 3; q++) { const gl = iM ? xform(iM, W[q]) : W[q]; pos2.push(gl[0], gl[1], gl[2]); nrm2.push(mv.N[q][0], mv.N[q][1], mv.N[q][2]); uv2.push(uu, vv); }
            tg.pos = Float32Array.from(pos2); tg.nrm = Float32Array.from(nrm2); tg.uv = Float32Array.from(uv2);
            tg.idx = [...Array.from(tg.idx as ArrayLike<number>), base, base + 1, base + 2];
            env.stats.picMoved = (env.stats.picMoved ?? 0) + 1;
          }
        };
        for (let gi = 0; gi < m.groups.length; gi++) {
          const og = m.groups[gi], d = groupData(m, gi), bg = blob[gi];
          if (bg.kind === 1) {   // the player's group, unchanged
            groups.push({ flags: og.flags, pos: m.positions.slice(d.fv * 3, (d.fv + d.nv) * 3), nrm: m.normals.slice(d.fv * 3, (d.fv + d.nv) * 3), uv: m.uvs.slice(d.fv * 2, (d.fv + d.nv) * 2), idx: Array.from(m.indices.subarray(d.fi, d.fi + d.ni)) });
            continue;
          }
          let gpos: Float32Array = bg.pos, gnrm: Float32Array = bg.nrm, gidx: ArrayLike<number> = bg.idx;
          const pieces = (bg.flags & 1) && e.kinds[gi] === 'pic' ? picPieces(m, d, mats[gi]) : [];
          if (e.kinds[gi] === 'pic' && !pieces.length) env.log(`${e.member}: picture group ${gi} has no flat pieces (nearest-point uv)`);
          const pieceUv = new Map<number, UvAffine>();   // by output vertex: the affine of the piece the vertex belongs to
          if (pieces.length) {
            // a picture stays where the GAME has it: every new triangle goes to the nearest piece of the game's picture and is cut at the edge of that piece (its uv range); what lies outside becomes the game's body there
            const np: number[] = [], nn: number[] = [], ni: number[] = [], vu: UvAffine[] = [];
            for (let i = 0; i < bg.idx.length; i += 3) {
              const Pw = [0, 1, 2].map((k) => { const v = bg.idx[i + k], l: V3 = [bg.pos[v * 3], bg.pos[v * 3 + 1], bg.pos[v * 3 + 2]]; return mats[gi] ? xform(mats[gi]!, l) : l; });
              const c: V3 = [(Pw[0][0] + Pw[1][0] + Pw[2][0]) / 3, (Pw[0][1] + Pw[1][1] + Pw[2][1]) / 3, (Pw[0][2] + Pw[1][2] + Pw[2][2]) / 3];
              let bi = 0, bd = 1e30;
              pieces.forEach((pc, k) => { for (const t of pc.tris) { const r = closestOnTri(c, t.a, t.b, t.c); if (r.d2 < bd) { bd = r.d2; bi = k; } } });
              const pc = pieces[bi];
              const tri: PV[] = [0, 1, 2].map((k) => { const v = bg.idx[i + k], p: V3 = [bg.pos[v * 3], bg.pos[v * 3 + 1], bg.pos[v * 3 + 2]], q = pc.aff.raw(p); return { p, n: [bg.nrm[v * 3], bg.nrm[v * 3 + 1], bg.nrm[v * 3 + 2]] as V3, u: q[0], w: q[1] }; });
              const cl = clipUvRect(tri, pc.aff.range, 0.01);
              for (const poly of cl.inside) for (let k = 1; k < poly.length - 1; k++) {
                // inside the picture's footprint AND near the picture's own surface (PIC_DEPTH): a brick behind it (the far side's panel, a seat) must not take the picture
                const cw: V3 = [0, 0, 0];
                for (const q of [poly[0], poly[k], poly[k + 1]]) { const w = mats[gi] ? xform(mats[gi]!, q.p) : q.p; cw[0] += w[0] / 3; cw[1] += w[1] / 3; cw[2] += w[2] / 3; }
                let dmin = 1e30;
                for (const t of pc.tris) dmin = Math.min(dmin, closestOnTri(cw, t.a, t.b, t.c).d2);
                if (dmin > PIC_DEPTH * PIC_DEPTH) { moves.push({ gi, P: [poly[0].p, poly[k].p, poly[k + 1].p], N: [poly[0].n, poly[k].n, poly[k + 1].n] }); continue; }
                const b0 = np.length / 3; for (const q of [poly[0], poly[k], poly[k + 1]]) { np.push(...q.p); nn.push(...q.n); vu.push(pc.aff); } ni.push(b0, b0 + 1, b0 + 2);
              }
              for (const poly of cl.outside) for (let k = 1; k < poly.length - 1; k++) moves.push({ gi, P: [poly[0].p, poly[k].p, poly[k + 1].p], N: [poly[0].n, poly[k].n, poly[k + 1].n] });
            }
            gpos = Float32Array.from(np); gnrm = Float32Array.from(nn); gidx = ni;
            vu.forEach((a, v) => pieceUv.set(v, a));
          }
          const nv = gpos.length / 3, uv = new Float32Array(nv * 2);
          if (bg.flags & 1) {   // a picture on this group: the UV of the nearest point of the player's own group
            const tris: { a: V3; b: V3; c: V3; i: [number, number, number] }[] = [];
            for (let i = 0; i < d.ni; i += 3) {
              const ids = [0, 1, 2].map((k) => m.indices[d.fi + i + k] + d.fv) as [number, number, number];
              const P = ids.map((v) => [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]] as V3);
              tris.push({ a: P[0], b: P[1], c: P[2], i: ids });
            }
            const aff = pieces.length ? null : fitUvAffine(m.positions, m.uvs, d.fv, d.nv);
            for (let v = 0; v < nv; v++) {
              const p: V3 = [gpos[v * 3], gpos[v * 3 + 1], gpos[v * 3 + 2]];
              const pa = pieceUv.get(v) ?? aff;
              if (pa) { const q = pa.f(p); uv[v * 2] = q[0]; uv[v * 2 + 1] = q[1]; continue; }
              let best = 1e30, bu = 0.5, bv = 0.5;
              for (const t of tris) {
                const r = closestOnTri(p, t.a, t.b, t.c);
                if (r.d2 < best) { best = r.d2; bu = m.uvs[t.i[0] * 2] * r.w[0] + m.uvs[t.i[1] * 2] * r.w[1] + m.uvs[t.i[2] * 2] * r.w[2]; bv = m.uvs[t.i[0] * 2 + 1] * r.w[0] + m.uvs[t.i[1] * 2 + 1] * r.w[1] + m.uvs[t.i[2] * 2 + 1] * r.w[2]; }
              }
              uv[v * 2] = bu; uv[v * 2 + 1] = bv;
            }
          } else uv.fill(0.5);
          groups.push({ flags: og.flags, pos: gpos, nrm: fixNormals(gpos, gnrm, gidx), uv, idx: gidx });
          const M = mats[gi];
          for (let i = 0; i < gidx.length; i += 3) {
            const P = [0, 1, 2].map((k) => { const v = gidx[i + k], q: V3 = [gpos[v * 3], gpos[v * 3 + 1], gpos[v * 3 + 2]]; return M ? xform(M, q) : q; });
            const n = cross(sub(P[1], P[0]), sub(P[2], P[0])), l = Math.hypot(n[0], n[1], n[2]) || 1;
            hull.push({ a: P[0], b: P[1], c: P[2], n: [n[0] / l, n[1] / l, n[2] / l] });
          }
        }
        movePicOutside();
        // decals: lifted onto the new surface (nearest facing triangle of the hull within DECAL_REACH, + DECAL_LIFT above it)
        e.kinds.forEach((k, gi) => {
          if (k !== 'decal' || !hull.length) return;
          const g = groups[gi], M = mats[gi], iM = M ? inv4(M) : null;
          if (M && !isIdentity(M)) return;   // a picture on a moving part (rotor blades, hub caps) stays where the player's part has it: the part is re-fitted, the picture moves with it
          if (M && !iM) return;
          const pos = Float32Array.from(g.pos as ArrayLike<number>), nrm = g.nrm as ArrayLike<number>, nv = pos.length / 3;
          const hits: ({ q: V3; n: V3 } | null)[] = [], P: V3[] = [];
          for (let v = 0; v < nv; v++) {
            const lp: V3 = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]], p = M ? xform(M, lp) : lp, nn: V3 = [nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]];
            let best = DECAL_REACH * DECAL_REACH, hit: { q: V3; n: V3 } | null = null;
            for (const t of hull) {
              if (dot(t.n, nn) < 0.3) continue;
              const r = closestOnTri(p, t.a, t.b, t.c);
              if (r.d2 < best) { best = r.d2; hit = { q: r.q, n: t.n }; }
            }
            hits.push(hit); P.push(p);
          }
          // a flat picture (a few quads) stays flat: one offset along its own normal that puts every corner above the hull (when the hull under it is within 0.15 of parallel); on a curved hull each vertex conforms
          let rigid: { n: V3; off: number } | null = null;
          if (!M) {
            const n: V3 = [0, 0, 0];
            for (let v = 0; v < nv; v++) { n[0] += nrm[v * 3]; n[1] += nrm[v * 3 + 1]; n[2] += nrm[v * 3 + 2]; }
            const l = Math.hypot(n[0], n[1], n[2]) || 1; n[0] /= l; n[1] /= l; n[2] /= l;
            const hs: number[] = [];
            for (let v = 0; v < nv; v++) if (hits[v]) hs.push(dot(sub(hits[v]!.q, P[v]), n));
            if (hs.length === nv && Math.max(...hs) - Math.min(...hs) <= 0.15) rigid = { n, off: Math.max(...hs) + DECAL_LIFT };
          }
          for (let v = 0; v < nv; v++) {
            let w: V3;
            if (rigid) w = [P[v][0] + rigid.n[0] * rigid.off, P[v][1] + rigid.n[1] * rigid.off, P[v][2] + rigid.n[2] * rigid.off];
            else { const hit = hits[v]; if (!hit) continue; w = [hit.q[0] + hit.n[0] * DECAL_LIFT, hit.q[1] + hit.n[1] * DECAL_LIFT, hit.q[2] + hit.n[2] * DECAL_LIFT]; }
            const l = iM ? xform(iM, w) : w;
            pos[v * 3] = l[0]; pos[v * 3 + 1] = l[1]; pos[v * 3 + 2] = l[2];
          }
          g.pos = pos;
        });
        // gaps: where the game's own hull has a surface and the new hull has none within GAP (an open cab door, a missing panel) the player's triangle stays: the model is closed wherever the game's was
        if (hull.length) {
          const ti = new TriIndex(0.5);
          for (const t of hull) ti.add(t.a, t.b, t.c);
          let filled = 0;
          m.groups.forEach((og, gi) => {
            if (e.kinds[gi] !== 'flat' && e.kinds[gi] !== 'uv' && e.kinds[gi] !== 'pic') return;
            const g = groups[gi], M = mats[gi], d = groupData(m, gi);
            const pos: number[] = Array.from(g.pos as ArrayLike<number>), nrm: number[] = Array.from(g.nrm as ArrayLike<number>), uvs: number[] = Array.from(g.uv as ArrayLike<number>), idx: number[] = Array.from(g.idx as ArrayLike<number>);
            // per connected piece of the player's group: when at least half of its triangles have no new surface within the gap (a tall antenna the set's shorter one does not reach, a lid) the WHOLE piece
            // stays the player's (no floating fragments); a piece that the new hull mostly covers is left to the new hull
            const nt = d.ni / 3, parent = Array.from({ length: nt }, (_, i) => i), find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
            const at = new Map<string, number>(), unc: boolean[] = [];
            for (let t = 0; t < nt; t++) {
              const ids = [0, 1, 2].map((k) => m.indices[d.fi + t * 3 + k] + d.fv);
              const L = ids.map((v) => [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]] as V3), W = L.map((q) => (M ? xform(M, q) : q));
              const c: V3 = [(W[0][0] + W[1][0] + W[2][0]) / 3, (W[0][1] + W[1][1] + W[2][1]) / 3, (W[0][2] + W[1][2] + W[2][2]) / 3];
              const pts: V3[] = [c, ...W.map((q): V3 => [c[0] + (q[0] - c[0]) * 0.7, c[1] + (q[1] - c[1]) * 0.7, c[2] + (q[2] - c[2]) * 0.7])];
              unc.push(!pts.some((q) => ti.near(q, e.gap ?? GAP)));
              for (const q of L) { const key = `${Math.round(q[0] * 1000)},${Math.round(q[1] * 1000)},${Math.round(q[2] * 1000)}`; const o = at.get(key); if (o === undefined) at.set(key, t); else parent[find(t)] = find(o); }
            }
            const tot = new Map<number, number>(), un = new Map<number, number>();
            for (let t = 0; t < nt; t++) { const r = find(t); tot.set(r, (tot.get(r) ?? 0) + 1); if (unc[t]) un.set(r, (un.get(r) ?? 0) + 1); }
            for (let t = 0; t < nt; t++) {
              const r = find(t);
              if ((un.get(r) ?? 0) < 0.5 * tot.get(r)!) continue;
              const ids = [0, 1, 2].map((k) => m.indices[d.fi + t * 3 + k] + d.fv), base = pos.length / 3;
              for (const v of ids) { pos.push(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]); nrm.push(m.normals[v * 3], m.normals[v * 3 + 1], m.normals[v * 3 + 2]); uvs.push(m.uvs[v * 2], m.uvs[v * 2 + 1]); }
              idx.push(base, base + 1, base + 2); filled++;
            }
            g.pos = Float32Array.from(pos); g.nrm = Float32Array.from(nrm); g.uv = Float32Array.from(uvs); g.idx = idx;
          });
          env.stats.gapTriangles = (env.stats.gapTriangles ?? 0) + filled;
        }
        env.put(e.member, writeMsh(groups, m.gtom && m.matl ? { gtom: m.gtom, matl: m.matl } : {}));
        replaced++; trisBefore += m.indices.length / 3; trisAfter += groups.reduce((s, g) => s + g.idx.length / 3, 0);
      } catch (err) { env.log(`${e.member}: ${String(err)}`); }
    }
    env.stats.replaced = replaced; env.stats.left = left; env.stats.missing = missing; env.stats.trianglesBefore = trisBefore; env.stats.trianglesAfter = trisAfter;
  },
};
