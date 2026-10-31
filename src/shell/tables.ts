// Shell tables that live in the executable's .data/.rdata and are read at run time (nothing here is committed data).
// See docs/re/shell-m2.md for the address map. All addresses are virtual addresses of "LEGO eiland 2.exe" (image base 0x400000).
import type { Pe } from '../formats/exe.ts';

/** zone table: 35 records of 20 bytes { u32 run fn (0 = no code), u32 kind, char name[8], u32 0 } (FUN_00404dc9, zones.py) */
export const ZONE_TABLE_VA = 0x89a9c0;
export const ZONE_COUNT = 35;
/** story FSM table: 72 records of 8 bytes { s16 zone index, s16 var, s16 mask, s16 value } (FUN_00404aa0 / FUN_00404be7) */
export const STORY_TABLE_VA = 0x89a758;
export const STORY_NODE_COUNT = 72;
/** a pointer CELL (PTR_DAT_008a95f4) that holds the address of the menu page table (the cell contains 0x8a9338) */
export const MENU_PAGES_PTR_VA = 0x8a95f4;
/** the menu page table itself: 30 records of 20 bytes { kind, nitems, items*, setupfn, type }; it ends at 0x8a9590 (the engine's current-page global) */
export const MENU_PAGES_VA = 0x8a9338;
export const MENU_PAGE_COUNT = 30;
export const MENU_ITEM_SIZE = 0x4c;
/** save-slot captions: 71 strings of 12 bytes "FSMSTATEnn" indexed by the FSM node (FUN_0041ac0e) */
export const FSM_CAPTIONS_VA = 0x8a5448;
/** Pepper's-house mini-game replay list (page 24 "PPHSUBGAME", setup FUN_0041b12d): 19 records of 0x30 bytes */
export const REPLAY_TABLE_VA = 0x8a57f0;
export const REPLAY_COUNT = 0x13;
/** "story checkpoint" list (page 17, setup FUN_0041b227; the 0x8a5c88 of the notes is the zone field of record 0): 36 records of 0x2c bytes */
export const CHECKPOINT_TABLE_VA = 0x8a5c68;
/** the set-up function returns `0x24 - index` = the entries that FOLLOW entry `index`, so the list has 0x25 = 37 entries (record 36 = the last island era, node 68); the earlier notes said 36 */
export const CHECKPOINT_COUNT = 0x25;
/** "all zones" debug list (page 26, setup FUN_0041b274; the 0x8a62e8 of the notes is the zone field of record 1): 25 records of 0x2c bytes */
export const ALLZONES_TABLE_VA = 0x8a62c8;
/** `0x19 - index` in FUN_0041b274: 26 entries (record 25 = z42BRP is the last real one) */
export const ALLZONES_COUNT = 0x1a;
/** sound test list (page 23, setup FUN_0041b0d2): count at 0x8a5c64, pairs of char* {music key, label id} at 0x8a5bb0 */
export const SOUNDTEST_TABLE_VA = 0x8a5bb0;
export const SOUNDTEST_COUNT_VA = 0x8a5c64;
/** per-era building/outfit "decor" table (FUN_00421fa0 / FUN_00421b18 / FUN_00421bbe): groups at 0x8acdc0 {first,count}, entries (8 bytes) at 0x8acdf0 */
export const DECOR_GROUPS_VA = 0x8acdc0;
export const DECOR_ENTRIES_VA = 0x8acdf0;
export const DECOR_ENTRY_COUNT = 0x1c0;
export const DECOR_GROUP_COUNT = 6;
/** initial values of the 319 game variables (.data, FUN_00417575 base) */
export const GAMEVARS_VA = 0x8a2d2c;

export interface ZoneInfo {
  index: number;
  /** VA of the zone run function, 0 for the two empty (cut) zones */
  runAt: number;
  /** 1 = hub / rewind target, see architecture.md 2.1 */
  kind: number;
  /** internal id as in the table, e.g. 'z90PSX' */
  id: string;
  /** archive (.bob/.bod) name that holds the zone, null for zones without code */
  archive: string | null;
  hasRun: boolean;
}

/** internal id -> archive name when they differ (architecture.md 2.1) */
export const ZONE_ARCHIVE_ALIAS: Record<string, string> = {
  z00FRE: 'z60FRE', z90PSX: 'z02LGI', z91PSX: 'z02LGI', z92PSX: 'z02LGI', z93PSX: 'z02LGI', z90CAS: 'z07CSI', z90ADV: 'z13CAI',
  z90OSD: 'z14OSD', z90PYA: 'z16PYA', z90DIP: 'z23DIP', z90OGL: 'z40OGL', z40APO: 'z40aPO',
};
export function zoneArchive(id: string): string { return ZONE_ARCHIVE_ALIAS[id] ?? id; }

export function readZoneTable(pe: Pe): ZoneInfo[] {
  const out: ZoneInfo[] = [];
  for (let i = 0; i < ZONE_COUNT; i++) {
    const at = ZONE_TABLE_VA + i * 20;
    const runAt = pe.u32(at);
    const id = pe.cstr(at + 8, 8);
    out.push({ index: i, runAt, kind: pe.u32(at + 4), id, archive: runAt ? zoneArchive(id) : null, hasRun: runAt !== 0 });
  }
  return out;
}

export interface StoryNode {
  index: number;
  /** zone table index */
  zone: number;
  /** game variable tested */
  var: number;
  /** sign-extended s16 as the original compares it: node is complete when (var & mask) === value */
  mask: number;
  value: number;
}

function s16(pe: Pe, va: number): number { const v = pe.u32(va) & 0xffff; return v & 0x8000 ? v - 0x10000 : v; }

export function readStoryFsm(pe: Pe): StoryNode[] {
  const out: StoryNode[] = [];
  for (let i = 0; i < STORY_NODE_COUNT; i++) {
    const at = STORY_TABLE_VA + i * 8;
    out.push({ index: i, zone: s16(pe, at), var: s16(pe, at + 2), mask: s16(pe, at + 4), value: s16(pe, at + 6) });
  }
  return out;
}

export interface MenuItem {
  /** label; '!ID' = message id of FRONTEND.str / PAUSE.str, otherwise literal text */
  label: string;
  /** 0 title, 1 goto page (id = page), 2 back, 3 (yes/no confirm entry), 4 action (id = action, FUN_0041b500 case 4), 5 toggle (id = current value), 6 slider, 7 key binding, 9 list item, 10 (credits/pause text) */
  type: number;
  id: number;
  /** disable mask: 0x20 = greyed out, 0x40 / 0x80 = hidden by the pause wrapper (FUN_0041bd3d mask) */
  mask: number;
}
export interface MenuPage {
  index: number;
  /** 0 static items, 1 = dynamic list: item 1 is a template repeated by `setupFn` until it returns < 0 */
  kind: number;
  nitems: number;
  /** VA of the items array (0x4c bytes each) */
  itemsAt: number;
  /** VA of the setup function (0 = none) */
  setupFn: number;
  /** page style (0 plain, 1 list, 2 dialog) */
  type: number;
  items: MenuItem[];
  /**
   * The type words of the first 8 item slots of the page's item array, read as the original's page renderer reads them: its panel-width loop over the 8 list entries takes the TYPE of the entry from
   * item slot j of the page (`piVar2[2] + 0x40 + j * 0x4c`), not from the entry; slots beyond the page's own items read whatever lies behind the array in `.data` (the next page's items).
   */
  slotTypes: number[];
}

export function readMenuPages(pe: Pe): MenuPage[] {
  let base = pe.u32(MENU_PAGES_PTR_VA);
  if (!base) base = MENU_PAGES_VA;
  const out: MenuPage[] = [];
  for (let i = 0; i < MENU_PAGE_COUNT; i++) {
    const at = base + i * 20;
    const kind = pe.u32(at), nitems = pe.u32(at + 4), itemsAt = pe.u32(at + 8), setupFn = pe.u32(at + 12), type = pe.u32(at + 16);
    const items: MenuItem[] = [];
    for (let j = 0; j < nitems; j++) {
      const it = itemsAt + j * MENU_ITEM_SIZE;
      items.push({ label: pe.cstr(it, 0x40), type: pe.u32(it + 0x40), id: pe.u32(it + 0x44) | 0, mask: pe.u32(it + 0x48) | 0 });
    }
    const slotTypes = Array.from({ length: 8 }, (_, j) => pe.u32(itemsAt + j * MENU_ITEM_SIZE + 0x40) | 0);
    out.push({ index: i, kind, nitems, itemsAt, setupFn, type, items, slotTypes });
  }
  return out;
}

/** FSM node -> `FSMSTATEnn` message id of FRONTEND.str (save-slot caption, FUN_0041ac0e). 71 entries (nodes 0..70); node 71 has none. */
export function readFsmCaptions(pe: Pe): string[] {
  const out: string[] = [];
  for (let i = 0; i < 80; i++) {
    const s = pe.cstr(FSM_CAPTIONS_VA + i * 12, 12);
    if (!/^FSMSTATE\d\d$/.test(s)) break;
    out.push(s);
  }
  return out;
}

export interface ReplayEntry {
  index: number;
  /** '!LEVxxx' message id */
  label: string;
  /** zone table index (written to var 5) */
  zone: number;
  /** default disable mask (overwritten by `replayEnabled`) */
  mask: number;
  /** game var that must be non-zero to unlock the entry (-1 = special rule) */
  gateVar: number;
  /** FSM node to jump to (-1 = none; all 19 shipped entries have -1) */
  node: number;
}
export interface LevelEntry {
  index: number;
  label: string;
  zone: number;
  mask: number;
  /** FSM node (-1 = none) */
  node: number;
}
export interface SoundTestEntry { index: number; musicKey: string; label: string }
export interface LevelSelect {
  /** page 24 (Pepper's house computer, "mini-game replays"): the one that is reachable in the shipped game */
  replays: ReplayEntry[];
  /** page 17, story checkpoints (the Debug Mode list of the LI2 Mod Manager, 37) */
  checkpoints: LevelEntry[];
  /** page 26, every zone (debug list, 26) */
  allZones: LevelEntry[];
  /** page 23, sound test (22) */
  sounds: SoundTestEntry[];
}

function sdword(pe: Pe, va: number): number { return pe.u32(va) | 0; }

export function readLevelSelect(pe: Pe): LevelSelect {
  const replays: ReplayEntry[] = [];
  for (let i = 0; i < REPLAY_COUNT; i++) {
    const at = REPLAY_TABLE_VA + i * 0x30;
    replays.push({ index: i, label: pe.cstr(at, 0x20), zone: sdword(pe, at + 0x20), mask: sdword(pe, at + 0x24), gateVar: sdword(pe, at + 0x28), node: sdword(pe, at + 0x2c) });
  }
  const lev = (base: number, n: number): LevelEntry[] => {
    const o: LevelEntry[] = [];
    for (let i = 0; i < n; i++) {
      const at = base + i * 0x2c;
      o.push({ index: i, label: pe.cstr(at, 0x20), zone: sdword(pe, at + 0x20), mask: sdword(pe, at + 0x24), node: sdword(pe, at + 0x28) });
    }
    return o;
  };
  const sounds: SoundTestEntry[] = [];
  const nsound = pe.u32(SOUNDTEST_COUNT_VA);
  for (let i = 0; i < nsound && i < 64; i++) {
    sounds.push({ index: i, musicKey: pe.cstr(pe.u32(SOUNDTEST_TABLE_VA + i * 8)), label: pe.cstr(pe.u32(SOUNDTEST_TABLE_VA + i * 8 + 4)) });
  }
  return { replays, checkpoints: lev(CHECKPOINT_TABLE_VA, CHECKPOINT_COUNT), allZones: lev(ALLZONES_TABLE_VA, ALLZONES_COUNT), sounds };
}

/**
 * Setup of the replay list item `index` (FUN_0041b12d): returns the item's disable mask (0 = enabled, 0x20 = greyed out).
 * `get(i)` reads a game variable; `fsmNode` = var 0x58.
 */
export function replayEnabled(e: ReplayEntry, get: (i: number) => number): boolean {
  const node = get(0x58);
  if (e.gateVar === -1) return e.index === 1 && (node < 7 || node > 10);
  if (e.index === 0 && (node < 7 || node > 0x33)) return true;
  return get(e.gateVar) !== 0;
}

/** (var 0x4d PPH_MENU_INTERNALS) packed by the replay start (FUN_0041b9b1 case 0x18): page, item, scroll offset, previous subgame as signed chars */
export function packMenuInternals(page: number, item: number, offset: number, prevSubgame: number): number {
  const sc = (v: number) => (v << 24) >> 24;
  return ((page & 0x7f) | 0x80 | (sc(item) << 8) | (sc(offset) << 16) | (sc(prevSubgame) << 24)) | 0;
}

/** decor ("building / outfit phase") tables: `groups[era] = {first,count}` into `entries`, whose default (set, variant) bytes are in the EXE */
export interface DecorTables {
  groups: { first: number; count: number }[];
  /** per entry: record index (+0), default set (+4), default variant (+5), 8 bytes each */
  entries: { record: number; set: number; variant: number }[];
}
export function readDecorTables(pe: Pe): DecorTables {
  const groups = [];
  for (let i = 0; i < DECOR_GROUP_COUNT; i++) groups.push({ first: pe.u32(DECOR_GROUPS_VA + i * 8), count: pe.u32(DECOR_GROUPS_VA + i * 8 + 4) });
  const entries = [];
  for (let i = 0; i < DECOR_ENTRY_COUNT; i++) {
    const at = DECOR_ENTRIES_VA + i * 8;
    entries.push({ record: pe.u32(at), set: pe.u32(at + 4) & 0xff, variant: (pe.u32(at + 4) >> 8) & 0xff });
  }
  return { groups, entries };
}
/** the decor blob a new game starts with (FUN_00421fa0(1)): 0x1c0 x (set, variant) bytes */
export function defaultDecor(pe: Pe): Uint8Array {
  const t = readDecorTables(pe), out = new Uint8Array(DECOR_ENTRY_COUNT * 2);
  for (let i = 0; i < DECOR_ENTRY_COUNT; i++) { out[i * 2] = t.entries[i].set; out[i * 2 + 1] = t.entries[i].variant; }
  return out;
}
/** FUN_00421b18: decor group of the current zone (var 0x59), -2 = none */
export function decorGroupOfZone(zone: number): number {
  switch (zone) {
    case 2: case 0x1f: case 0x20: case 0x21: return 0;
    case 6: return 1;
    case 0xb: return 2;
    case 0xd: return 3;
    case 0x13: return 4;
    case 0x1b: return 5;
    default: return -2;
  }
}

/** the initial values of the 319 game variables as compiled into .data (the original snapshots them into _data\sw.dat at launch) */
export function readInitialVars(pe: Pe): Int32Array {
  const a = new Int32Array(319);
  for (let i = 0; i < 319; i++) a[i] = pe.u32(GAMEVARS_VA + i * 4) | 0;
  return a;
}
