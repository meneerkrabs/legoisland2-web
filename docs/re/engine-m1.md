# Engine core, milestone M1 (`src/game/`)

Status of the first playable slice: Pepper walks (and swims) around the island `z02LGI` and Pepper's house `z03PPH` with the original's
controls, animation selection, collision, ground following, camera, footsteps and a blob shadow. This document says which code was ported from
which function of the executable, where the constants come from, which behaviours of the original turned out to be surprising, what is
approximated or missing and what M2 should do next. The structure of the original is in [architecture.md](architecture.md) (sections 4 and 8),
the data formats in [formats.md](formats.md), the browser-side glue in [../engine-api.md](../engine-api.md).

Run it: `?play=1&zone=z02LGI` or `zone=z03PPH` (dev server or the start page after the intro), options `&pos=x,y,z`, `&from=z03PPH` (arrive at the
house door instead of the skate park), `&era=N` (stored, unused), `&mute=1`. Debug handle in the page: `window.__game` (`state()`, `setPepper()`,
`world`, `loaded`). Tests: `node tools/test-formats.mjs --only engine-collision,engine-anim,engine-input,engine-framework,engine-walk,engine-soak,engine-walker`.

## 1. Modules

| module | what | ported from (VA) |
|---|---|---|
| `world.ts` | `World` (records, vars, collision, input, camera, frame counter, `tick()`), `GameLoop` (fixed 60 Hz, one step per drawn frame, `dt` = 1.0 for the first five frames then 0.5 by `nextDt` = FUN_00443e40, no render interpolation) | 1.3 / 1.4 frame skeleton; 8.5 |
| `vars.ts` | game variable array, names read from the EXE (table 0x8a3228, 319 entries), gate | `FUN_00417575/97/5ca/61b/66c` |
| `record.ts` | object record (0x68 bytes in the original): name, model, collision object, controller, animation instance, flags, matrix, Euler | 4.1 |
| `controller.ts` | controllers, behaviour nodes with `(var & mask) == value` gating, return codes 0/1/2/3, the three passes, registry (`registerNode` / `createNode` / `attachNode`) | `FUN_0042226e`, `FUN_004225c5`, `FUN_0042271b`, `FUN_00423532`, `FUN_00423ad4` |
| `collision.ts` | sweep, terrain ray, probe, polygon test, grid walk, box shape | `FUN_00441270`, `FUN_00441b10`, `FUN_004425f0`, `FUN_0043cd62`, `FUN_00441ac0`, `FUN_00440810`, `FUN_0043f810`, `FUN_0043f9b0`, `FUN_004405f0`, `FUN_00440f30`, `FUN_0043d5ec`, `FUN_004427e0/00442780/004428b0` |
| `anim.ts` | animation instance: start / advance / seek / pose (advance and pose bit-exact against the emulated original at dt 1 and 0.5: `m7-pose-emu`) | `FUN_0043b4e2`, `FUN_0043b6a3`, `FUN_0043b76a`, `FUN_0043b874`, `FUN_0043b64d`, `FUN_0043ba7a` |
| `input.ts` | key table of the EXE -> logical bits, edge detection, optional gamepad | `FUN_004376f9`, `FUN_00423170`, table 0x8aeb20 |
| `walk.ts` | Pepper's walk (`SGwalk`): states, input -> velocity, ground following, ledges, walls, slopes, jump arc, footsteps, tilt | `FUN_0042d514`, `FUN_0042a88f`, `FUN_0042a654`, `FUN_0042a487`, `FUN_0042baf6`, `FUN_00429e00` |
| `camera.ts` | chase camera, camera key ramps, view basis | `FUN_0042c227`, `FUN_0042b8e8`, `FUN_00422b50`, `FUN_0043cc5c` |
| `swim.ts` | swimming (`sgswim`), the sea loop and the mode switch (`PepSwitc`, with a rule list later modes extend) walk <-> swim | `FUN_0088c740`, `FUN_00422c7e/00422ddc` (camera), `FUN_0043363c`, `FUN_004bb67d` |
| `nodes.ts` | registers the built-in node names | |
| `zone.ts`, `setup.ts` | records from `extractZone` + archive, collision objects shared per `.col` slot, zone profiles (sea level, gravity, ground record, hidden records, box colliders, start place, player node chain) | `FUN_004b6475`, `FUN_004b4220`, `FUN_0053ea4d`, `FUN_004c2d22` |
| `render.ts`, `play.ts` | WebGL drawing of a frame, dev entry, HUD, sound sink | (browser side) |
| `walker.ts` | waypoint walker (see its header; written separately) | Common\WayPt |

Everything simulates at a fixed 60 Hz, one step per drawn frame, `world.dt` = 1.0 for the first five frames and then 0.5 in the game's unit of 1/30 s (WP-TIME, architecture.md 8.5); the draw always shows the last step (the
original does not interpolate).

## 2. What was ported, in detail

### 2.1 The walk node (`FUN_0042d514` and friends)

The node's state byte *is* the clip number of the player's rig (`MFIG.blk`): 0x01 jump, 0x02 jump start, 0x03 idle gag, 0x08 sneak, 0x0d walk,
0x1b idle (plays clip 0x3a), 0x1f double jump, 0x24 run, 0x30 skid, 0x37 slide, 0x38 teeter, 0x3f / 0x40 run left / right, 0x57 hard landing, 0x25 out of the
water. Per tick (`WalkNode.update`):

1. mailbox (`DAT_008ae088`) / stamp handling (see 3.2), clip restart when the clip differs from the state;
2. input (`FUN_0042a654`): the keys are a ramp, not a switch. Index 0..32 (16 = centre) moves 3 per tick towards the pressed side and returns 4 per tick;
   stick = `table[index] - 128` (table 0x8ae098: 0, 8 ... 248, 255); inside +-32 nothing happens. The velocity direction is the stick rotated by the *camera's*
   view axes (right x/z and forward x/z), the speed factor is `|stick| / 128 * hypot(forward.x, forward.z)` capped at 1 (so it depends on the camera pitch);
3. state machine (`FUN_0042a88f`): idle -> sneak (speed >= 0.01) -> walk (> 0.05) -> run (>= 0.4) and back; Alt = jump; idle for 1000 ticks -> turn to the
   camera + clip 3; run for 200 ticks below 0.4 -> skid; the animation advances by 1 (walk, sneak), 1.25 (run), 0.666 (idle) per tick;
4. one-shot clips ended (`animResult == 2`): jump start -> jump, landing -> idle, ... (switch in `FUN_0042d514`). **No MFIG clip has the loop flag 0x10**, every
   clip is a "one-shot" that wraps and reports 2 each cycle; the footstep code uses that wrap;
5. heading: turns towards the velocity by at most 0.349 rad per tick (the original compares the unwrapped difference, so left turns are instant, see 3.5);
6. ground following: sweep 8 down from 4 above (mask 3, radius 0.6, skin 0.2); in the air only along the arc. No hit -> the terrain ray (or the sea level);
7. tilt to the slope (`FUN_00429e00`): four probes 0.12 around the feet, the matrix is rebuilt from the normal and the heading;
8. slopes: standing on up.y < 0.85 -> slide state 0x37 (facing downhill); moving uphill on such a slope: speed -= 1 / (up.y + 1.1), floor -0.25;
9. ledge: ground more than 2 below the *next* position (terrain ray and a mask-1 probe from 80 above): running (speed > 0.4) -> jump / fall, slower -> teeter on
   the edge (state 0x38) and stop; not while jumping / landing / sliding, and **not in sub-game 3 (the house)**;
10. walls: mask-1 sphere sweep at chest height (+1.48), slide along the plane (remove the normal component), a second sweep with mask 3 zeroes the velocity if
    still blocked, a third sweep above the head (+4, up 1.2); records named `PAG*` do not block;
11. jump arc: `y = y0 + (v0 + g t) t + g t^2 / 2` with `t += 0.1` per tick, v0 15 (standing) / 17.5 (double jump), g = -10: **a jump lasts 10 ticks (1/3 s) and
    is 3.75 high**, falls are limited to 4 per tick; landing -> state 0x57;
12. camera (`FUN_0042c227`, called at the end of the walk update).

### 2.2 Camera

Orbit keys: `<>` / Z orbit left / right, X / C raise / lower, X+C zoom in, `<>`+Z zoom out (same ramp as the walk keys). Radius 12..28, height above
the target 5.6 (+ terrain rise at the eye) .. 28, target = Pepper + (0, 4, 0) (eased upwards only). The eye is re-projected on a circle of the old radius around
the new target every tick, so **the camera does not swing behind Pepper**: it only follows at the current distance, pulls closer when more than 28 away
(mode 1) and backs off when Pepper walks towards it closer than 12 (mode 2); sideways movement makes him circle around the camera until the player orbits it.
Height logic uses sweeps from the target towards the eye (mask 0xc3, radius 1, skin 1) and a vertical velocity accumulator (+-0.025 / 0.05 per tick, clamped
+-1, applied x 0.8). There is no horizontal pull-in at walls: the camera can sit inside a hill behind a wall (its "wall push" `FUN_004229a0` is compiled out, 3.1).

### 2.3 Collision

`FUN_00441270` sweeps a segment against every record with `((f & 0x20) && !(mask & 0x80)) || (f & 2)`, not `f & 0x10`, not the ignored record, collision radius > 0:
bounding sphere against the segment mid point, then the record's box (`FUN_0043f9b0`, so polygons outside the stored box are never hit), then either all
polygons (1x1x1 grid) or the grid cells from `centre - half - 1.0` (cell range `ftol((min - O) / cs - 0.1)` .. `ftol((max - O) / cs + 0.5)`, each cell box-tested with
half size `cs / 2 + radius`). The polygon test is plane based: two-sided; start within `2 * skin` of the plane = hit at t = 0 with the point projected on the skin
plane; otherwise `t = (d0 - skin) / (d0 - d1)`; the point must lie inside the three edge planes widened by the **edge radius** (mitred corners). Nearest `t` wins
across records. Hit point and normal are transformed to world space. Box shapes (trees, boats, props; `FUN_004427e0/00442780/004428b0` called by the zone set-up by
record name) use `FUN_0043d5ec`. The terrain ray (`FUN_004425f0`) is the same polygon test against the ground record only, 500 down, radius 1.0, skin 0.1, mask 3,
result = hit height - 0.1 (= the surface). Footstep surfaces come from "the polygon hit last by any query" (`DAT_009deb78`).

### 2.4 Swimming and the mode switch

Walking with `y < sea level` (2.4 on the island, a global the zone code sets) -> `PEPPER_CONTROL = 2`, state 0x62 (dive clip, then tread water 0x41, swim clip 9);
Left / Right turn 0.0872660 rad (`0x8926a4`, 5 degrees) per tick, Up accelerates to 0.8 (+0.08 / tick, -0.04 when released; every constant is a float32 of the executable: the first version used the double 0.8, which the speed test `0.8f <= speed` misses); a mask-3 sphere sweep at +3.6; y = sea level. Swimming and the terrain ray one unit ahead reaches the sea
level -> mode 1, state 0x25 (out of the water), the position moves one unit ahead. The sea is a loop (`FUN_0043363c`, called at the end of the swim update): past
+-1056 (880 in sub-game 6, 1840 in 10 / 0x16) Pepper and the camera move to the opposite edge (x or z = +-1040, the other coordinate becomes its fraction). The skateboard (Ctrl), the vehicles and the Ptera are the island's `PepSwitc` nodes (`src/island/vehicles`, behind the `PEPPER_CONTROL` mode word).

## 3. Findings about the original

1. **The island's camera "wall push" is dead code.** `FUN_0042271b` (draw pass) starts with `xor eax,eax; test eax,eax; je` around the call of `FUN_004229a0`
   (at 0x42272f), so it never runs. The viewer's camera is the plain eye.
2. **State mailbox quirk.** The walk node compares its state with `DAT_008ae088` every tick and re-runs the "entering a state" block (zeroing the idle timer)
   whenever they differ. After the first tick the mailbox is 0 while the state is 0x1b, so until the first state change the idle timer cannot reach 1000 (the idle gag
   starts only after the first movement). Ported as is.
3. **Jumping is disabled in sub-game 3 (the house) and 0x11 (WAS)**; falling off ledges too in the house.
4. The 340 polygons with NaN planes in the shipped data are misses (x87 compares), not hits.
5. Turning: `step = (maxTurn <= diff) ? maxTurn : fabs(diff)`, diff = `atan2(vx, vz) - yaw` is not wrapped, so negative differences turn instantly and positive ones
   are limited to 20 degrees per tick; when forward . velocity > 0.9 the heading snaps. A debug-heap artefact: in states where the input reader is not called its
   result variable holds the fill pattern (non-zero), so Pepper turns towards the velocity in the slide state.
6. The "run left / run right" states 0x3f / 0x40 are selected by the *camera* orbit stick (node +0x34), which the camera scales to +-3.2 each tick: unreachable in practice.
7. The grid: the engine walks cells from `centre - half - 1.0` (one unit off the origin the files' lists were built with, immaterial next to 70+ unit cells) and the files list a
   polygon only in the cells that contain one of its corners / edges, so large triangles are missing from cells their interior crosses: about 2% of the polygon hits that a full scan
   finds (random segments over the island) are not found by the grid walk. That is the original's behaviour; `engine-collision` measures it (and checks that the grid walk never
   finds something a full scan does not).
8. Ground ray radius 1.0 lets neighbouring polygons within the mitred widening win (up to 4 units away at sharp triangles), so the terrain height is sometimes higher than
   the real surface under the feet; the walk sweeps (radius 0.6) decide where Pepper stands.

## 4. Constants (source: `.rdata` / `.data` of the NL EXE, 6,459,444 bytes)

Single numbers are written into the code with the address in a comment where they matter; tables are read from the EXE at run time (game-variable names 0x8a3228, key table
0x8aeb20, sound / speech / music tables by `src/audio`, zone placement by `extractZone`, waypoint maps from the archives).

| constant | value | where |
|---|---|---|
| stick ramp table | 0, 8 ... 248, 255 | 0x8ae098 (checked against the EXE in `engine-input`) |
| step sound patterns (16 steps, variants 1..4) | tables | 0x8ae11c .. 0x8ae17c (per surface; copied as 3 small arrays in `walk.ts`) |
| sweep radius / skin of the walker | 0.6 / 0.2 | 0x8ae068 / 0x8ae06c |
| jump v0 standing / double | 15 / 17.5 | 0x8ae070 / 0x8ae074 |
| gravity | -10 | set by `FUN_004b4220` (0xc1200000); -7 in one other zone |
| sea level island / elsewhere | 2.4 / 0 | `FUN_004b6475` (0x4019999a) / reset to 0 by `FUN_00426759` |
| ledge probe from +80 down 160; drop > 2 | | 0x8ae07c, 0x8ae078, 0x8ae080 |
| camera radius 12 .. 28; target offset (0, 4, 0); preset eye (0, 6.4, -16) | | 0x8ae060 / 0x8ae064; 0x8ae1a0; 0x8adbf8 |
| speed thresholds sneak / walk / run | 0.01 / 0.05 / 0.4 | 0x892030 / 0x892034 / 0x892118 |
| idle gag after 1000 ticks; run timer 200; idle turn 0.1745 per tick | | 0x892120, 0x892114, 0x89211c |
| walk heading limit | 0.349 rad per tick | 0x892150 |
| slope slide threshold up.y / ledge fall step | 0.85 / 4 per tick | literal in `FUN_0042d514` / 0x892080 |
| jump arc time step; pose snap | 0.1; 0.1 | 0x8920cc |
| swim: turn / acceleration / max / deceleration | 0.0873 / 0.08 / 0.8 / 0.04 | 0x8926a4 / 0x89212c / 0x892084 / 0x8925ec |

## 5. State of the M1 modules (rewritten 2026-10-31: nothing of this chapter is approximated any more)

This chapter listed what the first version left out. Everything on that list has since been ported or settled; where each piece lives and how it was verified:

* **Pizza throwing, talking (Space / Shift, `FUN_00427c15`)**: `src/island/pizza` (the walk node's hook `walkHooks.space`), the NPC families in `src/island/npc`; compared with the original's constructors / updates in the x86 emulator (`m7-isl-*`, `m5-*`).
* **Skateboard, vehicle modes, Ptera**: `src/island/vehicles` (`PepSwitc`, SGBoat / SGHeli / SGCar / Ptera ...), oracle tests `m7-isl-veh-*`, `m4-wp6-looks`, `m4-wp13-ptera`.
* **Sub-game 9 camera (`FUN_0042d4b1`)**: the zone's own node (z09JST), not the walk node.
* **Mouse look of the camera**: ported (`camera.ts chase`, `FUN_00437ca5`, docs/re/input.md section 3, `m7-walk-cam` mouse scenarios at tolerance 0).
* **Analytic sphere / cylinder shapes**: never created by any zone's set-up (checked by `tools/tests/m4-s5-colshapes` for the loader slots; `FUN_004410e0` box shapes are in).
* **Island story handler `FUN_004b7040`, era visibility, NPC placement, `BRCC` cubes**: `src/island/story*`, `src/zones/z02LGI` (WP-ISLAND; the set-up runs in the x86 emulation `m4-s-island`).
* **Sound**: 3D positioning, ambience and music: `src/audio` / `src/shell/audiohost.ts`, docs/re/audio.md.
* **Blob shadow**: `FUN_00444940` / `FUN_00444ef0` ported function by function and verified on the emulator (rendering.md 9, gaps.md R5).
* **Simulation step**: one step per drawn frame at a fixed 60 Hz with the original's `DAT_008b1718` rules (1.0 for the first five frames, then 0.5; WP-TIME, gaps.md T1); the original ran with the measured frame time, so a machine that misses 60 Hz behaved differently there. This is the one inherent difference.
* **Still true and exact**: the hit cache of `FUN_00441b10` (`CollisionWorld.hitCache`: the cache returns stale polygons exactly like the original), the NPC bound (flag 0x40 uses the box shape `FUN_004410e0`), the swim stroke sound, the skateboard dismount state 0x1c, the explicit +-1840 wrap.

## 6. Tests

`tools/tests/engine-*.mjs` (run with `node tools/test-formats.mjs --only <name>`; they use the dev copy of the game data and the EXE):

* `engine-collision`: ground ray vs a brute-force triangle raycast of the land mesh (never below it, equal at ~79% of random points, the rest are higher through the edge
  radius), 600 random segments: every segment that crosses a land triangle is reported, never later than the geometric crossing; free air never hits; grid walk equals the full polygon
  scan wherever it hits (about 2% of the scan's hits are not in the file's cell lists); skin semantics; surface ids; box shapes of the trees (24 of 28 hit from the side); probe skips the ground.
* `engine-anim`: start / advance / wrap / one-shot end, rates, seek, pose = `sampleBlk` with the 0.1 snap, render interpolation, bone counts (both zones' `MFIG.blk`).
* `engine-input`: key table of the EXE and the ramp table, mapper edge detection, the input -> velocity model (ramp values, stick, speed factor, state sequence
  idle -> sneak -> walk -> run in four ticks, direction along the camera axes, never more than one unit per tick).
* `engine-framework`: game-variable names and semantics, gating, return codes, pass order, stamps, attach positions, registry.
* `engine-walk`: jump arc (apex 3.75, 10-11 ticks), double jump, footstep sounds, ground following over 68 runs from waypoint nodes (never under the ground, never faster than one
  unit per tick, camera distance), a cliff, walking into the sea / swimming / back out, and in the house: walls in 8 directions, jumping disabled, wall sliding.

* `engine-soak`: 6000 ticks of random key mashing in each of four set-ups (island from the skate park / the house door / the beach, the house): no exception, no NaN, Pepper stays on the map, the camera stays near.
* `engine-walker`: the waypoint walker (four island maps, 1190 random routes, a 28-node walk from the house door to the skate park, traffic, the node inside a real `World`); written separately, see the header of `src/game/walker.ts`.

Headless browser runs (`tools/steps/game-*.mjs`, `node tools/browse.mjs "http://localhost:5499/?play=1&zone=z02LGI&mute=1" tools/steps/game-island.mjs --size 1280x800`)
cover the same scenarios with screenshots.

## 7. Next steps (historical)

The plan of M1 (zone loop / shell, set-up extraction, story handler and NPCs, HUD / 2D layer, particles and brick effects, audio) has been carried out; see engine-m2.md (shell), engine-m4.md (island), docs/re/m5 (hubs), docs/re/m6 (mini-games), particles.md, audio.md and gaps.md (the inventory).

## 8. Differential test (WP-VERIFY)

The walking engine is verified against the ORIGINAL code, run from the user's own executable in the x86 emulation (`src/formats/x86emu.ts`; addresses only, nothing is stored in the repository). The port's
`WalkNode` / `CollisionWorld` / `SwimNode` / `WaypointSystem` run next to the original functions with the same input, tick by tick, and every compared value must be IDENTICAL (tolerance 0, bit for bit).

Run: `node tools/test-formats.mjs --only m7-walk-col,m7-walk-emu,m7-walk-island,m7-walk-dt,m7-walk-states,m7-walk-free,m7-walk-ledge,m7-walk-swim,m7-walker-emu,m7-walk-cam`.

### 8.1 The finding that matters most: the x87 runs in 24-bit precision

Direct3D 7 leaves the FPU in single precision (no `DDSCL_FPUPRESERVE` in any `SetCooperativeLevel` call of the executable; the CRT's sin / cos / sqrt wrappers compare the control word with 0x27f and switch for
their own call). So **every arithmetic result of the original's code (fadd, fsub, fmul, fdiv, fsqrt) is rounded to a float32 mantissa**, no matter whether the compiler stored it in a local or kept it on the FPU
stack. A bit-exact port therefore writes `Math.fround` around every single `+ - * /` and `sqrt` (`k = fr(1 / fr(sqrt(s)))`); only the results of `sin` / `cos` / `atan2` (CRT calls, computed at 53 bits) stay doubles until the next
operation. The emulator's bare `Cpu` still starts with the CRT's control word 0x27f (53 bit, what the C runtime sets before Direct3D exists); everything the game runs after the device exists is `createGameCpu` (`GAME_CW` = 0x7f, `src/formats/emusetup.ts` included) and the oracles of this WP set `cpu.cw = 0x7f` (`M7_CW=0x27f` runs the 53-bit mode for comparison; the first version of the port was exact in
that mode and differed by one ulp in about 1 in 10 multi-operation statements in the real one). Three more rules learned on the way:

* the decompile lists the terms of a sum in a different order than the code adds them (`z*m10 + y*m6 + x*m2` in the listing, `x, y, z` in the machine code; also `l84 + y0 + la0` is as listed): every
  multi-term sum was checked in the assembly (`tools/tests/*` fail on a wrong order within a few hundred ticks, the order is not guessed);
* `fcomp; fnstsw; test ah,0x41; jne` treats an unordered compare (NaN) as `<=` (C0 and C3 are both set): the walker's `0 / 0` turn rate after `FUN_00462206` makes the original turn instantly, the port
  writes the compare as `!(a > b)` to do the same;
* `fsqrt` rounds to a float32 too (the CRT's sqrt wrapper does not widen the precision): `1 / sqrt(s)` is `fr(1 / fr(sqrt(s)))`.

### 8.2 Tests

All use the harness `tools/lib/m7-walk-emu.mjs` (the original's collision loader `FUN_0043f370` reads the zone's own `.col` files; hosted engine services: game variables, sound log, allocator / files,
keyboard / pad readers, the animation instance of the player (the port's `AnimInstance` of the oracle's world, as in the other oracles)). "Sync" = the original starts every tick from exactly the port's state
(record, node, camera, the hit-cache globals), so a difference is attributable to its tick; "free" = both run alone for the whole scenario. Records far from the player are switched off in the emulated memory
(`cull`) to keep the runs short (no query of a tick can reach them).

| test | what it compares | checks |
|---|---|---|
| `m7-walk-col` | sweep `FUN_00441270`, probe `FUN_00441ac0`, ball ray `FUN_00441b10` with its hit cache, terrain `FUN_0043cd62` / `004425f0`, box / sphere helpers `FUN_0043f810` / `0043f9b0` / `0043d5ec` / `0043d159`, in 6 zones (island with 31 box shapes, house, cave, z10, pyramid, z28): record, polygon (object, index), point, normal, surface id, and the hit-cache globals after every query; 9585 sweeps, 915 probes, 2073 ball rays, 4219 near sweeps, 2096 terrain, 2112 down rays, 27000 helper calls | 151,520 |
| `m7-walk-emu` | the walk node `FUN_0042d514` with `FUN_0042a654` / `0042a487` / `0042a88f` / `00429e00` / `0042baf6`, the collision it makes, the chase camera `FUN_0042c227` + view basis `FUN_0043cc5c`: node fields (22), record matrix / angles / flags, camera (18 floats + vertical velocity), all globals, animation clip / frame, sounds, accessory flags, hit cache. House at dt 1 and 0.5, sub-game 0 variants, idle gag (1060 ticks), skid, taps, cave, pyramid, whack-a-snake | 448,608 (5442 ticks, 11 states) |
| `m7-walk-island` / `m7-walk-dt` | the island from 5 waypoint starts, random walks incl. pad-stick and ledges, dt 1 / dt 0.5 | 141,690 / 142,044 |
| `m7-walk-states` | the states other nodes request through the mailbox (knock-back with / without arc, off the board 0x1c, crash, out of water, throws, run variants, idle, jump with a handed-over velocity, turn gags), Alt in sub-games 3 / 0x11 / 0, pad-stick sweep, sub-game 9 (camera excluded), beach | 211,724 |
| `m7-walk-free` | free runs (no resync) on the house, island and sub-game variants, dt 1 / 0.5 | 257,848 |
| `m7-walk-ledge` | slow ledge approaches (teeter, forced jump), every requestable state at the edge, Alt at the edge, props `PAG*` | 129,320 |
| `m7-walk-swim` | `sgswim` `FUN_0088c740` with `FUN_00422c7e` / `00422ddc` / `0043363c`: dive, strokes, turning, pad stick, both coast sweeps (16 coasts), the sea loop in sub-games 0 / 6 / 10 / 0x16, camera presets 0..5, vehicle flag, stale stamp: 34 wraps, 1128 blocked and 38 sliding ticks, 492 stroke sounds | 293,400 |
| `m7-walker-emu` | the waypoint walker (`tools/lib/m7-walker-emu.mjs`): the loader `FUN_004630c0` runs natively on the real island maps (ROAD, PATH, OTH; CSM has no route matrices and the original cannot route on it), create, go to, `FUN_004626d0` step with route lookup, curve planning, steering and all traffic rules, at dt 1 / 0.5: route walkers, 14-walker clusters, random orders (go to with / without the continue flag, follow, heading, node / point, move to point, speed / lane / ignore changes, pause / resume, teleport + apply), road + path walkers around the crossings. All 26 walker fields, the record, the step results and the node lists (3.0 M list checks) | 17,115,088 |
| `m7-walk-cam` | the camera (`src/game/camera.ts`) against the original, bit for bit (tolerance 0), with the mouse path (CAM-1..3 fixed, below) | 171,590 |

Coverage is measured on the original's code at run time (both outcomes of each conditional jump, decoded from the executable): the walk tests together cover most of `FUN_0042d514` (168 / 236 outcomes in
`m7-walk-emu`), `FUN_0042a88f` (130 / 182), the camera (109 / 140 on the island) and the collision core; what no scenario reaches is listed in the test notes (`M7_COV_OUT=file` dumps it): the Space (pizza) branch,
the sub-game 9 camera, the debug-line draws, analytic sphere shapes, `FUN_0042baf6` surfaces the zones never produce. The walker tests cover 357 / 572 outcomes (the rest are the save-game code, the debug overlay,
`free`, the CSM map and accessors).

### 8.3 Deviations found and fixed (all in modules of this WP)

* `collision.ts` (rewritten): float32 stores and per-operation rounding in the polygon test, the grid cell range, the box / sphere helpers, the bounding sphere, `toWorld` / `toLocal`; the HIT CACHE of
  `FUN_00441b10` (see section 5); the ray has no box test of the object; failed box-face candidates leave their coordinates in the out point (`FUN_0043f9b0` uses it as the new segment start); the
  NPC bound uses the box shape.
* `walk.ts` (rewritten body): per-operation float32; the up vector is normalised after the cross product (`FUN_0043cec0` at `0x42a3a5`); double jump plays sound 751; the slide speed is 0.5 (the word
  `0x3f000000`, not the walk speed); knock-back writes `yJump` (node +0x58); state 0x1c is ported; an extra terrain call refreshes the hit cache (`0x42dd..`); the camera mode distance is the 3-D distance
  with y = 0 in the machine order; the sub-game 9 camera stays out of the walk node (zone node). `anim.ts`: float32 advance.
* `swim.ts` (`SwimNode`): float32 constants (turn 0.0872659981, speed steps 0.08 / 0.04 / 0.8: with the double 0.8 the test `0.8f <= speed` missed and the speed ran on), the two sweeps
  (the second one is NOT scaled by dt: `local_1c - n * dot`, with `dot` from the scaled step), sweep start `y + 3.6f`, the accessory sinks 0.8 per dive tick, the pad stick, the inline +-1840 wrap
  of position and camera, the camera of `FUN_00422c7e` / `FUN_00422ddc` (target `(0, 3, 0)`, eye = blend 0.5 to `(0, 6.4f, -16)` in the record's frame, minimum height per camera preset
  `{6.4, 1, 1, 1, 10.4, 8}`, +3 on the eye height in a vehicle), `wrapWorld` after the camera, the terrain query of the "leave the water" rule with float32 arguments.
* `walker.ts`: every field is a float32 and every operation rounds (`len2` = `FUN_00465bf6`: two stored squares and their sum); constants from the executable (`NPC_TURN_RATE` is `0x3f060a63` = 0.5235988, the
  first version had 0.523596; `BEND_MAX` is 2.9670439); setters round their argument; `setSpeed` divides unguarded like the original (`0 / 0` = NaN turn rate, see 8.1); nearest-node search and
  the traffic distance in float32. `engine-walker` compares float32 values since.

### 8.4 Recorded, not in this WP's modules (KNOWN DEVIATION)

* **CAM-1 / CAM-2 / CAM-3 (`src/game/camera.ts`): FIXED by WP-ISLAND-FIX.** The shipped camera used `ground ?? true` (the original's "no ground record" is "no hit": `ground ? true : null`), a Float64Array with double constants, and a double view basis. Now `c` is a `Float32Array(18)`, every operation is rounded like the 24-bit x87 (`zones/common/f32.ts`), the constants are the exe's floats, `updateView` is the exact LookAtLH (the basis is left alone when the length is below 1e-6) and `init` / `chase` follow `FUN_0043cc5c` / `FUN_0042c227` (the mouse path `FUN_00437ca5`: buttons 0x10 / 0x20 zoom, dx / dy replace the sticks before the 0.1 factor). `tools/lib/m7-camera-exact.ts` only re-exports `ChaseCamera`; `m7-walk-cam` runs the shipped camera at tolerance 0 (z03PPH, z50LTC, the island nodes, 5 mouse scenarios).
* `src/island/vehicles/pepswitch.ts` (`IslandPepSwitch.prerender`, `FUN_004bb67d`): FIXED (the terrain ray gets float32 values like the original's locals); the mode switch runs inside the island duels (`m7-isl-veh-*`) at tolerance 0.
* `m6-z10RGB` (scripted win of the cannon duel) used to pass only with `col.hitCache = false`: the cannon-ball queries see the original's hit cache, whose result depends on the order of
  all earlier queries (`rayRecord(land)` / `rayRecord(buns)` / `sweep`), so the zone's query order has to be the original's (`tools/tests/m7-walk-col` proves the cache itself is exact on the z10 collision data); `m6-z10RGB-emu` compares the zone with the original.
* Every other oracle that runs the original natively at the default control word 0x27f (z21FSH, z13CAI (Ptera), ...) now shows one-ulp differences in Pepper's position against these modules: their harnesses
  must set `cpu.cw = 0x7f` and their own ports must round per operation (8.1).

### 8.5 UNCERTAIN items closed / left

* Closed: the hit cache semantics (above); the sub-game 9 camera is the zone's (the walk node excludes it, `m7-walk-states` checks the walk with the camera fields excluded); state 0x1c; the velocity word of the
  slide (0.5); the order of the sweep slide dot products (x, y, z).
* Left: `local_5c` of `FUN_0042d514` (the input reader's "moving" result) is uninitialised stack in the states that skip the reader (slide flag set, state 2 / 0x1c): its value is the stack garbage of the
  real game's call history and cannot be derived; the port assumes the debug fill (non-zero = moving) and the oracle fills the stack below the call with 0xCC to run the same path.
* `FUN_00462206` / `FUN_0046248a` (clone): `FUN_004388e7` is the CRT `sqrt` behind a debug trap for a negative argument (asm 0x4388e7: `fcomp`, `int3`, `call 0x85d104`); the API battery of the walker oracle (`m7-walker-emu`, tools/lib/m7-walker-api.mjs) runs `clone` with and without the distance delta natively and compares every walker field at tolerance 0. Closed.
