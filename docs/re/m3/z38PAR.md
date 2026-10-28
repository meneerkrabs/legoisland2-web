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
| 0x467d38 | birds | `ParBirds` (3 Lissajous birds around (35.8, 29.5), call sounds at 50 %) |
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

- Particles (spray, footsmoke) not ported. The SHAD shadow is a flat quad, not terrain-deformed. SeaAmin / seabed animation skipped.
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
