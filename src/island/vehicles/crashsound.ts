// The skateboard crash sound of the SHARED trick code (FUN_0048e840, 0x48fa0c: `FUN_004435a0(DAT_05d58064)`). DAT_05d58064 is written ONLY by the park's sound set FUN_00492ec0 (0x492f6f,
// the 10th 2D load of that list), never by the island's: on the island it holds 0 (BSS) in a process that never entered the park, else the SLOT number the park's load order gave it,
// and FUN_004435a0(slot) plays that slot of the CURRENT zone's 2D bank (the island's FUN_004b037e list: first 2D load = SND_PEPPS_CAR (880, Sophie1.wav)). So the original does play a sound
// here, whichever sample sits in that slot. (The jump handle DAT_05d5802c is only read at 0x49222f / 0x492364, park code: not an island matter.)
import type { Pe } from '../../formats/exe.ts';
import { ZONE_SOUND_SETUP } from '../../audio/zonesounds.ts';

/** the process visited the park (its sound set ran): the stale slot is then in DAT_05d58064 */
export const parkSession = { visited: false };

const PARK_FN = 0x492ec0, PARK_END = 0x4931a0, DAT_CRASH = 0x5d58064;
/** the 2D slot number FUN_00492ec0 stores into the global `dst` (counted over its `call 0x443580` loads), -1 when it does not */
export function parkSlotOf(pe: Pe, dst: number): number {
  const u8 = (a: number) => pe.u32(a) & 0xff;
  let n2d = 0, last = -1;
  for (let a = PARK_FN; a < PARK_END;) {
    const op = u8(a);
    if (op === 0x68) { a += 5; continue; }
    if (op === 0x6a) { a += 2; continue; }
    if (op === 0xe8) {
      const t = (a + 5 + (pe.u32(a + 1) | 0)) >>> 0;
      last = t === 0x443580 ? n2d++ : -1;
      a += 5; continue;
    }
    if (op === 0x83 && u8(a + 1) === 0xc4) { a += 3; continue; }
    if (op === 0xa3) { if (pe.u32(a + 1) === dst) return last; a += 5; continue; }
    if (op === 0xa1) { a += 5; continue; }
    if ((op === 0x8b || op === 0x89) && (u8(a + 1) & 0xc7) === 0x05) { if (op === 0x89 && pe.u32(a + 2) === dst) return last; a += 6; continue; }
    a++;
  }
  return -1;
}
/** the sound id in the island's 2D slot `slot` (FUN_004b037e's loads), -1 beyond the list */
export function islandSlot2d(slot: number): number {
  let k = 0;
  for (const [kind, id] of ZONE_SOUND_SETUP.z02LGI.loads) if (kind === '2d') { if (k === slot) return id; k++; }
  return -1;
}
/** the sound id the island's crash plays: the slot DAT_05d58064 holds (0, or the park's after a visit), looked up in the island's 2D bank */
export function crashSoundId(pe: Pe): number {
  return islandSlot2d(parkSession.visited ? parkSlotOf(pe, DAT_CRASH) : 0);
}
