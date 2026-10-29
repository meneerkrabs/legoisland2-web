// The decor / outfit swap and the look roster of hub 5 (Ogel's island), PEPPSWIT's constructor FUN_00811413 and the tail of its pre-render (docs/re/m5/z40OGL-peppswit.md):
//   FUN_00811413 (ctor): every record's variant word (+0x64) := 0; the records of the list 0x9559f8 (PN00 .. TRBR, the decor models' templates: 18 records from 104) get render mode 1
//   (FUN_00444550(rec, 0xff, 1)) and `flags &= ~2`; FUN_00420837(5): the decor group 5 (13 records: MAMA / PAPA outfits and the crystals G002 .. G010, KKKK) gets the variant word
//   set << 8 | 1 | variant << 16; FUN_008113f0: FUN_00420674 (the decor sets' era table) + FUN_004202ef(roster 0x9559d8): the roster is EMPTY here (first record -1).
//   FUN_0081152d (Enter): FUN_004201f0 (the nearest record with a variant word) -> type 1: FUN_00420bb7 (the swap), type 2 (a roster vehicle): FUN_00420570; FUN_008115c2 (every tick):
//   FUN_00420590 + FUN_00420dc4. These are the island's generic modules (src/island/vehicles/looks.ts, src/island/decor.ts), here with the tables of hub 5.
import type { World } from '../../../game/world.ts';
import { tryCtx } from '../../../island/ctx.ts';
import { DecorState, decorModel, decorStore } from '../../../island/decor.ts';
import type { DecorHost } from '../../../island/decor.ts';
import { VehicleLooks, LOOKS_KEY, decorSetsOf, applyDecorSets, looksOf, lookKey, tickLooks } from '../../../island/vehicles/looks.ts';
import { islandBrickFx } from '../../../fx/bricks/island.ts';
import { NO_SLOT } from '../../../fx/bricks/manager.ts';
import { ROSTER_STRIDE } from '../../../island/vehicles/looks.ts';
import { decorGroupOfZone, defaultDecor } from '../../../shell/tables.ts';
import type { Pe } from '../../../formats/exe.ts';
import type { GameRecord } from '../../../game/record.ts';

/** the roster (FUN_004202ef(&DAT_009559d8)) and the hidden list (DAT_009559f8, ends with -1) of hub 5 */
export const OGL_ROSTER_VA = 0x9559d8, OGL_HIDDEN_VA = 0x9559f8;
/** the zone table index of z90OGL (var 0x59): FUN_00420837(5) = decor group 5 */
const ZONE_INDEX = 0x1b;
const DECOR_KEY = 'island.decor', DECOR_SETS_KEY = 'island.decorsets';

export function hiddenList(pe: Pe): number[] {
  const out: number[] = [];
  for (let va = OGL_HIDDEN_VA; ; va += 4) { const i = pe.u32(va) | 0; if (i === -1) break; out.push(i); }
  return out;
}

/** FUN_00811413 */
export function decorInit(w: World): void {
  const c = tryCtx(w);
  if (!c) return;
  const pe = c.pe;
  for (const r of w.records) r.variant = 0;
  for (const i of hiddenList(pe)) { const r = w.records[i]; if (!r) continue; c.partMode?.(r, 0xff, 1); r.flags &= ~2; }
  // FUN_00420837(5): the decor group's variant words, the decor sets resolved against this zone's models
  applyDecorSets(w, pe);
  const ds = decorSetsOf(w);
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
    const st = new DecorState(pe, host, ds.groups);
    st.resolve();
    w.ext.set(DECOR_KEY, st);
    if (!decorStore.blob) decorStore.blob = defaultDecor(pe);
    st.applyStored(pe, decorGroupOfZone(ZONE_INDEX), decorStore.blob);
  }
  // FUN_004202ef(0x9559d8): an empty roster
  const fx = islandBrickFx(w);
  w.ext.set(LOOKS_KEY, new VehicleLooks(w, pe, (n) => {
    const s = fx?.setupSlots.get(c.setup.mem.r32(OGL_ROSTER_VA + n * ROSTER_STRIDE + 0x14) | 0);
    return s === undefined ? NO_SLOT : s;
  }, OGL_ROSTER_VA));
}
/** FUN_0081152d */
export function decorEnter(w: World, rec: GameRecord): void { if (looksOf(w)) lookKey(w, rec); }
/** FUN_008115c2 */
export function decorTick(w: World, _rec: GameRecord): void { void _rec; if (looksOf(w)) tickLooks(w); }
/** FUN_008115e9: frees the roster's brick effects (none) */
export function decorDestroy(_w: World): void { /* the roster is empty */ }
export { DECOR_SETS_KEY };
