# z05WAB: Whack-A-Bot ("Botten meppen", M3)

Mini-game of the island (zone table index 5, story node 10 after the island nodes 8 / 9; the island sends Pepper here when he walks into the WAB door: `NEXT_SUBGAME` = 5).
Pepper stands on a spot behind a red platform with four trap doors (up, left, right, down). One Brickbot at a time pops out of a random hole; Pepper whacks it with the four
direction buttons. In one bot in eight the Infomaniac pops out instead and must not be hit (it stuns Pepper). 90 seconds per game; the score is the hit percentage x 100,
medals at 5000 / 8000 / 9000 (bronze / silver / gold); 5000 (50 %) completes the story step.

Code: `src/zones/z05WAB.ts` (registration), `src/zones/z05WAB/wab.ts` (all game logic, pure, no DOM), `src/zones/z05WAB/game.ts` (the `ZoneGame` for the shell). Test:
`tools/tests/m3-z05WAB.mjs`. Browser: `tools/steps/m3-z05WAB.mjs`.

## 1. What the executable does (functions)

| address | function | role |
|---|---|---|
| 0x56905a | `FUN_0056905a` | the zone loop (loop template, architecture.md 2.3): opens `data\z05WAB.bob`, set-up, mode machine 7 / 0 / 1 / 9 / 2 / 3 / 4 / 5 / 8. Mode 0 shows `LESGWB11` at y 100 (zone table, wrap 30) and speaks it; mode 9 = controls help of 4 lines (`FUN_00461155(strfile, 4)`), the music starts when play starts (`FUN_004432c0`); mode 2 draws the HUD (`FUN_0046055f`) and watches `DAT_05d58864` (game over); mode 4 is the banner (score, medal, lines), mode 5 the result menu (`FUN_0041c092(&mode, 0, (score < 5000) + 1)`); the exit goes through `FUN_00404d14(&next, exit == 2, 4999 < score)` |
| 0x569ca6 | set-up | `FUN_00442900("z05wab")`, fog `FUN_00442d90(4, 100, 100, 10, 0, 0)` (already read by `zoneparams.ts`), sounds `FUN_00569dd0`, loader `FUN_00570679`, controllers `FUN_00569bf3`, music `Z05WAB1` (`FUN_00443290`), strings `LI/Data/wab.str`, HUD set `Overlays/z05WAB` (`FUN_00569b80`), camera `DAT_009da5e0 = 4` + `FUN_00422b50(&cam, PEPP matrix, 4)` |
| 0x569bf3 | controllers | attach `pepwab` (ctor 0x56cd3b) on record 0 (PEPP) and `botwab` (ctor 0x56b2d5) on record 1 (LAND), gate var 2 (always) |
| 0x569dd0 | sounds | 12 x `FUN_00443580(id)` (2D) and 3 x `FUN_004433b0(id)` (3D) = sound-table ids 0x1dd..0x1ef (section 5) |
| 0x56cd3b / 0x56c950 | `pepwab` ctor / update | Pepper's hammer: input, swing clips, stun, camera (section 3) |
| 0x56b2d5 | `botwab` ctor | the state of the game (section 2) |
| 0x569f50 | `botwab` update (430 lines) | one tick of the game: bots, scoring, clock, difficulty, end |
| 0x56bb20 | presentation | every 2nd tick: gears, TV face, radar dial, lids |
| 0x56c6a5 | whack animation | stages BOT1.. / INF1.. |
| 0x56c8f1 | alarm light | `FLSH` texture frame in the last 16 s |
| 0x56b1dc | hide all | flags = 0 of the four current bot records |
| 0x56ce50 / 0x570679 | builder / loader | records and models (read by `extractZone` / `extractZoneSetup`) |
| 0x569ef9 | tear down | stops the three looping sounds |

## 2. The botwab node (`BotNode`, node struct of 0x194 bytes on the LAND record)

Records of the scene (48): 0 PEPP, 1 LAND (the room WABROOM), 2 G000 / 3 G001 (the two tape reels, they spin), 4..7 LIDD / LIDR / LIDU / LIDL, 8..23 BOT1..BOTG,
24..39 INF1..INFG, 40 INFO, 41..44 BOTT (the resting bot of a hole), 45 FLSH (alarm light), 46 / 47 FLOW (flowers). The node reaches them by index.

**Holes**: hole 0 = up / far = BOTT record 44 (lid LIDU), 1 = left = record 42 (LIDL, x +1.77), 2 = right = record 41 (LIDR, x -1.74), 3 = down / near = record 43 (LIDD). The
camera looks from +z towards -z, so +x is the left of the screen. The key -> hole mapping is Pepper's swing clip: clip 5 (Up button) -> hole 0, 6 (Left) -> 1, 7 (Right) -> 2, 4 (Down) -> 3
(`DAT_008f6c00 - 4` switch of `FUN_00569f50`).

| offset | field (`BotNode`) | meaning |
|---|---|---|
| +0x14.. | `base[4]` / `cur[4]` (+0xdc) | resting bot record of every hole / the record currently shown for it (BOTT, BOTn, INFO or INFn) |
| +0xbc / +0xc0 | `WAB.RANGE` / `BASE_Y` | 1.6 (`0x3fcccccd`) rise and -1.44 (`0xbfb851ec`) hidden y of a bot |
| +0xec / +0xf0 | `timeLeft` / `elapsed` | 2700.0 (`0x4528c000`) counting down, ticks played |
| +0xf4 / +0xfc / +0x104 | `state` / `whacked` / `isInfo` | per hole: 0 hidden, 1 rising, 2 up, 3 falling; hit by Pepper; the bot is the Infomaniac |
| +0x10c / +0x11c | `y` / `tUp` | current y, the tick (`ftol(elapsed)`) the bot reached the top |
| +0x12c | `clockOn` | the clock is shown (it blinks in the last 16 s) |
| +0x12e / +0x12f | `hits` / `misses` | bytes |
| +0x130 / +0x134 | `WAB.RISE` / `FALL` | 10.0 and 13.0: a bot rises in 10 ticks (0.16 per tick) and falls twice as fast (6.5 ticks) |
| +0x138 / +0x13c | `hold` / `gap` | ticks a bot stays up and ticks between two bots: 29 / 12 at the start |
| +0x188 | `lastDown` | `ftol(elapsed)` when the last bot went down (init -1) |
| +0x158.. +0x168 | `c158 c15c c160 c164 c168` | the free-running animation counters of `FUN_0056bb20` (every 2nd tick +1, `c164` +2.25, `c168` the flash counter) |
| +0x16c | `c16c` | countdown of the 2-tick animation step (1.0 at the start, reset to 2.0) |
| +0x170 / +0x17e | `reactT` / `reactKind` | the TV reaction (timer -1 = idle; kind 0..3 = the whacked hole, 4 = the red cross) |
| +0x174 / +0x180, +0x178 / +0x182, +0x184 | `openT/openHole`, `closeT/closeHole`, `lidDone` | the lid animations (timers -1 = idle) |
| +0x18e / +0x190 | `hitStage` / `hitT` | the whack animation (stage 0..8 shows BOT1..BOT9 / INF1..INF9) |
| +0x17c / +0x17d | `mark1740` / `mark780` | written only (limits 1740 / 780 ticks left); +0xa8..+0xb6 (eight u16 constants 60 / 400 / 320), +0x140, +0x142, +0x18c, +0x18d are write-only too: not ported |

One tick of `FUN_00569f50` (`BotNode.update`):

1. `FUN_0056bb20` (presentation, section 4).
2. ambient loop sound (every tick); if `hitStage >= 0`: `FUN_0056c6a5`; if `timeLeft < 480`: `FUN_0056c8f1` (flash frame `ftol(c168) % 6`) and the two alarm loops.
3. `timeLeft <= 0`: **game over** (once): bots put back to y -1.44, the four lid z set to their closed values (`0x40f04189 / 0x40b74396 / 0x407ea7f0 / 0x40b753f8`), `DAT_05d58864 = 1`,
   current bot records hidden (`FUN_0056b1dc`), `DAT_05d58860 = hits / (hits + misses) * 100` (a float; NaN for 0 / 0), alarms stopped, Pepper plays clip 3 (win) when the percentage is
   >= 50 (`0x42480000`) and clip 2 (stunned) otherwise.
4. else `timeLeft -= 1`, `elapsed += 1`, then the HUD strings (`%02d:%02d` of `ftol(timeLeft / 30)`; empty when `clockOn` is off; hits; misses; `"%2d%%%%"` = percentage truncated, `"0%%%%"`
   without bots), the clock blink (below 480 left: toggle when `ftol(elapsed) % 5 == 0`), the two time marks, the difficulty stage:

   | time left | hold | gap |
   |---|---|---|
   | >= 1830 | 29 | 12 |
   | 930 .. 1829 | 25 | 10 |
   | 480 .. 929 | 22 | 8 |
   | < 480 | 20 | 8 |

5. per hole with `state != 0` (the position of the last one is kept for the sounds, `active` counts them): state 1: `y += 1.6 / 10`, at `y >= -1.44 + 1.6` -> `y = top`, state 2,
   `tUp = ftol(elapsed before the increment)`; state 2: when `hold < elapsed(before) - tUp` -> state 3 and the close sound of the hole; state 3: `y -= 2 * 1.6 / 13`, when
   `y <= -1.44` and no lid is closing and the previous lid finished opening (`lidDone == 0`) the lid closing animation starts; at the bottom: state 0, `lastDown = ftol(elapsed)`, the
   record is hidden, **a bot that is neither whacked nor the Infomaniac is a miss** (`misses++`, TV red cross), the hole gets its resting record back.
6. with no active hole: all four current records hidden and reset; when `lastDown + gap < elapsed` (the post-increment value) a new bot: the hole is `random & 3`, state 1, the open sound of
   the hole, `whacked = 0`; `random & 7 == 0` makes it the Infomaniac (record INFO gets the matrix of the hole's record and replaces it, `isInfo = 1`); visible flags |= 3; the lid
   opening animation starts. The first bot comes on the 12th tick.
7. **Pepper's hit**: when Pepper's animation frame is in [12, 13) and his clip is not 1 (idle): the hole of the clip (above). A bot that is not fully up (`y < top`): only the miss sound
   (3D, at the position of the active hole; the original passes uninitialised stack data when no hole is active and plays nothing). Fully up and not whacked: bot: `hits++`, with
   chance 2/8 a spoken line (`LESGWB09` "Terug de zee in." / `LESGWB10`), TV arrow, whack animation, `SND_HIT_BOT`; Infomaniac: `SND_HIT_INFO`, a line `LESGWB06..08`
   (`random % 3`), **Pepper stunned for 90 ticks** (`0x42b40000`), TV red cross, whack animation; then `whacked = 1`. (The original also tests `state == 1 || state[stale local] == 2` and
   would send a rising bot down: a fully up bot is in state 2, so the test never holds; ported literally.)
8. the UV scroll `FUN_0043ebe0(LAND model, 0x1642, 23.0, 0.0003)` (section 4).

Randomness: `FUN_00435c91` returns `GetTickCount() - base`; `FUN_004388ae(x)` = `rand() / 32767 * x`; `ftol(...) & 3` / `& 7` / `% 3`: a uniform pick. The port uses a host
`random(n)`: the zone game binds `crtPick(n)` = `ftol(FUN_004388ae((float) FUN_00435c91())) % n` exactly (WP-TIME: `randF` of `src/game/crt.ts` = the float32 `rand() / 32767 * x`, scaled by the REAL milliseconds since the zone clock base `startTickClock()` = FUN_00435c81; the seed is `srand(time())` at the zone's first start, FUN_00569ca6, the clock base again at every restart as the loop prologue does); the tests pin the generator (`setRandSource`) and the tick clock (`setTickCountSource`) and the oracle replays the same values.

## 3. The pepwab node (`PepNode`, node struct 0x1c bytes on PEPP)

`+0x15` clip (1 at the start), `+0x16` result of the last `FUN_0043b76a(anim, 1.0)`, `+0x17` busy (1 at the start), `+0x18` start-up lock (15 ticks). Pepper's clips in this zone's
`MFIG.blk` (8 chunks): 1 idle (35 frames), 2 stunned / lose (90), 3 win (55), 4 down, 5 up, 6 left, 7 right (27 frames each). Each tick (while `DAT_05d58864 != 1`):
matrix rebuilt from the yaw, animation advanced by 1.0; when a non-idle clip ended (result 2): back to clip 1 (clip 2 while stunned), busy cleared unless stunned;
`stun -= 1` (busy while > 0); when not busy and a button went down: left (1) -> clip 6, down (8) -> 4, right (2) -> 7, up (4) -> 5 (later tests win), the swing sound, clip started,
busy = 1; the start-up lock counts down 15 ticks and clears busy. **The hammer lands on frame 12 of the 27 frame swing** (checked by `botwab`, which reads Pepper's clip from
`DAT_008f6c00` and his frame). The node returns "stop chain", so the stub walk node the set-up adds for zones without player code never runs and Pepper does not walk.

**Camera**: `FUN_00422b50` preset 4 at set-up: eye = Pepper's matrix * (0, 10.4, 24) (table 0x8adbf8 + 4 * 12) = (0, 10.4, 22.8), target = Pepper + (0, 4, 9.6) (0x8adc60..68); each tick
`FUN_00422c7e(cam, PEPP, 4, 0)` sets the target to Pepper's position and `FUN_00422ddc(cam, 0, 4)` holds the eye height. The eye never moves. The camera looks from +z towards -z.

## 4. Presentation (what the room does)

`FUN_0056bb20`, every 2nd tick (`c16c`): `c158 c15c c160 += 1`; when Pepper is not in clip 2: `c164 += 2.25` (wraps above 8) and the two tape reels G000 / G001 rotate about z by
`0.009 * percentage` rad (matrix rebuilt from the Euler angles); **texture frames** (`FUN_00443120(model, 0, slot, 2, frame)` = `FUN_00411202`: freeze an animated `.wib` texture on a
sequence entry, `Renderer.setTextureFrame`): slot 0x1b of LAND (text026.wib, the radar dial, 8 frames): `ftol(c160)` (0..10, entries >= 8 are ignored by the original), `% 5 + 10` while stunned
(also ignored); slot 10 (text011.wib, the Infomaniac's TV, 24 frames): idle `ftol(c158) % 6` (static), a reaction (timer 0..9, one step per 2 ticks) by `reactKind`: 0 -> `% 3 + 6`
(arrow down), 1 -> `% 3 + 12` (arrow left), 2 -> `% 3 + 15` (arrow right), 3 -> `% 3 + 9` (arrow up), 4 -> `% 5 + 18` (red cross); the slot 0x1c call of the original hits a
plain TGA in this build and has no effect (not ported). The FLSH light (text038.wib, sequence 0,1,2,3,2,1,0) is frozen on entry 0 at the start and cycles `ftol(c168) % 6` in the last
16 s. The lids: opening / closing animations of 3 steps each (`openT` / `closeT` 0..3), one step moves 8 * 1.6 / 10 = 1.28 along the lid's axis (LIDU / LIDD z, LIDL / LIDR x) and 0.25 in y
(clamps: open 5.888 / 0 / 0 / 5.75, closed 3.979 / 1.775 / -1.743 / 7.508, y 2.0 / 2.358). The UV scroll (`FUN_0043ebe0(.., 0x1642, 23, 0.0003)`) adds 0.0003 to the V coordinates of
mesh group 23 (text022.tga, the printer paper) per call, **once per group of the mesh** (the original's loop runs `group count` times): 29 groups -> 0.0087 per tick
(`GameRenderer.scrollGroup`, `DrawOpts.uvOffset`).

## 5. Sounds, speech, music, game variables

* Sound-table ids (names from the EXE table): 0x1dd `SND_HAMMER_MOVE` (swing), 0x1de `SND_HIT_BOT`, 0x1df `SND_HIT_INFO`, 0x1e0 `SND_WAB_MISS` (the last three 3D, min 16 / max 128),
  0x1e1 `SND_WAB_AMBIENT` (loop, played every tick, stopped at the exit), 0x1ee / 0x1ef `SND_WAB_ALARM1 / 2` (loops in the last 16 s, stopped at the game over), opening sounds 0x1e8 TOP,
  0x1e6 LEFT, 0x1ec BOTTOM, 0x1ea RIGHT for hole 0, 1, 2, 3 and closing sounds 0x1e9 / 0x1e7 / 0x1ed / 0x1eb. (The original's hole 2 plays the sound named BOTTOM and hole 3 the one named
  RIGHT although hole 2 is the right one on screen: ported as it is, the pans (64 / 127) follow the names.)
* Speech (`messages/LI/Data/wab.str`): `LESGWB01` gold, `02` silver, `03` bronze, `04` + `05` below 5000 (a pair), `06 07 08` the Infomaniac, `09 10` a bot, `11` the brief. `WAB1..3`
  ("Gemept", "Mis", "Oh-Nee!") are not used by the code of the zone (floating texts of an older version); `CONTROL0..3` are the help lines.
* Music `Z05WAB1` (levels 2 / 3 exist in the table but are never requested), started when play starts (the port drops the music the runner starts at zone entry: `AudioHost.leaveZone`,
  then `enterZone` in `onStart`); `FUN_004432c0(music)` is called again at the banner (the segment is replayed): not reproduced.
* Variables: `HISCORE_WAB` (0x20) = max(score), `TROPHY_WAB` (0x40) = max(medal 1 / 2 / 3), written when the banner starts (nothing is written below 5000). The island's LGI totals are
  computed by the story code later (architecture.md 3.6). Success for the story = score >= 5000 (`cmp score, 5000; setge` before `FUN_00404d14`).
* Score = `ftol(percentage)` capped at 100, times 100 (`Math.imul`, so a game without any bot hit or missed, NaN, is 0). Medals `>= 9000 / 8000 / 5000`.

## 6. What the port does where

* The zone loop is the shared runner (`playzone.ts`): intro `LESGWB11` at y 100 (`zoneintro.ts`), help of 4 controls, pause menu page 18, result menu 16 (continue / retry, 5000+) or 19
  (retry / abort), the exit through the story (`miniGameExit`). `ZoneGame`: `onStart` (HUD on, music), `update` (HUD texts, result 1 / 2 when `DAT_05d58864` is set), `onBanner` (variables, result speech),
  `bannerTick` (Pepper's win / lose clip keeps playing: `FUN_0043b76a(Pepper, 1.0)` in mode 4), `draw2d` (the percentage line at (320, 400)), `drawBanner` (`ctx.banner`: score y 100, medal
  y 150, lines y 200 / 330).
* HUD (`FUN_0046055f`, state set by `FUN_00569b80`): left icon texture 0 + hits, right icon texture 1 + misses, the clock in the middle, from `Overlays/z05WAB`; shown in mode 2 only.
* Constructors are registered by address (`registerCtor(0x56cd3b / 0x56b2d5)`); the set-up attaches them from `ZoneSetup.attaches`, `Loaded.skipped` is empty.

## 7. Differences / approximations (honest list)

* **Particles are not drawn**: the four `bolts01.par` emitters on the holes (started with `FUN_00442a20(emitter, 2, 1, 1)` when a bot is whacked) and the `wabswirl.swl` swirl on the Infomaniac
  (started when he is whacked) need a particle renderer, which the engine does not have yet (rendering.md section 8). `botexpl01`, `exclaim01`, `wabinfo01` are in the archive but nothing in the
  zone code starts them.
* The 3D sounds (miss / hit bot / hit info) are played as 3D (`host.play3d`, listener = camera; A3).
* The percentage line is drawn from `draw2d` every frame instead of being queued by the update; the time strings lag one tick behind the counters exactly like the original's.
* Pepper's shadow (blob shadow of `GameRenderer`) is drawn as in the other zones; nothing in the original code of this zone suggests otherwise, but it was not compared.
* `FUN_00460a3d(0x16, 0x14, 0)` (the prompt panel of modes 0 and 4) is the runner's `drawIntroScreen` / `drawBannerScreen`.
* Random numbers: `crtPick(n)` (wab.ts) = `ftol(FUN_004388ae((float) FUN_00435c91())) % n` on the shared C runtime generator and the real zone clock (WP-TIME; the sequence is not reproducible by design: time seed and wall clock, as in the original).
* The hiscore / trophy are written in the first banner frame, the tick after the mode switch, like the original.
* The first 15 ticks (start-up lock) and the first bot at tick 12 mean a bot that comes first is whackable only at the end of its rise, as in the original.

## 8. Review

A Codex review of `wab.ts` against the decompile (FUN_00569f50, 56bb20, 56c6a5, 56c8f1, 56c950, the two constructors, the loop's thresholds, the camera functions) found no behavioural differences in
bot state timing, hole / record mapping, hit animation, lids, TV, Pepper's input, camera or the score / medal thresholds; its two remarks (uniform instead of tick-count based random numbers: exact since WP-TIME,
the variables written one frame earlier) are listed in section 7.

## 9. Tests and how to run

`node tools/test-formats.mjs --only m3-z05WAB` (about 0.4 s, 192 checks): constants against the executable (rdata floats, the immediates of the two constructors and of `FUN_00569f50`,
the compare constants of the loop 9000 / 8000 / 5000, the camera table, the sound-table names, the speech table indices of the `wab.str` ids), `scoreOf` / medal / percentage tables,
the set-up (attaches, records, holes under their lids, Pepper does not walk, camera), a scripted WIN (a bot that whacks every bot: 100 %, the game ends on the 2702nd update, the four
difficulty stages, clock, alarm, hits = bots - Infomaniacs, Pepper's win clip), a scripted LOSS (never pressing: 0 hits, every bot a miss, lose clip, red crosses on the TV), the start-up lock,
hammer timing (frame 12), miss on an empty hole, whacking, whack animation through BOT1..9, a late press, the Infomaniac (stun 90, no hit, no miss, no swing while stunned), only
Infomaniacs (NaN -> score 0), lids opening and closing, the clock and its blink, and the zone game through a stub shell (update 1 / 2, hiscore / trophy only raised, the result speech and
banner lines for bronze / silver / gold / failed).

Browser (headless, muted; the page is loaded without the Vite hot-reload client so other edits do not reload it):

```
node tools/browse.mjs "http://localhost:5499/?zone=z05WAB&mute=1" tools/steps/m3-z05WAB.mjs --size 1024x768 --out /tmp/m3/z05WAB      # ~4 min (a real 90 s game with a bot that presses the arrow keys)
WIN=0 node tools/browse.mjs ... (the same without the long win run)
```

The steps play the intro / help, a real win with keyboard events (screenshots, the banner, HISCORE / TROPHY variables, result menu 16, Continue -> the island, node 11), a loss (clock shortened to
10 s through `window.__zone.world.records[1].ctrl.nodes[0].timeLeft`), the banner, result menu 19, retry (`attempt` 1), the pause menu (page 18), abort (island, node 9) and the way back in from
the island (`var 5 = 5`).

## 10. Browser run (what was seen)

Headless screenshots (`/tmp/m3/z05WAB/wab-*.png`, looked at): the intro panel with `LESGWB11` and the help panel (4 key lines); the room (blue baseplate, grey brick wall, the console with the red platform and its four
lid tiles, Pepper with the hammer behind it, tape reels, flowers, the TV with the Infomaniac's face on the right, the red alarm light), HUD (hit icon + count left, miss icon + count right, clock, percentage line); a
bot coming out of the left hole with its lid slid away; the TV showing an arrow / red cross; the banner (score, `ZILVER!`, result line) and result menus 16 / 19; the pause menu 18; the island afterwards at node 11.
With a real-keyboard bot the win run scored 88 % (silver, 40 hits / 5 misses: two screenshots stall the page for a second each); without screenshots the bot gets all of them.

## Shortcuts

* `?zone=z05WAB[&mute=1]`: starts in the zone at story node 10; `window.__zone.game.debug()` returns the state (`timeLeft`, `elapsed`, `hits`, `misses`, `state[4]`, `isInfo`, `whacked`, `y`, `hold`,
  `gap`, `over`, `pct`, `score`, `stun`, `clip`, `busy`, `lock`, `tUp`, `pepClip`, `pepFrame`, `clock`, `pctText`).
* The node state is at `__zone.world.records[1].ctrl.nodes.find(n => n.kind === 'botwab')` (`BotNode`) and `__zone.world.records[0].ctrl.nodes.find(n => n.kind === 'pepwab')`.
* The old stub aids (F9 / F10) are gone for this zone; `tools/steps/shell-minigame.mjs` now runs on z08BKD (a zone without a port).

## Shared files touched

`src/render/renderer.ts`: expression sheets / frozen textures keep their frames (`TexAnim.frozen`), `Renderer.setTextureFrame(archive, id, mode, frame)` (FUN_00411202), `DrawOpts.uvOffset` + the `uUvOff` uniform;
`src/game/render.ts`: `GameRenderer.scrollGroup` / `groupCount` and the per-record UV offsets passed to `drawMesh`; `src/shell/audiohost.ts`: `AudioHost.stop(id)` (FUN_004435b0);
`tools/steps/shell-minigame.mjs`: moved to z08BKD.

## Closure 2026-10-31 (fork C)

Section 7 re-read against the code: the particle bullet is stale (the four `bolts01.par` hole emitters and the `wabswirl.swl` swirl are wired by WP-PART-WIRE, `src/zones/z05WAB/game.ts`); music start is A1; the random picks are exact since WP-TIME; Pepper's blob shadow is a non-issue (the zone never initialises the shadow system, so the original draws none: gaps.md R5, `extractShadowSetup`). The write-only fields (`mark1740` / `mark780`, the eight u16 constants, +0x140 / 0x142 / 0x18c / 0x18d) have no reader anywhere in the executable and are correctly not ported. The `FUN_00443120` slot 0x1c call hits a plain TGA (no animated texture): no effect in the original either. Nothing open.
