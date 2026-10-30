// WP-SAVE helpers shared by the save blocks of src/island/pizza/* (docs/re/save.md).
//  * the debug heap: the original is a Visual Studio 2003 DEBUG build (FUN_00433d38 -> FUN_00858d30 -> __nh_malloc_dbg): a fresh node block is filled with 0xCD, so the node bytes the constructor never
//    writes (fields initialised on first use, struct padding) are 0xCD in the game and in every save. The ports keep those fields (and their pad bytes) with the same fill value.
//  * record pointers inside a block (`recPtr`): the original's record array lives at DAT_00983804 + index * 0x68 (a heap address of the process); the port uses the emulation's address of the oracle
//    (src/island/args.ts EMU_RECORDS_BASE), the loader of the original ignores / overwrites these words (it translates the 4 character tags that follow them).
//  * the 4 character tag of a record is its first dword; FUN_00419a79(tag) finds the first record of that name (a tag whose first byte is 0 finds nothing).
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { EMU_RECORDS_BASE, EMU_RECORD_STRIDE } from '../args.ts';
import { tagOf, recordOfTag } from '../../shell/saveworld.ts';

/** 0xCDCDCDCD as a float32 (-431602080), as an int32 */
export const CD_F32 = -431602080;
export const CD_I32 = -842150451;
export const CD_U32 = 0xcdcdcdcd;

/** the address of a record in the original's record array (null = 0) */
export const recPtr = (r: GameRecord | null | undefined): number => (r ? (EMU_RECORDS_BASE + r.index * EMU_RECORD_STRIDE) >>> 0 : 0);

/** the dword a saver writes for a record pointer slot: the record's tag, or the default tag word (a global of the exe) when the slot is empty */
export const tagWord = (r: GameRecord | null | undefined, empty = 0): number => (r ? tagOf(r.name) : empty) >>> 0;

/** FUN_00419a79 */
export const findByTag = (w: World, tag: number): GameRecord | null => recordOfTag(w, tag >>> 0);

/** the first 0x24 bytes of a record header as the original's carry saver copies them (FUN_00429baa): +0 tag, +4 model pointer, +8 animation pointer, +0xc.. the first six floats of the matrix */
export function recordHeader(r: GameRecord, out: Uint8Array, at: number) {
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  dv.setUint32(at, tagOf(r.name), true);
  // +4 / +8: heap pointers of the process (model, animation instance): not reproducible, 0
  for (let k = 0; k < 6; k++) dv.setFloat32(at + 0xc + 4 * k, r.m[k], true);
}
