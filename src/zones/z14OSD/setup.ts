// z14OSD set-up pieces the x86 emulation of FUN_006290ea only LOGGED (docs/re/m5/foundation.md 7): the sub-object matrix calls `FUN_0043ea60(model, part)` of story node 45's builder FUN_0062bb80:
//   `*(float*)(FUN_0043ea60(rec[70].model, 1) + 0x30) = 0` and the same for part 2: the translation X (m[12]) of the sub-object matrices 1 and 2 of record 70 (G002) is zeroed.
// The port keeps live copies of a record's sub-object matrices (src/island/trigger/parts.ts) that the renderer draws the groups with (GameRenderer.partMatrices).
import type { IslandSetup } from '../../formats/emusetup.ts';
import { EMU_RECORDS_BASE, EMU_RECORD_STRIDE } from '../../island/args.ts';
import { partMatrix } from '../../island/trigger/parts.ts';
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';

/** record field +4 = the model pointer (`RF.MODEL`): the argument FUN_0043ea60 gets (`DAT_00983804 + 4 + index * 0x68`) */
export function recordOfModelToken(emu: IslandSetup, token: number): number {
  const n = emu.records.length;
  for (let i = 0; i < n; i++) if ((emu.mem.u32(EMU_RECORDS_BASE + i * EMU_RECORD_STRIDE + 4) >>> 0) === (token >>> 0)) return i;
  return -1;
}

/** FUN_0043ea60 calls of the emulated set-up that are followed by `*(ptr + 0x30) = 0` (the only use in this zone): { record, part } */
export function subMatrixZeroes(emu: IslandSetup): { record: number; part: number }[] {
  const out: { record: number; part: number }[] = [];
  for (const c of emu.calls) {
    if (c.name !== 'subMatrix') continue;
    const rec = recordOfModelToken(emu, c.args[0]);
    if (rec >= 0) out.push({ record: rec, part: c.args[1] | 0 });
  }
  return out;
}

/** apply them: m[12] (+0x30) := 0 of the live sub-object matrix */
export function applySubMatrices(w: World, emu: IslandSetup): { record: number; part: number; applied: boolean }[] {
  return subMatrixZeroes(emu).map(({ record, part }) => {
    const rec: GameRecord | undefined = w.records[record];
    const m = rec ? partMatrix(w, rec, part) : null;
    if (m) m[12] = 0;
    return { record, part, applied: !!m };
  });
}
