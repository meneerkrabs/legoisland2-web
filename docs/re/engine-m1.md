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
| `world.ts` | `World` (records, vars, collision, input, camera, frame counter, `tick()`), `GameLoop` (fixed 30 Hz, dt = 1.0 per tick, render interpolation) | 1.3 / 1.4 frame skeleton; 8.5 |
| `vars.ts` | game variable array, names read from the EXE (table 0x8a3228, 319 entries), gate | `FUN_00417575/97/5ca/61b/66c` |
| `record.ts` | object record (0x68 bytes in the original): name, model, collision object, controller, animation instance, flags, matrix, Euler | 4.1 |
| `controller.ts` | controllers, behaviour nodes with `(var & mask) == value` gating, return codes 0/1/2/3, the three passes, registry (`registerNode` / `createNode` / `attachNode`) | `FUN_0042226e`, `FUN_004225c5`, `FUN_0042271b`, `FUN_00423532`, `FUN_00423ad4` |
| `collision.ts` | sweep, terrain ray, probe, polygon test, grid walk, box shape | `FUN_00441270`, `FUN_00441b10`, `FUN_004425f0`, `FUN_0043cd62`, `FUN_00441ac0`, `FUN_00440810`, `FUN_0043f810`, `FUN_0043f9b0`, `FUN_004405f0`, `FUN_00440f30`, `FUN_0043d5ec`, `FUN_004427e0/00442780/004428b0` |
| `anim.ts` | animation instance: start / advance / seek / pose | `FUN_0043b4e2`, `FUN_0043b6a3`, `FUN_0043b76a`, `FUN_0043b64d`, `FUN_0043ba7a` |
| `input.ts` | key table of the EXE -> logical bits, edge detection, optional gamepad | `FUN_004376f9`, `FUN_00423170`, table 0x8aeb20 |
| `walk.ts` | Pepper's walk (`SGwalk`): states, input -> velocity, ground following, ledges, walls, slopes, jump arc, footsteps, tilt | `FUN_0042d514`, `FUN_0042a88f`, `FUN_0042a654`, `FUN_0042a487`, `FUN_0042baf6`, `FUN_00429e00` |
| `camera.ts` | chase camera, camera key ramps, view basis | `FUN_0042c227`, `FUN_0042b8e8`, `FUN_00422b50`, `FUN_0043cc5c` |
| `swim.ts` | swimming (`sgswim`), the sea loop and the mode switch (`PepSwitc`, with a rule list later modes extend) walk <-> swim | `FUN_0088c740`, `FUN_00422c7e/00422ddc` (camera), `FUN_0043363c`, `FUN_004bb67d` |
| `nodes.ts` | registers the built-in node names | |
| `zone.ts`, `setup.ts` | records from `extractZone` + archive, collision objects shared per `.col` slot, zone profiles (sea level, gravity, ground record, hidden records, box colliders, start place, player node chain) | `FUN_004b6475`, `FUN_004b4220`, `FUN_0053ea4d`, `FUN_004c2d22` |
| `render.ts`, `play.ts` | WebGL drawing of a frame, dev entry, HUD, sound sink | (browser side) |
| `walker.ts` | waypoint walker (see its header; written separately) | Common\WayPt |

Everything simulates at a fixed 30 Hz (dt = 1.0 in the game's unit, architecture.md 8.5); drawing interpolates the matrices of the last two ticks,
the camera and the animation frame.

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
Left / Right turn 5 degrees per tick, Up accelerates to 0.8; a mask-3 sphere sweep at +3.6; y = sea level. Swimming and the terrain ray one unit ahead reaches the sea
level -> mode 1, state 0x25 (out of the water), the position moves one unit ahead. The sea is a loop (`FUN_0043363c`, called at the end of the swim update): past
+-1056 (880 in sub-game 6, 1840 in 10 / 0x16) Pepper and the camera move to the opposite edge (x or z = +-1040, the other coordinate becomes its fraction). Ctrl (skateboard), vehicles and the Ptera are not ported; the mode word and the
node gating are in place for them.

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

## 5. Approximated or missing

* Not ported: pizza throwing and talking (Space / Shift call `FUN_00427c15`, which is 0 while no pizza record or NPC target exists), the skateboard (Ctrl) and the
  vehicle modes, the Ptera, the skateboard dismount state 0x1c, the sub-game 9 camera, the explicit +-1840 wrap inside the swim update (the +-1040 loop above hits first), mouse look
  of the camera, the hit cache of `FUN_00441b10` (full scan instead; same result except at overlapping polygons), the NPC bound (records with flag 0x40), analytic
  sphere / cylinder shapes (never created by the island / house set-up).
* The island set-up applies the hide lists of `FUN_004b4220` / `FUN_004b6475` and the box colliders; the story handler `FUN_004b7040` (era dependent visibility, NPC
  placement, the bridge collision cubes `BRCC`) is not ported, so records the story would move or hide (many sit at the origin until the story places them) are drawn /
  collide where the builder tables put them. The `BRCC` boxes block some places that the story opens.
* Sound: footsteps (surface and step pattern as in the original, variants from the sound table), jump, landing, skid, teeter, dive / out of water; no 3D positioning, no
  swim stroke loop. Music / ambience are started by the browser glue only if cheap.
* The blob shadow follows `rendering.md` section 9 loosely (type 4, ray down from the player).
* The simulation is deterministic at 30 Hz; the original ran with a variable step in the same unit, so very slow machines behaved slightly differently.

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

## 7. Next steps (M2 and on)

1. The zone loop / shell: `FUN_00404dc9` and the zone exit states (architecture.md 2.1 / 2.3), the front end `z60FRE`, pause menu (the input mapper already reports Esc), save game.
   `setupZone` is the place where the per-zone loop will call the same set-up.
2. Pull more of the zone set-up out of the EXE with the symbolic interpreter instead of the hand-written `ZoneProfile`s: the `FUN_00423532` attach calls and the record flag
   writes (architecture.md 8.2). The hide lists, box colliders and node registrations of `FUN_004b6475` / `FUN_004b4220` are the first test case.
3. Port the story handler (`FUN_004b7040`) and the era visibility for the island, then NPCs (generic talking NPC `FUN_00426151`, `Turn2Pep`, `MeetPepp`, `Human1`) on top of
   the waypoint walker, the cutscene runner (architecture.md 5), doors / portals / buildings, and the other player modes (skateboard, boat, helicopter, car) as nodes behind `PEPPER_CONTROL`.
4. HUD / 2D layer: fonts (`Fonts` archive), the text queue, `.str` messages; the DOM HUD of `play.ts` is a dev overlay only.
5. Particles and brick-morph effects, music (DirectMusic player exists), 3D sound positioning.
