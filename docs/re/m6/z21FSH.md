# z21FSH "Fishing" (Adventure Island, story nodes 42-44), M6 port

Archive `z21FSH`, zone table index 17, music `Z21FSH` (+ ambience `Fishing`, shark theme `Z21Jaws` during the fight), strings `AI/Data/fsh.str`, HUD `Overlays/Z21FSH`.
Pepper walks to one of eight fishing spots (Shift), aims (left / right), casts (Ctrl, power meter 10..60), waits for a bite, strikes (Up), reels (Down, tension 10..60) and lands fish
(weight x 78 points). Catching Big Bertha (19 kg) ends the game (win, medal by score: bronze < 4000, silver < 7000, gold); running out of the 20 casts loses.

## Files
| file | what |
|---|---|
| `src/zones/z21fsh/rules.ts` | constants (EXE addresses in comments), `Fish` + `fishStep` (FUN_007061ee), `pickBite` (FUN_00705e00), `Follower` (FUN_006f5b50), `Popups` (FUN_006f48c9 / 49b3) |
| `src/zones/z21fsh/nodes.ts` | the nodes: FSwitch 0x6f51e6/6f4bfa, Fishing 0x6f8e5a/6f6e2b (+ bobber 6f665b, camera 6f6d71), Bertha 0x6f56d0/6f54c0, Shoal 0x6f6034/6f5dac, Splash 0x6f5aa1, rod 0x6f9cdc/6f94d4, Fisherman 0x6f937d/6f9090; `prepareFsh` binds them after set-up |
| `src/zones/z21FSH.ts` | zone game: cutscenes ADV04 / ADV11, HUD, popups, score panel, sounds, music switch, fishing line, argument blocks of the fisherman's generic nodes |
| `tools/tests/m6-z21FSH.mjs` | node tests (199 checks) |
| `tools/steps/m6-z21FSH.mjs`, `-loss.mjs` | headless browser runs |

## Findings
* Result flow: play goes straight to the result menu (no mode-4 banner): `LoopConfig.skipBanner`. The score panel is the machine's state 13.
* The fishing cutscene start at node 42 sets S252 = 1 (completes node 42); the in-zone COMPLETE_SUB_GAME completes node 43, and Continue advances once more (generic `miniGameExit`), so the story lands at node 45 (oasis).
* The fisherman's route table (0x92f720) maps spots 6 / 7 to the way-points of POL6 / POL7 while the spot records are POL8 / POL9: an original quirk, ported as is.
* The last cast (casts == 0) forces the nearest fish to the bait in 50 steps; bites last 30 ticks (60 when forced).
* The symbolic set-up gives no argument block for the fisherman's SGMFIG / Turn2PepA: written in `fishermanArgs` from FUN_006f3eec.

## Approximations / open
* No particle runtime: the splash emitter is not drawn (the ripple ring SPLH is). The generic NPC conversation needs the island context (no speech lines for the fisherman).
* S252 == 2 (node 44): settled by WP-VERIFY, there is no writer in the zone code (the Fishing node writes var 0xfb / 0xfc only; no store to story var 252 other than the cutscene start = 1).
* Hint system (`fshhol.str`, HOLOA) not ported; FUN_0085eb80 in the rod hook is the CRT `printf` called with an empty format (the buffer DAT_05d5cbc4 is never written): 2440 calls in the oracle, 0 non-empty, so skipping it is exact; camera variants for DAT_00987660 != 0 unused.
* The Fisherman node (FUN_006f9090, walker engine), the zone loop modes of FUN_006f3511, the HUD hook FUN_00705c64 and the draw timing of the popups in `z21FSH.ts` (the original draws at update time the slots visible at the start of the tick; the port's draw2d uses the post-tick set, one tick later) are not covered by the differential test.

## Shared-file edits
`src/zones/index.ts` (import), `src/shell/loopmachine.ts` (`skipBanner`), `src/render/renderer.ts` (`drawLine`).

## Runs
`node tools/test-formats.mjs --only m6-z21FSH`; `node tools/browse.mjs "http://localhost:5602/?zone=z21FSH&mute=1" tools/steps/m6-z21FSH.mjs --size 1024x768 --out /tmp/m6-z21FSH` (win, ~4 min);
`...?zone=z21FSH&node=43&mute=1 ... m6-z21FSH-loss.mjs` (pause, loss, retry, abort). Shortcuts: fish / Bertha moved to the bobber, casts set to 1 in the loss run.

## Differential test (WP-VERIFY)
`tools/tests/m7-z21FSH-emu.mjs` (+ `tools/lib/m7-z21FSH-emu.mjs`) runs the original node code of FUN_006f6e2b (Fishing node, shoal, Bertha, rod, fish update FUN_007061ee, popups) natively in the x86 emulator beside the port, in controller-chain order with the original's return codes, with the engine calls hosted (game vars, anims, sounds, text, rand fed from the port's rng, the three matrix builders native).
* Constructors: the original's constructors against the port's bind (344 fields the original leaves uninitialised are skipped).
* Per tick, strict float32 equality: nodes that ran, the 0x68-byte records, Fishing/shoal/Bertha/rod fields, 32 popup slots, globals, story vars, anims, the call log (sounds, texts), rand-call count, part matrices, line and rod draws, popup texts.
* 12 seeded games (9 at dt 1, 3 at dt 0.5, an angler driver with bait attraction): 16k ticks, 45.4M checks, 0 mismatches, about 22 s. Every state 0..14, Bertha landed, forced approach, snaps, popups and result 1 are visited.
* Found and fixed in the port: constructor draw order and the extra rand(20); `rec.ry` untouched by the node; Bertha draw offset; splash flag one tick early; rod hook drew Pepper's record instead of the rod's; state 10 advances Pepper's anim twice and keeps the WRIGGLE sound; FSwitch (FUN_006f4b65) allows var 2 only with state < 7 (or var 1); catch popup text overflows its 12-byte buffer ("13kg = 1014p\n"); many float32 store sites (K constants are float32 now).
* Not checked: the exact constants against .rdata, and the spots-table slice (FUN_006f3eec loop) separately; both are covered indirectly by the per-tick comparison.

## WP-PART-WIRE / WP-MINI (2026-10-29)
* **x87 precision**: Direct3D 7 leaves the FPU in 24-bit mode (docs/re/engine-m1.md 8.1). The collision code of the port is exact in that mode, so the old oracle (53 bit) showed 41 PEPP-matrix mismatches (`Fishing.py`, the ground ray). The oracle now runs at `cw = 0x7f` (`FSH_CW=0x27f` for the old mode) and the zone code rounds every operation (`rules.ts`, `nodes.ts`, `src/zones/common/x87.ts` `euler24` / `normalize24` / `cross24`, `render/math.ts` `mulGame` / `transformPointGame`). `m7-z21FSH-emu`: 45.4M checks, 0 mismatches. Also fixed: `FUN_004388ae` = float(float(r / 32767) * max), sqrt of `FUN_0043cf57` rounded, sum orders (x, y, z) of the bite metric / distances, the stale `K.TWO_PI`.
* **Emitter**: `splash01.par` started in the Fishing constructor (FUN_006f8e5a @ 0x6f8ec7): parent = LAND record matrix (record 4), offset 0, rotation (-pi/2, 0, 0), gate off. Landing (state 7 sub 3, 0x6f7b45 / 0x6f7b60): `setMatrix(DAT_05d5caf0 = (identity, bx, ty, bz))` + on; reeling (0x6f7f78): off. `fx.finish()` after it. Screenshot `tools/steps/wa-z21FSH-splash.mjs`.
* **Fisherman speech**: `src/zones/z21fsh/ctx.ts` installs a reduced IslandCtx (table = fsh.str, speech, cutscene override, objective); FSHMA is spoken (`tools/steps/wa-z21FSH-talk.mjs`). `fshhol.str` / HOLOA is only read by a hologram node (0x88d41f): the zone has none, so nothing to port.
* **Popups** are drawn from the slots visible at the start of the tick (FUN_006f49b3 draws before it counts down); the HUD score counter uses `FUN_004388ae(20)` exactly.
* `DAT_00987660` is the 16-bit display flag (never set at the default 32 bit): the camera variants are unreachable. S252 == 2: no writer (WP-VERIFY).
* **Second talk** (FSHMC): explained and verified (`tools/steps/wa-z21FSH-talk.mjs`: "Veel wijting vandaag." is spoken at the second Shift). The first Shift is also the FSwitch key (FUN_006f4bfa starts Pepper's walk to a spot while fb == 1) and the Fishing node then owns Pepper's matrix: after the first talk she walks off, the fisherman leaves the view and the range, `stateLogic` (FUN_00425902, runs in the pre-render only while the NPC is in view) stops and the line counter is reset once she is out of the talk radius. So FSHMC needs a later Shift next to the fisherman. Pointing the way needs an objective target (FUN_00424e37: the default is the nearest other talk NPC with ctor 0x426151; z21 has none, so `line` falls back to 0, as in the port's SGMFIG; the objective globals the island leaves behind are not known).
* **Pointing the way (FSHMC)**: settled. The objective globals (DAT_009da82c .. 830) are cleared when the island's talking NPCs are destroyed (FUN_0042651e, the SGMFIG destructor, calls FUN_004241df), so the zone starts with mode 0. FUN_00424e37 mode 0 scans for another record whose controller node has the SGMFIG vtable and a non-zero `talk50`; the zone has only the fisherman (excluded as the caller), so there is no target and `line` falls back to 0: exactly what the port does.

### Second differential pass (Fisherman node, HUD hook, loop modes)
* `m7-z21FSH-emu` now also runs the original **Fisherman node FUN_006f9090** (constructor FUN_006f937d) with the **waypoint walker of Common\WayPt run natively** (FUN_004630c0 / 004614d5 / 004626d0 / 00461c24 ... on the zone's W_PATH map; the walker is made like the generic node does: start -1, NPC speed / turn rate / radii, apply) and the **HUD hook FUN_006f514c -> FUN_00705c64** (the three sprintf texts, the counting score with FUN_004388ae(20), the gauge switch / marker / value, the icon column slot 0) next to the port, tolerance 0, dt 1 and 0.5, 12 games: 46.0M comparisons, 0 differences. Compared per tick: the Fisherman node (x y z yaw state route), its walker struct (all fields of the 0x84-byte table entry), record 7's matrix and clip, the HUD texts / gauge / column. Visited: fisherman states 1, 2, 4 and their transitions (walk to way-point 2, wait and face Pepper, walk to a spot's way-point), gauge markers 6 and 7, the score counting.
* The HUD hook moved from the zone game into `src/zones/z21fsh/nodes.ts` (`hudHook`, shared by the zone and the test). Deviations found by reading the hook / the loop and fixed: the hook runs only while 0 < state < 13 (the HUD keeps the last texts afterwards, the port hid it at state >= 13); the icon column's slot 0 gets texture DAT_05d5cbd0 + 8 = 8 (never written, so 8) but the column is not drawn in this zone (its enable flag DAT_05d4e13c is only set by the island / hub HUD set-ups): kept in `S.column0`, compared with the original, not drawn; mode 1 draws the HUD (icons, empty texts) while the opening cutscene runs (`else FUN_0046055f()`), mode 2 always, mode 5 not.
* **Loop modes FUN_006f3511** (not runnable natively: it is the shell's message loop): audited against `LoopConfig` / the zone game from the decompile. Mode 7 fade in (0.0625 dt per pass), 0 (result := 0), 1 (intro: cutscene tick + rod controller only, the ADSGFI14 brief at (320, 80) wrapped at 30, spoken once; a button -> mode 9 only when no cutscene runs), 9 (controls help, 4 lines), 2 (play: cutscene tick, update, probes, the line draw; result != 0 -> mode 5 directly, no banner = `skipBanner`), 5 (result menu: only the cutscene tick), 3 (pause), 8 fade out: all as the port. The only deviation was the HUD in mode 1.
* The dt 0.5 int counter (`ftol(counter + dt)` of the Fishing node, `+0xf4`, the bobbing sound's tick counter) is kept exactly: at dt 0.5 it never advances, like the original at 60 Hz (WP-TIME 2026-10-30; `m7-z21FSH-emu` runs dt 1 and 0.5 at tolerance 0). Random numbers: the shared CRT generator (`crtRng`: `rand() / 32767`); the cast sound (`% 5 < 3`) and the catch speech line (`% 7`) of `FUN_006f6e2b` are `ftol(FUN_004388ae((float)FUN_00435c91())) % n` over the real milliseconds since `FUN_006f3511` called `FUN_00435c81` (`randT`, `startTickClock()` in the zone game); every other draw is `ftol(FUN_004388ae(n))` (`randI`). The oracle pins both clocks to 5000 ms.
