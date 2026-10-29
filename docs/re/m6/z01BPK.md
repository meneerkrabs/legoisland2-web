# z01BPK: the skate park (M6)

"Doe zoveel mogelijk stunts in 2 minuten" (BPK.str `BPK2`): Pepper rides a skateboard around a walled arena with two half-pipes, crouches (Alt) to charge a jump, and in the
air holds Space / Ctrl / Shift plus a direction for one of 20 stunts. A stunt's progress scores 15 (30 at the end) per tick; a clean landing moves that score into the total at
10 per tick; a stunt held past 100 at the landing is a crash. 3600 ticks (2 minutes); the total decides the medal (bronze > 0, silver > 2500, gold > 5000) and is stored as
`HISCORE_BPK` (0xc0) / `TROPHY_BPK` (0x8d). The zone is a kind-1 zone of the table (story node 1, `S250 == 1`, skipped by "New game"; started from the Pepper's-house replay list
or the front end's level select) but its loop has the mini-game result menu and the mini-game pause, so the port's zone game overrides the hub config.

Code: `src/zones/z01BPK.ts` (constructor registration, the zone game: HUD, banner, trick-name text, sounds), `src/zones/z01bpk/skate.ts` (the skateboard node, the stunt table),
`run.ts` (shared state, the clock / score node, the walk to the board, `finishGame`), `setup.ts` (the zone loop's set-up of the world, the spectators), `sound.ts` (slots).
Node harness: `tools/lib/bpk-load.mjs`, bot: `tools/lib/bpk-bot.mjs`. Test: `tools/tests/m6-z01BPK.mjs` (443 checks). Browser: `tools/steps/m6-z01BPK.mjs` (win),
`m6-z01BPK-loss.mjs` (loss / pause / retry / abort).

## 1. Functions ported (VA)

| address | function | role |
|---|---|---|
| 0x48d8bd | zone loop | template modes (loopmachine.ts); mode 2: the 19 spectators (records 0x25 .. 0x37) advance their clip and turn to Pepper (`spectatorsTick`), the stunt name text (FUN_0048d52b), `DAT_05d57fc4 != 0` -> mode 4; mode 4: FUN_0048d3d1, no points (`DAT_05d580bc < 1`) -> straight to mode 5 (`skipBanner`) |
| 0x493506 / 0x4938e8 | set-up / re-init | overlays `z36cnt`, `BPK.str`, music `z01bpk`, node attaches FUN_004933c4, Pepper's matrix + place (`readStartMatrix` reads the 12 stores out of the code), camera (target +3, eye (0, 12, -16) in the frame turned by pi), clips: Pepper 0x1b, spectators 0x7a / 0x7b (pairs, the judge 0x7a), board 0 |
| 0x4933c4 | player chain | `PepSwitc` FUN_00494091 @ 0 [always], `Walk` FUN_004944f3 @ 1 [PEPPER_CONTROL & 1], skate FUN_00492cc2 @ 2 [& 4]; PEPPER_CONTROL = 1, mailbox 0x1b, board record 0x24, gravity -10 |
| 0x494091 / 0x493dd8 | clock node | `BpkSwitch`: while PEPPER_CONTROL == 4 (exact): the clock FUN_00493ba0, at the end FUN_00493ecd(score) |
| 0x493ba0 | clock | time 3600 ticks, runs down except while Pepper's clip is 0x16 (getting on); text "M:SS" = `%01d:%02d` of (ticks / 30) / 60, (ticks / 30) % 60; a judged landing (trick flag) moves the stunt score into `pending`, 10 per tick into the total |
| 0x493ecd | result | thresholds 5000 / 2500 / 0 (`>`), trophy only raised, `result = 2 - (stored trophy != 0)`, hi-score raised -> `BPK1` text |
| 0x4944f3 / 0x494190 | walk | Pepper walks to (33.9, 16.3, -29): turns 45 deg per tick until `forward . d >= 6.8` (or it was > 6), then faces the target and steps 0.2; idle clip 0x1b -> walk 0x0d after one wrap; at distance <= 0.8: clip 0x16, board clip 1 + shown, PEPPER_CONTROL 4 |
| 0x492cc2 .. 0x490e2e | skateboard | `BpkSkate`: update FUN_00490e2e (the CURRENT_SUBGAME == 1 branches; the island's branches are src/island/vehicles/skate.ts), FUN_004900d4 (state work), FUN_0048f66d (state machine), FUN_0048e840 (stunts), FUN_00490cd2 / FUN_00490af4 (input), FUN_0048fece (wheels) |
| 0x4928d2 | pre-render | both branches test CURRENT_SUBGAME != 1: nothing in the park |
| 0x48d52b | stunt names | clip -> `BPK3 .. BPK23` text at (325, 450), wrap 30 (`TRICK_NAMES`) |
| 0x48d3d1 / 0x48d390 | banner / intro | score (y 50, wrap 10), medal text of STD.str (y 100, wrap 8 / 8 / 6), `BPK1` when the hi-score was beaten (y 150, wrap 20); brief `BPK2` at y 60 |
| 0x492ec0 | sounds | the wheels = 3D sound 0x94 (looping, played at the board every rolling tick, stopped otherwise), the crash 0x1a8, the 17 stunt sounds 0x1aa .. 0x1bb |

## 2. The skateboard (CURRENT_SUBGAME == 1)

State byte = Pepper's clip: 0x16 getting on, 0x2d push off, 0x29 rolling, 0x51 / 0x53 lean (scrubbed by the steering), 0x2a crouch, 0x2b crouch held, 0x20 in the air,
0x21 landing, 0x23 crash. Differences to the island's branches of the same function (the port reuses the structure, not the code):

* ground sweep from y + 1.2 down by `vyv * dt - 40`, radius 0.8 / skin 0.6 (island 1.4 / 0.2, -8); hovering at the skin height, floor clamp 0.6479;
* no brake (Down only moves the vertical stick), no automatic push-off timer, `maxSpeed` 0.75 (+0.1 per stunt that ends with its score pending, up to 1.0; crash resets it);
* jump: `v0 = charge * 20` (charge 0.1 + 0.06 per tick, max 2), `y = v0 t + 1.5 g t^2` with t += 0.1 per tick (a full jump: 27 ticks, 26.7 high); falling off the start platform
  (z <= -25, drop > 2) or moving up above y 9.25 launches with v0 = 30 without a crouch;
* walls: x +-39.9, z +-24 clamp, the board turns away (pi / 16 = 0.19634954 rad per tick, bits 0x3e490fdb) from the wall it touches (also from record collisions, not from "QPIP"); a second sweep (0.6) stops it;
* half-pipes (records named `QPIP`): `onPipe`, the pipe's normal tilts Pepper's matrix (`alignTo`), in the air above a pipe the board slides along the pipe's right axis by
  `0.25 / forward.y` with a 10 degree per tick spin (`airSpin`), a steep wall (normal.y < 0.6) snaps the up vector to +-z (state machine case 0x20);
* the camera eases (0.1, in the air 0.8) to (0, 12, -14) in Pepper's frame, target 4 above him, eye clamped to +-37.9 / +-21.9.

### Stunts (FUN_0048e840)

`TRICKS` (20): Space (8), Ctrl (5), Shift (7) with the stick direction (left / right beyond +-30, none inside, up = the Up key) -> Pepper's clip, the board's clip, the progress rate
(2 / 4 / 8 per tick) and the sound. While the state is 0x20 and Pepper's clip is not the jump (0x20): progress (0 .. 127) grows while the inputs of the playing clip are held,
the clip frame is `frames * progress / 128` for both Pepper and the board, trick score += 15 (30 at 127). Released: the nine "decay" clips (0x68, 0x0a, 0x11, 0x0f, 0x52, 0x54, 0x5c,
0x60, 0x6c) fall by 2 x rate per tick, the others run on to 127. Landing (state 0x21): `trickMid == 0`: progress <= 100 passes; `trickMid == 1` (set while released with progress >= 100):
progress >= 100 passes; otherwise crash (state 0x23, stunt score lost, speed 0). A passed landing sets the trick flag, the clock node counts the score up.

Findings (original behaviour, kept):

* The "still held" test has two tautologies in the compare chains (0x48e8d0 for Space + Left = 0x67: the vertical test is `y < 30 || y > -30`; 0x48e911 for Space + Down = 0x6d: the
  horizontal test is `steer < 30 || steer > -30`): those stunts stay held whatever the stick does on the unchecked axis. Clip 0x5f (Shift + Right + Down) is only in the held test,
  nothing selects it.
* `FUN_0048f66d` case 0x21 resets `evaluated` at the end of the landing clip and judges again in the same call, so every landing but the first one of a run is judged when its
  landing clip (9 frames) ends, not on touch-down; a crash shows up to 9 ticks late.
* The clock does not run during the mount (clip 0x16, 60 ticks); the whole game is 3600 + ~190 (walk-in) + 60 ticks. A stunt still being counted when the time is up is lost
  (FUN_00493ecd gets only the counted total); the stunt score of the running stunt is zeroed when the time is 0.
* `DAT_05d580a4` is 1 in the park (FUN_00492ec0 sets it): the island's surface landing / rolling sounds are replaced by the single positional wheels loop; the landing sound table
  is not used. The park loads the cheer / boo sounds (0x1be .. 0x1c1) but no handler plays them.
* `FUN_0043b6a3` in the walk-in: the calls' arguments are in `calls.py` (Pepper 0x16 / board 1 / PEPPER_CONTROL 4).
* The trick names show for the clip only (FUN_0048d52b runs every frame in mode 2), also during the dead tick after a crash.
* The decompile drops the byte stores to `param_3` (the next state) in several functions (0x2d after the mount in case 0x16, ...): the state machine was ported from the asm
  (grep `[ebp + 0x10]` stores in 0x48f66d).

## 3. Game variables

| var | name | written |
|---|---|---|
| 0x5e | PEPPER_CONTROL | 1 at set-up, 4 when Pepper reaches the board (the clock node tests `== 4` exactly) |
| 0x8d | TROPHY_BPK | raised to 1 / 2 / 3 at the end of the game (never lowered) |
| 0xc0 | HISCORE_BPK | raised when the score is higher (`BPK1` on the banner) |

Success (`DAT_05d57fc4 == 1`) = the stored trophy is not 0, so a run without points still succeeds once a trophy exists. Result menu: success page 16, failed page 19; Continue ->
exit state 2 (`miniGameExit(true, true)`: the story advances when the zone is the story's, else PREV_SUBGAME), Abort -> 4, Retry -> 3 (the port re-runs the zone).

## 4. Differences / approximations

* **The board record is not hit by the skateboard's sweeps: SkBoard.col is loaded by the OTHER collision loader** (WP-VERIFY, resolved; was "UNCERTAIN why"). The zone loader (0x4a26df) reads `PEPP_HR.col`,
  `SkBoard.col` and the other character / part files with `FUN_0043f700`, which reads only the 28 byte header (centre, half extents, radius) and sets the polygon count to 0; only the
  scenery files (`Pipe3.col`, `SkatePark.col`, fences ...) use the full loader `FUN_0043f370`. `FUN_00441270` case 0 tests `*piVar4 != 0` polygons, so the board (and Pepper, the
  spectators) can never be hit: the port's old `withoutBoard` flag trick was an accidental equivalent (and wrong for the other records). Now: `src/game/colbounds.ts`
  (`boundsOnlyColPaths` finds the loader per file from the code, `applyBoundsOnly` swaps the records' objects), called by `prepareBpk`; the node no longer touches the board's flags.
  Evidence: the differential test (below) sweeps 1129 times from within 3.5 of the board: the original hits it 0 times, 505 times when the board is given the polygons of the full loader
  (that is the "lifts Pepper every tick" the old note saw; the ground sweep returns the board's bevel at +0.139 above its start and `rec.y = point.y` raises him by 1.3 per tick).
  The same applies to the island's `SBRD` (src/island/vehicles/skate.ts, gaps.md S5): its zone loader calls `FUN_0043f700` for `SkBoard.col` as well (not changed here).
* The gamepad (FUN_004376f9 pad values override the key ramp when beyond +-30) is not read.
* Music starts at zone entry, not after the intro screen (all zones of the port).
* `FUN_00444370` (record frustum flags), `FUN_00444850` etc. are the generic renderer's. The HUD texts the clock writes besides the score and the time (`DAT_05d4dfec` the stunt
  score) are not drawn by FUN_0046055f either (only `DAT_05d4dd20` / `dd44` / `dd60`).
* The zone sets up its own loop when restarted (FUN_004938e8 in place); the port re-enters the zone (exit state 3), which gives the same fresh state.
* x87 / float32: node fields are doubles with `Math.fround` at the places where an exact compare matters (speed vs maxSpeed).

## 5. Tests and how to run

```
node tools/test-formats.mjs --only m6-z01BPK -v       # 443 checks: EXE constants / tables / strings / sounds, set-up, walk-in, the board (walls, pipes, jump), all 20 stunts,
                                                      # landing judgement, score counting, clock, trophy rules, WIN (bot, gold, ~34 jumps), LOSS (no input), crash, spectators, loop exits
sh tools/m4-snapshot-server.sh 5611
node tools/browse.mjs "http://localhost:5611/?zone=z01BPK&mute=1" tools/steps/m6-z01BPK.mjs --size 1280x800 --out /tmp/m6-z01BPK
node tools/browse.mjs "http://localhost:5611/?zone=z01BPK&mute=1" tools/steps/m6-z01BPK-loss.mjs --size 1280x800 --out /tmp/m6-z01BPK
```
Browser win run (real key presses, ~2 x 12 ms latency, clock shortened after 24 s): intro -> walk -> bronze / silver 1500 .. 2500 points, banner (score, medal, "Hoogste score"),
result menu 16, Continue -> story node 2 (island). Loss run: pause page 18 (the clock stands still), time up without stunts -> result menu 19 at once (the banner is skipped), Retry
(attempt 1), Abort -> the front end (story node 1 rewinds to node 0).

Shortcuts: `?zone=z01BPK&mute=1` starts story node 1 (zone 1); `window.__zone.game.debug()` (state, score, clock, `snap` for the bot), `window.__zone.game.bpk` (the nodes).

## 6. Open questions

* (closed) whether the original's sweeps include the board record: they cannot, see section 4.
* The exact bounds of the camera clamp are from FUN_00490e2e's constants; the original's intro camera before the board is shown (the fixed eye at (0.25, 28, -22)) is as set by FUN_00493506.

## 7. Differential test (WP-VERIFY)

`node tools/test-formats.mjs --only m7-z01BPK-emu` (about 25 s, 12 million float / integer comparisons, 9300 compared ticks + 1560 sweeps + 288 spectator ticks); harness `tools/lib/m7-z01BPK-emu.mjs`.
The ORIGINAL code runs natively in the x86 emulation: the clock node `FUN_00493dd8` (+ `FUN_00493ba0`, `FUN_00493ecd`, sprintf of the HUD texts), the walk node `FUN_00494190` (+ the camera preset
`FUN_00422c7e`), the skateboard `FUN_00490e2e` with `FUN_004900d4`, `FUN_0048f66d`, `FUN_0048e840`, `FUN_00490cd2`, `FUN_00490af4`, `FUN_0048fece`, `FUN_0048fdea`, and the collision sweep
`FUN_00441270` (+ `FUN_00441a90`, `FUN_0043cd62` / `FUN_004425f0` / `FUN_00441b10`, the polygon tests) on collision objects built by the original loaders `FUN_0043f370` / `FUN_0043f700` from
the archive's `.col` files (which loader a file gets is read from the zone loader's code). Hosted: game variables, animation instances (act on the port's `AnimInstance`: the animation engine is not
the subject), sound calls (logged), file / heap functions of the loader, the gamepad (none), atan2. The constructors `FUN_00492cc2` / `FUN_00494091` / `FUN_004944f3` initialise the node blocks.
Every compared tick: the port's state is mirrored into the emulation (records at 0x68 bytes, node blocks at the original's offsets, the globals), the original's chain runs with its own return
codes (`ran` / stop), the world is restored and the port ticks; compared: which nodes ran, all 56 records (matrix, Euler of Pepper / board, flags), every node field (skate: 29 fields + pipe
speed / record, clock: 6, walk: 3), trick score / flag, mailbox, surface at the feet, camera, Pepper's and the board's clip / frame, all 319 game variables, the HUD texts, the sound calls in order.
Scenarios (seeded; all at dt = 1 AND dt = 0.5, the port runs both: the zone code reads `w.dt` everywhere): the walk-in and mount, walk-ins from random places / headings, random riding
(arrows, crouch jumps, random stunts, teleports onto the half-pipes), every one of the 20 stunts (crouch, jump, stunt held / released at progress 80 / to the landing: pass, crash), the clock and
the result (36 score / hi-score / trophy combinations, the score counting), 1560 random sweeps against `FUN_00441270`, the spectators of the zone loop (slice of `FUN_0048d8bd` 0x48db56 ..
0x48dd59), the camera of the set-up (slice of `FUN_00493506`), the stunt name of every clip / the banner / the brief text calls (`FUN_0048d52b`, `FUN_0048d3d1`, `FUN_0048d390`).
Visited (counted from the state): all skate states 0x16 0x2d 0x29 0x2a 0x2b 0x20 0x21 0x23, 3866 ticks on a half-pipe, 1518 with the pipe's air spin, 54 steep-wall snaps, 17 launches with v0 30, 48 crouch
jumps, 78 good landings, 3 crashes, all 20 stunt clips, x / z wall clamps, all three spectator branches, all four medals.

Found and fixed in the port (all in z01bpk, all verified by the test):
* the board record's sweeps (above): `src/game/colbounds.ts` (new), `setup.ts`; `skate.ts` lost `withoutBoard`;
* two constants were one float32 ulp off the .rdata (`0x8924ec` = 0x3e490fdb = pi / 16, `0x89252c` = 0x3f490fdb = pi / 4; the port had `f32(0.19635)` / `f32(0.785398)`), which flipped the wall-clamp turn once
  in a while (a tick where the board slid along the wall at exactly x = 39.9) and the walk's turning;
* the node's arithmetic keeps the original's float32 stores (positions, velocities, jump arc, charge, progress, the camera, `FUN_0043cec0`'s normalisation with its float32 `1 / sqrt`, the pipe
  alignment): `nx = f32(x + vx)` decides the wall clamp, `f32` matters at equality; the yaw matrix uses `src/formats/matrixf32.ts` (new: `FUN_0043a5e4` stores sin / cos as float32; `buildMatrix` does not);
* the board record copy no longer writes the Euler angles (the original copies the 12 matrix words only), `trickText` is the original's `"    "` when the stunt score is 0 (`0x8d2428`), the walk /
  spectators / clock use float32 stores.
Left (recorded, owner: whoever owns `src/game/collision.ts` / `src/formats/matrix.ts`): the collision sweeps are evaluated in doubles, the original stores float32 at every step: hit points / normals
differ by up to ~2e-6 relative (measured 1560 sweeps: point 0.29, normal 0.73 of the 5e-6 tolerance), which reaches the half-pipe matrices, `jumpY` and the camera (tolerance 2.5e-5); everything else is
bit-identical as float32 in these runs (8.5 million float comparisons, 5760 of the Pepper / board matrix elements on pipes differ). Sound 300 (`DAT_05d5802c`, the silent slot) is played by the original at
every launch off the ground (28 times), the port leaves the call out (nothing audible). The game loop's HUD text `DAT_05d4df1c` (16 blanks when the stunt score is 0) is not drawn.
The 0x5f clip is never selectable (the stunt table has no entry): confirmed by the 20 clips seen.


## WP-PART-WIRE / WP-MINI (2026-10-29)

* **Particles**: `FUN_00493506` only creates the engine (`FUN_00442900("GENERICBITS")`) and starts no emitter; the effects of the shared walker / skateboard code (`pizza`, `boatplume` ...) do not exist in this zone. Nothing to wire.
* **Collision**: the path-based `src/game/colbounds.ts` call (`applyBoundsOnly`) is gone from `prepareBpk`: the header-only slots of the loader (`FUN_0043f700`: PEPP_HR.col, SkBoard.col, ...) are stripped generically by `setupZone` (`applyHeaderOnlyCols`, slots read from the loader's code). The node tests load the zone with the executable (`tools/lib/bpk-load.mjs` passes `pe`, like the runner). S5 (why the board does not lift Pepper) is closed by it: `m6-z01BPK` 444 checks and `m7-z01BPK-emu` 12.2 M comparisons pass unchanged.
* **Unchanged**: restart re-enters the zone (equivalent to `FUN_004938e8` in place).
