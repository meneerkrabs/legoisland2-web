# M4 WP1: the island's set-up, run out of the executable (x86 emulation)

The symbolic interpreter of M2 (`zonesetup.ts`, docs/re/zone-setup.md) reads the straight-line parts of the island's set-up (183 attaches over all eras) but cannot
follow record pointers that come out of tables / calls, argument blocks built in scratch buffers, or computed gates. M4 needs the exact data per story node, so
the set-up is now **executed**: a concrete 32-bit x86 interpreter runs the original `FUN_004b6475` inside the user's own executable, with a host table that
replaces the engine functions and records what they were called with. Nothing of the executable is stored in the repository (addresses only).

Files: `src/formats/x86emu.ts` (CPU + memory), `src/formats/emusetup.ts` (host table, island extraction, `toZoneSetup`), `tools/tests/x86emu.mjs`,
`tools/tests/emusetup.mjs` (`node tools/test-formats.mjs --only x86emu,emusetup`), the optional integration in `src/game/setup.ts` (`profileFor(..., { islandVars, archive })`).

## 1. The CPU (`x86emu.ts`)

* **Memory**: sparse 4 KB pages (`Memory.pages`, 2^20 slots), created on first access when the address lies in a region: the PE sections (`mapImage`: bytes copied
  lazily from the file, the rest of `.data` / `.bss` zero), the stack (1 MB below `STACK_TOP` 0x7ff00000), the thread block (`fs` base 0x7ffd0000) and the regions the
  host adds (records, heap). Any other access throws `EmuError` with the instruction address (null pointers, `0xcccccccc` locals ...). `Memory.onWrite` observes
  stores into one range (`wlo .. whi`: the record array).
* **Decoder**: `decode()` of x86.ts (length + ModRM / SIB / immediates) plus the emulator's own prefix scan (`f2` / `f3`, `fs`); decoded instructions are cached per address.
* **Instructions**: the integer set of an MSVC debug build: ALU group with all flags (CF / ZF / SF / OF, PF from the low byte), inc / dec, push / pop / pusha,
  mov / movzx / movsx / lea / xchg / xlat, imul (all forms), mul / div / idiv (BigInt for the 64-bit cases), shifts and rotates (rcl / rcr bitwise), shld / shrd,
  bt / bts / btr / btc, bsf / bsr, bswap, setcc, cmovcc, jcc / jmp / call / ret n / loop / jecxz, jump tables (`jmp [table + reg*4]`), cbw / cwde / cdq, lahf / sahf,
  pushf / popf, cld / std, string instructions with `rep` / `repe` / `repne` (a fast path for the `rep stosd` 0xcccccccc frame fills). **x87**: an 8-slot stack of
  doubles (the build runs the FPU at 53-bit precision, so doubles are exact), all arithmetic forms of d8 / dc / de (Intel meanings of the reversed sub / div register forms),
  fld / fst / fstp m32 (float32 rounding on 32-bit stores) / m64, fild / fist / fistp m16 / m32 / m64 with the rounding control of the control word (fldcw / fnstcw:
  `__ftol` works natively), fcom / fcomp / fcompp / fucom*, fcomi / fucomi(p), fnstsw ax / m16, ftst / fxam, fchs / fabs / fsqrt / fsin / fcos / fsincos / fptan /
  fpatan / fprem / frndint / fscale / f2xm1 / fyl2x, the constants. Not modelled: 16-bit addressing, segments other than fs, MMX / SSE, 80-bit memory operands, privileged code.
* **API**: `createCpu(pe)`; `cpu.call(entry, args, { maxSteps, trace })` pushes the cdecl arguments and a magic return address and runs to it (returns eax);
  `cpu.hooks: Map<addr, HostFn>` replaces a function (the host sees `cpu.arg(i)` / `argf(i)` with the return address at [esp], sets `cpu.eax` or `fpush(st0)`,
  returns the number of argument bytes the callee pops: 0 for cdecl, n for stdcall / thiscall); `cpu.watches` observe an address and let the code run;
  `cpu.exec` (address ranges) + `cpu.native` (single entries) decide what executes: a **call target** outside them goes to `cpu.fallback(addr)` (a jump inside a
  function never does). `cpu.frames` is a shadow call stack (entry addresses), `cpu.callAt` the address of the last call instruction. A step limit, an
  unimplemented opcode, `int3` (failed assertion) or a fault throws with the address, the step count, the innermost frames and the last 64 instruction addresses (`EmuError.trace`).

## 2. The island run (`emusetup.ts`)

`emulateIslandSetup(pe, scene, { vars, archive, maxSteps?, hooks? }): IslandSetup`

1. Records: record i at `RECORDS_BASE` 0x10000000 + i * 0x68, filled from `scene.records` like `zone.ts buildRecords` (name, matrix +0x0c with translation +0x3c,
   Euler +0x4c, flags = scene flags || 2, a dummy zeroed model block at +4 and collision block at +0x58 where the scene has one, controller 0, variant 0);
   `DAT_00983800` = count, `DAT_00983804` = base.
2. Game variables: the array `DAT_008a2d2c` (319 int32) is filled from `env.vars.get(i)`; the hosted get / set / add / or / andnot keep array and `env.vars` in step
   and log every write (`varWrites`); direct writes of the code into the array (`FUN_004177ed` clears 0xfa..0x13e) are diffed after the run and logged as `direct`.
3. Execution: the island's code region (`zoneCodeIndex`: 0x4af2f7 .. 0x53d7da), the C runtime (0x858d30 .. 0x873e00: strncmp, strncpy, memset, sprintf, __ftol
   ... run natively) and a few pure engine functions (`NATIVE_ENGINE`: `FUN_004177ed`, the waypoint loader `FUN_004630c0`, `FUN_00462be9`, `FUN_004236f3`, the matrix
   builders `FUN_0043a4a1` / `0043a5e4` / `0043a742`) execute; every other call goes to the host table or the fallback (log, return 0, counted in `unhooked`).
4. **The loader `FUN_004f645b` runs natively**: it builds the animation-name dictionary between its mesh / texture / model calls (all of which fall back to 0 and are
   not logged); it allocates its own record array, so the hosted builder (`FUN_004c34c0`, a no-op) points `DAT_00983804` back at the scene's records.
   Calls / stores made inside the loader are not logged (except the dictionary).
5. Root: `FUN_004b6475` with `var 0x58` = the story node (`eraOfNode`: < 7, < 0x1e, < 0x34, < 0x3d, else = era 0..4). The GameLoop's other init
   (`FUN_004b037e` sound handles, `FUN_0042207d(PEPP)`, `FUN_00421bbe` the building / outfit phase restore that swaps model / collision pointers by the variant word)
   is not run: it is run-time state of the renderer, not set-up data (the variant words the set-up stores are in `records[i].variant` / the stores).
6. After the run: final record state + diff (`records`, `changed`), every store into the record array in order (`stores`: record, field, size, value, `at` = store
   instruction, `fn`, `story`), node snapshots, dictionaries.

### Host table

| address | name | what is logged / done |
|---|---|---|
| 0x417575 / 597 / 5ca / 61b / 66c, 0x41ad80 | getVar, setVar, addVar, orVar, andNotVar, getSaveVar | against `env.vars` (+ the array); writes in `varWrites` (vars 1 / 2 are read-only like the original) |
| 0x423532 | attach | `attaches[]`: record, ctor (+ `ctorName`), `arg` (raw value), `args` (0x80 bytes at `arg` at call time), `argWords`, pos, var, mask, value, `hasController`, `ctrlFlags` (the last FUN_004238b7 on that record before), `node` (a 0x40 byte node block: var +0, stamp +8, mask +0xc, value +0xe; `nodeBytes` = its state after the run, `gate` = var / mask / value when code changed them later, FUN_004236f3), `story`; returns the node, or 0 when the record has no controller (as the original) |
| 0x42382c / 0x4238b7 / 0x4237b6 / 0x423716 | createController, ctrlFlags, setCreateMode, ctrlNop | controller blocks (heap, the original's initial values, `rec + 0x5c`) only while `DAT_008adc74 != 0`; flags written to ctrl + 0xc and logged with the owner record |
| 0x4427e0 / 4428b0 / 442780 | boxFile / boxRadiusHeight / boxDims | `boxes[]` (record, kind, dims as floats) |
| 0x444550, 0x4425e0, 0x442d90 | renderMode, groundRecord, fog | `modes[]`, calls |
| 0x45c310 / 45c366 / 45c397 / 45c432 | cutsceneSlots, cutsceneDir, cutscene, cutsceneActive | `cutsceneSlots` (n), `cutscenes[]` (slot, script, strings, the area / zone dir of the last FUN_0045c366); cutsceneActive returns 0 |
| 0x424029 | hudHint | `hudHints[]` |
| 0x424270, 0x424230, 0x42419f, 0x4242b9 | hintTarget, hintTarget2, hintBox, hintRecord | the objective arrow of the story handler: target record(s) + radius in `info` |
| 0x423fe0 / 423ff6, 0x88d280 / 88d296 / 88d2bc | textFile(Free), textFile2(Free / Angle) | the story handler's `.str` files (`info.file`) |
| 0x45bf20 / 45bff4 | dictCreate, dictAdd | the TDict built in emulated memory as the original lays it out + a `Map<string, number>` per handle (`dictionaries.all`; first entry of a name wins, entries beyond the capacity are dropped like the original) |
| 0x433d38, 0x858d30 | alloc (SDMem2), malloc | bump heap at 0x20000000 (zeroed) |
| 0x43bfb7 / 43c1a0 / 43c22e | fileOpen / fileRead / fileClose | files from `env.archive` (`_Data\z02LGI\` stripped): the compiled waypoint maps, so `FUN_004630c0` loads them natively and `FUN_00462be9` returns the real node positions |
| 0x4630c0, 0x462be9 (watches) | loadWaypoints, waypointPos | `waypointMaps[]` (index, path), `places[]` (record / field of the destination, map, node) |
| 0x85abc0 | __chkesp | checks ZF of the `cmp ebp, esp` before it: a host that popped the wrong number of bytes is reported at once |
| 0x46140f / 4625d7 / 4614d5, 0x43b6a3, 0x429638, 0x42401c, 0x42407f, 0x4446c0, 0x447cc0 / 447da0 / 447d70 / 447d20 / 447f00 / 447ed0, 0x442900 / 442960 / 44e8d0, 0x43f160 / 444530 / 43ebe0, 0x4430f0, 0x46063b, 0x422b50 | walker, anim start, HUD items, part flags, brick-morph FX, particles, model parts, backdrop, overlay, camera | logged with their arguments (count from the caller's `add esp, n`), return 0 |

`unhooked` lists every other engine function that was called (address, count, callers): **empty for all 73 story nodes 0..72**.

### Pointer and argument conventions

* `recIndexOfPtr(ptr)` -> record index (any field of the record) or -1; `recFieldOfPtr(ptr)` -> `{ record, field }`. Pointers into the image (0x400000 ... 0x5df1000: strings,
  `.rdata` tables, `.data`) are read with `pe` (`pe.cstr`, `pe.u32`) or, with the values the set-up stored, with `IslandSetup.mem`; heap pointers (0x20000000 ...: controllers,
  nodes, dictionaries, waypoint arrays) only with `mem`.
* The argument blocks are the caller's stack scratch buffer (`DAT_05d58668` points at it; 0x7feffe68 / 0x7feffe74 in the emulation): the code `memset`s the part the
  constructor reads, the rest is the caller's 0xcccccccc frame fill. Short notes per family (the node ports read the decompile for the field meanings): the generic NPC
  `SGMFIG 0x426151` (and `BrickBot 0x5327b1`) blocks have floats at words 1 / 2 and small integers (waypoint nodes?) at 4 / 5; `Turn2Pep 0x52ff39` / `MeetPepp 0x530d69` carry the PEPP record pointer at
  word 4; `SGBoat 0x430e6c` carries four record pointers (RIPB, WAKR, WAKP, WAKS); `building 0x535e80` / `0x5364a5` mix floats and 16-bit values; `Bunny` / `Spin` /
  `seabed` blocks are two words (a float or record pointer + 0.01). Many constructors get `arg` 0.

## 3. Findings

* **The oracle holds**: for nodes 2 / 7 / 30 / 52 / 61 every attach, flag write (a store at the same instruction with a consistent value), box, cutscene slot, HUD hint
  and render mode the symbolic extraction reports as active is in the emulation. One explained difference: `FUN_0052266a` (era 3, the four PAG buildings 69..72,
  constructor 0x535281) gates with mask `local_c`, shifted left after every attach (1, 2, 4, 8); the oracle reads 0.
* The emulation finds about 4x as many attaches as the oracle per era (272 / 290 / 261 / 302 / 266 against 59..74): the NPC / prop spawner helpers with record
  pointers from tables. Per-constructor table: `node tools/test-formats.mjs --only emusetup` (notes). Era 4 runs era 0's roster but differs in the var-dependent parts.
* Story handler at set-up: `FUN_004b6475` passes `&local_14` (uninitialised: 0xcccccccc) as the previous node, so the "just advanced" branches of `FUN_004b7040` never run
  at set-up; per node it makes 2..7 calls (objective arrow, the `lifsmN` / `liholN` text files, some hides). WP8 can call `FUN_004b7040` itself with a real previous node
  (`cpu.call(0x4b7040, [pA, pB, node])` on a CPU prepared like `emulateIslandSetup`; not wrapped yet).
* Dictionaries: `SWITCH_LGI_*` (FUN_00523200, 70 names, values 250 .. 317 + two `Dummy_` entries = 0xffff) and the animation names (built **inside the loader**
  `FUN_004f645b`, capacity 340, 339 names `<RIG>_<RIG>_<ANIM>` with per-rig numbers, e.g. `SKBD_SKBD_ONTOBOARD` = 1). The "~0x8e entries" of architecture.md 5.2
  are a smaller zone's copy.
* `var 0x4f` (`FUN_0041ad80`) selects which of the ten PH records 350..359 stays visible (value 10 -> 350 ... 1 -> 359; 0 or > 10 -> none); verified by the test.
* Cost: about 200 k instructions and 20-35 ms per node in node (the first call also builds the shared zone index, ~50 ms); the browser pays the same.

## 4. Use from the game side

```ts
// src/game/setup.ts (default behaviour unchanged)
const profile = profileFor('z02LGI', pe, scene, starts, { islandVars: world.vars /* get / set */, archive });
const loaded = setupZone(scene, archive, profile, { vars: { 0x58: node }, pe });
profile.island   // the full IslandSetup (argument blocks, dictionaries, story-handler calls, stores ...)
```

`toZoneSetup()` gives the shapes of the symbolic extraction with `cond: []`: `attaches` (with the final gates), `flagWrites` as `and` + `or` pairs per store (the 16 bits
become the stored value, bits the port keeps above them stay), `hide` / `show` = stores that clear / set bit 2, `fieldWrites` = position / Euler / variant stores, boxes,
modes, cutscenes, HUD hints, places, waypoint maps, controllers, controller flags, var writes, sea level, gravity (when the code changed it), ground, focus, skateboard record.
`applySetup` applies positions and the variant (not the Euler stores: `FUN_004b6475` negates every record's ry, the scene already has the engine's sign).
The island's arrival place stays the hand-written `PROFILE_LGI.start` (the emulated PEPP position from `FUN_004c2d22` is in `island.records[16].pos`).

## 5. Limits

* Engine functions outside the table return 0; a set-up path that depended on a real value from one (a model pointer, a loaded animation) would take the "failed"
  branch. None found on the island's paths (all 73 nodes run, `unhooked` empty), but the per-node `calls` log is the place to look.
* Hosted attaches do not run the constructors: the node layout beyond the gate is the constructor's business (ports read `args`).
* Walkers (`FUN_004614d5`) are not created at set-up on these paths; they are logged only. Records' animation instances (+8) stay 0.
* Only `FUN_004b6475` is wrapped. Other zones can use the same CPU + host table (`emulateIslandSetup` is island-specific in the region, the root and the builder hook).
