// The player's original skinned mesh in the reference pose: world positions / normals, per-vertex influences, group lookups (shared by the body / decal assemblers).
import { parseMsh, type Msh } from '../../../formats/msh.ts';
import { parseSvwl, skinPositions, skinNormals, type Svwl } from '../../../formats/anim.ts';
import type { MshOutGroup, MshSkinExtra } from '../mshio.ts';
import type { Rig } from './rig.ts';
import type { V3 } from './geo.ts';

export interface Influence { bone: number; w: number; local: V3 }
export interface Orig {
  m: Msh; sv: Svwl;
  world: Float32Array; nrm: Float32Array;
  inf: Influence[][];
  groupOf: Int32Array;
}
export function readOrig(bytes: Uint8Array, rig: Rig): Orig | null {
  const m = parseMsh(bytes);
  if (!m.svwl) return null;
  const sv = parseSvwl(m.svwl, m.vertexCount);
  for (let v = 0; v < m.vertexCount; v++) if (sv.bone[v] >= rig.count) return null;
  const world = skinPositions(m.positions, sv, rig.bones), nrm = skinNormals(m.normals, sv, rig.bones, undefined, true);
  const inf: Influence[][] = Array.from({ length: m.vertexCount }, (_, v) => [{ bone: sv.bone[v], w: sv.weight[v], local: [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]] as V3 }]);
  const e = sv.extra;
  for (let i = 0; i < e.count; i++) inf[e.vertex[i]].push({ bone: e.bone[i], w: e.weight[i], local: [e.local[i * 3], e.local[i * 3 + 1], e.local[i * 3 + 2]] as V3 });
  const groupOf = new Int32Array(m.vertexCount);
  m.groups.forEach((g, gi) => { for (let v = g.firstVertex; v < g.firstVertex + g.vertexCount; v++) groupOf[v] = gi; });
  return { m, sv, world, nrm, inf, groupOf };
}
/** global vertex indices of the triangles of group gi (3 per triangle) */
export function groupIndices(o: Orig, gi: number): number[] {
  const g = o.m.groups[gi], out: number[] = [];
  for (let t = 0; t < g.indexCount; t++) out.push(o.m.indices[g.firstIndex + t] + g.firstVertex);
  return out;
}
/** the original group copied as it is (positions, normals, UVs, skin) */
export function copyGroup(o: Orig, gi: number): MshOutGroup {
  const m = o.m, g = m.groups[gi], n = g.vertexCount;
  const bone = new Int32Array(n), weight = new Float32Array(n), extra: MshSkinExtra[] = [];
  for (let k = 0; k < n; k++) {
    const v = g.firstVertex + k;
    bone[k] = o.sv.bone[v]; weight[k] = o.sv.weight[v];
    for (let j = 1; j < o.inf[v].length; j++) extra.push({ v: k, bone: o.inf[v][j].bone, weight: o.inf[v][j].w, local: o.inf[v][j].local });
  }
  return { flags: g.flags, pos: m.positions.slice(g.firstVertex * 3, (g.firstVertex + n) * 3), nrm: m.normals.slice(g.firstVertex * 3, (g.firstVertex + n) * 3), uv: m.uvs.slice(g.firstVertex * 2, (g.firstVertex + n) * 2), idx: Array.from(m.indices.subarray(g.firstIndex, g.firstIndex + g.indexCount)), skin: { bone, weight, extra } };
}
