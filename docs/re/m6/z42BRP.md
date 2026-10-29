# z42BRP: Brickster's palace (final boss, two phases)

Entered from the Ogel hub at story node 67; a win ends with `OutroFMV.mpg` (only when var 0xb STARTEDFROMMENU == 0) and goes straight to the island at node 68 (no credits: they are a menu item only, `FUN_00404d14` advances the story before the movie). Abort returns to z40OGL node 66.

## Files and how to run

- `src/zones/z42BRP.ts` (import only), `src/zones/z42BRP/rules.ts` (constants, scoring, EXE table readers), `nodes.ts` (all nodes + `ZoneLoop`), `game.ts` (`registerZoneGame`), `bot.ts` (snapshot/restore, `Phase2Bot`), `bot-plan.ts` (generated side-run plan).
- Tests: `node tools/test-formats.mjs --only m6-z42BRP` (257 checks; `Z42BRP_FAST=1` skips the heavy parts) and the differential oracle `--only m7-z42BRP-emu` (see "Differential test (WP-VERIFY)" below, about 20 s).
- Browser (headless, muted, port 5612): `tools/steps/m6-z42BRP.mjs` (win incl. results, outro, island), `m6-z42BRP-loss.mjs` (fall, pause restart, abort), `m6-z42BRP-look.mjs` (screenshots).
- Regenerate the plans: `node tools/lib/z42brp-planner.mjs 5 60 900 --write` (dt = 1, about 80 s, seed 1) and `node tools/lib/z42brp-planner.mjs 10 60 1500 --dt=0.5 --write` (dt = 0.5, about 100 s) -> `bot-plan.ts` (`PLAN1`, `PLAN1_DT05`); the recorded roof games of the differential test: `node tools/lib/z42brp-roofplan.mjs --write` (about 2 min) -> `bot-plan-roof.ts`.

## Ported functions

| address | what |
|---|---|
| FUN_008212a3 | zone runner (loop modes 1 intro, 9 help, 10 second help, 18 pause, 16 result) |
| 0x823f08 / 0x822ba8 | `pepbrp` ctor / update: side run on a circle (phase 1) |
| 0x8224ba / 0x821704 | `peptop` ctor / update: roof, pizzas (phase 2) |
| 0x82714a / 0x826b40 | `brickst` Brickster |
| 0x824a02 / 0x8243e5 | `bottop` bots (records 92..95) |
| 0x825378 / 0x824c80 | `zonetop` floor, door |
| 0x826516 / 0x825850 | `zonebrp` platforms, sliders, lift |
| FUN_00820f4e | behaviours, FUN_00820b70 sound loader |
| FUN_0081fd64 | end: result, outro when result == 2 and var 0xb == 0 |
| FUN_00838e41 | music groove calls |

Set-up gates: phase 1 = var 0xfa == 1 (pepbrp on PEPP, zonebrp on record 14); phase 2 = 0xfa == 2 (peptop, brickst on 91, bottop on 92..95, zonetop on 14). Vars: 0xfa phase, 0xfb door, 0x96 hi-score, 0xcf trophy.

## Rules

- Side run: radius = collision radius x 0.465 (29.42); LEFT forward, step 0.019198518 rad (the float32 of the exe, `0x8929dc`) x dt per tick, the angle is a float32 wrapped with `fmod(angle, 6.2831854820251465)` (the double `0x401921fb60000000` = the float32 of 2 pi); jump v0 23, g -10, t += 0.1. 6 sliders, BRI2/BRI3 lowered by switches, BRI7 crumbles, BRI5 arc, 4 bobbing BRI4, lift to y 132.703 in 240 ticks then var 0xfa = 2. Falling below y 0.625 restarts the climb.
- Roof: step 0.625; priority DOWN > UP > LEFT > RIGHT; SPACE throws a pizza (1.875 per tick, 60 ticks). Three hits end the game; leg period 60 / 45 / 30. Bots 0.48 per tick, knock-back 20 ticks. Floor 5x5, a row falls every 300 ticks.
- Score = 10000 - 55 per second beyond 60 s (clamped at 0), clock 2 per tick. Gold >= 8350, silver >= 5050, else bronze. Result is always success.

## Findings

- The decompile mislabels some branch directions; checked in the asm.
- The original steps by `0.0192 * dt`. Switch 2's trigger window is 0.00674 rad wide at ground level; at dt = 1 the lattice of Pepper's step positions on that lap has no point in it (the gap between two lattice points is 0.0192 rad), at dt = 0.5 it has (T1a, section below). The port's widened trigger probe (radius 0.16 + 0.5 * 0.0192 * R) is therefore only active for `world.dt > 0.5` (a deviation at 30 Hz, none at 60 Hz).
- Faithful quirks kept: slider reset test inside the loop (only slider 0 exact), bot footstep stage 2 never left, PIZZ loses NO_COLLIDE after its first vanish, FUN_00822b26 reads the head node's flag bytes.
- brp.str and brp2.str are loaded separately (CONTROL0.. collide in the merged table). Animation dictionary: 129 entries.

## Approximations / missing

- No particles (smoke2 / flame1 on Brickster bone 10); rats and slugs unused; analogue stick not read; music starts at zone entry.
- Widened switch trigger at dt > 0.5 only (above). Speech subtitles come from the shell. The analogue stick (DAT_0098384c / DAT_00983850: side run left / right by its sign, roof direction by the larger axis) is not read by the port.
- Bots: side run replays a planner-recorded plan; the roof uses a look-ahead bot simulating the real node code (`Phase2Bot`). The browser bot feeds keys through a hook on `sh.input.update` (`inp.setKey`).

## Differential test (WP-VERIFY)

`tools/tests/m7-z42BRP-emu.mjs` (`node tools/test-formats.mjs --only m7-z42BRP-emu`, about 20 s, 30 million checks) runs the ORIGINAL zone code in the x86 emulation (`tools/lib/m7-z42BRP-emu.mjs`, docs/re/m4/emu.md) next to the port from the same state with the same input and compares after every tick.

- **Native from the executable**: the set-up `FUN_00820f4e` (controllers `FUN_0042382c`, the nine attaches `FUN_00423532` with the six constructors `0x82714a` / `0x823f08` / `0x8224ba` / `0x826516` / `0x825378` / `0x824a02` in creation and in re-init mode), the sound loader `FUN_00820b70`, the six update functions (`0x826b40` Brickster, `0x822ba8` side run, `0x821704` roof, `0x825850` tower parts, `0x824c80` floor, `0x8243e5` bots) with their helpers, the camera helper `FUN_00422c7e`, the matrix builders, the C runtime (sin / cos / fmod), and the whole zone loop `FUN_0081fd64` (modes 7 / 0 / 1 / 9 / 2 / 10 / 4, clock, second help, end sequence, score) with the port ticking in step (`runZoneLoop`).
- **Hosted engine services (not the subject)**: game variables, the animation instances (the port's `AnimInstance` advanced by `rate * DAT_008b1718`), the collision queries `FUN_00441270` / `FUN_00441b10` (the port's `CollisionWorld` over the records the emulated code moved), sounds / speech / letterbox / the end cutscene (ordered event logs; the cutscene is a scripted 60-tick actor), the random numbers (one scripted sequence both sides draw from, `ms` of `FUN_00435c91` scripted from the tick counter), the clocks (`FUN_00435cbb` counts 2 * dt per tick), particles and the walkers (no-ops).
- **Compared every tick**: all 96 records (matrix, flags), every field of the six nodes at the original's offsets (about 150 values, `NODEMAP`), the zone's globals `DAT_05d5f5xx`, all 319 game variables, the camera, all animation instances (clip, frame), the ordered sound / speech / letterbox / cutscene events (3D positions) and the mapping of the port's 3D `voice` numbers to the original's handles. The harness sets the x87 control word 0x7f (24-bit precision, as the executable runs: env `M7_CW` overrides) and the comparison is BIT EXACT (tolerance 0; every record matrix element, node field, camera value equals the original's float32). With the emulator's default 0x27f the test fails by design. The only place with a 2-ulp tolerance is the restart comparison (the original re-computes BRI5's place from the angle, the port's fresh run reads the scene value).
- **Scenarios** (each at dt = 1 and dt = 0.5): construction (nodes, attaches, sound ids, intro camera), the recorded side-run plan (jumps, switch 1, the BRI2 / BRI7 / BRI5 platforms, restarts), random side runs, staged runs from the switch / platform heights, the lift and the phase change, random roofs (walls, falls, bot knock-backs, pizzas, the collapsing floor, the door variable 1 / 2 / 3), recorded bot roof games (three hits, end state 1 / 2 / 3, letterbox, cutscene), the whole loop at dt = 1 (roof by variable) and dt = 0.5 (the whole game from the intro: side run with sw1, sw2, lift, roof, win), a score sweep over 50 s .. 250 s of clock (800 result frames: score text, medal text, speech, `0x96` / `0xcf` variables against `rules.ts`), the pause menu's restart (the original re-initialises in place, the port starts fresh; the side run of both agrees afterwards).

### T1a: switch 2 and the widened probe

Measured with the original's own probe (radius 0.16, skin 0.4, from y + 2.4 down 80) on the oracle world:

- Switch 2's window with Pepper on the ramp (y 84.8): angles 2.52031 .. 2.52705 = 0.00674 rad (0.0066 in the earlier notes is right to 2 digits). Above the ramp (y_ray >= 85.5) the window adds a hole-ridden strip 2.507 .. 2.527; with the landing overshoot of a jump (the probe runs before the landing correction, y_air below the ground) angle 2.513 hits for ray starts y 83.84 .. 84.51.
- dt = 1: the lattice of the real run (angle0 + n * 0.0191985, wraps shift it by 1.7e-7 per lap) has the points L0 = 2.53218 and L1 = 2.51298 around the window: both outside, margins 0.0052 and 0.0073. The only other way is the landing overshoot at L1, which needs y_air in 83.84 .. 84.51; the plan's jump lands with y_air 84.533 (0.03 too high). 16 phases of the lattice (the real one is phase 0) walked through the window by the emulated original: it hits for 5 of 16 phases (31 %), phase 0 does not.
- dt = 0.5: the lattice contains the midpoints (2.5226 lies inside the window); the original hits for 10 of 16 phases and for phase 0 (tick 26 of the walk). The beam search `z42brp-planner.mjs --dt=0.5` (probe widening off) finds the whole run (sw1, sw2, lift) in 1810 ticks; the recorded plan `PLAN1_DT05` wins the whole game in lock step with the original.
- So the widening is not needed at 60 Hz and not exact at 30 Hz: at dt = 1 the port's probe (radius 0.442, window 2.5045 .. 2.5288) triggers switch 2 at all 16 phases where the original triggers it at 5 (KNOWN DEVIATION at dt = 1, counted by the test; it is the only difference to the original at dt = 1). `PepBrpNode.widenTrigger = false` gives the original's probe at every dt (the test runs with it at dt = 1).

### Deviations found and fixed in the port (this work package)

- Constants of `rules.ts` that were rounded decimals, not the executable's float32 values: `TURN_RATE` 0.0191985 (exe 0.019198518, 9.5e-7 relative: 3.6e-6 rad drift after 200 steps), `BOB_STEP` 0.0261799 (1.5e-6: 7.8 * 239 * 1.5e-6 = 3 mm on the flame platforms), `PIZZA_SPIN`, `ARC_STEP`, `JUMP_DT`, `PROBE_UP`, `THROW_OFFSET`, `BOT.SPEED`, `ARC_RISE`, `ARC_WIDTH`, `RADIUS_FACTOR`, the sweep radii / skins. The test checks every `FLOAT_CONSTANTS` entry for `fround(v) === exe value`.
- Per-operation float32 rounding (24-bit x87) throughout `nodes.ts`, in the order of the asm: the side run's angle (float32 after the add and after `fmod(., 6.2831854820251465)`; the lattice of T1a depends on it), `polar()`, the jump (t, velocity, y), sweeps (float32 start / delta in, float32 point / normal out), the side and roof cameras, the slider / arc / crumble / lift / flame-bobber motion, Brickster's leg, the bots' march and spawn, the floor and door, the roof step / knock-back / pizza; `normalise`, the Euler matrices and matrix products are `src/zones/exact.ts`; pi and pi / 2 are the executable's floats. The door's angle constant 0.05235988 is a float32 local, the leg factor is the float 0.01. Before this the port drifted by 1e-5 .. 1e-4 over a few hundred ticks and flipped wall-contact decisions (an idle tick of Pepper started the idle clip in the original only).
- dt = 0.5: `anim.advance(rate)` ignored the step (the original's `FUN_0043b76a` advances by `rate * DAT_008b1718`): Pepper, Brickster and the bots animated at half speed per tick; the 1/60 s clock (`BrpState.clock()`, the flame bobbers) and the game clock `elapsed` counted 2 per tick. All now follow `world.dt`.
- `prepareWorld`: `FUN_00820f4e` ends with `FUN_0043b6a3(Pepper's animation, 1, 0)`: Pepper shows clip 1 (not the idle clip) until the first update (intro screen).

### Statements of the earlier notes that were wrong or are now closed

- "the widened probe is needed": not at dt = 0.5 (above); "unhittable at 30 Hz" is right for the real lattice (T1a) but a jump landing at the right overshoot could hit it (not reachable with the recorded plan).
- "step 0.0191985": the exe has 0.019198518 (float32); "fmod(a, 2 pi)": the original wraps with the float32 of 2 pi.
- Rats (records 0 .. 9) are not touched by the zone code at all and the four slugs only get `flags = 0` each tick (zonetop): both sides agree over about 50 000 lock-step ticks, so "rats and slugs unused (faithful)" is confirmed.
- After the pause menu's restart the original keeps stale internal fields (the side run's jump variables, the bots' timers) and re-uses the flame bobbers' wall-clock phase; `FUN_008260e5` copies SWUP1's matrix into the hidden SWUP2 (invisible until switch 2 rewrites it). The port's fresh start is equivalent in everything the side run shows.

### Not compared / notes

- The sound listener (`FUN_004434d0`): the port sets it in `game.ts` after the tick, the original passes Pepper's (pre-move) pose each node update: one tick lag, not compared. 3D voices: the original's bots 0's step sounds share the handle `DAT_05d5f534` / `DAT_05d5f538` with the generic frame-15 step (one voice), the port uses two voices (`BBFSMETAL[0]`, voices 0 and 1): audible only as an overlap.
- The particles (smoke2 / flame1 on Brickster's bone 10: `FUN_0043bc58` + `FUN_00442960` / `FUN_00442a20`) are hosted no-ops; their calls are counted (`E.fx`).
- The pause / result menus (modes 3, 5, 8) and the exit paths belong to the shell (not run). `FUN_00820b70` also loads the cutscene sounds `SND_BRICK_FIRE` (0x381) and `CSSND_BRICK_SPLOOSH` (0x382) and exports their handles in `DAT_05d5f518` / `DAT_05d5f51c`; no node of the zone plays them (presumably the end cutscene BRP01 does).

## WP-PART-WIRE / WP-MINI (2026-10-29)

* **Particles** (all 21 call sites of the zone: 3 starts, 18 gates): Brickster's constructor `FUN_0082714a` stores the identity in the static matrix DAT_05d5f608 and starts `smoke2`, `flame1`, `flame1` on it at (0, 0.3, 0.2), no rotation, gate off (`game.ts`, `BrpState.bossFxM`). `FUN_00826b40` (Brickster): when the hit count it has seen changes, 0 -> all off, 1 -> smoke2 on, 2 -> first flame1 on; while the seen count is not 0 the matrix is bone 10 of BSTR's last drawn pose x its record matrix (`boneOfPose`, FUN_0043bc58 + FUN_0043a9e5). `FUN_00824c80` (roof): while a cutscene runs the matrix follows bone 10; var 0xfb = 2 lights the second flame1 (others off), 3 puts all out (the end cutscene BRP01 drives 0xfb). The restart branch of the ctor (all off) is covered by the port's fresh zone start. Node test: gates after the first and second hit, the matrix on the bone.
* T1a (widened trigger at the 30 Hz step) stays for WP-TIME. WP-VERIFY's other findings for this zone were already fixed in nodes.ts (float32, dt).
* Browser steps (test aids, no check changed): the bots' key hook is installed before play starts (a late hook under heavy load missed the first ticks of the recorded run) and drives the keys only in mode 2 (it used to release the arrows every tick, which swallowed the menu taps of the pause-abort); `m6-z42BRP-loss.mjs` confirms the pause menu's restart / abort on the confirm page (0x14) that WP-SHELL added. New `tools/steps/m6-z42BRP-fx.mjs` (particle stats after hit 1 / 2).
* WP-VERIFY items fixed: the sound listener is set before the tick (the original passes Pepper's pre-move pose in every node update: one tick behind the port's old end-of-tick call); bot 0's step sounds use voice 0 of 0x246 / 0x247, the handles of the generic frame-15 / frame-5 step (`DAT_05d5f534` / `538`), bot n voice n. Sounds 0x381 / 0x382 are loaded by `FUN_00820b70` and played by no node of the zone (the end cutscene's script, `ctx.cutscene`): unchanged. API rescan of the zone: 3 starts + 18 gates (no matrix calls) all wired above; no direct `FUN_0044ea60` / `44ea00` / `44e920` callers.
