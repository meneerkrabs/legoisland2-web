// LEGO 3D generator "glass": the game's translucent glass is a one-sided surface (docs/re/lego3d.md sections 16.9, 16.10). The meshes the LEGO 3D option does not replace (hospital, shops, houses ...)
// have the same panes: seen from inside a building (the free camera, the flight) a window shows the sky, not the glass. This generator writes, for each such mesh of the table, a copy of the player's own
// mesh in which every glass triangle that has no partner facing the other way yet gets a reversed copy appended to ITS OWN group (same group, flags, texture slot, vertex colours, uv and uv2, GTOM / MATL).
//
// Two-layer rule: the pack holds a TABLE only (per archive: member name, content hash of the game's mesh, group count, the indices of the glass groups). Nothing of the game's geometry is stored; the
// back faces are derived from the player's mesh at run time.
//
// Safety, because a game mesh must never change silently: a member whose hash is not the table's (a mod replaced it), that does not parse, that has skin weights, whose group layout is not the plain
// consecutive one, or whose UNMODIFIED parse -> serialise round trip is not byte-identical is left alone. The added vertices go at the END of the glass group (the game's own vertices and triangles
// stay the first part of the group in the same order); the groups after it shift by the added counts, nothing else is touched. A member that an earlier generator wrote (the studs) is the starting point
// when it has the same groups: the hash is checked against the player's archive.
import { parseMsh } from '../../../formats/msh.ts';
import type { Msh, MshGroup } from '../../../formats/msh.ts';
import type { Generator } from './types.ts';
import { hashMember } from '../meshpack.ts';

export interface GlassMeshEntry {
  /** member path as the archive spells it */
  m: string;
  /** content hash of the game's mesh (hashMember) */
  h: string;
  /** number of groups of the mesh */
  c: number;
  /** indices of the glass groups */
  g: number[];
  /** triangles the generator adds (informational, from the build) */
  t: number;
}
export interface GlassTable { v: number; archive: string; meshes: GlassMeshEntry[] }

/** a group may not exceed the 16 bit indices of the format */
const MAX_GROUP_VERTICES = 65535;
/** pairing test of the sets generator (`addBackFaces`): a partner is a triangle facing the other way (cos < -0.999) in the same plane (0.002) that contains the centroid */
const OPPOSITE = -0.999, PLANE_TOL = 0.002, EDGE_TOL = -1e-6;

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * The triangles (indices into the group's triangle list) of group `gi` that have no partner facing the other way: what a two-sided copy has to add. Same rule as `addBackFaces` of sets.ts
 * (degenerate triangles count as paired), with a grid over the triangle boxes so a group of thousands of triangles stays cheap.
 */
export function unpairedTriangles(m: Msh, gi: number): number[] {
  const g = m.groups[gi], nt = g.indexCount / 3;
  const P: V3[][] = [], N: V3[] = [], L: number[] = [], lo: V3[] = [], hi: V3[] = [];
  for (let t = 0; t < nt; t++) {
    const p = [0, 1, 2].map((k) => { const v = m.indices[g.firstIndex + t * 3 + k] + g.firstVertex; return [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]] as V3; });
    const n = cross(sub(p[1], p[0]), sub(p[2], p[0])), l = Math.hypot(n[0], n[1], n[2]);
    P.push(p); L.push(l); N.push(l > 1e-12 ? [n[0] / l, n[1] / l, n[2] / l] : [0, 0, 0]);
    lo.push([0, 1, 2].map((c) => Math.min(p[0][c], p[1][c], p[2][c])) as V3); hi.push([0, 1, 2].map((c) => Math.max(p[0][c], p[1][c], p[2][c])) as V3);
  }
  const CELL = 1, key = (x: number, y: number, z: number) => `${x},${y},${z}`, grid = new Map<string, number[]>(), big: number[] = [];
  for (let t = 0; t < nt; t++) {
    if (L[t] < 1e-12) continue;
    const a = lo[t].map((v) => Math.floor(v / CELL)), b = hi[t].map((v) => Math.floor(v / CELL));
    if ((b[0] - a[0] + 1) * (b[1] - a[1] + 1) * (b[2] - a[2] + 1) > 512) { big.push(t); continue; }
    for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) for (let z = a[2]; z <= b[2]; z++) { const k = key(x, y, z), l = grid.get(k); if (l) l.push(t); else grid.set(k, [t]); }
  }
  const partner = (t: number, u: number, c: V3) => {
    if (u === t || L[u] < 1e-12 || dot(N[t], N[u]) > OPPOSITE || Math.abs(dot(sub(c, P[u][0]), N[u])) > PLANE_TOL) return false;
    return [0, 1, 2].every((k) => dot(cross(sub(P[u][(k + 1) % 3], P[u][k]), sub(c, P[u][k])), N[u]) >= EDGE_TOL);
  };
  const out: number[] = [];
  for (let t = 0; t < nt; t++) {
    if (L[t] < 1e-12) continue;
    const c: V3 = [(P[t][0][0] + P[t][1][0] + P[t][2][0]) / 3, (P[t][0][1] + P[t][1][1] + P[t][2][1]) / 3, (P[t][0][2] + P[t][1][2] + P[t][2][2]) / 3];
    let has = big.some((u) => partner(t, u, c));
    if (!has) for (const u of grid.get(key(Math.floor(c[0] / CELL), Math.floor(c[1] / CELL), Math.floor(c[2] / CELL))) ?? []) if (partner(t, u, c)) { has = true; break; }
    if (!has) out.push(t);
  }
  return out;
}

/**
 * parseMsh's inverse: the same chunks in the same order (VERT, INDL, GRPL, then GTOM / MATL / SVWL as the parser found them). `parseMsh(serialiseMsh(m))` equals `m`; for the game's own meshes the bytes are identical
 * (the generator checks that before it changes anything, `mshRoundTrips`).
 */
export function serialiseMsh(m: Msh): Uint8Array {
  const n = m.vertexCount, k = m.indices.length, g = m.groups.length;
  const size = 8 + n * 32 + n * 12 + 8 + k * 2 + 8 + g * 20 + (m.gtom ? 8 + m.gtom.length * 4 : 0) + (m.matl ? 8 + m.matl.length * 4 : 0) + (m.svwl ? 8 + m.svwl.length : 0);
  const buf = new ArrayBuffer(size), dv = new DataView(buf);
  let p = 0;
  const tag = (t: string) => { for (let i = 0; i < 4; i++) dv.setUint8(p++, t.charCodeAt(i)); };
  const u32 = (v: number) => { dv.setUint32(p, v, true); p += 4; };
  const f32 = (v: number) => { dv.setFloat32(p, v, true); p += 4; };
  tag('VERT'); u32(n);
  for (let i = 0; i < n; i++) { f32(m.positions[i * 3]); f32(m.positions[i * 3 + 1]); f32(m.positions[i * 3 + 2]); u32(m.colors[i]); f32(m.uvs[i * 2]); f32(m.uvs[i * 2 + 1]); f32(m.uvs2[i * 2]); f32(m.uvs2[i * 2 + 1]); }
  for (let i = 0; i < n * 3; i++) f32(m.normals[i]);
  tag('INDL'); u32(k);
  for (let i = 0; i < k; i++) { dv.setUint16(p, m.indices[i], true); p += 2; }
  tag('GRPL'); u32(g);
  for (const q of m.groups) { u32(q.flags); u32(q.indexCount); u32(q.firstVertex); u32(q.vertexCount); u32(q.firstIndex); }
  if (m.gtom) { tag('GTOM'); u32(m.gtom.length); for (let i = 0; i < m.gtom.length; i++) u32(m.gtom[i]); }
  if (m.matl) { tag('MATL'); u32(m.matl.length / 9); for (let i = 0; i < m.matl.length; i++) f32(m.matl[i]); }
  if (m.svwl) { tag('SVWL'); u32(n); new Uint8Array(buf, p, m.svwl.length).set(m.svwl); p += m.svwl.length; }
  if (p !== size) throw new Error(`serialiseMsh: wrote ${p} of ${size} bytes`);
  return new Uint8Array(buf);
}

/** the mesh's own bytes come back unchanged through parse -> serialise (the precondition of changing a game mesh) */
export function mshRoundTrips(bytes: Uint8Array): boolean {
  try {
    const back = serialiseMsh(parseMsh(bytes));
    if (back.length !== bytes.length) return false;
    for (let i = 0; i < back.length; i++) if (back[i] !== bytes[i]) return false;
    return true;
  } catch { return false; }
}

/** groups are one consecutive vertex range and one consecutive index range each, in order (what the writers produce and the engine's draw loop assumes) */
function plainLayout(m: Msh): boolean {
  let v = 0, i = 0;
  for (const g of m.groups) { if (g.firstVertex !== v || g.firstIndex !== i) return false; v += g.vertexCount; i += g.indexCount; }
  return v === m.vertexCount && i === m.indices.length;
}

export interface BackResult { msh: Msh; /** triangles added per group index (only glass groups present) */ added: Map<number, number> }

/**
 * A copy of `m` in which the listed groups got a reversed copy of every unpaired triangle appended: one new vertex per source vertex used (same position, colour, uv, uv2, normal negated),
 * the triangle (a, b, c) as (a', c', b'). Null when nothing is to add. Throws when the layout is not the plain one, the mesh is skinned or a group would exceed 65535 vertices.
 */
export function addBackFaces(m: Msh, glassGroups: readonly number[]): BackResult | null {
  if (m.svwl) throw new Error('skinned mesh');
  if (!plainLayout(m)) throw new Error('groups are not consecutive');
  const extra = new Map<number, number[]>();   // group -> unpaired triangles
  for (const gi of glassGroups) { const g = m.groups[gi]; if (!g) throw new Error(`no group ${gi}`); const u = unpairedTriangles(m, gi); if (u.length) extra.set(gi, u); }
  if (!extra.size) return null;
  // per glass group: the source vertices (local indices) in first-use order, the new triangles as indices into that list
  const plan = new Map<number, { src: number[]; tri: number[] }>();
  for (const [gi, tris] of extra) {
    const g = m.groups[gi], at = new Map<number, number>(), src: number[] = [], tri: number[] = [];
    for (const t of tris) {
      const ids = [0, 1, 2].map((k) => m.indices[g.firstIndex + t * 3 + k]);
      const back = ids.map((v) => { let b = at.get(v); if (b === undefined) { b = src.length; at.set(v, b); src.push(v); } return b; });
      tri.push(back[0], back[2], back[1]);
    }
    if (g.vertexCount + src.length > MAX_GROUP_VERTICES) throw new Error(`group ${gi}: ${g.vertexCount + src.length} vertices`);
    plan.set(gi, { src, tri });
  }
  const addV = [...plan.values()].reduce((s, p) => s + p.src.length, 0), addI = [...plan.values()].reduce((s, p) => s + p.tri.length, 0);
  const n = m.vertexCount + addV;
  const positions = new Float32Array(n * 3), colors = new Uint32Array(n), uvs = new Float32Array(n * 2), uvs2 = new Float32Array(n * 2), normals = new Float32Array(n * 3), indices = new Uint16Array(m.indices.length + addI);
  const groups: MshGroup[] = [];
  let v = 0, ix = 0;
  m.groups.forEach((g, gi) => {
    const pl = plan.get(gi), fv = g.firstVertex;
    const ng: MshGroup = { flags: g.flags, indexCount: g.indexCount + (pl?.tri.length ?? 0), firstVertex: v, vertexCount: g.vertexCount + (pl?.src.length ?? 0), firstIndex: ix };
    for (let i = 0; i < g.vertexCount; i++) copyVertex(fv + i, v + i, 1);
    for (let i = 0; i < g.indexCount; i++) indices[ix + i] = m.indices[g.firstIndex + i];
    if (pl) {
      pl.src.forEach((s, i) => copyVertex(fv + s, v + g.vertexCount + i, -1));
      for (let i = 0; i < pl.tri.length; i++) indices[ix + g.indexCount + i] = g.vertexCount + pl.tri[i];
    }
    v += ng.vertexCount; ix += ng.indexCount;
    groups.push(ng);
  });
  function copyVertex(from: number, to: number, nsign: number) {
    positions.set(m.positions.subarray(from * 3, from * 3 + 3), to * 3);
    colors[to] = m.colors[from];
    uvs.set(m.uvs.subarray(from * 2, from * 2 + 2), to * 2);
    uvs2.set(m.uvs2.subarray(from * 2, from * 2 + 2), to * 2);
    for (let c = 0; c < 3; c++) normals[to * 3 + c] = nsign < 0 ? -m.normals[from * 3 + c] : m.normals[from * 3 + c];
  }
  const added = new Map<number, number>();
  for (const [gi, p] of plan) added.set(gi, p.tri.length / 3);
  return { msh: { vertexCount: n, positions, colors, uvs, uvs2, normals, indices, groups, gtom: m.gtom, matl: m.matl, svwl: null }, added };
}

export const generator: Generator = {
  id: 'glass',
  applies: (name, pack) => pack.has(`glass/arch/${name.toLowerCase()}.json`),
  async run(env) {
    const table = await env.pack.json<GlassTable>(`glass/arch/${env.name.toLowerCase()}.json`);
    let meshes = 0, tris = 0, skipped = 0, bytes = 0;
    const t0 = Date.now();
    for (const e of table.meshes) {
      const hit = env.archive.find(e.m);
      if (!hit) { skipped++; continue; }
      if (hashMember(env.archive.read(hit)) !== e.h) { env.log(`${e.m}: not the game's mesh (hash), left alone`); skipped++; continue; }
      const cur = env.read(hit.path);
      if (!cur) { skipped++; continue; }
      try {
        if (!mshRoundTrips(cur)) { env.log(`${e.m}: does not round-trip byte for byte, left alone`); skipped++; continue; }
        const m = parseMsh(cur);
        if (m.groups.length !== e.c) { env.log(`${e.m}: ${m.groups.length} groups, the table has ${e.c}, left alone`); skipped++; continue; }
        const r = addBackFaces(m, e.g);
        if (!r) { skipped++; continue; }
        const out = serialiseMsh(r.msh);
        env.put(hit.path, out);
        meshes++; for (const a of r.added.values()) tris += a;
        bytes += out.length - cur.length;
      } catch (err) { env.log(`${e.m}: ${(err as Error).message}`); skipped++; }
    }
    env.stats['glass-meshes'] = meshes; env.stats['glass-triangles'] = tris; env.stats['glass-skipped'] = skipped; env.stats['glass-bytes'] = bytes; env.stats['glass-ms'] = Date.now() - t0;
  },
};
