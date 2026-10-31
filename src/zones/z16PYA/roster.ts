// z16PYA, the Pyramid: the vehicle / decor roster of PeppSw's constructor (FUN_00677350 -> FUN_00698963, the Pyramid's copy of the island's PepSwitc roster FUN_0051c823).
//   FUN_00698963: every record's variant word (+0x64) := 0; the 15 records of the list 0x925a30 (PN00 .. TRBR, the decor models' templates: records 0x58 .. 0x66) get render mode 1
//   (FUN_00444550(rec, 0xff, 1)) and `flags &= ~2` (hidden); FUN_00420837(3): the decor group 3 of the decor tables (48 records: the 24 PM palms / pyramids models, 9 BS bushes,
//   10 OBL obelisks, 2 JAK, and the minifigs JTHN / MPRD / DRKL) gets the variant word set << 8 | 1 | variant << 16 (type 1 = Enter swaps the outfit / decor model: FUN_00420bb7 +
//   FUN_00420dc4: `DecorState`, wired by `ensurePyaLooks`); FUN_00698940: FUN_00420674 (the decor sets' era table) + FUN_004202ef(roster 0x925a00) (the roster
//   `{ record 0x70 (SPED, the Speedster), SwapText set 0x37, game variable 0x24, brick effect }`: variant word 2 = Enter changes its look: sound 0x2c0, the SwapText cycler, the brick
//   morph speedster00..08.txt); then FX_Bricks: FUN_00447d20(SPED, var 0x24) + nine models + nine stages.
// The set-up emulation does not run constructors: `constructRoster` runs FUN_00698963 in the emulated machine after the set-up (the FX_Bricks registrations become part of
// `setup.calls`, which the brick manager applies when it is created, src/fx/bricks/island.ts) and makes the record writes here (the island does the same, looks.ts
// `applyRosterRecords`). The look cycler itself is the island's (`VehicleLooks`, the roster table passed in).
import type { Pe } from '../../formats/exe.ts';
import type { World } from '../../game/world.ts';
import { tryCtx } from '../../island/ctx.ts';
import { islandBrickFx } from '../../fx/bricks/island.ts';
import { NO_SLOT } from '../../fx/bricks/manager.ts';
import { readDecorTables, decorGroupOfZone } from '../../shell/tables.ts';
import { VehicleLooks, LOOKS_KEY, ROSTER_STRIDE, VARIANT_VEHICLE, applyDecorSets, looksOf, lookKey, tickLooks, startZoneDecor } from '../../island/vehicles/looks.ts';
import type { RosterHooks } from './peppsw.ts';

/** FUN_00698963 and the tables it reads */
export const FN_ROSTER = 0x698963, ROSTER_VA = 0x925a00, HIDDEN_LIST_VA = 0x925a30;
/** the Pyramid's zone table index (var 0x59 while it runs): `FUN_00420837(3)` = decor group 3 = `decorGroupOfZone(0xd)` */
const ZONE_INDEX = 0xd;

/** the records of the hidden list (ends with -1) */
export function hiddenList(pe: Pe): number[] {
  const out: number[] = [];
  for (let va = HIDDEN_LIST_VA; ; va += 4) { const i = pe.u32(va) | 0; if (i === -1) break; out.push(i); }
  return out;
}

/** FUN_00698963's record writes (the set-up emulation drops them) */
export function applyRosterRecords(w: World, pe: Pe): void {
  for (const r of w.records) r.variant = 0;
  for (const i of hiddenList(pe)) { const r = w.records[i]; if (r) r.flags &= ~0x2; }
  const dt = readDecorTables(pe), grp = dt.groups[decorGroupOfZone(ZONE_INDEX)];
  for (let i = grp.first; i < grp.first + grp.count; i++) {
    const e = dt.entries[i], r = w.records[e.record];
    if (r) r.variant = (e.set << 8) | 1 | (e.variant << 16);
  }
  applyDecorSets(w, pe);   // FUN_00698940 -> FUN_00420674
  for (let va = ROSTER_VA; (pe.u32(va) | 0) !== -1; va += ROSTER_STRIDE) { const r = w.records[pe.u32(va) | 0]; if (r) r.variant = VARIANT_VEHICLE; }
}

/** at the set-up: run FUN_00698963 in the emulated machine (FX_Bricks calls) and make its record writes */
export function constructRoster(w: World, pe: Pe, run: (fn: number) => unknown): void {
  run(FN_ROSTER);
  applyRosterRecords(w, pe);
}

/** FUN_004202ef at the first use: the roster's look cyclers (built when the brick effects can be registered: the library is installed after the set-up) */
export function ensurePyaLooks(w: World): VehicleLooks | null {
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
  startZoneDecor(w, c.pe, ZONE_INDEX);   // FUN_00420837(3) resolved against the zone's models + the wrapper's FUN_00421bbe(3): the stored decor applied
  return looks;
}

/** PeppSw's pre-render tail: FUN_00698da4 (Enter: the nearest record with a variant word: type 2 changes its look, type 1 is the decor / outfit swap) and FUN_00698e39 (every tick) */
export const pyaRosterHooks: RosterHooks = {
  enter(w, pepper) { if (ensurePyaLooks(w)) lookKey(w, pepper); },
  tick(w) { if (ensurePyaLooks(w)) tickLooks(w); },
};
