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
import { Cpu, Memory, createGameCpu, EmuError } from './x86emu.ts';
import type { HostFn } from './x86emu.ts';
import { zoneCodeIndex, extractShadowSetup, extractCtorRenderCalls, readZoneTable, ctorName as ctorNameOf, RECORD_STRIDE, RF, GLOBALS, FN } from './zonesetup.ts';
import type { ZoneSetup, Attach, FlagWrite, FieldWrite, Box, RenderMode, Shiny, Cutscene, HudHint, VarWrite, CtrlFlags, WaypointMap, Place } from './zonesetup.ts';

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
  0x43a340,   // FUN_0043a340(m, rx, ry, rz): rotation matrix (the hubs' set-ups turn records)
  0x442810,   // FUN_00442810(rec, out): the record's collision object extents (col +0x18..0x20 = half extents; the emulated block holds the .col header, see `colBlock`)
  0x51e475,   // FUN_0051e475(hub, a, b, c): the hub's three vehicle records (DAT_05d58688 table)
  0x51e4b0,   // FUN_0051e4b0(hub, hideOthers): shows the vehicle record chosen by var 0xbb, returns its record pointer
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
  /** `stores.length` when the node was attached: the record stores before it were made earlier than the node's constructor (which the original runs at the attach), the later ones afterwards (M5, z07CSI) */
  storeIndex: number;
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
  boxes: Box[]; modes: RenderMode[]; shiny: Shiny[];
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
  /** M5 (`spec.loaderRigs`): the animation instances the zone's loader gives records: record, rig name (`MFIG`, from the `.blk` path), the clip FUN_0043b6a3 started (-1: none); empty otherwise */
  loaderRigs: { record: number; rig: string; path: string; clip: number }[];
  /**
   * M5: the sound / music handles the set-up (and the loader) obtained: `FUN_004433b0(id)` (3D sound), `FUN_00443580(id)` (2D sound), `FUN_00443290(name)` (the zone's music
   * / sound bank). The hosts hand out tokens, so the globals the code stored them into can be read back: `addr` = the global (`DAT_05d588f0` ...), `id` = sound id (-1 for music),
   * `name` = the string of `FUN_00443290`. The hub's runtime code plays `FUN_004435a0(DAT_...)`: the port maps the global to the sound id with this table.
   */
  soundHandles: { addr: number; kind: 'sfx3d' | 'sfx2d' | 'music'; id: number; name: string | null }[];
  /** every hosted / unhooked call in order */
  calls: EmuCall[];
  /** engine functions without a host entry that were called (logged, returned 0) */
  unhooked: { fn: number; count: number; callers: number[] }[];
  /** the emulated memory after the run (follow pointers of argument blocks / nodes) */
  mem: Memory;
  steps: number; ms: number;
  /** the same data in the shapes of the symbolic extraction (`cond: []` everywhere: the code ran for concrete variables), for `setupZone` */
  toZoneSetup(): ZoneSetup;
  /**
   * M5: call a function of the original in the same emulated machine after the set-up ran (the hubs' story handlers `FUN_00574e40(&next, &prev, node)`, per-frame
   * functions ...): the oracle of the hub ports' tests. `args` are cdecl stack words (pointers into `alloc` blocks for the `&next` / `&prev` style arguments); returns eax and
   * the calls / record stores / variable writes the call made. Game variables for the call: `setVar` (the emulated array and `env.vars` stay in step).
   */
  run(fn: number, args?: number[], opts?: { maxSteps?: number }): EmuRun;
  /** a zeroed block of emulated heap (argument buffers for `run`) */
  alloc(size: number): number;
  /** set a game variable in the emulated machine (and `env.vars`) */
  setVar(i: number, v: number): void;
}
/** what a function called with `IslandSetup.run` did */
export interface EmuRun { eax: number; calls: EmuCall[]; stores: RecordStore[]; varWrites: EmuVarWrite[]; records: EmuRecord[]; steps: number }
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
  /**
   * FUN_0043cd62(&pos, dy) = FUN_004425f0(pos + (0, dy, 0)): the height of the ground record below the point (the hubs' set-ups put Pepper and props on the terrain).
   * `groundRecord` = the record the set-up named with FUN_004425e0; return null for "no ground hit" (the original returns the constant at 0x8920c4).
   * Without it the host returns that constant.
   */
  terrainHeight?: (groundRecord: number, x: number, y: number, z: number, dy: number) => number | null;
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
  // M5 (hubs): sound / music loads (no set-up data: the sound ids are in the arguments), animation time, sub-object matrix, ground height
  0x443290: 'zoneSounds', 0x4431e0: 'ambience', 0x4432c0: 'music', 0x443c90: 'sound443c90', 0x443ca0: 'sound443ca0', 0x4433b0: 'sfxLoad3D', 0x443580: 'sfxLoad',
  0x4359d5: 'soundInit', 0x43b64d: 'animTime', 0x43ea60: 'subMatrix', 0x43cd62: 'terrainHeight', 0x43b1ff: 'rigLoad', 0x43b4e2: 'animNew',
};

/** what differs between zones in `emulateZoneSetup` */
export interface ZoneEmuSpec {
  /** archive name ('z02LGI', 'z07CSI' ...): selects the code region / loader / root of `zoneCodeIndex` */
  zone: string;
  /** the zone's story handler (calls, stores and attaches made while it runs are flagged `story`), omitted: none */
  story?: number;
  /** override of the set-up root (default: the loader's only caller, `zoneCodeIndex`) */
  root?: number;
  /** story era of a node (island: `eraOfNode`; hubs: 0) */
  eraOf?: (node: number) => number;
  /** run the island's vehicle roster FUN_0051c823 after the set-up (WP9) */
  vehicleRoster?: boolean;
  /** functions the zone's wrapper calls before the set-up root (the sound handle loaders, the HUD overlay loaders): run first, so `soundHandles` / `calls` include them */
  pre?: number[];
  /** record the rigs (`.blk` files) the loader loads (FUN_0043b1ff) and the animation instances it gives records (FUN_0043b4e2 + FUN_0043b6a3 -> record +8): `IslandSetup.loaderRigs` */
  loaderRigs?: boolean;
  /** extra pure engine functions (addresses) that execute natively in this zone (e.g. a hub's own data helpers outside its region) */
  native?: number[];
  /** extra code ranges that execute natively besides the zone's region and the C runtime (shared library code the set-up calls) */
  exec?: [number, number][];
  /** zones (archive names) whose whole code region also executes natively: the hubs call the island's shared code (vehicle roster FUN_0051e4b0 ...) */
  shared?: string[];
  /** extra host functions (address -> host) for this zone, below `env.hooks` */
  hooks?: (ctx: HostCtx) => Map<number, HostFn>;
}

/** what a zone's own host functions get (logging, memory, records) */
export interface HostCtx {
  cpu: Cpu; mem: Memory; pe: Pe;
  /** log a call like the built-in hosts do (`nargs` stack words); returns the logged call */
  log(fn: number, nargs: number, info?: Record<string, unknown>): EmuCall | null;
  /** record index of a pointer into the record array (-1 when it is none) */
  recOf(ptr: number): number;
  /** bump allocation in the emulated heap (zeroed) */
  alloc(size: number): number;
  /** read a C string from a pointer when mapped */
  str(ptr: number): string | null;
  getVar(i: number): number;
  putVar(i: number, v: number, op: EmuVarWrite['op']): void;
}

/** the island's emulation spec (`emulateZoneSetup`): FUN_004b6475, the story handler FUN_004b7040, the era of the story node, the vehicle roster */
export const ISLAND_SPEC: ZoneEmuSpec = { zone: 'z02LGI', story: ISLAND.STORY, eraOf: eraOfNode, vehicleRoster: true };

/** the island's set-up (FUN_004b6475) run in the x86 emulation: `emulateZoneSetup` with `ISLAND_SPEC` (docs/re/m4/emu.md) */
export function emulateIslandSetup(pe: Pe, scene: ZoneScene, env: EmuEnv): IslandSetup {
  return emulateZoneSetup(pe, scene, env, ISLAND_SPEC);
}

/**
 * Any zone's set-up RUN out of the executable (M5, docs/re/m5/foundation.md): the zone's code region, loader, builder and set-up root come from
 * `zoneCodeIndex` (the loader's only caller = the root, which calls the loader itself); `spec.story` = the zone's story handler. Everything else is as for
 * the island: the host table below, the native C runtime, the loader that builds the zone's dictionaries.
 */
export function emulateZoneSetup(pe: Pe, scene: ZoneScene, env: EmuEnv, spec: ZoneEmuSpec): IslandSetup {
  const t0 = performance.now();
  const code = zoneCodeIndex(pe).get(spec.zone.toLowerCase());
  if (!code) throw new Error(`emusetup: no code of ${spec.zone} in this executable`);
  if (!code.root) throw new Error(`emusetup: ${spec.zone}: no set-up root`);
  const ROOT = spec.root ?? code.root, LOADER = code.loader, STORY = spec.story ?? -1;
  const zoneDirRe = new RegExp('^\\.?[\\\\/]*_data[\\\\/]+' + spec.zone.toLowerCase() + '[\\\\/]+', 'i');
  const cpu = createGameCpu(pe);
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

  // the collision objects' header (.col file: centre, half extents, radius) in the emulated block: col +0x0c centre, +0x18 half extents, +0x24 radius
  // (file offsets + 8, FUN_00442810 reads +0x18..0x20, the frustum test +0x0c / +0x24)
  const colHeader = (slot: number, block: number) => {
    const path = scene.colPaths[slot];
    const e = path && env.archive ? env.archive.find(path.split('\\').slice(2).join('/')) : null;
    if (!e) return;
    const d = env.archive!.read(e);
    if (d.length < 32 || d[0] !== 0x43 || d[1] !== 0x42 || d[2] !== 0x42 || d[3] !== 0x58) return;   // 'CBBX'
    for (let k = 4; k < 32; k += 4) mem.w32(block + 8 + k, d[k] | (d[k + 1] << 8) | (d[k + 2] << 16) | (d[k + 3] << 24));
  };
  // --- records (zone.ts buildRecords: flags = scene flags || 2, matrix / Euler from the builder)
  const initial: EmuRecord[] = [];
  for (const r of scene.records) {
    const a = RECORDS_BASE + r.index * RECORD_STRIDE;
    for (let k = 0; k < 4; k++) mem.w8(a + k, r.name.charCodeAt(k) || 0);
    if (r.model) mem.w32(a + RF.MODEL, alloc(0x40));
    for (let k = 0; k < 16; k++) mem.wf32(a + RF.MATRIX + 4 * k, r.matrix[k]);
    for (let k = 0; k < 3; k++) mem.wf32(a + RF.EULER + 4 * k, r.rot[k]);
    if (r.col >= 0) {
      const cb = alloc(0x80);
      mem.w32(a + RF.COL, cb);
      colHeader(r.col, cb);
    }
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
    if (cpu.frames.includes(LOADER)) return;   // the loader's animation instances (rec + 8)
    const r = Math.floor((a - RECORDS_BASE) / RECORD_STRIDE);
    stores.push({ record: r, field: a - RECORDS_BASE - r * RECORD_STRIDE, size, value: v, at: mem.eip, fn: cpu.frames[cpu.frames.length - 1] ?? 0, story: (STORY >= 0 && cpu.frames.includes(STORY)) });
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
  const storyDepth = () => (STORY >= 0 && cpu.frames.includes(STORY));
  const caller = () => cpu.frames[cpu.frames.length - 1] ?? 0;
  const calls: EmuCall[] = [];
  const argCount = (): number => {
    // the caller's `add esp, n` right after the call (cdecl); 0 when there is none
    const r = cpu.retAddr;
    if (mem.r8(r) === 0x83 && mem.r8(r + 1) === 0xc4) return mem.r8(r + 2) >> 2;
    if (mem.r8(r) === 0x81 && mem.r8(r + 1) === 0xc4) return mem.u32(r + 2) >> 2;
    return 0;
  };
  const inLoader = () => cpu.frames.includes(LOADER);
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
  const boxes: Box[] = [], modes: RenderMode[] = [], shiny: Shiny[] = [], hudHints: HudHint[] = [];
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
  // M5: sound handles as tokens (read back from the globals the code stored them in, `soundHandles`)
  const SND_TOK = 0x5a000000;
  const sndTok: { kind: 'sfx3d' | 'sfx2d' | 'music'; id: number; name: string | null }[] = [];
  const sndHost = (fn: number, kind: 'sfx3d' | 'sfx2d' | 'music') => H.set(fn, (c) => {
    const name = kind === 'music' ? str(c.arg(0)) : null, id = kind === 'music' ? -1 : c.arg(0) | 0;
    log(fn, 1, kind === 'music' ? { name } : { id });
    c.eax = SND_TOK + sndTok.length; sndTok.push({ kind, id, name });
  });
  sndHost(0x4433b0, 'sfx3d'); sndHost(0x443580, 'sfx2d'); sndHost(0x443290, 'music');
  // M5: the rigs the loader loads and the animation instances it gives records (the port's `ensureAnim`): tokens in emulated memory, read back after the run
  const rigTok = new Map<number, string>(), instTok = new Map<number, { rig: number; clip: number }>();
  if (spec.loaderRigs) {
    H.set(0x43b1ff, (c) => { const t = alloc(0x20); rigTok.set(t, str(c.arg(0)) ?? ''); c.eax = t; });
    H.set(0x43b4e2, (c) => { const t = alloc(0x20); instTok.set(t, { rig: c.arg(0), clip: -1 }); mem.w32(t + 8, c.arg(0)); c.eax = t; });
    H.set(0x43b6a3, (c) => { const i = instTok.get(c.arg(0)); if (i) i.clip = c.arg(1) | 0; log(0x43b6a3, 3); c.eax = 0; });
  }
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
    const at: EmuAttach = { ...base(c.callAt), record, ctor, ctorName: ctorName(ctor), arg, argWords, pos, var: v, mask, value, args, hasController: !!ctrl, node, story: storyDepth(), storeIndex: stores.length };
    if (flags) at.ctrlFlags = flags.flags;
    attaches.push(at);
    c.eax = node;
  });
  // colliders, render modes, terrain, fog
  H.set(FN.BOX_FILE, (c) => { log(FN.BOX_FILE, 1); boxes.push({ ...base(c.callAt), record: recOf(c.arg(0)), kind: 'file', dims: [] }); });
  H.set(FN.BOX_RADIUS_HEIGHT, (c) => { log(FN.BOX_RADIUS_HEIGHT, 3); boxes.push({ ...base(c.callAt), record: recOf(c.arg(0)), kind: 'radiusHeight', dims: [c.argf(1), c.argf(2)] }); });
  H.set(FN.BOX_DIMS, (c) => { log(FN.BOX_DIMS, 4); boxes.push({ ...base(c.callAt), record: recOf(c.arg(0)), kind: 'dims', dims: [c.argf(1), c.argf(2), c.argf(3)] }); });
  H.set(FN.SHINY, (c) => { log(FN.SHINY, 2); shiny.push({ ...base(c.callAt), record: recOf(c.arg(0)), on: c.arg(1) !== 0 }); });
  H.set(FN.RENDER_MODE, (c) => { log(FN.RENDER_MODE, 3); modes.push({ ...base(c.callAt), record: recOf(c.arg(0)), partMask: c.arg(1), mode: c.arg(2) }); });
  let groundRecord = -1;
  H.set(FN.GROUND, (c) => { groundRecord = recOf(c.arg(0)); log(FN.GROUND, 1, { record: groundRecord }); });
  // FUN_0043cd62(&pos, dy): ground height (the port's collision, `env.terrainHeight`); the constant 0x8920c4 when nothing is hit
  H.set(0x43cd62, (c) => {
    const p = c.arg(0), dy = c.argf(1);
    const x = mem.f32(p), y = mem.f32(p + 4), z = mem.f32(p + 8);
    const h = env.terrainHeight?.(groundRecord, x, y, z, dy) ?? null;
    log(0x43cd62, 2, { pos: [x, y, z], dy, ground: groundRecord, height: h });
    c.fpush(Math.fround(h ?? mem.f32(0x8920c4)));
  });
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
    const member = path.replace(zoneDirRe, '').replace(/\\/g, '/');
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
    if (H.has(a) || a === LOADER || NATIVE_ENGINE.includes(a)) continue;
    H.set(a, () => { log(a, argCount() || 0); cpu.eax = 0; });
  }
  if (spec.hooks) for (const [a, h] of spec.hooks({ cpu, mem, pe, log, recOf, alloc, str, getVar, putVar })) H.set(a, h);
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
  const shared: [number, number][] = [];
  for (const z of spec.shared ?? []) { const c = zoneCodeIndex(pe).get(z.toLowerCase()); if (c) shared.push([c.lo, c.hi]); }
  cpu.exec = [[code.lo, code.hi], CRT, ...shared, ...(spec.exec ?? [])];
  for (const a of NATIVE_ENGINE) cpu.native.add(a);
  for (const a of spec.native ?? []) cpu.native.add(a);
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
  for (const f of spec.pre ?? []) cpu.call(f, [], { maxSteps: env.maxSteps ?? 20_000_000 });
  cpu.call(ROOT, [], { maxSteps: env.maxSteps ?? 20_000_000 });

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
  const soundHandles: IslandSetup['soundHandles'] = [];
  if (sndTok.length) {
    for (let pg = 0; pg < (0x6000000 >>> 12); pg++) {
      const page = mem.pages[pg];
      if (!page) continue;
      for (let o = 0; o < 4096; o += 4) {
        const v = (page[o] | (page[o + 1] << 8) | (page[o + 2] << 16) | (page[o + 3] << 24)) >>> 0;
        if (v >= SND_TOK && v < SND_TOK + sndTok.length) soundHandles.push({ addr: (pg << 12) + o, ...sndTok[v - SND_TOK] });
      }
    }
  }
  const loaderRigs: IslandSetup['loaderRigs'] = [];
  if (spec.loaderRigs) {
    for (let i = 0; i < n; i++) {
      const inst = instTok.get(mem.u32(RECORDS_BASE + i * RECORD_STRIDE + 8));
      const path = inst ? rigTok.get(inst.rig) : undefined;
      if (inst && path !== undefined) loaderRigs.push({ record: i, rig: (path.split('\\').pop() ?? '').replace(/\.blk$/i, ''), path, clip: inst.clip });
    }
  }
  const out: IslandSetup = {
    node, era: spec.eraOf ? spec.eraOf(node) : 0, attaches, records, changed, stores, boxes, modes, shiny, cutscenes, cutsceneSlots, hudHints, varWrites, waypointMaps, places, controllers, ctrlFlags,
    dictionaries, storyHandler: calls.filter((c) => c.story), calls, vehicleRoster: [], loaderRigs, soundHandles,
    unhooked: [...unhooked.values()].map((u) => ({ fn: u.fn, count: u.count, callers: [...u.callers] })).sort((a, b) => b.count - a.count),
    mem, steps: cpu.steps, ms: performance.now() - t0,
    toZoneSetup: () => toZoneSetup(pe, out, code, initial),
    alloc,
    setVar: (i, v) => { if (i >= 0 && i < VAR_COUNT) mem.w32(VAR_ARRAY + 4 * i, v); env.vars.set(i, v | 0); },
    run: (fn, args = [], opts = {}) => {
      const c0 = calls.length, s0 = stores.length, v0 = varWrites.length, st0 = cpu.steps;
      const eax = cpu.call(fn, args, { maxSteps: opts.maxSteps ?? env.maxSteps ?? 20_000_000 });
      const recs: EmuRecord[] = [];
      for (let i = 0; i < n; i++) recs.push(readRecord(i));
      return { eax, calls: calls.slice(c0), stores: stores.slice(s0), varWrites: varWrites.slice(v0), records: recs, steps: cpu.steps - st0 };
    },
  };
  // --- FUN_0051c823, the vehicle roster's brick effects (WP9): the constructors are not run by the set-up emulation; its record writes (+0x64,
  //     flags of the 0x8e9c30 list) are not part of the set-up data above, its FX_Bricks calls are kept (`vehicleRoster`) and its render modes (mode 1 of the listed records) stay in `modes`
  if (spec.vehicleRoster) {
    const nCalls = calls.length;
    const onW = mem.onWrite;
    mem.onWrite = () => {};
    const snap = mem.read(RECORDS_BASE, n * RECORD_STRIDE);
    try { cpu.call(FN_VEHICLE_ROSTER, [], { maxSteps: 2_000_000 }); } catch { /* keep what was logged */ }
    mem.write(RECORDS_BASE, snap);
    mem.onWrite = onW;
    out.vehicleRoster = calls.splice(nCalls).filter((c) => c.fn >= 0x447c00 && c.fn < 0x448000);
    // the roster's FUN_00444550(record, 0xff, 1) calls (every record of the 0x8e9c30 list is drawn in mode 1 = lit at every draw) stay in `modes` (WP-RENDER R4 / R7)
  }
  return out;
}

/** FUN_0051c823: the vehicle roster (table 0x8e9b28 {record, ?, ?, first clip, var, handle}): brick-morph effects of the island's vehicles */
const FN_VEHICLE_ROSTER = 0x51c823;

/** the emulation in the shapes of `extractZoneSetup` (everything active, `cond: []`); flag / field writes are the stores the original code made */
function toZoneSetup(pe: Pe, s: IslandSetup, code: { zone: string; root: number; lo: number; hi: number }, initial: EmuRecord[]): ZoneSetup {
  // zone table entries whose run function lies in the zone's region (the island: 2, 31, 32, 33; a hub: its one entry), like extractZoneSetup
  const sub = readZoneTable(pe).filter((t) => t.run >= code.lo && t.run < code.hi).map((t) => t.index);
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
  // the render calls of the attached nodes' constructors (they are not run by the emulation): the symbolic walk over each constructor (WP-RENDER R4)
  const starts = pe.functionStarts(), full = zoneCodeIndex(pe, starts).get(code.zone.toLowerCase());
  const attachesOut = s.attaches.map((a) => (a.gate ? { ...a, ...a.gate } : a));
  const ctorRender = full ? extractCtorRenderCalls(pe, full, starts, attachesOut, { modes: s.modes, shiny: s.shiny }) : { modes: [] as RenderMode[], shiny: [] as Shiny[] };
  return {
    zone: code.zone, root: code.root, region: [code.lo, code.hi], functions: [], subgame: sub.length ? sub[0] : -1, variants: sub.slice(1),
    attaches: s.attaches.map((a) => (a.gate ? { ...a, ...a.gate } : a)), flagWrites, hide, show, fieldWrites, boxes: s.boxes, modes: s.modes, shiny: s.shiny, ctorModes: ctorRender.modes, ctorShiny: ctorRender.shiny, cutscenes: s.cutscenes, hudHints: s.hudHints,
    globalWrites: [], varWrites, ctrlFlags: s.ctrlFlags, waypointMaps: s.waypointMaps, places: s.places,
    controllers: s.controllers.map((c) => ({ record: c.record, at: c.at, cond: [] })), shadow: extractShadowSetup(pe, code, pe.functionStarts()), fogCalls: [], fog: [],
    seaLevel: s.mem.f32(GLOBALS.SEA_LEVEL), gravity: s.mem.u32(GLOBALS.GRAVITY) !== pe.u32(GLOBALS.GRAVITY) ? s.mem.f32(GLOBALS.GRAVITY) : null,
    groundRecord: ground ? recIndexOfPtr(ground.args[0]) : null, groundName: ground ? s.records[recIndexOfPtr(ground.args[0])]?.name ?? null : null,
    focusRecord: recIndexOfPtr(s.mem.u32(GLOBALS.FOCUS)) >= 0 ? recIndexOfPtr(s.mem.u32(GLOBALS.FOCUS)) : null,
    accessoryRecord: (s.mem.r32(GLOBALS.ACCESSORY) | 0) >= 0 ? s.mem.r32(GLOBALS.ACCESSORY) | 0 : null,
    dynamic: {}, unresolved: [],
  };
}

// ---------------------------------------------------------------------------------------------------
// M5: the hubs

/**
 * The emulation specs of the six hubs (docs/re/m5/foundation.md): zone code, loader and set-up root come from `zoneCodeIndex`; the hubs call the island's
 * shared code (the vehicle roster FUN_0051e475 / FUN_0051e4b0, ...), which therefore executes natively too (`shared`). `story` = the story handler the set-up
 * calls (only the castle's, FUN_00574e40; the other hubs' loops have none: their story state is read by the nodes).
 */
export const HUB_SPECS: Record<string, ZoneEmuSpec> = {
  z07csi: { zone: 'z07CSI', story: 0x574e40, shared: ['z02LGI'], loaderRigs: true, pre: [0x572ef0] },
  z13cai: { zone: 'z13CAI', shared: ['z02LGI'], loaderRigs: true, pre: [0x61bf50, 0x61b000] },
  // z14OSD: PEPPSW's roster FUN_00655de3 (+ FUN_00655dc0, FUN_006561e9, FUN_0065627e) lie just behind the zone's region: native, so the hub game can run the roster after the set-up (M5 z14OSD)
  z14osd: { zone: 'z14OSD', shared: ['z02LGI'], loaderRigs: true, pre: [0x6285e0, 0x6283c0], exec: [[0x655dc0, 0x656300]] },
  // z16PYA: PeppSw's roster FUN_00698963 and its helpers (0x698940 .. 0x698e79) lie just behind the zone's region: native, so the hub game can run the roster after the set-up (M5 z16PYA)
  z16pya: { zone: 'z16PYA', shared: ['z02LGI'], loaderRigs: true, pre: [0x6762a0, 0x676080], exec: [[0x698940, 0x698e80]] },
  z23dip: { zone: 'z23DIP', shared: ['z02LGI'], loaderRigs: true, pre: [0x7267e0, 0x7265c0] },
  z40ogl: { zone: 'z40OGL', shared: ['z02LGI'], loaderRigs: true, pre: [0x7e2a80] },
};
/** the emulation spec of a zone (island or hub), undefined for zones whose set-up is not run in the emulator */
export function emuSpecOf(zone: string): ZoneEmuSpec | undefined {
  return zone.toLowerCase() === 'z02lgi' ? ISLAND_SPEC : HUB_SPECS[zone.toLowerCase()];
}
/** run the set-up of any zone `emuSpecOf` knows (island or hub) */
export function emulateSetup(pe: Pe, scene: ZoneScene, env: EmuEnv, zone: string): IslandSetup {
  const spec = emuSpecOf(zone);
  if (!spec) throw new Error(`emusetup: no emulation spec for ${zone}`);
  return emulateZoneSetup(pe, scene, env, spec);
}
