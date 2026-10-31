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
| 1 | SETANIM | 0x45ce77 | not used by `ogl02` (its 16 commands: SETVISIBILITY x2, SETPOSITION x2, SETTARGET x3, SETFOV x2, SAYTEXT x7); the host runs the faithful WP2 handler (zone dictionary) if a script has it |
| 2 | SAYTEXT | 0x45cf83 | done: speech, subtitle, minimum time (len + 20 + duration) / 20 s, skip |
| 3 | SETTARGET | 0x45cd23 / 0x45ec4f | done (actor yaw / camera look-at) |
| 4 | camera MOVETARGET | 0x45eeaa | done (eased move 0x45edae / eff9 / f1bc / f2f4) |
| 5 | SETPOSITION | 0x45c5e2 / 0x45ebc8 | done (WP2: FUN_00422f21 actor-relative sides ported; ogl02 places the camera by waypoints) |
| 6 | MOVEPOSITION | 0x45c66b / 0x45ecec | not used by `ogl02`; the host runs the faithful WP2 handlers (waypoint walker FUN_0045c66b / 0045c80d, the camera's eased move / B-spline) |
| 7 | FOLLOW | 0x45f543 / 0x45cb50 | not used by `ogl02`; WP2's faithful handlers (camera look-at follows the actor +3.37, the actor's walker follow mode) |
| 8 | SETSWITCH | 0x45f670 | done |
| 9 | WAV / MIDI | stub | no-op (never emitted) |
| 10 / 11 | SETMOVESPEED / SETTARGETSPEED | 0x45f5b8 | done |
| 12 | SETFOV | 0x45f64b | done |
| 13 / 14 | SETEXPRESSION / ATTACH | 0x45d294 / 0x45d2b9 | done (WP2); not used by `ogl02` |
| 15 | ENABLEAI | 0x45d301 | done |

(Updated by WP-ISLAND, gaps S9: the end-of-script clean-up of Pepper (idle animation, camera behind her, walker re-pin), the mouth frames and the spline targets were ported by WP2, `m4-wp2-*`; the table above predates that.) The real `ogl02` (16 commands, 8 lines,
FOV 1 -> 0.5 -> 1, ~981 ticks = 32.7 s) runs in the test.

## 6. Known differences

- Particles: wired (WP-PART-WIRE, last section). The shuttle door-part rotations are ported (`ApoPilot.turnDoors`, `GameRenderer.partMatrices`). The wing has no collision in the port (UNCERTAIN, see the oracle notes).
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

## Differential test (WP-VERIFY)

`node tools/test-formats.mjs --only m7-z40aPO-emu` (tools/tests/m7-z40aPO-emu.mjs + tools/lib/m7-z40aPO-emu.mjs on tools/lib/m7-zone-emu.mjs, a vendored extension of the M5 audit's tools/lib/apo-emu.mjs; about 24 M checks, 25-40 s; `APO_FULL=1`
runs all 19 natural scenarios at both dt, about 3 minutes): the ORIGINAL's whole update pass of the zone runs in the x86 emulation next to `World.tick()`: pilot `FUN_007d3187` (constructor `FUN_007d53af`), rock monsters `FUN_007d28e0`,
brickbots `FUN_007d19e0`, asteroids `FUN_007d14b0`, the wing's draw hook `FUN_007d2dd8` (all through their vtable slots; constructors in the order of `FUN_007d0839`), the HUD `FUN_007d0f00` and the end block of the loop
(case 2 of `FUN_007cf929`, run from the middle of the function). Same buttons and random numbers; compared tick by tick: every record that either side moved (all of them every 64 ticks): matrix / Euler / visibility; the pilot's node, the 8
bot nodes (aim, flying, timer, counter, exploded), rock-monster flags and animations, asteroid spins, the wing's scale, Pepper's animation, all globals (score, ring flags, groups, height, canopy, chuteOk, landScore ...), the camera, the shuttle's
sub-object matrices, the shadow patch, the HUD values and every sound / speech call by sound-slot identity (`FUN_007d0cb0` stores one handle per global). The collision queries answered by the port's `CollisionWorld` over a world mirroring the
ORIGINAL's emulated records (so the props evolve independently of the port's); the rock monsters' box test `FUN_007d3050` runs natively (12000 random segments against `segmentHitsRecordBox(1.2)`: 864 crossings, 0 disagreements, normals equal).
dt is a parameter of both sides: every scenario runs at dt 1 and dt 0.5. Scenarios: natural jumps (3 bot landings, idle, no wing, chases and dives at the rock monsters / asteroids / targets, the sky sphere, 3 random-button jumps)
and 16 staged starts (next to each rock monster, the targets without wing, the planet, the brickbots, wing at low altitude, a landing, a random start). The end block over 440 cases (score x stored hiscore x stale trophy) agrees with
`apoFinish` / `apoResultSpeech` (hiscore, trophy 0..3, result, speech lines).

Result: no deviation in the pilot, the props or the end rules; WP-TIME: at tolerance 0 (bit exact: the 1e-5 / 6e-4 floors and the shadow-point tolerances are gone, see the WP-TIME section). Recorded (the code belongs to the M5 audit, not changed here), with counts in the notes of the test:
* (the two dt 0.5 items, `anim.advance` without dt and `hud.update` without `world.dt`, were closed in WP-MINI and are now failures of the test if they come back.)
* the altitude gauge value `DAT_05d4e138` is not clamped below in the original (it exceeds 204 when `height > refAlt`, e.g. after a bounce); `ApoHud.gauge.value` keeps it unclamped and equal to the original's, only the marker fraction is clamped to 0..1 (the draw `FUN_00460214` does the same).
* the SHAD record is visible inside the wing's draw hook only in the original; the port keeps it visible while the pilot glides (render only). The rock monsters' hit point `FUN_007d3050` returns is overwritten by the range checks of later faces
  (`FUN_0043d5ec`): the port returns the clean point, callers use the normal only.
* the beacon of target 1 uses the same global as the beacon of target 3 (`DAT_05d5ee38`; `DAT_05d5ee44` is loaded but never played): matches the port's `beacon1`.
Not covered: the intro (mode 1: cutscene, the camera ease and the reset of the pilot to (0, 2000, 0) read as in the port), the loop's modes 0 / 7 / 8 / 9 / 5 (generic template).

## WP-PART-WIRE / WP-MINI (2026-10-29)

Emitters (`src/zones/parachute/apo-fx.ts`, wired in `z40aPO.ts` in the order of the zone's attaches; the archive's `Particle/` folder: bbflame / botexpl01 / footsmoke / T_gold / rocket01):
* `FUN_007d53af` (the pilot, record 6): `footsmoke.par` (0x7d53dc) on `DAT_05d5f210` (bone 2 of the pilot's pose x his record) at (0.79, 0.07, -0.53), `footsmoke.par` (0x7d5413) on `DAT_05d5f250` (bone 4) at (-0.79, 0.07, -0.53), `T_gold.par` (0x7d5484) on record 3 (TAR1) at the origin, rotation -pi/2 about x; then (every call) T_gold off, the footsmokes on. T_gold goes on (2, 1, 1) every tick in the free fall while the pilot is below the third group's height (310) and a ring of the group was passed (0x7d3b58, the `else` of the "group missed" test: `ApoPilot`), the footsmokes go off in the states 5 / 6 (0x7d4cde / f9) and otherwise the bone matrices are refreshed (pose of the last draw, `common/pose.ts`) at the end of the update (the port's collision test runs after the camera block, so this is done after it, with the final state).
* `FUN_007d2650` (the eight brickbots, records 69..76 = BBT0..7): `rocket01.par` (0x7d2834) on each bot's live matrix, no rotation, gate on; `FUN_007d19e0` switches a bot's rocket off (1, 1, 1) while it is parked and the pilot is below y = 500 (0x7d1c54... in `ApoBots`), on at its launch (0x7d1c08). `botexpl01.par` goes through `FUN_004429e0` (returns the invalid handle 0xbabababa; nothing is started, no slot is used) and every gate / matrix call on it is ignored; `bbflame.par` is never started.
Verified: node test `m8-wire-z40aPO` (14 checks: executable names, 11 starts in order with arguments, the constructor's gate calls, a whole scripted game for the footsmoke gates and the rocket gates, the T_gold condition), the oracle `m7-z40aPO-emu` (23.4 M checks, 0 differences, unchanged by the edits).

Residuals closed (WP-MINI): the pilot's / rock monsters' animation advances use `dt` (`anim.advance(rate, dt)`), the HUD spin counters step `1 * dt` as float32 (`hud.update(run, dt)` was called without dt), the gauge value is kept unclamped (`gauge.value`; the draw clamps). The SHAD patch was already `vertexOverride`. Open: the wing's collision (UNCERTAIN: whether `PARA` takes part in the pilot's sweeps needs the collision primitive `FUN_00441270` run against the real record flags: the oracle world copies the port's flags).

PARA collision question (WP-MINI): SETTLED by running the original's `FUN_00441270` (tools/lib/col-oracle.mjs, x86 interpreter, cw 0x7f). z40aPO's PARA (wing, record 79) keeps the scene's flags 2 and the collision object of `solaarwing.col`, an NCOL file (no polygons: count 0), so no sweep finds anything in it; the port no longer sets the 0x10 exclusion (only its own 0x8000 'zero scale' bit). `tools/tests/m8-para-collision.mjs`: all 2493 pilot sweeps of a whole scripted game plus 400 random sweeps with the opened wing: the original never hits PARA, the port neither. (z38PAR's PARA is the header-only `PARA_Chute.col`: docs/re/m3/z38PAR.md.) Also fixed here: the bounce vector is a float32 node field and `reflect` is `FUN_0043cfee` in the machine code's order (`reflect32`: three float stores per component), the random normal `rand(2) - 1` is stored as a float.

## WP-TIME (2026-10-30): time step, random numbers, tolerance 0

* Time: fixed 60 Hz sim step, one tick = one drawn frame. Audit: dt-scaled float32 `x * dt`: pilot (door, pitch, fall, yaw steps), wing / canopy scale 0.05, bots (timer, 2 * dt flight, ry 0.3 * dt), rock monsters (ry 0.06 * dt, animation), asteroid spins, the HUD spin counters (`1 * dt`); animation advances all carry `dt`; the bots' `counter + 1` is the original's integer step per 30 time units; per drawn frame (the intro's camera ease 0.85 per loop pass in mode 1, the HUD feed) once per sim step, not multiplied. The intro camera settle (`FUN_007cf929` 0x7cfb96) is now float32 per operation. `ApoHud.update` takes `dt` as a required argument.
* Random numbers: `parachute/util.ts` (shared with z38PAR) draws from `src/game/crt.ts`; the 28 constructor draws (asteroid spins) and the run-time draws keep the original's order; `FUN_004388ae` runs natively in the oracles on the scripted `FUN_0085daf0`. No ms-scaled picks in this zone.
* Tolerance 0: `m7-z40aPO-emu` (23.4 M checks, dt 1 and 0.5) and `m5-audit-z40aPO-emu` (14 M) compare for equality, including the HUD gauge value (unclamped) and the sound arguments; `APO_TOL` is gone. `m3-z40aPO` runs the scripted WIN and the HUD spin counter at `world.dt` 0.5 too.
