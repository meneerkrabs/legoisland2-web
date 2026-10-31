# Game shell, milestone M2 (`src/shell/`, `src/ui/`, zone set-up extraction)

Top-level flow of the original instead of the placeholder page: start-up movies, front end z60FRE, story FSM + zone loop, save / load, pause menu, HUD,
options, outro + credits (every zone is ported since M6, hubs since M5). Sub-documents: [shell-m2.md](shell-m2.md) (tables, FSM, save format, options),
[ui-m2.md](ui-m2.md) (strings, fonts, 2D layer), [zone-setup.md](zone-setup.md) (set-up extraction). API / URLs: [../engine-api.md](../engine-api.md).

## Ported (VA)
| what | functions |
|---|---|
| zone loop, zone table 0x89a9c0, story FSM 0x89a758 | FUN_00404dc9, 00404aa0/af6/b43/bb2/be7/c07/d14, 00423bad (story.ts) |
| loop template (modes 7 0 1 9 2 3 4 5 8, exits 0/2/3/4/6/8) | FUN_00465d39, 00470ac3, 004afaf7, 00423170 (loopmachine.ts, playzone.ts) |
| menu engine, page table 0x8a9338, rows 0x8a9928/978/9c8, themes 0x8a9a18 | FUN_0041fd45, 0041fa84, 0041f695, 0041f966, 0041d765, 0041b500, 0041be4e, 0041bd3d, 0041c092, set-ups 0041ae6e/afbc/b037/b2c1/b2fd |
| front end stage | FUN_00470ac3, 0047172c, 00471070, 00472743/004721f0 (Pepper on the skateboard: gags 0x8c9198, outfits 0x8c9150), credits 00471bfa/802/c4c |
| save format `Save%02d.lgo` 0x51c8c bytes, XOR checksum | FUN_00418ec7, 00419c45, 0041aa2e, 00419e82, 0041ac8f, 00418e7f (save.ts) |
| options `Settings.set` | FUN_00403e30, 0040410f |
| HUD (island), letterbox, fades | FUN_004b8ef0/908d/9008, 0046055f, 0045f771, 0043ec80 |
| per-zone set-up extraction | FUN_00423532 attaches, 004427e0/4428b0/00442780 boxes, 00444550 modes, 0045c397, 00424029 (zonesetup.ts) |

## Behaviour notes / findings
* New game = pending override node 2 / zone 2; the front end returns -1 for new game and load alike, the zone loop's override picks the zone.
* Save / load slots list FSMSTATEnn captions (empty = `<-------->`); slots stay selectable (cutscene running greys them). Saving closes the pause menu.
* Esc on the key page restores the live key table (only it: the Settings keep the bound keys; input.md section 2) unless the cursor is on OK (original quirk); the key page shows the fixed key (grey) and the rebindable one.
* Failure result menu is page 19, success page 16 (`FUN_0041c092` kind `(success != 1) + 1`). Pause pages: hubs 5 (mask 0x80), mini-games 18 (0x40), rooms z03PPH / z04IFC 29 (0x40).
* Mini-game exits go through `FUN_00404d14` (failed / aborted rewinds to the last hub; B noted stale snapshots after loading a save).

## Approximations / not ported (state 2026-10-31: none left in the shell)

* All 30 zones run their own ported gameplay (M3 mini-games / rooms, M4 island, M5 hubs, M6 remaining mini-games); no zone runs as a stub any more. Intro / help screens, cutscenes and subtitles exist for every zone. Mini-game subtitles are a port extension (gaps.md U3).
* Front end: butterflies, train, brick figure and Pepper on the skateboard are the original's nodes (`fenodes.ts`, compared with the original's code in `m5-audit-fe-emu`; gaps.md R11); the credits are `FUN_00471bfa`'s (gaps.md U6).
* After the outro movie the port goes straight to the island like the original (gaps.md U2). The loading card is the original's (spinning pizza / CD disc and LADEN over every fade and while a zone loads: gaps.md U1, `src/ui/loadingcard.ts`).
* Save files are the original's (WP-SAVE, save.md): the whole file, verified against the original's own writer and reader; only process addresses inside the file cannot be reproduced.
* Resolution items of the graphics page are greyed (a browser has no display mode list: the original's modes are a device matter). Mouse sensitivity is wired (`(Settings[0x14] + 5) * 0.05f`, input.md section 3); the speech preview of the volume slider exists (audio.md 11.5).
* Render modes are applied per part mask (`GameRenderer.setPartMode`, gaps.md R4).
* Menus: the page renderer FUN_0041d765 is compared with the port's `drawMenu` for every page and engine step (`m7-shell-menu`, gaps.md U4); the key page's bind / cancel semantics are the original's (`m9-input-keytable`).

## Tests
`node tools/test-formats.mjs` (all): new `shell-menu` (engine on the EXE's pages, loop template), `shell-ui` (keys, credits, HUD, exit mapping), `shell-tables`, `shell-story`, `shell-save`, `zonesetup`, `ui-*`.
Headless browser (`tools/steps/shell-*.mjs`): flow (new game -> island -> walk -> pause -> save -> quit -> load -> same place, in-place load, `?save=`, erase), menu (options, key rebinding, persistence, credits, mouse),
story (node 2 -> 68 through all zones with F9, outro), zones (all 29 zone archives load and walk), minigame (pause / restart / fail / abort), house (island <-> Pepper's house).

## Next (M3, first mini-games)
Register runners with `registerZoneRunner` (z05WAB, z36CNT, z38PAR are the smallest), set `LoopConfig.intro/help`, draw the intro / help / banner texts from the zone's `.str`,
port the zone's constructors with `registerCtor(address, ...)` using `Loaded.setup.attaches`; write real scores to the HUD; story handler FUN_004b7040 for the island.
