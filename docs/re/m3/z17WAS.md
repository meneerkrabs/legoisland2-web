# z17WAS "Whack-A-Snake" (Adventure Island mini-game) - M3 port

Zone table index 14 (sub-game id 14, `CURRENT_SUBGAME`), archive `z17WAS`, story node 37 (entered from the pyramid hub z16PYA, node 36; after a win the story goes on at node 38,
back in z16PYA; after a loss / abort it rewinds to the hub). Music key `z17was2` (`ZONE_MUSIC`), strings `AI/Data/was.str`, HUD textures `Overlays/z17WAS`.
Pepper stands behind four snake baskets and hits the snakes that pop out of them for 90 seconds; one in three snakes carries a gem that must be grabbed with a double press.
Everything the zone does is in two behaviour nodes (`pepwas` on Pepper, `zonewas` on the room record `WAS `), the loop function `FUN_00698efe` around them is the runner's loop template.

## 1. Files

| file | what |
|---|---|
| `src/zones/z17was/rules.ts` | the two nodes (`PepWasNode`, `ZoneWasNode`), the state they share (`WasShared`), constants, sound ids, camera, result helpers. Pure TypeScript, no DOM |
| `src/zones/z17WAS.ts` | `registerCtor` of the two constructors, `registerZoneGame('z17WAS')`: HUD, intro / banner texts, speech, 3D sound slots, result variables |
| `tools/tests/m3-z17WAS.mjs` | node tests (`node tools/test-formats.mjs --only m3-z17WAS`, 191 checks, 0.4 s) |
| `tools/steps/m3-z17WAS.mjs`, `-loss`, `-entry`, `-look`, `-ket`, `-gem` | headless browser runs (section 9) |

Edits of shared files (additive): `src/game/render.ts` (`GameRenderer.fov`: the camera zoom `DAT_0089df2c` used for the projection and the LOD test; default `DEFAULT_FOV`; this zone sets 0.4),
`src/shell/playzone.ts` / `src/shell/zonegame.ts` (`ZoneGame.bannerTick`, called every tick of mode 4 unless the game has `tickInBanner`; shared with the z41MAP port).

## 2. Ported code (addresses of the NL build)

| address | function | port |
|---|---|---|
| 0x698efe | zone loop `FUN_00698efe` | runner loop template (`playzone.ts`, `loopmachine.ts`): fade in, intro (mode 0), help (mode 9, `FUN_00461155(table, 5)` = 5 `CONTROLn` lines), play (2), pause, banner (4), result menu (5, page 16 / 19, `(score < 0x65) + 1`), fade out. Zone parts: `z17WAS.ts` (`draw2d`, `drawBanner`, `onBanner`) |
| 0x699bb4 | init: overlay set `Overlays/z17WAS`, strings `was.str` | `ctx.hud.set`, `ctx.strings` |
| 0x699dc7 | zone init: music `z17was2`, sounds, loader, builder, camera, zoom 0.3 then 0.4 | runner + `prepareWas` |
| 0x699950 | sound loads (`FUN_00443580(id)` 2D, `FUN_004433b0(id)` 3D) | `ALL_SOUNDS_2D` / `ALL_SOUNDS_3D`, `SND` |
| 0x69c040 | builder: records, models, collision, animation bindings | the scene extraction (`extractZone`), records `REC` |
| 0x699c4e | `FUN_00699c4e`: two nodes attached (`FUN_00423532(rec, ctor, 0, 0, var 2, mask 1, value 1)`), camera `FUN_00422b50(.., 5)`, eye z += 7, zoom 0.4 | `registerCtor`, `setWasCamera`, `gr.fov` |
| 0x69bf24 | `pepwas` constructor (0x24-byte node) | `PepWasNode.init` |
| 0x69b9b0 | `pepwas` update (Pepper) | `PepWasNode.update` |
| 0x69b337 | `zonewas` constructor (0x154-byte node, records, 4 `wasfire.par` emitters) | `ZoneWasNode.bind` (emitters not ported) |
| 0x699e80 | `zonewas` update (474 lines) | `ZoneWasNode.update` |
| 0x69b968 | `zonewas` destroy (stops the torch loop) | zone exit resets the audio |

The nodes are gated by `var 2 & 1 == 1` (always on); the update pass runs record 0 (Pepper) before record 22.

## 3. Records (index = the byte offset the constructors use / 0x68)

0 `PEPP` (MFIG.blk, 15 clips), 1-4 `SNAK` (SNAK.blk, 16 bones, clips 1 squash 9 frames, 3 idle 30 frames), 5-6 `SKEL` (cheering skeletons: MFIG clips 13 / 14), 7-13 `KET2`..`KET8`
(the dented basket shapes; parked at x = 28 until used), 14-21 `TOP2`..`TOP9` (unused extra lid shapes), 22 `WAS ` (the room, carries `zonewas`), 34 `GEMM`, 35 `BAS0`, 36 `LID3`, 37 `BAS3`,
38 `LID0`, 39 `BAS2`, 40 `LID1`, 41 `BAS1`, 42 `LID2`, 51 `SHFT` (hidden by the set-up).
Basket `k` (the code's index) -> records: `SNAKE[k] = [2, 1, 4, 3]`, `LID[k] = [38, 40, 42, 36]`, `BAS[k] = [35, 41, 39, 37]`. On screen (camera in front of the baskets, looking back at Pepper): k0 = nearest to
the camera = bottom (DOWN), k1 = farthest = top (UP), k2 = x +1.76 = screen left (LEFT), k3 = x -1.76 = screen right (RIGHT). The `SND_WAS_*_L/R/U/D` names do not follow this (k0 uses the `_R` sounds, k3 `_D`): the ids are what the EXE uses.
The record names are checked at run time (`checkRecords`).

## 4. Pepper (`pepwas`, 0x69b9b0)

State (node offset): `cur` +0x18 (clip), `next` +0x19 (0xff none), `res` +0x1a, `busy` +0x1b, `timer` +0x1c, `presses` +0x1d, `dir` +0x20; global `DAT_00925e58` = the clip now playing (`WasShared.clip`, .data value 1).
Per tick (one step of the world, dt-scaled where the original multiplies by `DAT_008b1718`): rebuild the matrix at the record's yaw; advance the animation (`FUN_0043b76a(anim, 1.0)`); when a one-shot clip ended (result 2): nothing queued -> idle clip 1 (`busy = 0, presses = 0`),
otherwise `cur = next`, `busy = 1`, the sound of the press count (1 press: 3D `SWISH1..5` round robin, 2 presses: 3D `XSWISH1..3`), a grunt with chance 2/8 (`int(8)`: 0 `GRUNT1`, 1 `GRUNT2`), start the clip. While `busy` and `cur != 10` the last 5
frames free the buttons (`busy = presses = 0`, `next = 0xff`). With `!busy` and a button pressed this tick (`DAT_00983840` = buttons that went down): first press (`presses == 0`): clip 10 (wind-up, 9 frames) now and the
whack clip next: LEFT -> 3, DOWN -> 0xc, RIGHT -> 4, UP -> 0xb (the checks run in the order LEFT, DOWN, RIGHT, UP; every pressed bit adds one to `presses`); the same button again during the wind-up: the grab clip replaces it, LEFT -> 6, DOWN -> 9, RIGHT -> 7,
UP -> 8, `busy = 1`, `presses` 2. A 15-tick timer after the start (`__ftol(15.0 * dt)`) clears `busy` once. Another button during the wind-up is ignored. Returns "stop the chain".
Time budget: a whack lands (Pepper's frame >= 2) 9 ticks wind-up + 2 = 11 ticks after the press; the clip is 17 frames (whack) / 16 (grab); after a whack the buttons are free again 5 frames before the clip ends.

## 5. The game (`zonewas`, 0x699e80)

Constants (ctor 0x69b337, all floats of the code stream; `K`): clock `2700` ticks (`+0xc0`, counts down; `+0xc4` counts up), snake travel 2.664 (`+0x74`), hidden y -0.4 (`+0x78`), lid height above the snake 2.264
(`+0x7c`), closed lid y = y of LID0 (2.32, `+0x80`), rise 6 ticks (`+0xfc`: +0.444 per tick up to y = -0.4 + 2.664 - 0.8 = 1.464), stay up 48 ticks (`+0x104`), sink 9 ticks (`+0x100`), spawn gap `+0x108`: 15 ticks, 19 from
elapsed 480, 24 from 930 (it stays 24 after 1830: the code only writes inside the 480..1830 window), clock sounds from 16 s left (`+0x134`), score cap 10000.

Per tick (`FUN_00699e80`):
1. `SND_WAS_TORCH` (loop) is requested. If `timeLeft <= 0`: game over (`DAT_05d5be4c = 1`, final score `DAT_05d5be54`, gems `DAT_05d5be50`), Pepper plays clip 5 (sad, final score < 101) or 2 (cheer), the four snakes' record y is set to -0.4 and the lids' matrices are rebuilt closed;
   the rest of the tick still runs. Otherwise the clock sounds (`secs = (int)timeLeft / 30`; whenever `secs <= beeps`: `beeps--` and `CLOCKLOW` (secs >= 13), `CLOCKMID` (9..12), `CLOCKHIGH` (1..8), `OUTOFTIME` (0)), then `timeLeft -= 1`, `elapsed += 1`.
2. The HUD strings: clock `"%02d:%02d"` of `(int)(timeLeft / 30)`, gems `"%d"` (`+0x110`), hits `"%d"` (`+0x114`); the score `"%d"` is drawn at (320, 400) with 28 characters per line.
3. The spawn gap (above).
4. For each basket `k` whose state is not 0: states 1 rising (y += 0.444; `lastRise = elapsed`; at the top: state 2, `topAt = elapsed`, `SND UP[k]`; the lid is pushed up to `y + 2.264`, +0.75 for the gem holder), 2 up (while `elapsed - topAt <= 48` or a snake is being squashed: advance the snake's clip 3, the lid
   is copied from the snake's matrix and put on bone 10 of the snake's pose, +0.75 for the holder; afterwards state 3 and the lid's matrix is rebuilt at the snake's x / z), 3 sinking (y -= 0.296; at -0.4: hidden, state 0; the holder: gem hidden, `holder = -1`, **-300** (min 0) when the snake was neither hit nor robbed; the lid follows down to the closed y).
   The gem sits at the holder snake (`y + 2.264 + 0.1`).
5. A new snake when fewer than 3 are active and `lastRise + gap < elapsed` (the first at tick 15): a random free basket, `SND SPAWN[k]` (the very first of a run: `SND_WAS_GASP` too), state 1, snake and lid shown; while nobody holds the gem a one-in-three chance makes this snake the holder (gem shown).
6. Pepper's swing: from Pepper's frame 2 on (`lock` keeps it to once per clip; clip 1 never hits) the clip number gives the basket (3, 6 -> k2; 4, 7 -> k3; 8, 0xb -> k1; 9, 0xc -> k0). If that snake is up (state 2): `SND HIT[k]`; on the holder: a grab clip (6..9) takes the gem
   (**+300**, gems +1, hits +1, `SND_WAS_GETCRYSTAL`, `hit[k] = 2`, gem hidden; a plain whack on the holder does nothing); on any other snake a whack clip (3, 4, 0xb, 0xc): **+70**, hits +1, `hit[k] = 1`, the snake plays clip 1 (squash, 9 frames), `squash = 1`
   (a grab on a plain snake does nothing); a snake that is rising or sinking is not hit.
7. The squashed snake follows Pepper's hammer: its frame = Pepper's frame - 1, and for Pepper's frames 2..8 the basket is replaced by the dented shape `KET(frame)` (placed on the basket's matrix, the previous shape hidden); when Pepper's clip is 10 or 1 or its frame is > 10 the snake is gone (state 0, hidden, lid closed, clip 3), the plain basket is back.
8. The skeletons cheer: `gems > 3, 7, 11, ... 31` advance skeleton 1 (clip 13) / skeleton 2 (clip 14) alternately one stage at a time (a stage ends when the clip finished).

The flash counter (`+0xf9`, `+0x130`: set to 8 on a hit) computes a value that is never used (dead code in the original); not ported.

## 6. Result, medals, variables, speech

Score > 100 = won (`FUN_00404d14(&next, exit == 2, 100 < score)` -> `story.miniGameExit`), 101 bronze, 5001 silver, 8501 gold (the code compares `score > 0x64 / 0x1388 / 0x2134`). Banner (mode 4): score at (320, 100), medal word
(`SGBRONZE` / `SGSILVER` / `SGGOLD` of STD.str) at (320, 150) when >= 101, the result line (`ADSGWS01` gold ... `ADSGWS04` below 101) at (320, 200), 28 characters wide. The result line is spoken (`ADSGWS01..04`, speech index = the voice field 1505..1508).
Variables (only raised): `HISCORE_WAS` (200) = max(old, score); `TROPHY_WAS` (0xd5) = max(old, medal); below 101 `if (var < 1) var = 0`. Intro: `ADSGWS06` ("Geef die slangen een klap...", voice 1510) at (320, 200), 28 wide, spoken at mode 0; help: 5 lines `CONTROL0..4`
(UP upper snake, DOWN lower snake, LEFT left snake, RIGHT right snake, "press twice for the gem"). `ADSGWS05` ("Sissss") and `WAS1..4` ("Gemept", "Mis", ...) are in the string table but not used by this zone's code.
The HUD (generic `Hud`): overlay texture 0 (red gem) at (20, 20) with the gem count, texture 1 (hit counter) at (716, 20) with the hits, the clock at the top centre; the constants of `FUN_0045fd45` match `hud.ts` (60 x 60 icons on the 800 x 600 grid, text baseline y = 69, x = 100 / 699 / 400).

## 7. Sounds (ids of the sound table; `SND` in rules.ts)

`SND_WAS_FLIP_*` 0x164..0x167 (snake at the top, by basket 0x165, 0x166, 0x164, 0x167), `SWISH1..5` 0x168..0x16c and `XSWISH1..3` 0x16d..0x16f (3D at Pepper), `SNAKE_*` 0x170..0x173 (lid pops, by basket 0x171, 0x172, 0x170, 0x173),
`CLOCKLOW/MID/HIGH` 0x174..0x176, `GRUNT1/2` 0x177 / 0x178, `OUTOFTIME` 0x1c3, `HIT_*` 0x1c4..0x1c7 (by basket 0x1c7, 0x1c4, 0x1c6, 0x1c5), `GASP` 0x1cf, `GETCRYSTAL` 0x1d0, `TORCH` 0x373 (loop, 3D table entry used as a 2D loop).
`BIGTHUMP` 0x1c8 / `BIGSWING` 0x1c9 are loaded by the zone and never played.

## 8. Known differences, approximations, not ported

* **Torch fire**: wired (WP-PART-WIRE, verified): the four `wasfire.par` emitters of the constructor 0x69b42b / 46a / 4ab / 4ec on the `WAS ` record, rotation -pi/2 about x, gate (2,1,1) = always on, offsets read from the asm (`src/zones/z17WAS.ts`).
* **Music** starts with the zone (`audiohost.enterZone`), the original starts it when the game starts (`FUN_004432c0` when leaving the help screen).
* The original's random numbers: `ftol(FUN_004388ae((float) FUN_00435c91())) & 3` (basket) / `% 3` (gem holder) and `ftol(FUN_004388ae(8.0))` (the grunt). The port's default `crtRng` (`WasRng.int(n)`) draws them exactly (WP-TIME): `randF` of `src/game/crt.ts` (float32 `rand() / 32767 * x`) on the shared C runtime generator, scaled by the REAL milliseconds since the zone clock base (`startTickClock()` = FUN_00435c81, called with `seedFromTime()` = `srand(time())` of FUN_00699dc7 at the zone's first start; a restart loops in place and neither runs again). `WasRng` stays injectable for the node tests; the oracle test pins the generator (`setRandSource`) and the clock (`setTickCountSource`).
* `DAT_05d5be54` / `DAT_05d5be50` (final score / gems) and `DAT_00925e58` (clip) persist across restarts like the original's statics (WP-MINI: `WasShared` statics; only `DAT_05d5be4c` is cleared at 0x69b864).
* The `GEMM` record's second flag word (`+0x62 = 0x20`) is set (record flags are one 32 bit word: `0x20 << 16`). The snake's bone-10 pose is read one frame behind like the original (M5 audit: `pose(1)` before the advance).
* Port-only: records that are moved by teleport (a spawning snake, a dented basket, the gem when it appears) get `savePrev()` so the renderer does not interpolate across the jump; a spawn loop cannot hang with a degenerate random source.
* The intro text is drawn by the zone at (320, 200) / 28 characters (the loop's own call), not at the runner's generic (320, 120) / 30: `introId` is null and `config.intro` is true.
* The runner's generic `say()` returns false while muted (no speech engine); the result line and the intro are drawn by the zone anyway, only the subtitle copy is missing then.
* Time step (WP-TIME): the original multiplies by the frame time `DAT_008b1718` and the port does the same with `world.dt` (1.0 for the first frames, then 0.5 at the fixed 60 Hz step): the clock counts 0.5 per step (2700 game ticks = 90 s), the animations step by `rate * dt`, the end banner's cheer clip too (`bannerTick`: `FUN_0043b76a(Pepper, 1.0)` multiplies by dt inside), the pepwas start-up timer is `ftol(15.0 * DAT_008b1718)` of the step time at construction (7 at dt 0.5), the other counters are integers per frame. All arithmetic is float32 per operation in the original's order (the oracle `m5-audit-z17WAS-emu` compares at tolerance 0, dt 1 and 0.5). Not modelled: the port's world starts at dt 1.0 while the original's constructor sees the previous zone's last step time (normally 0.5 after the hub: timer 7 instead of 15 at the start of the first game, a 0.25 s difference in when the first button press is accepted).

## 9. Tests, runs

`node tools/test-formats.mjs --only m3-z17WAS` (191 checks): the constructor addresses of the set-up's attaches and the record table; the medal thresholds, variable ids, the score immediates (+300 twice, +70, cap 10000), the node constants, the clip numbers `pepwas` queues, the sound ids
`FUN_00699950` loads and their table names, strings in the EXE; Pepper's button state machine (wind-up, whack, double press, ignored buttons, busy window); one snake (spawn tick 15, up at tick 20, gone at tick 76); whack (score 70, KET shapes shown, reset); grab (+300), whack on the holder (nothing), escaped holder (-300, clamp at 0), grab clip on a
plain snake (nothing), hits on rising / sinking snakes (nothing), the cap; the clock (2701 ticks, 17 clock sounds 4 / 4 / 8 / 1, first at tick 2192), the spawn gaps 15 / 19 / 24 at 480 / 930, the skeleton stages, a scripted **LOSS** (no input: score 0, result 2, sad clip),
a scripted **WIN** (bot that whacks every snake: 6930 points, silver, result 1, cheer clip) and a bot that also grabs the gems with a fixed random seed (10000 points, 23 gems, gold), the result variables.

Browser (headless, muted; the dev server of the repo, or any other port):
```
node tools/browse.mjs "http://localhost:5499/?zone=z17WAS&mute=1" tools/steps/m3-z17WAS.mjs      --size 1280x800 --out /tmp/m3/z17WAS   # intro, help, bot with real key presses, gem, banner, variables, Continue -> story
node tools/browse.mjs "http://localhost:5499/?zone=z17WAS&mute=1" tools/steps/m3-z17WAS-loss.mjs --size 1280x800 --out /tmp/m3/z17WAS   # pause menu (page 18), no input -> LOSS, retry, abort
node tools/browse.mjs "http://localhost:5499/?zone=z16PYA&mute=1" tools/steps/m3-z17WAS-entry.mjs --size 1280x800 --out /tmp/m3/z17WAS   # entry through the story (F9 in the hub)
```
Last results: win run 1140 / 1810 / 930 points depending on the bot's luck (bronze), `HISCORE_WAS` / `TROPHY_WAS` written, result menu page 16, Continue -> z16PYA at story node 38; loss run: pause page 18 (clock stands still), banner score 0, no medal, page 19, retry restarts the zone (second attempt, clock
2700), abort -> z16PYA at node 36; entry from z16PYA with F9 -> z17WAS intro. Screenshots looked at: intro panel with `ADSGWS06`, help panel with the five control lines, play view (baskets with lids and red snakes, Pepper behind them, skeletons at both sides, gem / hit icons, clock, score), gem holder close-up, dented baskets
(KET3 flat with a burst, KET5 tall, KET7 / KET8), banner (score, `BRONS!`, the ADSGWS03 line, Pepper cheering), result menu "VOLTOOID" (continue / restart), loss banner and menu.
The browser runs shorten the clock through `__zone.world.records[22].ctrl.nodes[0].timeLeft` (the 2700 ticks are covered by the node tests).

## Shortcuts

* `?zone=z17WAS` starts the zone at its story node (37, sub-game 14); there is no stub aid (F9 / F10) for it because the zone has its own game.
* `window.__zone.game.debug()` returns `{ score, gems, hits, timeLeft, elapsed, state[4], hit[4], holder, squash, stage, done, finalScore, clip, pepClip, pepFrame, busy, presses, timeText }`;
  the nodes are `__zone.world.records[0].ctrl.nodes[0]` (`pepwas`) and `__zone.world.records[22].ctrl.nodes[0]` (`zonewas`: `timeLeft`, `score`, `gems`, `shared.rng`, `shared.sounds`).
* Keys in the game: arrow keys / WASD = the four baskets (press twice quickly at a snake with a gem).

## Notes for M4 (island)

* The story node 37 -> 38: a won game sets `COMPLETE_SUB_GAME` and advances through `story.miniGameExit`; the island totals (`HISCORE_WAS` in the Adventure sum, `TROPHY_WAS`) are only written here.
* `GameRenderer.fov` (the zoom) is a per-zone property: other zones that call `FUN_0040cd1a` with something else than 1.0 can set it the same way.

## Closure 2026-10-31 (fork C)

Section 8 re-read: the last 'not modelled' sentence of the time-step bullet (the constructor sees the previous zone's last step time) is closed: `playzone.ts` carries `sh.dt` into the new world (`world.dt = sh.dt`, the original's `DAT_008b1718` is a global that only the zone loops' `FUN_00443e40` write; the frame counter, which makes the first five passes 1.0, is reset per zone by `FUN_004237b6`), so the pepwas timer `ftol(15 * dt)` sees 0.5 after the island's loop like the original. The flash counter (+0xf9 / +0x130) is dead code (nothing reads it); the `GEMM` second flag word is set; torch particles are wired. Nothing open.
