# z10RGB "cannon duel" (the Bull castle, Cedric / "Simon") - M6 port

Zone table index 9 (sub-game id 9, `CURRENT_SUBGAME`), archive `z10RGB`, kind 4, story node 26 (entered from the castle hub z07CSI; a win goes on at node 27, back in z07CSI; a loss / abort
rewinds to the hub). Strings `CI/Data/rgb.str`, HUD textures `Overlays/Z10RGB`, music key `z10rgb` (`Z10RGB.sgt` + `Cedric.dls`), sounds `_data/sounds/z10RGB/*`.
Pepper has to cross a bridge while Cedric's nine cannons shoot at him, take one of four cannons on the far side, aim it and destroy Cedric's nine cannons; Cedric hops from cannon to cannon and
fires back; four hits on the player while he sits in a cannon end the game. Intro text `HOLOA` ("Ga over de brug, verover de kanonnen en vernietig de kanonnen van Simon.").

## 1. Files

| file | what |
|---|---|
| `src/zones/z10RGB.ts` | registers the five constructors (`registerCtor`), the zone game (`registerZoneGame('z10RGB')`): HUD gauge / score, intro / help ids, banner, speech, barrel overlay, listener, sound bank, test aids (`game.assist`) |
| `src/zones/z10rgb/consts.ts` | constructor addresses, record indices, variable ids, sound ids, clip numbers, `K` (the numbers of the code with their addresses), the hop table reader |
| `src/zones/z10rgb/shared.ts` | `RgbState` (the globals of the zone), `Ball`, `PepperCannon`, math helpers (`rotate`, `wrapPi`, `yawError`), `Lcg` (seeded random for tests) |
| `src/zones/z10rgb/balls.ts` | the ten-ball pool: alloc / release / launch / step / collide / update |
| `src/zones/z10rgb/pepper.ts` | `PepSwitcNode` (bridge, cannons, aiming, firing, camera of sub-game 9) and `PeppHitNode` (the knock-up) |
| `src/zones/z10rgb/enemy.ts` | `CannonNode` (the nine enemy cannons), `CedricNode`, the aim solver, `ballHit` |
| `src/zones/z10rgb/game.ts` | `RgbGameNode` (phases, score, blinking, flags, result), `initRgb` (the constructors' effects on the records, rigs, camera, variables) |
| `src/zones/z10rgb/sound.ts` | the sound slots by name (`SOUND_DEFS`), `SoundBank` |
| `src/zones/z10rgb/bot.ts` | the scripted player (route, flight model, aim plan, steering) used by the node tests and, through `game.assist`, by the browser steps |
| `tools/tests/m6-z10RGB.mjs` | node tests (`node tools/test-formats.mjs --only m6-z10RGB`, 381 checks, 2 s) |
| `tools/tests/m6-z10RGB-emu.mjs` | oracle test: the original's node code (pool, rgbgame, Cedric, 9 cannons, PepSwitc, PeppHit) run in the x86 interpreter next to the port with a replayed RNG, two scripted bot games (4000 + 3000 ticks), ~9.3 M comparisons (state, records, animations, sounds, speech), 0 differences |
| `tools/steps/m6-z10RGB.mjs`, `m6-z10RGB-loss.mjs` | headless browser runs: win (real key presses) and loss (pause menu, retry) |

Shared-file edits (additive): `src/zones/index.ts` (one import line), `docs/re/m6/progress.md` (the section of this zone). Nothing else outside the zone's own files.

## 2. Ported code (VAs of the NL build)

| address | function | port |
|---|---|---|
| 0x5f418b | zone loop `FUN_005f418b` | the runner's loop template (modes 7 / 0 / 1 / 9 / 2 / 3 / 4 / 5 / 8); zone parts in `z10RGB.ts`. Mode 1 = the intro panel with `HOLOA` at y 200 (`FUN_005f7872`), mode 9 = the help with 11 `CONTROLn` lines, mode 2 = play (balls, controllers, HUD), mode 4 = banner (the world keeps running), the result menu page 16 (won) / 19 (lost) |
| 0x5f6340 | reset: bridge point (-25.45, 12, -16.22), speed 6.4, 9 cannons, 4 lives, gravity 0.06, score 1000 | `RgbState` defaults, `K` |
| 0x5f6470 | the sound loads | `SOUND_DEFS` |
| 0x5f690b / 0x5f67e4 / 0x5f6a99 / 0x5f6bef / 0x5f6ca4 / 0x5f6d20 | zone set-up and the attaches | the set-up extraction (`registerCtor` for the five constructors); `initRgb` does the record / camera / variable effects |
| 0x5f77ad / 0x5f72c0 | `rgbgame` constructor / update (on LAND) | `RgbGameNode` |
| 0x5f78b6 / 0x5f798f / 0x5f7c3d | HUD text, win banner, loss banner | `syncHud`, `drawBanner` (`z10RGB.ts`) |
| 0x5f7cec | hi-score and trophy of a win | `RgbState.writeResult` |
| 0x5f7d8a | the 16 flags wave (`rand(0.5) + 0.75` per tick) | `RgbGameNode` |
| 0x5f4f14 / 0x5f49c5 | `PepSwitc` (zone copy) constructor / update | `PepSwitcNode`, `initPepperCannons` |
| 0x5f6017 / 0x5f554b / 0x5f542f / 0x5f56d9 / 0x5f6120 | nearest cannon / leave / cannon lost / aim / fire | `PepSwitcNode.nearestCannon / leaveCannon / cannonLost / aim / fire` |
| 0x5f4dd2 | the barrel overlay (texture 0 of `barrel/`, full screen, while the mode word is 4) | `draw2d` |
| 0x5f4d03 | PepSwitc "prerender": two probe rays whose results nothing reads (dead code, not ported) | `PepSwitcNode.prerender` carries the camera of sub-game 9 instead |
| 0x42d4b1 | the camera of sub-game 9 (called at the end of the walk update): eye and target move by Pepper's step (x, z) | `PepSwitcNode.prerender` |
| 0x61884d / 0x6186f2 / 0x618360 / 0x618612 / 0x618631 / 0x6186af | `PeppHit` | `PeppHitNode` |
| 0x619863 / 0x618ba6 | `cedric` constructor / update | `CedricNode` |
| 0x61a57f / 0x61a06a | `cannon` constructor / update | `CannonNode` |
| 0x619bb0 | something hit a record: Pepper / his cannon -> mode word 2 | `ballHit` |
| 0x619ec9 / 0x619c97 / 0x619dbf / 0x619c20 | aim decision, turn the barrel, aim on the side, the muzzle | `CannonNode.wantsToFire / aimNow / aimSide / placeMuzzle` |
| 0x5f87e1 / 0x5f89c9 | aim solver / quadratic | `solveShot`, `quadratic` |
| 0x5f8197 / 0x5f825a / 0x5f895d / 0x5f8a7b / 0x5f8291 / 0x5f8f91 | ball pool | `balls.ts` |
| 0x5f8050 | pool set-up (impact emitters) | `RgbState.bind` (emitters not ported) |
| 0x5f90f7 / 0x5f4e77 / 0x5f7709 / 0x61a705 / 0x61a753 | ball shadows, draw hooks, a registry of the cannons that nothing reads | not ported |

## 3. Records and variables

Records (index = byte offset / 0x68; the names are checked at run time, `RgbState.check`): 4 `LAND` (carries `rgbgame`, the ground record), 5..20 the sixteen flags `LFG0..` / `BFG0..` (rigs `LFLG` / `BFLG`, clip 1, advanced by the `rgbgame` update), 21 `BBFG`
(rig `BBFG`), 22 `CEDR` (Cedric, rig `MFIG`; clips 0xda wave, 0xd9 take-off, 0xb3 / 0xba the two hops), 23 `SBRD` (the skateboard, hidden by the walk code), 104..112 `CC00..CC08` (the nine enemy cannons, castle,
x -246 .. -284, y 37 .. 63), 113..122 `CB04 CB03 CB01 CB00 CB02 CB06 CB07 CB05 CB08 CB09` (the ten balls; pool index i = the record named `CB0i`), 123 `CSHD` (ball shadow model), 124 `BUNS` (castle, hit like the
ground), 135..138 `CP00..CP03` (the four cannons of the player, x -105 .. -90, box colliders), 145 `G091` (the invisible fence, flags 0x20), 146 `PEPP` (start (223.4, 13.9, 3.7), facing west).
Pepper's chain: `StubGuard` (the engine's safety net), `PepSwitc` (0x5f4f14, always), `SGwalk` (0x42f470, gate `0xfb & 1`), `PeppHit` (0x61884d, gate `0xfb & 2`).
Zone variables (SUBGAME 250 .. 254): `0xfa` the cannons fire (rgbgame constructor sets 1, the end of the game 0), `0xfb` the player's mode (1 walk, 2 hit, 4 in a cannon, 8 out of lives; it gates SGwalk / PeppHit), `0xfc` Cedric (gate; 0 when the last
cannon is gone), `0xfd` bit of the player's cannon last lost, `0xfe` bit of the enemy cannon last destroyed. Result variables: `HISCORE_RGB` 0x3b, `TROPHY_RGB` 0x23.

## 4. Phases and the loop (`DAT_05d5b338`)

0 init; 1 the bridge (set by the button of the intro); 2 the bridge is crossed (Pepper.x < -25.45, `PepSwitc`); 3 the cannon phase (set by the next `rgbgame` update, shot speed 4.0, gauge on, `CASGRB08`); 4 won; 5 lost.
Per tick of the play mode (the order of the original): the ball pool (`FUN_005f8f91`, before the controllers), then the nodes in record order (rgbgame (4), Cedric (22), the nine cannons (104..112), Pepper: StubGuard / PepSwitc /
SGwalk / PeppHit), then the camera / HUD. `DAT_05d5b29c != 0` (set by the `rgbgame` update in phases 4 / 5) moves the loop to the banner (mode 4); the world keeps running there (`tickInBanner`).
Phase 1: the score is `1000 - (ticks - base)` (clamped at 0), nothing else changes it before phase 3. The score is a signed short that the HUD function clamps at 0 every tick.

## 5. The player

**Walking** (SGwalk): fixed camera (sub-game 9): the controls are relative to the camera (Up = away from it), the eye starts 8 higher than the walk's default (`FUN_005f67e4`). Below `y = 4` while walking (the water) Pepper is put back
at the bridge point `(-25.45, 12, -16.22)` with the camera moved along; `y < 0` is clamped. There is an invisible fence (`G091`, polygon plane through the exit of the bridge at z -15 .. -18): the way on goes through the gap at z ~ -13 (the scripted
player's `ROUTE`).
**Entering a cannon** (phase 3, Ctrl pressed): the nearest of the four cannons that is still shown within squared distance 72 (3D) is taken, the camera is saved, the mode word becomes 4. **Aiming** (`FUN_005f56d9`): zoom 0.21, the cannon lifted to
y = 16, the first time the pitch jumps to rx = -0.3; keys: Left / Right `ry += / -= 0.0025` per tick, Up / Down `rx += / -= 0.0025` (limits 0.3 / -0.5); the matrix is built from `(-rx, -ry, 0)`; the camera sits in the barrel (eye (0, 3.878, 0),
target (0, 5.17, 3.209) in the cannon's frame); the HUD gauge shows the reload (0 .. 100), icon 4 while reloading, 7 / 5 blinking (bit 4 of the tick counter) when ready; loops: tilt, swivel, clock, bell when ready. Analog stick values of
`DAT_00983848 .. 50` (a gamepad axis) are not read (the engine maps the pad to the button bits).
**Firing** (Space): needs `timer == 0` and a free ball: the ball starts at the muzzle `(0, 4.8, 11.2)` with the launch vector `scale * (fx, 1, fz)` (`scale` 8 for the first shot of the program run, 6 afterwards: `DAT_0090bb84`, never reset) and the launch
angle `2.5 * rx + 0.8`; the reload is 100 ticks; Space while reloading plays the dry-fire click. Only the LAST ball the player fired is looked at: when it has hit one of the nine cannons (and that is still there) the cannon is hidden, the cannons left
-1, score +500, var 0xfe = 1 << k, the ball is given back at once. A second ball fired before the first has landed means the first one can no longer destroy anything (the original's behaviour; the lobs needed for the castle fly ~190 .. 270 ticks).
**Leaving** (Ctrl): the cannon is put back (matrix from the saved euler angles; the euler fields keep the aim), camera and zoom restored. **Hit inside** (the mode word becomes 2 while the previous tick had 4): leave the cannon, the cannon is hidden, lives -1,
score -1000, var 0xfd = bit; no life left: mode 8, phase 5.
**PeppHit** (mode word 2): clip 0x1a, `vy = 4`, -0.5 per tick, bounce -0.4 (the first tick already counts as falling, so the rise is 14 units); on the ground below 2.4 speed: clip 0x93, the bump sound (2D), `CASGRB06` the first time; 30 ticks later the clip
runs out (within 3 frames of its end), clip 0x1b, mode 1. `DAT_0090bc4c` (vulnerable) is 0 from the first tick of the hit; the `rgbgame` update blinks Pepper (hidden on the ticks with bit 2 of the tick counter) for 3 / (1/30) = 90 ticks, then it is 1 again.
Port-only: a hit over the water (no ground below: the original would fall for ever) puts Pepper back on the bridge point.

## 6. The enemy

**Cannon** (`cannon`, nine nodes, gate `0xfa & 1`): initial delay `ftol(rand(90))`, state 0 waits `ticks > delay`, state 1 tries to fire every tick, 2 recoil, 4 waits for its ball, 3 rest (delay 50). In phase 1 every cannon turns straight at a random point of the segment
Pepper -> bridge point (`T = (B - P) * rand(1) + P`), computes the two launch tangents (`solveShot`: `a t^2 + D t + (a - dy) = 0`, `a = -g D^2 / 2 s^2`, D = horizontal distance, dy = height difference, s = the shot speed 6.4), picks the lob or the flat one
at random (`ftol(rand(2.0))`) and fires if the pool has a free ball; in phase 3 only the cannon Cedric stands on fires, once, when he leaves it (flag `DAT_05d5b33c`), at the point Cedric chose, along the flat arc, without turning (`aimSide`). Recoil: the cannon moves by
the recoil velocity (0, 2, 0) rotated into the world, -0.5 per tick on the local y, bounce -0.4, forward 0.5, rest below 0.6 (the cannon01 / 02 emitters are not ported).
**Cedric** (`cedric`, gate `0xfc & 1`): starts on cannon 5, `+0xf4 = 30`. State 0 (on a cannon): first tick: clip 0xda, one of the two wave sounds, the aim point = the player's cannon (when the mode word is 4) or Pepper, +- 18 (`rand(36) - 18` per axis);
his cannon turns at most 0.001 rad per tick towards it; when it is aligned (error < 0.001) state 1; when the cannon he stands on is destroyed: `CASGRB09..14` in turn (only while cannons are left), +300 points, state 1. State 1: clip 0xd9 (the clip's frames = 60 ticks; 0 when his cannon is gone), then he
chooses: cannons left 0 -> phase 4, var 0xfc = 0; 1 -> the first one that is still there; else `ftol(rand(9)) % 9` until it is another one that is still there; he jumps with `vy0 = table[cur][next] / 2` (9 x 9 floats at 0x911f78), raised by 0.4 until `-g t^2 + vy0 t = dy` has a root; duration = the larger root,
horizontal speed = distance / duration, clip 0xda (<= 20 ticks), 0xba (z speed < 0) or 0xb3, rate = frames / duration; his old cannon fires when it is still there. State 3: the parabola `y = (vy0 - t g) t + perch.y`; on landing he stands at the perch (0, 5, 2) of the new cannon.
When Cedric is mid-hop at the moment the last cannon is destroyed he lands on the destroyed cannon and the win follows through state 0 -> 1.
**Balls** (10, shared): states 0 free / 1 reserved / 2 flying / 3 splash (50 ticks) / 4 done (parked at y -8000); the step is `cos a * dir` horizontally and `dir.y * sin a - t g` vertically (g = 0.06 per tick^2, t = ticks since the launch); every tick a backwards sweep of the last
step against all mask-2 polygons (cannons, castle ...) hides the ball and remembers the record, a ray one step ahead against LAND and BUNS puts it on the surface (hit = LAND); landing within 4 units of Pepper (squared 16) is a hit on Pepper (hit = Pepper), within 6 (squared 36) a near miss
(one of three 3D sounds by `rand(90)`, speech `CASGRB07`), only within the box |dx|, |dz| < 20 around him; below y = 0 it is in the sea (hit = LAND). The enemy cannon in state 4 reports a ball that hit Pepper (while vulnerable) or the player's own cannon (`ballHit`: the mode word becomes 2).

## 7. Result, medals, texts

Won (phase 4): the score (positive), the medal word `SGBRONZE` / `SGSILVER` / `SGGOLD` (STD.str) at y 150, silver from 4001, gold from 7001 (the code compares `> 4000` / `> 7000`), the lines `CASGRB01` (gold), `CASGRB02` + `CASGRB03` (silver, at y 200 and 320), `CASGRB04`
(bronze) at y 200, wrap 30; the score at y 100. Variables (only raised): `HISCORE_RGB = max`, `TROPHY_RGB = max(old, 1 / 2 / 3)` (bronze even for a tiny score). The story takes the win through `miniGameExit` (continue -> node 27).
Lost (phase 5): `CASGRB05` at y 100, no variables, page 19 (retry / quit). The original also writes `COMPLETE_SUB_GAME (0x53) = 1` at phases 4 and 5; the port does not (its runner checks the story FSM while playing, the original's loop does not: it would advance the story on a loss; `FUN_00404d14` does the
real work on exit either way).
HUD: the centre text is the score; the gauge (`FUN_00460214`, 12 segments with the textures 3 3 3 2 2 2 1 1 1 1 1 1, no marker): in phase 3 outside a cannon 0 .. 12 with the cannons left and icon 6 (Cedric's head), inside a cannon 0 .. 100 with the reload.
Intro `HOLOA`, help `CONTROL0..10`, speech lines by voice index 1136 .. 1150.

## 8. Sounds (ids of the sound table)

2D: wind loop 0x1a2 (every tick), crows 0x1a3 / 0x1a4 (1 % / 0.5 % of the ticks), cannon fire 0x18e, dry fire 0x18f, reload clock loop 0x190, ready bell 0x191, swivel loop 0x192, tilt loop 0x193, the bump when Pepper lands 0x1f5.
3D: Cedric's cannon 0x194 (when he is aligned), explosion 0x195, castle hit 0x196 (loaded, not played), ball landing 0x197 (ten slots, one per ball), ball whistle 0x198 (ball 0 only), Cedric's jumps 0x199 / 0x19a, waves 0x19b / 0x19c, cries 0x19d / 0x19e, sea 0x19f, wave crashes 0x1a0 / 0x1a1
(loaded, not played), near misses 0x1f2 / 0x1f3 / 0x1f4. The listener is the camera. Music starts with the zone (`audiohost`).

## 9. Not ported / approximations

* **Particles**: the emitters (`cannon01` / `cannon02` muzzle smoke, `impact01` splashes, `dust` at the player's cannons, `problow` at Cedric's hand, `cannonhit`, `swirl02`) are only reported to a `fx` hook; there is no particle runtime yet. The ball stays on the ground for its 50 splash ticks, which marks where it landed.
* **Ball shadows** (`FUN_005f8a7b` samples five ground points, `FUN_005f90f7` draws the model `CSHD` there) and the **underwater view plane** of the `rgbgame` draw hook (`FUN_00444500`) are not drawn (the camera is never below the water).
* The force feedback calls (`FUN_00438518`), the registry of the cannons (`FUN_0061a753`, nothing reads it) and `FUN_005f4d03` (dead probes) are left out.
* The random numbers come from `rand()` seeded by the clock in the original; the port draws uniform numbers (`RgbState.rand`, injectable; the tests use a seeded generator). `FUN_004388ae(x)` = `rand() / 32767 * x`, the port uses `[0, x)`.
* The analog aim axes (`DAT_00983848 .. 50`) are not read; the keyboard bits and the pad's d-pad bits are.
* `DAT_0090bb84` (the shot scale 8, then 6) is kept in a module variable (`shotScale`): like the original it stays at 6 over restarts of the zone within one program run.
* The port runs a fixed 30 Hz step (dt = 1); everything the original multiplies by the frame time uses `w.dt`.
* The harsh enemy: with a seeded generator the scripted idle player loses four lives in ~6000 ticks (one hit about every 700 ticks; Cedric fires every ~150 ticks, a quarter of the shots hit the player's cannon: the flat arc comes in low, so the ball also hits the cannon's
  box before it lands). This is what the code does; nothing was tuned.
* The scripted WIN (seed 4: 2956 ticks, score 4790, silver) needs all nine cannons destroyed with the flight model of the ball and a bot that waits for the previous ball to land (see 5).

## 10. Tests, runs

`node tools/test-formats.mjs --only m6-z10RGB` (381 checks): the constructor attaches and gates against the set-up, record names, floats at their addresses (.rdata / .data), immediates inside the functions (the reset, the cannon constructor, the aim and fire code, the banner and the result thresholds, the
variable ids), the sound table names and the ids `FUN_005f6470` loads, the texts and voice indices, the maths (`quadratic`, `solveShot` against the flight, `wrapPi`), the ball pool (alloc order, the step formula, the splash length, the hit / near-miss radii, the sea, the sweep against a cannon), the bridge (score per tick, the fall, the
phases), entering / aiming / firing / reloading / leaving a cannon with the exact steps, a kill, a hit inside (lives, score, mode 8 -> phase 5), PeppHit (rise, landing, lying time, blinking = 90 ticks, the port's water guard), the cannons in phase 1 (heading between Pepper and the bridge point, launch vector, recoil, states), Cedric (waves,
perch, 0.001 turn, 60 tick take-off, the parabola, the hop table, +300 and the taunts, one cannon left, none left), the result variables, the camera of sub-game 9, a scripted **WIN** (bot, seed 4) and a scripted **LOSS** (idle in a cannon, seed 3), determinism.
Browser (headless, muted; port 5606 serves a snapshot): `node tools/browse.mjs "http://localhost:5606/?zone=z10RGB&mute=1" tools/steps/m6-z10RGB.mjs --size 1280x800 --out /tmp/m6-z10RGB` (intro, help, a bot with real key presses crosses the bridge, takes a cannon, aims, fires and destroys one cannon, the rest is removed through the
page (`NOSHORT=1` plays all nine), banner, variables, result menu page 16, continue -> story node 27); `m6-z10RGB-loss.mjs` (pause menu page 18, a lost game, banner, result menu page 19, retry restarts with a clean state).
Last results: win run score 5423 (silver, `HISCORE_RGB` 5423, `TROPHY_RGB` 2), continue -> `z07CSI` at node 27; loss run: pause page 18 (the tick counter stands still), phase 5 after the last hit, banner `CASGRB05`, page 19, retry: phase 0 / score 1000 / four lives.
Screenshots looked at: intro panel (`HOLOA`), the help with 11 key lines, the bridge with the cannons beyond and the HUD gauge (9 of 12 segments, Cedric's icon, the subtitle `Hmm, kanonnen. Handig.`), the aiming view (the barrel overlay, zoom 0.21, the cannon icon, the score), the castle with its nine cannons and Cedric
in the air, the near-miss subtitle, the win banner (score, `ZILVER!`, `CASGRB02` / `CASGRB03`), the loss banner.

## Shortcuts

* `?zone=z10RGB` starts the zone at its story node (26, sub-game 9).
* `window.__zone.game.debug()` returns `{ phase, score, ticks, mode, cannonsLeft, lives, inCannon, cedricAt, resultMode, vulnerable, balls[10], fov, pepper, timers[4] }`; `window.__zone.game.assist.state` is the `RgbState` (cannons, enemy, balls, perches, hud ...) and
  `assist.route / steer / nextTarget / plan / aim` are the scripted player's decisions. Keys: arrows / WASD walk and aim, Ctrl enter / leave a cannon, Space fire, Alt jump.


## Oracle test findings (m6-z10RGB-emu)

Differences it found and fixed in the port: balls start free (not parked), Cedric starts with no perch (`cedricAt` -1), cannon rest heights, the hit flight compares single floats (ground vs. record y), the ball velocity is stored as single floats, and a ball that falls into the sea plays its landing sound at the original's uninitialised point (`0xcccccccc` floats, inaudible). The sea edge SEAE is made non-solid by SeaAmin (src/island/ambient/misc.ts); the oracle applies that flag too.
