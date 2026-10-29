// z28HAT: the balloon's shadow patch (record 80 SHAD), drawn by the balloon's draw hook FUN_00796d72: `flags(SHAD) |= 2`, FUN_0043ebe0(SHAD model, 2, balloon record + 0x40, 0) = FUN_0088350d mode 2
// (vertex i := the three floats at points + 12 i, for the mesh's 5 vertices), FUN_00444480(SHAD) with the z test off (FUN_0040cc4d(0) before, restored after).
// The pointer is the balloon RECORD's own memory from +0x40, so the five vertices are the 15 dwords from there (the record array is a debug-CRT block of 0x3e90 + 4 bytes, `FUN_00433cfe` writes
// the sentinel 0xbadfebad behind the data, the debug heap's 4 guard bytes 0xfd follow, then padding and the next heap entry's header). Record 153 is the LAST record, so:
//   +0x40 y, +0x44 z, +0x48 m[15] (1.0)                       -> vertex 0 = (y, z, 1)
//   +0x4c rx, +0x50 ry (the heading), +0x54 rz                -> vertex 1 = (rx, ry, rz)
//   +0x58 collision pointer, +0x5c controller pointer, +0x60 flags (u16) / +0x62 (u16) -> vertex 2: heap addresses and a flag word read as float32
//   +0x64 variant, +0x68 = 0xbadfebad (the sentinel), +0x6c = 0xfdfdfdfd (the guard)  -> vertex 3 = (variant, -0.00170..., -4.2e37)
//   +0x70 padding of the heap block, +0x74 / +0x78 the next heap entry's header words                            -> vertex 4
// Every word that is a heap address, flag, small integer or heap header (< 2^28 as a bit pattern) is a float32 below 2^-60: it cannot move a projected position, so the port uses 0 for them (the
// emulator test checks |value| < 1e-18 against the real words); the words that DO matter (y, z, 1.0, rx, ry, rz, 0xbadfebad, 0xfdfdfdfd) are exact.
import type { GameRecord } from '../../game/record.ts';

/** the sentinel FUN_00433cfe writes after the data of the record array (an `int` 0xbadfebad read as a float32 = -0.00170...) and the debug heap's guard byte pattern 0xfdfdfdfd (-4.2e37) */
export const HEAP_SENTINEL = 0xbadfebad, HEAP_GUARD = 0xfdfdfdfd;
/** the SHAD record */
export const SHAD_RECORD = 80;

const BITS = new Uint32Array(1), AS_F = new Float32Array(BITS.buffer);
const fromBits = (u: number): number => { BITS[0] = u >>> 0; return AS_F[0]; };

/** the five vertices (15 floats) the original's FUN_0043ebe0 reads from the balloon record at the time of the draw */
export function shadowPoints(balloon: GameRecord, out: Float32Array = new Float32Array(15)): Float32Array {
  out[0] = balloon.m[13]; out[1] = balloon.m[14]; out[2] = balloon.m[15];       // +0x40 .. +0x48
  out[3] = balloon.rx; out[4] = balloon.ry; out[5] = balloon.rz;                // +0x4c .. +0x54
  out[6] = 0; out[7] = 0; out[8] = 0;                                           // pointers + flag word: floats below 2^-60
  out[9] = 0;                                                                    // +0x64 variant (a small int)
  out[10] = fromBits(HEAP_SENTINEL); out[11] = fromBits(HEAP_GUARD);            // +0x68 sentinel, +0x6c guard
  out[12] = 0; out[13] = 0; out[14] = 0;                                        // padding + the next heap entry's header
  return out;
}
