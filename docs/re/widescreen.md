# Widescreen ("Beeld: 4:3 (origineel) / breedbeeld")

Option of the port, not of the original. Default: **4:3, the original**. Choose it on the start screen (`Beeld:`, next to "Introfilms overslaan" / "Debugmenu") or in the
game's own Options -> Afbeeldingen page (the greyed-out resolution entry, item 4 / action 14, is the switch: "Beeld: 4:3 (origineel)" / "Beeld: breedbeeld"; the page keeps
its rows). Stored in localStorage `le2-display` (`src/display.ts`), not in `Settings.set` (the original's 92-byte file keeps its layout). `?wide=1` / `?wide=0` override it
for one session.

## What the original does

The 3D scene is projected with a fixed aspect of **0.75 (h / w)** whatever the display mode: `FUN_0040c8c6` / `FUN_0041533b` get `push 0.75f` (file offset **0xCAC3**, VA
0x40CAC3 in the Dutch EXE: `68 00 00 40 3f`). The LI2 Mod Manager's widescreen hack writes `height / width` over it and adds more resolutions to the table at 0x52D6;
the vertical field of view (1.0 rad) stays, so a wider window shows MORE at the sides (rendering.md 3.1). The 2D layer scales three reference grids (800x600 HUD,
640x480 menus and fonts) to the surface and is not adapted; with the hack it is stretched.

## What the port does

* **Canvas**: 4:3 mode = the largest 4:3 box in the window (as before). Wide mode = the whole window (`Shell.fitCanvas`, `display.canvasBox`).
* **3D scene**: `projection(setup, aspect)` with `aspect = Renderer.aspect` = the canvas' width / height and the **same vertical FOV** (`GameRenderer.render`). Everything
  that is derived from the view follows from that one matrix:
  * frustum culling / the records' frustum flag (`clipPlanes(viewProj)`; the island's `inFrustum`) use the planes of the actual matrix, so more records are "in view";
  * LOD is by distance only (`selectLod`: `lod^2 < zoom * dist^2`, `zoom` = the FOV factor, unchanged): nothing to do;
  * sky dome (radius `1.2 * range`) and sea plane (`2.5 * range`, snapped to 0.25 range) are placed from the camera and the draw range, not from the aspect: at 16:9 the
    horizontal field is 87 degrees (72 at 4:3), the corners of the far plane are 1.5 x range away and lie in fog (fog end <= range), so nothing shows beyond the plane;
  * z39ASB's star backdrop quad is built from "the frustum's unit plane" (+-0.7 along right and up at distance 1): its horizontal half extent grows with `aspect / (4/3)`
    (`backdropCorners(..., widen)`), otherwise the sides of the picture would be empty.
* **2D layer** (`Ui2D`, `fit: 'fit'` in wide mode): the 640x480 grid stays a **centred 4:3 area**; the area is never stretched. Decision per element group:
  | group | wide mode |
  |---|---|
  | menus (main, options, pause, result menus), help / intro / brief panels, credits, loading card, level banners, subtitles | centred 4:3 area |
  | HUD left group (icon at (20, 20), counter text, icon column x = 20) | anchored to the **left** screen edge (`Ui2D.anchor('left')`) |
  | HUD right group (icon at (716, 20), counter text, vertical gauge) | anchored to the **right** screen edge |
  | HUD centre text (hi-score) | centred 4:3 area |
  | fade to black / cutscene letterbox bars | whole canvas (full width) |
  | movies (`engine/movie.ts`) | their own 4:3 element, centred on black as before |
  | the 3D picture of the **front end** (z60FRE) | centred 4:3 area, black bars (`Renderer.fixed43`): its stage is a flat painting that does not continue sideways |
  Every zone whose HUD goes through `shell/hud.ts` (island, parachute, bi-plane, whack-a-bot, ...) is anchored this way; the few zone modules that draw their own HUD pieces with
  `ui.sprite` stay in the centred 4:3 area for now (z39ASB's slot column and gauge, z41MAP's gauge, z10RGB's full-screen cannon-barrel overlay, which in wide mode covers the
  4:3 part only): one `ui.anchor('left' | 'right')` call around their drawing code would anchor them (`ui.anchor('centre')` after).

Checked with headless screenshots at 1280x720 (wide) and 1024x768 for the front end, the island (cutscene and play), Pepper's house, the information centre, every mini-game
zone, the pause / options menus and cutscenes: `tools/steps/widescreen.mjs` (all zones, `WIDE=0` for the 4:3 comparison). A 4:3 window gives the identical picture in both modes.
* **Pointer**: `Shell.attachPointer` maps client px -> canvas px -> the 4:3 area (`ui.view`) -> 640x480, so menu clicks hit in both modes.

`Ui2D.anchor(side)` only changes where the area's own offset goes: with a 4:3 canvas all three sides are the same, so 4:3 mode is unchanged.
