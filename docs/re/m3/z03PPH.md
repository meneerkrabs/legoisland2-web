# z03PPH - Pepper's house (M3 port)

Room of the zone table (kind 3, pause page 29 with mask 0x40, `FUN_0053dfda`): Pepper's house with the **trophy room (23 trophies)**, the **wall map**, the **computer** (replays of the
mini-games, sound test, the two movies), the door and the fixed cameras. Reached from the island through the pause menu (`!LEVPPH`, var 5 = 3) or from the island's house door;
left through the door, by walking out of it, or through the pause menu "Afbreken". Nothing in it is won or lost: it only *shows* what the other zones wrote (`TROPHY_xxx`,
`HISCORE_xxx`) and starts replays.

Code: `src/zones/z03PPH.ts` (zone game + constructor registration), `src/zones/z03PPH/house.ts` (behaviour nodes, pure), `computer.ts` (the computer menu, pure), `totals.ts`
(FUN_00423bf0, pure). Tests `tools/tests/m3-z03PPH.mjs` (172 checks), differential test `tools/tests/m7-z03PPH-emu.mjs`, headless bot `tools/steps/m3-z03PPH.mjs`.

## 1. Addresses (LE2.EXE, image base 0x400000)

| address | what | ported in |
|---|---|---|
| 0x53dfda | the loop (mode 0 init, 2 play, 3 pause, 5 result menu never reached, 8 fade out); `FUN_0053df81` pause trigger skipped while `DAT_05d58784` (computer active); `FUN_0053dfa2` view matrix; exit block: var 0xb == 0 -> `FUN_00404d14(&next, exit == 2, 1)` | runner + `exitNext`, `blockPause` |
| 0x53e7c0 | sounds (`FUN_00443580(id)` x 28 into `DAT_05d58710..`) | `TROPHY_SOUND`, `SOUND_NO_TROPHY`, `SOUND_NO_INDEX` |
| 0x53ea4d | set-up: `FUN_0042382c` controllers, 5 attaches on Pepper (record 0xd68 / 0x68 = 33), PHSE (6), 23 trophies, DOOR (2), LND1 (0), overlay set `Overlays/z03pph`, var 0x5e = 1 | extraction (`src/formats/zonesetup.ts`) + `registerCtor` |
| 0x53fb1f | zone start: loader 0x546012, name table 0x542520 ("Dummy 0..69": cutscene actor names, unused), 0x53faf7, `SetupFog`, music key `menu`, `FUN_0053ea4d(1)` | runner |
| 0x53faf7 | `FUN_0045c310(0)` = cutscene manager init with 0 actor slots (`FUN_00458a4c`); `FUN_0045c366("z02lgi", "li")` only **stores the script folder and message area names** (`DAT_05d4d45c / 5d4d470`, flag `DAT_05d4dc88`). **No script is loaded or started in the house.** | nothing to port |
| 0x53fb86 / 0x53fba1 | restart / teardown of the zone | runner |
| 0x53fbc0 | computer menu step (per frame, from the draw hook of PeppComp `FUN_0054003e`) | `ComputerMenu.step` |
| 0x53fe2b | movies via `LegoIntro.mpg` / `LegoOutro.mpg`: **dead path** (flag `DAT_05d58788` is set by `FUN_0041b9b1`, the files do not exist); the movies the menu really plays are `IntroFMV.mpg` / `OutroFMV.mpg` from `FUN_0041b9b1` page 0x16 | `playMovie` |
| 0x53fed3 | enter the computer (param 0) / zone start (param 1): after a replay var 0x4d bit 7 opens the computer at once, else the previous zone is parked in var 0x4d's top byte | `openComputer`, `enterZone` |
| 0x53ff69 / 0x53ffa1 / 0x54003e | PeppComp update (Pepper to (-6.52, 0.96, -6.704), returns 1) / camera (eye (-8.4, 4.88, -6.704), look (-10.92, 4.88, -6.704)) / draw hook = menu step | `PeppCompNode` |
| 0x5400d5 | PeppComp constructor (loads `levels` and `FRONTEND.str`, engine = `DAT_008a9590`) | `CTOR.PEPPCOMP` |
| 0x5401e0 / 0x5402ac / 0x54042d | cam index (player height vs camera 0 y) / hotspot scan / PeppHse update (camera easing, hotspots, exit) | `HotspotNode`, `scanHotspots` |
| 0x540733 | PeppHse camera (pre-render): eye = eased position, look-at = the player, up = +y | `HotspotNode.prerender` |
| 0x5408c4 | PeppHse constructor (the tables of section 3) | constants in `house.ts` |
| 0x540b96 / 0x540db1 | DOOR update (swing 5 deg per tick to 90 and back) / constructor; 0x540f4e LND1 (draw hook forces flags |= 3) | `DoorNode`, `LandNode` |
| 0x54116c / 0x5413c4 | Trophy / island trophy constructors `{trophy var, high-score var, sound index}`; update returns 1, draw (0x541034 / 0x54128c) picks a model part by the variable | `TrophyNode` |
| 0x5414b0 / 0x5419dc / 0x541b79 | trophy browser update / camera / constructor | `TrophyBrowserNode` |
| 0x541c98 / 0x541e71 / 0x541f94 | map view (TIMM) update / camera / constructor | `MapViewNode` |
| 0x5421af (0x5420c4 draw, 0x542090 update) | ClimLadr: update returns 3, draw clamps the draw height of Pepper to 12.8 while walking | `ClimLadrNode` (no effect) |
| 0x542259 / 0x542454 | ladder climbing (up / down 0.4 per tick, 30 ticks) - **never attached by the set-up**: dead code | not ported |
| 0x542b30 / 0x546012 | builder / loader | `extractZone` (M1) |
| 0x41b12d / 0x41b0d2 / 0x41b08c | set-up of the replay list (page 24) / sound test (page 23) / movies page (22) | `ComputerMenu.setup` |
| 0x41b9b1 | actions: page 0x16 movies, 0x17 music key, 0x18 replay start (var 5 = zone, var 0xb = 1, var 0x4d packed) | `ComputerMenu.handle` |
| 0x423bf0 | island totals / island trophies (called by the house loop before the first frame) | `computeIslandTotals` |

## 2. The mode word and the node chain

`PEPPER_CONTROL` (var 0x5e) selects the active node of Pepper (record 33): **1 walking (SGwalk), 4 computer (PeppComp), 2 trophy browser, 0x20 wall map**; ClimLadr is always on.
The PHSE record (6) carries the hotspot / camera node (var 2 = always), DOOR (2) the door, LND1 (0) a draw hook. The 23 trophy records (8..30) read their variable every frame.

Port: `registerCtor(addr, factory)` for the nine constructor addresses in `house.ts` `FACTORIES`; the extraction (`Loaded.setup.attaches`) supplies records, gates and the three argument
words of the trophies (`argWords` = trophy variable, high-score variable, sound index); `Loaded.skipped` is empty.

The original steps the computer menu in the **draw pass** (node draw hook); the port's renderer does not call node draw hooks, so `PeppCompNode.update` sets `computerRan` and the zone
game's `update()` (after `world.tick()`, same frame) runs `ComputerMenu.step`.

## 3. Hotspots, cameras, door (FUN_0054042d, FUN_005402ac, FUN_00540733, FUN_00540b96)

Constants of the PeppHse constructor 0x5408c4 (node offsets in brackets):

| what | value |
|---|---|
| camera 0 (+0x14) / camera 1 (+0x20) | (10.4, 8.8, -8.0) / (0.0, 18.4, 8.48); the eased position (+0x98) starts at camera 1; index (+0xa4) = 0 when `player.y - 8.8 <= 0` else 1 |
| easing | normalised delta scaled by `dist * 0.1` per tick (0x8920cc), snap when `dist < 0.1` |
| hotspot centres (+0x34 + 12 i) | 0 computer (-6.52, 0.96, -6.568); 1 wall map (-15, 0.96, 6); 2 door (-6, 0.96, 10); 3 trophies (10.772, 0.96, 3.8); 4 door again (-6, 0.96, 10) |
| types (+0x70) | 0, 0, 1, 0, 0 (type 1 = `|ry| <= 0.78`: the player must face +z; type 2 = face -z, unused) |
| half sizes (+0x84), tested on x and z with `|d| <= r` | 8, 8, 8, **80**, 1.6 |

The scan returns the **first** hit, so hotspot 3 (80 wide, anywhere in the house) shadows hotspot 4: the "trophies" action is available everywhere except in the computer / map / door
boxes. Per hotspot (only while var 0x5e == 1; action = Shift pressed this tick): 0 computer: HUD icon 2, action opens the computer; 1 map: no icon, action -> mode 0x20; 2 and 4 door:
icon 0, the door opens, action leaves; 3 trophies: icon 1, action -> mode 2. Walking beyond `z > 15.0` leaves the house as well. Icons are textures 0 (door), 1 (trophy), 2 (computer)
of `Overlays/z03PPH`, drawn in the bottom-left slot of the HUD icon column (20, 516 on the 800x600 grid).

The Pepper start place (-3.75, 0.33, 5.37) with yaw 0 is inside the door's box: the door starts open and Shift leaves at once.

**Which camera is drawn (settled by the differential test, WP-VERIFY).** The loop sets the device's view from the camera after the update pass (`FUN_0053dfa2` -> `FUN_0043cc5c` = look-at + `SetTransform(VIEW)` via `FUN_00416961`), but then
the pre-render pass runs the nodes' camera functions, and **each of them calls `FUN_0043cc5c` itself** (PeppHse `FUN_00540733`, PeppComp `FUN_0053ffa1`, the browser `FUN_005419dc`, the map `FUN_00541e71`), which sets the view again; the draw hook of PeppHse (`FUN_005407eb`, record 6) re-applies the camera
once more in the draw pass. So **every record is drawn with the camera the pre-render pass left** (the real camera state): eye = the eased fixed camera, look-at = **the player's position (his feet)**, up = +y. The old "display camera" of this port (the camera after the update pass, the walk node's
chase code, 4 above the player) was never what the original draws: it is removed (`swapInDisplayCamera` / `restoreCamera` and `ZoneGame.beforeRender` of the house are gone; the view the earlier port showed looked 4 units higher). Evidence: in 15 000 emulated frames every `FUN_00444480` / part draw of the draw pass has the camera after the pre-render pass active
(in 11 758 of them the view the loop set after the update pass differs from it). Side facts: PeppHse's update (`FUN_0054042d`) also writes the camera target = the player's position (`FUN_005401e0`) and the node's update return codes are 1 (PeppHse, door, trophies, PeppComp, browser, map) / 3 (ClimLadr).

Door (record 2, hinge (-3.763, 0, 14.598)): state 0 closed -> 1 when the flag is set; 1: angle += 5 per tick (to 90 -> state 2), flag lost -> 3; 3: angle -= 5, 0 -> state 0; the
record is rebuilt with `FUN_0043a5e4(0, angle * 0.0174532, 0, hinge)` every tick.

## 4. Trophies (Trophy.c: FUN_0054116c / 005413c4 / 005414b0 / 005419dc, 00541034 draw)

23 records, in browser order (records 8..30): TOGL TADV TLGI TCSI (island trophies, constructor 0x5413c4, kind 1), TBKD TJST TPAR TMMP TFSH TSKP TWAB TWAS THAT TCNT TMAP TBPL TRGB TAPO TSSH TDSP TBIP TTRX
TASB. The attach arguments (read from the executable: `argWords`):

| record | trophy var | high-score var | sound index |
|---|---|---|---|
| TOGL / TADV / TLGI / TCSI | 0x8f TROPHY_OGL / 0xb9 TROPHY_ADV / 0x49 TROPHY_LGI / 0x90 TROPHY_CSI | 0x25 / 0x17 (HISCORE_CAI) / 0x12 / 0xce | 22 / 21 / 19 / 20 |
| TBKD | 0x3d | 0x2f | 2 |
| TJST | 0xcb | 0x18 | 3 |
| TPAR | 0xd1 | 0xaa | 16 |
| TMMP | 0x48 | 0x14 | 7 |
| TFSH | 0x88 | 0x38 | 18 |
| TSKP (skate park) | 0x8d TROPHY_BPK | 0xc0 | 0 |
| TWAB | 0x40 | 0x20 | 1 |
| TWAS | 0xd5 | 0xc8 | 6 |
| THAT | 0x9d | 0x4a | 11 |
| TCNT | 0x86 | 0x9b | 12 |
| TMAP | 0x3f | 0xda | 14 |
| TBPL (palace, BRP) | 0xcf | 0x96 | 15 |
| TRGB | 0x23 | 0x3b | 4 |
| TAPO | 0x43 | 0x2c | 17 |
| TSSH | 0x93 | 0x4b | 5 |
| TDSP | 0xdc | 0x1e | 8 |
| TBIP | 0xd6 | 0x27 | 9 |
| TTRX | 0x1a | 0x87 | 10 |
| TASB | 0x44 | 0x29 | 13 |

(The test checks that variable names (`TROPHY_xxx`, `HISCORE_xxx`) and record names agree.) Each model has three parts = three meshes `<X>_Gold / _Silver / _Bronze` (TSKP: TSK1..3); the
draw function shows part 0 for value 3 (gold), 1 for 2 (silver), 2 for 1 (bronze) and **nothing for 0** (the draw hook returns 1 = handled). The island trophies are the framed pictures on
the wall (gold / silver / bronze frame). The port draws all records itself, so `TrophyNode.update` sets the record flags the renderer understands: 0x400 / 0x200 / 0x100 force part 2 / 1 / 0
(`FUN_00443f90`, honoured by `GameRenderer.render` since M3), 0x8000 hides. Values are written by the mini-games (0..3, only raised) and by `FUN_00423bf0` for the islands.

**Island totals (FUN_00423bf0)**: `HISCORE_CSI = JST + RGB + BKD + SCORE_CSI`, `HISCORE_CAI = SSH + WAS + MMP + DSP + FSH + BIP + TRX + HAT + SCORE_ADV`, `HISCORE_OGL = APO + ASB + MAP + BRP + SCORE_OGL`,
`HISCORE_LGI = WAB + CNT + PAR + BPK + SCORE_LGI` (the `*_SUBGAMES` variables get the first sum); island trophy: 0 below 1, 1 from 1, 2 from 30001 / 60001 / 35001 / 47001 (CSI / ADV / OGL / LGI), 3 from
35001 / 70001 / 42001 / 55001. `computeIslandTotals(vars)` is exported for the island (M4); the house runs it once at its start.

### Browser (var 0x5e == 2)

State machine of `FUN_005414b0`, node fields +0x18 current record, +0x1c focus point, +0x4c state (-1 fresh, 0 browsing, 1 leaving), +0x54 "moved":
* state -1: focus := home (10.4, 10.0, -11.52), state 0. Same frame as the opening Shift (state -1 is not 0, so the key does not close it).
* Left / Right: previous / next record, wrapping 30 <-> 8 (any state). Any button but Left / Right (`pressed & ~3`, includes Esc), Alt or Space while state 0 (Alt / Space in any state): state 1.
* The focus eases to the trophy position (state 0) or home (state 1) with `0.2 * dist` per tick, arrives within 0.1. Camera (`FUN_005419dc`): eye = focus + (0, 1.44, -2.24), look-at = focus + (0, 0.64, 0) for
  mini-game trophies; for the island trophies (kind 1) eye = focus + (0, 0, -2.24), look-at = focus.
* Arrival (state 0): HUD lines `HISCORE` (FRONTEND.str: "Hoogste score"), the high score (`%d`), the level name (`LEVxxx` from the record name: SKP -> LEVBPK, ADV -> LEVCAI, BPL -> LEVBRP, else `LEV` + name;
  looked up in IFC.str first, then FRONTEND.str) at y = 494 / 518 / 542 of the 800x600 grid, centred; the trophy jingle once (`SND_PPH_GAMELOCKED` 0x29a when the variable is 0, `SND_PPH_GAMESELECT`
  0x299 when the record has no sound index, else `TROPHY_SOUND[index]`: 0..15 `SND_PPH_GAME_BPK, WAB, BKD, JST, RGB, SSH, WAS, MMP, DSP, BIP, TRX, HAT, CNT, ASB, MAP, BRP`, 16..22
  `SND_PEPP_THROUGHRING, SND_APO_ROCKMON, SND_FISH_CAUGHT, SND_PIZZA_HIT, SND_CSI_HORSE_SHOWOFF, SND_SCORP_RUN, SND_OGL_CHIMP1`).
* Lines 1 and 3 are cleared every frame, **line 2 (the score) never**: while the camera travels and after the browser is left the last score stays on the screen. Kept as in the code
  (`KEEP_STALE_SCORE_LINE`); the other writers of that slot are the cutscene subtitle code, which the house never runs.
* State 1 reaching home: state -1, var 0x5e = 1. The current record is kept for the next visit.

### Wall map (var 0x5e == 0x20, TIMM)

`FUN_00541c98`: state -1 -> focus := home; focus eases (0.2 per tick) to (-15, 7, 6) (state 0) or home (state 1, set by any button); camera `FUN_00541e71`: eye = focus + (2.8, 0, 0), look-at = focus.

## 5. The computer (FUN_0053fbc0, FUN_0041b9b1, FUN_0041b12d / 0x41b0d2 / 0x41b08c)

Menu engine = the shared `MenuEngine` (the original uses the global engine `DAT_008a9590` too), mask 3, text offsets of the pause menu (`FUN_004201aa`). Pages (read from the executable):

| page | content |
|---|---|
| 21 `PPHM0` PEPPER'S COMPUTER | `PPHSUBGAME` (-> 24), `PPHSOUND` (-> 23), `PPHMOVIES` (-> 22), Terug |
| 22 `PPHMOVIES` | "Film 1" action 0x12 = `IntroFMV`, "Film 2" action 0x13 = `OutroFMV` (greyed unless story node >= 0x44 = 68), Terug |
| 23 `PPHSOUND` | list of the 22 entries of the sound test table 0x8a5bb0 (`LEVxxx` label, music key `Z01BPK`, `Z02LGIM`, ...): choosing one stops the music and plays the DirectMusic segment (stays until the room is left) |
| 24 `PPHSUBGAME` | list of the 19 replays of 0x8a57f0 (zones 1 4 5 7 8 9 12 14 15 16 17 18 20 21 24 25 26 30 28 = BPK IFC WAB BKD JST RGB SSH WAS MMP DSP FSH BIP TRX HAT CNT PAR ASB APO MAP), entry enabled when its gate variable (the TROPHY_xxx) is non-zero; BPK also at story node < 7 or > 0x33; IFC (gate -1) at node < 7 or > 10 |

* First step opens page 21 (`engine[7] == -1` branch), sets STARTEDFROMMENU (var 0xb) = 0. Esc / Terug on the root page (event 2 with nothing to pop) leaves the computer (var 0x5e = 1).
  While the menu is active the loop does not sample the pause key (`blockPause`, evaluated with the state of the *previous* frame like `FUN_0053df81`), the HUD is not drawn.
* **Replay start** (page 24): var 5 = entry zone, var 0xb = 1, var 0x4d = `packMenuInternals(24, cursor, scroll, var 0xa3)` (bit 7 = "restore"), the computer closes; the loop sees var 5 != var 0x59 and leaves
  with exit state 8; the exit block takes `next = var 5` because var 0xb != 0 (no `FUN_00404d14`). The mini-game's own exit goes through `FUN_00404d14` -> `PREV_SUBGAME` (= the house).
* **Return from a replay**: `FUN_0053fed3(1)` at the zone start sees bit 7 of var 0x4d, sets var 0x5e = 4; the first menu step restores page 24 with cursor and scroll, the root page on the stack, and
  every step rewrites PREV_SUBGAME (var 0xa3) from the top byte of var 0x4d (the zone the house was entered from), so the door leads back to where the player came from.
* The movie page: the port plays `IntroFmv` / `outroFmv` through `Shell.runMovie` (any key skips); the room is held while it plays (the original blocks inside the call) and the menu music is started again afterwards.
* The shared engine's `listCount` only counted the visible window; the set-up function's "remaining entries" return value (`count - index - 1`) is now added (`src/shell/menu.ts`), so lists with more than 8 entries scroll (also fixes the key list, 13 entries).

## 6. Exit (FUN_0053dfda)

* Door / `z > 15` / hotspot action: `DAT_05d587b0` -> fade out with exit state 2 (`ZoneGame.leaveRequest`). Pause menu "Afbreken" (page 29, `PauseM6`, action 1 = abandon) -> exit state 2 as well (the runner's exit 4).
  Pause "Afsluiten" -> front end. Exit block: var 0xb == 0 -> `FUN_00404d14(&next, completed, 1)` = `story.miniGameExit(...)`: the zone the player came from (PREV_SUBGAME), or the story's zone when
  the story is at the house (nodes 69..71 are unreachable); var 0xb != 0 and exit state 8 -> var 5 (replay). `ZoneGame.exitNext` implements this (the runner's room mapping would send exit 2 to the front end).
* The M2 stub aid F9 ("back to the previous place") is kept as a dev shortcut that acts like the door (tools/steps/shell-house.mjs uses it).

## 7. Sounds, music, HUD

Music key `menu` (`ZONE_MUSIC`), started at the zone start. Loaded but never played by the house code: `SND_PPH_SWITCHON / SWITCHOFF / COMPUTER / SCROLL_OK / SCROLL_NA` (0x282..0x286) and `SND_PPH_FSTEP1..4`
(0x2a2..0x2a5); the menu sounds are the shell's. The jingles are preloaded at the zone start (the first `play` of an id only loads it).
HUD: icon column slot 0 (see 3), three text lines (see 4); fog: the house calls `SetupFog` three times (loop start near 4, set-up near 5, loop after the set-up near 1 / far 100..500 / fraction 10,
wrapped in `FUN_004096b3(1)..(0)`): the **last** one is in effect, so `GameRenderer.useFogCall(1)` makes it the default (the zone table in rendering.md lists the first, near 4, which clipped the walls from the
close trophy cameras).

## 8. Differences, approximations, not done

* ClimLadr (**closed, WP-MINI**): the update now returns 3 like `FUN_00542090`, and `updatePass` (`controller.ts`) runs return code 3 and the exclusive node like `FUN_0042226e` (3: the exclusive node's update runs again if one is set, the chain CONTINUES; no exclusive node: "ran, go on"; an exclusive node returning 1 ends the record's pass; the old code stopped the chain after a 3; only the test `engine-framework` and ClimLadr use it).
  Its **draw hook** `FUN_005420c4` is ported as the node's `draw`: while Pepper walks (var 0x5e bit 0) the original draws the record itself with y clamped to 12.8 (`0x89260c`) and returns 1, otherwise it draws nothing and returns 3: both skip the default draw, so **Pepper is drawn only while walking**, not at the computer, in the trophy browser or at the wall map. The port returns 0 while walking (the default draw does what the hook's `FUN_00444480` does; no other draw hook is on Pepper's chain; the clamp never matters because the ground of the house is y = 0) and 3 otherwise. `m7-z03PPH-emu` checks per tick that the original draws record PEPP iff the port's `runDrawHooks` lets the default draw run (15 000 ticks, all four modes).
* The stray score line (section 4) is confirmed by the differential test (the original never clears the text slot `DAT_05d4de4c`; slots 1 and 3 are cleared by every browser update); the display camera (section 3) turned out wrong and was removed.
* Sound-test labels: **settled (WP-MINI)**: `FUN_00540198` (the PeppComp constructor, 0x54014b) loads `_data/sounds/DirectMusic/levels` (`FUN_00439126`, file not in the install) into `DAT_009d9c28`, and the only other reference is its destructor (`FUN_00540198` frees it, asm search of `0x9d9c28`: two references): the table is never read, the labels are the `LEVxxx` texts of the menu tables, as ported.
* Frame limiter / fps text of the loop (`%d (%d)`, `FUN_0053dfda` at 0x53e079..0x53e425): **the fps text is dead code, the limiter is LIVE (WP-TIME, gaps.md T3)**: every 30 frames the loop measures the frame rate with `QueryPerformanceCounter` / `GetTickCount` and `sprintf`s it (format 0x8eb2f8) into a local buffer (`ebp - 0x40`) that nothing reads: nothing to port. But each iteration also ends with `do { QueryPerformanceCounter } while (now - last < QPF / 30)` (LE2.c:94644-94650, `local_68 = ftol(QPF / 30.0)` at 0x53e076): the house runs at most 30 fps, dt = 1.0, on any display (the other zones follow the display: dt 0.5 at 60 Hz). The port steps the house at 60 Hz / dt 0.5 like every zone, so its per-frame motion (camera easing, door, browser, fade) is twice as fast as the original's: needs a per-zone frame limit in the runner (lead). Nodes and oracle tests are dt-exact (`m7-z03PPH-emu`, `m5-audit-z03PPH-emu`: dt 1 and 0.5, tolerance 0). Particles / lights: nothing house-specific.
* Pepper's pose while at the computer: he is not drawn there at all (ClimLadr's hook, above), so the pose is invisible; the display camera question is settled by the differential test (section 'Differential test').
* Not verified against a real running copy of the game (none available): everything is from the decompile, the nodes now also against the original code run in the emulator (see "Differential test").

## 9. Tests and how to run

* `node tools/test-formats.mjs --only m3-z03PPH` (about 0.2 s): the 23-trophy table against the executable and the variable names, the tier flags for 0 / 1 / 2 / 3, the hotspot scan (edges: 0.78 rad, 8.0 / 8.01
  box, the 80 box shadowing the door exit), icon / door flag in the world, door swing (5 deg per tick, state machine), walking out (z > 15), the camera easing (factor 0.9 per tick, arrives exactly), the display
  camera swap / restore, the computer on the real page table (root, movies with the greyed outro, sound test list, replay list with gating, replay start variables, restore after the replay, scroll 5 round
  trip, `enterZone`, PREV_SUBGAME rewrite), the browser (arrival lines / jingles / wrap both ways / leaving / reopen at the last trophy / Space and Ctrl leave), the map, the island totals (thresholds on both sides).
* Headless bot (island -> pause -> house -> everything above with real key presses, replay of Whack-A-Bot and the way back into the same menu state, the door, the pause "Afbreken"):
  `node tools/browse.mjs "http://localhost:5499/?zone=z02LGI&node=5&mute=1" tools/steps/m3-z03PPH.mjs --size 1280x800 --out /tmp/m3/z03PPH` (screenshots `house-1 .. house-19`). Pepper is put on the
  hotspots with `page.evaluate`, everything the player does uses keys.

## Differential test (WP-VERIFY)

`node tools/test-formats.mjs --only m7-z03PPH-emu` (about 13 s; `tools/lib/m7-z03PPH-emu.mjs`, `tools/tests/m7-z03PPH-emu.mjs`). One frame of the original loop runs natively in the x86 emulation from the port's state of every tick: the engine's **update pass `FUN_0042226e`** (real node chains with their vtables and gates, return codes 1 / 2 / 3, ran bits),
the loop's view step `FUN_0053dfa2`, the **pre-render pass `FUN_004225c5`**, the **draw pass `FUN_0042271b`** (node draw hooks, every record / part draw and every `FUN_0043cc5c` view call logged with the view active at that moment). The node code (PeppHse, door, LND1, PeppComp, ClimLadr, trophies, browser, map) and the constructors (into zeroed node memory:
the constant tables) are the executable's own; hosted from the decompile: variables, sounds (by handle -> sound id), the model getters, the draw call, the view transform (logs the camera block it is given) and the computer's menu step (not the subject: the scenarios let the player leave the computer by script). The walk node SGwalk and the port's M1 StubGuard are not in Pepper's chain (Pepper is placed by script).

Compared each tick (1e-5 relative; integers / strings exact): all 34 records (matrix, Euler, flags: the trophies' forced-part bits and the engine's frustum bit excepted), PeppHse (eased camera position, floor index), door (state, angle), browser (current trophy, focus, state, moved flag), map (focus, state), the globals (door flag, leave, HUD icon, the three HUD text strings: sprintf results of the original
against the port's message ids / number), the camera after the pre-render pass (eye, target, up), all game variables, the ran bits of every chain, the ordered sounds, and for the 23 trophies the part the original draws (by the variable's value) against the port's forced-part flags. The constructors' tables: the two fixed cameras, the 5 hotspot centres / types / half sizes, the eased start position, the 23 trophy argument words and kinds, the sound handles.
Scenarios: 6 scripted visits of 2 500 ticks (Pepper placed around the hotspots, anywhere in and outside the house on both floors, at any heading including the +z windows, Shift at random moments, the trophy browser with Left / Right / any button / Space / Alt, the map, the computer, trophy values changing at random, long idle stretches for the camera easing): about 11 million checks, 15 000 ticks, hotspots 0..3 (hotspot 4 is shadowed by 3, as documented), modes 1 / 2 / 4 / 0x20, door states 0..3, 825 leave requests, 33 trophy jingles, 107 140 part draws.

Result: **no deviation in any node, constant table, return code, text slot or camera value** except the findings below.
* The display camera (section 3) was wrong and is removed (fixed in `house.ts` / `z03PPH.ts`; `tools/tests/m3-z03PPH.mjs` asserts the new behaviour instead of the old one).
* ClimLadr returns 3 in the original (the port 2): equivalent in the house, see section 8. PeppHse and the door return 1 in the original (the port returned 2; changed to 1: no effect, each is alone in its chain).
* Not covered: the computer menu (`FUN_0053fbc0`, `ComputerMenu`), the zone loop's modes / exit block, the walk node, the HUD drawing, the particle / sound engine, the rendering of the trophy parts themselves.

**Precision (WP-VERIFY follow-up):** the harness runs the x87 in 24-bit precision (`cpu.cw = 0x7f`); the house constants are the executable's float values, the easing (`easeToward`: normalised delta * dist * factor), door matrix, hotspot scan and cameras replay float32 per operation (`src/zones/f32math.ts`): the differential test compares with **tolerance 0** (bit-exact).

## Shortcuts

* `?zone=z03PPH&mute=1` starts the room directly (story node 69, trophies all empty); `?zone=z02LGI&node=5` then pause -> "Huis van Pepper" (needs node >= 4) is the normal way in.
* `window.__zone.game.debug()` in the page: `{ mode (var 0x5e), icon, hotspot, doorOpen, trophy, lines, computer: { active, page, item, scroll, last }, movie }`; `__zone.sh.vars.set(0x40, 3)` raises TROPHY_WAB.
* F9 in the house: leave through the door (dev shortcut).
* `computeIslandTotals(vars)` (`src/zones/z03PPH/totals.ts`) for the hubs; `GameRenderer.useFogCall(i)`; `ZoneGame.leaveRequest()` / `exitNext()` / `blockPause()`.

## WP-PART-WIRE (2026-10-29): particles

The original's code does start effects here (`FUN_005357cb`: `notes01.par`, `FUN_00536e16`: `music01.par`, `FUN_0053284a` / `FUN_0053287f`: `Explode01.par` / `swirl01.swl`, `FUN_005352f6` / `0053532e`: `TWINKLE01.par` / `TWINKLE02.par`, `FUN_0053d915`: `trainsmoke01.par`: the island's era code that this region carries as copies), but the zone's engine is `FUN_00442900("z03pph")` (0x53fb36) and `_data/z03PPH/Particle/` holds only `text.opt` + `Text000.tga`: no effect record exists, every start returns the invalid handle and every gate / matrix / parameter call on it is ignored. Nothing is drawn in the original either (z03PPH does not use the `GENERICBITS` fallback of the hubs). The port starts nothing. Closed.
