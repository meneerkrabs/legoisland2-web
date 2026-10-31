# M4 WP17: era 3 / era 4 of the island (story nodes 52..71, zone ids 33 and 2)

Bot `tools/steps/m4-era3.mjs` (real key input; long walks are teleports), node test `m4-wp17-era3` (31 checks).

    sh tools/m4-snapshot-server.sh 5489
    node tools/browse.mjs "http://localhost:5489/?zone=z02LGI&node=52&mute=1&hold=1" tools/steps/m4-era3.mjs --size 1280x800 --out /tmp/wp17   (52 .. 67, ~22 min)
    FROM=radio (node=55) / tower (node=58) / cnt (zone=z36CNT&node=59) / era4 (node=61) / asb (zone=z39ASB&node=62, also z40OGL&node=66 ...) start later;
    FROM=end (node=68): the end of the game; FROM=abort (zone=z36CNT&node=59): Afbreken in z36CNT and z38PAR; STOP=<phase> ends early.

Runs seen passing (2026-10-29, screenshots looked at): 52 -> 67 in one run (intro, pages, Space Port, radio, heads, police, tower, z36CNT, z38PAR, era 4
arrival, LGI13 countdown, z39ASB, z40aPO, z40OGL, z41MAP); z40OGL 66 -> z42BRP (then a stub) -> outro movie -> node 68 (no credits, corrected by WP-VERIFY); FROM=end; FROM=abort.
z42BRP became a real zone (M6) during this WP: the bot stops at node 67 there (its in-page bot is too slow headless; `BRP=1` tries it,
`tools/steps/m6-z42BRP.mjs` plays it to the outro, the credits and node 68). z38PAR: the pilot sometimes loses the first flight after z36CNT in the same
page (score 0) and wins the retry; the bot retries from the result menu and flies at 640x480.

## 1. What completes each node

StartCSM blocks of era 3 (set-up FUN_004bfd7d, the same at nodes 52..58; gate var 0x58 = node; waypoints are PATH node numbers):

| record | gate | waypoints (PATH) | effect | slot |
|---|---|---|---|---|
| HSE2 | 0x54 & 4 == 0 | none (fires at once) | 0x54 = 4 | 0 LGIBR08 (era intro) |
| PIZB | node 0x35 | none | S277 = 4 | 5 LGI09 |
| RADI | node 0x37 | 0xdd (S1DJPAT1), 0x45, 0xde, 0xdf, 0xdc r 2 walk-to | S277 = 0xc | 6 LGI10 (DJAB) |
| POLB | node 0x39 | 0x4c, 0x1a3, 0x4b, 0x49, 0x4a r 2 walk-to | S277 = 7 | 8 LGI12 (Infomaniac) |
| TOWE | node 0x3a | 215 (INSIDESPACE, inside the tower) r 2, icon 0x20 | S284 = 1 | none |

Era 4 (nodes >= 61, era-0 code FUN_004c0ca9): TOWE gate node 0x3d, PATH 216, S284 = 2, slot 0 = LGI13 (the only cutscene slot of era 4: the shuttle
launch); the era-0 PHSE (node 4) / PIZB (nodes 2, 5) blocks are attached but their gates never open again.

| node | handler FUN_004b7040 (story.ts) | completed by (bot) | status |
|---|---|---|---|
| 52 `PC == 1` | lifsm/lihol of band 0x34, pages objective | on foot at once with the URL shortcut (SKTP arrival); from z13CAI Pepper lands the helicopter / Ptera (WP16) | ok |
| 53 `S277 == 4` | pages objective | PIZB fires at once: LGI09 (runs after LGIBR08, 350 commands, ~40 Shift taps) | ok |
| 54 `PAGES_SET == 15` | 0x36 band: PIZC shown, MAMA / PAPA / DJAB hidden, Pizza nodes of MAMA / PAPA reset, the ten walkers re-pinned when entered from 53 | PAG1..4 (pickup, LGIBR09..12) | ok |
| 55 `S277 == 12` | hologram alert, objective RADI, DJAB hidden (LGI10 shows him) | walk to RADI's waypoints: LGI10 | ok |
| 56 `COLORED_BOTHEADS == 15` | objective -1 (nearest talk NPC), record 68 GETO shown (0x37..0x3a) | the ghetto blaster: dance the four coloured bots out, walk into them | **was broken, fixed** (BOTMUSIC) |
| 57 `S277 == 7` | objective POLB | walk to POLB's waypoints: LGI12 (fires at once when the last bot was collected next to the police station) | ok |
| 58 `S284 == 1` | objective TOWE, record 31 TBOB hidden | walk into the tower (PATH 215): no cutscene, the FSM leaves for z36CNT | ok |
| 59 z36CNT | | m3 perfect player, Continue | ok (win -> z38PAR node 60) |
| 60 z38PAR | | tools/lib/par-bot.mjs, Continue | ok (win -> island node 61) |
| 61 `S284 == 2` | 0x3d band: objective TOWE; HUD has no counters from node 0x3d | arrival from z38PAR on PATH 0x18e (SPBT gives the yaw); walk to PATH 216: LGI13 (countdown, shuttle) | ok |
| 62 z39ASB | | test aid F9 | ok |
| 63 z40aPO | | tools/lib/apo-bot.mjs | ok |
| 64 / 66 z40OGL | stub | F9 | ok |
| 65 z41MAP | | tools/lib/z41map-bot.mjs (~2 min) | ok |
| 67 z42BRP | stub (ported by M6 meanwhile) | stub: F9 -> banner -> result menu -> **outro movie** (skipped with Space) -> island node 68 (credits removed, WP-VERIFY); ported: see above | ok |
| 68 `NS_OFF == 1` | band < 0x45: objective PATH 0x1a5 then -1 (the second call wins: nearest talk NPC), texts lifsm15, no hologram texts, record 68 hidden | never completes: free roam, era 4 roster (the era-0 talk NPCs with reward var 0xb0 / op 3), HUD = only the score; arrival at the skate park (PREV_SUBGAME = z42BRP: default case) | ok |

Mini-game aborts (`FROM=abort`): Afbreken in the pause menu (page 18) of z36CNT / z38PAR rewinds the story to node 58 (FUN_00404b43) and the island puts
Pepper on PATH 0xff for both (FUN_004c2d22 cases 0x18 / 0x19: node < 0x3b -> 0xff, else 0xd7 / 0x18e; CTRL / SPBT only give the yaw). The TOWE trigger then
fires again (fresh node state after the zone load).

## 2. Findings / fixes

* **Fixed: BOTMUSIC returned 1 on every path** (`src/island/ambient/misc.ts`, FUN_00536a44). In the executable `xor eax, eax` at 0x536a8f (radio off) and
  0x536b1a (not dancing), `mov eax, 1` at 0x536d4f only while the bot dances. Consequences of the old value: in era 3 every BrickBot's chain stopped at
  BOTMUSIC (position 2, before BotFollow / MeetPepp / BotHarass / Human1), so the bots never walked; and the node's stamp (+8) was renewed every frame, so the
  "first dancing frame" reset (`DAT_009da5cc != stamp` -> timer 0) never happened while the timer ran down by 5 per tick whenever Pepper was away (-600 after
  a few seconds). The dance therefore never reached 600 ticks (danced out: var |= 0x1000000 -> BotHit falls over, Pepper can walk into it): **node 56 could
  not be completed**. How node 56 is played (original): Pepper carries the ghetto blaster GETO (nodes 0x38..0x3c, var 0x22 = 1); a bot within 24 dances,
  one within 12 for 600 ticks (20 s) is danced out; pizzas do not hit in era 3 (FUN_00429556). Bots that follow a leader keep 0x20000 from BotFollow's
  pre-render, which blocks the era-3 wave gag for them (as in the original); `m4-wp11-brickbot`'s wave check now tries the bots until a free one waves.
  Not ported in BOTMUSIC: `FUN_00427000(ctrl)` (ground probe flag) on the dancing path.
* **The shuttle vanishes after the 4th page until the island is reloaded** (faithful): LGIBR12 hides TOWE / PLAT / CTRL / SHTL and sets the four
  `SWITCH_LGI_BRICKFX_SPACE*` switches, but the era-3 brick set FUN_004bf737 registers no SPACESHUTTLE effect (nor the vehicle roster), so SHTL stays hidden;
  the set-up shows it from node 54 on, so after z36CNT / an abort / a load it is back. At node 52 the Space Port is not there yet and TBOB stands on the
  empty mountain top: that is the era-3 set-up (WP10's observation is right).
* **Slot 7 LGI11** (NICK talks to Pepper) is declared by the era-3 set-up but nothing starts it: no StartCSM block, no SGMFIG slot (+0x20 = -1 for every
  era-3 talk NPC), not the page table; the island's only callers of FUN_0045c40c are StartCSM, the page node and SGMFIG. Unused in the shipped game.
* The URL shortcut `?node=55..58` starts with NUM_PAGES = 0 etc. (FUN_00404c07 forces only the node's own var): the HUD shows 0/4 pages and the heads; not a game bug.
* At node 68 10 attaches are skipped (unregistered constructors: Human1.c XXX0..2 0x4bf329, SPLH 0x88d1f6, sea / sky nodes ...; see WP13's list).

## Status 2026-10-31 (WP-ISLAND-CLOSE: the statements of this document that are out of date)

* `FUN_00427000` on BOTMUSIC's dancing path is ported (`misc.ts`, controller near bit 0x10 at 0x536b25).
