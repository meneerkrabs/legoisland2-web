# M5 z40OGL: Ogel's island (zone table index 27 `z90OGL`, story nodes 64 and 66)

Worker `ogl` (hub main). The seven PeppSwit constructors (Pepper's mode switch, the citizens, robots, slugs, the star dome, the hologram watcher: 22 attaches) are the work of `ogl-peppswit`,
see `docs/re/m5/z40OGL-peppswit.md` (folder `src/zones/z40OGL/peppswit/`).
Tests: `node tools/test-formats.mjs --only m5-z40OGL,m5-z40OGL-emu` (97 + about 74,000 checks), bot `tools/steps/m5-z40OGL.mjs`.

## 1. Files

| file | content |
|---|---|
| `src/zones/z40OGL/index.ts` | `registerHub({ archive: 'z40OGL', ... })`: HUD (`onCreate`, `frame`), the wrapper's outfit restore `restoreOutfits` (`afterSetup`), debug; imports `krystal.ts` and (at the end) `peppswit/` |
| `src/zones/z40OGL/krystal.ts` | the `Overlay` node (the krystals KST0 .. KST9): constructor 0x7e31fc, update 0x7e2c9a |
| `src/zones/z40OGL/hud.ts` | HUD set-up FUN_007e2a80 and per-frame update FUN_007e2ad0 |
| `src/zones/z40OGL/common.ts` | sound helpers (the krystal handle slots), constants with their addresses |
| `tools/tests/m5-z40OGL.mjs`, `m5-z40OGL-emu.mjs`, `tools/lib/m5-z40OGL-emu.mjs` | node tests, oracle tests against the original's code in the x86 interpreter, the duel harness |
| `tools/steps/m5-z40OGL.mjs` | the headless bot (real key input) |

## 2. What runs where (functions, addresses)

| original | what | port |
|---|---|---|
| `FUN_007e2321` (wrapper) | loads the archive (`_data\z40OGL.bob`), `FUN_007e4222` (set-up root), `FUN_0042207d(PEPP)` (Pepper's walker), `FUN_00421bbe(5)` (outfit / phase restore), `FUN_007e2a80` (HUD), loop, teardown | `HubGame` (shared) + `restoreOutfits` + `hudInit` |
| `FUN_007e247f` (GameLoop) | the template loop: mode 0 music, mode 2 `FUN_00427233` probe pass / `FUN_004225c5` / `FUN_0042271b`, `FUN_00444850` + `FUN_00444ed0(1)` (blob shadows on record 1 = OGEL), mode 7 / 8 fades, `FUN_007e2ad0` every pass, exit mapping (`FUN_00404be7`, var 5) | `src/shell/playzone.ts` + `loopmachine.ts` (HUB_CONFIG), shadows through `ZoneSetup.shadow` (`records: [1]`, checked in the test) |
| `FUN_007e4222` | music handle `FUN_00443290("ogel")`, `FUN_00810ed0` (the 59 `SWITCH_OGL_*` names, dictionary of capacity 60), `FUN_007fe97e` (the loader: 228 animation names, 38 loader rigs), `FUN_00442900("z40OGL")` (particle engine, own `Particle/` folder: twinkle01 / twinkle02), `FUN_00447cc0("GENERICBITS")`, `FUN_007e3350` (45 sound handles), `FUN_007e3bd1(1)` (the story function), `FUN_007e3679` (3 cutscene slots) | the x86 emulation (`src/formats/emusetup.ts`, spec `z40ogl`): runs this code unchanged; `unhooked` is empty for both nodes |
| `FUN_007e3bd1` (story function) | `SetupFog(4, 100, 300, 200, black, on)` (32-bit display; the 16-bit branch `(4, 80, 200, 100)` is not taken), 4 HUD hints, `FUN_0043b6a3(PEPP rig, clip 0x1b)`, ground record OGEL, the two waypoint maps `W_PATH` / `W_CSM`, `FUN_007e39d9` (+ `FUN_007e36dd`: the nine Overlay attaches, PEPP / CIT flags), node `< 0x41`: `FUN_007e7c56` (node 64) + objective `FUN_004242b9(0x3f, 16)` + PEPP to PATH node 0x3e + `OGLhol1.str`; else `FUN_007e8308` (node 66) + objective node 3 + `OGLfsm2.str` + `OGLhol2.str`; then PEPP's four constructors, HOLO (render mode 2, `hOLO`), SGMFIG, STAR, the four StartCSM triggers, gravity -7, sea -96 | emulated (same) + `replaySetupState` (texts, objective) |
| `FUN_007e6c60` (shared by `FUN_007e7c56` / `FUN_007e8308`) | the five citizens' controllers and flags, the walker nodes | emulated |
| `FUN_007e2ad0` | HUD per frame | `hudFrame` (oracle-tested) |
| `FUN_007e2a80` | HUD set-up | `hudInit` (oracle-tested) |
| `FUN_007e31fc` / `FUN_007e2c9a` / `FUN_007e3148` / `FUN_007e3162` / `FUN_007e319e` / `FUN_007e31c3` / `FUN_007e3304` | Overlay: constructor, update, pre-render (returns 1), draw (= default draw), save, load, destroy | `KrystalNode` (`ctorInit`, `update`, `prerender`, `saveState` / `loadState`, `destroy`) |
| `FUN_007e4293` | teardown = `FUN_007e4207` (`FUN_00423ad4` destroy slots, `FUN_00423ff6` / `FUN_0088d296` free the text tables) + `FUN_004232a0`: engine, nothing zone specific | `HubGame.destroy` |
| `FUN_007e22b0`, `FUN_007e22cd`, `FUN_007e2c95` | empty | - |
| `FUN_007e22b5` / `FUN_007e22d2` | `FUN_00423170` (pause trigger) / view matrices, frustum flags, 3D listener | shell |
| `FUN_007e4278`, `FUN_007e8800` (3,596 lines) | not referenced by any other function (a restart set-up of the editor era: `FUN_007e8800` calls itself in the decompile, i.e. a Ghidra artefact of a data function); not run by the game | not ported |
| 0x7e4f9c, 0x7e539e, 0x7e5ea7, 0x7e61e9, 0x7e6498, 0x7e69a2, 0x7e6bb2 | PeppSwit.c | `ogl-peppswit` |

## 3. The set-up is the original's code

The story function and everything it calls run in the x86 interpreter against the live game variables (`profileFor(..., { emuVars })`): the attaches with their argument blocks, flag / variable writes,
render modes, cutscene slots, dictionaries, sound handles are what the original's code produced. Per node (checked in `m5-z40OGL`):

* node 64: 64 attaches, Pepper at PATH node 0x3e = (35.30, 27.0, 209.08), objective = PATH node 63 (radius 16), texts `OG/Data/OGLhol1.str`; the five CIT records visible + walkers `0x7e69a2`;
* node 66: 59 attaches, Pepper where the map put her (-143.74, -65.80, 122.14), objective = PATH node 3, texts `OGLfsm2.str` + `OGLhol2.str`; the citizens only SGMFIG, hidden by `FUN_007e8308` (`flags &= ~2`);
* both: PEPPER_CONTROL = 1 (`FUN_00417597(0x5e, 1)`), the Pepper chain `0x7e4f9c` (any mode) / SGwalk (1) / `0x43310c` (4) / `0x7e539e` (0x20), gravity -7, sea level -96, ground record OGEL;
* the nine `Overlay` attaches: KST0, KST1, KST2, KST3, KST4, KST5, KST6, KST8, KST9, gate var 0x31 bits 1, 2, 4 ... 0x100, value 0 (KST7 has none: a decoration);
* three cutscene slots from `FUN_007e3679`: 0 `OGL01` (stuffed_croanies), 1 `OGL03` (intro_briks_palace), 2 `OGL04` (land_on_ogel); `OGL03` / `OGL04` have no `.str` and need none (their scripts have no `saytext`);
* `FUN_00424029` x4 (`0x71, 0x79, 0x82, 0x81, 0.032`): the SGMFIG animation-set table `0x8adcf8`; the values equal the executable's static table, `src/island/npc/sgmfig.ts` reads the executable: nothing to do.

### 3.1 Story flow (verified in the node test and by the bot)

* **node 64** (`SUBGAME: 256 == 1`, next zone z41MAP): `StartCSM` trigger 0 (no waypoint) starts slot 2 `OGL04` at the arrival (the camera shows the pizzeria `PZ00` from the waypoint `ogelcam03`, about 200 ticks);
  trigger 1 waits at PATH node 63 (the pizzeria door, radius 2 x 8) and sets var 256 (`SWITCH_OGL_AT_OGEL_PIZZERIA`) := 1 -> the FSM leaves for node 65 (z41MAP).
  Pepper walks the PATH route 62 61 60 43 44 45 46 47 48 49 50 51 52 63 (down the spiral to the pizzeria).
* **node 66** (`SUBGAME: 257 == 1`, next zone z42BRP): trigger 2 starts slot 0 `OGL01` at the arrival (the sleeping citizens, the hologram CIT03 says `OGCSES01`); trigger 3 waits at PATH node 3 (Ogel's headquarters, the palace) and starts
  slot 1 `OGL03` (the palace intro) and sets var 257 (`SWITCH_OGL_AT_OGEL_HQ`) := 1 -> node 67 (z42BRP). The route climbs the spiral 63 52 51 ... 4 3.
* The HUD hint hologram (`hOLO` on HOLO, texts `OGLhol1` / `OGLhol2`) shows the objective arrow's direction on Shift (shared family).

## 4. Why Ogel's island is dark (the foundation's "renders black")

It is the original's look; nothing is missing. Every cause was checked against the data and the original's code:

1. **Lights** (`lights/lights.lgt` of z40OGL, loader `FUN_008864b6` -> `FUN_008849c6`): ambient = max over the file's records = **0.0171 (4.4 / 255)** in all three channels, one sun (file direction (-0.06, -0.84, 0.54), the
   loader negates the negative y: toward the light (-0.06, 0.84, 0.54), diffuse (1, 1, 1)) and nine point lights whose runtime reach is the constant **1.0** (`FUN_008849c6` stores 1.0 at `+0x5c`, never the file's range 8000;
   `FUN_00885a9a` multiplies by `1 - d / 1.0`): they light nothing but vertices within one unit. So only surfaces facing the sun are lit (the tops of the plates, the terrain), the rest is 4 / 255: black.
   The archive also holds `lights.lgt.original` (ambient 0.54), `_set1_1point-red`, `_set2_lots of pointlamps_amb1_dir.5`, `_set3_lotsofpoint_amb.1_dir1`, `_pos2`: editor-era experiments; the game opens the exact name
   `lights/lights.lgt` (`FUN_004348ff` first tries a disk file, then compares every path component with `__strcmpi`, `FUN_004346a2`: no prefix match).
   The oracle test runs `FUN_008849c6` on the shipped file and compares every light (kind, position, direction, diffuse, reach) and the ambient entry with `lightSetFromLgt` (`m5-z40OGL-emu`, section c).
2. **Fog** `SetupFog(4, 100, 300, 200, colour 0, on)`: far = (300 - 100) x (100 - 50) / 100 + 100 = 200 at the default draw distance, fog from 66.7; the fog colour is black and the clear colour is the fog colour: **the sky is black**.
   There is no sky dome, no sea plane (`SSKY` / `SSEA` records do not exist in z40OGL): the sea level -96 only matters to the fall code. The backdrop call `FUN_004430f0("_Data\GENERICBITS\Backdrop\")` is a single `ret` in this executable.
   (The table in `docs/re/rendering.md` lists the 16-bit call `(4, 80, 200, 100)`; `src/game/fogphases.ts` picks the 32-bit call 0x7e3c43 for play: `FUN_007e3bd1` takes the 16-bit branch only when `DAT_00987660 != 0`.)
3. **Render modes**: only HOLO has one (`FUN_00444550(HOLO, 0xff, 2)`, the translucent hologram; emulated, `GameRenderer` applies `ZoneSetup.modes`); no shiny records; the Overlay constructor makes no render call. Pepper's minifig is dark from behind because the sun is in front
   of her when she walks toward +z; the white glints are the specular term (`FUN_0088612c`) of the same sun.
4. **Overlay** is the krystal node, not a screen overlay: it has no drawing code (its draw hook is the default draw).

Result: the arrival plateau (colourful plates over the void, lit from above) looks like the screenshots of the bot (`/tmp/m5-ogl/*.png` of the session), the island itself (cutscene OGL04, the pizzeria area) is lit grey rock with black fog behind it.

## 5. Krystals (Overlay, 0x7e31fc)

Node: +0 var (0x31), +0xc mask, +0xe value (the attach's gate), +0x18 state. `ctorInit` (the constructor's world half, run by `registerHub` after the set-up, in record order): bit clear -> state 0 and record flag 0x10 (no collision);
bit set (collected in an earlier visit) -> state 1, hidden; the first constructor also creates the ONE shared emitter `TWINKLE01.par` (gate off, offset (0, 4, 0), on the first krystal's live matrix).
`update` (FUN_007e2c9a): while visible, the 3D loop of the krystal's handle plays at its position every tick (`FUN_004433f0(DAT_05d5f338 ..., rec + 0x3c)`; KSTn -> the n-th 3D slot of sound 0x267 = 615, the handle globals
`0x5d5f338, 0x5d5f340, 0x5d5f33c, 0x5d5f354, 0x5d5f350, 0x5d5f35c, 0x5d5f358, 0x5d5f348, 0x5d5f344, 0x5d5f34c`, in the order of the loads of `FUN_007e3350`); state 0 and squared distance (controller +0x18) < 12.96 (3.6 units):
+1000 to var 0xc7 and var 0x25 (the HUD score), the emitter moves to the krystal (twice) and emits, the loop stops (`FUN_004434b0`), the collect jingle (sound 0x2f1 = 753, `DAT_009da8f4`), hidden, state 3; then 3 -> 2 -> 1 -> 0 over three ticks: the emitter stops and
the bit is set in var 0x31 (the gate closes). The node returns 0 (never counts as "ran"). `destroy` stops the first handle's loop and forgets the emitter. Save / load (4 bytes at +0x18) exist as `saveState` / `loadState` (the save-game package V1 does not store node states yet).
Sound: the port plays the exact slot (`AudioHost.slot('3d', 615, n)` + `sfx.play3D`); without an audio host (tests) it falls back to `sfxAt(615, pos)`.

## 6. HUD (FUN_007e2a80, FUN_007e2ad0)

Set-up: left icon texture 0 (the krystal) white, no right icon, no centre text until the first frame, column slot 0 white. Per frame: centre text `"%04d"` of var 0x25, left text `"x%d"` = number of set bits among the first ten of var 0x31 (bit 9 = 0x200 counts, no krystal sets it),
interaction icon (column slot 0) from var 0xc: 0x20 -> texture 3, 1 -> 2, 0x1e -> 1 (only while PEPPER_CONTROL & 1, otherwise the icon keeps its last value), 0xc0 -> blinking 4 / 5 (`_DAT_05d5f304` += dt: below 15 texture 4, else 5, above 30 the counter restarts), nothing -> -1 and the counter 0;
then var 0xc := 0. Textures: `Overlays/Z40OGL` = `tEXT000` (krystal), `Text001..005`.

## 7. Wrapper: outfit / phase restore (FUN_00421bbe(5))

`FUN_00421b18` maps var 0x59 = 0x1b to hub number 5; table `0x8acdc0 + 5 * 8` = entries 435 .. 447 of the record table `0x8acdf0` (records MAMA, PAPA, G002 .. G010, the two KKKK): variant word (record + 0x64) := `phase << 8 | 1 | outfit << 16` from the saved bytes
(`DAT_009d9fd0` / `DAT_009d9fd1`, zero in a new game) and the phase table's model words (the `0xbabababa` "unchanged" markers of phase 0 in a new game). `restoreOutfits` writes the variant words (fresh game: 1). Only the island's "change the look" code (`FUN_0051db5c`, not in this zone) reads them.
`FUN_00421eb3` (the matching save at the end of the zone) and the saved bytes are the save-game package's (V1). The function itself is an engine function that the emulation does not run (`emu.run(0x421bbe)` faults: outside the zone's code regions).

## 8. Particle emitters (listed, for the particle wiring package)

| effect | call site | when | notes |
|---|---|---|---|
| `TWINKLE01.par` (z40OGL `Particle/twinkle01`) | `FUN_007e31fc` @0x7e3265 `FUN_0044e920(name, rec + 0xc, 0, 4.0, 0, 0, 0, 0, gate 1,1,1)` | created idle by the first krystal constructor (KST0) | ONE handle `DAT_0094c4fc` for all krystals, offset (0, 4, 0), rotation 0, follows a krystal's matrix |
| same handle | `FUN_007e2c9a` `FUN_0044ea00(h, rec + 0xc)` x2, `FUN_0044ea60(h, 2, 1, 1)` | pick-up: move to the krystal, emit | |
| same handle | `FUN_007e2c9a` `FUN_0044ea60(h, 1, 1, 1)` | three ticks after the pick-up | stop |

No other `.par` / `.swl` is started by the zone's code (grep of the region 0x7e1b21 .. 0x8112bc: one `FUN_0044e920`, no `FUN_00442960` / `FUN_004429a0`); `twinkle02` is in the archive but never named. The node calls `fxStart` / `fxMatrix` / `fxGate`
(`src/island/emitters.ts`) on `ctx.fx` (`ZoneParticles`): The engine is wired by this hub: `onCreate` in `src/zones/z40OGL/index.ts` runs `ZoneParticles.create` (the zone's own `Particle/` folder), assigns it to `ictx.fx` and creates the shared emitter on the first krystal (`ensureTwinkle`); skipped if some package already installed `ictx.fx`. `FUN_0044e8d0` (`fx.finish`) is not called by this zone.

## 9. Sounds and music

Music `ogel` (`FUN_00443290("ogel")`, played at the loop's mode 0 init: `ZONE_MUSIC.z40OGL`). `FUN_007e3350` loads 44 sounds (36 3D, 8 2D; the list is `ZONE_SOUND_SETUP.z40OGL`): the krystal loops (10 x 615), the PeppSwit sounds (ids 244, 619, 620, 626, 614, 616 ... 817: the fall, the slugs' / robots' / citizens' sounds,
handled by `ogl-peppswit`), and the generic walk sounds of SGwalk (`FUN_004b0f16`, list `WALK`). The wrapper's speech set `"ogl"` (`FUN_00435b59`) is the audio package's.

## 10. Verification

* `m5-z40OGL-emu` (a): `FUN_007e2a80` and `FUN_007e2ad0` run natively in the set-up emulation (`IslandSetup.run`) on 7,143 random variable sets (dt 1 / 0.5 / 1.3, blink runs of 20 .. 70 frames): both strings, slot 0's texture, the blink counter (float32) and var 0xc agree, and the function makes exactly one variable write and no engine call.
* (b): the original's Overlay constructor / update and the node framework's update / pre-render passes (`FUN_00423532`, `FUN_0042226e`, `FUN_004225c5`, the distance `FUN_0042216f`) run natively next to `KrystalNode` (harness `tools/lib/m5-z40OGL-emu.mjs`, on `IslEmu`): 12 sessions,
  2,016 ticks, scripted pick-ups of all krystals in both nodes, the 3.6 boundary, krystals collected in earlier visits (5 bit patterns), random walks (dt 1 and 0.5): records' flags, node states, variables 0x31 / 0x25 / 0xc7 / 0x58 / 0x5e, every sound call with its handle
  (KST0 .. KST9 named by the globals `FUN_007e3350` stored them in) and every particle call agree: 0 differences.
* (c): `FUN_008849c6` on the shipped `lights.lgt` against `lightSetFromLgt`: all lights, the zero records beyond the file's end, the ambient entry (section 4).
* `m5-z40OGL`: the emulated set-up facts of both nodes (section 3), the krystal node, the HUD, the outfit restore, the arrival cutscenes and the two waypoint triggers that complete the nodes and the story FSM's hand-over.
* The bot (section 11).

## 11. Bot

`tools/steps/m5-z40OGL.mjs` (header has the command; `NODE=64|66`): real key input (ArrowUp / Left / Right, held across polls), closed-loop steering along the PATH route read from the game (routes: node 64 `62 61 60 43 .. 52 63`, node 66 `63 52 51 .. 4 3`),
waits for the arrival cutscene (OGL04 about 200 ticks, OGL01 about 620 ticks), handles falls (PEPPER_CONTROL 0x20: the peppswit worker's void fall puts her back) and wedging.
Runs (snapshot server 5516, screenshots in `/tmp/m5-z40OGL/`, looked at): **node 64**: arrival OGL04, walk to the pizzeria door, var 256 = 1, hand-over to z41MAP (node 65); **node 66**: OGL01, climb the spiral picking up two krystals on the way (HUD `x2`, score 2000, var 0x31 = 0x110), PATH node 3,
var 257 = 1, hand-over to z42BRP (node 67). Screenshots show the HUD (krystal icon, `X0`, `0000`), the lit rock canyon, the black void, Pepper as a silver / black minifig.

## 12. Not exact / open

* Particles: wired (section 8), not yet looked at in a screenshot.
* Outfit restore: the saved phase / outfit bytes come from the save-game package; the phase tables' model words are not applied (they are the `0xbabababa` markers in a new game).
* Node save / load states exist but are not stored in save games (V1).
* The dead functions `FUN_007e4278` / `FUN_007e8800` are not ported (nothing calls them).
* The 3D loop of a krystal uses the audio host's per-slot API (`slot` / `ga.sfx.play3D`); the pan / attenuation are the audio package's.

## 13. Shared-file edits

None so far (this worker only adds files in `src/zones/z40OGL/` (not `peppswit/`), `tools/tests/m5-z40OGL*.mjs` (not `-peppswit`), `tools/lib/m5-z40OGL-emu.mjs`, `tools/steps/m5-z40OGL*.mjs`, this doc and a section of `progress.md`).
Observation for the foundation owner: `tools/lib/hub-load.mjs` still gives its mock context `fx: []` and a `particles()` method of the old API; `World.tick` now calls `fxOf(w).finish()` (src/island/emitters.ts) so every test that ticks a `loadHub` world needs an `fx` object with `finish` (`tools/lib/fake-fx.mjs`); `loadOgl` does that.
