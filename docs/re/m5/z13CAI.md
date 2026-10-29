# z13CAI, the Adventure Island (zone table index 10, `z90ADV`, story nodes 33 and 51)

Wrapper `FUN_0061aebb`, GameLoop `FUN_0061a821`, set-up root `FUN_0061beae` -> loader `0x621d05` + `FUN_0061b1f4`, per-frame `FUN_0061bf8c`, teardown `FUN_0061bf1b` (+ `FUN_0061c0d4` = `ret`).
Hub worker `cai` (M5). Files: `src/zones/z13CAI/` (`index.ts`, `bunny.ts`, `pepswitc.ts`, `flow.ts`, `hud.ts`), tests `tools/tests/m5-z13CAI.mjs`, `m5-z13CAI-emu.mjs`, `m5-z13CAI-hud-emu.mjs`
(helpers `tools/lib/m5-z13CAI-load.mjs`, `m5-z13CAI-emu.mjs`), bots `tools/steps/m5-z13CAI-node33.mjs`, `-node51.mjs`, `-particles.mjs` (+ `lib-z13CAI.mjs`).

## 1. What the zone is

Pepper arrives by air (helicopter PHEL / RHEL, or the Ptera PTER, chosen by var 0xbb = PORTAL_VEHICLE through `FUN_0051e4b0(2, 1)`; the island's air portal PORA sets it) at the portal record PORS
(default place 64 units in front of it, facing PATH node 0), from the Oasis at PATH node 0 + 16 up (803.8, 44.6, -788.7), from the Dino island at PATH node 1 (-699.5, 93.9, 160.5)
(var 0xa3 = 11 / 19; the emulated set-up does all of this). **Pepper has no walk node here**: her chain is only the seat (SGVehic `0x4333c2`, or the Ptera ride `0x4bb582` for the Ptera), both gated `(var 0x5e, mask 0)` = always, returning 1.
The record the vehicle node chain sits on is `[pepswitc 0x61c2a4, SGHeli 0x4325e8]` (Ptera: `[pepswitc, 0x4bb1a6]`). Nothing else is interactive: there is no story handler in the loop (the set-up selects the hologram text and the objective itself), no cutscene slot, no NPC.

* **Node 33** (first visit, FSM: zone 10, condition `var 5 == 11`): hologram text `advholA.str` ("Vind je de woestijn dan leuk, Pepper?"), objective arrow at PATH node 0 (the ONE helipad: `DAT_009daa14 = 1`, pad node 0, exit node 0).
  Ctrl near the pad: SGHeli lands, Pepper steps off (PEPPER_CONTROL := 1) -> `pepswitc` sets var 5 := 0xb -> the story FSM completes node 33 and the loop leaves for z14OSD (node 34).
* **Node 51** (return from the Dino island, condition `S250 == 1`): hologram `advhol0.str` ("... nu moet je die bladzijden terugvliegen naar LEGO eiland"), objective arrow at record PORS (53, `FUN_00424270`).
  The box portal PORS (StartCSM `0x51ea3c`, already ported by the island) sets var 0xfa |= 1 and var 5 := 33 when the vehicle flies into it; node 52 = the island era 3 (zone 33), arrival at PORA in the vehicle.
  (Landing on the pad at node 51 also sets var 5 := 11 like at node 33: the original's code does not look at the story node.)
* The hologram (hOLO `0x88df51`) only appears while Shift is held (20 ticks) as there is no story alert in the hub.

## 2. Ported (function, address, port)

| original | what | port |
|---|---|---|
| `FUN_0061beae`, `FUN_0061b1f4`, loader `FUN_00621d05`, `FUN_0061bc41` | set-up (records, attaches, vehicle arrival, texts, objective, particles) | RUN in the x86 emulation (foundation); the module reads the helipad table and the vehicle / control word out of it (`applyCaiSetup`) |
| `FUN_0061aebb` / `FUN_0061a821` / `FUN_0061a7d2` | wrapper / loop / camera + frustum prep | the generic hub loop (`src/hub`, `loopmachine.ts`); the per-frame part is `spec.frame` |
| loop start: `FUN_00417597(0xc5, 5 or 1)` | Pepper's shadow type (PTER record -> 5) | `onCreate` (after the renderer reset var 0xc5 to 4) |
| `FUN_0061bf8c` | HUD: centre score `%04d` of var 0x17, interaction icon of var 0xc (blink 15 / 30), var 0xc := 0 | `hud.ts` `CaiHud`; HUD pictures = overlay set `z14OSD` (`FUN_0061bf50`, `HubSpec.overlay`) |
| `FUN_0061c2a4` / `FUN_0061c0e0` / `FUN_0061c1b9` / `FUN_0061c33f` (table `0x912418`) | `pepswitc` (the hub's vehicle controller, see 3) | `pepswitc.ts` `CaiPepSwitch` |
| `FUN_006277b9` (+ `FUN_00627b3f`, `FUN_00627ba5`, `FUN_00627be0`) | roster of the look change (table `0x914bc8`, PHEL, var 0xd2, 8 brick models) | `constructRoster` (runs the original in the emulation), `ensureCaiLooks` (island `VehicleLooks` over the hub table; additive `rosterVa` parameter) |
| `FUN_004b4000` / `FUN_004b3bb7` (table `0x8d9280`) | the circling birds (GL00..GL14, PTER) | `bunny.ts` `GullNode` (shared with the Oasis; `ctorInit` hook) |
| `FUN_00426f55` (table `0x8ade18`, draw hook `FUN_00426e9a`) | flowing water LAVA {0.0025, 0}, FALL {0.01, 0} | `flow.ts` `FlowNode` (update = stop); the draw hook is the renderer's (`GameRenderer.flow`, WP-RENDER) |
| `FUN_0061bf1b` (teardown), `FUN_0061c0d4`, `FUN_0061bef2` (dead) | frees sounds / bricks | nothing to port (`pepswitc.destroy` stops its two sounds; `FUN_0061b120` and `FUN_0061bef2` have no callers) |
| SGHeli `0x4325e8`, SGVehic `0x4333c2`, Ptera `0x4bb1a6` / `0x4bb582`, StartCSM portal `0x51ea3c`, hOLO `0x88df51`, sky / sea / seabed | shared families | ported by the island package; used as they are (verified in this hub by the oracle test) |

Music (`ad2`, groove 0 at the end of the intro) and the sound lists (`0x2f5`, `0x303`, `0x302`, `0x2f3`, heli `0x132`) come from `src/audio/zonemusic.ts` / `zonesounds.ts` (audio package; z13CAI `plays: [{ at: 'init' }, { at: 'leaveIntro', groove: 0 }]`). Fog: `fogphases.ts`
(the set-up helper and the loop's mode-7 call have the same values 4 / 100 / 800 / 500, white; nothing to do).

## 3. `pepswitc` (FUN_0061c0e0), facts

* update (returns 2): `PEPPER_CONTROL & 1` -> var 5 := 11; 3D sound handle `DAT_05d5bc1c` (id 0x2f3) at (-248.5, 130.4, -223.3) and 2D `DAT_05d5bc2c` (0x2f5) every tick; `n = ftol(rand * 100)`: `n >= 99` -> `DAT_05d5bc3c` (0x303), `n == 98` -> `DAT_05d5bc38` (0x302), both at record 24 (PTER) + 0x3c. The handle -> sound id map comes from `HubContext.soundOf` (emulated loader FUN_0061b000).
* pre-render: Enter (`DAT_00983840 & 0x10000`) -> `FUN_00627b3f`: when record 50 (PHEL) has variant word 2 (always) -> `FUN_00420570(table, 0x32)` = the island's look cycler `FUN_00420404` over the hub's one-entry roster (even while flying RHEL / the Ptera). Then `FUN_00420590` every tick (the busy slot).
* The icon of `FUN_0061bf8c` is NOT gated by `PEPPER_CONTROL & 1` (the decompile computes the gated value and overwrites it before use: asm `0x61bfba..0x61bfe1`), unlike the island / Pyramid HUD; foundation.md section 3 says CSI / CAI gate it: for CAI that is wrong.
* var 5 stays 10 (= var 0x59) while flying, so the loop's "next subgame != current subgame" exit only fires through this node or the portal.

## 4. Verification

* **Oracle** `m5-z13CAI-emu` (3.38 M checks, 0 failures): the original's node framework (`FUN_0042226e` / `FUN_004225c5`) + pepswitc + the 16 birds + SGHeli + SGVehic + the Ptera nodes + the portal + the zone's sound loader run natively in `x86emu` next to the port with the same buttons
  and a shared MSVC `rand()` stream; per tick the records (matrix, Euler, flags), the birds' node blocks (state, turn, home) and animation frames, all 319 game variables, vehicle globals, pad table, camera and every sound call (3D positions) are compared. Sessions: free flight dt 1 and 0.5 (900 / 1800 ticks, random keys), landing on the pad (var 5 = 11 in both), RHEL, Ptera (PORTAL_VEHICLE 2).
  The vehicle chain is compared in "sync mode" (float32 pose / velocities of the original copied into the port before each tick, as `m7-isl-veh-heli.mjs` does) with 1e-4 relative tolerance; the birds, pepswitc, the portal and the variables are free-running and exact (float32 stores reproduced with `Math.fround`).
  Hosted in the oracle (not the subject): variables, rand, collision (port's `CollisionWorld`), animation (port's `AnimInstance`), `FUN_0043b92a` (3 lines of the decompile), sounds (logged).
* **HUD oracle** `m5-z13CAI-hud-emu` (1696 checks): `FUN_0061bf8c` called with `IslandSetup.run` over every icon x control x score combination and 80 blink passes: texture word, blink counter, text, var 0xc identical.
* **Node tests** `m5-z13CAI` (124 checks): registration, the three vehicles x two nodes (nodes, chain, control word, shadow var, pad table, variant words), arrival places, texts / objective of both nodes, flow arguments, pepswitc sounds and cries (scripted rand), the exits (landing -> var 5 = 11; flying into PORS -> S250 / var 5 = 33), the look cycler with the brick effect (Enter, busy flags, release), the overlay textures.
* **Bots** (headless, muted, real keys, snapshot server port 5513, screenshots looked at in `/tmp/m5-z13CAI`): `node33` (mode 1, any button, Shift hologram "Vind je de woestijn dan leuk, Pepper?", flight across the island to the pad, Ctrl lands, zone changes to z14OSD at node 34, PREV 10),
  `node51` (hologram "Het is je gelukt Pepper ...", flight into PORS, island era 3 node 52 arrives in the vehicle, PREV 10). Both print ALL OK. `particles` checks the emitters.

## 5. Findings

* Ptera port (island, `src/island/vehicles/ptera.ts`): the steering rates were doubles with double constants; the original keeps `yawRate` / `pitchRate` and the step constants as float32, and a rate that reaches 0 must not land on a tiny residual of the other sign (the port then added a whole step back).
  Found by the oracle in the Ptera session; **fixed** (float32 constants and `Math.fround` stores of the two rates, listed under shared-file edits). `m4-wp13-ptera` stays green.
* The foundation's `applyEmulatedArrival` needs a node on Pepper's chain whose gate bit matches the control word; here the seat's gate is mask 0, so the module (`vehicleArrival: false`) does the arrival itself (control word + `vehicles(w).current`).
* The generic set-up adds a stub guard + the island's walk / swim / mode nodes to Pepper's chain; `applyCaiSetup` removes them (the original has only the seat).
* The Adventure Island's birds in the Ptera variant have no bird on the PTER record (it is the ridden vehicle); in the helicopter variants PTER is bird no. 16 and `FUN_0061c0e0` plays the gull cries at its position.

## 6. Particle emitters (WIRED, `FUN_0061bc41`, called by the set-up root, only when `DAT_008adc74 != 0`)

All ten are `FUN_00442960(name, LAND matrix (record 4 + 0xc), pos, rot, gate (2,1,1) = always on)`; the emulated set-up recorded the calls, `ctx.fx` is installed in `onCreate` and `src/island/emitters.ts` `startSetupEmitters` starts them in call order with the original's arguments (no hand-written start values):
`vol03` (-248.5, 130.4, -223.3), `vol02`, `vol01` (x2: the second at (-890, 28, 133.8)), `lava01`, `lava02`, `lava03`, `vol04`, `spray01`, `spray02` (rotation about x or y -pi/2 as in the call sites). The call site VAs are `0x61bc41..0x61bead`. Without particles (`DAT_008adc74 == 0`) the original calls `FUN_0044ec30` instead.

## 7. Shared-file edits

* `src/island/vehicles/looks.ts`: `VehicleLooks` constructor gets an optional 4th parameter `rosterVa` (default `ROSTER_VA`): additive.
* `src/island/vehicles/ptera.ts`: float32 constants / `Math.fround` stores for `yawRate` / `pitchRate` (bug fix found by the oracle, see 5; island package, please re-run your Ptera checks).
* `docs/re/m5/progress.md`: my section + the Bunny note.
* No edits of `src/hub`, `src/shell`, `src/game`, `src/audio`.

## 8. Not exact / open

* The vehicle chain (SGHeli / Ptera) is compared in sync mode: over 1000+ free ticks the float32 vs double accumulation drifts by < 2e-3 absolute (logic identical per tick).
* The brick-effect update runs from `spec.frame` in play mode only (the original updates in the draw pass of every loop mode).
* `rand` goes through `island/ambient/common.ts` `rand` (`// RNG:`, replaced by the shared MSVC stream later); the oracle shares the stream, so the comparison stays valid after that change.
* The Enter look change needs the SwapText archive (`gr.swapArchive`): installed asynchronously in `onCreate`.
* Not checked in the oracle: Enter look change (SwapText / brick effect state machines are the island's, tested in node tests), sound loudness / distance (audio package).
