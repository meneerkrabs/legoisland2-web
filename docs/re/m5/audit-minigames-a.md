# M5 audit, part C: z05WAB, z17WAS, z36CNT, z38PAR

Scope: the M3 ports of Whack-A-Bot (z05WAB), Whack-A-Snake (z17WAS), the Centrifuge (z36CNT) and Parachute (z38PAR): re-check every approximation of their M3 docs against the
decompile, fix what is fixable exactly, and verify the node logic against the ORIGINAL executed in the x86 interpreter (M6-style oracle tests: the original's constructor + update
functions run natively from the user's executable next to the TypeScript port, same buttons, same random numbers, everything compared tick by tick). Particles, music timing, the
original RNG, gamepad, saves are other packages (listed as pending below).

## Method: oracle tests (new)

| test | harness | what runs natively in the emulator | compared per tick |
|---|---|---|---|
| `tools/tests/m5-audit-z05WAB-emu.mjs` | `tools/lib/m5-wab-emu.mjs` | `botwab` ctor `FUN_0056b2d5` / update `FUN_00569f50` (+ `FUN_0056bb20`, `0056c6a5`, `0056c8f1`, `0056b1dc`), `pepwab` ctor / update `FUN_0056c950`, camera helpers `00422c7e` / `00422ddc`, C runtime | node fields (bot states, y, timers, lids, TV, counters), Pepper node, globals (stun, clip, over, percentage), HUD strings, all 48 records (matrix, flags), camera, every sound / speech / texture-frame / UV-scroll call, random-call count. 4 games x 3000 ticks (mash, perfect, idle, spam, hit-everything incl. the Infomaniac): 13.2 M checks |
| `tools/tests/m5-audit-z17WAS-emu.mjs` | `tools/lib/m5-was-emu.mjs` | `zonewas` ctor `FUN_0069b337` / update `FUN_00699e80`, `pepwas` ctor `FUN_0069bf24` / update `FUN_0069b9b0`; the pose buffer is filled "by the renderer" after every tick | node fields, Pepper's node, globals, HUD strings and the score line, all 52 records, all animation instances (clip, frame), sounds, random-call count. 5 games x 2900 ticks (mash, idle, two perfect players with gem grabs, spam): 13.7 M checks |
| `tools/tests/m5-audit-z36CNT-emu.mjs` | `tools/lib/m5-cnt-emu.mjs` | TRAI ctor `FUN_007b20a8` / update `FUN_007b0c6e` (+ `007b0401`, `007aff48`, `007aff9f`, `007af902`), Bob `FUN_007b2836` / `007b24a2`, the draw hook `FUN_007b1a1b` (placement part) | every controller field, the zone globals, Pepper's and Bob's animation, the 14 light records, the game variables, all sound / pitch / speech calls, random-call count; 8 whole games x 3400 ticks (belt, visor, start, run, stop, result: perfect, partial, mash, lazy, with better / worse stored hi-scores); plus 40 placements of the arm / chair / weight / Pepper matrices at random angle / power (2560 matrix elements, worst difference 1.4e-6) |
| `tools/tests/m5-audit-z38PAR-emu.mjs` | `tools/lib/m5-par-emu.mjs` | pilot ctor `FUN_0046a926` / update `FUN_004686a3` (649 lines), HUD feed `FUN_00466f50`, sound loads `FUN_00467370` | node fields, run globals (score, wind, y, height, ground, rings, canopy, over, landing score / bonus), the pilot's matrix + Euler angles, the camera, the animation, ring / target / shadow visibility, the HUD (text, compass, ring icons, chute icon, `chuteOk`, `refAlt`), all sounds + speech, random-call count. 6 whole jumps (bot: 3 rings + target 3 / rings 3-1 + target 1 / no chute crash / no dive; two button-mashers), states 0..5 and 7 all visited: 1.2 M checks. The engine's collision queries (sweep `FUN_00441270`, probe `FUN_00441ac0`, the ground ray inside `FUN_00442a70`, the pterodactyl box `FUN_00468590`) are answered by the PORT'S collision code in both: they are not verified |

Every oracle run found real differences at first (listed below under "fixed"); all four now pass. Reading-only verification is marked as such.

## z05WAB (Whack-A-Bot)

Verified by the oracle (13.2 M checks, 0 differences after the fix below): the whole bot / hole / lid / TV / scoring / clock / alarm state machine, Pepper's hammer (clips, stun, busy,
start-up lock), the percentage and HUD strings (including their one-tick lag), the camera, all records, every sound / speech / frame call, the end-of-game state and the percentage.
By reading: the loop `FUN_0056905a` (mode flow, the hiscore (var 0x20) / trophy (var 0x40) rules, result menu cases, exit `FUN_00404d14(&next, exit == 2, score >= 5000)`), medal thresholds
9000 / 8000 / 5000 (the original writes hiscore / trophy every banner frame, the port once when the banner starts: same end state).

Fixed:
* `DAT_008f6c00` (Pepper's swing clip that the hit test reads) is left untouched at the game over; the port reset it to 1 (found by the oracle; no visible effect, the hit test does not run after the end).
* The three positional sounds (hit bot, hit Infomaniac, miss: ids 0x1de / 0x1df / 0x1e0, loaded by the original with `FUN_004433b0`) were played 2D at full level; they now go through the audio engine's 3D slots (`ga.sfx.load3D` / `play3D`, listener = the fixed camera) at the position of the active hole, like z17WAS / z20DSP. The original's miss sound with no active hole passes uninitialised stack data (0xcccccccc coordinates, far outside the 3D range = silent): the port plays nothing then (the oracle log shows the call; the test maps it to "none").
* The end banner leaves for the result menu as soon as ANY button is HELD (`DAT_0098383c != 0`, a held key skips the banner at once; intro / help use `DAT_00983840 != 0` = any button pressed). `ZoneGame.skipBanner` = held buttons (`z05WAB/game.ts`).

Not exact / pending: particles (bolts, swirl: particle package); random numbers are uniform (`ftol(rand() / 32767 * (GetTickCount() - base)) & 3`, RNG package); the music replay at the banner (`FUN_004432c0`, audio-timing package); the layer-0 draw details (Pepper's blob shadow not compared).

## z17WAS (Whack-A-Snake)

Verified by the oracle (13.7 M checks, 0 differences after the fixes): snake spawn / rise / up / sink, lids on bone 10, the gem holder and the -300 rule, Pepper's wind-up / whack / grab state machine and its sounds (round robins, grunt), squash + dented baskets, skeleton stages, the clock beeps, game over, final score, all records and animations.

Fixed (all found by the oracle):
* **Spawn pause**: the original starts the pause between two snakes at 30 ticks and SHRINKS it with the clock: 24 below 1830 ticks left, 19 below 930, 15 below 480 (the comparisons use `timeLeft`, +0xc0). M3 had read the thresholds as ticks played and the values reversed (15 -> 19 -> 24: the game got easier). The first snake now comes at tick 30 (was 15). `K.SPAWN_GAP` / `K.GAP_AT` / `K.GAP_START`; `m3-z17WAS` updated.
* **HUD strings** (gems, hits, the score line) are formatted before the swing / spawn logic of the same tick and so lag the counters by one tick (`gemText` / `hitText` / `scoreText`, like the clock text already did).
* **Head bone**: `FUN_0043bc58` reads the matrices the renderer evaluated at the end of the previous loop iteration, i.e. the pose BEFORE this tick's animation advance (the lid follows the head one frame behind). The oracle harness models the renderer's pose buffer (evaluated after every tick); that model is an inference (the only caller of the pose evaluation `FUN_0043ba7a` is the model draw `FUN_004440f0`, and the loop draws after every update).
* `DAT_00925e58` (Pepper's current clip) is a process global that the constructor does not reset: it now persists across runs (`WasShared.resetGlobals()` for tests). A restart / re-entry therefore starts with the clip the last run left.
* Banner: this loop leaves the banner on a pressed button (not held), unlike z05WAB / z38PAR: checked, unchanged.

Not exact / pending: torch particles (`wasfire.par`); music at the start of play; RNG (uniform ints); the `GEMM` record's second flag word (`+0x62 = 0x20`): never read by the zone, its effect in the renderer is unknown (not modelled); `DAT_05d5be54` persistence across restarts is irrelevant (only read after being written, `FUN_00404d14` needs exit state 2).

## z36CNT (Centrifuge)

Verified by the oracle (1.4 M checks): the complete state machine (belt, visor, start, run, stop, result), the window / latch / streak / power / bonus logic, the monitor frame ranges, the lights, the pitch calls, Bob's machine, hi-score / trophy writes with better / worse stored hi-scores, the placement of arm / chair / weight / Pepper (the draw hook's real copy). By reading: the HUD feed `FUN_007aef49` and the banner `FUN_007b0085` (medal text and speech choice by the shown score, `FUN_0041c080` + pressed-button exit as ported).

Fixed:
* The monitor's next range (`+0x13c`) is written whether or not the range changes (`CentrifugeSim` step, found by the oracle).
* The motion-blur copies are drawn with mode 7 = state preset 26 (modulated colour + alpha, blended, NO z test; `modePreset(7)`), the port used preset 13 with z (`GameRenderer.ghosts`, only z36CNT uses it).

Not exact: the draw ORDER of the copies (the original draws them inside the hook; the port right after their record, so later records overdraw them); the arm shadows use the generic shadow mesh (the original's `FUN_0087dd20` polygon call is identified by its geometry, not read); controller rumble; the original RNG for Bob's random clip (`rand() < power`).

## z38PAR (Parachute)

Verified by the oracle (1.2 M checks, 6 whole jumps): the dive / pitch / glide dynamics, the rings (bonuses, dive bonus, speech lines), the target landing score and the landing bonus (flare cost), the crash paths, the bounce (state 7) incl. the reflected velocity, the wind, the camera, all sounds and speech, the HUD feed (compass, ring icons, chute-allowed rule). By reading: the props `FUN_00467520` (boat), `00467e40` (balloon), `00468040` (plane), `004677a0` (three pterodactyls: radii, heights, phases, steps, headings, call / fly sounds) match `par-props.ts` constant by constant; the loop `FUN_00465d39` (hiscore / trophy / result 1 or 2 by the STORED hiscore >= 2000, result speech, `FUN_00404d14(&next, exit == 2, ce8 == 1)`).

Fixed (oracle):
* **Ring missed**: the compare is against the DOUBLE at 0x8924c0 = -8.0 (the decompile shows `(float)_DAT_008924c0 = 0`: a misreading). A ring is missed once the pilot is more than 8 below it; M3 used 0, which marked rings missed (and so denied the bonus / revealed the wrong HUD icon) up to 8 units too early, and the "both upper rings" hint line came too early too. `m3-z38PAR` updated.
* **Crash tick**: when the glide ends with the pilot below the ground (state 3, `height < 0`) the original reloads its position from the record, so the pilot does NOT make this tick's move; the port moved once more (0.15 units).
* **float32**: the original's node fields, record angles and locals are 32-bit floats stored per statement; the port computed in double and let the trajectory drift (positions differed by 1e-3 after a few hundred ticks, enough to flip a ring decision). The pilot update now rounds at every store (`rec.rx / ry`, `fall`, `windX / Z`, `windDir`, `ex / ey / ez`, distances, `groundY`, `height`), the constants of the 0x3e.. immediates are the float values (`PILOT.PITCH_STEP` ... `CAM_LIFT`). Residual differences are 1e-5 (x87 extended intermediates, sin / cos of floats).
* **SeaAmin**: the shore foam record SEAE carries the island's SeaAmin node (0x4b1212), its texture wobble was skipped because the node reaches the renderer through the island context's `uvScroll`; the zone game installs just that service (`installCtx` with `GameRenderer.scrollGroup`), the foam moves now.
* The end banner leaves on ANY HELD button (`ZoneGame.skipBanner`), like z05WAB.

Not exact / pending: particles (spray, footsmoke); the SHAD blob shadow is a flat quad (the original projects 4 probe points onto the terrain, `FUN_00442a70`; only the centre ray is used by the pilot); `plane_flyoff` plays in the original when a button is HELD during mode 0 (the one-tick init mode: mode 2 at once, skipping intro and help): the shared template does not model mode 0's held-button path; the collision queries themselves (see the method note); music timing (starts at zone entry); RNG.

## Shared-file edits (additive)

| file | edit | why |
|---|---|---|
| `src/shell/playzone.ts` | the intro / help (modes 1, 9, 10) leave on ANY pressed button (`pressed & ~ESC`), previously only Enter / Space / Shift / Alt / Ctrl | every mini-game loop tests `DAT_00983840 != 0`; the arrow keys, Z / X / C count |
| `src/game/render.ts` | `GHOST_PRESET = 26` for the motion-blur copies (was 13) | original draw mode 7 (z36CNT only) |
| `src/zones/z38PAR.ts`, `src/zones/z05WAB/game.ts`, `src/zones/z17was/rules.ts` + `z17WAS.ts`, `src/zones/z36cnt/sim.ts`, `src/zones/parachute/par-pilot.ts` | zone-specific fixes above | |

Tests: `m5-audit-z05WAB-emu`, `m5-audit-z17WAS-emu`, `m5-audit-z36CNT-emu`, `m5-audit-z38PAR-emu` (new); `m3-z17WAS` (spawn gap, first snake at tick 30) and `m3-z38PAR` (ring-miss threshold, float pitch step) updated; all M3 tests of the four zones pass.
Bot steps (headless, muted, real key input, snapshot server port 5513, `sh tools/m5-botslot.sh`): `tools/steps/m5-z05WAB.mjs` (arrow keys skip intro / help, short game, held key skips the banner, waiting banner), `tools/steps/m5-z17WAS.mjs` (arrow skip, first snake at tick 30, held key does NOT skip this banner), plus the unchanged M3 steps `m3-z36cnt.mjs`, `m3-z38PAR.mjs` (loss run now releases the key before the ground).

## Follow-up (wrap-up checks)

* Music: the audio package moved the music start into the runner (`AudioHost.modeChange`, `enterZone` in `runPlayZone`); `z05WAB/game.ts` no longer calls `leaveZone` / `enterZone` and plays `Z05WAB1` again at the banner (`sh.audio.playMusic`). Deliberate, so `m3-z05WAB` now asserts that convention (the stub has `playMusic`); it passes (192).
* z38PAR banner ticks no nodes: the loop `FUN_00465d39` runs the update passes (`FUN_0042226e` / `FUN_00427233` / `FUN_004225c5`) only in mode 2; mode 4 only draws and advances Pepper's win / lose clip by hand (`FUN_0043b76a`). So z38PAR (and z05WAB, z17WAS) keep `bannerTick` only; `tickInBanner` is z40aPO's / z41MAP's / z36CNT's.
* Bot re-runs (port 5513, real keys, screenshots looked at): `m5-z17WAS` passes with the first snake at EXACTLY tick 30 (recorded by a `world.tick` wrapper: pause 30, `lastRise` -1, elapsed 30 > 29, same as the oracle); `m3-z38PAR` passes including the loss run (key released before the ground, failure banner shown, abort -> node 58).
* All eight tests pass (m3-z05WAB 192, m3-z17WAS 191, m3-z36cnt 270, m3-z38PAR 132, the four m5-audit oracles). `tsc --noEmit`: no errors in my files (remaining ones are other workers': `fx/particles`, `render/`, `shell/cheats.ts`, `z42BRP`).

## Closure 2026-10-31 (fork C)

The 'Not exact / pending' lines above are historic: particles are wired for z05WAB / z17WAS / z38PAR (WP-PART-WIRE, tests `m8-wire-*`), random numbers are exact (WP-TIME: shared CRT generator, ms-scaled picks), music starts per A1, z36CNT's copies / shadows / rumble are closed (z36CNT.md section 12), z38PAR's SHAD patch is the terrain patch drawn in the canopy's draw hook with the z test off and the canopy hook runs in every pass (z38PAR.md 'Closure 2026-10-31'), `plane_flyoff` is played by the mode-0 held-button skip (`ZoneGame.skipInit`), z17WAS's `GEMM` flag word is set, `DAT_05d5be54` persistence is modelled (`WasShared`). Nothing open.
