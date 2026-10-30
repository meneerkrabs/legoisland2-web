// "Gems" (Common\Z14OSD\...\Gems.c): ctor FUN_0062b220, table 0x914fe0 = { update FUN_0062b040, pre-render FUN_0062b16c (returns 1), destroy FUN_0062b367, draw FUN_0062b186 = the default
// draw FUN_00444480, save FUN_0062b1e7 (4 bytes at +0x1c), size FUN_0062b1c2 }. Shared by the Oasis, the Pyramid and the Dino island (the attach site carries the variable / bit).
// Node: +0x00 the collected-items variable (the attach's `var`, 0x1d in the Oasis: one bit per gem: 1, 2, 4 ... 0x200), +0x0c / +0x0e the attach's mask / value, +0x18 the GEM01.par emitter
// of this gem, +0x1c the state (0 = lying there, 3 / 2 / 1 = the 3 ticks after the pick-up, 1 from the start = the gem was collected before).
// The gate (var & mask) == value (value 0) lets the update run only while the gem's bit is clear.
import { registerCtor } from '../../game/setup.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_NONE } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import type { ZoneParticles } from '../../fx/particles/zone.ts';
import { NO_HANDLE } from '../../fx/particles/zone.ts';
import { f32, SND, ctxOf, playId } from './common.ts';
import { distSq32 } from './exact.ts';
import { BlockIn, BlockOut } from '../../island/blockio.ts';

export const CTOR_GEMS = 0x62b220;
/** _DAT_00914ff8 (4.0): a gem is picked up when the controller's squared distance to Pepper (+0x18) is below it */
export const GEM_RANGE2 = f32(4.0);
/** the score a gem gives: FUN_004175ca(0xca, 1000) (the zone's total) and FUN_004175ca(0x17, 1000) (the HUD's score) */
export const GEM_SCORE = 1000, VAR_SCORE_TOTAL = 0xca, VAR_SCORE = 0x17;
/** particle emitters (FUN_0044e920 = FUN_0044f710: name, matrix = the record's live matrix, local position, Euler rotation, gate): the constructor starts "GEM01.par" (0x62b2f1: one per gem, pos 0, rot 0, gate (2,1,1) = emitting)
 *  and, ONCE for all gems (DAT_00914ffc, the first constructor), "TWINKLE01.par" (0x62b349: pos (0, 4, 0), gate (1,1,1) = idle) bound to that gem's matrix; the update moves the twinkle to the picked gem (FUN_0044ea00 at
 *  0x62b0eb / 0x62b100), switches it on (FUN_0044ea60(h, 2, 1, 1) at 0x62b115) and the gem's own emitter off (0x62b12a) at the pick-up, and the twinkle off again 3 ticks later (0x62b07e). */
export const GEM_EMITTER = 'GEM01.par', TWINKLE_EMITTER = 'TWINKLE01.par';
const twinkles = new WeakMap<ZoneParticles, number>();   // DAT_00914ffc per particle engine

export class GemNode implements BehaviourNode {
  readonly kind = 'Gems';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** +0x1c */
  state = 0;
  /** +0x18: this gem's GEM01.par emitter */
  fxh = NO_HANDLE;
  /** +0x00 / +0x0c / +0x0e: the variable and the bit the constructor was given */
  readonly gemVar: number; readonly gemMask: number; readonly gemValue: number;
  constructor(a: Pick<Attach, 'var' | 'mask' | 'value'>) { this.gemVar = a.var; this.gemMask = a.mask & 0xffff; this.gemValue = a.value & 0xffff; }

  /** the constructor's work on the record (FUN_0062b220 after the node exists): needs the world: `registerHub` (src/hub/game.ts) calls every node's `ctorInit(world, record)` right after the set-up, in record order */
  ctorInit(w: World, rec: GameRecord) {
    // FUN_00444550(rec, 0xff, 2): the render mode (applied by the extraction of the constructors' render calls, src/formats/zonesetup.ts)
    if ((w.vars.get(this.gemVar) & this.gemMask) === this.gemValue) {
      this.state = 0;
      rec.flags |= 0x10;                                       // +0x60 |= 0x10: no collision (0x62b2f1: GEM01.par starts here)
    } else {
      this.state = 1;                                          // collected in an earlier visit: hidden for good (its gate never opens)
      rec.flags &= ~2;
    }
  }

  /** the constructor's emitter starts (`registerHub` calls it once the zone's particle engine exists; in record order like the constructors) */
  startEmitters(fx: ZoneParticles, rec: GameRecord) {
    if (this.state === 0) this.fxh = fx.start(GEM_EMITTER, rec.m, [0, 0, 0], [0, 0, 0], [2, 1, 1]);
    if (!twinkles.has(fx)) twinkles.set(fx, fx.start(TWINKLE_EMITTER, rec.m, [0, 4.0, 0], [0, 0, 0], [1, 1, 1]));
  }

  /** FUN_0062b040 (returns 0: the node is not marked as having run) */
  update(w: World, rec: GameRecord, ctrl: Controller): number {
    if (this.state === 0) {
      if (distSq32(w, rec) < GEM_RANGE2) {   // FUN_0042216f's float32 distance (the framework's double `ctrl.distSq` differs in the last bits)
        w.vars.add(VAR_SCORE_TOTAL, GEM_SCORE);
        w.vars.add(VAR_SCORE, GEM_SCORE);
        const fx = ctxOf(w)?.fx, tw = fx ? twinkles.get(fx) : undefined;
        if (fx && tw !== undefined) { fx.setMatrix(tw, rec.m); fx.setMatrix(tw, rec.m); fx.on(tw); fx.off(this.fxh); }
        rec.flags &= ~2;                                              // the gem disappears
        this.state = 3;
        playId(w, SND.GEM);                                           // FUN_004435a0(DAT_009da8f4)
      }
    } else {
      this.state -= 1;
      if (this.state === 0) {
        const fx = ctxOf(w)?.fx, tw = fx ? twinkles.get(fx) : undefined;
        if (fx && tw !== undefined) fx.off(tw);
        w.vars.or(this.gemVar, this.gemMask);                         // FUN_0041761b(var, mask): collected, the gate closes
      }
    }
    return NODE_NONE;
  }
  /** FUN_0062b1c2 (`*out = node + 0x1c; return 4`): the state; the emitter handle (+0x18) and the node's gate are not saved */
  saveBlock(): Uint8Array { return new BlockOut(4).i32(0, this.state).bytes; }
  /** FUN_0062b1e7: a plain copy of the 4 bytes into +0x1c */
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void { this.state = new BlockIn(data).i32(0); }
  /** FUN_0062b16c */
  prerender(): void { /* returns 1 */ }
  /** FUN_0062b367: DAT_00914ffc = 0xbabababa (the shared twinkle handle is forgotten), the node is freed */
  destroy(): void { /* nothing the port keeps */ }
}

registerCtor(CTOR_GEMS, (a) => new GemNode(a));
