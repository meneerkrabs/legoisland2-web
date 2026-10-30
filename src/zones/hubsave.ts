// WP-SAVE, the hub nodes' save blocks (z14OSD / z16PYA / z23DIP / z40OGL): helpers shared by their `saveBlock` / `loadBlock`.
// The original's node memory comes from the DEBUG heap (FUN_00433d38 -> FUN_00858d30 = __nh_malloc_dbg): a fresh block is filled with 0xCD (_bCleanLandFill), so every byte of a node's save
// range that its constructor never writes (padding after a byte field, a never-initialised word) is 0xCD in the file the original writes. The ports keep such words as plain fields that
// start with this fill and are carried through a load, so a save / load round trip is byte exact.
import type { World } from '../game/world.ts';
import { tryCtx } from '../island/ctx.ts';
import { applyDecorSets, looksOf } from '../island/vehicles/looks.ts';

/** the debug heap's fill byte / dword, and the float32 those four bytes make */
export const CD8 = 0xcd, CD32 = 0xcdcdcdcd;
export const CD_F32: number = new Float32Array(new Uint32Array([CD32]).buffer)[0];

/**
 * The tail of the hub PeppSw loaders (z14OSD FUN_00655dc0, z16PYA FUN_00698940, z23DIP FUN_00765180, z40OGL FUN_008113f0): FUN_00420674 (the decor sets' era table from the game variables) and
 * FUN_004202ef(roster) (every roster entry re-reads its stored look from its game variable, the busy list DAT_009da590 is cleared to -1). The cycler handles themselves
 * (`FUN_00443810`, only created while 0xbabababa) and the record pointers are untouched, so the port's `VehicleLooks` keeps its entries and re-reads their looks.
 */
export function rosterReload(w: World): void {
  const pe = tryCtx(w)?.pe;
  if (pe) applyDecorSets(w, pe);
  const looks = looksOf(w);
  if (!looks) return;
  for (const e of looks.entries) {
    if (e.varIdx === -1) continue;
    const v = w.vars.get(e.varIdx) | 0;
    e.part = v & 0xff; e.variant = v >> 8;
  }
  looks.busy.fill(-1);
}

/**
 * The 0x20 bytes at node +0x18 of the Oasis' / Pyramid's mode switch (z14OSD PEPPSW FUN_0062ba3b, z16PYA PeppSw FUN_00677350; the savers FUN_0062b9d8 / FUN_006772ed are `*out = node + 0x18;
 * return 0x20`, the loaders memcpy them back and then run `rosterReload`): +0x00 level wanted, +0x04 level last sent to the music, +0x08 = -1, +0x0c byte 0 (+3 padding), +0x10
 * `FUN_00443370() & 0xff` (the music notification poll), +0x14 = 0, +0x18 byte 0 (+3 padding), +0x1c = 0. Only the two levels are read after the constructor; the rest is kept as an image
 * (padding = the debug heap fill 0xCD).
 */
export function newPeppSwTail(): Uint8Array {
  const t = new Uint8Array(32).fill(CD8), v = new DataView(t.buffer);
  v.setInt32(0, 1, true); v.setInt32(4, 1, true); v.setInt32(8, -1, true); t[12] = 0; v.setInt32(16, 0, true); v.setInt32(20, 0, true); t[24] = 0; v.setInt32(28, 0, true);
  return t;
}
/** the constructor's `param_3[10] = FUN_00443370() & 0xff` */
export function setPeppSwPoll(t: Uint8Array, poll: number): void { new DataView(t.buffer, t.byteOffset, t.byteLength).setInt32(16, poll & 0xff, true); }
/** the block: the image with the two live levels written over it */
export function packPeppSw(t: Uint8Array, level: number, sent: number): Uint8Array {
  const out = t.slice(), v = new DataView(out.buffer);
  v.setInt32(0, level, true); v.setInt32(4, sent, true);
  return out;
}
