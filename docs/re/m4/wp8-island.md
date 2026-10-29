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
