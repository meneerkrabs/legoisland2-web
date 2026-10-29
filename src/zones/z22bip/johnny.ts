// z22BIP: Johnny's plane, the node "csplane" on SEPL (constructor FUN_0070df00, update FUN_0070db60): the guide plane flies the course (the spline) at a fixed
// pace from 50 ticks after the start, banked by the way the course bends; the player scores a point per tick while the plane's nearest point of the course is
// further on than Johnny's (FUN_00708e17). Its engine is a positional sound.
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import { bipRun, f32 } from './run.ts';
import { mul4 } from './plane.ts';

const F = Math.fround;
export const CTOR_JOHNNY = 0x70df00;

export const JOHNNY = {
  WAIT: 50,                     // +0x18  0x42480000: ticks before he starts
  STEP: f32(0x398d8ec9),        // +0x2c: progress per tick
  END: f32(0x3f7fbe77),         // the progress at the end of the course
  BANK_EASE: 40,                // 0x892528
  LIFT: 5,                      // 0x892070: drawn 5 above the course
} as const;

export class JohnnyNode implements BehaviourNode {
  readonly kind = 'csplane';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;

  wait: number = JOHNNY.WAIT;   // +0x18
  /** +0x1c: 1.0 while waiting to start, 0 from then on (the take-off waits for it) */
  waiting = 1;
  /** +0x20: how much the course bends sideways here (the second output of the spline frame . the frame's right vector), +0x24 its ease (the roll angle) */
  bend = 0; roll = 0;
  /** +0x28: his progress along the course (starts at 1 / the number of control points), +0x2c the step */
  progress = 0;
  step: number = JOHNNY.STEP;
  /** +0x38 (written by FUN_00708e17): the player is ahead of him */
  ahead = false;
  private inited = false;

  init(w: World) {
    if (this.inited) return;
    this.inited = true;
    const run = bipRun(w);
    run.johnny = this;
    this.progress = F(1 / run.spline.n);
  }

  update(w: World, rec: GameRecord): number {
    if (!bipRun(w).spline) return 1; // zone not prepared (generic set-up test)
    this.init(w);
    const run = bipRun(w), dt = w.dt;
    if (this.waiting !== 0) {
      if (this.wait <= 0) this.waiting = 0;
      else this.wait = F(this.wait - F(1 * dt));
    }
    if (this.waiting === 0) this.progress = F(F(this.step * dt) + this.progress);
    if (1 < this.progress) this.progress = JOHNNY.END;
    const fr = run.spline.frame(this.progress);
    const m = fr.m, n = fr.normal;
    this.bend = F(n[2] * m[2] + n[1] * m[1] + n[0] * m[0]);
    if (this.waiting === 0) this.roll = F(F(F(this.bend - this.roll) / JOHNNY.BANK_EASE) * dt + this.roll);
    // FUN_0043af16: the roll about the forward axis (row 0 / 1 turned by the angle), applied first
    const s = Math.sin(this.roll), c = Math.cos(this.roll);
    const R = new Float32Array(16);
    R[0] = c; R[1] = -s; R[4] = s; R[5] = c; R[10] = 1; R[15] = 1;
    rec.m.set(mul4(R, m));
    run.sound.at('planeIdle', [rec.m[12], rec.m[13], rec.m[14]]);
    rec.m[13] = F(rec.m[13] + JOHNNY.LIFT);
    return NODE_STOP;
  }
}
