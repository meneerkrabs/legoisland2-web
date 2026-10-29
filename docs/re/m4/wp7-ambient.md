# WP7: ambient life, music and the island's director

Code: `src/island/ambient/` (`index.ts` registers the constructors), test `tools/tests/m4-wp7-ambient.mjs` (`node tools/test-formats.mjs --only m4-wp7-ambient`).
All behaviour is ported from the decompile (`LE2.c`, addresses below); node fields carry the byte offset of the original node block in comments.

## Registered constructors

| ctor | node (kind) | records (era 0 roster) | file |
|---|---|---|---|
| `FUN_004b2149` | Bunny | RBT0-4 | animals.ts |
| `FUN_004b2d44` | Butterfly | BFS0-9, BFG0-9 | animals.ts |
| `FUN_004b31db` | SwiftLeader | SFT9 (pos 0) | animals.ts |
| `FUN_004b3a92` | Swift | SFT0-9 (SFT9 pos 1) | animals.ts |
| `FUN_004bdbb2` | Spin | PORA, PORS | misc.ts |
| `FUN_004b1212` | SeaAmin | SEAE | misc.ts |
| `FUN_00538779` | Sound3d | HSE2 (era 0), LOON (era 3) | misc.ts |
| `FUN_00536e16` / `FUN_00536961` | BOTMUSIC / GETO | BBT0-5, BBR0, BBG0, BBB0, BBY0 / GETO (era 3) | misc.ts |
| `FUN_004bd4a8` | Brikimal | BML1, BML3 | brikimal.ts |
| `FUN_004bc773` | Music | PEPP (pos 0) | music.ts |
| `FUN_004b8c73` | LGI_FSM = the director (update `FUN_004b7c78`) | PIZ4 (era 0) | director.ts, **not registered** (see below) |

Not ported: Ptera (`FUN_004bb1a6`, update `FUN_004b93b0`, PTER / GLDR in era 3), see the last section; seagulls (`FUN_004b4000`): not on the
island (only referenced from z13CAI / z14OSD code, 0x61b0f5, 0x61ba98, 0x629052).

## Shared helpers (common.ts)

* **Animation instances**: the island loader `FUN_004f645b` gives records 9..66 an animation instance (`@0x519c09..0x51a8f0`: `rec.anim = FUN_0043b4e2(rig, 1)`,
  then clip 1 frame 0; rigs `SKBD` 9, `MFIG` 10-50, `SWFT` 51-60, `RBBT` 61-65, `PTER` 66, names at 0x8dbe28..). The port's `setupZone` only animates PEPP.
  `islandRigs(pe)` scans that code at run time, `ensureAnim(w, rec)` creates the instance lazily. **Lead: better done once in setupZone for every node family.**
* **Sound handles**: `FUN_004b037e` loads the island's sounds into globals (`push id; call 0x4433b0 (3D) / 0x443580 (2D); mov [global], eax`) and copies 41 of them
  into the director's list `DAT_05d58214..`. `islandSoundHandles(pe)` reads that code at run time (global -> sound id). **Preload list for the lead** (ids, hex):
  `11c 12b fd fe 0 2 133 104 132 8b 8d 102 103 129 fc f9 163 125 8c fa fb 2df 2ed 2ea 2e6 2e7 2dd 2ee 2eb 370 374 378 376 377 375 372 364 37d 37b 37c 339 338 337 336
  33a-358 (the cue sounds) 132 36e 36f 383 385 384`, plus the Ptera's 0x302 / 0x303 (FUN_00443580 in its constructor).
* `rand(max)` = `FUN_004388ae` (`rand()/32767*max`), replaceable for tests (`setAmbientRandom`).
* Frustum flag (record flag 1, `FUN_00444370`): `IslandCtx.inFrustum` when the zone game has it, else every record counts as in view.
* `groundSnap`: the controller probe `FUN_00427014(ctrl, (0,8,0), (0,-16,0), 3, 0x50)` (flags 0x1053, run by the probe pass `FUN_00427233`, not ported as a pass)
  approximated by the ground record's ray from pos + 8, taken when the hit lies within the 16-unit segment.

## Animals

**Bunny** (`FUN_004b18fb`, prerender `FUN_004b1ffb`): args f32 range (x8), f32 speed (x8). States: 0 sit (clip 1), 1 sit (clip 3), 2 hop (clip 2), 3 run to a burrow,
4 dive (pitch 0.75), 5 come out of another burrow (pitch -0.75), 6 startled (clip 4). The animation's loop wrap (rate 1 sitting, 2 hopping) counts `+0x3c` down;
below 0 `FUN_004b17eb` picks the next state (after 10 picks a 7% chance per pick to go to a burrow, else a random other of 0..2). Hopping turns home when outside the
box (`FUN_004b1330`: SIGNED x/z test against the range, then squared 3D length) and wanders inside half the range (`FUN_004b13f4`). Burrows = table 0x8d9208
(3 x xyz, y -1 until the first bunny puts them on the terrain with `FUN_0043cd62(p, 40)`). Shift within 8 units startles a bunny (sound 0x103 at Pepper); five at
once (`DAT_05d582f8`, checked in the prerender) set `SWITCH_GME_LGI_EXTRA_SCOREITEMS` bit 1 and add 1000 to vars 0xa6 / 0x12 (once). Out of view for 101 ticks and
farther than 16: frozen.
**Butterfly** (movement in the PRE-RENDER hook `FUN_004b2539`): home = own position (BFG*: BFG0's, record 143), wing flap = the y column scale of the matrix (+1 .. -1,
0.6667 / tick, `FUN_0043a742` scale 1.5, 2 while following), random heading every 10..20 ticks, height kept within home.y .. +6 by `vy` re-rolls. Shift (more than
4 ticks after the previous Shift) within 8 units: follows Pepper at speed 0.2 (floor = Pepper y + 0.8), a quick double Shift releases it. 200 ticks out of view:
reset to the start position and frozen.
**Swifts**: the leader node on SFT9 follows a uniform cubic B-spline (`FUN_004454e0` / `FUN_00445660`, `SplineBase.cpp` vtable 0x892268: basis
[-1 3 -3 1; 3 -6 3 0; -3 0 3 0; 1 4 1 0]/6, u = n t, n = the `.man` header's frame count, points = the frames' translations with x negated (`FUN_0043ecd0`), a missing
last frame repeats the previous one) through `swift.man` (or `bat.man`, type 0), t += 0.0001 / tick, target = point - (16, 0, 0); it plays sound 0xfd at SFT9 every
tick and is not drawn (draw returns 1). The followers steer at 2 units / tick towards it (`FUN_004b336d`: yaw and pitch turn by dist/8 * 0.0333 per tick; within
1.0/8 they wobble for 20 ticks). The leader's mode 1 (bats: perch 500 ticks, fly a lap, come home) is ported but not used on the island.

## Spin, SeaAmin, Sound3d, BOTMUSIC, Brikimal

* **Spin** (`FUN_004bd900`): axis short (0 x / 1 y / 2 z) and rate (0.00873 = 0.5 degree) per frame (no dt in the original). Field +0x16 (face the camera) is never set.
* **SeaAmin**: render-only (texture wobble of SEAE material 0: V offset sin(phase) * 0.003, phase += 0.0524 / 0.0175 per drawn frame); the node keeps `vOffset`
  for the renderer. The sea plane / seabed / sky (SSEA / SEAB / SSKY, `FUN_00426da4` / `FUN_004266ca` / `FUN_00426915`) are already in src/render/environment.ts.
* **Sound3d** (`FUN_005386d0`): the update returns 2 and does nothing; the constructor only loads the sound (HSE2: 0x8b, LOON: 0x8c). No node plays it.
* **BOTMUSIC** (era 3, `FUN_00536a44`): while `SWITCH_GME_RADIO_ON` (0x22) is set and Pepper is within 24 (or the dance timer runs), the bot dances (clip 0xfa, rate
  1..5 growing every 120 ticks, expression 7, emitter `music01.par` at bone 10) and its var gets bits 1 / 0x4000000 (0x1000000 after the dance). **GETO**
  (`FUN_005366b0`): visible at story nodes 0x38..0x3c, sets var 0x22, pulsing scale 0.8 +- 0.2, drawn at Pepper's bone 16 (`FUN_00536806`); its prerender
  (`FUN_005367b9`) mutes the music unless a bot danced this frame (`IslandCtx.musicMute`).
* **Brikimal** (`FUN_004bcc1b`): the var (0xc3 / 0xe0) is the animal shape 0..7; it counts on every 300 ticks (row field 0) or on Enter within 16 when the morph is
  idle (`FUN_00447e60` == 2), sound 0x364. Movement rows (speed, turn, bob, phase rates, flags 1 tilt / 2 wobble / 4 walk home / 8|0x10 stop on the negative half /
  0x10 waddle) are read from 0x8d9f10 + v*0x1c + kind*0xe0. Box collider `FUN_00442780(1.6, 6.0, 2.666)`, record hidden (`&~2`) and solid when hidden (`|0x20`);
  the brick-morph object (WP9) is asked through `IslandCtx.brickMorph(rec, var, files, matrix)` with the files `animal07/00/06/02` (BML1) or `animal04/01/05/03`
  (BML3) and the matrix the node rewrites each tick (tilted, translation = position + right * -0.45). **Fallback** without it: the record stays visible (plain model).

## Music (music.ts)

Ctor `FUN_004bc773`: keys by story node (< 7 and >= 0x3e the nine town keys incl. the missing `Z02LGIB`; < 0x1f `bbotsM` (played); < 0x38 `bbotsM` + `radio`
(bbotsM played); < 0x3b `radio` (played, mode 1); < 0x3e `bbotsM`), ambience `LGIBirds`, groove 0. Update `FUN_004bc533` (town mode 2): building segment when
ftol(squared XZ distance) <= 1600 (unsigned), first match of INFC `Z02Info`, RADI `Z02Laura`, PIZB `Z02Papa`, HSE3 `Z02Mama`, POLB `Z02Nick`; outside all:
`Z02LGIT` (groove 0) or `Z02LGIM` in the main-theme sub-mode. A DirectMusic notification (edge of `FUN_00443370`, debounced 120 ticks) switches LGIT -> LGIM
(sub 1, the next building/none choice plays LGIM) and the next one LGIM -> LGIT. While LGIM plays the groove follows Pepper: walking 1 (2 while the walk clip is
0x24 / 0x3f / 0x40), vehicles / skateboard / ptera 3 (`FUN_00443310(level - 3)`). Story node 0x38 outside a cutscene: `radio`, mode 1.
New `IslandCtx` members (optional): `music(key)`, `musicGroove(level)`, `musicNotified()`, `musicMute(on)`, `ambience(name)`, `brickMorph(...)`.
The building distances are computed directly (the original reads the records' controller distance of the previous frame, `FUN_0042377a`).

## The director (director.ts)

`FUN_004b7c78` is the update of the LGI_FSM node (ctor `FUN_004b8c73`, table 0x8d9448; the only reference to the function). WP4 also ported it
(src/island/trigger/lgifsm.ts, registered there); this file has the same logic as `directorTick(w, state)` + `DirectorNode` + `registerDirector()` (NOT called),
for the lead to pick. Differences to WP4's port: WP7 drives the particle emitters (`ctx.particles`: `rocket01.par` x6 at bones 5 / 7 of INFO / BBR0 / BBT0 /
BBT1 / BBT5 / BRIK, `zzz.par` at Info's bone 10, `bill01` x2 at Bill's bones 14 / 16, `twinkle03.par` + sound 0x354 at a bot; owners < 0 = the director's global
emitters), reads the cue sound ids from the code instead of a transcribed list, and scales record **370 (WORM)**: the decompile's `+0x96b0` (flags) and `+0x965c`
(matrix) are record 370 (`370 * 0x68 + 0x60 / + 0xc`); WP4 uses 371 (OPL0).
Sections (vars by `ctx.switchVar` name): cue table 0x8d9460 (`SWITCH_GME_CSM_SFX1..30` + `CSM_FX_SWITCH08/09/10`: 1 play at the record and set 2, 4 play every tick,
8 stop and set 2); `PHEL_ROTOR_SPEED` (PHEL part 3, BHEL part 2 yaw += v/10); `CSM_FX_SWITCH00` INFC windows (parts 1 / 2: +-0.1 per tick, bounce at 1.8 with
-0.5, closed below 0.05; sound 0x33e; doubles 1.8 / 0.05 at 0x892570 / 0x892560); `CSM_BRICKESC_02` bit 1 (PIZ3 hidden after the +0x48 count-down);
`CSM_FX_SWITCH02` (rockets, 0x1000 = start, 0x80 = stop, value 1 = sound 0x33d at INFO); `CSM_FX_SWITCH03` (dead: `0 < v < 1`); wormhole (node < 7
`CSM_FX_SWITCH04`, node >= 0x3d var 0xd; 1 start, 2 scale in 1/30 per tick, then 0 (or 5 for var 0xd), 3 hide); `CSM_FX_SWITCH05` (Bill's emitters);
`CSM_FX_SWITCH06` (twinkle); `CSM_FX_SWITCH11` (1/2: PAPA, MAMA, BBT0, BBT1 non-solid / solid); `CSM_FX_SWITCH01` (JAIL part 1 opens at 0.1 per tick to 1.8).
Emitters are created by the era inits (`FUN_004bf65b` region: `bill01` x2 -> DAT_05d58384/88, `rocket01.par` x6 -> DAT_05d585d0..e4, `twinkle03.par` ->
DAT_05d58300; `zzz.par` bound to DAT_05d585e8).
**FUN_004b4907** (the world set-up called by `FUN_004b6475`) is fully covered by the emulated set-up: it is only attaches (Spin on PORA / PORS, Brikimal, seabed /
sea / sky, SeaAmin, sgswim on SPLH with y = sea level, Bunny / Swift / Butterfly with their argument blocks), controller flags, render modes (`FUN_00444550`),
part flags (`FUN_004446c0` on LOON, SBRD, BRID x6), record flags (SEAE |0x10, XXX3 hidden); `FUN_00423716(ctrl, 80.0)` is an empty stub.

## Ptera (not ported)

`FUN_004b93b0` is the ridden vehicle of era 3 (PTER pterodactyl / GLDR glider): states (+0x23) -1 take off (to 18 above ground), 0 flight under the held keys
(Up/Down pitch +-0.0011 to 0.02, Left/Right yaw +-0.0016 to 0.05 with bank = -yaw rate * 8, Space/Alt speed 0.5 .. 2.0 +-0.18 / 0.06, sweeps with radius 2 against
mask 3 and the sea, bounce), 1 land on the nearest of the landing slots `DAT_009daa14 / 18 / 2c / 38 / 50` (waypoint positions, within 80), 2 parked (Ctrl within
12 makes it the interactive record `DAT_009daa80`, var 0xc 0x40 / 2 icons), Pepper rides with clips 0x114 / 0xed / 0x134, vars 0x5e, 0xc5 (5 / 6), 0xa9, the chase
camera (0.35 ease), wing sounds 0x303 / 0x302 by animation frame, ceiling y 184 (0x8d9c6c). It belongs with PepSwitc / the vehicle modes (WP6, PEPP's `Ptera`
node `FUN_004bb582`).

## Tests (m4-wp7-ambient, 64 checks)

Rigs / sound handles / cue table read from the EXE; every node attached; 1800 ticks on the real era-0 world: no NaN, bunny states cycle (0, 1, 2 and burrow trips),
bunnies within 45 of home and on the terrain while hopping, butterflies within range and <= home + 6..9, the swift leader in state 4 and the flock around the spline
point, PORA spins; Shift startles a bunny (sound 0x103), five pokes give the score; a butterfly follows Pepper; BML1's var counts on after 300 ticks (sound 0x364);
Music: LGIBirds + Z02LGIT far away, each building's segment within 40, back to LGIT, notification -> LGIM and back, node 0x38 radio; director: cue values 1 / 4 / 8,
windows 1 -> 2 -> 3 -> 0, wormhole scale-in / hide, jail door, rotor speed, rockets on / off, FX_SWITCH11 collision.

## Differential test (WP-VERIFY): ambient nodes against the original's code

> Status after WP-ISLAND-FIX: every KNOWN DEVIATION named in this section is fixed in the port and the test runs at tolerance 0 without the filters (`docs/re/gaps.md`, "Deviations FIXED by WP-ISLAND-FIX"); the sentences below describe the state when the deviation was found.

Tests `m7-isl-veh-ambient`, `m7-isl-veh-swift`, `m7-isl-veh-brikimal`, `m7-isl-veh-music`, `m7-isl-veh-bots` (`tools/tests/`; helpers `tools/lib/m7-isl-veh-ambient.mjs` + `m7-isl-veh-ambient-sc.mjs`, on top of the island emulation
`tools/lib/m7-isl-veh-emu.mjs`). The ORIGINAL's constructors (run through the original's own attach `FUN_00423532`), the update pass `FUN_0042226e`, the pre-render pass `FUN_004225c5`, the draw pass `FUN_0042271b` and the nodes'
code run natively (x87 at 24 bit, `cpu.cw = 0x7f`) next to the port's nodes with the same scripted Pepper position / buttons, at dt 1 and dt 0.5 (free-running, with the graze guard) and in sync mode (the original's continuous
state is copied into the port before each tick; tolerances 5e-6 relative). Random numbers: `FUN_004388ae` runs natively on a scripted CRT `rand()` (0x85daf0); the port's `rand` gets the same 15-bit integers
(`setAmbientRandom`): the number and order of the draws of every tick are compared. The engine services are hosted and logged (not the subject): game variables, collision / terrain ray, animation instances (the port's `AnimInstance`),
audio (Music: `FUN_00443290 / 004432c0 / 00443310 / 004431e0 / 00873e00 / 00443370`), emitters, expressions. Everything of `src/island/ambient/**` except the bunnies (NPC oracle `m7-isl-npc-emu`) is covered:

| test | node | compared per tick | checks |
|---|---|---|---|
| `m7-isl-veh-ambient` | Butterfly (BFS0-9, BFG0-9) 0x4b2d44: update + pre-render, Shift follow / release, 200 ticks out of view; Spin (PORA / PORS); SeaAmin (SEAE phase / scroll); Sound3d (HSE2) | records (matrix, Euler, flags), node block (flap, flapState, cnt, cnt2, vy, off, follow, speed, shiftT; axis, rate; phase), all vars, sounds, rand draws | 8.3 M |
| `m7-isl-veh-swift` | SwiftLeader 0x4b31db + Swift 0x4b3a92 (SFT0-9): **the original's spline engine (SplineBase.cpp 0x445000.., `FUN_0043ecd0` on the archive's swift.man) runs natively** | records, leader t / state / target, follower cnt / dyaw / dpitch / timer, clip / frame (rig SWFT), sound 0xfd at SFT9, rand draws; `spline(t)` = the port's `BSpline` at the original's t against the native evaluation | 4.8 M |
| `m7-isl-veh-brikimal` | Brikimal (BML1 / BML3) 0x4bd4a8: the 8 shapes of both animals, 300 tick counter, Enter within 16, waiting within 4.8 | record pose, node block (timers, phase, toggles, morph matrix 16 floats), var (shape), morph sound, rand draws | 3.6 M |
| `m7-isl-veh-music` | Music 0x4bc773 on PEPP for the story nodes 2 / 10 / 30 / 52 / 61 (dt 1, and 2 at dt 0.5) | every audio call (key, groove, ambience, mute) incl. the constructor's, node block (mode, building, main, groove, last, sub, flag, timer), vars | 3.3 M |
| `m7-isl-veh-bots` | BOTMUSIC (10 bots) 0x536e16 + GETO 0x536961, story node 52 (+ var 0x58 = 0x37 .. 0x3d) | bot records, clip / frame (clip 0xfa, rate), node timer, emitter matrix, music01 emitter calls (gate / matrix / parameters), expression calls, mute calls, vars | 12.3 M |

Coverage printed in the notes: butterflies follow Pepper (15 k ticks), reset after 200 ticks out of view (4.4 k), 162 Shift presses; all 8 Brikimal shapes; 111 music calls over the town / bot / radio modes (every building segment, LGIM <->
LGIT on notifications, grooves -2 / -1 / 0); bots dancing (170 k bot-ticks), blaster shown / hidden. **Result: the port is exact (float32 noise only: worst 1.8e-4 on butterfly matrices at |coordinate| ~ 500, 6e-5 spline
evaluation on |p| ~ 300) except the KNOWN DEVIATIONS below.**

* **GETO (the ghetto blaster, `FUN_005366b0`) returns 0 when it is hidden** (`xor eax, eax` at 0x5366f7: story node < 0x38 or >= 0x3d) and 1 (0x5367a6) when it shows. The pre-render pass runs a node's hooks only if its update returned 1 / 2
  (`FUN_004225c5`, `ctrl[2]` ran bits), so while the blaster is hidden the original runs neither its pre-render `FUN_005367b9` (the music mute) nor the draw hook `FUN_00536806` (matrix at Pepper's bone 16, `flags | 3`). The port's `GhettoNode.update`
  returns 1 on both paths: **in the whole of era 3 before story node 0x38 (nodes 52 .. 55) the blaster record is visible at Pepper's hand (flags 0x13 instead of 0x10, matrix = scaled pose) and the music is muted every tick unless a bot dances**
  (`ctx.musicMute(true)`); one tick after it shows, the original still sees the stale dance flag DAT_05d586d4 (`mute 0`), the port `mute 1`. Fix: `return 0` in the hide path of `GhettoNode.update` (misc.ts); counted by the test as
  `geto-hidden-prerender` (16 k ticks) / `geto-stale-dance-flag`.
* Documentation: "Music ... `FUN_004432c0(0)`: nothing" is right (`if (param_1 != 0)` in the decompile of 0x4432c0); the SOUND players differ: `FUN_004435a0(0)` plays slot 0 (see the skateboard section of wp6-vehicles.md).
* Not reachable on the island and so not run: the bats' mode 1 of the swift leader (perch, `FUN_0043b874` end-of-clip), `Spin` field +0x16 (never set), Brikimal kind 2 (the swimmer, not attached).
