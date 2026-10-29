// The hologram HOLO's variable watcher (PeppSwit.c ctor 0x7e6bb2, one attach on record 5, gate var 2 & 1 = 1; vtable 0x94c808 = { update FUN_007e6b05, pre-render 0, destroy FUN_007e6c29, draw 0,
// load 0, save 0 }). The constructor sets its own gate (var 2, mask 1, value 1) whatever the attach passed. The update walks the table at 0x94c820 (12 bytes per entry, ends at the first
// entry whose variable is not positive) and turns a variable that is 1 or 8 into 2; in this build the first entry holds -1, so the table is empty and the node does nothing.
import type { BehaviourNode, Controller } from '../../../game/controller.ts';
import { NODE_CONTINUE } from '../../../game/controller.ts';
import type { GameRecord } from '../../../game/record.ts';
import type { World } from '../../../game/world.ts';
import { tryCtx } from '../../../island/ctx.ts';

export const HOLO = { TABLE_VA: 0x94c820, ENTRY_BYTES: 12 } as const;

export class HoloWatchNode implements BehaviourNode {
  readonly kind = 'PeppHolo';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;

  /** FUN_007e6b05: returns 2 */
  update(w: World, _rec: GameRecord, _ctrl: Controller): number {
    void _rec; void _ctrl;
    const pe = tryCtx(w)?.pe;
    if (!pe) return NODE_CONTINUE;
    for (let i = 0; (pe.u32(HOLO.TABLE_VA + i * HOLO.ENTRY_BYTES) | 0) > 0; i++) {
      const v = pe.u32(HOLO.TABLE_VA + i * HOLO.ENTRY_BYTES);
      const x = w.vars.get(v);
      if (x === 1 || x === 8) w.vars.set(v, 2);
    }
    return NODE_CONTINUE;
  }
}
