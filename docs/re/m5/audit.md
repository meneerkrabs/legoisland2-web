# M5 audit of the zones ported before M5 (z05WAB, z17WAS, z36CNT, z38PAR, z39ASB, z40aPO, z41MAP, z50LTC, z03PPH, z04IFC, front end z00FRE / z60FRE)

Method (all zones): ctor survey from the emulated set-up (`extractZoneSetup`: every attach has a registered ctor except z38PAR's `seabed` 0x426da4 = the engine's own sea plane `render/environment.ts`
and z60FRE's four `Walk` stage ctors, which `frontend.ts` / `fenodes.ts` now cover), cutscene slots (only z40aPO declares one, `ogl02`; z03PPH's `FUN_0053faf7` declares the manager with no slot), the
zone loops against the port, and an ORACLE test per zone wherever the infrastructure reaches: the original's node code run in the x86 interpreter next to the port, same keys / random numbers,
compared tick by tick (every oracle found real differences at first; all pass now). The per-zone detail is in four docs:

| doc | zones |
|---|---|
| `audit-fe.md` | front end z00FRE (archive z60FRE): stage nodes, butterflies, credits, loop exit |
| `audit-rooms.md` | z03PPH, z04IFC, z50LTC |
| `audit-minigames-a.md` | z05WAB, z17WAS, z36CNT, z38PAR |
| `audit-minigames-b.md` | z39ASB, z40aPO, z41MAP |

## Per zone

| zone | oracle (checks) | fixed (found by oracle unless noted) | not exact / open |
|---|---|---|---|
| z60FRE | `m5-audit-fe-emu` 5.9 M, `m5-audit-fe-credits` 3.2 M | crossing duration `ftol(10 / (rand(0.045) + 0.045))`, gag bounce, clip 2, matrix turn; outfit swaps visible (`GameRenderer.setModel`); train, Brickster, butterflies, BBT1 frozen; credits stage characters; fade-in 17 ticks; exit block (17 passes) | particles (smoke), RNG, butterfly tint / specular, loading card, attract mode, gamepad stick |
| z03PPH | `m5-audit-z03PPH-emu` 735 k | trophy browser used the new record's trophy in the Left/Right tick (original: previous one); pre-render pass in the pause; Esc-before-update order | computer menu (shared UI) not in the oracle, draw hooks by reading, music start, 3D sound |
| z04IFC | `m5-audit-z04IFC-emu` 1.51 M | **door turn constant: a double 7.2 that the decompile shows as float -2.0 (door turned 6 instead of 72 degrees)**, `pinsOff` start, fade-in update pass, pre-render behind the exit question, Esc order; faces were already fixed by M4 (doc was stale) | F8 demo toggle (windowed debug only), music start, 3D sound, info menu / character page = shared menu code (M3 tests + screenshots) |
| z50LTC | `m5-audit-z50LTC-emu` 1.79 M | slope alignment at the talk start (`FUN_00429e00`), cheat code SDREAMS (`src/shell/cheats.ts`, shared) | particles (twinkle, Paul Scully), 3D sound, `var 0x59 = 0x1b` quirk of the loop (no reader differs) |
| z05WAB | `m5-audit-z05WAB-emu` 13.2 M | swing clip kept at game over, hit / miss sounds as real 3D, banner skips on any held key | particles, RNG, music replay at the banner |
| z17WAS | `m5-audit-z17WAS-emu` 13.7 M | **spawn pause 30 -> 24 / 19 / 15 shrinking with the clock (M3 had it reversed)**, HUD text lag, lid one frame behind the head, `DAT_00925e58` persists | torch particles, music timing, RNG, `GEMM` +0x62 flag (effect unknown) |
| z36CNT | `m5-audit-z36CNT-emu` 1.4 M | monitor next-range write, blur copies in preset 26 without z | draw order of the blur copies, arm shadow polygon by geometry, rumble, RNG |
| z38PAR | `m5-audit-z38PAR-emu` 1.2 M | **ring "missed" threshold is the double -8.0 (M3 compared with 0)**, crash tick, float32 stores, SeaAmin shore foam animates, banner skip | engine collision queries answered by port code in both (not independent), props by reading, flat blob shadow, particles, mode-0 skip path (`plane_flyoff`) |
| z39ASB | `m5-audit-z39ASB-emu` 6.9 M | pre-loop node update, exact spin constants, float32 camera, HUD tints / frame icon, thrust sound state | sound variants compared by class (tick-scaled randoms), HULL placement hook, particles, rumble |
| z40aPO | `m5-audit-z40aPO-emu` 12.5 M, `m5-audit-z40aPO-intro` 36 | wind pitch, group icon dimming, wing matrix tick, float32 pilot, box crossing hit point, shuttle doors, terrain-following shadow, banner runs the node update, Pepper's walker so `ogl02` ends cleanly; M3 "HUD icon absent" / "no wing collision" refuted (exact) | particles, hit_monster never reached in scripted games, blob shadow decision, music start, RNG |
| z41MAP | none for the nodes (rigs, emitters, draw hooks too deep): `m3-z41MAP` 166 EXE-constant / sequence checks | model-holder records PIZ1, TOP1..4, TOMA, MEAT, CHEE, GREE, TOPP are visible at the origin (flags 2, nothing hides them); "`.man` material animations" was a misreading (no such strings in the EXE) | node logic by reading; the pizzeria PIZZ renders as a mosaic from inside (verified: real geometry + flat colour textures, camera inside the building; culling rule suspected if the original differs) |

## Hand-over / story
Checked per zone (loop vs port): hi-score / trophy vars, `FUN_00404d14(&next, exit == 2, success)` exits, the var 5 vs var 0x59 test, banner / result menu paths, retry / abort, nodes 59 / 60 / 62 / 63 / 65 (mini-games),
69 / 70 / 71 (rooms: z04IFC OK completes node 70 -> z50LTC node 71, which never completes). Intro / help / banner leave on any pressed button (held for z05WAB / z38PAR / z40aPO): shared change, below.
No mini-game of this scope falls back to the stub runner or to the F9 / F10 aids any more (the aids of the ported zones are behind the debug option, `?debug=1`).

## Shared-file edits (all additive)
* `src/shell/playzone.ts`: intro / help / banner leave on any pressed button; `ZoneGame.skipBanner` (held buttons) honoured (C).
* `src/game/render.ts`: `GameRenderer.setModel` (outfit swaps, A), `GHOST_PRESET = 26` (C), `vertexOverride` / `liveVerts` (D, terrain-following shadow patch).
* `src/shell/cheats.ts` (new) + one import / line in `src/shell/shell.ts` (B). `src/shell/frontend.ts`, `fenodes.ts`, `credits.ts` rewritten for the front end (A: only the front end uses them).
* `src/zones/parachute/*` (par-pilot float32 and ring threshold, apo-*), `z05WAB`, `z17was`, `z36cnt`, `z39ASB`, `z41MAP`, `z50LTC`, `z03PPH`, `z04IFC` zone files.

## Tests and bots
Node: the 12 new `m5-audit-*` tests above (about 50 M comparisons), the M3 tests updated where the audit corrected them (`m3-z04IFC`, `m3-z17WAS`, `m3-z38PAR`, `m3-z05WAB`, `m3-z39ASB`, `m3-z41MAP`): all green.
Headless muted bots with real key input: `m5-fe`, `m5-fe-credits`, `m5-z03PPH`, `m5-z04IFC`, `m5-z50LTC-sdreams`, `m5-z05WAB`, `m5-z17WAS`, `m5-z39ASB` (with `?debug=1`), `m5-z41MAP` (win + loss), `m3-z38PAR`, `m3-z40aPO`, screenshots looked at.

## Pending packages (not done here on purpose)
Particle renderer (all `.par` emitters), music start moments (`FUN_004432c0` at the end of help / banner), the original RNG (`rand` / `GetTickCount` scaling; injectable everywhere), gamepad / rumble, 3D sound details, loading card.
