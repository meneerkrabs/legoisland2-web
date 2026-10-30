// The castle's vehicle roster and decor group (Control's constructor FUN_005b2a23 -> FUN_00420837(1) + FUN_005b2a00 = FUN_00420674 + FUN_004202ef(0x9031d0), and the wrapper's FUN_00421bbe(1)),
// built on the island's modules (src/island/vehicles/looks.ts: the look cycler / roster, src/island/decor.ts: the decor and outfit swap; both are generic in the roster table / the decor group):
//   * roster table 0x9031d0 (0x18 bytes per entry: record, record pointer, cycler, SwapText set, game variable, brick effect): SPBT (87, var 0xae, set 0x1c), DNGY (0xb6, var 0xd7, set 8) and
//     JSKI (0xb7, var 0x34, set 0x14): Enter next to a boat of the roster (record variant word 2) cycles its paint (SwapText) through the speedboat's brick morph (speedboat00..09.txt);
//   * decor group 1 (98 entries of the table 0x8acdf0 from index 176): records of the castle whose variant word has type 1 (minifig hats / decor models): Enter swaps the model (FUN_00420bb7), a
//     30 tick pop animation (FUN_00420dc4 every tick); the stored choice (`decorStore`, 0x1c0 x (set, variant) bytes) is applied at the zone start (FUN_00421bbe(1)).
// The brick effect registrations of the roster (FUN_00447d20 / 00447da0 / 00447d70 for the speedboat) are made by RUNNING Control's constructor tail in the set-up emulation (`run`): they become part
// of `setup.calls`, which the brick manager applies when it is created.
import type { Pe } from '../../formats/exe.ts';
import type { World } from '../../game/world.ts';
import { tryCtx } from '../../island/ctx.ts';
import { islandBrickFx } from '../../fx/bricks/island.ts';
import { NO_SLOT } from '../../fx/bricks/manager.ts';
import { VehicleLooks, looksOf, LOOKS_KEY, VARIANT_VEHICLE, ROSTER_STRIDE, decorSetsOf, applyDecorSets } from '../../island/vehicles/looks.ts';
import { DecorState, decorModel, decorStore } from '../../island/decor.ts';
import type { DecorHost } from '../../island/decor.ts';
import { readDecorSetGroups } from '../../island/decorsets.ts';
import { decorGroupOfZone, defaultDecor, readDecorTables } from '../../shell/tables.ts';

/** the roster table of the castle (`FUN_005b2a00`: FUN_004202ef(&DAT_009031d0)) and its length-terminating record -1 */
export const CSI_ROSTER_VA = 0x9031d0;
/** FUN_005b2a23 = Control's constructor body (the brick effect of the speedboat is created in it); `FN_CONTROL_CTOR` is run in the emulation */
export const FN_CONTROL_CTOR = 0x5b2a23;
/** the list at 0x903230 (ends with -1): the records Control's constructor hides and draws in render mode 1 (FUN_00444550(rec, 0xff, 1)): the decor templates, the horse set, the board */
export const HIDDEN_LIST_VA = 0x903230;
/** the decor group of the castle (FUN_00421b18: zone 6 -> 1) */
export const CASTLE_DECOR_GROUP = 1;
/** the keys the island's modules look the state up under (src/island/vehicles/looks.ts, `decorOf`) */
const DECOR_KEY = 'island.decor', DECOR_SETS_KEY = 'island.decorsets';

/** the records of the hidden list, read from the executable */
export function readHiddenList(pe: Pe): number[] {
  const out: number[] = [];
  for (let va = HIDDEN_LIST_VA; (pe.u32(va) | 0) !== -1; va += 4) out.push(pe.u32(va) | 0);
  return out;
}

/**
 * FUN_005b2a23's record writes at the set-up: every record's variant word +0x64 := 0, the roster's vehicles 2 (set by the VehicleLooks constructor), the listed records `flags &= 0xfffd`
 * (the visibility: see `applyCsiSetup`; the render mode 1 of the same records is the set-up extraction's / `profile.setup.modes`). Then the brick effects of the roster by running the constructor tail in the emulation.
 */
export function constructCastleRoster(w: World, pe: Pe, run: (fn: number) => unknown): void {
  run(FN_CONTROL_CTOR);
  for (const r of w.records) r.variant = 0;
  // FUN_00420837(1): every record of the castle's decor group gets the DEFAULT word set << 8 | 1 | variant << 16 (the exe's table; the stored decor is applied later, by the wrapper's FUN_00421bbe(1))
  const dt = readDecorTables(pe), grp = dt.groups[decorGroupOfZone(6)];
  for (let i = grp.first; i < grp.first + grp.count; i++) {
    const e = dt.entries[i], r = w.records[e.record];
    if (r) r.variant = ((e.set << 8) | 1 | (e.variant << 16)) >>> 0;
  }
  applyDecorSets(w, pe);   // FUN_005b2a00 -> FUN_00420674(1): the decor sets' era table
  // the roster's vehicles (table 0x9031d0) are variant 2
  for (let va = CSI_ROSTER_VA; (pe.u32(va) | 0) !== -1; va += ROSTER_STRIDE) { const r = w.records[pe.u32(va) | 0]; if (r) r.variant = VARIANT_VEHICLE; }
  // (the hidden list's `flags &= 0xfffd` happens at the attach, in the middle of the set-up: `applyCsiSetup` resolves the final visibility from the set-up's own flag writes in execution order)
}

/** the roster + decor of the world, built at the first pre-render of Control (the records and the brick library exist then) */
export function ensureCsiLooks(w: World): VehicleLooks | null {
  const have = looksOf(w);
  if (have) return have;
  const c = tryCtx(w);
  if (!c?.setup) return null;
  const fx = islandBrickFx(w);
  // FUN_00420837(1) + FUN_005b2a00's FUN_00420674: the decor sets' era table, then the sets' entries resolved against the castle's models
  const baatat = !!c.baatat?.();
  let ds = decorSetsOf(w);
  if (!ds) { w.ext.set(DECOR_SETS_KEY, { groups: readDecorSetGroups(c.pe), baatat }); applyDecorSets(w, c.pe); ds = decorSetsOf(w); }
  const R = c.decorRender;
  const host: DecorHost = {
    records: w.records,
    model: (g, i) => (c.scene ? decorModel(c.scene, g, i) : null),
    sfx: (id) => c.sfx(id),
    setModel: (r, m) => { r.model = m; if (R) R.setModel(r, m); },
    setAttach: (r, slot, bone, child) => R?.setAttach(r, slot, bone, child),
    attachLocal: (r, slot, m) => R?.attachLocal(r, slot, m),
    shiny: (m) => R?.shiny(m),
  };
  if (ds) {
    const st = new DecorState(c.pe, host, ds.groups);
    st.resolve();
    w.ext.set(DECOR_KEY, st);
    if (!decorStore.blob) decorStore.blob = defaultDecor(c.pe);   // FUN_00420837: DAT_008adbf0 (a new game) copies the defaults into the stored decor
    st.applyStored(c.pe, decorGroupOfZone(6), decorStore.blob);   // FUN_00421bbe(1)
  }
  // FUN_004202ef(0x9031d0): the roster; the brick effect of each entry is the slot the emulated constructor registered (the emulated table's +0x14 handle -> the manager's slot)
  const looks = new VehicleLooks(w, c.pe, (n) => {
    const h = c.setup.mem.u32(CSI_ROSTER_VA + n * ROSTER_STRIDE + 0x14) | 0;
    const s = fx?.setupSlots.get(h);
    return s === undefined ? NO_SLOT : s;
  }, CSI_ROSTER_VA);
  w.ext.set(LOOKS_KEY, looks);
  return looks;
}

/**
 * The tail of Control's loader FUN_0057a53b = FUN_005b2a00: FUN_00420674(1) (the decor sets' era table from the CURRENT story node / trophy variables) and FUN_004202ef(0x9031d0) (the roster: per
 * entry the stored look of its game variable applied to the cycler, FUN_004439f0(cycler, v & 0xff, v >> 8); the busy list cleared). The port builds the roster lazily (`ensureCsiLooks`, which reads
 * the variables when it is created): a roster that exists already is brought to the same state here, one that does not exist yet needs nothing (it reads the loaded variables later).
 */
export function reloadCsiRoster(w: World): void {
  const c = tryCtx(w);
  if (!c) return;
  if (decorSetsOf(w)) applyDecorSets(w, c.pe);                 // FUN_00420674
  const looks = looksOf(w);
  if (!looks) return;
  for (const e of looks.entries) {                              // FUN_004202ef
    if (e.varIdx === -1) continue;
    const v = w.vars.get(e.varIdx) | 0;
    e.part = v & 0xff; e.variant = v >> 8;
  }
  looks.busy.fill(-1);
}
export { VARIANT_VEHICLE };
