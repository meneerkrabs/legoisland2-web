# z15SSH "Slangen schieten" (Snake Shooting, Adventure Island) - M6 port

Zone table index 12 (sub-game id 12, kind 2, archive `z15SSH`), story node 35 (entered from the oasis hub z14OSD, node 34; after a win the story goes on at node 36 = the pyramid hub
z16PYA, after a loss / abort it rewinds to node 34). Music key `z15ssh` (`AdvRace.sgt`, `ZONE_MUSIC`), strings `AI/Data/ssh.str`, HUD textures `Overlays/z15ssh` (0 = the crosshair,
1 = the red gem), fog `FUN_00442d90(4, 400, 400, 400, 0xffaaaaff, 1)`.
Johnny Thunder and Pippin Reed ride a buggy through the desert canyon with 20 gems; three snakes (cobras) catch up from behind and jump on the buggy to steal a gem each. The player
(Pepper, the gunner at the rear turret) only aims the turret (arrow keys) and fires coconuts (Space). The buggy drives itself along a path (`CARBUT.man`), about 5050 ticks
(170 s) from z = -190 to z = 7000. Score = 50 per snake hit; at the end 250 per gem left (cap 10000); medals by gems left: 18..20 gold, 12..17 silver, 1..11 bronze, none left = lost.

## 1. Files

| file | what |
|---|---|
| `src/zones/z15ssh/rules.ts` | the two nodes (`CartNode` = `Walk`, `SnakeNode` = `Snake`), constants with their EXE addresses, results / banner lines / variables, the path helpers `placeOnPath` / `orientOnPath`. Pure TypeScript, no DOM |
| `src/zones/z15ssh/spline.ts` | the engine's "path" object: uniform cubic B-spline through a `.man`, frame evaluation (vtable[1] `0x4466f0`), nearest-point projection (`FUN_00447550`) |
| `src/zones/z15ssh/parts.ts` | the mesh's sub-object matrices (`FUN_0043ea60(rec + 4, i)`: the wheels and the turret of the buggy) for the renderer, matrix helpers |
| `src/zones/z15ssh/setup.ts` | `prepareSsh`: paths, rigs, constructor work, coconut helper records, intro camera |
| `src/zones/z15SSH.ts` | `registerCtor` of the two constructors, `registerZoneGame('z15SSH')`: HUD, crosshair, intro / banner texts, speech, sounds (`SshAudio`), result variables |
| `tools/tests/m6-z15SSH.mjs` | node tests (`node tools/test-formats.mjs --only m6-z15SSH`, 257 checks, ~4 s) |
| `tools/lib/ssh-bot.mjs` | the aiming bot of the tests |
| `tools/steps/m6-z15SSH.mjs`, `-loss.mjs` | headless browser runs (section 9) |

Shared files touched (small, additive): `src/zones/index.ts` (one import line), `src/game/render.ts` (`GameRenderer.poseRange`, default 150 as before: the distance within which animated records are
posed every frame; this zone sets 500 so the snakes slither from far away, 2 lines).

## 2. Ported code (addresses of the NL build)

| address | function | port |
|---|---|---|
| 0x656372 | zone loop `FUN_00656372` | runner loop template (`playzone.ts`): mode 7 fade in (fog), mode 0 = the intro (`ADSGSS14` at (320, 120) wrap 30, spoken at the start), 9 help (`FUN_00461155(table, 5)` = 5 `CONTROLn` lines: UP / DOWN / LEFT / RIGHT / `BUTTON_4` fire), leaving it speaks `ADSGSS07` and starts the music, 2 play (`FUN_00658834` HUD), 3 pause (18), 4 banner, 5 result menu (`(result < 3) + 1` = page 16 / 19), 8 fade out; exit `FUN_00404d14(&next, exit == 2, 2 < result)` |
| 0x65760c | init `FUN_0065760c` | font `bknw`, strings `ssh.str`, overlay set, `FUN_0066f47d` (loader: meshes, rigs `MFIG` / `SNK1`, collision), ground record LAND, music `z15ssh`, attaches `FUN_00657460` |
| 0x657460 | attaches | `Walk` (0x659d94) on PEPP (22), `Snake` (0x65a3c3) on SNK1..3 (4, 5, 6), the sky node on SSKY, records 11 / 12 / 21 / 37 hidden |
| 0x659d94 | `Walk` constructor | the six paths, start places, clips, initial values: `CartNode.bind` |
| 0x658c16 | `Walk` update | `CartNode.update` (sections below) |
| 0x657a30 | the snakes | `CartNode.updateSnakes` |
| 0x65866f / 0x6582de | fire / coconut update | `fire` / `updateCoconuts` |
| 0x657860 | the Brickbot carts | `updateCarts` |
| 0x65888a | sounds of the ride | `engineSounds` |
| 0x65817c | crosshair | `crosshair()` (drawn by the game's `draw2d`) |
| 0x659b77 | draw hook (default draw, coconuts at scale 1.5, crosshair) | helper records for the coconuts, `cocoMatrix` |
| 0x65a3c3 / 0x65a2e0 / 0x65a314 | `Snake` node: constructor / update (returns 1) / draw (scale 0.75) | `SnakeNode`; the scale is applied to the snake's matrix rows |
| 0x65a470 | sounds | `SND`, `SOUNDS_2D` / `SOUNDS_3D` |
| 0x65a5c0 / 0x66f47d | builder / loader | read by `extractZone` (285 records) |
| 0x4466f0, 0x447280, 0x447550, 0x445680, 0x447bf0, 0x447800, 0x4476b0 | path objects (GSMS) | `spline.ts`, `placeOnPath`, `orientOnPath` |

## 3. Records (index = the byte offset the code uses / 0x68)

0 `SSKY`, 1 `LAND` (ground), 2 `PIPP` (Pippin, MFIG rig), 3 `JOHN` (Johnny, MFIG), 4-6 `SNK1`..`SNK3` (snake.msh, rig `SNK1.blk`: clip 1 hit 13 frames, 2 attack 45, 3 slither 16), 7-9 `BBT2`/`BBT1`/`BBT0`
(Brickbots, MFIG), 22 `PEPP` (the buggy, `PEPP.msh` with 8 MATL parts: 0-3 wheels, 4 the turret, 5 / 6 the seats of Pippin / Johnny), 23-25 `CRT1..3` (the Brickbots' carts, 6 parts, part 5 = the seat), 37 `G149` (the
fountain's place), 41 `COCO` (the coconut shape; the zone draws 15 flying coconuts with it), 20 `MFIG` (unused), many `Gnnn` scenery records. The names are checked at run time (`checkRecords`).

## 4. The buggy (`Walk`, `FUN_00658c16`)

State (node offset): speed `+0x34`, top speed `+0x3c` = 0.12 (`0x3df5c28f`), wheel angle `+0x24`, turret yaw `+0x28` / pitch `+0x2c`, heading `+0x18`, eased heading `+0x1c`, its rate `+0x20`, `|yaw|` of the last tick
`+0x30`, score `+0x40`, gems `+0x48` (20), snake timers `+0x4c`, snake states `+0x58`, coconuts at `+0x64` (15 x 0x54), time `+0x57c`, reload `+0x580`, Pippin flinch `+0x584`, saved snake places `+0x558`, sound stage `+0x598`.
Per tick (30 Hz, `dt` = 1):
1. The wheels: `+0x24 += 0.05236 * speed` **once per wheel inside the loop** (four adds; the wheels show 1x..4x of it), part i = `Euler(wheel, 0, 0)` at its translation.
2. `FUN_00447800(rec)` (the end flag of the CARBUT path: the second nearest control point in the last three) or `z > 7000`: the ride is over: the wind layer is set to its base rate, the speed falls 0.005 per tick, at 0 the result is
   computed **when all three snakes are idle**, else 0 (a snake that still runs keeps attacking the standing buggy). Otherwise the engine sounds (`FUN_0065888a`) and the speed rises 0.005 per tick to the top speed.
3. The turret: LEFT / RIGHT held change yaw by -/+ 0.0349 (2 degrees) with the swivel sound, UP / DOWN pitch by +/- 0.0349 with the tilt sound (the swivel stops); no key: both sounds stop. Limits: pitch -0.5236 .. +0.43633, yaw +-1.0472.
4. The snakes (section 5), the HUD copy (`FUN_00658818`), part 4 = `Euler(pitch, yaw, 0)`, fire when Space went down (`DAT_00983840 & 0x80`), the coconuts (section 6).
5. `FUN_00447bf0(rec, CARBUT)`: the record's rotation = the curve's frame at the point nearest to it (right = normalise(Fz, 0, -Fx), up = right x forward, forward = the normalised tangent), yaw `+0x50` = atan2(fx, fz), pitch `+0x4c` = atan2(-fy, hypot(fx, fz)).
6. The three Brickbot carts (section 7), then the move: `pos += (0, 0, 8) rotated by the yaw * speed * 8 * 0.2` (1.536 per tick at top speed; the buggy follows the path's *heading* only, it is not snapped to it),
   the ground: probe from y + 15 (+2 above it, `FUN_0043ce45`), else from y with 80, a rise above 0.8 is probed again from y; the eased yaw `+0x1c += (yaw - eased) / 8` (the rate is only recomputed while they differ).
7. The camera (`DAT_009da5e8`): target = the buggy - 16 along the eased heading, eye = target + 32 along it (so 16 **ahead** of the buggy, looking back) and 5 above the buggy, `FUN_00422ddc` (at least 6.4 above the buggy, -0.8 per tick when more than 32 above),
   at least ground + 4 below it, then + 6.
8. The crew: Johnny (part 6) and Pippin (part 5) get the buggy's matrix and their seat position (`FUN_0043ab72(M, part translation)`); Pippin's clip 3 runs to frame 18 when `(yaw - eased yaw) * 4` leaves +-0.6 (flinch), Johnny's clip 1 is
   positioned at `(frames - 1) / 2 * (1 + v)` with `v` that value clamped to +-1 (he leans in the curves); the Brickbots sit on their carts (part 5) and advance their clip.

## 5. The snakes (`FUN_00657a30`)

`limit = 3 * (10 - (variant >> 16) / 100)` of the buggy record (variant 0: 30 ticks; no `+0x64` write exists in the builder). Per snake i (record 4 + i, path CARBUT / SNAKEPOSL / SNAKEPOSR, lateral offsets 0 / -2.4 / +2.4):
* start: the snakes wait at their path starts (CARBUT t 0.001, SNAKEPOSL 0.003, SNAKEPOSR 0): about 165 behind the buggy (the ride starts at CARBUT t 0.02 = z -189.7).
* **idle (0)**: hidden; while the buggy is not at the end of the path and z < 7000 the timer `+0x4c + 4i` counts +1 per tick; above the limit: state RUN, clip 3 (slither) from a random frame 0..9.
* **run (1)** (shown): `FUN_00447bf0(snake, its path)`, `pos += heading * (speed + 0.1) * 12.8` (2.8 per tick, the buggy 1.5), clip advance, the move sound (3D); when `buggy.z - snake.z < 24`: clip 2, the place is saved,
  the move sound stops, the jump sound, state ATTACK.
* **attack (3)**: homes onto the buggy (`d / frame` per tick towards buggy.x + offset, buggy.z: the closer the later in the clip), yaw towards it, clip advance; at the clip end (45 frames) the snake takes a gem when its timer is 0 and gems > 0
  (gem sound, gems - 1, 3 / 13 chance of `JOHNA` / `JOHNC` / `ADSGSS10`), is put back where it jumped and goes idle (timer 0, hidden).
* **hit (2)**: clip 1 (13 frames), then idle, timer 0.
* every tick: y = terrain below (probe 8 above), else the integer part of the old y. The snakes are drawn at scale 0.75 (`FUN_004440d0(&0x91c8d8)`, applied to the matrix rows).
A snake in state IDLE waits 30 ticks, runs back (about 110 ticks when it was hit far away), jumps. A hit snake keeps its place: only a hit **while leaping** (timer 1: nothing is stolen) or a coconut that starts inside it protects a gem.

## 6. Coconuts (`FUN_0065866f`, `FUN_006582de`)

Fire (Space edge, reload counter 0): the first inactive of 15, gun sound (stop + play), reload 1, `gun = part4 * rec matrix` (`FUN_0043a9e5`), position = the buggy position + the turret's translation (not rotated: the original's quirk), matrix = gun with that
position, velocity = `(0, 0, -1.5679)` rotated by the gun matrix (so backwards along the turret), birth = `ftol(time)`.
Update: active while `time <= birth + 500` (the time runs 8 per tick: 63 ticks, about 98 units), `pos += vel`; for each snake in RUN / ATTACK: squared distance `ftol(dx^2 + dy^2 + dz^2) < 40` (radius 6.3): 3 / 15 chance of
`PEPPA` / `PIPPC` / `ADSGSS13`, score + 50, hit sound (3D, stopped first), the coconut is gone (the loop over the other snakes still runs with it), RUN -> HIT + clip 1, ATTACK -> timer 1. The expiry test and the hit test both run for a coconut that expired in this tick.
Then `time += 8`; the reload counter counts +1 per tick and falls back to 0 above 6: one shot per 6 ticks. A coconut that starts inside a snake hits it in the same tick (so a leaping snake next to the turret is easy to hit).
Drawn with `COCO` at scale 1.5 (helper records, `GameRenderer.refreshViews`).

## 7. Brickbot carts, sounds of the ride

`FUN_00657860`: while `3750 <= z < 5020` the carts CRT1..3 (start on cartpos1 at t 0 / 0.004 / 0.007, z about 3656: they roll behind the buggy) follow cartpos1: `FUN_00447bf0`, move at the buggy's speed (same formula), y = terrain below (probe 4,
else `ftol(y)`), the train sound (3D at CRT1) plays; outside the window it stops.
`FUN_0065888a`: the fountain (3D at G149) and the ambience every tick; engine rate = `clamp(31360 + 32340 * (pitch + 0.1745) / 0.349, 31360, 63700)` on the engine loop, the wind layer (turret.wav) at raw volume `80 (1 - u)` and the same rate; skids by the change of
`|yaw|` (> 0.1 large, > 0.06 small); stages by z: 4402 and 4813 `UNDER_TRACK`, 6166 studs on, 6276 off, 6320 on, 6407 off.

## 8. Result, banner, variables

Result `DAT_05d5bcdc`: 0 running, 1 no gems left (`2` is never stored; the banner treats it like 1), 3 / 4 / 5 bronze / silver / gold by `DAT_05d5bcd8` (the gems) `< 12` / `< 18` / else. Score `DAT_05d5bd48` = points + gems x 250 (x 150 of the empty
count for result 1, i.e. 0), capped at 10000. The ride counts as won above result 2 (bronze counts: `FUN_00404d14(.., .., 2 < result)`).
Banner (mode 4): panel, the score `%d` at (320, 100), the medal word (`SGGOLD` / `SGSILVER` / `SGBRONZE` of STD.str) at 150, result 1: `ADSGSS05` at 200 and `ADSGSS06` at 330; bronze `ADSGSS04` at 200; silver `ADSGSS02` at 200 and `ADSGSS03` at 330; gold `ADSGSS01` at 200 (wrap 30);
the lines are spoken. Variables (only raised): `HISCORE_SSH` (0x4b) = max(old, score), `TROPHY_SSH` (0x93) = max(old, 1 / 2 / 3). The HUD (`FUN_00658834`, mode 2 only): the right icon = texture 1 (the gem) with `x%d` of the gems, the centre text `%d` of the score, no left icon.

## 9. Tests, runs

`node tools/test-formats.mjs --only m6-z15SSH` (257 checks): the set-up attaches / record names, the constants of every ported function as immediates / floats of the executable (constructor, update, snakes, coconuts, fire, sounds,
loop banner, variable names, SSH.str ids), the sound ids of `FUN_0065a470` with their table names, **the path code against the original's own code run in the x86 emulator** (the plane table of `FUN_00447280`, the frame of `0x4466f0`, the projection of
`FUN_00447550`, agreement 1e-6), `finalScore` / lines / variables, the start state (buggy at CARBUT t 0.02, intro camera = start + 16, crew seats, clips), the speed ramp and the ride (movement 1.5 per tick, camera, path distance, wheels), the turret
and the crosshair (limits, formula, clamps), the snakes (spawn at tick 31, run faster, leap within 24, 45 frames, theft, speech), the coconuts (reload 6, life 63 ticks, hit sphere, hit on a running / leaping / idle snake, speech by rng), the end of the ride
(stop in 24 ticks, the result waits for the snakes, medals by gems), the carts and the sound stages, a scripted **LOSS** (no input: all 20 gems stolen after 5050 ticks, result 1), scripted **WINS** (an aiming bot: 88 hits, 9400 points, gold; Space every 8 ticks: gold, 10000)
and bots that stop firing at tick 3500 / 4200 / 4600 / 4800 (lost / bronze with 6 gems / silver with 13 / silver with 16).

Browser (headless, muted; a snapshot server `sh tools/m4-snapshot-server.sh 5601`):
```
node tools/browse.mjs "http://localhost:5601/?zone=z15SSH&mute=1" tools/steps/m6-z15SSH.mjs      --size 1280x800 --out /tmp/m6-z15SSH   # intro, help, arrow keys aim, Space fires, a bot with real key presses, banner, variables, result menu, Continue -> z16PYA node 36
node tools/browse.mjs "http://localhost:5601/?zone=z15SSH&mute=1" tools/steps/m6-z15SSH-loss.mjs --size 1280x800 --out /tmp/m6-z15SSH   # pause menu (page 18), no input -> LOSS, banner, page 19, retry, abort -> z14OSD node 34
```
Last results: the win run (bot: fires when a snake is within 80, 46 shots in 22 s, 1000 points, then the buggy is put near the end of the course) ended gold with 20 gems (6700 points), `HISCORE_SSH` 6700, `TROPHY_SSH` 3, result menu page 16, Continue -> z16PYA at node 36;
the loss run: pause page 18 (the ride stands still), two gems stolen by real snakes, banner with ADSGSS05 / 06, page 19, retry restarts (attempt 1, 20 gems), abort -> z14OSD node 34. Screenshots looked at: intro panel with `ADSGSS14`, help panel with the five cap lines, the buggy from the front camera
(crew, turret, crosshair, HUD `X20` with the gem), coconuts in flight, snakes slithering far behind, a snake leaping at the buggy, the canyon at the end, the gold banner (6700, GOUD!, ADSGSS01), the loss banner, the result menu.
Shortcuts for runs: `window.__zone.game.debug()` (score, gems, states, cart, snakes, coconuts, sounds counted), `window.__zone.game.ssh.node.jumpTo(world, t)` (put the buggy at parameter t of its path, the snakes 0.02 behind), `?zone=z15SSH` starts the zone at its story node (35).

## 10. Findings, approximations, not ported

* **The game is easy to hold**: a coconut starts at the turret, so a snake that leaps (it ends up within 3 units of the buggy) is hit by any shot fired then; mashing Space gives gold (the node test). Hitting a *running* snake only delays it (it comes back from where it was hit), so
  the score comes from hits (50 each, about 90 attack cycles per ride), the medal from the leaps that were stopped. All of this is the original's arithmetic (no balance changes).
* The wheels turn 4x 3 degrees x speed per tick (0.025 rad per tick): very slow, as in the code.
* The coconut's start position adds the turret's local offset without rotating it (original quirk, kept).
* `Walk` returns "stop the chain" (the stub chain of the generic set-up is removed); the nodes of `Snake` (update returns 1) do nothing, the snake logic lives in the buggy's node.
* **Particles**: the two `trexfeet.par` dust emitters at the rear wheels (`FUN_00442960` in the constructor, `FUN_00442a20(emitter, 2, 1, 1)` each tick) are not drawn (no particle system yet).
* **Blob shadow**: the focus record's (Pepper's) blob shadow smears over the canyon walls under the path-following buggy (a long dark spike); `SWITCH_GME_PEPPERSSHADOW` (var 0xc5) is set to -1 for the ride and restored when the zone ends. Port decision; the original's shadow code is not known to draw one here.
* **Music** starts with the zone (`audiohost.enterZone`), the original starts it when the help screen is left (`FUN_004432c0`); `SND_SSH_AMBIENT` names `snake_amb2.wav` which the CD does not have (silent), `SND_WATERFALL` is loaded and never played.
* The speech chances come from `GetTickCount` (`FUN_00435c91` + `FUN_004388ae`); the port draws uniform integers (`SshRng`, injectable).
* The original poses every drawn animated record; the port poses within `poseRange` (500 here), snakes beyond are in the bind pose.
* `FUN_00444530(FUN_0043f160(LAND model, 0, ...))` at the end of the attach function changes a render property of the terrain mesh; its meaning is not known (not ported). The initial `FUN_0045c310(0)` is the cutscene manager's zero-slot set-up.
* The crosshair is drawn only in play (the original draws it with the buggy in every mode; the panels cover the screen in modes 1 / 4 / 9).
* Time step: the original multiplies by the frame time (`DAT_008b1718`, 1.0 at 30 fps); the port runs a fixed 30 Hz step (dt = 1).
* The path object keeps `lo` / `hi` state between projections like the original, but every projection recomputes them; when the nearest segment is the last one the original reads one table row past the end, the port returns that segment's start.
