// Camera / projection side of the renderer (the placement of the game camera is not part of this module).
import { perspectiveLH } from './math.ts';
import type { Mat4 } from './math.ts';
import type { FogSetup } from '../formats/zoneparams.ts';
import { fogRange } from '../formats/zoneparams.ts';

/** The game's time unit is 1/30 s: DAT_008b1718 = frame time / (1/30 s) (FUN_00443e40, target interval = QPF * 1/30; 0.5 at the port's fixed 60 Hz step). The renderer's state steps take that dt directly (no seconds -> ticks conversion any more) */
export const GAME_TICK = 30;
/** vertical field of view in radians for the default "zoom" factor DAT_0089df2c = 1.0 (FUN_0041533b: m11 = cot(fov / 2) * 0.75, m22 = cot(fov / 2)) */
export const DEFAULT_FOV = 1.0;
/** the game always projects with aspect h/w = 0.75 (4:3), whatever the display mode (FUN_0040c8c6) */
export const GAME_ASPECT_HW = 0.75;

export interface CameraSetup {
  /** vertical field of view, radians */
  fov: number;
  near: number;
  far: number;
  fog: { enabled: boolean; color: [number, number, number]; start: number; end: number };
  /** the colour the frame is cleared to (the zone's fog colour, also with fog disabled) */
  clear: [number, number, number];
}

const argbToRgb = (c: number): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

/** Camera range and fog of a zone from its SetupFog call (src/formats/zoneparams.ts) and the options slider (default 50) */
export function cameraFromFog(f: FogSetup, slider = 50, fov = DEFAULT_FOV): CameraSetup {
  const r = fogRange(f, slider);
  const color = argbToRgb(f.color);
  return { fov, near: r.near, far: r.far, fog: { enabled: f.enabled, color, start: r.fogStart, end: r.fogEnd }, clear: color };
}

/** Projection matrix (left-handed, GL clip space). `aspect` = width / height of the surface; the game itself always uses 4/3 */
export function projection(c: Pick<CameraSetup, 'fov' | 'near' | 'far'>, aspect: number): Mat4 {
  return perspectiveLH(c.fov, aspect, c.near, c.far);
}

/** One model part: `lod` is the squared-distance switch-in value stored in the model table (distance in game units) */
export interface LodPart { lod: number }

/**
 * Level of detail selection of FUN_00443f90: the last part i whose (lod_i)^2 < zoom * dist^2, where dist is the distance from the camera to the
 * record's world position (its matrix translation) and zoom the camera factor DAT_0089df2c (1.0 by default). `force` mirrors the record flag bits
 * 0x100 / 0x200 / 0x400 which pin LOD 0 / 1 / 2.
 */
export function selectLod(parts: readonly LodPart[], dist: number, zoom = 1, force = -1): number {
  if (parts.length < 2) return 0;
  if (force >= 0) return Math.min(force, parts.length - 1);
  let pick = 0;
  const d2 = zoom * dist * dist;
  for (let i = 0; i < parts.length; i++) if (parts[i].lod * parts[i].lod < d2) pick = i;
  return pick;
}
