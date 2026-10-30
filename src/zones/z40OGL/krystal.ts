// "Overlay" (Common\Z40OGL\...\Overlay.c, the krystals KST0..KST9): ctor FUN_007e31fc (attached 9 times by FUN_007e36dd, KST7 has none), vtable 0x94c4e0 = { update FUN_007e2c9a,
// pre-render FUN_007e3148 (returns 1), draw FUN_007e3162 = the default draw FUN_00444480, save FUN_007e319e (4 bytes at +0x18), restore FUN_007e31c3, destroy FUN_007e3304, size FUN_007e31c3 .. }.
// Node: +0x00 the collected-krystals variable (the attach's `var`, 0x31: one bit per krystal 1, 2, 4 ... 0x100), +0x0c / +0x0e the attach's mask / value (value 0: the gate lets the update run only
// while the krystal's bit is clear), +0x18 the state (0 = lying there, 3 / 2 / 1 = the 3 ticks after the pick-up, 1 from the start = collected in an earlier visit).
// The record's name selects the sound handle (KSTn -> DAT_05d5f338 ... = the n-th 3D slot of sound 615, the krystal's humming loop).
import { registerCtor } from '../../game/setup.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_NONE } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_ENABLED, RF_NO_COLLIDE } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import { fxStart, fxGate, fxMatrix, fxOf, recMatrix, FX_NONE, GATE_ON, GATE_OFF } from '../../island/emitters.ts';
import { BlockIn, BlockOut } from '../../island/blockio.ts';
import { f32, playKrystal, stopKrystal, playId, posOf, SND_COLLECT } from './common.ts';

export const CTOR_OVERLAY = 0x7e31fc;
/** _DAT_0094c4f8 (12.96 = 3.6 squared): a krystal is picked up when the controller's squared distance to Pepper (+0x18) is below it */
export const KRYSTAL_RANGE2 = f32(12.96);
/** the score of a krystal: FUN_004175ca(199, 1000) (the zone's total, var 0xc7) and FUN_004175ca(0x25, 1000) (the HUD's score, var 0x25) */
export const KRYSTAL_SCORE = 1000, VAR_SCORE_TOTAL = 199, VAR_SCORE = 0x25;
/** "TWINKLE01.par" at 0x94c5fc: ONE emitter for all krystals (DAT_0094c4fc, created idle by the first constructor on its record's matrix, offset (0, 4, 0), gate (1,1,1) = off) */
export const TWINKLE_EMITTER = 'TWINKLE01.par';
/** FUN_0044e920's offset argument (0, 4, 0): the emitter sits 4 units above the matrix it follows; rotation (0, 0, 0) */
export const TWINKLE_OFFSET = [0, f32(4), 0] as const, TWINKLE_ROT = [0, 0, 0] as const;
/** DAT_0094c4fc: the ONE emitter handle all krystals share (0xbabababa = none yet), per world */
const twinkle = new WeakMap<World, number>();
/** the shared emitter: created idle (gate 1,1,1) on a krystal's live matrix by the first constructor; the port creates it as soon as the particle engine (`ctx.fx`) exists */
function twinkleHandle(w: World, rec: GameRecord): number {
  let h = twinkle.get(w) ?? FX_NONE;
  if (h === FX_NONE && fxOf(w)) { h = fxStart(w, TWINKLE_EMITTER, recMatrix(rec), TWINKLE_OFFSET, TWINKLE_ROT, GATE_OFF); twinkle.set(w, h); }
  return h;
}
/** the krystal number of a record name: the update compares the first 4 characters with "KST0" .. "KST9" (strncmp) */
export function krystalIndex(name: string): number {
  const m = /^KST([0-9])/.exec(name);
  return m ? +m[1] : -1;
}

/** the shared emitter once the particle engine exists: created on the first krystal (the original's first constructor), idle */
export function ensureTwinkle(w: World): number {
  const first = w.records.find((r) => r.ctrl?.nodes.some((n) => n.kind === 'Overlay'));
  return first ? twinkleHandle(w, first) : FX_NONE;
}

export class KrystalNode implements BehaviourNode {
  readonly kind = 'Overlay';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** +0x18 */
  state = 0;
  /** +0x00 / +0x0c / +0x0e: the variable and the bit the constructor was given */
  readonly kVar: number; readonly kMask: number; readonly kValue: number;
  constructor(a: Pick<Attach, 'var' | 'mask' | 'value'>) { this.kVar = a.var; this.kMask = a.mask & 0xffff; this.kValue = a.value & 0xffff; }

  /** the constructor's work on the record (FUN_007e31fc after the node exists): `registerHub` (src/hub/game.ts) calls every node's `ctorInit(world, record)` right after the set-up, in record order */
  ctorInit(w: World, rec: GameRecord) {
    if ((w.vars.get(this.kVar) & this.kMask) === this.kValue) {
      this.state = 0;
      rec.flags |= RF_NO_COLLIDE;                              // +0x60 |= 0x10
    } else {
      this.state = 1;                                          // collected in an earlier visit: hidden for good (its gate never opens)
      rec.flags &= ~RF_ENABLED;
    }
    twinkleHandle(w, rec);                                     // DAT_0094c4fc == 0xbabababa: FUN_0044e920("TWINKLE01.par", rec + 0xc, (0, 4, 0), ..., gate 1,1,1)
  }

  /** FUN_007e2c9a (returns 0: the node is not marked as having run) */
  update(w: World, rec: GameRecord, ctrl: Controller): number {
    const n = krystalIndex(rec.name);
    if ((rec.flags & RF_ENABLED) !== 0 && n >= 0) playKrystal(w, n, posOf(rec));          // FUN_004433f0(KSTn's handle, rec + 0x3c)
    if (this.state === 0) {
      if (ctrl.distSq < KRYSTAL_RANGE2) {
        w.vars.add(VAR_SCORE_TOTAL, KRYSTAL_SCORE);
        w.vars.add(VAR_SCORE, KRYSTAL_SCORE);
        const h = twinkleHandle(w, rec);
        fxMatrix(w, h, recMatrix(rec));                                                    // FUN_0044ea00(h, rec + 0xc) (twice in the original: the second call is the same move)
        fxMatrix(w, h, recMatrix(rec));
        fxGate(w, h, GATE_ON);                                                             // FUN_0044ea60(h, 2, 1, 1): emit
        if (n >= 0) stopKrystal(w, n);                                                     // FUN_004434b0(KSTn's handle)
        playId(w, SND_COLLECT);                                                            // FUN_004435a0(DAT_009da8f4)
        rec.flags &= ~RF_ENABLED;                                                          // the krystal disappears
        this.state = 3;
      }
    } else {
      this.state -= 1;
      if (this.state === 0) {
        fxGate(w, twinkle.get(w) ?? FX_NONE, GATE_OFF);                                    // FUN_0044ea60(twinkle, 1, 1, 1): stop
        w.vars.or(this.kVar, (this.kMask << 16) >> 16);                                   // FUN_0041761b(var, (short) mask): collected, the gate closes
      }
    }
    return NODE_NONE;
  }
  /** FUN_007e3148 */
  prerender(): void { /* returns 1 */ }
  /** FUN_007e3304: the first krystal's loop is stopped, DAT_0094c4fc = 0xbabababa (the shared twinkle handle is forgotten) */
  destroy(w: World): void { stopKrystal(w, 0); twinkle.delete(w); }
  /** FUN_007e319e (`*out = node + 0x18; return 4`): the state */
  saveBlock(): Uint8Array { return new BlockOut(4).i32(0, this.state).bytes; }
  /** FUN_007e31c3: a plain copy of the 4 bytes into +0x18 */
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void { this.state = new BlockIn(data).i32(0); }
}

registerCtor(CTOR_OVERLAY, (a) => new KrystalNode(a));
