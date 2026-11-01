// Static (unskinned) mesh assembler for heads, hands, hair, headgear, accessories: the pack's fitted LDraw geometry (positions in the original mesh's own coordinate system, one target group
// per triangle) + the player's original mesh -> a new .msh with the SAME groups in the same order. Rebuilt groups take UVs and normals from the original's nearest surface of that group,
// 'K' groups are copied as they are (a hair group, a decal quad). GTOM / MATL are kept.
import { parseMsh } from '../../../formats/msh.ts';
import { writeMsh, type MshOutGroup } from '../mshio.ts';
import { TriSet, surfaceNormal, degenerateTri, norm, sub, len, type V3 } from './geo.ts';
import { creaseNormals } from '../geom/decimate.ts';

/** magic "CST1": u32 nV, u32 nT, f32 lo[3], f32 hi[3], u16 pos[3 nV], u16 idx[3 nT], u8 group[nT] */
export interface StaticBlob { pos: Float32Array; idx: Uint16Array; group: Uint8Array }
const MAGIC = 0x3154_5343;
export function encodeStatic(b: { pos: ArrayLike<number>; idx: ArrayLike<number>; group: ArrayLike<number> }): Uint8Array {
  const nV = b.pos.length / 3, nT = b.idx.length / 3;
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < nV; i++) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], b.pos[i * 3 + c]); hi[c] = Math.max(hi[c], b.pos[i * 3 + c]); }
  const buf = new ArrayBuffer(12 + 24 + nV * 6 + nT * 6 + nT), dv = new DataView(buf);
  let p = 0;
  dv.setUint32(p, MAGIC, true); dv.setUint32(p + 4, nV, true); dv.setUint32(p + 8, nT, true); p += 12;
  for (const v of lo) { dv.setFloat32(p, v, true); p += 4; } for (const v of hi) { dv.setFloat32(p, v, true); p += 4; }
  for (let i = 0; i < nV; i++) for (let c = 0; c < 3; c++) { dv.setUint16(p, Math.round(((b.pos[i * 3 + c] - lo[c]) / (hi[c] - lo[c] || 1)) * 65535), true); p += 2; }
  for (let i = 0; i < nT * 3; i++) { dv.setUint16(p, b.idx[i], true); p += 2; }
  for (let i = 0; i < nT; i++) dv.setUint8(p++, b.group[i]);
  return new Uint8Array(buf);
}
export function decodeStatic(bytes: Uint8Array): StaticBlob {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('not a static blob');
  const nV = dv.getUint32(4, true), nT = dv.getUint32(8, true);
  const lo = [0, 1, 2].map((c) => dv.getFloat32(12 + c * 4, true)), hi = [0, 1, 2].map((c) => dv.getFloat32(24 + c * 4, true));
  let p = 36;
  const pos = new Float32Array(nV * 3);
  for (let i = 0; i < nV; i++) for (let c = 0; c < 3; c++) { pos[i * 3 + c] = lo[c] + (dv.getUint16(p, true) / 65535) * (hi[c] - lo[c]); p += 2; }
  const idx = new Uint16Array(nT * 3);
  for (let i = 0; i < nT * 3; i++) { idx[i] = dv.getUint16(p, true); p += 2; }
  return { pos, idx, group: new Uint8Array(bytes.subarray(p, p + nT)) };
}

export interface StaticStats { tris: number; decalTris?: number; decalsMissed?: number }
/** a decal lies this far above the host surface (model units); a faceted host needs more (the decal's flat triangles cut through the corners of the facets) */
export const STATIC_DECAL_LIFT = 0.012;
/**
 * A 'D' group (a print, a badge: a few flat quads that are NOT part of the LDraw shape) = the original triangles draped on the rebuilt surface: every vertex goes to the nearest point of the
 * rebuilt groups that faces the same way (within `maxD`), lifted along that surface's normal; long edges are split while the draped triangle would float above / cut into the host by more than `tol`.
 * UVs and normals stay the original's. Triangles that find no host are dropped; `null` when nothing is left (the caller keeps the original group).
 */
function drapeGroup(m: ReturnType<typeof parseMsh>, gi: number, host: TriSet, tol = 0.02, minEdge = 0.12, maxDepth = 3, maxD = 0.35): { group: MshOutGroup; missed: number } | null {
  const og = m.groups[gi];
  interface DV { p: V3; n: V3; uv: [number, number]; hit: ReturnType<TriSet['closest']> }
  const hostOf = (p: V3, n: V3) => host.closest(p, n, 0.2, maxD) ?? host.closest(p, null, 0, maxD * 0.5);
  const mk = (p: V3, n: V3, uv: [number, number]): DV => ({ p, n: norm(n), uv, hit: hostOf(p, n) });
  const lift = (d: DV): V3 | null => d.hit ? [d.hit.q[0] + d.hit.n[0] * STATIC_DECAL_LIFT, d.hit.q[1] + d.hit.n[1] * STATIC_DECAL_LIFT, d.hit.q[2] + d.hit.n[2] * STATIC_DECAL_LIFT] : null;
  const mid = (a: DV, b: DV): DV => mk([(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2, (a.p[2] + b.p[2]) / 2], [a.n[0] + b.n[0], a.n[1] + b.n[1], a.n[2] + b.n[2]], [(a.uv[0] + b.uv[0]) / 2, (a.uv[1] + b.uv[1]) / 2]);
  const out: [DV, DV, DV][] = [];
  let missed = 0;
  const split = (a: DV, b: DV, c: DV, depth: number) => {
    const edge = Math.max(len(sub(a.p, b.p)), len(sub(b.p, c.p)), len(sub(c.p, a.p)));
    const ok = !!(a.hit && b.hit && c.hit);
    if (depth < maxDepth && edge > minEdge) {
      let need = !ok;   // a triangle over the rim of the host: cut it there
      if (ok) {
        const la = lift(a)!, lb = lift(b)!, lc = lift(c)!;
        for (const [x, y, p, q] of [[a, b, la, lb], [b, c, lb, lc], [c, a, lc, la]] as [DV, DV, V3, V3][]) {
          const md = mid(x, y), lm = lift(md) ?? md.p;
          if (len(sub(lm, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2])) > tol) need = true;
        }
      }
      if (need) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); split(a, ab, ca, depth + 1); split(ab, b, bc, depth + 1); split(ca, bc, c, depth + 1); split(ab, bc, ca, depth + 1); return; }
    }
    if (ok) out.push([a, b, c]); else missed++;
  };
  const raw = (v: number): DV => mk([m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]], [m.normals[v * 3], m.normals[v * 3 + 1], m.normals[v * 3 + 2]], [m.uvs[v * 2], m.uvs[v * 2 + 1]]);
  for (let k = 0; k < og.indexCount; k += 3) {
    const v = [0, 1, 2].map((j) => m.indices[og.firstIndex + k + j] + og.firstVertex);
    split(raw(v[0]), raw(v[1]), raw(v[2]), 0);
  }
  if (!out.length) return null;
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const tri of out) for (const d of tri) { const p = lift(d)!; pos.push(p[0], p[1], p[2]); nrm.push(d.n[0], d.n[1], d.n[2]); uv.push(d.uv[0], d.uv[1]); idx.push(idx.length); }
  return { group: { flags: og.flags, pos, nrm, uv, idx }, missed };
}

/** roles: per original group 'S' (rebuilt from the blob), 'K' (kept) or 'D' (the original draped on the rebuilt surface, see drapeGroup); `nrmFrom[g]` = further groups whose vertices also supply normals for group g (the skin takes the face's too) */
export function assembleStatic(origBytes: Uint8Array, blob: StaticBlob, roles: string, nrmFrom: number[][] = []): { bytes: Uint8Array; stats: StaticStats } | null {
  const m = parseMsh(origBytes);
  if (m.groups.length !== roles.length || m.svwl) return null;
  const groups: MshOutGroup[] = [];
  let tris = 0, decalTris = 0, decalsMissed = 0;
  // the surface the decals ride on: every blob triangle of an 'S' group
  let host: TriSet | null = null;
  if (roles.includes('D')) { const ts: number[] = []; for (let t = 0; t < blob.group.length; t++) if (roles[blob.group[t]] === 'S') ts.push(t); if (ts.length) host = new TriSet(blob.pos, blob.idx, ts); }
  for (let gi = 0; gi < m.groups.length; gi++) {
    const og = m.groups[gi];
    const copy = (): MshOutGroup => ({ flags: og.flags, pos: m.positions.slice(og.firstVertex * 3, (og.firstVertex + og.vertexCount) * 3), nrm: m.normals.slice(og.firstVertex * 3, (og.firstVertex + og.vertexCount) * 3), uv: m.uvs.slice(og.firstVertex * 2, (og.firstVertex + og.vertexCount) * 2), idx: Array.from(m.indices.subarray(og.firstIndex, og.firstIndex + og.indexCount)) });
    if (roles[gi] === 'D' && host) {
      const r = drapeGroup(m, gi, host);
      if (r) { groups.push(r.group); tris += r.group.idx.length / 3; decalTris += r.group.idx.length / 3; decalsMissed += r.missed; continue; }
    }
    if (roles[gi] !== 'S') { groups.push(copy()); tris += og.indexCount / 3; continue; }
    const mine: number[] = [];
    for (let t = 0; t < blob.group.length; t++) if (blob.group[t] === gi) mine.push(t);
    if (!mine.length) { groups.push(copy()); tris += og.indexCount / 3; continue; }
    const gIdx: number[] = [];
    for (let k = 0; k < og.indexCount; k++) gIdx.push(m.indices[og.firstIndex + k] + og.firstVertex);
    const uvSet = new TriSet(m.positions, gIdx);
    const cand: number[] = [], nIdx: number[] = [];
    for (const g2 of [gi, ...(nrmFrom[gi] ?? [])]) { const o2 = m.groups[g2]; for (let v = o2.firstVertex; v < o2.firstVertex + o2.vertexCount; v++) cand.push(v); for (let k = 0; k < o2.indexCount; k++) nIdx.push(m.indices[o2.firstIndex + k] + o2.firstVertex); }
    const nrmSet = new TriSet(m.positions, nIdx);   // the surface the normals are read from: this group's triangles and those of the groups it shares normals with
    // the rebuilt triangles of this group, vertices split at creases (> 40 degrees) so every vertex has one geometric normal; normals / UVs come from the original's nearest surface of this group
    const remap = new Map<number, number>(), lp: number[] = [], lidx: number[] = [];
    for (const t of mine) for (let k = 0; k < 3; k++) {
      if (degenerateTri(blob.pos, blob.idx, t)) break;
      const v = blob.idx[t * 3 + k];
      let id = remap.get(v);
      if (id === undefined) { id = remap.size; remap.set(v, id); lp.push(blob.pos[v * 3], blob.pos[v * 3 + 1], blob.pos[v * 3 + 2]); }
      lidx.push(id);
    }
    if (!lidx.length) { groups.push(copy()); tris += og.indexCount / 3; continue; }
    const cn = creaseNormals(lp, lidx, 40), pos: number[] = Array.from(cn.pos), nrm: number[] = [], uv: number[] = [], idx: number[] = Array.from(cn.idx);
    for (let i = 0; i < cn.src.length; i++) {
      const p: V3 = [cn.pos[i * 3], cn.pos[i * 3 + 1], cn.pos[i * 3 + 2]], fn: V3 = [cn.nrm[i * 3], cn.nrm[i * 3 + 1], cn.nrm[i * 3 + 2]];
      const n = surfaceNormal(p, fn, nrmSet, nIdx, m.normals, cand, m.positions); nrm.push(n[0], n[1], n[2]);
      const c = uvSet.closest(p, fn, 0.3, 0.35) ?? uvSet.closest(p);   // the UVs of the face of the ORIGINAL that looks the way this face does (a corner is shared by 2 - 3 faces with different mappings)
      if (c) { const a = gIdx[c.tri * 3], b = gIdx[c.tri * 3 + 1], d = gIdx[c.tri * 3 + 2], U = m.uvs; uv.push(U[a * 2] * c.u + U[b * 2] * c.v + U[d * 2] * c.w, U[a * 2 + 1] * c.u + U[b * 2 + 1] * c.v + U[d * 2 + 1] * c.w); } else uv.push(0.5, 0.5);
    }
    groups.push({ flags: og.flags, pos, nrm, uv, idx });
    tris += idx.length / 3;
  }
  return { bytes: writeMsh(groups, { gtom: m.gtom, matl: m.matl }), stats: { tris, decalTris, decalsMissed } };
}
