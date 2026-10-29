// The set-up's final state of the horse family's records. The port's world takes its record flags from the symbolic extraction of the zone's set-up code, which applies the writes in ADDRESS order;
// the original runs them in EXECUTION order. For HORS the two disagree: FUN_00573527 shows it at 0x573cbf (`flags = 2`) but the Control constructor's tail FUN_005b2a23 (called earlier, address
// 0x5b2adc) hides it: address order ends hidden, the machine ends visible (the emulated set-up `ctx.setup.records`: flags 2, the last write wins). The stage's explicit placements (the arrival after the
// joust puts HORS and JKIT at Pepper's place, the stage sets 0x57a8ae ...) are `ctx.setup.changed` entries and come AFTER the SGMFIG constructor's placement on its PATH node (the walker's start
// node), so they win as well. This applies exactly those two things to a record of the family (its visibility bit and an explicit position); everything else of the record stays as `setupZone` built it.
import type { GameRecord } from '../../../game/record.ts';
import type { World } from '../../../game/world.ts';
import { tryCtx } from '../../../island/ctx.ts';
import { f } from './math.ts';

/** `visibility`: the visible bit of the emulated set-up's final flags; `placement`: the position the set-up code wrote (an `emu.changed` entry), when it wrote one */
export function applyEmulatedSetupState(w: World, rec: GameRecord, opts: { placement?: boolean } = {}) {
  const emu = tryCtx(w)?.setup;
  const e = emu?.records[rec.index];
  if (!emu || !e || e.name !== rec.name) return;
  if ((e.flags & 2) !== 0) rec.flags |= 2; else rec.flags &= ~2;
  if (opts.placement) {
    // the last explicit position the set-up code wrote to this record (`changed`: the machine's final value against the scene's)
    const c = [...emu.changed].reverse().find((x) => x.record === rec.index && x.field === 'pos');
    if (c) { const p = c.to as number[]; rec.m[12] = f(p[0]); rec.m[13] = f(p[1]); rec.m[14] = f(p[2]); }
  }
}
