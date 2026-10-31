# LEGO Island 2 / LEGO Eiland 2 - the rendering pipeline of `LEGO eiland 2.exe`

How the original engine draws a frame, reverse-engineered from the NL retail executable (6,459,444 bytes, MSVC debug-style build with assert strings,
DirectDraw 7 + **Direct3D 7**). Function names are the Ghidra names of `LE2.c` (`FUN_<address>`, address = virtual address; image base 0x400000).
The implementation of everything marked **[viewer]** lives in `src/render/` and `src/viewer/` (see `docs/engine-api.md`, section "Rendering").
Confidence: statements without a marker are read directly from the code and data (high); **UNCERTAIN** marks guesses and things I could not close.
Companion documents: `formats.md` (file formats), this file (what the engine does with them on screen).

Contents: 1 display set-up, 2 frame structure, 3 camera, range and fog, 4 materials and render states, 5 lighting, 6 textures, 7 the world
(sky, sea, seabed, LOD, culling), 8 particles, 9 shadows, 10 other effects, 11 the 2D layer (text, HUD, menus, fades), 12 what the viewer reproduces, 13 open questions.

---------------------------------------------------------------------------------------------------------------------------

## 1. Display set-up

* **API**: `DirectDrawCreateEx` (IDirectDraw7 `DAT_00983a30`), primary surface `DAT_00983a3c`, back buffer `DAT_00983a40`, `IDirect3D7` `DAT_00983a34`, device
  `IDirect3DDevice7` `DAT_00983a38` (vtable offsets: 0x14 BeginScene, 0x18 EndScene, 0x28 Clear, 0x2c SetTransform, 0x34 SetViewport, 0x48 SetLight, 0x50 SetRenderState,
  0x64 DrawPrimitive, 0x68 DrawIndexedPrimitive, 0x80 DrawIndexedPrimitiveVB, 0x84 ComputeSphereVisibility, 0x8c SetTexture, 0x94 SetTextureStageState, 0x9c ApplyStateBlock, 0xa8 CreateStateBlock).
  Direct3D 7 is the only 3D API in the file (formats.md 7.1 used to say DirectX 8; corrected).
* **Mode and options** come from `_data/GameSetup.txt` (shipped file, written by `FUN_004032b8`, read by the set-up dialog `FUN_004037c2` / `FUN_00403239`):
  `video driver Primary Display Driver`, `video device Direct3D HAL`, **`video mode Mode 800x600x32`**, `video exclusive t`, `video fog f`, sound driver / on. `dialog t` shows the dialog again.
  The 3D device is always the HAL; there is no software rasteriser path.
* **Exclusive full screen** (`video exclusive t`, `FUN_0040acb0` / `FUN_0040bdd1`): `SetCooperativeLevel(FULLSCREEN | EXCLUSIVE | ALLOWREBOOT = 0x13)`, `SetDisplayMode(w, h, bpp)`, a primary
  surface with a complex flip chain of **one back buffer** (caps 0x6218 = PRIMARYSURFACE | FLIP | COMPLEX | 3DDEVICE | VIDEOMEMORY, `dwBackBufferCount = 1`). The frame is shown with
  `Flip(NULL, DDFLIP_WAIT)` and retried while the result is `DDERR_WASSTILLDRAWING` (`FUN_0040cb0f`), i.e. double buffering synchronised to the display.
  If the chosen mode fails, `FUN_00405832` retries with **640x480x16**.
* **Windowed** (`FUN_0040a43f`): the window must have the desktop's bit depth ("Cant create a %d bpp window on a %d bpp desktop" assert); the frame is `Blt` from the back buffer to the window.
* **Resolution**: the list of modes comes from DirectDraw (`SDEnum.c`); the 3D scene is **always projected with a 4:3 aspect** (section 3) whatever the mode; the 2D layer scales three different reference grids (800x600 HUD, 640x480 menus / fonts, section 11).
* **Bit depth**: 32 bit by default. Textures are created as ARGB8888 whenever the card offers it (section 6). A 16-bit display (`DAT_00983cc8 == 0x10`) switches the game to a "low end" profile
  (`FUN_004060b1`): near plane >= 12, far plane <= 350, less than 4 MB of video memory (`DAT_00983b8c < 0x3e8000`) forces half-size textures.
* **Z-buffer**: the device's depth formats are tried in the order **32 bit, 24 bit, 16 bit** (`FUN_0040a43f` loops, creates a `DDSCAPS_ZBUFFER | VIDEOMEMORY` surface, attaches it, then `CreateDevice`); the first that works is used.
  If the card reports `D3DPRASTERCAPS_WBUFFER` (0x40000, `DAT_00983aa4`) the game switches depth testing to a **W-buffer**: `ZENABLE = 2` (`FUN_0040cc4d`, `FUN_0040788f`), otherwise a Z buffer (`ZENABLE = 1`).
  `ZFUNC = LESSEQUAL`. The frame is cleared with `Clear(TARGET | ZBUFFER, colour, z = 1.0)`.
* **Viewport**: `SetViewport` with (0, 0, width, height) and **MinZ = MaxZ = 0.0** (`FUN_0040bdd1`, `FUN_0040a43f`, `FUN_0040acb0`; the return value is not checked). **Settled**: Direct3D 7 turns a degenerate range into `[MinZ, max(MaxZ, MinZ + 0.001)]`
  (measured by Wine against native Windows, `ddraw7.c` "Test degenerate viewport z ranges"), so the depth values of the game's triangles span `[0, 0.001]` (ordering intact, a thousandth of the 0..1 resolution; `Clear` uses z = 1.0). The port: `gl.depthRange(0, 0.001)` (`states.ts` `GAME_Z_RANGE`).
* **Fog option**: `video fog` is stored in `DAT_00983e14` (`FUN_0040661f`); when it is non-zero fog is disabled everywhere (`FUN_0040920e`, `FUN_0040943f`, `FUN_00409563` force `FOGENABLE = 0`).
  The shipped file has `f`, so fog is on. (The flag's dialog label is unknown; the code only ever uses it to switch fog off.)
* **Time base**: game logic, animation and particles run in **ticks of 1/30 s**. `FUN_00443e40` measures the real frame time and keeps `DAT_008b1718 = frameTime / (1/30 s)` (the constant `0x892260` = 1/30; 1.0 for the first
  4 frames, reset to 1.0 above 15, growth limited to 3x per frame). Everything that moves (`sky rotation`, `sea orbit`, `texture animation`, `fades`) is written "per tick x DAT_008b1718".
  The game does not lock the frame rate itself; a 60 fps port multiplies by `dt * 30`. An adaptive mode (`FUN_00443d10`, off unless `DAT_009e56b8` is set) shortens LOD distances and the far plane when frames are late.

---------------------------------------------------------------------------------------------------------------------------

## 2. Frame structure and render order

Per frame (zone main loops such as `FUN_00465d39` / `FUN_00470ac3`; about 30 near-identical copies, one per zone; end of frame `FUN_00435d0d` = `FUN_0040cb0f`):

1. **Begin** (`FUN_0043ec70` -> `FUN_0040c8c6`): `Clear` to the **zone's fog colour** (`DAT_00986e24`; pure black while a fade-out is at 0), `BeginScene`, view matrix = look-at
   (`FUN_004165a5(eye DAT_00986e18, target DAT_00986d78, up DAT_00986d88)`), projection `FUN_0041533b` (section 3).
2. **Update** of record behaviours (`FUN_004225c5`), game logic, camera (`FUN_00465c9b`: `FUN_0043cc5c` sets eye / target / up and `SetTransform(VIEW)`), and the per-record sphere visibility test (`FUN_00444370`).
3. **World**: `FUN_0042271b` walks the **record array in index order**. Each record is drawn either by its behaviour's own draw function (vtable +0xc: sky, sea, seabed ...) or by the generic `FUN_00444480`;
   every drawn object is followed by its blob shadow (`FUN_00444940`, section 9). There is no sorting by distance or by transparency: **the record order is the draw order**.
   In the island zone: `0 SEAB` (seabed), `1 SSEA` (sea plane), `2 SEAE` (shore foam), `3 SSKY` (sky dome), `4 LAND`, then all objects and characters (z02LGI order of `extractZone`).
4. **Bricks and particles** (`FUN_00442930`): `FUN_00447de0` flushes the batched brick meshes of the brick effects (preset 5), then `FUN_0044e8e0` updates and draws all particles (section 8).
5. Game state machine, frame timing (`FUN_00443e40`), **HUD** (`FUN_0045f9a6` -> `FUN_0046055f`), text flush `FUN_00439f51`, queued menu sprites `FUN_0043c70f`.
6. **End** (`FUN_0040cb0f`): fade / loading overlay and spinner (`FUN_0040d1be`), step of all animated textures (`FUN_004126fd`), `EndScene`, `Flip` (or `Blt`).

Consequences: the sea plane is drawn **before** the land and without depth test (sections 7.2, 7.3), so land and objects simply paint over it; the sky is drawn after the sea but before the land and *with* depth test.
Text and sprites of the 2D layer are drawn last and are not affected by fog (fog is switched off around every 2D draw).

---------------------------------------------------------------------------------------------------------------------------

## 3. Camera, projection, draw distance and fog

### 3.1 Projection (`FUN_0041533b`, `FUN_0040c8c6`)

`Projection = D3DX-style perspective(fov, aspect, near, far)` with

```
m[0][0] = cot(fov / 2) * 0.75        (aspect passed to the builder is always 0.75 = 480 / 600 = h / w)
m[1][1] = cot(fov / 2)
m[2][2] = far / (far - near)   m[2][3] = 1   m[3][2] = -far * near / (far - near)
```

* `fov` is `DAT_0089df2c`, the camera zoom factor, in **radians, vertical**: default **1.0 rad (57.3 deg vertical, 72.4 deg horizontal at 4:3)**. Game code changes it with `FUN_0040cd1a`
  (values seen: 1.0 normal, 0.9 / 0.57 / 0.4 / 0.3 in cut scenes and zoomed views). The same value scales the LOD test (section 7.4) and the particle size (section 8).
* **near** `DAT_0089df30 = max(zoneNear, 1.0)`; **far** `DAT_0089df34`, see 3.2. The aspect is fixed at 4:3, the game never widens the view (the push of `0.75f` sits at file offset 0xCAC3, VA 0x40CAC3 in the Dutch EXE: what the LI2 Mod Manager's widescreen hack overwrites with height / width, keeping the vertical FOV, which shows more at the sides). **[viewer]** keeps the vertical FOV and uses the real canvas aspect. **[port]** the option "Beeld: breedbeeld" does the same for the 3D scene and keeps the 2D layer a centred 4:3 area: docs/re/widescreen.md.
* The view is a left-handed look-at (formats.md 7.1); the camera placement itself is gameplay code (not covered here).

### 3.2 Draw distance and fog (`FUN_00442d90` -> `FUN_004096e0` -> `FUN_004095ab`, `FUN_0040943f`)

Each zone's set-up function calls `SetupFog(near, farMin, farMax, fogFrac, colourARGB, enable)` with constants (the per-zone values are in the table below, and are read from the executable at run time by `src/formats/zoneparams.ts`).
`FUN_004095ab` combines them with the **options slider** (settings value `0x15`, default **50**, 0..100, `_data/Settings.set`; menu page 10, item 1, `FUN_0041b500`):

```
far       = (farMax - farMin) * ((100 - slider) / 100) + farMin          (slider 0 = farMax, slider 100 = farMin)
fogEnd    = far
fogStart  = far - fogFrac * far / farMax
```

Then **linear fog**: `FOGCOLOR = colour`, `FOGSTART = fogStart`, `FOGEND = fogEnd` (written into all 30 state blocks, `FUN_00408f82`), `FOGENABLE = enable && fog option on`.
If the card has table fog (`D3DPRASTERCAPS_FOGTABLE` 0x100 in `DAT_00983aa4`) the mode is `FOGTABLEMODE = LINEAR` (pixel fog), otherwise `FOGVERTEXMODE = LINEAR`. No range-based fog (`RANGEFOGENABLE = 0`): the fog factor
depends on view depth (z / w), not on distance. The **clear colour is the fog colour** also when fog is disabled. All 2D draws and all particles switch fog off.
A 16-bit display (`DAT_00987660`) clamps far to 350 and near to >= 12 (`FUN_004096e0`). The set-up function can be wrapped in `FUN_004096b3(1) ... (0)` to ignore that clamp.

Fog colours are D3DCOLOR 0xAARRGGBB; the constant `0xffff` that most outdoor zones use is **cyan (0, 255, 255)**: the horizon haze of the island zones.

Zone table (default slider 50; near is the near plane; sea y = value stored into `DAT_009da858` by the set-up code, `-` = never stored = 0). Lights from section 5:

| zone | near | far (slider 0 / 50 / 100) | fog start / end at 50 | fog colour | fog | sea y | ambient | sun toward light (xyz) | sun colour | point lights |
|---|---|---|---|---|---|---|---|---|---|---|
| z01BPK | 1 | 200 / 150 / 100 | 135 / 150 | #000000 | on | 0 | 0.42,0.42,0.42 | -0.65,0.45,0.61 | 1,0.96,0.53 | 0 |
| z02LGI | 4 | 800 / 450 / 100 | 169 / 450 | #00ffff | on | 2.4 | 0.18,0.18,0.24 | 0.71,0.6,0.37 | 1,1,1 | 0 |
| z03PPH | 4 | 800 / 450 / 100 | 169 / 450 | #00ffff | on | - | 0.2,0.2,0.18 | 0.76,0.58,-0.3 | 0.84,0.97,1 | 0 |
| z04IFC | 5 | 100 / 100 / 100 | 75 / 100 | #000000 | off | - | 0.4,0.4,0.4 | -0.46,0.45,0.77 | 1,1,1 | 0 |
| z05WAB | 4 | 100 / 100 / 100 | 90 / 100 | #000000 | off | - | 0.3,0.3,0.36 | 0,1,0.07 | 1,1,1 | 0 |
| z07CSI | 4 | 800 / 450 / 100 | 169 / 450 | #ff9966 | on | 0 | 0.49,0.49,0.51 | 0.44,0.81,0.39 | 1,1,0.9 | 0 |
| z08BKD | 4 | 200 / 200 / 200 | 80 / 200 | #00ffff | on | - | 0.09,0.1,0.1 | 0,1,-0.03 | 0.94,1,1 | 0 |
| z09JST | 4 | 500 / 350 / 200 | 70 / 350 | #ff9966 | on | - | 0.3,0.3,0.36 | 0.44,0.81,0.39 | 1,0.77,0.43 | 0 |
| z10RGB | 4 | 600 / 350 / 100 | 175 / 350 | #ff9966 | on | 0 | 0.3,0.3,0.36 | 0.44,0.81,0.39 | 1,0.77,0.43 | 0 |
| z13CAI | 4 | 800 / 450 / 100 | 169 / 450 | #00ffff | on | - | 0.2,0.2,0.24 | -0.59,0.57,0.57 | 1,0.91,0.84 | 0 |
| z14OSD | 4 | 800 / 450 / 100 | 169 / 450 | #00ffff | on | 0 | 0.26,0.26,0.3 | -0.83,0.36,-0.43 | 1,0.98,0.79 | 4 |
| z15SSH | 4 | 400 / 400 / 400 | 0 / 400 | #aaaaff | on | - | 0.17,0.17,0.02 | 0.18,0.69,0.7 | 1,1,0.71 | 0 |
| z16PYA | 4 | 400 / 400 / 400 | 300 / 400 | #00ffff | on | -400 | 0.23,0.23,0.27 | 0,0.64,0.77 | 1,1,0.81 | 0 |
| z17WAS | 1 | 400 / 400 / 400 | 300 / 400 | #00ffff | off | - | 0.3,0.3,0.3 | 0.01,0.98,-0.17 | 1,1,1 | 0 |
| z18MMP | 4 | 150 / 125 / 100 | 83 / 125 | #000000 | on | - | 0.4,0.4,0.4 | -0.1,0.87,-0.48 | 1,1,1 | 10 |
| z20DSP | 4 | 700 / 550 / 400 | 314 / 550 | #00ffff | on | - | 0.2,0.19,0.1 | -0.4,0.73,-0.55 | 1,1,1 | 0 |
| z21FSH | 4 | 800 / 450 / 100 | 169 / 450 | #00ffff | off | - | 0.4,0.4,0.4 | 0,0.97,0.26 | 1,1,1 | 0 |
| z22BIP | 4 | 500 / 450 / 400 | 180 / 450 | #00ffff | on | - | 0.55,0.55,0.55 | 0.93,0.36,0.03 | 1,1,1 | 12 |
| z23DIP | 4 | 500 / 400 / 300 | 80 / 400 | #00ffff | on | -80 | 0.36,0.36,0.42 | 0.17,0.63,-0.75 | 1,1,1 | 5 |
| z27TRX | 4 | 250 / 250 / 250 | 150 / 250 | #cacce1 | on | - | 0.22,0.22,0.26 | 0.5,0.43,-0.75 | 1,1,1 | 13 |
| z28HAT | 4 | 300 / 190 / 80 | 95 / 190 | #ffe8a6 | on | - | 0.18,0.18,0.24 | 0.71,0.45,-0.54 | 1,0.86,0.78 | 9 |
| z36CNT | 26 | 53 / 53 / 53 | 43 / 53 | #000000 | off | - | 0.2,0.2,0.2 | 0,0.84,0.54 | 0.82,0.91,1 | 0 |
| z38PAR | 4 | 1600 / 1600 / 1600 | 1400 / 1600 | #ffffff | on | - | 0.55,0.55,0.55 | 0.33,0.84,0.43 | 1,1,1 | 3 |
| z39ASB | 1 | 3200 / 3200 / 3200 | 3100 / 3200 | #000000 | off | - | 0.12,0.12,0.13 | -0.11,0.66,-0.74 | 1,1,1 | 1 |
| z40aPO | 4 | 4000 / 4000 / 4000 | 3400 / 4000 | #000000 | on | - | 0,0,0 | -0.68,0.6,-0.43 | 1,1,1 | 7 |
| z40OGL | 4 | 200 / 140 / 80 | 70 / 140 | #000000 | on | -96 | 0.02,0.02,0.02 | -0.06,0.84,0.54 | 1,1,1 | 9 |
| z41MAP | 4 | 300 / 300 / 300 | -300 / 300 | #ffffff | off | - | 0.21,0.25,0.4 | 0,0.37,-0.93 | 0.85,0.91,1 | 0 |
| z42BRP | 4 | 1500 / 1500 / 1500 | 900 / 1500 | #000000 | off | - | 0.27,0.38,0.48 | -0.77,0.54,-0.34 | 0.82,0.91,1 | 4 |
| z50LTC | 4 | 800 / 450 / 100 | 169 / 450 | #00ffff | on | -800 | 0.14,0.16,0.2 | 0,0.75,0.66 | 1,0.67,0.52 | 0 |
| z60FRE | 4 | 1500 / 1500 / 1500 | 900 / 1500 | #ffffff | off | - | 0.6,0.6,0.6 | 0,0.64,0.77 | 1,1,1 | 0 |

**Which `SetupFog` call is in effect (R8, settled in `src/game/fogphases.ts`, checked in `tools/tests/render.mjs`)**: `FUN_00442d90` stores the zone's fog and applies it at once, so the call that ran last wins. The zone loops (about 30 near-identical copies, read one by one) follow one template:
the zone's set-up helpers run before the loop; the fade-in (mode 7) shows their last fog; **when the fade-in completes the loop calls SetupFog with the play values** (`case 7` of `FUN_005cd33d`, `FUN_005f418b`, `FUN_00706bee` ...), which stay until the zone is left; a restart (exit state 3) calls SetupFog with a black fog after the
fade-out, re-runs the helpers and shows that during the next fade-in. The play call is the first call by address that `extractRenderParams` lists in every zone with several calls (z08BKD 3, z09JST 3, z10RGB 4, z13CAI 2, z15SSH 2, z17WAS 3, z20DSP 3, z21FSH 3, z22BIP 3, z28HAT 3, z42BRP 2; the calls of z13CAI / z15SSH are identical, z42BRP's
`FUN_008212a3` calls its 400 / 400 black fog first and then `FUN_00820f4e(1)`, whose 1500 / 1500 / 600 black fog (fog off) is the last: the first by address) **except z40OGL**: its hub set-up function `FUN_007e3bd1` calls `SetupFog(4, 100, 300, 200, black, on)` when `DAT_00987660 == 0` (32-bit display) and `(4, 80, 200, 100, ...)` for the 16-bit low-end profile, whose call
comes FIRST in the code. The start / restart fogs differ from the play fog only for z08BKD (start: black, fog on; play: cyan), z09JST (restart black), z10RGB (start / restart: the 800 / 800 fog of `FUN_005f6340`, play 100 / 600 / 300) and the black restart calls; they only show during the 16 fade-in ticks.
`GameRenderer.currentFog` selects by the loop mode the shell reports (`loopMode`, `restarted`). Zones with several calls that other ports wired by hand (z03PPH, z18MMP, z27TRX: `useFogCall`) keep that.
Zones without a sea record but with `sea y -` and records `SSEA` keep the global at 0: **settled**: `DAT_009da858` starts at 0 and is reset to 0 by the destroy slot of the sea node (`FUN_00426759`), so a zone that never stores it has 0 (the previous zone's value can only survive when its sea node was not destroyed).

---------------------------------------------------------------------------------------------------------------------------

## 4. Material and render-state model

### 4.1 The 30 state blocks (Material2.cpp: `FUN_00408b36`, `FUN_004090a7`, `FUN_004092fd`)

The engine does not change individual render states per draw. At start-up (`FUN_00408b36`, also after every device loss / `FUN_0040979c`) it builds the **base state** and then **30 pre-recorded state blocks**
(`CreateStateBlock(D3DSBT_ALL)` after applying the 11 entries of each row of the table at VA **0x89b020**, 0xb0 bytes per preset, entry = `{kind (0 = texture stage state, 1 = render state), stage, type, value}`).
`FUN_004092fd(n)` selects block `n` (`ApplyStateBlock`) and sets `SPECULARENABLE = 1` for blocks 4, 5, 0x13, 0x14 and 0 for the others (`FUN_004090a7`). If a block cannot be created (`ValidateDevice` fails) the code falls back to block 9 / 3 (`FUN_00409090`).

**Base state** (`FUN_0040788f`, then the default structs of `FUN_00408714` / `FUN_004088dc` applied by `FUN_004076a5` / `FUN_00407703`; everything the blocks do not override):

| state | value |
|---|---|
| ALPHATESTENABLE / ALPHAREF / ALPHAFUNC | **on / 1 / GREATEREQUAL** (a fragment passes when its alpha byte is >= 1) |
| CULLMODE | **CCW** (counter-clockwise triangles are culled; clockwise = front, formats.md 7.2) |
| ZENABLE / ZWRITEENABLE / ZFUNC | 1 (2 = W-buffer when supported) / 1 / LESSEQUAL (blocks override ZENABLE and ZWRITE together) |
| SHADEMODE | GOURAUD |
| FILLMODE | SOLID |
| D3D lighting | **`LIGHTING = 0`**, `AMBIENT = 0`, `COLORVERTEX = 1`, `DIFFUSEMATERIALSOURCE = COLOR1`, `SPECULARMATERIALSOURCE = COLOR2`: vertices carry pre-lit colours (section 5) |
| texture stage 0 | `MAGFILTER = LINEAR`, `MINFILTER = LINEAR`, `MIPFILTER = POINT` (irrelevant: textures have **one mip level**), `ADDRESSU/V = WRAP` (changed per texture, 6.3), `TEXCOORDINDEX = 0`, `TEXTURETRANSFORMFLAGS = 0` |
| texture stage 1 | `COLOROP = DISABLE` (no multitexturing, no light maps; the second UV set of the vertices is unused) |
| fog | linear, see 3.2 (`FOGENABLE` per zone), `RANGEFOG = 0` |
| other | `DITHER = 0`, `ANTIALIAS = 0`, `STENCIL = 0`, `LASTPIXEL = 0`, `TEXTUREPERSPECTIVE = 1`, `CLIPPING = 1`, `ZBIAS = 0` |

**Presets.** `COLORARG1 = TEXTURE`, `COLORARG2 = DIFFUSE`, `ALPHAARG1 = TEXTURE`, `ALPHAARG2 = DIFFUSE` in all blocks. Colour op: `tex` = SELECTARG1 (texture only), `mod` = MODULATE (texture * vertex colour),
`diffuse` = SELECTARG2 (vertex colour only; the texture then only provides alpha). Alpha op: `one` = DISABLE (alpha 1), `tex` = SELECTARG1, `mod` = MODULATE (texture alpha * vertex alpha), `diffuse` = SELECTARG2,
`mod4x` = MODULATE4X. Blend: `alpha` = SRCALPHA / INVSRCALPHA, `add` = SRCALPHA / ONE, `a/a` = SRCALPHA / SRCALPHA.

| # | colour | alpha | blend | Z test+write | used by |
|---|---|---|---|---|---|
| 0 | tex | one | off | on | mesh mode 6 |
| 1 | tex | tex | alpha | on | mesh mode 2 (sky, shore foam, unlit translucent things) |
| 2 | mod | one | off | on | - |
| **3** | **mod** | **tex** | **alpha** | **on** | **default mesh state (modes 0, 1)**, shadows, sprites of the 2D layer, particle material 2 |
| 4 / 5 | mod | one / tex | off / alpha | on | + specular (preset 5: specular meshes, brick batches) |
| 6 | mod | mod | alpha | on | particle material 0 |
| 7 | diffuse | mod | **add** | on | particle material 1 (additive glow) |
| 8 | diffuse | mod | a/a | on | - |
| 9 | diffuse | tex | add | on | - |
| 10 / 11 / 12 | diffuse | mod | alpha | on | - |
| 13 (0xd) | tex | mod | alpha | on | mesh mode 5 |
| 14 (0xe) | diffuse | diffuse | alpha | on | untextured diffuse (debug lines `FUN_0087da0b`) |
| 15 | tex | one | off | **off** | - |
| 16 (0x10) | tex | mod | alpha | **off** | **sea plane and seabed**, fade overlay, mesh mode 3 |
| 17 | mod | one | off | off | - |
| 18 (0x12) | mod | tex | alpha | off | font glyphs, mesh mode 4 |
| 19 / 20 | mod | one / tex | off / alpha | off | + specular |
| 21..29 | diffuse (mod4x for 22, 24, 28) | mod / diffuse | alpha | off | 2D untextured rectangles (0x1d), mesh mode 7 uses 26 (mod / mod) |

`src/render/states.ts` contains this table (`PRESETS`).

### 4.2 Mesh groups, draw passes, transparency

* A mesh group (formats.md 4) has `flags` (draw pass), a texture slot (byte at +2 of the 0x14-byte group record) and an index range. **`flags & 0x7f` is only the pass number:** `FUN_0088aca2` draws the groups
  three times: pass 0 = groups with flags 0, pass 1 = flags 1, pass 2 = everything not drawn yet (flags >= 2). Within a pass the groups are drawn in file order, one `DrawIndexedPrimitiveVB(TRIANGLELIST)` per group.
  The render state is set **once per mesh**, not per group, and does not depend on the group.
* **Opaque, cut-out and translucent surfaces all use the same state (preset 3)**: blending is always on, `ALPHAOP = SELECTARG1` takes the alpha from the texture, the alpha test (>= 1/255) removes fully transparent texels,
  and **Z writes stay on** also for translucent pixels. Translucent surfaces therefore only look right if the content creator put them in a later pass (flags 1 / 2) or a later record; the engine does no sorting.
  Textures without an alpha channel get alpha 255 (24-bit TGA), so they are opaque.
* **Mesh `mode`** (third argument of `FUN_0087d9a7` = the `+0x10` field of a model PART record; every builder creates its parts with mode 0, `FUN_00444550(record, partMask, mode)` changes it: bit i of `partMask` = LOD part i of the record's model;
  also called at run time) selects the block:

| mode | block | lighting computed first | meaning |
|---|---|---|---|
| 0 | 3 | once, at the first draw of the MESH (`mesh+0x60` flag, never cleared) | normal lit object |
| 1 | 3 | at every draw (`FUN_0088abcc`) | lit object that moves / turns (characters, vehicles, the island's dynamic set, `FUN_0051c823`'s roster of vehicle records) |
| 2 | 1 | no | unlit, alpha-blended, depth on (sky, shore foam, holograms, portals) |
| 3 | 0x10 | no | unlit, no depth (seabed, sea) |
| 4 | 0x12 | once | lit, no depth test (overlay-like objects) |
| 5 | 0xd | no | tex colour, alpha = tex * vertex alpha |
| 6 | 0 | no | unlit opaque |
| 7 | 0x1a | no | modulate / modulate, no depth |

  The record-level draw `FUN_00444480` picks the LOD part and calls `FUN_0088aca2` with ITS mode; a record that has a skeleton (`record + 8`, the animated draw `FUN_004440f0`) draws its base mesh with `FUN_0088b87b`, which ignores the part's mode
  (always block 3, skinned and lit at every draw with `FUN_0088589e`, or `FUN_00885e33` / block 5 for a shiny mesh; a mesh without skin data (no `SVWL` chunk, `*mesh != 0`) is drawn with the colours its vertex buffer has: not lit) and its
  attached models with `FUN_0088b4c0` in mode 1 (lit at every draw; the same LOD index as the base mesh, clamped to the child's part count), followed by the blob shadow `FUN_00444940` (section 9).
  The meshes are shared: one mesh object per mesh file slot, so all records that use a mesh share its vertex colours (the first record to light it in mode 0 decides for all; a mode 1 record re-lights the shared buffer at every draw).
  A mesh can also carry its own state callback (`mesh+0x8c`, set by `FUN_00444790`) which overrides the switch: the sea plane uses it (callback returns 0x61, `FUN_00883fad` maps 0x61 -> block 0x10,
  0x62 / 0x63 -> block 6, anything else -> block 3). **[port]** `GameRenderer.setPartMode(record, mask, mode)` = `FUN_00444550`; the extraction (`ZoneSetup.modes`, emulated set-ups too, now including the vehicle roster's mode 1) is applied per part.
  Modes seen in the zone set-ups: 1 for the vehicle records of the island and the hubs (`FUN_0051c823` list at `0x8e9c30`, SBRD, LOON, BRID x6, Pepper and the toppings of the house, z20DSP's BBT, z60FRE ...), 2 for the shore foam, holograms, portals, 5 for the island's wake and the castle's walkways, 3 for z40aPO's targets.
* Skinned meshes (`FUN_0088b87b`, `FUN_0088bd34`, `FUN_0088c367`): the joints are skinned on the CPU every frame, the lighting is recomputed per frame (`FUN_0088589e`, directional lights + ambient only, the skinned normals are NOT renormalised) and all groups are drawn with block 3 (block 5 for a shiny mesh).
* **Specular** ("shiny") meshes: a model can be switched to vertex format 0x2c2 (`FUN_00883013(mesh, 1)`, called for every part and attachment by `FUN_004446c0(record, 1)`; 28 calls in the island's set-ups (AMBU, SPD0-2, PCAR, LOON, SBRD, BRID x6), 24 for the house's trophies and Pepper (z03PPH), 17 PONT of z04IFC,
  Pepper / mummies / spiders / coffins of z18MMP, Pepper in z17WAS and z60FRE ...); lighting then also writes a specular colour `pow(H.N, 16) * colour * 128/255` for `H.N > 0.9` (`FUN_0088612c`; skinned meshes `FUN_00885e33`: power 8, threshold 0.92, factor 220/255) next to the diffuse colour.
  **SPECULARENABLE is on for every draw**: `FUN_004090a7` sets it (1 for blocks 4, 5, 0x13, 0x14, else 0) BEFORE it applies the state block, and the 30 blocks were created with `D3DSBT_ALL` after the base state (`FUN_0040788f`) had set `SPECULARENABLE = 1`,
  so applying any block restores 1. A 0x242 mesh has no specular colour (nothing is added); a 0x2c2 mesh always shows its highlights, also when its lighting function selected block 5 and the caller then selected block 3 (modes 0 / 1). The brick batches (section 10) use block 5.
  Meshes are loaded as FVF 0x242 (`XYZ | DIFFUSE | TEX2`, 32 bytes); 0x2c2 adds `SPECULAR` (36 bytes). **[port]** `Renderer.setShiny`, `GameRenderer.setShiny`, `ZoneSetup.shiny` (the extraction / emulation records the `FUN_004446c0` calls).
* **Environment (sphere) mapping** exists in code (`FUN_00884002` / `FUN_00884128`: texture transform `[.5 0 0 0; 0 .5 0 0; 0 0 1 0; .5 .5 0 1]`, `TEXCOORDINDEX = CAMERASPACENORMAL`, `TEXTURETRANSFORMFLAGS = COUNT2`, vertex format 0x212 `XYZ | NORMAL | TEX2`, `WRAP0 = 7`)
  but the flag that enables it (`mesh+0x64`, set only by `FUN_0088350d(-999)`) is never set by any call site in the executable: **dead code** (checked by scanning the 27 callers; **UNCERTAIN** only if a call goes through a path I did not trace).
* Culling of whole meshes: each mesh keeps 8 box corners; `FUN_00416454` computes outcodes against the six frustum planes (`DAT_00987db8`) and a mesh is skipped when the AND of the 8 outcodes is non-zero (`FUN_0088aca2`).
  Meshes the set-up code partitions (`FUN_00444530` -> `Carve.c` `FUN_0088069b`, names `Part%d_%d_%d.msh` in its export function) are drawn through their cells (`FUN_0088b1e5`): that changes the draw order and duplicates triangles, section 4.2a. Records are tested with their collision sphere (`FUN_00444370`, `FUN_004164f1`).

### 4.2a Partitioned meshes (`FUN_00444530` = `Carve.c`'s `FUN_0088069b`), item 10, 2026-10-31

The set-up code of eight zones calls `FUN_00444530(FUN_0043f160(model of record R, 0), nx, ny, nz)` (the executable has 16 call sites; `tools/tests/render-partition.mjs` decodes all of them): z02LGI (LAND record 4 and SEAB record 0, 8x1x8), z05WAB (tape reel G001, record 3, 8x1x8), z09JST (LAND, 8x1x8), z10RGB (LAND, 20x1x1),
z13CAI (LAND 4 and SEAB 0, 8x1x8), z15SSH (LAND, 1x1x20), z27TRX (LAND record 0: 1x1x150; SKY0, SKY1, range_01, range_02 = records 29..32: 1x1x20), z28HAT (LAND 1, tree canopies 4 and 5: 8x1x8; only the first set-up function: the restart set-up `FUN_00791990(0)` skips it).
It is NOT only a culling aid, it changes what is drawn:
* `FUN_0088069b` cuts the bounding box of the vertices (widened by 1.0 on every side) into `nx * ny * nz` cells and gives each cell its own sub-mesh with copies of the triangles that touch it (a triangle is rejected from a cell only when its three vertices lie outside ONE common side plane of the cell: `FUN_008804e3`). Triangles that straddle
  cells, and big triangles that merely reach a neighbouring cell's planes, are therefore in several cells (30 - 40 % extra triangles in the meshes above: `render-partition` prints the numbers); per cell the triangles keep file order inside each group.
* From then on `FUN_0088aca2` draws the mesh through `FUN_0088b1e5`: **group-major, cell-minor** (`for group: for cell: draw`), without the three passes of the unpartitioned mesh (so a group with flags 1 / 2 is NOT postponed: z15SSH's LAND has a flags-2 group in the middle of its list), no group matrices (MATL), and a triangle in two cells is drawn twice
  (blending is always on and Z writes stay on, 4.2: a translucent texel of such a triangle is blended twice; for opaque texels nothing changes). Cells are culled by their eight corners (`FUN_00416454`), which cannot change a pixel. The cell draw selects block 3 / 1 / 0x10 / 0x12 / 0xd for modes 0 / 1 / 2 / 3 / 4 / 5 as the plain draw does, but mode 4 does not
  light, and modes 6 / 7 select nothing (the plain draw: blocks 0 / 0x1a). Lighting is per cell with the same functions (all cells are lit in the first loop whether visible or not, so "lit once" happens at the mesh's first draw as before).
* **[port]** `src/render/partition.ts` (`partitionMesh` = `FUN_0088069b`'s binning, float32 / 24-bit x87 like the original, `cellIndexOrder`, the `PARTITIONS` table), `Renderer.partitionMesh` (rebuilds the index buffer group-major / cell-minor; `MeshGpu.partitioned`: `drawMesh` draws the groups in file order without passes or group matrices), `GameRenderer` applies the table of the zone at construction.
  Verified: `tools/tests/render-partition.mjs` runs `FUN_0088069b` natively on the x86 emulator (hosted allocator, DAT_0098764c = 1) and compares the vertices of every triangle of every cell and group, in order: 24,244 triangles of the zones' real meshes (13,219 by default = the meshes up to 1500 vertices, the rest up to 7000 vertices with `PARTITION_FULL=1`, 1 minute; the 10 - 33 k vertex terrains take the original hours in the emulator and are not run, they use the same code) and 8,391 triangles of random soups (all grid sizes incl. 1x1x20 / 8x1x8 / 20x1x1, float boundary cases): 0 differences; the 16 call sites against the table. Not reproduced: modes 6 / 7 of a partitioned mesh keep the previous state block (none of the 16 meshes uses them).

### 4.3 Vertex colour, alpha and winding

* The mesh files hold white vertex colours (`0xFFFFFFFF`); the engine overwrites the diffuse colour of every vertex with the lit colour (section 5) and keeps alpha 0xFF. No baked lighting exists in the data.
* Back faces are culled for every mesh (`CULLMODE = CCW`), including the sky and sea. **[viewer]** draws with the same winding.
* There is no depth bias, no stencil, no scissor; `TEXTUREFACTOR` is white and unused.

---------------------------------------------------------------------------------------------------------------------------

## 5. Lighting

D3D lighting is **off**. The engine lights vertices itself on the CPU (Lights.cpp) and uploads them as diffuse (and specular) vertex colours, so the result is Gouraud-interpolated per-vertex lighting.

* **Light file** `lights/lights.lgt` (format: `src/formats/lights.ts`, formats.md 8.3.6), loaded per zone by `FUN_008864b6` (-> `FUN_008849c6`) into a runtime light set (`DAT_05d5fafc[n]`, 100 bytes per light: type +0, position +4 / +0x28,
  direction +0x10, diffuse +0x4c, range +0x5c, 60.0 at +0x60); **all meshes use set 0** (`FUN_0088abcc` reads `*DAT_05d5fafc`). The conversion:
  * file type 2 (directional) -> runtime kind 1; **if its direction's Y is negative, Y is negated**; the vector is thus the direction **towards** the light with `y >= 0` (z02LGI: file `(0.71, -0.60, 0.37)` -> `(0.71, 0.60, 0.37)`); not normalised
    by the loader (the shipped vectors are unit length);
  * file types 0 (point) and 1 (spot, never seen) -> runtime kind 2 (point) whose range field is **1.0** (`+0x5c`); the only function that would use 60.0 (`+0x60`, `FUN_00884f68`) and the D3D light setters (`FUN_00884370` ... `FUN_00884598`)
    have no callers. **Settled (R17):** a point light reaches a mesh vertex only within 1.0 unit (`FUN_00885a9a`: intensity `(1 - d / 1.0) * max(0, N . unit(light - vertex))`, static 0x242 meshes only: the skinned and the 0x2c2 functions ignore point lights);
    z14OSD / z18MMP / z22BIP / z23DIP / z27TRX / z28HAT / z40OGL / z40aPO / z42BRP have 3 to 13 such lights;
  * **ambient** = the component-wise maximum of the `ambient` colour of **all** records of the file (appended as the last entry, kind 0); the last record is dropped when its type is not 0..2; the loader reads `declaredCount` records and a file holds fewer
    (the rest read as zero = black point lights). The `specular` colour of the file is unused.
  * No `lights.lgt` (never in the shipped data): `FUN_0088465a` builds a default set but leaves the light count at 0 (`FUN_00884230` constructor): **settled**, everything lit by that set is black.
* **Per draw** (`FUN_00885664(lightSet, worldMatrix)`, the D3D world matrix of that moment: the record's matrix, for an attached model the bone-composed one; a group's own MATL matrix does not count): for each directional light the object-space
  vector `L = normalize(dir . rows(M))` (`FUN_0043b0c5`: the direction times the matrix's rows, i.e. `M` applied to `dir`, then normalised; for a scaled matrix that is NOT the inverse), the half vector `H = normalize(normalize(eye - M.translation) + dir)` in world space
  taken into object space the same way (not normalised again), and point lights as `lightPos - M.translation` rotated the same way.
* **Per vertex** (`FUN_00885a9a` static meshes, `FUN_0088589e` skinned, `FUN_0088612c` / `FUN_00885e33` shiny), for each channel, with `N` the vertex normal (from the mesh's separate normal array, object space, NOT renormalised, for skinned meshes the skinned sum):

  ```
  acc = 0
  for each directional light:  I = max(0, N . L);  acc = acc + (1 - acc) * I * diffuse      ("screen" blend of successive lights)
  colour = max(acc, ambient)
  ```

  then `(int)ROUND(colour * 255)` (`fistp`: nearest, ties to even) per channel into the vertex diffuse dword (`G * 0x100 + R * 0x10000 + B`, the 0x242 variants keep the alpha byte, the 0x2c2 variants write `... - 0x1000000`, alpha 0xff). The texture stage multiplies
  (`MODULATE`, no 2x / 4x), so the final pixel is `texture * max(ambient, N.L * sun)` (+ specular for shiny meshes). For z02LGI: grass facing up is lit with 0.60, faces turned away from the sun fall back to the ambient 0.18 / 0.18 / 0.24 (bluish shade).
* **When**: mode 0 / 4 meshes at their first draw only (`mesh + 0x60`; the first record that draws the mesh decides the colours of all records that use it), mode 1 meshes, attached models and skinned meshes at every draw (section 4.2).
* **[port] verified against the original**: `src/render/meshlight.ts` ports `FUN_00885664`, `FUN_00885a9a`, `FUN_0088589e`, `FUN_0088612c` and `FUN_00885e33`; `tools/tests/render-light.mjs` runs the original functions on the x86 emulator for random light sets (directional / point / ambient), rotated, scaled and
  non-uniformly scaled matrices and random normals / positions: all 69,120 diffuse and specular bytes agree exactly (including the specular vertices). `Renderer.drawMesh` lights on the CPU into per-mesh vertex-colour buffers with the rules above (`lit: 'once' | 'always' | 'never'`
  from the mode, `skinned`, shared by all records of a mesh, reset per zone by `resetLighting`); the old per-vertex shader lighting is gone. Light colours are evaluated once per draw and mesh, not per pixel: Gouraud interpolation of the 8-bit vertex colours as in D3D.

---------------------------------------------------------------------------------------------------------------------------

## 6. Textures

### 6.1 Loading (TextureManager.cpp)

`FUN_004100a1` (`.tga`), `FUN_004112ac` (`.wib`, replaces the extension when no `.tga` exists), registered per zone through `text.txl` / `text.opt` (formats.md 5.3, 5.4).

* TGA: 8-bit paletted, 24 and 32 bit, raw or RLE (`FUN_0040fcb9` / `FUN_0040fae2`). Rows are used **as stored** (the origin bit is ignored): file row 0 is texture row v = 0 (formats.md 5.1: bottom-up files, V unchanged).
* **Format choice**: the loader counts the distinct alpha values (24-bit files count as alpha 0). Classes: "one value that is 0 or 255, or exactly two values" -> ARGB8888, else ARGB1555; "three or more values, or a single other value (e.g. the constant 128 of the water)" -> ARGB8888, else ARGB4444, else ARGB1555.
  On every current 32-bit capable card all textures are therefore **ARGB8888**; 16-bit formats (565 / 1555 / 4444) are only fallbacks (`FUN_0040dd5f(n)`: 0 = 565, 1 = 1555, 2 = 4444, 3 = 888, 4 = 8888).
* **No mipmaps**: the DirectDraw surface is created with `DDSD_CAPS | HEIGHT | WIDTH | PIXELFORMAT` and caps `DDSCAPS_TEXTURE` + `DDSCAPS2_TEXTUREMANAGE` (managed), without `DDSCAPS_MIPMAP`. Sampling is bilinear without mip levels
  (distant textures shimmer). **[viewer]** has `mipmaps` off by default for this reason (checkbox "mip maps").
* **Resolution**: full size by default. Half size (`width/2 x height/2`) is used only when `DAT_0089df44 == 0` (texture-quality option 0x12 set to low, `FUN_0040cf18` / `FUN_0040cf38`, or < 4 MB video memory) and bit 7 (0x80) of the texture's flag byte is clear.
  Sizes are also clamped to the device limits and made square when the device requires it.
* Textures are NOT colour-keyed; transparency is alpha only.

### 6.2 Animated textures (.wib)

Loader `FUN_004112ac`: `WIBF` (sequence), `WIBT` (header + frames); frames are kept in system memory in the target format. **Playback** (`FUN_00410ff8`, called for every animated texture once per drawn frame by `FUN_004111a3` from `FUN_004126fd`; WP-TIME: exact, `Renderer.stepTextures`):

```
idx = ftol(timer)                                       (timer = texture struct +0x20, a float32; +0x24 = the entry shown last, +0x28 = the mode)
if mode == 2 and idx == last: nothing                   (stopped)
else: copy the image seq[idx] into the texture surface (the port: `want`, uploaded once per drawn frame), last = idx
      if mode != 2: timer = 1.0 * DAT_008b1718 + timer  (one float32 add)
                    if sequenceLength <= timer:  mode 0 -> timer = 0 (restart, the overshoot is dropped);  else timer = sequenceLength - 1.0, mode = 2
```

The step is per PASS of the main loop (one sim step of the port's 60 Hz loop = one drawn frame of the original), `1.0 * dt` entries per pass: at dt 0.5 every entry is shown for two passes, at dt 1 for one. The loader `FUN_004112ac` ends with one such pass (mode 0, timer 0, so the timer of a fresh texture is `1.0 * DAT_008b1718` at the load, checked by running the original loader in the emulator (`wp-time-wib-load`): `Renderer.loadDt` = the dt the zone is loaded with, `GameRenderer` sets it from the world's dt = the previous loop's last value, 0.5 after a loop at 60 Hz, 1.0 at boot; the timer restarts at 0 when the sequence is not longer than that first step). The browser draws at the display rate, with at most one pass per drawn frame (`FrameClock`, a late frame is one pass with the measured, larger dt): `World.advanceDt` logs every pass (`passes`, `passDt`, `passEye`; `stepView` the pass's far / fog) and `GameRenderer.render` steps the textures once per pass it has not drawn yet (no pass between two rAF calls = the last frame again).

`FUN_00411202` (`FUN_0041270c`, called by cut-scene / face code) sets the mode (0 loop, 1 play once, 2 stopped) and the start frame of a texture: this is how the 16-frame **expression sheets** of the characters are driven
(they are frozen on one frame and changed on demand). Water, fire, portals, screens and the like simply loop. Sequence entries repeat frames to hold them longer (e.g. `[0,0,1,1,1,2,2,...]`).
**[viewer]** plays all `.wib` with a sequence at 30 entries per second (`updateTextures(dt * 30)` per rAF frame), except the 16-frame identity-sequence sheets, which stay on frame 0.

### 6.3 Addressing and filtering

Per-texture flag byte (`text.txl`, formats.md 5.4) bits 0 / 1: set = `D3DTADDRESS_WRAP` (1), clear = `CLAMP` (3) for U / V; stored in the texture record (+0x88 / +0x8c) and applied with `SetTextureStageState(ADDRESSU / ADDRESSV)` every time
`FUN_00412243(stage, slot)` binds a texture for a mesh group. Filtering is bilinear (MAG and MIN LINEAR). A group whose slot has no texture (-1) gets texture 0 of the zone (`FUN_00412243` clamps negative ids to 0; sprites / faces replace them at run time).

---------------------------------------------------------------------------------------------------------------------------

## 7. The world: sky, sea, seabed, LOD, culling

The zone's first records are special behaviours (`seabed.c`: `FUN_004266ca` seabed, `FUN_00426915` sky, `FUN_00426da4` sea, `FUN_00426f55` flowing water / lava; registered with `FUN_00423532(record, behaviour, ...)`
in each zone's set-up code; vtable draw entries `FUN_00426659`, `FUN_004267d2`, `FUN_00426a43`). The mesh files contain **unit shapes** that the code re-places every frame.

### 7.1 Sky dome (`SSKY`, mode 2 = block 1, `FUN_004267d2`)

* `sky.msh` is a unit half-sphere (x, z in -1..1, y in 0..1). World matrix each frame (`FUN_0043a742`): rotation about Y by the dome's angle, **scale (1.2 * fogEnd, cameraY + 100, 1.2 * fogEnd)**, translation **(camera x, record y, camera z)**
  (`FUN_00442dc0` returns `fogEnd * 1.2`, constant `0x8920e8`). So the dome follows the camera horizontally, its apex is always 100 units above the camera, its rim lies beyond the far plane (radius 1.2 * far).
* The angle advances by **0.000436332 rad per tick** (0.75 deg/s, one turn per 8 minutes) where the zone enables it (the island does: `FUN_00426915`'s parameter `!= 0`).
* State: block 1 (texture colour unlit, texture alpha, blend, depth on), fog applies normally: the dome fades to the fog colour towards its rim, which gives the horizon haze.

### 7.2 Sea plane (`SSEA`, block 0x10 = no depth, `FUN_00426a43`)

* `pPlane1.msh` is a 20x20 grid spanning **-0.5 .. 0.5** with UV 0..1 (one texture repeat over the whole plane); texture e.g. `Text004` (128x128, uniform alpha 128, teal).
* Each frame: scale **x = z = 2.5 * range**, y = 1 (range = far plane, or the fog end when that is smaller), y position = the sea level `DAT_009da858` (set by the zone's set-up code, z02LGI **2.4**; the table in 3.2 lists the others).
* Horizontal position: an **anchor** that starts at the camera and re-centres in steps of **0.1 * scale (= 0.25 * range)** whenever the camera is further away than one step, plus an **orbit offset** that makes the water "move":
  `phaseA += 1 deg/tick`, `phaseB += 0.67 deg/tick`, `offset.x = 4 * (cos(phaseB) + sin(phaseA))`, `offset.z = 4 * (sin(phaseB) + cos(phaseA))` (+-8 units, periods 12 s and 18 s).
  **There is no UV scrolling on the sea plane**; the visible motion is this slide plus the animated textures of the shore foam.
* The plane is drawn with block 0x10: no depth test and no depth write, texture colour with alpha = texture alpha (128 = 50 %) * vertex alpha, SRCALPHA/INVSRCALPHA. It lies over the seabed (drawn before it) and is overpainted by land and objects.

### 7.3 Seabed (`SEAB`, mode 3 = block 0x10), shore foam (`SEAE`, drawn by its hook in mode 3 = block 0x10)

`SeaBed.Msh` is real terrain below the water (x -537..537, y -44..2.8 in z02LGI); drawn first, unlit, without depth. `Sea.Msh` / `wash.msh` (`SEAE`) is the white foam rim along the coast, drawn unlit by the SeaAmin draw hook FUN_004b109e, which calls the mesh draw with mode **3** (block 0x10, no depth; not the part's mode 2 / block 1 that the default draw would use: the hook replaces the default draw, returns 1, runs every pass the node ran with no visibility test; WP-TIME `wp-time-foam-hook`).
The behaviours are bound to specific record indices by each zone's set-up code, not by name: z38PAR reuses the name `SEAB` for a palm tree (record 4), z20DSP has two `SSKY` records of which only the first gets the sky behaviour (the viewer therefore treats only the **first** record of each of the four names specially). In some zones the record order differs (z14OSD: SEAB, SEAE, SSEA; z09JST: SEAB, SSKY, SSEA, SEAE) and zones use other names (`SKY0`/`SKY1`, `SKY_` are static background meshes without behaviour).

### 7.4 Level of detail (`FUN_00443f90`)

A model has up to 5 parts (LOD meshes `_HR, _MR, _LR, _SLR, _BGR`, formats.md 6.3) with a `lod` value per part (0 / 20 / 40 / 70 / 100 for characters; 0 / 60 / 70 ... for terrain pieces). The part drawn is the **last i with `(lod_i)^2 < zoom * dist^2`**,
where `dist` is the distance from the camera to the **record's world position** (matrix translation, `FUN_0040c796` returns the squared distance) and `zoom` the camera factor `DAT_0089df2c` (1.0 normally; zooming in with a smaller factor makes the switch distance `lod / sqrt(zoom)` larger).
Models with fewer than 2 parts always use part 0. Record flag bits 0x100 / 0x200 / 0x400 pin LOD 0 / 1 / 2. The adaptive frame-time mode can raise the minimum LOD (`DAT_009e56bc`, table `0x8b576c` = 1.0, 0.8, 0.6, 0.4, 0.2, off by default). **[viewer]** `selectLod`.

### 7.5 Records and flags

Record `flags` (ushort at +0x60): bit 0 visible (set by the sphere test), bit 1 enabled, 0x10 environment object (sky / sea), 0x8000 hidden; a record is drawn when `(flags & 1) && (flags & 2) && !(flags & 0x8000)` (`FUN_00444480`).

---------------------------------------------------------------------------------------------------------------------------

## 8. Particles (FX_Particle.c, CParticle*.cpp)

* **Engine**: one global `DAT_05d3b09c` (`FUN_0044ec60`; created per scene by `FUN_00442900`), 150 sources, 150 swirls, up to 4096 sprites drawn per frame. Effect files are `.app` (appearance), `.emi` (emitter), `.mov` (movement), `.par` (script), `.swl` (swirl lists) under `_data/<zone>/particle/` and `GENERICBITS/Particle` (formats.md 8.8). The texture page is `particle/Text.opt` -> `Text000.tga`, an **8 x 8 sheet of 32-pixel sprites** (256 x 256).
* **Sprites are CPU-projected screen quads**, not 3D geometry (`FUN_0044f380`, `FUN_0044f4c0`, `FUN_0088841c`, `FUN_00887498`): each particle's centre is tested with `ComputeSphereVisibility` (a sprite touching the near or far plane is dropped),
  projected with `ProcessVertices`, **sorted back to front** (`FUN_00887ae5`, key = rhw) and drawn with FVF 0x244 (`XYZRHW | DIFFUSE | TEX2`), one `DrawIndexedPrimitive` per sprite (4-gon clipped to the viewport by `FUN_008885e0`).
  Fog is switched off for the whole particle pass, there is no lighting.
* **Quad**: half extent `K = size * rhw / fov * (viewportWidth / fovAtStart)` (a fudge, varies with 1/fov^2; UNCERTAIN whether intended), corners at the angle `a` (index into a 256-entry sin / cos table starting at 225 deg, built by `FUN_00454460`):
  `(x + c, y + s), (x - s, y + c), (x - c, y - s), (x + s, y - c)` with `s = sin[a] * K`, `c = cos[a] * K`. `fSCTIndex` / `fSCTIndexInc` in the `.app` files are the **start angle index and the spin speed** of this table (not colour indices).
* **UV**: sprite index `n = iSSprite + random in the sprite range` chosen at spawn; `col = n & 7`, `row = n >> 3`; U table `0, .125 ... 1.0`, V table `1.0, .875 ... 0` (the tables at 0x8b8510 / 0x8b8534 have a typo: entry 5 is 0.6125). No UV animation over the life.
* **Material** (`iMaterial` of the `.app`): 0 -> **block 6** (modulate, alpha blend), 1 -> **block 7** (vertex colour only, texture alpha as shape, **additive** SRCALPHA/ONE), 2 -> **block 3** (texture alpha only). All with Z test and write on and alpha test >= 1. Counts in the shipped files: material 0 x 31, 1 x 22, 2 x 16.
* **Colour / size over life** (`FUN_00452300`, `FUN_00453410`): start / end RGBA with random variation, linear interpolation per tick in 8.8 fixed point (alpha separately); size start / end with variation; life = `(rand * dLifespan + lifespan) * 30` ticks.
  Emission accumulates `(rand * dDensity + density) * dt` per tick (density is per **tick**, not per second; UNCERTAIN against the table in formats.md 8.8 which says per second), motion `v = (v + dt * gravity) * airResistance`, ground bounce through the collision list.
* **[viewer]** does not draw particles. **[port]** `src/fx/particles/draw.ts` + `sprites.ts` (WP-PART): the pass above, exact on the CPU side (verified against `FUN_0044f4c0` / `FUN_008885e0` / `FUN_00887ae5` in the emulator), D3D's visibility / ProcessVertices re-implemented; see docs/re/particles.md.

---------------------------------------------------------------------------------------------------------------------------

## 9. Shadows (`Shadow.bob`, `FUN_00444850`, `FUN_00444ed0`, `FUN_00444940`, `FUN_00444ef0`)

* Blob shadows. `Shadow.msh` is a 5-vertex, 4-triangle fan (4 corners + centre) with one group (flags 2); `Shadow/text.txl` lists 9 textures (all RGB 0 with alpha, `text001` is a 4-frame `.wib`):
  0 glider, 1 animated, 2 plane, 3 soft square, **4 round blob (default)**, 5 bird, 6 ship, 7 sparkles (the Pepper marker), 8 soft square.
* **Which zones**: only zones whose loop function calls `FUN_00444850` (loads `\data\shadow\shadow.Msh` and the textures, sets game var 0xc6 = 0 (marker off) and **var 0xc5 = 4** (Pepper's type), enables `DAT_009e5864`; `FUN_00444e90` at the zone's end disables it again) AND registers the terrain records
  the shadows are ray-cast against with `FUN_00444ed0(record)` (at most 0x40; with none registered `FUN_00444940` computes and draws nothing). Read from the code (`extractShadowSetup`, `tools/tests/render-shadow.mjs`): shadows exist in z01BPK (records 22, 32, 34), z02LGI (4, 5, 6, 0x186, 0x187),
  z03PPH (6), z07CSI (3, 4), z10RGB (4, 0x26), z13CAI (4, 5, 7, 8), z14OSD (3), z16PYA (1), z18MMP (0, 0x5c, 0x5d), z21FSH (4), z23DIP (2), z27TRX (0, 1), z28HAT (1, 4, 5), z40OGL (1), z41MAP (0), z42BRP (56 records 14..79 through a switch), z50LTC (1);
  **no shadows**: z04IFC, z36CNT and z60FRE (initialised, nothing registered), z05WAB, z08BKD, z09JST, z15SSH, z17WAS, z20DSP, z22BIP, z38PAR, z39ASB, z40aPO (never initialised). So the zones that switched Pepper's shadow off in the port (z15SSH, z22BIP, z38PAR, z40aPO, z36CNT)
  agree with the original; it needs no switch.
* **Which objects**: the shadow is drawn at the end of the animated record draw `FUN_004440f0` (records with a skeleton, right after the model and its attachments), and by node draw hooks of records the generic draw does not reach (`FUN_004bd41a`, the island's glider node vtable slot).
  Pepper (`PEPP`) uses the type from game variable 0xc5 (-1 = none) and, while var 0xc6 is set, the marker; every other record needs a controller whose flags have bit 0x10 or 0x40 and a squared distance of at most 6400 to the camera (`DAT_009da5e8..f0`), type 4.
  The shadow sits under the translation of bone 0 (hips) times the record matrix of a posed record unless var 0xa9 (PEPP_IN_VEHICLE) is set, else under the record's translation.
* **Geometry** (`FUN_00444940`, ported in `src/game/shadow.ts` and compared with the original code on the emulator: 60 random shadows + 17 markers, worst difference 3.8e-6): corner radius `R = radius[type] * 8` at the angles `a +- 0.785` and `a +- 2.356` (single precision constants, not pi / 4) around the heading
  `a = atan2(forward.x, forward.z)`; the centre is ray-cast down from `(x, y + rayStart[type] * 8, z)` (length 2400, radius 0.01, mask 3: `FUN_00441b10`) against each registered record in turn: the centre height is the highest hit, starting at the sea level
  (`DAT_009da858`); each corner is cast from `centre height + rayStart * 8` and moves onto a hit that is higher than the centre height (the last such record wins), a corner more than 16 above or below the centre height is clamped to it, and everything is lifted by `lift[type] * 8`.
  Tables (type 0..8, before the x8): radius `.25 1 .25 .6 .25 1 1 0 1`, rayStart `.25 1 .25 .5 .25 1 1 0 1`, lift `.01 .2 .01 .01 .01 .2 .2 0 .5`.
* **State**: `FUN_0043f1a0(shadow mesh, identity, texture, mode 0)`: block 3, lit once like any mode 0 mesh (the texture is black, so the colour is black whatever the light), black blob with alpha = texture alpha (round blob peaks at 205 / 255), depth test and write on. There is no fade with height.
* Pepper's flashing marker (`FUN_00444ef0`): texture 7 (mode 2), five points from the matrix of bone 10 times the record matrix: the centre `(-0.5, 2.27, -0.12)` in bone space, corners `(+-1, +-1, 0)` along the NOT normalised vectors right = `(-d.z, 0, d.x)` and up = `(d.x d.y, -(d.x^2 + d.z^2), d.y d.z)` of the unit view direction `d`
  (so it shrinks seen from above); visible while bit 3 of `_DAT_009e5868` is set, which grows by `DAT_008b1718` (the frame length in 1/30 s ticks) per call: 8 of every 16 ticks (**dt-scaled**).
* **[port]** `GameRenderer.drawBlobShadow(record, matrix, world, bones, eye, dt)` (called from the render loop for records with `rec.anim`, public for node draw hooks), `loaded.setup.shadow` (`ShadowSetup`: init call sites and registered records), vars 0xc5 / 0xc6 initialised like `FUN_00444850`,
  the rays through `CollisionWorld.rayRecord` (the hit cache of the original included; the "last polygon hit" the footstep sounds read is restored). Not drawn by the generic path: z38PAR's SHAD patch (flat quad by `vertexOverride`, not deformed), z10RGB's ball shadows (`FUN_005f8a7b` / `FUN_005f90f7`, model CSHD: zone code).

---------------------------------------------------------------------------------------------------------------------------

## 10. Other effects

* **Brick batches** (`Effects.c`, `FUN_0044d420`, `FUN_00886be0`, `FUN_00886b34`, flush `FUN_00447de0`): every visible brick's LOD mesh (distance^2 to the camera `< 1280` -> LOD 0, `< 7200` -> 1, else 2; the debug override `DAT_05d37024` is never set) is transformed on the CPU (positions `FUN_0043ab72`, normals `FUN_0043abe6`
  rotation rows, not renormalised) into one of two vertex buffers of 4096 vertices / 4096 16-bit indices (FVF 0x2c2, 36 bytes), palette UVs from the 32-entry table at 0x981980 (`u = 0.0625 + c * 0.125`, `v = 0.9375 - r * 0.125`: the first `split` vertices the first colour, the rest the second;
  a missing second colour (-1) reads the 8 bytes before the table (the string bytes `"c\\Li"` / `".cpp"`: `u = 2.9758521e29`, `v = 0`); the rasteriser then applies the texture's address mode from `text.txl`: WRAP keeps the fraction (a float above 2^24 has none: u = 0), CLAMP takes the edge (u = 1), v = 0 either way; `missingColourUv` in `draw.ts` resolves exactly that, `render-bricks.mjs` checks the vertex UVs of such bricks against the emulator), lit with `FUN_0088612c` against light set 0 and the identity matrix `DAT_05d5fb00` (the half vector therefore uses the direction from the world origin to the camera),
  flushed when the next brick would not fit (`0x1000 - n <= used`, vertices or indices; the buffers alternate) and once at the end of the frame after the records (before the particles) with block 5 (specular on), texture 0 of the brick archive. **[port]** `src/fx/bricks/draw.ts`
  (`BrickBatchCpu` + `Renderer.drawBatch`); `tools/tests/render-bricks.mjs` runs `FUN_0044d420` + `FUN_00886be0` on the emulator and compares positions (exact), palette UVs (exact, colour -1 included), indices, counters and all diffuse / specular bytes (exact, with the 24-bit x87 mode below).
* **View plane** (`FUN_0087f01e`, wrapper `FUN_00444500(y)`; **R6, settled**): the function has two passes with two planes: `local_c4` = (0, 1, 0, `y`) (the argument: 0 for z10RGB, -106 for z22BIP) and `local_44` = (0, -1, 0, 200) (y = -200).
  The TEXTURED pass runs only when `DAT_05d5faac != 0`, which only `FUN_0087f854(n1, n2, speed)` writes (and `DAT_05d5fac0` = `n1`: the texture of both stages; `DAT_05d5fab0[0..n1)` = 0.., `DAT_05d5fac0[0..n2)` = n1..: two frame lists of 4 entries, followed by the speed word and the phases `t1` / `t2`); nothing calls or references
  `FUN_0087f854`, so the original never draws it and `t1` / `t2` never advance. What it WOULD draw (**debug option of the port, default off**, below): the quad 8 units ahead (+-6 along the view's right and up vectors) clipped to the part BELOW the eye (`y < eye.y - 0.0001`), every vertex projected from the eye onto the plane `y = argument`
  (an infinite floor at the zone's level seen under the horizon), diffuse `0xCFFFFFFF`, texture set 0 `(x / 100 + 0.2 sin t1, z / 100 + 0.15 cos t2)` (set 1 `(x / 100, z / 100)` is unused: state block 0x10 has stage 1 off), `t1` / `t2` += 0.01 per drawn frame, block 0x10 (texture only, alpha = texture x vertex alpha, blended, no depth), far plane 2000, drawn BEFORE the coloured pass.
  The COLOURED pass always runs: the quad clipped to the part above the eye height + 0.01, projected onto the plane y = -200 (the argument is not used), cyan at the horizon vertices and `(0, ftol(255 d^2), 255)` elsewhere, block 0x1d, depth off, far plane 2000. For a camera above y = -200 (all of its callers' cameras) every vertex lies behind the camera: **nothing is visible**; below it is a cyan-blue surface seen from below.
  Callers: z10RGB's LAND node (`FUN_005f7709`, before the record) and z22BIP's SEAB node (`FUN_0070fc64`, after it; `y = -106`). `src/render/viewplane.ts` + `GameRenderer.setViewPlane` reproduce both passes (`tools/tests/render-viewplane.mjs` runs `FUN_0087f01e` on the emulator, the textured one after running `FUN_0087f854` itself:
  positions, colours, both texture coordinate sets, indices and the 0.01 phase step are bit for bit equal); a wider canvas gets a proportionally wider quad.
  **Debug switch for the textured pass**: only with the debug option (start page "Debugmenu", or `?debug=1`): **F8** toggles it in the zones whose draw hook draws a view plane (z10RGB, z22BIP), `?debug=1&viewplane` starts with it on and `?debug=1&viewplane=<n>` also names the texture (`GameRenderer.viewPlaneTextured` / `viewPlaneTexture`).
  From the code: texture = first argument of `FUN_0087f854` (a value `1..4`: the frame lists hold 4 entries), floor level = the plane's `y` argument, phases per drawn frame. NOT from the code (nobody calls it): which texture and which zone would have called it; the port's default texture per zone (`VIEWPLANE_TEXTURE_DEFAULT`: z10RGB 62, z22BIP 3) is a guess, name your own with `viewplane=<n>`.
  The phases advance by 0.01 per 1/30 s of real time (the port scales by the frame length: at 60 Hz 0.005 per drawn frame), like the original at its 30 frames per second.
* **Flowing water** (`FUN_00426f55` node, vtable `0x8ade18`, draw hook `FUN_00426e9a`; z13CAI's LAVA 0.0025 and FALL 0.01, argument words `(dv, du, ...)`): every frame the hook adds `(du, dv)` to the texture coordinates of part 0's mesh and draws it in mode 0 at the record's matrix without the visibility flags and the LOD test:
  **per pass of the loop (one per drawn frame), not scaled by `dt`**, in place and exact: `u = u + du, v = v + dv` per vertex, float32, no wrapping (FUN_0088350d mode 0; `src/render/uvscroll.ts`, `Renderer.scrollMeshUV`; oracle `wp-time-water-uv`). `GameRenderer` does this for every attach with that constructor (`flow`).
* No lens flares, lightning, trails or glows were found; splashes, wakes, fire, smoke are particle effects or ordinary meshes. The sphere-map code is dead (4.2).

---------------------------------------------------------------------------------------------------------------------------

## 11. The 2D layer (text, HUD, menus, fades)

### 11.1 Primitives

* All 2D drawing is **immediate and unbatched**: every sprite and every glyph is one `DrawPrimitive(TRIANGLEFAN, 4 vertices)` with FVF **0x144 = `XYZRHW | DIFFUSE | TEX1`** (`x y z rhw ARGB u v`, 28 bytes), vertex order TL, TR, BR, BL (clockwise, so not culled),
  integer pixel positions in the real back buffer (800x600). z = rhw-ish constants (sprites z = 1e-6, glyphs 1e-4). Fog is off during 2D. D3D7 pixel centres are at integers and the font UVs carry the half-texel offset, so the draws sample texel centres at scale 1.
  (WebGL has pixel centres at +0.5: add 0.5 to positions.)
* **Sprite** `FUN_0043c267(rect{x0,y0,x1,y1}, ARGB, tex{list,index})`: full texture on the rectangle (TL (0,1), TR (1,1), BR (1,0), BL (0,0): V runs up the picture), hand clipped to the screen, **block 3** (texture * ARGB, alpha from the texture, blended);
  without texture (`tex == NULL` or index -1) block 0x1d (ARGB only). Tinting is by the vertex colour; `0xffffffff` shows the texture unchanged. Deferred sprites (`FUN_0043c645` queue, flushed by `FUN_0043c70f` at the end of the frame) are used for menu icons with a drop shadow (`FUN_0041c3f6`: a `0x7f000000` copy at +4, +4; because block 3 takes alpha from the texture the shadow is an opaque black silhouette).
  All UI textures are loaded with CLAMP (flag byte 0xffffff80) at full size.
* **Fade / loading overlay** `FUN_0040d1be` (drawn at the end of every frame): `FUN_0043ec80(a)` sets the scene visibility `a` (1 = visible, 0 = black); the overlay is a full-screen quad `(0, 0) .. (W-1, H-1)` of the black 16x16 `LoadingScreen.tga` with vertex alpha `255 - a * 255`, **block 0x10**
  (texture colour, alpha = tex * vertex, no depth). Fades take **16 steps = 17 passes** at dt 1 (`a += 0.0625 * DAT_008b1718` after the level was handed to `FUN_0043ec80` and tested against 1.0 / 0.0, `FUN_00465d39` states 7 / 8; the handed-over level is the one BEFORE the step). While `a == 0` the frame is cleared to black instead of the fog colour (`FUN_0040ce80`).
  During loading the overlay also draws the spinning "pizza / CD" card (a 128-pixel-radius diamond, rotated by two angles advancing `dtMs / 30 * 0.05` and `* 0.01`) and the text `LOADING` / `INSERTCD` (font 1, yellow).
* **Letterbox** (cinematic bars, `FUN_0045f750(mode)`, `FUN_0045f771`): mode 1 = top and bottom bar, mode 2 = bottom bar only; the bar height grows by `H / 30` per tick up to `0.21875 * H` (131 px at 600), drawn with `FUN_0043c267` in black. No other screen flashes or vignettes were found.

### 11.2 Fonts and text (NewFont.c, SDText.c)

* **Fonts**: `Fonts/Balloon12.fnt/.tga` (256x128, 20 px cell) and `Balloon24.fnt/.tga` (256x256, 40 px cell); the TGAs are **white with the glyph in alpha**, so text colour is purely the vertex colour. `.fnt` layout (`FUN_00413af1`):
  `u32,u32,u32 cellHeight (+8), u32 N glyphs (+0xc), u32 nonzero (+0x10), u8 charMap[256] (+0x14), N x 32-byte glyph {f32 u0, v0 (fraction from the top), u1, v1, i32 width, height, xOffset (0), yOffset}, u8 kern[N*N]`
  (file size `0x114 + 32 N + N^2`; N = 124 and 119). `charMap` maps an 8-bit (Windows-1252) character to a glyph; bytes 0xE0..0xFF are folded onto 0xC0..0xDF (no lower-case accents); unmapped bytes use glyph 0 (the space).
* **Metrics**: scale `sx = W/640 * fontScale`, `sy = H/480 * fontScale` (`FUN_00413ed9`; Balloon24 is run at **0.7** after the first call of `FUN_00413fbd`). A glyph quad is
  `x0 = (xOffset - pad) * sx + x`, `y0 = (yOffset - cellHeight - pad) * sy + y` (`y` = the **bottom of the line cell**), size `(w + 2 pad) * sx` by `(h + 2 pad) * sy`, edges truncated to integers; UV V = `1 - v`.
  Advance: `x = trunc(x + kern[glyph(c_i) * N + glyph(c_(i+1))] * sx)` (**the kern byte is the pair advance**, so spacing includes kerning); `(c)` is drawn as `O` + a smaller `c`, `0x9C` as `O` + `E`.
* **Drawing**: text is queued (`FUN_0043a25c` left, `FUN_0043a091` centre, `FUN_0043a167` right; 0x18-byte entries at 0x9dc0d0) and flushed at the end of the frame (`FUN_00439f51`): for each entry first a **black copy at (+2, +2)** (colour index 8), then the text, with **block 0x12**
  (modulate, alpha from the texture, no depth). Colour table (11 entries x 4 corner colours, vertex-interpolated gradients): 0 yellow `0xffffff00` (usual), 1 white, 2 blue, 3 green, 4 red, 5..7 gradients, 8 black, 9 grey `0x3f3f3f`, 10 `0x3f000000`; values >= 11 are raw ARGB.
  `FUN_00439c6f(table, font, key|text, ?, colour, x, y, maxChars)` takes 640-space coordinates (**both scaled with W/640**), word-wraps by character count (x 1.4286 for font 1) and centres every line; line pitch = font height - 8 px.
* **Messages** (`SDText.c`, `messages/<lang>/Data/*.str`): `KEY:<4 chars> text`, CR LF separated, `#` comments, keys sorted and binary searched, a missing key returns the key itself; escapes `\n \t \\`, argument markers `$n` (`%s`), `%n` (`%d`), `&n` (`%x`).

### 11.3 HUD and menus

* **HUD** (`FUN_0046055f`, DrawHUD.c, drawn after the 3D scene): **800x600 reference grid** (`ref_x * W / 800`, `ref_y * H / 600`): 60x60 icons at (20, 20) and (716, 20); left / right / centre texts in Balloon24 at y = 69 (x = 100 left-aligned, 699 right-aligned);
  two 5-slot inventory columns of 60x60 icons at x = 20 and 716 stacked upwards with a 72-px pitch (slot i top = 516 - 72 i); four subtitle lines in the menu font centred at x = 400, y = 494 / 518 / 542 / 566; a vertical gauge. Textures `Overlays/HUDFX/text.opt`.
* **Menus** (Menu.c, SGPauseM.c, SGGen.c): a **640x480 virtual grid with 24-pixel tiles**, columns centred on x = 320 (`x = (col * 24 + 320) * W / 640`, `y = (rowOffset + (row - 1) * 24) * H / 480`); panels are built from 3x3 tile pieces of `menu/mOverlays` (56 textures of 32x32), frames in yellow / blue, text in the two Balloon fonts.
  Menu sprites are static; there is no tweening in the draw code.

---------------------------------------------------------------------------------------------------------------------------

## 12. What the viewer reproduces (`src/render/`, `src/viewer/`)

| topic | status |
|---|---|
| per-group blend / alpha test | preset 3 for mode 0 (blend on, alpha test >= 1/255, depth write on), presets for the other modes, three group passes per object in record order |
| culling | clockwise front faces, back faces culled (also for sky / sea) |
| fog per zone | linear, from `SetupFog` of the zone and the draw-distance slider (HUD `draw distance`, default 50), clear colour = fog colour |
| projection | vertical FOV 1.0 rad, zone near / far (`game look` checkbox off = free camera 60 deg, 0.5 .. 12000) |
| lighting | the game's CPU lighting (section 5): object-space light vectors per draw, 8-bit vertex colours, lit once (modes 0 / 4, shared by all records of a mesh) or at every draw (mode 1, attachments, skinned), specular for shiny meshes, point lights within 1 unit; verified byte for byte against the original code (`render-light`) (`game look` off = full bright) |
| per-record modes | `GameRenderer.setPartMode(record, partMask, mode)` per LOD part; skinned records ignore the part mode; extraction + emulation of the set-up code incl. the vehicle roster's mode 1 |
| shadows | blob shadows and Pepper's marker as `FUN_00444940` / `FUN_00444ef0` (section 9), per zone only where the original has them |
| bricks | batched like `FUN_00886be0`, specular lit, block 5 (section 10) |
| view plane, flowing water | section 10 |
| sky / sea / seabed | placement and states of sections 7.1 - 7.3 incl. the orbit of the sea plane and the sky rotation (island) |
| animated textures | `.wib` at 30 entries / s (expression sheets frozen) |
| LOD | `selectLod` from the record position, forced-LOD checkbox kept |
| mip maps | off by default (checkbox) |
| not done | env map (dead), the carve parts (`FUN_0088b1e5`), the probe pass of the node framework (R14) |

Reference check: PC screenshots of the island (RAWG / MobyGames) show the same cyan horizon haze, lime grass at 0.7 of its texture colour on flat ground and ~0.25 on shaded cliff walls, blue-green sea with white shore foam.

## 13. Open questions

Closed by WP-RENDER (2026-10-29, details in the sections named):
* **`SetViewport` MinZ = MaxZ = 0** (3.1): the three calls (`FUN_0040a43f`, `FUN_0040acb0`, `FUN_0040bdd1`, vtable +0x34) pass `{0, 0, width, height, 0.0, 0.0}`; Direct3D 7 replaces a degenerate range by `[MinZ, max(MaxZ, MinZ + 0.001)]` (what Wine measured against native Windows: `dlls/ddraw/tests/ddraw7.c` "Test degenerate viewport z ranges", `wined3d_viewport_get_z_range`), so the game's depth values span `[0, 0.001]`: ordering unchanged, the buffer's resolution a thousandth of a 0..1 range (the frame's Clear uses z = 1.0). `Renderer.begin` sets `gl.depthRange(0, 0.001)` (`states.ts` `GAME_Z_RANGE`, `d3dZRange`).
* **FPU precision** (5): no `SetCooperativeLevel` call passes `DDSCL_FPUPRESERVE` (flags 8 and 0x13), and nothing in the executable resets the control word after `CreateDevice` (the CRT's `__setdefaultprecision` runs once at start-up), so Direct3D 7 leaves the x87 in 24-bit precision for the whole game: every x87 operation rounds to a float mantissa. The emulator models it (`cpu.cw = 0x7f`: `p24` in `x86emu.ts`), the lighting / view plane / brick / probe / shadow tests set it, and all of them are bit-exact with it.
* **Per-record `mode` / `specular`** (4.2): extracted from the set-up code and the emulation (`ZoneSetup.modes` / `.shiny`).
* **Fallback light set** (5): count 0, black. **Point-light range** (5): 1.0 for meshes; 60.0 only in dead code. **`video fog` label**: the settings dialog (resource of `FUN_004037c2`, dialog `0x585c00`) calls the checkbox **"No Fog"**: `video fog t` = fog off.
* **`FUN_0087f01e`** (10): the textured pass is dead, the coloured pass only shows below y = -200. **Flowing water** (10): per drawn frame UV scroll. **Sea level** of zones that never store `DAT_009da858` (3.2): 0.
* **Which SetupFog call** (3.2). **Adaptive detail** (`FUN_00443d10`): `DAT_009e56b8` is never written anywhere (two reads, no store, no pointer into its struct), so the adaptive mode is permanently off and `DAT_009e56bc` stays 0: the port's "always best detail" is the original's behaviour.
* **2D**: the fade quad `(0, 0)-(W - 1, H - 1)` leaves the last pixel column and row unfaded (one game pixel; `Ui2D.fade`), the gauge geometry `FUN_00460214` (`HudGauge`: the marker's centre is truncated first and it takes the gauge tint; the rest matched), colour 10 (`0x3f000000`): block 0x12 has `ALPHAOP = SELECTARG1` (texture alpha), so the vertex alpha is ignored: opaque black like colour 8 is exact.

Closed in item 10 (2026-10-31):
* **Particle details**: the colour variation, the sprite range rule, the mirrored digits and the `W / fov` fudge are all in the oracle-verified engine (particles.md 7: 99 effects x 11 scenarios, 0 differences; the sprite visibility rule is the executable's `(flags & 0xf) == flags`). The rule's meaning came out wrong in the first port: Direct3D 7's `ComputeSphereVisibility` returns the
  `D3DSTATUS_CLIP*` layout (bit i = the plane cuts the sphere, bit 12 + i = the sphere is completely outside plane i; planes left, right, top, bottom, front, back), NOT the documented `D3DVIS_*` values (Wine's `test_compute_sphere_visibility`, measured on native Windows, expects 0x103d for a sphere left of the frustum). `FUN_0040cd36`'s `(flags & 0x3f000) == 0` (the record
  culling of `FUN_00444280`, every record every pass) and `(flags & 0xf) == flags` (sprites: no plane has the sphere completely outside, front / back not cut: a sprite may cross the left / right / top / bottom edge, the engine's clipper trims it) only make sense in that layout. `src/fx/particles/sprites.ts` (`planesFromD3d`, `frustumPlanes`, `visibleFlags`) is Wine's implementation (the six planes from the combined matrix,
  `in_plane`: float32 normalised distance, `|d| < r` cuts, `d < -r` outside) and reproduces all 12 native-measured cases (`tools/tests/d3d-spherevis.mjs`); the record culling of `GameRenderer.sphereVisible` uses the same function (it used normalised double planes and inclusive `< -r`).
* **The vertex buffer before its first lighting**: the conversion to format 0x2c2 (`FUN_00883013`) copies x y z diffuse and the texture coordinates and never writes the SPECULAR dword (the new buffer's memory as `CreateVertexBuffer` gives it: not initialised in the code; zero in the port, which only matters for a shiny mesh that is drawn in a mode that does not light, and a lit mesh writes it on its first draw).
  The diffuse dword before the first lighting is the file's (`0xffffffff` in all files).
* **ProcessVertices / ComputeSphereVisibility are Direct3D runtime code (`ddraw.dll` / `d3dim.dll`), not in the executable**: the port uses Wine's float32 implementation of the visibility call (native-verified table) and double arithmetic for the projection of a point to the back buffer (`projectPoint`: x = (1 + cx / cw) w / 2, y = (1 - cy / cw) h / 2, z = (cz / cw + 1) / 2 for the GL clip space); the native runtime's rounding order is not documented anywhere, so a sprite whose centre
  lies within a float32 ulp of a pixel may differ by that ulp. This and the rasteriser are the only parts of the particle / record pipeline that cannot be bit-exact.
