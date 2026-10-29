// Zone set-up extracted from the executable at run time (docs/re/zone-setup.md). The zone's set-up function (the one that calls the zone's loader,
// FUN_004b6475 for the island, FUN_0053fb1f -> FUN_0053ea4d for Pepper's house ...) and every zone-local function it calls are interpreted with the
// extended symbolic interpreter of x86.ts; the calls and stores of the engine helpers that matter are collected into plain tables:
//   FUN_00423532 attach behaviour node   FUN_004427e0 / 004428b0 / 00442780 box colliders   FUN_00444550 part render modes
//   FUN_0045c397 cutscene slots          FUN_00424029 HUD hints                              FUN_004425e0 ground record
//   record flag / field writes (rec + 0x60, + 0x3c ...), stores into well-known globals (sea level 0x9da858, gravity 0x9da9bc, camera focus 0x9da5d8 ...)
// Entries that sit inside `if` arms carry the comparison (`cond`: a game variable / call result / record name); the island's set-up branches on the story
// FSM state (game var 0x58, FUN_004c3226 + the per-era functions). Pure (no DOM), nothing of the executable is stored in this file except addresses.
import type { Pe, ZoneScene } from './exe.ts';
import { decode, interpret } from './x86.ts';
import type { CallEv, Ev, Guard, StoreEv, Val } from './x86.ts';
import { extractRenderParams } from './zoneparams.ts';
import type { FogSetup } from './zoneparams.ts';

// ---------------------------------------------------------------------------------------------------
// addresses of the NL build (6,459,444 bytes)

/** engine helpers the set-up code calls */
export const FN = {
  GET_VAR: 0x417575, SET_VAR: 0x417597, ADD_VAR: 0x4175ca, OR_VAR: 0x41761b, ANDNOT_VAR: 0x41766c,
  /** (rec, ctor, arg, pos, var, mask, value): give the record a node (controller.ts attachNode) */
  ATTACH: 0x423532,
  /** (rec): create the record's controller */
  CREATE_CTRL: 0x42382c,
  /** (controller, flags): controller +0xc */
  SET_CTRL_FLAGS: 0x4238b7,
  /** (rec): collision object box = the box stored in the .col file */
  BOX_FILE: 0x4427e0,
  /** (rec, radius, height) */
  BOX_RADIUS_HEIGHT: 0x4428b0,
  /** (rec, x, y, z): half extents */
  BOX_DIMS: 0x442780,
  /** (rec, partMask, mode): per-part render mode */
  RENDER_MODE: 0x444550,
  /** (rec, on): FUN_004446c0 / FUN_00883013 switch every mesh of the record's model (and of its attached models) to vertex format 0x2c2 (specular): "shiny" */
  SHINY: 0x4446c0,
  /** (slot, name, messages): cutscene slot */
  CUTSCENE: 0x45c397,
  /** (index, a, b, c, d, scale): HUD hint icons */
  HUD_HINT: 0x424029,
  /** (rec): the record the terrain ray (FUN_004425f0) tests */
  GROUND: 0x4425e0,
  /** (near, farMin, farMax, fogFrac, colour, enable) */
  SETUP_FOG: 0x442d90,
  /** (map index, path without the `_C.wpt` suffix): load a compiled waypoint map */
  LOAD_WAYPOINTS: 0x4630c0,
  /** (map, node, dest): copy the position (3 floats) of a waypoint node to dest (a record's x / y / z, or a frame buffer) */
  WAYPOINT_POS: 0x462be9,
  /** CRT strncmp (the record-name tests of the set-up loops) */
  STRNCMP: 0x85e410,
} as const;

/** the blob shadow set-up (Shadow.c): FUN_00444850 initialises the shadows of the zone, FUN_00444ed0(record) registers a terrain record the shadows are ray-cast against */
export const SHADOW_INIT = 0x444850, SHADOW_REGISTER = 0x444ed0;

/** globals the set-up code stores into (name, address) */
export const GLOBALS = {
  /** DAT_009da858: y of the sea plane */
  SEA_LEVEL: 0x9da858,
  /** DAT_009da9bc: gravity */
  GRAVITY: 0x9da9bc,
  /** DAT_009da5d8: matrix pointer (record + 0xc) of the camera focus record */
  FOCUS: 0x9da5d8,
  /** DAT_009daa7c: record index of the skateboard (hidden while walking / swimming) */
  ACCESSORY: 0x9daa7c,
  /** DAT_008ae088: the walk node's state mailbox */
  WALK_MAILBOX: 0x8ae088,
  /** DAT_00983800 / DAT_00983804: record count / record array */
  RECORD_COUNT: 0x983800, RECORDS: 0x983804,
} as const;

export const RECORD_STRIDE = 0x68;
/** record fields (byte offsets inside the 0x68 byte record) */
export const RF = { NAME: 0, MODEL: 4, MATRIX: 0xc, X: 0x3c, Y: 0x40, Z: 0x44, EULER: 0x4c, COL: 0x58, CTRL: 0x5c, FLAGS: 0x60, VARIANT: 0x64 } as const;
/** the zone table: 35 records of 20 bytes { run fn, kind, char name[8], 0 } */
export const ZONE_TABLE = 0x89a9c0, ZONE_TABLE_COUNT = 35;
/** the small helper stubs (input, pause hook) sit up to ~0x600 bytes in front of a zone's run function (architecture.md 3.1) */
const ZONE_STUBS = 0x800;

// ---------------------------------------------------------------------------------------------------
// result types

export type CondOp = '==' | '!=' | '<' | '>=' | '<=' | '>';
/** One comparison that an entry depends on (all of an entry's conditions must hold; code reached on several paths gets one entry per path). */
export interface Cond {
  /** what is compared: a game variable (`FUN_00417575(id)`), the result of another call (`id` = its address, `arg` its first argument), a global
   * (`id` = address), the name of the record of a record loop (`value` = the characters compared, `id` = the byte offset of the first: 0 for the 4
   * character name of a strncmp / dword compare, 0..3 for a byte compare), something the interpreter could not name, or `never` (a
   * comparison of two constants that fails: the code is dead for these arguments) */
  src: 'var' | 'call' | 'global' | 'name' | 'unknown' | 'never';
  id: number;
  arg?: number;
  op: CondOp;
  value: number | string;
  /** address of the conditional jump */
  at: number;
}
export interface Base {
  /** address of the call / store instruction in the executable */
  at: number;
  /** address of the function it sits in */
  fn: number;
  /** conditions (conjunction) under which it runs; empty = always (when the function is reached) */
  cond: Cond[];
  /** inside a loop of the set-up code: a record loop has `record = -1` and is restricted by a `name` condition */
  loop?: boolean;
}
export interface Attach extends Base {
  /** record index (-1: not a constant record) */
  record: number;
  /** constructor address (VA) and the source file name of the constructor if it has one ('PepSwitc', 'SGwalk' ...) */
  ctor: number; ctorName: string | null;
  /** argument: a constant, or null when it points to memory the interpreter does not follow (`argWords` = the constants of a frame local the argument points to) */
  arg: number | null; argWords?: number[];
  /** position in the controller's node list (0 = head, resets the list) */
  pos: number;
  /** gate (var & mask) == value (the player chain: var 0x5e = PEPPER_CONTROL) */
  var: number; mask: number; value: number;
}
/** `unknown`: a conditional show / hide the interpreter could not separate (both arms merged into one store) */
export interface FlagWrite extends Base { record: number; op: 'and' | 'or' | 'set' | 'unknown'; mask: number }
export interface FieldWrite extends Base {
  record: number; field: number; size: number;
  /** a constant (float fields: the bit pattern, see `float`), or null when it is a global (`ref`) or unknown */
  value: number | null; float: number | null; ref: number | null;
}
export interface Box extends Base {
  record: number;
  kind: 'file' | 'radiusHeight' | 'dims';
  /** file: []; radiusHeight: [radius, height]; dims: [x, y, z] */
  dims: number[];
}
export interface RenderMode extends Base { record: number; partMask: number; mode: number }
/** FUN_004446c0(record, on): the record's meshes get a specular colour per vertex (vertex format 0x2c2); `on` false = back to 0x242 */
export interface Shiny extends Base { record: number; on: boolean }
export interface Cutscene extends Base { slot: number | null; name: string | null; messages: string | null }
export interface HudHint extends Base { index: number; a: number; b: number; c: number; d: number; scale: number }
export interface GlobalWrite extends Base { addr: number; size: number; value: number | null; float: number | null; ref: number | null; recordPtr: number | null }
export interface VarWrite extends Base { var: number; op: 'set' | 'add' | 'or' | 'andnot'; value: number | null }
export interface CtrlFlags extends Base { record: number; flags: number }
export interface WaypointMap extends Base { index: number; path: string | null }
/** FUN_00462be9(map, node, record + field): the record is placed at the position of a waypoint node (word -1: all three of x / y / z at field, field + 4, field + 8) */
export interface Place extends Base { record: number; field: number; map: number; node: number; word: number }

/** a zone's blob shadow set-up: the terrain records FUN_00444ed0 registers (record indices); with none, FUN_00444940 draws nothing */
export interface ShadowSetup { init: number[]; records: number[]; /** call sites whose record is not a constant */ unresolved: number }

export interface ZoneSetup {
  zone: string;
  /** the set-up root: the function that calls the zone's loader */
  root: number;
  /** code region of the zone (functions called from the root are followed inside it) */
  region: [number, number];
  /** addresses of the functions that were interpreted (in visit order, a function reached twice appears twice) */
  functions: number[];
  /** zone table index of the zone (island: 2; `variants` are the other table entries that run the same function) */
  subgame: number; variants: number[];
  attaches: Attach[];
  /** every write to rec + 0x60 */
  flagWrites: FlagWrite[];
  /** the flag writes that clear bit 2 (hide the record) / set it (show) */
  hide: FlagWrite[]; show: FlagWrite[];
  /** the other stores into record fields (position, colour ...) */
  fieldWrites: FieldWrite[];
  boxes: Box[];
  modes: RenderMode[];
  /** FUN_004446c0 calls (specular "shiny" records) */
  shiny: Shiny[];
  /** the same two kinds of call made by the CONSTRUCTORS of the attached nodes (`extractCtorRenderCalls`): they run while FUN_00423532 builds the node, which neither the symbolic walk nor the emulation does */
  ctorModes: RenderMode[]; ctorShiny: Shiny[];
  cutscenes: Cutscene[];
  hudHints: HudHint[];
  globalWrites: GlobalWrite[];
  varWrites: VarWrite[];
  ctrlFlags: CtrlFlags[];
  /** FUN_004630c0: the waypoint maps the zone loads (by map index) and the places records are set to */
  waypointMaps: WaypointMap[]; places: Place[];
  /** FUN_0042382c: records that get a controller */
  controllers: { record: number; at: number; cond: Cond[] }[];
  /** the zone's blob shadows (`extractShadowSetup`); null = the zone never calls FUN_00444850: no blob shadows at all */
  shadow: ShadowSetup | null;
  /** FUN_00442d90 calls of the set-up code in code order (`fog` below is the zone's block as found by zoneparams.ts) */
  fogCalls: FogSetup[];
  fog: FogSetup[];
  /** the unconditional (else the first) store to DAT_009da858; null = never stored (the sea stays where the previous zone left it, 0 after FUN_00426759) */
  seaLevel: number | null;
  /** the same for DAT_009da9bc; null = never stored (the previous zone's -10) */
  gravity: number | null;
  /** FUN_004425e0 argument: the record the terrain ray tests (and its name when `scene` was given) */
  groundRecord: number | null; groundName: string | null;
  /** the record the camera focuses (DAT_009da5d8 = record + 0xc), null when never stored */
  focusRecord: number | null;
  /** the record index in DAT_009daa7c: the skateboard (SKBD / SBRD) record, hidden while the player walks or swims; null = none (-1) */
  accessoryRecord: number | null;
  /** entries whose record is not a constant (a record pointer from a call, a parameter ...): attaches / boxes / modes / flag writes the interpreter saw but could not
   * assign to a record; only counted (by kind) */
  dynamic: Record<string, number>;
  /** things the interpreter could not resolve (arguments that are not constants and so on) */
  unresolved: string[];
}

// ---------------------------------------------------------------------------------------------------
// zone index: loader, setup root and code region of every zone (one pass over .text)

export interface ZoneCode { zone: string; loader: number; builder: number; root: number; lo: number; hi: number }

const indexCache = new WeakMap<Pe, Map<string, ZoneCode>>();

function fnEndOf(starts: number[], idx: number, va: number): number { return idx + 1 < starts.length ? starts[idx + 1] : va + 0x100000; }
/** index of the function start that contains `va` */
export function fnIndex(starts: number[], va: number): number {
  let lo = 0, hi = starts.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= va) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

/** Finds the loader (the function that references the zone's mesh path strings), the builder (right in front of it), the setup root (the loader's only
 * caller) and the code region (from the end of the previous zone's loader to the end of this zone's loader) of every zone in the executable. */
export function zoneCodeIndex(pe: Pe, starts: number[] = pe.functionStarts()): Map<string, ZoneCode> {
  const hit = indexCache.get(pe);
  if (hit) return hit;
  // 1. mesh path strings per zone
  const strByZone = new Map<string, number[]>();
  const nameOf = new Map<number, string>();
  for (const va of pe.findStrings('\\meshes\\')) {
    const s = pe.cstr(va);
    const m = /^_data\\(z\d\d[a-z]{3})\\meshes\\.*\.msh$/i.exec(s);
    if (!m) continue;
    const z = m[1];
    (strByZone.get(z) ?? strByZone.set(z, []).get(z)!).push(va);
    nameOf.set(va, z);
  }
  // 2. one pass over .text: first `push <string>` per string
  const want = new Set(nameOf.keys());
  const firstPush = new Map<number, number>();
  const d = pe.data, t = pe.text;
  for (let o = t.roff; o < t.roff + t.rsize - 5; o++) {
    if (d[o] !== 0x68) continue;
    const v = (d[o + 1] | (d[o + 2] << 8) | (d[o + 3] << 16) | (d[o + 4] << 24)) >>> 0;
    if (want.has(v) && !firstPush.has(v)) firstPush.set(v, t.va + (o - t.roff));
  }
  const loaders = new Map<string, number>();
  for (const [z, strs] of strByZone) for (const s of strs) { const x = firstPush.get(s); if (x !== undefined) { loaders.set(z, starts[fnIndex(starts, x)]); break; } }
  // 3. callers of the loaders
  const byLoader = new Map<number, string>();
  for (const [z, l] of loaders) byLoader.set(l, z);
  const root = new Map<string, number>();
  for (let o = t.roff; o < t.roff + t.rsize - 5; o++) {
    if (d[o] !== 0xe8) continue;
    const rel = d[o + 1] | (d[o + 2] << 8) | (d[o + 3] << 16) | (d[o + 4] << 24);
    const z = byLoader.get((t.va + (o - t.roff) + 5 + rel) >>> 0);
    if (z && !root.has(z)) root.set(z, starts[fnIndex(starts, t.va + (o - t.roff))]);
  }
  // 4. regions: a zone's code runs from its GameLoop / wrapper (the zone table's run function, a few stubs in front of it) to the end of its loader. A rough
  // region (from the end of the previous zone's loader) only decides which table entries belong to the zone: the island's behaviours sit behind its loader,
  // so the next zone's rough region would start inside them.
  const order = [...loaders].sort((a, b) => a[1] - b[1]);
  const table = readZoneTable(pe).filter((t) => t.run > 0);
  const out = new Map<string, ZoneCode>();
  let prevEnd = Math.min(...table.map((t) => t.run));
  for (let i = 0; i < order.length; i++) {
    const [z, l] = order[i];
    const li = starts.indexOf(l);
    const hi = fnEndOf(starts, li, l);
    const runs = table.filter((t) => t.run >= prevEnd && t.run < hi).map((t) => t.run);
    const lo = runs.length ? Math.min(...runs) - ZONE_STUBS : prevEnd;
    out.set(z.toLowerCase(), { zone: z, loader: l, builder: li > 0 ? starts[li - 1] : 0, root: root.get(z) ?? 0, lo, hi });
    prevEnd = hi;
  }
  // a zone's own code can also sit behind its loader (the island's behaviours, the castle's stage sets): the region ends where the next zone's begins
  const byLo = [...out.values()].sort((a, b) => a.lo - b.lo);
  for (let i = 0; i + 1 < byLo.length; i++) byLo[i].hi = Math.max(byLo[i].hi, byLo[i + 1].lo);
  indexCache.set(pe, out);
  return out;
}

export interface ZoneTableEntry { index: number; run: number; kind: number; name: string }
export function readZoneTable(pe: Pe): ZoneTableEntry[] {
  const out: ZoneTableEntry[] = [];
  for (let i = 0; i < ZONE_TABLE_COUNT; i++) {
    const a = ZONE_TABLE + i * 20;
    out.push({ index: i, run: pe.u32(a), kind: pe.u32(a + 4), name: pe.cstr(a + 8, 8) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// helpers

const f32 = new DataView(new ArrayBuffer(4));
const asFloat = (u: number) => { f32.setUint32(0, u >>> 0, true); return f32.getFloat32(0, true); };
const s32 = (u: number) => u | 0;

/** source file name of a behaviour constructor: the basename of the first source path string (`...\c_src\PepSwitc.c`) it references */
export function ctorName(pe: Pe, ctor: number): string | null {
  let pc = ctor;
  for (let n = 0; n < 400; n++) {
    const win = pe.slice(pc, 16);
    if (!win) return null;
    const ins = decode(win, 0, pc);
    if (!ins) { pc++; continue; }
    if (ins.op === 0x68) {
      const s = pe.cstr(ins.imm >>> 0, 200);
      const m = /([^\\/]+)\.(?:c|cpp)$/i.exec(s);
      if (m && /[\\/]/.test(s)) return m[1];
    }
    if (ins.op === 0xc3 || ins.op === 0xc2) return null;
    pc += ins.len;
  }
  return null;
}

type Ctx = {
  pe: Pe;
  starts: number[];
  code: ZoneCode;
  out: ZoneSetup;
  visits: Map<number, number>;
  seen: Set<string>;
  names: Map<number, string | null>;
  places: Set<string>;
  notes: Set<string>;
};

const flip: Record<CondOp, CondOp> = { '==': '!=', '!=': '==', '<': '>=', '>=': '<', '<=': '>', '>': '<=' };
const swap: Record<CondOp, CondOp> = { '==': '==', '!=': '!=', '<': '>', '>=': '<=', '<=': '>=', '>': '<' };
const CC: Record<number, CondOp> = { 2: '<', 3: '>=', 4: '==', 5: '!=', 6: '<=', 7: '>', 0xc: '<', 0xd: '>=', 0xe: '<=', 0xf: '>' };

function immOf(v: Val | undefined): number | null { return v && v.k === 'imm' ? v.v >>> 0 : null; }

/** a load from the name of the record a record loop is at: the dword at +0 or a byte at +0..3 of `records + iter * 0x68` */
function isRecordName(v: Val): v is Extract<Val, { k: 'load' | 'ld8' }> {
  if (v.k === 'load') return v.o === 0 && v.base.k === 'giter' && v.base.a === GLOBALS.RECORDS && v.base.mul === RECORD_STRIDE && v.base.o === 0;
  if (v.k === 'ld8') return v.base.k === 'giter' && v.base.a === GLOBALS.RECORDS && v.base.mul === RECORD_STRIDE && v.base.o === 0 && v.o >= 0 && v.o < 4;
  return false;
}

function condOf(g: Guard, calls: Map<number, CallEv>, pe: Pe, unres: (s: string) => void): Cond | null {
  if (g.loopExit) return null;
  if (g.cc === 0xff) { unres(`condition at ${g.at.toString(16)} not known (switch table or too many paths)`); return { src: 'unknown', id: 0, op: '==', value: 0, at: g.at }; }
  let cc = CC[g.cc];
  if (!cc) { unres(`guard at ${g.at.toString(16)}: unhandled condition code ${g.cc}`); return { src: 'unknown', id: 0, op: '==', value: 0, at: g.at }; }
  if (g.taken === false) cc = flip[cc]; // fall through = the jump was NOT taken: the body runs when the jump condition is false
  // `jcc` jumps AROUND the body: the body runs when the jump condition is false, the else arm (`taken`) when it is true
  let lhs = g.lhs, rhs = g.rhs, op = cc;
  if (lhs && lhs.k === 'imm' && rhs && rhs.k !== 'imm') { const t = lhs; lhs = rhs; rhs = t; op = swap[op]; }
  if (lhs && (lhs.k === 'iter' || lhs.k === 'giter' || lhs.k === 'tld')) return null; // loop bound
  if (lhs && lhs.k === 'imm' && rhs && rhs.k === 'imm') {
    // two constants (a parameter the caller passed as a constant): decide now
    const unsigned = g.cc >= 2 && g.cc <= 7, a = unsigned ? lhs.v >>> 0 : lhs.v | 0, b = unsigned ? rhs.v >>> 0 : rhs.v | 0;
    const holds = op === '==' ? a === b : op === '!=' ? a !== b : op === '<' ? a < b : op === '>=' ? a >= b : op === '<=' ? a <= b : a > b;
    return holds ? null : { src: 'never', id: 0, op, value: 0, at: g.at };
  }
  const rv = immOf(rhs);
  let cond: Cond;
  if (lhs && lhs.k === 'gvar' && rv !== null) cond = { src: 'var', id: lhs.v, op, value: s32(rv), at: g.at };
  else if (lhs && lhs.k === 'ret' && rv !== null) {
    const c = calls.get(lhs.id);
    if (c && c.target === FN.GET_VAR && c.args[0]?.k === 'imm') cond = { src: 'var', id: c.args[0].v, op, value: s32(rv), at: g.at };
    else if (c && c.target === FN.STRNCMP && c.args[1]?.k === 'imm' && rv === 0 && (op === '==' || op === '!=')) cond = { src: 'name', id: 0, op, value: pe.cstr(c.args[1].v, 4).slice(0, 4), at: g.at };
    else if (c) cond = { src: 'call', id: c.target, arg: c.args[0]?.k === 'imm' ? c.args[0].v : undefined, op, value: s32(rv), at: g.at };
    else cond = { src: 'unknown', id: 0, op, value: s32(rv), at: g.at };
  } else if (lhs && rv !== null && (op === '==' || op === '!=') && isRecordName(lhs)) {
    // `record.name == 'TRIC'` (dword compare) or `record.name[k] == 'A'` (byte compare) inside a record loop
    const byte = lhs.k === 'ld8';
    const off = byte ? lhs.o : 0;
    const chars = byte ? String.fromCharCode(rv & 0xff) : String.fromCharCode(rv & 0xff, (rv >>> 8) & 0xff, (rv >>> 16) & 0xff, (rv >>> 24) & 0xff);
    cond = { src: 'name', id: off, op, value: chars, at: g.at };
  } else if (lhs && lhs.k === 'glob' && rv !== null) cond = { src: 'global', id: lhs.a, op, value: s32(rv), at: g.at };
  else cond = { src: 'unknown', id: 0, op, value: rv !== null ? s32(rv) : 0, at: g.at };
  return cond;
}

const condKey = (cs: Cond[]) => cs.map((c) => `${c.src}:${c.id}:${c.arg ?? ''}:${c.op}:${c.value}`).join('&');
/** false when the conditions exclude each other (the code can never run): game variable ranges, a record name that has to be two different things */
function satisfiable(cs: Cond[]): boolean {
  const iv = new Map<number, [number, number]>();
  const eq = new Map<number, string>(), ne = new Map<number, Set<string>>();
  for (const c of cs) {
    if (c.src === 'never') return false;
    if (c.src === 'name') {
      const v = c.value as string;
      for (let i = 0; i < v.length; i++) {
        const pos = c.id + i, ch = v[i];
        if (c.op === '==') { if (eq.has(pos) && eq.get(pos) !== ch) return false; eq.set(pos, ch); if (ne.get(pos)?.has(ch)) return false; }
        else if (c.op === '!=' && v.length === 1) { (ne.get(pos) ?? ne.set(pos, new Set()).get(pos)!).add(ch); if (eq.get(pos) === ch) return false; }
      }
      continue;
    }
    if (c.src !== 'var') continue;
    const r = iv.get(c.id) ?? [-Infinity, Infinity];
    const v = c.value as number;
    if (c.op === '==') { r[0] = Math.max(r[0], v); r[1] = Math.min(r[1], v); } else if (c.op === '<') r[1] = Math.min(r[1], v - 1);
    else if (c.op === '<=') r[1] = Math.min(r[1], v); else if (c.op === '>') r[0] = Math.max(r[0], v + 1); else if (c.op === '>=') r[0] = Math.max(r[0], v);
    if (r[0] > r[1]) return false;
    iv.set(c.id, r);
  }
  return true;
}
/** the conditions on one game variable as an interval (`>= lo`, `<= hi`, or `==`); other conditions stay as they are */
function normalizeConds(cs: Cond[]): Cond[] {
  const ranges = new Map<number, { lo: number; hi: number; at: number }>();
  for (const c of cs) {
    if (c.src !== 'var' || c.op === '!=') continue;
    const r = ranges.get(c.id) ?? { lo: -Infinity, hi: Infinity, at: c.at };
    const v = c.value as number;
    if (c.op === '==') { r.lo = Math.max(r.lo, v); r.hi = Math.min(r.hi, v); } else if (c.op === '<') r.hi = Math.min(r.hi, v - 1);
    else if (c.op === '<=') r.hi = Math.min(r.hi, v); else if (c.op === '>') r.lo = Math.max(r.lo, v + 1); else r.lo = Math.max(r.lo, v);
    ranges.set(c.id, r);
  }
  const out: Cond[] = [];
  const done = new Set<number>();
  for (const c of cs) {
    if (c.src !== 'var' || c.op === '!=') { out.push(c); continue; }
    if (done.has(c.id)) continue;
    done.add(c.id);
    const r = ranges.get(c.id)!;
    if (r.lo === r.hi) out.push({ src: 'var', id: c.id, op: '==', value: r.lo, at: c.at });
    else {
      if (r.lo > -Infinity) out.push({ src: 'var', id: c.id, op: '>=', value: r.lo, at: c.at });
      if (r.hi < Infinity) out.push({ src: 'var', id: c.id, op: '<=', value: r.hi, at: c.at });
    }
  }
  return out;
}
/** the same comparison with the opposite outcome */
const negKey = (c: Cond) => `${c.src}:${c.id}:${c.arg ?? ''}:${flip[c.op]}:${c.value}`;
/** merges paths that differ only by `c` / `!c` (a condition the compiler tested twice) and drops paths another path implies */
function simplifyPaths(paths: Cond[][]): Cond[][] {
  const ks = paths.map((p) => new Set(p.map((c) => condKey([c]))));
  const list = paths.map((p, i) => ({ p, k: ks[i] }));
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const A = list[i], B = list[j];
      if ([...A.k].every((v) => B.k.has(v))) { list.splice(j, 1); changed = true; break outer; }
      if ([...B.k].every((v) => A.k.has(v))) { list.splice(i, 1); changed = true; break outer; }
      if (A.k.size === B.k.size) {
        const oa = A.p.filter((c) => !B.k.has(condKey([c]))), ob = B.p.filter((c) => !A.k.has(condKey([c])));
        if (oa.length === 1 && ob.length === 1 && negKey(oa[0]) === condKey([ob[0]])) {
          const p = A.p.filter((c) => c !== oa[0]);
          list[i] = { p, k: new Set(p.map((c) => condKey([c]))) }; list.splice(j, 1); changed = true; break outer;
        }
      }
    }
  }
  return list.map((x) => x.p);
}

/** record argument: a constant record, a record loop (`loop`), or a loop over a table of record indices (`table`: `for (i = 0; table[i] != -1; i++) f(records + table[i] * 0x68)`) */
interface RecArg { record: number; field: number; loop: boolean; table?: { a: number; scale: number; id: number } }
function recordOf(v: Val | undefined): RecArg | null {
  if (!v) return null;
  if (v.k === 'gtld' && v.g === GLOBALS.RECORDS && v.mul === RECORD_STRIDE) return { record: -1, field: v.o, loop: false, table: { a: v.a, scale: v.scale, id: v.id } };
  if (v.k === 'glob' && v.a === GLOBALS.RECORDS) return { record: 0, field: 0, loop: false };
  if (v.k === 'gptr' && v.a === GLOBALS.RECORDS) return { record: Math.floor(v.o / RECORD_STRIDE), field: v.o % RECORD_STRIDE, loop: false };
  if (v.k === 'giter' && v.a === GLOBALS.RECORDS && v.mul === RECORD_STRIDE) return { record: -1, field: v.o, loop: true };
  return null;
}

/** z42BRP's FUN_00820a.. loop registers records through a switch on (index - 0xe): byte map 0x820aed -> jump table 0x820ae5, the case at 0x81fe6b is the registering one */
const BRP_SWITCH = { first: 0xe, count: 0x42, bytes: 0x820aed, table: 0x820ae5, registerCase: 0x81fe6b, site: 0x81fe6f };

/**
 * The zone's blob shadows (Shadow.c): the call sites of FUN_00444850 and FUN_00444ed0(record) in the zone's code (its loop function, not the set-up tree). `null` when the zone
 * never initialises the shadows. The record is the `push imm` right before the call (a register: z42BRP's loop over all records, resolved through its switch tables).
 */
export function extractShadowSetup(pe: Pe, code: { lo: number; hi: number }, starts: number[]): ShadowSetup | null {
  const init: number[] = [], records: number[] = [];
  let unresolved = 0;
  const lo = fnIndex(starts, code.lo), hi = fnIndex(starts, Math.max(code.lo, code.hi - 1));
  for (let fi = Math.max(0, lo); fi <= hi && fi < starts.length; fi++) {
    const a = starts[fi], e = fnEndOf(starts, fi, a);
    let prev: { op: number; imm: number } | null = null;
    for (let at = a; at < e;) {
      const ins = decode(pe.slice(at, 16) ?? new Uint8Array(16), 0, at);
      if (!ins || ins.len <= 0) break;
      if (ins.op === 0xe8) {
        if (ins.rel === SHADOW_INIT) init.push(at);
        else if (ins.rel === SHADOW_REGISTER) {
          if (prev && (prev.op === 0x6a || prev.op === 0x68)) records.push(prev.imm >>> 0);
          else if (at === BRP_SWITCH.site) {
            for (let i = 0; i < BRP_SWITCH.count; i++) {
              const k = pe.at(BRP_SWITCH.bytes + i), target = pe.u32(BRP_SWITCH.table + k * 4);
              if (target === BRP_SWITCH.registerCase && BRP_SWITCH.first + i < 0x10000) records.push(BRP_SWITCH.first + i);
            }
          } else unresolved++;
        }
      }
      prev = { op: ins.op, imm: ins.imm };
      at += ins.len;
    }
  }
  if (!init.length) return null;
  return { init, records: [...new Set(records)].sort((x, y) => x - y), unresolved };
}

/** end of the function at `fn` */
function fnEnd(ctx: Ctx, fn: number): number {
  const i = fnIndex(ctx.starts, fn);
  return i >= 0 && ctx.starts[i] === fn ? fnEndOf(ctx.starts, i, fn) : fn + 0x4000;
}

const MAX_VISITS = 8, MAX_DEPTH = 8;

function walk(ctx: Ctx, fn: number, params: (Val | undefined)[], base: Cond[], depth: number) {
  const { pe, out } = ctx;
  const note = (s: string) => { if (!ctx.notes.has(s)) { ctx.notes.add(s); out.unresolved.push(s); } };
  if (!satisfiable(base)) return;
  // the same function reached again under the same conditions and constants gives the same entries
  const key = `${fn}|${condKey(base)}|${params.map((p) => (p ? JSON.stringify(p) : '-')).join(',')}`;
  if (ctx.seen.has(key)) return;
  ctx.seen.add(key);
  const n = (ctx.visits.get(fn) ?? 0) + 1;
  ctx.visits.set(fn, n);
  if (n > MAX_VISITS || depth > MAX_DEPTH) { note(`function ${fn.toString(16)}: not followed again (more than ${MAX_VISITS} different call contexts, or deeper than ${MAX_DEPTH})`); return; }
  out.functions.push(fn);
  const evs: Ev[] = interpret(pe, fn, fnEnd(ctx, fn), { params, outputs: { [FN.WAYPOINT_POS]: { arg: 2, words: 3 } } });
  const calls = new Map<number, CallEv>();
  for (const e of evs) if (e.type === 'call') calls.set(e.id, e);
  const unres = note;
  /** the paths that reach an event: each is the base conditions plus the conditions of its guards (loop tests dropped); dead paths are left out */
  type Reach = { cond: Cond[]; guards: Guard[] };
  const reaches = (e: Ev): Reach[] => {
    const res: Reach[] = [];
    const seenK = new Set<string>();
    for (const ga of e.alts ?? [e.guards ?? []]) {
      const cs = [...base];
      for (const g of ga) { const c = condOf(g, calls, pe, unres); if (c) cs.push(c); }
      if (!satisfiable(cs)) continue;
      const k = condKey(cs);
      if (seenK.has(k)) continue;
      seenK.add(k);
      res.push({ cond: cs, guards: ga });
    }
    for (const r of res) r.cond = normalizeConds(r.cond);
    const merged = simplifyPaths(res.map((r) => r.cond));
    return merged.map((cond) => res.find((r) => r.cond === cond) ?? { cond, guards: res[0]?.guards ?? [] });
  };
  const here = (e: Ev, r: Reach): Base => { const b: Base = { at: e.at, fn, cond: r.cond }; if (e.loop !== undefined) b.loop = true; return b; };
  const num = (v: Val | undefined): number | null => immOf(v);
  const rec = (v: Val | undefined, what: string, at: number): RecArg => {
    const r = recordOf(v);
    if (!r) { unres(`${what} at ${at.toString(16)}: record argument is not constant`); return { record: -1, field: 0, loop: false }; }
    if (r.field) unres(`${what} at ${at.toString(16)}: record pointer + ${r.field.toString(16)}`);
    return r;
  };
  /** the record indices of a table loop (read from the executable up to the -1 terminator the loop tests for), or null */
  const tableRecords = (t: NonNullable<RecArg['table']>, guards: Guard[]): number[] | null => {
    const ends = guards.some((g) => g.lhs && g.lhs.k === 'tld' && g.lhs.a === t.a && g.lhs.id === t.id && g.rhs && g.rhs.k === 'imm' && g.rhs.v === 0xffffffff);
    if (!ends) return null;
    const out: number[] = [];
    for (let i = 0; i < 4096; i++) { const v = pe.u32(t.a + i * t.scale); if (v === 0xffffffff) return out; if (v > 0x10000) return null; out.push(v); }
    return null;
  };
  /** adds the entry (once per record of a table loop); an entry whose record is not a constant is only counted */
  const add = <T extends { record: number }>(list: T[], kind: string, r: RecArg, entry: T, guards: Guard[]) => {
    if (r.table) {
      const recs = tableRecords(r.table, guards);
      if (recs) { for (const v of recs) { const x: T & { loop?: boolean } = { ...entry, record: v }; delete x.loop; list.push(x); } return; }
    }
    if (r.record < 0 && !r.loop) out.dynamic[kind] = (out.dynamic[kind] ?? 0) + 1; else list.push(entry);
  };
  for (const e of evs) for (const rch of reaches(e)) {
    if (e.type === 'call') {
      const a = e.args;
      switch (e.target) {
        case FN.ATTACH: {
          if (a.length < 7) { unres(`attach at ${e.at.toString(16)}: ${a.length} arguments`); break; }
          const r = rec(a[0], 'attach', e.at);
          const ctor = num(a[1]);
          if (ctor === null) { unres(`attach at ${e.at.toString(16)}: constructor is not constant`); break; }
          let name = ctx.names.get(ctor);
          if (name === undefined) { name = ctorName(pe, ctor); ctx.names.set(ctor, name); }
          const at: Attach = { ...here(e, rch), record: r.record, ctor, ctorName: name, arg: num(a[2]), pos: num(a[3]) ?? -1, var: num(a[4]) ?? -1, mask: num(a[5]) ?? 0, value: num(a[6]) ?? 0 };
          if (a[2]?.k === 'lea' && e.locals) { const w: number[] = []; for (let i = 0; i < 4; i++) { const x = e.locals.get(a[2].o + i * 4); if (x === undefined) break; w.push(x); } if (w.length) at.argWords = w; }
          if (r.loop) at.loop = true;
          if (num(a[3]) === null || num(a[4]) === null) unres(`attach at ${e.at.toString(16)}: position / gate not constant`);
          add(out.attaches, 'attach', r, at, rch.guards);
          break;
        }
        case FN.BOX_FILE: { const r = rec(a[0], 'box', e.at); add(out.boxes, 'box', r, { ...here(e, rch), record: r.record, kind: 'file', dims: [] }, rch.guards); break; }
        case FN.BOX_RADIUS_HEIGHT: { const r = rec(a[0], 'box', e.at); add(out.boxes, 'box', r, { ...here(e, rch), record: r.record, kind: 'radiusHeight', dims: [asFloat(num(a[1]) ?? NaN), asFloat(num(a[2]) ?? NaN)] }, rch.guards); break; }
        case FN.BOX_DIMS: { const r = rec(a[0], 'box', e.at); add(out.boxes, 'box', r, { ...here(e, rch), record: r.record, kind: 'dims', dims: [asFloat(num(a[1]) ?? NaN), asFloat(num(a[2]) ?? NaN), asFloat(num(a[3]) ?? NaN)] }, rch.guards); break; }
        case FN.RENDER_MODE: { const r = rec(a[0], 'render mode', e.at); add(out.modes, 'mode', r, { ...here(e, rch), record: r.record, partMask: num(a[1]) ?? 0, mode: num(a[2]) ?? 0 }, rch.guards); break; }
        case FN.SHINY: { const r = rec(a[0], 'shiny', e.at); add(out.shiny, 'shiny', r, { ...here(e, rch), record: r.record, on: (num(a[1]) ?? 1) !== 0 }, rch.guards); break; }
        case FN.CUTSCENE: {
          const s = (v: Val | undefined) => (v && v.k === 'imm' ? pe.cstr(v.v) : null);
          out.cutscenes.push({ ...here(e, rch), slot: num(a[0]), name: s(a[1]), messages: s(a[2]) });
          break;
        }
        case FN.HUD_HINT: out.hudHints.push({ ...here(e, rch), index: num(a[0]) ?? -1, a: s32(num(a[1]) ?? 0), b: s32(num(a[2]) ?? 0), c: s32(num(a[3]) ?? 0), d: s32(num(a[4]) ?? 0), scale: asFloat(num(a[5]) ?? 0) }); break;
        case FN.GROUND: { const r = rec(a[0], 'ground', e.at); if (out.groundRecord === null && r.record >= 0 && !rch.cond.length) out.groundRecord = r.record; else if (r.record >= 0 && out.groundRecord !== r.record) unres(`ground record ${r.record} at ${e.at.toString(16)} (conditional)`); break; }
        case FN.SETUP_FOG: {
          const v = a.map(num);
          if (v.length >= 6 && v.every((x) => x !== null)) out.fogCalls.push({ near: asFloat(v[0]!), farMin: asFloat(v[1]!), farMax: asFloat(v[2]!), fogFrac: asFloat(v[3]!), color: v[4]!, enabled: v[5]! !== 0, at: e.at });
          break;
        }
        case FN.LOAD_WAYPOINTS: out.waypointMaps.push({ ...here(e, rch), index: num(a[0]) ?? -1, path: a[1] && a[1].k === 'imm' ? pe.cstr(a[1].v) : null }); break;
        case FN.WAYPOINT_POS: {
          const d = recordOf(a[2]);
          if (d && !d.loop) out.places.push({ ...here(e, rch), record: d.record, field: d.field, map: num(a[0]) ?? -1, node: num(a[1]) ?? -1, word: -1 });
          else if (!a[2] || a[2].k !== 'lea') unres(`waypoint position at ${e.at.toString(16)}: destination not understood`);
          break;
        }
        case FN.CREATE_CTRL: { const r = rec(a[0], 'controller', e.at); add(out.controllers, 'controller', r, { record: r.record, at: e.at, cond: rch.cond }, rch.guards); break; }
        case FN.SET_CTRL_FLAGS: {
          const p = a[0];
          // controller pointer = [record + 0x5c]
          if (p && p.k === 'load' && p.base.k === 'glob' && p.base.a === GLOBALS.RECORDS) {
            const r = Math.floor(p.o / RECORD_STRIDE);
            if (p.o % RECORD_STRIDE === RF.CTRL) out.ctrlFlags.push({ ...here(e, rch), record: r, flags: num(a[1]) ?? 0 });
            else unres(`controller flags at ${e.at.toString(16)}: pointer is not a record's controller`);
          } else unres(`controller flags at ${e.at.toString(16)}: pointer not constant`);
          break;
        }
        case FN.SET_VAR: case FN.ADD_VAR: case FN.OR_VAR: case FN.ANDNOT_VAR:
          out.varWrites.push({ ...here(e, rch), var: num(a[0]) ?? -1, op: e.target === FN.SET_VAR ? 'set' : e.target === FN.ADD_VAR ? 'add' : e.target === FN.OR_VAR ? 'or' : 'andnot', value: num(a[1]) });
          break;
        default:
          // zone-local function: follow it with the constant arguments
          if (e.target >= ctx.code.lo && e.target < ctx.code.hi && e.target !== ctx.code.loader && e.target !== ctx.code.builder && e.target !== fn) {
            const ps = a.map((v): Val | undefined => {
              if (v && (v.k === 'imm' || v.k === 'gptr' || v.k === 'glob' || v.k === 'addr')) return v;
              // a game variable the caller read and passes on (the island's story state to the per-state functions)
              if (v && v.k === 'ret') { const c = calls.get(v.id); if (c && c.target === FN.GET_VAR && c.args[0]?.k === 'imm') return { k: 'gvar', v: c.args[0].v }; }
              return v;
            }).map((v) => (v && v.k === 'ret' ? undefined : v));
            walk(ctx, e.target, ps, rch.cond, depth + 1);
          }
      }
    } else {
      storeEntry(ctx, e, here(e, rch), unres, calls);
    }
  }
}

function storeEntry(ctx: Ctx, e: StoreEv, b: Base, unres: (s: string) => void, calls: Map<number, CallEv>) {
  const { out } = ctx;
  const bv = e.base;
  if (!bv) return;
  // stores into the record array
  const r = recordOf(bv.k === 'glob' ? bv : bv.k === 'giter' ? bv : bv.k === 'gptr' ? bv : undefined);
  if (r && (bv.k === 'glob' || bv.k === 'gptr' || bv.k === 'giter')) {
    let record = r.record, field = r.field + e.off;
    if (!r.loop) { const o = (bv.k === 'glob' ? 0 : (bv as { o: number }).o) + e.off; record = Math.floor(o / RECORD_STRIDE); field = o % RECORD_STRIDE; }
    if (field < 0 || field >= RECORD_STRIDE) { unres(`store at ${e.at.toString(16)}: field ${field}`); return; }
    if (field === RF.FLAGS && e.size === 2) {
      if (e.rmw && (e.rmw.op === 'and' || e.rmw.op === 'or')) out.flagWrites.push({ ...b, record, op: e.rmw.op, mask: e.rmw.imm });
      else if (e.value && e.value.k === 'imm') out.flagWrites.push({ ...b, record, op: 'set', mask: e.value.v & 0xffff });
      else { unres(`flag write at ${e.at.toString(16)} not understood (merged conditional)`); out.flagWrites.push({ ...b, record, op: 'unknown', mask: 0 }); }
      return;
    }
    const v = e.value;
    if (v && v.k === 'out') {
      const c = calls.get(v.id);
      const key = `${b.fn}:${v.id}:${record}:${field - 4 * v.i}`;
      if (c && c.target === FN.WAYPOINT_POS && !ctx.places.has(key)) {
        ctx.places.add(key);
        out.places.push({ ...b, record, field: field - 4 * v.i, map: immOf(c.args[0]) ?? -1, node: immOf(c.args[1]) ?? -1, word: -1 });
      }
      return;
    }
    const fw: FieldWrite = { ...b, record, field, size: e.size, value: v && v.k === 'imm' ? v.v : null, float: v && v.k === 'imm' && e.size === 4 ? asFloat(v.v) : null, ref: v && v.k === 'glob' ? v.a : null };
    if (e.rmw) return;
    if (field === RF.MODEL || field === RF.NAME || field === RF.COL || field === RF.CTRL || field === RF.MATRIX) return; // loader / builder fields
    out.fieldWrites.push(fw);
    return;
  }
  // absolute globals
  if (bv.k === 'addr') {
    const v = e.value;
    const gw: GlobalWrite = { ...b, addr: bv.a + e.off, size: e.size, value: v && v.k === 'imm' ? v.v : null, float: v && v.k === 'imm' && e.size === 4 ? asFloat(v.v) : null, ref: v && v.k === 'glob' ? v.a : null, recordPtr: null };
    if (v && v.k === 'gptr' && v.a === GLOBALS.RECORDS) gw.recordPtr = v.o;
    else if (v && v.k === 'glob' && v.a === GLOBALS.RECORDS) gw.recordPtr = 0;
    out.globalWrites.push(gw);
  }
}

// ---------------------------------------------------------------------------------------------------
// API

/**
 * The render calls (`FUN_00444550` modes, `FUN_004446c0` shiny) the CONSTRUCTORS of the attached nodes make: FUN_00423532 calls the node's constructor at once, so these calls run at set-up time, but
 * the constructors are only referenced by address in the set-up code (neither the symbolic walk nor the emulation runs them). Each distinct (constructor, record) of `attaches` is interpreted with the
 * record pointer as its first argument; the entries carry the attach site's conditions plus the paths inside the constructor. WP-RENDER R4.
 */
/**
 * Render calls the symbolic walk cannot resolve because their record comes from DATA the walk does not follow: (1) the loops of the zone start functions that go through a table in the
 * executable (`for (i = 0; table[i] != -1; i++) FUN_00444550(records + table[i] * 0x68, 0xff, 1)`: z15SSH FUN_00655de3, z17WAS FUN_00698963, z41MAP FUN_00811413, z60FRE FUN_00472... with a
 * fixed count) are read here from the call site's own code (the table address, the terminator or count and the pushed mask / mode are decoded from the instructions in front of the call);
 * (2) the z20DSP vehicle constructor FUN_006c6495 hands four records to FUN_00444550 through fields of its own data block (`+0x28`, `+0x6c`, `+0xb4`, `+0xf4` of the block at word 0xa2, set up
 * earlier in the same function from `DAT_00983804 + 0xdd0 / 0xe38 / 0xea0 / 0xf08`, i.e. records 34..37, the four wheels): listed by hand (`FIELD_RECORDS`). WP-RENDER R4 (second pass).
 * `known` = the call sites (`at`) the walk / emulation found already.
 */
const FIELD_RECORDS: Record<number, { record: number; mask: number; mode: number }> = {
  0x6c6b4d: { record: 36, mask: 0xff, mode: 1 },   // local_24[0x1b] -> block word 0xbd = DAT_00983804 + 0xea0 (record 36, WEFR)
  0x6c6b63: { record: 37, mask: 0xff, mode: 1 },   // local_24[10]   -> word 0xac = + 0xf08 (record 37, WEFL)
  0x6c6b7c: { record: 34, mask: 0xff, mode: 1 },   // local_24[0x3d] -> word 0xdf = + 0xdd0 (record 34, WEBR)
  0x6c6b95: { record: 35, mask: 0xff, mode: 1 },   // local_24[0x2c] -> word 0xce = + 0xe38 (record 35, WEBL)
};
export function extractUnwalkedRenderCalls(pe: Pe, code: ZoneCode, starts: number[], known: { at: number }[]): { modes: RenderMode[]; shiny: Shiny[] } {
  const modes: RenderMode[] = [], shiny: Shiny[] = [];
  const have = new Set(known.map((k) => k.at));
  const t = pe.text, d = pe.data;
  const lo = Math.max(code.lo, t.va), hi = Math.min(code.hi, t.va + t.rsize);
  const fnOf = (a: number) => { let l = 0, h = starts.length - 1; while (l < h) { const m = (l + h + 1) >> 1; if (starts[m] <= a) l = m; else h = m - 1; } return starts[l]; };
  const byte = (va: number) => d[t.roff + (va - t.va)];
  const dword = (va: number) => (byte(va) | (byte(va + 1) << 8) | (byte(va + 2) << 16) | (byte(va + 3) << 24)) >>> 0;
  const inData = (v: number) => v >= 0x890000 && v < 0x9c0000;
  for (let va = lo; va < hi - 5; va++) {
    if (byte(va) !== 0xe8) continue;
    const target = (va + 5 + (dword(va + 1) | 0)) >>> 0;
    const isMode = target === FN.RENDER_MODE, isShiny = target === FN.SHINY;
    if (!isMode && !isShiny) continue;
    if (have.has(va)) continue;
    const field = FIELD_RECORDS[va];
    if (field && isMode) { modes.push({ at: va, fn: fnOf(va), cond: [], record: field.record, partMask: field.mask, mode: field.mode }); continue; }
    // the table load in front of the call: mov r32, [reg * 4 + T]  (8b modrm SIB disp32; mod 0, rm 4, SIB base 5, scale 4)
    let table = -1;
    for (let b = va - 4; b > va - 48 && table < 0; b--) {
      if (byte(b) === 0x8b && (byte(b + 1) & 0xc7) === 0x04 && (byte(b + 2) & 0xc7) === 0x85 && (byte(b + 2) >> 6) === 2 && inData(dword(b + 3))) table = dword(b + 3);
    }
    if (table < 0) continue;
    // the pushed arguments: `push mode` (6a ib) then `push mask` (68 id / 6a ib) for FUN_00444550, `push on` for FUN_004446c0
    let mask = 0, mode = 0, on = true, found = false;
    for (let b = va - 6; b > va - 64 && !found; b--) {
      if (isMode && byte(b) === 0x6a && byte(b + 2) === 0x68 && b + 7 <= va) { mode = byte(b + 1); mask = dword(b + 3); found = true; }
      else if (isMode && byte(b) === 0x6a && byte(b + 2) === 0x6a && b + 4 <= va) { mode = byte(b + 1); mask = byte(b + 3) === 0xff ? 0xffffffff : byte(b + 3); found = true; }
      else if (isShiny && byte(b) === 0x6a && b + 2 <= va) { on = byte(b + 1) !== 0; found = true; }
    }
    if (!found) continue;
    // the loop bound: `cmp dword [reg * 4 + T], -1` (83 3c SIB T ff) or `cmp dword [ebp - n], count` (83 7d dd ib)
    let count = -1;
    for (let b = va - 4; b > va - 200 && count < 0; b--) {
      if (byte(b) === 0x83 && byte(b + 1) === 0x3c && (byte(b + 2) & 0xc7) === 0x85 && dword(b + 3) === table && byte(b + 7) === 0xff) count = 0;   // terminated by -1
      else if (byte(b) === 0x83 && byte(b + 1) === 0x7d && b + 4 <= va && byte(b + 3) < 0x80 && byte(b + 3) > 0 && (byte(b + 2) & 0x80)) count = byte(b + 3);
    }
    if (count < 0) continue;
    const entries: number[] = [];
    for (let i = 0; i < 256; i++) {
      const v = pe.u32(table + i * 4) | 0;
      if (count === 0 ? v === -1 : i >= count) break;
      entries.push(v);
    }
    for (const rec of entries) {
      if (isMode) modes.push({ at: va, fn: fnOf(va), cond: [], record: rec, partMask: mask >>> 0, mode });
      else shiny.push({ at: va, fn: fnOf(va), cond: [], record: rec, on });
    }
  }
  return { modes, shiny };
}

export function extractCtorRenderCalls(pe: Pe, code: ZoneCode, starts: number[], attaches: Attach[], known: { modes: RenderMode[]; shiny: Shiny[] } = { modes: [], shiny: [] }): { modes: RenderMode[]; shiny: Shiny[] } {
  const modes: RenderMode[] = [], shiny: Shiny[] = [];
  const done = new Set<string>();
  for (const a of attaches) {
    if (a.record < 0 || !a.ctor || a.loop) continue;
    const key = `${a.ctor}|${a.record}|${condKey(a.cond)}`;
    if (done.has(key)) continue;
    done.add(key);
    const tmp: ZoneSetup = { zone: code.zone, root: code.root, region: [code.lo, code.hi], functions: [], subgame: -1, variants: [], attaches: [], flagWrites: [], hide: [], show: [], fieldWrites: [], boxes: [], modes: [], shiny: [], ctorModes: [], ctorShiny: [], cutscenes: [], hudHints: [],
      globalWrites: [], varWrites: [], ctrlFlags: [], waypointMaps: [], places: [], controllers: [], shadow: null, fogCalls: [], fog: [], seaLevel: null, gravity: null, groundRecord: null, groundName: null, focusRecord: null, accessoryRecord: null, dynamic: {}, unresolved: [] };
    const ctx: Ctx = { pe, starts, code, out: tmp, visits: new Map(), seen: new Set(), names: new Map(), places: new Set(), notes: new Set() };
    try { walk(ctx, a.ctor, [{ k: 'gptr', a: GLOBALS.RECORDS, o: a.record * RECORD_STRIDE } as Val], a.cond, 1); } catch { continue; }
    for (const m of tmp.modes) if (m.record >= 0) modes.push(m);
    for (const m of tmp.shiny) if (m.record >= 0) shiny.push(m);
  }
  // calls whose record comes from data (tables, fields of a constructor's block)
  const extra = extractUnwalkedRenderCalls(pe, code, starts, [...known.modes, ...known.shiny, ...modes, ...shiny]);
  modes.push(...extra.modes); shiny.push(...extra.shiny);
  return { modes, shiny };
}

/** Interprets the set-up of `zone` (archive name, e.g. 'z02LGI'). `scene` (the zone's `extractZone` result) only adds names / bounds checks. `starts` = `pe.functionStarts()`. */
export function extractZoneSetup(pe: Pe, zone: string, scene?: ZoneScene, starts: number[] = pe.functionStarts(), opts: { ctorRender?: boolean } = {}): ZoneSetup {
  const index = zoneCodeIndex(pe, starts);
  const code = index.get(zone.toLowerCase());
  if (!code) throw new Error(`no zone code found for ${zone}`);
  if (!code.root) throw new Error(`${zone}: nothing calls the loader`);
  const table = readZoneTable(pe);
  const sub = table.filter((t) => t.run >= code.lo && t.run < code.hi).map((t) => t.index);
  const out: ZoneSetup = {
    zone: code.zone, root: code.root, region: [code.lo, code.hi], functions: [], subgame: sub.length ? sub[0] : -1, variants: sub.slice(1),
    attaches: [], flagWrites: [], hide: [], show: [], fieldWrites: [], boxes: [], modes: [], shiny: [], ctorModes: [], ctorShiny: [], cutscenes: [], hudHints: [], globalWrites: [], varWrites: [], ctrlFlags: [], waypointMaps: [], places: [], controllers: [],
    shadow: null, fogCalls: [], fog: [], seaLevel: null, gravity: null, groundRecord: null, groundName: null, focusRecord: null, accessoryRecord: null, dynamic: {}, unresolved: [],
  };
  const ctx: Ctx = { pe, starts, code, out, visits: new Map(), seen: new Set(), names: new Map(), places: new Set(), notes: new Set() };
  walk(ctx, code.root, [], [], 0);
  for (const k of ['attaches', 'flagWrites', 'fieldWrites', 'boxes', 'modes', 'cutscenes', 'hudHints', 'globalWrites', 'varWrites', 'ctrlFlags', 'waypointMaps', 'places', 'controllers', 'fogCalls'] as const) {
    const seen = new Set<string>();
    (out[k] as { at: number; fn?: number; cond?: Cond[] }[]) = (out[k] as { at: number; fn?: number; cond?: Cond[] }[]).filter((e) => {
      const key = JSON.stringify(e, (kk, v) => (kk === 'fn' ? undefined : v));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  for (const f of out.flagWrites) {
    if (f.op === 'and' && (f.mask & 2) === 0) out.hide.push(f);
    else if (f.op === 'or' && (f.mask & 2) !== 0) out.show.push(f);
  }
  // well-known globals: the unconditional store, else the first
  const pick = (addr: number): GlobalWrite | null => {
    const all = out.globalWrites.filter((g) => g.addr === addr);
    return all.find((g) => !g.cond.length && !g.loop) ?? all[0] ?? null;
  };
  const sea = pick(GLOBALS.SEA_LEVEL); if (sea) out.seaLevel = sea.float;
  const grav = pick(GLOBALS.GRAVITY); if (grav) out.gravity = grav.float;
  const foc = pick(GLOBALS.FOCUS); if (foc && foc.recordPtr !== null) out.focusRecord = Math.floor(foc.recordPtr / RECORD_STRIDE);
  const acc = pick(GLOBALS.ACCESSORY); if (acc && acc.value !== null && (acc.value | 0) >= 0) out.accessoryRecord = acc.value | 0;   // -1 = none (z21FSH)
  try { out.fog = extractRenderParams(pe, code.builder).fog; } catch { /* keep empty */ }
  out.shadow = extractShadowSetup(pe, code, starts);
  // render modes / shiny switches the attached nodes' constructors make while FUN_00423532 builds them (appended after the set-up code's own: the constructor runs at its attach site)
  if (opts.ctorRender) { const ctorRender = extractCtorRenderCalls(pe, code, starts, out.attaches, { modes: out.modes, shiny: out.shiny }); out.ctorModes = ctorRender.modes; out.ctorShiny = ctorRender.shiny; }
  if (scene) out.groundName = out.groundRecord !== null ? scene.records[out.groundRecord]?.name ?? null : null;
  return out;
}

/** every zone archive the executable has code for */
export const ZONE_ARCHIVES = ['z01BPK', 'z02LGI', 'z03PPH', 'z04IFC', 'z05WAB', 'z07CSI', 'z08BKD', 'z09JST', 'z10RGB', 'z13CAI', 'z14OSD', 'z15SSH', 'z16PYA', 'z17WAS', 'z18MMP', 'z20DSP', 'z21FSH', 'z22BIP', 'z23DIP', 'z27TRX', 'z28HAT', 'z36CNT', 'z38PAR', 'z39ASB', 'z40aPO', 'z40OGL', 'z41MAP', 'z42BRP', 'z50LTC', 'z60FRE'];

// ---------------------------------------------------------------------------------------------------
// evaluating conditions

/** true / false, or undefined when the condition is about something the port does not model (a call result, a global ...) */
export function evalCond(c: Cond, getVar: (v: number) => number): boolean | undefined {
  if (c.src !== 'var') return undefined;
  const x = getVar(c.id) | 0, v = c.value as number;
  return c.op === '==' ? x === v : c.op === '!=' ? x !== v : c.op === '<' ? x < v : c.op === '>=' ? x >= v : c.op === '<=' ? x <= v : x > v;
}
/** all conditions hold (name conditions are ignored: they belong to record loops); unknown conditions count as not holding unless `unknown` is true */
export function condsHold(cs: Cond[], getVar: (v: number) => number, unknown = false): boolean {
  for (const c of cs) {
    if (c.src === 'name') continue;
    const r = evalCond(c, getVar);
    if (r === false || (r === undefined && !unknown)) return false;
  }
  return true;
}
/**
 * The entries that apply for the game variables `getVar` returns (e.g. the island's story state 0x58). Code that several paths reach has one entry per path:
 * an entry that is identical to an earlier active one (same call / store, same values) counts once.
 */
export function activeEntries<T extends Base>(list: T[], getVar: (v: number) => number, unknown = false): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const e of list) {
    if (!condsHold(e.cond, getVar, unknown)) continue;
    const k = JSON.stringify(e, (kk, v) => (kk === 'cond' ? undefined : v));
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}
/** the record name pattern a record loop entry is restricted to ('ROCK', or 'PAG?' when only the first three characters are tested), or null (one record / no name test) */
export function nameOfEntry(e: Pick<Base, 'cond'>): string | null {
  const p = ['?', '?', '?', '?'];
  let any = false;
  for (const c of e.cond) {
    if (c.src !== 'name' || c.op !== '==') continue;
    const v = c.value as string;
    for (let i = 0; i < v.length && c.id + i < 4; i++) { if (v.charCodeAt(i) !== 0) p[c.id + i] = v[i]; }
    any = true;
  }
  return any ? p.join('') : null;
}
/** does a record name match a pattern of `nameOfEntry` (`?` matches any character; names are compared over 4 characters) */
export function nameMatches(pattern: string, name: string): boolean {
  for (let i = 0; i < 4; i++) if (pattern[i] !== '?' && pattern[i] !== (name[i] ?? '\0')) return false;
  return true;
}
/** record indices hidden after the set-up ran (flag writes applied in code order against the game variables; records `names` selects by name for loops) */
export function hiddenRecords(s: ZoneSetup, getVar: (v: number) => number, names?: (string | undefined)[]): number[] {
  const hidden = new Set<number>();
  for (const w of activeEntries(s.flagWrites, getVar)) {
    const pat = w.record < 0 ? nameOfEntry(w) : null;
    const idx = w.record >= 0 ? [w.record] : names && pat ? names.flatMap((n, i) => (n !== undefined && nameMatches(pat, n) ? [i] : [])) : [];
    for (const i of idx) {
      if (w.op === 'and' && (w.mask & 2) === 0) hidden.add(i);
      else if (w.op === 'or' && (w.mask & 2) !== 0) hidden.delete(i);
      else if (w.op === 'set') { if (w.mask & 2) hidden.delete(i); else hidden.add(i); }
    }
  }
  return [...hidden];
}
