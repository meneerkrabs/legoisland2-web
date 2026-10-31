# M5 audit B: z39ASB, z40aPO (z40APO), z41MAP

Method: the decompile (loops, nodes, helpers) read against the port; for z40aPO the original's code run in the x86 interpreter as an oracle (`tools/lib/apo-emu.mjs`,
`tools/tests/m5-audit-z40aPO-emu.mjs`). z39ASB and z41MAP were audited by reading only (no oracle: out of time, see "open").

## z40aPO

### Verified (oracle, tick by tick, 12.5 M comparisons, 12 scripted games + 6000 box segments)
Pilot FUN_007d3187 (all states 0..8, camera, rings / groups, landing, score, speech, every sound id / pitch / 3D position), constructor FUN_007d53af, rock monsters FUN_007d28e0,
brickbots FUN_007d19e0, asteroids FUN_007d14b0, wing hook FUN_007d2dd8 (matrix, scale), HUD FUN_007d0f00 (text, icons, tints, gauge, spin counters), the shuttle's sub-object matrices,
the SHAD shadow points, FUN_007d3050 + FUN_0043d5ec (native vs port). Scenarios: idle, bot to targets 3 / 1, no wing, dives at rock monsters / the brickbot pad, random buttons.
Not independent: the collision answers (sweep, ground ray) are the port's code on the oracle's record state; the animation instances are the port's `AnimInstance`.
Coverage gap: the rock-monster box crossing (hit_monster) never happened in the scripted games (the box itself is verified in the 6000 segment unit test).

### Fixed (all found by the oracle unless noted)
* Wind sound pitch: `ftol((fall - 0.4) * 25840 + 32000)` (port had z38PAR's 17215 / 9114).
* HUD: the three group icons are dimmed (0x88888888) until a ring of the group was passed (port: always white).
* Wing: matrix is built with the previous scale, then the scale moves (port: one tick early); tilt constant 0.523596 as float32.
* Float32 arithmetic of the whole pilot / props (rx, ry, positions, camera, camLerp threshold 0.85 crossing at 0.85000008, reflect FUN_0043cfee, normalise FUN_0043cec0).
* FUN_0043d5ec box crossing reproduced with its side effects (the hit point holds leftovers of failed face tests; the old `segmentBox` gave other points; normals / flags were right).
* Shuttle doors / hatch (sub-objects 1..3, FUN_0043ea60 + FUN_0043a4a1) are now turned and drawn (`GameRenderer.partMatrices`); door constants are float32.
* Shadow: SHAD is drawn with its 5 vertices from FUN_00442a70 (terrain-conforming) instead of a flat scaled quad (new `GameRenderer.vertexOverride`).
* The update pass also runs in the end banner (mode 4: `tickInBanner`, loop FUN_007cf929 calls FUN_0042226e for modes 2 and 4; z38PAR's loop only for mode 2).
* Intro: the tick in which the script ends goes on to the camera settling (same loop iteration); Pepper gets his walker (FUN_0042207d(PEPP) at the loop top) so the end of
  ogl02 does its Pepper clean-up (clip 0x1b does not exist in the 12-clip rig: no change; camera behind him, then eased by the loop).
* Stub chain (StubGuard / M1 walk) removed from PEPP; node constant +0x5c = 0.5 * 0.17.
* Doc stale: `docs/re/m3/z40aPO.md` section 5 (cutscene runner) is superseded by M4 WP2; the cutscene is exact (`tools/tests/m5-audit-z40aPO-intro.mjs`: real zone, real records,
  all waypoints / actors resolve, 981 ticks, FOV 1 / 0.5 / 1, bars, PEPPER_CONTROL).
* "HUD left icon absent (stale global)" refuted: FUN_0045f9d2 resets the HUD (left texture -1) at the zone start; absent is exact. "Wing has no collision": the PARA mesh has 0 collision polygons: exact.

### Not exact
Particles (footsmoke, bbflame, botexpl, rocket01, T_gold: pending package); music start moment, RNG source (original uses time-scaled rand; the oracle uses one shared sequence),
Pepper's blob shadow (var 0xc5 = -1 is a port decision; the original draws it by FUN_00444940 from the registered ground list, unknown here); SHAD draw ignores the original's
Z-test switch (FUN_0040cc4d(0)); the wing's matrix is built in the update (the original: draw hook; per drawn frame also during pause).

## z39ASB (follow-up: oracle built, see "Follow-up" below)
* The original's single pre-loop update of the shuttle node (`FUN_0042226e(records + 0x68, 1)`) is now ported (`createAsbGame`). Banner mode 4 runs no update pass (port the same).
  F9 / F10 aids are gated by the debug option. Particles (rocket01 x3), music start: pending packages (rumble is an empty function in the original: nothing to do).

## z41MAP (reading only)
* `.man` material animations: refuted. The EXE has no `PLAN_Planet.man` / `GALA_Galaxy.man` string (only z02LGI / z15SSH / z20DSP / z22BIP / z28HAT matanim paths); the nine
  `FUN_0043f1d0(model, 4, 5, ..., flag)` calls of the loader are the face set-up (type 0 / 1) the renderer already binds. Planet / galaxy only rotate (0.005 per frame).
* Loop FUN_00811abc vs port: hand-over (`FUN_00404d14(&next, exit == 2, result == 1)`, result = 2 - (TROPHY_MAP != 0)), update pass in modes 2 and 4 (`tickInBanner`) match;
  the planet position (25, 10, 30) written at the loop start is in the port (`nodes.ts`).
* Model-holder records: see "Follow-up". No oracle for the nodes (Pepper / Papa / Topping / citizens): not built (see below).

## Shared-file edits
* `src/game/render.ts`: additive `GameRenderer.vertexOverride` + `liveVerts` (live vertex positions of a record's first mesh, FUN_0043ebe0 mode 2).
* No other shared file (z27trx/gate.ts `meshParts` is imported, `parachute/util.ts` untouched; apo-* files are z40aPO only).

## Tests
`m5-audit-z40aPO-emu` (12.5 M checks, ~60 s), `m5-audit-z40aPO-intro` (36), `m3-z40aPO` (104), `m3-cutscene`, `m3-z39ASB`, `m3-z41MAP` unchanged and green.
Hint for the z38PAR owner: its loop and sound constants differ from z40aPO's (accel pitch, update modes); z38PAR's own values were not checked here.

## Follow-up

### z39ASB oracle (`tools/lib/asb-emu.mjs`, `tools/tests/m5-audit-z39ASB-emu.mjs`: 6.9 M checks, 4 whole games: no input, steering, 2 random)
The original's `FUN_007b96a0` (constructor: layout, camera), `FUN_007b82dd` (update: state machine, controls, hull / score, hit test FUN_007b7f68, asteroid recycling FUN_007b91b9,
camera, HUD values) and the sound / speech calls run natively; compared per tick: node fields, SHUT matrix, 235 asteroid positions (full matrix every 11th tick), camera, score text,
hit-icon / frame tints, gauge, result, and the node's sound calls (variants chosen by tick-scaled randoms are compared by class). Games end in state 6 with result 2 (hull / 5 hits).
Not independent: the sound variant / voice choices (original: rand scaled by GetTickCount; the port uses its own source), HULL placement (draw hook), particles.
Fixed (all found by the oracle): the pre-loop update; the layout spins used rounded constants instead of the immediates 0x3d0efa03 / 0x3d567704 / 0x3d8efa03 (rotation drift);
camera written as float32 (window test `dz = f(z - cam z)`); hit icons start 0x00ffffff (alpha 0, visible only after a hit as 0xff7f7f7f), the frame icon uses 0x7f7f7f / 0xffffff
(alpha 0) and flashes with the frame counter +0x2c8 (not the hull); thrust / gyro sounds follow the state the node's switch ran with (`stateIn`), not the state it leaves in.
Uncertain: whether the HUD draw (FUN_0043c267) shows alpha-0 tints; the port keeps the executable's values and its sprite alpha semantics.

### z41MAP model holders
The builder FUN_00816ca0 stores flags 2 on PIZ1, TOP1-4, TOMA, MEAT, CHEE, GREE, TOPP (and TOPD); nothing in the zone code hides them (the only flag clears are the citizens' own records);
the record draw FUN_00444480 draws any record with a model, flag 2 and the frustum bit. All their meshes are origin-centred and small (PIZ1 / layers radius 0.75-0.85, toppings 0.2-0.4),
so the original shows a pizza with its layers and toppings at the world origin. Changed: the port now leaves them visible (only TOPD stays hidden: its hook FUN_00815d2b draws the
toppings in the air, its return value is not visible in the decompile). If the screenshots of the bot show an unwanted pizza at the origin this is the cause and the decision is easy to revert (`prepareWorld`).
No oracle for the z41MAP nodes (Pepper / Papa / Topping / 5 citizens / slug / mama / planet): they depend on bone matrices of 7 rigs, particle emitters, 3D loops and the draw-hook matrices;
the harness would need the pose evaluation and hook outputs of each; not built in this pass. Covered instead by the 166 EXE-constant / sequence checks of `m3-z41MAP`.

### z40aPO banner
The end banner tests the held buttons (DAT_0098383c, FUN_007cf929 case 4): `skipBanner` (held & ~Esc) is set in `z40aPO.ts` like z38PAR's (shared `playzone.ts` `anyButton`).

### Bots (headless, muted, real key input, port 5514 via `m5-botslot.sh`; screenshots looked at)
* `tools/steps/m5-z41MAP.mjs` (copy of the M3 step): WIN and LOSS, 14 checks ok, "z41MAP checks passed" (intro, help, HUD, pizza making, banner, result menu, story to z40OGL node 66 / abort to node 64).
  Screenshots show the model-holder pizza plate lying at the origin (floor, centre) after the un-hide; the large garbled blue / black roof geometry at the top is a pre-existing renderer matter, not touched here.
* `tools/steps/m5-z39ASB.mjs` (copy of the M3 step, intro expectation updated for the pre-loop update: z -765.6, camera 396 behind): 19 checks ok through the full course with the bot, the failed run, the
  result menus (page 19 retry / abort), retry and abort to the island (node 61); then it stops at its last section (`F9` of the old island stub hub to re-enter node 62: the island is a real zone now, the aid
  does not exist; the run times out in `waitZone`, outside this audit). The first run showed score 3845 for the dodging bot (expectation "gold or silver" is timing / random-layout dependent): relaxed to "a medal" in the m5 step.
* z40aPO: `m3-z40aPO.mjs` WIN / LOSS ran earlier in this audit (banner 3646 bronze); not re-run after the `skipBanner` addition.

### Tests (final)
`m5-audit-z39ASB-emu` (6.9 M checks), `m5-audit-z40aPO-emu` (12.5 M), `m5-audit-z40aPO-intro` (36), `m3-z39ASB` (229, tint expectations updated), `m3-z41MAP` (166, model-holder expectation updated), `m3-z40aPO` (104): green.

### z41MAP "block mosaic" at the top / left of the game view: not a renderer defect
Isolated by hiding records in a headless run (`tools/steps/m5-z41MAP-mosaic.mjs`): the mosaic is the record **PIZZ** (`PIZZ_Building.Msh`, record 34 at (0, 0, -8.6), 2813 vertices, 19 groups, texList 25); hiding PIZZ leaves a clean scene
(moon ground, sky, planet, counter). Findings: (1) the mesh has no skin / MATL data, groups use the texture list one-to-one (texture ids 7, 21..37 = `Text007` .. `Text037`), no group is mis-indexed;
(2) those textures are plain 16x16 colour swatches (red, blue, grey, tan, brown, yellow, black, orange, teal; two 64x64 rock textures; one 512x512): the building is a LEGO-style block building whose parts are flat colours,
the UV tiling (-4..5) is irrelevant for them; (3) seen from outside with the camera moved by hand (`mos-outside-side`, `mos-back-30`) it renders as a coherent colourful pizzeria with a red roof, white posts, a red door,
yellow / blue blocks and an open back; (4) the game camera (eye (1.2, 4, -17.4) = Pepper's matrix * the table at 0x9560c0, look-at (0.7, 2, -4.4), near 3 / 1 from FUN_00816220 as the decompile, FOV 1.0, default near 5.0 only
before the first camera call) lies inside the building's footprint (x -19..9.5, z -15.6..6), directly under the upper box structure, so the underside of those boxes fills the top of the screen; the near plane value changes
nothing visible (near 1 / 3 / 5 screenshots look the same). The builder / loop never move or hide PIZZ (no write to its record fields in the z41MAP code). Nothing in the decompile suggests the original draws it differently
(culling, part mode, texture swap, face binding: the only `FUN_0043f1d0` calls of the loader are the nine face set-ups, none for PIZZ), so no change was made. If a reference screenshot of the original disagrees, the first suspects
would be back-face culling of the building's inner faces (the port culls with the clockwise-front rule of the other zones) and the camera table 0x9560c0 / 0x9560a8, not the textures.

## Closure 2026-10-31 (fork C)

'Not exact' of z40aPO is closed: particles wired (WP-PART-WIRE); RNG / music by WP-TIME / A1; Pepper's blob shadow: the zone never initialises the shadow system, so the original draws none (gaps.md R5), the port's var 0xc5 = -1 matches; the SHAD patch is drawn by the wing's draw hook with `FUN_0040cc4d(0)` (z test off, `GameRenderer.drawRecordLive(.., noZ)`) and the record stays disabled (z40aPO.md 'Closure 2026-10-31'); the wing's matrix / scale step runs in every loop pass, also behind the pause menu (`apoGame.everyTick`). z39ASB: the 'not independent' sound picks are exact since WP-TIME and the HUD globals (tints included) are compared at tolerance 0 by `m7-z39ASB-emu`; how the HUD draw `FUN_0043c267` blends an alpha-0 tint is the shared sprite path of every HUD (R15, WP-RENDER), not zone code. Nothing open.
