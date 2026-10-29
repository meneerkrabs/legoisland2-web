// The island's set-up, RUN out of the user's executable (docs/re/m4/emu.md). `emulateIslandSetup` executes the original FUN_004b6475 (and everything it
// calls inside the island's code region and the C runtime) on the concrete x86 interpreter of x86emu.ts for the ACTUAL game variables of `env.vars`
// (var 0x58 = story node selects the era, 0x4f the house / brick count ...). Engine functions are replaced by host functions (the table `HOST` below)
// that log what they were called with; the record array is built in emulated memory from the scene, so the record writes of the original code (flags,
// positions, Euler angles, variant) are visible afterwards (`records`, `changed`).
//
// Pointer conventions (for reading the logged argument blocks):
//   * record i lives at RECORDS_BASE + i * 0x68 (`recIndexOfPtr(ptr)` -> i or -1, `recFieldOfPtr(ptr)` -> { record, field }); the record layout is
//     architecture.md 4.1 / `RF` of zonesetup.ts (matrix +0x0c with the translation at +0x3c, Euler +0x4c, flags +0x60, variant +0x64);
//   * pointers into the EXE image (strings, tables in .rdata / .data: 0x400000 ... 0x5df1000) can be read with `pe` (`pe.cstr`, `pe.u32`), or, with the
//     values the set-up stored into .data, with `IslandSetup.mem` (the emulated memory after the run);
//   * heap blocks (HEAP_BASE ...: controllers, nodes, dictionaries, waypoint arrays, allocations of the set-up code) and stack addresses (STACK_TOP - ...)
//     only make sense inside `mem`; a stack pointer inside a snapshot (`args`) points at a frame that is gone after the call.
//   * `args` of an attach = the 0x80 bytes the argument pointer pointed at, at the time of the call (zeros when the argument is not a mapped pointer).
// Nothing of the executable is stored in this file except addresses (with comments).
import type { Pe, ZoneScene } from './exe.ts';
import type { Archive } from './archive.ts';
import { Cpu, Memory, createCpu, EmuError } from './x86emu.ts';
import type { HostFn } from './x86emu.ts';
import { zoneCodeIndex, ctorName as ctorNameOf, RECORD_STRIDE, RF, GLOBALS, FN } from './zonesetup.ts';
import type { ZoneSetup, Attach, FlagWrite, FieldWrite, Box, RenderMode, Cutscene, HudHint, VarWrite, CtrlFlags, WaypointMap, Place } from './zonesetup.ts';

// ---------------------------------------------------------------------------------------------------
// memory layout of the emulation (outside the EXE image)

export const RECORDS_BASE = 0x10000000;
export const HEAP_BASE = 0x20000000, HEAP_SIZE = 0x4000000;
/** handles of files opened by the hosted FUN_0043bfb7 */
const FILE_BASE = 0x30000000;

/** the game-variable array DAT_008a2d2c (319 int32; FUN_00417575 / FUN_00417597 read and write it, some code writes it directly) */
export const VAR_ARRAY = 0x8a2d2c, VAR_COUNT = 319;

/** the island's set-up root and the functions around it (NL build) */
export const ISLAND = {
  /** FUN_004b6475: the island's set-up (calls the loader, the story handler, the era sets) */
  ROOT: 0x4b6475,
  /** FUN_004f645b: the loader (meshes, collision files: hooked as a no-op, the records come from the scene) */
  LOADER: 0x4f645b,
  /** FUN_004b7040(&a, &b, node): the story handler (calls made while it runs are `storyHandler`) */
  STORY: 0x4b7040,
  /** FUN_00523200: builds the SWITCH_LGI_* name dictionary */
  SWITCH_DICT: 0x523200,
  /** era roster functions (era 0..3; era 4 runs era 0's) */
  ERAS: [0x4c0ca9, 0x4c070c, 0x4c015e, 0x4bfd7d, 0x4c0ca9],
} as const;
/** the C runtime of the build (strncmp, memset, sprintf ... run natively) */
const CRT: [number, number] = [0x858d30, 0x873e00];

/** engine functions that are pure data / bookkeeping and run natively (everything else outside the zone region and the CRT is hosted) */
const NATIVE_ENGINE: number[] = [
  0x4177ed,   // FUN_004177ed: clears the zone-local game variables 0xfa..0x13e (direct writes into DAT_008a2d2c)
  0x4630c0,   // FUN_004630c0: loads a compiled waypoint map (file functions hosted below) - Common\WayPt\Load.c
  0x462be9,   // FUN_00462be9(map, node, dest): copies a waypoint node position
  0x4236f3,   // FUN_004236f3(node, var, mask, value): changes the gate of an attached node (the hosted attach's node block, see EmuAttach.gate)
  0x43a4a1,   // FUN_0043a4a1(m, rx, ry, rz): rotation matrix (CRT sin / cos)
  0x43a5e4,   // FUN_0043a5e4(m, rx, ry, rz, px, py, pz): record matrix
  0x43a742,   // FUN_0043a742(m, rx, ry, rz, px, py, pz, sx, sy, sz)
  0x43cec0,   // FUN_0043cec0(v): normalise in place (CRT sqrt; the arrival code's harbour / helipad offsets, WP10)
];

// ---------------------------------------------------------------------------------------------------
// result types

export interface EmuCall {
  /** called address and its name in the host table (or `FUN_xxxxxxxx`) */
  fn: number; name: string;
  /** stack arguments (the count is the host table's, else read from the caller's `add esp, n`) */
  args: number[];
  /** address of the call instruction, the function it was made from */
  at: number; caller: number;
  /** made while the story handler FUN_004b7040 ran */
  story: boolean;
  /** extra labelled data (strings the arguments point at ...) */
  info?: Record<string, unknown>;
}
export interface EmuAttach extends Attach {
  /** the 0x80 bytes the argument pointed at when the node was attached (zeros when `arg` is not a pointer into mapped memory) */
  args: Uint8Array;
  /** the record had a controller (FUN_00423532 does nothing without one) */
  hasController: boolean;
  /** the node block the hosted attach returned (heap address; `nodeBytes` = its 0x40 bytes after the whole set-up ran: fields the set-up wrote afterwards) */
  node: number; nodeBytes?: Uint8Array;
  /** controller flags (FUN_004238b7) set on the record's controller before this attach, if any */
  ctrlFlags?: number;
  /** made while the story handler ran */
  story: boolean;
  /** the gate the node has after the whole set-up when code changed it after the attach (FUN_004236f3); `toZoneSetup` uses it */
  gate?: { var: number; mask: number; value: number };
}
/** one store of the original code into a record field (`at` = the store instruction) */
export interface RecordStore { record: number; field: number; size: number; value: number; at: number; fn: number; story: boolean }
export interface EmuRecord { name: string; flags: number; variant: number; pos: [number, number, number]; euler: [number, number, number] }
export interface RecordChange { record: number; name: string; field: 'flags' | 'variant' | 'pos' | 'euler' | 'name' | 'matrix'; from: unknown; to: unknown }
export interface EmuVarWrite { var: number; op: 'set' | 'add' | 'or' | 'andnot' | 'direct'; value: number; before: number; after: number; at: number; caller: number }
export interface IslandSetup {
  node: number; era: number;
  attaches: EmuAttach[];
  /** final record state (index = record index) and what changed against the scene */
  records: EmuRecord[]; changed: RecordChange[];
  /** every store into the record array, in execution order */
  stores: RecordStore[];
  boxes: Box[]; modes: RenderMode[];
  cutscenes: (Cutscene & { area: string | null; zoneDir: string | null })[];
  /** FUN_0045c310(n) calls: the number of cutscene slots */
  cutsceneSlots: number[];
  hudHints: HudHint[];
  varWrites: EmuVarWrite[];
  waypointMaps: WaypointMap[]; places: Place[];
  controllers: { record: number; ctrl: number; at: number }[];
  ctrlFlags: CtrlFlags[];
  /** name -> value dictionaries built with FUN_0045bf20 / FUN_0045bff4, by the function that built them; `switches` = FUN_00523200 (SWITCH_LGI_*), `anims` = the PEP_ animation names */
  dictionaries: { switches: Map<string, number>; anims: Map<string, number>; all: EmuDict[] };
  /** the calls of the story handler FUN_004b7040 (hosted / unhooked engine calls, in order) */
  storyHandler: EmuCall[];
  /** WP9: the FX_Bricks calls of the vehicle roster FUN_0051c823 (PepSwitc's constructor FUN_004bbef8 calls it when the era set builds Pepper's node
   *  chain, right after the era set's own brick effects). Run after the set-up with record writes / render modes discarded (only the brick calls kept). */
  vehicleRoster: EmuCall[];
  /** every hosted / unhooked call in order */
  calls: EmuCall[];
  /** engine functions without a host entry that were called (logged, returned 0) */
  unhooked: { fn: number; count: number; callers: number[] }[];
  /** the emulated memory after the run (follow pointers of argument blocks / nodes) */
  mem: Memory;
  steps: number; ms: number;
  /** the same data in the shapes of the symbolic extraction (`cond: []` everywhere: the code ran for concrete variables), for `setupZone` */
  toZoneSetup(): ZoneSetup;
}
/** a TDict built with FUN_0045bf20(capacity - 1) / FUN_0045bff4(dict, name, value) */
export interface EmuDict {
  handle: number; builtBy: number; at: number; capacity: number;
  entries: Map<string, number>;
  /** adds of a name that was already there (kept: the first) */
  duplicates: number;
  /** names added after the dictionary was full (capacity - 1 entries): the original drops them */
  dropped: string[];
}
export interface EmuEnv {
  vars: { get(i: number): number; set(i: number, v: number): void };
  /** the zone's archive (z02LGI): files the set-up opens (compiled waypoint maps) are read from it */
  archive?: Archive;
  maxSteps?: number;
  /** extra host functions (address -> host), applied over the built-in table */
  hooks?: Map<number, HostFn>;
}

/** record index of a pointer into the emulated record array (any field), -1 otherwise */
export function recIndexOfPtr(ptr: number, count = 0x10000): number {
  const o = (ptr >>> 0) - RECORDS_BASE;
  if (o < 0 || o >= count * RECORD_STRIDE) return -1;
  return Math.floor(o / RECORD_STRIDE);
}
/** record index + byte offset inside the record of a pointer into the record array, or null */
export function recFieldOfPtr(ptr: number, count = 0x10000): { record: number; field: number } | null {
  const r = recIndexOfPtr(ptr, count);
  return r < 0 ? null : { record: r, field: (ptr >>> 0) - RECORDS_BASE - r * RECORD_STRIDE };
}
const hex = (v: number) => '0x' + (v >>> 0).toString(16);

// ---------------------------------------------------------------------------------------------------

/** the era (0..4) FUN_004b6475 selects for story node `node` (game var 0x58) */
export function eraOfNode(node: number): number { return node < 7 ? 0 : node < 0x1e ? 1 : node < 0x34 ? 2 : node < 0x3d ? 3 : 4; }

/** names of the host table (address -> name; the ones with a host function are implemented in `emulateIslandSetup`) */
export const HOST_NAMES: Record<number, string> = {
  0x417575: 'getVar', 0x417597: 'setVar', 0x4175ca: 'addVar', 0x41761b: 'orVar', 0x41766c: 'andNotVar', 0x41ad80: 'getSaveVar',
  0x423532: 'attach', 0x42382c: 'createController', 0x4238b7: 'ctrlFlags', 0x423716: 'ctrlNop', 0x4237b6: 'setCreateMode',
  0x4427e0: 'boxFile', 0x4428b0: 'boxRadiusHeight', 0x442780: 'boxDims', 0x444550: 'renderMode', 0x4425e0: 'groundRecord', 0x442d90: 'fog',
  0x45c310: 'cutsceneSlots', 0x45c366: 'cutsceneDir', 0x45c397: 'cutscene', 0x45c432: 'cutsceneActive',
  0x424029: 'hudHint', 0x424270: 'hintTarget', 0x424230: 'hintTarget2', 0x42419f: 'hintBox', 0x4242b9: 'hintRecord',
  0x423fe0: 'textFile', 0x423ff6: 'textFileFree', 0x88d280: 'textFile2', 0x88d296: 'textFile2Free', 0x88d2bc: 'textFile2Angle',
  0x4630c0: 'loadWaypoints', 0x462be9: 'waypointPos', 0x46140f: 'walkerPlace', 0x4625d7: 'walkerNode', 0x4614d5: 'walkerCreate',
  0x45bf20: 'dictCreate', 0x45bff4: 'dictAdd', 0x43b6a3: 'animStart', 0x429638: 'fn429638',
  0x433d38: 'alloc', 0x858d30: 'malloc', 0x43bfb7: 'fileOpen', 0x43c1a0: 'fileRead', 0x43c22e: 'fileClose',
  0x85abc0: '__chkesp', 0x4f645b: 'loader', 0x4236f3: 'setNodeGate', 0x42401c: 'hudSelect', 0x42407f: 'hudItem', 0x4446c0: 'partFlags',
  0x447cc0: 'brickFxInit', 0x447da0: 'brickMorphLoad', 0x447d70: 'brickFx447d70', 0x447d20: 'brickFx447d20', 0x447f00: 'brickFx447f00', 0x447ed0: 'brickFx447ed0',
  0x442900: 'particlesLoad', 0x442960: 'particleEmitter', 0x43f160: 'modelPart', 0x444530: 'partSetup', 0x43ebe0: 'partUv', 0x4430f0: 'backdrop',
  0x46063b: 'overlayLoad', 0x422b50: 'cameraPlace', 0x44e8d0: 'particlesReset',
};

export function emulateIslandSetup(pe: Pe, scene: ZoneScene, env: EmuEnv): IslandSetup {
  const t0 = performance.now();
  const code = zoneCodeIndex(pe).get('z02lgi');
  if (!code) throw new Error('emusetup: no island code in this executable');
  const cpu = createCpu(pe);
  const mem = cpu.mem;
  const n = scene.records.length;
  mem.addRegion({ lo: RECORDS_BASE, hi: RECORDS_BASE + Math.max(1, n) * RECORD_STRIDE + 0x1000, name: 'records' });
  mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + HEAP_SIZE, name: 'heap' });
  let heap = HEAP_BASE;
  const alloc = (size: number): number => {
    const p = heap;
    heap = (heap + Math.max(4, size) + 15) & ~15;
    if (heap > HEAP_BASE + HEAP_SIZE) throw new Error('emusetup: emulated heap exhausted');
    return p;
  };

  // --- records (zone.ts buildRecords: flags = scene flags || 2, matrix / Euler from the builder)
  const initial: EmuRecord[] = [];
  for (const r of scene.records) {
    const a = RECORDS_BASE + r.index * RECORD_STRIDE;
    for (let k = 0; k < 4; k++) mem.w8(a + k, r.name.charCodeAt(k) || 0);
    if (r.model) mem.w32(a + RF.MODEL, alloc(0x40));
    for (let k = 0; k < 16; k++) mem.wf32(a + RF.MATRIX + 4 * k, r.matrix[k]);
    for (let k = 0; k < 3; k++) mem.wf32(a + RF.EULER + 4 * k, r.rot[k]);
    if (r.col >= 0) mem.w32(a + RF.COL, alloc(0x80));
    mem.w16(a + RF.FLAGS, r.flags || 2);
  }
  const readRecord = (i: number): EmuRecord => {
    const a = RECORDS_BASE + i * RECORD_STRIDE;
    return {
      name: mem.cstr(a, 4), flags: mem.r16(a + RF.FLAGS), variant: mem.u32(a + RF.VARIANT),
      pos: [mem.f32(a + RF.X), mem.f32(a + RF.Y), mem.f32(a + RF.Z)], euler: [mem.f32(a + RF.EULER), mem.f32(a + RF.EULER + 4), mem.f32(a + RF.EULER + 8)],
    };
  };
  for (let i = 0; i < n; i++) initial.push(readRecord(i));
  const matrix0 = mem.read(RECORDS_BASE, n * RECORD_STRIDE);
  mem.w32(GLOBALS.RECORD_COUNT, n);
  mem.w32(GLOBALS.RECORDS, RECORDS_BASE);
  const recOf = (p: number) => recIndexOfPtr(p, n);
  // every store of the original code into the record array (in order; `flagWrites` / `fieldWrites` of toZoneSetup)
  const stores: RecordStore[] = [];
  mem.wlo = RECORDS_BASE; mem.whi = RECORDS_BASE + n * RECORD_STRIDE;
  mem.onWrite = (a, size, v) => {
    if (cpu.frames.includes(ISLAND.LOADER)) return;   // the loader's animation instances (rec + 8)
    const r = Math.floor((a - RECORDS_BASE) / RECORD_STRIDE);
    stores.push({ record: r, field: a - RECORDS_BASE - r * RECORD_STRIDE, size, value: v, at: mem.eip, fn: cpu.frames[cpu.frames.length - 1] ?? 0, story: cpu.frames.includes(ISLAND.STORY) });
  };

  // --- game variables: the array mirrors env.vars (hosted get / set keep both in step; direct writes are diffed after the run)
  const vars0: number[] = [];
  for (let i = 0; i < VAR_COUNT; i++) { const v = env.vars.get(i) | 0; vars0.push(v); mem.w32(VAR_ARRAY + 4 * i, v); }
  const getVar = (i: number) => (i >= 0 && i < VAR_COUNT ? mem.r32(VAR_ARRAY + 4 * i) : env.vars.get(i) | 0);
  const varWrites: EmuVarWrite[] = [];
  const putVar = (i: number, v: number, op: EmuVarWrite['op']) => {
    const before = getVar(i);
    if (i >= 0 && i < VAR_COUNT) mem.w32(VAR_ARRAY + 4 * i, v);
    env.vars.set(i, v | 0);
    varWrites.push({ var: i, op, value: v | 0, before, after: v | 0, at: cpu.callAt, caller: caller() });
  };

  // --- logging
  const storyDepth = () => cpu.frames.includes(ISLAND.STORY);
  const caller = () => cpu.frames[cpu.frames.length - 1] ?? 0;
  const calls: EmuCall[] = [];
  const argCount = (): number => {
    // the caller's `add esp, n` right after the call (cdecl); 0 when there is none
    const r = cpu.retAddr;
    if (mem.r8(r) === 0x83 && mem.r8(r + 1) === 0xc4) return mem.r8(r + 2) >> 2;
    if (mem.r8(r) === 0x81 && mem.r8(r + 1) === 0xc4) return mem.u32(r + 2) >> 2;
    return 0;
  };
  const inLoader = () => cpu.frames.includes(ISLAND.LOADER);
  const log = (fn: number, nargs: number, info?: Record<string, unknown>): EmuCall | null => {
    if (fn !== 0x45bf20 && fn !== 0x45bff4 && inLoader()) return null;   // the loader's mesh / texture / model calls are not set-up data
    const args: number[] = [];
    for (let i = 0; i < nargs; i++) args.push(cpu.arg(i));
    const c: EmuCall = { fn, name: HOST_NAMES[fn] ?? `FUN_${fn.toString(16).padStart(8, '0')}`, args, at: cpu.callAt, caller: caller(), story: storyDepth() };
    if (info) c.info = info;
    calls.push(c);
    return c;
  };
  const unhooked = new Map<number, { fn: number; count: number; callers: Set<number> }>();
  const str = (p: number) => (p && mem.mapped(p) ? mem.cstr(p) : null);

  // --- results
  const attaches: EmuAttach[] = [];
  const boxes: Box[] = [], modes: RenderMode[] = [], hudHints: HudHint[] = [];
  const cutscenes: IslandSetup['cutscenes'] = [];
  const cutsceneSlots: number[] = [];
  let csDir: string | null = null, csArea: string | null = null;
  const controllers: IslandSetup['controllers'] = [];
  const ctrlFlags: CtrlFlags[] = [];
  const ctrlOwner = new Map<number, number>();
  const waypointMaps: WaypointMap[] = [], places: Place[] = [];
  const dicts = new Map<number, EmuDict>();
  const base = (at: number) => ({ at, fn: caller(), cond: [] });
  const ctorNames = new Map<number, string | null>();
  const ctorName = (c: number) => { if (!ctorNames.has(c)) ctorNames.set(c, ctorNameOf(pe, c)); return ctorNames.get(c)!; };

  const H = new Map<number, HostFn>();
  // game variables
  H.set(FN.GET_VAR, (c) => { c.eax = getVar(c.arg(0) | 0); });
  H.set(0x41ad80, (c) => { c.eax = getVar(c.arg(0) | 0); });   // FUN_0041ad80(i): the save-game copy when DAT_009d9c19 == 1, else the variable (the port has one set)
  H.set(FN.SET_VAR, (c) => { const i = c.arg(0) | 0; if (i !== 1 && i !== 2) putVar(i, c.arg(1), 'set'); });
  H.set(FN.ADD_VAR, (c) => { const i = c.arg(0) | 0; if (i === 1 || i === 2) { c.eax = getVar(i); return; } putVar(i, (getVar(i) + (c.arg(1) | 0)) | 0, 'add'); c.eax = getVar(i); });
  H.set(FN.OR_VAR, (c) => { const i = c.arg(0) | 0; if (i !== 1 && i !== 2) putVar(i, getVar(i) | c.arg(1), 'or'); c.eax = getVar(i); });
  H.set(FN.ANDNOT_VAR, (c) => { const i = c.arg(0) | 0; if (i !== 1 && i !== 2) putVar(i, getVar(i) & ~c.arg(1), 'andnot'); c.eax = getVar(i); });
  // memory
  H.set(0x433d38, (c) => { const p = alloc(c.arg(0)); c.eax = p; });   // FUN_00433d38(size, 1, file, line): SDMem2 allocator
  H.set(0x858d30, (c) => { c.eax = alloc(c.arg(0)); });                // CRT malloc
  H.set(0x85abc0, (c) => { if (!c.zf) throw new EmuError(`emusetup: __chkesp failed after the call before ${hex(c.retAddr)} (a host function popped the wrong number of bytes?)`, c.retAddr, c.lastSteps()); });
  // the loader runs natively (it builds the animation-name dictionary DAT_05d4d484 between its mesh / texture calls, which fall back to 0);
  // the builder it calls is a no-op: the records come from the scene
  H.set(code.builder, () => { mem.w32(GLOBALS.RECORD_COUNT, n); mem.w32(GLOBALS.RECORDS, RECORDS_BASE); });   // the loader allocated its own array before
  // controllers and nodes
  H.set(FN.CREATE_CTRL, (c) => {
    const rp = c.arg(0), r = recOf(rp);
    log(FN.CREATE_CTRL, 1);
    if (mem.r32(0x8adc74) === 0) return;   // DAT_008adc74 == 0: re-initialise mode, no allocation (FUN_0042382c)
    const p = alloc(0x68);
    mem.w32(p + 0xc, 6); mem.w32(p + 0x1c, 0x44000000); mem.w32(p + 0x60, 0xbf800000);
    mem.w32(rp + RF.CTRL, p);
    ctrlOwner.set(p, r);
    controllers.push({ record: r, ctrl: p, at: c.callAt });
  });
  H.set(FN.SET_CTRL_FLAGS, (c) => {
    const p = c.arg(0), v = c.arg(1);
    log(FN.SET_CTRL_FLAGS, 2);
    if (p && mem.mapped(p)) mem.w32(p + 0xc, v);
    ctrlFlags.push({ ...base(c.callAt), record: ctrlOwner.get(p) ?? -1, flags: v });
  });
  H.set(0x4237b6, (c) => { log(0x4237b6, 1); mem.w32(0x9da5cc, 0); mem.w32(0x8adc74, c.arg(0)); });   // FUN_004237b6(mode): DAT_008adc74
  H.set(0x423716, () => { log(0x423716, 0); });
  H.set(FN.ATTACH, (c) => {
    const rp = c.arg(0), ctor = c.arg(1), arg = c.arg(2), pos = c.arg(3) | 0, v = c.arg(4) | 0, mask = c.arg(5) & 0xffff, value = c.arg(6) & 0xffff;
    log(FN.ATTACH, 7);
    const record = recOf(rp);
    const args = new Uint8Array(0x80);
    let argWords: number[] | undefined;
    if (arg >= 0x10000 && mem.mapped(arg) && mem.mapped(arg + 0x7f)) { args.set(mem.read(arg, 0x80)); argWords = []; for (let k = 0; k < 0x80; k += 4) argWords.push(mem.u32(arg + k)); }
    const ctrl = record >= 0 ? mem.u32(rp + RF.CTRL) : 0;
    let node = 0;
    if (ctrl) {
      node = alloc(0x40);
      mem.w32(node, v); mem.w32(node + 8, 0xfffffffe); mem.w16(node + 0xc, mask); mem.w16(node + 0xe, value);
    }
    const flags = ctrlFlags.filter((f) => f.record === record && record >= 0).pop();
    const at: EmuAttach = { ...base(c.callAt), record, ctor, ctorName: ctorName(ctor), arg, argWords, pos, var: v, mask, value, args, hasController: !!ctrl, node, story: storyDepth() };
    if (flags) at.ctrlFlags = flags.flags;
    attaches.push(at);
    c.eax = node;
  });
  // colliders, render modes, terrain, fog
  H.set(FN.BOX_FILE, (c) => { log(FN.BOX_FILE, 1); boxes.push({ ...base(c.callAt), record: recOf(c.arg(0)), kind: 'file', dims: [] }); });
  H.set(FN.BOX_RADIUS_HEIGHT, (c) => { log(FN.BOX_RADIUS_HEIGHT, 3); boxes.push({ ...base(c.callAt), record: recOf(c.arg(0)), kind: 'radiusHeight', dims: [c.argf(1), c.argf(2)] }); });
  H.set(FN.BOX_DIMS, (c) => { log(FN.BOX_DIMS, 4); boxes.push({ ...base(c.callAt), record: recOf(c.arg(0)), kind: 'dims', dims: [c.argf(1), c.argf(2), c.argf(3)] }); });
  H.set(FN.RENDER_MODE, (c) => { log(FN.RENDER_MODE, 3); modes.push({ ...base(c.callAt), record: recOf(c.arg(0)), partMask: c.arg(1), mode: c.arg(2) }); });
  H.set(FN.GROUND, (c) => { log(FN.GROUND, 1, { record: recOf(c.arg(0)) }); });
  H.set(FN.SETUP_FOG, () => { log(FN.SETUP_FOG, 6); });
  // cutscenes
  H.set(0x45c310, (c) => { log(0x45c310, 1); cutsceneSlots.push(c.arg(0)); });
  H.set(0x45c366, (c) => { csDir = str(c.arg(0)); csArea = str(c.arg(1)); log(0x45c366, 2, { zoneDir: csDir, area: csArea }); });
  H.set(FN.CUTSCENE, (c) => {
    const name = str(c.arg(1)), messages = str(c.arg(2));
    log(FN.CUTSCENE, 3, { name, messages });
    cutscenes.push({ ...base(c.callAt), slot: c.arg(0) | 0, name, messages, area: csArea, zoneDir: csDir });
  });
  H.set(0x45c432, (c) => { c.eax = 0; });   // FUN_0045c432: a cutscene is running -> no
  // HUD / hints / text files of the story handler (logged with labels; the globals they set are run-time state)
  H.set(FN.HUD_HINT, (c) => { log(FN.HUD_HINT, 6); hudHints.push({ ...base(c.callAt), index: c.arg(0) | 0, a: c.arg(1) | 0, b: c.arg(2) | 0, c: c.arg(3) | 0, d: c.arg(4) | 0, scale: c.argf(5) }); });
  H.set(0x424270, (c) => { log(0x424270, 2, { record: recOf(c.arg(0)), target: c.arg(0), radius: c.argf(1) }); });                     // objective arrow at a record (0 = off)
  H.set(0x424230, (c) => { log(0x424230, 3, { record: recOf(c.arg(0)), b: c.arg(1), radius: c.argf(2) }); });
  H.set(0x42419f, (c) => { log(0x42419f, 4, { a: c.arg(0), b: c.arg(1), c: c.argf(2), d: c.argf(3) }); });
  H.set(0x4242b9, (c) => { log(0x4242b9, 2, { record: recOf(c.arg(0)), radius: c.argf(1) }); });
  // FX_Bricks registrations of the era sets (WP9, src/fx/bricks): FUN_00447d20 returns the effect slot the manager gives (in order from FUN_00447cc0),
  // FUN_00447d70's 24-word parameter block lives on the caller's stack, so it is copied here (info.params: raw 32-bit words, floats and ints mixed)
  let brickSlot = 0;
  H.set(0x447cc0, (c) => { log(0x447cc0, 1); brickSlot = 0; c.eax = 1; });
  H.set(0x447d20, (c) => { log(0x447d20, 2, { record: recOf(c.arg(0)), var: c.arg(1), slot: brickSlot }); c.eax = brickSlot++; });
  H.set(0x447da0, (c) => { log(0x447da0, 3, { slot: c.arg(0), file: str(c.arg(1)) }); });
  H.set(0x447d70, (c) => {
    const p = c.arg(3), params: number[] = [];
    for (let k = 0; k < 24; k++) params.push(p && mem.mapped(p + 4 * k) ? mem.u32(p + 4 * k) : 0);
    log(0x447d70, 5, { slot: c.arg(0), stage: c.arg(1), fn: c.arg(2), params, vis: c.arg(4) });
  });
  H.set(0x447ed0, (c) => { log(0x447ed0, 2, { slot: c.arg(0), delay: c.argf(1) }); });
  H.set(0x423fe0, (c) => { log(0x423fe0, 1, { file: str(c.arg(0)) }); });
  H.set(0x88d280, (c) => { log(0x88d280, 1, { file: str(c.arg(0)) }); });
  H.set(0x423ff6, () => { log(0x423ff6, 0); });
  H.set(0x88d296, () => { log(0x88d296, 0); });
  H.set(0x88d2bc, () => { log(0x88d2bc, 0); });
  // name dictionaries (TDict): the original layout, plus a Map per handle
  H.set(0x45bf20, (c) => {
    const cap = ((c.arg(0) & 0xffff) + 1) & 0xffff;
    log(0x45bf20, 1);
    const h = alloc(8), e = alloc(cap * 8);
    mem.w16(h, 0); mem.w16(h + 2, cap); mem.w32(h + 4, e);
    for (let k = 0; k < cap; k++) { mem.w32(e + k * 8, 0); mem.w16(e + k * 8 + 4, 0xffff); }
    dicts.set(h, { handle: h, builtBy: caller(), at: c.callAt, capacity: cap, entries: new Map(), duplicates: 0, dropped: [] });
    c.eax = h;
  });
  H.set(0x45bff4, (c) => {
    const h = c.arg(0), np = c.arg(1), v = c.arg(2) & 0xffff;
    const name = str(np) ?? '';
    log(0x45bff4, 3, { name });
    const cnt = mem.r16(h), cap = mem.r16(h + 2);
    const d = dicts.get(h);
    if (cnt + 1 < cap) {
      const e = mem.u32(h + 4) + cnt * 8;
      mem.w32(e, np); mem.w16(e + 4, v);
      mem.w16(h, cnt + 1);
      // the first entry of a name wins (the lookup scans from the start); entries beyond the capacity are dropped by the original
      if (d && !d.entries.has(name)) d.entries.set(name, v);
      else if (d) d.duplicates++;
    } else if (d) d.dropped.push(name);
  });
  // files (the compiled waypoint maps FUN_004630c0 reads): opened from the zone's archive
  const files = new Map<number, { data: Uint8Array; pos: number; path: string }>();
  let nextFile = FILE_BASE;
  H.set(0x43bfb7, (c) => {
    const path = str(c.arg(0)) ?? '';
    log(0x43bfb7, 1, { path });
    const member = path.replace(/^\.?[\\/]*_data[\\/]+z02lgi[\\/]+/i, '').replace(/\\/g, '/');
    const e = env.archive?.find(member);
    if (!e) { c.eax = 0; return; }
    const h = (nextFile += 0x10);
    files.set(h, { data: env.archive!.read(e), pos: 0, path });
    c.eax = h;
  });
  H.set(0x43c1a0, (c) => {
    const f = files.get(c.arg(0)), dst = c.arg(1), len = c.arg(2);
    if (!f) { c.eax = 0; return; }
    const k = Math.max(0, Math.min(len, f.data.length - f.pos));
    mem.write(dst, f.data.subarray(f.pos, f.pos + k));
    f.pos += k;
    c.eax = k;
  });
  H.set(0x43c22e, (c) => { files.delete(c.arg(0)); });
  // the named engine functions without an own host: logged with their arguments, return 0
  for (const k of Object.keys(HOST_NAMES)) {
    const a = +k;
    if (H.has(a) || a === ISLAND.LOADER || NATIVE_ENGINE.includes(a)) continue;
    H.set(a, () => { log(a, argCount() || 0); cpu.eax = 0; });
  }
  for (const [a, h] of env.hooks ?? []) H.set(a, h);
  cpu.hooks = H;

  // natively executed functions that are logged on entry (watches)
  cpu.watches.set(0x4236f3, (c) => { log(0x4236f3, 4); });
  cpu.watches.set(0x4630c0, (c) => {
    const path = str(c.arg(0 + 1));
    log(0x4630c0, 2, { path });
    waypointMaps.push({ ...base(c.callAt), index: c.arg(0) | 0, path });
  });
  cpu.watches.set(0x462be9, (c) => {
    const map = c.arg(0) | 0, nd = c.arg(1) | 0, dest = c.arg(2);
    const rf = recFieldOfPtr(dest, n);
    log(0x462be9, 3, { record: rf?.record ?? -1 });
    places.push({ ...base(c.callAt), record: rf ? rf.record : -1, field: rf ? rf.field : -1, map, node: nd, word: -1 });
  });

  // everything else outside the island's region and the CRT: logged, returns 0
  cpu.exec = [[code.lo, code.hi], CRT];
  for (const a of NATIVE_ENGINE) cpu.native.add(a);
  cpu.fallback = (addr: number) => (c: Cpu) => {
    c.eax = 0;
    if (inLoader()) return;
    const nargs = argCount();
    log(addr, nargs || 4);
    let u = unhooked.get(addr);
    if (!u) unhooked.set(addr, (u = { fn: addr, count: 0, callers: new Set() }));
    u.count++;
    u.callers.add(caller());
    c.eax = 0;
  };

  // --- run FUN_004b6475
  const node = getVar(0x58);
  cpu.call(ISLAND.ROOT, [], { maxSteps: env.maxSteps ?? 20_000_000 });

  // --- after the run: direct variable writes, record diff, node snapshots
  for (let i = 0; i < VAR_COUNT; i++) {
    const v = mem.r32(VAR_ARRAY + 4 * i);
    const last = [...varWrites].reverse().find((w) => w.var === i);
    const expect = last ? last.after : vars0[i];
    if (v !== expect) { env.vars.set(i, v); varWrites.push({ var: i, op: 'direct', value: v, before: expect, after: v, at: 0, caller: 0 }); }
  }
  const records: EmuRecord[] = [];
  const changed: RecordChange[] = [];
  for (let i = 0; i < n; i++) {
    const r = readRecord(i), a = initial[i];
    records.push(r);
    if (r.flags !== a.flags) changed.push({ record: i, name: a.name, field: 'flags', from: a.flags, to: r.flags });
    if (r.variant !== a.variant) changed.push({ record: i, name: a.name, field: 'variant', from: a.variant, to: r.variant });
    if (r.name !== a.name) changed.push({ record: i, name: a.name, field: 'name', from: a.name, to: r.name });
    if (r.pos.some((x, k) => !Object.is(x, a.pos[k]))) changed.push({ record: i, name: a.name, field: 'pos', from: a.pos, to: r.pos });
    if (r.euler.some((x, k) => !Object.is(x, a.euler[k]))) changed.push({ record: i, name: a.name, field: 'euler', from: a.euler, to: r.euler });
    const ma = RECORDS_BASE + i * RECORD_STRIDE + RF.MATRIX;
    let mchg = false;
    for (let k = 0; k < 0x30; k++) if (mem.r8(ma + k) !== matrix0[i * RECORD_STRIDE + RF.MATRIX + k]) { mchg = true; break; }
    if (mchg) changed.push({ record: i, name: a.name, field: 'matrix', from: null, to: null });
  }
  for (const a of attaches) {
    if (!a.node) continue;
    a.nodeBytes = mem.read(a.node, 0x40);
    const g = { var: mem.r32(a.node), mask: mem.r16(a.node + 0xc), value: mem.r16(a.node + 0xe) };
    if (g.var !== a.var || g.mask !== a.mask || g.value !== a.value) a.gate = g;
  }
  const allDicts = [...dicts.values()];
  const dictOf = (pred: (d: (typeof allDicts)[0]) => boolean) => allDicts.find(pred)?.entries ?? new Map<string, number>();
  const dictionaries = {
    switches: dictOf((d) => d.builtBy === ISLAND.SWITCH_DICT || [...d.entries.keys()].some((k) => /^SWITCH_/i.test(k))),
    anims: dictOf((d) => [...d.entries.keys()].some((k) => /^PEP_/i.test(k))),
    all: allDicts,
  };
  const out: IslandSetup = {
    node, era: eraOfNode(node), attaches, records, changed, stores, boxes, modes, cutscenes, cutsceneSlots, hudHints, varWrites, waypointMaps, places, controllers, ctrlFlags,
    dictionaries, storyHandler: calls.filter((c) => c.story), calls, vehicleRoster: [],
    unhooked: [...unhooked.values()].map((u) => ({ fn: u.fn, count: u.count, callers: [...u.callers] })).sort((a, b) => b.count - a.count),
    mem, steps: cpu.steps, ms: performance.now() - t0,
    toZoneSetup: () => toZoneSetup(pe, out, code, initial),
  };
  // --- FUN_0051c823, the vehicle roster's brick effects (WP9): the constructors are not run by the set-up emulation; its record writes (+0x64,
  //     flags of the 0x8e9c30 list) and render modes are not part of the set-up data above, only its FX_Bricks calls are kept
  {
    const nCalls = calls.length, nModes = modes.length;
    const onW = mem.onWrite;
    mem.onWrite = () => {};
    const snap = mem.read(RECORDS_BASE, n * RECORD_STRIDE);
    try { cpu.call(FN_VEHICLE_ROSTER, [], { maxSteps: 2_000_000 }); } catch { /* keep what was logged */ }
    mem.write(RECORDS_BASE, snap);
    mem.onWrite = onW;
    out.vehicleRoster = calls.splice(nCalls).filter((c) => c.fn >= 0x447c00 && c.fn < 0x448000);
    modes.length = nModes;
  }
  return out;
}

/** FUN_0051c823: the vehicle roster (table 0x8e9b28 {record, ?, ?, first clip, var, handle}): brick-morph effects of the island's vehicles */
const FN_VEHICLE_ROSTER = 0x51c823;

/** the emulation in the shapes of `extractZoneSetup` (everything active, `cond: []`); flag / field writes are the stores the original code made */
function toZoneSetup(pe: Pe, s: IslandSetup, code: { zone: string; root: number; lo: number; hi: number }, initial: EmuRecord[]): ZoneSetup {
  const flagWrites: FlagWrite[] = [], fieldWrites: FieldWrite[] = [];
  const hide: FlagWrite[] = [], show: FlagWrite[] = [];
  const flags = initial.map((r) => r.flags);
  const f32 = (u: number) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, u >>> 0, true); return d.getFloat32(0, true); };
  for (const st of s.stores) {
    if (st.field >= RF.FLAGS && st.field < RF.FLAGS + 2) {
      const before = flags[st.record];
      let v = before;
      if (st.size >= 2 && st.field === RF.FLAGS) v = st.value & 0xffff;
      else if (st.field === RF.FLAGS) v = (v & 0xff00) | (st.value & 0xff);
      else v = (v & 0xff) | ((st.value & 0xff) << 8);
      flags[st.record] = v;
      // as an `and` + `or` pair: the 16 bits become v, bits the port keeps above them stay (applySetup / hiddenRecords understand both)
      const wa: FlagWrite = { at: st.at, fn: st.fn, cond: [], record: st.record, op: 'and', mask: v };
      const wo: FlagWrite = { at: st.at, fn: st.fn, cond: [], record: st.record, op: 'or', mask: v };
      flagWrites.push(wa, wo);
      if ((before & 2) && !(v & 2)) hide.push(wa);
      else if (!(before & 2) && (v & 2)) show.push(wo);
    } else if (st.size === 4 && ((st.field >= RF.X && st.field <= RF.Z) || (st.field >= RF.EULER && st.field < RF.EULER + 12) || st.field === RF.VARIANT)) {
      fieldWrites.push({ at: st.at, fn: st.fn, cond: [], record: st.record, field: st.field, size: 4, value: st.value >>> 0, float: st.field === RF.VARIANT ? null : f32(st.value), ref: null });
    }
  }
  const varWrites: VarWrite[] = s.varWrites.filter((w) => w.op !== 'direct').map((w) => ({ at: w.at, fn: w.caller, cond: [], var: w.var, op: w.op as VarWrite['op'], value: w.value }));
  const ground = s.calls.filter((c) => c.fn === FN.GROUND).pop();
  return {
    zone: code.zone, root: code.root, region: [code.lo, code.hi], functions: [], subgame: 2, variants: [],
    attaches: s.attaches.map((a) => (a.gate ? { ...a, ...a.gate } : a)), flagWrites, hide, show, fieldWrites, boxes: s.boxes, modes: s.modes, cutscenes: s.cutscenes, hudHints: s.hudHints,
    globalWrites: [], varWrites, ctrlFlags: s.ctrlFlags, waypointMaps: s.waypointMaps, places: s.places,
    controllers: s.controllers.map((c) => ({ record: c.record, at: c.at, cond: [] })), fogCalls: [], fog: [],
    seaLevel: s.mem.f32(GLOBALS.SEA_LEVEL), gravity: s.mem.u32(GLOBALS.GRAVITY) !== pe.u32(GLOBALS.GRAVITY) ? s.mem.f32(GLOBALS.GRAVITY) : null,
    groundRecord: ground ? recIndexOfPtr(ground.args[0]) : null, groundName: ground ? s.records[recIndexOfPtr(ground.args[0])]?.name ?? null : null,
    focusRecord: recIndexOfPtr(s.mem.u32(GLOBALS.FOCUS)) >= 0 ? recIndexOfPtr(s.mem.u32(GLOBALS.FOCUS)) : null,
    accessoryRecord: (s.mem.r32(GLOBALS.ACCESSORY) | 0) >= 0 ? s.mem.r32(GLOBALS.ACCESSORY) | 0 : null,
    dynamic: {}, unresolved: [],
  };
}
