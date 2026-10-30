// The vehicles' "change the look" (Enter), the model-variant cycler of SwapText.c and the vehicle roster of PepSwitc (docs/re/m4/wp6-vehicles.md, gaps.md S2).
//
// Original (LE2.c): PepSwitc's pre-render FUN_004bb67d starts with `if (DAT_00983840 & 0x10000) FUN_0051db5c(Pepper); FUN_0051dbd7(Pepper);`.
//   FUN_0051db5c  nearest record (FUN_004201f0: record variant word +0x64 != 0, not Pepper, record flag 1 = in the view frustum, squared distance < 800) ->
//                 variant & 0xff == 1: FUN_00420bb7 (an outfit / decor swap of a minifig or a decor model, NOT ported: docs) ; variant == 2: FUN_00420570 -> FUN_00420404
//   FUN_00420404  plays DAT_009da5b0 (sound 0x2c0); the roster entry (table 0x8e9b28, 0x18 bytes: record, record pointer, cycler handle, SwapText set, game variable, brick
//                 effect handle) of the record: not while the record has flag 0x8000, not while the entry is in the busy list DAT_009da590 (8 slots); the cycler goes to the
//                 next look (FUN_00443b00) and applies it (FUN_004439f0); the game variable := part + variant * 256 (FUN_00417597); the record gets flags |= 0x8020 and the entry
//                 a busy slot. The brick effect of the entry (FX_Bricks, src/fx/bricks) sees the variable change and morphs the vehicle from the old look's brick model into
//                 the new one (speedboat00.txt ...), clears 0x8000 and shows the record again when it is done.
//   FUN_0051dbd7  every tick: FUN_00420590 frees the busy slots whose brick effect is idle again (FUN_00447e60 == 2): flags &= 0x7fdf, then FUN_00420dc4 (the decor animation).
//   FUN_004202ef  (FUN_0051c800, from FUN_0051c823 = PepSwitc's constructor): per entry the record pointer, the cycler FUN_00443810(set, model) and the stored look
//                 FUN_004439f0(cycler, var & 0xff, var >> 8); the busy list is cleared to -1.
// A "look" is a record of the swap table at 0x8b5028 (24 bytes: nParts, parts*, nExtra, nVariants, extra*, loaded); the cycler's group = the consecutive records from the entry's set
// while nParts > 0. Part j of a record (12 bytes: handle, n, list*) replaces the texture table of the model's LOD part j: group g of the mesh uses SwapText texture list[g]
// (FUN_00443810 subtracts DAT_008b5718, the size of the SwapText bank, from the list and the texture group adds the bank's base again; list == 0 keeps the model's own table, so
// look 0 of every set is the original paint). All tables are read from the executable at run time.
import type { Pe } from '../../formats/exe.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { B } from '../../game/input.ts';
import { tryCtx } from '../ctx.ts';
import { inView } from '../npc/globals.ts';
import { islandBrickFx } from '../../fx/bricks/island.ts';
import { NO_SLOT } from '../../fx/bricks/manager.ts';
import { decorGroupOfZone, defaultDecor } from '../../shell/tables.ts';
import { applyDecorEra, readDecorSetGroups } from '../decorsets.ts';
import { DecorState, decorModel, decorStore } from '../decor.ts';
import type { DecorHost } from '../decor.ts';

export const LOOKS_KEY = 'island.looks';

/** the vehicle roster table (FUN_0051c823 / FUN_004202ef): 0x18 bytes per entry, ends with record -1 */
export const ROSTER_VA = 0x8e9b28, ROSTER_STRIDE = 0x18;
/** the swap table (SwapText.c): 0x18 bytes per record */
export const SWAP_VA = 0x8b5028, SWAP_STRIDE = 0x18;
/** DAT_009da590: the busy list (8 entries) */
export const BUSY_SLOTS = 8;
/** FUN_004201f0: the squared search radius */
export const NEAREST_R2 = 800.0;
/** DAT_009da5b0 = FUN_00443580(0x2c0) (FUN_004b0f16) */
export const LOOK_SOUND = 0x2c0;
/** record variant word +0x64 of a roster vehicle (FUN_0051c823: `= 2`) */
export const VARIANT_VEHICLE = 2;
/** flags FUN_00420404 sets and FUN_00420590 clears (0x7fdf) */
export const LOOK_FLAGS = 0x8020, LOOK_CLEAR = 0x7fdf;

/** a part of a look: the texture table of LOD part j (list = SwapText indices of the mesh groups, null = the model's own) */
export interface LookPart { n: number; list: number[] | null }
/** one record of the swap table */
export interface LookRecord { parts: LookPart[]; /** word 3: the number of variants of the look (0 in every set of the game) */ variants: number }
export interface RosterEntry {
  /** record index (+0x00) */
  rec: number;
  /** SwapText set (+0x0c): index of the first look record */
  set: number;
  /** game variable (+0x10) holding part + variant * 256, -1 none */
  varIdx: number;
  /** the group's look records */
  looks: LookRecord[];
  /** the cycler's state (handle +0x0c / +0x10): the current look and its variant */
  part: number; variant: number;
  /** the brick effect slot of the FX manager (the entry's +0x14), NO_SLOT when the roster has none for it */
  slot: number;
}

/** the swap table's records of the group that starts at `set` (FUN_00443810: while nParts > 0) */
export function readLookGroup(pe: Pe, set: number): LookRecord[] {
  const out: LookRecord[] = [];
  for (let va = SWAP_VA + set * SWAP_STRIDE; (pe.u32(va) | 0) > 0; va += SWAP_STRIDE) {
    const np = pe.u32(va) | 0, pp = pe.u32(va + 4);
    const parts: LookPart[] = [];
    for (let j = 0; j < np; j++) {
      const n = pe.u32(pp + j * 12 + 4) | 0, lp = pe.u32(pp + j * 12 + 8);
      let list: number[] | null = null;
      if (lp !== 0) { list = []; for (let k = 0; k < n; k++) list.push(pe.u32(lp + k * 4) | 0); }
      parts.push({ n, list });
    }
    out.push({ parts, variants: pe.u32(va + 12) | 0 });
  }
  return out;
}

/** FUN_00443b00: the cycler's next look: the variant, when it runs past the look's variant count the next look, wrapping to 0 after the last */
export function nextLook(e: Pick<RosterEntry, 'looks' | 'part' | 'variant'>): void {
  const v = e.variant + 1;
  e.variant = v;
  if ((e.looks[e.part]?.variants ?? 0) <= v) {
    e.variant = 0;
    e.part += 1;
    if (e.looks.length <= e.part) e.part = 0;
  }
}

/** the game variable the entry stores: part + variant * 256 (FUN_00420404) */
export const lookWord = (e: Pick<RosterEntry, 'part' | 'variant'>): number => e.part + e.variant * 0x100;

export class VehicleLooks {
  readonly entries: RosterEntry[] = [];
  /** DAT_009da590: the entries whose look change is still running (index into `entries`), -1 free */
  readonly busy: number[] = new Array(BUSY_SLOTS).fill(-1);
  /** a record variant word of 1 (an outfit / decor swap, FUN_00420bb7) was the nearest: the call is not ported, the count is for the tests and the docs */
  unportedNearest = 0;

  /** FUN_004202ef: the roster of the executable, the stored looks applied */
  constructor(w: World, pe: Pe, brickSlot: (entry: number) => number, rosterVa: number = ROSTER_VA) {
    for (let c = 0; ; c++) {
      const va = rosterVa + c * ROSTER_STRIDE;
      const rec = pe.u32(va) | 0;
      if (rec === -1) break;
      const e: RosterEntry = {
        rec, set: pe.u32(va + 0xc) | 0, varIdx: pe.u32(va + 0x10) | 0, looks: readLookGroup(pe, pe.u32(va + 0xc) | 0), part: 0, variant: 0, slot: brickSlot(c),
      };
      this.entries.push(e);
      if (e.varIdx !== -1) {
        const v = w.vars.get(e.varIdx);
        // FUN_004439f0(cycler, v & 0xff, v >> 8)
        e.part = v & 0xff; e.variant = v >> 8;
      }
      const r = w.records[rec];
      if (r) r.variant = VARIANT_VEHICLE;    // FUN_0051c823
    }
  }

  /**
   * FUN_004202ef on a roster that already exists (PepSwitc's loader, FUN_0051c800, after the saved variables are back): every entry whose game variable is not -1 gets its stored look
   * (FUN_004439f0(cycler, var & 0xff, var >> 8): part and variant, whatever the values), the cyclers themselves stay; the busy list is cleared to -1
   */
  reapply(w: World): void {
    for (const e of this.entries) {
      if (e.varIdx === -1) continue;
      const v = w.vars.get(e.varIdx);
      e.part = v & 0xff; e.variant = v >> 8;
    }
    this.busy.fill(-1);
  }

  entryOf(rec: GameRecord): number { return this.entries.findIndex((e) => e.rec === rec.index); }

  /** the texture table of the record's LOD part (null: the model's own) */
  textures(rec: GameRecord, lod: number): readonly number[] | null {
    const c = this.entryOf(rec);
    if (c < 0) return null;
    const e = this.entries[c];
    return e.looks[e.part]?.parts[lod]?.list ?? null;
  }
}

/** the records FUN_0051c823 hides (list 0x8e9c30, ends with -1): the decor models' templates (BS00 .. FL00, TRGO / TRSI / TRBR, OPL0 .. 2) */
export const HIDDEN_LIST_VA = 0x8e9c30;
/**
 * FUN_0051c823's record writes (PepSwitc's constructor, at set-up): every record's variant word +0x64 := 0 (then the decor entries get type 1 from FUN_00420837, the roster vehicles 2),
 * the records of the list 0x8e9c30 get render mode 1 (FUN_00444550(rec, 0xff, 1): R4) and `flags &= 0xfffd` (hidden). The set-up emulation drops these writes, so the
 * port makes them here (gaps S11: these records were drawn under the origin before).
 */
export function applyRosterRecords(w: World, pe: Pe): void {
  for (const r of w.records) if (r) r.variant = 0;
  applyDecorSets(w, pe);   // FUN_0051c800: FUN_00420674 first
  for (let va = HIDDEN_LIST_VA; ; va += 4) {
    const i = pe.u32(va) | 0;
    if (i === -1) break;
    const r = w.records[i];
    if (r) r.flags &= ~0x2;
  }
  // FUN_00420837(0) (called by FUN_0051c823): the island's decor group, 147 decor models + 29 minifig outfit entries: variant word = set << 8 | 1 | variant << 16 (type 1:
  // Enter would swap the outfit / decor model, FUN_00420bb7: not ported, but these records are what `nearestLookRecord` finds before a farther vehicle)
  startDecor(w, pe);
  for (let va = ROSTER_VA; (pe.u32(va) | 0) !== -1; va += ROSTER_STRIDE) { const r = w.records[pe.u32(va) | 0]; if (r) r.variant = VARIANT_VEHICLE; }
}

const DECOR_KEY = 'island.decor';
export function decorOf(w: World): DecorState | null { return (w.ext.get(DECOR_KEY) as DecorState | undefined) ?? null; }
/** FUN_00420837 (the resolution of the sets' entries) + FUN_00421bbe(-1) (the stored decor applied to the zone's decor records) */
function startDecor(w: World, pe: Pe): void {
  const c = tryCtx(w), ds = decorSetsOf(w);
  if (!ds) return;
  const R = c?.decorRender;
  const host: DecorHost = {
    records: w.records,
    model: (g, i) => (c?.scene ? decorModel(c.scene, g, i) : null),
    sfx: (id) => c?.sfx(id),
    setModel: (r, m) => { r.model = m; if (R) R.setModel(r, m); },
    setAttach: (r, slot, bone, child) => R?.setAttach(r, slot, bone, child),
    attachLocal: (r, slot, m) => R?.attachLocal(r, slot, m),
    shiny: (m) => R?.shiny(m),
  };
  const st = new DecorState(pe, host, ds.groups);
  st.resolve();
  w.ext.set(DECOR_KEY, st);
  if (!decorStore.blob) decorStore.blob = defaultDecor(pe);   // FUN_00420837: DAT_008adbf0 (a new game) copies the defaults into the stored decor
  st.applyStored(pe, decorGroupOfZone(2), decorStore.blob);
}

/** the decor model sets' groups (0x8acb98 +0) as FUN_00420674 left them, and the BAATAT state they were made for */
export interface DecorSets { groups: number[]; baatat: boolean }
const DECOR_SETS_KEY = 'island.decorsets';
export function decorSetsOf(w: World): DecorSets | null { return (w.ext.get(DECOR_SETS_KEY) as DecorSets | undefined) ?? null; }
/** FUN_00420674: at the island's set-up (FUN_0051c800) and again whenever the BAATAT cheat (`IslandCtx.baatat`, DAT_009da5b4) is typed (the cheat calls it at once) */
export function applyDecorSets(w: World, pe: Pe): void {
  const baatat = !!tryCtx(w)?.baatat?.();
  const have = decorSetsOf(w);
  const groups = have ? have.groups : readDecorSetGroups(pe);
  applyDecorEra(pe, groups, (v) => w.vars.get(v) | 0, baatat);
  w.ext.set(DECOR_SETS_KEY, { groups, baatat } satisfies DecorSets);
}

/** FUN_0051c800, what PepSwitc's loader (FUN_004bbeba) runs after its 16 byte memcpy: FUN_00420674(0) (the decor sets' era table) and FUN_004202ef (the stored looks, the busy list) */
export function restoreLooks(w: World): void {
  const c = tryCtx(w);
  if (c) applyDecorSets(w, c.pe);
  looksOf(w)?.reapply(w);
}

export function looksOf(w: World): VehicleLooks | null { return (w.ext.get(LOOKS_KEY) as VehicleLooks | undefined) ?? null; }

/**
 * The roster of the world (FUN_0051c823 runs in PepSwitc's constructor; the port builds it at the first pre-render, when the records and the brick effects exist).
 * The brick effect of an entry is the slot the emulated roster registered (the emulated table's +0x14 handle -> the manager's slot).
 */
export function ensureLooks(w: World): VehicleLooks | null {
  const have = looksOf(w);
  if (have) return have;
  const c = tryCtx(w);
  if (!c) return null;
  const fx = islandBrickFx(w);
  applyRosterRecords(w, c.pe);
  const looks = new VehicleLooks(w, c.pe, (n) => {
    const h = c.setup.mem.u32(ROSTER_VA + n * ROSTER_STRIDE + 0x14) | 0;
    const s = fx?.setupSlots.get(h);
    return s === undefined ? NO_SLOT : s;
  });
  w.ext.set(LOOKS_KEY, looks);
  return looks;
}

/** FUN_004201f0: the nearest record with a variant word, in the view, within sqrt(800); -1 none */
export function nearestLookRecord(w: World, pepper: GameRecord): number {
  let best = -1, bestD = NEAREST_R2;
  for (let i = 0; i < w.records.length; i++) {
    const r = w.records[i];
    if (!r || r.variant === 0 || r === pepper) continue;
    if (!inView(w, r)) continue;
    const dx = r.x - pepper.x, dy = r.y - pepper.y, dz = r.z - pepper.z;
    const d = dz * dz + dy * dy + dx * dx;
    if (d < bestD) { best = i; bestD = d; }
  }
  return best;
}

/** FUN_00420404(roster, rec) on its parts: `sfx` = FUN_004435a0(DAT_009da5b0), `setVar` = FUN_00417597 */
export function changeLookWith(looks: VehicleLooks, rec: { index: number; flags: number }, sfx: (id: number) => void, setVar: (i: number, v: number) => void): void {
  sfx(LOOK_SOUND);
  for (let c = 0; c < looks.entries.length; c++) {
    const e = looks.entries[c];
    if (e.rec !== rec.index) continue;
    if ((rec.flags & 0x8000) !== 0) return;
    if (looks.busy.includes(c)) return;
    nextLook(e);
    if (e.varIdx !== -1) setVar(e.varIdx, lookWord(e));
    // (the original writes the variable whatever its index: the roster of the game has one for every entry)
    if (e.slot !== NO_SLOT) {
      const k = looks.busy.indexOf(-1);
      if (k >= 0) { rec.flags |= LOOK_FLAGS; looks.busy[k] = c; }
    }
  }
}
export function changeLook(w: World, looks: VehicleLooks, rec: GameRecord): void {
  changeLookWith(looks, rec, (id) => tryCtx(w)?.sfx(id), (i, v) => w.vars.set(i, v));
}

/** FUN_0051db5c(Pepper) */
export function lookKey(w: World, pepper: GameRecord): void {
  const looks = looksOf(w);
  if (!looks) return;
  const i = nearestLookRecord(w, pepper);
  if (i === -1) return;
  const r = w.records[i];
  if ((r.variant & 0xff) === 1) decorOf(w)?.enter(r.index);   // FUN_00420bb7: the outfit / decor swap
  if (r.variant === VARIANT_VEHICLE) changeLook(w, looks, r);
}

/** FUN_00420590 on its parts: `state` = FUN_00447e60(brick effect of the slot) */
export function tickLooksWith(looks: VehicleLooks, record: (i: number) => { flags: number } | undefined | null, state: (slot: number) => number): void {
  for (let k = 0; k < BUSY_SLOTS; k++) {
    const c = looks.busy[k];
    if (c < 0) continue;
    const e = looks.entries[c];
    if (state(e.slot) === 2) {
      const r = record(e.rec);
      if (r) r.flags &= LOOK_CLEAR;
      looks.busy[k] = -1;
    }
  }
}
/** FUN_00420590: the busy entries whose brick effect is idle again (FUN_00447e60 == 2) release their record */
export function tickLooks(w: World): void {
  const c = tryCtx(w), ds = decorSetsOf(w);
  if (c && ds && ds.baatat !== !!c.baatat?.()) applyDecorSets(w, c.pe);   // the BAATAT cheat was typed: FUN_00420674 runs again
  const looks = looksOf(w);
  if (!looks) return;
  const fx = islandBrickFx(w);
  tickLooksWith(looks, (i) => w.records[i], (slot) => (fx ? fx.state(slot) : 2));
  if (w.focus) decorOf(w)?.tick(w.focus);   // FUN_00420dc4
}

/** PepSwitc's pre-render top (FUN_004bb67d): Enter, then the every-tick part */
export function lookPrerender(w: World, pepper: GameRecord): void {
  if (!ensureLooks(w)) return;
  if ((w.input.pressed & B.ENTER) !== 0) lookKey(w, pepper);
  tickLooks(w);
}
