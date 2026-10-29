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
