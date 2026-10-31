# z08BKD "Brick Dive" (castle island mini-game, M6)

The diver Pepper swims in a 2.5D cut-out (everything lives in the plane z = 10, a side camera follows him) and brings five bridge bricks (BRK1..5) up to the surface within
500 seconds of "oxygen". Hazards: a shark, two swordfish, six manta rays (electric shock), a dolphin (harmless, jumps for every brick delivered), an octopus with a sweeping
tentacle, a clam that closes on the diver, a cannon with ten balls, a swinging anchor, three pirate skeletons (they wake up when the LAST brick is taken). A page (PAG5) lies
in a side cave (+1000 points, `GOT_PAGE`). The game has no PEPP walk rig: record 5 `PEPP` is the swimmer and gets the zone's own node chain.

Code: `src/zones/z08BKD.ts` (constructor registration, `registerZoneGame`), `src/zones/z08bkd/*`, bot `tools/lib/bkd-bot.mjs`, test `tools/tests/m6-z08BKD.mjs`,
browser steps `tools/steps/m6-z08BKD.mjs` (win) / `m6-z08BKD-loss.mjs` (loss, pause, retry, abort).

## Files

| file | contents |
|---|---|
| `z08BKD.ts` | `registerCtor` for the 12 constructors of FUN_005b9430 (0x5be9f0 anchor, 0x5bfad5 page, 0x5c01e8 brick, 0x5bd2b1 cannon, 0x5bcd17 ball, 0x5be08a clam, 0x5be5e0 octopus, 0x5bd8b4 pirate, 0x5bc592 fish, 0x5bf7ce dolphin, 0x5c23f9 diver, 0x5c06d7 camera); `registerZoneGame('z08BKD')` |
| `z08bkd/consts.ts` | every float / immediate of the zone as a named constant with its address (`FLOAT_ADDRS` is checked against the EXE by the test), record indices, sound ids, hurt templates, camera table address |
| `z08bkd/math.ts` | `wrapAngle` FUN_005bb164, `angleDelta` FUN_005bb05d, `rotateShape` FUN_005ba8b0, `segmentSphere` FUN_0043d159, `ZoneClock` FUN_005baf8f / 005baffd, `Rng` (FUN_004388ae on the shared CRT generator `src/game/crt.ts`, WP-TIME) |
| `z08bkd/graph.ts` | waypoint graph FUN_005bb2da of `W_OTH_C.wpt` (69 nodes): `adjacent` FUN_004639a7, tag lookups FUN_005bb867 / 919 / 9eb, loops FUN_005bb600, route search FUN_005bb588 / 3b0 |
| `z08bkd/hurt.ts` | hurt zones FUN_005ba570 (register), FUN_005ba5d7 (move), FUN_005ba745 (test the diver's quad edges against the spheres) |
| `z08bkd/physics.ts` | `castQuad` FUN_005ba9a7, `bounce` FUN_005bc194, `swingPush` FUN_005be690 / 005be130, `hitSpin` FUN_005c188e |
| `z08bkd/state.ts` | zone state (DAT_05d5897c ..): oxygen clock, bricks, page, HUD tints / gauge FUN_005b92d3, delivery FUN_005b903b, end test FUN_005b8fa4, score FUN_005b7f60 |
| `z08bkd/bodies.ts` | anchor, page, bricks, cannon + balls, clam, octopus, pirates |
| `z08bkd/swimmers.ts` | fish (shark, swordfish, mantas) FUN_005bc592 + steering FUN_005bbd62, dolphin FUN_005bf7ce / 005bea80 |
| `z08bkd/diver.ts` | diver FUN_005c23f9 / FUN_005c0888 (all of it, with its helpers FUN_005c1b21 .. 005c21ea), camera FUN_005c06d7 / 005c03f0 |
| `z08bkd/run.ts` | `prepareBkd(world, archive, scene)`: record check, node binding in constructor order, rigs / start clips, sounds, per-tick `beforeTick` / `afterTick`, `snapshot(run)` |
| `z08bkd/game.ts` | the zone game for `playzone.ts`: brief (CASGBD13 y 50 + CASGBD14 y 200), help (5 `CONTROLn` lines), HUD, listener, banner, variables (`finish`) |

## The set-up (what `setupZone` gives and what the zone does with it)

* `setupZone` adds the island walk chain to record 5; `prepareBkd` strips the controller to the zone's own nodes (`SwimBeh`, `CamBeh`) and binds every node to the shared `Env`
  in the order the constructors ran (`track()` counts the calls). Records are addressed by index (offset / 0x68): PEPP 5, SKEL 6 (the electrified skeleton: shown while shocked),
  SHRK 2, DLPH 3, MANT [4, 7..11], SORD 16, SOR1 42, pirates [21, 22, 24], OCTO 25, tentacle OCTC 69, OCTH 72, bricks [51, 89..92], bridge pieces BRT 83..87 (hidden until delivered),
  clam CTOP 52 / CBOT 53, anchor 54, cannon CBAR 57 + balls [67, 56, 59..66], page 82, land 1.
* Rigs / start clips (FUN_005ca0a5 + FUN_0043b4e2): animated records start clip 1 at frame 0; the 20 plants start at their own frames and advance 0.5 frames per tick (FUN_005b8ac0).
* The part bank (`scene.models` with array `g983838+44`, 9 models: 3 = brick in the hand, 4 = the skeleton's spark part, 8 = left hand) is attached to bones of the diver with
  `GameRenderer.setAttach` (shared file, see below).

## Physics and rules (all ported from the decompile)

* Diver: heading, angular velocity (turn gain 4.7124, drag -2: terminal 2.356 rad/s), thrust 24 along (-sin h, cos h), drag -2 (terminal speed 12 u/s), surface clamp at y 86.5
  (`C.SURFACE_Y`), start (0, 82.5, 10). Two collision shapes (small 2 x 4, tall 2 x 7 with a brick); the new quad is cast against land, anchor, octopus parts, clam, bricks, balls, page, cannon;
  a blocked move restores the last free place (`safe`); at the surface a carried brick is delivered (BRT piece appears, dolphin told 1/1/2/1/2, speech CASGBD08..12).
* Hurt: shark / swordfish drop the brick and knock him back (20, -2: the original reads the diver's own constant table); a manta does the same plus a 2 s shock (skeleton view,
  flicker, CASGBD05, no control); a pirate only while slashing, then he rests 10 s; anchor and tentacle push by their swing speed; a cannon ball pushes with its velocity.
* Bricks: a dropped brick falls back into the water and cannot be taken again for 4 s; taking the 5th brick wakes the pirates (engage within 10, slash a diver with a brick within 16).
* Clam: opens to -0.785 rad, waits 4 s, closes; the diver inside is held for 4 s (BRK1 lies in it). Octopus: tentacle rz 0 .. -1.2217, period ~405 ticks; BRK5 is at the bottom of a pocket under it.
* Cannon: counts 1 s (first) / 8 s (then) while the diver is within 40 units and to its right, aims at him (clamped arc), fires a ball (speed 10, gravity 4, 20 s life, bounces).
* Oxygen: `percent = 100 - elapsed / 500 * 100`, the end test is `0 <= percent` false or five bricks; CASGBD07 at half. Score = `ftol(percent) * 0xb3 (+1000 page)`, clamped 0..10000;
  bronze < 6000 <= silver < 9000 <= gold; hi-score 0x2f and trophy 0x3d written when the score beats the hi-score (a failed game writes only the hi-score).
* Camera: `cameraFor` interpolates eye height / target height / distance from the table at 0x9038e8 by the diver's depth, with a parallax of 15 * x / 40.
* Sounds: 26 ids (0x30..0x4a, 0x334) loaded like FUN_005cd0d0 (2D / 3D by the call), listener = the camera target. Music Z08BKD1 (shared zone music table).

## Quirks kept

* The knock-back is a constant (20, -2); `hitSpin` takes an uninitialised normal in the original (+-pi/2 by an undefined sign: we use the sign of the dot product);
  the skeleton / ZRRTZZ part toggles; the half-air line; `CONTROL4` shows raw in the help (the loop asks for five rows, the table has four: the original does the same).
* The page-flash test `ftol(t) & 0x10` never fires for 0..4 s: the icon just lights up.
* Fish positions depend only on the tick (no random choice after set-up): that is what lets the bot know where each creature will be (see Bot).

## Bot (`tools/lib/bkd-bot.mjs`)

A grid planner (heading-aware A*) over the scenery as the diver's quad sees it, a key law with the diver's own physics, and a 3 s forward simulation per tick against the creatures'
recorded paths (a copy of the zone is run with an idle diver; fish are a function of the tick), the swinging anchor (blocked cells per swing angle), cannon balls in flight and the
cannon's next shot, pirates once awake. BRK5 is taken with a timed manoeuvre: wait above the pocket, dive through the neck while the tentacle is away, take the brick, turn, wait,
leave in the next free window. Seed 1: all five bricks in 12224 ticks (407.5 s), score 3222 (bronze).

## Approximations / not ported

* The bubble particles (`bubble01.par`, the diver's exhaust) are not drawn: there is no particle renderer in the port.
* Music starts at zone entry (shared behaviour), not at the loop start.
* The matrix lag of the original (records are drawn with last frame's matrix) is not reproduced; the listener uses the camera target of the same frame.
* The hurt template numbers come from the immediate stores of FUN_005ba32c; the shark's three spheres are used for the swordfish too (the original registers the same template).
* No analogue stick (shared input layer).

## Tests

`node tools/test-formats.mjs --only m6-z08BKD`: constants and immediates against the EXE, hurt templates, sound ids and names, strings, set-up (36 attaches, record table, node chain, rigs),
helpers, graph, diver physics, brick lifecycle, every creature, camera, oxygen / score / medals / variables, a scripted LOSS (no input: 500 s), a scripted WIN (the bot). Browser: see above.

## Differential test (WP-VERIFY)

`node tools/test-formats.mjs --only m7-z08BKD-emu` (`tools/tests/m7-z08BKD-emu.mjs`, harness `tools/lib/m7-z08BKD-emu.mjs`, about 14 s; `BKD_FUZZ=N` adds N random-state scenarios, 60 gives 10.3M checks in 69 s). The original's own builder `FUN_005b9430` (real attach `FUN_00423532`, controllers `FUN_0042382c`, constructors, waypoint loader `FUN_004630c0`) and the real per-frame order (`FUN_005baf8f`, `FUN_005ba5d7`, `FUN_0042226e` with the node update functions, `FUN_005b8d97`, `FUN_005b92d3`) run natively in the emulator; anims, the collision ray (`FUN_00441b10`, onto the port's `CollisionWorld`), sounds, speech and rand are hosted. **The x87 runs in 24-bit precision** (Direct3D 7, control word 0x7f; the harness sets `cpu.cw = 0x7f`, override `M7_CW`): every +, -, *, / and sqrt rounds to float32, so the port rounds every single operation (`src/zones/common/f32.ts`), in the asm's order; `asin` is the CRT's (`0x85e7b4`: `fpatan(x, sqrt((1+x)(1-x)))` with the sqrt argument rounded: `asin24`), sin / cos / atan2 stay double until the next operation. Compared with tolerance 0 (bit for bit): all node fields per kind (fish, ball, cannon, pirate, clam, octopus, anchor, dolphin, page, brick, camera, diver), record matrices and flags, anims, HUD / score / bricks, the merged chronological sound / speech / attach log.

* 1.65M checks by default (plus the whole 500 s without input, 15000 ticks, sampled): 51 float literals of the zone code against the EXE (0 differ); the set-up (35 controllers, 36 nodes, 120 static blocks incl. fish loops, shapes, links, hurt templates, 69 graph nodes); function-level unit tests (wrapAngle, angleDelta, normalize3, rotateShape, segmentSphere, bounce, swingPush, hitSpin, cameraFor, ZoneClock.pick, clam inside / touch, Euler / transform / rotate, hurt update / test, graph lookups); the banner `FUN_005b7f60` and end tests over 780 end states; scenarios at dt 1 and dt 0.5: the recorded bot dive (`tools/lib/bkd-bot.mjs`, 7500 ticks), random keys, random-state injection. Coverage of node kinds and branches is asserted.
* Fixed in the port: depth sounds (shallow band 0..86.5 plays WATER_SHALLOW and stops MID; below -100 WATER_DEEP) and the flipper sounds (left / right were swapped); five inexact float32 constants in `consts.ts`; dt (the zone clock, breath, wave rng, thresholds, all anim advances) was hardcoded 1; the PCOL record lacked flag 0x20; cannon and pirate wrote Euler fields the original does not; hurt template decimals are float32; many float32 rounding steps and operation orders (`diver.ts`, `bodies.ts`, `swimmers.ts`, `physics.ts`, `math.ts`, `state.ts`, `hurt.ts`); new `matrix.ts` / `src/zones/common/matrix.ts` with the exact `FUN_0043a5e4` / `0043ab72` / `0043abe6`.
* Wrong or outdated in this doc: the bot result (seed 1, 12224 ticks, 3222) is now: the bot (a test aid) delivers 4 bricks by real play and the last one lies in a pocket it cannot enter with the exact collision; `m6-z08BKD` fetches it by script; the depth / flipper sound naming; the time step is dt (the zone clock now uses it). Fish loop fractions past the last segment leave the original's outputs unwritten (no shipped fraction does that).
* Recorded: the shared `buildMatrix` (`src/formats/matrix.ts`) differs from `FUN_0043a5e4` by one float32 unit in about 18% of elements (1150 of 6400 in the test); the zone uses its exact version. Not covered: rendering.

## WP-PART-WIRE / WP-MINI (2026-10-29)

* **Particles**: `FUN_005c23f9` (diver ctor) starts `bubble01` on the diver record (5) live matrix at (0, 4, 0), rotation (0, -pi, 0), gate (2,1,1) = always on, collision records 1, 93 (PCOL, flags |= 0x20 already in `DiverNode.bind`) and 52, in that order (`z08bkd/game.ts`, `BUBBLE` in consts). Screenshot: bubbles rise from the diver's head.
* **Abort node**: abort (pause menu or result page 19) rewinds the story to node 17 (z07CSI hub) and z07CSI runs next; checked in `tools/steps/m6-z08BKD-loss.mjs` (the old check `node <= start` was vacuous; in the `?zone=` dev entry the castle then advances the story back to the dive because node 17's variable is satisfied, so the rewind is watched while it happens). The generic path is verified against the original by `m7-shell-story`.
* **Matrix lag**: not reproducible: the original loop order is clock, hurt move, node update, listener / `FUN_00444370` after the update, draw; `m7-z08BKD-emu` compares every record matrix per frame bit for bit. Only the renderer's tick interpolation (all zones) differs.
* Browser win step (`tools/steps/m6-z08BKD.mjs`): after the zone's float32 exactness the bot's coarse grid can no longer enter the pocket of the last brick (the node test already says so and fetches it by script); the step now does the same at the same point (4 bricks, > 7000 ticks): the diver is put at the brick and picks it up through the node's own pickup, everything after (delivery, banner, variables, result menu, Continue to z07CSI node 19) is real play. Run: ALL OK, score 9487, gold.
