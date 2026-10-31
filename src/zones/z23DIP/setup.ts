// z23DIP: the world-dependent half of the set-up: what the emulated set-up does not carry over (calls it only logged, constructor bodies the port runs after `setupZone`).
//   * `FUN_0043b64d(anim, time)` of the node-50 builder (FUN_007283e0): the Rex records REX2 .. REX7 are posed at fixed frames (7, 2, 5, 10, 12, 9) - the emulation logs the six
//     calls (`animTime`), the animation instances are the loader's (`ensureAnim`, clip 1); nothing in the zone advances them afterwards (only a cutscene's FUN_00459740 does);
//   * the PeppSw constructor's record writes (FUN_00727e84 -> FUN_007651a3, the Dino island's copy of the island's FUN_0051c823): every record's variant word (+0x64) := 0, the
//     records of the list at 0x93d590 (the decor templates PN00 .. TRBR: 253 .. 269 except 266) get flags := 0 (hidden), FUN_00420837(4): the decor entries of group 4 (22 records:
//     the stage figures' outfits, the huts) get the variant word `set << 8 | 1 | variant << 16` that `FUN_00765281` (Enter) finds;
//   * FUN_00726e25's `DAT_009daa7c = 0x1c` (the skateboard record, already `Loaded.pepper`'s accessory through the emulated global) for the skate node.
import type { World } from '../../game/world.ts';
import type { Pe } from '../../formats/exe.ts';
import type { IslandSetup } from '../../formats/emusetup.ts';
import { RECORDS_BASE } from '../../formats/emusetup.ts';
import { readDecorTables, decorGroupOfZone } from '../../shell/tables.ts';
import { applyDecorSets, VARIANT_VEHICLE, ROSTER_STRIDE } from '../../island/vehicles/looks.ts';
import { vehicles } from '../../island/vehicles/common.ts';
import { ensureAnim } from '../../island/ambient/common.ts';
import { ZONE_INDEX, REC } from './consts.ts';

/** FUN_007651a3's hidden list (DAT_0093d590, ends with -1) */
export const HIDDEN_LIST_VA = 0x93d590;
/** the roster table (FUN_007651a3's last loop): its first record is -1 */
const ROSTER_VA = 0x93d578;
/** the stride of the emulated record array */
const STRIDE = 0x68;

const f32 = (bits: number): number => { const v = new DataView(new ArrayBuffer(4)); v.setUint32(0, bits >>> 0, true); return v.getFloat32(0, true); };

/** the `FUN_0043b64d(anim, time)` calls of the set-up, as (record index, frame) */
export function animTimes(emu: IslandSetup): { record: number; time: number }[] {
  const owner = new Map<number, number>();
  const n = emu.records.length;
  for (let i = 0; i < n; i++) owner.set(emu.mem.u32(RECORDS_BASE + i * STRIDE + 8), i);
  const out: { record: number; time: number }[] = [];
  for (const c of emu.calls) {
    if (c.name !== 'animTime') continue;
    const r = owner.get(c.args[0] >>> 0);
    if (r !== undefined) out.push({ record: r, time: f32(c.args[1]) });
  }
  return out;
}

/** apply them: FUN_0043b64d (range checked: 0 <= time <= the clip's frame count) on the record's animation instance */
export function applyAnimTimes(w: World, emu: IslandSetup): { record: number; time: number; ok: boolean }[] {
  return animTimes(emu).map(({ record, time }) => {
    const rec = w.records[record];
    const a = rec ? ensureAnim(w, rec) : null;
    return { record, time, ok: a ? a.seek(time) : false };
  });
}

/** FUN_007651a3 + FUN_00420837(4): see the header */
export function applyDecorRecords(w: World, pe: Pe) {
  for (const r of w.records) r.variant = 0;
  for (let va = HIDDEN_LIST_VA; ; va += 4) {
    const i = pe.u32(va) | 0;
    if (i === -1) break;
    const r = w.records[i];
    if (r) r.flags = 0;
  }
  const dt = readDecorTables(pe), grp = dt.groups[decorGroupOfZone(ZONE_INDEX)];
  for (let i = grp.first; i < grp.first + grp.count; i++) {
    const e = dt.entries[i], r = w.records[e.record];
    if (r) r.variant = (e.set << 8) | 1 | (e.variant << 16);
  }
  applyDecorSets(w, pe);   // FUN_00765180: FUN_00420674(4) (the decor sets' era table) + FUN_004202ef(0x93d578)
  for (let va = ROSTER_VA; (pe.u32(va) | 0) !== -1; va += ROSTER_STRIDE) { const r = w.records[pe.u32(va) | 0]; if (r) r.variant = VARIANT_VEHICLE; }   // (the roster is empty here)
}

/** DAT_009daa7c := 0x1c (FUN_00726e25): the skateboard record the skate node and the walk node's accessory use */
export function setBoardRecord(w: World) { vehicles(w).board = REC.SKBD; }
