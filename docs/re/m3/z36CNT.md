# z36CNT: the centrifuge ("Centrifuge", G-force training, M3)

Mini-game of the story (zone table index 24, story node 59 after the island; the next node 60 is the parachute z38PAR). Pepper is strapped into the chair at the end of a
spinning arm in the training hall of Technician Bob. The arm turns faster the better the player hits the rhythm: **LEFT when the chair passes the left side of the screen
(the arm angle around 0), RIGHT when it passes the right side (angle around pi)**, two presses per turn. A good press adds score (20 + 5 per hit in a row, up to +100) and
0.01 power; two good presses in a row add another 0.01 when the window closes. At power 1.0 the arm runs at 15 degrees per tick (1.25 turns per second), the klaxon sounds and
490 points are added once. The game lasts 60 s (1800 ticks) after the start button; then the arm brakes. Medals: score >= 2000 bronze, >= 4000 silver, >= 6000 gold.
Success (result 1) = the hi-score `HISCORE_CNT` (var 0x9b) is at least 2000, failure (2) otherwise.

Code: `src/zones/z36CNT.ts` (registration, the `ZoneGame`, the two behaviour nodes, sounds), `src/zones/z36cnt/sim.ts` (all rules, pure, no DOM), `src/zones/z36cnt/pose.ts`
(placement of the arm / chair / weight / Pepper, motion-blur copies, the arm's shadows, pure), `src/zones/z36cnt/util.ts`. Test: `tools/tests/m3-z36cnt.mjs`. Browser:
`tools/steps/m3-z36cnt.mjs`.

## 1. What the executable does (functions)

| address | function | role |
|---|---|---|
| 0x7af067 | `FUN_007af067` (GameLoop.c) | the zone loop (loop template, architecture.md 2.3). Mode 1 draws the intro (`FUN_007afff6`: panel `FUN_00460a3d(0x16, 0x14, 0)`, `LESGCE01` at y 120 wrap 30, spoken once), mode 9 the controls help (`FUN_00461155(cnt.str, 4)`), mode 2 `FUN_007aef49` (HUD feed) and a check of `DAT_05d5d470`, mode 4 `FUN_007b0085` (banner), mode 5 the result menu `FUN_0041c092(&mode, 0, (result != 1) + 1)`; the exit goes through `FUN_00404d14(&next, exit == 2, result == 1)`. **The update pass (`FUN_0042226e`, i.e. the behaviour nodes) runs in modes 1, 2 and 4** (`0 < mode < 3 \|\| mode == 4`), not in 9 |
| 0x7afd2d | set-up | `FUN_007af780` (sounds), loader `FUN_007b48bc`, `FUN_007afbc0(1)` (controllers, camera, hidden records), fog `FUN_00442d90(26, 52.5, 52.5, 10, 0, 0)` (read by `zoneparams.ts`), strings `LI/Data/cnt.str`, HUD `FUN_007af9b0(Overlays/z36cnt)`, font `Data/fonts/main/main`; music `FUN_00435a07("silence", "cnt", 0)` = **no music** |
| 0x7afbc0 | controllers / camera | attach `FUN_007b20a8` (TRAI, record 18) and `FUN_007b2836` (TBOB, record 0), both gate var 2 = always; `FUN_0040cd1a(0x3f19999a)`: **zoom / vertical field of view 0.6 rad** (default 1.0); camera: target = TRAI + (0, 3.9, 0), eye = target + (0, 15, 30), up (0, 1, 0), fixed all game long; records 18 (TRAI), 1 (CHAI), 2 (WEIG) get flags 0 (the hook draws them) |
| 0x7b20a8 | TRAI controller ctor (Walk.c, 0x19c bytes) | constants, offsets CHAI / WEIG relative to TRAI, the seat offset, initial state (section 3) |
| 0x7b0c6e | state machine (290 lines) | one tick of the machine (section 4) |
| 0x7b0401 | input / lights | the windows, the lights, score and power (section 5) |
| 0x7b1a1b | draw hook (vtable slot 3) | places TRAI / CHAI / WEIG / PEPP, draws the motion blur copies and the arm's two shadows (section 8) |
| 0x7b2836 / 0x7b24a2 | TBOB controller ctor / update | the technician's animation machine (section 6) |
| 0x7aff48 / 0x7aff9f | monitor frame ranges | `cur = next; next = cur + step; frame = first of the range` / `frame += 1, wrap at the end` (section 7) |
| 0x7af902 | engine pitch | rates of the engine and swish loops (section 9) |
| 0x7aef49 | HUD feed (mode 2) | timer, score, gauge, klaxon, monitor texture (section 10) |
| 0x7b0085 | banner (mode 4) | score, medal, result lines and their speech (section 11) |
| 0x7b2460 | `FUN_007b2460(n)` | Bob's next state = `max(0, n)`, more than 3 -> 4 (`DAT_05d5d4e4`) |
| 0x7afe61 | shadow points | the five points of the arm shadow (section 8) |
| 0x7b204c | TRAI destructor | stops the engine, swish and ambient loops |
| 0x7b2910 / 0x7b48bc | builder / loader | records and models (read by `extractZone`) |

## 2. Records and assets

Scene records (20): 0 TBOB (Bob, at (0, 2.135, -16.49)), 1 CHAI (chair, (4.7, 5.976, 0.414)), 2 WEIG (counter weight, (-4.749, 5.972, 0.413)), 3 FLOR (the hall; its
texture list entry 6 is `text010.wib`, a 64x64 monitor animation of 110 frames), 4 RGRN, 5 RYEL, 6 LYEL, 7 LGRN (the four green / yellow indicator lights of the two sides),
8..11 LIGH, 12..15 LION (four ring lights, "off" / "on" variant each), 16 LLIT, 17 RLIT (the red "missed" lights), 18 TRAI (the arm), 19 PEPP. The archive's own `anim/MFIG.blk` has
16 clips (the zone's clips, not the island's): Pepper 1 idle (1 frame), 2 spin (60 frames, scrubbed by the power), 3 maximum G (15), 8 phew (90), 12 visor (56), 14 start (40), 15 seat
belt (57); Bob 5 idle (60), 9 / 10 / 11 / 6 button presses, 7, 4. All clips are one-shots. Sound ids 0xca..0xdc (section 9), speech `LESGCE01..09` (speech indices 752..760).
The camera is `zoneparams`' fog + the fixed camera above; the lights are the zone's `lights.lgt` (one directional light, ambient 0.2).

## 3. The TRAI controller object (`CentrifugeSim` fields, offsets of the 0x19c-byte object)

| offset | field | meaning |
|---|---|---|
| +0xd4 | | PEPP record (animation = `+8`) |
| +0xd8 / +0xdc | `K.OMEGA_MIN` / `OMEGA_MAX` | angular speed at power 0 / 1: `0x3d567704` (3 deg) / `0x3e860a63` (15 deg) per tick |
| +0xe0 | `K.BOOST` | `0x3c23d70a` = 0.01, power per good press |
| +0xe4 | `K.WINDOW` | `0x40300000` = 2.75: half width of the TOP / BOTTOM windows = 2.75 x OMEGA_MAX = 0.7199 rad (41.25 deg) |
| +0xe8 | `K.TIME` | `0x44e10000` = 1800 ticks (+0xec = 90.0, unused) |
| +0xf0 | `time` | ticks left, decremented by 1 per RUN tick |
| +0xf4 | `bonusHits` | good presses in the bonus phase (copied to `DAT_05d5d47c`, never displayed) |
| +0xf8 | `state` | 0 init, 1 belt, 2 ready, 3 run, 4 stop, 5 result, 6 done, 7 wait for Pepper's clip |
| +0xfc | `clip` | Pepper's clip (1, 2, 3, 8, 12, 14, 15) |
| +0x100 | `reached75` | power was above 0.75 once (decides the phew clip) |
| +0x104 / +0x108 | `latchL` / `latchR` | a press (also an early one) was made for the next / current left / right window |
| +0x10c | `bonus` | power reached 1.0 |
| +0x110 | `angle` | arm angle 0..2 pi (the record is turned by `-angle` about Y) |
| +0x114 | `power` | 0..1 |
| +0x11c | `streak` | hits in a row, 0..20 (`DAT_05d5d474` = HUD copy, never displayed) |
| +0x120 | `resetStreak` | request to zero the streak |
| +0x124 / +0x128 | `prevHit` / `hit` | the previous / the current window was hit |
| +0x12c | `score` | the score |
| +0x130 | `inWindow` | in a TOP / BOTTOM window |
| +0x134 | `launch` | 1 at the start: nothing counts until the arm passed +0.72 rad once (the START sound plays meanwhile) |
| +0x138.. | `mon` | monitor frame ranges: `cur`, `next` (+0x13c), `frame` (+0x140), `start` (+0x144), `end` (+0x148) |
| +0x14c | `swish` | the swish was played in this turn |
| +0x150 / +0x154 / +0x158 | `visorAngle` / `visorStep` (0.1) / matrix | the visor's rotation; the matrix (rotX, translation `0x3b449ba6, 0x3f3a5e35, 0x3d178d50`) is attached to Pepper's model as slot 5 (`FUN_0043e910`) |
| +0x198 | `visorFirst` | 1 until the first tick of clip 12 |

Zone globals shared with Bob and the loop: `DAT_05d5d4e4` Bob's next state, `DAT_05d5d49c` power for Bob (copied in state 3), `DAT_05d5d424` the **shown score** (counts up 17 per tick
towards `score`, set to `score` in state 5), `DAT_05d5d46c` score reached 2000 at the time-out (medal flag), `DAT_05d5d470` the result (0 / 1 / 2), `DAT_05d5d468` time for the HUD,
`DAT_05d5d48c` power for the HUD / pitch / klaxon, `DAT_05d5d420` the monitor frame, `DAT_05d5d3cc` LESGCE08 was spoken.

## 4. One tick of `FUN_007b0c6e` (`CentrifugeSim.step(pressed)`; `pressed` = `DAT_00983840`, the buttons that went down this tick)

0. every tick: ambient loop (`SND_CNT_AMBIENT`, `DAT_05d5d3e0`).
1. state 0: shown score 0, medal flag 0, -> 1. State 1 (**belt**): button 0x40 (BUTTON_3 = Shift) -> state 7, clip 15 (belt, 57 frames), Bob next 1. State 2 (**ready**): 0x40 -> state 7, clip 14
   (start, 40 frames), sound `SND_CNT_BRAKE_OFF`. State 7 does nothing; it ends through Pepper's clip (below).
2. state 3 (**run**): `FUN_007b0401` (section 5); `angle += (OMEGA_MAX - OMEGA_MIN) * power + OMEGA_MIN` (wrap at 2 pi); `DAT_05d5d49c = power`; engine pitch + `SND_CNT_ENGINE` each tick;
   when the angle first reaches 0.5 in a turn: `SND_CNT_SWISH` (re-armed below 0.5).
3. state 4 (**stop**, after the time-out): pitch, engine and swish sounds each tick; `score > 1999` sets the medal flag; `power -= 0.01`; lights RYEL / LYEL on, RGRN / LGRN / RLIT / LLIT off;
   the angle keeps running at the speed of the shrinking power; when `power <= 0` and the angle wrapped past the speed step it stops at angle 0, `SND_CNT_BRAKE`, and goes to state 5
   (never above 0.75) or plays Pepper's clip 8 (`SND_CNT_PHEW`, state 7) first.
4. state 5 -> 6 (**result**): engine / swish stopped, shown score = score; **if `HISCORE_CNT` (0x9b) < score**: `HISCORE_CNT = score`, `TROPHY_CNT` (0x86) = 0 when the medal flag is
   off, else 1 (< 4000) / 2 (< 6000) / 3. State 6 each tick: result = `HISCORE_CNT < 2000 ? 2 : 1` (the **hi-score**, not this run, decides; a bad run after a good one is "success", an
   equal score does not rewrite the variables). The loop leaves mode 2 for the banner when the result is not 0.
5. clip 12 (visor): at frames 27..28 `SND_CNT_VISOR`; the first tick: visor angle 0, step 0.1, monitor range 8 (frames 100..110); then at frames 26..34 the visor angle grows by 0.1 per tick
   (0.9 rad total); after frame 34 the monitor range 0.
6. monitor ranges (section 7), the four ring-light pairs by quarter turn (a quarter `(0, pi/2)`: LION3 + LIGH0 on, LIGH3 + LION0 off; `(pi/2, pi)`: LION0 + LIGH1; `(pi, 3pi/2)`: LION1 + LIGH2;
   `(3pi/2, 2pi)`: LION2 + LIGH3; the on / off variants hide the opposite one), the HUD feed copies, the score ticker (+17 per tick).
7. Pepper's clip: clip 2 is **scrubbed**: `frame = frameCount * power`; every other clip advances by 1 per tick; at its end: 8 -> idle + state 5; 12 -> idle + state 2; 14 -> clip 2, power 0,
   window state cleared, time 1800, **state 3**, Bob next 4; 15 -> clip 12; (others restart). Clip 15 plays the seat belt sound and `LESGCE09` at frames 20..21.

## 5. `FUN_007b0401`: the windows

The arm angle is normalised to (-pi, pi]; `win = 0.7199`. Zones (`CentrifugeSim.zoneOf`): TOP |a| <= win, RIGHT win < a < pi - win, BOTTOM |a| >= pi - win, LEFT -(pi - win) < a < -win. The chair is at screen **left**
at angle 0 (the camera looks along -z, +x is the left of the screen), so TOP = chair on the left = press LEFT; BOTTOM = chair on the right = press RIGHT.

* a left / right press plays `SND_CNT_BIGBUTTON` every time (also during the launch phase).
* launch phase (+0x134 = 1): `SND_CNT_START` each tick, nothing else; ends when the angle passes `win`.
* **TOP**: lights LGRN / LLIT off, LYEL / RGRN on, RYEL off; window active; a LEFT press with the left latch free: latch, hit, `SND_CNT_LGREEN`, power +0.01, score += 20 + 5 x streak, streak + 1 (max 20), bonus counter in the bonus phase.
* **BOTTOM**: mirrored (RGRN / RLIT off, RYEL / LGRN on, a RIGHT press, `SND_RGREEN`, the right latch).
* **RIGHT zone** (after TOP): if the TOP window was active: RGRN off; **no hit**: RLIT on, streak reset, `SND_RRED`; hit: RYEL on; two hits in a row (`hit && prevHit`): power +0.01 more; `prevHit = hit`, window closed, left latch released. A RIGHT press
  here sets the right latch, which **blocks the RIGHT press of the following BOTTOM window** (anti-mash). **LEFT zone** (after BOTTOM): the same for the BOTTOM window (LGRN off, LLIT, `SND_LRED`, right latch released) and a LEFT press sets the left latch.
* streak reset request (+0x120) -> streak 0; `time -= 1`; at 0: state 4, Bob next 1, clip 2, streak 0; power > 0.75 -> `reached75`; power >= 1.0: power = 1, once: clip 3 (maximum G), `bonus`, **score += 490**, speech `LESGCE08` (once per run).

A perfect player (left in every TOP window, right in every BOTTOM window as soon as the window opens) scores 10840 in the node test and in the browser run (9450..10840 in other runs of the step bot, depending on its key timing); the gold limit
is 6000, bronze 2000. A player who only presses right in the top window or never presses scores 0.

## 6. Bob (`FUN_007b24a2`, `CentrifugeSim.bobStep`)

State 7 waits until the clip is about to end (`frameCount < speed + 1 + frame`, `FUN_0043b92a`), then enters `DAT_05d4e4`. States: 0 / 3 idle clip 5; 1 clip 9, next 2; 2 clip 10, next 3; 5 clip 7, next 3; 6 clip 4, next 3;
**4 (random, while the machine runs)**: `rand() >= power` -> idle clip 5, else `trunc(rand * 4)` picks clip 9 / 10 / 11 / 6 with `SND_BOB_BUTTON1..4`; speed `3 * power + 1`. The machine sets next = 1 on the belt button (clips 9, 10, then idle),
next = 4 at the start, next = 1 at the time-out. The start state is 7 with next 0.

## 7. The monitor (FLOR's `text010.wib`)

`FUN_00443120(floorModel, 0, 6, 2, frame)` pins texture list entry 6 of the floor (`text010.wib`, 110 frames) to frame `DAT_05d5d420` (mode 2 = frozen, `Renderer.setTextureFrame`). Ranges of the table at `0x944268`:
0: 0..0, 1: 0..9, 2: 10..40, 3: 40..51, 4: 51..67, 5: 67..87, 6: 87..98, 7: 98..98, 8: 100..110. Start: range 7 (frame 98; modes 0 / 1 also pin 98). A finished range 0 / 2 / 4 / 6 picks by power
(< 0.125 -> 0; < 0.5 -> 1; < 0.75 -> 3; else 5; stays when `next + 1 == cur`), a finished range 1 / 3 / 5 continues with `cur + 1`, 7 / 8 never change by themselves (8 runs during the visor clip). The table is read from the executable at run time.

## 8. Placement, motion blur, shadows (`pose.ts` `blurCopies`, `armShadows`; `z36CNT.ts` draw hook; FUN_007b1a1b)

The hook is the TRAI node's draw hook (TRAI = record 18: the draw pass calls it at TRAI's turn, after the records 0..17 and before PEPP). Its loop, instruction for instruction in 24-bit x87 (Direct3D leaves single precision, `src/zones/common/x87.ts`):
`power` = the float at +0x114, `N0 = ftol(5 * power) + 1`, `a = (0.2 * power) * N0` (float), `tilt = power * 1.5707964`, `N = N0` (1 when `DAT_00987660` is set, but `a` keeps N0), alpha step `60 / N`. The working matrix starts as a copy of TRAI's record matrix (`FUN_0043a5e4(0, -angle, 0, position)`
of `FUN_007b0c6e`), is turned about y by `a` (`FUN_0043ad29`) and then, before every draw `j = N - 1 .. 0`, by `-(a / N)`: copy j sits j steps back and the REAL copy (j = 0) carries the accumulated float noise. Per iteration: WEIG = (rotZ(-tilt) at its offset from TRAI) x working,
CHAI = (rotZ(+tilt) at its offset) x working, PEPP = seat translation (0, -3.2, 1.6) x CHAI (all written into the records: the last iteration is what stays); `FUN_0043ebe0(model, 3, &alpha, 0)` sets the alpha of TRAI, CHAI, WEIG **and PEPP** (alpha 255 for j = 0, else `70 - ftol(j * (60 / N))`), then the draw of the three
machine models only: `FUN_0043f1a0(model object, matrix, part 0, mode)` with mode 1 for j = 0 and **mode 7 (state preset 26, blended, no z test) for the copies**, in the order TRAI, CHAI, WEIG. **Pepper is not drawn by the hook** (only his alpha is set, to 255 by the last iteration): he gets no blur copies and no attachment copies; he is
drawn as an ordinary record (after TRAI). TRAI / CHAI / WEIG have flags 0 (`FUN_007afbc0`), so they are drawn only here. After the loop the hook draws the two blob shadows of the arm: the five points of `FUN_007afe61` (a trapezoid along +x at y 0.8: (4, .8, 0), (1.6, .8, .8), (1.6, .8, -.8), (8, .8, -1.6), (8, .8, 1.6) in the order of the table at 0x9442b0)
transformed by the real copy's arm matrix (`FUN_0043ab72`), the second one with the matrix turned by pi, through `FUN_0087dd20(shadow, 2, points)` + `FUN_0043f1a0(shadow, ..., mode 0)` (shadow mode 0; the port used mode 2 before WP-MINI).
Port: `GameRenderer.drawPart0(record, matrix, alpha | null)` (LOD part 0 at a matrix, mode 1 / preset 26 + alpha, no culling) and the now public `drawShadowPoints`; the TRAI node's `draw` hook calls them in the original's order and the three records stay disabled.  The placement runs in the node's update (the hook's inputs, the controller's angle / power, are the ones of the last tick): no interpolation between ticks, like the original, which draws once per update.
Verified bit for bit (`m5-audit-z36CNT-emu`, section "placement"): the original hook runs in the x86 interpreter at cw 0x7f with its draw calls recorded; for 120 random angle / power pairs (power 0, 0.2, 1 included) every loop iteration's model order, matrix (16 float bit patterns), mode and alpha, the CHAI / WEIG / PEPP records and the two shadow polygons equal the port's (0 differences).

## 9. Sounds and speech

| id | name | use |
|---|---|---|
| 0xca | `SND_CNT_AMBIENT` | loop, every update tick |
| 0xcb | `SND_CENT_SEATBELT` | belt clip frames 20..21 |
| 0xcc | `SND_CNT_VISOR` | visor clip frames 27..28 |
| 0xcd | `SND_CNT_PHEW` | phew clip start |
| 0xce | `SND_CNT_BIGBUTTON` | every left / right press |
| 0xcf | `SND_CNT_START` | launch phase |
| 0xd0 | `SND_CNT_BRAKE_OFF` | start button |
| 0xd1 | `SND_CNT_BRAKE` | the arm stops |
| 0xd2 / 0xd3 | `SND_CNT_ENGINE` / `SND_CNT_SWISH` | loops; rates `0x3880 + 0xfd94 p` / `0x204c + 0x8bf8 p` Hz (`FUN_007af902`, power of the previous tick); the swish once per turn |
| 0xd4 / 0xd6 | `SND_CNT_LRED` / `SND_RRED` | missed left / right window |
| 0xd5 / 0xd7 | `SND_CNT_LGREEN` / `SND_RGREEN` | good left / right press |
| 0xd8 | `SND_CNT_KLAXON` | loop while the power is exactly 1.0 (HUD feed), stopped otherwise |
| 0xd9..0xdc | `SND_BOB_BUTTON1..4` | Bob's button clips |

Speech (`cnt.str`, voice = speech index): `LESGCE01` (752) the brief, `LESGCE09` (760) in the belt clip, `LESGCE08` (759) at full power; banner: gold `LESGCE02` + `03` (753 / 754), silver `04` (755), bronze `05` (756), no medal `06` + `07` (757 / 758). No music
(`FUN_00435a07("silence", ...)`: the zone has no entry in `ZONE_MUSIC`). The sounds are loaded up front (`CntSound.preload`); loops are re-triggered every tick like the original (play on a playing slot only refreshes the volume).

## 10. HUD (mode 2, `FUN_007aef49` -> `FUN_0046055f`)

Right text (x 699 right aligned, y 69 of the 800x600 grid): the time left in whole seconds `ftol(time) / 30`; centre text (x 400, y 69): the shown score `%d`. No corner icons. **The gauge `FUN_00460214(732, 696, 716, state)`**
(new generic `Hud.gauge`, `HudGauge`): twelve 32x16 segments from y 508 upwards at x 732 (textures of `Overlays/z36cnt`: 3 for segments 0..3 (green), 2 for 4..7 (yellow), 1 for 8..11 (red)), a 32x32 marker (texture 0) at x 696 whose centre
is at y `508 - 192 * power`, the icon (texture 4, 60x60) at (716, 516). The klaxon plays while `power == 1.0`. The HUD is drawn in mode 2 only.

## 11. Banner (mode 4, `FUN_007b0085`)

Panel of `FUN_00460a3d(0x16, 0x14, 0)`; the shown score at y 100, the medal text (STD.str `SGBRONZE` / `SGSILVER` / `SGGOLD`) at y 150 and the lines (wrap 30): no medal `LESGCE06` y 200 + `LESGCE07` y 320; bronze `LESGCE05` y 200; silver `LESGCE04` y 200;
gold `LESGCE02` y 200 + `LESGCE03` y 380. The medal shown is the flag + the score of this run (not the hi-score). Result menu: page 16 (continue / retry) for 1, page 19 (retry / abort) for 2. The update pass keeps running in the banner (Bob goes on).

## 12. Port notes, differences, open points

* **Closed (WP-MINI)**: the motion-blur copies (mode 7 = preset 26 without z, drawn in the hook in the original's order, only TRAI / CHAI / WEIG: Pepper has no copies), the arm shadows (the points go through the original's matrix code, shadow mode 0) and the placement in 24-bit x87 (bit exact, see section 8).
  TRAI / CHAI / WEIG stay hidden (flags 0) and are drawn only by the hook, as in the original. `DAT_00987660` (the "one copy" switch) is the port's `camera.vehicle`, false here. Not exact: none known (the sound is verified by ear only in the muted run).
* The player record's walk chain that `setupZone` adds as a stub is removed; the blob shadow of Pepper is switched off with `PEPPERSSHADOW` (var 0xc5 = -1, restored on exit); the fixed camera and the 0.6 rad field of view are set in the zone game (`gr.fov`). The visor matrix is `FUN_0043a5e4` (24-bit, `euler24`).
* The visor's attachment matrix reaches the renderer through `GameRenderer.attachLocal` (slot 5 of Pepper's model); the angle follows the original's counter (0.1 per tick for 9 ticks).
* Verified only in the muted browser: the sound calls themselves are checked in the node test at the sim level (ids, order, pitch), not by listening.
* The values `DAT_05d5d474` (streak), `DAT_05d5d47c` (bonus hits) are written but never read in the EXE; the zone has no use for `+0xec` (90.0).
* The generic `Hud` draws the gauge from `hud.set` (the zone's overlay set); the right / centre texts are `rightText` / `centreText`.

## 13. Tests, how to run

* `node tools/test-formats.mjs --only m3-z36cnt` (270 checks): the frame table, the 19 sound ids (names from the sound table, the `push` immediates of `FUN_007af780`), the constructor immediates (speeds, boost, window, time, seat, visor), the result code's 2000 / 4000 / 6000 compares,
  scene record names, the zone's clip counts; a scripted **WIN** (perfect player: gold, 10840 points, hi-score / trophy written, speech, sounds, the stop, the phew clip), a scripted **LOSS** (no input: 0 points, result 2, nothing written), the time limit (RUN lasts exactly 1800 ticks),
  window order / edges / latches / early presses / missed windows, score and streak arithmetic (20 + 5 n, cap 20), the medal table (1999 -> none and failed, 2000 / 3999 bronze, 4000 / 5999 silver, 6000 / 8000 gold) and the hi-score rule, the pitch table, the lights per quarter, the monitor ranges, the visor clip (0.9 rad), Bob's machine, the placement maths, ghosts and shadows.
* Browser (headless and muted, a dev server without hot reload is safest; other work in the tree restarts a hot-reloading page in the middle of the 4 minute run): `node tools/browse.mjs "http://localhost:5499/?zone=z36CNT&mute=1" tools/steps/m3-z36cnt.mjs --size 800x600 --out /tmp/m3/z36CNT`:
  intro, help, belt, visor, start, a perfect player through the 60 s (gold banner, result menu, Continue -> z38PAR at node 60, hi-score 0x9b and trophy 0x86 set), pause (page 18, the machine freezes, Esc resumes), restart from the pause menu, a run without input (banner 0, result menu page 19), retry, pause menu Abort -> the island at node 58.

## Shortcuts

* `?zone=z36CNT` (add `&mute=1` for tests) starts the zone at its story node 59; `window.__zone.game.debug()` returns the machine's state (state, clip, angle, power, score, streak, time, zone, latches, monitor state, hi-score / trophy); `window.__zone.game.sim` is the `CentrifugeSim`.
* The stub aids F9 / F10 are not active (the zone is ported). Keys: Shift = BUTTON_3 (belt, start), Left / Right arrows (or A / D).
* Game variables: `HISCORE_CNT` 0x9b, `TROPHY_CNT` 0x86 (0 none, 1 bronze, 2 silver, 3 gold; written only when the hi-score is beaten).

## Changes to shared files

* `src/game/render.ts`: `GameRenderer.attachLocal` (local transform of an attachment slot); `Attach.slot`. WP-MINI: `GameRenderer.drawPart0` (the direct draw of a node draw hook: LOD part 0 of a record at a matrix, mode 1, or mode 7 = preset 26 with an alpha) and `drawShadowPoints` made public; the M3 fields `ghosts` / `extraShadows` (copies drawn after their record, shadows after all records) are gone: the draw hook of the TRAI node draws copies and shadows at its turn.
* `src/game/controller.ts` (WP-MINI, with z03PPH): `updatePass` runs the exclusive node / return code 3 like `FUN_0042226e` (see z03PPH.md section 8).
* `src/shell/hud.ts`: `Hud.gauge` (`HudGauge`, `FUN_00460214`).
* (`src/render/renderer.ts` already had `setTextureFrame` from another worker; my duplicate was removed.)

## WP-PART-WIRE (2026-10-29): particles

`FUN_007af0d2` creates the engine `FUN_00442900("z36cnt")` and the loop updates it (`FUN_00442930`), but the zone never starts an effect (the archive has no `Particle/` folder). Nothing to wire. Closed. (`rand` default: `randF` of the C runtime generator, src/game/crt.ts.)


## WP-TIME (fixed 60 Hz step, shared RNG, float32 sweep)

The sim ran with `dt = 1` baked in (`* 1`, `time - 1`, `+ 1`, `advance(1)`); it follows `DAT_008b1718` now (`CentrifugeSim.step(pressed, dt)`, `bobStep(dt)`; the zone game passes `w.dt`):
* dt-scaled floats (float32 per operation, the order of the asm): the arm angle in RUN and STOP (`(OMEGA_MAX - OMEGA_MIN) * power + OMEGA_MIN` rounded per operation, times dt, plus the angle), the power fall in STOP (`0.01 * dt`), the time left (`+0xf0 -= 1.0 * dt`), the monitor frame (`FUN_007aff9f`: `1.0 * dt + frame`), the visor matrix angle (`visorAngle * dt`; the angle itself still steps 0.1 per update), Pepper's clip (`FUN_0043b76a(anim, 1.0)` = `advance(1, dt)`), Bob (`advance(speed, dt)` and the clip-end test `FUN_0043b92a`: `1.0 + frame + speed * dt > frameCount`, per operation float32; Bob's speed `3.0 * power + 1.0` per operation).
* integer / per-update counters (not dt): the displayed score ticker (+17 per update), the streak, the twinkle-free light logic, `DAT_05d5d488` (a per-frame HUD counter nobody reads).
* Draw hook FUN_007b1a1b (`placeParts`): a pure function of the last angle / power, no accumulating state: once per sim step is enough.
* RNG: `host.rand(x)` is `FUN_004388ae(x)` (float32): Bob's `rand(1.0)` against the power and `ftol(rand(4.0))` for the clip (src/zones/common/crtrand.ts `randFrom` in tests, `randF` of src/game/crt.ts in the game).
* Oracle `m5-audit-z36CNT-emu` runs with the x87 at 24 bit (`cw 0x7f`), FUN_004388ae native on a hosted `rand()`, dt 1 / 0.5 / the game's own rule (1 for the first five frames, then 0.5) and TOLERANCE 0 (4.7 M comparisons). `m3-z36cnt` has a dt 0.5 block.
