# Touch control ("Touchbesturing")

Port-only feature (src/touch/controls.ts); no game logic changes. Every on-screen button is a LOGICAL button bit of the input mapper (docs/re/input.md), so menus, pause, dialog
pages, options and mini-games get exactly what a keyboard gives them, and the key bindings of the options page do not matter.

| button | bit | in the game |
|---|---|---|
| D-pad (8 way, drag allowed) | 1 Left, 2 Right, 4 Up, 8 Down | walk, steer, menu cursor |
| Alt | 0x20 | jump / brake |
| Shift | 0x40 | talk, use, pizza |
| Spatie | 0x80 | throw, gas |
| Ctrl | 0x10 | get in / out |
| Enter | 0x10000 | menus: choose, panels |
| Esc | `B.ESC` (0x40000000) | pause menu, back |
| `<` / Z (camera) | 0x1000 / 0x2000 | turn the chase camera (the view turns left / right: the eye orbits the other way) |
| X / C (camera) | 0x4000 / 0x8000 | camera up / down |
| - / + | mouse buttons left / right | chase camera zoom out / in (`input.mouse.buttons`) |

* `InputMapper.touch` (src/game/input.ts) is asked once per `update()` (the tick's sample) for `{ bits, mouse }`; nothing else changed there. A tap is held until the mapper has sampled it 3 times and
  at least 70 ms (same rule as tools/browse.mjs `key`), capped at 600 ms. A finger that stays down is held as long as it is down. Multi-touch: every button / the pad keeps its own pointer (pointer events, `setPointerCapture`).
* Menus: the canvas pointer (finger = mouse) works as before (hover selects, press activates; sliders by tapping a bar). `Shell.pointer.down` is kept until the menu engine has sampled it (a tap is shorter than a tick).
  Touch `pointerdown` on the canvas is `preventDefault`ed: no emulated mouse events (a tap would be the left mouse button = camera zoom).
* The key-binding page needs a keyboard (capture of a key); it can be opened and left with Esc, not completed with fingers.
* Layout (`TouchControls.layout`, `mode`): portrait = `strip` (4:3 picture moved to the top, buttons in the free strip below); landscape with margins beside the picture = `side`; otherwise `overlay`
  (widescreen, 4:3 tablets: over the picture, clear of the HUD columns, semi-transparent, hide button under the right HUD icon). Safe-area insets are read through `env(safe-area-inset-*)`.
  "Hide" (x) leaves a small tab; the choice is stored (`touchHidden`). Fullscreen button where the browser has it (not iPhone Safari). The buttons go away while a movie plays (a tap skips it).
* No page gestures: `touch-action: none`, `gesturestart` / `touchmove` prevented on the game root; the start screen is normal scrolling HTML with finger-sized targets (`@media (pointer: coarse)`).
* Option on the start screen: Touchbesturing automatisch / aan / uit (`le2-display.touch`, URL `?touch=1|0`). Automatisch = `(pointer: coarse)`, or touch points without hover.
* Tests (headless, muted): tools/steps/touch-island.mjs, touch-menus.mjs, touch-minigame.mjs (z05WAB, z17WAS, z39ASB), touch-start.mjs, touch-movie.mjs; `node tools/browse.mjs --touch [--size WxH | --device "iPhone 13"]`
  (Chromium: real multi-touch through CDP `touchDown/touchMove/touchUp`; webkit / firefox: taps).
