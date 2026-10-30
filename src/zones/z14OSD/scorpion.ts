// The scorpions of the Oasis (Common\Z14OSD\...\Scorpion.c), shared with the Pyramid (10 attaches there):
//   ctor FUN_0062ad35 (the scorpion's own node; 10 records SCR0..SCR9 at the zone's FUN_00628967, gate 2 & 1 = always),
//        table 0x914ef0 = { update FUN_0062a120 (315 lines), pre-render FUN_0062ac81 (1), destroy FUN_0062ae16, draw FUN_0062ac9b = FUN_00444480, save 0x62acfc (0xc bytes at +0x20), size 0x62acd7 }
//   ctor FUN_0062af8d (the grab node on PEPP, position 1 of her chain, gate PEPPER_CONTROL & 0x20 == 0x20), table 0x914f08 = { update FUN_0062ae46, pre-render FUN_0062aed9 (1), destroy FUN_0062b007,
//        draw FUN_0062aef3 = FUN_00444480, ... }
// Scorpion node (0x2c bytes): +0x14 / +0x18 / +0x1c home x / y / z, +0x20 timer (float), +0x24 state (1 = walking, 2 = waiting, 0x10 = after Pepper, 0x11 = after the attack), +0x28 the heading to Pepper.
// Pepper's grab node (0x1c bytes) only plays the grabbed clip 0x70 until it ends and then clears var 0x5e bit 0x20.
import { registerCtor } from '../../game/setup.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { armControllerProbe } from '../../game/probehost.ts';
import { ensureAnim, setRot } from '../../island/ambient/common.ts';
import { H, PI, f32, play, playAt, posOf, wrapPi } from './common.ts';
import { fb, nameIs4, pepperSide32, rand32 } from './exact.ts';
import { BlockIn, BlockOut } from '../../island/blockio.ts';
import { CD32, CD_F32 } from '../hubsave.ts';

export const CTOR_SCORPION = 0x62ad35, CTOR_SCORPION_GRAB = 0x62af8d;
/** the record-name strings (4 chars) FUN_0062a120 compares with and the sound handles of the zone's loader: SCR0 .. SCR9 (SCR4 has none, SCR6 is listed twice) */
export const SCORPION_SOUNDS: ReadonlyArray<readonly [number, number]> = [
  [0x914f20, 0x5d5bc5c], [0x914f28, 0x5d5bc54], [0x914f30, 0x5d5bc58], [0x914f38, 0x5d5bc6c], [0x914f40, 0x5d5bc60],
  [0x914f48, 0x5d5bc64], [0x914f50, 0x5d5bc64], [0x914f58, 0x5d5bc74], [0x914f60, 0x5d5bc78], [0x914f68, 0x5d5bc70],
];
/** the float constants of the code (float32 values of the data words / literals) */
const SIGHT_R2 = f32(64.0), SIGHT_CONE = fb(0x3f5f66a5);   // FUN_004242f0(rec, &dist, 0x42800000, 0x3f5f66a5): 0.87265998, not f32(0.87266463)
const BACKSTEP = f32(-0.2);        // _DAT_0089273c: the walk step along the forward row
const TURN_STEP = fb(0x3e32b884); // _DAT_0089211c (0.17453199: the float of the code, not f32(10 degrees))
const FAR2 = f32(576.0);           // _DAT_008921a0: further than 24 from home
const GRAB_FRAME = f32(15.0), LUNGE_FRAME = f32(20.0), MID_A = f32(6.0), MID_B = f32(12.0);   // _DAT_00892074 / _DAT_0089237c / _DAT_0089228c / _DAT_00892024
const BITE2 = f32(4.0), CLOSE_HI = f32(2.56), CLOSE_LO = f32(1.0);   // _DAT_00892080 / _DAT_00892544 / _DAT_00892020
const CHASE_STEP = f32(0.8), LUNGE_STEP = f32(0.2);   // _DAT_00892084 / _DAT_008920f0
const WAIT_BASE = f32(30.0), WAIT_RAND = 90.0, FIRST_WAIT = 5.0, START_RAND = 3.0;   // _DAT_00892038, FUN_004388ae arguments 0x42b40000 / 0x40a00000 / 0x40400000
const HOME_TURN_RAND = fb(0x3da0d943), HOME_TURN_K = f32(10.0);   // 0x3da0d943 (0.07853939), _DAT_00892060

export class ScorpionNode implements BehaviourNode {
  readonly kind = 'scorpion';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  home: [number, number, number] = [0, 0, 0];   // +0x14 / +0x18 / +0x1c
  timer = 0;       // +0x20
  state = 1;       // +0x24
  heading = CD_F32; // +0x28 (never written by the constructor: the debug heap's 0xCD fill)

  /** the constructor: the first timer is rand(3), the home spot is where the record stands, the clip 2 starts (FUN_0043b6a3(anim, 2, 0)); `registerHub` calls it after the set-up (ctorInit) */
  ctorInit(w: World, rec: GameRecord) {
    this.state = 1;
    this.timer = rand32(START_RAND);
    this.home = [rec.m[12], rec.m[13], rec.m[14]];
    ensureAnim(w, rec)?.start(2, 0);
    // FUN_00444550(rec, 0xff, 1): the render mode (from the constructor's render calls)
  }

  /** FUN_0062a120 */
  update(w: World, rec: GameRecord, ctrl: Controller): number {
    const an = rec.anim ?? ensureAnim(w, rec);
    const pep = w.focus!;
    const dt = w.dt;
    const pos = posOf(rec);
    let done = 0;
    if ((this.state & 0x10) === 0) {
      const code = pepperSide32(w, rec, ctrl, SIGHT_R2, SIGHT_CONE);
      if (code === 0 || code === 4) done = an ? an.advance(1.0, dt) : 0;
      else {
        this.state = 0x10;
        playAt(w, H.SCORPION_ALERT, pos);
        this.timer = 0;
        an?.start(1, 0);
        done = 0;
      }
    } else done = an ? an.advance(1.0, dt) : 0;

    switch (this.state) {
      case 1:
      case 0x11: {
        if ((rec.flags & 1) !== 0) {
          for (const [nameVa, handle] of SCORPION_SOUNDS) if (nameIs4(w, rec, nameVa)) playAt(w, handle, pos);
        }
        if (done !== 0) {
          this.timer = f32(this.timer - 1.0);
          if (this.timer < 0) { this.state = 2; this.timer = f32(rand32(WAIT_RAND) + WAIT_BASE); }
        }
        const sx = f32(rec.m[8] * BACKSTEP), sy = f32(rec.m[9] * BACKSTEP), sz = f32(rec.m[10] * BACKSTEP);
        rec.m[12] = f32(sx + rec.m[12]); rec.m[13] = f32(sy + rec.m[13]); rec.m[14] = f32(sz + rec.m[14]);
        // FUN_00427014(ctrl, &(0, 12, 0), &(0, -28, 0), 1, 0x110)
        armControllerProbe(ctrl, [0, 12.0, 0], [0, -28.0, 0], 1, 0x110);
        break;
      }
      case 0x10: {
        if (done === 0) {
          const frame = f32(an ? an.frame : 0);
          let h: number;
          if (frame < GRAB_FRAME) {
            const dx = f32(pep.m[12] - rec.m[12]), dz = f32(pep.m[14] - rec.m[14]);
            h = f32(Math.atan2(dx, dz));
            this.heading = h;
            h = wrapPi(h);
          } else h = this.heading;
          let a = f32(rec.ry - h);
          a = wrapPi(a);
          const abs = f32(Math.abs(a));
          if (abs >= TURN_STEP) rec.ry = a <= 0 ? f32(rec.ry + TURN_STEP) : f32(rec.ry - TURN_STEP);
          else rec.ry = h;
          h = wrapPi(h);
          setRot(rec.m, rec.rx, f32(PI + rec.ry), 0);
          if (frame < GRAB_FRAME) {
            if (frame > MID_A) {
              let dx = f32(pep.m[12] - rec.m[12]), dy = f32(pep.m[13] - rec.m[13]), dz = f32(pep.m[14] - rec.m[14]);
              if (frame > MID_B) {
                dx = f32(pep.m[12] - rec.m[12]); dy = f32(pep.m[13] - rec.m[13]); dz = f32(pep.m[14] - rec.m[14]);
                const d2 = f32(f32(f32(dx * dx) + f32(dy * dy)) + f32(dz * dz));
                if (d2 <= BITE2) {
                  // the attack: Pepper is grabbed (var 0x5e |= 0x20: her chain's grab node takes over)
                  playAt(w, H.SCORPION_BITE, pos);
                  play(w, H.SCORPION_GRAB);
                  w.vars.or(0x5e, 0x20);
                  this.timer = -1.0;
                  this.heading = f32(this.heading + PI);
                  this.heading = wrapPi(this.heading);
                }
              }
              const vx = f32(f32(Math.sin(h)) * CHASE_STEP), vy = f32(0 * CHASE_STEP), vz = f32(f32(Math.cos(h)) * CHASE_STEP);
              const d2 = f32(f32(f32(dx * dx) + f32(dy * dy)) + f32(dz * dz));
              if (d2 <= CLOSE_HI) {
                if (d2 < CLOSE_LO) { rec.m[12] = f32(rec.m[12] - vx); rec.m[13] = f32(rec.m[13] - vy); rec.m[14] = f32(rec.m[14] - vz); }
              } else { rec.m[12] = f32(vx + rec.m[12]); rec.m[13] = f32(vy + rec.m[13]); rec.m[14] = f32(vz + rec.m[14]); }
            }
          } else if (frame > LUNGE_FRAME) {
            const vx = f32(f32(Math.sin(h)) * LUNGE_STEP), vz = f32(f32(Math.cos(h)) * LUNGE_STEP);
            rec.m[12] = f32(vx + rec.m[12]); rec.m[13] = f32(0 * LUNGE_STEP + rec.m[13]); rec.m[14] = f32(vz + rec.m[14]);
          }
          break;
        }
        // the clip ended: back to the walk (state 0x11) and on into the waiting code
        this.state = 0x11;
        an?.start(2, 0);
        this.timer = -1.0;
      }
      // falls through
      case 2: {
        this.timer = f32(this.timer - f32(1.0 * dt));
        if (this.timer < 0) {
          this.timer = rand32(FIRST_WAIT);
          this.state = 1;
          const dx = f32(this.home[0] - rec.m[12]), dy = f32(this.home[1] - rec.m[13]), dz = f32(this.home[2] - rec.m[14]);
          const d2 = f32(f32(f32(dx * dx) + f32(dy * dy)) + f32(dz * dz));
          if (d2 < FAR2) {
            // at home: look at Pepper and wait 5 ticks
            const px = f32(pep.m[12] - rec.m[12]), pz = f32(pep.m[14] - rec.m[14]);
            rec.ry = f32(Math.atan2(px, pz) + PI);   // (the sum of the FPATAN result and pi rounds once: the atan2 value is not stored as a float first)
            this.timer = 5.0;
            rec.ry = wrapPi(rec.ry);
          } else {
            // away from home: turn towards it in random steps
            let h = f32(Math.atan2(dx, dz));
            h = wrapPi(h);
            let a = f32(rec.ry - h);
            a = wrapPi(a);
            if (a <= 0) rec.ry = f32(f32(rand32(HOME_TURN_RAND) * HOME_TURN_K) + rec.ry);
            else rec.ry = f32(rec.ry - f32(rand32(HOME_TURN_RAND) * HOME_TURN_K));
          }
          setRot(rec.m, rec.rx, f32(PI + rec.ry), 0);
        }
        break;
      }
      default: break;
    }
    return NODE_STOP;
  }

  prerender(): void { /* FUN_0062ac81: returns 1 */ }

  /** FUN_0062acd7 (`*out = node + 0x20; return 0xc`): timer, state, heading; home (+0x14..) is not saved */
  saveBlock(): Uint8Array { return new BlockOut(12).f32(0, this.timer).i32(4, this.state).f32(8, this.heading).bytes; }
  /** FUN_0062acfc: a plain copy of the 12 bytes into +0x20 */
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    const b = new BlockIn(data);
    this.timer = b.f32(0); this.state = b.i32(4); this.heading = b.f32(8);
  }

  /** FUN_0062ae16 */
  destroy(): void { /* frees the node */ }
}

/** the grab node on Pepper (FUN_0062af8d): gate var 0x5e & 0x20 */
export class ScorpionGrabNode implements BehaviourNode {
  readonly kind = 'scorpion';
  var = 0x5e; mask = 0x20; value = 0x20;
  stamp = 0xfffffffe;
  /** +0x18: never written by the constructor (debug heap fill 0xCD), but part of the save block (4 bytes): kept as it was loaded */
  word18 = CD32;
  /** FUN_0062ae46: the first frame starts the grabbed clip 0x70, the following ones play it (rate 1); when it ends the grab is over (the walk clip of the state mailbox restarts) */
  update(w: World, rec: GameRecord): number {
    const an = rec.anim;
    if (this.stamp !== w.frame) {
      an?.start(0x70, 0);
    } else {
      const r = an ? an.advance(1.0, w.dt) : 0;
      if (r !== 0) {
        w.vars.andNot(0x5e, 0x20);
        an?.start(w.pep.mailbox & 0xff, 0);   // DAT_008ae088
      }
    }
    return NODE_STOP;
  }
  prerender(): void { /* FUN_0062aed9 */ }
  /** FUN_0062af2f (`*out = node + 0x18; return 4`) */
  saveBlock(): Uint8Array { return new BlockOut(4).u32(0, this.word18).bytes; }
  /** FUN_0062af54: a plain copy of the 4 bytes into +0x18 */
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void { this.word18 = new BlockIn(data).u32(0); }
}

registerCtor(CTOR_SCORPION, () => new ScorpionNode());
registerCtor(CTOR_SCORPION_GRAB, () => new ScorpionGrabNode());

