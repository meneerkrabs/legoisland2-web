# z22BIP "the jungle biplane" (M6)

Mini-game of the Adventure Island chapter (zone table index 18, archive `z22BIP`, story node 46; after a win the story goes on at node 47 = z23DIP, after a loss / abort it rewinds to the
hub). Pepper flies a biplane along a fixed course through a jungle canyon behind Johnny's seaplane: bananas are shot at monkeys, rock monsters and targets, fuel cans and banana
bunches are collected, and the plane lands on a runway at the end of the course. Strings `AI/Data/bip.str` (`ADSGBI01..15`), HUD textures `Overlays/Z22Bip`, music key `carn`
(`FlyingCarn.sgt`, `ZONE_MUSIC`), hi-score `HISCORE_BIP` (var 0x27) and trophy `TROPHY_BIP` (var 0xd6).

## 1. Files

| file | what |
|---|---|
| `src/zones/z22BIP.ts` | constructor registrations (`registerCtor`), the zone game (HUD, sounds, intro / banner / result, hi-score), `game.setup` (the `BipSetup`) for the tests and the bot |
| `src/zones/z22bip/setup.ts` | `prepareBip`: the course, the nodes the original attaches from tables (monkeys, rope targets, propellers), rigs of the creatures, helper records for the projectiles, the camera's 50 settling steps |
| `src/zones/z22bip/spline.ts` | the course object (`BipSpline`): B-spline, frame, nearest point (FUN_00445340 / 00447280 / 00446af0 / 00447550) |
| `src/zones/z22bip/plane.ts` | the flight node `Walk` (FUN_0070b7b2 / 00709fac and helpers), the shared camera, matrix helpers |
| `takeoff.ts`, `landing.ts`, `recover.ts`, `johnny.ts` | the nodes `Takeoff`, `Landing`, `Recover` and Johnny's `csplane` |
| `monkey.ts`, `rocky.ts`, `props.ts` | monkeys + melons, rock monsters + stones, animated props / fuel cans / propellers / river / rope targets / PSwitch / SeaBed |
| `run.ts`, `rules.ts` | the shared state (the original's globals), sound slots, the CRT `rand`; the end rules (result code, hi-score, banner lines) |
| `tools/lib/bip-emu.mjs`, `tools/lib/bip-oracle.mjs` | the original's node code run in the x86 interpreter (host functions for engine calls) and the scenarios that compare it with the port |
| `tools/lib/bip-bot.mjs` | the scripted pilot (node tests and, injected into the page, the browser run) |
| `tools/tests/m6-z22BIP.mjs` | node tests (`node tools/test-formats.mjs --only m6-z22BIP`, ~400 000 checks, ~15 s) |
| `tools/steps/m6-z22BIP.mjs` | headless browser run: `BIP_RUN=win` (default, about 2 minutes), `loss`, `quick` |

Shared-file edits: `src/zones/index.ts` (one import line) and the progress log. Nothing else outside the zone's own files.

## 2. Ported functions (NL build)

| address | function | port |
|---|---|---|
| 0x706bee | zone loop | runner template (`playzone.ts`, `loopmachine.ts`): mode 7 / 0 (intro `ADSGBI15` at y 80) / 9 (help, 5 lines) / 2 / 3 / 4 (banner) / 5 (result menu: `(result < 3) + 1` -> page 16 / 19) / 8; the zone parts in `z22BIP.ts` |
| 0x708457 / 0x70814f / 0x707800 | init, node attaches, table attaches | extraction (`setup.attaches`) + `prepareBip` (tables 0x931aa0 monkeys, 0x9318a0 rope targets, 0x931a38 propellers read from the EXE) |
| 0x707da6 | the course | `BipSpline.fromMan`: 60 `.man` points (x negated), 2 extrapolated, 2 runway points |
| 0x708640 | sound slots | `SOUNDS` (14 positional, 14 plain; the test checks the ids against the loads) |
| 0x70835a / 0x709147 / 0x7091f6 | HUD set-up / text / sync | `syncHud` in `z22BIP.ts`: ammo `%d` left, score `%d` centre, fuel `%03d` right, 12-segment gauge with the arrow marker, the right icon runs through frames 5 .. 0x22 |
| 0x70b7b2 / 0x709fac | flight node constructor / update | `PlaneNode` |
| 0x70996a / 0x70988a / 0x709258 / 0x708e17 / 0x709c5f / 0x70b58c | fire, move bananas, hit tests, progress + score, box probe, draw (spin) | methods of `PlaneNode`, `syncDraw` |
| 0x70c36b / 0x70c014 / 0x70bede | Takeoff ctor / update / camera | `TakeoffNode` |
| 0x70e8b0 / 0x70e42c / 0x70e2c5 | Landing ctor / update / setup | `LandingNode` |
| 0x710167 / 0x70fdc0 | Recover | `RecoverNode` |
| 0x70df00 / 0x70db60 | csplane (Johnny) | `JohnnyNode` |
| 0x70fafb / 0x70f433 / 0x70f2be / 0x70efc0 / 0x70f6ec | monkey ctor / update / throw / melons / draw (turns to the plane) | `MonkeyNode` |
| 0x70cfd8 / 0x70ca17 / 0x70c998 / 0x70c5f0 / 0x70c774 / 0x70cdba | rock monster ctor / update / next state / spawn / stones / draw | `RockyNode` |
| 0x70ed68 / 0x70ea60 | rope target ctor / update | `RopeSlideNode` |
| 0x70daa6 / 0x70d960, 0x70d523 / 0x70d437, 0x70d6cc / 0x70d5e0, 0x70d352 / 0x70d140 / 0x70d271, 0x70e1ad / 0x70e010 / 0x70e0d4, 0x70fd0b, 0x7102f9 / 0x710220 | fuel can, croc / parrot clips, propellers, river, sea bed, PSwitch | `props.ts` |
| 0x445340 / 0x447280 / 0x446af0 / 0x447550 (+ 0x445660 / 0x445680 / 0x4458d0 / 0x4458f0 / 0x4478d0 / 0x447800) | the path object (type 0, vtable 0x892268) | `BipSpline` (checked against the original's code) |

Dead code of the build (never called, not ported): FUN_007088b0 / 00708ed4 (rope slides driven from the plane's node), FUN_00708808, FUN_0070bca0 (propeller spin-up), FUN_00709bdf, FUN_0070d875 / 0070d789
(an animation node no record uses). FUN_00709f7f only calls a getter. The four "wing" matrices the flight node updates (node +0xa8 .. +0x140) are written and never read.

## 3. The game

**Records** (index = byte offset / 0x68): 74 `PEPP` (the biplane, nodes PSwitch, Walk, Recover, Takeoff, Landing in this order, gated by variable 0xfa & 2 / 4 / 8 / 0x10), 75 `SEPL` (Johnny's seaplane), 76 `PROP`,
48 the river, 0 `SEAB`, 4-8 `ROC1..5` (rock monsters), 9-18 `PRT?` parrots, 19-25 `CRC?` crocodiles, 26-41 `MNK0..F` (16 monkeys), 189-198 `FUEL` (spinning cans; 199-201 are plain), `BANP` banana bunches,
`BANT` banana targets, `DTH?` / `SLD?` / `DTR?` rope targets (13 triples), 117 `BANN` / 118 `MELN` / 188 `G011` (models of the banana, the melon and the stone, parked near the origin), 3 `LAND` (the terrain).
Variable 0xfa = 8 at the start (PSwitch's constructor), then 2 (flying), 4 (crash recovery), 0x10 (landing).

**Course**: a uniform cubic B-spline through 64 points (`bippath.man` 60 + 4). The plane's "progress" is the nearest-point search of FUN_00447550 (two nearest control points, plane distances: the planes of the
object are the curve's tangents at the control points). `atEnd` = the second nearest point is past index 60.

**Take-off** (mode 8): the plane stands on the course start (4 above it) until Johnny has started (50 ticks) plus 20 ticks; then 100 ticks along the first 3 % of the course (progress += 3e-4), climbing 24.5 during the last 50
(`climb += climbSpeed`, `climbSpeed += 0.02`); at the end speed = 400, altitude = the climb, sound `plane_flyoff`, mode 2. The camera is 65 % eased to (0, 6, -20) of the plane; the loop runs it 50 times before the game starts.

**Flight** (mode 2, `PlaneNode.update`, per tick; buttons = FUN_004376f9 bits): Left / Right steering +-0.5 per tick up to +-2.2 (Left wins), eased back by 0.5; Up / Down pitch +-8 per tick up to +-128 (Up = nose down: the altitude falls by pitch / 64),
Alt raises the thrust by 160 up to 323.2 (it never falls by itself), Shift brakes (+0.25 up to 0.4 per tick, subtracted from the speed and from the thrust), Space fires a banana per tick while the speed is above 320 (4 gun mouths round robin,
muzzle speed 1.57 x 10 per tick, 20 ticks, 30 slots, 1000 bananas at the start). Speed += (2 thrust / speed - brake) (speed 400 at most, thrust 0 does not slow the plane); fuel -= speed per tick (100 x 6825 at the start: 57 s at full speed,
the course needs about three tanks); heading += speed / 256 x steering / 128; the plane moves speed / 256 along its heading; altitude 0 .. 96. The heading may stay at most 0.9 rad away from the course (the course heading at progress + 0.01).
Out of fuel: thrust 0, speed -10 and altitude -1 per tick. Fuel below 15 %: speech `ADSGBI09`, below 10 %: the alarm and the engine sound off; engine pitch = 56750 - 65.5 x pitch Hz.

**Hits**: every banana is tested against every `MNK` record whose monkey state is 1 (squared distance < 92: +700, state 2; **each banana within range scores, so two bananas in one tick give 1400**), `BANT` (< 32: +20 per tick per banana)
and `DTR` (< 48: +100 once for the partner record `DTH` + the same last character, which then turns over for 50 ticks and can score again afterwards); a banana that hit anything flies on in a random direction
(three numbers of the table of 40 random floats made from `srand(1)` at the start). The plane's own box (12 edges of a 4 x 4 x 4 box 4 ahead, swept outwards with radius / skin 1) decides what it touches: `FUEL` (+50 % fuel, the can moves
to the origin), `BANP` (+500 bananas, same), `PALM` (leaf particle), `LAND` (crash: sound, `ADSGBI13`, -100 points, thrust 0, mode 4). Johnny's progress against the plane's gives **+1 point per tick while the plane is ahead of him**.
Melons (monkeys, awake within 160 square / circle, thrown at the frames 15 / 35 / 54 of the 60-frame clip while the plane flies above 320, 4 per tick, 50 ticks, hit within 6.4) and stones (rocks, within 84.8 attack clip 1, stone at frame 87,
gravity -0.04, 300 ticks, sweep radius 1.6) spin the plane out (20 degrees per tick for 18 ticks, no input meanwhile) and cost 100 points; a rock hit by a banana (within 8) gives +100.

**Crash recovery** (mode 4, 30 ticks): the plane is flown from the crash to the course point at progress + 0.01 turning to the course heading, then mode 2.
**Landing** (mode 16): when the nearest point is past the course end: brake 0.4, thrust 0 (and its step), mode 0x10; 50 ticks to the first runway point, 30 ticks along the runway (skid sound), the camera fixed at (-900, 70, 400); then `landed`, mode 2.
**End** (every tick): `speed > 1 || fuel != 0 || atEnd` keeps the game running; if it is landed the result is `(max(score - 3000, 0) / 2000) + 2`, at least 3 (and then the score reads 100: **a landing below 5000 points is a bronze with 100 points**);
not landed: 0; out of fuel and stopped: 1 (failed). 3 bronze (5000), 4 silver (7000), 5 and more gold (9000; 11000+ is also gold). The result goes to the end banner: score at y 50, medal (STD `SGBRONZE / SGSILVER / SGGOLD`) at 100, `ADSGBI06 / 07`
(failed) at 140 / 300, `ADSGBI04 / 05` (bronze), `ADSGBI02 / 03` (silver), `ADSGBI01` (gold); hi-score / trophy written when the score beats the old one (trophy 0 / 1 / 2 / 3 for results < 3 / 3 / 4 / 5+). Success for the story = result >= 3.

## 4. Findings

* The decompile drops arguments and prints float math as ints (rock stones, monkeys); every constant and every call argument was read from the assembly. Doubles of the code: 0x8928b0 / b8 (engine pitch), 0x892890 / 98 (heading band 0.9), 0x8928c8 (1.5, unused), 0x892770 (0.6), 0x8928d8 (-0.01: the river's scroll), 0x892210 (2.0).
* The update functions of the zone all end in `mov eax, 1` ("stop the chain") except PSwitch (`eax = 2`); the draw functions only draw (the monkey's facing, the spin of the projectiles and the propeller matrices are updated in the draws, the port does them in the updates).
* A landing is followed by a crash: the first update after the landing finds the runway terrain in the plane's box (-100 points, `ADSGBI13`) before the result is evaluated. Faithful, visible in the tests.
* `FUN_00445680` / `FUN_00446af0`: a frame with right = norm(Tz, 0, -Tx), up = norm(T x right), forward = norm(P'(t)) and the normalised second derivative as the second output (Johnny's roll = N . right, eased by 1 / 40).
  Beyond progress 1 the code reads control points past the array (reached only after the landing started; not reproduced).
* The nearest-point progress uses planes made from the curve's tangents (`FUN_00447280`: `FUN_004466f0` fills a whole frame, the plane normal is its forward row).
* Monkey clips: 3 (60 frames, throws) and 4 (hit); the table's first value is never used (`param_3[7]`, the constructor leaves it as the allocator's fill). Rock clips: 1 attack (120 frames), 2 hit (60), 3 idle (45), 4 medium (120).
* Sounds that are loaded but never played in this build: splash (0x73), melon_fly (0x7e), rock_hit (0x2e5), hit_valley #2 (0x72).
* Speech lines `ADSGBI08`, `11`, `14` are not used by the code (the strings exist).

## 5. Tests

`node tools/test-formats.mjs --only m6-z22BIP -v` (about 400 000 checks, ~15 s):
* the constants / immediates / tables / vtable slots / constructor addresses against the executable, the sound loads of FUN_00708640;
* **the original's code against the port** (`tools/lib/bip-emu.mjs`: the zone's functions and the C runtime run natively in the x86 interpreter, engine calls are host functions; the port is compared tick by tick, floats within 2e-3 relative):
  the path object (planes, frame, normal, nearest point and its indices), the flight node over 900 ticks of scripted buttons (steering, pitch, thrust, brake, 280 bananas, hits on a monkey / banana target / rope target, a fuel can, a banana bunch,
  a scripted crash, the camera, the random table), the whole sequence take-off -> flight -> crash -> recovery -> landing (3374 ticks; the constructors of Takeoff / Landing / Recover / csplane run natively and read the `.SRC` files),
  a monkey with its melons (2 hits on the plane), a rock monster with its stones (2 hits, a banana hit), the rope target (incl. the 50-tick turn), the fuel can, the crocodile clip and the three propellers;
* the end rules (result codes, medals, hi-score, trophy, banner lines), the set-up on the real data (records, nodes, 242 helper records), the take-off timeline, a passive plane (crashes, out of fuel, result 1), the scripted pilot (collects fuel,
  hits monkeys, lands: result 3 after ~3400 ticks), the medal thresholds on the landing (4800 .. 30000 points -> 3, 3, 3, 4, 4, 5, 5, 6, 15), a banana hitting a monkey.

Browser (muted, headless, snapshot server): `BIP_RUN=win node tools/browse.mjs "http://localhost:5609/?zone=z22BIP&mute=1" tools/steps/m6-z22BIP.mjs --size 1280x800 --out /tmp/m6-z22BIP` (intro, help, the bot flies the whole course with
real key presses: 7 cans, 7 monkeys, landing, banner BRONS 100, result menu page 16, continue -> story node 47 / z23DIP, hi-score 100, trophy 1); `BIP_RUN=loss` (no input: out of fuel at ~75 s, banner, menu page 19, retry restarts the zone).

## 6. Not ported / approximations

* Particles: `Leaffall.par` at the plane (a palm hit) and the four `Spray01` waterfall emitters of the PKLW records are not drawn (no particle system); the palm hit is counted (`BipRun.leafBursts`).
* The underwater plane the sea bed draws (`FUN_00444500(-106)`) and the engine's draw scaling of the monkeys / stones / melons / bananas: the port bakes the scale (2 / 2 / 4 / 4) into the matrices of the records it draws them with (helper records).
* The 3D / 2D sound handles are the port's slots (`SoundBank`), the listener is the camera eye; music starts at zone entry (the original starts it when the play mode starts).
* The "GetTickCount" random picks (monkey chatter / hit sounds) use the tick count in milliseconds (30 ticks a second), so they are deterministic here.
* Beyond the course end the original reads memory past the control points (frames at progress > 1); the port yields NaN there (never reached while flying).
* The HUD gauge's corner icon (state +8 of the HUD record, never set by this zone) is off; the arrow marker and the 12 segments are drawn like the original's `FUN_00460214`.

## Shortcuts

`?zone=z22BIP&mute=1`. `window.__zone.game.debug()` is the snapshot (mode, speed, altitude, fuel, score, progress, stats, ...), `window.__zone.game.setup` the `BipSetup` (nodes, records). Keys: arrows (Up = nose down, Down = nose up), Space = bananas,
Alt = more thrust, Shift = brake.


## WP-PART-WIRE / WP-MINI (2026-10-29)

* **Emitters** (`FUN_00707800`, `src/zones/z22BIP.ts`): `FUN_00442900("Z22BIP")`; `Leaffall.par` on record 74 (matrix at `+0x1e1c`), offset 0, rotation (0, pi, 0), gate off; then `Spray01` on the ten records of the table at `0x9319b0` (206 .. 213, 215, 216; matrix = the record's), rotation (0, -pi/2, 0), gate ON (2, 1, 1). The leaf burst (`FUN_00709fac`, a hit on a `PALM` record): `FUN_00442a20(handle, 2, 1, 1)` immediately followed by `FUN_00442a40(handle)` (stop) = `run.onLeaf` (`fx.on(leaf); fx.stop(leaf)`). No `FUN_0044e8d0` in this zone.
  Checks: `m6-z22BIP` (the table, the names, the pushed rotation immediates against the executable), screenshots `tools/steps/m6-z22BIP-fx.mjs`.
* **Unchanged, why**: the baked draw scale (monkey / stone / melon / banana records) is the same matrix product the engine's draw scaling makes (the picture is identical; only the shading normals of scaled meshes could differ, not verifiable without the D3D layer); the NaN beyond the course end is unreachable (the plane lands first). The underwater plane (`FUN_00444500(-106)`, R6) is drawn by `GameRenderer` from the attach list (WP-RENDER).

### Exact float32 path and the cover test (WP-MINI, 2026-10-29)
The executable runs the x87 in 24-bit mode (control word 0x7f), so the emulated oracles of this zone run with `M7_CW=127` (`m6-z22BIP`, `m7-z22BIP-cover` set it themselves) and the port's course maths rounds like the code:
* `spline.ts`: `frame` (FUN_00446af0, used by Johnny, the take-off, the planes) and the new `frameB` (FUN_004466f0 = vtable +4 through FUN_00445660, used by the plane's course-ahead frame and the crash recovery: the same matrix with a DIFFERENT order of additions) are transliterated from the code, `nearest` (FUN_00447550: squares added z, y, x; plane dot products; `fst` keeps a float32 progress) and the plane table (FUN_00447280: `T . P` added z, y, x) likewise. Spline scenario: worst difference 0 above 1e-7 (was 2e-4).
* `plane.ts`: the heading wrap threshold is the DOUBLE 0x8928a0 = float32 pi (was 0.99999 pi), the band +-0.9 is cast to float by the code (0.8999999762), the step is `((float10)speed * K * sin(h) * dt)` with a float32 rounding after each product, the course heading's `atan2` is added to the correction unrounded.
* `m7-z22BIP-cover` (WP-VERIFY's lib, finished): 4.95 M comparisons at dt 1 and 0.5, 0 failures. The original reads the control points at floor(n * (progress + 0.01)) without a lower clamp: a plane far before the course start (scenarios that fly off) reads memory in front of the array (undefined behaviour; an unmapped address in the emulator): the scenario ends there (`originalReadsBeforeCourse`). `DEAD_ARMS` lists the arms no scenario takes with the reason (analog stick, compiler flags, re-run constructors on an existing node, jump-table bytes, rare Johnny end).
* The baked draw scale of bananas / melons / stones / monkeys: the cover test compares the banana, melon, stone and monkey draw matrices (scale included) with the original's `FUN_0043f1a0` calls: they agree (4.95 M checks), so the helper records stay; replacing them by an engine draw-scale call would change the plumbing, not a number.
