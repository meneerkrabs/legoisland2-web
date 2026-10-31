# z27TRX "T-Rex Racing" (Adventure Island mini-game) - M6 port

Zone table index 20 (`CURRENT_SUBGAME`), archive `z27TRX`, strings `AI/Data/trx.str`, HUD textures `Overlays/z27TRX`, music key `Flying` (`ZONE_MUSIC`; the segment's own repeat count
applies: the engine honours it, so the music stops after its repeats as in the original). Pepper rides a T-Rex down a three-lane track (z 80 .. 4336) to the main camp within 180 s.
Loop function `FUN_007656f2` = the runner's loop template; everything else is the zone code of 0x7656f2 .. 0x76b6xx.

## 1. Files
| file | what |
|---|---|
| `src/zones/z27trx/consts.ts` | every constant with its EXE address, sound ids, clip tables, banner layout |
| `src/zones/z27trx/trex.ts` | `TrexNode` (the player), `scoreOf`, `medalOf` |
| `src/zones/z27trx/props.ts` | GATE, VOLC, SLOG, BLDR, EGGS, BRON, spectator nodes |
| `src/zones/z27trx/prepare.ts` | `prepareTrx`: what FUN_0076649a / the builder leave behind (rigs, nodes by record name, tables read from the EXE) |
| `src/zones/z27trx/run.ts`, `gate.ts` | run globals + sound / rng interfaces, ground probe; gate door matrices |
| `src/zones/z27TRX.ts` | `registerCtor`s, zone game (HUD, sounds, speech, banner, fog, partMatrices), `clockText` |
| `tools/lib/trx-bot.mjs`, `tools/tests/m6-z27TRX.mjs`, `tools/steps/m6-z27TRX{,-loss}.mjs` | bot, node tests (125 checks), browser runs |

Shared-file edits: `src/zones/index.ts` (one import line), `docs/re/m6/progress.md` (section).

## 2. Findings
* **PEPP (record 335) is the T-Rex** (TrexHR/MR/LR meshes, `anim/TREX.blk`, 21 bones, clips 0..29); **DRKR (336) is Pepper the rider** (PEPP_HR body + head / hat / hands / bag attachments, `MFIG.blk`).
  `FUN_0076a194` copies the rex's clip through a table (`RIDER_CLIP`), its frame and its matrix to the rider every tick. `setupZone` gives PEPP an MFIG instance: `prepareTrx` replaces it.
* The set-up's record loop (`FUN_0076649a`) attaches by upper-cased 4-char name: TRIC (clip 3) / STEG (4) / BREX (1) spectators, GATE, VOLC, BRDG (kept as the bridge record), SLOG, BLDR, EGGS / YOLK;
  BURN loses flag 0x20; PTRA gets `fly` (its update `FUN_007680c0` is empty: the pterodactyls are static), BRON gets `bronty`. The extraction skips the name loops, so `prepareTrx` does them.
* Phases (var 0xfa): 0/1 wait (first tick -> 4), 4 run, 5 arrival (z > 4112, or the clock ran out), 6 final clip, 7 over (loop mode 4). Medal in var 0xff.

## 3. The run (FUN_00768510; one update per drawn frame, dt-scaled where the original multiplies by DAT_008b1718)
Clock 5400 ticks, -1 per tick, 0 = timeout flag. Speed 0.6 .. 1.4: RIGHT +0.02, LEFT -0.08. z += speed (before the change). Lanes -1 / 0 / 1 (UP / DOWN presses, `x = 16 + 16 lane`), the offset
follows at `(1 - 0.5 f) * 0.8 * 8` per tick. Height = terrain ray (from y 0 + 4, 300 down, radius 1, skin 0.1; min 0.1), raised by a 32-unit upward ray against BRDG. Jump (button press, 28 up, g -56,
`t = ticks * 0.0333`, peak 7 after 15 ticks) with clip 0x11 -> 7 -> 0xf, landing clip 4 + gravel sound; roar (BUTTON_3 / Shift) clip 3 + one of four sounds.
Probes (`world.col.sweep`, the port's FUN_00441270): **forward** (from (0, 0.4, 6) ahead, delta (0, 0.8, -8.56), radius 0.01): ROCK / STP2 / VOLC / STMP: speech ADSGTR09, clip 9; FENC clip 9; BLDF / BLDR / LOGS clip 1 (cancels the jump);
STAT clip 9 + var 0xfb; all stun and count a hit; a lane change whose new lane is blocked (old lane free) bounces back (clip 0x16 / 0x17, wahey sound, no hit). **Up** (0 .. 4 above, radius 2, skin 0.08): BURN clip 5/6 (once per contact,
speed to minimum), SLOG clip 0x1d (0x1c when its phase is below 0), EGGS clip 2 and the egg breaks. A crash clip ending: z += 24, minimum speed, 75 ticks of blinking (hidden / shown every two ticks, no hits; state 2 until clear).
Arrival (z > 4112): autopilot at 1.4 down the middle lane; at z > 4336 the run is won: **score = 10000 - 250 * hits** (the original subtracts `5 * ftol(clock - 5400)` clamped at 0: the clock never costs points),
medal by `>` 7500 / 5000 / 2500 (gold / silver / bronze / none), vars 0x87 (best score) and 0x1a (trophy) only raised, end clip 0x13 / 0x15 / 0x18 / 0x19 and the victory sound. Timeout instead: phase 5 slows by 0.05 per tick; stopped before 4336 = lost
(var 0xff 0, lose sound, clip 0x13 -> 0x14). Phase 6 ends (var 0xfa = 7) when the end clip finishes. The loop: medal 0 is a failure (page 19) even when the rex arrived.
Camera: side view from (x 90, y 24, camZ + 12) at the lane (never goes back in z); arrival: (16, 14, 4400) looking back, fog (34, 250). Zoom 0.75, fog 450.

## 4. Props
BLDR: hidden 54 up and 24 off; within 56 (xz) it drops (0.8 / tick sideways, gravity 0.12) and lands (a little past its spot: the original overshoots too). EGGS: within 72 they drop from 48 (model `eggs.msh` -> `yolk_whole.msh` on landing -> `yolk_split.msh` when hit; the record's model is swapped and
`GameRenderer.refreshViews()` called). SLOG: swings (z-tilt 20 degrees x cos phase, phase +pi/30, wraps at pi) while the rex is within 160. VOLC: one rumble at a time within 64 (var 0xfc). GATE: doors (mesh sub-objects 1, 2) open 1 degree per tick in phase 5
(`GameRenderer.partMatrices`). BRON roars when the rex is within 48 ahead. Spectators advance their clip in view and make random calls.

## 5. Approximations / not ported / open
* **Jump key**: the code tests bit 0x20 (BUTTON_2, default Alt, asm 0x768ab6) but the help text says `BUTTON_1 Springen` (0x10, Ctrl): the original disagrees with itself. The port accepts both (`BUTTON.JUMP`). **Closed by the differential test (section 7)**: the original's code reacts to bit 0x20 only (a press of 0x10 does nothing in the emulation); accepting Ctrl too is a deliberate extension of the port, the only known difference in the controls.
* Particles (trexfeet / burn / volcano / statue / egg emitters) and the 4-corner shadow points (+0x88..+0xb4, written, read nowhere in the zone) are not ported (no particle system); the rex has the generic blob shadow. Rumble (force feedback): timers kept; `FUN_00438518` is an empty function in the executable, the `run.rumble` hook is exactly what the original does.
* The zone-timeout probe of the original gets an uninitialised position (never hits): ported as "no collision while slowing down".
* Music starts with the zone (the original starts it when the help is left). The frustum flag of the spectators is a distance test (220). Random numbers (WP-TIME): the shared CRT generator (`src/game/crt.ts`) through `makeRandom` (run.ts): `float(max)` = FUN_004388ae in float32, `int(n)` = `ftol(FUN_004388ae((float) ms)) % n` with `ms` = FUN_00435c91 = the real `getTickCount()` since the zone's start (it only scales the pick; tests inject a scripted rand() and a fixed ms).
* Floats: the original runs the x87 in 24-bit precision (every + - * / sqrt rounds to float32; control word 0x7f, Direct3D 7). The node code of this zone (`trex.ts`, `props.ts`, `run.ts` groundAt, `src/zones/exact.ts`) now rounds per operation like the original, so the port is bit-identical to the emulated original (section 7); the earlier double-precision port drifted ~5e-3 within 600 ticks.

## 6. Tests / runs
`node tools/test-formats.mjs --only m6-z27TRX` (125 checks, ~7 s): EXE constants (arrival / finish / clock, medal and end-clip tables, constructor immediates, the 47 sounds FUN_00766060 loads, speech indices),
controls, jump, roar, each crash type, fire, lane bounce, boulder / egg / log / volcano / gate / bronto, clock text, score and medal table (strict `>`), variables only raised, arrival, scripted LOSS (clock, no input), scripted WIN (bot: 5 hits, 8750, gold, 3534 ticks), RIGHT only (26 hits, bronze), determinism.
Browser (snapshot server on 5603): `tools/steps/m6-z27TRX.mjs` (real keys, win, banner, result menu, continue) and `-loss.mjs` (pause, timeout, banner, retry, abort).

## 7. Differential test (WP-VERIFY): the original's code in the emulator next to the port

`node tools/test-formats.mjs --only m7-z27TRX-emu` (tools/tests/m7-z27TRX-emu.mjs + tools/lib/m7-z27TRX-emu.mjs, ~25 s; runs the original functions of the executable in `src/formats/x86emu.ts`).

**What runs natively (the executable's own code):** the rex node `FUN_0076a39b` with its phases (`FUN_00769cb0` / `FUN_00768510` / `FUN_00769d6e` / `FUN_0076a05c`), the probes (`FUN_007692a1`, `FUN_007698cf`), rumble (`FUN_00769200` /
`FUN_00769859` / `FUN_0076ab2b`), footsteps (`FUN_00769b26`), the rider copy (`FUN_0076a194`), both cameras (`FUN_0076ab5e` / `FUN_0076ac33`), the prop updates (gate, egg + `FUN_00767295`, log + `FUN_007676ea`, volcano,
boulder, brontosaurus, spectators, fly), all constructors, the zone set-up exactly as the loop runs it (`FUN_00766b85` -> `FUN_0076649a(1)` with allocating constructors, then `FUN_00766e19` = builder `FUN_0076b230` +
`FUN_0076649a(0)` with the constructors re-run on the existing nodes), the sound loads `FUN_00766060`, the ground probe (`FUN_0043ce45` / `FUN_004425f0`), `FUN_00441a90`, the matrix builders, the HUD sprintf (`FUN_0076560f`, the banner `FUN_007653be`) and the C runtime.
**Hosted engine services** (not the subject): game variables (the port's `GameVars`), animation instances (the port's `AnimInstance`: start / advance / frame / clip / `FUN_0043b92a`), collision (`FUN_00441270` -> `CollisionWorld.sweep`, `FUN_00441b10` ->
`rayRecord`), sounds / speech / rumble (recorded), particles (no-ops), the random numbers (FUN_004388ae runs NATIVELY; its rand() FUN_0085daf0 is a scripted integer keyed by tick, record and draw, `FUN_00435c91` = the fixed `TRX_MS` that the port's `makeRandom` clock returns too: the port's own `float` / `int` code is compared, not a stand-in).

**How:** one update pass of the original over all 337 records (every node in record order) is run from exactly the state of one port tick (the port's own objects are the shared state: snapshot / restore around the original pass; the port now holds float32 values by construction), then the port ticks; compared per tick: every record's matrix / Euler / flags / model / variant, every node's fields (rex 25 fields, props), run globals (timeout, clock, score, bridge, volcano, camera flag, HUD hit text, HUD dim colour),
variables 0xfa..0xff / 0x1a / 0x87, camera eye / target, animation clip + frame of every record, the number of random draws per node, and the ORDERED list of sound / speech / rumble / fog calls with their positions. Tolerance: 0 (bit-exact; the emulated x87 runs in 24-bit precision, `cpu.cw = 0x7f`).
Every scenario runs at dt = 1 and at dt = 0.5 (`world.dt`; `DAT_008b1718` / `008b171c` written in the emulator).

**Scenarios (~22 k compared ticks):** two whole bot games (dt 1 every 2nd tick, dt 0.5 every 5th), every hazard kind (STMP, FENC, LOGS, STAT, BURN, SLOG, EGGS, VOLC, BLDR) with random speed / lane / keys (jumps, roars, braking), lane changes into blocked lanes (the bounce), standing in a fire patch (clips 5 -> 6),
renamed records for the arms the shipped data has no record for (ROCK, STP2, BLDF, YOLK), boulders / eggs / swinging logs / volcanoes (incl. leaving a volcano in x only) / brontosaurus, free runs with random keys and sounds ending at random (the engine's 'playing' state is perturbed identically on both sides), the arrival run from z 4100 with 0 / 10 / 20 / 30 hits,
finishes at z 4326 with 5 .. 50 hits (every medal and score, hi-score / trophy only raised), a rumble still on at the arrival, the clock running out anywhere (also in the air, also near the camp), the waiting phases 0 / 1, the HUD clock text for every half tick 0 .. 5400 against `FUN_0076560f`, the banner (`FUN_007653be`) for 4 medals x 11 scores against `BANNER`.
A negative control (a port whose speed is off by 0.001) is detected. Instruction coverage of the original's functions (visited by the scenarios): 100 % of the executable lines of the rex node and all props except the instructions after the `ret`s (jump tables), the probe-hit branch of the timeout phase (`FUN_00769d6e`, never reachable: the probe gets an uninitialised position) and one `jmp` per unreachable fall-through.

**Result:** the port matches the original at every compared tick at dt = 1 and, after the fixes below, at dt = 0.5. Visited: phases 4 / 5 / 6 / 7 (+ 0 / 1 as start states), rex clips 1 .. 9, d, f, 10, 11, 13 .. 19, 1a, 1c, 1d, crashes by every hazard, lane bounces, fire, jumping / blinking / timeout / arrival.

**Fixed in the port (found by this test):**
* `GateNode`: the doors open by one degree per update in the original with **no dt factor** (`FUN_00766ef0`); the port scaled it by `world.dt` (half speed at dt 0.5). `props.ts`.
* `TrexNode.footsteps`: `FUN_0043b92a(anim, 1.0)` is `frameCount < 1.0 * dt + 1.0 + frame`; the port used 2.0 (wrong at dt 0.5, the footstep sounds came a tick off). `trex.ts`.
* `prepareTrx`: after the loop's restart pass the rex's record flags are 0x202 (the builder `FUN_0076b230` resets them to 2, `FUN_0076649a` adds 0x200); the port kept the scene's 0x212 (non-solid bit). `prepare.ts`.

**Known differences (counted by the test, not fixed):**
* PTRA (record 2) gets a controller + the no-op `fly` node (`FUN_00768188`) in the original; `prepareTrx` attaches nothing (the update is empty; no observable effect).
* The jump key: Ctrl (bit 0x10) also jumps in the port, in the original only Alt (0x20) does (see section 5).
* Spectators: the original reads the frustum flag (record flag bit 0) and draws a random number **every tick** whether in view or not; the port uses a distance test (220) and draws only in view. The test hands the original the port's decision as bit 0; the draws of the spectators are compared only when the port draws.
* Float32: fixed (see section 5): per-operation `Math.fround` everywhere the original rounds; tolerance of the test is 0. The two worlds side by side (original in the emulator, port native, same keys, no resync) are bit-identical over three whole runs (3554 / 3612 / 2500 ticks). The scene's static record matrices (`formats/matrix.ts`, double products) differ from the builder's float32 products by <= 2.5e-7 (compared with that tolerance; not a zone module).
* PTRA (record 2) gets the controller + the no-op `fly` node (`FlyNode`, `trx-fly`) like the original; `m7-z27TRX-emu` compares the attach list with no exception left. Rescan of the API calls: 4 starts, 17 matrix (12 of them on the dead handle 0xbabababa, the rest `feetMatrix`), 3 param, 12 gate: all covered.

## Closure pass (2026-10-31)
* **Jump key**: the port reacts to bit 0x20 (Alt) only, like the original (`BUTTON.JUMP = 0x20`); section 5 / 7's "the port accepts both / Ctrl also jumps" is stale. The help text's Ctrl label is the original's own inconsistency.
* **Spectators** (`FUN_00768330`): the node draws its random number every tick and tests record flag bit 0 (`RF_FRUSTUM`), as the original (the "distance test 220" statement is stale; `frustum()` is the renderer's sphere test on the record's collision sphere = `FUN_00444370`). Timing fixed: `FUN_00444370` runs in `FUN_00765682` right after the previous loop pass's update (after that pass's update, with its camera) and the nodes read the flag in the next pass; the zone game now sets the flags in `beforeTick` (before the nodes, using the planes `stepView` left at the end of the previous step); before they were set after the nodes with the planes of one pass earlier (one pass too old). `m7-z27TRX-emu` hands the original the port's bit 0, so it cannot see the timing: it follows from the loop order of `FUN_007656f2`: update pass `FUN_0042226e`, then `FUN_00765682` (view, listener, `FUN_00444370`), then the draw `FUN_0042271b`.
* PTRA's `fly` node is attached (`FlyNode`); particles are wired (WP-PART-WIRE); rumble is an empty function (non-gap); the "uninitialised position of the timeout probe" is the original's own bug (never reachable: the probe branch has 0 coverage in the oracle).
