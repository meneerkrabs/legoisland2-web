# M4 progress log (the island z02LGI with its story)

> **Historical log.** The "Open" / "not ported" remarks below are the state of the day they were written; the particle runtime, music start, RNG, gamepad (analogue values are always 0 in the original), rumble (empty function), saves of node state, the decor / outfit swap of the hubs and the other items were closed later: `docs/re/gaps.md` and the zone docs carry the current state.


Running log, newest section last. Keep it current: it is what survives an interruption.

## Plan (2026-10-28)

Strategy: the island's set-up data (which record gets which behaviour node with which argument block, era by era, hide lists, cutscene slots,
dictionaries) is *run* out of the user's executable by a small x86 interpreter with host functions (`src/formats/x86emu.ts`, `src/formats/emusetup.ts`)
instead of being transcribed; the behaviours (nodes) are hand ports of the decompile in `src/island/` (one file per node family), wired by constructor
address through `registerCtor` (src/game/setup.ts). The island zone game (`src/zones/z02LGI/`) owns the story handler, the cutscene host, the HUD and the loop.

Work packages (WP) and owners:

| WP | what | files |
|---|---|---|
| WP1 | x86 interpreter + host table + island set-up extraction (all eras), cutscene name dictionaries | `src/formats/x86emu.ts`, `src/formats/emusetup.ts` |
| WP2 | cutscene runner completion (SETANIM dictionary, actor MOVEPOSITION via the walker, FOLLOW, EXPRESSION, ATTACH, end-of-script clean-up) | `src/shell/cutscene*.ts` |
| WP3 | NPCs: generic talk NPC, Turn2Pep, MeetPepp, Human1, talk target (Shift), speech / subtitles | `src/island/npc/` |
| WP4 | StartCSM triggers, portals, doors, buildings, page pickups, LGI_FSM | `src/island/trigger/` |
| WP5 | pizza delivery (Pizza.c), Footy, SupaStat | `src/island/pizza/` |
| WP6 | Pepper modes: PepSwitc, skateboard, SGBoat, SGHeli, SGVehic/SGCar, Ptera ride | `src/island/vehicles/` |
| WP7 | ambient: Bunny, butterflies, swifts, seagulls, Ptera, Brikimal, Spin, Sound3d, Music, director | `src/island/ambient/` |
| WP8 | story handler FUN_004b7040, island zone game, HUD, era handling, loop integration | `src/zones/z02LGI/` |
| WP9 | brick-morph FX (Bricks / BrickMorph archives) | `src/fx/bricks/` |

## Status

(see the sections below)

### WP1 (x86 emulation of the island set-up) - 2026-10-28: done

`src/formats/x86emu.ts` (concrete x86 + x87 CPU, paged memory from the EXE, host hooks), `src/formats/emusetup.ts` (`emulateIslandSetup(pe, scene, { vars, archive })`,
`toZoneSetup()`), tests `x86emu` / `emusetup`, doc `docs/re/m4/emu.md`. All 73 story nodes run (20-35 ms each), no unknown engine call; the symbolic oracle is reproduced
(one explained difference: computed masks in FUN_0052266a). Attaches per node 2 / 7 / 30 / 52 / 61: 272 / 290 / 261 / 302 / 266. Dictionaries: `SWITCH_LGI_*` (70) and the
animation names (339, built inside the loader). Integration: `profileFor('z02LGI', pe, scene, starts, { islandVars, archive })` (default unchanged), result in `profile.island`.

### WP3 (talking NPCs) - 2026-10-28: done (BrickBot not ported)

`src/island/npc/` (doc `docs/re/m4/wp3-npc.md`, test `m4-wp3-npc`: 41 checks on nodes 2 and 7). Registered: SGMFIG 0x426151, Human1 0x4bec00, Turn2Pep
0x52ff39 / 0x5306e5 / 0x5308f3, MeetPepp 0x530d69. The lead calls `loadIslandWalkMaps(archive, profile.island)` + `startIslandNpcs(world)` after `setupZone`.
Space -> FUN_00427c15 is the pizza throw (WP5 ported it, re-exported as `interact`); Shift talking is read by the NPC nodes themselves. ctx: `say(table, id, id2?)`,
optional `inFrustum`, `expression`, `cameraHold`; the point-the-way target is WP8's `ctx.objective`. BrickBot.c (4 ctors, era 1+) inventoried in the doc, not ported.

### WP2 (cutscene runner) - 2026-10-28: done

`src/shell/cutscene.ts` / `cutscene-host.ts` ported 1:1 for the island scripts (loader rules, all 16 commands incl. walker walks / FOLLOW, `.man` camera B-splines and
actor tracks, actor-relative camera FUN_00422f21, mouth frames, ATTACH via a `setParent` carry node or a logical fallback, end-of-script clean-up, queue, skip, empty-script
lock); `GameRecord.face` added. Coverage tool `tools/m4-cutscene-coverage.mjs`; tests `m4-wp2-scripts` (62/62 island scripts end, also with Shift) and `m4-wp2-commands`.
Wiring notes for WP8 in `docs/re/m4/wp2-cutscenes.md` 6 (host options `{ waypoints, dictionaries }`, Pepper's walker FUN_0042207d, `applyCarried`). Carry node 0x429d1b
("Pizza") is not ported (WP5?).

### WP4 (StartCSM triggers, portals, doors, buildings, pages, LGI_FSM, hOLO) - 2026-10-28: done

`src/island/trigger/` (startcsm.ts, building.ts, parts.ts, lgifsm.ts, holo.ts), tests `m4-wp4-triggers` (41) / `m4-wp4-buildings` (51), doc `docs/re/m4/wp4-triggers.md`.
Ctors: 0x51e19c, 0x51ea3c, 0x535e80, 0x5364a5, 0x535281, 0x5357cb, 0x4b8c73, 0x88df51 (0x534b89 is dead in the original: not ported). Lead: the renderer
must draw `partOverrides(w, rec)` (live MATL sub-object matrices: doors, swinging parts, rotors); the zone game must `waypoints.load(archive)` and set
`ctx.scene`. Shared keys `vehicleState` (WP6), `holoActive`.

### WP8 (story handler, island zone game, HUD, loop) - 2026-10-28: done (first pass)

`src/zones/z02LGI/` (zone game + set-up hooks, `story.ts` FUN_004b7040, `objective.ts` FUN_00424e37 & co., `arrival.ts` FUN_004c2d22, `ctx.ts` the real IslandCtx),
shell hooks (`registerZoneSetup`, `sayFrom`, `beforeTick` / `storyTick` / `introPanel`), HUD re-port (`initIsland` / `updateIsland`). The island now runs the emulated
set-up against the live vars, wires WP2 (host options, slots, applyCarried), WP3 (walk maps, startIslandNpcs, Pepper's walker FUN_0042207d), WP6 / WP7 ctx services.
Tests `m4-wp8-story` (port == emulated original for nodes 0..72, set-up call and "just advanced"), `m4-wp8-island` (arrival, live handler, objective), step
`tools/steps/m4-island.mjs` passes. Doc `docs/re/m4/wp8-island.md` (open points section 7: island mode 1 waits for a key -> older steps need a key press).

### WP5 (pizza, carried props, delivery rules, cars, train, football) - 2026-10-28: done (SUPE not ported)

`src/island/pizza/` (doc `docs/re/m4/wp5-pizza.md`, tests `m4-wp5-pizza` 52 / `m4-wp5-carry` 41 / `m4-wp5-ambient` 33 checks, nodes 2, 7, 52). Registered:
Pizza.c 0x42887c (PIZ0-2 thrown pizza) / 0x42900b (PIZ3/4 hand-over, eras 1-3) / 0x429d1b (carried prop: PIZ3 box, CNST, RHCP, BRIK, PAPA, MAMA), speeder.c
0x538126 (cars) / 0x5385d3 (drivers), Footy.c 0x53955e (football) / 0x5399d8 (flowers) / 0x539d44 (LOON), SupaStat.c 0x53d66c (train, rideable). Space ->
throw via `walkHooks.space` (small edit in src/game/walk.ts). Finding: the throw is a toy in era 0 (only BrickBots are targetable); deliveries are WP3's
conversations + delivery.ts rules. Lead: `startPizzaNodes(world)` after `loadIslandWalkMaps`, before `startIslandNpcs`; ctx `particles?`, `brickBurst?`.
SUPE (super-hero taxi, FUN_0053adc3) inventoried, not ported.

### WP6 (Pepper's modes, skateboard, boats, helicopters, cars, Ptera ride) - 2026-10-28: done (tricks / skate park branches not ported)

`src/island/vehicles/` (doc `docs/re/m4/wp6-vehicles.md`, tests `m4-wp6-switch/skate/boat/heli/car`): island PepSwitc 0x4bbef8 (overrides the M1 factory;
mode logic = the pre-render FUN_004bb67d), skateboard 0x43310c (skate.c, island branches), SGVehic 0x4333c2 (Pepper on the seat = mesh part 1), Ptera ride
0x4bb582 (empty), SGBoat 0x430e6c (SPBT / JSKI / DNGY, docks), SGHeli 0x4325e8 (PHEL / RHEL, helipads, rotors via trigger/parts.ts), SGCar 0x88fb35 (behind
speeder.c). Finding: the vehicles choose Pepper (Ctrl within 24, nearest wins), boats / helicopters are left only at a dock / helipad. Lead: arrival in a
vehicle = `vehicles(w).current = rec` + PEPPER_CONTROL 8; waypoint maps must be loaded before the first tick; new optional ctx `sfxFreq`; zonesetup's
z02LGI chain check expects the M1 chain (now Music .. Ptera).

### WP7 (ambient animals, Spin, Brikimal, BOTMUSIC, Music, director) - 2026-10-28: done (Ptera not ported)

`src/island/ambient/` (doc `docs/re/m4/wp7-ambient.md`, test `m4-wp7-ambient` 64 checks). Registered: Bunny 0x4b2149, Butterfly 0x4b2d44, swift leader
0x4b31db / swift 0x4b3a92 (B-spline through swift.man), Spin 0x4bdbb2, SeaAmin 0x4b1212, Sound3d 0x538779 (a no-op in the original), BOTMUSIC 0x536e16 /
GETO 0x536961, Brikimal 0x4bd4a8 (brick morph via optional `ctx.brickMorph`, plain-model fallback), Music 0x4bc773 (ctx music / musicGroove / musicNotified /
musicMute / ambience). The director FUN_004b7c78 = LGI_FSM's update: `directorTick` / `registerDirector()` exported, NOT registered (WP4's lgifsm.ts is;
differences: particles, WORM = record 370 not 371). Lead: the loader's animation instances for records 9..66 (`islandRigs` / `ensureAnim`, FUN_004f645b
@0x519c09) belong in setupZone; preload list of FUN_004b037e in the doc; Ptera (FUN_004b93b0) is the ridden era-3 vehicle (WP6 territory, analysed in the doc).

### WP14 (SUPE, SupaStat.c 0x53c337) - 2026-10-28: done

`src/island/pizza/supe.ts` (registered via `src/island/pizza/index.ts`), doc `docs/re/m4/wp14-supe.md`, test `m4-wp14-supe` (94 checks, nodes 2 / 7, all eras).
SUPE (record 45, every era) patrols the OTH sky map, lands at the station at Pepper's end of the island (Turn2Pep runs while he stands: the update returns 0),
and rescues Pepper from the railway (surface 9 at y 41..48 for 3 ticks, at once with the locomotive within 24): pick-up, lift over the nearest track node (the
east line first), flight to the nearest helipad exit node, drop (PEPPER_CONTROL 0x80 -> 1, record 9 hidden), camera FUN_0053ab93. Update = FUN_0053adc3
(table 0x8eb0f0; FUN_0053c6eb is the train's). No new ctx members; lazy init on the first update (after SGMFIG). DAT_00987660 = 16-bit display flag (taken 0).

### WP13 (Ptera / glider ride, eras 3-4) - 2026-10-28: done

`src/island/vehicles/ptera.ts` (`PteraNode`, registered `0x4bb1a6` in vehicles/index.ts), doc `docs/re/m4/wp13-ptera.md`, test `m4-wp13-ptera` (47 checks, nodes 52 / 61).
Ported FUN_004bb1a6 (ctor) / FUN_004b93b0 (update: take-off, flight on held keys, backwards-sweep wall / sea / ceiling bounce, landing, dead state 2, parked
choice) / FUN_004baf1b (boarding, Pepper carried); PTER (animated via WP7 `ensureAnim`) and GLDR (no rig: Pepper clip 0x114, propeller part 2). Landing slots =
the helipad table shared with SGHeli. PepSwitc needed no change (no 0x40 branch in FUN_004bb67d). Edit in `src/zones/z02LGI/index.ts` afterSetup: the vehicle
arrival now sets `vehicles(world).current` (DAT_009daa80), which FUN_004c2d22 does and every vehicle node relies on. Browser run at node 52 OK.
Still unregistered in eras 2-4 besides BrickBot: 0x4bf329 (Human1.c, XXX0..2, all eras), 0x88d1f6 (SPLH swim splash: a draw hook, no node draw API), the
sea / sky nodes (rendered by environment.ts), 0x534b89 (dead).

### WP11 (the Brickster's bots, BrickBot.c + botPConly.c) - 2026-10-28: done

`src/island/npc/brickbot.ts` (doc `docs/re/m4/wp11-brickbot.md`, test `m4-wp11-brickbot` 81 checks on nodes 7 / 8 / 30 / 52, browser bot
`tools/steps/m4-wp11-brickbot.mjs`: node 8 played with Space / ArrowUp to node 9, COLORED_BOTHEADS 15, HUD 4 heads). Registered: 0x531d45 (follow /
ride the leader, clip mirroring), 0x5327b1 (pizza hit, daze, collect: NUM_BOT_HEADS, COLORED_BOTHEADS, score, shrink, hide; era-3 wave), 0x532acc
(harass: a bumped walker becomes the leader), 0x533ba8 (hide behind a PATH node from Pepper / DJAB, BBT0's ring), 0x53de63 (botPConly, BBT5).
`startIslandNpcs` now ends with `startBrickBots` (constructor work in attach order). Findings: no brick effect in BrickBot.c; the hand-over pizza
collects at once; a pizza coming at a bot frees the NPC it harasses even without a hit.

### WP10 (island rendering fixes) - 2026-10-28: done

Doc `docs/re/m4/wp10-render.md`, test `m4-wp10-render` (54). Faces: the builders' Faces.c set-up FUN_0043f1d0 is extracted (`Model.face`), the renderer
scales the face group's UVs x4 about v = 1 and freezes the `.wib` sheet on `rec.face` (type 1; type 0 atlas offsets too) - all zones. Live MATL part
matrices (`GameRenderer.partMatrices`, wired in `IslandContext.bind` to WP4's `partOverrides`): INFC doors / PHEL rotors checked. `IslandContext.inFrustum`
(FUN_00444370 rules, planes of the last drawn frame), `IslandCtx.uvScroll` (SeaAmin's additive foam drift), blob shadows of NPCs (FUN_00444940: controller
flags 0x10 / 0x40 within 80 of the camera, under bone 0), emusetup FUN_0043cec0 native (vehicle arrivals = emulated; m4-wp8-island extended). Lighting of
skinned characters matches the decompile (dark sides = ambient 0.18), not changed.

### WP9 (FX_Bricks: brick effects, house stages, Brikimals, vehicle roster; director merged) - 2026-10-28: done

`src/formats/bricks.ts` (dictionaries read from FUN_00447f20's code, brickset + LOD meshes FUN_0044a5e0, models FUN_0044d570), `src/fx/bricks/` (bricks +
actions, BrickFX_Manager 64 slots / callbacks 0..13 / update FUN_0044a180, island wiring, drawing), doc `docs/re/m4/wp9-bricks.md`, test `m4-wp9-bricks`,
step `tools/steps/m4-wp9-bricks.mjs` (node 3: PAPA's delivery -> LGIPH01 -> the house foundation falls into place, PH01 shown after the 3 s wait).
The era sets' registrations come from the emulation (emusetup now hosts FUN_00447cc0/447d20/447da0/447d70/447ed0 and copies the 24-word blocks); 22 effects
in era 0 (11 buildings float away, PH01..PH10 + PHSE house stages), 4 / 4 / 9 buildings falling in in eras 1 / 2 / 3. **Director merged**: one LGI_FSM node
(src/island/trigger/lgifsm.ts, registered), ambient/director.ts re-exports it; WORM = record 370 (WP4 tests updated), particles + cue ids from WP7, switch
0xfe (finish building effect n) is live, the node ticks the brick manager. Lead: the zone game installs the library (`installBrickLibrary`, archives
Bricks + BrickMorph) and sets `GameRenderer.effects` (done in src/zones/z02LGI/index.ts); `ctx.brickMorph` / `brickBurst` implemented in ctx.ts;
the node mock enables bricks with `loadIsland(ctx, { bricks: true })`.
Follow-up: the vehicle roster FUN_0051c823 (table 0x8e9b28, 10 vehicles) is emulated after the set-up (emusetup `vehicleRoster`) and registered after the
era's effects; a crashed car falls apart and is rebuilt (flag 0x8000 cleared) in 46 ticks. Not ported: the Enter "change the vehicle's look" (FUN_00420404).

### Lead (2026-10-29): integration state after wave 2

* Central wiring done by the lead: emulated island set-up in `playzone.ts` / `src/zones/z02LGI/index.ts` (WP8), `startPizzaNodes` before `startIslandNpcs`, animation instances of
  records 9..66 (`islandRigs` / `ensureAnim`), controller flags of the set-up applied in `setupZone` (`attach.ctrlFlags`), pre-render / draw passes skip disabled controllers
  (`controller.ts`, FUN_004225c5 / FUN_0042271b check `ctrl.flags & 2`; this fixed cutscene actors sinking through the floor: a disabled actor's NPC node kept running its pre-render hook).
* **Chapter 1 plays end to end with real key input** (bot `tools/steps/m4-chapter1.mjs`, ~7 minutes headless): front end -> Nieuw spel -> opening cutscene (Infomaniac) ->
  pizza customers NANC + 11 house customers (NUBB after NANC's delivery, his toy car crash is optional) -> node 4 house cutscene -> node 5 pizzeria -> node 6 jail -> era 1 island
  -> 4 pages -> 4 coloured Brickbot heads (thrown pizza, walk into the dazed bot) -> node 9 Info Center door -> Whack-A-Bot (mini-game bot) -> result menu -> island node 11.
  Long walks are teleports; talk / throw / walk-in / skip / menus are real key presses.
* Test infrastructure: `tools/m4-snapshot-server.sh <port>` serves a snapshot of the repo (no watcher / HMR) so that long bot runs are not broken by concurrent edits;
  `tools/browse.mjs` taps a key for old steps that wait for the island (the island's mode 1 waits for a button like the original) unless the URL has `&hold=1` / env NOPRESS=1;
  `tools/steps/lib-island.mjs` (helpers), `tools/lib/island-load.mjs` (node tests).

### WP15 (era 1 after Whack-A-Bot, nodes 11..14, castle stubs, return at node 30) - 2026-10-29: done

Bot `tools/steps/m4-era1.mjs` (node 11 LGI06 -> node 12 save / in-place load / front-end load -> RESQ trigger LGI07 -> node 13 Ctrl at SPBT -> save in the
boat + front-end load -> node 14 PORS -> z07CSI .. z10RGB stubs with F9 / Enter -> island era 2 node 30 on the boat -> moor at dock 0x1b5, walk) passes;
test `m4-wp15-era1` (19). Nodes 11..14 needed no fix. **Fixed**: a save made in a vehicle loaded with Pepper frozen at sea in mode 8 (no current vehicle)
while the parked boat drove off by itself: `src/zones/z02LGI/savevehicle.ts` + optional set-up hooks `saveEntities` / `restoreSave` (`zonegame.ts`), the
save writes the vehicle's entity after PEPP (`shell.ts` LiveGame.capture `entities`), playzone's `restore` calls the hook. Doc `docs/re/m4/wp15-era1.md`.

### WP16 (era 2: story nodes 30..51, zone id 32) - 2026-10-29: plays end to end, no fix needed

Bot `tools/steps/m4-era2.mjs` (real keys; `FROM=castle` starts at z07CSI node 29 and arrives by boat at PORS, `FROM=stubs` only 33..52): era intro LGIBR05 ->
PAG1 / PAG2 (LGIBR06 / LGIBR07, buildings fall back in) -> POLB trigger (LGI08, S277 = 2) -> Ctrl at PHEL, fly into PORA (S281 |= 2, var 5 = 10) -> z13CAI and the
stubs with F9 (z17WAS played by the m3 bot) -> island era 3 node 52, arrival in PHEL at PORA, Ctrl lands on a helipad (node 53 / 54). Test `m4-wp16-era2` (16).
Findings (faithful, not changed): LGIBR07's loader stops at the missing actor FECM, so the Brickster stays visible at the police station; hidden talking NPCs
fall to sea level (NICK). Doc `docs/re/m4/wp16-era2.md`.

### M6 (remaining mini-games) - started 2026-10-29

Separate log: `docs/re/m6/progress.md`. Touches (additive only): `src/zones/index.ts` imports, `src/zones/<zone>*`, tiny hooks in `src/shell/zonegame.ts` / `playzone.ts` / `src/game/*` listed in each zone doc. Does not touch `src/island/`, `src/zones/z02LGI/`.

### WP17 (era 3 / era 4: story nodes 52..71, zone ids 33 / 2) - 2026-10-29: plays end to end (one fix)

Bot `tools/steps/m4-era3.mjs` (real keys; 52 -> 58 -> z36CNT -> z38PAR -> island 61 -> z39ASB (F9) -> z40aPO -> z40OGL / z41MAP -> z42BRP (stops there now that
M6 ported it; as a stub: outro movie -> credits -> island node 68) ; FROM=radio / tower / cnt / era4 / asb / end / abort), test `m4-wp17-era3` (36), doc `docs/re/m4/wp17-era3.md`.
**Fixed**: BOTMUSIC (`src/island/ambient/misc.ts`, FUN_00536a44) returned 1 on every path; the executable returns 0 unless the bot dances: the era-3 bots
stood still and the dance timer (counted down while Pepper was away) never reached the danced-out state, so node 56 (the four bot heads) could not be
completed. `m4-wp11-brickbot`'s era-3 wave check adapted (followers keep 0x20000 now that BotFollow runs). Faithful oddities: SHTL hidden after the 4th
page until the island reloads (no SPACESHUTTLE brick effect in era 3); LGI11 (slot 7) never started; aborts of z36CNT / z38PAR arrive on PATH 0xff.

### Lead (2026-10-29): final state of M4

All WPs are done and integrated; `npx tsc`, `npx vite build` and `node tools/test-formats.mjs` (all tests, incl. 29 M4 test files, ~3.6k checks) pass. Bots with real key input:
`m4-chapter1.mjs` (front end -> new game -> chapter 1 -> Whack-A-Bot -> back on the island at node 11; also passes with `THROTTLE=2`), `m4-era1.mjs` (11 -> castle stub -> 30), `m4-era2.mjs`
(30 -> 52), `m4-era3.mjs` (52 -> 68). The live-site failure of the head collection (four heads, three collected) was bot timing on a slow page, not the game: the bot now waits in game
ticks, taps keys for >= 3 ticks and repeats a missed throw / collect cycle (`collectHead` in `tools/steps/lib-island.mjs`; `THROTTLE=6` still collects all four, with retries).
Open points are listed in docs/re/engine-m4.md ("Approximations / not ported"). M5: other hubs.


## WP-ISLAND (2026-10-29, gaps S1-S12, U2 note)

Done: S1 island skateboard tricks (shared `skateTricks`), S2 vehicle looks on Enter (swap table + SwapText textures + roster, cycler and Enter logic identical to the original in the x86 interpreter), S3 kids' jump node
(constructor identical to the original's) and swim splash ring, S4 objective vehicle branch, S5 header-only collision objects (the reason the board never lifts Pepper; the original sweep and the port's agree on 900
random placements), S6 hologram shimmer, S8 / S9 / S11 / S12 checks and fixes, S7 / S10 emitter hooks (BOATPLUME + the inventory in engine-m4.md). Open: S2's type-1 half (minifig outfit / decor model swap, `FUN_00420bb7`),
S7's wake draw order (needs a node draw API in the renderer), the emitters listed in engine-m4.md (WP-PART-WIRE). U2: settled by the code (no credits after the outro), the fix is in the shell (gaps.md U2).
New tests: `m4-wp6-looks`, `m4-s5-colshapes`, `m4-s-island`; new bot step `tools/steps/m4-wp-island.mjs`; new oracle helper `tools/lib/col-oracle.mjs` (the original `FUN_00441270` on records you describe).
