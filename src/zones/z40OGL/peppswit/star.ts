// The sky dome STAR of Ogel's island (PeppSwit.c ctor 0x7e6498, one attach on record 0, gate var 2 & 1 = 1; vtable 0x94c790 = { update FUN_007e62a6 (returns 1), pre-render FUN_007e62c0
// (returns 1), destroy FUN_007e6512, draw FUN_007e62da, load FUN_007e645f, save FUN_007e643a }). The ONLY work is the draw hook: every drawn frame the record is scaled
// (c, 0.8 c, c) and put at the camera, with c = the far plane (FUN_00443cb0; the integer part of it while the fog is on), and drawn first with the fog and the depth
// test switched off (FUN_00442d50(0) / FUN_004445a0(0), then the projection FUN_0087efc6 with the near plane 1 / far 400 for the dome), then the fog and depth state are restored.
import type { BehaviourNode } from '../../../game/controller.ts';
import { NODE_STOP } from '../../../game/controller.ts';
import type { GameRecord } from '../../../game/record.ts';
import { fr } from './util.ts';

export const STAR = {
  /** DAT_0089df34: the dome's far plane (FUN_00443cb0); the dome's flat factor _DAT_00892084 = 0.8 */ FAR: 400.0, FLAT: fr(0.8),
  /** the projection the dome is drawn with (FUN_0087efc6 -> FUN_0041533b(1.0, 0.75 (0x3f400000), 5.0, 400)) */ PROJ_NEAR: 5.0, PROJ_FAR: 400.0,
} as const;

/** what the renderer needs to draw the dome the way the hook does: the matrix scale and that fog / depth are off (src/game/render.ts `skyDome`) */
export interface DomeDraw { scale: [number, number, number]; fogOff: true; depthOff: true }

export class StarDomeNode implements BehaviourNode {
  readonly kind = 'PeppStar';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  /** +0x15 (byte): what the save game keeps (never written) */
  state = 0;

  /** FUN_007e62a6 */
  update(): number { return NODE_STOP; }
  /** FUN_007e62c0 */
  prerender(): void { /* returns 1 */ }

  /**
   * FUN_007e62da (draw): the record is flagged as seen (+0x60 |= 1) and gets the matrix FUN_0043a742(rotation 0, translation = the camera `eye` (the draw pass's fourth argument), scale (c, 0.8 c, c)).
   * `far` = FUN_00443cb0 (DAT_0089df34, the far plane FUN_004095ab computes from the fog), `fogOn` = FUN_004095a1; the fog's far distance DAT_009dec3c is `__ftol(far)`: with fog on and
   * the far plane not below it c is that integer, else c = far.
   */
  place(rec: GameRecord, eye: ArrayLike<number>, far: number, fogOn: boolean): DomeDraw {
    rec.flags |= 1;
    const fogFar = Math.trunc(far);
    const c = (far < fogFar || !fogOn) ? fr(far * 1.0) : fogFar;
    const s: [number, number, number] = [c, fr(c * STAR.FLAT), c];
    const m = rec.m;
    m.fill(0); m[0] = s[0]; m[5] = s[1]; m[10] = s[2]; m[15] = 1;
    m[12] = fr(eye[0]); m[13] = fr(eye[1]); m[14] = fr(eye[2]);
    return { scale: s, fogOff: true, depthOff: true };
  }

  saveBlob(): Uint8Array { return new Uint8Array([this.state & 0xff]); }
  loadBlob(b: Uint8Array): void { this.state = b[0]; }
}
