# WP9: FX_Bricks (brick-built buildings, Pepper's house stages, Brikimals) and the merged island director

Code: `src/formats/bricks.ts` (data), `src/fx/bricks/` (`sim.ts` bricks + actions, `manager.ts` BrickFX_Manager, `island.ts` the island wiring,
`draw.ts` drawing), `src/island/trigger/lgifsm.ts` (the ONE LGI_FSM node, merged), small hooks: `src/game/render.ts` (`GameRenderer.effects`),
`src/zones/z02LGI/index.ts` (library + effects pass), `src/zones/z02LGI/ctx.ts` (`brickMorph`, `brickBurst`), `src/formats/emusetup.ts` (hosts of the
brick calls), `tools/lib/island-load.mjs` (`opts.bricks`). Tests: `m4-wp9-bricks` (+ `m4-wp4-*`, `m4-wp7-ambient` for the director), browser step
`tools/steps/m4-wp9-bricks.mjs` (node 3: deliver to PAPA, LGIPH01 builds the first house stage; screenshots show the bricks falling onto the plot).

## 1. Data (formats.md section 10, loaders ported)

* **Dictionaries** `FUN_00447f20`: colours (22: DKGREY 0, DKGREEN, RED, BLUE, BLACK 4, WHITE 5, GREEN, YELLOW 7, BUFF, BROWN, LTGREY 10, LTGREEN, ORANGE,
  DKBLUE, UNUSED14/15, TRANS_BLUE 0x10 .. TRANS_LIME 0x15), bricks (267 names with fixed values 0..0x10a; brickset.txt has 257 of them), groups (AUTO09..AUTO00 =
  0..9, PART00..PART19 = 10..29, others 255), centre modes (AUTO 0, BASEDON 1, VECTOR 2). Read from the code at run time (`brickDictionaries`).
* **Library** `FUN_0044a5e0`: `brickset.txt` `%s %i %i %i %f %f %f` (symmetry ints, pivot offset x,z * 0.8, y * 0.96), `bricks/lods/<name>_lod0..2.msh`
  (ordinary VERT meshes; `FUN_0044ddd0` flattens the GRPL groups into one absolute index list). A missing LOD takes another's mesh (switch on the mask:
  1 -> all lod0, 2 -> all lod1, 3 -> lod2 = lod1, 4 -> all lod2, 5 -> lod1 = lod2, 6 -> lod0 = lod1). Per LOD a "first colour" vertex count: vertex count
  minus 8..72 for 23 window / door / glass bricks (switch on index - 0x10), then 24 fixed counts written into the table (0x44a9cb..0x44aa8a, `TABLE_PATCHES`:
  all are first-colour counts of wheels, track, steering wheel, eye ...). The rest of a brick's vertices take its second colour.
* **Model** `FUN_0044d570`: 3 header lines read positionally, line 3 `%s %s [%f %f %f]`; then each line not starting with `//` is upper-cased and
  scanned with `%s %s %f %f %f %f %f %f %s %s`: 1 field + `NEWLAYER` = next layer, 9 / 10 fields = a brick (`FUN_0044e720`: unknown brick names are
  dropped; degrees * 0.0174533, rotation y + pi wrapped; colour names through the dictionary, -1 unknown / missing). Bricks are prepended (the list's
  head is the file's LAST brick; "tail" walks = file order). AUTO centre: min / max of x and z only (y keeps the first brick: a slip, house04 only, which
  loads 0 bricks anyway). The centre is ADDED to every brick. `FUN_0044dba0`: positions normalised to the bounds (max starts at 0), 1 / extent per axis
  and its squared length (+0x78; the morph pairing's ratio). All 96 files: 6155 bricks, every brick name has a brickset entry.
* Palette: the brick texture `Bricks/Text000.tga` (64 x 64, 8 x 8 cells) and the cell table at 0x981980 (u = 0.0625 + 0.125 c, v = 0.9375 - 0.125 r;
  colour -1 reads the 8 bytes before the table in the original: here the first colour is used).

## 2. The manager (BrickFX_Manager.c, 64 slots of 0x1730 bytes at DAT_05cb58cc)

Slot: +0x00 + 4 s visibility of stage s (0 hide the record, 1 show it, 2 leave it and keep drawing the bricks), +0x40 callbacks, +0x80 + 0x60 s the 24-word
parameter block, +0x680 file names, +0x16c0 model pointers, +0x1700 sound, +0x1704 record, +0x1708 state, +0x170c variable, +0x1710 used, +0x1712 + s
function id, +0x1722 running, +0x1723 model count, +0x1724 one-shot, +0x1725 swapped, +0x1726 started, +0x1727 current stage, +0x1728 time, +0x172c wait.

* `FUN_00449ec0` register (free slot or 0xbabababa), `FUN_0044a070` add a model (parent matrix = the record's matrix, all bricks hidden), `FUN_00449fe0`
  stage callback (state 0, copies the block, current stage = var % models), `FUN_0044a5a0` wait after the morph in seconds (used ONCE: never reset),
  `FUN_0044a5d0` (FUN_00447f00) is empty, `FUN_0044a350` replaces the parent matrix, `FUN_0044a300` state (2 = idle unless running or record flag 0x8000).
* **Update** `FUN_0044a180` per frame (var 10 SWITCH_NS_FX_PARTICLE_ONLYRENDER != 0: draw only): target = var % models. Target == current and no one-shot:
  draw only when the stage's visibility is 2. Otherwise: once, the TARGET stage's callback(slot, params[target], target); then `FUN_0044c300` (every
  brick's action list, minimum state; 3 while the wait +0x172c runs down 0.03333 per tick); at 2: the record is hidden / shown by the target's visibility,
  flags 0x4000 / 0x8000 cleared, current stage + 1 (one step, whatever the target: a jump of two stages plays two morphs), `FUN_0044c3f0` frees the lists of
  the new current stage and the next, the sound is stopped. Then the draw (`FUN_0044c2c0` -> `FUN_0044dae0`: visible bricks rebuilt, world = local . parent,
  LOD 0 / 1 / 2 by distance^2 to the camera < 1280 / < 7200). The draw's rebuild matters: the swap action clears the dirty flag and the next
  fly-home reads the matrix, so the port rebuilds in its per-tick draw pass too.
* `FUN_0044a3b0` (FUN_00447e90(rec, kind)) one-shot on every idle slot of the record: kind 6 = show the current model, 0xb / 0xc / 0xd / other = morph
  callbacks 11 / 12 / 13 / 10 with a fixed block (6.0, 6.4, spins 0.3 / 0.2 / 0.5, centre (0, -5, 0)); the update then also plays the target stage's callback.
* `FUN_00449b00` (FUN_00447ef0, switch 0xfe) runs `FUN_0044c300` with dt 1 until the slot is done (it tests the HEAD brick's list for every brick).

### Callbacks (FUN_00449f50; P = parameter words; delays in seconds, 0.0333333 per tick)

| id | function | what |
|---|---|---|
| 0 | FUN_0044c4c0 | bricks appear one by one (file order), step P0 / count (P1 if P0 <= 0) |
| 1 | FUN_0044c550 | bricks disappear one by one (list order) |
| 2 | LAB_0044c5e0 | this model's bricks disappear, then the next model's appear |
| 3, 6, 9, other | FUN_0044cd30 | show the model |
| 4 | LAB_0044cbe0 | from the top layer down (delay (layers - layer) * P0 / layers + rand), spin A (P2..10), accelerate by P11..13 until offset^2 > P14; sound DAT_05d582ec (0x34e) |
| 5 | LAB_0044cd60 | the same with spin B (P11..19) and acceleration P20..22, limit 40000 |
| 7 | LAB_0044ced0 | every brick starts P4 higher and falls home in file order (delay step .. P0), speed P2 + rand(P3) per tick; sound 0x350 / 0x351 / 0x353 / 0x352 in turn |
| 8 | LAB_0044d010 | bricks [P5, P6) (ints; P6 < 0 = to the end, written back) fall from P4 + 0.1, earlier ones stand, later ones hidden; sound DAT_05d58130 (0x34f) |
| 10 / 11 / 12 / 13 | FUN_0044c6c0 / c820 / c980 / cad0 | morph: pairing (`FUN_0044e410` PART groups nearest of the group / AUTO groups same brick + y rotation within 0.005, `e5a0` nearest of the group within the extent ratio, `e660` nearest of any group, `e6e0` back links), this model's bricks spin + fly out from the centre P20..22 (P0 per tick, P1 / P0 ticks, 0.01 s stagger; without a partner they vanish), the next model's take over the partner's place and spin, un-spin by symmetry, fly home at P0 (0.02 s stagger); 11 uses spin B, 12 no vanish, 13 no delays |

Actions (64-byte pool, prepended; type +0, state +4, brick +0x10, delay +0x14): 1 delay + visibility (waits for the next action unless partnered), 3 / 7
spin A / B rates towards targets (accelerations randomised), 4 / 8 un-spin (A stops at an angle its symmetry class makes look like 0: class 1 half turn, 2
quarter turn), 5 fly out, 6 fly home (one of four click sounds DAT_05d58200 / 1f4 / 1f8 / 1fc = 0x339 / 0x338 / 0x337 / 0x336 in turn when it snaps in),
9 swap with the partner (waits for the partner's head action; record flag 0x2000 pauses it; sets record flag 0x4000), 12 accelerate away (returns 2 once far
but keeps moving until the slot completes). 3, 7 and 9 do not count in the minimum. Brick rebuild `FUN_0044d330`: local = R(A) T(pivot) R(C) T(pos)
R(B) T(offset) (row vectors; A / B / C advance by their rates at every rebuild), "home" = the translation before R(B).

## 3. The island

* **Registrations** are made by the era sets the emulation runs: emusetup now hosts FUN_00447cc0 / 447d20 (returns the slot numbers in order) / 447da0 /
  447d70 (copies the 24 words: floats AND ints) / 447ed0; `applySetupRegistrations` replays them on the live manager (`setupSlots` maps the emulated slot
  numbers for switch 0xfe). Era 0 (FUN_004c0ce9): INFC, GRGE, HOSP, HSE2, HSE3, PIZB, RADI, SHP1, TOWE, PLAT, CTRL = test01.txt (stage 0: callback 7,
  show) / building (stage 1: callback 4 or 5, hide): the Brickster's escape makes them float away (BRICKFX_* = 1) and come back as one brick (2); PH01..PH10
  and PHSE (record 125) = peppershouse01.txt twice, stage 1 = callback 8 with the brick ranges 0..0x16, 0x16..0x2f, 0x2f..0x55, 0x55..0x6b, 0x6b..0x7c,
  0x7c..0x84, 0x84..0x9f, 0x9f..0xab, 0xab..0xb4, 0xb4..0xb7, 0xb7..end, show, wait 3 s. Era 1 (FUN_004c0471): RESQ, HSE1, PHSE, INFC; era 2
  (FUN_004bfec3): SKTP (wait 7), GRGE (5), HOSP (7), POLB; era 3 (FUN_004bf737): HSE2, SHP2, PIZB, RADI, HSE3, SHP1, TOWE, CTRL, PLAT: callback 7 from 100
  up (speed 1 + rand 0.25, 3 s of drops), show. Era 4 = era 0. No era registers SWITCH_LGI_BRICKFX_JAIL / SPACESHUTTLE / SKATEPARK(era 2 only) / HOUSE1
  (era 1 only): those switches do nothing outside their era, as in the original.
* The LGIPH01..11 scripts hide PHSE / PH01..PH10 and set `SWITCH_LGI_BRICKFX_PEPPERSHOUSEnn 1`: the stage's bricks fall in (22 for stage 1: ~150 ticks)
  and after the 3 s wait the stage's record is shown (node test: 242 ticks). The bricks are only drawn while the effect runs.
* **Brikimal** (WP7's `ctx.brickMorph`): register + 4 animal models, every stage callback 10 with the constructor's block (0.8, 8.0, spins, centre (0, -1, 0)),
  visibility 2, burst 6, parent = the node's matrix. As in the original the animal shown at rest is model (var + 1) % 4 (the morph explodes the TARGET model
  and builds the next one; the start burst plays callback 10 on stage 0 once).
* `ctx.brickBurst(rec, kind)` = FUN_00447e90 (WP5 cars, WP11 bots): only acts on records with a slot (none of the cars / bots register one in the port).
* Drawing: `GameRenderer.effects` (after the records, like FUN_00442930), one draw per brick of a cached mesh per (brick, LOD, colours) with the palette UVs,
  preset 5. The original batches all bricks into CPU-transformed ping-pong buffers (4096 vertices) and lights them with its specular variant (not in the
  WebGL shader).

## 3b. The vehicle roster FUN_0051c823

PepSwitc's constructor (FUN_004bbef8) calls it when the era set builds Pepper's chain (era 0: FUN_004c0ce9 then FUN_004c0750), so the vehicles' slots come
right after the era's building effects. Table 0x8e9b28 (0x18 bytes: record, ?, cycler handle, first clip, var, brick handle; ends with -1): AMBU 0xb1,
DNGY 0xd7, JSKI 0x34, SPBT 0xae, RHEL 0x46, PHEL 0xd2, SPD0 0x24, SPD1 0xd9, SPD2 0x4c, PCAR 0x99; per record a switch on index - 0xa3 adds the clip files
(speedboat07/00..06/09/08, dinghy10/00..09, phel03/00/07/04/01/02/06/05, speedster08/00..07, policecar07/00/02..06, ambulance06/00..05, jetski06/00..05,
resqhel05/00..04) with callbacks 10 / 11 alternating, block (2.0, 24.0, spins 0.3 / 0.5 / 0.2, centre (0, -3, 0)), visibility 1. The emulation runs the
function after the set-up (emusetup `vehicleRoster`: only its brick calls are kept; its record writes (+0x64 = 0 / 2, the 0x8e9c30 list hidden) and
render modes are dropped). A crashed car (WP5 speeder: flags |= 0xa010, `brickBurst(rec, 0xd)`) plays callback 13 on its current clip as a one-shot; at
the end the manager shows the record and clears 0x8000 (visibility 1): the car is back (node test: 46 ticks) and drives on.

## 4. The director (LGI_FSM, FUN_004b7c78): merged

WP4's `src/island/trigger/lgifsm.ts` is the only port (registered, 0x4b8c73); `src/island/ambient/director.ts` re-exports it under WP7's names. Taken from
WP7: the particle emitters (rocket01 / zzz / bill01 / twinkle03 through `ctx.particles`), the cue sound ids read from FUN_004b037e's code, record **370
(WORM)** for the scale-in / hide (decompile `+0x96b0` flags, `+0x965c` matrix = 370 * 0x68 + 0x60 / + 0xc; the constructor hides it too). Kept from WP4:
the double constants of the window swing (1.7999999523 / 0.0500000007), the wrapped jail angle of the constructor. New: switch **0xfe**
(SWITCH_LGI_CSM_FX_SWITCH03) = n with 0 < n < DAT_008d95f8 finishes building effect DAT_05d58304[n] (FUN_00447ef0) and clears the switch: it is NOT dead
(WP4 assumed DAT_008d95f8 = 1; the era sets count it up to 12). At the end of each update the node ticks the FX manager (`tickIslandBrickFx`).
WP4's tests now check record 370.

## 5. Not done / approximations

* Vehicles' Enter "change the look" (FUN_0051db5c -> FUN_00420404: a model-variant cycler FUN_00443b00 / 004439c0 writes var = part + 256 variant,
  record flags |= 0x8020 until FUN_00420590 sees the slot idle) is not ported: the cycler handles come from the decor code FUN_004202ef (WP6 territory).
* The specular term, the 4096-vertex batching and the debug LOD override (DAT_05d37024) of the drawing; save / load of the effects (FUN_00449a10 /
  FUN_00449be0, `FUN_00447c90` blob of the save game).
* Bricks whose second colour is missing use the first colour (the original reads garbage UVs before the palette table).
* Record flag 0x4000 (set while bricks swap) is kept but nothing reads it in the port.
