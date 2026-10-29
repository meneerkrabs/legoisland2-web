// Shared helpers of the WP5 node family (Pizza.c, Footy, SupaStat, speeder): the services of the island context with fall-backs for worlds
// without one (other zones, bare node tests), angle helpers and the "hold a record at a bone of another record" transform the draw hooks of
// Pizza.c use (FUN_004285b0 / FUN_00428d29 / FUN_0042992a).
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { eulerMatrix, mulMatrices } from '../../zones/exact.ts';
import { tryCtx } from '../ctx.ts';

/** 0x89207c / 0x892094 / 0x892098 */
export const PI_F = 3.1415927410125732, TWO_PI_F = 6.2831854820251465;
/** 0x3fc90fdb */
export const HALF_PI_F = 1.5707963705062866;

/** the one-step wrap the original applies to angles (`if a < -pi: a += 2pi; else if a > pi: a -= 2pi`) */
export const wrapOnce = (a: number) => (a < -PI_F ? Math.fround(a + TWO_PI_F) : a > PI_F ? Math.fround(a - TWO_PI_F) : a);

/** FUN_004435a0: 2D sound (the island context's sink, else the world's) */
export function sfx(w: World, id: number) { const c = tryCtx(w); if (c) c.sfx(id); else w.playSound(id); }
/** FUN_004433f0: sound at a position */
export function sfxAt(w: World, id: number, pos: readonly [number, number, number]) { const c = tryCtx(w); if (c) c.sfxAt(id, pos); else w.playSound(id); }
/** FUN_0045c432 */
export function cutsceneActive(w: World): boolean { return tryCtx(w)?.cutsceneActive() ?? false; }
/**
 * The draw hooks of Pizza.c: `rec.m = (R(0, pi/2, 0) * T(off) * bone[b]) * carrier.m` (FUN_0043a5e4(local, 0, pi/2, 0, off) then two FUN_0043a9e5), every product / sum float32.
 * With no animated rig (or bone < 0) the carrier's matrix is used as is. `carrierM` = the carrier's matrix (the carry node may scale it).
 */
export function placeAtBone(rec: GameRecord, carrier: GameRecord, bone: number, off: readonly [number, number, number], carrierM: Float32Array = carrier.m) {
  const bones = bone >= 0 ? carrier.anim?.pose(1) ?? null : null;
  if (!bones || bones.length < bone * 16 + 16) { rec.m.set(carrierM); return; }
  const local = new Float32Array(16);
  eulerMatrix(local, 0, HALF_PI_F, 0, off[0], off[1], off[2]);
  const d4 = mulMatrices(local, bones.subarray(bone * 16, bone * 16 + 16));
  rec.m.set(mulMatrices(d4, carrierM));
}
