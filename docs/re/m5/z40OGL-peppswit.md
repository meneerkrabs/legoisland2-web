# z40OGL PeppSwit.c: the seven constructors of Ogel's island (worker ogl-peppswit)

Source file `Common\Z40OGL\c_src\PeppSwit.c` of the debug build; hub z40OGL (story nodes 64 and 66, zone table index 27 / var 0x59 = 0x1b, hub number 5). 22 attaches, ~1850 decompile lines.
The nodes are lazy: the framework gives a factory only the attach, so each node does its constructor's world work (anim start, home position, decor set-up) in its first update; the original runs it at the set-up, before tick 1.
All code: `src/zones/z40OGL/peppswit/`; registered by `index.ts` (the import line is in `src/zones/z40OGL/index.ts`).

## 1. What they are

| ctor | file | attaches | node kind | handlers (VA) | what it does |
|---|---|---|---|---|---|
| 0x7e4f9c PEPPSWIT | `pepper.ts` | 1 (PEPP, pos 0, gate var 0x5e & 0) | `PeppSwit` | update 0x7e489b, pre-render 0x7e4b12, destroy 0x7e504c, draw 0x7e4e36 (default draw, returns 1), load 0x7e4f1a, save 0x7e4e72 | Pepper's mode switch (below), lamp blink (FUN_007e42b0), ambience / random one-liners / 3D emitters, the decor / look machinery of hub 5 |
| 0x7e539e | `pepper.ts` | 1 (PEPP, pos 3, gate 0x5e & 0x20) | `PeppVoid` | update 0x7e5138, pre-render 0x7e52ea, destroy 0x7e5418, draw 0x7e5304, load 0x7e5365, save 0x7e5340 | the void fall |
| 0x7e5ea7 | `slug.ts` | 8 (SLG0..SLG7) | `PeppSlug` | update 0x7e5448, pre-render 0x7e5df3, destroy 0x7e5f75, draw 0x7e5e0d, load 0x7e5e6e, save 0x7e5e49 | the crawling, biting slugs |
| 0x7e61e9 | `robot.ts` | 5 (RBT0..RBT4) | `PeppRobot` | update 0x7e5fb4, pre-render 0x7e6135, destroy 0x7e6276, draw 0x7e614f, load 0x7e61b0, save 0x7e618b | robots idling / turning to Pepper |
| 0x7e6498 | `star.ts` | 1 (STAR = record 0, gate var 2 & 1) | `PeppStar` | update 0x7e62a6, pre-render 0x7e62c0, destroy 0x7e6512, **draw 0x7e62da**, load 0x7e645f, save 0x7e643a | the star sky dome (draw hook only) |
| 0x7e69a2 | `citizen.ts` | 5 (CIT1..CIT5, pos 1 after the SGMFIG that owns the walker; node 64 only) | `PeppCitizen` | update 0x7e6542, pre-render 0x7e68ee, destroy 0x7e6ac6, draw 0x7e6908, load 0x7e6969, save 0x7e6944 | patrol on the PATH map with ground following, falling back onto the route |
| 0x7e6bb2 | `holo.ts` | 1 (HOLO = record 5, gate var 2 & 1) | `PeppHolo` | update 0x7e6b05, destroy 0x7e6c29 | a variable watcher; its table (0x94c820) is EMPTY in this build (first entry -1): a no-op |

Pepper's chain (FUN_007e3bd1): `PEPPSWIT@0 (always), SGwalk@1 (&1), skate@2 (&4), void@3 (&0x20)`. Vtable layout of the 6-entry class tables: update, pre-render, destroy, draw, load (buffer -> node), save (node -> buffer);
`saveBlob` / `loadBlob` of every node are the serializers (16 / 12 / 16 / 1 / 12 / 1 bytes), ready for the save package (the game saves them in the entity section).
Draw handlers that are `FUN_00444480 + return 1` need no hook in the port (the renderer draws the record once); the return codes of the update handlers are read from the ASM (the decompile shows `void`):
the slug returns 0 during a cutscene and 1 otherwise, PEPPSWIT / HOLO 2, the others 1.

## 2. Findings

* **PEPPSWIT = the island's PepSwitc without swimming.** Below the sea level (`DAT_009da858` = -96, FUN_007e3bd1) Pepper is in the void: mode 0x20 (+ `DAT_05d58009 = 1`, the skate node's reset flag, + fall speed `y - last y`). Walking + Ctrl (not while mailbox 1 / 2 / 0x57 / 0x1f / 0x38, clips 99 / 0x62, or a
  vehicle is chosen) = skateboard (mode 4, clip 0x16, SKBD record 29 anim 1 + shown, sound 0x150); skateboard + Ctrl (not mailbox 0x20 / 0x32) = walking (clip 0x1c, board anim 2, the eight roll sounds stopped, 0x106); `DAT_009daa80 != 0` while walking = mode 8, clip 0x43.
  PEPPER_CONTROL bit 0x1000 survives every change. Enter = FUN_0081152d (the decor swap / look change of the nearest record), every tick FUN_008115c2.
* **The void**: PEPP is put at PATH node 0x3e + 160, falls at least 2 per tick (the global fall speed, saved), the camera keeps its offset; on landing PEPPER_CONTROL := 1, clip 0x1b, `camera.init`. Falling is only reachable where the walk node lets Pepper drop below the sea (it clamps to the sea level over ground-less terrain only while not airborne).
* **Lamps** (FUN_007e42b0, from PEPPSWIT's update): every 10 ticks the next of three phases switches render mode 2 / 0 on the 12 lamp records MKA1..MKD3 (123..134); story node 0x40 uses a 6-record variant. Uses `ctx.partMode` (HubContext got `partMode`).
* **Sounds**: the ambience (806) every tick, three 1-in-300 one-liners (807 / 808 / 809), 3D emitters on the point (20, 49, 101) and records 40 / 41 / 42, three random MNK sounds (14 / 13 / 12), and in node 66 the five citizens' voices. The sounds come from the zone's handle globals (0x5d5f3xx, read from the emulated set-up).
* **Slug**: three sweeps in turn (down 4 above / 8 long, ahead, behind; mask 2, radius 0.8) keep it on the surface; it crawls 0.08 per tick (not dt scaled), orients to the surface normal, heads home when > 40 away, chases Pepper within 16 of home, bites within 4 (mailbox 1, sounds 616 / 617, bite clip) and toggles every 120 ticks. Its timer is never initialised by the constructor: the debug CRT heap fills 0xCDCDCDCD, ported as such.
* **Citizen**: the constructor's argument block (row of the route table 0x94c7c8, clip, speed multiplier, sound token) is read from the emulated attach; the multiplied speed is stored but never used by the original. When `terrainHeight` is below the sea the citizen is put 40 above its next node and falls 0.8 per tick.
* **Star dome**: the draw hook scales the record (c, 0.8 c, c), centres it on the camera and draws it with the fog off; c = the far plane (integer part while the fog is on, `DAT_009dec3c = __ftol(far)`). Wired into `src/game/render.ts` (below).
* **Decor / roster (FUN_00811413)**: variant words of the 13 decor records (MAMA / PAPA outfits, the crystals G002..G010 and KKKK), the 18 template records 104..121 (PN00 .. TRBR) get render mode 1 and are hidden, the roster (0x9559d8) is empty. The swap itself is the island's `src/island/decor.ts` + `looks.ts` with hub 5's tables.
* **x87 precision**: the game runs the FPU in 24-bit mode (docs/re/rendering.md): every op of the decompile is a float32 op. Matrices use `eulerRotation` (util.ts, per-op rounding; `buildMatrix` differs in the last bit).

## 3. Verification

`tools/tests/m5-z40OGL-peppswit-emu.mjs` (9.4 M checks): the ORIGINAL's constructors and handlers + the node framework passes run in the x86 interpreter (24-bit mode) next to the port, tick by tick, same buttons / positions / random numbers
(harness `tools/lib/m5-ogl-emu.mjs`, built on `m7-isl-veh-emu.mjs`; the memory is seeded with the emulated set-up). Compared every tick: records (bit for bit), flags, variables, mailbox, camera, `ran` masks of the controllers, animation clip / frame, node fields, sound / render-mode calls (ids and order exact), random draw counts.
Scenarios: PEPPSWIT + void with randomised variables / mailbox / clips / heights / vehicle / Ctrl / Enter (all four modes reached, both nodes), 8 slugs with Pepper moved next to them and cutscene toggles (states 0 / 1 / 2), robots (clips 1 / 3), citizens with the original's SGMFIG beneath (walking and falling), HOLO / STAR (draw hook against FUN_0042271b for fog on / off), the constructor's decor set-up and an Enter swap next to MAMA.
Bugs the oracle found and fixed: heap CD fill, return codes read from the ASM, the 8-sound roll stop list, the exact float op order of the slug orientation, the Euler matrix rounding.
`tools/tests/m5-z40OGL-peppswit.mjs` (41 checks): registration, attach counts, chain, constructor effects, skateboard on / off, void, slug bite, blobs. Bot `tools/steps/m5-z40OGL-peppswit.mjs` (headless, real keys): see progress.md.

## 4. Particle emitters

None: no code of PeppSwit.c starts an emitter / `.par` / `.swl`.

## 5. Shared-file edits (all additive)

* `src/island/vehicles/common.ts`: `VehicleGlobals.skateReset` (DAT_05d58009). `src/island/vehicles/skate.ts`: the start block clears t / y0 / jumpY / v0 / vy and the flag (FUN_00490e2e, as the original; also set by the glider in the original, not by the port's glider).
* `src/game/render.ts`: the `PeppStar` node places the record each frame (`place`) and the mesh is drawn with the fog off (3 small blocks in the record loop).
* `src/hub/ctx.ts`: `partMode` was added by the ogl worker already (used for the lamps).

## 6. Not exact / open

* The sky dome is drawn with the fog off but WITH the depth test (the original also switches it off: it draws first, so the effect only differs for geometry beyond the far plane): render-side (WP-RENDER's `GameRenderer`), listed in docs/re/rendering.md.
* Sound handles: the original has one handle per slug / citizen (own instances of the same sound id); `AudioHost` picks the playing or first idle slot per id: audible only as overlap of the same sound (the audio package's `AudioHost` semantics, audio.md).
* `DAT_05d5f3c0` / the lamp globals (`_DAT_05d5f3c4` / `c8`) / `DAT_009da9a8` are process state like the original's BSS: a second visit of the island starts with what the first left (`PROC` in `peppswit/globals.ts`, `resetOglProcessGlobals` for the test loaders; fixed 2026-10-31, they used to restart at 0 per visit).
* Debug draws (`FUN_00445ba0` / `FUN_00445c70`: sweep lines and points) are only active in the original's debug view and not ported.

## WP-TIME (2026-10-30)

* dt audit: every timer of the zone is a dt-scaled float32 (`lampTimer`, the slug's `timer`, the animation advances `rate * dt`, the walker step) or a per-update quantity the original also does not scale (the slug's crawl 0.08, the falling citizen's 0.8, the krystal's 3-tick pick-up counter); STAR's draw hook is a pure placement at the camera (no state: once per rAF call is the same as once per frame); the HUD's blink counter (`1 * dt`, FUN_007e2ad0) runs in `everyTick` = once per sim step in every mode.
* RNG: `rand` / `randInt` are the shared CRT generator through `src/island/rng.ts` (no `Math.random` anywhere in the zone); the oracle runs FUN_004388ae natively (float32) on the scripted rand() FUN_0085daf0 (`m5-ogl-emu.mjs`).
* `m5-z40OGL-peppswit-emu` now runs every section (PEPPSWIT + void in both story nodes, slugs, robots, citizens, HOLO / STAR, decor) at dt = 1 and dt = 0.5, bit for bit (18.7 M checks, tolerance 0).
