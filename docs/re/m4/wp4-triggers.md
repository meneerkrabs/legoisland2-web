# WP4: StartCSM triggers, portals, doors, buildings, pages, LGI_FSM, hOLO

Code: `src/island/trigger/` (`index.ts` registers everything), tests `tools/tests/m4-wp4-triggers.mjs`, `tools/tests/m4-wp4-buildings.mjs`.
Constructors registered (`registerCtor`): `0x51e19c` StartCSM trigger, `0x51ea3c` box portal, `0x535e80` door, `0x5364a5` swinging part, `0x535281` page,
`0x5357cb` music house, `0x4b8c73` LGI_FSM, `0x88df51` hOLO. Not registered on purpose: `0x534b89` (dead node, see below).

The emulated set-up does not run the constructors, so every port does its constructor's side effects itself, lazily on the first update (the factory has
no world and the mock / real context may be installed after `setupZone`): door / part initial rotation, page hide + building reveal, HOLO / record 371 hidden ...

## StartCSM.c

### Waypoint / immediate trigger: ctor FUN_0051e19c, update FUN_0051dd7e (vtable 0x8ea070)

Argument block (node offsets in brackets):

| block | node | meaning |
|---|---|---|
| +0x00.. | +0x14 | `count` shorts: PATH (map +0x17) waypoint ids |
| +0x14 s16 | | the single waypoint when count = 0; < 0 = no waypoint (fires at once) |
| +0x16 u8 | +0x18 | count |
| +0x17 u8 | +0x19 | waypoint map slot |
| +0x18 f32 | +0x1c / +0x20 | radius in walker units: (r*8)^2, icon radius (2*r*8)^2; no waypoint: 1e38 (0x7e967699) |
| +0x1c / +0x20 / +0x24 s16 | +0x24 / +0x28 / +0x2c | var, value, operation applied AFTER the cutscene (FUN_0051dc50): 1 SET, 2 OR, 4 ANDNOT, 0x10 / 0x20 OR / ANDNOT plus the same on the head-node gate vars of the linked records (FUN_004240d1, table 0x9da7e0), 0x40 (+1000 to vars 0xa6 / 0x12, -1 to 0xb0) + SET |
| +0x26 u8 | +0x2e | put Pepper's walker on the nearest waypoint when it fires (FUN_004625d7) |
| +0x28 s16 | +0x38 | cutscene slot (-1 none); the node writes -20 (fired) and -30 (done) here |
| +0x2a u8 | +0x2f | only while the record is visible |
| +0x30 | +0x30 | key mask (`pressed`, DAT_00983840); 0 = walking in is enough |
| +0x34 | +0x34 | INTERACT_ICONS (var 0xc) bits ORed when near / when the key is missing (a zero becomes 2 with a key mask) |

Rules (update returns 0 on every path): nothing after -30, during a cutscene, or for a hidden record with +0x2f. After -20 (the frame after the cutscene
ended) apply the operation and go to -30. Unarmed: nearest waypoint (3D squared distance to Pepper); out of radius or PEPPER_CONTROL & 0x1d == 0 -> wait.
Key mask set and pressed: PEPPER_CONTROL = 0x100, arm, fire. No mask: in a vehicle (pc & 8) with DAT_009da9f8 hi word != -1 wait (port:
`ctx.shared.vehicleState`, default -1); arm; when not on foot (pc & 0x11 == 0) OR 0x1000 into PEPPER_CONTROL (asks the mode node to put Pepper down)
and fire in a later frame once pc & 0x11 != 0, (pc & 0x401) != 0x401 and Pepper's clip != 0x1c. Fire: PEPPER_CONTROL &= ~0x1000, start the slot, walk-to, -20.
NOTE: the brief's "clears INTERACT_ICONS" is wrong: the trigger only ORs icon bits; the var is cleared elsewhere every frame.

Real blocks (story node: record, waypoints, effect): 2 PIZB (none) slot 0 -> var 0x115 = 0x10 (S277, node 2 complete); 4 PHSE wp 0xef r 3 -> slot 0x25,
var 0x12f = 1; 5 PIZB 7 waypoints r 2 walk-to -> slot 0x26, var 0x115 = 1; 6 JAIL wp 0x9f/0x9a r 2.5 -> slot 0x27, BRICKSTER_ESCAPED (0x51) = 2, which opens
JAIL's second trigger (gate 0x51 == 2, no waypoint) -> slot 0x28, op 0x40, 0x51 = 1; 7.. INFC (gate 0x51 == 1 / node 0xb) slot 5 -> 0x115 = 0x100; 12 RESQ
slot 6 -> 0x115 = 0x200; era 2 SKTP (gate 0x54 & 2 == 0) slot 0 -> 0x54 |= 2, POLB node 31; era 3 HSE2 (0x54 & 4), TOWE nodes 0x3a / 0x3d (icon 0x20),
PIZB 0x35, POLB 0x39, RADI 0x37; era 4 = era 0's blocks.

### Box portal: ctor FUN_0051ea3c, update FUN_0051e5ab (vtable 0x8ea088)

Block: +0 / 4 / 8 half extents (node +0x14..), +0xc var / +0x10 value ORed while inside (ANDNOT when out of range), +0x14 s16 table row (0 = the focus
record; n = row n-1 of FUN_0051e475's table 0x5d58688, read from the emulated memory: row 0 SPBT / JSKI / DNGY, row 1 PHEL / RHEL / PTER in era 0),
+0x18 s16 zone for var 5, +0x1a face the camera, +0x1b spin 0.0087266 / tick about x, +0x1c key mask, +0x20 icon bits. Proximity radius^2 =
|half|^2 + 16 against the controller's (or the table vehicle's) XZ distance to the focus; it reacts only while that distance decreases (key mask 0), after 30
ticks of its own age (which counts only while its gate is open), with a 3D box test. Firing: var 0xbb = table index, PEPPER_CONTROL = 0x100 with a key
mask, var |= value, var 5 = zone. Portals: PORS (sea, row 0) -> 6, PORA (sky, row 1, gate node 0x20, ORs 0x119 |= 2) -> 10, WORM (era 4, gate var 0xd & 1,
Pepper) -> 0x22. The era 3 attaches on HSE3 / CTRL / PLAT / SHTL / SHP1 have an all-zero box: inert. `showPortalVehicle` = FUN_0051e4b0 (the arrival code's).
`src/zones/z50LTC/portal.ts` is an earlier port of the same node without the table; it could import this one.

## building.c

### Mesh parts (FUN_0043ea40 / FUN_0043ea60), `parts.ts`

The record's render instance holds one 4x4 matrix per MATL entry of its mesh; nodes rotate them in place (FUN_0043a4a1 = rotation from Euler angles,
no scale, translation kept). The port creates a live copy per (record, MATL index) on demand from the LOD-0 mesh (`ctx.scene` + archive). All LODs of the
island buildings have the same MATL count. **Renderer contract**: `partOverrides(w, rec)` (MATL index -> matrix) replaces `groupMatrices(msh)[g]` for the
groups with that gtom index (render.ts / renderer.ts are the lead's: not edited).

### Door: ctor FUN_00535e80, update FUN_0053594e

Block: +0 rate (node +0x2c = -arg), +4 MATL index, +8 angle (open = closed - arg; closed = atan2(m[8], m[10]) of the part), +0xc flags (1 = stays open;
0x100 / 0x200: the door point is -/+1.22 x the part's right axis from its pivot, 0x400 / 0x800 forward axis), +0x10 exit zone (-1 = ordinary door).
Radius 6 (12 for exit doors) squared; second radius (|point| + r)^2. Constants written by the ctor: push radius^2 16 (DAT_05d586b0), exit radius^2
f32(0x408a71de) = 4.33 (DAT_05d586ac). States 0 closed -> 1 opening (rate / tick, clamp FUN_005358fc) -> 2 open -> 3 closing. Runs only with no cutscene,
the record visible, and (state != 0, or an exit door, or action button (0x40) pressed while pc & 5); ignores Pepper more than 4 units above / below.
Exit doors open by themselves, show icon 0x20 within the radius and write var 5 = exit at the threshold while walking / skating (PHSE -> 3, INFC -> 4
(era 1 node 9: 5), SKTP -> 1). Ordinary doors open / close with the action button and push Pepper away (0.1 / tick) while swinging.

### Swinging part: ctor FUN_005364a5, update FUN_00536256

Block: +0 rate (-arg), +4 MATL index, +8 far angle (-arg), +0xc start angle (-arg, 1e38 = spin for ever), +0x10 axis flags (0x20 y, 0x40 z, else x);
2 pi wrap of the far angle by the rate's sign. Oscillates 0 -> 1 -> 2 -> 3 -> 0. RESQ, RADI, POLB x2, INFC, HOSP x2, SKTP, GRGE.

### Pages PAG1-4: ctor FUN_00535281, update FUN_00534d98

Gate = the attach's var (0x26 PAGES_SET) with mask 0 / value 0; the attach's mask / value (1, 2, 4, 8 / 0) are the page's bit. Spins 0.1 / tick; pickup
within 4 (controller XZ distance^2, then 3D with a +-2.5 dead zone in y) while pc & 5: NUM_PAGES (0xa5) + 1, hidden, sound 0x2f0 (DAT_009da96c, FUN_004b0f16),
15 ticks later the cutscene slot table[PAGECOUNTER] (FUN_00534d71's table 0x5d586c4 = slots 1..4 = LGIBR01..04 at node 7), PAGECOUNTER + 1, next frame
PAGES_SET |= bit. Return 1 (stop the chain) on the timer / pickup / spin paths. Constructor: a page already collected hides itself and reveals the first
hidden building of FUN_00534d4a's table (0x5d586b4: RESQ, HSE1, PHSE, INFC) and its props; the era 1 set-up resets PAGES_SET to 0 right before it
attaches the pages, so the shipped game does not reach this branch (the rebuilt buildings come back with the story nodes' set-ups). TWINKLE01/02
particles not ported (no `ctx.particles` call yet: the emitters belong to the page).

### Props: FUN_00533d30

RESQ -> SPBT; POLB -> PCAR, PHEL, JAIL, FECL x3; TOWE -> CTRL, PLAT, SHTL; HOSP -> AMBU; PIZB -> PIZC; GRGE -> GAR1, GAR2 (`BUILDING_PROPS`, `syncProps`).
Called by the page constructor and by the dead 0x534b89 node only.

### Music house HSE2: ctor FUN_005357cb, update FUN_00535485, draw FUN_00535550

Visible: 3D music loop 0x8b at the house every tick (DAT_05d5810c), phase += 0.4; the draw hook bounces it (rz + 0.025 sin, squash 0.9375 + 0.0625 |sin|,
y + 0.25 |sin|) and restores the matrix after drawing. Port: applied in the pre-render hook, restored at the next update. notes01.par not ported.

### Dead: FUN_00534b89 (vtable 0x8eac08, "pop in" scale / spin of GRGE, SKTP, HSE2, SHP2, PIZB in eras 2-3)

Its constructor writes the gate var 1, mask 0, value 1: (0 & 0) == 1 never holds and nothing re-gates it. Not ported.

### Building phases / model swaps

Nothing in building.c (nor StartCSM / LGI_FSM) changes `rec.variant` or a record's model at run time. The variant word (+0x64 = set << 8 | 1 | variant << 16)
and the model / collision / texture swap come from the decor tables (FUN_00421bbe at zone load, FUN_00421eb3 to save; 0x8acdc0 / 0x8acdf0 / 0x8acb98):
island group 0 = 147 entries of set 0 (23 decor models, pointers filled at run time) + 29 of set 1 (64 minifig outfits). That is the zone loader's / save
game's business (WP8), so no `setBuildingPhase` helper: the house construction phases (HOUSECONTRUCTIONPHASE 0xad, slot 0x1a + phase = LGIPH01..) are
the brick pickup's (FUN_00425c13, Common) and the set-up's record flags.

## LGI_FSM: ctor FUN_004b8c73, update FUN_004b7c78

The island's switch processor (one attach per era on PIZ4 / GETO, gate forced to var 2 & 1). Every tick: the sound switch table 0x8d9460 (33 x {var, sound
slot, record}; 1 = play at the record then 2, 4 = keep playing, 8 = stop then 2; slots = FUN_004b037e's 41 3D sounds, transcribed ids `LGI_SOUNDS`);
0x131 rotors (PHEL part 3, record 157 part 2, value / 10 rad per tick); 0x106 the info centre's doors (INFC parts 1 / 2: +-1 starts with sound 0x33e, swings
0.1 / tick past 1.8 rad (the doubles at 0x892570 / 0x892560 are 1.7999999523 / 0.0500000007: they decide the tick counts), bounces back at half speed,
-> 3 -> 0 at rest); 0x11f & 1 hides record 78 when its timer ran out; 0x110 = 1 sound 0x33d at record 11; record 371 scales in over 30 ticks on var 0x128
(era 0) / 0xd (era 4: ends with 0xd = 5, which opens WORM); 0x109 / 0xff particle switches (vars only, + sound 0x354); 0x129 makes records 12 / 13 / 17 / 18
non-solid (1) / solid (2); 0x134 the jail door (JAIL part 1, 0.1 / tick to 1.8). Not ported: particles, FUN_00444550, switch 0xfe (dead test).

## hOLO: ctor FUN_0088df51, update FUN_0088d41f, pre-render FUN_0088d666, activation FUN_0088d2cb

HOLO record (hidden: ctor arg 0). Hold the action button 20 ticks (not on the skateboard, no cutscene, `shared.holoActive` 0), or the story's alert timer
(`ctx.objective.holoTimer`, set to 90 by FUN_0088d2bc; decremented here) runs out: var 0xc6 = 1, `shared.holoActive` = 1, `cameraHold(true)`, clip 0x82; it
stands at Pepper + 4 x (-view right) + 2 x view forward, rises while it scales in (0.1 / frame to 0.75), faces the objective (`ctx.objective.target`, clip 0x81)
or Pepper, speaks `HOLO<letter>` of `ctx.text.hol` (letters A, B, ... wrapping to A when the id is missing; queued while another line plays). Shift,
a cutscene or 210 ticks scale it out; then the record is restored / hidden, var 0xc6 = 0. Approximated: the shimmer (state 3, a scaled extra draw) is not
drawn, the blink (state 4) uses RF_NO_DRAW for 3 frames; random(10) via Math.random.

## Context / mock changes

* `IslandCtx.scene?` (the zone scene: mesh paths for the MATL parts). Mock: `scene` set; `waypoints.load(archive)` in `loadIsland` (the zone game must load
  the island's waypoint maps: FUN_004630c0; the triggers read PATH node positions).
* `ctx.shared` keys: `vehicleState` (DAT_009da9f8 hi word, WP6), `holoActive` (DAT_009da844).

## Differential test (WP-VERIFY)

> Status after WP-ISLAND-FIX: every KNOWN DEVIATION named in this section is fixed in the port and the test runs at tolerance 0 without the filters (`docs/re/gaps.md`, "Deviations FIXED by WP-ISLAND-FIX"); the sentences below describe the state when the deviation was found.

All run the original's constructors (`FUN_00423532` attach with the set-up's own argument blocks, in the five eras' set-ups) and update / pre-render / draw hooks natively in the x86 emulation (`IslEmu`, FPU at 24 bit,
`tools/lib/m7-isl-veh-trig.mjs`) next to the port's nodes in the same world, Pepper scripted (position, `PEPPER_CONTROL`, vehicle kind, buttons, clip, cutscene), dt 1 and 0.5 (second `*-half` file each).
* `m7-isl-veh-trig` / `-trig-half` (StartCSM trigger + box portal; 1.6 M + 2.4 M checks, 40 triggers + 28 portals over the eras, ~420 scenarios): constructor blocks (radius^2, icon radius, key mask, slot, op ...), per tick
  all variables, cutscene starts (slot), walker pins (node), the node fields (slot -20 / -30, armed, nearest, portal distance memory, age), the portal records' matrix / Euler / flags (spin, face the camera).
  Synthetic variants (key mask 0x40, icon 0 -> 2) cover the key branches no shipped trigger has. A 2 % radius change in the port is detected. **No deviation found.** Finding: gates on var 1 (`HSE1` / `HSE3` / `CTRL` /
  `PLAT` / `SHTL` / `SHP1` portals: `v1/1/1`) never open: var 1 is read-only 0, in the original as in the port (inert).
* `m7-isl-veh-bldg` / `-bldg-half` (door, swinging part, page, music house; 6.6 M + 7.9 M checks, 51 doors (19 exit), 25 swings, 6 pages, 2 houses): constructor results (door radii / door point / closed + open angle,
  swing rate / angles), per tick door state / angle, the live part matrices (`FUN_0043ea60` buffers vs `partMatrix`), all record flags, Pepper's record (door push), variables (`0xc` icons, exit var 5, pages 0xa5 / 0xc4 / 0x26),
  sounds / emitter calls, cutscene starts (page cutscene slot), the music house's bounced matrix at draw time (9,210 draws). Exact. Two kinds of tick are float-noise threshold grazes and are re-synced (first tick only,
  see `Duel.grazeEnd`): a door test whose squared distance sits within float noise of a radius, and the door push that repeats until Pepper's distance passes sqrt(16) (one 0.1 step more or less). 0 - 1 per session.
  The swinging parts' angle (float32 accumulation over hundreds of ticks vs the port's doubles) is copied into the port before each tick (the per-tick step is compared strictly).
  The dead `0x534b89` node is attached natively in the original too (5 attaches): its constructor changes no compared state.
* `m7-isl-veh-fsm` / `-fsm-half` (LGI_FSM director; 8.0 M + 16.3 M checks, 10 + 20 k ticks): random switch values per tick in the ranges the scripts use (33 sound cues, rotors, INFC windows, PIZ3 timer, rocket pairs, WORM scale,
  Bill's hands, twinkle, collision, jail door), all variables, sub-object matrices (INFC 1 / 2, JAIL 1, 165 / 3, 157 / 2), WORM, every record's flags, the node block, sounds with positions, emitter gate / matrix calls (the
  emitter handles of the era functions created in the original's memory by name). Exact; **excluded**: switch 0xfe (FUN_00447ef0 needs the brick library) and the bone-matrix contents of the emitters (pose stand-in).
  Original quirk not reproduced by the port and never triggered by the data: an emitter handle global the era's set-up did not create (e.g. rocket slots 2..5 in era 0) is 0 in the original, and handle 0 is a valid
  engine handle (`FUN_0044ea60`: 0 < 0x95): such a switch would gate the engine's first emitter; the port ignores it (FX_NONE).
* `m7-isl-veh-holo` (hOLO; 2.0 M checks, 8 sessions x 3,900 ticks incl. dt 0.5, 104 activations): the lihol N.str table is the shared input of the original's hosted `FUN_00439bf8` lookup and the port; random streams are
  consumed in lockstep (checked every tick). Compared: node block, record matrix / Euler / flags (the blink's frustum bit vs `RF_NO_DRAW`), var 0xc6, DAT_009da844, speech calls, camera-hold calls. **KNOWN DEVIATIONS**:
  (1) `holo-flicker-rate-pepper-motion`: `FUN_0088d666` (0x88d7ee..) decides the flicker rate L (0.3 or 0.5) from the squared distance between Pepper and the hologram's target position (Pepper + 4 x -right + 2 x
  forward of the camera: about 20 units^2, so L = 0.5 always in play); the port compares Pepper's movement since the previous frame (`prevPep`), i.e. L = 0.3 whenever Pepper stands still. Evidence: t163, original
  d2 20.000 -> 0.5, port d2 0.00000 -> 0.3 (5,302 ticks over the test). The test forces the port's `prevPep` so both take the original's branch. (2) `holo-say-while-speech-off`: with var 9 (speech) == 0 the original
  makes no `FUN_00435a11` voice call (0x88db12: it only copies the text and shows the subtitle when var 0 != 0); the port calls `ctx.say(table, id)` (41 times): the shell's `sayFrom` must skip the voice itself
  (UNCERTAIN: not checked here). Not covered: the speech-queue path (`queued`: the hint is delayed while another line plays) never occurred in the scripts.

## Status 2026-10-31 (WP-ISLAND-CLOSE: the statements of this document that are out of date)

* The emitters listed as "not ported" are wired: TWINKLE01 / 02 (pages, `building.ts`), notes01.par (music house), the LGI_FSM particle switches 0x109 / 0xff incl. twinkle03 (`lgifsm.ts`); switch 0xfe (finish brick effect n, FUN_00447ef0) and `FUN_00444550` (render mode 2 of record 370 via `ctx.partMode`) are ported; the hologram shimmer (state 3) is ported (gaps S6); hOLO and the pages draw from the shared generator (no `Math.random`).
* FUN_00534b89 (the dead pop-in node) stays unreachable: its gate var 1 & 0 == 1 never holds. The port carries it as `PopInNode` (state, save block, update / pre-render, `m8-save-popin`); its draw hook FUN_00534918 for a node with a speed variable >= 2 is not ported because no attach of the game gives such a node (argument +0xc = -1 everywhere): unreachable, not a deviation.
