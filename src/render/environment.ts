// Sky dome, sea plane and seabed behaviours of the zone records `SSKY`, `SSEA` and `SEAB` (seabed.c: FUN_00426915 / FUN_004267d2 sky,
// FUN_00426da4 / FUN_00426a43 sea plane, FUN_004266ca / FUN_00426659 seabed). The meshes are unit shapes that the game re-places
// every frame from the camera position and the fog/far distance; this module reproduces that placement.
import { buildMatrix } from '../formats/matrix.ts';
import type { Mat4 } from './math.ts';
import { GAME_TICK } from './camera.ts';

/** Part `mode` (see states.ts modePreset) the zone code assigns to these records with FUN_00444550 */
export const SKY_MODE = 2;      // preset 1: unlit texture, texture alpha, blended, depth test + write on
export const SEA_MODE = 3;      // preset 0x10: unlit texture, alpha = texture alpha * vertex alpha, blended, NO depth test / write
export const SEABED_MODE = 3;   // same as the sea plane (drawn first, without depth, the land overdraws it)
/** SEAE (shore foam, Sea.Msh) is set to mode 2 in the island zone (FUN_004b4907 `FUN_00444550(record + 0xd0, 0xff, 2)`) */
export const SEA_EDGE_MODE = 2;

/** sky dome horizontal radius = far * 1.2 (FUN_00442dc0: fog end * _DAT_008920e8), height = camera y + 100 (FUN_004267d2) */
export const SKY_RADIUS_FACTOR = 1.2;
export const SKY_HEIGHT_ABOVE_CAMERA = 100;
/** the sky turns by 0.000436332 rad per 1/30 s tick where the zone enables it (`param != 0` in FUN_00426915; the island does) */
export const SKY_SPIN = 0.0004363299813121557;

export class SkyState {
  angle = 0;
  spin: boolean;
  constructor(spin = true) { this.spin = spin; }
  update(dt: number) {
    if (!this.spin) return;
    this.angle += SKY_SPIN * dt * GAME_TICK;
    if (this.angle > Math.PI) this.angle -= 2 * Math.PI; else if (this.angle < -Math.PI) this.angle += 2 * Math.PI;
  }
  /** world matrix of the unit dome (x, z in -1..1, y in 0..1): centred on the camera in x/z, its own y (the record's y, 0 in the island) */
  matrix(cam: readonly number[], far: number, recordY = 0): Mat4 {
    const r = far * SKY_RADIUS_FACTOR;
    return buildMatrix(0, this.angle, 0, cam[0], recordY, cam[2], r, cam[1] + SKY_HEIGHT_ABOVE_CAMERA, r);
  }
}

/** sea plane scale = 2.5 * range, where the range is the far plane (or the fog end when that is smaller); pPlane1.msh spans -0.5 .. 0.5 */
export const SEA_SCALE = 2.5;
/** the plane re-centres on the camera in steps of 0.1 * its scale (0.25 * range) */
export const SEA_SNAP = 0.1;
/** orbit phases advance 1 degree and 2/3 degree per tick, amplitude 4 * (sin + cos) */
export const SEA_PHASE_A = 0.01745319925248623;
export const SEA_PHASE_B = 0.011693643406033516;
export const SEA_ORBIT = 4;

export class SeaState {
  phaseA = 0; phaseB = 0;
  anchor: [number, number] | null = null;
  update(dt: number) { const k = dt * GAME_TICK; this.phaseA += SEA_PHASE_A * k; this.phaseB += SEA_PHASE_B * k; }
  /** world matrix of the sea plane for the camera position `cam`, draw range `range` and sea level y */
  matrix(cam: readonly number[], range: number, seaLevel: number): Mat4 {
    const scale = range * SEA_SCALE, step = scale * SEA_SNAP;
    if (!this.anchor) this.anchor = [cam[0], cam[2]];
    const a = this.anchor;
    for (let i = 0; i < 200; i++) {
      let moved = false;
      for (const k of [0, 1] as const) {
        const cv = k === 0 ? cam[0] : cam[2], d = cv - a[k];
        if (Math.abs(d) > step) { a[k] += d <= 0 ? -step : step; moved = true; }
      }
      if (!moved) break;
    }
    const ox = (Math.cos(this.phaseB) + Math.sin(this.phaseA)) * SEA_ORBIT, oz = (Math.sin(this.phaseB) + Math.cos(this.phaseA)) * SEA_ORBIT;
    return buildMatrix(0, 0, 0, a[0] + ox, seaLevel, a[1] + oz, scale, 1, scale);
  }
}
