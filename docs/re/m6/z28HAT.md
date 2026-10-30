# z28HAT "hot-air balloon" (Adventure Island mini-game) - M6 port

Zone table index 21 (sub-game id 21, archive `z28HAT`), story node 49 (a win goes on to node 50 = z23DIP, abort / loss rewinds to before the game), strings `AI/Data/hat.str`
(`ADSGMC01..19`, `CONTROL0..4`), HUD textures `Overlays/z28HAT`, music key `z28HAT` (`MrHates.sgt`), two cutscenes in the zone archive (`cutscene/adv08.cut` = intro "MainCampIntro",
`adv09.cut` = outro "MrHatesDefeated", messages `AI/Data/ADV08.str` / `ADV09.str`), set-up code 0x790fc0 - 0x7aef10 (loop `FUN_00790fc0`, banner `FUN_00790c19`, runner `FUN_007927b5`).
Story of the game: Sam Sinister ("Mr Hates", record `HATE`) holds dinosaurs captive in a valley and rides the brontosaurus Bronto (`BRON`) who burps fireballs at the
balloon. Pepper flies a hot-air balloon from the landing site (`DROP`, a bullseye on a plateau), lowers a winch hook onto the dinosaurs (6 big ones standing around, 5 babies in a
pit), carries them back and lets them fall onto the landing site (counted always, scored only inside 40 units of it), dodges the fireballs, and when all eleven are down drops sandbags into
Bronto's mouth until he is free. There is **no clock**; the game ends when Bronto's last animation ends.

## 1. Files

| file | what |
|---|---|
| `src/zones/z28hat/rules.ts` | constants with the EXE addresses (`K`), record indices (`REC`), variables (`VAR`), state names, sound table (`HAT_SOUNDS`), the shared state `HatShared` (the original's globals `DAT_05d5d2e4 .. DAT_05d5d3c4`), result rules (`finishGame`, `medalOf`, `resultLines`, `applyResult`). Pure |
| `src/zones/z28hat/nodes.ts` | the ten behaviour nodes (`HatPepp`, `HatBalloon`, `HatWinch`, `HatDino`, `HatBaby`, `HatBronty`, `HatMrHates`, `HatFireball`, `HatSandbag`, `HatPtera`). Pure |
| `src/zones/z28hat/game.ts` | `prepareHat` (rigs, constructor effects in the order of the attach calls), `hatUpdate` (FUN_007928a0: HUD values, `allDone`), `hatSnapshot` (what the bots read) |
| `src/zones/z28HAT.ts` | `registerCtor` of the ten constructors, the zone game (HUD, cutscenes, banner, speech, sounds, music fade, winch rope, listener), `registerZoneSetup` (ZAPP render mode) |
| `tools/lib/hat-bot.mjs` | scripted player (steering law, hook / carry / release, sandbags) used by the tests and the browser steps |
| `tools/tests/m6-z28HAT.mjs` | node tests (`node tools/test-formats.mjs --only m6-z28HAT`, 340 checks, ~2 s) |
| `tools/steps/m6-z28HAT.mjs`, `m6-z28HAT-loss.mjs` | headless browser runs (section 9) |

Shared files touched (additive): `src/zones/index.ts` (one import), `src/shell/zonegame.ts` (`ZoneGame.resultHold?` / `resultTick?`), `src/shell/playzone.ts` (mode 5 calls them: the result menu waits while a zone's outro cutscene runs).

## 2. Ported code (addresses of the NL build)

| address | function | port |
|---|---|---|
| 0x790fc0 | zone loop | runner loop template; zone parts in `z28HAT.ts`: cutscene slot 0 at the first start (`FUN_0045c40c(0)`, not after a restart), intro `ADSGMC19` at y 120 (mode 1, after the cutscene), help `FUN_00461155(table, 5)`, play = `world.tick` + `hatUpdate`, banner, mode 5 starts slot 1 when `DAT_05d5d314` (a medal) |
| 0x790c19 | end banner | `drawBanner`, `resultLines`, `applyResult` (hi-score var 0x4a raised every tick of the banner; `%5d` score at y 100, medal word at 150, lines at 200 / 320, 32 wide) |
| 0x7927b5 | runner | records / sounds / HUD overlay `Z28hat` / strings `hat.str` / music `z28HAT`; `FUN_007a6bf3` = loader (anim rigs `MFIG BRON STEG BREX TRIC TREX PTER`, `Food.man`, `W_PATH` waypoint map) |
| 0x791990 | attaches | 23 `FUN_00423532` calls: extracted by `extractZoneSetup`; the argument blocks of the dinosaurs are immediates of this function (`DINO_ARGS`, `BABY_ARGS`), start clips / frames (`DINO_START_CLIP`, `BABY_START_FRAME`) |
| 0x791940 | cutscene set-up | `HAT_CUTSCENES`: 2 slots, `ADV08` / `ADV09`, area `ai` |
| 0x7928a0 | per-tick HUD | `hatUpdate`: score `%d` (centre), `11 - delivered` `%d` (right, icon 0), left icon 2 once `DAT_05d5d32d` |
| 0x792950 | sound loads | `HAT_SOUNDS` (10 positional `FUN_004433b0`, 12 plain `FUN_00443580`; the test compares the ids) |
| 0x797d67 / 0x797ba0 / 0x797c02 | `pepp` ctor / update / pre-render | `HatPepp` |
| 0x79798f / 0x796e14 | balloon ctor / update (277 lines) | `HatBalloon` (`FUN_00796b60` camera snap, `FUN_00796c0e` camera follow; `FUN_00873e13` = music fade) |
| 0x795da0 / 0x795770 / 0x795bd6 | winch ctor / update / pre-render (the rope line) | `HatWinch`; the rope is drawn by the zone game (`gr.effects`, `Renderer.drawBox` of a thin box) |
| 0x796a05 / 0x795f80 (+ 0x795ec0, 0x796939) | Bronty ctor / update | `HatBronty` (relative angle `FUN_00433450`, food path `Food.man`, Mr Hates' matrix copy) |
| 0x7956be / 0x7955f0 | Mr Hates ctor / update (returns 1) | `HatMrHates` (the record is moved by Bronty's node) |
| 0x7953d4 / 0x794c26 (+ 0x794a5c, 0x79492a, 0x794860) | big dinosaur ctor / update, speech, landing count, blink | `HatDino` |
| 0x794679 / 0x793c44 (+ 0x793b12, 0x793a48) | baby ctor / update, landing count, blink | `HatBaby` |
| 0x793867 / 0x793370 | fireball ctor / update | `HatFireball` |
| 0x7932b6 / 0x792e60 | sandbag ctor / update | `HatSandbag` |
| 0x792d38 / 0x792ae0 | pterodactyl ctor / update | `HatPtera` |
| 0x797e90 | record reset (restart) | not needed: a restart builds a new world |
| 0x7a6bf3 (code stream) | animation dictionary `DAT_05d4d484` (174 `FUN_0045bff4(dict, "NAME", clip)` calls) | `readAnimDictionary(pe)`: read from the code at run time, handed to the cutscene host (`registerZoneSetup.cutsceneOptions`) so the scripts' `setanim` names resolve (`XTALK3` 123, `INFO_PONDERING` 114, `HATES_*`, `BRON_BR_*` ...) |

## 3. Records (index = byte offset / 0x68)

`PEPP` 151 (MFIG, flags 0x12), `HOTB` 153 (the balloon, mode 1), `WNCH` 65 (hook), `BRON` 8 (BRON.blk, 33 bones, 10 clips; attachments at bone 14), `HATE` 7 (MFIG.blk 17 bones, clips 0x77 ..),
`DROP` 6 (landing site, (-221.2, 25.03, 356.9)), `STE1/2/3` 9, 14, 11 (STEG), `TRI1/2` 12, 15 (TRIC), `TREX` 13, `REX1..5` 10, 17..20 (BREX, nest at REX1's place (-59.3, -0.79, 113.3)),
`FRB1` 22 (+ `FRB2` 63, `FRB3` 64: three flame sheets, hidden), `SDB1..3` 76 - 78, `PTER` 16, `PIZ4` 139 (the pizza Bronty eats), `ZAPP` 150 (electric fence, render mode 2 set by the
balloon's constructor), `PAG1` 152 (cutscene prop), `HOLO` 21, `LAND` 1 (ground record). `G0xx` helper records are hidden by the set-up. Names are checked at run time (`checkRecords`).
Update order = record order, so every node sees the others' state of THIS tick only when they have a lower index: the hook (65) follows the balloon (153) one tick late, the dinosaurs
(9 - 20) see the hook of the previous tick, Pepper's pre-render (151) runs after every update.

## 4. Variables and shared state

Game variables: `0x4a` HISCORE_HAT (raised in the banner), `0x9d` TROPHY_HAT (written by Bronty's end: 3 gold, silver / bronze only raised, **0 below 2500**), `0xc5` PEPPERSSHADOW (set to 4 by the loop
before the cutscenes: the blob shadow type), and three zone-local ones: `0xfa` winch (0 top, 1 lowering, 2 raising, 3 lowering with a dinosaur), `0xfb` Bronty's state, `0xfc` balloon control (1 / 0 knocked).
`HatShared` = `DAT_05d5d2e8/ec/f0` balloon momentum, `2d8/2dc/2e0` nest, `304` carrying, `30c` delivered, `0x94000c` total (the EXE's 11), `310` score, `314` medal, `32d` allDone, `2cc` result,
`2e4` eat count, `316` fireball hit, `320/324/328` fireball push, `2f4/32c` speech counters, `3c0/3c4` the winch's / Bronty's copy of the variables.

## 5. The nodes

**Balloon (`HatBalloon`)**: constant height (drop zone y + 40 = 65.03); the keys give x / z momentum only. Left / Right turn 3 degrees per tick (Left wins), Up / Down ramp the thrust `speed` by 0.0004 per tick to +-0.004
(Up wins), the ramp decays 2% per tick without a thrust key, the thrust vector is forward * 8 * speed, the momentum is damped 2% per tick (while in control) and capped at 1.6. Two sweeps decide collisions (mask 1; from 12.8
under the centre radius 3.2 / skin 4.0, else from the centre radius / skin 5.6); a hit that is not the hook reflects the momentum about the horizontal normal. The analogue stick branch is not ported (the input mapper turns a pad
stick into direction bits). Knocked (var 0xfc = 0, by a fireball): 15 ticks without control, the push added to the momentum every tick, the winch var set to 2, speech `ADSGMC06` (first knock) / `09` (third) / `18` (odd counts).
The music fade (`fade -= 0.01` per tick from the first points while `fade >= 0`, `+= 0.01` while `<= 1` once everything is down) goes to the music engine's `setFade` (master volume dB = 0.22 * opt * fade - 22: the floor after the
fade-out is -22 dB, not silence).
**Camera**: target = balloon x / z, y - 16 at once; eye eases 6% per tick towards the balloon's frame * (0, 15.2, -16) (y with 0.125 of that).
**Pepper (`HatPepp`)**: takes the balloon's matrix, 12.8 under it (world axes), clip 0x74 restarted by the sandbag nodes every tick (so Pepper stands still on frame 1) and clip 0x75 (throw) from the sandbag press on. The electric fence of the T-rex buzzes (3D loop at `TREX`).
**Winch (`HatWinch`)**: states by var 0xfa. The switch uses the value read at the END of the previous tick (`DAT_05d5d3c0`), so a press acts one tick later. Lowering 1.6 per tick (the rope grows, minimum 18.4); the sweep (radius 0.01, mask 1, ground included) is made
**upwards** (delta y +1.6 + the momentum) from the new hook position, so the hook turns round when it is at or below a surface or ground (at most 1.6 under it); with nothing below, at y <= 0. Raising 1.6 per tick back to 18.4. The Shift press toggles 0 -> 1, 1 -> 2, 2 -> 1,
3 -> 2 but is ignored while `carrying`. While carrying the hook sways by (heading to the drop zone) * 0.03.
**Big dinosaurs (`HatDino`)**: the six clip bytes of a block are IDLE1, IDLE2 (the roar / stamp clip: footsteps `StepRev` from frame 44, the roar from frame 25), HANG, DROP, DROPEND, WALK of the rig (`STEG_STEG_*`, `TRIC_TRI_*`; the T-rex's block has IDLE, IDLE, HANG, HANG, LAND, WALK). States 0 idle (random clip: 2/3 IDLE1, 1/3 IDLE2; the TREX never sounds), 1 hooked (HANG), 2 falling (DROP), 3 landed (DROPEND, then WALK), 4 gone.
Hooking: the hook within `reachH` (16) in x AND z of the dinosaur and `reachV` (5.6 / 8 for the T-rex) in y; var 0xfa 1 -> 3; speech by kind (`ADSGMC10 / 11 / 14` stegosaurs, `12 / 13` triceratops, `17` T-rex). Hooked: it hangs at the hook (y = |hook y - hang|, 0.8 / 1.2), above the terrain, var 0xfb = 6
when within 24 of Bronty, released by Shift when the balloon's squared distance from the origin (3D, so 27.8 horizontally at the balloon's height) is over 5000, or dropped by a fireball hit. Falling 2.4 per tick onto the ground record (ray from 4 above, radius 0.8 / skin 0.08, 1e38 when
there is no ground). Landing counts the dinosaur once (`delivered++`), +1000 inside 40 of the drop zone (x and z each), blinks (visible while `ftol(timer) & 2`) and vanishes after 75 ticks (flags = 0). While one dinosaur is carried the others in a later state reset `carrying` (order quirk, ported).
**Babies (`HatBaby`)**: wander forward 0.4 per tick inside 6.4 of the nest, turning by a random angle at the edge; **all five hang together** when the hook is over the NEST (within 6.4 in x / z and 2.08 in y: the test is the nest, not the baby), stacked 2.0 / 5.68 / 6 / 8 / 10 under the hook, calling (`newbabes` loop),
`ADSGMC15` + `16` for REX1. Falling / landing as above, +300 each inside the drop zone; they walk on while they blink out.
**Bronty (`HatBronty`)**: his state is var 0xfb; the clip numbers are the dictionary's names (BRON.blk / MFIG.blk: `BRON_BR_*` / `HATES_*`, checked by the test). 4 idle (`BR_IDLE` 7 / `HATES_IDLE` 0x81, the riding pose): when the clip ends and he faces the balloon within +-22.5 degrees he eats the pizza
(2, `BR_FEDPIZZA` 4, the `Food.man` path of PIZ4) the first time, then returns to 0 while `count < 4` and the balloon is far; else turns (7 left = `BR_PULLEDLEFT` 5, 8 right = `BR_PULLEDRIGHT` 3: 0.75 degrees per tick during a 30 frame clip). 0 stance (`BR_BURP` 1):
while the balloon is far (squared 3D distance > 5000) the burp at frame 20 (and the fireball); three stance cycles, then back to idle. 3 hit by a sandbag (`BR_HIT` 6, `ADSGMC07 + 08`, eat count++); the next time he is in state 3 with `eatCount > 2` Mr Hates runs up his back (5, `BR_RUNUPBACK` 8)
while dinosaurs are missing, or Bronty is freed (1, `BR_TAILFLICK` 9, 150 frames: he flicks Mr Hates off; his flags are cleared, then +1000, the trophy variable and the result) once everything is delivered. 6 roar (`BR_CALL` 2: a hooked dinosaur above him). Mr Hates' matrix is a copy of Bronty's every tick.
**Fireball (`HatFireball`)**: spawns when var 0xfb == 0 and Bronty's frame truncates to 20 (in the original this reads an uninitialised local otherwise): from bone 17 (the mouth) aimed at the balloon (rx = atan2(0, dy), ry = atan2(dx, dz)), 2.4 per tick, swept (radius 0.08, mask 3) one step ahead; hitting `HOTB` or `WNCH` knocks the balloon (var 0xfc = 0, push = (vx, 0, vz), a carried dinosaur falls); any hit or 200 from the origin ends it.
**Sandbags (`HatSandbag`)**: once all eleven are down one Shift press activates **all three** (the nodes do not look at each other) at Pepper's place; each falls 1.6 per tick until a sweep (up 1.6, **radius 16**, mask 1) finds anything but `HOTB`, `WNCH` or `SDB*`; then within 8 horizontally of Bronty's head (bone 14) = hit (+500, cap 10000, var 0xfb = 3), else miss (-100). So one press is +1500 or -300, and the end is always reached with 3 hit presses.
**Pterodactyl (`HatPtera`)**: x = 60 sin(2t) + 35.784, z = 60 cos(t) + 29.474, t += 0.016, at the balloon's height - 16, flapping.

## 6. Result, medals, variables, speech

Result (1 = success) = Bronty's end with score >= 2500 (`0x9c3 < score`); bronze 2500, silver 5000, gold 7500 (`score < 0x9c4 / 5000 / 0x1d4c`). Dinosaurs 7500 (5 x 300 + 6 x 1000), +500 per sandbag hit (cap 10000), -100 per miss, +1000 for the end. Failing (score < 2500) is only possible
by missing with the sandbags (11 missed presses for 0 dinosaur points) or by quitting: the banner then shows `ADSGMC05`, page 19 (retry / abort). Banner: `%5d` score, medal word (`SGBRONZE` / `SGSILVER` / `SGGOLD`), line `ADSGMC04` / `03` / `01 + 02`. The result lines are spoken. Outro: with a medal the result menu waits for `ADV09`.

## 7. Sounds (ids of the sound table; `HAT_SOUNDS`)

3D (`FUN_004433f0`): `brontyCall` 0x26, `brontyBurp` 0x12, `brontyEat` 0x13, `brexCall` 10 (loop), `fenceBuzz` 8 (loop at the T-rex), `dinoStamp` 7, `fireballFly` 9 (loop), `pterFlap` 6 (loop), `stegRoar` 0xe, `tricRoar` 0xf (the T-rex's block leaves the slot of the previous block: triceratops).
2D: `balloonFly` 0x15 (loop while a key is held), `balloonHit` 0x16 (no sample in the table), `dinoLand` 0x11, `fireballHit` 0x14, `sandbagHit` 0xd, `sandbagMiss` 0xc, `sandbagFall` 0xb (loop), `winchMove` 3 (loop), `wind1` 4 + `wind2` 5 (beds, every tick), `hatesHit` 0x93 (Bronty's burp state), `hatesFinal` 0x2b8 (loaded, never played).

## 8. Known differences, approximations, not ported

* **Fireball particles**: the original draws the fireball as a particle emitter (`burp.par`, `FUN_00442960 / 00442a00 / 00442a20`) and keeps `FRB1..3` hidden. The port has no particle system: it shows the three flame sheets (FRB1 / 2 / 3, rolled 60 degrees apart) while the fireball flies. They are never collidable.
* **3D sound positions of the big dinosaurs and babies**: an earlier note claimed that the original passes the wrong pointer (one float off: y, z, junk). **Wrong** (differential test, section 10): the 3D calls of the dinosaurs / babies hand the engine the true (x, y, z) of the record; ~50 000 such calls agree with the port's positions.
* **Bone matrices** (Bronty's head and mouth for the sandbags / fireball): the original reads the matrices of the previous draw = the animation state at the start of the tick; the port sampled the current frame (one animation step ahead). Fixed (`poseOfLastDraw` in nodes.ts; found by the differential test).
* **Analogue stick** (`DAT_00983848..50`) not read; **rumble** (`FUN_00438518`) not ported; `_DAT_009dec14 = 1` before the winch's sweeps: a write-only global (the sweep FUN_00441270 clears it at its entry, nothing reads it: asm 0x441283), no effect.
* **Music** starts with the zone (`audiohost.enterZone`), the original starts it when play starts (`FUN_004432c0` at the end of the help screen); the fade is applied through the music engine.
* The original's random numbers come from `rand`; the port uses uniform draws (`rand()` of the parachute helpers, injectable for tests).
* Var 0xfa is cleared at the start (the original keeps it across a restart inside the zone loop, section 10); the original's uninitialised `+0x47` byte of a new dinosaur is non-zero (0xcd of the debug heap: the first update picks a clip): same here.
* The record reset of a restart (`FUN_00797e90`) is not needed: a restart builds a new world. `DAT_05d5d31c`, `DAT_05d5d2f8 .. 300`, `DAT_05d5d315`, `DAT_05d5d305 / 317` (a clock nobody reads) are written and never read.
* The intro cutscene plays only at the first start, a retry / restart skips it (`ctx.attempt`), as the original's `local_20`.

## 9. Tests, runs

`node tools/test-formats.mjs --only m6-z28HAT` (340 checks): the attaches and gates of the set-up, record names, the executable's floats / doubles of every constant, the score and threshold immediates of the loop, the dinosaur / sandbag / Bronty code, the 22 sound loads of `FUN_00792950` (and the table names), the clip bytes and
start frames of `FUN_00791990`, the rig names; the balloon (start place, camera, thrust ramp, decay, turning, priorities, momentum cap / damping, constant height, sounds), the knock-back (timer, push, speech by count), the winch (states, one-tick latency, 1.6 steps, toggling, carrying), a big dinosaur (hook, speech, carry,
release rule, fall 2.4, landing sound, +1000, counted once, blink, vanish), a dinosaur dropped far away (counted, 0 points), the 70.7 rule, a fireball hit while carrying, the babies (nest radius, stacking, +300 each), Bronty (idle / eat / stance, the burp at frame 20, the fireball: start, aim, speed 2.4, hit, push, range), the roar,
the sandbags (not before allDone, all three, fall 1.6, hit +1500 / miss -300, hit state), the end rules (result / trophy / medal for 9 scores, the cap, trophy only raised, reset to 0 below 2500), the animation dictionary (174 entries, the cutscene names, the clip names of Bronty / Mr Hates / the dinosaurs against the clip numbers the nodes use), the pterodactyl, the music fade, a scripted **WIN** (bot, gold, 6134 ticks), the quick plan with five seeds, and a scripted **LOSS** (11 missed presses + 3 hits: 2200 points, result 2, no trophy), 3000 ticks of random key mashing.

Browser (headless, muted, snapshot server on port 5608):
```
sh tools/m4-snapshot-server.sh 5608
node tools/browse.mjs "http://localhost:5608/?zone=z28HAT&mute=1" tools/steps/m6-z28HAT.mjs      --size 1024x640 --out /tmp/m6-z28HAT   # intro cutscene, brief, help, the bot with real keys (babies + dinosaurs, sandbags), banner, outro, result menu 16, Continue -> story
node tools/browse.mjs "http://localhost:5608/?zone=z28HAT&mute=1" tools/steps/m6-z28HAT-loss.mjs --size 1024x640 --out /tmp/m6-z28HAT   # pause 18, eleven missed sandbag presses, failed banner, page 19, Retry, pause restart, second loss, Abort (story rewinds)
```
Last results: win run (5160 ticks, ~5 min wall time) 7000 points = silver, trophy 2, hi-score 7000, outro cutscene, result menu page 16, Continue -> z23DIP at story node 50; loss run: pause 18 (the world stands still), 11 missed presses = -3300, three hit presses, Bronto freed, 2200 points, result 2, trophy 0, banner `ADSGMC05`, page 19, Retry (attempt 1, no intro cutscene), the pause menu's restart (attempt 2), a second loss, Abort -> z23DIP at story node 47 (< 49: rewound). Screenshots looked at: the cutscene (Mr Hates beside Bronto in his pit), the brief, the help panel (5 control lines),
the balloon in the basket over the bullseye with the HUD (score, 11 dinosaurs), the balloon in flight with the hook and rope, babies in their pit, the T-rex in its electric fence, Bronto with Mr Hates on his neck, the fireball flame sheets, the sandbags in flight with the sandbag icon in the HUD, the hit / freed frames with the subtitles, the banner "ZILVER!", the outro cutscene subtitle.

## Shortcuts

* `?zone=z28HAT&mute=1` starts at the story node (49); `window.__zone.game.debug()` = `hatSnapshot` (balloon, hook, Bronto, mouth, dinosaurs, babies, sandbags, winch / Bronty / control variables, score, delivered, allDone, result ...); the shared state is `__zone.world.ext.get('z28HAT')` (`delivered`, `score`, `mom` ...).
* Keys: arrows turn / thrust, Shift = winch (lower / raise) and, when all dinosaurs are down, the sandbags.

## 10. Differential test (WP-VERIFY): the original's code in the emulator next to the port

`node tools/test-formats.mjs --only m7-z28HAT-emu` (tools/tests/m7-z28HAT-emu.mjs + tools/lib/m7-z28HAT-emu.mjs, ~20 s; the original's functions run in `src/formats/x86emu.ts`).

**Native (the executable's code):** the ten node updates and their helpers (Pepper + pre-render, balloon + `FUN_00796b60` / `00796c0e`, winch, Bronty + `FUN_00795ec0`, Mr Hates, big dinosaur + `00794a5c` / `0079492a` / `00794860`, baby + `00793b12` / `00793a48`, fireball, sandbag, pterodactyl),
all ten constructors, the attach function `FUN_00791990` (the dinosaurs' argument blocks are its immediates), `FUN_007918a0` (globals reset), `FUN_00792950` (sound loads), `FUN_007928a0` (the loop's HUD part), the end banner `FUN_00790c19`, the record reset `FUN_00797e90`, the restart sequence `FUN_00792868`,
the `.man` loader `FUN_0043ecd0` (Food.man from the zone archive), the matrix / vector helpers, `FUN_0043cd62` / `004425f0`, `FUN_00441a90`, the C runtime. **Hosted:** variables, animation instances (the port's `AnimInstance`), collision (`FUN_00441270` -> `sweep`, `FUN_00441b10` -> `rayRecord`; the winch record's collision pointer `0xbabababa` = off, as the sweep tests it),
sounds / speech / music fade (recorded), rumble (`FUN_00438518` is empty), particles (no-ops), random numbers (an integer keyed by tick, record and draw), the bone matrices `FUN_0043bc58` (= the pose of the animation state at the start of the tick = the last draw), the stick values (0: `FUN_004376f9` zeroes them).

**What is compared** at every tick (one original pass over the 154 records from exactly the state of one port tick; the port's doubles are rounded to float32 first): every mutable record's matrix / Euler / flags / collision pointer, every node's fields (balloon 5, winch 2, Bronty 8, dinosaur 16, baby 10, fireball 4 ...), the zone globals (momentum, push, carrying, delivered, score,
allDone, result, eat count, fireball hit, speech counters, the winch's and Bronty's copies, the nest), variables 0xfa / 0xfb / 0xfc / 0x4a / 0x9d, camera eye / target, animation clip + frame of every record, the random draws per node, the HUD strings (score `%d`, dinosaurs left `%d`, the left icon), and the ordered list of sound / speech / music-fade calls with their positions.
Tolerance 0 (bit-exact; the emulated x87 runs in 24-bit precision, `cpu.cw = 0x7f`; only denormals get 3e-45). Every scenario runs at dt = 1 and dt = 0.5.

**Scenarios (~30 k compared ticks):** the set-up against `prepareHat` (attach list and gates, the argument blocks, all 154 records' flags / matrix / collision incl. the random headings, the 16 animation starts, camera, variables, globals; fields the constructors leave uninitialised are the debug heap's 0xcd and are not compared), two whole bot games (dt 1 every 4th tick, dt 0.5 every 8th; score 10000, trophy 3),
free flights with random keys / knock-backs / jumps to places, the hook over each dinosaur and the nest (lowering, hooking, carrying, letting go inside / outside / far outside the drop zone -> no ground, landing, blinking out), every Bronty state with the eat / delivered counts at their edges and the angle wrap, the sandbags over / beside his head, the fireball (aimed, into the hook, onto a carrier), the winch's own sweep against a wall,
Bronty freed with every score / trophy combination, the banner for 13 scores x 3 hi-scores, the record reset (all 154 matrices equal the scene), the restart sequence. Instruction coverage of the original's nodes: 85 % of the balloon (the rest is the analogue-stick branch: unreachable, the stick values are 0), 94 - 100 % of every other node (the rest: bytes after `ret` and one `jmp` per unreachable fall-through).

**Result:** the port matches the original at every compared tick at dt = 1 and, after the fixes below, at dt = 0.5. Two worlds side by side without resync (original in the emulator, port native, same keys) stay bit-identical.

**Fixed in the port (found by this test):**
* `anim.advance(1.0)` of the pre-render of Pepper, the dinosaurs, babies, Bronty / Mr Hates and the pterodactyl ignored `world.dt` (the original's `FUN_0043b76a` scales by `DAT_008b1718`): at dt 0.5 their animations ran twice as fast. `nodes.ts`.
* The bone matrices of Bronty (`FUN_0043bc58`: the fireball's start place, the sandbags' target) are those of the previous draw; the port used the current frame. `poseOfLastDraw` in `nodes.ts`.
* A baby that lands made an extra `stop(brexCall)` call in the landing tick; the original only stops it in the landed state. `nodes.ts`.

**Known differences (counted / noted by the test, not fixed):**
* FRB1 / FRB2 / FRB3: the flame sheets stand in for the particle emitter `burp.par` (flags 0x10 / 0x2, FRB2 / FRB3 moved): excluded from the record comparison (FRB1's matrix, the real fireball, is compared).
* The pterodactyl's Euler fields (the original rebuilds only the matrix with `FUN_0043a340`).
* Var 0xfa and the winch's copy `DAT_05d5d3c0` are kept across a restart in the original (`FUN_00792868` + `FUN_007918a0` do not touch them: checked by running both); `prepareHat` clears them at every attempt. The port's variable store is shared across attempts (`world.vars = sh.vars`), so removing the clear would reproduce the original, but a first visit must still start from 0 (the original clears var 0xfa .. 0x13e on every zone entry, `FUN_004177ed`): needs the shell's notion of 'restart inside the loop' vs 'entered again' (the lead / playzone.ts).
* Float32: fixed. `nodes.ts` (with `src/zones/exact.ts`: the matrix builders FUN_0043a4a1 / 0043a5e4 / 0043a742, normalise, reflect, rotate, transform, multiply, each checked against the native function with random inputs) rounds every + - * / sqrt to float32 like the original's 24-bit x87 (the decompile lists three-term sums in a different order than the code adds them: x, y, then z). Two worlds side by side without resync are bit-identical over a whole game (6927 ticks, score 10000, 11 dinosaurs) and 9000 ticks at dt 0.5. The pterodactyl's constant at 0x892918 is the double 29.474000930786133, not 29.474. The scene's static matrices (formats/matrix.ts, doubles) differ from the reset's float32 products by <= 2.5e-7 (compared with that tolerance).
* **Finding outside the zone code:** record 80 `SHAD` (the balloon's shadow): the balloon's draw hook `FUN_00796d72` sets its flag 2 at every draw (the set-up hides it) and draws it itself with `FUN_00444480`; the port keeps it hidden (flags 0) and has no such hook: the balloon's shadow is missing (render owner).


## 12. WP-PART-WIRE / WP-MINI (2026-10-29)

* **Fireball emitter** (`FUN_00793867` ctor, `FUN_00793370` update): `FUN_00442960("burp.par", FRB1's matrix, offset 0 0 0, rotation (pi, 0, 0), gate off)` in the ctor (`HatFireball.init`, handle `fx.burp`); at the launch `FUN_00442a00(handle, record matrix)`; every flying tick `FUN_00442a20(handle, 2, 1, 1)` (on), at the end / hit `(1, 1, 1)` (off). The three model records FRB1 / FRB2 / FRB3 stay hidden (the flame sheets of the earlier port are gone). The engine is `ZoneParticles.create(ctx)` in `z28HAT.ts` (`FUN_00442900("z28HAT")`); the original never calls `FUN_0044e8d0` here (no `[SPLASH]` effect), nor does the port.
  Checks: `m6-z28HAT` (start arguments, matrix call at the launch, `on` per flying tick, one `off`), `m7-z28HAT-emu` (the fireball node against the original: 15.1 M comparisons, 0 differences), headless screenshot `tools/steps/m6-z28HAT-fire.mjs`.
* **Var 0xfa / DAT_05d5d3c0 across a restart (exact)**: `prepareHat` no longer writes var 0xfa: the shell clears 0xfa..0x13e at a zone ENTRY only (`Story.enter` = `FUN_004177ed`) and a restart exit re-runs the zone without it, exactly like the original. The winch's copy `DAT_05d5d3c0` is a process global (`hatGlobals.winchLast`, updated by `hatUpdate`, never cleared; the tests reset it). Test: `m7-z28HAT-emu` section "restart".
* Section 8 corrected: the 3D sound positions are exact (no pointer quirk), the bone matrices of the previous draw are done, `_DAT_009dec14` has no reader. Nothing in this zone deviates any more except the music start (A1: central) and the analogue stick / rumble (I1: non-gaps).
* **The balloon's shadow draw hook `FUN_00796d72` (DONE, `src/zones/z28hat/shadow.ts`)**: the balloon's draw hook sets flag 2 of SHAD (record 80), calls `FUN_0043ebe0(SHAD model, 2, balloon record + 0x40, 0)` (= `FUN_0088350d` mode 2: vertex i := the three floats at `points + 12 i`; the mesh `balloon_shadow.Msh` has 5 vertices, 12 indices = 4 triangles around vertex 1) and draws SHAD with the z test off (`FUN_0040cc4d(0)` = render state 7 = 0 before, restored after), then the balloon's default draw. The pointer is the RECORD's own memory: the 15 dwords from +0x40 of the last record (153) are y, z, m[15] = 1.0 | rx, ry (the heading), rz | collision pointer, controller pointer, flags word | variant, **0xbadfebad (the sentinel `FUN_00433cfe` writes behind the 0x3e90 bytes of the array, a float32 of -0.0017)**, **0xfdfdfdfd (the debug CRT's guard bytes, -4.2e37)** | the heap block's padding and the next heap entry's header words. Everything except the heap's 4 padding bytes is derived (heap addresses, flags and header words are floats below 2^-60: they cannot move a vertex; the port uses 0). The patch is therefore: vertex 1 (the fan centre) at (0, heading, 0), two corners at (y, z, 1) and (~0, ~0, ~0), one at (0, -0.0017, -4.2e37): thin wedges from the origin out to z = -infinity. The port reproduces exactly that: `balloon.draw` hook (z28HAT.ts) computes `shadowPoints`, sets the flag, draws SHAD with `GameRenderer.drawRecordLive(rec, verts, noZ = true)`; the flag stays, so the ordinary record loop draws SHAD (depth tested, `vertexOverride`) from the next frame on, like the original.
  Verified: `m7-z28HAT-emu` runs `FUN_00796d72` natively (`H.shadowRun`, the record array followed by the sentinel / guard / padding words, several heap-word variants) and compares the 15 dwords bit for bit (the eight words that matter) and as `|x| < 1e-18` (the heap words): 60 draws at dt 1 and 0.5, 0 differences; the flag and the `FUN_00444480` call are checked too. Screenshot `tools/steps/m6-z28HAT-shadow.mjs`: two thin bright / dark sheets run from the Bronty pit towards the horizon (the wedges). **Not exact / unknowable**: the 4 padding bytes behind the guard (stale memory of an earlier allocation, assumed 0), and how Direct3D 7's software pipeline clips vertices at -4.2e37 (the GL path is used).
