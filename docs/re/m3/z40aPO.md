# z40aPO: "Parachute landing on Ogel" (M3)

Mini-game (story node 63, island -> z40aPO): Pepper in a space suit is thrown out of a shuttle above the planet Ogel, dives through 15 rings (three groups of five) past asteroids,
rock monsters and Ogel's rocket brickbots, opens a solar wing and lands on one of three targets. It is a copy of the z38PAR loop (0x7cf929) with a launch phase, more props
and an intro cutscene (`ogl02` of the `z40OGL` archive). Shared logic is in `src/zones/parachute/`.

Code: `src/zones/z40aPO.ts`, `src/zones/parachute/apo-pilot.ts` (pilot, DOM-free), `apo-props.ts` (asteroids, bots, rock monsters, wing, sky), `apo-run.ts` (state + sound slots),
`apo-hud.ts`, shared `sound.ts`, `rigs.ts`, `util.ts`. Cutscene: `src/shell/cutscene.ts` (runner, DOM-free) and `src/shell/cutscene-host.ts` (shell glue). Bot `tools/lib/apo-bot.mjs`.
Tests: `tools/tests/m3-z40aPO.mjs`, `tools/tests/m3-cutscene.mjs`. Browser: `tools/steps/m3-z40aPO.mjs`.

Story: success (result 1) advances to node 64 = z40OGL (Ogel hub, not yet a game zone: the port shows its scene with the stub overlay); failure + Abort rewinds to the island (node 61).

## 1. Functions ported

| address | function | role |
|---|---|---|
| 0x7cf929 | loop | modes; intro = cutscene then brief `OGSGPO12`, 6 controls; end: hiscore / trophy, result, speech |
| 0x7d53af | pilot constructor | node on PEPP; start (0, 2000, 0) |
| 0x7d3187 | pilot update (629 lines) | states 0 doors, 1 launch, 2 fall, 3 wing opening, 4 glide, 5 landing, 6 over, 8 bounce; rings by the RCnn disc under every ring, group-missed rule, landing test, camera |
| 0x7d3050 | segment vs box | `segmentHitsRecordBox` (rock monsters scaled 1.2) |
| 0x7d2fae | wing | `ApoWing` (scale to 0.6, tilt rx + 0.5236) |
| 0x7d2bf2 | rock monsters | `ApoRockMonsters` (wake < 80: OGSGPO08, clip, spin 0.06) |
| 0x7d2650 | brickbots | `ApoBots` (8 bots launched from (BOT_LAUNCH), aim at the pilot, explode on contact, 30 ticks respawn, active while the pilot is above 500) |
| 0x7d1778 | asteroids | `ApoAsteroids` (RKA +-0.5/15, RKB +-0.5/50 per tick) |
| 0x7d1429 | sky | `ApoSky` |
| 0x7d0839 | zone set-up | declares the cutscene (`z40OGL`, `og`, slot 0 `ogl02`, strings `apo01`), hides the three targets |
| 0x7d0cb0 | sounds | 32 loads, ids checked against `APO_SOUNDS` in the test |

## 2. Constants

Start 2000, group heights 1400 / 800 / 310 (a group without a passed ring below its height is missed: the flag of its last ring becomes 2), ring points 250 / 500 / 750 (groups 1/2/3),
landing 1000 / 1500 / 2000 at the centre of target 3 / 2 / 1, bonus 800 (max), radii 22.8 / 11.5 / 7.6, medals 2000 / 5000 / 8000 (0x8923d0 / d8 / 0x89297c), doors 0.02/tick to 2.09438
(105 ticks), launch about 24 ticks, pitch 0.07, wing allowed below a quarter of the start height.

## 3. Game variables

| var | name |
|---|---|
| 0x2c | SWITCH_GME_HISCORE_APO (raised when score > stored) |
| 0x43 | TROPHY_APO (1 / 2 / 3, only when the hiscore rises) |

Success = stored hiscore >= 2000.

## 4. Sounds / speech

`APO_SOUNDS` (rocket0-7, palace_amb, beacons, rock monster growls, engine, breath, hit_ring, hit_asteroid, hit_monster, hit_rocketbot, solar_open, 2d_accel, smack, landontarget,
land_offtarget, launch, thru_spacering, thruster, doos_OPEN). Speech: brief `OGSGPO12`, wing `OGSGPO09`, monsters `OGSGPO08`, bounce `OGSGPO11`, result gold 01 + 02, silver 03 + 04,
bronze 05, failed 06 + 07.

## 5. The cutscene runner (`src/shell/cutscene.ts`)

Generic runner for the compiled `.cut` scripts (`src/formats/cutscene.ts`): `CutsceneRunner` (scheduler, DOM-free) + `CutsceneHost` (shell glue: loads script + strings, speech,
subtitle drawing, letterbox, FOV). Wired through `ctx.cutscene`, `ZoneGame.introHold()` and `LiveGame.cutsceneRunning`. Scheduling follows FUN_00458c15 / 00459119 / 00459597
(wait / signal counters, 3 passes per frame, script ends the frame no command ran). Skip: Shift (like the original); Escape during the hold opens the pause menu.

| id (FUN_0045988b) | command | handler | status |
|---|---|---|---|
| 0 | SETVISIBILITY | 0x45c595 | done 1:1 |
| 1 | SETANIM | 0x45ce77 | approximated: clip via an env name map, no-op without a mapping |
| 2 | SAYTEXT | 0x45cf83 | done: speech, subtitle, minimum time (len + 20 + duration) / 20 s, skip |
| 3 | SETTARGET | 0x45cd23 / 0x45ec4f | done (actor yaw / camera look-at) |
| 4 | camera MOVETARGET | 0x45eeaa | done (eased move 0x45edae / eff9 / f1bc / f2f4) |
| 5 | SETPOSITION | 0x45c5e2 / 0x45ebc8 | done for waypoints; actor-target sides approximated (FUN_00422f21 not ported) |
| 6 | MOVEPOSITION | 0x45c66b / 0x45ecec | camera done; actor walks straight at 0.5/tick (approximated) |
| 7 | FOLLOW | 0x45f543 | camera approximated (look-at follows +3.37); actor no-op |
| 8 | SETSWITCH | 0x45f670 | done |
| 9 | WAV / MIDI | stub | no-op (never emitted) |
| 10 / 11 | SETMOVESPEED / SETTARGETSPEED | 0x45f5b8 | done |
| 12 | SETFOV | 0x45f64b | done |
| 13 / 14 | SETEXPRESSION / ATTACH | | no-op |
| 15 | ENABLEAI | 0x45d301 | done |

Not done: the end-of-script clean-up of Pepper (idle animation, camera behind her, walker re-pin), mouth frames. Spline targets are no-ops. The real `ogl02` (16 commands, 8 lines,
FOV 1 -> 0.5 -> 1, ~981 ticks = 32.7 s) runs in the test.

## 6. Known differences

- Particles (footsmoke, spray, bbflame, botexpl, rocket01, T_gold) not ported. The shuttle door-part rotations are not ported. The wing has no collision.
- Music starts at zone entry. The HUD left icon is absent (stale global in the original). Cutscene camera placement relative to actors is approximated.
- The browser bot has latency: the browser run expects >= 6 of 15 rings (node bot: 11 rings, score 6657 silver; browser WIN: 13 rings, score ~7650 silver, trophy 2, then node 64 z40OGL; LOSS: no wing, score 0, abort to island node 61).

## 7. Tests and how to run

```
node tools/test-formats.mjs --only m3-z40aPO,m3-cutscene -v
node tools/browse.mjs "http://localhost:5499/?zone=z40aPO&mute=1" tools/steps/m3-z40aPO.mjs --size 1280x800 --out /tmp/m3/z40aPO
```

## Shortcuts

- `?zone=z40aPO&mute=1` jumps to node 63. `__zone.game.debug()` = `apoSnapshot` + result / hiscore / trophy / cutscene state.
- Shift skips the intro cutscene: one skip per key press (edge), tap it repeatedly (the browser step does).

## M4 notes

The runner hooks (`ctx.cutscene`, `introHold`) are generic: another zone declares `await ctx.cutscene.declare([{slot, zone, script, strings, area}])` and `ctx.cutscene.start(slot)`.
Shared-file edits: `src/shell/zonegame.ts` (`ZoneGameCtx.cutscene`, `ZoneGame.introHold`), `src/shell/playzone.ts` (cutscene host, hold handling around the intro).
