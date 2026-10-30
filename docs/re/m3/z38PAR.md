# z38PAR: "Parachute" (M3)

Mini-game of the island (story node 60, island -> z38PAR): Pepper jumps from a plane at 1360 m, dives through three rings, opens the parachute and lands on one of three
targets on a small island. Score = ring bonuses + landing points (+ 800 bonus). Shared helpers of both parachute games live in `src/zones/parachute/`.

Code: `src/zones/z38PAR.ts` (ctor registration, vars, medals, `startParRun`, `parSnapshot`, `parGame`), `src/zones/parachute/par-pilot.ts` (the pilot node, DOM-free),
`par-props.ts` (boat, birds, balloon, plane, canopy), `par-run.ts` (shared run state + sound slots), `par-hud.ts` (HUD model + gauge), `sound.ts` (`SoundBank`),
`rigs.ts` (animation instances), `util.ts` (segment/box tests, float32 steering ramp). Bot: `tools/lib/par-bot.mjs`. Test: `tools/tests/m3-z38PAR.mjs` (129 checks).
Browser: `tools/steps/m3-z38PAR.mjs`.

## 1. Functions ported

| address | function | role |
|---|---|---|
| 0x465d39 | loop | template modes; `introId LESGPT01`, 6 controls; mode 2 ends the game: hiscore/trophy writes, result 1/2, result speech |
| 0x46a926 | pilot constructor (node on PEPP) | `ParPilot`; hides the 4th PTER, sets initial state |
| 0x4686a3 | pilot update | `ParPilot.update`: fall/glide dynamics, pitch (Up/Down 0.07 rad per tick), yaw ramp (Left/Right, +-0.14 max, step 0.01, float32), wind, parachute open (Shift), flare (pull-up costs 50 per frame), ground probe, collisions (rings, targets, birds, plane, balloon, boat), landing test, camera |
| 0x4684ec | canopy | `ParCanopy` (scales to 0.55 at bone 8, shadow quad) |
| 0x4681c0 | plane | `ParPlane` (loops radius 70 around (-49.7, 705.5, -110)) |
| 0x467fae | balloon | `ParBalloon` (bounces the pilot, 400..460) |
| 0x467d38 | birds | `ParBirds` (3 Lissajous birds around (35.8, 29.5), a call sound with a 1 in 50 chance per tick and bird: `FUN_004388ae(50.0) < 1.0`; the first M3 text said 50 %) |
| 0x4676cd | boat | `ParBoat` (circle radius 400, +0.003/tick) |
| 0x468590 | segment vs record box | `segmentHitsRecordBox` (box centre is ADDED) |
| 0x467370 | sounds | 28 slots (`PAR_SOUNDS`; the test checks the ids against the EXE loads) |
| 0x466f50 | HUD | `ParHud` (compass strip 14+idx of 72, three ring icons with blink, missed icons 0xb2/0xb1/0xb0, altitude gauge with chute-allowed marker at 153/204) |

## 2. Constants (addresses in `par-pilot.ts`)

Start altitude 1360, glide ref 400, landing radii 22.8 / 11.5 / 7.6 (TAR3/2/1), chute fall 0.3, fall start 0.5, ring bonus 750 / 500 / 250 (RNG1/2/3) with an extra 1000 dive bonus
(pitch 4..5.5 rad when passing), landing points 5000 / 2500 / 1000 (centre of TAR1 / 2 / 3, linear to the edge), bonus 800, medals 2000 / 3000 / 5000 (0x8923d0 / d4 / d8).

## 3. Game variables

| var | name | written |
|---|---|---|
| 0xaa | HISCORE_PAR | raised when score > stored |
| 0xd1 | TROPHY_PAR | 1 bronze / 2 silver / 3 gold, only when the hiscore rises |

Success = stored hiscore >= 2000 (the original tests the stored value), result 1 -> story; else 2.

## 4. Sounds and speech

Sound slots by sound-table id: see `PAR_SOUNDS` (ambience 0x1a, sea 0x1b, wind freefall 0x18 / chute 0x19, chute_open 0x1c, hit_ring 0x29, thru_ring 0x2e, hit_pterodactyl 0x2a, hit_plane 0x2b,
hit_balloon 0x2c, smack 0x1e, Hit_targnochute 0x20, land_succes_targ 0x21, land_off_target 0x22, splash 0x23, bigsplash 0x1f, ...). Speech: intro `LESGPT01`; result gold 02 + 03,
silver 04 + 05, bronze 06 + 07 (+ 08 queued), failed 09 + 10 (+ 11 queued). Music: `ZONE_MUSIC` (starts at zone entry).

## 5. Known differences

- Particles: wired (WP-PART-WIRE, see the last section). The SHAD shadow is the terrain-following 5-vertex patch since WP-MINI. SeaAmin: the foam's texture wobble is ported (`uvScroll`); the seabed animation is not.
- Music starts at zone entry, not after the help screen. `plane_flyoff` (played by the original only on the mode-0 button-skip path) is not played.
- The ground probe uses the stale `groundY` over the sea, like the original.
- The browser bot has 2-4 ticks of latency, so the browser run expects >= 2 rings (node tests: all three, gold ~5956).

## 6. Tests and how to run

```
node tools/test-formats.mjs --only m3-z38PAR -v          # 129 checks: EXE constants, dynamics, rings, scripted WIN (gold) and LOSS, props, HUD, end rules
node tools/browse.mjs "http://localhost:5499/?zone=z38PAR&mute=1" tools/steps/m3-z38PAR.mjs --size 640x480 --out /tmp/m3/z38PAR
```
Browser run (own vite on 5488, WIN score 4193 silver, trophy 2, return to island node 61; LOSS crash score 0, abort to node 58).

## Shortcuts

- `?zone=z38PAR&mute=1`: jumps to story node 60. `__zone.game.debug()` returns the snapshot (`parSnapshot` + result/hiscore/trophy).
- Keys: Up/Down pitch, Left/Right steer, Shift opens the parachute when the gauge allows it.

## M4 notes

The island exit to PAR needs nothing special: the zone game is registered by `registerZoneGame('z38PAR')`; result 1/2 goes through `story.miniGameExit`.

## Differential test (WP-VERIFY)

`node tools/test-formats.mjs --only m7-z38PAR-emu` (tools/tests/m7-z38PAR-emu.mjs + tools/lib/m7-z38PAR-emu.mjs on tools/lib/m7-zone-emu.mjs; about 10.6 M checks, 20 s; `PAR_FULL=1` runs every natural scenario at both dt):
the ORIGINAL's whole update pass of the zone runs in the x86 emulation next to `World.tick()`: pilot `FUN_004686a3` (constructor `FUN_0046a926`), birds `FUN_004677a0`, balloon `FUN_00467e40`, seaplane `FUN_00468040`,
boat `FUN_00467520`, the canopy's draw hook `FUN_00468338` (all through their vtable slots, constructors 0x4676cd / 0x467d38 / 0x467fae / 0x4681c0 / 0x4684ec), the HUD feed `FUN_00466f50` and the end block of the loop
(case 2 of `FUN_00465d39`, run from the middle of the function on a prepared frame). Same buttons, same random numbers (`FUN_004388ae`, scripted); compared tick by tick: every record's matrix / Euler / visibility,
the nodes' fields (pilot +0x30..+0x80, boat angle / heading, bird phases, balloon flag, canopy scale), animation clip / frame (Pepper, 4 PTER), the run globals, the camera, the HUD values and every sound / speech call by sound-slot
identity (the loader `FUN_00467370` stores one handle per global; the log names it). The collision queries (sweep, probe, ground ray) are answered by the port's `CollisionWorld` over a world whose records mirror the original's
own emulated record array (the collision engine is not the subject). dt is a parameter of both sides: every scenario runs at dt 1 and dt 0.5. Scenarios: 8 natural jumps (bots: rings 3-2-1 / 3-1 / no chute / no dive / land on 1, 2, 3; 3 random-button
jumps) and 23 staged starts (pilot put into free fall next to the balloon, the plane, the birds (hit by the sweep and by the box test), rings 1 / 2 / 3, the dive bonus, the targets without chute, the sea with / without chute, landings).
`FUN_00468590` (segment against a pterodactyl's box) runs natively on 12000 random segments against `segmentHitsRecordBox`; the loop's end block over 418 cases (score x stored hiscore x stale trophy) against `parFinish` / `parResultSpeech`
(speech, queued line, vars 0xaa / 0xd1, result). Coverage printed in the notes: states 1..5 and 7, all three rings hit / missed, bounces (balloon, plane, birds, rings), all four landings, splash / big splash.

Deviations found and FIXED in the port (evidence = the oracle at the tick named):
* `par-props.ts` `ParBirds`: the call sound is `rand(50) < 1` (asm 0x4677d8 `push 0x42480000`), the port had `rand(2) < 1` (a call every other tick): the rand streams ran out of step at tick 3.
* `par-props.ts` `ParCanopy` (`FUN_00468338`): the matrix is built with the scale of this moment and the scale moves on afterwards; the port moved it first (the canopy was one step ahead: scale 0.05 against 0 at the first tick of the opening).
* float32 fidelity of the props (boat angle / heading / the float locals, bird phases and positions, balloon y, seaplane rx, canopy scale): all are float node / record fields in the original, the port accumulated doubles
  (bird phases drifted by about 1e-5 rad after a few thousand ticks, the boat heading by 4e-6 at once).
* `par-pilot.ts` `ground()`: `FUN_00442a70` is the centre ray plus the four corner rays of the blob shadow (`shadowPoints` of apo-pilot.ts); the corner rays move the engine's hit cache, so the single centre ray of the port
  returned another polygon at an edge (groundY 0.0 against -0.001 at tick 86 of the bot jump). The port now calls `shadowPoints` and reads pts[4] / pts[3..5].
  (`tools/tests/m5-audit-z38PAR-emu.mjs`: its `ground` host now calls `shadowPoints` too; `tools/tests/m3-z38PAR.mjs`: the "50 %" assertion became 1 in 50.)

Deviations RECORDED (not fixed, listed in the notes of the test with counts):
* dt 0.5: `ParPilot` / `ParBirds` call `anim.advance(rate)` without `w.dt` (the original's `FUN_0043b76a` steps by rate * DAT_008b1718): at dt 0.5 the animations run twice as fast; the test passes the world's dt for those calls (227615 of them
  in the full matrix) so that the rest of the dt 0.5 run is still compared.
* dt 0.5: `src/zones/z38PAR.ts` calls `hud.update(run, pep.ry)` without `world.dt` (the ring-icon blink counters step by `1 * DAT_008b1718`).
* the altitude gauge: `FUN_00466f50` does not clamp `DAT_05d4e138 = 204 - local_20` below (it exceeds 204 when the pilot is above the altitude where the gauge last was in its first phase, e.g. after a bounce); the port clamps the marker to the bar.
* the SHAD record: the original shows it only inside the canopy's draw hook (flags |= 2, draw, flags &= ~2) with the five vertices `DAT_05d57da8`; the port keeps a flat quad visible while `DAT_05d57de4` is set (known, render only).
* `FUN_00468590`: the hit POINT the original returns is overwritten by the range checks of later faces (`FUN_0043d5ec` assigns before its conditions are complete): the port returns the clean point; the callers use the normal only (normal agrees on 649 / 649 crossings).

(Settled, see the last section: PARA's collision file is header-only in the original's loader, it is never hit.)

## WP-PART-WIRE / WP-MINI (2026-10-29)

Emitters (derived from the original's call sites; `src/zones/parachute/par-fx.ts`, wired in `z38PAR.ts` after `startParRun`, `ZoneParticles.create` = the zone's own archive: `Particle/` has cloud01 / footsmoke / James01 / spray01):
* `FUN_0046a926` (the pilot's constructor, first of the zone's attaches, record 8): `footsmoke.par` (0x46a99b) on the static matrix `DAT_05d57de8` (= bone 7 of the pilot's pose x his record matrix), `footsmoke.par` (0x46a9cb) on `DAT_05d57e28` (bone 5), `spray01` (0x46aa13) on record 3 (LAND, 0x144) at (92.803, 71.484, -126.834) (`DAT_00987660 == 0`, the default display); all offset 0 (except spray01), rotation -pi/2 about x, gate (2, 1, 1) = on. A second call of the constructor (restart of the node) switches the three on again (0x46aa6b / 83 / a4).
* `FUN_004676cd` (the boat, record 40): `James01` (0x467729) on the BOAT's live matrix, offset 0, gate on; `FUN_00467520` (its update) calls `FUN_00442a00(handle, record + 0xc)` first (`ParBoat.update`, `boatTick`).
* `FUN_004686a3` (the pilot's update): states 4 / 5 switch both footsmokes off (0x46a734 / 0x46a74f, handles +0x88 then +0x84), every other tick refreshes the two bone matrices from the pose of the LAST DRAW (`src/zones/common/pose.ts`: `poseAt` of the (clip, frame) at the start of the update, `composeBone32` = `FUN_0043a9e5` in float32 steps); state 5 (`case 5`) switches `spray01` off (0x469d1c).
* `cloud01` and `Volcano01` (the file `spray01.par`: the first line decides) are in the archive; the original's code never starts `cloud01`. (The stale-appearance finding of the particle oracle used cloud01 as a test effect.)
Not exact: the initial content of the two bone matrices before the first update tick (the original composes them in the constructor from the animation buffer before any draw: unknown content; the port uses the record's own matrix; the first engine update happens after the first node update, so nothing is emitted from it). Verified: node test `m8-wire-z38PAR` (start order / arguments / gate sequence of a whole scripted game), headless screenshots (`tools/steps/m3-z38PAR.mjs`: the purple footsmoke trails at the body in the free fall and under the chute: `par-4-ring3`, `par-6-glide`).

Residuals closed (WP-MINI): the animation advances of the pilot, the birds and the end banner scale with `dt` (`FUN_0043b76a` steps by rate * `DAT_008b1718`: `anim.advance(rate, dt)`), the HUD ring blink counters step `1 * dt` as float32 (`FUN_00466f50`), the gauge value `DAT_05d4e138` is kept unclamped in `ParHudFrame.gauge.value` (the draw function `FUN_00460214` clamps its ratio to 0..1, which `marker` does), the SHAD patch (`FUN_00468250`: shown only while `DAT_05d57de4`, vertices = `DAT_05d57da8`, `GameRenderer.vertexOverride`). `rand()` defaults to the C runtime generator (`// RNG:`, `common/tickrand.ts`).

### PARA collision, header-only collision objects, bounce exactness (WP-MINI follow-up)

* PARA (the canopy, record 34, flags 2) never takes part in the pilot's sweeps: `PARA_Chute.col` is loaded by the zone loader with `FUN_0043f700` (header only, count 0; line `push path; call 0x43f700; mov [ecx + 0x1c], eax` of `FUN_0046ea70`, slot 7). The slot finder `headerOnlyColSlots` (src/game/colshapes.ts) only knew the disp32 form of the store (`89 81 / 89 82`, slots >= 32) and so missed every header-only slot below 32: z38PAR's `PARA_Chute.col` and the 10 minifig parts / `Pterodactyl.col` (slots 22..31), and in other zones z04IFC (25..31), z09JST (31), z36CNT (18..31), z41MAP (5, 28, 30, 31), z50LTC (19..31). It now reads the disp8 (`89 41 / 89 42`) and disp0 forms; the island's 188 slots are unchanged. With the polygons the same sweeps hit PARA on 1682 of 1683 ticks (control in `m8-para-collision`), so the port had to exclude it by hand (`flags |= 0x10`); that hack is gone: PARA keeps flags 2.
* Consequence for the pterodactyls: `Pterodactyl.col` is header-only too, so the sweep never hits a bird; only the box test `FUN_00468590` does, and it plays `hit_pterodactyl` (the old test text "the sweep hit is silent" described the port's polygon path).
* Exactness found by the oracle on the way (`m7-z38PAR-emu`, now 10.6 M checks, 0 differences): the bounce vector `+0x78 / 7c / 80` is float32; `FUN_0043cfee` rounds `n * -2`, `* d` and `+ v` separately; the random normal `rand(2) - 1` of a flat hit is stored as a float; the box test of the birds is `rockBoxHit(.., scale 1)` (the same code as z40aPO's `FUN_007d3050` without the 1.2); the wind matrix is `buildMatrixF32`; the oracle world gets `SEAE.flags |= 0x10` (the SeaAmin constructor's write, not run by the oracle).

