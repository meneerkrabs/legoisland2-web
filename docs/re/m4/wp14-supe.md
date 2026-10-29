# M4 WP14: SUPE, the flying super-hero of SupaStat.c

Code: `src/island/pizza/supe.ts` (`SupeNode`, registered for `0x53c337` and exported from `src/island/pizza/index.ts`), test `tools/tests/m4-wp14-supe.mjs`
(94 checks: eras 0..4, the real island of story nodes 2 and 7).

## What he is (findings)

* **Record SUPE (45)**, attached in **every era** (story nodes 2 / 7 / 30 / 52 / 61) as `SGMFIG 0x426151` (pos 0, a talking NPC: clip 0x78, talk radius 1.0),
  `SupaStat 0x53c337` (pos 1), `Turn2Pep A 0x52ff39` (pos 2, gate MOVE_SUPE & 0x100) and `Turn2Pep B 0x5306e5` (pos 3); all gates on MOVE_SUPE (var 0xa8), the
  SupaStat gate is always open (mask 0). His argument block is empty.
* "SupaStat" = **Super Station**: he belongs to the railway's two stations. The OTH waypoint map is his sky network: STAT1_OUT 0 / STAT1_IN 0x2f (the south station,
  z ~ 192), STAT2_IN 6 / STAT2_OUT 0x39 (north, z ~ -514), the hub CTR 10 (105 up over the island's middle), STAT1_CTR 0x37.
* **Patrol**: from the hub he flies the OTH routes (`FUN_00539eb1`) to a random node 0..4, then back towards the destination, again and again (state 4 picks
  a new random node as the *immediate* target, not as the destination).
* **Station**: when Pepper's z is beyond a quarter of the line from either end (`FUN_0053a35d`: z > 15.35 -> STAT1_IN, z < -336.95 -> STAT2_IN) he routes there,
  lands (clip 0x8c, down 0.8 per tick to the ground under him) and stands; while she stays at that end his update **returns 0** so the Turn2Pep nodes behind him
  run (he turns to her and waves, and SGMFIG lets her talk to him: lifsm lines `SUPE...`). When she leaves he takes off for the hub via the station's OUT node.
* **The rescue**: Pepper on the **rail** (surface 9 = the track, y 42.4) or on surface 10 within 32 units of the locomotive, at height 41..48, for 3 ticks (at
  once when the locomotive is within 24): `DAT_009daa80` (WP6's `vehicles(w).current`) = none; he swoops to her at 2.4 per tick (from where he is when he is in view
  and within 1600 of the camera, taking off with clip 0x8c backwards first when standing; else he appears 24 units behind the camera eye, 8 up), the skateboard's
  rolling sounds stop, Pep_Up (0x37d) + the Thrust loop (0x37b), both play clip 0x8c backwards (the pick-up), he rises to 12 over the **nearest of ten track nodes**
  (`DAT_008eb114`), then flies to 80 over the **nearest helipad exit node** (WP6's pad table, PATH map), 16 over it, down to 16 over the terrain there, plays 0x8c
  forwards while sinking 1.6 per tick and lets her go: PEPPER_CONTROL 1, Pepper clip / walk state 0x1b, on the terrain, facing his way, Pep_Down (0x37c), Thrust off,
  **record 9 (the skateboard SBRD) hidden**; he rises with 0x8c backwards and flies back to the hub (non-solid, flag 0x10, until then).
  While carried Pepper hangs at his matrix minus the up and right rows (1 below, 1 to the side) with PEPPER_CONTROL 0x80 and plays his clips (0x8c, then 0xd2).
* **The east line**: when Pepper's x is within 24 of ROAD node 0x67's x (the east line, x ~ 308), the track node becomes the *other* end of that line
  (0x67 <-> 0x60) and he first turns (states 9 / 10, sliding his x onto the line by 0.4 per tick), then flies along the whole line (state 0xb, camera from behind
  (0, 0, -14)) before heading for the helipad (which was chosen at the call, near where she stood, so he flies 500 units north and back). This branch is skipped
  in a **16-bit display mode** (`DAT_00987660` = colour depth == 16, FUN_004096b3 / the mode set-up; the train doc's "meaning unknown" global): the port takes 32-bit.
* **The camera** (`FUN_0053ab93`) from the pick-up on: look-at = him + 4, the eye eases to (0, 10, -14) (`DAT_008eb150`) in his yawed frame by 0.01 / 0.02 / 0.04 /
  0.08 / 0.2 per state. The walk camera takes over after the drop (no explicit reset).
* **No talking while he carries**: the pre-render `FUN_0053c25a` sets 0x20000 in MOVE_SUPE when the state is > 4 (WP3's "no talking this tick" bit).
* **The train**: the trigger reads record 158's (TRNL) controller distance (`DAT_00983804 + 0x408c`); in eras 1-3 the record has no controller -> 1e38. At the
  pick-up `DAT_05d586ec` (train.ts `boarded`) = 0 (a rider is let go; never reachable since riding sets the surface to -1).

## The node (0x54 bytes, handler table 0x8eb0f0)

| offset | field | |
|---|---|---|
| +0x14 / +0x18 | `zoneA` / `zoneB` | z of OTH 0 / 0x39 moved a quarter (0x892134) inwards |
| +0x1c / +0x20 | `zoneA10` / `zoneB10` | the same with a tenth: never read |
| +0x24 | `eastX` | x of ROAD 0x67 |
| +0x28 / +0x2c / +0x30 | `dest` / `goal` / `next` | OTH destination, the node he flies at, the one after |
| +0x34 | `speed` | 1.6 (`DAT_008eb10c`); doubled to 3.2 by `FUN_0053a35d` when Pepper is at an end while +0x3a is 0 (never back) |
| +0x38 | `state` | below |
| +0x39 | `landNow` | "land at once" in states 2 / 3: never set by anyone |
| +0x3a | `steerBits` | 1 / 2 the yaw / pitch turn in progress, 4 compute the rates |
| +0x3b | `mode` | 0 free, 1 detour via 0x37 (no route), 2 landing |
| +0x3c / +0x40 / +0x44 | pitch / yaw rate, turn ticks | `cot(half the change) / 15` |
| +0x48 / +0x4a / +0x4c | `road` / `pad` / `east` | set at the call |
| +0x50 | `timer` | ticks on the rail |

States: 0 stand, 1 land, 2 / 3 fly (3 after a cutscene / the rescue), 4 at the destination, 5 / 7 take off backwards (5 unused), 6 swoop, 8 pick-up, 9 / 10 east
turn / align, 0xb along the east line, 0xc to 80 over the pad, 0xd 16 over, 0xe down to 16 over the terrain, 0xf drop, 0x10 climb back. The update returns 1,
except 0 while standing with Pepper at his end. A cutscene starting during the take-off / swoop sends him back to the hub (state 3).
The tail of the update: the clip advances while the node ran the frame before (`node + 8` == the frame counter), else the fly clip 0xd2 starts again; in
states 0 / 1 that is a second advance (double speed), as in the original.

## Quirks of the original reproduced

* The steering's turning branch turns **away** from the target (`-rate <= d` subtracts) until the angle is within its rate or 15 ticks have passed; the yaw rate is
  always computed from a zero change (`cos 0 / (sin 0 * 15)` = infinite), so the yaw snaps; only the pitch eases (and the "next leg" pitch is not negated).
* States 2 / 3 build the matrix with **roll = pitch** (`FUN_0043a4a1(m, rx, ry, rx)`); `+0x54` (rz) holds the pitch error.
* The uninitialised node words (debug heap 0xCD): `steerBits` -51, rates / turn ticks / timer -4.3e8 (harmless: the first steering tick or the first tick off the
  rail sets them).
* `DAT_05d58009 = 1` (skate.c's "reset the board's motion") when PEPPER_CONTROL & 4 at the end of the pick-up: unreachable (the carry set 0x80 the ticks before): not ported.
* `FUN_00539e30` stops the eight skateboard surface loops every pick-up tick (ids 0x17f..0x185, 300).

## Approximations / not ported

* The terrain heights `FUN_0043cd62` are used unchecked by the original (state 0xe and the drop); the port keeps the node / Pepper's y when there is no ground.
* Save / load (`FUN_0053c2fe` / `FUN_0053c2d9`, 0x2c bytes from +0x28) not ported. Random numbers: `Math.random`.
* The constructor runs on the first update (it needs Pepper's z and the waypoint maps), after the record's SGMFIG node (pos 0) ran its own set-up, which is the
  original's order (SGMFIG's constructor puts him on the ground, SupaStat's then moves him to the OTH node).
* The lead's brief named `FUN_0053c6eb` (282 lines) as SUPE's ride and `FUN_0053adc3` as the football: it is the other way round (`0x8eb0f0` = {`0x53adc3`,
  `0x53c25a`, `0x53c526`, `0x53c29d`, `0x53c2fe`, `0x53c2d9`}; `0x53c6eb` is the train's update, table 0x8eb170, ported by WP5).

## Tests

`m4-wp14-supe`: the attach in all five eras; the constructor (zones 15.35 / -336.95, start at the hub, random destination); a 1500-tick patrol over 17 OTH nodes
without NaN; landing at STAT1_IN with Pepper in the south (on the ground, idle / Turn2Pep clips, takeoff goal STAT1_OUT) and the take-off when she returns to the middle;
three full rescues (rail 105 era 0, the east line 103, rail 97 era 1 without a train): the state sequence, Pepper 1.41 from him all the way, PEPPER_CONTROL 0x80 /
1, the camera target, the flight height, the no-talk bit, the drop at the helipad exit node on the ground and upright, the sounds, the hidden skateboard, Pepper
walks afterwards, he flies back solid; the trigger rules (2 ticks not enough, the reset, the height window, the locomotive within 24: at once, 24 behind the camera).
Browser: `?zone=z02LGI&node=2&mute=1`, Pepper teleported onto the rail at ROAD 105: he comes, lifts her, flies over the south coast and sets her down beside the
helipad at (256, 33, 294) (screenshots looked at).

## Differential test (WP-VERIFY): SUPE against the original's code

> Status after WP-ISLAND-FIX: every KNOWN DEVIATION named in this section is fixed in the port and the test runs at tolerance 0 without the filters (`docs/re/gaps.md`, "Deviations FIXED by WP-ISLAND-FIX"); the sentences below describe the state when the deviation was found.

`tools/tests/m7-isl-veh-supe.mjs` (+ `supeSession` in `tools/lib/m7-isl-veh-supe.mjs`): the original's `FUN_0053c337` (constructor), `FUN_0053adc3` (update), steering `FUN_00539eb1`, turn `FUN_0053a7d8`, flight
`FUN_0053aa8e`, camera `FUN_0053ab93`, carry `FUN_0053ac79`, `FUN_0053a35d` / `a41b` / `a4f7` / `a6c2` and the node framework run natively (x87 24-bit) next to `SupeNode`; the waypoint maps are the ones the
original's own set-up loaded (route `FUN_00462bd0` / `FUN_00463b49`, node `FUN_00462be9` / `FUN_00462c18` run natively). Scripted inputs: Pepper's place, the surface under her feet (`DAT_009da9ac`), the in-view
flag of SUPE, the camera, a controller on TRNL, cutscenes. Per tick: SUPE and Pepper records, the node block (state, mode, steering bits, dest / goal / next, speed, zones), both clips / frames, all variables,
the vehicle globals, the camera, the sounds, record 9's flags. 21 M checks, dt 1 / 0.5, free-running + sync mode, ~27 s. Visited: states 0..0x10 (all 17), patrol over the OTH map, landings at both stations,
stand and take-off when Pepper leaves, 36 rescues: rail nodes 105 / 99 / 97 (in view, not in view, camera > 1600 away), the east line (103, 96: states 9 / 10 / 0xb), take-off from the station (state 7), a cutscene
during take-off / swoop and at the arrival (-> state 3), height window, the locomotive roof (surface 10, TRNL controller within 24 -> at once). Deviations:
* **KNOWN DEVIATION `supe-random-table` (src/island/pizza/supe.ts `randomNode`)**: `FUN_0053a3dd` ends `mov eax, [eax*4 + 0x8eb13c]` (0x53a403): the random index 0..4 selects the OTH node of the table
  **{14, 15, 21, 41, 46}**; the decompile (`void FUN_0053a3dd`) drops the lookup and the port (and this doc: "a random node 0..4") uses the index itself as the OTH node (first goal 4 against 46 at t0). Every
  patrol destination and every "next random goal" of state 4 is affected. The test maps the port's random draws through the table so that everything after stays strict.
* **KNOWN DEVIATION `supe-anim-dt`**: the port calls `anim.advance(1.0)` (default dt = 1) for SUPE's and Pepper's clips in states 0 / 1 / 7 / 8..0x10 and the tail of the update; the original's
  `FUN_0043b76a` advances by `rate * DAT_008b1718`. At dt = 0.5 the port's clips run twice as fast per game time (original frame 4.5 where the port has 9 at t1290). The test passes the world's dt in the port's calls.
  Positions are not dt-scaled in the original either (speed 1.6 per tick, 2.4 in the swoop, 0.8 / 1.6 vertical): the port equals it there.
* Float noise only otherwise: ~3e-5 in matrices, 1e-4 in the camera / carried Pepper at dt 0.5 free-running; two knife-edge turns (the pitch rate `cos(b) / (sin(b) * 15)` with a tiny `b` amplifies float32 noise ~1e-4)
  are re-synced and counted (`grazes`).
Doc statements corrected: "a random node 0..4" (it is the table above); "Random numbers: Math.random" is fine (the original: `FUN_004388ae(5.0)` truncated, index into the table).
