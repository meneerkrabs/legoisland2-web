# M4 WP15: the rest of era 1 (story nodes 11..14), the castle stubs, the return at node 30

Bot `tools/steps/m4-era1.mjs` (real key input, long rides are teleports), node test `m4-wp15-era1` (19 checks), fix `src/zones/z02LGI/savevehicle.ts`
(+ small hooks in `src/shell/zonegame.ts` / `shell.ts` / `playzone.ts` and the island's `registerZoneSetup` in `src/zones/z02LGI/index.ts`).

## Per node (what completes it, what the port does)

| node | complete when | set-up / story handler FUN_004b7040 | trigger | status |
|---|---|---|---|---|
| 11 | S277 == 0x100 | band 10..12: MOVE_INFO &= ~0x4000, objective RESQ (116), texts lifsm8 / lihol8 | INFC StartCSM (gate var 0x58 & 0x7fff == 0xb, no waypoint: fires at once) slot 5 = LGI06 (the mainframe, ~2200 ticks unskipped), op SET 0x115 = 0x100 | works; Pepper (INFO_HELP1) and INFO next to INFC afterwards, MOVE_INFO 0x500, walking |
| 12 | S277 == 0x200 | same band | RESQ StartCSM (gate node 0xc, 6 PATH waypoints 0xc9 0x57 0xa8 0x18e 0xc0 0xc4, radius 4 -> 32 units, walk-to) slot 6 = LGI07 -> 0x115 = 0x200 | works |
| 13 | PEPPER_CONTROL == 8 | band 13..29: objective pair (PORS, SPBT), texts lifsm8 / lihol8 (the same files as 10..12) | SGBoat SPBT (MOVE_BOAT 0x82) at dock PATH 0x19e, Ctrl within 24 | works (any vehicle completes it, as in the original: the condition is PC == 8) |
| 14 | S302 == 1 | same | PORS box portal (gate node 0xe, half extents 21, table row 0 = SPBT/JSKI/DNGY): S302 \|= 1, PORTAL_VEHICLE = 0, var 5 = 6 | works: z07CSI loads |
| 15..29 | z07CSI / BKD / JST / RGB | stubs (M5) | F9 completes the step, the mini-game stubs end with Enter -> Continue | works; node 15 (PC == 1) completes at once in the stub because the stub zone walks Pepper (castle arrival on the boat is M5) |
| 30 | (era 2) | arrival FUN_004c2d22 PREV_SUBGAME 6: SPBT 48.8 from PORS, PC 8 | | works: Pepper on the boat, era intro, drives, moors at dock 0x1b5 with Ctrl and walks |

NPCs at nodes 11..14 (node mock, Shift in front of every SGMFIG): every talking NPC answers with its `<NAME>A` line from lifsm8 (all texts present),
none at the origin. BrickBots BBT0..5 / BBY0 have no line (no SGMFIG talk), as expected.

## Found and fixed: loading a save made in a vehicle

The port's save writes Pepper's entity only (shell.ts `saveSlot`), the original's FUN_00419e82 restores every record's entity and node blobs.
Saving on the Res-Q boat (node 14), quitting and loading from the front end left Pepper **frozen at sea in mode 8**: PEPPER_CONTROL 8 and MOVE_BOAT 1
came back from the variables, `DAT_009daa80` (vehicles.current) was null, so the seat node had no vehicle, and the parked boat (its var 1 = "ridden")
**drove away on its own** with the player's keys. An in-place load left Pepper on the boat where it was (the boat carries her), not where she saved.
Fix (`savevehicle.ts`): the island's set-up hooks `saveEntities` (the current vehicle's entity: tag, position, angles, flags, written after PEPP; the
`.lgo` format already has room for any number of entities) and `restoreSave` (called by playzone's `restore` after Pepper's place): every vehicle whose var
says "ridden" is reset (boats / helicopters var 0, cars bit 0x10000000 cleared), then, in mode 8, the vehicle from the save's entity (else the one that
was ridden, put under Pepper's saved place) gets its place back, speed 0, `vehicles.current` = it, PEPPER_CONTROL 8: the same re-entry as the arrival
FUN_004c2d22. Mode 8 with no vehicle at all -> walking (PEPPER_CONTROL 1). Approximation: no node state is restored (the boat starts from rest).

## What a save / load restores (port)

The 304 game variables, node, zone, Pepper's place and camera, now Pepper's vehicle. Lost: every other record's place and the node state (NPC walkers and
conversation progress, Turn2Pep / MeetPepp state restart from the set-up for the loaded variables; carried props; brick effects; the boat's speed).
A load is refused while a cutscene runs (menu `cutsceneRunning`), as in the original. Loading from another node re-runs the emulated set-up with the jump's
vars and applies the save's vars after it, the original's order (FUN_0041adb5 after FUN_004b6475).

## MOVE_* words and the era reset

FUN_004c3226 (era 1 bit of AI_STATE_RESET 0xc1) zeroes MOVE_* (0x5a..0x80, 0xa4, 0xa8, 0x7d ...), NUM_PAGES, PAGES_SET, COLORED_BOTHEADS, PAGECOUNTER and sets
0xb3 = 100, PEPPER_CONTROL = 1; a real game does this once at node 7, so at node 11 (back from WAB) the words are whatever chapter 1 left. The dev entry
`?node=11` is the original's story jump FUN_00404c07 (forces the GME / MS vars of the nodes before 11: NUM_PAGES 4, COLORED_BOTHEADS 15) followed by the
same reset (the era bit was never set), so the HUD shows 0/4 pages and the coloured heads: the original's debug jump does the same; the bot sets 4 / 15 / 15
for the HUD. MOVE_INFO: 0 after the reset, 0x500 after LGI06 (INFO's own nodes; LGI06 has no SETSWITCH). Not compared against a full chapter-1 run (the
chapter-1 bot did not reach node 11 in my run on a loaded machine: 3 of 4 heads, unrelated to this WP).

## Other observations (not changed)

* NUM_PIZZAS (0xb0) is -2 at node 7 after the chapter-1 bot (11 house deliveries + NANC take 12 from 11, the jail op 0x40 another one); era 0, not shown in era 1.
* The castle stub completes node 15 at once (PC == 1 holds as soon as the stub walks Pepper): M5.
* Boats are fast (about 2.4 units / tick at full throttle): not compared with the original here.

## Status 2026-10-31 (WP-ISLAND-CLOSE: the statements of this document that are out of date)

* "No node state is restored" after a load is out of date: every vehicle node has `saveBlock` / `loadBlock` (boat, heli, car, Ptera, SUPE, train ...) and the load restores them (`m8-save-vehicles`, `m8-save-nodes`).
