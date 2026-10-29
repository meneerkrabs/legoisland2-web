# Ontwikkelaarshoek (developer corner)

Debug mode only (`src/game/debug.ts`: the start screen's "Debugmenu" checkbox or `?debug=1`). Without it nothing of `src/devcorner` is loaded and the game is exactly the original
(`tools/tests/devcorner-off.mjs`). Research: `docs/re/unused.md`. UI in Dutch.

## Reaching it
* Start screen: with "Debugmenu" on, an extra button "Ontwikkelaarshoek" starts the game (intro skipped) with the corner open in the front end.
* Anywhere (front end, every zone): the **` key (Backquote)**. It is not in the original's key table 0x8aeb20 (13 entries: arrows, Ctrl, Alt, Shift, Space, `<>`, Z, X, C, Enter), the key page's capture
  refuses it (DAT_008aef08), and the port uses no other key for it. The key never reaches the input mapper (the cheat detector does not see it). PgUp / PgDn change section, Esc closes.
* "spel pauzeren" (header): on = the game stands still while the corner is open; off = the panel docks at the side and the game runs on.
* UI choice: an HTML overlay, not the game's 2D layer: lists of hundreds of rows (319 variables, 805 meshes, 1,800 voice clips), search boxes, number fields and a WebGL turntable do not fit the
  8-row menu engine. The original's own menu pages (hidden "Debug" item, 17, 25, 26) run in the game's menu engine.

## Hooks in shared files (all additive, null / no-op without the debug option)
* `src/shell/playzone.ts`: `const dev = debugAids() ? (await import('../devcorner/index.ts')).attachZone(...) : null`; `dev?.tick()` after `sh.input.update()`; `dev.afterSim()` / `dev.storyLeave()` at the end of the play block;
  `dev.alpha(a)` in the render; `dev.exit` / `dev.destroy()` at the end; the old F8 view-plane key is skipped when the corner exists (`&& !dev`).
* `src/shell/frontend.ts`: the same (`attachFront`, `dev.leaveRequest`).
* `src/game/render.ts`: `GameRenderer.debugDraw` (+ the LOD hooks of section 4).
* `src/shell/menuui.ts` + `src/shell/shell.ts`: page 26 (QA zone list, set-up FUN_0041b274, action FUN_0041be4e branch 0x1a): `allZones` / `gotoZone` in `MenuContext`.
* `src/main.ts`: the start-screen button and `?devcorner=1`.
* Section 4's hooks in the collision / walk / vehicle / zone code are listed in its section's source (`camera-*.ts`) and in the report.

## Sections
1 Springen (story nodes, F9 FSM / sub-game jump, pages 17 / 25 / 26, PEPPERONI) | 2 Variabelen (319 vars, F9 "Switches" list, evidence scan) | 3 Cheats en geheimen | 4 Camera en tekenen |
5 Records / Objecten (F9 GOB list) | 6 Galerij: modellen | 7 Galerij: texturen en HUD | 8 Geluid en muziek | 9 Teksten | 10 Scenes / animaties | 11 Vliegen | 12 Over.

### Ported original functions
| function | what | where |
|---|---|---|
| FUN_0041b357 (DAT_008a933c = 6) | PEPPERONI reveals the 6th main-menu item "Debug" (0x8a788c, goto page 17) | `cheats.ts` `applyPepperoni` |
| FUN_0041b227 / FUN_0041b274 / FUN_0041be4e | pages 17 and 26 (checkpoint list, QA zone list) and their actions | menu engine (`menuui.ts`), opened from `springen.ts` |
| FUN_004015cc, FUN_004014c0, FUN_00404c07 | F9 dialog FSM group: `<` `>` `Jump To` | `springen.ts` `jumpToNode` |
| FUN_0040154b | F9 sub-game jump (var 5 = zone) | `springen.ts` `jumpToZone` |
| FUN_00401613 / FUN_00417597 | F9 "Switches" list / Set (vars 1, 2 ignored) | `variabelen.ts` |
| FUN_004026ed / FUN_00402898 / FUN_00401e61 / FUN_00401fab / FUN_0040218c / FUN_0040228a / FUN_00402388 | GOB list, Move To / By / Forwards, Paste / Copy | `records.ts` |
| FUN_004375a8 / FUN_00437515 | cheat rows (detector already in `shell/cheats.ts`); typing box and toggles | `cheats.ts` |
Sections 4, 6-11 have their own notes in their source headers.

### Not exact / uncertain
* The F9 dialog itself was never run; its logic is read from the decompile (the variable / jump / record functions are trivial wrappers).
* The jump leaves the running zone through the zone loop's pending override (the way the front end's checkpoint list does), not through var 5 alone: mini-game exits would otherwise rewind the story.
* "Variabelen" evidence = constant-index calls only (154 of 319 untouched; the research says 155, a lower bound).
* NS_OFF = 1 is applied through `GameVars.get` (instance override); code that reads the var array directly does not see it.
