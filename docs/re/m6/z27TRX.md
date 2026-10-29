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

## 3. The run (FUN_00768510, 30 Hz)
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
* **Jump key**: the code tests bit 0x20 (BUTTON_2, default Alt, asm 0x768ab6) but the help text says `BUTTON_1 Springen` (0x10, Ctrl): the original disagrees with itself. The port accepts both (`BUTTON.JUMP`).
* Particles (trexfeet / burn / volcano / statue / egg emitters) and the 4-corner shadow points (+0x88..+0xb4, written, read nowhere in the zone) are not ported (no particle system); the rex has the generic blob shadow. Rumble (force feedback): timers kept, `run.rumble` hook is a no-op.
* The zone-timeout probe of the original gets an uninitialised position (never hits): ported as "no collision while slowing down".
* Music starts with the zone (the original starts it when the help is left). The frustum flag of the spectators is a distance test (220). Random numbers are uniform (original: `rand()` scaled by the tick count).
* Floats are doubles (the original stores float32): no effect on the thresholds.

## 6. Tests / runs
`node tools/test-formats.mjs --only m6-z27TRX` (125 checks, ~7 s): EXE constants (arrival / finish / clock, medal and end-clip tables, constructor immediates, the 47 sounds FUN_00766060 loads, speech indices),
controls, jump, roar, each crash type, fire, lane bounce, boulder / egg / log / volcano / gate / bronto, clock text, score and medal table (strict `>`), variables only raised, arrival, scripted LOSS (clock, no input), scripted WIN (bot: 5 hits, 8750, gold, 3534 ticks), RIGHT only (26 hits, bronze), determinism.
Browser (snapshot server on 5603): `tools/steps/m6-z27TRX.mjs` (real keys, win, banner, result menu, continue) and `-loss.mjs` (pause, timeout, banner, retry, abort).
