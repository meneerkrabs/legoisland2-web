# Restoration plan: optional mode "Herstelde inhoud" (restored content), default off

Research and planning pass of 2026-10-29 (read-only: nothing in `src/`, `tools/` or the data was changed; this file is the only output). Goal: bring the original's unused or cut content into the game as an
**optional** mode, so that with the option off the game stays exactly what it is now. This document is the evidence-based plan, not the implementation.

Inputs: `docs/re/unused.md` (the inventory), `docs/re/gaps.md`, `docs/re/engine-m4.md`, the zone docs, the Ghidra decompile (`basdebeer-tools/decomp-le2/LE2.c`, `LE2.asm.txt`), the x86 emulation of the
island set-up (`emulateIslandSetup`, run for 14 story nodes), all 22,831 archive members (re-extracted to `/tmp` with `tools/research/unused/extract-all-archives.mjs`), the loose sound files, the printed Dutch
manual `iso/Handleiding/Island2_NL.pdf` (read with `pdftotext`) and the PlayStation script variants that ship inside the PC archives. The scratch scripts of this pass lived in `/tmp/le2-unused/` (lost on restart);
section 8 lists what they did so they can be re-created under `tools/research/restore/`.

Contents: 1 Summary table | 2 Classes and evidence | 3 New facts established in this pass | 4 Shared infrastructure (R0) | 5 Designs of the class A and B items, ordered by value | 6 Class C (gallery only) |
7 Test plan | 8 Method, open decisions, what was not done.

---------------------------------------------------------------------------------------------------------------------------

## 1. Summary table

Class: **A** = everything needed exists in the original's own data and code (only wiring; at most the transcription of an existing recording). **B** = restorable with a small, clearly marked
reconstruction (the "Invented" line of each design says exactly what). **C** = too speculative: gallery only (the developer corner, `src/devcorner/**`, already covers galleries).
Effort: S = under a day, M = a few days, L = a week or more (R0 not counted in the items). "Files" = the main files of the design (the shared files are named in R0).

| # | Item | Class | Evidence (short) | Effort | Files |
|---|---|---|---|---|---|
| R0 | Option, hooks and overlay infrastructure | n/a | pattern of `src/game/debug.ts` + `src/devcorner/`; `compileCutscene` reproduces 86 of 87 shipped `.cut` bit for bit (`splineStart` 12) | M | `src/display.ts`, `src/main.ts`, new `src/restore/**`, small hooks in shared files |
| 1 | **LGI11 "BBs_Dance_Dizzy"** (Nick arrests the radio) + LGI09 line `LECSBK24` "rattenvanger van Pizza" | A | complete script + `.str` + 3 mp3 + slot declared by the era-3 set-up, no trigger; `//340 ... LECSBK24` commented in `lgi09.txt`, active in `lgi09psx.txt` | S | `src/zones/z02LGI/ctx.ts`, `src/restore/scripts.ts` |
| 2 | **Radio battery side quest** (BTB0-9, `BATTERY_LEVEL`, DJ lines `LECSRS06-08`, `DJ_THROW`, gauge bars) | B | 10 placed records (terrain + 1.7), var 22, commented DJ lines, clip 274, textures `REDBAR/GreenBar/YellowBar`, radio var 0x22 gate | M | `src/restore/battery.ts`, `src/shell/hud.ts` (gauge exists), `src/island/ambient/misc.ts` (read only) |
| 3 | **Objective arrow** (`Pointer` sprite; logic still runs) | B | texture `Overlays/Z02LGI/text008` unused, objective radius written never read, `Originals/POINTER.tga` | S-M | `src/restore/arrow.ts`, `src/ui/renderer2d.ts`, `src/shell/hud.ts` |
| 4 | **Darren's tips**: 15 unused tip pairs (`LEDTHT03-42`) + 14 replaced regular lines (`LECCAA20` ...) | B | manual describes Darren as the advice giver; slot-gap analysis; transcripts; speech engine takes any mp3 name | M | `src/restore/tips.ts`, `src/restore/messages.ts`, `src/zones/z02LGI/ctx.ts`, `src/audio/index.ts` |
| 5 | Commented-out / unscripted lines with an exact slot: `CACSBR11` (csi02), `LEINVS04` (lgici25), `CACSAR02` (csi01) | A / A / B | commented block + skipped next-id (`csi02`); text id 04 after 03 (`lgici25`); id gap (`csi01`) | S | `src/restore/scripts.ts` |
| 6 | "Dr. Pepper" gag `ADCSAM05/06` (adv02) | A | block commented in `adv02psx.txt`, shipped `ADCSAM04` ends mid-sentence ("... en hij is") | S | `src/restore/scripts.ts`, `src/restore/messages.ts` |
| 7 | Voice-slot bugs: `TBOBA` (LIFSM5) uses the C clip; NICK / LICK (LIFSM2) reuse band-1 clips | A | tag scan: exactly one A-tag on a C-clip; orphans `LEBEAA07`, `LEPHAA03/04` fill the numbering gaps | S | `src/restore/messages.ts` |
| 8 | Three-line joke chain `BAR2C` - `UNUSED` - `BAR2D` (castle) | A | tag `UNUSED:1293` (CAJOBB12) sits between C and D, audio present | S | `src/restore/messages.ts`, `src/island/npc/sgmfig.ts` (chain) |
| 9 | Silenced / never-played cues: flower grow/shrink (`GrowBig`, `GrowSmll`), Pepper's-house computer set, z10RGB castle hit, z17WAS big swing / thump, z22BIP, z15SSH, z28HAT | B | sound table maps ids 0 / 2 to `Silence.wav` while the real files sit unused; "loaded but never played" lists in the zone docs | S each, M total | `src/restore/cues.ts` + one-line hooks per zone |
| 10 | Never-shown popups: `WAB1-3`, `WAS1-2`, `FSH5`, `BIP9-15` | B | 1:1 with existing sound / event ids (WAB: hit / miss / Infomaniac) | S | `src/restore/cues.ts`, zone files |
| 11 | Extra vehicle looks (SwapText 4, 29, 30, 72, 107, 124, 126, 136-143; `policecar01.txt`) | B | 16 of 144 swap textures in no look; PCAR numbering gap 01; neighbouring ids per group | S-M | `src/island/vehicles/looks.ts` (table read), `src/restore/looks.ts` |
| 12 | Swimming Brikimal `BML2` | B | constructor compares with record 367 (kind 2) + swim rows in the table; set-up writes flags 0x20 on BML2 | S | `src/island/ambient/brikimal.ts`, `src/restore/swimmer.ts` |
| 13 | Developers' cave: portal without typing SDREAMS after the ending, `Teleport` sound | B | DARR hint `LEDTHT25/26`, WORM + z50LTC complete, `Teleport.wav` / `Teleport2.wav` unused | S | `src/island/trigger/lgifsm.ts` (read), `src/restore/sdreams.ts` |
| 14 | Shadowed hologram hints `LIHOL9` (681 / 682), `LIHOL6` (177 / 182), orphan `LIHOL16` | B | duplicate tags; the sort picks the later one; `HOLOB` answers the shadowed one | S | `src/restore/messages.ts` |
| 15 | Fisherman hands over the page: `ADCSOA13/14` (z13CAI after adv04); `CACSCS08` "Aha, bijna!" | B | text + audio in the table, no script; speaker / trigger inferred | M / S | `src/restore/scripts.ts`, hub files |
| 16 | Dutch `BIP7-9`, `TRX_*` English set, `WAS3/4` | C | stunt-flight draft design; English only; no event | - | gallery |
| 17 | 805 never-loaded meshes (T-Rex pieces, ferry, police chopper, steam train, old trophies, 47 bricks), 359 front-end character meshes | C | no record, no position, no behaviour; some are 12-triangle stubs | - | `src/devcorner/modellen.ts` |
| 18 | 74 unused island `.man` paths (Brickster flights / crashes / kidnaps, cameras) | C | drafts of the scenes that did ship (`lgi04`, `lgi09`); pairs (cam + target + root) exist, no script | - | `src/devcorner/scenes.ts` |
| 19 | `adv06` draft cutscene | C | placeholder text, superseded by `adv07` | - | gallery |
| 20 | Story nodes 68-71 (Pepper's house, info centre, developers' cave as FSM nodes) | C | gated on the read-only `NS_OFF`; no trigger anywhere | - | gallery / item 13 |
| 21 | Unused music segments / styles, hooves / swords / `pep_rap` / `Railslide` loose sounds | C | no request, no event; names only | - | `src/devcorner/geluid.ts` |
| 22 | `XXX3`, `BML4`, `CSPZ`, six `BRID`, `NS_OFF` hologram talkers, PlayStation remnants, car "warning" of the manual | C | hidden by explicit code or no mechanism | - | gallery |

Ordered by value for players: 1 (a whole scene), 2 (a side quest), 3 (quality of life), 4 (voice content), 5-8 (small dialogue repairs), 9-10 (polish), 11-15 (extras).

---------------------------------------------------------------------------------------------------------------------------

## 2. Classes and evidence

Evidence strength used below: **code** (decompile / emulated set-up: a function, a flag write, a table row), **data** (a file, a position, a string, a script line), **names** (identifiers, file names, tag
numbering), **ear** (transcript of a recording), **weak** (manual, PlayStation script variants, editor files, other platforms). A class A item needs code or data for *every* part; a class B item names the part
that has only names or weak evidence; class C has nothing for the behaviour.

Two principles that shape every design:

* **The shipped `.txt` is the source of the shipped `.cut`.** `compileCutscene(text, { splineStart: 12 })` (`src/formats/cutscene.ts`) reproduces **86 of the 87** `.cut` files of the game byte for byte (all
  archives; the one exception `lgici06` is an empty stub). So un-commenting a block of an archive `.txt` and compiling it gives exactly what the original compiler would have produced; no authored script text is
  needed for class A scene repairs. (A first check without `splineStart` shows 4 differences: the spline-name table index of `lgi09`, `lgi13`, `ogl03` starts at 12.)
* **Developers cut a block by commenting it out and changing the "next" id of the line before it.** Seen in `lgi09` (`330 ... LECSBK23 350` skips the commented `340` block), `csi02` (`50 ... CACSBR10 70` skips the
  commented `60` block), `lgi10` (`40 ... LECSRS05` has no next at all; the commented block starts at 50) and `adv02` (`ADCSAM04 60` skips the 40 / 50 block that the PlayStation file still shows commented).
  So the restoration rule is mechanical: un-comment the block and set the previous line's next id to the block's id (rule P below).

---------------------------------------------------------------------------------------------------------------------------

## 3. New facts established in this pass (beyond `unused.md`)

1. **LGI11 is a finished scene that nothing starts** and it is the missing first half of the police-station scene (item 1).
2. **Every `BTB` battery sits 1.6 to 1.9 above the terrain** (island collision, node 56): BTB0 (4.4, 22.5, -53.3) terrain 20.8; BTB1 (71.4, 31.8, -172.3) 30.2; BTB2 (192.2, 28.1, -299.4) 26.4; BTB3 (-335.8, 33.5, -219.6)
   31.6; BTB4 (-182.8, 45.6, -430.9) 43.9; BTB5 (-97.2, 23.2, 10.0) 21.5; BTB6 (-232.5, 31.6, 300.9) 29.8; BTB7 (228.7, 28.9, 77.7) 27.3; BTB8 (-207.4, 11.4, -336.4) 9.7; BTB9 (428.0, 77.4, 0.3) 75.7. They were
   placed on the ground by a tool, not floating at random. The ten meshes `Battery.msh`, `Battery1-9.msh` are identical (50 vertices, 32 triangles, 0.8 x 0.86 x 0.5), each with its own `.col`.
3. **The island HUD's gauge bars are a gauge**: `REDBAR`, `GreenBar`, `YellowBar` (textures 9 / 10 / 11 of `Overlays/Z02LGI`, 32 x 16) are exactly the 12 segment tiles of the engine's vertical gauge
   (`FUN_00460214`, `Hud.gauge` in `src/shell/hud.ts`; z22BIP's fuel gauge is `[3 x4, 2 x4, 1 x4]` = red, yellow, green from the bottom). The island never sets the gauge; the battery level is the obvious consumer.
4. **The ghetto blaster already has the power switch**: `GETO` is attached with gate var 0x22 (`SWITCH_GME_RADIO_ON`), `BOTMUSIC` (`FUN_00536a44`) returns 0 and clears its dance bit when var 0x22 is 0, and the
   blaster's pre-render mutes the music unless a bot danced this frame (`misc.ts`). The only writer of var 0x22 is `GETO`'s update, which sets it to 1 unconditionally in nodes 56-60. The "radio off" branch is dead code.
5. **`BML2` is half there**: the world set-up `FUN_004b4907` attaches Brikimal `FUN_004bd4a8` to BML1 and BML3, but for BML2 only writes `flags = 0x20` (exactly what the Brikimal constructor does to its own
   record) and for BML4 `flags = 0`; the constructor compares with BML2's record address and has the swimmer rows (kind 2) in its table.
6. **Darren's slot gaps**: in six LIFSM bands the tag list has a numbering hole exactly where Darren stands (between RICH and PETE); the orphan voice files fill those holes (item 4). `DARR` is an SGMFIG
   in all five eras, and the printed manual says: "Darren is cool. ... Vaak kan hij je goede raad geven" and "Als je even wilt pauzeren ... kun je naar Darren gaan ... hij heeft altijd ideeen om plezier te maken! Experimenteer met je omgeving!".
7. **Two scripts have a data-entry bug that the orphans repair**: `TBOBA` in `LIFSM5.str` points at the C clip `LEBEBB07` (same text as `TBOBC`), the A clip `LEBEAA07` is an orphan; the tag scan over all FSM string files
   finds no other A-tag on a C-clip (and one `UNUSED` pair, item 8).
8. **Sound table**: ids 0 `SND_FLOWER_GROWING`, 2 `SND_FLOWER_SHRINK`, 136 `SND_MFIG_SURPRISE`, 138 `SND_MAMA_SURPRISE`, 254 `SND_BIRDS_FLY2` are mapped to `Silence.wav`; the flower node calls its two sounds on every growing tick
   (`docs/re/m4/wp5-pizza.md`: 17 k calls in the footy test), and `z02LGI/GrowBig.wav` (0.55 s) and `GrowSmll.wav` (0.98 s) are among the unused files. A sample of 0.5 s retriggered 90 times is presumably why it was silenced.
9. **SwapText**: of the 144 SwapText textures 16 belong to no look (4, 29, 30, 72, 107, 124, 126, 136-143); each sits in the numbering gap of one vehicle group (ambulance 4, dinghy 29-30, rescue helicopters 72,
   police car 124, 126, 136-143 = six police badges in white, cream, blue, green, orange, red plus two dark / cream R.E.S.Q logos).
10. **No local speech model**: only whisper.cpp's `for-tests-ggml-tiny.bin` test stub exists on this machine (no `ggml-small` / `medium` / `large` anywhere on disk), so the transcripts could not be redone. The transcripts of
    `unused.md` 7.7 were cross-checked against the str files where a sibling exists (they match in meaning), but every orphan line that is used as a subtitle needs one human listen (section 8, D1).

---------------------------------------------------------------------------------------------------------------------------

## 4. Shared infrastructure (R0)

Everything below is shared by the items; the items only add content on top.

**Option.** `Prefs.restored: boolean` in `src/display.ts` (stored like `debugMenu`, URL `?restored=1`), a checkbox "Herstelde inhoud" next to "Debugmenu" on the start page (`src/main.ts`, near the
`checkbox('le2-debug', ...)` call), plus an optional folded list of the individual features (`restoredOff: string[]`, all on by default) so each item can be switched off. The original options pages (menu
tables in the executable) are not touched.

**Separation.** (1) `src/restore/flag.ts` (tiny, imported statically by shared files): `restoredOn()`, `restoredFeature(id)` and one object `restoreHooks` whose members are all `undefined` by default.
(2) Everything else lives in `src/restore/**` and is loaded with a dynamic `import()` only when `restoredOn()` (the pattern of `src/game/debug.ts` and `src/devcorner/index.ts`), which then fills `restoreHooks`.
(3) The shared files get only additive one-line calls `restoreHooks.x?.(...)`; with the option off nothing changes, no chunk is requested. (4) Nothing of the game is stored: scripts are derived from the
user's archives at run time, tables from the executable (as `docs/re/engine-m4.md` already does for the set-up). The only authored data are the subtitles of lines that exist as audio only (D1).

**Hooks to add (each one line):**

| Hook | Shared file | Purpose |
|---|---|---|
| `script(zone, name, bytes)` | `src/shell/cutscene-host.ts` `declare()` (line ~118, before `parseCutscene`) | replace a `.cut` by the patched one (rule P, items 1, 2, 5, 6, 15) |
| `messages(path, table)` | `src/zones/z02LGI/ctx.ts` `table()`, `src/hub/ctx.ts`, `cutscene-host.ts` (`loadMessages`) | overlay tags: `MessageTable` already accepts `MsgEntry[]` as a source (`src/ui/strings.ts`) |
| `extraSpeech()` | `src/audio/index.ts:46` (`new SpeechEngine(..., tables.speech)`) | append the orphan mp3 names to the table; overlay entries carry the new index (>= 1732) in their id field |
| `sayRewrite(id, id2)` | `IslandContext.say` (`src/zones/z02LGI/ctx.ts:141`) | tips rotation (item 4), the three-line chain (item 8) |
| `startCutscene(slot)` / `cutsceneActive()` | `IslandContext` | chain LGI11 -> LGI12 (item 1) |
| `islandStart(zg)`, `islandTick(zg)` | `src/zones/z02LGI/index.ts` (next to the HUD init at `:168` and the per-tick HUD update) | attach restored nodes, set gauge / arrow state |
| `Hud.extras` | `src/shell/hud.ts` (a list drawn after the gauge) | the arrow |
| `soundPatch(entries)` | `src/audio/tables.ts` | remap sound ids 0 / 2 to the real files (item 9) |
| `cue(name)` | the zone files of item 9 / 10 | one call at the event |

**Rule P (script patch)** in `src/restore/scripts.ts`: read the zone archive's `Cutscene/<name>.txt` (case-insensitive), apply a list of `{ unComment: [lines], setNext: [{ line, id }], insert: [lines] }`,
`compileCutscene(text, { splineStart: 12 })`, hand the bytes to the hook. A self-test compiles the unpatched text and asserts equality with the archive's `.cut` (so a changed data set is detected, not silently patched).

**State.** Battery level uses the original's own `SWITCH_GME_BATTERY_LEVEL` (var 22, in the saved range 15..234); the collected-battery bit mask uses var 225 (`UNUSED_ 225`, zero references anywhere, also in the saved
range). Everything else is stateless or per run. A save made with the option on loads fine with it off (the vars are never read). New game resets them like any other var.

**Dev corner.** The galleries (class C) belong to `src/devcorner/**`; restored features should appear there as "herstelde inhoud" badges, nothing more.

---------------------------------------------------------------------------------------------------------------------------

## 5. Designs of the class A and B items (ordered by value)

### Item 1. LGI11 "BBs_Dance_Dizzy" and the Pied Piper line (A, S)

**Evidence.**
* `z02LGI/Cutscene/lgi11.txt` + `lgi11.cut` (86 / 87 `.cut` equal compile(`.txt`)), `SCRIPTNAME BBs_Dance_Dizzy`, 30 commands; `messages/LI/Data/LGI11.str`: `LECSSB01:731` "Agent Nick Brick, de rattenvanger van Pizza is hier
  met Blokbot gevangenen." (Pepper), `LECSSB02:732` "Pepper, zo is muziek een dodelijk wapen!" (Nick), `LECSSB03:733` "Ik arresteer de radio." (Nick); `LECSSB01-03.mp3` exist and are in the speech table (731-733).
* The era-3 set-up declares it: cutscene slot 7 = LGI11 (emulated set-up, node 56). Nothing starts it: over all five eras the only unstarted island slots are 7 in era 3 and 5 / 6 / 7 (empty `LGICI05-07`) in era 0;
  every other slot is started by a `StartCSM`, an SGMFIG, the page nodes or the house stages (`docs/re/m4/wp17-era3.md` s.2 says the same).
* It is the first half of the scene that does ship: `POLB`'s `StartCSM` (node 0x39 = 57, gate `S277`) starts slot 8 = LGI12 `To_The_Shuttle` (Infomaniac: "Geweldig, mooi, toppie! ... Pepper moet naar de Space Port!").
  Both scenes use the same stage: camera waypoint `CSM_police01`, Pepper / partner on `S1LPAT2` / `S1LPAT3` with the roles mirrored (LGI11 pepp `S1LPAT2`, nick `S1LPAT3`; LGI12 pepp `S1LPAT3`, info `S1LPAT2`).
* The story around it (the Pied Piper theme): LGI09 (`LECSBK20-23`: "OK, je moet nu naar het Radiostation ... Met muziek kunnen we ze verslaan ... Ik ben een man met een plan!") ends in the commented-out
  `//340 pepp saytext LECSBK24` "Pepper, de rattenvanger van Pizza." (active in `lgi09psx.txt` line 208); LGI10 gets the radio; node 56 = dancing the bots out with the ghetto blaster; LGI11 closes the joke with the
  arrest of the radio. The manual says nothing about it (cut before print).

**Meant to work.** Arrival at the police station after the dance: LGI11, then LGI12.

**Design.**
* LGI11 chain: in `IslandContext.startCutscene(slot)` (`src/zones/z02LGI/ctx.ts`), when `restoredFeature('lgi11')`, the era is 3 and `slot === 8`: start slot 7 instead, remember `chain = 8`; `cutsceneActive()` returns
  true while a chain is pending; the island tick (`islandTick`) starts slot 8 when the manager is idle. The `StartCSM` node (`src/island/trigger/startcsm.ts`, slot marker -20 / -30 and the `S277 = 7` operation
  after the end) is untouched: it believes it started slot 8 and sees "active" without a gap.
* LGI09 line: rule P on `lgi09`: `330 0.0 pepp saytext LECSBK23 350` -> next `340`, un-comment only `//340 0.0 pepp saytext LECSBK24 350`. The two `//330 / //350 info setvisibility` lines stay commented (they hide
  the Infomaniac, which the shipped scene does not do).
* Messages: `LGI11.str` is already in the archive; slot 7's string table is declared by the set-up (`declare()` loads `LI/Data/LGI11.str`), nothing to add.

**Invented.** Nothing in the content. The order (7 before 8) follows the slot numbers and the stage data; the one-line decision is that the arrest scene precedes the Infomaniac's praise.
**Off-switch.** Hook unset: slot 8 starts alone as today; `lgi09` loads unpatched.
**Test.** Node: compile equality (unpatched `lgi09` / `lgi11`), patched `lgi09` has `LECSBK24` after `LECSBK23`; `loadIsland({ node: 57 })`, run the POLB trigger, assert `ictx.cutscenes` = [7, 8] and the speech ids
731-733 then 734-739, `S277 == 7` afterwards. Headless: `?zone=z02LGI&node=57&restored=1&mute=1&hold=1` (`tools/steps/m4-era3.mjs` pattern), walk onto the POLB trigger, screenshots of both scenes.

### Item 2. Radio battery side quest (B, M)

**Evidence.**
* Ten hidden records `BTB0..BTB9` = 295..304 with their own models and collision (`meshes/Battery*.msh`, `col/Battery*.col`), set-up writes `flags &= 0xfffd` on them in every era (0x522a20, 0x52ad5b,
  0x527005, 0x52c30c; never `|= 2`), no attach, no controller. Positions: see section 3 point 2 (all on the ground + 1.7).
* Game var 22 `SWITCH_GME_BATTERY_LEVEL`, never read or written; the radio's own var 0x22 `SWITCH_GME_RADIO_ON` (section 3 point 4).
* `lgi10.txt` lines 45-51 (commented, valid as written; `SETFOV` ignores its actor in the runner, `src/shell/cutscene.ts:922`): after `LECSRS05` "Tijd om die Blokbotten te laten da-ansen!" DJ says `LECSRS06` "Oh eh, voor
  ik het vergeet, die radio werkt op batterijen.", `LECSRS07` "Misschien heb je deeeeeze nodig." with `djab setanim dj_throw`, `LECSRS08` "Oh sorry, Pepper, je moet ze onderweg maar oprapen." Audio and text exist (speech 728-730).
  `DJ_THROW` is clip 274 of `MFIG.blk` (50 frames, resolved by the island animation dictionary) and used nowhere else.
* HUD: 12-segment gauge with red / yellow / green tiles in the island's own overlay set and an engine gauge that the island never sets (section 3 point 3).

**Meant to work (reading).** At the end of LGI10 the DJ hands over the radio, remembers it needs batteries, throws some (they fly away), tells Pepper to pick them up on the way; the ten batteries lie around the island;
the radio only plays / makes bots dance while it has power; a battery meter on the HUD shows the level.

**Design.**
* Script: rule P on `lgi10`: `40 0.0 pepp saytext LECSRS05` gets next `50`, un-comment the 50 / 60 / 70 / 80 blocks (cameras `csm_radio02`, `djab saytext` x3, `djab setanim dj_throw`, `setfov`). Compiles (checked).
* World (`src/restore/battery.ts`, `islandStart`): for story node 56 only (the ghetto blaster is carried in nodes 56-60 but the dance puzzle ends at 56), set `RF_ENABLED` on records 295..304 (hidden ones whose bit is set in var 225 stay hidden), attach a
  `BatteryNode` to each through the same attach call the set-up replay uses (`src/game/setup.ts`/`controller.ts`): spin (`ry += 0.05`) and bob (`+-0.25 sin`) per tick; pickup when the record's controller `distSq`
  (`Controller.distSq`, controller +0x18: the squared XZ distance, `updatePass` in `src/game/controller.ts`) is below 16 and |dy| < 4: hide, `BATTERY_LEVEL += CELLS`, set the bit in var 225, play the pickup sound (the island's page / brick collect sample).
* Power: `RadioPower` rides on BTB0's controller (records update in index order, so it runs after `GETO` = 68, which sets var 0x22 = 1): when `BATTERY_LEVEL == 0` it sets var 0x22 = 0, which makes `BOTMUSIC` return 0
  (its original dead branch) and the blaster's pre-render mute the music. Drain: `1 / DRAIN_TICKS` cell per tick only on ticks where `w.ext.get('ambient.botDance')` is true (music audible), i.e. the radio does not drain
  while nothing dances. Start level 0 (the DJ says it needs batteries).
* HUD: while the quest is active `hud.gauge = { value: level, min: 0, max: 12, segments: [9,9,9,9,11,11,11,11,10,10,10,10], marker: -1, icon: -1 }`; otherwise `null`. (Bottom to top: red 9, yellow 11, green 10.)
* Objective: while level is 0 and a battery is left, `objective` is left alone; with item 3 on, the arrow may point at the nearest battery (optional).

**Invented (clearly marked in the code as `// RESTORED: invented`).** `CELLS` per battery (proposal 4 of 12), `DRAIN_TICKS` (proposal 300 per cell = one battery is 40 s of dance music; the puzzle needs about 80-120 s, ten batteries
exist), pickup radius (4), spin / bob, the pickup sound, start level 0, hiding at node 57, the choice to drain only while music is audible. Tune after one play-through.
**Off-switch.** Records stay hidden, `lgi10` unpatched, no gauge, var 0x22 untouched.
**Test.** Node (`loadIsland({ node: 56 })` with the hooks installed): ten records visible, `y - terrainHeight` in [1.5, 1.9], pickup raises the level and sets the mask bit, drain only with `botDance`, var 0x22 follows the
level; a save round trip keeps level and mask. Headless: screenshots of the gauge at 0 / 6 / 12 cells and of a battery on a slope.

### Item 3. Objective arrow (B, S-M)

**Evidence.** `Overlays/Z02LGI/text008` "Pointer" (32 x 32, yellow arrow pointing right in a blue frame; `WhatsWhat.txt`, `Originals/POINTER.tga`) is never drawn: the island HUD (`FUN_004b8ef0`, `FUN_004b908d`) only sets
icons 0-7 and 0xc-0x10. The objective logic runs every tick (story handler `FUN_004b7040` sets mode + records; `FUN_00424e37` resolves the target) and every setter writes `DAT_009da840` = (radius * 8)^2 which nothing reads
(`src/zones/z02LGI/objective.ts:6`, `radiusSq`): an arrival radius for exactly this use. The target is used by the talking NPCs and the hologram only (`docs/re/m4/wp8-island.md` s.3). No other overlay set has a pointer.
The manual's icon list (p. 34-35) does not mention it: cut before print. Why it is cut is unknown; the hologram (clip 0x81) and the NPC's pointing replaced it.

**Design.** `src/restore/arrow.ts` adds a draw callback to the new `Hud.extras`: each frame `t = ictx.objective.target(Pepper)` (the vehicle branch is already handled there); skip when `t` is null, mode 0 (nearest NPC: not a
destination), a cutscene runs, story node >= 0x3d (no HUD icons then either) or `dist^2 <= objective.radiusSq`; angle = bearing to `t` minus the camera yaw; draw texture 8 of the HUD set as a rotated 32 x 32
sprite at (400, 104) on the 800 x 600 grid, tinted white (so the same arrow serves the gauge: no overlap, the gauge is bottom right). Needs one new method `Ui2D.spriteRot(set, index, cx, cy, size, angle, argb)` in
`src/ui/renderer2d.ts` built on the existing private `quad4`.
**Invented.** Position, size, rotation convention (arrow up = straight ahead), the hide rules, island only. **Off-switch.** Callback not registered. **Test.** Unit test of the bearing for four quadrants and the
radius cut-off; headless screenshot at nodes 8 / 12 / 31 (objective record, pair, PATH node).

### Item 4. Darren's tips and his replaced lines (B, M)

**Evidence.**
* Darren (`DARR`, record 50, (-37, 22, -423), SGMFIG in all five eras, var `MOVE_DARR` 0x78; PATH node `DARREN01` (-57, 29, -381) next to the football nodes `FOOTY1-3`) is the advice giver (manual, section 3 point 6).
  Conversation lines are `<NAME>A+B` first, `<NAME>C+D` on the next talk (`src/island/npc/sgmfig.ts:378`).
* His lines per band (`LI/Data/lifsmN.str`): ordinary greetings / hints in LIFSM1, 2, 4, 5, 6, 7; a **tip pair** in LIFSM8 (HT17/18), LIFSM10 (HT25/26), LIFSM12 (HT01/02), LIFSM13 (HT19/20), LIFSM14 (HT07/08), LIFSM15
  (HT09/10). The speech table has `LEDTHT01-42` as 21 pairs; 6 pairs are wired, **15 pairs = 30 clips are audio only** (`sounds/speech/Data/LEDTHT03-06, 11-16, 21-24, 27-42.mp3`, no table entry, no text).
* The numbering gaps: in LIFSM8 / 10 / 12 / 13 / 14 / 15 the A numbering skips right after RICH (AA21, AA20, AA21, AA20, AA22, AA24+25) and the C numbering likewise (BB21, BB20, BB23, BB21, BB22+23, BB24); the orphan
  files fill exactly these holes: `LEFMAA21` "He joh, blijf nou doorgaan!" / `LEFMBB21` "Helemaal naar het rescue-hoofdkwartier."; `LECCAA20` "Leuk je te zien, maatje!" / `LECCBB20` "Ga zo vlug als je kunt naar het politiebureau.";
  `LERSAA21` "Pepper, wat een verrassing!" / `LERSBB23` "Je moet naar het radiostation. Dat is leuk."; `LESBAA20` "Mooie stereo, pizzaman." / `LESBBB21` "De politie heeft naar je gevraagd, Pepper.";
  `LESPAA22` "Pepper! Leuk je te zien!" / `LESPBB22` "Jij hebt duidelijk actie nodig." / `LESPBB23` "Naar de Spaceport en snel."; `LEGFAA24` "Oh Pepper, we zijn je allemaal dankverschuldigd." / `LEGFAA25` "Je bent hier altijd
  welkom." / `LEGFBB24` "Blijf nog even, Pepper. Nu Dondersteen achter slot en grendel zit, kunnen we meer plezier beleven dan ooit." (14 clips: Darren's regular pair of each band, replaced by the tips).
* The 15 unused pairs and what each points at (transcripts of `unused.md` 7.7; hook = the game feature the player can try): 03/04 rabbits jump in the air (Shift near a bunny, five at once: `animals.ts`);
  05/06 CD collection at home (Pepper's computer, music page 23); 11/12 car paint ("spuit je ze gewoon over": Enter changes the look, `looks.ts`); 13/14 film night (computer, movies page 22); 15/16 island makeover (Enter
  on decor / outfits: `decor.ts`); 21/22 "verre landen" (after the first hub); 23/24 rails and the station master ("net zo snel als de Superstationschef": `supe.ts`); 27/28 silver Brickbots dancing to music (era 3);
  29/30 general chat; 31/32 dark corners / tunnels (no hook identified); 33/34 "jump into a vehicle"; 35/36 helicopter ("Stap maar in"); 37/38 jet ski; 39/40 speedboat ("Valerie ... in haar speedboot"); 41/42 house party /
  people following music (`HSE2` music node, era 3). All of them describe features that exist in the port.

**Meant to work.** Darren talks about something to try; his regular pair exists for every band, the tips are an alternative.

**Design.**
* Audio: `restoreHooks.extraSpeech()` appends the 44 orphan names (30 tips + 14 regular) to the speech table (a runtime directory listing of `_data/sounds/speech/Data` minus the table, so it adapts to the data; the names
  are identifiers, not content).
* Text: `restoreHooks.messages()` adds overlay entries to the island NPC tables: tags `DARRT03A`, `DARRT03C` ... (tips) and `DARRR8A`, `DARRR8C` ... (regular pair of the band), each with the new speech index in its id
  field. The subtitles are authored from the transcripts (D1).
* Choice: `restoreHooks.sayRewrite(id)` in `IslandContext.say`: when `id` starts with `DARR`, pick the pair: first conversation of a band = the regular pair (orphan where it exists), later conversations = a tip from the pool
  `eligible(node)` in a fixed order advanced by a per-band talk counter (deterministic, no `Math.random`). `eligible` = a table `{ pair, fromNode, toNode }` (proposal below).
* Bands that have a shipped tip (8, 10, 12, 13, 14, 15) keep it as one member of the pool; bands with ordinary lines (1, 2, 4-7) are left alone (their orphans do not exist; the pool starts at node 10).
* Proposed `eligible` (to be checked against the era set-ups while implementing): rabbits 03/04 from node 7; computer 05/06, 13/14 from node 8 (house built); vehicle paint 11/12 and boarding 33-40 from the node at which
  the vehicle is first usable (car era 1, helicopter / boat / jet ski era 2: verify per roster); makeover 15/16 from era 1; travel 21/22 from node 33; station master 23/24 era 3; silver bots 27/28 and party 41/42 era 3;
  chat 29/30 always; 31/32 held back (no hook).

**Invented.** The eligibility ranges, the rotation rule, the tag names, the subtitle texts (typed from the recordings). **Off-switch.** Hooks unset: Darren says what he says today.
**Test.** Node: pool selection for every node 0..71 is deterministic and non-empty from node 10; every pair's mp3 resolves; `sgmfig.startConversation` with the rewrite speaks both lines of the pair. Headless: talk to Darren
three times at node 56 (spoken ids logged through `window.__zone.game`).

### Items 5-8. Small dialogue repairs (A, S each)

All four use rule P / overlays; none needs new content.

* **5a `CACSBR11` (csi02, A).** In `z07CSI/cutscene/csi02.txt`: `50 0.0 PEPP saytext CACSBR10 70` -> next `60`; un-comment the block `//60 ... CEL_CAM02, SETFOV 0.6, cmra follow LSD1, pepp setanim xtalk3, LSD1 setanim CSITALK3,
  LSD1 saytext CACSBR11 70` ("Hoera, Pepper, Pepper, nu kunnen we gaan vechten!"). The PlayStation twin `csi02psx.txt:90` has the line active with the actor `Lar1` (the PC comment says `LSD1`; use the PC actor, the
  record exists in the hub; if `LSD1` is absent at that moment fall back to `Lar1`: check in the hub).
* **5b `LEINVS04` (lgici25, A).** `LGICI25.str` has `LEINVS01-04`; the script `lgici25.txt` (Valerie gets her pizza: "Honger: over.") stops after `LEINVS03`. Insert `40 0.0 Vals SayText LEINVS04 45` next to the existing
  `40 ... PEP_HandsPizza1 45` ("Honger: over. / Erop af." = hunger over, dig in). The scene is customer slot 25 (era 0, started by VALS's SGMFIG).
* **5c `CACSAR02` (csi01, B).** Ids 01, [02], 03-07 with 02 missing; the script has `Lar2 saytext CACSAR01 11` (comment "//CHEERING"). Insert `Lar2 saytext CACSAR02` between (01 next 6, new `6 ... CACSAR02 11`). B only because
  nothing is commented: the slot is inferred from the numbering and the text ("Handige hulp en hoop is gearriveerd!").
* **6 "Dr. Pepper" gag, `ADCSAM05/06` (adv02, A).** `z16PYA/cutscene/adv02.txt`: `35 0.0 jthn SayText ADCSAM04 60`; the shipped line (`ADV02.str`) is "Ja dokter, dit is Pepper en hij is " and breaks off. The PlayStation file `adv02psx.txt`
  still shows the cut block (`//40 jthn setanim xidle, drkl follow pepp, drkl setanim xtalk, drkl SayText ADCSAM05 50; //50 drkl setanim xidle, jthn setanim xtalk, jthn SayText ADCSAM06 60`); the two clips exist
  (`ADCSAM05` 1.5 s "Dr. Pepper?", `ADCSAM06` 2.3 s "Nee! ... Pepper!"; both are *not* in `ADV02.str` or the speech table), and `ADCSAM07` "Pepper Roni!" follows. Patch: `ADCSAM04` next 40 + the PSX block. Subtitles of 05 / 06
  must be re-checked by ear (the whisper small text was "Dr. Vapper?" / "Nee! (...) Pepper!"; checked by ear: "Dr. Pepper?"; the gag is presumably the soft-drink brand, which would also explain the cut). Class A for the script, D1 for the text.
* **7 Voice-slot bugs (A).** (a) `LIFSM5.str`: `TBOBA:520` points at `LEBEBB07` (the C clip) and repeats TBOBC's text; overlay `TBOBA` -> `LEBEAA07` ("Noodgeval! Niks te maken! Ik moet wat maken!", transcript flagged garbled: D1).
  (b) `LIFSM2.str`: `NICKA:362` / `LICKA:363` reuse the band-1 clips `LEDPAA05/06` ("Hallo hallo, kleine knul!" / "Goeiedag Pepper, hoe is het op straat?") while the band's numbering has holes AA03 / AA04 filled by the orphans `LEPHAA03`
  ("Ha Pepper, en lekker aan het joggen zie ik") and `LEPHAA04` ("Pepper, je bent klaar met je ronde"): overlay NICKA / LICKA -> these two (they fit policemen). This one is a swap of recordings, not a bug: put it behind its own feature id.
* **8 Joke chain `UNUSED` (A).** `CI/Data/CSIFSM4.str` lines 32-34 and 42-44: `BAR2C` "Hoe lang is lang?" -> `UNUSED:1293` "Hoe lang is een touwtje?" -> `BAR2D` "Hoe lang blijf ik hier nog kletsen?" (and `BAR4C` / `UNUSED:1303` / `BAR4D`;
  1293 and 1303 are the same clip `CAJOBB12`). A third line does not fit the two-slot conversation (`say(a, b)`), so the tag was renamed `UNUSED` and left. Restore: after the C+D pair finishes, say the middle line first:
  a small chain in `sayRewrite` (`C`, then `UNUSED`, then `D`) using two successive `say` calls on `speechIdle()`. Audio and text exist.

**Invented (items 5-8).** Only the fallback actor in 5a and the chain mechanics in 8. **Off-switch / test.** As item 1 (compile equality + patched command list; overlay lookups; headless run of csi02 / adv02 via the hub steps `tools/steps/lib-z07CSI.mjs`, `lib-pya.mjs`).

### Item 9. Silenced and never-played cues (B, S each)

**Evidence.** (a) Sound ids 0 / 2 (flowers) map to `Silence.wav` while `GrowBig.wav` / `GrowSmll.wav` exist unused (section 3 point 8). (b) The zone docs list sounds that the original loads and never plays:
Pepper's house `SND_PPH_SWITCHON` / `SWITCHOFF` / `COMPUTER` / `SCROLL_OK` / `SCROLL_NA` (ids 642-646: `StartComp.wav`, `Shutoff.wav`, `computer.wav` (loop), `selectormove.wav`, `Sub_NA.wav`) and `SND_PPH_FSTEP1-4` (674-677,
`PLAS_*.WAV`; the same four samples as the info centre's `SND_IFC_FSTEP1-4`) (`docs/re/m3/z03PPH.md:164`); z10RGB `SND_HIT_CASTLE` (id 406 `HIT_CASTLE.wav`, `docs/re/m6/z10RGB.md:116`); z17WAS `SND_WAS_BIGTHUMP` (456 `big bonk.wav`) and
`SND_WAS_BIGSWING` (457 `X swing big.wav`) (`docs/re/m3/z17WAS.md:92`); z22BIP splash 0x73, melon_fly 0x7e, rock_hit 0x2e5, hit_valley #2 0x72 (`docs/re/m6/z22BIP.md:91`); z15SSH `SND_WATERFALL` (188 `river_amb.wav`);
z28HAT `hatesFinal` 0x2b8; z41MAP `SND_MAP_PAPA_CONGRATS` + speech `OGSGMP06`.

**Design.** `src/restore/cues.ts` registers named cues; each zone file gets one guarded call at the obvious event. Proposed events: flowers: `GrowBig` once at the start of a growth cycle, `GrowSmll` once at the start of the
shrink (the original calls the sound every tick; a half-second sample retriggered 90 times is the likely reason for the silence, so play once per phase: invented); z03PPH: SWITCHON when the computer pages open, `computer.wav`
loop while open, SWITCHOFF on leaving, SCROLL_OK on moving between available entries, SCROLL_NA on a locked entry, FSTEP1-4 on Pepper's footsteps in the house (the surface footstep call of the walk node); z10RGB: HIT_CASTLE when a ball lands on `BUNS`; z17WAS: BIGSWING when a snake swing is the "gem" double press, BIGTHUMP on its hit (the only candidate for a "big
swing": weak); z22BIP: splash on a sea hit, rock_hit on a stone hit, melon_fly when a melon is thrown; z15SSH: waterfall bed near the river (3D, at the `PKLW` water records' side); z28HAT / z41MAP: at the existing result
branches. Each cue states in its code comment which table id it plays.
**Invented.** The event of each cue (named after the sound id); the "once per phase" rule for the flowers; z17WAS is the weakest. **Off-switch.** No `cue()` hook, the sound table patch absent. **Test.** Unit: each cue's id
resolves to a file in the data; headless: the `window.__audio` log (`tools/steps/audio-*.mjs`) shows the sound ids at the events.

### Item 10. Never-shown popups (B, S)

**Evidence.** `LI/Data/WAB.str`: `WAB1` "Gemept", `WAB2` "Mis", `WAB3` "Oh-Nee!" are a 1:1 match with the three whack events of z05WAB (`SND_HIT_BOT` 0x1de, `SND_WAB_MISS` 0x1e0, `SND_HIT_INFO` 0x1df,
`docs/re/m3/z05WAB.md`). `AI/Data/WAS.str`: `WAS1` "Gemept", `WAS2` "Mis" match hit / miss in z17WAS, `WAS3` "Gezwiept" / `WAS4` "Kapot!" go with the unplayed `BIGSWING` / `BIGTHUMP` (class C until a big swing exists).
`AI/Data/FSH.str`: `FSH5` "Mooie vis!" next to the shown `FSH3` "Mooie worp!" (z21FSH's blinking message `FUN_006f48c9(msg, 1, 30, 0, 320, 180)`, `src/zones/z21fsh/rules.ts:111` `MSG`). `AI/Data/BIP.str`: `BIP10` "Je benzine is op!", `BIP11`
"Probeer het nog eens en houd deze keer je benzinemeter in de gaten!", `BIP12` "Jammer!", `BIP13` "Je hebt niet genoeg punten gehaald. Volgende keer beter!", `BIP14` "Gefeliciteerd!!", `BIP15` "WAARSCHUWING: Benzine is bijna
op!" (z22BIP has the fuel gauge, the low-fuel speech `ADSGBI09` below 15 % and the out-of-fuel result 1: `docs/re/m6/z22BIP.md` s.3). Note: none of `BIP1-15` has a reference in the code (the literal strings at 0x931f70.. are
data only; the shipped game uses the speech lines), so the set belongs to an earlier "stunt flight" design (`BIP3-7` Amateur / Bronze / Silver / Gold / Platina stunt, `BIP8` Red Baron, `BIP9` race: class C).
**Design.** Show each text at its event with the zone's existing message / banner facility: WAB at the whacked hole (the HUD text layer), FSH5 on a caught fish, BIP15 together with `ADSGBI09`, BIP10 / 11 on the failed-by-fuel
banner (result 1), BIP12 / 13 on result 0, BIP14 on any medal. **Invented.** Where and how long (copy the nearest shown message); the BIP mapping is by meaning only. **Off-switch / test.** As item 9.

### Item 11. Extra vehicle looks (B, S-M)

**Evidence.** The swap table (`0x8b5028`, `looks.ts: readLookGroup`) holds 8 groups with 7 / 11 / 7 / 10 / 6 / 8 / 9 / 7 looks; 16 of the 144 SwapText textures are in no look (section 3 point 9), each next to the id range of one group:
4 (ambulance emblem) inside the ambulance range, 29 / 30 (R.E.S.Q yellow / black) after the dinghy range, 72 (stripes) inside the rescue-helicopter range, 124 / 126 (an "A" emblem on black / blue) just before the police-car
range 125..135, and 136-143 behind it (police badge on white, cream, blue, green, orange, red; R.E.S.Q on dark / cream). The shipped police-car looks use a body colour plus a badge pair per look (`127/95`, `128/129`, `130/101`, `131/102`,
`132/133`, `134/135`); the brick-model file list of the roster names `policecar00, 02-07` (7) but `BrickMorph/policecar01.txt` exists (same build, blue body) and is unreferenced; likewise `house04.txt`, `jail.txt`,
`shuttle.txt`, `helicopter_resq.txt` exist unreferenced (`unused.md` 7.2).
**Design.** `src/restore/looks.ts` appends looks to the in-memory group read from the executable: new look = copy of an existing look with the badge texture ids replaced by the unused ones (police: 124 / 126 / 136 /
139-143 per colour; ambulance: 4; dinghy: 29 / 30; helicopters: 72), brick-morph file `policecar01` for the missing index. Needs a visual check of each look (which id goes in which mesh group) and a decision per vehicle which
body colour pairs with which badge. **Invented.** The pairing of colours and badges (data decides only the pool); the order in the cycle. **Off-switch.** Groups stay as read. **Test.** Node: group sizes 7 -> 8+, every id
exists in `SwapText`; headless screenshots of the police car cycling through the new looks.

### Item 12. The swimming Brikimal BML2 (B, S)

**Evidence.** Section 3 point 5. `src/island/ambient/brikimal.ts`: `KIND_OF_RECORD = { 366: 0, 368: 1, 367: 2 }`, rows for kind 2 in the table at 0x8d9f10 + 2 * 0xe0, `if (this.animal !== 2)` skips the terrain snap (it
swims), morph files `animal04 / 01 / 05 / 03`; var `MOVE_BML2` (0x2e); the record sits at (0, 0, 0) (never placed). `BML4` (369) has no kind row: class C.
**Design.** `src/restore/swimmer.ts` (`islandStart`): put BML2 on the sea near the coast (position invented), `rec.flags` as the constructor expects, attach `BrikimalNode` with var 0x2e exactly like BML1 / BML3 (the
shape counter and the morph use the existing code; the swimming row and the 8 shapes come from the table). **Invented.** The place (the nearest open sea to the island's centre of mass; the original data has none) and the
era(s). **Off-switch / test.** Record stays at flags 0x20; node test: the kind-2 rows run 3000 ticks without leaving the sea.

### Item 13. Developers' cave without the cheat (B, S)

**Evidence.** Darren's shipped era-2 tip `LEDTHT25/26` (LIFSM10): "ik zag een vogel verdwijnen in een fel verlicht stukje van de hemel, vlakbij de toppen van Space Mountain! ... Als je er doorheen kon vliegen, wat zou je dan aan de andere kant
vinden?"; the WORM record (370, (-410, 129, -98)) is scaled in by `FUN_004b7c78` for node >= 0x3d when var 0xd is set (`src/island/trigger/lgifsm.ts:34,207`), the box portal leads to z50LTC (`src/zones/z50LTC.ts` is complete); the only
setter of var 0xd is the SDREAMS cheat; `z02LGI/Teleport.wav` (1.0 s) and `Teleport2.wav` (0.68 s) are unused (the sound-table entry `SND_CAI_PORTAL` has an empty file name and no caller). The editor's PATH node `CAVE`
(433, 23, -99) is a weak hint to an earlier entrance on the coast.
**Design.** With the option on: when the story reaches node 68 (the ending, free roam) set var 0xd := 1 once (the director then scales the portal in and sets 5), play `Teleport` when Pepper enters the portal box and
`Teleport2` at the arrival in z50LTC. **Invented.** That the unlock is the ending (the data only shows the hint at era 2 and the cheat); the two sound events. **Off-switch.** Cheat-only as today. **Test.** Node: var 0xd after
node 68, portal trigger fires, z50LTC loads (bot `m5-z50LTC-sdreams` exists).

### Item 14. Shadowed hologram hints (B, S)

**Evidence.** `LIHOL9.str`: `HOLOA:681` "Je moet de bladzijden nu terugbrengen, Pepper." (`LEHMRP01`) and `HOLOA:682` "Breng deze helikopter naar Adventure eiland!" (`LETIPC01`) + `HOLOB:683` (`LETIPC02`); the binary search over the stable-sorted
table returns the later duplicate, so 681 never shows. `LIHOL6.str`: `HOLOA:177` "Pas op voor de Blokbotten!" (+ `HOLOB:178 .. HOLOE`) loses to `HOLOA:182`; the B-E follow-ups were written as the answer to 177. `LIHOL16.str` (`HOLOA:685` "Goed gedaan Pepper,
en breng nu die bladzijden maar terug.", `LEHMAP01`) is selected by no band. **Design.** Overlay: LIHOL9 shows 681 while the pages are in hand and 682 otherwise; LIHOL6 shows 177 (with its B-E chain) first, 182 after it was
seen once. Both need a small state test (invented); LIHOL16 stays unused (no band fits). **Off-switch / test.** As item 5.

### Item 15. Page hand-over lines at Adventure Island (B, M / S)

**Evidence.** `AI/Data/ADV04.str`: `ADCSOA13` "Ik dacht wel dat je de bladzijde kon gebruiken, daarom heb ik hem met mijn hengel eruit gevist." and `ADCSOA14` "Alsjeblieft Pepper, hier is de volgende bladzijde!" are in the speech table (1471,
1472), `adv04.txt` ends at `ADCSOA12`. They are the fisherman's lines when the fishing game is won and the page appears. `CI/Data/CSI08.str`: `CACSCS08` "Aha, bijna!" sits between `CS07` and `CS09` in both script versions' numbering.
**Design.** A short script after z21FSH's win (z13CAI hub, fisherman record `FSHM`): speaker = `fshm`, camera as in adv04 (`rodd attach`), then the existing page pickup. For `CACSCS08` the speaker is a guess (`bar1`).
**Invented.** Trigger, staging, speaker; M for the first, S for the second. **Off-switch / test.** As item 5.

### Class B/C boundary notes

* Items 9 and 10 each depend on an event inference; if one cannot be verified in play it is dropped without touching the others (separate feature ids).
* Items 2, 3 and 4 are the three that change how the island *feels*; they are individually switchable.

---------------------------------------------------------------------------------------------------------------------------

## 6. Class C (gallery only) and why

| Item | Why not restored |
|---|---|
| 805 never-loaded meshes: T-Rex course pieces (boulders, lava, stumps, logs, statues, eggs), `ferry`, `police_chopper`, `steam_train`, old trophy names (`ast_`, `cunt_`, `dps_`, `has_`, `pepp_` x gold / silver / bronze), `speederhr/mr/lr`, `rbbt_rabbit1-4` (12-triangle stubs), `space_*_lod`, bridge / road pieces, 47 unused bricks | No record, no position, no behaviour, no loader. The island's records (393) contain no ferry, chopper or train slot; the old trophies are earlier names of the live `<zone>_{gold,silver,bronze}` set; the T-Rex pieces are the pre-merge pieces of the shipped course; many are editor stubs. Gallery with turntable (`src/devcorner/modellen.ts`). |
| 359 front-end character meshes without a model (`z60FRE`) | The 116 shipped models use the other 371; the rest are a library (heads, hair, hats). A character creator would be invention. |
| 74 unused island `.man` | Drafts of scenes that did ship (`lgi04` crash / chopper, `lgi09` kidnap, `lgi13` shuttle): cameras, targets and roots in pairs (e.g. `bbCrash1Cam` + `bbCrash1Target`, `Police_Chopper` + `chopperChaseCam` 624 frames, `bbCrashCam5a/b` + `bbcrash5obj`, `emerge01-05`), but no script names them and the story already tells these events. A "cutscene gallery" can play each triple through the CSM with a generated script (`cmra moveposition spline`, `movetarget spline`, an actor on the root path): dev corner `scenes.ts`, not the game. |
| `adv06` | A draft of `adv07` (placeholder `ADCSTR01` three times). |
| Nodes 68-71 | `{zone 2 / 3 / 4 / 34 (island, z03PPH, z04IFC, z50LTC), var 1 (NS_OFF), mask 0x7fff, value 1}`: the read-only `NS_OFF` is the "never" of the FSM; nothing is meant to set it. Item 13 is the only evidence-based route. |
| Unused music (10 `.sgt`, 14 `.sty`), horse / sword / `pep_rap` / `Railslide` / `Teleport` (beyond item 13) / space cow, `SND_BPK_CHEER*` / `BOO*` (table entries without file names) | Names only, no events. (`SND_BPK_PEPRAP` plays `scratch3.wav` while `pep_rap.wav` exists: a late swap, no reason to reverse it.) Jukebox in the dev corner. |
| `XXX3` (hidden NPC), `BML4`, `CSPZ`, `BRID` x6, `NS_OFF` hologram talkers (z14OSD, z16PYA, z23DIP, z40OGL, z07CSI `HORS`) | Hidden by explicit code (`flags = 0` in `FUN_004b4907`); the HOLO talkers have no text in the npc tables (a forced `HOLOA` finds no tag); superseded by the `hOLO` node. |
| `BIP3-9`, English `TRX_*`, `PARSTR`, `APOSTR`, `WAS3/4`, `UNUSED` stunts | Earlier designs or other languages; would need translation or a new mechanic. |
| PSX-only script lines (`LECSBE22/23` "Ssst! / zzz", `CACSBP17`) | They belong to a different staging of scenes (`lgi04psx` has the Infomaniac asleep, `csi04psx`); the PC scenes do not have the slot. |
| Manual: "blijf uit de buurt van auto's, anders krijg je misschien een waarschuwing wat je punten kan kosten" | No variable, string or code for a car warning exists in the executable (grep of all `SWITCH_*` names and strings). |
| Alt takes (`ADSGSS01_`, `ADSGSS01_NLB`, `ADSGTR01_`, `ADSGDS07ALT`, `LEGFBB15ALT`, `LEPHBB05 ALT`, `LEGPAA08 ALT`, `CARQBB04ALT1`, `LEBBPH02B`, `LEBBPM06B`, `LECSBE20B`, `BALBAA01`, `CAROAA07`, `OGSGPO11_NL ALTERNAT`) | Other takes of lines that exist; nothing to restore (a "voice variants" list in the jukebox). `CACSFH02/03/06` ("Pepperdag" proclamation, "Een hoorntje voor papa!") are the remains of a cut castle feast without any table entry or script. |

---------------------------------------------------------------------------------------------------------------------------

## 7. Test plan

1. **Off equals original (the main guarantee).** With the option off: `restoreHooks` has no defined member (unit test); the dynamic chunk `src/restore/**` is never requested (headless step reads `performance.getEntriesByType('resource')`);
   all existing differential tests unchanged: `node tools/test-formats.mjs` (`m4-wp8-story`, `m7-isl-veh-*`, `m4-s-island`, `m6-z22BIP`, ...); a seeded 3000-tick island soak (`engine-soak`) hashes identically before and
   after the infrastructure lands.
2. **Script patches.** `tools/tests/restore-scripts.mjs`: for every patched script, compile(unpatched txt, splineStart 12) == archive `.cut`; patched compile parses; the patched command list equals the expected delta
   (a line count and the saytext ids in order); all 86 equalities as a data-set check.
3. **Overlays.** Every overlay tag resolves (`MessageTable.has`), every voice index is < table size + orphans, every orphan mp3 exists, the speech engine decodes each (`tools/tests/audio-speech.mjs` pattern).
4. **Behaviour nodes.** `loadIsland` (`tools/lib/island-load.mjs`) with the hooks installed: battery placement / pickup / drain, arrow bearing and cut-off, tips pool determinism, chain 7 -> 8, `BML2` swim rows.
5. **Headless browser, muted** (the browse tool opens its own headless Chromium, never the user's browser; at most two bots at a time through the slot script):
   `sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:<port>/?zone=z02LGI&node=56&restored=1&mute=1&hold=1" tools/steps/restore-battery.mjs --size 1280x800 --out /tmp/restore` (a private snapshot server
   from `tools/m4-snapshot-server.sh <port>`); steps per item: 1 (node 57 -> POLB), 2 (node 56: batteries, gauge), 3 (nodes 8 / 12 / 31), 4 (talk to Darren at node 56), 5 / 6 (hub steps).
6. **Saves.** Save with batteries collected, reload with the option on and off.

---------------------------------------------------------------------------------------------------------------------------

## 8. Method, open decisions, what was not done

**Method (re-creatable).** (1) Re-extract all archives to `/tmp/le2-unused/story/x` (`extract-all-archives.mjs`, run with `node --experimental-strip-types`). (2) Cutscene round trip: `compileCutscene(txt, { splineStart: 12 })` against every
`.cut` (86 / 87). (3) Commented-command scan over all compiled scripts (`^//\s*\d+\s` lines; only `lgi09`, `lgi10`, `csi01`, `csi02`, `csi02a` contain commented `saytext`). (4) Island set-up emulation for nodes 0, 2, 3, 5, 6, 7, 10,
12, 15, 25, 29, 30, 31, 35, 45, 51, 52, 53, 55, 56, 58, 60, 61, 68: BTB / BML / DARR flag writes and attaches with their store addresses; declared vs started cutscene slots per era; the DARR attach per era. (5) Terrain heights of the
batteries through `loadIsland(...).world.col.terrainHeight`. (6) Tag scan of all `*FSM*.str`: speech id -> table name, A / B tags on AA / BB clips, numbering gaps per band, orphan matching. (7) Swap-table scan:
used texture ids per group vs the 144 SwapText files; contact sheet of the 16 unused ones. (8) Sound-table scan: entries mapped to `Silence.wav` / without a file. (9) Manual text (`pdftotext`). (10) Island PATH node names
(`aW_PATH_.h` + `W_PATH_C.wpt`) for `DARREN01`, `CAVE`, `TRAPA*`, `BBCRASH*`.

**Open decisions for the owner.**
* **D1 Subtitle texts.** The orphan lines exist as audio only; their subtitles must be typed by us (transcripts in `unused.md` 7.7). Ship them as the project's own text (`src/restore/lines.nl.ts`, ~50 short lines) or leave
  those lines without subtitles. Recommended: ship, after one listen per line.
* **D2 Brand gag.** Item 6 restores a line that was probably cut for the soft-drink brand; include it or not.
* **D3 Quest numbers** (item 2) and **tip eligibility** (item 4) are proposals to tune in play.
* **D4 Speech model.** A larger whisper model (`ggml-medium` / `large`) is not on this machine and was not downloaded; fetching one would let `tools/research/unused/whisper-orphans.sh` redo the garbled lines
  (`LEBEAA07`, `LEPHAA03`, `LEBBPH02B`, `CACSFH03/06`, `ADCSAM05/06`).

**Not done.** No source or data file was changed; nothing was run in the browser (all checks were node-side); the per-vehicle visual work of item 11 and the hub scenes of items 5c / 15 were not rendered; the other hubs' cutscene
slots (z07CSI, z13CAI, z14OSD, z16PYA, z23DIP, z40OGL) were not audited for "declared but never started" (only the island was, because only the island has an emulated slot table here); the GBA / PS1 versions and
press material were not consulted beyond the PlayStation scripts in the archives and the printed manual.

---------------------------------------------------------------------------------------------------------------------------

## 9. Cutscene audit of the other hubs and zones (2026-10-29)

Read-only pass (nothing in `src/` or the data changed). Scripts of this pass: `tools/research/restore/` (`hub-slots.mjs`, `hub-startcsm.mjs`, `hub-texts.mjs`, `scan-scripts.mjs`, `scan-blocks.mjs`, `scan-str.mjs`, `scan-gaps.mjs`, `scan-fsm.mjs`, `psx-diff.mjs`, `hub-talkers.mjs`, `hub-dead-npcs.mjs`, `hub-records.mjs`, `anim-check.mjs`, `scan-literals.mjs` (lead list only) and **`cutscene-patches.mjs`**: the patch specs below, with a verifier; `node --experimental-strip-types tools/research/restore/cutscene-patches.mjs [--json] [ID...]`). All of them expect the archives extracted with `tools/research/unused/extract-all-archives.mjs` to `/tmp/le2-unused/story/x` and `/tmp/le2-unused/speech-table.tsv`.

### 9.1 What was checked and the headline results

* **Declared slots vs. started slots** (the emulated set-up of every hub node, `emu.cutscenes` and the decoded `StartCSM` triggers, ctor `0x51e19c`; the portals `PORS` / `PZ00` use ctor `0x51ea3c`, also named "StartCSM" by the emulation, with another argument layout: ignore their "slot"): **every declared script of z07CSI, z13CAI (none declared), z14OSD, z16PYA, z23DIP, z40OGL is started by a trigger in the node where it is meant to play.** The slots a node lists but does not start belong to another node of the same hub (`ADV05` is started at node 45, `ADV01` at 34, ...; `csi09` is declared in nodes 24 / 25 but started at 27). Slots started by zone code instead (grep): z21FSH `ADV04` (node 42) / `ADV11` (the win), z28HAT `ADV08` (start) / `ADV09` (medal), z40aPO `ogl02` (start), z42BRP `BRP01` (end). The only scripts no slot names: `adv06` (known), `csi03` (one-line stub "NO LONGER USED", no `.cut`, no `.str`). **`csi02a` is not unused**: `FUN_0057ab10` declares it instead of `csi02` when game var 0xc2 = `SWITCH_GME_BKD_GOTPAGE` is non-zero (page already won in z08BKD).
* **Block graph of all 87 compiled `.cut`** (`scan-blocks.mjs`, FUN_00458c15: a wait id that nobody signals never starts): no never-starting block in any script (the dev cut blocks by deleting / commenting them and re-pointing the previous next id, so nothing is left dangling). Compile equality `compile(txt, splineStart 12) == .cut` holds for all hub / zone scripts below (86 of 87 overall, as before).
* **Commented commands** (`^//\s*\d+` lines of the hub scripts): 82 lines in the 15 PC scripts that have any (`psx-diff.mjs`, `scan-scripts.mjs`), of which only **two blocks carry speech** (`csi02` / `csi02a` block 60 = `CACSBR11`) and **one carries a missing actor beat** (`ogl01` block 40 / 45). All others are alternative camera / position / animation choices that the active lines replaced (listed in 9.2).
* **PlayStation twins** (`*psx.txt`; `psx-diff.mjs` lists the commands only they have): the saytext ids that are active in a PSX twin and absent from the PC `.cut`: **`CACSBR11` (csi02)**, **`CACSBP17` (csi04)**; the PSX `adv02` still shows the cut `ADCSAM05/06` block (commented). No other id differs in any hub script.
* **`.str` / speech table** (`scan-str.mjs`, `scan-gaps.mjs`): every speech-table entry has a `.str` line (the last two entries, 1730 / 1731, are extra copies of `OGCSSD08` that no line uses), 1698 mp3 for 1732 names. Scripted vs `.str` ids of the hub scripts: only `CACSAR02`, `CACSBR11`, `CACSBP17`, `CACSCS08`, `ADCSOA13/14` (and csi02a's 08-11 by design) have a line but no script. Numbering holes inside the hub series: **`ADCSAB08` only (no line, no mp3: nothing to restore)**. Table entries **without an mp3** (new): `CARQAA03`, `CARQAA07`, `CARQBB06` (three CSIFSM6 lines: `LQUNA`, `LSD2A`, `LSD2C`) and `CASGJO11` (z09JST): text only in the original, so the speech engine must tolerate a missing file for them (R-A15).
* **Hub FSM / hologram tables** (`scan-fsm.mjs`, `hub-talkers.mjs`, `hub-dead-npcs.mjs`; the nodes -> files map is `hub-texts.mjs`): all 6 CSIFSM, 4 ADVFSM, OGLFSM2 and all 7 CSIHOL, 8 ADVHOL, FSHHOL, 2 OGLHOL files are selected by some node (the exe holds every path; the missing numbers ADVHOL4 / 5 / 8 do not exist as files). No A/B tag on a BB/AA clip and no C/D tag on a wrong clip (the LIFSM-style voice-slot bugs of item 7 do not occur in the hubs); numbering of every `CA..AA/BB`, `AD..AA/BB` series is gap-free; the only `UNUSED` tag is the known pair `UNUSED:1293 / 1303` (item 8). **New: NPCs whose lines exist but who are not on the stage** (R-A11, R-A12).
* **Not a cutscene but found on the way** (z04IFC info centre, from `docs/re/m3/z04IFC.md` + `IFC.str`): R-A13.

### 9.2 Per hub / zone

**z07CSI** (nodes 15-29; slots per node from the emulated set-up; starters = `LAND` `StartCSM` gated on var 0x58 = node)

| script | slot / node | started by | commented / missing | finding |
|---|---|---|---|---|
| csi01 ARRIVES | 0 / 15-17 | LAND (var 0x58 = 16, waypoint) | `//10 cmra ... lar2` + `//10 Lar2 saytext CACSAR01` (earlier staging), id `CACSAR02` skipped (`01`, `03`) | **R-A4** (B) |
| csi02 BRIDGE_CELEBRATION | 0 / 19-22 (var 0xc2 = 0) | LAND (var 0x58 = 19, immediate) | block 60 `CACSBR11` (lines 111-116); `//20 cnst attach brik righthand` (106) and the position lines 17-23 are leftovers | **R-A1** (A) |
| csi02a (same, page already won) | 0 / 19-22 (var 0xc2 != 0) | same | block 60 `CACSBR11` (109-114); blocks 26-50 (`CACSBR08-10`, page hand-over) are correctly absent | **R-A2** (A) |
| csi03 | none | not declared | one line "NO LONGER USED" | nothing |
| csi04 HAVE_PAGE_NO | 1 / 20 | LAND (var 0x58 = 20) | `//70 cmra moveposition cata_cam03` (46, replaced by `movetarget ... pflg`); `CACSBP17` only in `csi04psx.txt:71` (bar1) | **R-A9** (C, not recommended) |
| csi05 | 2 / 21 | LAND (21) | `//120 pepp enableai` (127, 141: `hors_pep_ridehrsgallop`): alternates | none |
| csi06 | 3 / 22 | LAND (22) | none | none |
| csi07 HaveTheFlag | 0 / 24 | LAND (24, immediate) | `//90 jkit setanim PEP_CATCHBULLFLAG 100` (97): clip 156 (next to `LKNG_THROWSFLAG` 155) is used by no script; other comments are alternates (`psts3`, `lionkg1`) | **R-A8** (cosmetic) |
| csi08 CEDRIC_STEALS_FLAG | 1 / 25 | LAND (25, waypoint) | `CACSCS08` "Aha, bijna!" between 07 and 09 (PSX has no 08 either); `//60 ... lkng_throwsflag` etc. are copy-paste leftovers of csi07 | **R-A6** (B) |
| csi09 cedric_defeated | 2 / 27 | LAND (27, immediate) | `//0 PAG0 moveposition spline z07csi\matanim\Flutter.man 25 PSXSPLINE` (26): `Flutter.man` is referenced by no active script | **R-A10** (B cosmetic) |
| hub NPCs | - | - | `CAVL` (45), `LAR4` (44), `BAR4` (32) hidden by the set-up and not attached although CSIFSM1-6 have lines for them; `LGRD`, `BGRD` have lines and no record | **R-A11** (B), **R-A12** (C) |

**z13CAI**: no cutscene folder, no slot, no NPC table (`advholA` at node 33, `advhol0` at node 51). Nothing.

**z14OSD**: `ADV01` (slot 0, `SCRP` trigger, node 34, var 186 mask 0x1), `ADV05` (slot 1, `SCRP` at node 45); `adv01` has only commented `setfov` lines (48, 56, 63); `ADCSAB08` is a hole without audio. Nothing to restore.

**z16PYA**: `ADV02` (node 36, `SCRP`, var 186 mask 0x2), `ADV03` (node 38). `adv02`: `//20 cmra movetarget`, `//90 drkl follow jthn` are alternates; the **cut `ADCSAM05/06` block** (PSX `adv02psx.txt:37-44`) is **R-A5** (A, known item 6). `adv03` clean (22 lines, 22 ids).

**z23DIP**: `ADV07` (slot 0, node 47), `ADV10` (slot 1, node 50, var 186 mask 0x8). `adv06` is a draft (known item 19, class C). Nothing new.

**z40OGL**: `OGL04` (slot 2, node 64), `OGL01` / `OGL03` (slots 0 / 1, node 66, `PZ00` immediate / waypoint). `ogl01` block 40 / 45 (cit4 falls asleep) is **R-A3** (A). `ogl03` `//0 brik setposition waypoint brik02` / `//0 brik setanim xtalk`: **no `BRIK` record in z40OGL** (waypoints `BRIK01-03` at y = 200 and the five unused `.man` `brikPalaceCam1`, `brikPalaceTarg1`, `ogelPalaceCam01/02`, `Batflight` remain): a cut Brickster-in-his-palace shot, class C (R-A16). `OGLFSM2.str` (4 lines `OGBPAA01/02`, `OGBPBB01/02`): R-A12.

**z40aPO** (`ogl02`, messages `apo01`): 8 ids, all scripted; the speech table lists `OGCSSD08` twice (1730 / 1731), no impact.

**z42BRP** (`BRP01`, messages `ogl02.str`): 11 ids, all scripted (`OGCSDB01` is a line with an empty text = a sound-only beat). `BRP.str` `OGSGBP07-25` (19 lines): R-A14 (C).

**z21FSH** (`ADV04` node 42, `ADV11` win): `ADCSOA13/14` -> **R-A7** (B). `//120 swch setswitch SWITCH_GME_MOVE_PIZ3 0` (adv04:64) is a leftover (no `PIZ3` effect is needed; not restored).

**z28HAT** (`ADV08`, `ADV09`): all ids scripted, no comments. **z03PPH, z04IFC, z50LTC, z41MAP, front end**: no `Cutscene` folder; strings only (R-A13; `FRONTEND` / `PAUSE` label leftovers are in `unused.md` 8.6).

### 9.3 New items (numbering continues after 22; `R-A` = restore audit)

Status legend: `verified` = patched text compiles with `compileCutscene(text, { splineStart: 12 })`, baseline compile equals the shipped `.cut`, every block of the patched script can start (counter rule), new speech ids exist in the slot's `.str`, as mp3 and (except R-A5) in the speech table, new actors / animations already occur in the script / the hub dictionary. Not rendered in the port's runner (see 9.5).

| # | Item | Class | Evidence (file, line, ids) | Patch spec (machine-readable: below) | Status |
|---|---|---|---|---|---|
| R-A1 | csi02 `CACSBR11` "Hoera, Pepper, Pepper, nu kunnen we gaan vechten!" (Lion: LSD1) | A (known 5a) | `csi02.txt:109` `50 ... CACSBR10 70` skips the commented block 60 (111-116); PSX `csi02psx.txt:90` has it active (actor `lar1`); mp3 `cacsbr11` 3.8 s, speech 1050, `CSI02.str:1050` | unComment 111-116, next 109: 70 -> 60 | verified (97 -> 103 commands) |
| R-A2 | csi02a, the same line | A | `csi02a.txt:93` `24 ... CACSBR07 70` skips the block 60 (109-114) | unComment 109-114, next 93: 70 -> 60 | verified (84 -> 90) |
| R-A3 | ogl01 fourth sleeper `cit4` (camera behind cit4, `cit4_snaek_fallingasleep`, `cit4_snaek_sleep_idle`) | A (cosmetic) | `ogl01.txt:46` `30 ... cit5 setanim ... 50 2` skips the commented blocks 40 / 45 (48-51, 53); `ogl01psx.txt:34-45` shows the order cit1, cit3, cit5, **cit4** (40-41), cit2; clips 7 / 6 of `CIT4.blk` (8 clips) exist in the loader dictionary. **Do not un-comment line 24** (it would move cit4 to `holo01`; the montage shows each sleeper where it lives: cit4 at (-67.3, -36.5, 83.9)) | unComment 48-51, 53, next 46: 50 -> 40 | verified (42 -> 47) |
| R-A4 | csi01 `CACSAR02` "Handige hulp en hoop is gearriveerd!" (Lar2, 3.2 s) | B (known 5c) | ids 01, **[02]**, 03-07; `csi01.txt:47` `5 ... Lar2 saytext CACSAR01 11`; the commented lines 54-56 show Lar2 as the speaker of the cheering; PSX also lacks 02 | next 47: 11 -> 8, insert after 47 `8 0.0 Lar2 saytext CACSAR02 11` | verified (52 -> 53). Invented: speaker (Lar2) and slot |
| R-A5 | adv02 `ADCSAM05` "Dr. Pepper?" (Drkl) / `ADCSAM06` "Nee! ... Pepper!" (Jthn) | A script / D1 text (known 6) | `adv02.txt:32` `35 ... jthn SayText ADCSAM04 60` (the line ends "... en hij is "); `adv02psx.txt:37-44` still has the block (commented); mp3 exist (1.5 s / 2.3 s), **no `.str` line, no speech-table entry** (needs the `extraSpeech` + overlay of R0) | next 32: 60 -> 40, insert after 34 six lines (below) | verified (64 -> 70); the two subtitles are D1 |
| R-A6 | csi08 `CACSCS08` "Aha, bijna!" | B | `CSI08.txt:64` `34 bar2 saytext cacscs07 50`, `:69` `50 pepp saytext cacscs09 80`; id 08 skipped in the PC and the PSX script; speaker **bar2** (the three lines before it are bar2's; pitch of the recording ~134 Hz like `CACSCS05` ~132 Hz, Pepper's `CS02-04` 225-258 Hz: weak, pitch tracker unreliable) | next 64: 50 -> 36, insert after 64 `36 0.0 bar2 saytext cacscs08 50` | verified (121 -> 122). Invented: speaker; a listen decides |
| R-A7 | `ADCSOA13/14` fisherman hands the page ("Ik dacht wel dat je de bladzijde kon gebruiken, daarom heb ik hem met mijn hengel eruit gevist." / "Alsjeblieft Pepper, hier is de volgende bladzijde!") as new script `adv04b` | B (known 15) | `ADV04.str:1471/1472`, both mp3 (6.9 s / 4.5 s, a low voice like `ADCSOA11/12`), `adv04.txt` ends at `ADCSOA12`; fits the z21FSH **loss / abort** path (20 casts used up: result 1; the page is not won) better than the win (`ADV11` has Pepper cheer "ik heb de bladzijde") | new script text (script file), 11 commands | verified (compiles, 0 -> 11). Invented: trigger (loss or abort of the fishing game), staging |
| R-A8 | csi07 Pepper catches the flag: `PEP_CATCHBULLFLAG` | A (cosmetic) | `CSI07.txt:97`; clip 156 in `MFIG.blk` (205 clips) used by no script | unComment 97 | verified (77 -> 78); needs a look (the active `bbfg_drops` / `dropped` pair may have replaced it) |
| R-A9 | csi04 `CACSBP17` "Op naar de stallen." (Bar1) | C | `csi04psx.txt:71` `65 bar1 saytext CACSBP17 70`; the PC staging throws the horse at once (`170 ... hors_throwhorse`), so "to the stables" contradicts it | next 77: 165 -> 160, insert after 77 `160 0.0 bar1 saytext CACSBP17 165` | verified (94 -> 95). **Not recommended** |
| R-A10 | csi09 page flutter `Flutter.man` | B (cosmetic) | `CSI09.txt:26` (`... 25 PSXSPLINE`); `z07CSI/matanim/Flutter.man` (1092 bytes) referenced by no active script; the camera line 31 `//10 cmra follow pag0` conflicts with 30 / 33: leave commented | unComment 26 | verified (29 -> 30); look needed (duration of the spline decides when block 25 starts) |
| R-A11 | **Hidden NPCs with lines: `CAVL` (record 45), `LAR4` (44), `BAR4` (32) of z07CSI** | B | CSIFSM1-6 have lines for all three in every band they can appear in (CAVL: A+C in all six, B in FSM5; LAR4: A+C in all six; BAR4: A+C in FSM2-6, `BAR4D` in FSM4) and the records exist with model and position (siblings LAR3 / BAR3 are attached with `SGMFIG, Turn2Pep, Human1, Turn2Pep`); the set-up **hides** them (flags 2 -> 0: CAVL at `0x573879` in the set-up root `FUN_00573527` for every node; LAR4 at `0x5b7077` (`FUN_005b5a20`, node 16) and `0x5b4cf3` (`FUN_005b2fa0`, nodes 19-28 tested); BAR4 at `0x5b767f` / `0x5b5435`; node 17 and 27 / 29 not run separately) and attaches nothing. The scripts `csi02` / `csi02a` animate `BAR4` (`:46`, `:73` `xhappyjump` / `xtalk3`) while it is hidden. Positions: CAVL (128.5, 13.9, 165.2), LAR4 (194.0, 14.6, 162.1), BAR4 (-77.1, 13.7, -15.8) (siblings LAR3 (148, 13, 154.5), BAR3 (-74, 13.4, 28.5)). 36 lines in all (CAVL 13, LAR4 12, BAR4 11) | records 45 / 44 / 32: `flags |= 2` in nodes 16-29 (24 has no FSM table) and attach `SGMFIG + Turn2Pep + Human1 + Turn2Pep` cloned from LAR3 (LAR4, CAVL) / BAR3 (BAR4) with the record index replaced | **not compiled** (no script); checked with `hub-dead-npcs.mjs`. Invented: that the three were meant to stand there (the data hides them on purpose, maybe a crowd limit) |
| R-A12 | **Lines without a speaker**: `LGRD` / `BGRD` (CSIFSM4 `LGRDA/C`, `BGRDA/C`; FSM5 / 6 `BGRDA/C`): **no record, no mesh** in z07CSI; **OGLFSM2** `OGBPAA01/02`, `OGBPBB01/02`: tags the `<NAME4><letter>` lookup of SGMFIG cannot form, MAMA / PAPA / CIT1-5 are hidden at node 66 and have no tags | C | `hub-dead-npcs.mjs`, `hub-records.mjs z07CSI ...`, `sgmfig.ts:404` (name = 4 chars + letter); `docs/re/m5/z40OGL.md:42`; texts: "Sorry Pepper. Je mag er niet in." / "Halt, verboden toegang!" (guards), "Pepper, ik vind dit helemaal niks, ik voel me niet lekker!" / "Hee Pepper, het is hier nogal turbulent!" / "Vlug Pepper, het paleis van Dondersteen is daar!" / "Stuiter die kant maar eens op ..." | none | gallery only |
| R-A13 | **z04IFC "Leeftijd" lines and unlinked pages** | A (text) / B | `IFC.str`: every character has `IFCxxxx01` "Leeftijd: nn" but `FUN_0041c964` starts at `...02` (docs `m3/z04IFC.md:96`; `IFCINF01` is the original's typo for `IFCINFO01`); Bill (page 22) and the three footballers (pages 36-38) have a page but no location links to them (`z04IFC.md:95`) | not a script: show the `01` line above the `02` line (`infoLines`, `src/zones/z04IFC/pages.ts:46`), map `IFCINF01` for the Infomaniak; link Bill / footballers: invented location | not checked in the port; facts from the doc and `IFC.str` |
| R-A14 | z42BRP `BRP.str` `OGSGBP07-25` (19 lines) | C | no code names them (`scan-literals.mjs`: only 01-06, 26-28, 34 are said; `RESULT_LINES` has no loss entry, `docs/re/m6/z42BRP.md:33` "result is always success"); 07-09 = result lines of a lost run ("Oh nee, Dondersteen heeft de zege uit de klauwen van de nederlaag gegrepen" ...), 10-20 = banter of Brickster's helpers (Simon, Sam Sinister the T-Rex hunter), 21-25 = Brickster's "ik ben je vader" gag; all 19 have audio | none (no trigger, no actors) | gallery / jukebox |
| R-A15 | Table entries without an mp3: `CARQAA03` (`LQUNA` "Veel succes verder met je avontuur Pepper."), `CARQAA07` (`LSD2A`), `CARQBB06` (`LSD2C`), `CASGJO11` | info | `scan-str.mjs` + directory listing | the speech engine must not stall on a missing file; show the subtitle only | to check in `src/audio` |
| R-A16 | ogl03 Brickster in his palace (`brik` lines, `brikPalaceCam1` + `brikPalaceTarg1`, `ogelPalaceCam01/02`, `Batflight`) | C | `ogl03.txt:8, 10`; no `BRIK` record in z40OGL | none | gallery (merge with item 18) |

Patch specs (all line numbers are 1-based lines of the ORIGINAL file in the archive's `Cutscene` folder; `unComment` removes the leading `//`; `setNext {line, from, to}` replaces the next-id token `from` after the command word; `insert {after, lines}` inserts after that original line; rule P as in section 4 with the same self-test):

```json
[
 {"id":"R-A1","zone":"z07CSI","script":"csi02","unComment":[111,112,113,114,115,116],"setNext":[{"line":109,"from":70,"to":60}],"insert":[]},
 {"id":"R-A2","zone":"z07CSI","script":"csi02a","unComment":[109,110,111,112,113,114],"setNext":[{"line":93,"from":70,"to":60}],"insert":[]},
 {"id":"R-A3","zone":"z40OGL","script":"ogl01","unComment":[48,49,50,51,53],"setNext":[{"line":46,"from":50,"to":40}],"insert":[]},
 {"id":"R-A4","zone":"z07CSI","script":"csi01","unComment":[],"setNext":[{"line":47,"from":11,"to":8}],"insert":[{"after":47,"lines":["8\t\t0.0\t\tLar2\t\tsaytext\t\t\tCACSAR02\t11"]}]},
 {"id":"R-A5","zone":"z16PYA","script":"adv02","unComment":[],"setNext":[{"line":32,"from":60,"to":40}],"insert":[{"after":34,"lines":["40\t0.0\t\tjthn\tsetanim\t\txidle","40\t0.0\t\tdrkl\tsetanim\t\txtalk","40\t0.0\t\tdrkl\tSayText\t\tADCSAM05\t\t50","50\t0.0\t\tdrkl\tsetanim\t\txidle","50\t0.0\t\tjthn\tsetanim\t\txtalk","50\t0.0\t\tjthn\tSayText\t\tADCSAM06\t\t60"]}]},
 {"id":"R-A6","zone":"z07CSI","script":"csi08","unComment":[],"setNext":[{"line":64,"from":50,"to":36}],"insert":[{"after":64,"lines":["36\t\t0.0\t\tbar2\t\tsaytext\t\t\tcacscs08\t\t50"]}]},
 {"id":"R-A7","zone":"z21FSH","script":"adv04b (new)","text":"cutscene-patches.mjs SPECS R-A7: 11 commands, blocks 0 / 5 / 10 / 20, fshm SayText ADCSOA13 then ADCSOA14"},
 {"id":"R-A8","zone":"z07CSI","script":"csi07","unComment":[97],"setNext":[],"insert":[]},
 {"id":"R-A9","zone":"z07CSI","script":"csi04","unComment":[],"setNext":[{"line":77,"from":165,"to":160}],"insert":[{"after":77,"lines":["160\t\t0.0\t\tbar1\t\tsaytext\t\t\tCACSBP17\t165"]}]},
 {"id":"R-A10","zone":"z07CSI","script":"csi09","unComment":[26],"setNext":[],"insert":[]},
 {"id":"R-A11","zone":"z07CSI","records":[{"name":"CAVL","index":45,"clone":"LAR3"},{"name":"LAR4","index":44,"clone":"LAR3"},{"name":"BAR4","index":32,"clone":"BAR3"}],"nodes":[16,17,19,20,21,22,25,27,28,29],"set":"flags|=2 + attach SGMFIG,Turn2Pep,Human1,Turn2Pep (args of the clone, record index replaced)"}
]
```

Audio / text names: R-A1 / R-A2 `CACSBR11` (CSI02.str 1050); R-A3 none (speech `OGCSES01` unchanged); R-A4 `CACSAR02` (1034); R-A5 `ADCSAM05`, `ADCSAM06` (mp3 only: overlay ids >= 1732, subtitles D1); R-A6 `CACSCS08` (1103); R-A7 `ADCSOA13` (1471), `ADCSOA14` (1472); R-A9 `CACSBP17` (1072); R-A11 `CAVLA/B/C`, `LAR4A/C`, `BAR4A/C/D` of `CSIFSM1-6` (ids 1164-1389, in the table above).

Class summary: **A**: R-A1, R-A2, R-A3, R-A5 (+ D1), R-A8 (cosmetic), R-A13 (text); **B**: R-A4, R-A6, R-A7, R-A10 (cosmetic), R-A11, R-A13 (links); **C**: R-A9, R-A12, R-A14, R-A16; info: R-A15. Value order: R-A1 / R-A2 (a real line, mechanical), R-A5 (the gag, D2 decides), R-A4 / R-A6 (two small lines), R-A3 (a montage beat), R-A7 (needs the trigger decision), R-A11 (three more talkers in the castle), then the cosmetic ones.

### 9.4 Method details worth keeping

* The slot view of a hub node is `profileFor(zone, pe, scene, undefined, { emuVars })` with var 0x58 = node and var 2 = 1 (the pattern of `tools/m5-hub-survey.mjs`); `StartCSM` decode = `decodeStartCsm(ArgView.of(attach))`. A script is "started" when a ctor-`0x51e19c` trigger has its slot; box portals are not.
* The block-start rule is the scheduler's: `FUN_00458c15` initialises the counter of every id with `0xff`, then counts the signalers; a block starts when its counter is 0 (so a block nobody signals never runs; this is why un-commenting a block without re-pointing the previous next id does nothing, and why rule P needs the `setNext`).
* The csi02a selection: `FUN_0057ab10` (`LE2.c`) reads var 0xc2 (`SWITCH_GME_BKD_GOTPAGE`).

### 9.5 Could not check

* The patched scenes were **not run** in the port's cutscene runner (compile, parse and block-graph checks only); camera / animation looks (R-A3, R-A8, R-A10, R-A5's camera) need one look each. The B items depend on one listen (speaker of `CACSAR02`, `CACSCS08`; the subtitles of `ADCSAM05/06` come from the whisper-small transcripts of `unused.md` 7.7, no larger model on this machine).
* Speaker inference by pitch (`CACSCS08` ~134 Hz) is weak (an autocorrelation tracker with octave errors; the other lines of the same speakers range 132-258 Hz).
* R-A11: the attach arguments of a cloned `SGMFIG` (animation set, turn target, MOVE_ var) were not diffed against the original's other attaches; the stage routines that hide the three records (`FUN_005b2fa0`, `FUN_005b5a20`, `FUN_00573527`) were not read beyond the store addresses.
* Mini-game speech lines: `scan-literals.mjs` shows names with no code reference (`CASGRB15`, `ADSGMM01/03/04/05/15-17`, `ADSGWS05`, `ADSGFI05/06`, `ADSGSS08/09/11`, `ADSGBI08/11/14`, `OGSGMP06-08`, `OGSGAB05/08-12`, `OGSGPO10`, `OGSGBP07-25`), but those zones look lines up by `.str` tag or computed ids, so only `OGSGBP07-25` (no result path, no actors) was followed up; the rest is a lead list for the zone docs' "never played" sections.
* The front end (`FRONTEND`, `PAUSE`, `CREDITS`, `BROWSER` strings) was not traced through its index tables; z03PPH, z50LTC, z41MAP have no cutscene content. The PlayStation / GBA versions beyond the archive scripts were not consulted.
