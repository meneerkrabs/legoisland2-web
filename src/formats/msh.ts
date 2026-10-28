// .msh mesh. Little endian.
//   "VERT" u32 n; n x { f32 x,y,z; u32 colour(ARGB); f32 u,v,u2,v2 }  (32 bytes)
//   n x { f32 nx,ny,nz }                                              (normals, no tag)
//   "INDL" u32 k; k x u16                                              (triangle list, indices relative to the group's firstVertex)
//   "GRPL" u32 g; g x { u32 flags, indexCount, firstVertex, vertexCount, firstIndex }
//   optional "GTOM" u32 c; c x u32      group -> entry of MATL
//   optional "MATL" u32 c; c x 9 f32    (translation xyz, rotation xyz, scale xyz) per material/part
//   optional "SVWL" u32 n; ...          per-vertex blend/weld data, runs to end of file
import { Reader } from './reader.ts';
import { buildMatrix } from './matrix.ts';

export interface MshGroup {
  flags: number;
  indexCount: number;
  firstVertex: number;
  vertexCount: number;
  firstIndex: number;
}

export interface Msh {
  vertexCount: number;
  /** x,y,z per vertex */
  positions: Float32Array;
  /** 0xAARRGGBB per vertex */
  colors: Uint32Array;
  /** u,v per vertex (first UV set) */
  uvs: Float32Array;
  /** u2,v2 per vertex */
  uvs2: Float32Array;
  normals: Float32Array;
  /** triangle list, indices relative to the owning group's firstVertex */
  indices: Uint16Array;
  groups: MshGroup[];
  /** group -> MATL entry */
  gtom: Uint32Array | null;
  /** 9 floats per entry: translation, rotation (radians), scale */
  matl: Float32Array | null;
  /** raw bytes after the SVWL count (n = vertexCount) */
  svwl: Uint8Array | null;
}

export function parseMsh(data: Uint8Array): Msh {
  const r = new Reader(data);
  r.expectTag('VERT');
  const n = r.u32();
  const positions = new Float32Array(n * 3);
  const colors = new Uint32Array(n);
  const uvs = new Float32Array(n * 2);
  const uvs2 = new Float32Array(n * 2);
  if (r.remaining < n * 44) throw new Error('truncated vertices');
  for (let i = 0; i < n; i++) {
    positions[i * 3] = r.f32();
    positions[i * 3 + 1] = r.f32();
    positions[i * 3 + 2] = r.f32();
    colors[i] = r.u32();
    uvs[i * 2] = r.f32();
    uvs[i * 2 + 1] = r.f32();
    uvs2[i * 2] = r.f32();
    uvs2[i * 2 + 1] = r.f32();
  }
  const normals = r.f32s(n * 3);
  r.expectTag('INDL');
  const k = r.u32();
  const indices = r.u16s(k);
  r.expectTag('GRPL');
  const g = r.u32();
  const groups: MshGroup[] = [];
  for (let i = 0; i < g; i++) groups.push({ flags: r.u32(), indexCount: r.u32(), firstVertex: r.u32(), vertexCount: r.u32(), firstIndex: r.u32() });
  let gtom: Uint32Array | null = null, matl: Float32Array | null = null, svwl: Uint8Array | null = null;
  while (!r.eof()) {
    const t = r.tag();
    const c = r.u32();
    if (t === 'GTOM') gtom = r.u32s(c);
    else if (t === 'MATL') matl = r.f32s(c * 9);
    else if (t === 'SVWL') {
      if (c !== n) throw new Error(`SVWL count ${c} != vertex count ${n}`);
      svwl = r.bytes(r.remaining);
    } else throw new Error(`unknown mesh chunk "${t}" at ${r.pos - 8}`);
  }
  return { vertexCount: n, positions, colors, uvs, uvs2, normals, indices, groups, gtom, matl, svwl };
}

/** Structural validation used by tests; returns a list of problems (empty = ok). */
export function validateMsh(m: Msh): string[] {
  const p: string[] = [];
  if (m.indices.length % 3) p.push('index count not multiple of 3');
  let ix = 0;
  for (const [gi, g] of m.groups.entries()) {
    if (g.firstIndex !== ix) p.push(`group ${gi}: firstIndex ${g.firstIndex} != running ${ix}`);
    if (g.indexCount % 3) p.push(`group ${gi}: indexCount%3`);
    if (g.firstVertex + g.vertexCount > m.vertexCount) p.push(`group ${gi}: vertex range out of bounds`);
    for (let i = g.firstIndex; i < g.firstIndex + g.indexCount; i++) {
      if (m.indices[i] >= g.vertexCount) { p.push(`group ${gi}: index ${m.indices[i]} >= vertexCount ${g.vertexCount}`); break; }
    }
    ix += g.indexCount;
  }
  if (ix !== m.indices.length) p.push(`groups cover ${ix} of ${m.indices.length} indices`);
  if (m.gtom && m.gtom.length !== m.groups.length) p.push('GTOM length != group count');
  if (m.gtom && m.matl) for (const v of m.gtom) if (v >= m.matl.length / 9) { p.push('GTOM index out of MATL range'); break; }
  for (let i = 0; i < m.positions.length; i++) if (!Number.isFinite(m.positions[i])) { p.push('non-finite position'); break; }
  return p;
}

/**
 * Per-group placement matrices (MATL entry selected by GTOM), or null for groups without one.
 * The game draws each group with world' = matl * world (FUN_0088b4c0 / FUN_0043a9e5); an entry is
 * (translation xyz, rotation xyz, scale xyz) and is built with FUN_0043a742 (see matrix.ts).
 * Meshes without GTOM/MATL return all null.
 */
export function groupMatrices(m: Msh): (Float32Array | null)[] {
  const out: (Float32Array | null)[] = m.groups.map(() => null);
  if (!m.gtom || !m.matl) return out;
  const n = m.matl.length / 9, cache: (Float32Array | undefined)[] = [];
  for (let g = 0; g < m.groups.length; g++) {
    const i = m.gtom[g];
    if (i === undefined || i >= n) continue; // a few shipped meshes have a truncated MATL table: treated as "no matrix"
    const f = m.matl.subarray(i * 9, i * 9 + 9);
    out[g] = cache[i] ??= buildMatrix(f[3], f[4], f[5], f[0], f[1], f[2], f[6], f[7], f[8]);
  }
  return out;
}
