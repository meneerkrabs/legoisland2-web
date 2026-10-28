# M3: generic zone UI (intro, controls help, banner panel, subtitles, intro table)

Code: `src/shell/helpscreen.ts` (panel, help, intro / banner screens, subtitle), `src/shell/zoneintro.ts` (`ZONE_INTRO`), hooks in `src/shell/playzone.ts` / `zonegame.ts`,
test `tools/tests/m3-ui.mjs` (`node tools/test-formats.mjs --only m3-ui`), browser steps `tools/steps/m3-ui.mjs`. Decompile helper scripts (decomp-le2/tools):
`ui_zoneintro.py` (calls of FUN_00439c6f / 460a3d / 461155 / 439bf8 / 435a11 in a zone loop and its text helpers), `ui_fonts.py`, `ui_fnof.py`.

## 1. The panel (FUN_00460a3d -> FUN_00460a66) and the three screens that use it

`FUN_00460a3d(width, rows, withTitle)` only stores a request (`DAT_008b9284 = 1`, `DAT_05d4e1a0/a4/8b9288`); `FUN_00461347` (called from the text flush `FUN_00439f51`,
i.e. after the 3D scene, before the queued texts) draws it with `FUN_00460a66`. The panel is the same 24 px tile frame as the menus (`menu/mOverlays`, tile
numbers = theme 0 of `menudraw.ts`: 0xf / 3 / 0x12 top, 9 / 0 / 0xc sides + fill, 0x15 / 6 / 0x18 bottom, 0x36 the notch under a title). The zone loops call
`FUN_00460a3d(0x16, 0x14, 0)` in mode 1 and in mode 4: a full screen panel (20 rows = 480 px, 26 tile columns = x 8..632), no title; the last plain row carries
`!PRESS` ("Druk op een toets om door te gaan...", PAUSE.str) in the small font (slot 0), white, centred, y = 452. `drawPanel(ui, env, rows, withTitle)`.

* **Mode 1 (intro)**: panel + `FUN_00439c6f(zone table, font main (slot 1, big), id, 1, 0 (yellow), 0x140, y, wrap)` for each brief line. A button press goes to mode 9 (or
  mode 2 when the zone has no help) and stops the speech. The brief is spoken when the loop starts (`FUN_00439bf8` + `FUN_00435a11` before the mode loop, z08BKD in mode 1).
  `drawIntroScreen(ui, env, lines)`.
* **Mode 4 (banner)**: same panel; z38PAR (`FUN_00465d39`): `%d` of the score (raw text, table 0) at y 100 wrap 30, the medal text from STD.str (`SGGOLD` / `SGSILVER` /
  `SGBRONZE`) at y 150 wrap 30, the zone's result lines (`LESGPT02`...) wrap 0x24 (36) at y 200 / 280 / 320 / 380 ... as the zone says. The font is always the big one
  (`data/fonts/main/main`, `bknw`, HUD `balloon24`: all slot 1), colour 0. The y positions differ per zone (z08BKD: score 50, medal 100, line 150; z01BPK: 50 / 100 / 150 with
  wraps 10 / 8 / 20; z38PAR 100 / 150 / 200 ...), so the helper takes them as data: `bannerLines(spec, std)` / `drawBannerScreen(ui, env, spec, std)` with
  `BannerSpec { score?: {text, y?=100}, medal?: 0..3, medalY?=150, lines?: ScreenLine[] (wrap default 36) }`. Zone ports call `ctx.banner(ui, spec)` from `drawBanner`
  and build lines with `ctx.line(id, y, wrap?, 'zone' | 'std')` (see zonegame.ts).
* **Mode 9 (help)**: `FUN_00461155(table, n)` every frame (stores request 2), drawn by `FUN_00461175`. See 2.

The default banner of the runner (zones without `drawBanner`) is now the panel with the medal / failure text at y 150.

## 2. Controls help (modes 9 / 10)

`FUN_00461175(table, n)`: panel with `n + 7` rows and the title `!FECONTRL` (BESTURING, big font, white, y = panel y0 + 62; notch tiles 0x36 under it), y0 =
(480 - (n + 7) * 24) / 2. Line i (`CONTROLi`, raw unexpanded text of the zone table, `FUN_004396a0`; a missing id returns the id itself) is on tile row i + 4:

* `FUN_00460f31` parses the line: button token up to ' ' or '+' (`BUTTON_UP` 4, `BUTTON_DOWN` 8, `BUTTON_LEFT` 1, `BUTTON_RIGHT` 2, `BUTTON_2` 0x20, `BUTTON_1` 0x10,
  `BUTTON_4` 0x80, `BUTTON_3` 0x40; strings 0x8b92ac.., bits = the immediates of its strcmp chain), after '+' a second token (only z41MAP: `BUTTON_LEFT+BUTTON_4 label`); the label is
  the text after the last separator. A line that does not parse (z17WAS `CONTROL4` "Druk tweemaal voor de edelsteen"; z08BKD `CONTROL4` which BKD.str does not have: the id is
  shown) is drawn raw, centred (column 0) and ends the list.
* **The "button icons" are key caps, not icon textures**: tile `0x3c` of the **menu** texture set (4 tiles wide = 96 px; the same tile the key list of the options uses) at tile
  column -8 (x 128..224), with the NAME OF THE KEY the player currently bound to that button centred on it (small font, white, column -6): `FUN_004384c9(bit)` looks the bit up
  in the key table at 0x8aeb20 (13 x 0x30 bytes, current key at +4), `FUN_0043839f` makes `"!NAME"` and the `+ 1` of `FUN_00461175` skips the `!`, `FUN_004396a0` on the menu
  table (FRONTEND.str) localises it (`UP` -> OMHOOG, `LSHIFT` -> L SHIFT, `SPACE` -> SPATIE, `LCTRL` -> L CTRL, ...; names without an entry stay as they are). So the help
  reflects the rebinding of the options menu. (Quirk kept out: for mouse / joystick codes the format has no `!`, so the `+ 1` would drop the first letter.)
  Two buttons: a second cap at column -12 with the first key name at column -10, the second at -6.
* the label left aligned at tile column -3 (x 248), same font / colour.

`drawHelp(ui, set, strings, n, opts?)` keeps the M3 coordinator's signature; `opts` = `{ set?, press?, title?, keyName?(bit), menuText?(id) }` (the runner passes
`ctx.panelEnv()`: menu set, `!PRESS`, `!FECONTRL`, the live key bindings (`sh.input.bindings`), FRONTEND.str). Note the first argument is now the **menu** set
(`sh.menuSet`), not the zone overlay set. A zone with a second help (z42BRP, loop mode 10, `FUN_00461155(BRP2 table, 5)`) calls `ctx.help(ui, 5, brp2Table)` itself;
`loopmachine.ts` has the constant `MODE.HELP2` but no transition into it, and `ctx.strings` of z42BRP is the merged `brp.str + brp2.str` (duplicate `CONTROLn` ids), so the BRP port
needs a separate table for the second help (BRP2.str CONTROL0..4).

## 3. Subtitles

* **Mini-game loops show no subtitle at all.** `FUN_00435a11` (SayText of the zone loops) only starts the speech (`DAT_009dab54/58`; `FUN_00435a5e` starts it after a 6 tick delay,
  `FUN_00435ad3` = idle, `FUN_00435b07` stops; it does not look at var 9 / var 0); game var 0 (`CS_TEXT_ON`, "Ondertiteling") is read only by the options menu (`0x41bc87`) and by the
  cutscene / NPC speech code (`FUN_0045cf83`, `FUN_004254a5`). The only text that goes with the speech of a mini-game is the brief / banner text on the panels above.
* The subtitle of the original is the cutscene HUD one (`FUN_0045d47f` splits, `FUN_00460003` draws): **four lines**, small font (`data/fonts/csm/csm` = Balloon12, slot 0), yellow
  (colour field 0), centred at x = 400 / 800 -> 320, y = 494 / 518 / 542 / 566 of the 800x600 reference grid -> **395 / 414 / 433 / 452** in the 640x480 grid. The wrap
  (`FUN_0045d34b`, width from `FUN_004606e3`: `ftol(280 * W / 800) * 2` = **448 px**) takes characters until the pixel width exceeds the limit, backs up to the last ' ' or '.',
  trims trailing spaces and continues; text past the fourth line is dropped; the 0x92 character becomes an apostrophe. Ported as `wrapSubtitle(text, measure)` (pure) and
  `drawSubtitle(ui, text)`.
* Port decision: the runner still shows the subtitle of `ctx.say()` lines while a zone is in mode 2 when the subtitle option is on, drawn with `drawSubtitle` (the provisional
  line at y 400 is gone). That is an extension: the original draws nothing for mini-game speech. The intro / banner lines are not repeated as subtitles (they are on the panel).
  The timing is unchanged (`30 + 2 * length` ticks when no audio plays; with audio the subtitle ends with the speech).
* `ctx.say` fix: it returned false when no audio engine existed (muted: `!undefined`), so no subtitle fallback was ever created in tests; now only an active speech (`idle === false`)
  or a pending subtitle blocks it ("started only when no speech is active", `FUN_00435a11`). The intro brief is now spoken at the start of the loop, not when mode 1 starts, and
  `stopSpeech()` runs when mode 1 / 9 is left (button), also for zones without a port.

## 4. `ZONE_INTRO` (src/shell/zoneintro.ts)

Per mini-game archive: `introId` (first brief line), `lines` (all intro panel lines: id, y, wrap), `speech` (ids spoken at the start when not the lines), `helpControls`, `help2`.
Every value has its EXE address in a comment and is checked by the test against the push immediates of the call sites. Summary (`id y wrap`, help n):

| zone | intro lines | help |
|---|---|---|
| z38PAR | LESGPT01 120 30 | 6 |
| z05WAB | LESGWB11 100 30 | 4 |
| z08BKD | CASGBD13 50 30, CASGBD14 200 30 (both spoken) | 5 (BKD.str has 4: the 5th shows "CONTROL4" like the original) |
| z09JST | CASGJO13 160 30 | 7 |
| z10RGB | HOLOA 200 30 | 11 |
| z15SSH | ADSGSS14 120 30 (leaving the help speaks ADSGSS07) | 5 |
| z17WAS | ADSGWS06 200 28 | 5 (line 4 is a raw hint) |
| z18MMP | ADSGMM18 100 30 | 5 |
| z20DSP | ADSGDS12 80 30 | 5 |
| z21FSH | ADSGFI14 80 30 | 4 (table has 5 lines) |
| z22BIP | ADSGBI15 80 30 | 5 |
| z27TRX | ADSGTR12 120 30 | 6 |
| z28HAT | ADSGMC19 120 30 | 5 |
| z36CNT | LESGCE01 120 30 | 4 |
| z39ASB | OGSGAB13 200 30 | 4 |
| z40aPO | OGSGPO12 120 30 (after the opening cutscene) | 6 |
| z41MAP | OGSGMP14 120 30 | 7 (two lines with two buttons) |
| z42BRP | OGSGBP34 100 32 | 3, second help (mode 10) 5 (BRP2.str) |
| z01BPK | BPK2 60 30 | none (the loop never calls FUN_00461155) |

Not captured by the table (zone specific, ports must do them): zones whose mode 1 is a camera cutscene (z15SSH mode 0, z18MMP, z40aPO `FUN_0045c432`), the hologram of z10RGB
(`FUN_005f7872` draws `HOLOA` y 200 over the HOLO frame), z01BPK / z08BKD banners (own y positions above).
`ZONE_FILES` gained `z01BPK: LI/Data/BPK.str` (the set-up loads `_Data/messages/LI/Data/bpk.str`, 0x8d23b8) and `z39ASB: OG/Data/ASB.str` (0x7b7289); z36CNT (`cnt.str`) was already there.

Application in `playzone.ts`: for a zone **without** a registered `ZoneGame`, kind != 1 and not a room, `cfg.intro` / `cfg.help` come from the table (`zoneIntroFor`), the zone `.str` is loaded
(`ZONE_FILES`), the brief is spoken at start, mode 1 draws `drawIntroScreen`, mode 9 `drawHelp`. A ported zone sets `introId` / `introLines` / `helpControls` itself (they win; `introId`
alone is drawn at y 120 unless the table knows the id).

## 5. Tests / how to run

* `node tools/test-formats.mjs --only m3-ui` (427 checks): line parser (one / two buttons, unknown token, end of text), panel geometry on a recording stub of `Ui2D` (26 x 20 tiles, corner
  tiles, PRESS y 452, caps at x 128 / 224, label x 248, key name x 176, two button caps), localised key names from the EXE key table + FRONTEND.str, banner line list, subtitle
  wrap / limits, every `ZONE_INTRO` id / speech / `CONTROLn` exists in the zone's `.str`, the button token strings and bit order in the EXE (0x8b92ac.. and the strcmp chain), every
  `FUN_00461155` call site (`6a nn` before the call) and every intro line's (y, wrap) in a `FUN_00439c6f` call of the EXE.
* Browser (headless, muted; a dev server on :5499): `node tools/browse.mjs "http://localhost:5499/?zone=z08BKD&mute=1" tools/steps/m3-ui.mjs --size 1280x800 --out /tmp/m3/ui/z08BKD`
  (intro, help, subtitle, banner screenshots). Dev-server hot reloads caused by other work in the tree can restart the page in the middle of a run: rerun.
  Looked at: z08BKD intro (two lines, full panel), help (4 caps + the literal `CONTROL4`), subtitle (two yellow lines at the bottom), banner (panel + GOUD!); z41MAP help (two-button
  lines with two caps, SPATIE), z17WAS help (raw centred hint line).

## 6. Known differences / open points

* Mini-game subtitles are an extension (see 3). The panel text y offsets use the start-up values (-4 / +14); the original's pause menu rewrites `DAT_008a991c` / `8a9918`, so after
  a pause the next help / banner would sit 2 px lower / 4 px lower in the original (not reproduced).
* `ui.measure` of the title uses the big font; the original `FUN_0043a05b(text, title font)`.
* Mouse / joystick bindings are not rebindable in the port (keyboard only), so the `+ 1` quirk for their names is not reproduced.
* The key list of the options menu (`menuui.ts`, M2) shows the raw EXE names (`UP`, `LCTRL`); the help shows them localised through FRONTEND.str as `FUN_00461175` does. The original
  key list probably localises too (not verified).
* The 6 tick start delay of `FUN_00435a5e` and its quirky `speechIdle` (idle during the delay) are not reproduced; `speechIdle` follows the real audio.
* `loopmachine.ts` has no mode 10 (second help of z42BRP).

## Shortcuts
`?zone=<archive>&mute=1` with a zone that has no port shows its real intro and help (`z08BKD`, `z41MAP`, ...); F9 / F10 (stub aids) finish / fail it to see the banner.
