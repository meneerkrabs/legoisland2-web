// The game's lighting: D3D lighting is OFF; vertex colours are computed on the CPU (Lights.cpp, FUN_00885a9a / FUN_0088589e) from a
// per-zone light list (`lights/lights.lgt`, loader FUN_008864b6 + FUN_008849c6).
//
// Per vertex, per colour channel, with N the world-space normal and the lights in file order:
//     acc = 0
//     for each directional light i:   I = max(0, N . L_i);   acc = acc + (1 - acc) * I * diffuse_i        ("screen" combination)
//     colour = max(acc, ambient)                                                                       (the ambient entry is last in the runtime list)
// L_i is the file's direction with its Y component forced to be >= 0 (FUN_008849c6 negates a negative Y): it points TOWARDS the light.
// `ambient` is the component-wise maximum of the `ambient` colours of all records of the file. Point lights are stored but only reach vertices
// that are closer than 1 unit (range field +0x5c = 1.0 in the runtime record), so they do not light meshes; they are kept for completeness.
import type { LightFile } from '../formats/lights.ts';

export interface DirectionalLight {
  /** unit vector towards the light, world space, y >= 0 */
  dir: [number, number, number];
  color: [number, number, number];
}
export interface PointLight {
  position: [number, number, number];
  color: [number, number, number];
  /** range used by the mesh lighting (1.0); the file's own range is ignored by the game */
  range: number;
}
/**
 * One entry of the game's runtime light array (100 bytes per light at `DAT_05d5fafc[set]`, Lights.cpp FUN_008849c6): kind 0 = ambient (always the LAST entry, the
 * component-wise maximum of the file's ambient colours), 1 = directional, 2 = point (file types 0 and 1). `dir` is the file's direction with its Y made >= 0
 * (the vector towards the light, not normalised by the loader); `pos` the file position; `range` the +0x5c field (1.0: the only value any code ever writes).
 */
export interface RuntimeLight {
  kind: 0 | 1 | 2;
  pos: [number, number, number];
  dir: [number, number, number];
  color: [number, number, number];
  range: number;
}
export interface LightSet {
  ambient: [number, number, number];
  directional: DirectionalLight[];
  point: PointLight[];
  /** the runtime array in the game's order (file order, ambient last); the CPU lighting of meshlight.ts evaluates this. Absent: built from the three fields above */
  list?: RuntimeLight[];
}

/** shader limit (the files contain at most one directional light) */
export const MAX_DIRECTIONAL = 4;

/**
 * Light set for archives without lights.lgt (viewer only). The game's fallback (FUN_0088465a) allocates one light but leaves the count at 0,
 * which would draw everything black; a viewer wants fullbright instead.
 */
const DEFAULT_LIGHTS: LightSet = { ambient: [1, 1, 1], directional: [], point: [], list: [{ kind: 0, pos: [0, 0, 0], dir: [0, 0, 0], color: [1, 1, 1], range: 1 }] };
export function defaultLights(): LightSet {
  return DEFAULT_LIGHTS;   // one shared object: meshes lit once (FUN_0088aca2 mode 0) are re-lit when the renderer's light set changes
}

/** the runtime array of a set (`list`, or built from ambient / directional / point lights) */
export function runtimeLights(set: LightSet): RuntimeLight[] {
  if (set.list) return set.list;
  const out: RuntimeLight[] = [];
  for (const d of set.directional) out.push({ kind: 1, pos: [0, 0, 0], dir: d.dir, color: d.color, range: 1 });
  for (const p of set.point) out.push({ kind: 2, pos: p.position, dir: [0, 1, 0], color: p.color, range: p.range });
  out.push({ kind: 0, pos: [0, 0, 0], dir: [0, 0, 0], color: set.ambient, range: 1 });
  return out;
}

export function lightSetFromLgt(f: LightFile): LightSet {
  const set: LightSet = { ambient: [0, 0, 0], directional: [], point: [], list: [] };
  const list = set.list!;
  // FUN_008849c6: the last record is dropped when its type is not 0..2
  let n = f.lights.length;
  if (n > 0 && (f.lights[n - 1].type > 2 || f.lights[n - 1].type < 0)) n--;
  for (let i = 0; i < n; i++) {
    const l = f.lights[i];
    for (let k = 0; k < 3; k++) set.ambient[k] = Math.max(set.ambient[k], l.ambient[k]);
    const color: [number, number, number] = [l.diffuse[0], l.diffuse[1], l.diffuse[2]];
    if (l.type === 2) {
      // runtime kind 1: the file's direction with a negative Y negated (kept as is: the file's vectors are unit length)
      const raw: [number, number, number] = [l.direction[0], l.direction[1] < 0 ? -l.direction[1] : l.direction[1], l.direction[2]];
      const len = Math.hypot(raw[0], raw[1], raw[2]) || 1;
      set.directional.push({ dir: [raw[0] / len, raw[1] / len, raw[2] / len], color });
      list.push({ kind: 1, pos: [l.position[0], l.position[1], l.position[2]], dir: raw, color, range: 1 });
    } else if (l.type === 0 || l.type === 1) {
      // file types 0 (point) and 1 (spot, never seen) both become runtime kind 2 with range 1.0 (+0x5c)
      set.point.push({ position: [l.position[0], l.position[1], l.position[2]], color, range: 1 });
      list.push({ kind: 2, pos: [l.position[0], l.position[1], l.position[2]], dir: [l.direction[0], l.direction[1], l.direction[2]], color, range: 1 });
    }
  }
  list.push({ kind: 0, pos: [0, 0, 0], dir: [0, 0, 0], color: [set.ambient[0], set.ambient[1], set.ambient[2]], range: 1 });
  return set;
}

/** CPU reference of the per-vertex formula (the renderer evaluates the same thing in its vertex shader) */
export function lightVertex(set: LightSet, n: [number, number, number]): [number, number, number] {
  const acc = [0, 0, 0];
  for (const l of set.directional) {
    const i = Math.max(0, n[0] * l.dir[0] + n[1] * l.dir[1] + n[2] * l.dir[2]);
    for (let k = 0; k < 3; k++) acc[k] = acc[k] + (1 - acc[k]) * i * l.color[k];
  }
  return [Math.max(acc[0], set.ambient[0]), Math.max(acc[1], set.ambient[1]), Math.max(acc[2], set.ambient[2])];
}
