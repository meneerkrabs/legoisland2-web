// z23DIP: the decor / outfit swap of the Dino island's PeppSw (docs/re/m5/z23DIP.md): the Dino island's copy of the island's FUN_0051db5c / FUN_0051dbd7 are FUN_00765281 (Enter: FUN_004201f0 ->
// type 1 FUN_00420bb7 = the outfit swap of the stage figures / huts, type 2 FUN_00420570 over the roster 0x93d578, which is EMPTY here) and FUN_00765316 (every tick: FUN_00420590 + FUN_00420dc4).
// These are the island's generic modules (src/island/vehicles/looks.ts, src/island/decor.ts) with decor group 4; the wrapper's FUN_00421bbe(4) (the stored decor applied) runs when the state is built,
// at the first pre-render of PeppSw (the models of the zone exist then).
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import { tryCtx } from '../../island/ctx.ts';
import { islandBrickFx } from '../../fx/bricks/island.ts';
import { NO_SLOT } from '../../fx/bricks/manager.ts';
import { VehicleLooks, LOOKS_KEY, ROSTER_STRIDE, looksOf, lookKey, tickLooks, startZoneDecor } from '../../island/vehicles/looks.ts';
import type { DecorHooks } from './pepsw.ts';
import { ZONE_INDEX } from './consts.ts';

/** the roster of the Dino island (FUN_00765180: FUN_004202ef(&DAT_0093d578)): its first record is -1, no vehicle changes its look here */
export const DIP_ROSTER_VA = 0x93d578;

/** FUN_00420837(4) resolved against the zone's models, FUN_00421bbe(4) and the (empty) roster, once */
export function ensureDipLooks(w: World): VehicleLooks | null {
  const have = looksOf(w);
  if (have) return have;
  const c = tryCtx(w);
  if (!c?.setup) return null;
  const fx = islandBrickFx(w);
  const looks = new VehicleLooks(w, c.pe, (n) => {
    const s = fx?.setupSlots.get(c.setup.mem.u32(DIP_ROSTER_VA + n * ROSTER_STRIDE + 0x14) | 0);
    return s === undefined ? NO_SLOT : s;
  }, DIP_ROSTER_VA);
  w.ext.set(LOOKS_KEY, looks);
  startZoneDecor(w, c.pe, ZONE_INDEX);
  return looks;
}

/** FUN_00765281 / FUN_00765316 for `setDecorHooks` */
export const dipDecorHooks: DecorHooks = {
  enter(w: World, pepper: GameRecord) { if (ensureDipLooks(w)) lookKey(w, pepper); },
  tick(w: World) { if (ensureDipLooks(w)) tickLooks(w); },
};
