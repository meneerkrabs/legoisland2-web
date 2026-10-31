# M5 audit: the front end (zone table index 0, z00FRE, archive z60FRE)

Scope: everything of the front end that was still a stub or an approximation after M2/M3: the stage nodes (`FUN_00472743` / `004729f6` / `00472c45` / `00472fd8`, the butterflies
`FUN_004b2d44`), the stage set-up `FUN_00471070`, the loader's animation instances (`FUN_0047ec85`), the loop `FUN_00470ac3` (fades, exit), the credits scroll `FUN_00471c4c`.
Method: the original's code is run in the x86 interpreter (`src/formats/x86emu.ts`) next to the port and compared tick by tick (oracle tests), after reading the disassembly because the
decompile hides the x87 parts.

## Files

| file | what |
|---|---|
| `src/shell/fenodes.ts` | rewritten: `FePepperNode` (0x472743 / 0x4721f0), `FeFigureNode` (0x4729f6 / 0x4728e2), `FeTrainNode` (0x472c45 / 0x472adb), `FeBricksterNode` (0x472fd8 / 0x472d7d), `feTables(pe)` (gag table 0x8c9198 and outfit table 0x8c9150 are read from the executable), `rotateY` (0x43ad29) |
| `src/shell/frontend.ts` | the stage set-up as FUN_00471070 / FUN_0047ec85 (anims for records 0..21, nodes in the original's order, butterflies, focus, frustum flag), the exit fade, fade-in count |
| `src/shell/credits.ts` | `CreditsStage` (FUN_00471c4c's stage characters), the record copied to every wrapped part (FUN_00471802) |
| `tools/lib/fe-emu.mjs` | the oracle harness (the stage nodes, the butterfly node, FUN_00471c4c run natively from the user's executable; engine calls hosted) |
| `tools/tests/m5-audit-fe-emu.mjs` | 5.9 M comparisons: Pepper / figure / train / Brickster (5 seeds x 6000 ticks) and the seven butterflies (3 seeds x 4000 ticks) |
| `tools/tests/m5-audit-fe-credits.mjs` | 3.2 M comparisons: the credits' slots over whole scrolls (no input, Space presses, a key that ends it) |
| `tools/steps/m5-fe.mjs`, `tools/steps/m5-fe-credits.mjs` | headless bots, real key input (see "Bot runs") |
| `tools/tests/m5-audit-fe-particles.mjs` (WP-SHELL) | the train's smoke and the Brickster's emitter against the ORIGINAL particle engine (train 1100 frames on the node's matrix path, Brickster 5 junk matrices x 1500 frames: never a particle), 4.3 M comparisons |
| `tools/tests/m8-shell-loadcard.mjs`, `tools/lib/loadcard-emu.mjs` (WP-SHELL) | the loading card `FUN_0040d1be` / `FUN_0043ec80` in the interpreter against `src/ui/loadingcard.ts` (gaps.md U1) |
| `tools/steps/m8-fe-loading.mjs`, `m8-shell-fe.mjs`, `m8-shell-zone.mjs`, `m8-ltc-intro.mjs` (WP-SHELL) | headless looks: the card over the first fade-in and the train's smoke, the front end's menus / options with the offsets of `FUN_004201aa`, the global text offsets in a zone, z50LTC's mode 1 wait |

Shared-file edit: `src/game/render.ts` got `GameRenderer.setModel(rec, model)` (additive: rebuilds the view of one record after the original's `*(record + 4) = model` pointer swap).
`src/island/ambient/animals.ts` (the island's butterfly node) is used unchanged.

## What was wrong, found with the oracle / the disassembly

| item | before | original |
|---|---|---|
| Pepper's crossing | `duration = floor(80 / speed)`, gag bounce from the elapsed frame, first clip of the skateboard 3, the gag state `+0x38` rebuilt each tick | `duration = ftol(10 / (rand(0.045) + 0.045))` with the float32 sum; `+0x38 = ftol(clip length - frame)` (frames LEFT, the decompile shows `frame`, the asm `fsubr`), compared with `length / 2` (signed shift) for the rising / falling half; the constructor starts the skateboard on clip 2 (not 3); a crossing that restarts during a gag keeps `+0x38` and then indexes the gag table with -1 (reads the outfit table's last word): reproduced through `FeTables.word(row, n)` reading raw executable memory |
| Pepper's turn | `setEuler`, yaw set absolute | `FUN_0043ad29(matrix, pi)` turns the matrix in place (`rotateY`); only the translation words (+0x3c .. +0x44) are written each tick |
| outfit swaps | `rec.model = o.model` had no visible effect: `GameRenderer` built its views once | `GameRenderer.setModel` (new): Pepper really wears the borrowed outfit (checked on the screenshots: the red / white figure) |
| record 8 (BBT1) | the animation started on a random frame 0 .. 19 | the constructor places it at (-5.4, 8, 51.2) turned by 0.2625 and starts clip 0x74 frame 0; the countdown `+0x1c = ftol(rand(300) + 300)` (the decompile drops the `+ 300`) is overwritten with `ftol(+0x18)` (never changing) at every update: the figure stands on frame 0 for ever |
| train (G002, record 44) | not ported | 300 ticks waiting at x = 64, then 180 ticks riding from x = -64 to 64 (`x = (8 - n * 16 / 180) * 8`), 750 ticks waiting, repeat (scale 0.4, rotated 0.5236 about x); visible on the viaduct |
| Brickster (BRIK, record 2) | not ported | hidden (flags 0), pops up at one of three poses (pose table built by the constructor) after `ftol(rand(300) + 300)` ticks, plays the pose's clip once (rate 1), hides again, next pose `ftol(rand(2) + 1)` (the decompile drops the `+ 1`, 5 % pose 0) |
| butterflies BFS0..BFS6 (records 35..41) | static | `FUN_004b2d44` (the island's `ButterflyNode`, argument 8.0) attached in the original's order; the focus record is Pepper (`FUN_0042207d(record 0)`: they follow him when Shift is pressed within 8 units); record flag 1 (`FUN_00444370`: collision sphere against the view frustum) is computed every tick, the butterflies freeze and reset after 200 ticks out of view. Verified against the original's pre-render pass FUN_004b2539 (the shared island code was not verified against an oracle before) |
| animation instances | records 0, 1 and 8 only | records 0 .. 21 as the loader `FUN_0047ec85` (asm 0x48aff8 ..): MFIG on every record but record 1 (SKBD), clip 1 frame 0; needed by the Brickster, the outfit records and the credits |
| outfit records hidden | at the first update (after 17 ticks of fade-in) | at the attach (the constructor runs there): the nodes' `init` is called when the stage is built |
| credits | text only | `FUN_00471c4c` also lets the stage characters of the lines (`record` field of the credits table: Darren Drabwell 21, Rich Hancock 16, Steve Hughes 15, ... and record 0 at the end) peek into the picture: three slots, 80 ticks each, clip 0x5c, Space during ticks 28..32 blinks one away; the wrap copied the record only to the first part of a wrapped line, the original copies it to every part |
| fade in / out | 16 ticks, the scene frozen while leaving | fade in 17 ticks (the check precedes the increment); leaving runs the exit block: 17 passes of update + prerender + render with the fade 1.0 .. 0.0, the stage keeps moving; "new game" / "load" (var 5 differs from var 0x59) go straight to it, "Stoppen" goes through mode 8 (17 ticks without update) first and then the exit block starts again at 1.0 |

## Verified (and how)

* Pepper / figure / train / Brickster nodes: `m5-audit-fe-emu` (constructors + updates, 5 seeds x 6000 ticks, matrices of records 0, 1, 2, 8, 44, 45, flags of 0..21, Pepper's model pointer, clip / frame of the
  animations, every node field): 0 differences. The test saw 189 crossings, all ten gags, 19 outfits, all Brickster poses 0 .. 2 and the train riding. Mutating one comparison in the port makes the test fail at once.
* Butterflies: same test, 7 records x 3 seeds x 4000 ticks with a moving focus record, random Shift presses (follow / release) and random frustum flags (freeze / reset): 0 differences.
* Credits stage: `m5-audit-fe-credits`, whole scrolls (7410 ticks), Space presses, a key at tick 2500: 0 differences in slots, timers, blink states, record flags / positions, clip / frame, return value.
* Stage set-up FUN_00471070: camera (0, 11, 56.8) -> (0, 11, 0), fog, the two backdrop planes (already right), attach order and arguments, the controller flags (0x13 / 3 / 0x86 all contain the AI bit 2 the port's controllers use).
* Loop FUN_00470ac3: mode order, what runs in which mode (update pass only in mode 2 and in the exit block), result codes, the var 5 hand-over (`local_24 = var 5`, exit block) read from the decompile.

## Bot runs (headless, muted, real key input, snapshot server 5511)

`sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5511/?start=frontend&mute=1" tools/steps/m5-fe.mjs --size 1280x800 --out /tmp/m5-fe`: outfit records hidden, the figure frozen on clip 0x74
frame 0, crossings in both directions, gags (clips 85 / 86 / 126 / 131 / 35 seen), outfit swaps (screenshots show Pepper in other outfits), the Brickster peeking in at the left edge, the train on the viaduct,
butterflies flying (up to 17 units in the run), then Starten -> Nieuw spel with the arrow keys + Enter: the exit fade is recorded in the page every animation frame (17 passes, 1.0 -> 0, the tick counter advances),
the island starts at story node 2. `tools/steps/m5-fe-credits.mjs`: Credits from the menu, characters peek in next to their credit line (screenshot: Steve Hughes), a key returns to the menu. All ok;
screenshots looked at (`/tmp/m5-fe/fe-1-start.png`, `fe-3-outfit-*.png`, `fe-4-brickster.png`, `fe-5-train.png`, `fe-credits-1.png`).

## Not exact / not done, and why

> **Status 2026-10-31 (WP-SHELL-FINAL).** Closed since this list was written: random numbers (the shared CRT generator, `randF`, float32 like `FUN_004388ae`), music (A1), the shared / specular render modes and the butterflies' vertex colour (WP-RENDER, gaps.md R3 / R4 / R11), the gamepad (analogue values are zeroed by the original's poll, input.md section 1). What stays, with its reason, is the Brickster's pose 3 and the attract mode below.

* **Particles**: done by WP-SHELL (gaps.md R11): the nodes start the real emitters (`FeFx`), the front end runs its own `ZoneParticles` once per loop pass; calls compared with the original in `m5-audit-fe-emu`, the engine scenarios in `m5-audit-fe-particles`.
* **Random numbers**: the original draws `rand() / 32767` (MSVC `rand`, seeded by the time); the port uses `Math.random` (`fenodes.rng` replaceable, tests use the original's LCG). The island's butterfly node has its own replaceable source (`setAmbientRandom`). Unifying belongs to the RNG package.
* **Brickster pose 3**: `ftol(rand(2) + 1)` is 3 only for `rand() = 32767` (1 in 32768 per pick); the original then reads the three-row pose table one row too far: the 0x48 bytes at 0x5d57f88 (matrix 16 floats, clip id at +0x40, rate at +0x44) are the globals that follow the table in the BSS, among them the DirectMusic COM pointers `DAT_05d57f98` / `f9c` / `fa0` / `fb0` (heap addresses of that process run). Not reproducible (inherent: the bytes are addresses of one run of the original, they differ between two runs of the original itself); the port shows pose 0 there.
* **Butterfly vertex colour**: the constructor calls `FUN_0043ebe0(model, 0x14, 0xff999999)` (sets the diffuse colour of every vertex of the model's part 0 to grey 0.6); the renderer has no per-model vertex colour (shared with the island's butterflies). Not done.
* **Shiny / specular parts and part render modes**: `FUN_00444550(record, 0xff, 1)` / `FUN_004446c0(record, 1)` (lit at every draw, vertex format 0x2c2 with specular: the skateboard, Pepper) are not applied (the game renderer has no specular pass); mode 1 equals mode 0 in the port, the specular highlight is missing. Renderer package.
* **Music**: the original starts the `menu` music in mode 0 (after the 17-tick fade-in), the port at zone entry (`enterZone`); audio timing package. The butterfly sound handle `FUN_004433b0(300)` is loaded but nothing plays it in this zone.
* **Loading card**: done by WP-SHELL (gaps.md U1, `m8-shell-loadcard`).
* The attract mode `FUN_00423f7b` (advances the story after 0x97 frames when `DAT_009da634 != 0`): `DAT_009da634` is only toggled by F8 (DIK 0x42) in the poll's windowed-only block (`FUN_004376f9`, LE2.c:28680; gaps.md T3), never in a normal run; not ported on purpose (a debug aid).
* The gamepad stick values of the menu (`FUN_00470a38` reads `FUN_004376f9(0, &DAT_00983848)`) are not used; gamepad package.
* `m4-wp6-skate` fails in the full run (3 checks: the stunt clip / sound): not in this area (island skateboard, nothing of the front end is involved); `m5-audit-z40aPO-emu` fails: another worker's test in progress.
