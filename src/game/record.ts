// Object records (docs/re/architecture.md 4.1): the world is a flat array of records (0x68 bytes in the original at DAT_00983804).
// Field offsets of the original are noted so the decompile can be followed: matrix +0x0c (right +0x0c, up +0x1c, forward +0x2c,
// translation +0x3c/+0x40/+0x44), Euler +0x4c/+0x50/+0x54, collision object +0x58, controller +0x5c, flags +0x60.
import { eulerMatrix } from '../zones/exact.ts';
import type { Model } from '../formats/exe.ts';
import type { ColObject } from './collision.ts';
import type { Controller } from './controller.ts';
import type { AnimInstance } from './anim.ts';

/** record flag bits (+0x60) */
export const RF_FRUSTUM = 0x0001;      // set every frame by the frustum test
export const RF_ENABLED = 0x0002;      // visible and collidable (hide = &= ~2)
export const RF_NO_COLLIDE = 0x0010;   // non-solid
export const RF_SOLID_HIDDEN = 0x0020; // solid even when hidden (unless the query mask has 0x80)
export const RF_NPC = 0x0040;          // simple bound collision (FUN_00426151)
export const RF_NO_DRAW = 0x8000;

export class GameRecord {
  index = 0;
  /** 4 characters (+0x00) */
  name: string;
  model: Model | null = null;
  /** collision object (+0x58); shared between records that use the same .col slot */
  colObj: ColObject | null = null;
  ctrl: Controller | null = null;
  /** per-record animation instance (+0x08), null for static objects */
  anim: AnimInstance | null = null;
  flags = RF_ENABLED;
  /** variant / phase word (+0x64) */
  variant = 0;
  /** face (mouth / expression) frame of the model's face object (model +0x14, FUN_0043f2f0 set / FUN_0043f310 get): SETEXPRESSION, the mouth of speaking actors */
  face = 0;
  /** row-major row-vector 4x4 (+0x0c), translation in elements 12..14 */
  m = new Float32Array(16);
  /** Euler angles +0x4c / +0x50 / +0x54 (float32 fields like the original's: every store rounds); the walk code keeps its yaw in ry */
  private readonly eul = new Float32Array(3);
  get rx() { return this.eul[0]; } set rx(v: number) { this.eul[0] = v; }
  get ry() { return this.eul[1]; } set ry(v: number) { this.eul[1] = v; }
  get rz() { return this.eul[2]; } set rz(v: number) { this.eul[2] = v; }
  /** matrix of the previous simulation tick (render interpolation) */
  prev = new Float32Array(16);
  /** scale the builder put into the matrix (the original has no separate field; kept for rendering) */
  scale: [number, number, number] = [1, 1, 1];
  constructor(name: string) { this.name = name; }

  get x() { return this.m[12]; } set x(v: number) { this.m[12] = v; }
  get y() { return this.m[13]; } set y(v: number) { this.m[13] = v; }
  get z() { return this.m[14]; } set z(v: number) { this.m[14] = v; }
  /** forward row (+0x2c) */
  get fx() { return this.m[8]; } get fy() { return this.m[9]; } get fz() { return this.m[10]; }
  /** right row (+0x0c) */
  get rxv() { return this.m[0]; } get ryv() { return this.m[1]; } get rzv() { return this.m[2]; }
  /** up row (+0x1c) */
  get ux() { return this.m[4]; } get uy() { return this.m[5]; } get uz() { return this.m[6]; }

  get enabled() { return (this.flags & RF_ENABLED) !== 0; }
  hide() { this.flags &= ~RF_ENABLED; }
  show() { this.flags |= RF_ENABLED; }

  /** FUN_0043a5e4(rec + 0xc, rx, ry, rz, x, y, z): rebuild the matrix from Euler angles */
  setEuler(rx: number, ry: number, rz: number, x: number, y: number, z: number) {
    eulerMatrix(this.m, rx, ry, rz, x, y, z);       // FUN_0043a5e4 per operation in float32 (24-bit x87); formats/matrix.ts buildMatrix is not exact
  }
  /** walk code: yaw only, at the current position */
  rebuildYaw() { this.setEuler(0, this.ry, 0, this.m[12], this.m[13], this.m[14]); }

  /** local -> world (FUN_0043ab72), out = v * M */
  toWorld(v: ArrayLike<number>, out: number[] = [0, 0, 0]): number[] {
    const m = this.m;
    out[0] = v[0] * m[0] + v[1] * m[4] + v[2] * m[8] + m[12];
    out[1] = v[0] * m[1] + v[1] * m[5] + v[2] * m[9] + m[13];
    out[2] = v[0] * m[2] + v[1] * m[6] + v[2] * m[10] + m[14];
    return out;
  }
  /** world -> local for rotation-only matrices (FUN_0043b022) */
  toLocal(v: ArrayLike<number>, out: number[] = [0, 0, 0]): number[] {
    const m = this.m;
    const dx = v[0] - m[12], dy = v[1] - m[13], dz = v[2] - m[14];
    out[0] = dx * m[0] + dy * m[1] + dz * m[2];
    out[1] = dx * m[4] + dy * m[5] + dz * m[6];
    out[2] = dx * m[8] + dy * m[9] + dz * m[10];
    return out;
  }
  savePrev() { this.prev.set(this.m); }
}
