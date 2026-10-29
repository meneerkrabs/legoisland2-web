# z42BRP: Brickster's palace (final boss, two phases)

Entered from the Ogel hub at story node 67; a win ends with `OutroFMV.mpg` and the credits (only when var 0xb STARTEDFROMMENU == 0), then the island at node 68. Abort returns to z40OGL node 66.

## Files and how to run

- `src/zones/z42BRP.ts` (import only), `src/zones/z42BRP/rules.ts` (constants, scoring, EXE table readers), `nodes.ts` (all nodes + `ZoneLoop`), `game.ts` (`registerZoneGame`), `bot.ts` (snapshot/restore, `Phase2Bot`), `bot-plan.ts` (generated side-run plan).
- Tests: `node tools/test-formats.mjs --only m6-z42BRP` (257 checks; `Z42BRP_FAST=1` skips the heavy parts).
- Browser (headless, muted, port 5612): `tools/steps/m6-z42BRP.mjs` (win incl. results, outro, credits, island), `m6-z42BRP-loss.mjs` (fall, pause restart, abort), `m6-z42BRP-look.mjs` (screenshots).
- Regenerate the plan: `node tools/lib/z42brp-planner.mjs 5 60 900 --write` (about 80 s, seed 1).

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

- Side run: radius = collision radius x 0.465 (29.42); LEFT forward, step 0.0191985 rad per tick; jump v0 23, g -10, t += 0.1. 6 sliders, BRI2/BRI3 lowered by switches, BRI7 crumbles, BRI5 arc, 4 bobbing BRI4, lift to y 132.703 in 240 ticks then var 0xfa = 2. Falling below y 0.625 restarts the climb.
- Roof: step 0.625; priority DOWN > UP > LEFT > RIGHT; SPACE throws a pizza (1.875 per tick, 60 ticks). Three hits end the game; leg period 60 / 45 / 30. Bots 0.48 per tick, knock-back 20 ticks. Floor 5x5, a row falls every 300 ticks.
- Score = 10000 - 55 per second beyond 60 s (clamped at 0), clock 2 per tick. Gold >= 8350, silver >= 5050, else bronze. Result is always success.

## Findings

- The decompile mislabels some branch directions; checked in the asm.
- The original steps by `0.0192 * dt`; at the fixed 30 Hz step switch 2's trigger window (0.0066 rad) was unhittable because `fmod(a, 2 pi)` shifts the lattice. Fix: widened trigger probe (radius 0.16 + 0.5 * 0.0192 * R).
- Faithful quirks kept: slider reset test inside the loop (only slider 0 exact), bot footstep stage 2 never left, PIZZ loses NO_COLLIDE after its first vanish, FUN_00822b26 reads the head node's flag bytes.
- brp.str and brp2.str are loaded separately (CONTROL0.. collide in the merged table). Animation dictionary: 129 entries.

## Approximations / missing

- No particles (smoke2 / flame1 on Brickster bone 10); rats and slugs unused; analogue stick not read; music starts at zone entry.
- Widened switch trigger (above). Speech subtitles come from the shell.
- Bots: side run replays a planner-recorded plan; the roof uses a look-ahead bot simulating the real node code (`Phase2Bot`). The browser bot feeds keys through a hook on `sh.input.update` (`inp.setKey`).
