# M4 WP6: Pepper's modes and the island's vehicles

Code: `src/island/vehicles/` (`index.ts` registers the constructors), tests `tools/tests/m4-wp6-{switch,skate,boat,heli,car}.mjs`
(`node tools/test-formats.mjs --only m4-wp6-switch,m4-wp6-skate,m4-wp6-boat,m4-wp6-heli,m4-wp6-car`).

## Constructors

| ctor | node | where | handler table | file |
|---|---|---|---|---|
| `0x4bbef8` | PepSwitc (island) | PEPP pos 1, always | `0x8d9d18` = update `FUN_004bb630`, pre-render `FUN_004bb67d` | `pepswitch.ts` `IslandPepSwitch` |
| `0x43310c` | skateboard (thunk to `FUN_00492cc2`, skate.c of z01BPK) | PEPP pos 4, `0x5e & 4` | `0x8d2130` = `FUN_00490e2e` / `FUN_004928d2` | `skate.ts` `SkateNode` |
| `0x4333c2` | SGVehic | PEPP pos 5, `0x5e & 8` | `0x8ae318` = `FUN_00433160` / `FUN_00433173` | `pepswitch.ts` `VehicleSeat` |
| `0x4bb582` | Ptera (the riding half) | PEPP pos 6, `0x5e & 0x40` | `0x8d9c98` = `FUN_004bb425` / `FUN_004bb43f` (both `return 1`) | `pepswitch.ts` `PteraRide` |
| `0x430e6c` | SGBoat | SPBT (MOVE_BOAT 0x82), JSKI (0xb2), DNGY (0x10), mask 0 | `0x8ae1f0` = `FUN_0042f9a2` / `FUN_00430749` | `boat.ts` `BoatNode` |
| `0x4325e8` | SGHeli | PHEL (MOVE_PHEL 0x3e), RHEL (0xbe), mask 0 | `0x8ae288` = `FUN_00431425` / `FUN_00432421` | `heli.ts` `HeliNode` |
| `0x88fb35` | SGCar | AMBU 0xa7, SPD0 0x80, SPD1 0xa4, SPD2 0x7f / 0x7e, PCAR 0x60 (behind speeder.c, WP5) | `0x982c48` = `FUN_0088ed56` / `FUN_0088f816` | `car.ts` `CarNode` |

Findings that correct the brief / architecture.md:
* PepSwitc's mode logic (`FUN_004bb67d`) is the **pre-render** hook; its update `FUN_004bb630` only puts Pepper on the "leave the car" spot while
  PEPPER_CONTROL has `0x401`. The M1 `PepSwitchNode` (swim.ts, used by the other zones) does the walk/swim part in the update; the island now uses
  `IslandPepSwitch` (registered over the M1 factory at `0x4bbef8`).
* **Who switches Pepper into a vehicle is the vehicle**, not PepSwitc: every parked vehicle's update tests Ctrl (pressed) + its controller distance
  (`ctrl+0x18`, squared XZ distance to Pepper) against `DAT_008ae330` (the walk node writes 576 = 24^2 every tick, so the nearest vehicle within 24 wins),
  makes itself `DAT_009daa80` (the current vehicle) and returns 1; PepSwitc's pre-render then starts Pepper's getting-in clip 0x4c (instead of the
  skateboard), and the vehicle's pre-render sets its MOVE var to 1 and PEPPER_CONTROL = 8 (cars: var bit 0x10000000).
* **Leaving**: boats only at a dock (Ctrl -> the boat sails into the nearest free dock within 24 and Pepper steps off at its exit node), helicopters only
  on a helipad (Ctrl -> nearest free pad within 80, descend, exit node), cars anywhere (PepSwitc mode 8 + `DAT_009da9f8` high word -1: `FUN_0088e030`
  finds a free spot). The docks (4) and helipads (10) are PATH-map (1) nodes set by `FUN_004b6475` (common.ts `DOCKS` / `PADS`); a vehicle reserves
  the nearest one within 80 at construction and frees it while it is out.
* The Ptera ride on PEPP is empty (both hooks return 1): the flying Ptera (`FUN_004b93b0`, WP7) moves Pepper. `0xa9 PEPP_IN_VEHICLE` is written only by
  that Ptera code; `0xbb PORTAL_VEHICLE` is cleared by PepSwitc while walking and set by the portals (WP4).
* The rotors are **in SGHeli**, not the director: `FUN_0043ea60(model, i)` (mesh part matrix i = the `.msh` MATL entry) of RHEL part 2 spins about y
  by 0.8 per tick, part 3 (tail) about x by 0.75; PHEL part 3. The seat is part 1 of every vehicle (SGVehic), the car wheels 2..5.
* `DAT_00987660` (camera.ts `vehicle`) is not a vehicle flag: it is set when the display runs in 16-bit colour (`DAT_00983cc8 == 0x10`,
  the graphics set-up `FUN_004059b0`, saved / restored by `FUN_004096b3`); the vehicle cameras test it like the chase camera does (the port leaves it false).

## Modes (PEPPER_CONTROL & 0xfff, `FUN_004bb67d`)

| mode | what PepSwitc's pre-render checks |
|---|---|
| 1 walk / 0x401 | (story node 30, once: the hologram's call timer `_DAT_05defbcc` = 90, `FUN_0088d2bc`, = `ctx.objective.holoTimer`); var 0xbb = 0; Ctrl (pressed) and not in walk state 1 / 2 / 0x57 / 0x1f / 0x38, not in clip 99 / 0x62, no vehicle chosen -> **skateboard**: mode 4, state 0x16, board record 9 shown, board clip 1, sound 0x150; a vehicle chosen -> state 0x4c; feet below the sea -> mode 2, state 0x62 |
| 2 swim | the terrain 1 ahead (probe 4) >= sea -> mode 1, state 0x25, sound 0x128, Pepper put there (+4 up) |
| 4 skateboard | Ctrl (or 0x1000) and mailbox not 0x20 / 0x32 -> mode 1, state 0x1c, board clip 2, the 8 rolling sounds stopped, sound 0x106; terrain 4 ahead <= sea (not in the air, not in clip 0x16) -> mode 1, state 0x1c |
| 8 vehicle | Ctrl (or 0x1000), kind -1 (car) and a free spot -> `DAT_009daa80` = 0, mode 0x401, state 0x1b |

`0x1000` survives every change. The state goes to the mailbox `DAT_008ae088` (`w.pep.mailbox`) and Pepper's clip.
Not ported: `FUN_0051db5c` (Enter) / `FUN_0051dbd7` (every tick: the brick-morph vehicle roster 0x8e9b28, FX_Bricks: WP9), `FUN_004bc527` (empty),
`FUN_004433f0(DAT_05d5812c, pos clamped to +-400)` (the sea sound follows Pepper: ambient, WP7).

## Skateboard (skate.c, island branches)

States (= Pepper's clip): 0x16 getting on (speed 0, board clip 1 at half rate) -> 0x2d push (twice) -> 0x29 rolling; steering beyond +-21 shows the
lean poses (Pepper 0x51, board 4, both scrubbed to frame n + n * steer / 127); Alt -> 0x2a crouch (charge 0.1, +0.06 per tick up to 2) -> held: 0x2b ->
released: 0x20 in the air with v0 = charge * 15 -> 0x21 landing (sound by surface) -> 0x29; every 50 ticks rolling: a push (0x2d); an edge ahead
(more than 2 above the ground 2.5 ahead) starts an ollie with v0 15; the walk node's jump state (mailbox 1) continues as 0x20 with v0 20.
* Input (`FUN_00490cd2`): the same key ramp as the walk node; the board speeds up by itself by 0.1 per tick to 0.75; Down brakes by 0.2 (net -0.1);
  yaw += steer * 0.00075 per tick (not in the air).
* Arc (`FUN_004900d4` case 0x20): `t += 0.1`, `vy = g t + v0`, `y = vy t + y0 + g t^2 / 2` (so `v0 t + 1.5 g t^2`), clamped to 4 per tick down; going
  up is swept (radius 1.4).
* Ground (`FUN_00490e2e`): sweep (0, -8, 0) from 1.2 above the feet, mask 3, radius 1.4, skin 0.2 (`DAT_008d2120/2124`); no hit -> the terrain;
  on `LAND` the matrix is tilted to four probes 0.8 around Pepper (`FUN_0048e1b0`); walls: slide, a second hit stops.
* Pre-render (`FUN_004928d2`): a ceiling hit on a slope (up.y < 0.9) knocks Pepper off (0x37, board hidden, mode 1); speed <= 0 outside 0x16 / 0x2d /
  0x20 -> off (0x1c, board clip 2, mode 1).
* Camera: target 4 above Pepper, eye eases (0.1) to (0, 12, -14) in his frame.
* Sounds (`FUN_004b0b37`): rolling by surface 0 0x180, 1 / 8 0x17f, 3 0x181, 4 0x184, 6 0x182, 7 / 9 0x185, 10 300; landing 0 0x2c6, 1 / 6 / 8 0x2c1,
  3 0x2c5, 4 0x2c3, 7 0x2c2. The ollie sound `DAT_05d5802c` is only set up by the skate park (0 on the island).
* **Skipped**: everything under `CURRENT_SUBGAME == 1` (the park: half-pipes `QPIP`, the +-39.9 / +-24 arena, its camera clamp), the tricks of the air
  (`FUN_0048e840`: Space / Ctrl / Shift + direction -> trick clips 0x52..0x6d and board clips 5..0xe, trick progress `node+0x78`, score `DAT_05d58004`).
  The landing judgement is ported but with no trick the progress stays 0 and the crash (0x23) never happens on the island.
* Board animation: the port's SBRD record has no animation instance; `SkateNode` creates one from `anim/SKBD.blk` (the original's record has one).

## Boats (SGBoat)

* Argument block: +4 the ripple record (RIPB / RIPJ / RIPD; `|= 0x10`, `FUN_00444550(rec, 0xff, 2)`), +8 WAKR (`|= 0x10`, hidden), +0xc WAKP
  (hidden, render mode 2), +0x10 WAKS (hidden, render mode 2). The type is the record name's first letter.
* Driving (`FUN_0042f9a2`): Space forward, Alt reverse (the pad's y axis -127 / 127), Left / Right steer (dead zone 0.2), steer eased by 0.125;
  `yaw += steer * 0.0628319 * (speed * 0.390625 + (speed < 0 ? 0 : 0.5))`; pitch `-speed * 0.0687223`; roll `-steer * 0.439823 * speed * 0.390625`;
  `speed += thr * (thr < 0 ? 0.064 : 0.12)`, `speed -= speed * 0.03` (top speed 4 per tick); sweeps: along the way from 2.8 above the sea, and
  (0, 8, 0) up from the sea at the new spot, mask 3, radius 0.8, skin 2.0: a hit puts the boat back, speed 0, crash sound 0x332 (the shore).
  The boat's y is the sea level (the pre-render writes it); the pitch lifts the drawn bow by sin(-rx) * the collision box's half length.
* Camera: the eye eases (0.35) to 40 behind / 16 above, looks at 8 above the boat; then `FUN_0043363c` (the world wrap, swim.ts `wrapWorld`).
* Engines (`FUN_0042f666` / `77a` / `88e`): speedboat 0x129 9966..11443 Hz (+-36 per tick), jet ski 0x8d 10253..12237 (+-66), dinghy 299 10738..11500
  (+-25), wobble `base + sin(phase) * base * 0.05`, phase += 0.05 (`FUN_0042f5f0`). `ctx.sfxFreq(id, hz)` (new optional ctx member).
* Pepper's clips: speedboat 0x4c, jet ski 0x6f, dinghy 0x6e, scrubbed to frame n + n * throttle.
* The wake (`FUN_00430749`): WAKR at the sea, scale (4 speed, 1, 4 speed), moved (1 - speed / 4) * half length forward; WAKP (plume, only above speed 2)
  scale (2 speed, 2.5 speed, 2 speed) half a length behind at sea - 1.5; WAKS (spray) scale 4 speed, half a length ahead at sea - 0.05 speed.
  **Approximation**: the original draws the three records in the boat's draw hook (`FUN_00430c59`, flags | 3 for the draw only); the port shows them
  (flag 2) while a boat drives and hides them when the boat is parked again. The BOATPLUME particle emitter is not ported.

## Helicopters (SGHeli)

Space / Alt pitch the nose to +-0.5215 (followed by at most 0.0314 per tick), Left / Right turn (yaw 0.0628 per tick, roll to -+0.2639), Up / Down = the
pad's y axis = descend / climb (vy += 0.16 * input - 0.1 vy); thrust = pitch * 0.7639 along the nose, drag 0.1; horizontal moves only above a squared
speed of 0.16, vertical only above 0.4. Altitude band (state 1): below 16 above the ground (terrain probe 160, at least the sea) it is lifted to 16,
below 40 it climbs by itself, never above 160. Take-off (state 0) climbs (0.5) until 40 above the ground. Landing (state 2): the nearest free pad
within 80; farther than 16: pitch towards it (if 40 above it) and turn; within 16: sink (-0.5), slide (0.125) over it, at the pad's height Pepper steps off
(PEPPERSSHADOW 4). Camera: 56 behind, 24 above, eased by 0.35, looking at the helicopter. Engine 0x132 19756..22050 Hz (+-76), wobble phase += 0.02.

## Cars (SGCar)

Space +0.05 per tick to 1 (coast -0.025), Alt -0.01 to -0.75 (coast back +0.025); yaw += steer * 0.00075 when |speed| > 0.05 (reversed backwards);
velocity = speed * forward; the terrain 8 ahead below the sea stops the car, a slope changes the speed by -0.1 * forward.y (>= -0.5); the matrix is
tilted to four probes 1.5 around the car (`FUN_0088e440`); the sweep starts between the front wheels (parts 2 / 3; backwards 4 / 5) 1.6 up, radius / skin
0.6: slide, a second hit bounces the car (velocity x / z negated) and spins it 0.5 per tick for 20 ticks (Pepper clip 0x4a). Camera: target = Pepper's
matrix (`DAT_009da5d8`), eye eased (0.1) to (0, 12, -16) in his frame, at least 6.4 above the car (`FUN_00422ddc`). Leaving (`FUN_0088e030`): candidates
at -right, +right, +forward, -forward times r (r = 4, 8, 12 ..., the vectors are multiplied again every round), the terrain above the sea (surface 9 =
a roof: 36 lower), nothing solid from 48 above to 8 below; **the port stops after 6 rounds** (the original loops for ever) and then uses PATH node 0x1a4.

## Shared state (`common.ts` `vehicles(w)`, world.ext key `island.vehicles`)

`current` = `DAT_009daa80`, `range` = `DAT_008ae330`, `kind` = high word of `DAT_009da9f8` (-1 car, -2 boat, -3 helicopter; the objective arrow,
WP8, uses it), `boatEnter` / `heliEnter` / `carEnter` = `DAT_009daa10` / `DAT_009daa78` / `DAT_05defbd0`, the dock / pad tables, `board` = `DAT_009daa7c` = 9.
Var 0x0c (interact icons) bits ORed in: car 2, helicopter 4, boat 8, pad near 0x40, dock near 0x80. Var 0xc5 PEPPERSSHADOW: 1 in a helicopter, 4 after leaving
a boat / helicopter.

## Approximations / open points

* The constructors' world-dependent work (argument records, the dock / pad reservation) runs at the node's first update (the factory has no world);
  the reservation order is then the record order (SPBT 163, DNGY 164, PHEL 165, RHEL 170, JSKI 171) instead of the attach order.
* The skateboard's own sweeps leave the board record (SBRD, SkBoard.col with 384 polygons of flags 0x23) out: the port's sweep from 1.2 above the feet
  starts inside the skin of the board's chamfer planes and would lift Pepper every tick. The rules are the same as `FUN_00441270`'s, so why the original
  does not climb is UNCERTAIN.
* Engine frequencies need `ctx.sfxFreq` (optional); the vehicles call `ctx.sfx(id)` every tick like `FUN_004435a0` (the sink must not restart a playing loop).
* `FUN_00444550(rec, 0xff, 2)` (render mode 2 of the ripple / wake meshes) is not modelled.
* Arrival in a vehicle (the island's arrival code `FUN_004c2d22`, src/zones/z02LGI/arrival.ts): set `vehicles(w).current = rec` and PEPPER_CONTROL = 8;
  the vehicle's own update / pre-render then sets its MOVE var to 1 (the original does the same).
