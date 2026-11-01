// Body assembler: the pack's LDraw body (fitted, decimated, skinned, in the reference pose) + the player's original body mesh -> a new body .msh with the SAME groups in the
// same order: solid groups come from the LDraw geometry (UVs and normals taken from the original's nearest surface), decal groups are the original's own quads draped on the new surface.
import { writeMsh, type MshOutGroup, type MshSkinExtra } from '../mshio.ts';
import { TriSet, surfaceNormal, degenerateTri, norm, sub, len, dot, type V3 } from './geo.ts';
import { readOrig, groupIndices, copyGroup, type Orig } from './orig.ts';
import { creaseNormals } from '../geom/decimate.ts';
import type { Rig } from './rig.ts';
import type { BodyBlob } from './bodypack.ts';

export const DECAL_LIFT = 0.012;
/** a decal that wraps a faceted part: its flat triangles cut through the corners of the facets (a sagitta of up to 0.02), so it floats this far above the surface */
export const DECAL_LIFT_CURVED = 0.03;

export interface BodyOptions {
  /** per original group: 'S' = solid (rebuilt from the pack), 'D' = decal (the original's quads, draped), 'K' = kept as it is */
  roles: string;
  /** decal subdivision: deviation tolerance (model units) / smallest edge */
  tol?: number; minEdge?: number; maxDepth?: number;
  /** per original group: the parts (indices into the pack's part list) that carry the decals of that group; absent = decided by the bones of the original vertices */
  hosts?: (number[] | null)[];
  /** y planes (reference pose) where the decals are cut, per part of the pack's part list (the skin band planes of that part); absent = the decals are not cut */
  partPlanes?: number[][];
}
export interface BodyStats { solidTris: number; decalTris: number; decalsMissed: number }

interface Skin { bone: number[]; w: number[]; /** per influence the bind-pose world point it is attached to (default: the vertex position): a decal vertex rides its host triangle exactly */ q?: V3[] }
const skinOf = (b: BodyBlob, v: number): Skin => { const bone: number[] = [], w: number[] = []; for (let k = 0; k < 4; k++) if (b.bone[v * 4 + k] !== 255 && b.weight[v * 4 + k] > 0) { bone.push(b.bone[v * 4 + k]); w.push(b.weight[v * 4 + k]); } return { bone, w }; };

/**
 * A point of a decal that rides a triangle of the new body EXACTLY: the skinned position of point H = u a + v b + w c on the host triangle is  sum_j lambda_j sum_i w_ji M_i p_j = sum_i W_i M_i Q_i  with
 * W_i = sum_j lambda_j w_ji and Q_i = sum_j lambda_j w_ji p_j / W_i: ONE influence per bone, each with its own bind point. The decal vertex (lifted to T = H + L) takes those influences with the points
 * Q_i + L, so in every pose it stays on the host's (flat, skinned) triangle plus the lift that turns with the bones: a decal can no longer slide behind the surface it was draped on (the plain blend of the
 * corner weights, skinned at T, is not on the triangle once the bones bend: whole prints disappeared in some poses).
 */
function rideSkin(b: BodyBlob, tri: number, u: number, v: number, w: number, H: V3, T: V3): Skin {
  const acc = new Map<number, { w: number; q: V3 }>();
  for (const [vi, lam] of [[b.idx[tri * 3], u], [b.idx[tri * 3 + 1], v], [b.idx[tri * 3 + 2], w]] as [number, number][]) {
    const s = skinOf(b, vi), p: V3 = [b.pos[vi * 3], b.pos[vi * 3 + 1], b.pos[vi * 3 + 2]];
    s.bone.forEach((bn, i) => { const k = s.w[i] * lam, e = acc.get(bn) ?? { w: 0, q: [0, 0, 0] as V3 }; e.w += k; e.q = [e.q[0] + k * p[0], e.q[1] + k * p[1], e.q[2] + k * p[2]]; acc.set(bn, e); });
  }
  const L: V3 = [T[0] - H[0], T[1] - H[1], T[2] - H[2]];
  const e = [...acc].map(([bone, x]) => ({ bone, w: x.w, q: [x.q[0] / x.w + L[0], x.q[1] / x.w + L[1], x.q[2] / x.w + L[2]] as V3 })).filter((x) => x.w > 0.004).sort((x, y) => y.w - x.w || x.bone - y.bone).slice(0, 5);
  const t = e.reduce((s, x) => s + x.w, 0) || 1;
  return { bone: e.map((x) => x.bone), w: e.map((x) => x.w / t), q: e.map((x) => x.q) };
}

/** a vertex list -> a skinned group (influences given per vertex with the WORLD position; local positions are derived here) */
interface OutV { p: V3; n: V3; uv: [number, number]; skin: Skin }
function toGroup(flags: number, verts: OutV[], idx: number[], rig: Rig): MshOutGroup {
  const n = verts.length, pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), bone = new Int32Array(n), weight = new Float32Array(n), extra: MshSkinExtra[] = [];
  verts.forEach((v, i) => {
    const b0 = v.skin.bone[0];
    bone[i] = b0; weight[i] = v.skin.w[0];
    pos.set(rig.local(b0, v.skin.q?.[0] ?? v.p), i * 3);
    nrm.set(rig.normal(v.skin.bone, v.skin.w, norm(v.n)), i * 3);   // stored so that the game's blend of it gives v.n in the reference pose (see Rig.normal)
    uv[i * 2] = v.uv[0]; uv[i * 2 + 1] = v.uv[1];
    for (let k = 1; k < v.skin.bone.length; k++) extra.push({ v: i, bone: v.skin.bone[k], weight: v.skin.w[k], local: rig.local(v.skin.bone[k], v.skin.q?.[k] ?? v.p) });
  });
  return { flags, pos, nrm, uv, idx, skin: { bone, weight, extra } };
}


function solidGroup(o: Orig, rig: Rig, blob: BodyBlob, gi: number): MshOutGroup | null {
  const tris: number[] = [];
  for (let t = 0; t < blob.group.length; t++) if (blob.group[t] === gi) tris.push(t);
  if (!tris.length) return null;
  const og = groupIndices(o, gi), uvSet = new TriSet(o.world, og);
  const candidates: number[] = []; const g = o.m.groups[gi];
  for (let v = g.firstVertex; v < g.firstVertex + g.vertexCount; v++) candidates.push(v);
  // local mesh of this group's triangles, split at creases (>40 degrees: a box keeps one normal per face, a tube stays round), every vertex carrying its own geometric normal
  const remap = new Map<number, number>(), lp: number[] = [], lidx: number[] = [], lsrc: number[] = [];
  for (const t of tris) for (let k = 0; k < 3; k++) {
    if (degenerateTri(blob.pos, blob.idx, t)) break;   // a sliver left by the cuts has no normal: dropped
    const v = blob.idx[t * 3 + k];
    let id = remap.get(v);
    if (id === undefined) { id = remap.size; remap.set(v, id); lp.push(blob.pos[v * 3], blob.pos[v * 3 + 1], blob.pos[v * 3 + 2]); lsrc.push(v); }
    lidx.push(id);
  }
  if (!lidx.length) return null;
  const cn = creaseNormals(lp, lidx, 40), verts: OutV[] = [], idx: number[] = Array.from(cn.idx);
  for (let i = 0; i < cn.src.length; i++) {
    const v = lsrc[cn.src[i]], p: V3 = [cn.pos[i * 3], cn.pos[i * 3 + 1], cn.pos[i * 3 + 2]], fn: V3 = [cn.nrm[i * 3], cn.nrm[i * 3 + 1], cn.nrm[i * 3 + 2]];
    let uv: [number, number] = [0.5, 0.5];
    const c = uvSet.closest(p, fn, 0.3, 0.35) ?? uvSet.closest(p);   // the UVs of the face of the ORIGINAL that looks the way this face does (a corner is shared by 2 - 3 faces with different mappings)
    if (c) { const a = og[c.tri * 3], b = og[c.tri * 3 + 1], d = og[c.tri * 3 + 2], U = o.m.uvs; uv = [U[a * 2] * c.u + U[b * 2] * c.v + U[d * 2] * c.w, U[a * 2 + 1] * c.u + U[b * 2 + 1] * c.v + U[d * 2 + 1] * c.w]; }
    verts.push({ p, n: surfaceNormal(p, fn, uvSet, og, o.nrm, candidates), uv, skin: skinOf(blob, v) });
  }
  return toGroup(g.flags, verts, idx, rig);
}

/** the original decal group draped on the new surface (see the header); returns the group and how many original vertices found no surface (they stay as in the original) */
function decalGroup(o: Orig, rig: Rig, blob: BodyBlob, solid: TriSet, triMask: Uint32Array, gi: number, opt: BodyOptions): { group: MshOutGroup; missed: number } {
  const tol = opt.tol ?? 0.025, minEdge = opt.minEdge ?? 0.08, maxDepth = opt.maxDepth ?? 3, stats = { dropped: 0, dev: 0, edge: 0, cut: 0 };
  const g = o.m.groups[gi], og = groupIndices(o, gi);
  // a planar decal (the print on the torso, the stripes on the legs) is lifted as ONE plane above the highest point of the surface under it (the LDraw legs have recesses it must bridge)
  const n0 = norm([o.nrm[og[0] * 3], o.nrm[og[0] * 3 + 1], o.nrm[og[0] * 3 + 2]]), p0: V3 = [o.world[og[0] * 3], o.world[og[0] * 3 + 1], o.world[og[0] * 3 + 2]];
  let planar = true;
  for (const v of og) { const nv: V3 = [o.nrm[v * 3], o.nrm[v * 3 + 1], o.nrm[v * 3 + 2]], pv: V3 = [o.world[v * 3], o.world[v * 3 + 1], o.world[v * 3 + 2]]; if (n0[0] * nv[0] + n0[1] * nv[1] + n0[2] * nv[2] < 0.97 || Math.abs(n0[0] * (pv[0] - p0[0]) + n0[1] * (pv[1] - p0[1]) + n0[2] * (pv[2] - p0[2])) > 0.02) { planar = false; break; } }
  interface DV { p: V3; n: V3; uv: [number, number]; src: number; mask: number; hit: ReturnType<TriSet['closest']> }
  // the host of a decal vertex: the nearest surface of the part that carries it (a triangle shares a bone with the vertex's original influences); planar decals also need a surface that faces the same way
  const hostParts = opt.hosts?.[gi] ?? null;
  const hostOf = (p: V3, n: V3, mask: number) => {
    const acc = hostParts ? (mask ? (t: number) => hostParts.includes(blob.part[t]) && (triMask[t] & mask) !== 0 : (t: number) => hostParts.includes(blob.part[t])) : mask ? (t: number) => (triMask[t] & mask) !== 0 : null;
    if (planar) return solid.closest(p, n, 0.5, 0.5, acc);
    // a decal that wraps a part (an arm band, a knee pad): the host point at the SAME height, along the horizontal line to the nearest surface (the nearest point alone slides down the slope of a flared part and squeezes the band)
    const c = solid.closest(p, null, 0, 0.45, acc);
    if (!c) return null;
    const h: V3 = [c.q[0] - p[0], 0, c.q[2] - p[2]], hl = Math.hypot(h[0], h[2]);
    if (hl < 1e-4) return c;
    const r = solid.ray(p, [h[0] / hl, 0, h[2] / hl], 0.6, acc);
    return r && Math.abs(r.q[1] - p[1]) < 1e-3 && dot(r.n, [c.q[0] - p[0], c.q[1] - p[1], c.q[2] - p[2]]) * 0 >= 0 ? r : c;
  };
  const maskOf = (v: number) => { let m = 0; for (const e of o.inf[v]) if (e.w >= 0.2) m |= 1 << e.bone; return m; };
  const mk = (p: V3, n: V3, uv: [number, number], src: number, mask = 0): DV => ({ p, n: norm(n), uv, src, mask, hit: hostOf(p, n, mask) });
  const LIFT = planar ? DECAL_LIFT : DECAL_LIFT_CURVED;
  const lift = (d: DV): V3 | null => d.hit ? [d.hit.q[0] + d.hit.n[0] * LIFT, d.hit.q[1] + d.hit.n[1] * LIFT, d.hit.q[2] + d.hit.n[2] * LIFT] : null;
  const skinAt = (d: DV, T: V3): Skin | null => d.hit ? rideSkin(blob, d.hit.tri, d.hit.u, d.hit.v, d.hit.w, d.hit.q, T) : null;
  const mid = (a: DV, b: DV): DV => mk([(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2, (a.p[2] + b.p[2]) / 2], [a.n[0] + b.n[0], a.n[1] + b.n[1], a.n[2] + b.n[2]], [(a.uv[0] + b.uv[0]) / 2, (a.uv[1] + b.uv[1]) / 2], -1, a.mask | b.mask);
  const out: [DV, DV, DV][] = [];
  const prime = (d: DV): DV => { d.hit = hostOf(d.p, d.n, d.mask); return d; };
  const split = (a: DV, b: DV, c: DV, depth: number) => {
    const edge = Math.max(len(sub(a.p, b.p)), len(sub(b.p, c.p)), len(sub(c.p, a.p)));
    const hits = (a.hit ? 1 : 0) + (b.hit ? 1 : 0) + (c.hit ? 1 : 0);
    let need = false;
    if (depth < maxDepth && edge > minEdge) {
      if (hits === 3 && planar) { /* flat on flat: no deviation to follow */ }
      else if (hits === 3) {
        const la = lift(a)!, lb = lift(b)!, lc = lift(c)!;
        const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
        const probes: [V3, V3][] = [];
        for (const [m, p, q] of [[ab, la, lb], [bc, lb, lc], [ca, lc, la]] as [DV, V3, V3][]) probes.push([lift(m) ?? [m.p[0], m.p[1], m.p[2]], [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]]);
        for (const [x, y] of probes) if (len(sub(x, y)) > tol) need = true;
        if (need) { stats.dev++; split(a, ab, ca, depth + 1); split(ab, b, bc, depth + 1); split(ca, bc, c, depth + 1); split(ab, bc, ca, depth + 1); return; }
      } else if (hits > 0 && depth < maxDepth - 1) {   // the decal runs over the edge of the surface (the gap between the legs): cut it there
        stats.edge++;
        const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
        split(a, ab, ca, depth + 1); split(ab, b, bc, depth + 1); split(ca, bc, c, depth + 1); split(ab, bc, ca, depth + 1); return;
      }
    }
    if (hits === 3) out.push([a, b, c]); else stats.dropped++;
  };
  // the original quads, cut at the skin band planes of the new body (the new surface has vertices there: the decal follows the blend), then the adaptive split above
  let work: [DV, DV, DV][] = [];
  const raw = (v: number): DV => ({ p: [o.world[v * 3], o.world[v * 3 + 1], o.world[v * 3 + 2]], n: [o.nrm[v * 3], o.nrm[v * 3 + 1], o.nrm[v * 3 + 2]], uv: [o.m.uvs[v * 2], o.m.uvs[v * 2 + 1]], src: v, mask: maskOf(v), hit: null });
  for (let t = 0; t < og.length; t += 3) work.push([raw(og[t]), raw(og[t + 1]), raw(og[t + 2])]);
  const lerpV = (a: DV, b: DV, t: number): DV => ({ p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t], n: [a.n[0] + (b.n[0] - a.n[0]) * t, a.n[1] + (b.n[1] - a.n[1]) * t, a.n[2] + (b.n[2] - a.n[2]) * t], uv: [a.uv[0] + (b.uv[0] - a.uv[0]) * t, a.uv[1] + (b.uv[1] - a.uv[1]) * t], src: -1, mask: a.mask | b.mask, hit: null });
  const planesOf = (tri: [DV, DV, DV]): number[] => {
    if (!opt.partPlanes) return [];
    const c: V3 = [(tri[0].p[0] + tri[1].p[0] + tri[2].p[0]) / 3, (tri[0].p[1] + tri[1].p[1] + tri[2].p[1]) / 3, (tri[0].p[2] + tri[1].p[2] + tri[2].p[2]) / 3];
    const mk2 = tri[0].mask | tri[1].mask | tri[2].mask;
    const h = solid.closest(c, null, 0, 0.8, hostParts ? (t: number) => hostParts.includes(blob.part[t]) : mk2 ? (t: number) => (triMask[t] & mk2) !== 0 : null);
    return h ? opt.partPlanes[blob.part[h.tri]] ?? [] : [];
  };
  const planeMemo = new Map<[DV, DV, DV], number[]>();
  const allPlanes = [...new Set((opt.partPlanes ?? []).flat())].sort((a, b) => a - b);
  for (const y of allPlanes) {
    const next: [DV, DV, DV][] = [];
    const mine = new Map<[DV, DV, DV], number[]>();
    for (const tri of work) {
      let pl = planeMemo.get(tri); if (!pl) { pl = planesOf(tri); planeMemo.set(tri, pl); }
      if (!pl.includes(y)) { next.push(tri); continue; }
      const d = tri.map((v) => v.p[1] - y);
      if (d.every((x) => x >= -1e-6) || d.every((x) => x <= 1e-6)) { next.push(tri); continue; }
      for (const side of [1, -1]) {
        const poly: DV[] = [];
        for (let k = 0; k < 3; k++) {
          const a = tri[k], b = tri[(k + 1) % 3], da = d[k] * side, db = d[(k + 1) % 3] * side;
          if (da >= 0) poly.push(a);
          if ((da > 0 && db < 0) || (da < 0 && db > 0)) poly.push(lerpV(a, b, da / (da - db)));
        }
        for (let k = 1; k + 1 < poly.length; k++) { const piece: [DV, DV, DV] = [poly[0], poly[k], poly[k + 1]]; mine.set(piece, pl); next.push(piece); }
      }
    }
    for (const t of next) if (!planeMemo.has(t)) planeMemo.set(t, mine.get(t) ?? planesOf(t));
    work = next;
  }
  stats.cut = work.length;
  for (const [a, b, c] of work) split(prime(a), prime(b), prime(c), 0);
  if ((globalThis as { __decalDebug?: boolean }).__decalDebug) console.log(`decal group ${gi}: cut ${stats.cut}, dev splits ${stats.dev}, edge splits ${stats.edge}, dropped ${stats.dropped}, out ${out.length}`);
  // vertices: the draped ones are rebuilt in the new pose; a vertex that found no surface keeps its ORIGINAL skin (a vertex of a subdivided edge without a host takes the nearest original corner's)
  const verts: OutV[] = [], idx: number[] = [];
  let missed = 0, shift = -Infinity;
  if (planar) for (const tri of out) for (const d of tri) if (d.hit) shift = Math.max(shift, (d.hit.q[0] - d.p[0]) * n0[0] + (d.hit.q[1] - d.p[1]) * n0[1] + (d.hit.q[2] - d.p[2]) * n0[2]);
  for (const tri of out) for (const d of tri) {
    const p = planar && d.hit ? [d.p[0] + n0[0] * (shift + DECAL_LIFT), d.p[1] + n0[1] * (shift + DECAL_LIFT), d.p[2] + n0[2] * (shift + DECAL_LIFT)] as V3 : lift(d), sk = p ? skinAt(d, p) : null;
    if (p && sk) verts.push({ p, n: d.n, uv: d.uv, skin: sk });
    else {
      missed++;
      const src = d.src >= 0 ? d.src : tri.find((x) => x.src >= 0)?.src ?? og[0];
      const inf = o.inf[src];
      verts.push({ p: d.p, n: d.n, uv: d.uv, skin: { bone: inf.map((x) => x.bone), w: inf.map((x) => x.w) } });
    }
    idx.push(verts.length - 1);
  }
  return { group: toGroup(g.flags, verts, idx, rig), missed };
}

export function assembleBody(origBytes: Uint8Array, blob: BodyBlob, rig: Rig, opt: BodyOptions): { bytes: Uint8Array; stats: BodyStats } | null {
  const o = readOrig(origBytes, rig);
  if (!o || o.m.groups.length !== opt.roles.length) return null;
  const solid = new TriSet(blob.pos, blob.idx);
  const triMask = new Uint32Array(blob.group.length);
  for (let t = 0; t < triMask.length; t++) for (let k = 0; k < 3; k++) for (let j = 0; j < 4; j++) { const v = blob.idx[t * 3 + k] * 4 + j; if (blob.bone[v] !== 255 && blob.weight[v] >= 0.15) triMask[t] |= 1 << blob.bone[v]; }
  const groups: MshOutGroup[] = [];
  const stats: BodyStats = { solidTris: 0, decalTris: 0, decalsMissed: 0 };
  for (let gi = 0; gi < o.m.groups.length; gi++) {
    const role = opt.roles[gi];
    let g: MshOutGroup | null = null;
    if (role === 'S') { g = solidGroup(o, rig, blob, gi); if (g) stats.solidTris += g.idx.length / 3; }
    else if (role === 'D') { const r = decalGroup(o, rig, blob, solid, triMask, gi, opt); g = r.group; stats.decalTris += g.idx.length / 3; stats.decalsMissed += r.missed; }
    groups.push(g ?? copyGroup(o, gi));
  }
  return { bytes: writeMsh(groups, { skinned: true, gtom: o.m.gtom, matl: o.m.matl }), stats };
}
