// The castle's rats (ctor FUN_005763ca, "Rattus.c": RAT0..RAT9, ten rats that scurry about the spot where their record stands): handler table 0x8f84f8 = { update FUN_00575e70, pre-render
// FUN_00576316 (returns 1), destroy FUN_005764ff, draw FUN_00576330 (the default mesh draw), save FUN_00576391 (0x14 bytes at +0x20), size FUN_0057636c }. The gate (the attach's var / mask /
// value, the stage switch) only opens the node in the stages that show the rats.
// Node (0x34 bytes): +0x00 var, +0x0c / +0x0e mask / value, +0x14 / +0x18 / +0x1c = the home position (x, y, z of the record at construction),
//   +0x20 float: how long the current direction is kept (-1.0 = "out of range, heading for home"), +0x24 int: the mode (0 = scurry slowly, 1 = sit and look about (clip 1), 2 = scurry),
//   +0x28 float: ticks since the direction was picked, +0x2c int: the number of animation loops played in this mode (a mode ends at the loop that follows), +0x30 float: the turn per tick.
// The update (asm 0x575e70..0x576315; the decompile mis-orders the heading branch, the asm is followed): the clip advances one frame per tick; at the end of a clip (FUN_0043b76a != 0) the loop counter goes up
// and a new mode is rolled (rand(3.0) truncated, again while it is 3; mode 0 -> counter = rand(10), clip 4; mode 1 -> counter 0, clip 1; mode 2 -> counter = rand(20), clip 4). In the modes 0 and 2 the rat
// walks: within 16 units (256 = squared) of its home it keeps a heading for `+0x20 = rand(50) + 20` ticks and turns by +0x30 = rand(0.0873) - 0.0436 per tick while the timer is below 20; farther away it turns
// to face its home by one step (5 degrees) per tick; it moves along its forward axis by 0.08 (mode 0) or 0.16 (mode 2) per tick. The record is put on the ground by the controller probe (armed every tick
// in the walking modes: offset (0, 8, 0), delta (0, -16, 0), mask 3, flags 0x50: the same arming as the Mummy's props, src/zones/z18mmp/props.ts).
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import { ensureAnim, setRot } from '../../island/ambient/common.ts';
import { armControllerProbe } from '../../game/probehost.ts';
import { f32, fb, PI, TWO_PI, NEG_PI, rand32 } from './common.ts';
import { BlockIn, BlockOut } from './blockio.ts';

export const CTOR_RAT = 0x5763ca;
/** _DAT_008f8510 (256.0: the squared distance within which the rat roams), DAT_008f851c (0.087266 = 5 degrees: the turn step), _DAT_008f8514 (0.16) / _DAT_008f8518 (0.08): the speeds */
const ROAM_R2 = f32(256.0), TURN_STEP = fb(0x3db2b884), SPEED_FAST = fb(0x3e23d70a), SPEED_SLOW = fb(0x3da3d70a);
/** _DAT_0089204c (0.5), _DAT_0089237c (20.0) */
const HALF = f32(0.5), TWENTY = f32(20.0);
const MODE_SLOW = 0, MODE_SIT = 1, MODE_SCURRY = 2;

export class RatNode implements BehaviourNode {
  readonly kind = 'Rat';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** +0x14 / +0x18 / +0x1c */
  home: [number, number, number] = [0, 0, 0];
  /** +0x20 */
  keep = 0;
  /** +0x24 */
  mode = 0;
  /** +0x28 */
  timer = 0;
  /** +0x2c */
  loops = 0;
  /** +0x30 */
  turn = 0;
  private built = false;

  constructor(_a?: Pick<Attach, 'var' | 'mask' | 'value'>) { void _a; }

  /** `registerHub` (src/hub/game.ts) calls this for every node that defines it, in record order, right after the set-up's world work (the loader's animation instances exist then) */
  ctorInit(w: World, rec: GameRecord): void { this.construct(w, rec); }

  /** FUN_005763ca after the node block is allocated: the home position, clip 4 started at a random frame, a random loop count */
  construct(w: World, rec: GameRecord): void {
    if (this.built) return;
    this.built = true;
    this.home = [rec.m[12], rec.m[13], rec.m[14]];
    this.keep = 0; this.timer = 0; this.loops = 0; this.mode = 0; this.turn = 0;
    const a = ensureAnim(w, rec);
    if (a) {
      a.start(4, 0);                                              // FUN_0043b6a3(rec + 8, 4, 0)
      const n = a.frameCount;                                     // FUN_0043b753
      a.seek(rand32(f32(n - 2.0)));                               // FUN_0043b64d(anim, rand(n - 2))
    }
    this.loops = Math.trunc(rand32(10.0));                        // __ftol(rand(10))
  }

  /** FUN_00575e70 (returns 1) */
  update(w: World, rec: GameRecord, ctrl: Controller): number {
    if (!this.built) this.construct(w, rec);
    const dt = f32(w.dt);
    const anim = rec.anim;
    const wrapped = anim ? anim.advance(1.0, w.dt) : 0;            // FUN_0043b76a(anim, 1.0)
    if (wrapped !== 0) {
      this.loops = (this.loops + 1) | 0;
      let again = false;
      const m = this.mode;
      if (m === 0 || m === 1 || m === 2) again = true;             // (asm 0x575ecc: modes 0 / 2 fall through the loop-count tests into the always-true case 1)
      if (again) {
        do { this.mode = Math.trunc(rand32(3.0)); } while (this.mode >= 3);
        if (this.mode === MODE_SLOW) { this.loops = Math.trunc(rand32(10.0)); anim?.start(4, 0); }
        else if (this.mode === MODE_SIT) { this.loops = 0; anim?.start(1, 0); }
        else if (this.mode === MODE_SCURRY) { this.loops = Math.trunc(rand32(20.0)); anim?.start(4, 0); }
      }
    }
    if (this.mode === MODE_SLOW || this.mode === MODE_SCURRY) {
      let y = rec.m[13], x = rec.m[12], z = rec.m[14];
      const dx = f32(this.home[0] - x), dy = f32(this.home[1] - y), dz = f32(this.home[2] - z);
      const d2 = f32(f32(f32(f32(dx * dx) + f32(dy * dy)) + f32(dz * dz)));
      if (!(d2 <= ROAM_R2)) {
        // too far from home: face it
        this.keep = f32(-1.0); this.timer = 0;
        const bearing = f32(Math.atan2(dx, dz));                   // FUN_0085d640(dx, dz)
        let err = f32(rec.ry - bearing);
        if (err < NEG_PI) err = f32(err + TWO_PI);
        else if (!(err <= PI)) err = f32(err - TWO_PI);
        if (!(err <= TURN_STEP)) rec.ry = f32(rec.ry - f32(TURN_STEP * dt));
        else if (err < TURN_STEP) rec.ry = f32(f32(TURN_STEP * dt) + rec.ry);
        else rec.ry = bearing;
      } else {
        if (this.keep < this.timer) {
          this.turn = f32(rand32(TURN_STEP) - f32(TURN_STEP * HALF));
          this.keep = f32(rand32(50.0) + TWENTY);
          this.timer = rand32(TWENTY);
        } else if (this.timer < TWENTY) {
          rec.ry = f32(rec.ry + this.turn);
        }
        this.timer = f32(f32(f32(1.0 * dt)) + this.timer);
      }
      setRot(rec.m, rec.rx, rec.ry, rec.rz);                       // FUN_0043a4a1(rec + 0xc, rx, ry, rz) (the translation stays)
      const k = this.mode === 0 ? SPEED_SLOW : SPEED_FAST;
      const kd = f32(k * dt);
      const vx = f32(kd * rec.m[8]), vy = f32(kd * rec.m[9]), vz = f32(kd * rec.m[10]);
      x = f32(x + vx); y = f32(y + vy); z = f32(z + vz);
      rec.m[13] = y; rec.m[12] = x; rec.m[14] = z;
    }
    if (this.mode === MODE_SLOW || this.mode === MODE_SCURRY) armControllerProbe(ctrl, [0, 8.0, 0], [0, -16.0, 0], 3, 0x50);   // FUN_00427014(ctrl, &(0, 8, 0), &(0, -16, 0), 3, 0x50)
    return NODE_STOP;
  }
  /** FUN_00576316 returns 1 and does nothing */
  prerender(): void { /* nothing */ }

  /** save FUN_0057636c (vtable +0x14): `*out = node + 0x20; return 0x14`: +0x20 keep (float), +0x24 mode (int), +0x28 timer (float), +0x2c loops (int), +0x30 turn (float) */
  saveBlock(): Uint8Array {
    return new BlockOut(0x14).f32(0, this.keep).i32(4, this.mode).f32(8, this.timer).i32(0xc, this.loops).f32(0x10, this.turn).bytes;
  }
  /** load FUN_00576391 (vtable +0x10): memcpy of the 0x14 bytes back to node + 0x20 (nothing else is derived) */
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    const b = new BlockIn(data);
    this.keep = b.f32(0); this.mode = b.i32(4); this.timer = b.f32(8); this.loops = b.i32(0xc); this.turn = b.f32(0x10);
    this.built = true;            // the node exists already (the constructor ran at the set-up): the lazy construct must not roll the start values again
  }
}

export const ratFactory = (a: Attach) => new RatNode(a);
