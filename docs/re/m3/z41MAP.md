# z41MAP: pizza making at Ogel's pizzeria ("Pizza's maken", M3)

Mini-game of the Ogel arc (zone table index 28, kind 3, story node 65 between the Ogel hub z40OGL nodes 64 and 66; the hub's pizzeria switch `SWITCH_OGL_AT_OGEL_PIZZERIA`
is what starts it). Pepper (in a space suit) stands behind a table with four pots, Papa Brickolini swings a pizza base in front of the shop window. Pepper picks a
topping out of a pot (Up tomato, Down pepperoni, Left cheese, Right green pepper), holds it, and throws it with Space (Left / Right held at the release throws it
to the left / right edge) so that it lands on the base while Papa swings from side to side. Every round the HUD shows the wanted toppings in order (2, 3, 4, 4, 4
over five rounds, one Ogel citizen at the counter per round); a topping of the right type scores 250, the end of a round 250 plus 50 per unit of a 12-unit time
gauge when every topping was right, a cheese thrown straight through the window at the citizen waiting second in the queue 500 once. Score = the game's points,
medals at 2501 / 5001 / 7501 (bronze / silver / gold); any medal ever won completes the story step.

Code: `src/zones/z41MAP.ts` (registration), `src/zones/z41MAP/rules.ts` (constants, tables, medal rule), `src/zones/z41MAP/nodes.ts` (all game logic: the behaviour nodes of
the zone, pure, no DOM), `src/zones/z41MAP/game.ts` (the `ZoneGame` for the shell: HUD, banner, helper records). Test: `tools/tests/m3-z41MAP.mjs`, bot
`tools/lib/z41map-bot.mjs`. Browser: `tools/steps/m3-z41MAP.mjs`.

## 1. What the executable does (functions)

| address | function | role |
|---|---|---|
| 0x811abc | `FUN_00811abc` | the zone loop (loop template, architecture.md 2.3): opens `_data\z41MAP.bob`, music `bdanube` / `Z41MAP`, set-up, mode machine 7 / 0 / 1 / 9 / 2 / 3 / 4 / 5 / 8. Mode 1: `OGSGMP14` at (320, 120) wrap 30 + speech; mode 9: controls help of 7 lines (`FUN_00461155(strfile, 7)`), the music starts at the 1 -> 9 transition; mode 2 draws the HUD (`FUN_0081167c`) and watches `DAT_05d5f3e8` (result); mode 4: `FUN_0042226e` keeps updating the nodes (Papa dances) and `FUN_00811790` draws the banner; mode 5: `FUN_0041c092(&mode, 0, (DAT_05d5f3e8 != 1) + 1)`; exit through `FUN_00404d14(&next, exit == 2, DAT_05d5f3e8 == 1)`. Pause = `FUN_0041bd3d(&mode, 0x40, 1)` |
| 0x813cce | set-up | fog `FUN_00442d90(4, 300, 300, 600, -1, 0)`, font `main`, strings `OG/Data/map.str`, loader `FUN_0081bcf7` (records, 7 rigs MFIG / CIT1 / CIT2 / CIT3 / CIT4 / SLUG / CIT5, animation dictionary `DAT_05d4d484`), `FUN_00442900("z41map")`, `FUN_008138bd(1)` |
| 0x8138bd | attaches | Pepper on PEPP (0x816ba0), Papa on PAPA with the pizza-stack array (PIZ6 .. PIZ2) as argument (0x8132e0), mama (0x81611f), Topping on TOPD (0x815e1a), Slug (0x81529f), Planet on PLAN (0x814b0f), `FUN_00813733`: the five citizens (0x81483d) with the animation rates 1.0 / 1.1 / 0.9 / 1.3 / 1.3; HUD blocks: left column on, the 12-segment gauge, pizza icon texture 8 (`DAT_05d4dd14`); `FUN_00813d53` = restart (builder + attaches again) |
| 0x813500 | sounds | 28 x `FUN_00443580(id)` (2D) and `FUN_004433b0(0x1d6)` (3D, the flight loop): sound-table ids in `rules.ts` `SND` |
| 0x816562 | Pepper update | state machine of section 2; camera `FUN_00816220`; `FUN_008164d6` slot allocation, `FUN_0081638c` release |
| 0x812399 | Papa update | state machine of section 3; `FUN_008122a0` new round, `FUN_00812dbb` medal and variables, draw hook `FUN_00812ea5` |
| 0x815576 | Topping update | 10 slots (section 4); `FUN_0081543e` flight path, `FUN_008153c0` splat particles, draw hook `FUN_00815d2b` |
| 0x8140cc | citizen update | queue of five citizens (section 5); helpers `FUN_0081408f` (slot ahead), `FUN_00813f1e` (walk to a slot), `FUN_00813e03` (hit the citizen at slot 2), `FUN_00813e6c` (send the served citizen away), `FUN_00813f14` (is somebody at the counter); draw hook `FUN_008146ea` (CIT4 drawn 2 units further in z) |
| 0x814f6e | Slug update | the slug on its path (`FUN_00814bd0`), drawn at scale 0.4 (`FUN_008151c8`) |
| 0x815f30 | mama update | clap / fail clips; draw hook `FUN_0081603e` (rotated 3 pi / 4 about Y) |
| 0x814964 | Planet draw hook | planet and galaxy rotation (0.005 per frame) |
| 0x81167c | HUD per frame | icon tints, `%d` of the rounds left and of the score, then `FUN_0046055f` (the standard HUD) |
| 0x811790 | banner (mode 4) | score `%5d` at y 100, medal text at 150 (STD.str `SGBRONZE` / `SGSILVER` / `SGGOLD`), the medal sentence `OGSGMP03` / `02` / `01` at 200 (wrap 32) and its speech; no medal: `OGSGMP04` at 200 and `OGSGMP05` at 320, both spoken |
| 0x816ca0 / 0x81bcf7 | builder / loader | records and models (read by `extractZone`); records: 0 OGEL, 1 PEPP, 2 MAMA, 3 PAPA, 4..7 CIT1..CIT4, 8 SLUG, 9 CIT5, 10 NITE, 11 GALA, 12 PLAN, 13 BASE, 14 PIZ1, 15..19 PIZ2..PIZ6, 20..23 POT1..POT4, 24 TOPD, 25..28 TOP1 TOP3 TOP4 TOP2, 29..33 TOMA MEAT CHEE GREE TOPP, 34 PIZZ, 35 CRYS |

## 2. Pepper (`PepperNode`, ctor 0x816ba0, `FUN_00816562`)

Records PEPP (rig `MFIG.blk`, clips named in the dictionary: 3 PEP_MAP_STAND_IDLE, 4 RTOMATO, 6 RGREENPEPP, 7 CHUCK, 8 RCHEESE, 9 RPEPPERONI). State (`+0x18`):
0 -> 1; 1 waits for Papa's state 2 (`FUN_008134e2`), sets the idle timer `+0x20` = 60; 2 pick: when nothing is in the air (`DAT_05d5f4b0`) and no citizen is flying
(`DAT_05d5f4a0`) the timer falls by 1 and the camera goes to the close-up when it is below 0; a pressed button (Up 4 > Down 8 > Left 1 > Right 2) takes a free topping slot
(`FUN_008164d6`: first slot with `+4 == 0`), starts the pick clip and goes to 3; 3 plays the clip; frame > 16: sound by type and the slot becomes active (`+4 = 1`); close-up
while frame < 25; clip end: state 4 + clip 7; 4 plays clip 7 only up to frame 14 and waits for Space (pressed edge 0x80); 5 plays on; the direction (-1 Left held, +1 Right
held, 0 both / neither; the gamepad stick beyond +-0x14 is not ported separately) is read every tick and at frame >= 18 `FUN_0081638c(slot, dir)` lets go (state 1 -> 2, `t = 0`,
`DAT_05d5f4b0++`, one of `SND_MAP_THROW1..4` by `rand & 3` and `VOCAL1` / `VOCAL2` by `rand & 1`); clip end -> 6 -> 2 with the timer 60.
The camera (`FUN_00816220(rec + 0xc, mode, 1)`, every tick): look-at = Pepper + table `0x9560a8` [mode], eye target = Pepper matrix applied to `0x9560c0` [mode]; eye += 0.25 x
(target - eye); the same function sets the near plane `DAT_0089df30` (3.0 when mode 0 and the eye is within sqrt(0.1) of its target, else 1.0; `GameRenderer.near`); mode 0 (overview, eye (2, 4, -5), look-at (1.5, 2, 8)) / mode 1 (close-up from above, eye (0, 5.65, 1.5), look-at (0, 3.2, 2)). The constructor sets the camera without easing.

## 3. Papa (`PapaNode`, ctor 0x8132e0, `FUN_00812399`)

Rig MFIG, clips 10 PAPA_MAP_JUMP (the base state: it wraps every 59 ticks and each wrap plays `SND_MAP_PAPA_BOUNCE`), 13 PAPA_MAP_JUMPLOOK, 5 PAPA_MAP_DELIVER, hand bone 14.
Every tick: clip advance; the hand matrix (`+0x38`) = (Z rotation 2.1991 + translation (-0.3, -1, 0.3)) x bone 14 x record matrix; the base (record PIZ1's model) is drawn with that matrix
while `+0x20 != 0`, with the layers of the toppings on it (`+0x84` bits: TOMA 4 at z - 0.2, MEAT 8, CHEE 2, GREE 1 each 0.05 further towards the camera: `FUN_00812ea5`); the record sits at
(`+0x24`, `+0x28`, `+0x2c`) with an identity rotation. State:

| state | meaning |
|---|---|
| 0 | -> 1 |
| 1 | waits until slot 1 of the citizen queue is occupied; then `FUN_008122a0`: `+0x94` = toppings of the round (table 0x955bd8 = 2, 3, 4, 4, 4), each target = `1 << rand(0..3)` (HUD icon = the bit position, `DAT_05d4e144 + 8 i`), pending flags 1; gauge `+0xc8` = 12.0; `+0x84` = `+0x90` = 0; -> 2 |
| 2 | swing: x offset `+0x30` = 3 sin(angle `+0x34`); angle += speed `+0x8c` (0.015, +0.0075 per finished round); wrapped to [-pi, pi]; at a sign change of the angle: odd random -> stay, even -> state 3 and `+0x78 = 1`. Gauge -= 0.005 per tick (to 0). The record x = x offset |
| 3 | quick wiggle: amplitude 0.75, the angle runs up to 4 substeps per tick until the next sign change (-> 2, `+0x78 = 0`) |
| 4 | hit by a topping (distance 1.0 .. 1.5 to the hand): 25 % a sentence (`OGSGMP08` / `09` / `10` by a second random number), clip 13, -> 5 |
| 5 | at the clip end back to 2 or 3 (by `+0x78`) and clip 10 |
| 6 | round end: score += 250; if every landed type equals its target: score += `ftol(gauge) * 100 >> 1` and `SND_MAP_PAPA_YEAH` (rand % 5 < 3) / `PAPA_CHEERS`; level++, clip 5, -> 7 |
| 7 | frame >= 24: the served citizen leaves (`FUN_00813e6c`), base hidden, layers cleared, -> 8 |
| 8 | level < 5: frame >= 62: the next pizza of the stack is hidden (`PIZ6` .. `PIZ3` for rounds 1..4; `PIZ2` stays) and the base is back; clip end: clip 10, speed += 0.0075, -> 1. Level 5: clip end -> 9 and Pepper's and mama's clip 1 (the cheer) |
| 9 | -> 10; `FUN_00812dbb(score)` |
| 10 | dances (clip 10 restarted at every end) |

`FUN_00812dbb(score)` (0x812dbb): medal = 3 if score > 7500, 2 if > 5000, 1 if > 2500 else 0; `TROPHY_MAP` (var 0x3f) raised to the medal (only raised); `DAT_05d5f3e8` (the result) =
`2 - (TROPHY_MAP != 0)`, i.e. success whenever the *stored* trophy is not 0 (an earlier medal makes a failing run a "success" again); `HISCORE_MAP` (0xda) raised to the score (also
by a failing run). The banner uses the medal of this run.

## 4. The toppings (`ToppingNode`, ctor 0x815e1a on TOPD, `FUN_00815576`)

Slot (0x70 bytes): state (+0), active (+4), type (+8), direction (+0xc), ticks in the air (+0x10), model, matrix (+0x1c), start (+0x5c), spin (+0x68), life (+0x6c). The four template records
TOP4 / TOP1 / TOP2 / TOP3 hold the models (tomato 4 / pepperoni 8 / cheese 2 / green pepper 1). Per slot with `active`:

* state 1 (in the hand): matrix = (translation (0.094, -0.429, 0.135) x bone 14 of Pepper's rig) x her matrix; the start position follows it.
* state 2 (flying, `FUN_0081543e`): t += 1; z = start z + 0.264 t; progress = t / ((Papa z - start z) / 0.264); x goes from the start to -3 / the start x / +3 (direction), y to 3.04; spin 0.03 per tick;
  the 3D loop sound follows it. At z > -1 the sound stops and the distance d to Papa's hand decides: d < 1.0 lands on the base (layer bit, sound by type, landed list, +250 and `RIGHT_TOP`
  when it is the wanted type else `WRONG_TOP`; after the last topping of the round Papa goes to state 6, Pepper to 1 unless she holds one (it is released), `PIZ_DONE`; splat, mama clap,
  20 % `OGSGMP07`); 1.0 <= d < 1.5 hits Papa (Papa state 4, `HIT_PAPA` + one of EEK / OUCH / YEOW, splat); d >= 1.5 flies on (state 3) and mama's FAIL clip. Every non-hit sets mama to FAIL, every hit to CLAP.
* state 3: flies on; at z > 2.5 a 25 % sentence (`OGSGMP11` / `12` / `13`), splat; a cheese (type 2) thrown straight (direction 0) knocks the citizen waiting at slot 2 away
  (`FUN_00813e03`: only if he is in state 2): +500 once per game (node `+0x18`), `MAMA_CLAP` + `HIT_CITIZEN`; everything else `HIT_WINDOW`.
* state 4: the splat lasts 12 ticks (the original starts the "eatpizza" particles there), then the slot is free and `DAT_05d5f4b0--`.

## 5. The citizens (`CitizenNode`, ctor 0x81483d, `FUN_008140cc`) and the queue

Table `DAT_00955df8` (5 entries of 0x14 bytes: occupied, record, x, y, z): slot 0 = (-8, 0, 6.5) the exit, 1 = (-1.9, 0, 6.5) the counter, 2 = (0.5, ..), 3 = (4.1, ..), 4 = (16.5, ..) the entrance.
States: 0 hidden: when slot 3 is free the citizen enters at slot 4 and walks to slot 3; 1 walking (`steps = ftol(float(distance / 0.12) + 0.85)`, yaw = atan2(-dx, -dz): they walk backwards); at the end
of the walk: slot 0 -> state 6 (gone), else the next free slot ahead or state 2 at the slot (yaw pi, clip `CITIZEN_CLIPS[1]`); 2 waits (moves up when the slot ahead frees; when `DAT_05d5f4a0 != 0` -> 5);
3 hit: `y += 2`, `DAT_05d5f4a0++`; 4 flies away (`y += 0.024`, `z += 0.24`, spin x 0.1 per tick) until x rotation > 6 pi (188 ticks), then hidden, slot freed and the citizen starts again at state 0; 5 watches the
flying citizen (yaw towards slot 2's record) until the counter is 0. Order = record order CIT1, CIT2, CIT3, CIT4 (slot 3 free again), CIT5; one citizen per round leaves.
The clip numbers come from the table `{4, 4, 2, 7, 10}` (0x955d58); the rigs of CIT1..CIT5 have 3, 2, 4, 6 and 3 clips, so `FUN_0043b6a3`'s out-of-range clips (10, 7) do nothing and the citizens mostly keep
their first pose (`start` returns false in `AnimInstance`, as in the original).

## 6. Presentation

* HUD of mode 2 (`FUN_0081167c` + `FUN_0046055f`), 800x600 grid scaled to 640x480 like `Hud` does: pizza icon (texture 8) at (20, 20) with the rounds left (`5 - level`, `%d`) at (100, 69), the score
  (`%d`) centred at x = 400, the left icon column (4 slots, slot i at y = 516 - 72 i) with the topping icons (overlay textures 0 green pepper, 1 cheese, 2 tomato, 3 pepperoni): tint 0x7f7f7f7f
  when the slot is done, the first pending slot pulses `phase * 0x010101 | 0xff000000` (`phase += 0x10 & 0xff` per frame), the other pending ones white; the time gauge (`FUN_00460214`): 12 segments
  x 732 .. 764, y 492 - 16 i (textures 7 x 4, 6 x 4, 5 x 4: green, yellow, red) and the yellow arrow (texture 4) at x 696 .. 728, y = 508 - 192 f +- 16 with f = gauge / 12. No HUD in the other modes.
* Banner as in the table above. Speech lines come from `OG/Data/map.str` (`OGSGMP01..14`; `OGSGMP06` and `SND_MAP_PAPA_CONGRATS` are loaded but never used by the code).
* Music `Z41MAP` (BlueDanube, no command track), sound ids and speech in the tables of `rules.ts`.

## 7. Port notes: how the draw hooks are done

The original draws the toppings in the air, the base and the layers through draw hooks with hand-made matrices (`FUN_0043f1a0(model, matrix, texlist, 0)`). The port gives them helper records
(40 `TFLY`: one per slot and topping model, the renderer fixes a record's model when it builds the views; `DOUG`; `TOMAL` / `MEATL` / `CHEEL` / `GREEL`) that `game.ts` `syncClones` puts on those matrices every tick (`GameRenderer.refreshViews()` builds the views after they were added). The template
records (TOPD, TOP1..4, TOMA, MEAT, CHEE, GREE, TOPP, PIZ1) sit at the origin in the scene and are hidden (see differences). The other draw-hook work (Papa's identity matrix at his position, mama's rotation, the slug's
scale and path, the planet and galaxy rotation, CIT4's offset) is done at the end of each node's `update`, because the renderer reads the record matrices.

## 8. Differences and approximations (nothing is silent)

* **Particles**: the splat particles (`FUN_008153c0`, emitter at Papa + 0x88: `Particle/eatpizza.*` of the zone) are not drawn: there is no particle runtime yet. The splat itself (12 ticks, sounds) is ported.
* **Material animations**: `FUN_0043f1d0(model, 4, 5, params, flag)` binds the `.man` material animations of the records (`matanim/PLAN_Planet.man` ...): not ported (no runtime for `.man`).
* **Model-holder records hidden**: TOPD, TOP1..4, TOMA, MEAT, CHEE, GREE, TOPP and PIZ1 are placed at the origin by the scene and the original gives them flags 2; the port hides them (the toppings / base are drawn through the
  helper records). Unverified whether the original shows them there; hiding is the only sane look.
* **Frame-rate dependent bits** of the original that the port runs per 30 Hz tick: the planet / galaxy rotation (per drawn frame), the pulse phase of the first wanted icon.
* **Random numbers**: the original calls `FUN_004388ae(x)` = `rand() / 32767 * x` (the first call of a pick uses the milliseconds since the start as `x`, then `ftol(..) & 1` / `% 5`): the port draws `Math.random()` (the tests inject a seeded LCG).
* **Music** starts when the zone starts (`ZONE_MUSIC`), the original starts it when the intro is dismissed (mode 1 -> 9). The 3D flight loop plays through `SoundEngine.play3D` (listener = camera, set every tick).
* **Out-of-range score aliasing of the original not reproduced**: if a fifth topping of a round landed after the round was complete (two toppings in the air at once: not possible with the normal timing, the flight
  takes longer than pick + throw), the original writes its type into `papa + 0x9c + 4 * 0xc` = the score field; the port ignores it.
* The gamepad stick axis (`DAT_0098384c`, +-0x14) next to the direction bits is not read separately (the input mapper already turns the stick into the direction bits).
* The stub chain of the engine (M1 walk / swim nodes) is removed from Pepper: the zone has its own player node.

## 9. Tests and how to run

* `node tools/test-formats.mjs --only m3-z41MAP`: 166 checks (tables against the EXE: topping counts, queue slots, camera tables, hand offsets, medal thresholds in `FUN_00812dbb`, variable ids, the 28 sound ids against the
  `SND_MAP_*` names, the clip ids of the animation dictionary as `push id; push name` pairs in the loader; medal / trophy / hi-score rules incl. "stored trophy keeps the result a success"; the set-up (11 attaches, no skipped
  constructor, rigs, start clips, start camera, planet); camera easing; Papa swing / wiggle / gauge / speed; the queue; Pepper pick, hold, throw timing (released after 4 ticks at frame 18), flight maths; hit on the base,
  on Papa, far miss, window, the citizen bonus once; round end with and without the time bonus; two scripted games: WIN (bot: five rounds of 2 / 3 / 4 / 4 / 4 toppings, speed + 0.0075 per round, gold-ish score ~7500, vars written)
  and LOSS (17 wrong toppings, only the 5 x 250 round points, no trophy, hi-score written), a LOSS with an earlier bronze (result still success), determinism).
* `node tools/steps/...` (browser, headless and muted): see Shortcuts. Result of the last run: intro and help screens, HUD (rounds, score, icon column, gauge), pause menu -> restart -> a fresh run, WIN with real key
  input (a bot reading `game.debug()`, about two minutes: silver or gold, TROPHY_MAP = medal, HISCORE_MAP = score, banner, result menu page 16, continue -> story node 66 in z40OGL), LOSS (score 1250, no medal, banner text, result menu page 19, abort -> node 64 in z40OGL).

## Shortcuts

* URL: `?zone=z41MAP` jumps to the zone's first story node (65). `?zone=z41MAP&mute=1` for tests. F9 / F10 (the stub aids) do nothing here, the zone has its own game.
* `window.__zone.game.debug()` = `snapshot(S)` of `nodes.ts`: result, Papa (state, level, score, medal, gauge, angle, speed, targets, landed, hand), Pepper (state, held topping), queue, slots. `window.__zone.ctx`, `.world`, `.hud`.
* Node: `import { prepareWorld, stateOf, snapshot, lcg } from 'src/zones/z41MAP/nodes.ts'; const L = loadZone(ctx, 'z41MAP', { subgame: 28 }); const S = prepareWorld(L.world, L.archive); S.env.rng = lcg(1)`; drive with
  `world.input` (`held` / `pressed`) and `world.tick()`; `tools/lib/z41map-bot.mjs` (`Bot('win' | 'lose')`) plays from `snapshot(S)`.
* Shared files touched (additive): `src/shell/zonegame.ts` (`tickInBanner`, `bannerTick`: zones whose loop updates in the banner too), `src/shell/playzone.ts` (calls them), `src/game/render.ts` (`GameRenderer.refreshViews()`, `GameRenderer.near`: the near plane a zone's camera code writes to `DAT_0089df30`), `src/shell/audiohost.ts` (`AudioHost.preload(ids)`: the zone's sound set is loaded when the zone starts; `play` alone stays silent for a sound that is not loaded yet).
