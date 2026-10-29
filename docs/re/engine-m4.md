# The island z02LGI with its story, milestone M4 (`src/island/`, `src/zones/z02LGI/`)

The island plays through its four story eras (zone table ids 2 / 31 / 32 / 33, era 4 = id 2 again) with the nodes of the original: story handler, talking NPCs and their
waypoint routes, cutscenes started by trigger nodes, doors / portals / buildings, pizza delivery, Pepper's modes (skateboard, boats, helicopters, cars, Ptera / glider),
ambient life, brick effects, music, HUD counters. A new game goes from the front end through chapter 1 into the first mini-game (Whack-A-Bot) and back; the later
chapters are played by shortcut (`?zone=z02LGI&node=N`). Per work package details (ported functions with addresses, constants, findings, approximations) are in
`docs/re/m4/wp*.md`; the running log is `docs/re/m4/progress.md`; how the set-up is produced is `docs/re/m4/emu.md`.

## Design

* **The island's set-up is run, not transcribed.** `src/formats/x86emu.ts` is a concrete 32-bit x86 + x87 interpreter that executes the original's own set-up code
  (`FUN_004b6475`, the per-era roster functions, the loader for the animation-name dictionary) inside the user's executable at run time; `src/formats/emusetup.ts`
  hosts the engine functions (attach, controllers, boxes, cutscene slots, dictionaries, waypoint maps, game variables, brick calls ...) and returns every attach with
  the 0x80-byte argument block the constructor would have read, the record changes, the dictionaries (`SWITCH_LGI_*`, 339 animation names) and the story handler's
  calls. About 270-300 attaches per era, 20-35 ms. Nothing of the executable is stored in the repo. The same CPU can run the other hubs' set-ups (M5).
* **The behaviours are hand ports of the decompile**, one file per node family, registered by constructor address (`registerCtor`, `src/game/setup.ts`); their argument
  layouts are decoded from the constructors (`ArgView`, `src/island/args.ts`). Nodes talk to the shell through `IslandCtx` (`src/island/ctx.ts`, implemented in
  `src/zones/z02LGI/ctx.ts`; the node tests use the mock of `tools/lib/island-load.mjs`).
* **The island zone game** (`src/zones/z02LGI/index.ts`) owns what the original's `FUN_004afaf7` does around the nodes: emulated set-up against the live game variables,
  arrival place (`FUN_004c2d22`), the one-time-per-era variable reset, the story handler `FUN_004b7040` (ported by hand: node bands, message tables, objective, visibility,
  just-advanced actions; compared call by call with the emulated original for every node), the cutscene host, mode 1 (waits for a button), HUD, save of the vehicle.

## Modules

| module | what | ported from (VA) |
|---|---|---|
| `src/formats/x86emu.ts`, `emusetup.ts` | x86 interpreter, host table, island set-up extraction (`profileFor(..., { islandVars, archive })`) | `FUN_004b6475` + era sets, hosts for 60 engine functions |
| `src/shell/cutscene.ts`, `cutscene-host.ts` | CSM: all 16 commands, scheduler, actors / walker, actor-relative camera, B-splines, skip, end-of-script rule | `FUN_00458d15` .. `FUN_0045f702`, `FUN_00422f21` (WP2) |
| `src/island/npc/` | generic talking NPC `SGMFIG`, `Human1` routes, `Turn2Pep`, `MeetPepp`, BrickBots (follow / hit / harass / hide / botPConly), shared probe / camera helpers | `FUN_00426151` family, `FUN_004bec00`, `FUN_0052ff39`, `FUN_00530d69`, `FUN_00531d45` ... (WP3, WP11) |
| `src/island/trigger/` | `StartCSM` triggers + portals, doors / buildings / pages, swinging parts, hOLO, LGI_FSM (the director, merged with WP7's) | `FUN_0051e19c`, `FUN_0051ea3c`, `FUN_00535e80`, `FUN_00534d98`, `FUN_004b7c78` (WP4, WP9) |
| `src/island/pizza/` | Pizza.c (throw, hand-over, carried props), delivery rules, speeder.c (cars + drivers + NPC groups), Footy.c, train, SUPE | `FUN_0042887c`, `FUN_00429d1b`, `FUN_00538126`, `FUN_00539...`, `FUN_0053d66c`, `FUN_0053adc3` (WP5, WP14) |
| `src/island/vehicles/` | PepSwitc (island), skateboard, `SGBoat`, `SGHeli`, `SGCar`, `SGVehic`, Ptera / glider | `FUN_004bb67d`, `FUN_00492cc2` (island branches), `FUN_0042f9a2`, `FUN_00431425`, `FUN_0088ed56`, `FUN_004b93b0` (WP6, WP13) |
| `src/island/ambient/` | Bunny, butterflies, swift flocks (`swift.man` spline), Spin, SeaAmin, Sound3d, BOTMUSIC, Brikimal, Music.c | `FUN_004b2149` ... `FUN_004bc773`, `FUN_00536a44` (WP7) |
| `src/formats/bricks.ts`, `src/fx/bricks/` | Bricks / BrickMorph archives, effect manager (64 slots, callbacks), drawing, house stages, vehicle roster | `FUN_00449920` .. `FUN_0044e860`, `FUN_0051c823` (WP9) |
| `src/zones/z02LGI/` | zone game, story handler, objective, arrival, `IslandCtx`, vehicle save | `FUN_004afaf7`, `FUN_004b7040`, `FUN_004c2d22`, `FUN_004b908d` (WP8, WP15) |
| `src/game/render.ts`, `src/render/renderer.ts` | NPC face sheets, live part matrices (doors, rotors), frustum flag, NPC blob shadows | `FUN_0043f1d0`, `FUN_00444370` (WP10) |

Engine-core changes of the milestone: pre-render and draw passes skip disabled controllers (`FUN_004225c5` / `FUN_0042271b` test `ctrl.flags & 2`), controller flags of the
set-up are applied by `setupZone`, `GameRecord.face`, `World.ext`, the walk node's Space hook (`walkHooks.space`, the pizza throw).

## Findings about the original

* The pizza throw is Space, not Shift (`FUN_00427c15`); Shift talks (each NPC reads the press itself, nearest wins). In chapter 1 the deliveries are conversations: a customer's
  cutscene plays, then the reward (`SCORE_LGI += 1000`, `NUM_PIZZAS - 1`, house customers also `NUM_BRICKS - 1` and the house stage cutscene `LGIPH01 + phase`).
* NUBB (the 11th house customer) drives a toy car in a loop; the NPC groups of `FUN_0052cba0` (NANC+NUBB, CLIK+PETE, DARR+RICH ...) let a driver out of the car after his
  partner's delivery (NANC first); standing in the car's way only makes it fall apart into bricks (`FUN_00447e90`).
* Brickbot heads: era 1 thrown pizza -> dazed bot -> walk into it (`COLORED_BOTHEADS` bits 1 yellow, 2 red, 4 green, 8 blue); era 3 the ghetto blaster dances the bots out.
* Cutscene scripts that name an actor that does not exist stop loading (lgibr07: FECM / FECN), empty scripts (LGICI05-07) lock the manager: kept as in the original.
* The island's camera wall push is compiled out; `FUN_004afaf7` mode 1 waits for any button before the island starts (kept, the test tools tap a key for old steps).

## Tests

`node tools/test-formats.mjs` (all pass): `x86emu`, `emusetup`, `m4-wp2-*`, `m4-wp3-npc`, `m4-wp4-*`, `m4-wp5-*`, `m4-wp6-*`, `m4-wp7-ambient`, `m4-wp8-*` (story handler of
every node against the emulated original: 507 checks), `m4-wp9-bricks`, `m4-wp10-render`, `m4-wp11-brickbot`, `m4-wp13-ptera`, `m4-wp14-supe`, `m4-wp15-era1`, `m4-wp16-era2`, `m4-wp17-era3`.
Headless bots with real key input (`tools/steps/`, helpers `lib-island.mjs`, snapshot server `tools/m4-snapshot-server.sh`, `THROTTLE=n` for a slow page):
`m4-chapter1.mjs` (front end -> new game -> chapter 1 -> Whack-A-Bot -> back, ~8 min), `m4-era1.mjs` (nodes 11-30), `m4-era2.mjs` (30-52), `m4-era3.mjs` (52-68), `m4-heads.mjs`, `m4-island.mjs`
(`&hold=1`), `m4-wp5-nubb.mjs`, `m4-wp9-bricks.mjs`, `m4-wp11-brickbot.mjs`.

## Approximations / not ported (for M5 and later)

* Particles: no particle renderer (`ctx.particles` is an optional member nobody implements: train smoke, BOATPLUME, TWINKLE, Explode01 ...).
* Vehicles: the Enter "change the vehicle's look" (model variant cycler `FUN_00420404`), vehicle brick-morph clips beyond the car crash; skate tricks / scoring (z01BPK, a mini-game).
* Brick effects: no specular term, no 4096-vertex batching (one draw per brick); the carry node of the cutscene ATTACH is the logical attachment.
* Save / load: Pepper's place, camera, the 304 game variables and (new) the vehicle are saved; NPC / walker / node state restarts from the set-up for the loaded variables.
* `Math.random` for the random choices (bunnies, NPC idles); the original's rand is not seeded reproducibly either.
* Castle, Adventure Island, Oasis, Pyramid, Dino island, Ogel's island hubs and their mini-games are stubs (M5): the island hands over to them at nodes 14, 33, 62-67.
* Emulation hosts return 0 for engine functions that are not on the island's set-up paths (`unhooked` is empty for all 73 nodes).

## Next (M5)

Reuse the x86 interpreter + host table for the other hubs' set-up (CSI has 311 attaches, DIP 124, OGL 97), the cutscene runner (all scripts of the island run), the generic
NPC / trigger / door nodes (they are shared code: Turn2Pep, MeetPepp, Human1, StartCSM, building are called from CSI / OSD / PYA / DIP / OGL), the vehicle nodes (helicopter
for CAI), the particle renderer, and the arrival from the island (arrival.ts has the hand-over places for zones 6, 10, 11, 13, 0x13).
