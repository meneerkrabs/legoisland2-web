# M4 WP8: the island zone game (story handler, HUD, loop integration)

Files: `src/zones/z02LGI/index.ts` (zone game + set-up hooks), `story.ts` (FUN_004b7040), `objective.ts` (the objective globals + FUN_00424e37),
`arrival.ts` (FUN_004c2d22), `ctx.ts` (the real `IslandCtx`); shell edits: `src/shell/zonegame.ts` (`registerZoneSetup`, `ZoneGameCtx.sayFrom`,
`ZoneGame.beforeTick / storyTick / introPanel`), `src/shell/playzone.ts` (the hooks, HUD update every frame), `src/shell/hud.ts` (`initIsland`, `updateIsland`
re-ported), `src/shell/audiohost.ts` (`rate`), `src/zones/index.ts` (import), `src/island/ctx.ts` (`objective`). Tests: `m4-wp8-story`, `m4-wp8-island`,
`shell-ui` (HUD part adapted); browser step `tools/steps/m4-island.mjs`.

## 1. Loop FUN_004afaf7 and what the port does where

| original | port |
|---|---|
| FUN_004b037e (sound handles), FUN_0045f9d2, FUN_0041b40e | runner / WP4 `LGI_SOUNDS` |
| FUN_004b6475 set-up | `profileFor('z02LGI', ..., { islandVars: sh.vars, archive })` through `registerZoneSetup(...).profileOptions`: the x86 emulation runs against the live variables (its var writes, FUN_004c3226's era reset included, land in `sh.vars`) |
| FUN_0042207d(PEPP) | `afterSetup`: Pepper's walker on PATH, node -3, NPC tuning, lane 0.01 (`pepper.ctrl.walker`) |
| FUN_0041adb5 (pending load) | runner (`sh.applyPendingLoad`) |
| FUN_00423bf0 | `computeIslandTotals` (z03PPH/totals.ts) in the zone game's constructor |
| `FUN_00417597(0x120, 1)` | constructor |
| HUD set-up FUN_004b8ef0 | `hud.initIsland` |
| mode 7 -> 0 -> 1, mode 1 waits for `DAT_00983840 != 0` | `config.intro = true` + `introPanel = false`: no panel, no brief, any button but Esc; the world is drawn frozen |
| mode 2: FUN_0045c402, FUN_0042226e | `beforeTick` = `cutscene.tick()`, then `world.tick()` (+ `applyCarried`, WP2) |
| FUN_004636fc, FUN_0045c42d | empty in the executable |
| FUN_004b908d | `hud.updateIsland` every frame (all modes, like the original) |
| FUN_00423bad | `sh.story.frame()` (runner) |
| FUN_004b7040 when var 0x58 != local_8 | `storyTick` (runner calls it after the story frame when the zone is not left); exit 2 -> `exitNext` returns the handler's zone (0x1f) |
| var 5 != var 0x59 -> exit 8 | runner |
| FUN_00423f7b (debug auto-advance, DAT_009da634) | not ported |
| pause FUN_0041bd3d(.., 0x80, 0) | `HUB_CONFIG` (page 5, mask 0x80) |

Dev aid kept from the stub: F9 completes the condition of the current story node.

## 2. The story handler FUN_004b7040 (story.ts)

Hand port, node bands exactly as the decompile, records as `off / 0x68` (flags `(off - 0x60) / 0x68`, controllers `(off - 0x5c) / 0x68`). Returns 1 (stay) or
2 with `next = 0x1f` (band node 7: the era-1 island; normally the FSM leaves first because node 7's zone is 31). While a cutscene runs it does nothing and `prev`
stays, so it runs again next frame (and then sees the older `prev`: no "just advanced" actions when a cutscene ran across a node change, as in the original).

Per band: message tables (`lifsmN` -> `ctx.text.npc`, `liholN` -> `ctx.text.hol`, read from the executable's strings, loaded from the messages archive,
41 files, all present), the objective, visibility (records 11, 14, 29, 12, 13, 32, 31, 112, 68), one-shots when entered from `node - 1`: node 4 (hologram alert,
PEPPHOUSE_SIZE = 100, BLDG_PHSE |= 9), 9 (alert, MOVE_INFO = 0x4000), 0x1f (alert), 0x36 (ten era-3 walkers re-pinned: records 17..26 on PATH 0x171 .. 0x133),
0x37 (alert). Unconditional writes: node 9..12 MOVE_INFO, 0x36 resets the Pizza nodes of records 13 / 12 (FUN_00429638: the port calls `storyReset(0, 0)` on a
node that has it: WP5), record 68 shown for nodes 0x37..0x3a only.

At zone start the handler runs once in "set-up mode" (tables + objective only): the emulated set-up already made that call's record / variable writes.

**Verification** (`m4-wp8-story`): for every node 0..72 the original handler runs in the emulation twice: with the set-up's uninitialised `prev`, and "just
advanced" (a hook on FUN_0045c432, the handler's first call, writes `node - 1` into `*prev`; records without a controller get a dummy block so the walker reads
are defined). Calls (objective setters with resolved records and radii, text files, FUN_00429638, FUN_0046140f / FUN_004625d7 with nodes), visibility bit 2 of
every flag store and the variable writes are identical to the port: 507 checks.

## 3. The objective (objective.ts): there is no HUD arrow

FUN_00424270 / 00424230 / 0042419f / 004242b9 / 004241df set `DAT_009da82c` (mode) and up to four record pointers / a PATH node; `DAT_009da840` (radius^2)
is written but never read. The HUD draw (FUN_0046055f: corner icons, three texts, icon column, gauge) has no arrow. The target (FUN_00424e37) is read by the
generic talk NPC after its line (FUN_004254a5: `FUN_004627e2(walker, target + 0x30)`, it turns / points there) and by the hologram node (0x88d6xx). Modes:
1 record, 2 the second record (the first while Pepper rides a vehicle with a delivery list), 3 PATH node, 4 the nearest visible of four by controller distance,
0 the nearest talk NPC (controller flags & 0x50, distance^2 > 8, head node SGMFIG with `talk50 != 0`, not the caller). The vehicle delivery-list branch
(var 0x5e & 8 with DAT_009da9f8 hi word -2 / -3) is not ported (no target). `ctx.objective` exposes `target(from)` and `holoTimer` (DAT_05defbcc, FUN_0088d2bc
= 90; the hologram counts it down). Note: emusetup names FUN_0088d2bc `textFile2Angle`; it only sets that timer.

## 4. Arrival FUN_004c2d22 (arrival.ts)

By PREV_SUBGAME (FUN_0041ad80(0xa3)): 3 z03PPH -> PATH 0xef facing away from PHSE; 4 / 5 -> PATH 0x10b (INFC); 6 (castle) -> 48.8 units from PORS (162) towards
record 123 on the boat (FUN_0051e4b0(1, 0) by var 0xbb, default SPBT), PEPPER_CONTROL 8; 10 / 11 / 13 / 0x13 -> 48.8 from PORA (161), helicopter (default
PHEL 165) or Ptera (record 66 -> control 0x40); 0x18 z36CNT -> CTRL (113), PATH 0xff (node < 0x3b) or 0xd7; 0x19 z38PAR -> SPBT (163), 0xff or 0x18e;
else SKTP (130), PATH 0xf6. Yaw = atan2(dx, dz) from the base record, wrapped. The vehicle gets Pepper's matrix. Also clears vars 0x3e, 0xbe, 0xb6, 0xb2, 0x10, 0x82
(done by the emulation). The port replaces `PROFILE_LGI.start` (identical for the two cases it had). Verified against the emulated PEPP record: walking cases
same position and yaw; vehicle cases same yaw / vehicle / control, **but the emulation's position is wrong there**: FUN_0043cec0 (vector normalise) is not in
emusetup's native list and returns without normalising (Pepper lands 48.8 x |d| away). Fix for WP1 / lead: add 0x43cec0 to `NATIVE_ENGINE`. PEPPER_CONTROL of
a vehicle arrival is set only when Pepper's chain has a node for that mode (WP6), else walking + a note.

## 5. HUD (hud.ts, FUN_004b8ef0 / FUN_004b908d / FUN_004b9008)

Corrections to the M2 version: the centre text is var 0x12 (HISCORE_LGI) as `%04d`; before node 7 the left counter is `(11 - var 0xb0)/c` with c = 12 at node 6
(the numerator stays 11 - pizzas); the icon column is fixed: slot 0 = interaction icon, slots 1..4 = coloured bot heads (they were shifted up before); the
heads are hidden (texture -1, not white) when var 0x8e >= 0xf or in sub-game 0x20; the interaction icon keeps its last texture while a bit is set but Pepper is
not walking, the 0xc0 icon blinks 0xf / 0x10 (15 / 30 frames); var 0xc is cleared after reading (the nodes set it each frame). Icons are set once per zone run
(the era is fixed per run).

## 6. Context (ctx.ts) and cutscenes

`IslandContext` is created in `beforeSetup` and installed before `setupZone` (factories may use it); `bind` attaches the runner's services. Implemented: cutscene
start / active / hold, `say(table, id, id2)` (runner `sayFrom`: speech + subtitle), sfx / stopSfx / sfxAt (3D slots) / sfxFreq (`AudioHost.rate`), expression
(`GameRecord.face`), music / musicGroove / musicMute / ambience (GameAudio), animClip / switchVar, `scene`, `objective`. Not implemented (optional, nodes run
without): `particles`, `brickBurst`, `brickMorph` (FX, WP9), `inFrustum` (no frustum flag in the renderer), `cameraHold`, `musicNotified`.
Cutscenes: the 41 slots of the set-up are declared (`zone` z02LGI, area li); LGICI05 has no `LI/Data/LGICI05.str` and is left out. The host gets the shared
`waypoints` (WP3 loads the island maps into it) and the set-up's dictionaries. Subtitles of SAYTEXT are drawn by `draw2d`.

## 7. Open / for the lead

* Mode 1 now waits for a key on the island: every headless step that enters the island must press a key (e.g. `ArrowLeft`) before it expects ticks
  (tools/steps/m3-*.mjs, game-island, shell-*).
* WP4 (`trigger/lgifsm.ts`) and WP7 (`ambient/director.ts`) both port FUN_004b7c78 (LGI_FSM); WP4's is registered, WP7's `registerDirector` / `directorTick`
  is not called.
* BrickBot.c, the delivery-list objective branch, FUN_00423f7b, STARTEDFROMMENU replays (the island is never replayed; the cutscene runner ignores starts when var
  0xb != 0), saving more than Pepper's place.
* emusetup: FUN_0043cec0 native (section 4).
* Headless runs on the shared dev server get reloaded by the other workers' edits (HMR); a private server without HMR: a config that spreads `vite.config.ts`
  with `server: { port: 5498, hmr: false, watch: null }`.

## Differential test (WP-VERIFY)

> Status after WP-ISLAND-FIX: every KNOWN DEVIATION named in this section is fixed in the port and the test runs at tolerance 0 without the filters (`docs/re/gaps.md`, "Deviations FIXED by WP-ISLAND-FIX"); the sentences below describe the state when the deviation was found.

`tools/tests/m7-isl-veh-story.mjs` (lib `tools/lib/m7-isl-veh-story.mjs`, 958,933 checks, ~2 s): the original `FUN_004b7040` and `FUN_00424e37` run natively in the x86 emulation (`IslEmu` of `m7-isl-veh-emu.mjs`: the island's
machine state of the original's own set-up, FPU at 24 bit) next to the port's `storyHandler` + the real `liveStoryEnv` (z02LGI/index.ts) over the port world.
* **Handler**: all 73 nodes x previous node {node-1 (just advanced), node-2, node+1, 0, -1, 72, uninitialised 0xcccccccc} x cutscene on / off x seeded random flag words of the 9 records it writes x random state of the
  pizza-carry nodes of records 12 / 13 (era 3 world). Per call: return value, `*next`, `*prev`, the text-table calls (path strings), the objective globals (mode, 4 record pointers, PATH node, radius^2), every record's 16-bit
  flag word, every variable store (op + value) and the whole variable array, the hologram alert timer (DAT_05defbcc), the walker pins (FUN_0046140f / 004625d7 arguments: all ten records and PATH nodes of node 0x36), the
  pizza-carry reset. dt has no part in it (no `DAT_008b1718` reference in 0x4b7040..: checked on the disassembly); both Duel dts run.
* **Objective target `FUN_00424e37`** (4000 random cases: modes 0 nearest talk NPC / 1 / 2 / 3 PATH node / 4 nearest of four; Pepper walking, and the vehicle branch var 0x5e & 8 with kind -2 / -3, docks / pads free or
  taken): found / not found, target record, target position; the berth tables (counts, nodes, maps) read from the original's memory.
* **Result: exact except**: (1) KNOWN DEVIATION `story-0x36-pizza-reset-missing`: node 0x36 calls `FUN_00429638(ctrl, 0, 0)` on records 12 and 13 (PAPA / MAMA), which zeroes the carry node's bone (+0x20), carrier
  (+0x24), push flag (+0x2e) and timer (+0x34). The port's `liveStoryEnv.pizzaReset` looks for `storyReset` on the node, which `CarryNode` (island/pizza/carry.ts) does not have: the reset never happens (the docs
  section 2 claim "the port calls `storyReset(0, 0)`" is wrong). Evidence: node 54, prev 53: original 0,0,0,0 (bone, carrier, timer, flag), port 11,1,240,1. Fix: `CarryNode.storyReset(a, b)` (carrier = null, bone = b,
  timer = 0, pushPending = false) in src/island/pizza/carry.ts (not edited: owned elsewhere). (2) Not compared, indeterminate in the original: in objective mode 3 (PATH node) `FUN_00424e37` never assigns its return
  local (`[ebp-0x40]`, jump to 0x4252bc): the return value is stack residue (false in 12 of 584 emulated cases); the written target position is identical. The story handler leaves mode 3 only transiently
  (`objNode(0x1a5)` is overwritten by `objRecord(-1)` in the same call), so no gameplay consumer sees it. (3) With no free berth the vehicle branch reads `FUN_00462be9(1, -1)`: the debug heap header before the node
  array; not observable in the emulation (bump heap), counted, not compared.
* Docs corrections: wp8 section 3 says the objective's mode 1 reads a "record", fine, but the dead `local_40` test in mode 1 (0x42507d..) is a dead branch (`[ebp-0x3c]` is overwritten by 1 at 0x4250bc): the mode-1
  target is returned unconditionally, as ported. A record with a null pointer in mode 4 crashes the original (reads +0x60 of it); the story never sets one.

## Status 2026-10-31 (WP-ISLAND-CLOSE: the statements of this document that are out of date)

* **Objective mode 3** (PATH node, `FUN_00424e37` return value `[ebp-0x3c]` never written): evidence that it has no consumer on the island: its only island producer is the story handler's `FUN_004242b9(0x1a5)` at 0x4b7bf5, and the very next call (0x4b7c04) is `FUN_00424270(0, 16.0)` = `Objective.record(null)`, which clears the mode in the same call: none of the consumers (FUN_004254a5 at 0x4258a0, the hologram at 0x88d7bd / 0x88d847) can run between the two calls, so they never see mode 3 on the island (the hubs' producers 0x574e7c / 0x575303 / 0x61b2c5 / 0x7e3d3f are the hub owners'). The residue itself (stack slot of the FUN_004254a5 frame, depends on whether the subtitle path FUN_0045d47f ran, on the speech queue and on earlier frames) cannot be reproduced without the original's text / sound code; the port's answer is "found" whenever the PATH node exists.
* **No free berth** (vehicle branch, `FUN_00462be9(1, -1)`): the node array's element -1 is the heap block header (MSVC debug heap, `_CrtMemBlockHeader`: pointers, file name, line, size): the position read as floats is about (1e-38, ...) = the origin; the port returns the origin.
