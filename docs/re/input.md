# Input (SDPad.cpp): exact semantics and where the port has them

Work package WP-INPUT (gaps I1, I2, I4, I5, I6). Sources: `LE2.c` / `LE2.asm.txt` at the addresses given, `src/game/input.ts`, `src/shell/{cheats,dik,screenshot,menuui}.ts`, `src/game/{camera,debug}.ts`.
Tests: `tools/tests/wp-input.mjs` (node), `tools/steps/wp-input-frontend.mjs` and `wp-input-play.mjs` (headless browser).

## 1. The poll (FUN_004376f9, once per frame: FUN_00423170, menus, movies)
`FUN_00437411` first polls the devices: keyboard (`FUN_004367ef`, `GetDeviceState` into 0x9dacb0), mouse (`FUN_00436264`, 0x9dab78 = DIMOUSESTATE2: lX lY lZ, buttons at +0xc), joystick
(`FUN_00436e85`, 0x9dadb0 = DIJOYSTATE2: axes at +0..0x14, buttons at +0x30 = 0x9dade0). Then `FUN_004376f9` builds the button word (DAT_0098383c):
1. for each of the 13 table entries (0x8aeb20, stride 0x30: +0 fixed key, +4 current key, +8 bit, +0xc flag): current key down -> bit; fixed key down **and flag** -> bit.
   A key code is `(device << 16) | id`: device 0 = mouse button, 1 = keyboard DIK, 2 = joystick button (`FUN_00437148`).
2. joystick (only when `Settings[0x13]` and the device state could be read): axes 0 / 1 (`FUN_004372d2(2, n)` = axis `>> 9`, rounded to zero) beyond +-0x40 give Left / Right / Up / Down; buttons 0..9 give
   0x10 0x20 0x40 0x80 0x1000 0x2000 0x4000 0x8000 0x10000 0x20000. The axes themselves are zeroed afterwards (`param_2[1] = param_2[2] = 0`).
3. Esc held -> the word becomes 0x40000000 (replacing everything). Windowed mode only (`DAT_009dab70 == 0`): Tab+Alt, F8 (auto-up toggle), F9, F4 (exit), F12.
4. F10 held -> `FUN_0040cd27` (screenshot flag). Cheat codes (`FUN_004375a8`). Finally, if the word is 0 and `FUN_00437fdf()` (lowest button down: mouse 0..7, keyboard `0x10000|DIK`, joystick `0x20000|n`) is
   non-zero: 0x80000000 (any key). A lone left mouse button is 0 there (`FUN_00437fdf` returns 0 for button 0), so it does not count.

### I1: pad buttons are NOT one-tick pulses
`FUN_004371ea(device, id)` = "down now and not down in the previous buffer" (0x9daecc mouse, 0x9dabac keyboard, 0x9daf08 joystick). The previous buffers are **cleared on every poll**
(`_memset(&DAT_009daed8, 0, ...)` in `FUN_00436e85`, likewise `FUN_004367ef` / `FUN_00436264`); the only writers (`FUN_00436366`, `FUN_004368f1`: memcpy state -> previous) have no caller (no `call 0x436366` /
`0x4368f1` in the asm). So `FUN_004371ea` is the plain held state. Pad buttons (and Esc, F10, the mouse buttons) are **held** while pressed, like the keyboard; the earlier reading of architecture.md 7.1 ("one-tick pulse")
was wrong, and the port keeps them held (`InputMapper.update`). Consequently there is no pulse length to tie to the simulation tick.
* Only the **first attached controller** is used (`EnumDevices(DI8DEVCLASS_GAMECTRL, ATTACHEDONLY)`, the callback `FUN_00436c5a` returns 0 = stop): `InputMapper.firstPad`.
* Stick threshold: `v = (int)(axis * 65536)` (DIPROP_RANGE +-65536), `(v + (v < 0 ? 511 : 0)) >> 9`, then `> 64` / `< -64`: exactly 0.5078125 of the deflection (the port's old "0.5" accepted exactly 0.5): `padAxisUnits`.
  The dead zone (DIPROP_DEADZONE 500) and saturation (9500) shift this by under 0.001 whichever way DirectInput scales between them (UNCERTAIN: not modelled, the browser gives the axes already normalised).
* The D-pad (POV hat) and the analog triggers are not read by the original (no POV, no Z axis): not buttons here either. Button order: DirectInput's, i.e. the raw HID order for pads with an unknown mapping; for pads with the
  browser's "standard" mapping the Xbox order A B X Y LB RB Back Start LS RS (standard indices 0 1 2 3 4 5 8 9 10 11). UNCERTAIN for non-Xbox pads with the standard mapping (the browser hides the physical layout).
* Pad buttons are **not rebindable** in the original either: the key page's capture (`FUN_00438099`) scans mouse buttons 2..7 and the keyboard only. The `JOY:n` name format exists for table entries only.
* Rumble: `FUN_00438518` is empty. No hot-plug handling in the original (enumerated once); the browser reveals pads after a first input, so the first pad present is used on every tick.

The state is read **once per tick** like the original's poll: a key pressed and released between two ticks is not seen. Bots must hold a key >= 5 ticks of the fixed 60 Hz step (70 ms or more; `browse.mjs` `key()` holds 70 ms, its island auto-tap 100 ms). `InputMapper.latchTaps` is a test-only switch that keeps taps.

## 2. Key bindings (FUN_00436f7d, FUN_00437e82, FUN_00437f6e): fixed key plus current key
`current[i]` comes from Settings 4..0x10 (default = the fixed key). `flag[i] = 1` unless the fixed key equals the current key of some entry (`FUN_00436f7d`). Rebinding entry A from key O to K (`FUN_00437e82`):
every entry whose fixed key is O gets flag 1 again, `current[A] = K`, every entry whose fixed key is K gets flag 0. So a rebound action answers to **both** the new key and its fixed key, and a fixed key that
has become another action's key stops acting for its own entry. `InputMapper.makeBindings` derives the flags from the current keys (the same state). Cancel (`FUN_00437f6e`) puts back the changed entries.
The key takes effect at once, not when the page is left (the page's OK saves `Settings.set`).

### I6: capture (FUN_0041f966 + FUN_00438099)
Polled every tick while a key is waited for: the entry's own current key counts while it is down (`DAT_009db288`); else the first mouse button 2..7, then the first keyboard key (DIK 0..0xff) that is **not the current key of any entry**
(no swapping with another entry: the swap code of the port was dead code); keys of the list at 0x8aef08 answer 0 (Esc, F10, LWIN, RWIN, APPMENU, the grave accent key). The key is remembered while it is down
(`DAT_009d9fc0/fc4`, never reset by Esc: a key held while Esc is pressed binds in the next capture) and **bound when it is let go**. Left / right mouse buttons are not bindable. `MenuUi.pollCapture`, `InputMapper.captureKey`.
Names (`FUN_0043839f`): `MOUSE%d` / `JOY:%d` literal, keyboard `!<table name>` resolved through the menu text tables (`!UP` -> OMHOOG, `!SPACE` -> SPATIE, unknown -> `!---`); `FUN_00438212` (once, at the first lookup) replaces the
layout dependent names (the keys left of Enter, `\`, `<`, `-` ...) from one of nine tables chosen by the text of `FEERASE` (SLET, WISSEN, SUPPRIMER, LOESCHEN, ELIMINA, SLETT, APAGAR, BORRAR, RADERA; anything else
- English included - gets the **French** table at 0x8af3b0: AZERTY letters A Z Q W M; the Dutch game uses the WISSEN table: `@ / ° " * + ' < ] -`). The help screen shows the same names through `FUN_004384c9(bit) + 1` (skips the first character:
`!UP` -> `UP`, but `MOUSE2` -> `OUSE2`, and an entry-less bit gives `---` + 1 = `--`): `keyCodeName`.

## 3. Mouse (I2)
`FUN_00437ca5`: buttons 0..3 -> 0x10 0x20 0x40 0x80; dx = `ftol(lX * ((Settings[0x14] + 5) * 0.05f))` (scale rounded to float, product truncated), dy = `-ftol(lY * scale)` (default sensitivity 45: x 2.5).
Only two readers: the menu (cursor) and the chase camera `FUN_0042c227` (asm 0x42c273): `dx, dy != 0` replace the camera sticks `state+0x1c / +0x24` (after the x0.25, before the x0.1: `camera.ts` `chase`), the **left button** zooms
out like `<>`+Z, the **right button** in like X+C. The system cursor is hidden and re-centred every poll in the original (relative mouse).
Browser: the movement only exists under Pointer Lock. The chase camera calls `input.markMouseLook()` each tick; while it does, the mapper requests the lock on the next key press / click (a browser only grants it from a user action;
`unadjustedMovement` where available = raw counts like DirectInput) and gives it back one tick after the camera stops asking (pause menu, cutscene). Esc is swallowed by the browser when it releases the lock: a lock that is
lost while the look was active is read as an Esc press (pause). Mouse buttons are tracked always (`mousedown` / `mouseup`), mapped to DirectInput's indices (left 0, right 1, middle 2, back 3, forward 4).
Headless Chromium refuses the lock (WrongDocumentError): `wp-input-play.mjs` fakes `document.pointerLockElement` to test the movement path.

## 4. F-keys and aids (I4)
* **F10 = screenshot** in every mode: after the flip `FUN_0041278c` -> `FUN_00412f2f` writes `<PHOTOS>\Lego0000.bmp` (the first name of Lego0000 .. Lego9999 that does not exist; PHOTOS = STD.str "Fotos"; `formats.md`: `Fotos/Fotos.txt`
  "press F10 during play to save a screenshot in this folder"), 24 bit bottom-up BMP, 2000 px/m. `screenshot.ts`: same file format, offered as a **download** named by a localStorage counter, taken after the tick's frame (microtask).
  Deviation: the original takes a picture on every poll while F10 is held (one file per frame); here one per key press (a browser would block the burst of downloads).
* The port's **stub aids** (F9 completes the story step / finishes a mini-game / leaves a room, F10 fails a mini-game, the ported zones' test aids z39ASB F9 / F10, z02LGI / z03PPH / hub F9) are **only live with the debug option**
  (`src/game/debug.ts`: the start page's "Debugmenu" checkbox or `?debug=1`); the bot scripts under `tools/steps` that press F9 / F10 need `&debug=1` in their URL. F4 / F8 / F12 (windowed debug keys of the original) are not ported.

## 5. Cheat codes (I5, FUN_004375a8 / FUN_00437515)
Rows at 0x8aed70 (0x40 bytes each, DIK, 0-terminated), armed flags at 0x8aeef0 (**file image: 1 1 1 1 0 0**: SDREAMS and DAFFODILE start un-armed, so the first-ever key press only re-arms the rows and a first-ever SDREAMS must be typed twice;
this is in `tools/tests/m5-audit-cheats.mjs`). Polled once per tick with `FUN_00437fdf`'s value, acts on a change only: the sequence is "lowest key down" events, so a held modifier or a rollover changes what is seen (typing with Shift held cannot complete a word).
| row | word | handler (`FUN_00437515`) | port |
|---|---|---|---|
| 0 | PEPPERONI | `FUN_0041b357`: DAT_008a933c = 6 (never read) | debug only (windowed mode), `cheatState.pepperoni` |
| 1 | FSMADVANCE | `FUN_00404c07(var 0x58 + 1)` | debug only, `story.jump(node + 1)` |
| 2 | RHUNRHEGED | `FUN_00438cb0(0, "...\\SDPad.cpp", 0x2f7, "You found something better than EQ?")`: dialog "Error in Game" (Error Message / File / Line / Message, buttons Continue, Debug, Quit); every button but Debug ends the program (exit(0)); Debug = `int 3` | modal dialog, any button = `location.reload()` (the browser's exit) |
| 3 | BAATAT | `DAT_009da5b4 = 1; FUN_00420674(-1)`: the island decor era table for story node >= 0x40 uses era 4 instead of 3 (`FUN_00420674`: `local_18 = (node >= 0x40) ? (DAT_009da5b4 ? 4 : 3)`; 0x8accd0 + era*4 + i*0x14 -> 0x8acb98) | `cheatState.baatat` (the decor set-up of the island must read it: not wired, src/island is WP-ISLAND's) |
| 4 | SDREAMS | `FUN_00417597(0xd, 1)` | var 0xd = 1 |
| 5 | DAFFODILE | none | completes, nothing happens |
Rows 0 / 1 are only scanned when the original runs windowed; the port scans them with the debug option.
