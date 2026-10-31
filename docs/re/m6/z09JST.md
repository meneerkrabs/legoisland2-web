# z09JST: "Jousting" (M6 port)

The tournament of the Castle Island (story node 23, zone table index 8, archive `z09JST`, source file `Common\z09JST\c_src\GameLoop.c`, castle hub z07CSI): Pepper rides against the Dark Knight.
Both knights gallop at each other along the barrier; the player builds up speed by pressing LEFT / RIGHT in turns, lets go with SPACE and steers the lance (arrow keys) so that
the aim marker sits on the Dark Knight's shield when they meet. Three points win the tournament; the score is the sum of (speed bonus x precision bonus) of the rounds that were hit,
the medal (bronze / silver / gold) is 3 minus the Dark Knight's points. There is **no PEPP record** in the archive: the zone has its own player objects (the knight JKIT on a horse, the
dark knight DRKK on DRKH) and its own camera; the engine's dummy player is never used.

Addresses are VAs of the NL retail build; `FUN_` names are the Ghidra names of `decomp-le2/LE2.c`. The decompile hides several `x87` arguments and some stored results; every place
where that mattered was checked against `LE2.asm.txt` (see 6).

## 1. Files

| file | what |
|---|---|
| `src/zones/z09JST.ts` | registration: `registerCtor` for the four constructors (`JSTGame` 0x5d1f64, `Flag` 0x5d3e7c, `Anims` 0x5d3cc1, `Drkk` 0x5d3ad4) + `registerZoneGame('z09JST', createJstGame)` |
| `src/zones/z09jst/duel.ts` | **the simulation** (pure TS, no DOM): `JoustDuel` = the constructor FUN_005d1f64 + update FUN_005ce506 (36 states) + the camera FUN_005f2f0b + helpers; `bspline` (the path object 0x446fd0, float32), `crtRng`, `ST` |
| `src/zones/z09jst/mfig.ts` | `MfigMan`: "mfigman" (FUN_005f3a90 .. FUN_005f3f1b), a horse + saddle + cloak + knight acting as one rider |
| `src/zones/z09jst/rig.ts` | zone set-up beyond the generic extraction: `giveAnimations` (the builder's anim instances), `readTables`, `Gear` (lance / shield attachments), `makeHost` / `startDuel`, the four node classes |
| `src/zones/z09jst/consts.ts` | record numbers, rigs, start clips, sound ids, the named floats (address in the comments), `readClipTable` |
| `src/zones/z09jst/sound.ts` | `JoustSound`: loads the 17 2D + 26 3D sounds of FUN_005d24b0, plays them through the engine's `SoundEngine` |
| `src/zones/z09jst/screens.ts` | the text lines of the round popup (FUN_005d4070) and the end panel (FUN_005d4467) as data (`popupLines`, `finalLines`) |
| `src/zones/z09jst/game.ts` | the `ZoneGame`: HUD, aim marker (FUN_005d2814), the panels, `project`, `markerSegments` |
| `tools/lib/jst-bot.mjs` | scripted player (`jstKeys`): the keys a player presses in each state |
| `tools/tests/m6-z09JST.mjs` | node tests (`node tools/test-formats.mjs --only m6-z09JST`) |
| `tools/lib/m7-z09JST-cover.mjs`, `tools/tests/m7-z09JST-cover.mjs` | the WP-VERIFY coverage test (dt = 0.5, injected states, dead branches, restart; section 10) |
| `tools/lib/jst-emu.mjs`, `tools/tests/m6-z09JST-emu.mjs` | the **oracle**: the original's duel code executed in the x86 interpreter next to the port (`--only m6-z09JST-emu`) |
| `tools/steps/m6-z09JST.mjs`, `m6-z09JST-look.mjs` | headless browser runs with real key input (win, loss, results, retry, abort) / screenshots of every phase |
| shared edits | `src/zones/index.ts`: one import line; `docs/re/m6/progress.md`: the status section |

## 2. The original, function by function

| address | what | ported in |
|---|---|---|
| `FUN_005cd33d` | the zone loop (template 2.3: modes 7 0 1 9 2 3 4 5 8). Mode 0 speaks `CASGJO13`; mode 1 draws the panel `FUN_00460a3d(0x16, 0x14, 0)` with `CASGJO13` at (320, 160), wrap 30; mode 9 = `FUN_00461155(zone table, 7)` (7 control lines); **modes 2 and 4 run the update pass** (the duel goes on in the end banner), mode 2 calls `FUN_0046055f` (HUD) and enters mode 4 when `DAT_05d5ae9c` (the result) is set; mode 4 waits for a button; mode 5 = `FUN_0041c092(.., (result != 1) + 1)`; "continue" = exit 2 on a win / 4 on a loss; a restart re-runs `FUN_005ce332` | the runner (`playzone.ts`, `loopmachine.ts`) + `ZoneGame.tickInBanner` |
| `FUN_005ce27f` | set-up: builder / loader `FUN_005e628a`, `FUN_005d4add` (copies the 8 rows of the final tableau), records `FUN_005ce1c6`, backdrop, fog `FUN_00442d90(4.0, 200, 500, 400, 0xff9966, 1)`, font `main/bknw`, `CI/Data/jst.str`, overlays `Z09JST` | `extractRenderParams` (fog), `ZONE_FILES`, `rig.ts` |
| `FUN_005ce1c6` / `FUN_005cdb60` | the camera of the intro (eye (27.49, 20, -83.2), target (208.4, 17.7, -79.1)); the nodes: `JSTGame` on record 4 (LAND), `Flag` on 5..10, `Anims` on the 8 spectators, `Drkk` on 11, sky / sea nodes; start clips (bugles 0x86, king / queen 0x43, the rest 0x3a, flags 1); the four soldiers (records 25..28) are hidden (`flags = 0`) | `startDuel`, `giveAnimations`, `INTRO_CAMERA` |
| `FUN_005e628a` (0x5f10bc ..) | the builder creates the anim instances (`FUN_0043b4e2(rig, 1)`) and starts clip 1: LFLG on the flags 5..9, BBFG on 10, MFIG on DRKK / JKIT / the spectators, HORS on the horses and saddles (12..14, 16..18, 29) | `RIG_OF` |
| `FUN_005d1f64` | constructor of `JSTGame`: two mfig managers, nine particle emitters (`botexpl01.par`, 8 x `orsemud1.par`), the first round | `JoustDuel` constructor |
| `FUN_005ce506` | **update of the node**: crows / wind sounds, then the state machine (36 states, 3), the spectators turning to the knights (`FUN_005ce3a0` x 8), the camera | `JoustDuel.update` |
| `FUN_005d4860` | **round set-up**: places, gear back on, clips row 0, camera, rates | `JoustDuel.roundReset` |
| `FUN_005d4698` | **end of the tournament**: speech, medal, hi-score `0x18` and trophy `0xcb` (only raised) | `JoustDuel.finish` |
| `FUN_005d1d1c` | the horse during the charge: scrubbed with the gauge up to 18, rearing above | `chargeAnim` |
| `FUN_005d1b41` | hoofbeats by speed class and frame of the gallop | `hooves` |
| `FUN_005d1ab6` | the dark knight's footsteps (clip 0x5e, frames 5 and 15) | `footsteps` |
| `FUN_005ce454` | random idle sounds of the horses | `ambient` |
| `FUN_005d2782` | pitch of the power loop = `ftol(gauge) * 0x5bcc / 0x3c + 0x5fb4` Hz | state 3 |
| `FUN_005f2f0b` / `FUN_005f2bfc` / `FUN_005f2dd9` | the camera: 16 modes by `+0x100`, smoothing, set-up | `JoustDuel.camera`, `smooth`, `initCamera` |
| `FUN_005f3a90` .. `FUN_005f3f1b` | mfigman | `MfigMan` |
| `FUN_00445340` / vtable 0x892268 slot 8 (0x446fd0) | the camera spline of mode 1: a uniform cubic B-spline over 5 control points | `bspline` |
| `FUN_005d2814` (draw hook of `Drkk`) | the aim marker | `game.ts` `drawReticle` |
| `FUN_005d4070` / `FUN_005d4467` | round popup / end panel | `popupLines` / `finalBanner` |
| `FUN_005d3b80`, `FUN_005d3d90`, `FUN_005d27e0` | `Anims` update (advance 1.0 while the level +0x44 is 1..3), `Flag` update (always advance 1.0), `Drkk` update (nothing) | `AnimsNode`, `FlagNode`, `DrkkNode` |
| `FUN_005d3f30` | HUD: left icon 10 + the Dark Knight's points, right icon 9 + the player's points, centre = score, gauge | `game.ts` |
| `FUN_005d24b0` | the sounds | `JoustSound` |
| `FUN_005cd0d0` | sound loads that nothing calls (a template left-over) | - |

## 3. The tournament

### 3.1 State machine (node +0x4c)

| state | meaning | leaves |
|---|---|---|
| 0 | first tick | -> 1 |
| 1 | waits: any held button | -> 2 (charge 0, marker shown) |
| 2 | the two bugle players (BUG1 / BUG2, clip 0x86) play; the short fanfare `SND_FANFARE_SHORT` plays on frames 40..50 of BUG1 | BUG2's clip ends -> 3 (player row 6, dark knight row 2; the first key is RIGHT unless LEFT is held) |
| 3 | **charge**: alternate RIGHT then LEFT presses (rising edges), each adds 1.0, every tick `charge -= charge * 0.0075`, 0..60; the gauge (`DAT_05d4e138`) shows it; the horse is scrubbed to the gauge (frame = gauge) up to 18, above 18 it rears (row 7, `ready`); SPACE: not ready -> 4, ready -> 8 | SPACE |
| 4 | too slow: the player's group rewinds (`-rate`), marker off; at frame 0 the dark knight starts clip 0x5e and **loses lance and shield** | -> 5 |
| 5 | the dark knight walks to the horse (x - 1 per tick, footsteps) until x <= horse x + 3.7, then clip 0xbe, player row 10 | -> 6 |
| 6 | he grabs (sound at frame 27), lifts and throws (frame 70) the player; the camera target slides along | the player's clip ends -> 7 (landing sound, explosion effect) |
| 7 | camera set | -> 0x1f |
| 8 | the horses rear (player row 8, dark knight row 4) | the player's clip ends -> 9 (neighs, knights' speed = charge x 0.02) |
| 9 | **the ride**: crowd loop, camera mode 1 (spline), aim wobble + keys, hoofbeats, the knights move 2 x charge x 0.02 per tick; at `player.x - dark.x > -8`: marker off, aim squared distance decides: `< 40` -> 0xb, `<= 60` -> 0xe, else 0xc; the reaction variant = `ftol(rand * ms) & 3` | the clash |
| 0xb | the player hits: level 1, +1 point, `speed bonus = ftol(2 * charge)`, `precision = ftol(40 - aim^2)` (min 1), `round = product`, total += round; the four reactions (variant 0..3): 0xf / 0x11 / 0x12 / 0x13, speech `CASGJO11` / `11` / `10` / `12`, cameras 9 / 10 / 0xb / 0xc | -> 0x1f when the clip ends |
| 0xc | the dark knight hits: level 2, +1 point for him, reactions 0x16 / 0x18 / 0x19 / 0x1a, speech `CASGJO07` / `07` / `08` / `07`, cameras 3 / 5 / 6 / 7 | -> 0x1f |
| 0xe | glancing blow: level 3, both groups mode 0, `CASGJO09`, camera 0xf, state 0x20 (the knights ride on until x > 190) | -> 0x1f |
| 0x1f | round over: counters refreshed (`FUN_005d1e1b`), gauge 0 | -> 0x21 |
| 0x21 | popup (`FUN_005d4070`, by the state the clash went to: 4 / 0xb / 0xc / 0xe) | any button -> 0x22 |
| 0x22 | player < 3 and dark knight < 3: the next round (spectators back to their start clips, `FUN_005d4860`); player 3: **won**; dark knight 3: **lost** | |
| 0x23 | the tableau: the knights on the rows of `0x905a80` (won: rows 0..3, lost: 4..7), camera 0xe orbits (angle + 0.009 per tick); the end panel (`FUN_005d4467`) is drawn; the loop is in mode 4 | a button -> result menu |
| 0xd, 0x15, 0x1c, 0x1d | unreachable in the shipped game (no code sets them: section 10 lists every store to `+0x4c`); ported, and compared with the original by injection | |

Reaction states (0xf .. 0x20) run clips of the groups' rows (read from the executable tables) and move the knights apart by `charge / 32` per tick; the thrown / hit knight is the one whose
group is in mode 0 (the manager's last record runs on its own, the zone code moves it).

### 3.2 Controls and aim

LEFT / RIGHT in turns build the charge (the key table of the executable: LEFT bit 1, RIGHT bit 2); SPACE (bit 0x80) lets go; during the ride UP / DOWN / LEFT / RIGHT move the aim point **1 unit per tick**
(`+0x114` = 1.0; UP lowers y, i.e. the marker goes up the screen). Every tick the aim point also gets a random step in `[-s, s]` with `s = (charge * 0.0625 + 1) / 1.4` (up to 3.4 at full
charge); a step that points away is reduced by `aim / 10` beyond 20 (the original compares *both* signs with +20: ported as it is). Without any key since the start of the
ride the aim drifts (+1, -1) per tick; the first key press switches the drift off for the rest of the round. A gamepad stick is only read in the original while no key is held (`DAT_0098383c == 0`); the stick variables are always 0 in the original too (the pad reader FUN_004376f9 zeroes `DAT_00983848+4 / +8` (= `DAT_0098384c / 50`) at every poll after turning the stick into direction bits, so no stick value ever reaches the zone: not a gap (input.md section 1)).
The marker is drawn around the shield of the dark knight (the projection of bone 16 of his pose, see 6): white corner marks of 20 units, and the aim point (yellow, red inside radius sqrt(40) = 6.3) with marks of 30 units.

### 3.3 Score, medals, variables

* round points = `ftol(2 * charge) * max(1, ftol(40 - aim^2))` for every hit round, total `+0x108`.
* medal (`FUN_005d4698`): the player has 3 points: dark knight 0 -> gold (3, `CASGJO01` + `CASGJO02`), 1 -> silver (2, `CASGJO03`), 2 -> bronze (1, `CASGJO04`); the dark knight has 3 -> no medal (`CASGJO05` + `CASGJO06`).
* **var 0x18 `SWITCH_GME_HISCORE_JST`** = max(old, total), **var 0xcb `SWITCH_GME_TROPHY_JST`** = max(old, medal): written at the end of every tournament, also when it was lost (the score of a lost tournament still counts).
* result 1 (won) -> result menu page 16 (continue / retry), "continue" = exit 2 = `story.miniGameExit(true, true)` (node 24: z07CSI); result 2 -> page 19 (retry / abort).
* Maximum round: 120 x 39 = 4680; a perfect tournament is about 14 000; a careful player (charge 40, aim 3 off) gets about 2 500 per round.

## 4. Camera (`+0x100`, FUN_005f2f0b)

| mode | when | camera |
|---|---|---|
| 0 | default (rounds start, states 1..8) | follow point = JKIT * (-5, 8.35, -12.5) with y = 20, z - 3.2 + gauge / 15; target = bone 10 of the dark knight; eye / target ease a quarter of the way per tick and the camera takes the values of the tick before |
| 1 | the ride (state 9) | eye on a B-spline over 5 control points `(25, 21.3, -80) (28, 30, -120) (55, 30, -120) (95, 30, -120)` + `((player - dark) / 2 + (184, 24, -96))` (parameter 0..1 in `half distance / rider speed` ticks); target = player - 0.4 x (player - dark), 6.4 up |
| 3 / 4 | enemy hit variants | target = the dark knight |
| 5 / 10 | variants 1 | target = (knight x + 64 / + 200, 2 x y, z) of **bone 0 in model space** (see 6); mode 10: the eye drifts (-0.3, +0.3) below z -75 |
| 6 / 9 | | target = JKIT + 8 up, eye x + charge / 32 up to 245 / 240 (mode 9: eye z -68, mode 6: eye y 24.8) |
| 7 / 0xb / 0xc | | target = DRKK (+ 8 / + 4) / JKIT; mode 0xb: eye x - charge / 64 down to 50 |
| 8 / 0xd | | eye x + 0.55 (up to 170) / eye x - 0.55 and z + 0.6 (down to x 60) |
| 0xe | the tableau | eye (120, 20, -82), target = the king LKNG with the orbit angle mixed in (`x (1 + sin a)`, `z (1 - cos a)`) |
| 0xf | glance | target = BQUN |

## 5. Data

* The clip tables of the two managers are read from the executable: `0x90b7c4` (player: [HORS, GSAD, CLOK, JKIT] per row, 19 rows) and `0x90b8f4` (dark knight: [DRKH, RSAD, DRKK, 0]); the camera spline points `0x90b740` (count `0x90b73c`), the follow offset `0x90b7b8`, the final tableau `0x905a80` (8 rows x, y, z, yaw).
* Models: DRKK (record 11) and JKIT (15) carry the lance (slot 7, `OBJT_PEPLance`, bone 14) and the shield (slot 9, `Bulls_shield` / `PizzaShield`, bone 16) as attachments; the duel removes / restores them
  (`Gear`: the record gets a private copy of its model, the render views are rebuilt through `GameRenderer.refreshViews`).
* Sounds: see `consts.ts` `S2D` / `S3D` (the ids of FUN_005d24b0). There is **no music** for this zone (the music table has no JST key; `FUN_00435a07` / `FUN_00435b59` are empty): wind loop, crows, crowd, hoofbeats, fanfares.
* Texts: `CI/Data/jst.str`: `CASGJO01..13` (speech, voice 1123..1135), `JST1..JST15` (popups), `CONTROL0..6`.
* Overlay textures `Overlays/Z09JST`: 0 arrow, 1 / 2 / 3 green / yellow / red gauge segments, 8 horse icon, 9 the player, 10 the dark knight.

## 6. Differences and approximations (nothing silently dropped)

* **Particles are not drawn**: the node creates `botexpl01.par` (the landing explosion in state 6) and eight `orsemud1.par` emitters on the horses' hooves (switched on at the start of the ride, off at the end of a round). The port has no particle system yet; `JoustDuel.onEffect` reports the events (`botexpl01`, `orsemud1`, `emitters-off`).
* **Aim units**: the marker's offsets are in screen pixels of the original's back buffer (`FUN_004445c0` = D3D `ProcessVertices`); the port uses the 640 x 480 virtual grid of the 2D layer (the original's resolution was configurable: 640 / 800 / 1024 wide, so the tolerance of 6.3 px was relatively tighter at higher resolutions).
* **Marker position**: `FUN_005d2814` projects the local point (0, 0, 0) with the D3D world matrix that the *last drawn object* of `FUN_00444480` left, i.e. the last attachment of the dark knight, the shield (slot 9, bone 16). The port takes bone 16 of his pose (record matrix applied); the shield mesh's own origin offset is ignored.
* **Camera modes 5 and 10** read `FUN_0043bc58(anim, 0)`: bone 0 of the pose buffer that the draw (`FUN_004440f0`, identity root `PTR_DAT_008b5830` = `DAT_008b57f0`) left, i.e. in model space; the code writes world x + 64 / 200 over its x, doubles y and uses the matrix translation as the target, so z is the pelvis' model-space z (about 0), not a world coordinate. Reproduced as it is (the camera looks along +z at the flying knight's height); the oracle confirms the arithmetic, the space of the buffer follows from the identity root.
* **Stick**: the analogue stick path of the ride (`DAT_0098384c / 50`, dead zone +-20, `stick / 128 * aimStep`, no dt, read only while no key is held) is ported in `JoustDuel.update(held, pressed, stickX, stickY)` and compared with the original by the coverage test (section 10); the `JSTGame` node's `stick` stays (0, 0) exactly like the original's variables (the pad reader FUN_004376f9 zeroes `DAT_00983848+4 / +8` (= `DAT_0098384c / 50`) at every poll after turning the stick into direction bits, so no stick value ever reaches the zone: not a gap (input.md section 1)).
* **Random numbers**: the original uses C `rand()` (MSVC LCG at `0x85daf0`) through `FUN_004388ae(range)`; the port draws from the shared generator (`crt.ts` `randF`, `duel.rng` = `crtRng`), **bit-identical** to it for the same seed (9000 draws of the native original, section 10) and seeded with the clock like the original. The reaction variant is `ftol(FUN_004388ae((float) FUN_00435c91())) & 3` with the REAL milliseconds since the zone's `FUN_00435c81` (WP-TIME: `startTickClock()` in `createJstGame`, `msClock()` of `common/tickrand.ts`; before: the tick count x 1000 x dt / 30). The oracles pin the clock to the emulator's `ticks * 1000 * dt / 30` through `setTickCountSource`.
* **Subtitles / speech**: speech lines are started with `ctx.say` (ignored while another line is still speaking, like `FUN_00435a11`); lines that arrive while the end popup is up overlap it as in the original.
* The HUD is drawn after the popup panel (the original draws it last): while a popup is up the zone game draws the HUD itself on top.
* The unreachable states 0xd, 0x15, 0x1c, 0x1d are ported and are reached by the coverage test (section 10) by writing the state into both nodes.
* The `SeaAmin` / `seabed` nodes of the set-up are the engine's (the renderer animates the sea itself).

## 7. Tests

`node tools/test-formats.mjs --only m6-z09JST` (328 checks, about 1 s):
* the executable: 48 floats at their `.rdata` addresses, two doubles, the immediates of FUN_005d4860 / FUN_005ce506 / FUN_005d2782 / FUN_005d4698 / FUN_005ce1c6, the vtables of the four nodes, 43 sound table entries (id, name, file in the zone's folder, loop counts), `jst.str` ids / voice numbers / controls, the clip tables, the final tableau, the spline data, the intro camera;
* the zone: records and names, the 19 + 8 + 6 + 1 + 1 attaches and node classes, the animation instances and start clips, the hidden soldiers, every clip number used exists in `HORS.blk` / `MFIG.blk`;
* the B-spline (end points, partition of unity, interior value, continuity), `MfigMan` on fake records (bind, clips, mode 1 / 0 results and follow rules, hold on the last frame, seek);
* the duel on the real records through `World.tick` and the `JSTGame` node: states 0..3, bugle length and fanfare frames, charge dynamics replayed with an independent model (90 ticks), the toggle rule, cap 60 / floor 0, the horse's clips, power pitch, "too slow" (states 4 5 6 7 1f 21, gear off / on, sounds), ride durations for 4 charges, classification at the boundaries (aim^2 39.9 / 40 / 60 / 60.06), aim keys and drift, wobble / pull-back formulas, 24 hoofbeat combinations, scoring (speed x precision, floor 1), the four reactions of a hit and of a hurt (states, cameras, rows, speech), the glance, every reaction reaching the popup, spectators / flags, HUD refresh timing, medals / speech / variables (only raised) / tableau / gear / sounds, 16 camera modes with their formulas, the spline made once and evaluated, `project`, the marker geometry, `JoustSound` on a fake engine;
* **scripted matches**: WIN (the bot wins seven seeds, medal = 3 - the dark knight's points, variables), LOSS (3 points for the dark knight, no trophy), GLANCE (no point for anybody, deterministic), TOO SLOW (six thrown-off rounds, no points).

`node tools/test-formats.mjs --only m6-z09JST-emu` (13.5 million checks, about 10 s) is the oracle: `JstEmu` runs the original's `FUN_005d24b0` (sounds), the constructor `FUN_005d1f64` (two mfig managers, the first round `FUN_005d4860`, the camera set-up),
the update `FUN_005ce506` (all 36 states, mfigman `FUN_005f3b61 .. 005f3f1b`, the camera `FUN_005f2f0b` with the B-spline path object `0x446fd0`, the spectators `FUN_005ce3a0`, `FUN_005d1b41`, `FUN_005d1d1c`, `FUN_005d4698`, ...), the `Flag` / `Anims` node updates and
the panel code `FUN_005d4070` / `FUN_005d4467` natively in the user's executable; the engine (animation instances = the port's `AnimInstance`, sounds, speech, variables, particles, the gear calls, allocation, `rand()`) is a host table that logs its calls.
Both sides get the same buttons (the port's input mapper) and the same random numbers (two seeded per-side generators `tools/lib/msvc-rng.mjs` with one seed; the original's `FUN_004388ae` is hosted with it, `GetTickCount` with the tick count, the port's clock pinned to the same stand-in). Every tick the test compares 60 fields of the node (state, counters, positions, rates, the aim point, bonus values, the helper vectors of the camera),
the camera globals, all 30 records' matrices, flags, clips and frames, the two groups' modes and clips, the gauge / result, **every sound / speech / gear call (strict order)**, the particle effect events and **the text lines the original draws in the popups and in the end panel** (id, table, y, wrap, the printed numbers).
Scenarios: two wins (charge 40 / 30), a loss, SPACE too early, random key mashing, a deterministic glance run, four more win / loss seeds each: all 30 reachable states are visited (not the unreachable 0xd, 0x15, 0x1c, 0x1d), 0 differences; since WP-TIME every float compares bit for bit (tolerance 0; before: the worst difference was 1.5e-5, the camera's spline phase).

## 8. How to run

* Dev server: `http://localhost:5499/?zone=z09JST&mute=1` (story node 23; intro, help, play; Esc = pause menu page 18).
* Headless with real keys (serve a snapshot, `sh tools/m4-snapshot-server.sh 5605`): `node tools/browse.mjs "http://localhost:5605/?zone=z09JST&mute=1" tools/steps/m6-z09JST.mjs --size 800x520 --out /tmp/m6-z09JST` (about 5 minutes with `JST_QUICK=1`, which plays without the aim wobble; about 12 minutes with the real wobble).
  The run: intro / help / play / pause, SPACE too early (popup 4), a won tournament (banner, medal, variables, result menu 16, Continue -> z07CSI node 24), a lost one (banner, menu 19, Retry -> fresh duel), the abort (-> node 22, the castle hub; the debug entry `?zone=` leaves the hub's objective variable set, so the story walks on into the duel again at once: the step records the visit of node 22 with a page-side recorder).
  `tools/steps/m6-z09JST-look.mjs` takes a screenshot at every new state of a won match.
* Debug handle: `window.__zone.game.duel` (the `JoustDuel`: `state`, `speed`, `gauge`, `aimX`, `aimY`, `hitsP`, `hitsE`, `score`, `medal`, `level`, ...), `window.__zone.game.debug()`.

## 9. For the story / other zones

The zone is entered from the castle (z07CSI) at story node 23 and leaves with `story.miniGameExit(true, true)` (node 24) or rewinds to the castle. Variables other zones read: 0x18 (best score, shown by the information center) and 0xcb (trophy 0..3: Pepper's house shows the gold / silver / bronze jousting trophy, `JST_Gold/Silver/Bronze` models of z03PPH).

## 10. Differential test (WP-VERIFY): coverage

`node tools/test-formats.mjs --only m7-z09JST-cover` (about 80 scenarios, 54 000 ticks, 34.5 million checks, about 20 s). It reuses the oracle of section 7 (`JstEmu`, extended in `tools/lib/m7-z09JST-cover.mjs`: `JstCoverEmu`, `runScenario`,
`buildOracle`) and compares the original's code with the port **every tick**: node fields, aim point, camera, all 30 records' matrices / flags / clips / frames, both managers' modes and clips, every sound / speech / gear / effect call, every variable
write, the popup / end panel texts and how many panels the original draws. Tolerance 0 since WP-TIME: floats, ints, flags, clips and calls all compare exactly (before: 1e-5 relative, worst 4.8e-7 = the spectators' facing: FUN_005ce3a0 stores atan2 into a float before adding pi, the port added in double; 99.4 % bit-identical). The remaining double-precision spots (the spline, the camera chains, the wobble, the stick path, `toWorld`) are float32 per operation now.

### What the first oracle test did not cover (the gaps) and how they are closed

| gap | closed by |
|---|---|
| dt: the original ran with the image's dt = 1 only, the port had `dt = K.ONE` hard-wired | every scenario at **dt = 1 and dt = 0.5**: `DAT_008b1718 = dt`, `DAT_008b171c = 1/dt`, the hosted engine advance multiplies by it (as `FUN_0043b76a` does: `rate * DAT_008b1718 + frame`), `GetTickCount` counts dt x 1000 / 30 ms per tick; the port gets `world.dt`. **Fixed in the port**: `JoustDuel.dt` (set by the `JSTGame` node from `world.dt`), `MfigMan.dt`, the `Flag` / `Anims` nodes use `w.dt`, the movement / camera / aim constants and the variant clock use it. A sensitivity check runs the port at the other dt and must fail |
| states 0xd, 0x15, 0x1c, 0x1d (gaps.md: "no test") | written into the node of both sides at 7 moments of a round (right after the clash of a glance / hit / hurt, 10 ticks into the reaction, mid ride, during the charge, while the dark knight walks: dt 1 and 0.5): the original's own code runs the state and the rest of the round. Ticks run in them: 0xd 7, 0x15 288, 0x1c 91, 0x1d 321. 0 differences |
| medals / tournaments | gold, silver, bronze, lost 0:3, lost 2:3 (a planner bot loses `k` rounds first), the "only raised" variables with pre-set values above / below / equal; all four end panels (`FUN_005d4467` cases 0..3) |
| release speeds, charge dithering | release at 19 / 25 / 35 / 45 / 59.5 (every hoof class, speed cap), pump / rest / pump (`FUN_005d1d1c`'s `clip[0] == 0xd` branch), LEFT held at the end of the bugle (`toggle = held & 1`) |
| analogue stick | `update(held, pressed, stickX, stickY)` added to the port (it did not read it), compared against the original with random stick values (inside / outside the dead zone, with and without keys) and a stick-only aimed ride |
| `FUN_005d1b41` (hoofbeats) | function level: 12 speeds (every boundary: 18, 30, 30+ulp, 40, 40+ulp, 60) x frames -2..30 against `JoustDuel.hooves`: 396 calls, 0 differences |
| restart in place | see below |

### Dead or rare branches (reached by writing a value into both sides; the evidence that play cannot reach them)

* **States 0xd, 0x15, 0x1c, 0x1d**: the stores to the node's `+0x4c` in the whole executable are exactly `0x5ce5cc` (1), `5ce622` (2), `5ce723` (3), `5ce847` (8), `5ce877` (4), `5cead7` (5), `5cec0a` (6), `5cecf7` (7), `5cef12` / `5cef91` (0x1f / 9), `5cf5d5` / `5cf5fc` / `5cf60b` (0xb / 0xc / 0xe), `5cf953 5cf9b9 5cfa1f 5cfa81` (0xf 0x11 0x12 0x13), `5cfd17 5cfd7d 5cfde3 5cfe45` (0x16 0x18 0x19 0x1a), `5cfef8 5d00eb 5d0eee` (0x20), `5d01d2` (0x10), `5d02e5 .. 5d0fa9` (0x1f), `5d066b` (0x14), `5d0857` (0x17), `5d0cf6` (0x1b), `5d1078 5d1098 5d10d2 5d12bd` (0x21 0x22 0x23), `5d4879` (0); `DAT_05d5b0a8` is referenced only by the zone code and the camera. The states 0xa, 0x1e, >= 0x24 are no case at all (the switch falls through to the spectators and the camera; also compared).
* `5ce987` speed < 0 clamp: the charge starts at 0 and is raised by +1 per press, `speed - speed * 0.0075 * dt` stays >= 0 (dead; written -5 / -0.01). `5ce9af` speed > 60 clamp: reachable (a press every tick: release at 59.5).
* `5cf81c` precision < 0: state 0xb is entered only with aim^2 < 40, so `ftol(40 - aim^2) >= 0` (dead; written 45); `5cf835` precision 0 -> 1: aim^2 in (39, 40), narrow but reachable (written 39.5).
* `5ced5a` state 6 `dz <= tz`: the dark knight's z (-79) only slides 15 ticks x 0.12 (= 1.8, also at dt 0.5: 30 x 0.06) towards `horse z + 3.75 = -81.25`, never reaching it (dead; written -82).
* camera modes 2 and 4: no store of 2 or 4 to `+0x100` (list of stores: 1 9 0xa 0xb 0xc 3 5 6 7 0xf 0xf 0xd 8 0xe 0xe 0): mode 2 is the no-op default, mode 4 (`5f3473`, target = the dark knight's record) the same as mode 3; modes > 0xf and negative go to the default; mode 0 with the spline made (`5f2f60`: frees it) cannot occur because the round reset that sets mode 0 also clears the flag. All written and compared.
* popup `+0x118`: only 4 / 0xb / 0xc / 0xe are ever stored; 0xd (same lines as 0xe) and every other value (nothing drawn, no panel) written and compared. The result branches of state 0x22 with both sides at >= 3 points (the player's branch wins), 5 and 4 points.
* `5f3bae` (`FUN_005f3b61` on an already bound manager: the old group's flag 2 is cleared): the constructor binds each manager once, right after `FUN_005f3aef` zeroed it, so dead; compared at function level on both managers (record flags and clips).
* `5f3ed2` (`FUN_005f3d78`: a manager in mode 0 whose rider clip is a one-shot ends with noWrap 0: the rider holds on its last frame): not reached by any scripted play; reached by writing one-shot rider rows in the glance state 0x20.

Instruction coverage of the original (trace hook): 6467 distinct instructions of the zone / mfigman ranges; per function range the numbers are asserted in the test (`FUNCS`). Everything left unexecuted is not code: the state switch's jump table (`5d1a06..5d1ab5`), the popup / panel
tables (`5d4448..5d4465`, `5d4688..5d4697`), the camera's (`5f3a50..5f3a8f`) and `int3` padding (`5d27db`, `5d4b52`). **Not run by the oracle** (rendering / engine glue): `FUN_005d2814` (aim marker), `FUN_005d3f30` (HUD), `FUN_005cd33d` (zone loop),
`FUN_005cdb60` / `FUN_005ce1c6` (attach), `FUN_005d4b60` (models); the marker layout and the HUD-after-popup order stay as noted in section 6 (rendering topics, not tested here).

### Restart in place (a finding, fixed)

A retry / pause-menu restart (exit state 3) does **not** rebuild the node in the original: `FUN_00423532` (called by the attach `FUN_005cdb60` with `DAT_008adc74 = 0`) calls the constructor `FUN_005d1f64` with the existing node, which takes the **else branch**
(`FUN_004435b0` x 2, `FUN_005f3aef` x 2, points / score / aim step reset, `FUN_005d1e1b`, `FUN_005f3b61` x 2, `FUN_005d4860`) and keeps every node field that neither it nor the round set-up writes (the oracle lists them: `level`, `variant`, `popup`, `rider`, `splineRate`,
`splineT`, `aimSq`, `bonusSpeed`, `precision`, `roundPts`, `medal`, `step`, `aimStep`, `+0xc0`, parts of the camera vectors). The port rebuilds the whole zone (a fresh `JoustDuel`). Only `level` (`+0x44`) has an effect before it is overwritten: the `Anims` nodes advance the
spectators' clips while it is 1 .. 3, so after a retry the crowd's idle clips run (frames 0 -> 4 within 120 ticks) until the next round; in a fresh zone they stand still until the first clash. **Fixed**: `rig.ts` `rememberRestart` / `applyRestart` carry these fields over (`createJstGame` calls
them with `ctx.attempt`; `destroy()` stores them). The test restarts the original after a lost 2:3, a gold and a silver tournament (dt 1 and 0.5) and compares 400 / 763 ticks with the port; without the carried level the first tick already differs (sensitivity check).

### Documentation statements that were wrong or stale

* section 6 "Stick: not ported": ported now (`update(.., stickX, stickY)`); the keyboard never produces a stick value without a key.
* section 6 "same distributions, not the same sequence": the generator is bit-identical (crt.ts = `0x85daf0` + `FUN_004388ae`) and the variant roll reads the real zone clock (WP-TIME).
* section 6 "the unreachable states are ported but no test reaches them": tested (injection).
* section 3.1: states 0xd 0x15 0x1c 0x1d: confirmed unreachable (list of all stores above).
* the port's `dt` was fixed to 1 everywhere (the 60 Hz step of the engine would have run this zone at half speed per tick in some places and not in others): now dt-correct, verified at dt 0.5.

The emulator's x87 stack holds doubles (no 80-bit intermediates): results that depend on the extended precision of the original's float10 intermediates (rare, 1 ulp of float32) cannot be separated from the port's double arithmetic by this oracle.


## WP-PART-WIRE / WP-MINI (2026-10-29)

* **Emitters** (`FUN_005d1f64`, `createJstGame`): `botexpl01` is started with `FUN_004429e0`, which only returns the invalid handle `0xbabababa` (a stripped debug stub: nothing is shown, every call with that handle is ignored; also in z40aPO). Eight `orsemud1` (matrix = the horse record, offset 0; rotation (-pi/2, 0, 0) / 0 alternating; the second one starts ON, then all eight off): 0..3 on `HORS` (record 12), 4..7 on `DRKH` (record 29). State 8 -> 9 (`FUN_0044ea60(handle, 2, 1, 1)` x 8) switches them on, state 0x1f off (x 8). At the end of every update the eight matrices are rebuilt: `FUN_0043a9e5(DAT_05d5aea8 + 0x40 k, horse record matrix, FUN_0043bc58(horse anim, bone))` with bones 0x17, 0x1b, 0xb, 0xe and handed over with `FUN_00442a00` (`JoustDuel.placeMud`). The bone matrices are those of the LAST DRAW (nothing in the update re-poses a horse): the clip / frame at the start of the tick, identity root.
* **Verification**: `m6-z09JST-emu` compares every gate and matrix call of the original (171,432 over 15 scenarios, 13.6 M comparisons in all) with the port's; the oracle's pose buffer of the horses is frozen at the start of the tick (`drawBuf` in `tools/lib/jst-emu.mjs`); `m7-z09JST-cover` unchanged (0 diff). Screenshots `tools/steps/m6-z09JST-fx.mjs`.
* **The aim marker (`FUN_005d2814`, DONE, `src/zones/z09jst/marker.ts` + `game.ts`)**: (1) UNITS: `FUN_004445c0` = `FUN_00416d1a` = `ComputeSphereVisibility` (radius 1.0, flags must be 0: the shield's origin completely inside the frustum, else nothing is drawn) + `ProcessVertices` to a point of the BACK BUFFER; the 16 lines (`FUN_00445ba0`) are in PIXELS of the display mode and the aim offsets / the 6.3 px radius are pixels too. The port uses its actual back buffer the way the original uses its mode: the 4:3 area of the canvas (`ui.view`), the projection with `projectPoint` / `frustumPlanes` / `visibleFlags` of the particle engine on the real view-projection matrix of the frame (`GameRenderer.lastViewProj`), the marks drawn in pixels (1 px lines) and scaled to the 640x480 grid; at 640x480 it is the original's picture, at 1024x768 the marks are 20 / 30 px = 0.625 of their 640-grid size, like the original at that mode. (2) ANCHOR: the point is (0, 0, 0) projected with the D3D world matrix the record's draw LEFT, i.e. the matrix of the last mesh drawn (the shield attachment, slot 9: attachment local matrix x bone 16 x record matrix): `GameRenderer.trackWorld` / `lastWorld` hand that matrix over (replaces the "bone 16 of his pose" approximation). (3) The short part of a mark is the INTEGER `size / 3` (6 and 10, not 6.67 / 10), the second mark is red when the squared offset (a float32 sum, y*y + x*x) is < 40, the fixed marks white; (4) the marker is drawn in every loop mode except 3 (pause) and 9 (controls help) as long as the reticle flag (+0x51) is set (it was drawn in mode 2 only). Verified: `m6-z09JST-emu` runs `FUN_005d2814` natively (hosted `FUN_004445c0` / `FUN_00445ba0`) for 400 random cases (modes, flags, visibility, aim offsets, projected points): the 16 lines (float32 coordinates, colours) and the single projected point (0, 0, 0) agree exactly; `m6-z09JST` checks the pure parts. Screenshot `tools/steps/m6-z09JST-fx.mjs` (mud2.png). Still open: the default display mode of the original is unknown (the port's back buffer = the canvas).
* (the HUD is drawn after the round popup panel as the original's loop order)

## Closure pass (2026-10-31)
Section 6 is stale for particles (wired), the stick (ported in `update`; the pad reader zeroes the axes, non-gap), the marker anchor (the last drawn mesh's matrix, WP-PART-WIRE) and the random picks (CRT + real clock). The note "the emulator's x87 stack holds doubles" is stale (the oracles run at 24-bit, `cw = 0x7f`). Remaining and not a game rule: the marker's pixel grid depends on the display mode (the original's default mode is not known; the port uses its 4:3 canvas area).
