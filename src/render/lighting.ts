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
export interface LightSet {
  ambient: [number, number, number];
  directional: DirectionalLight[];
  point: PointLight[];
}

/** shader limit (the files contain at most one directional light) */
export const MAX_DIRECTIONAL = 4;

/**
 * Light set for archives without lights.lgt (viewer only). The game's fallback (FUN_0088465a) allocates one light but leaves the count at 0,
 * which would draw everything black; a viewer wants fullbright instead.
 */
export function defaultLights(): LightSet {
  return { ambient: [1, 1, 1], directional: [], point: [] };
}

export function lightSetFromLgt(f: LightFile): LightSet {
  const set: LightSet = { ambient: [0, 0, 0], directional: [], point: [] };
  for (const l of f.lights) {
    for (let k = 0; k < 3; k++) set.ambient[k] = Math.max(set.ambient[k], l.ambient[k]);
    if (l.type === 2) {
      const d: [number, number, number] = [l.direction[0], Math.abs(l.direction[1]), l.direction[2]];
      const len = Math.hypot(d[0], d[1], d[2]) || 1;
      set.directional.push({ dir: [d[0] / len, d[1] / len, d[2] / len], color: [l.diffuse[0], l.diffuse[1], l.diffuse[2]] });
    } else if (l.type === 0) {
      set.point.push({ position: [l.position[0], l.position[1], l.position[2]], color: [l.diffuse[0], l.diffuse[1], l.diffuse[2]], range: 1 });
    }
  }
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
