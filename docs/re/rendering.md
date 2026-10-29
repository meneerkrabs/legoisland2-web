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
* **Viewport**: `SetViewport` with (0, 0, width, height) and **MinZ = MaxZ = 0.0** (`FUN_0040bdd1`, `FUN_0040a43f`, `FUN_0040acb0`); the return value is not checked.
  A degenerate depth range would break the depth buffer, so the call presumably fails and keeps the default viewport (0..1) that `CreateDevice` installs. **UNCERTAIN** (cannot be run here).
* **Gamma**: none. No `IDirectDrawGammaControl`, no gamma ramp, no "gamma" string anywhere. **Dithering** is off (`DITHERENABLE = 0`), **anti-aliasing** off.
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

Only the **first** `SetupFog` call of each set-up function is the zone default; several zones call it again for sub-areas (z03PPH 3 calls, z10RGB 4, z27TRX 8 ...), those values are returned by `extractRenderParams().fog[]` too.
Zones without a sea record but with `sea y -` and records `SSEA` (z09JST, z13CAI, z22BIP, z38PAR) keep the global at 0 (UNCERTAIN: another store through a register could exist).

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
* **Mesh `mode`** (third argument of `FUN_0087d9a7`, stored per model part, set by game code with `FUN_00444550(record, mask, mode)`; default 0) selects the block:

| mode | block | lighting computed first | meaning |
|---|---|---|---|
| 0 | 3 | once, at the first draw of the mesh (`mesh+0x60` flag) | normal lit object |
| 1 | 3 | at every draw (`FUN_0088abcc`) | lit object that moves / turns (characters, vehicles, the island's dynamic set) |
| 2 | 1 | no | unlit, alpha-blended, depth on (sky, shore foam) |
| 3 | 0x10 | no | unlit, no depth (seabed, sea) |
| 4 | 0x12 | once | lit, no depth test (overlay-like objects) |
| 5 | 0xd | no | tex colour, alpha = tex * vertex alpha |
| 6 | 0 | no | unlit opaque |
| 7 | 0x1a | no | modulate / modulate, no depth |

  A mesh can also carry its own state callback (`mesh+0x8c`, set by `FUN_00444790`) which overrides the switch: the sea plane uses it (callback returns 0x61, `FUN_00883fad` maps 0x61 -> block 0x10,
  0x62 / 0x63 -> block 6, anything else -> block 3). Modes seen in the island's set-up code (`FUN_004b4907`, `FUN_004b6475`): 2 for the shore-foam record and a few effect records, 1 for a set of moving records (skateboard, vehicles ...), 5 for one special record.
  The viewer only knows the fixed assignments (`SSKY` 2, `SEAB`/`SSEA` 3, `SEAE` 2); every other record is mode 0. **[viewer]**
* Skinned meshes (`FUN_0088b87b`, `FUN_0088bd34`, `FUN_0088c367`): the joints are skinned on the CPU every frame, the lighting is recomputed per frame (`FUN_0088589e`, same formula, directional lights + ambient only) and all groups are drawn with block 3 (mode 2 = no state change).
* **Specular** ("shiny") meshes: a model can be switched to vertex format 0x2c2 (`FUN_00883013(model, 1)`, called by `FUN_004446c0(record, 1)` for a handful of records such as the skateboard and some vehicles); lighting then also writes a specular
  colour `pow(H.N, 16) * colour * 128/255` for `H.N > 0.9` (`FUN_0088612c`; skinned meshes `FUN_00885e33`: power 8, threshold 0.92, factor 220/255) and block 5 (SPECULARENABLE) is used. Meshes are loaded as FVF 0x242 (`XYZ | DIFFUSE | TEX2`, 32 bytes); 0x2c2 adds `SPECULAR` (36 bytes).
* **Environment (sphere) mapping** exists in code (`FUN_00884002` / `FUN_00884128`: texture transform `[.5 0 0 0; 0 .5 0 0; 0 0 1 0; .5 .5 0 1]`, `TEXCOORDINDEX = CAMERASPACENORMAL`, `TEXTURETRANSFORMFLAGS = COUNT2`, vertex format 0x212 `XYZ | NORMAL | TEX2`, `WRAP0 = 7`)
  but the flag that enables it (`mesh+0x64`, set only by `FUN_0088350d(-999)`) is never set by any call site in the executable: **dead code** (checked by scanning the 27 callers; **UNCERTAIN** only if a call goes through a path I did not trace).
* Culling of whole meshes: each mesh keeps 8 box corners; `FUN_00416454` computes outcodes against the six frustum planes (`DAT_00987db8`) and a mesh is skipped when the AND of the 8 outcodes is non-zero (`FUN_0088aca2`).
  Large meshes can be pre-split into spatial parts (`Carve.c`, `FUN_0088069b`: `Part%d_%d_%d.msh`) which are culled separately (`FUN_0088b1e5`). Records are tested with their collision sphere (`FUN_00444370`, `FUN_004164f1`).

### 4.3 Vertex colour, alpha and winding

* The mesh files hold white vertex colours (`0xFFFFFFFF`); the engine overwrites the diffuse colour of every vertex with the lit colour (section 5) and keeps alpha 0xFF. No baked lighting exists in the data.
* Back faces are culled for every mesh (`CULLMODE = CCW`), including the sky and sea. **[viewer]** draws with the same winding.
* There is no depth bias, no stencil, no scissor; `TEXTUREFACTOR` is white and unused.

---------------------------------------------------------------------------------------------------------------------------

## 5. Lighting

D3D lighting is **off**. The engine lights vertices itself on the CPU (Lights.cpp) and uploads them as diffuse (and specular) vertex colours, so the result is Gouraud-interpolated per-vertex lighting.

* **Light file** `lights/lights.lgt` (format: `src/formats/lights.ts`, formats.md 8.3.6), loaded per zone by `FUN_008864b6` (-> `FUN_008849c6`) into a runtime light set (`DAT_05d5fafc[n]`, 100 bytes per light);
  **all meshes use set 0** (`FUN_0088abcc` reads `*DAT_05d5fafc`). The conversion:
  * file type 2 (directional) -> runtime directional light; **if its direction's Y is negative, Y is negated** (`FUN_008849c6`); the vector is thus the direction **towards** the light with `y >= 0`
    (e.g. z02LGI: file `(0.71, -0.60, 0.37)` -> `(0.71, 0.60, 0.37)`, a sun at 37 deg elevation in the +x/+z quadrant);
  * file type 0 (point) -> runtime point light; its range is **not** taken from the file (runtime range 1.0 for meshes, 60.0 elsewhere), so point lights practically never touch a mesh;
  * file type 1 (spot) is converted but never occurs;
  * **ambient** = the component-wise maximum of the `ambient` colour of **all** records of the file (appended as a last light of type 0). The `specular` colour of the file is unused.
* **Per vertex** (`FUN_00885a9a` static meshes, `FUN_0088589e` skinned), for each channel, with `N` the vertex normal (from the mesh's separate normal array, rotated into the light's space with the object's world rotation) and the lights in list order:

  ```
  acc = 0
  for each directional light:  I = max(0, N . L);  acc = acc + (1 - acc) * I * diffuse      ("screen" blend of successive lights)
  colour = max(acc, ambient)
  ```

  then `ROUND(colour * 255)` per channel into the vertex diffuse. The texture stage multiplies (`MODULATE`, no 2x / 4x), so the final pixel is `texture * max(ambient, N.L * sun)`.
  For z02LGI: grass facing up is lit with 0.60, faces turned away from the sun fall back to the ambient 0.18 / 0.18 / 0.24 (bluish shade). This reproduces the look of the PC screenshots (grass ~0.7 of its texture colour, cliff walls in
  shade ~0.25).
* The light set also exists as D3D lights (`FUN_0088465a` creates a default D3DLIGHT7 and calls `SetLight`; `FUN_00884370` ... `FUN_00884598` change colour / direction / range) but D3D lighting is never enabled, so they have no effect. The default
  set (no `lights.lgt`) has count 0 (black meshes): **UNCERTAIN**, never used by the shipped zones.
* Light on **moving** objects uses the same list; the vertex colours are recomputed when the mesh is drawn in mode 1 (and skinned meshes every frame); static (mode 0) meshes keep the colours of their first draw.
* The viewer evaluates the same formula in its vertex shader (`src/render/lighting.ts` documents it, `lightVertex` is the CPU reference). **[viewer]**

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

Loader `FUN_004112ac`: `WIBF` (sequence), `WIBT` (header + frames); frames are kept in system memory in the target format. **Playback** (`FUN_00410ff8`, called for every animated texture once per frame by `FUN_004111a3` from `FUN_004126fd`):

```
timer += 1.0 * DAT_008b1718            (one sequence entry per 1/30 s)
index  = trunc(timer); the frame seq[index] is copied into the texture surface when `index` changed
if timer >= sequenceLength:  mode 0 (default) -> timer = 0 (loop);   mode 1 -> hold the last entry, mode 2 = stopped
```

`FUN_00411202` (`FUN_0041270c`, called by cut-scene / face code) sets the mode (0 loop, 1 play once, 2 frozen) and the start frame of a texture: this is how the 16-frame **expression sheets** of the characters are driven
(they are frozen on one frame and changed on demand). Water, fire, portals, screens and the like simply loop. Sequence entries repeat frames to hold them longer (e.g. `[0,0,1,1,1,2,2,...]`).
**[viewer]** plays all `.wib` with a sequence at 30 entries per second, except the 16-frame identity-sequence sheets, which stay on frame 0.

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

### 7.3 Seabed (`SEAB`, mode 3 = block 0x10), shore foam (`SEAE`, mode 2 = block 1)

`SeaBed.Msh` is real terrain below the water (x -537..537, y -44..2.8 in z02LGI); drawn first, unlit, without depth. `Sea.Msh` / `wash.msh` (`SEAE`) is the white foam rim along the coast, drawn unlit with block 1 (depth on).
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
* **[viewer]** does not draw particles.

---------------------------------------------------------------------------------------------------------------------------

## 9. Shadows (`Shadow.bob`, `FUN_00444850`, `FUN_00444940`)

* Blob shadows, drawn for each object right after the object itself. `Shadow.msh` is a 5-vertex, 4-triangle fan (4 corners + centre) with one group (flags 2); `Shadow/text.txl` lists 9 textures (all RGB 0 with alpha, `text001` is a 4-frame `.wib`):
  0 glider, 1 animated, 2 plane, 3 soft square, **4 round blob (default)**, 5 bird, 6 ship, 7 sparkles (the Pepper marker), 8 soft square.
* Which objects: Pepper (`PEPP`) uses the type from game variable 0xc5 (-1 = none); other objects only when `behaviour flags & (0x10 | 0x40)`, within 80 units of the camera (distance^2 <= 6400), type 4.
* **Geometry**: the four corners lie at `radius[type] * 8` from the object at angles heading +- 45 deg / 135 deg (`heading = atan2(forward.x, forward.z)`), the centre at the object; every vertex is **ray-cast straight down** against the registered collision meshes
  (`FUN_00441b10`, ray start `rayStart[type] * 8` above, length 2400): the centre takes the highest hit (starting at the sea level), the corners are clamped to +-16 around the centre height, and everything is lifted by `lift[type] * 8`.
  Tables (type 0..8, before the x8): radius `.25 1 .25 .6 .25 1 1 0 1`, rayStart `.25 1 .25 .5 .25 1 1 0 1`, lift `.01 .2 .01 .01 .01 .2 .2 0 .5`.
* **State**: block 3 with the black alpha texture: a black blob with alpha = texture alpha (round blob peaks at 205 / 255), depth test and write on. There is no fade with height. (The strong tree shadows in the PC screenshots come from larger shadow types and baked terrain texture detail.)
* Pepper's flashing marker (`FUN_00444ef0`): a camera-facing quad with texture 7 at bone 10, visible for 8 of every 16 ticks. **[viewer]** does not draw shadows.

---------------------------------------------------------------------------------------------------------------------------

## 10. Other effects

* **Brick batches** (`Effects.c`, `FUN_00886900`, `FUN_00886be0`, `FUN_00886b34`): the BrickMorph / brick-building effects transform brick meshes on the CPU into two ping-pong vertex buffers of 4096 vertices (FVF 0x2c2), LOD by distance^2 (1280 / 7200), palette UVs from a 32-colour table
  (u = 0.0625 + c * 0.125, v = 0.9375 - r * 0.125), lit with the specular lighting variant; flushed once per frame (`FUN_00447de0`) with block 5.
* **Underwater view plane** (`FUN_0087f01e`, wrapper `FUN_00444500`; zones with swimming: callers in z10RGB and z21FSH): with far temporarily 2000 and depth off, a horizontal plane at a given y is clipped to the view frustum and drawn twice: textured (FVF 0x242, block 0x10) with
  **scrolling UVs** `u = x / 100 + 0.2 * sin(t1)`, `v = z / 100 + 0.15 * cos(t2)` (`t1`, `t2` += 0.01 per call, i.e. per frame, frame-rate dependent), and a vertex-coloured gradient polygon (block 0x1d, cyan 0xff00ffff fading to blue with the distance). UNCERTAIN: exact use (surface seen from below / underwater fog).
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
  (texture colour, alpha = tex * vertex, no depth). Fades take **16 ticks** (`a += 0.0625 * DAT_008b1718`, `FUN_00465d39` states 7 / 8). While `a == 0` the frame is cleared to black instead of the fog colour (`FUN_0040ce80`).
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
| lighting | directional + ambient per vertex from `lights.lgt` exactly as in section 5 (`game look` off = full bright) |
| sky / sea / seabed | placement and states of sections 7.1 - 7.3 incl. the orbit of the sea plane and the sky rotation (island) |
| animated textures | `.wib` at 30 entries / s (expression sheets frozen) |
| LOD | `selectLod` from the record position, forced-LOD checkbox kept |
| mip maps | off by default (checkbox) |
| not done | particles, shadows, specular records, per-record modes other than the fixed ones, env map (dead), underwater plane, 2D layer |

Reference check: PC screenshots of the island (RAWG / MobyGames) show the same cyan horizon haze, lime grass at 0.7 of its texture colour on flat ground and ~0.25 on shaded cliff walls, blue-green sea with white shore foam.

## 13. Open questions

* Whether `SetViewport` with MinZ = MaxZ = 0 takes effect (1); exact meaning of the `video fog` dialog label.
* Per-record `mode` / `specular` assignments in the zone set-up functions beyond the sky / sea / seabed (they are straight-line calls like the tables of formats.md 6 and could be extracted with the same interpreter).
* Fallback light set of `FUN_0088465a`; whether the point-light range of 1.0 in mesh lighting is intended (range 60.0 in `FUN_00884f68`, whose callers I could not find).
* `FUN_0087f01e` usage (underwater view), the zones that use the flowing-water behaviour `FUN_00426f55` (z13CAI lava / falls), and sea level of the zones that never store `DAT_009da858`.
* Particle details: exact random factors of the colour variation, sprite range inclusivity, whether the mirrored digit sprites are intended, the `W / fov` size fudge.
* 2D: the exact raster of the last pixel row / column of the fade quad; `FUN_00460214` (gauge) geometry.
