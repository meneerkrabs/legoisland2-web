// z14OSD: the vehicle / decor roster of PEPPSW's constructor (FUN_0062ba3b -> FUN_00655de3) and its Enter / every-tick tail (FUN_006561e9 / FUN_0065627e), the Oasis' copy of the island's roster
// (FUN_0051c823; z16PYA's copy: src/zones/z16PYA/roster.ts, same pattern).
//   FUN_00655de3: every record's variant word (+0x64) := 0; the records of the list 0x91c480 (PN00 .. TS00, the decor models' templates: records 0x7d ..) get render mode 1 and `flags &= ~2`;
//   FUN_00420837(2) = the decor group 2 (`decorGroupOfZone(0xb)`); FUN_00655dc0 = FUN_00420674(2) (decor era table) + FUN_004202ef(roster 0x91c450): the roster is
//   `{ record 0x7c (PHEL, the parked helicopter), SwapText set 0x2e, game variable 0xd2, brick effect }`; then FX_Bricks: FUN_00447d20(PHEL, var 0xd2) + the 8 models phel03 / 00 / 07 / 04 / 01 / 02 / 06 / 05.txt
//   + 8 stages. The set-up emulation does not run constructors: `constructRoster` runs FUN_00655de3 in the emulated machine after the set-up (its FX_Bricks registrations become part of
//   `setup.calls`, which the brick manager applies when it is created) and makes the record writes here. The look cycler is the island's `VehicleLooks` with this roster table.
import type { Pe } from '../../formats/exe.ts';
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import { tryCtx } from '../../island/ctx.ts';
import { islandBrickFx } from '../../fx/bricks/island.ts';
import { NO_SLOT } from '../../fx/bricks/manager.ts';
import { readDecorTables, decorGroupOfZone } from '../../shell/tables.ts';
import { VehicleLooks, LOOKS_KEY, ROSTER_STRIDE, VARIANT_VEHICLE, applyDecorSets, looksOf, lookKey, tickLooks } from '../../island/vehicles/looks.ts';

export const FN_ROSTER = 0x655de3, ROSTER_VA = 0x91c450, HIDDEN_LIST_VA = 0x91c480;
/** the Oasis' zone table index (var 0x59 while it runs): `FUN_00420837(2)` = decor group 2 = `decorGroupOfZone(0xb)` */
const ZONE_INDEX = 0xb;

export function hiddenList(pe: Pe): number[] {
  const out: number[] = [];
  for (let va = HIDDEN_LIST_VA; ; va += 4) { const i = pe.u32(va) | 0; if (i === -1) break; out.push(i); }
  return out;
}

/** FUN_00655de3's record writes (the set-up emulation drops them) */
export function applyRosterRecords(w: World, pe: Pe): void {
  for (const r of w.records) r.variant = 0;
  for (const i of hiddenList(pe)) { const r = w.records[i]; if (r) r.flags &= ~0x2; }
  const dt = readDecorTables(pe), grp = dt.groups[decorGroupOfZone(ZONE_INDEX)];
  for (let i = grp.first; i < grp.first + grp.count; i++) {
    const e = dt.entries[i], r = w.records[e.record];
    if (r) r.variant = (e.set << 8) | 1 | (e.variant << 16);
  }
  applyDecorSets(w, pe);   // FUN_00655dc0 -> FUN_00420674(2)
  for (let va = ROSTER_VA; (pe.u32(va) | 0) !== -1; va += ROSTER_STRIDE) { const r = w.records[pe.u32(va) | 0]; if (r) r.variant = VARIANT_VEHICLE; }
}

/** at the set-up: run FUN_00655de3 in the emulated machine (FX_Bricks calls) and make its record writes */
export function constructRoster(w: World, pe: Pe, run: (fn: number) => unknown): void {
  run(FN_ROSTER);
  applyRosterRecords(w, pe);
}

/** FUN_004202ef at the first use (the brick library is installed after the set-up) */
export function ensureOsdLooks(w: World): VehicleLooks | null {
  const have = looksOf(w);
  if (have) return have;
  const c = tryCtx(w);
  if (!c?.setup) return null;
  const fx = islandBrickFx(w);
  const looks = new VehicleLooks(w, c.pe, (n) => {
    const h = c.setup.mem.u32(ROSTER_VA + n * ROSTER_STRIDE + 0x14) | 0;
    const s = fx?.setupSlots.get(h);
    return s === undefined ? NO_SLOT : s;
  }, ROSTER_VA);
  w.ext.set(LOOKS_KEY, looks);
  return looks;
}

/** FUN_006561e9: Enter -> the nearest record with a variant word (type 2 changes its look, type 1 the decor / outfit swap: not ported, the island's open item) */
export function lookEnter(w: World, pepper: GameRecord): void { if (ensureOsdLooks(w)) lookKey(w, pepper); }
/** FUN_0065627e: every tick */
export function lookTick(w: World): void { if (ensureOsdLooks(w)) tickLooks(w); }
