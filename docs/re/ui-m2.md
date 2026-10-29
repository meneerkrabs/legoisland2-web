# 2D layer (M2): strings, fonts, text layout, sprites, fade, letterbox

Code in `src/ui/` (`strings.ts`, `fonts.ts`, `layout.ts`, `renderer2d.ts`, test page `test.html` / `test.ts`), tests `tools/tests/ui-strings.mjs`, `ui-layout.mjs`
(`node tools/test-formats.mjs --only ui-strings,ui-layout`), screenshots `tools/steps/ui-test.mjs`, `ui-state.mjs`. Original behaviour: docs/re/rendering.md section 11; function
names are Ghidra names of `LE2.c`. Everything below was re-read from the executable for this milestone (the new findings are marked **new**).

## 1. Message tables (`strings.ts`)

* **Loader** `FUN_00439126(path)` (`SDText.c`; `path` gets `.txt` appended only when it has no `.xxx` extension): the file is one NUL-terminated buffer; a tiny state machine
  (state 0: bytes < 0x20 ignored, `#` = comment line, other byte = tag start; state 1: `:` ends the tag (written as NUL), a byte < 0x20 drops the tag; state 2: value runs to the first byte < 0x20, so a **TAB** ends it too).
  Value = 4 character id field + text. Tags are **bubble sorted with `strcmp`** (`FUN_00439573`, stable) and kept as pointers + a NULL sentinel.
  One file = one table in the original; `MessageTable` merges several files (sorted together).
* **Lookup** `FUN_004396a0(table, id)`: the binary search `n = count; do { mid = n / 2; e = a[base + mid]; if e == NULL not found; c = strcmp(e, id); c == 0 found; c < 1 ? (base += mid + 1, n -= mid + 1) : n = mid - 1 } while (n > -1)`.
  Case sensitive. **A missing id returns the id itself** (and the voice field then reads the id's first character). Duplicate tags (14 in the data): whichever entry the search meets first.
  All 2370 tags of the 164 shipped `.str` are found by the search (test).
* **Text** `FUN_00439788(table, id, args...)` / `FUN_004397b9`: stops at the first byte < 0x20; **bytes >= 0xE0 fold to upper case (-0x20)** (also in the missing-id case: the id is expanded like a text);
  `\n` `\t` `\\` escapes (any other `\x` produces nothing); `$$` `%%` `&&` = the literal sigil; **placeholder = 3 bytes `<sigil><any byte><digit n>`** (the middle byte is ignored; **new**, formats.md said `$x`):
  `$` = `%s`, `%` = `%d`, `&` = `%x` of vararg `n` (0-based), `<sigil>x<sigil>` = literal sigil (FUN_00439a80). None of this occurs in the data except `&&`.
* **Voice** `FUN_00439bf8`: the 4 character field is parsed with `atoi` only when its first byte is a **digit** (`isdigit`): `"-1  "` = -1 = none, `"775 "` = 775 = speech table index.
* `MessageTable`: `find(id)`, `has(id)`, `text(id, ...args)`, `raw(id)`, `voice(id)`; `loadMessages(archive, paths)`; `expandMessage`, `parseMessageFile`.

### Which files the game loads (callers of `FUN_00439126`, paths from the executable)

| table | file (`messages` archive) | loaded by | notes |
|---|---|---|---|
| menu table `DAT_008a9600` = `DAT_009d9c2c` | `FE/Data/FRONTEND.str` | `FUN_0041b40e` (menu context init, also from the credits `FUN_00470ac3`), `FUN_0040d1be` (loading card), `FUN_005400d5` | default table of every menu context (`ctx+0x70`); ids `FEQUIT`, `LOADING`, `INSERTCD`, `FSMSTATEnn` (save slot captions), `KeysM1` ... |
| `DAT_009d9fb8` | `FE/Data/PAUSE.str` | `FUN_0041b40e` | `BACK`, `SAVE`, `CONTINUE`, `PAUSE`, memory card texts, `LEVPPH`, `FOG` |
| `DAT_009d9fbc` | `FE/Data/IFC.str` | `FUN_0041b40e`, `FUN_004042d3` (start-up), `FUN_0054c4a7` | `LEVxxx` (level names), `IFCxxx` (information centre) |
| `DAT_00983a14` | `FE/Data/STD.str` | `FUN_00404dc9` (game start) | `SGGOLD` 775, `SGSILVER` 776, `SGBRONZE` 777, `PHOTOS` |
| `DAT_05d57e80` | `FE/Data/CREDITS.str` | `FUN_00471bfa` | `FRECR00..` (credits screen, lines `!FRECRnn` resolved by `FUN_00471bd2`) |
| (unused) | `FE/Data/BROWSER.str` | installer | `BROWSE01..07` |
| per zone | `LI/wab, cnt, parstr` `CI/bkd, jst, rgb` `AI/ssh, was, mmp, dsp, fsh, bip, trx, hat` `OG/apo, map, brp, brp2` (`.str`) | the zone set-up functions | `ZONE_FILES`; other zones take `SayText` ids from the cutscene script's `<AREA>/Data/<script>.str` (`findStrPath`) |

Presets: `FRONTEND_FILES`, `PAUSE_FILES`, `IFC_FILES`, `STD_FILES`, `CREDITS_FILES`, `BROWSER_FILES`, `MENU_FILES` (= the three menu tables in lookup order), `ZONE_FILES`.

### Menu labels (`FUN_0041c270`, `MenuStrings`)

`!ID` = message id: looked up in the context's table (FRONTEND), **then PAUSE, then IFC**; a table is skipped when the text it returned equals the id (`strcmpi`); the last result stands.
`@prefix!ID` = the same lookup printed as `sprintf("%s%s", text, prefix)` (e.g. `'@ 1!PPHMOVIES'` -> `Film  1`). A label starting with `^` is not a string (special item, `FUN_0041c7cd`). Anything else is literal.
`MenuStrings.label(label)`, `.resolves(label)`, `loadMenuStrings(archive)`. All 47 distinct `!` ids of the 30 menu pages (`gs_menu.py`) are in `tools/tests/ui-strings.mjs` with the table they resolve in:
44 resolve (FRONTEND 38, PAUSE 6, IFC 0: the `LEVxxx` / `IFCxxx` ids are for other screens); **`FileM1`, `FileM2` are in no file** (placeholders: the page set-up functions `FUN_0041ae6e` / `FUN_0041aef3` overwrite the item text with the save slot
caption `FUN_0041ac0e`: `FRONTEND.str` id `FSMSTATEnn` (key table at 0x8a5448, 12 bytes per entry, indexed by the slot's story state), empty slot = `<-------->`)
and **`Pause`** (pause page title, pages 5 and 18) is also in none: the lookup is case sensitive and the id in `PAUSE.str` is `PAUSE`, so the original shows the id itself, `Pause` (**new**, unverified on screen).

Menu item text is drawn with `FUN_0041c7cd`: font `ctx+0x6c` (= `data/fonts/menu/menu` = slot 0), position `((col * 24 + 320) * W / 640, (rowOff + row * 24 - 4) * H / 480)`, align 0 = centre (`FUN_0043a091`),
-1 = left (`FUN_0043a25c`), 1 = right (`FUN_0043a167`). Panel tiles: `FUN_0041c478` draws one 24 px tile `x = (col * 24 + 320) * W / 640 ... ((col + 1) * 24 + 320) * W / 640`, `y = (rowOff + (row - 1) * 24) * H / 480 ...`.
Tile numbers of `menu/mOverlays` (**new**, from the picture and the code `base + 9` / `base + 0xc`): the pieces come in triples yellow / green / red: top edge 3, bottom edge 6, left 9, right 12, corners TL 15, TR 18, BL 21, BR 24 (these four are rounded outer corners), plain fill 27 (28, 29), rounded buttons 30..35, lamps 36..53, tab fills 54..56, traffic lights 57 / 58, bars 59..61, arrows 62..65, 66 / 67 round lamps, 68..71 computer icons, 0 LEGO logo, 1 gauge, 2 big arrow.
The item's colour kind selects the triple through `DAT_008a9a18 = {0, 2, 1}` (offset 0 = yellow, 1 = green, 2 = red; `FUN_0041cbac` draws tile `base + 9` for the left edge and `base + 0xc` for the right edge).

## 2. Fonts (`fonts.ts`)

| item | value |
|---|---|
| files | `Fonts` archive: `Balloon12.fnt/.tga` (cell 20, 124 glyphs, 256x128), `Balloon24.fnt/.tga` (cell 40, 119 glyphs, 256x256); TGA = white with the glyph in alpha |
| slots (`DAT_00987d00[]`, loader `FUN_004139e0`, only two) | **0 = Balloon12**, **1 = Balloon24** |
| slot scale (`DAT_008a13e4`, set by `FUN_00413fbd`) | slot 0 = 1.0, slot 1 = **0.7** (0x3f333333 float32), applied on top of W / 640 (x) and H / 480 (y) |
| wrap multiplier (`DAT_008a13ec`) | slot 1: 1.4286 (0x3fb6db6e), `maxChars = ftol(maxChars * 1.4286) & 0xff` in `FUN_00439c6f` |
| name -> slot (`FUN_00413dae`, `fontSlotForName`) | name ends in `test` 0, `main` 1, `bknw` 1, `csm` 0, `menu` 0; else `strcmpi(name + 12, "Balloon12"/"Balloon24")`; no match 0 |

So the code's font names resolve to: `data/fonts/main/main` and `data/fonts/main/bknw` -> **slot 1 (Balloon24 at 0.7)**; `data/fonts/menu/menu`, `data/fonts/csm/csm`, `.../test` -> **slot 0 (Balloon12)**;
`_data/fonts/Balloon12` / `balloon24` -> 0 / 1. The loose `main`, `menu`, `csm`, `bknw`, `test` fonts do not exist in the shipped data (formats.md section 9 was right). Users: menu context `ctx+0x68` = main (slot 1), `ctx+0x6c` = menu (slot 0);
credits screen: Balloon24 (slot 1), main (1), menu (0); HUD (`FUN_0045f9d2`): `_data/fonts/balloon24` (1) and `csm/csm` (0); the zone set-ups (`FUN_00439f36`) ask for `main` or `bknw` (slot 1, subtitles / speech bubbles).
At 640x480: line height `trunc(cell * sy)` = **20** (slot 0) and **27** (slot 1: `40 * float32(0.7) = 27.9999995`, truncated, not 28).

## 3. Text layout (`layout.ts`, all in screen pixels of the 2D area; 640x480 = the virtual grid)

* **Glyph quad** (`FUN_004145d0`): `sx = f32(W / 640 * slotScale)`, `sy` likewise; `w' = f32((width + 2 pad) * sx)`, `x0 = f32((offsetX - pad) * sx + x)`, `y0 = f32(((offsetY - cell) - pad) * sy + y)`; the four edges are **truncated** (`ftol`):
  `x0i`, `trunc(x0 + w')`, `y0i`, `trunc(y0 + h')`. `y` is the **bottom of the line cell**. The quad is skipped when `x1 < 0 || y1 < 0 || x0 >= W || y0 >= H` and hand clipped otherwise (UVs follow, order left, top, right, bottom).
  Vertices TL, TR, BR, BL = colours 0, 1, 2, 3; V = `1 - v`; z = 1e-4. The glyph state is block 0x12: colour = texture * vertex colour, alpha from the texture only (the alpha of the text colour is ignored), no depth.
* **String** (`FUN_00413fd6`): the pen is an integer; `x = trunc(x + kern[glyph(c) * N + glyph(next)] * sx)` (next = 0 at the end); first and every next byte folded (>= 0xE0 -> -0x20). **`0xA9`**: `O` (pad +3) and `c` (pad -3) at the same pen position, advance by the kern of 0xA9 itself.
  **`0x9C`**: `O`, then `E` at `trunc(x + kern(O, E) * sx * 0.5)`, advance by the kern of `E`. A newline byte is just a glyph-0 character: **the original does not break lines at `\n`**.
* **Width** (`FUN_0041433a`): the same loop without folding and without the `(c)` / `0x9C` cases. Centre = `x - width / 2` (integer), right = `x - width`, left = `x`.
* **Message** (`FUN_00439c6f(table, font, key|text, flag, colour, x, y, maxChars)`): `text = table ? expand(table, key) : key`; `x = x * W / 640`, **`y = y * W / 640`** (integer arithmetic, both with the width factor; same as H / 480 at 4:3);
  while the rest is **longer than** `maxChars` it looks back from index `maxChars` for a space (the character at `maxChars` counts), cuts there and drops the space; every line is **centred** (the `flag` is forced to 0 inside the function, so wrapping always centres);
  line pitch = `lineHeight(font) - 8` pixels (unscaled 8). No space within the first `maxChars + 1` characters: the original scans backwards without a bound (garbage); `wrapLines` cuts hard instead.
* **Queue flush** (`FUN_00439f51`): per entry a black copy at **(+2, +2)** pixels (colour index 8), then the entry itself.
* **Colours** (`FUN_00413ed9`, table 0x8a1320): 0 yellow ffffff00, 1 white, 2 blue, 3 green, 4 red, 5 gradient (TL red, TR green, BR blue, BL white), 6 red with white BL, 7 red -> 22 00 00 (bottom), 8 black, 9 3f3f3f, 10 0x3f000000; values >= 11 are raw ARGB (all four corners).
* API: `scaleXY`, `lineHeight`, `stringWidth`, `measureText`, `glyphQuad`, `drawString`, `alignedX`, `layoutTextCmd`, `wrapLines`, `layoutMessage`, `resolveColour`, `TEXT_COLOURS`.

Float precision: the game computes in x87 extended and stores float32 at the same places; the TS uses `Math.fround` there and doubles elsewhere (differences only if a product lands within 1e-16 of an integer).

## 4. Drawing (`renderer2d.ts`)

* `Ui2D(gl)`: own program, buffer, VAO; one frame: `ui.begin()`, calls, `ui.flush()` after the 3D frame. `flush()` saves and restores program, VAO, array buffer, texture unit 0 + active unit, viewport, blend (enable / funcs / equation), depth test + mask,
  cull, scissor, stencil, dither, colour mask (checked by `tools/steps/ui-state.mjs`: nothing changes, no GL error).
* **Area**: 640x480 virtual grid scaled by `W / 640`, `H / 480`; `fit` (default): 4:3 centred in the canvas (the game only knows 4:3 modes), the bars are not painted (the 3D scene or the fade / letterbox shows there); `stretch`: whole canvas.
  Rectangles are given in virtual coordinates (floats, not truncated: sprites are not truncated in the original, glyph edges are); everything gets **+0.5 px** (D3D pixel centres at integers; the font UVs already carry the half texel).
* **Blocks** (rendering.md 4.1): sprite / glyph = colour `tex * vertex`, alpha = texture alpha (blocks 3, 0x12); fade = block 0x10: colour = texture (black), alpha = `tex.a * vertex.a`; flat = block 0x1d: vertex colour and alpha.
  SRCALPHA / INVSRCALPHA, no depth, no culling; **alpha test: alpha byte >= 1** (the game's base state) in all of them.
* **Order** inside `flush()`: layer 0 immediate sprites / rectangles / fade / letterbox in call order (the original draws sprites at once), layer 1 deferred sprites (`sprite(..., deferred = true)`, the `FUN_0043c645` queue flushed by `FUN_0043c70f`),
  layer 2 text (`FUN_00439f51`, so text is never covered by the fade). Batching only merges consecutive quads with the same texture and block.
* **Sprite** `FUN_0043c267`: TL V = 1 (V runs up the picture, rows as stored), hand clip with UV adjust (reproduced), tint = vertex colour (`0xffffffff` unchanged), z = 1e-6. No texture -> `fillRect` (block 0x1d).
* **Fade** `ui.fade(a)`: black quad, alpha `trunc(255 - 255 a)`, over the **whole canvas** (the original quad is `(0,0)-(W-1,H-1)`; see section 5); nothing when a >= 1. The "scene is black while a == 0" rule is the caller's.
* **Letterbox** `ui.letterbox(mode, dt)`: 0 off, 1 top + bottom, 2 bottom only; height `h += (H / 30) * dt` (`dt` in 1/30 s ticks), stops at `0.4375 * H * 0.5` (= 0.21875 H) when `trunc(h) >= max`; top bar `(0,0)-(W, trunc h)`,
  bottom bar `(0, trunc H - trunc h)-(W, trunc H)`; changing the mode restarts from 0 (`FUN_0045f7a8`). Black, full canvas width (H = canvas height).
* **Textures**: `UiTextureSet.load(gl, archive, dir)` = `<dir>/text.opt` count + `TextNNN.tga` (or `.wib`, first frame), `ui.loadSet(archive, dir)`; single images `ui.loadImage(archive, path)`.
  All CLAMP, bilinear, full size, no mip maps. Sets: `menu/mOverlays` (72), `menu/loading` (1: `text000.wib`, **64x64 x 30 frames**, first frame uploaded; **new**: it is a 64x64 animation, not a 640x480 screen),
  `Overlays/<ZONE>` (e.g. `Z02LGI`), `Overlays/HUDFX`, `GENERICBITS`: `Backdrop/loadingscreen.tga` (black 16x16, the fade texture), `Backdrop/CD.tga`, `Backdrop/Pizza.tga`.

## 5. Approximated / unresolved

* **Loading card** (`FUN_0040d1be`): done by WP-SHELL, see gaps.md U1: `src/ui/loadingcard.ts` (checked against the original in the x86 interpreter, `m8-shell-loadcard`), drawn by `Ui2D.fade()` with every fade below 1.0; the UVs are the full-screen quad's reused (0,1) (1,1) (1,0) (0,0), the face is the CD when the turned normal has z > 0.
* The fade quad's last pixel row / column (`W - 1`, `H - 1`) is not reproduced (the whole canvas is covered; the original leaves a one pixel strip unfaded, an open question in rendering.md).
* The letterbox bars use the canvas height (not the 4:3 area) so they match the full-canvas 3D scene.
* Text containing `%` goes through `vsprintf` in the original (the text is the format string); not reproduced: no text of the data contains a `%` (gaps.md U5, scanned).
* A string with no space inside `maxChars` is cut hard (the original reads out of bounds).
* `Pause` label (section 1) and the `FileM*` placeholders are the original's behaviour as read from the code, not verified on a running game.
* Colour 10 (`0x3f000000`) draws opaque black like colour 8 (block 0x12 ignores the vertex alpha).

## 6. Screenshots / test page

`src/ui/test.html?scene=text|sprites|panel|tiles|fade|loading&w=1280&h=800` (`window.__ui.scene(name)`, `__ui.checkState()`); `node tools/browse.mjs "http://localhost:5499/src/ui/test.html" tools/steps/ui-test.mjs --size 1280x800`
(SCENES=..., TAG=...) writes `/tmp/bdb-shots/ui-<scene>.png`.
