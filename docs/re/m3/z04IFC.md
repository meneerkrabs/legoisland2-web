# z04IFC, the Information Centre (M3)

Zone table index 4, kind 3 (room), loop `FUN_0054996a`, set-up `FUN_0054e6e4` (builder `FUN_0054e760`, loader `FUN_0055c4f9`), music key `menu`. Entered from the island door `INFC`
(var 5 = 4; the island's arrival code puts the player back at `INFC` when `PREV_SUBGAME` is z04IFC / z05WAB, architecture.md 3.2). Code: `src/zones/z04IFC.ts` (the four behaviours
+ the zone game), `src/zones/z04IFC/ifc.ts` (the pure room: camera states, pins, door, menu flow), `pages.ts` (page table read from the EXE, text lines of a character page),
`dialog.ts` (the dialog page the menu engine had no drawing for). Test `tools/tests/m3-z04IFC.mjs`, headless run `tools/steps/m3-z04IFC.mjs`.

## 1. What the room is

There is **no walking** in this room (the task text "how the player walks in" does not apply): record 7 is `PEPP`, but its behaviour is the room controller, not `SGwalk`. Pepper stands
at the information desk (`rec 7`, Euler yaw pi at (2.657, 0, -3.761)), the **camera flies in** from the side (24 units, 21 ticks), and shows the wall with the **map of the island and
17 pins** (records 32..48, `PONT`; only the selected pin is drawn: the yellow arrow). Keys (the original's button bits `DAT_00983840`):

| view (controller state, +0x18) | keys | effect |
|---|---|---|
| 0 fly-in -> 4 -> 3 far view | | x = 24 - 1.2 cnt, z 7.2, 21 ticks; the same call settles into state 3 |
| 3 far view (eye (0, 7.04, 7.2)) | Up / Shift / Enter | zoom to the map (state 5, 21 ticks, z = 7.2 - 0.52 cnt), sound MAINON |
| 3 | Left / Down | "leave?" sequence: state 7 turns the camera for 9 ticks while the door opens (5 degrees per tick), then state 8 + the question (loop mode 5, page 15 `AFSLUITEN`: `OK` / `Annuleren`) |
| 1 map view (eye z -4.8) | Left / Right | select the neighbouring pin record (record - 1 / + 1, only when it is a `PONT`), pointer sound; the caption of the pin is shown |
| 1 | Shift / Enter | open the info menu (state 2): location page of the pin, Pepper plays clip 0x73 |
| 1 | Down | zoom out (state 6, 21 ticks, z = -4.8 + 0.52 cnt), MAINOFF; ends at the far view |
| 2 info menu | Up / Down / Enter / Esc | the menu engine (`FUN_0041fd45`); Esc on the top page closes it (state 1, Pepper clip 0x78) |
| any, menu closed | Esc | the pause menu (page 29, mask 0x40, `FUN_005498f5` = `FUN_0041bd3d(&mode, 0x40, 5)`) |

While the info menu is open (`DAT_05d587c8`) the loop skips the pause trigger (`FUN_00549911`: `if (DAT_05d587c8 == 0) FUN_00423170`), so Esc is the menu's back key. The room mesh
(record 0, `LAND`) is hidden while the menu is open (mode 2 of the loop), so the menu shows over the map wall; the selected pin and the other `G00x` records stay.

## 2. What was ported (function by function)

| EXE | port | what |
|---|---|---|
| `FUN_0054bce3` (update of the controller node, vtable 0x8f0a08) | `IfcRoom.update` | three loops every tick (MAINLOOP 635, TYPING 697, PRINTER 698), four sporadic ambient sounds (`trunc(rand * ms) % 2000` = 0x479 WIBBLE 702, 0xf4 GARAGE3 700, 0x330 BOING 701, 0x635 GARAGE2 699), Pepper's record visible + placed while the menu is closed, the key handling of states 1 and 3 |
| `FUN_0054c00d` (prerender) | `IfcRoom.camera`, `ControllerNode.prerender` | camera eye / target per state (sequential `if`s like the original: state 0 -> 4 -> 3 in one call), the exit-question flag (`DAT_05d587cc`) after the 9 tick turn, Pepper's animation advances 1.0 per tick; `DAT_05d587d0 = (state != 1)` |
| `FUN_0054c398` (draw hook, state 2) | `IfcRoom.afterFrame` | runs the info menu once per tick (the loop does not read the keys itself while the menu is open: the step calls `FUN_00423170`); the end goes back to state 1 with Pepper clip 0x78 |
| `FUN_0054b7f2` | `IfcRoom.menuFrame` | first call only starts the engine at the pin's page (`DAT_05d587b8[7] == -1`); a page change plays one of the three info sounds (`trunc(rand * ms) % 3`, ids 639..641); Esc on the top page ends the menu |
| `FUN_0054bc04` ctor, `FUN_0054b982` (update), `FUN_0054bb49` (draw) | `PinNode`, `IfcRoom.pinUpdate`, record visibility | node data: page (+0x18), id (+0x1c), amplitude 0.04 (+0x14), angle (+0x24). The selected pin (var 0xfa) shows its caption (only in map view with the menu closed), moves the selection with Left / Right (clearing the key so the next pin of the pass does not see it), and bobs: `y += sin(angle) * 0.04`, angle += 10 degrees, wraps after 2 pi (the pin rises by 0.457 and returns; a pin that is deselected keeps its offset). Only the selected pin is drawn (record flag) |
| `FUN_0054c9f7` ctor, `FUN_0054c90b` | `CharacterNode` | the figure's animation advances every tick, shown or not |
| `FUN_0054ccae` ctor, `FUN_0054caa1` | `DoorNode`, `IfcRoom.doorUpdate` | door record 30: 4 states, angle 0 .. -90 in steps of 5 while `doorWanted` (state 7 of the controller sets it, the cancel of the question clears it); `FUN_0043a5e4(rec + 0xc, 0, angle * 0.01745, 0, 17.792, 4.455, -0.559)` |
| `FUN_0054c4a7` | `readIfcPages`, `IfcRoom` | the controller's ctor: `FUN_00439126(IFC.str)`, the menu context `FUN_0041c1a7(0, 0, IFC table, 0)` with the page table 0x8f0658, item 0 of the 29 character pages gets `&record[k]` |
| `FUN_0054ce86` | `createIfcGame` | the set-up: attaches (controller to rec 7, 17 pins with their page, 28 figures + clip 0x73, door), Pepper clip 0x3a, var 0xfa = record 47 (pin of page 3, `IFCINFC`), camera init |
| `FUN_0041cbac`, `FUN_0041c964` | `drawDialog`, `infoLines` | the kind 2 menu page (see 4) |
| `FUN_00460003` | `draw2d` | the caption of the selected pin: csm font (slot 0), colour 0 (yellow), centred at (400, 542) of the 800x600 reference grid, mode 2 only, not while the menu is open |
| `FUN_0054996a` | the runner's loop template + `ZoneGame` hooks | modes 7 / 0 / 2 / 3 / 5 / 8; mode 5 = the exit question (`FUN_0041c092(&mode, 0, 0)` = page 0xf); end: `FUN_00404d14(&next, exit == 2, 1)` for every exit (pause "quit" included, see 6) |
| `FUN_0054a001`.. (29 start-up initialisers `0x54a001`, `0x54a0d3` ... `0x54b72f`) | `readIfcPages` | the character pages' items: item 1 label = the string at `0x8f0a50 + 0x14 k` (`!IFCxxxx02`), item 2 `!BACK` type 2 (string at +0xc), types / values 0 |

### Constants (EXE addresses)

eye y / target y 7.04 (0x40e147ae literal), default eye z -4.8 (0x892618), default target z -12.8, far z 7.2 (0x89261c), fly-in start x 24.0 (0x8921a4), 0.15 * 8 per tick (0x892624 * 0x892090),
zoom 0.065 * 8 per tick (0x892620 * 0x892090), 0x14 / 8 step limits, turn angle `cnt * pi / 20` (0x89207c, 0x89237c) with target (sin a, 7.04, -2 - cos a) (0x892610), hold angle the double
`0x3ff41b2f80000000` (1.2566370964), Pepper place (0x40490fdb, 0x402a0c4a, 0xc070b439), door rate 5 (0x892070) / -90 (0x892628) / 0.01745 (0x8920d8) / position immediates (0x418e5604,
0x408e8f5c, 0xbf0f1aa0), pin amplitude 0x3d23d70a, step 0x89211c (10 degrees), wrap 0x892094 (2 pi), figure offset 2.8 / 2.16 (0x89206c / 0x892068), caption 542 / 400 / 600 / 800
(0x8923b4 / 0x892394 / 0x89238c / 0x892390). All asserted against the executable in the test.

### Sounds (`FUN_0054cd70`, ids = sound table indices, `FUN_00443580` loads, `FUN_004435a0` plays)

0x27b `SND_IFC_MAINLOOP` (looped every tick), 0x27c `MAINON` (zoom in), 0x27d `MAINOFF` (zoom out), 0x27e `POINTER` (pin moved), 0x27f..0x281 `INFO1..3` (page opened, random), 0x2ba
`PRINTER` and 0x2b9 `TYPING` (looped every tick), 699 `GARAGE2`, 700 `GARAGE3`, 0x2bd `BOING`, 0x2be `WIBBLE` (sporadic). The menu uses the shared `SND_MENU_*` sounds (cursor move
round robin, select 0x25e, back 0x25f). Music: key `menu` (`ZONE_MUSIC`). No speech in this room.

### Game variables

Only the zone-local var **0xfa** (selected pin record, cleared on zone entry, set to record 47 at set-up) and **0xb** (`STARTEDFROMMENU` := 0 whenever the exit question is answered,
`FUN_0041c092`). The room never touches a trophy, score or story variable. Leaving: `FUN_00404d14(&next, exit == 2, 1)` (`StoryFsm.miniGameExit`): from the island (the normal case) the
story zone is not z04IFC, so the next zone is `PREV_SUBGAME` (var 0xa3) = the island; when the story itself waits in z04IFC (`?zone=z04IFC` jumps to node 70, `NS_OFF == 1`, which the game
never completes by itself) the exit completes the node and the story moves on (node 71 = z50LTC).

## 3. The info menu (pages from the EXE)

The page table is `0x8f0658` (46 pages x 20 bytes, items 0x4c bytes: the shipped front end / pause pages' layout):

* pages 0..16 (kind 0): the 17 locations: title `!IFCxxxx` (IFC.str), one `goto` item per person (value = character page), `!BACK`.
* pages 17..45 (kind 2): the 29 characters: record k = page - 16 (record 1..29: `BRIK INFO PAPA MAMA NICK BILL PEPP NANC NUBB LICK VALS TBOB DJAB STEV RICH ROBB POST JACK CLIK XXX0 XXX1 XXX2 MAIL SUPE HOGG REDG SNAP PETE DARR`;
  **record 7 is Pepper's own record**: his page moves the player record in front of the camera; the controller puts it back when the menu closes).

| pin record | page | location | people (page) |
|---|---|---|---|
| 32 | 7 | Space Port | Technician Bob (28) |
| 33 | 0 | Huis 2 | Red Greenbase (42), Snap Lockitt (43) |
| 34 | 16 | Treinstation | Super-stationschef (40) |
| 35 | 15 | Winkel 1 | MP_Post (33), Ed Mail (39) |
| 36 | 6 | Huis 3 | Steve Hen (30), Rob Stuff (32) |
| 37 | 8 | Skaterspark | Rhoda Hogg (41) |
| 38 | 1 | Radiozender | DJ (29) |
| 39 | 5 | Huis van Pepper | Pepper (23) |
| 40 | 14 | Pizzeria | Papa (19), Mama (20) |
| 41 | 2 | Huis 1 | Darren Eana (45), Rich Pickings (31) |
| 42 | 13 | ResQ hoofdkwartier | Valerie (27) |
| 43 | 9 | Garage | Nancy Nubbins (24), Nubby Stevens (25) |
| 44 | 4 | Ziekenhuis | Dokter Clickit (35), Pete Bog (44) |
| 45 | 11 | Politiebureau | Nick (21), Laura (26) |
| 46 | 10 | Winkel 2 | Jack O Trades (34) |
| 47 | 3 | Infocentrum | Infomaniak (18) |
| 48 | 12 | Gevangenis | Brickster (17) |

Bill (page 22) and the three footballers (pages 36..38) have a page but **no location links to them** (data fact, reproduced). A character page shows the name as title and **one text
line, the "Beroep" line**: item 1's label is `!IFCxxxx02` and `FUN_0041c964` prints that id first, then tries `...03`, `...04` until a lookup returns the id itself (the `...01` "Leeftijd" lines of
IFC.str are never looked up: the labels start at 02, and `IFCINF01` is a typo of the original anyway). Long lines wrap at the last space that fits `(12 + 2) * 24 = 336` px.

## 4. The dialog page (`FUN_0041cbac`, kind 2)

menudraw.ts only knew the normal / list pages. The kind 2 page: panel half width 10 tiles around x = 320, 18 rows from y0 = `0xf0 - ((n * 2 + 0xb) * 0x18) / 2` (= 36 for 3 items); the row table
0x8a99c8 (-5 top, 0 title (two rows), -2, -1, 11 x -7 body rows, -1, then item 2 = the back button, last row -6): the body rows draw the left edge, a **transparent window** (columns -11..-4,
where the 3D figure shows) and the panel from column -3. The figure (record `page - 16`) is placed every frame with an identity rotation and the position `(target - m0 * 2.8) - m4 * 2.16` (x), `(target - m1 * 2.8) - m5 * 2.16` (y), `(target - m2 * 2.8) - m6 * 2.16` (z) of the view matrix `m` that FUN_0043cc5c builds (D3D layout: m0 / m4 = right.x / right.y, m1 / m5 = up.x / up.y, m2 / m6 = forward.x / forward.y; `placeFigure` in `z04IFC.ts`; this is NOT "target - 2.8 right - 2.16 up" component-wise: the two agree only for the map camera, where right.y = up.x = forward.x = forward.y = 0, = (2.8, 4.88, -12.8)), flag 2 set; leaving the page hides it (`FUN_0041fd45` case 2). Text lines at x = 272, y = `i * 30 + 0x78 + itemDy + y0`, item font (Balloon12), colour 1.
`FUN_0041fd45` forces the cursor of a kind 2 page onto item 2 (menu.ts: one additive line), so Enter / Shift / click activate the back button.

## 5. Shared files touched (additive)

* `src/shell/zonegame.ts`: `ZoneGame.blockPause()`, `ZoneGame.dialog { page, wanted(), done(ok) }`, `ZoneGame.exitNext(exit)`.
* `src/shell/playzone.ts`: passes `pressed & ~Esc` to the loop machine while `blockPause()`; opens the zone's dialog page in mode 5 (`dialog.page`) and maps its answers (OK = leave, Annuleren =
  back to play, result 99 used once); `exitNext` overrides `nextAfterExit`.
* `src/shell/loopmachine.ts`: `LoopInput.dialog` (mode 2 -> 5) and result `99` (mode 5 -> 2).
* `src/shell/menu.ts`: kind 2 pages keep the cursor on item 2.
* `src/shell/audiohost.ts`: `AudioHost.restart(id)` (`FUN_004435b0` + `FUN_004435a0`).

## 6. Known differences / approximations / not ported

> **Status 2026-10-31 (WP-SHELL-FINAL): historic list, nothing of it is open.** Camera / Pepper / door / pin values are float32 per operation and compared with the original at tolerance 0 (`m5-audit-z04IFC-emu`, 1.5 M comparisons: the bullet "camera values are doubles" is obsolete); the input / Esc handling happens before the update pass and the update runs in modes 7 / 5 (`escTick`, `src/zones/z04IFC.ts`); the faces exist; there IS an oracle (the x86 emulator, so "not verified against a running original" is obsolete). Only the debug-key `FUN_00423f7b` (F8, windowed only, gaps.md T3) is deliberately not ported.

* **[Corrected by WP-VERIFY: the faces exist since M4 WP10 (`Model.face`, `FaceSetup`, docs/re/m4/wp10-render.md); the paragraph below is the state at M3.]** Figure faces were missing (the 28 heads rendered plain yellow, Pepper's showed a smear): the head parts list a second texture, an expression sheet (`textures/text192.wib` for Infomaniak, 16 faces
  of 64 x 64), and the original binds the head to its face system (`FUN_0043f1d0(model, slot 4, 5, ..., 1)` in the builder = `BrickMorph`, plus `SwapText.c`: `FUN_00443810` / `FUN_004439f0` choose the
  expression). The shared renderer (`GameRenderer` / `Renderer.texture`) freezes such a sheet on frame 0 and does not do this binding, so the face never appears. Not investigated further (it is shared
  code and affects every talking character: M4).
* `FUN_00435c91` is `GetTickCount - DAT_009dab64` (the zone clock base, set by `FUN_00435c81` in the loop prologue: `startTickClock()`); the port reads the real tick count the same way (`msClock()`), and `rand()` is the shared C runtime LCG of `src/game/crt.ts` (WP-TIME): the ambient sounds and the info sound choice are `ftol(FUN_004388ae((float) ms)) % n` (`IfcHost.pick`), float32 per operation, random (time seed) in both; the zone does not call srand.
* Camera values are doubles in the port (float32 in the EXE), the interpolation between ticks is the shared renderer's.
* The pause menu items (page 29) are the shared ones; Esc at the exit question opens the pause menu like in any mode 5 (the original does the same through `FUN_00423170`).
* **Pause "Stoppen" (quit) does not reach the front end in this room**: in `FUN_0054996a` the pause result -1 sets exit 0 / next -1 and then *falls through* (asm 0x549d06 -> 0x549d1b) to the
  abort code (next = story zone, exit state 4), so like "Afbreken" it ends in `FUN_00404d14` (the island). `exitNext` reproduces that.
* Order inside a tick: the original reads the input and handles Esc (pause) **before** the update pass of the same loop iteration; the shared runner (`playzone.ts`) ticks the world first. Only
  matters for two keys in the same 33 ms (Esc together with a map key). The original also runs the update pass in the fade-in (mode 7: the three loops start, pin 47 bobs while the screen fades in)
  and the pre-render pass in mode 5 (Pepper's animation goes on behind the exit question); the shared runner ticks the world in mode 2 only.
* Mouse: the info menu uses the engine's pointer handling (hover / click on items and on the back button); the pins themselves are keyboard only like in the original.
* `FUN_00423f7b` (the demo / attract mode that advances the story after 0x97 frames when `DAT_009da634 != 0`) is not ported (it is never active in a normal run).
* Not verified against a running original (no emulator): the on-screen look is checked by the screenshots below and by the code reading.

## 7. Tests / how to run

* `node tools/test-formats.mjs --only m3-z04IFC` (534 checks): constants and the 13 sound ids / names / the load order of `FUN_0054cd70`, the 46 pages (kinds, goto targets, labels resolve in IFC.str,
  the 4 unreachable characters), the text lines (wrapping, ids 03/04), the camera states with scripted keys (fly-in, far view, zoom in / out, the 9 tick turn and its constants, hold, turn back), the
  pins (neighbour selection, ends, key consumption, bobbing), the door (open / close / reverse), the menu (open at the pin's page, all 17 locations x all people x back, Esc, the info sounds picked by
  `rand * ms % 3`), the ambient sounds, the exit question (cancel / OK), the dialog row table, and the zone set-up through `setupZone` (controller / 17 pins with their pages / 28 figure nodes / door,
  figures hidden, nothing of the room skipped).
* Headless run (muted): start a dev server (`npx vite --port 5499` or a private one) and
  `node tools/browse.mjs "http://localhost:5499/?zone=z02LGI&mute=1" tools/steps/m3-z04IFC.mjs --size 1280x800 --out /tmp/m3/z04IFC`: from the island (`var 5 = 4`), the fly-in, the far view, Up to the
  map, captions with Left / Right (first, last, ends), the info menu (location, person, Esc, Esc), the pause menu outside it, Down, Left, the exit question (Annuleren, again, OK -> the island), then
  `?zone=z04IFC` (story node 70): the exit moves the story to z50LTC (28 checks, screenshots `ifc-1..10`; also the pause menu "Stoppen" -> island).
* Screenshots looked at: the fly-in (map wall, Pepper from behind), the map view with the yellow arrow and the caption `INFOCENTRUM` / `WINKEL 2` / `SPACE PORT`, the location page (title, person, back),
  the character page (figure on the left in the transparent window, name, `BEROEP: ...` line, `TERUG`), the pause menu, the exit question over the turned camera (door half open), the island afterwards.

## Shortcuts

* `?zone=z04IFC` starts in the room with the story at node 70 (exit completes the node: next zone z50LTC); a realistic entry: any island run, then `__shell.vars.set(5, 4)` (what the `INFC` door does).
* `window.__zone.game.debug()`: `{ state, cnt, menuOpen, exitAsk, door: [state, angle], selected, caption, page, character, eye, target, pins, var }`; `__zone.game` has no other public surface.
* Keys: Up / Shift / Enter zoom in, Left / Right pins, Shift / Enter open, Esc back / pause, Down zoom out, Left / Down at the far view asks to leave.

## WP-PART-WIRE (2026-10-29): particles

`FUN_0054e6f6` creates the engine `FUN_00442900("z04IFC")`; the zone's code never starts, gates or moves an effect (no call of `FUN_00442960` / `FUN_0044e920` / `FUN_00442a20` in the region 0x5498f0..0x568fc0 outside the island-era copies of z03PPH). Nothing to wire. Closed.

## WP-MINI (2026-10-29): residuals closed

* **Float32 / 24-bit x87 exactness.** `m5-audit-z04IFC-emu` now runs the original at cw 0x7f (Direct3D leaves single precision) and compares **bit for bit** (tolerance 0, was 2e-5 against a 53-bit oracle): 1,510,883 comparisons, 0 differences, over the scripted walk and three 6000-tick random runs. What had to change: `IfcRoom.camera` rounds every operation of `FUN_0054c00d` to a float (fly-in x = `24 - ((cnt * 0.15) * 8)`, zoom z = `7.2 - ((cnt * 0.065) * 8)` / `((cnt * 0.065) * 8) - 4.8`, turn angle `(float)k * pi / 20`, `sin` / `7.2 - cos` stored as floats), the pin bob is `float(float(sin(angle) * 0.04) + y)` (`FUN_0054b982`), and Pepper's / the door's matrices are `FUN_0043a5e4` in 24-bit (`euler24`, `src/zones/common/x87.ts`; the door's angle is `float(angle * 0.0174532)`). `m3-z04IFC` asserts the factors (0.15, 0.065, 8) instead of their products.
* **Faces / expression system**: the zone's code never starts the expression machinery: no call of `FUN_00443810` / `FUN_004439f0` (SwapText) or `FUN_0043f2f0` in the zone's code range 0x5498f0..0x568fc0 (the only callers are the shared menu engine's character-page code and other zones); the figures' faces come from `FUN_0043f1d0` in the figure builder (`FUN_0054e760`), which the shared `FaceSetup` of the renderer covers (WP10). Closed.
* **Order of input and update, modes 7 / 5**: done by the M5 audit (`escTick`, mode 7 = update pass only, mode 5 = pre-render only, before the menu step), see audit-rooms.md.
* Not ported: `FUN_00423f7b` / F8 (the demo toggle: a debug key of the shared loop code `FUN_004376f9`, read only while `DAT_009dab70 == 0`; never active in a normal run) (the demo toggle is also listed in gaps.md T3). The time base and generator of the ambient sounds are exact since WP-TIME (`IfcHost.pick`, see above); the zone's loop has no frame limiter (the `QueryPerformanceCounter` values stored before the loop are never read: dead code, gaps.md T3). dt: the room's counters are per frame (integers `cnt`, the pins' 10 degrees, the door's 5 degrees); only Pepper's and the figures' animation advances step by `1.0 * DAT_008b1718` (`FUN_0054c00d`, `FUN_0054c90b`: `advance(1.0, w.dt)`), `m5-audit-z04IFC-emu` runs dt 1 and 0.5. The character model's position (`FUN_0041cbac`: `(target - right * 2.8) - up * 2.16`) is float32 per operation (not covered by the oracle).
* Particles: none (see above). Tests: `m5-audit-z04IFC-emu`, `m3-z04IFC` (534), bot `m5-z04IFC`, `m3-z04IFC`.

* **Character figures oracle (2026-10-31)**: `m8-z04IFC-figures` runs the original's placement of the figure record (FUN_0041cbac 0x41d65c .. 0x41d73b, the view matrix natively through FUN_0043cc5c / FUN_004165a5) in the emulator at cw 0x7f against `placeFigure`, for the camera of all 9 states x 25 counters of FUN_0054c00d (225 cameras) and all 28 figure records: 111208 values (16 matrix floats, flags, the camera's 18 floats incl. the view basis) bit for bit, plus the page -> record links of the 29 character pages read from FUN_0054c4a7's result. Found and fixed: the port took the view basis vector-wise (right.x / up.x ...) instead of the original's m0 / m4, m1 / m5, m2 / m6 reads: wrong for every camera with forward.x != 0 (the z of the figure had the wrong sign / magnitude there), invisible only with the map camera. The matrix elements 3 / 7 / 11 / 15 are no longer overwritten (the original does not write them).

## Closure 2026-10-31 (fork C)

Section 6 re-read: 'figure faces missing' (corrected in the first bullet by WP-VERIFY) and 'camera values are doubles' (the room's camera is float32 per operation since WP-MINI, bit exact against the original: `m5-audit-z04IFC-emu`, `m8-z04IFC-figures`) are historic; the order 'input / Esc before update' and modes 7 / 5 were done by the M5 audit (`escTick`). The demo / attract mode `FUN_00423f7b` is reachable only through the F8 key of the windowed debug keys (`DAT_009dab70 == 0`, gaps.md T3): not part of a normal fullscreen run, deliberately not ported. Nothing open.
