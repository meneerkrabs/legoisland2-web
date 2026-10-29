// z23DIP: the balloon LOON of story node 50 (the second class of Common\Z23DIP\c_src\PeppSw.c: ctor FUN_007281aa, handler table 0x935248 =
//   { update FUN_00727fe3, pre-render FUN_007280f6 (returns 1, does nothing), destroy FUN_00728256, draw FUN_00728110 (the default mesh draw), save FUN_00728171 / load FUN_0072814c
//     (node + 0x18, 8 bytes: the two speeds) }), attached to record 199 by FUN_007283e0 with the gate var 2 mask 1 / value 1 (the engine switch NS_ON).
// The constructor lifts the record by 17.6 (_DAT_008928f4) and remembers that height (+0x14); the update (while the record is visible and no cutscene runs) accelerates the
// balloon upwards by 0.032 per tick up to 0.4 and moves it; once it is 56 above its start it is hidden (flags & ~2); from 6 above its start it also drifts along +z with
// the second speed (+0x1c, the same ramp). Both speeds are multiplied by DAT_008b1718 (the tick length) like the original.
import type { BehaviourNode } from '../../game/controller.ts';
import { NODE_NONE, NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { cutsceneActive } from '../../island/vehicles/common.ts';
import { LOON } from './consts.ts';

const fr = Math.fround;

export class LoonNode implements BehaviourNode {
  readonly kind = 'PeppSw.loon';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  /** node + 0x14: the record's height after the constructor's lift */
  baseY = 0;
  /** node + 0x18 / 0x1c: the vertical and the z speed */
  vy = 0; vz = 0;
  private begun = false;

  /** FUN_007281aa: `rec.y += 17.6; +0x14 = rec.y; +0x18 = +0x1c = 0` (the set-up lifts the record, see `afterSetup`; a node made by hand lifts at its first update) */
  init(rec: GameRecord) {
    this.begun = true;
    rec.y = fr(rec.y + fr(LOON.LIFT));
    this.baseY = rec.y;
    this.vy = 0; this.vz = 0;
  }

  /** the framework's `ctorInit` hook (src/hub/game.ts, after the world work of the set-up) */
  ctorInit(_w: World, rec: GameRecord) { this.init(rec); }

  /** FUN_00727fe3: returns 0 while the record is hidden or a cutscene runs (nothing moves, no pre-render), else 1 */
  update(w: World, rec: GameRecord): number {
    if (!this.begun) this.init(rec);
    if ((rec.flags & 2) === 0) return NODE_NONE;
    if (cutsceneActive(w)) return NODE_NONE;
    const dt = w.dt;
    if (fr(this.baseY + fr(LOON.TOP)) <= rec.y) rec.flags &= ~2;
    else {
      if (this.vy < fr(LOON.VMAX)) this.vy = fr(fr(fr(LOON.ACCEL) * dt) + this.vy);
      rec.y = fr(fr(this.vy * dt) + rec.y);
    }
    if (fr(this.baseY + fr(LOON.DRIFT_FROM)) < rec.y) {
      if (this.vz < fr(LOON.VMAX)) this.vz = fr(fr(fr(LOON.ACCEL) * dt) + this.vz);
      rec.z = fr(fr(this.vz * dt) + rec.z);
    }
    return NODE_STOP;
  }
}
