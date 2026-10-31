# Zone set-up, read out of the executable at run time (M2)

The per-zone set-up code of the original (which behaviours a record gets, which records are hidden, the box colliders of trees and boats, the sea level, the
gravity, the render modes, the cutscene slots, the HUD hints, the ground record, the place the player starts at) is straight-line code with a few `if`s and
loops. M1 wrote it down by hand for the island and Pepper's house (`PROFILE_LGI`, `PROFILE_PPH`). M2 reads it from the user's own executable, like
`extractZone` reads the placement tables (architecture.md 8.2): `src/formats/zonesetup.ts` interprets the set-up functions of **all 30 zone archives** and
`src/game/setup.ts` builds any zone's world from the result. Nothing of the executable is stored in the sources except addresses (in comments / named constants).

Files: `src/formats/zonesetup.ts` (extraction), `src/formats/x86.ts` (the interpreter, extended and backwards compatible), `src/game/setup.ts`
(`profileFor`, `setupZone`, constructor registry), `tools/tests/zonesetup.mjs` (`node tools/test-formats.mjs --only zonesetup`), `tools/lib/engine-load.mjs`
(`loadZone` now uses the extraction; `{ reference: true }` gives the M1 profile). Addresses below are VAs of the NL retail build (6,459,444 bytes);
`LE2.c:n` is a line of the Ghidra decompile in `basdebeer-tools/decomp-le2`.

## 1. Which code is the set-up

* **Root** = the only caller of the zone's loader (`FUN_004f645b` for the island: `FUN_004b6475`; Pepper's house `FUN_00546012`: `FUN_0053fb1f`, which calls
  the real set-up `FUN_0053ea4d`; the others in the table of section 4). The loader is found as the function that pushes the zone's `_data\<zone>\meshes\*.msh`
  strings (the same rule as `extractZone`), the root as its single caller. One pass over `.text` finds all 30 (`zoneCodeIndex`, ~50 ms once per executable).
* **Region** of a zone = from the zone table's run function (`0x89a9c0`, 35 records `{ run, kind, name[8] }`, architecture.md 2.1) minus 0x800 bytes of stubs to the
  start of the next zone's region. Direct calls from the root into this region are followed (the loader and the builder excluded, a function reached under
  the same conditions and constants is interpreted once, at most 8 contexts per function and depth 8). The island's code sits behind its loader, so a region is
  not simply "up to the loader".
* Not followed: indirect calls (behaviour constructors, per-frame functions), the zone's GameLoop (the code before / after the call to the root:
  `FUN_0042207d(PEPP)`, `FUN_00421bbe`, the exit-state handling) and anything outside the region. `fog` is therefore still read by `zoneparams.ts` (it also finds the GameLoop's
  `FUN_00442d90` calls); `fogCalls` are the calls of the set-up chain only.
* The zone-table index (`ZoneSetup.subgame`) is the first table entry whose run function lies in the region (island 2, variants 31 / 32 / 33 = `variants`:
  the story eras of the same code; the story FSM chooses them, architecture.md 3.5).

## 2. The interpreter (x86.ts, extended mode)

`interpret(img, start, end)` is unchanged (straight-line, branches ignored). `interpret(img, start, end, opts)` is the extended mode:

| feature | why |
|---|---|
| **reaching conditions**: forward `jcc` / `jmp` edges carry a disjunction of conjunctions of guards (`cmp lhs, rhs` + condition code + taken / not taken) to their targets, complementary paths are merged, code no path reaches (behind a `jmp` / `ret`) is skipped | `if` / `else if` / `else`, `&&`, `\|\|`, compare-and-`je` chains (the compiler's `switch`) and `break`s come out right; every event has `guards` (one path) or `alts` (several) |
| `cmp` / `test` operand tracking, game-variable reads (`FUN_00417575(v)` results, also passed on as a parameter: `gvar`) | the island's story state `var 0x58` (`local_c < 7` ... ) |
| loops: a backward jump makes the frame slots written inside the loop symbolic (`iter`); `imul r, iter, 0x68`, `records + iter * 0x68` (`giter`), `table[iter]` (`tld` / `gtld`), `movsx byte [records + iter*0x68 + k]` (`ld8`); the `for` jump over the increment block is taken | the record loops by name (`strncmp(name, "ROCK", 4)`, `name[0] == 'P'`, `name == 'TRIC'`) and the table loops (`for (i = 0; table[i] != -1; i++) attach(records + table[i] * 0x68 ...)`, unrolled from the executable's table) |
| 16-bit read-modify-write: `mov dx, [rec+0x60]; and dl, 0xfd; mov [rec+0x60], dx` (also `or ch, 2`, `and ax, imm16`, `and al, imm8`) | record flags (`StoreEv.rmw`) |
| `params`: constant / global-relative arguments are bound to `[ebp+8 ...]` of the callee | helper functions called with a record pointer or a number |
| `outputs`: a call that fills a frame buffer (`FUN_00462be9(map, node, &pos)`) gives `out` values to later loads | the player's start place |
| a `ret` followed by padding or the next function's prologue ends the function, otherwise the function continues (several exits) | uncalled neighbours (constructors) are not run into |

State (registers, frame slots) is **not** merged at joins: the arms run one after the other in code order, so a value set in one arm is still there in the next
(the compiler's merged `flags = c ? flags & ~2 : flags | 2` becomes a flag write of op `unknown`).

`zonesetup.ts` turns the guards into `Cond` entries: `var` (game variable, after normalising to an interval: `v58 <= 6`, `v58 >= 7 && v58 <= 29` ...), `call`
(another call's result, e.g. `FUN_0041ad80(0x4f)`), `global`, `name` (record loops: `value` = the characters compared at byte offset `id`), `unknown`, `never`
(two constants that do not match: dead for these arguments). Paths whose conditions exclude each other are dropped; code reached on several paths gets one entry
per path (`activeEntries` counts identical active entries once). Loop tests and `break`s are not conditions on what follows the loop.

## 3. API

```ts
// src/formats/zonesetup.ts
extractZoneSetup(pe: Pe, zone: string, scene?: ZoneScene, starts?: number[]): ZoneSetup   // zone = archive name ('z02LGI'); starts = pe.functionStarts()
zoneCodeIndex(pe, starts?): Map<string, ZoneCode>   // loader, builder, root, region of every zone (cached per Pe)
readZoneTable(pe): ZoneTableEntry[]                 // 0x89a9c0: { index, run, kind, name }
ctorName(pe, ctor): string | null                   // source file name of a behaviour constructor ('PepSwitc', 'SGwalk' ...: the first source path string in its code)
activeEntries(list, getVar, unknown = false)        // the entries whose conditions hold for the game variables (call / global / unknown conditions do not hold unless `unknown`)
hiddenRecords(setup, getVar, names?)                // record indices hidden after the set-up (flag writes in code order); `names` resolves the record loops
nameOfEntry(entry) / nameMatches(pattern, name)     // the (wildcard) name a record loop entry is restricted to
const ZONE_ARCHIVES: string[]; FN (engine helper addresses); GLOBALS; RF (record field offsets); RECORD_STRIDE
```

`ZoneSetup` (all entries carry `at` = address of the call / store in the executable, `fn` = the function it sits in, `cond: Cond[]`, `loop?`):

| field | from | content |
|---|---|---|
| `attaches: Attach[]` | `FUN_00423532(rec, ctor, arg, pos, var, mask, value)` | `record`, `ctor` (VA), `ctorName`, `arg` (a constant or the address of the argument block in `.bss`; `argWords` = the first words of a frame-local block), `pos`, gate `var & mask == value` |
| `flagWrites`, `hide`, `show` | `rec + 0x60` 16-bit writes | `op` `and` / `or` / `set` / `unknown` + `mask`; `hide` = writes that clear bit 2, `show` = that set it |
| `fieldWrites` | other stores into record fields | position (`0x3c / 0x40 / 0x44` floats or the sea level `ref`), the variant word `0x64` |
| `boxes` | `FUN_004427e0` (box of the `.col` file), `FUN_004428b0` (radius, height), `FUN_00442780` (x, y, z) | `record` or a record loop (`record -1` + `name` conditions), `kind`, `dims` |
| `modes` | `FUN_00444550(rec, partMask, mode)` | per-part render mode |
| `cutscenes` | `FUN_0045c397(slot, name, messages)` | the two strings |
| `hudHints` | `FUN_00424029(i, a, b, c, d, scale)` | |
| `places`, `waypointMaps` | `FUN_00462be9(map, node, dest)`, `FUN_004630c0(index, path)` | the player's start place: record + waypoint node of map `map` |
| `globalWrites`, `varWrites`, `ctrlFlags`, `controllers`, `fogCalls` | stores into globals, `FUN_00417597` and friends, `FUN_004238b7`, `FUN_0042382c`, `FUN_00442d90` | |
| `seaLevel`, `gravity` | `DAT_009da858`, `DAT_009da9bc` (unconditional store, else the first); `null` = never stored (the previous zone's value stays: sea 0 / gravity -10) | |
| `groundRecord`, `groundName` | `FUN_004425e0(rec)` | the record the terrain ray tests |
| `focusRecord` | `DAT_009da5d8 = records + 0xc + rec * 0x68` | the camera focus = the player record (equals the `PEPP` record in every zone that stores it) |
| `accessoryRecord` | `DAT_009daa7c` | the skateboard record (`SKBD` / `SBRD`), hidden while walking / swimming |
| `fog` | `zoneparams.ts` | the zone's fog block |
| `dynamic`, `unresolved` | | counts of entries whose record is not a constant, and the notes of things not understood |

```ts
// src/game/setup.ts
profileFor(zone, pe, scene?, starts?): ZoneProfile      // sea level, gravity, ground, hub (zone table kind 1), hide list at story state 0, start place, `setup`
setupZone(scene, archive, profile, opts?: SetupOptions): Loaded
SetupOptions = { pos?, yaw?, from?, world?, subgame?, vars?: Record<number, number>, pe? }
Loaded = { world, data, pepper, profile, walk, rigs, setup: ZoneSetup | null, skipped: Skipped[], hasPlayer: boolean, notes: string[] }
registerCtor(address, factory: (attach: Attach) => BehaviourNode) / unregisterCtor / ctorFactory / registeredCtors / CTOR
PROFILES   // the two hand-written M1 profiles (reference) + placeholders for the other zones (setupZone then needs opts.pe and swaps in `profileFor`); live user: the `?play=1` dev entry (src/game/play.ts), the tests (`reference` option of tools/lib/engine-load.mjs)
```

`setupZone`: records from the scene; flag writes, position writes and box colliders of the set-up applied against the game variables of the world (set
`opts.vars = { 0x58: story state }` for the island's era, default 0); `CURRENT_SUBGAME` = `opts.subgame ?? profile.subgame`; the player = the record named `PEPP`; every
attach whose game conditions hold and whose constructor is registered (`registerCtor`: the three ports SGwalk `0x42f470`, sgswim `0x88cf13`, the island's PepSwitc
`0x4bbef8`) is created at its position with its gate, the others are listed in `skipped` (`{ record, ctor, ctorName, pos, at }`). A zone whose player record has no
SGwalk among the attaches gets the M1 chain (PepSwitc / SGwalk / sgswim; the sea nodes only when the zone stores a sea level) so that the player can walk around any
zone; a walk node gated by a zone-local variable (`0xfb` in z10RGB / z21FSH) gets that variable set; a zone with an `sgswim` node but its own copy of the mode switch gets
the M1 PepSwitc in front. (The former `StubGuard` safety net, a port extension that put a fallen player back, is gone.) Zones without a `PEPP` record (z09JST, z39ASB): `hasPlayer` is false,
`pepper` is an invisible dummy record without behaviours, the shell should fly a camera.

## 4. Per zone (counts of the extraction)

`fns` = functions interpreted, `hide (show)` = flag writes clearing (setting) bit 2 under any story state, `fw` = other record field writes, `dyn` = attach /
box / mode / controller entries whose record the interpreter could not name (counted, not listed), `ms` = extraction time (node, after `functionStarts()`;
the first zone includes the 50 ms zone index).

| zone | root | fns | attaches | boxes | hide (show) | modes | cutscenes | HUD hints | fw | places | dyn | ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| z01BPK | 0x493506 | 5 | 3 | 0 | 1 (0) | 0 | 0 | 0 | 11 | 0 | 0 | 74 |
| z02LGI | 0x4b6475 | 203 | 183 | 16 | 449 (19) | 13 | 62 | 6 | 24 | 21 | 375 | 64 |
| z03PPH | 0x53fb1f | 4 | 31 | 0 | 0 (0) | 30 | 0 | 0 | 23 | 0 | 0 | 6 |
| z04IFC | 0x54e6e4 | 3 | 47 | 0 | 0 (0) | 17 | 0 | 0 | 0 | 0 | 0 | 5 |
| z05WAB | 0x569ca6 | 4 | 2 | 0 | 0 (0) | 0 | 0 | 0 | 0 | 0 | 0 | 6 |
| z07CSI | 0x574d9c | 19 | 311 | 10 | 47 (16) | 5 | 10 | 4 | 8 | 28 | 2 | 25 |
| z08BKD | 0x5ba1bd | 15 | 36 | 0 | 9 (0) | 1 | 0 | 0 | 0 | 0 | 0 | 7 |
| z09JST | 0x5ce27f | 6 | 19 | 0 | 0 (0) | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| z10RGB | 0x5f690b | 11 | 17 | 4 | 1 (0) | 0 | 0 | 0 | 0 | 0 | 0 | 5 |
| z13CAI | 0x61beae | 4 | 13 | 0 | 1 (1) | 2 | 0 | 0 | 0 | 0 | 4 | 5 |
| z14OSD | 0x629788 | 9 | 54 | 9 | 11 (0) | 4 | 2 | 4 | 2 | 0 | 2 | 7 |
| z15SSH | 0x65760c | 3 | 5 | 0 | 0 (0) | 0 | 0 | 0 | 9 | 0 | 0 | 5 |
| z16PYA | 0x676c22 | 8 | 35 | 5 | 15 (0) | 1 | 2 | 4 | 3 | 0 | 0 | 8 |
| z17WAS | 0x699dc7 | 4 | 2 | 0 | 1 (0) | 0 | 0 | 0 | 2 | 0 | 0 | 7 |
| z18MMP | 0x6a489a | 9 | 41 | 0 | 33 (3) | 0 | 0 | 0 | 15 | 0 | 2 | 8 |
| z20DSP | 0x6bf929 | 7 | 27 | 0 | 2 (0) | 21 | 0 | 0 | 3 | 0 | 2 | 6 |
| z21FSH | 0x6f468d | 5 | 11 | 1 | 2 (0) | 3 | 2 | 0 | 4 | 0 | 0 | 4 |
| z22BIP | 0x708457 | 5 | 39 | 0 | 0 (0) | 0 | 0 | 0 | 1 | 0 | 4 | 8 |
| z23DIP | 0x7272ee | 7 | 124 | 8 | 35 (0) | 1 | 2 | 4 | 3 | 0 | 0 | 8 |
| z27TRX | 0x766b85 | 7 | 6 | 0 | 0 (0) | 8 | 0 | 0 | 0 | 0 | 12 | 5 |
| z28HAT | 0x7927b5 | 4 | 23 | 0 | 8 (0) | 1 | 2 | 0 | 0 | 0 | 0 | 6 |
| z36CNT | 0x7afd2d | 4 | 2 | 0 | 0 (0) | 0 | 0 | 0 | 0 | 0 | 0 | 5 |
| z38PAR | 0x466e90 | 4 | 8 | 0 | 0 (0) | 0 | 0 | 0 | 0 | 0 | 0 | 4 |
| z39ASB | 0x7b7281 | 6 | 1 | 0 | 0 (0) | 1 | 0 | 0 | 0 | 0 | 0 | 6 |
| z40aPO | 0x7d0b50 | 4 | 6 | 1 | 6 (0) | 5 | 1 | 0 | 0 | 0 | 0 | 7 |
| z40OGL | 0x7e4222 | 11 | 97 | 0 | 11 (0) | 3 | 3 | 4 | 0 | 1 | 0 | 5 |
| z41MAP | 0x813cce | 5 | 11 | 0 | 0 (0) | 0 | 0 | 0 | 0 | 0 | 0 | 4 |
| z42BRP | 0x8212a3 | 5 | 9 | 0 | 0 (0) | 0 | 1 | 0 | 0 | 0 | 0 | 4 |
| z50LTC | 0x839c09 | 4 | 4 | 1 | 1 (0) | 0 | 0 | 0 | 3 | 0 | 2 | 6 |
| z60FRE | 0x47172c | 2 | 11 | 0 | 0 (0) | 4 | 0 | 0 | 0 | 0 | 0 | 4 |

The island's numbers include every story state (conditions `v58 <= 6`, `7..29`, `30..51`, `52..60`, `>= 61`, FUN_004b6475's five arms) and the castle's
(stage sets by `var 0x58 < 0x12 ...`); `activeEntries` picks the ones for the game variables of a world. The 375 dynamic island entries are the NPC / prop spawner helpers
(`FUN_004c2010` ... `FUN_004c2c83`, reached through the story handler `FUN_004b7040`) that attach nodes to records obtained at run time.

Zone facts read from the set-up (era 0 where it matters; player chain = attaches on the `PEPP` record, `pos[var&mask=value]`):

| zone | subgame | PEPP | focus | ground | sea | gravity | skateboard | player chain |
|---|---|---|---|---|---|---|---|---|
| z01BPK | 1 | 35 | 35 | - | 0 | -10 | 36 | PepSwitc@0 Walk@1[5e&1] skate@2[5e&4] (zone copies) |
| z02LGI | 2 (31, 32, 33) | 16 | 16 | 4 LAND | 2.4 | -10 | 9 | Music@0 **PepSwitc**@1 **SGwalk**@2[5e&1] **sgswim**@3[5e&2] 0x43310c@4[5e&4] SGVehic@5[5e&8] Ptera@6[5e&0x40] |
| z03PPH | 3 | 33 | 33 | - | - | - | - | ClimLadr@0 **SGwalk**@1 PeppComp@2[5e&4] Trophy@3[5e&2] Trophy@4[5e&0x20] |
| z04IFC | 4 | 7 | 7 | - | - | - | - | Map@0 |
| z05WAB | 5 | 0 | - | - | - | - | - | pepwab@0 |
| z07CSI | 6 | 7 | 7 | 3 LAND | 0 | -10 | 68 | Control@0 **SGwalk**@1 **sgswim**@2 0x43310c@3 SGVehic@4 Horse@5[5e&0x10] |
| z08BKD | 7 | 5 | - | - | - | - | - | SwimBeh@0 CamBeh@1 |
| z09JST | 8 | **none** | 15 (JKIT) | - | - | - | - | - |
| z10RGB | 9 | 146 | 146 | 4 LAND | 0 | -10 | 23 | PepSwitc@0 **SGwalk**@1[fb&1] PeppHit@2[fb&2] |
| z13CAI | 10 | 40 | 40 | 4 LAND | - | - | - | SGVehic / Ptera (story-state dependent) |
| z14OSD | 11 | 4 | 4 | 3 LAND | 0 | -10 | 64 | PEPPSW@0 scorpion@1[5e&0x20] **SGwalk**@2 **sgswim**@3 0x43310c@4 |
| z15SSH | 12 | 22 | - | 1 LAND | - | - | - | Walk@0 |
| z16PYA | 13 | 3 | 3 | 1 LAND | -400 | -10 | 17 | PeppSw@0 scorpion@1 **SGwalk**@2 **sgswim**@3 0x43310c@4 |
| z17WAS | 14 | 0 | 0 | - | - | - | - | pepwas@0 |
| z18MMP | 15 | 121 | - | - | - | - | - | Walk@0 |
| z20DSP | 16 | 38 | - | - | - | - | - | SpeedStr@0 |
| z21FSH | 17 | 6 | 6 | 4 LAND | - | -10 | none | FSwitch@0 **SGwalk**@1[fb&1] Fishing@2[fb&2] |
| z22BIP | 18 | 74 | - | - | - | - | - | PSwitch@0 Walk@1[fa&2] Recover@2 Takeoff@3 Landing@4 |
| z23DIP | 19 | 16 | 16 | 2 LAND | -80 | -10 | 28 | PeppSw@0 **SGwalk**@1 **sgswim**@2 0x43310c@3 |
| z27TRX | 20 | 335 | - | 0 LAND | - | - | - | trex@0 |
| z28HAT | 21 | 151 | - | 1 LAND | - | - | - | pepp@0 |
| z36CNT | 24 | 19 | 19 | - | - | - | - | - |
| z38PAR | 25 | 8 | 8 | - | - | - | - | test@0 |
| z39ASB | 26 | **none** | 1 (SHUT) | - | - | - | - | - |
| z40aPO | 30 | 6 | 6 | - | - | - | - | Parogel@0 |
| z40OGL | 27 | 2 | 2 | 1 OGEL | -96 | **-7** | 29 | PeppSwit@0 **SGwalk**@1 0x43310c@2 PeppSwit@3[5e&0x20] |
| z41MAP | 28 | 1 | - | - | - | - | - | Pepper@0 |
| z42BRP | 29 | 90 | 90 | - | - | - | - | pepbrp@0[fa&0x7fff=1] peptop@1[fa&0x7fff=2] |
| z50LTC | 34 | 11 | 11 | 1 CAVE | -800 | -10 | 32 | pepswitc@0 **SGwalk**@1 0x43310c@2 |
| z60FRE | 0 | 0 | 0 | - | - | - | - | Walk@0 |

(`-` = not stored by the set-up. Bold = a shared / ported constructor.) Several zones do not store the camera focus in their set-up (the zone's own camera code does);
z05WAB / z17WAS have the player at record 0.

## 5. Findings

* **The shared library nodes.** `SGwalk` (`0x42f470`) and `sgswim` (`0x88cf13`) are the same function in every hub (island, castle, oasis, pyramid, dino island, Ogel, cave,
  Pepper's house, and the walk part of z10RGB / z21FSH); each zone has its own copy of the mode switch (`PepSwitc.c` family: `PepSwitc`, `Control`, `PEPPSW`, `PeppSw`, `PeppSwit`,
  `pepswitc`, `FSwitch`, `PSwitch`) and of the vehicle nodes. Gates: walk `0x5e & 1 == 1`, swim `& 2`, skateboard `& 4` (`0x43310c`), vehicle `& 8` (`SGVehic`
  `0x4333c2`), horse `& 0x10`, pizza / talk `& 0x20`, Ptera `& 0x40`. The mini-games use their own `Walk` copies gated by zone-local variables (`0xfa`, `0xfb`).
* **M1's hand-written island profile had small errors, all found by the extraction** (resolved in `PROFILE_LGI`, see its comment): the umbrella `UMB1` is record 111
  (`0x2d18 / 0x68`, LE2.c:76151), not 112, its box radius is `0x402a7efa` = 2.664 (not 2.667) and its z is 230.0 (`0x43660000`, not 230.4); the hide list lacked
  `XXX3` (42) and `BML2` / `BML4` (367 = `flags = 0x20`, 369 = `flags = 0`; `FUN_004b4907` at 0x4b4c3b / 0x4b4c97 / 0x4b4cf7) and the era-0 set
  (`FUN_004c0ca9` -> `FUN_004c0750(1)` -> `FUN_0052bc9b` / `FUN_0052cba0`: `BILL`, `PAG1`-`PAG4`, `BTB0`-`BTB9`; 0x52c30c, 0x52c424, 0x52f5b5). The extraction also
  sets `flags |= 0x10` on records M1 left alone (`SEAE`, `PIZ0`-`PIZ3`, `CNST`, `RHCP`) and moves `HSE1` (-40.15, -434.66), `CNST` and sets the y of `SPLH` to the sea level.
  The test asserts equality on everything M1 modelled (hidden records, colliders, sea level, gravity, ground, start place, PEPP flags, the node chain) and lists the rest.
* **Pepper's house has no `PepSwitc` and no `sgswim`** (LE2.c:94860-94864: `ClimLadr`, `SGwalk`, `PeppComp`, 2x `Trophy`); M1 gave it the island chain. With the extraction the house chain is `SGwalk`
  only (the ladder / computer / trophy nodes are skipped until ported); all engine tests pass unchanged. The house stores no sea level, gravity or ground record.
* **Sea level, gravity, skateboard**: sea 2.4 (island), 0 (castle, oasis, z10RGB, z07CSI ...), -400 (pyramid), -80 (dino island), -96 (Ogel), -800 (cave); gravity -10 everywhere
  it is stored except **z40OGL = -7** (`0xc0e00000`, LE2.c:245678). `DAT_009daa7c` (M1: "9 in the island") is the skateboard record of the zone (`SKBD` / `SBRD`) in 9 zones, -1 in z21FSH.
* **The story state is the era.** The island set-up has five arms on `var 0x58` (`< 7`, `< 0x1e`, `< 0x34`, `< 0x3d`, else), each calling its own set (`FUN_004c0ca9`, `4c070c`, `4c015e`,
  `4bfd7d`, `4c0ca9` again) which calls `FUN_004b4220` (the player chain) and the NPC / prop sets; the record 66 (Ptera) is hidden before state 0x34 and gets the Ptera node from it (LE2.c:75552).
  `FUN_004c0750` puts PEPP at node 0xf6 (246, the skate park) of waypoint map 1 (W_PATH) in states 0-3 (LE2.c:80773), `FUN_004c01a0` at node 0x199 in states 7-29, node 191 at state 61.
* **Sub-game ids = zone table indices** (`subgame` column above). M1 notes "jumping disabled in sub-game 3 (the house) and 0x11 (WAS)": 0x11 = 17 is **z21FSH** (fishing), z17WAS is 14.
  Table entry 22 = 0x16 (the second sea-loop size in `swim.ts`) is the empty z29PAI (no run function), so that branch cannot run in this build. Sub-game 9 = z10RGB (the zone has its own camera, which the walk node does not drive).
* The record-name loops are compiled three ways: `strncmp(name, "ROCK", 4) == 0` (island boxes), a dword compare `name == 'TRIC'` and byte compares `name[0] == 'P' && name[1] == 'A' ...` (island
  `PAG*`, z27TRX); the table loops `for (i = 0; table[i] != -1; i++)` (z22BIP: `prop`, `JerryCan`) take the record indices from tables in `.data`.
* Cutscene slots (`FUN_0045c397`) name the cutscene text and the message file (`LGIBR08` ...); the HUD hints (`FUN_00424029`) are 6 icon pairs in the island, 4 in the hubs.

## 6. The generic player chain of `setupZone` (history of the stub requirement)

> **State 2026-10-31.** All 30 zones are ported (the island, the six hubs, 19 mini-games, the rooms). In M2 every zone without ported gameplay ran as a stub in which the player simply walks: `setupZone` added the M1 chain
> (PepSwitc / SGwalk / sgswim, gated by `PEPPER_CONTROL`) to a player record without ported behaviour, plus a `StubGuard` safety net that put a player who fell out of the scene back. The `StubGuard` is gone (it was a port extension
> that the original does not have: where the original has no wall the original's player falls on as well). The generic M1 chain is kept as set-up scaffolding for the zones that run their own player node (the mini-games, z50LTC, the hubs): each of
> them removes it again in its own set-up (`PepSwitc` / `SGwalk` / `sgswim` filters in `src/zones/*`), and `Loaded.notes` lists what that scaffolding did. `tools/tests/zonesetup.mjs` still loads all 30 zones and ticks 300 frames with Up held (no exception, no NaN / Infinity in the player,
> the camera or the matrices); the remarks below are the observations of M2 for the bare set-up, they are not defects of the ported zones (those have their own camera, walls and rules).

| zone | remark of the bare set-up |
|---|---|
| z09JST, z39ASB | no `PEPP` record (jousting knight `JKIT`, the shuttle `SHUT` are the focus): `hasPlayer` false, dummy record, fly camera |
| z05WAB, z17WAS, z41MAP, z42BRP, z40OGL | the generic player walks off the edge of the (small / floating) scene (the original keeps the player in with walls and game code, which the zones' own nodes have) |
| z10RGB | `CURRENT_SUBGAME` 9: the walk node does not move the camera (the zone has its own camera: ported in `src/zones/z10rgb`), the generic player leaves the fixed view |
| z08BKD, z22BIP, (z39ASB) | no `anim/MFIG.blk` in the archive: static player (no animation), it still moves and collides |
| z36CNT, z38PAR | the generic player hardly moves (walls / a closed scene; z38PAR starts 50 units up and ends 2 units from its start) |

No zone needs a ground record: the walk code follows the ground with sweeps and uses the terrain ray / sea level only as a fallback. 17 zones have no ground record in the set-up (the table above).

## 7. Approximated or not resolved

* **Dynamic records**: attach / controller / box / mode calls whose record is returned by a call (`FUN_0051e4b0(1, 1)`), taken from a pointer parameter the caller built at run time, or walked
  with a pointer are only counted (`ZoneSetup.dynamic`, all kinds): 375 in the island (the NPC spawners), 12 in z27TRX, 4 in z13CAI and z22BIP, 2 each in z07CSI, z14OSD, z18MMP, z20DSP and z50LTC. Record loops whose name test the interpreter
  does not understand keep `record -1` + `loop` (`setupZone` skips them).
* **Attach arguments**: `arg` is the constant or the address of the argument block in `.bss`; blocks filled through a pointer the callee received (`*param_1 = 0x196`) are not followed (`arg: null`).
  The node arguments the ports need (waypoint routes, trophy slots ...) will have to be read from the executable's `.bss` initialisers / frame blocks by the milestone that ports the node.
* **Values computed with x87** (`fld` / `fstp`, e.g. `rec.x += rec.dx`) are not tracked: only stores of constants, globals and waypoint positions become `fieldWrites` / `places`. `FUN_004b6475`'s
  per-record `rec.ry = -rec.ry` negation loop is therefore not in the tables (the builder / the scene already carries the sign the engine uses).
* **No merging of register / frame state at joins**: arms run in code order; `a || b` and compare chains are exact for the conditions, but a value assigned in one arm is seen by the next. A flag write that
  merges two arms into one store (`flags = c ? flags & ~2 : flags | 2`, z10RGB twice) is recorded with `op: 'unknown'` and not applied. A `jmp [table]` switch leaves the code behind it under an unknown condition.
* **Conditions the port does not model are "not holding"**: `call` conditions (e.g. `FUN_0041ad80(0x4f)`: the island's 10 `show` writes of `0x8e90 ...` depending on a save-game value), `global`,
  `unknown`. `activeEntries(..., true)` treats them as holding. The names of the game variables come from `GameVars.loadNames`.
* **Not extracted**: the GameLoop-level code (`FUN_0042207d(PEPP)`, `FUN_00421bbe`, exit states, sound handles `FUN_004b037e`), behaviour constructors and per-frame code (M3+), the island's arrival place
  from another zone (`FUN_004c2d22`: kept from M1 in `profileFor('z02LGI')`; the other zones use the extracted `places`), the controller flags `FUN_004238b7(ctrl, 0xb)` (recorded as `ctrlFlags`, not applied: the port's
  controller keeps its M1 flags), render modes `FUN_00444550` (recorded; applied since WP-RENDER through `GameRenderer.setPartMode`, gaps.md R4), the variant word `+0x64` is applied (`GameRecord.variant`).
* **Region heuristics**: the 0x800 byte stub margin and "direct calls inside the region" can follow a function of a neighbouring zone that sits behind this zone's run function; every followed function is
  listed in `ZoneSetup.functions`. 883 of the 1108 `FUN_00423532` call sites of the executable are in the tables; the others are dynamic (above) or sit in code the set-up chain does not call (behaviour constructors, per-frame and story code reached through pointers, e.g. the island's FSM `FUN_004b8c73`, the cutscene starters `FUN_0051e19c`).
* Cost: 4-74 ms per zone after `pe.functionStarts()` (12 ms) + the 50 ms zone index; the test bound is 300 ms.

## 8. Tests

`node tools/test-formats.mjs --only zonesetup` (about 3 s):
the interpreter extensions on a synthetic function (16-bit read-modify-write, a guarded call, legacy mode unchanged); the zone table and index (30 zones, root, region); per-zone counts
(section 4, the regression table) and the time bound; structure (entries inside the region, attaches on existing records); spot checks with the decompile lines (FUN_004b4220 chain and gates, the five
story-state arms, the Ptera condition, PEPP flags, sea level / gravity / accessory / focus / ground, the box loop and the three single boxes, render mode, HUD hints, the start place and waypoint map, FUN_0053ea4d's
chain and `Trophy` argument words, z40OGL gravity -7, sea levels, subgame ids, constructor names, the focus record = PEPP in 19 zones); the equality with the M1 profiles for z02LGI / z03PPH (records, colliders, hidden
records, sea, gravity, ground, node chain, start place; allowed differences listed in the notes); the constructor registry (`Loaded.skipped`, `registerCtor`); the 30-zone walk of section 6. The existing
`engine-*` tests run on the extraction (`loadZone`), `loadZone(ctx, zone, { reference: true })` runs the M1 profile.
