# z20DSP: Desert Speedster

Runner FUN_006bf929; behaviours 6be930 (set-up), 6bf633, 6bfa9c; Speedster FUN_006c2627; WalkRock 6c0250; Saucer 6c1630; whirlwind 6c1990; scoring 6c6d57; Replay.c at 6f3270.

## Files
- `src/zones/z20DSP.ts`: ctor registration, zone game (HUD, banner, sounds, camera hook, debug `game.dsp`).
- `src/zones/z20dsp/spline.ts`: uniform cubic B-spline of the car1.man points (x negated), frames R=(Tz,0,-Tx), U=T x R (0x4466f0 / 0x446af0 / 0x446fd0 / 0x447280 / 0x447550).
- `replay.ts`: input recorder, 12-byte slots, 0x1a5e0 bytes (8999 slots).
- `speedster.ts`: car update (ramps, forces, wall probes, ground ray, collisions, finish autopilot, wrong way, gauge, sounds).
- `props.ts`: the other nodes. `camera.ts`: orbit for 270 ticks, then chase. `prepare.ts`: record checks and binding. `rules.ts`: medals. `shared.ts`: constants.

## Rules
Clock counts in states 4 and 5; a time bonus freezes it for 45 ticks; turbo x1.15 for 60 ticks; shrink 30/150/30 ticks to scale 0.5. Medals by clock: gold < 2700, silver < 3600, bronze < 4500. Score = 10000 - 3 * max(0, clock - 2100).

## Pitfalls found
sin = 0085d1c4, cos = 0085d374 (x = cos, z = sin in whirlwind / saucer / spin); several hex floats hand-decoded wrong (verified by emulator); Ghidra drops FPU subexpressions; ground record stays unset as in the original.

## Verification
Node test compares against the original code in the x86 emulator (`tools/lib/dsp-oracle.mjs`): Speedster identical for thousands of ticks, props identical in most runs. FUN_006c0af1 (rock hit, null controller) crashes in the original and is hooked out.

## Approximations / open
No particles, analog axis ignored, Replay playback is dead code kept, COW 'COW\0' branch unreachable, win bot teleports to t=0.925, subtitles drawn by the runner.

## WP-PART-WIRE / WP-MINI (2026-10-29)
* **x87 precision**: the game runs the x87 in 24-bit mode (docs/re/engine-m1.md 8.1). The whole zone is now bit-exact in that mode: `spline.ts` (FUN_00446fd0 / 004466f0 / 00446af0 / 00447280 / 00447550; the old version differed by 1e-3), `speedster.ts`, `props.ts`, `camera.ts` (`src/zones/common/x87.ts`: `euler24`, `eulerScaled24` = FUN_0043a742, `normalize24`, `cross24`; `render/math.ts` `mulGame`). Constants are the executable's float32 values, the 3-term sums follow the asm order (the decompile lists them reversed), `terrain` = FUN_0043ce45 (ray 300, `NO_GROUND` = float -1e38), `DspRng` = `ftol(FUN_004388ae(n))` (`// RNG:`).
* **Strict differential test** `tools/tests/m7-z20DSP-emu.mjs` (+ `tools/lib/dsp-oracle.mjs`): the original set-up FUN_006be930 + FUN_006bf633, every node's update (Speedster FUN_006c2627, falling cows, saucers + cones, whirlwind, WalkRock, Bertha, Spin, pickups) and the camera FUN_006bd776 run natively at cw 0x7f next to the port with the same buttons and random draws; compared as float32 every tick: the Speedster node (all fields), the records of all nodes (matrix, Euler, flags, clips), wheels, driver, variables, score, sounds (kinds and order), speech, the four emitter matrices, the particle call log, the camera. Two runs (seed 11 dt 1, seed 5 dt 0.5), each: 40 ticks of intro, countdown, a pilot lap along the track plus 18 placements along the track (cows, boulders / rocks, saucers, whirlwind, cacti, bricks, the finish line); about 12M comparisons, 0 differences. The 1e-3 "prop-oracle divergence" of gaps.md was the old 53-bit oracle against the 24-bit game.
* Found and fixed by it: `(forceScale (acc + brake)) e4` order, rounding of all float fields / constants (0.45, 0.075, 4.8, 0.7853982 ...), wall bounce tangent (`FUN_0043cec0`), the "behind the start line" branch keeps the new yaw, `turnTo` stored as float, side-slip sum order, the wheel / tilt sums, the rock's `normalize`, the camera's 9.2 float.
* **Emitters** (FUN_006bf633, `src/zones/z20dsp/emitters.ts`, `ZoneParticles` in `z20DSP.ts`): `cactus` x2 (record 2 matrix, offsets (+-0.145, 0.1, -0.85), gate var 0xfa), `problow` x2 (DAT_05d5c2c0 / 300, (-+0.25, 0, 0.35), gate 0xfc), `problow` x2 (DAT_05d5c340 / 380, (-+0.25, 1, -0.5), gate 0xfd), `cactuspop02` (record 2, (0, 0.25, 0), -pi/2 about x, gate 0xfb). The Speedster rewrites the four matrices at the top of every update (wheel places 2, 3, (0 with z of 2), (1 with z of 3), y - 2, times the car matrix: the original's quirk), rebinds / restarts them in the dust / skid block (0xfd, 0xfc: `setMatrix` once when the dust starts, `stop` x4 while skidding) and on a smashed cactus (`stop` + `setMatrix(cactuspop02, cactus record)`). Calls and matrices are compared with the original per tick. Screenshots: `tools/steps/wa-z20DSP-fx.mjs` (dust behind the car, turbo exhaust).
* Residuals: COW 'COW\0' branch unreachable (the records are COW0..2): faithful; Replay playback is dead code (kept); subtitles by the runner (U3); win bot teleports (test aid). `FUN_0043ceae` returns ST0 junk: 0 as in the emulation (the camera test passes in the orbit and the chase).

* **WP-TIME (2026-10-30).** The animation advances of the cows (`FUN_006bfc10`), Bertha (`FUN_006c0b70`), the WalkRock bot (`FUN_006c0250`) and the driver figure (`FUN_006c61cf`) are `FUN_0043b76a(anim, 1.0)` = `rate * DAT_008b1718` and now pass `w.dt` (before: dt 1 baked in; the oracle's hosted advance ignored the dt, so it did not see it: it passes `mem.f32(0x8b1718)` now and `m7-z20DSP-emu` also compares the animation FRAME of every record, which fails when the dt is dropped again). The cow's fall (`vy -= 0.32`), the turbo / pickup spin, the fixed 150-tick replay buffer are per update (per drawn frame) in the original too: not scaled. Random numbers: the shared CRT generator (`DspRng.next() = rand() / 32767`); the cow, bump and horn sounds are `ftol(FUN_004388ae((float)FUN_00435c91())) % n` (`& 1` for n = 2) over the real milliseconds since `FUN_006bde34` started the zone clock (`DspRng.tick(n)`, `startTickClock()` in the zone game). The oracle pins both clocks to 5000 ms and seeds its own LCG (`Replay` feeds the draws to the port).
