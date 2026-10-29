# M4 WP16: era 2 of the island (story nodes 30..51, zone id 32)

Browser bot `tools/steps/m4-era2.mjs` (real key input; long walks / flights are teleports), node test `m4-wp16-era2` (16 checks).

    node tools/browse.mjs "http://localhost:5490/?zone=z02LGI&node=30&mute=1&hold=1" tools/steps/m4-era2.mjs --size 1280x800 --out /tmp/wp16
    FROM=castle node tools/browse.mjs "http://localhost:5490/?zone=z07CSI&node=29&mute=1&hold=1" tools/steps/m4-era2.mjs ...   (arrival by boat)
    FROM=stubs  node tools/browse.mjs "http://localhost:5490/?zone=z13CAI&node=33&mute=1&hold=1" tools/steps/m4-era2.mjs ...   (only 33..52)

## 1. What completes each node (as the bot plays it)

| node | set-up / handler (FUN_004b7040) | completed by |
|---|---|---|
| 29 -> 30 | castle hub (stub, F9: NEXT_SUBGAME = 32) | arrival FUN_004c2d22 with PREV_SUBGAME 6: on SPBT at PORS (control 8); Ctrl at a dock puts Pepper ashore |
| 30 `NUM_PAGES & 2` | texts lifsm10 / lihol5, objective PAG1..4 (mode 4); era set FUN_004c015e hides SKTP, GRGE, HOSP, POLB, PCAR, PHEL, JAIL, FECL; StartCSM on SKTP (gate 0x54 & 2 == 0, no waypoint) fires at once (also on the boat): LGIBR05 (the Brickster takes the skate park / garage apart), var 0x54 \|= 2 | PAG1 (FUN_00534d98, pickup) -> slot 1 LGIBR06 (hospital falls in: BRICKFX_HOSPITAL), PAG2 -> slot 2 LGIBR07 (police station: BRICKFX_SPACETOWER is POLB's slot in era 2; PCAR / PHEL / JAIL / FECL shown) |
| 31 `S277 == 2` | hologram alert, objective POLB, texts lifsm10 / lihol10 | StartCSM on POLB (gate node 0x1f, 5 PATH waypoints, r 2): slot 3 LGI08 "NICK_CHOPPER", then var 0x115 = 2 |
| 32 `S281 == 2` | objective pair (record 160 / PHEL), texts lifsm10 / lihol9 | Ctrl at PHEL (SGHeli), fly into PORA (box portal, gate node 0x20, table row 2 = PHEL only in era 2): S281 \|= 2, var 5 = 10 |
| 33..51 | stub zones (z13CAI, OSD, SSH, PYA, WAS (ported: the m3 Whack-A-Snake bot plays it), MMP, DSP, FSH, BIP, DIP, TRX, HAT) | F9 per zone |
| 51 -> 52 | z13CAI -> island era 3 (zone 33), PREV_SUBGAME 10 | arrival at 48.8 from PORA in PHEL (control 8); after the era-3 intro Ctrl near a free helipad lands, Pepper walks (node 52 `PC == 1` -> 53 -> 54) |

## 2. Findings

* Everything above works in the browser; no code change was needed in the story handler, triggers, vehicles or arrival for nodes 30..33 / 51..52.
* **LGIBR07 leaves the Brickster standing at the police station** (S1LPAT3) after the second page: its actors FECM / FECN do not exist, the loader stops there
  (debug heap, docs/re/m4/wp2-cutscenes.md 3) and the commands `BILL invisible` / `SWITCH_LGI_CSM_FX_SWITCH05 = 3` never run. Faithful to the original (not changed).
* **Hidden talking NPCs fall to sea level** (NICK at y 2.4 below the police plot while hidden in era 2): FUN_00425c13 returns 1 for a hidden record, so the
  pre-render FUN_00426014 runs; no probe was requested, FUN_00427233 writes result 0 and FUN_00424526 lets the record fall (clamped at DAT_009da858). Same in the
  original; harmless because every script that shows NICK positions him first (LGI08: S1LPAT2). Checked that the constructor's ground snap itself is
  right (NICK y 30.7 after `startIslandNpcs`; the set-up order - NICK's SGMFIG attached before FUN_005238e0 hides POLB - makes no difference: the plot is terrain).
* The page cutscenes' first frames look at the sky: the camera target eases from HOSP_REC01 / CSM_POLICE02 down to BILL / POLB (MOVETARGET); by ~1 s the shot
  is on the building. Not a bug.

## 3. Bot notes

* Pages sit on hill tops / cliff edges: Pepper is put 10 units away on ground level with the page (24 directions tried) and walks in until NUM_PAGES rises
  (holding the key longer walks her off the cliff into the sea).
* The buildings come back brick by brick (FX_Bricks era-2 set FUN_004bfec3): shown only after the drops + the wait (up to ~10 s).
* The helicopter is teleported 70 units west of PORA at the portal's height and flown in with Space (nose down); at node 52 it is put 30 above the nearest
  free helipad before Ctrl.
