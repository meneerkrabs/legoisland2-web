# M4 WP13: the Ptera / glider ride (eras 3 / 4) and what is left of the eras 2-4 mode logic

Code: `src/island/vehicles/ptera.ts` (`PteraNode`), registered in `src/island/vehicles/index.ts` (`CTOR_PTERA = 0x4bb1a6`); one surgical edit in
`src/zones/z02LGI/index.ts` (the arrival sets `vehicles(world).current`). Test `tools/tests/m4-wp13-ptera.mjs` (`node tools/test-formats.mjs --only m4-wp13-ptera`, 47 checks).

## The original (Common\Z02LGI\c_src\Ptera.c)

| function | what |
|---|---|
| `FUN_004bb1a6` | ctor, node block 0x88, handler table `0x8d9c70` = update `FUN_004b93b0`, pre-render `FUN_004baf1b`, destroy `FUN_004bb3f5`, draw `FUN_004bb100` (= `FUN_00444480`, the default draw), save `FUN_004bb16d` / load `FUN_004bb148` (0x70 bytes from +0x18) |
| `FUN_004bb582` | the riding half on PEPP (pos 6, gate `PEPPER_CONTROL & 0x40`), table `0x8d9c98`: update / pre-render return 1 (WP6 `PteraRide`) |

Attaches: PTER (record 66, rig `PTER`, the only animated one) by `FUN_004b4220` with gate var 0xb6 mask 0, GLDR (record 172, no animation instance) by
`FUN_00522e68` (era 3) / `FUN_0052c2b5` (era 4) with gate var 0x11 mask 0. Both in eras 3 and 4 (nodes 52..72), not before. Argument +0 = a home PATH node
(PTER 406, GLDR 270): used only by state 2 and as a "may land" flag (`>= 0`). Every `rec + 8 == 0` branch is the glider.

Node fields: +0x1c yaw rate, +0x20 last yaw key (1 Left / 2 Right), +0x21 last pitch key (1 Down / 2 Up), +0x22 bouncing, +0x23 state (signed),
+0x24 pitch rate, +0x28 bounce time, +0x2c bounce vector, +0x38 speed, +0x40 ground height, +0x78 the helipad it occupies, +0x7c propeller angle,
+0x84 wing-sound phase. The ctor: state -1, speed 1, clip 3, reserves the nearest free pad within 80 (squared < 6400), loads sounds 0x303 / 0x302.

**Landing slots are the helipads** (`DAT_009daa14` count 10, `DAT_009daa18` node, `DAT_009daa38` exit node, `DAT_009daa2c` map, `DAT_009daa50` taken),
the same table SGHeli uses (WP6 `vehicles(w).pads`); the Ptera reserves / frees pads exactly like the helicopters.

### Update FUN_004b93b0 (returns 0 when the record is hidden, 1 when Pepper's controller is disabled; parked: see below)

* First update after a pause (`DAT_009da5cc != node+8`, the port's `w.frame !== stamp`): the current vehicle (`DAT_009daa80`, e.g. after the arrival)
  restarts clip 1, any other goes to state 3 (parked).
* **-1 take-off**: ground = `FUN_0043cd62(pos, 8)`, y += 0.25 dt, animation at the speed; 18 above the ground -> state 0.
* **0 flight** (not bouncing): a free pad within 32 (|dx|, |dz| <= 32) sets icon 0x40 and Ctrl (with home >= 0) starts the landing; Space +0.18 dt to 2.0, else
  Alt -0.06 dt to 0.5; pos += speed * forward (no dt); the yaw / pitch rate rules (steps 0.0016 / 0.0011 per tick, limits 0.05 / 0.02, the rate eases back to 0
  only in the direction of the last key); ry += yaw rate (wrapped), rz = -8 * yaw rate; at each loop end of the animation clip 4 with 1/16 chance
  (`FUN_004388ae(16)` truncated < 1) else clip 1. Collision: the way just flown is swept BACKWARDS (from the new to the old position, mask 3, radius / skin 2,
  `FUN_00441270`); a hit, or y <= sea level (normal (0,1,0)), sets bounce = normalise(reflect(old - new, normal)) (`FUN_0043cfee`: d - 2 n (d.n)), bounce
  time 10, speed 0.5, bounce.y forced <= -0.5; a second sweep from the new position to the old one 40 higher catches a ceiling (only when the hit point is
  above). Bouncing: pos -= time * bounce, time -= dt, pitch rate drifts to -0.02. Then rx += pitch rate, clamped to +-0.35.
* **1 landing**: nearest free pad within 80; x / z ease 1/8 per tick to it, rx = rz = 0; the ground (+1 Ptera, +4 glider); sink 0.7 per tick; on the ground:
  state 3, Pepper on the pad's exit node, `DAT_009daa80 = 0`, PEPPER_CONTROL = 1, Pepper clip / mailbox 0x1b, the pad taken (+0x78), 0xc5 = 4, 0xa9 = 0,
  the Ptera's clip 3.
* **2** dive (rx -0.05 per tick to -0.5, then 0.8 forward) and, out of view (record flag 1), back to the home node, parked. **No code of the executable sets
  state 2** (only the save / load block could): ported, unreachable.
* **3 parked**: animation at rate 1; Ctrl (pressed) with Pepper walking (`0x5e & 1`): the nearest vehicle within `DAT_008ae330` takes the choice
  (`DAT_009daa80`, range = its distance), returns 1 (so the pre-render runs); otherwise icon bit 2 within range, returns 0.
* After the states (-1..2): var 0xc5 = 6 (glider) / 5 (Ptera), var 0xa9 = 1, matrix = Rz(rz) * M(rx, ry, 0, pos); states -1..1: chase camera, eye eased by
  0.35 to (0, 16, -24) in the unrolled frame, target = position; `DAT_05d58634` = speed (written, never read); `FUN_0043363c` world wrap; y capped at 184
  (`DAT_008d9c6c`). Pepper's clip: glider 0x114 (advanced at rate 1) and the glider's mesh part 2 (propeller) about z by +0.25 per tick; Ptera: 0xed (0x134
  when the Ptera plays clip 2) at the Ptera's frame. Wing beats (Ptera only): 0x303 at frame > 0, 0x302 > 14, 0x303 > 29, 0x302 > 44 (fall-through
  switch), reset when the clip is about to wrap (`FUN_0043b92a`).

### Pre-render FUN_004baf1b (nothing during a cutscene)

Parked + Ctrl + chosen: glider -> Pepper clip 0x114; Ptera -> its clip 1, Pepper 0xed; kind (`DAT_009da9f8` high word) = -5, state -1, PEPPER_CONTROL = 0x40
(the 0x1000 bit is dropped); if it stood on a pad: the pad is freed, speed 1, pitch key 1, pitch rate -0.02. Not parked: Pepper gets the vehicle's whole
matrix (`FUN_0043b00b`, 0x40 bytes) and its position (glider: the point (0, -5.5, -0.5) of the glider's frame, `DAT_008d9c88`).

### How Pepper gets on (PepSwitc)

No mode-0x40 branch exists in `FUN_004bb67d`: walking + Ctrl + a vehicle chosen -> PepSwitc's pre-render (PEPP, record 16) starts clip 0x4c, then the
Ptera's pre-render (record 66 / 172, later in the pass) switches to 0x114 / 0xed and PEPPER_CONTROL 0x40. While riding PepSwitc does nothing (no branch)
and the riding node stops Pepper's chain. **WP6's `pepswitch.ts` needed no change** (only its comment now points here).

### Arrival and exit

* Arrival (`FUN_004c2d22`, WP8 `arrival.ts`): prev zone 10 / 11 / 13 / 0x13 -> `FUN_0051e4b0(2, 0)` = row 2 of the portal vehicle table
  (`PHEL, RHEL, PTER`) by var 0xbb; PTER -> PEPPER_CONTROL 0x40, `DAT_009daa80` = PTER, the Ptera at 48.8 from PORA. The node's first update sees
  `DAT_009daa80 == rec`, keeps state -1 and takes off with Pepper. The zone game did not set `DAT_009daa80`: **added** (`vehicles(world).current = v`
  next to the PEPPER_CONTROL write in `src/zones/z02LGI/index.ts` afterSetup; the helicopter / boat arrivals need the same and now get it).
* Exit: PORA's box portal (`FUN_0051ea3c`, WP4, args half 21, table 2, target zone 10, no key) tests the row's vehicles: flying the Ptera into it writes
  var 0xbb = 2 and var 5 = 10 (tested).

## Approximations / differences

* World-dependent constructor work (animation clip 3, pad reservation) runs at the first update. PTER's animation instance comes from WP7's `ensureAnim`
  (the island loader's rig table); GLDR has none, as in the original.
* Landing with no free pad within 80 any more (taken between the Ctrl and the landing): the original indexes the pad table with -1 (garbage); the port
  goes back to flying.
* State 2's "out of view" uses `IslandCtx.inFrustum` (absent: always in view); the state is unreachable anyway.
* `FUN_004435a0` wing sounds go through `ctx.sfx` (2D, like the original handles from `FUN_00443580`). The save / load hooks are not ported.
* Pepper's riding pose is the clip on Pepper's own rig at the Ptera's position; the screenshots show him standing on the Ptera's back (clip 0xed), which
  is what the data gives.

## Tests (m4-wp13-ptera, 47 checks) and browser run

Nodes 52 and 61: both attaches (home / gate); parked state, clip 3, icon 2; Ctrl boards (0x40, kind -5, clips 0xed / 1); take-off in 69 ticks; vars 0xa9 / 0xc5;
Pepper carried; chase camera; wing sounds; speed 1 -> 2 (Space) -> 0.5 (Alt); Left turn with bank and easing out; Up dives / Down climbs; ceiling 184; sea
bounce; hillside bounce; landing on every free pad (8 of 10, pads 0 / 1 are RHEL's / PHEL's) in 54..56 ticks with Pepper on the exit node; re-boarding
frees the pad; flying into PORA (var 5 = 10, var 0xbb = 2); arrival in the Ptera (takes off at once); the glider (clip 0x114, shadow 6, Pepper 5.5 below,
propeller part, turning). Browser (`?zone=z02LGI&node=52&mute=1`, private server): after the node's cutscenes Pepper boards the Ptera with Ctrl, takes off,
turns (banked) and dives over the island; no console errors (screenshots looked at).

## What else of eras 2-4 is not registered (nodes 30 / 52 / 55 / 58 / 61, `registeredCtors()`)

| ctor | records | status |
|---|---|---|
| `0x53c337` SUPE (SupaStat.c, super-hero taxi) | SUPE | WP14 (`src/island/pizza/supe.ts`) |
| `0x531d45 / 0x5327b1 / 0x532acc / 0x533ba8` BrickBot.c | BBT*, BBB0, BBG0, BBR0, BBY0 | another worker |
| `0x4bf329` Human1.c (update `FUN_004beec5`, pre-render `FUN_004bf03e`) | XXX0..2 (all eras, also node 2) | the ctor computes a ballistic launch (per-walker gravity table `DAT_008add08`), the hooks sync a walker clip; the kids' jump: it plays clip 0x84 and launches the SGMFIG head along the arc: **ported by WP-ISLAND** (`src/island/npc/launch.ts`, gaps S3) |
| `0x88d1f6` sgswim (SPLH, draw `FUN_0088cfcb`) | SPLH (all eras) | Pepper's swim splash ring: a pure DRAW hook (scale / place SPLH at Pepper on the sea, var 0xc5 = -1 while swimming, 4 after); **ported by WP-ISLAND** (`src/island/vehicles/swimsplash.ts`: the pre-render does the draw hook's work, `RF_NO_DRAW` while not swimming) |
| `0x4266ca / 0x426915 / 0x426da4` seabed / sky / sea | SEAB, SSKY, SSEA | rendered by `src/render/environment.ts` (WP7) |
| `0x534b89` building | HSE2, SHP2, PIZB | dead in the original (WP4) |

Nothing else of the era 2-4 rosters is missing; the vehicle modes (boats, helicopters, cars, skateboard: WP6; Ptera / glider: here) are all registered.

## Differential test (WP-VERIFY): Ptera.c against the original's code

> Status after WP-ISLAND-FIX: every KNOWN DEVIATION named in this section is fixed in the port and the test runs at tolerance 0 without the filters (`docs/re/gaps.md`, "Deviations FIXED by WP-ISLAND-FIX"); the sentences below describe the state when the deviation was found.

`tools/tests/m7-isl-veh-ptera.mjs` (+ `pteraSession` in `tools/lib/m7-isl-veh-supe.mjs`): the original's constructor `FUN_004bb1a6`, update `FUN_004b93b0`, pre-render `FUN_004baf1b`, the node
framework and PepSwitc run natively (x87 in 24-bit precision, `cpu.cw = 0x7f`) next to `PteraNode`; node 52 (eras 3), PTER and GLDR, Pepper beside the parked vehicle with Ctrl. Hosted (not the
subject): collision / terrain queries (the port's world), the animation instance of PTER (the port's `AnimInstance`, same rig), `FUN_0043b92a` (the "clip about to wrap" test, from the decompile / asm), rand
(`rand() / 32767 * x`, the same scripted source for both), the cutscene flag. Per tick: both records and Pepper, the node block (`+0x1c .. +0x84`: yaw / pitch rate, keys, bouncing, state, bounce vector,
speed, ground, pad, propeller, wing phase), clip / frame of PTER and Pepper, all variables, the vehicle globals (pads taken), the camera, the sounds. 9.0 M checks, 4 sessions (dt 1 / 0.5, free-running
with the shared float-noise guard, sync mode that copies the original's float state before every tick), ~17 s. Visited: 8 boardings (state 3 -> -1), take-off, 700 ticks of random keys per vehicle
(Left / Right / Up / Down / Space / Alt: 84 bounces, 112 sea bounces, 1886 ticks at the 184 ceiling), 16 landings on free pads (state 1 -> 3, exit node, re-boarding frees the pad), the 1-in-16 glide clip
4 (2602 ticks), cutscene during the ride, Ctrl away from a pad. **Port = original** apart from:
* KNOWN DEVIATION `ptera-wrap-pepper` (src/game/swim.ts `wrapWorld`): `FUN_0043363c(vehicle)` also adds the wrap delta to the focus record (Pepper, `DAT_009da5d0 + 0x3c / 0x44`) when the vehicle is not
  the focus record; the port's `wrapWorld(rec)` moves only the vehicle (and the camera), so on the wrap tick the sea loop (sound 0x125, `FUN_004433f0` at Pepper's position in PepSwitc's pre-render, which
  runs before the vehicle's pre-render copies the position) is one world length (2 x 1040) away. 14 occurrences in the test, nothing else observable.
* State 2 stays unreachable (no code sets it); not scripted.
Not covered: era 4 (node 61, same code), the save / load hooks.

## Status 2026-10-31 (WP-ISLAND-CLOSE: the statements of this document that are out of date)

* The Ptera's save / load hooks are ported (`saveBlock` / `loadBlock`, 0x70 bytes from +0x18). "Landing with no free pad" (original: pad table index -1) is unreachable: see wp7-ambient.md status.
