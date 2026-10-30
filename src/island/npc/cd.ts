// The original is a debug build: FUN_00433d38 -> __nh_malloc_dbg fills a new block with 0xCD, so a node field its constructor never writes holds 0xCDCDCDCD until the node's code does.
// The port keeps those fields at the same values until written, so that the save block (which copies the whole range) equals the original's byte for byte.
import { fromBits } from '../../zones/common/f32.ts';
/** 0xCDCDCDCD as a float32 (-4.3e8) / i32 / i16 / u8 */
export const CD_F = fromBits(0xcdcdcdcd), CD_I32 = 0xcdcdcdcd | 0, CD_I16 = 0xcdcd << 16 >> 16, CD_U8 = 0xcd;
