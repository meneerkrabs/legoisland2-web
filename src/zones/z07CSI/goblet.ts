// The goblet pick-up node of the castle (ctor FUN_005766fb, source "Rattus.c" at 0x8f8578: a copy-pasted file header; the ten records GOB0..GOB9 scattered over the island are goblets,
// the HUD counts them: Overlays/Z07CSI "Goblets --> text000", var 0xbc one bit each): handler table 0x8f8520 = { update FUN_0057652f, pre-render FUN_00576647 (returns 1), destroy
// FUN_00576803, draw FUN_00576661 (the default mesh draw FUN_00444480), save FUN_005766c2 (4 bytes at +0x18), size FUN_0057669d }.
// Node: +0x00 the collected-goblets variable (the attach's `var`, 0xbc), +0x0c / +0x0e the attach's mask / value (one bit per goblet: the gate (var & mask) == value, value 0, lets the update
// run only while the goblet's bit is clear), +0x18 the state (0 = lying there, 3 / 2 / 1 = the 3 ticks after the pick-up, 1 from the start = collected in an earlier visit).
// The constructor starts ONE TWINKLE01.par for all goblets (DAT_008f853c, the first constructor: bound to that goblet's matrix, local position (0, 4, 0), gate (1,1,1) = idle) and the update
// moves it to the goblet being picked up (FUN_0044ea00 twice) and switches it on (FUN_0044ea60(h, 2, 1, 1)); three ticks later it is switched off again and the bit is stored (FUN_0041761b).
// The same shape as the Oasis' Gems (src/zones/z14OSD/gems.ts) with the castle's score variables: the pick-up adds 1000 to var 0xaf (the castle's goblet score) and to var 0xce (the total).
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_NONE } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import type { ZoneParticles } from '../../fx/particles/zone.ts';
import { NO_HANDLE } from '../../fx/particles/zone.ts';
import { f32, SND, ctxOf, playId, distSq32 } from './common.ts';

export const CTOR_GOBLET = 0x5766fb;
/** _DAT_008f8538 (4.0): a goblet is picked up when the controller's squared distance to Pepper (+0x18) is below it */
export const GOBLET_RANGE2 = f32(4.0);
/** FUN_004175ca(0xaf, 1000) and FUN_004175ca(0xce, 1000) */
export const GOBLET_SCORE = 1000, VAR_GOBLET_SCORE = 0xaf, VAR_TOTAL = 0xce;
/** TWINKLE01.par (FUN_0044e920 at 0x576728): one for all goblets, DAT_008f853c */
export const TWINKLE_EMITTER = 'TWINKLE01.par';
const twinkles = new WeakMap<ZoneParticles, number>();

export class GobletNode implements BehaviourNode {
  readonly kind = 'Goblet';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** +0x18 */
  state = 0;
  /** +0x00 / +0x0c / +0x0e: the variable and the bit the constructor was given */
  readonly gobVar: number; readonly gobMask: number; readonly gobValue: number;
  constructor(a: Pick<Attach, 'var' | 'mask' | 'value'>) { this.gobVar = a.var; this.gobMask = a.mask & 0xffff; this.gobValue = a.value & 0xffff; }

  /** the constructor's work on the record (FUN_005766fb after the node exists; `registerHub` calls it right after the set-up, in record order) */
  ctorInit(w: World, rec: GameRecord) {
    // `(var & (int) (short) mask) == (int) (short) value`: the masks are 1 .. 0x200 here, so the sign extension changes nothing
    if (((w.vars.get(this.gobVar) & this.gobMask) | 0) === this.gobValue) {
      this.state = 0;
      rec.flags |= 0x10;                                       // +0x60 |= 0x10: no collision
    } else {
      this.state = 1;                                          // collected in an earlier visit: hidden for good (its gate never opens)
      rec.flags &= ~2;
    }
  }

  /** the constructor's emitter start (FUN_0044e920 at the first constructor: `DAT_008f853c == 0xbabababa`); returns true when this node created the shared emitter */
  startEmitter(fx: ZoneParticles, rec: GameRecord): boolean {
    if (twinkles.has(fx)) return false;
    twinkles.set(fx, fx.start(TWINKLE_EMITTER, rec.m, [0, 4.0, 0], [0, 0, 0], [1, 1, 1]));
    return true;
  }

  /** FUN_0057652f (returns 0: the node is not marked as having run) */
  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    void _ctrl;
    if (this.state === 0) {
      if (distSq32(w, rec) < GOBLET_RANGE2) {   // FUN_0042216f's float32 distance (the framework's double `ctrl.distSq` differs in the last bits)
        w.vars.add(VAR_GOBLET_SCORE, GOBLET_SCORE);
        w.vars.add(VAR_TOTAL, GOBLET_SCORE);
        const fx = ctxOf(w)?.fx, tw = fx ? twinkles.get(fx) : undefined;
        if (fx && tw !== undefined) { fx.setMatrix(tw, rec.m); fx.setMatrix(tw, rec.m); fx.on(tw); }
        rec.flags &= ~2;                                              // the goblet disappears
        this.state = 3;
        playId(w, SND.PICKUP);                                        // FUN_004435a0(DAT_009da8f4)
      }
    } else {
      this.state -= 1;
      if (this.state === 0) {
        const fx = ctxOf(w)?.fx, tw = fx ? twinkles.get(fx) : undefined;
        if (fx && tw !== undefined) fx.off(tw);
        w.vars.or(this.gobVar, this.gobMask);                         // FUN_0041761b(var, mask): collected, the gate closes
      }
    }
    return NODE_NONE;
  }
  /** FUN_00576647 returns 1 and does nothing */
  prerender(): void { /* nothing */ }
  /** FUN_00576803: DAT_008f853c = 0xbabababa (the shared twinkle handle is forgotten), the node is freed */
  destroy(): void { /* nothing the port keeps */ }
}

export const gobletFactory = (a: Attach) => new GobletNode(a);
export { NO_HANDLE };
