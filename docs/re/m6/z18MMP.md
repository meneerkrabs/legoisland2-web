# z18MMP (mummy tomb: memory match, key, page, boulder)

Status: playable end to end (intro ADSGMM18, help of 5 lines, play, pause 18, win / loss banner, result menus 16 / 19, retry / abort / continue to the story).
Entered at story node 39 (sub-game 15), Continue goes to z16PYA (node 40).

## Files
* `src/zones/z18MMP.ts`: zone game (`registerZoneGame`), constructor registrations, sound adapter, HUD gauge, `game.mmp = {shared, run, nodes}`.
* `src/zones/z18mmp/`: `consts.ts` (addresses, record indices, vars, bits, clips, sounds, constants), `shared.ts` (clock, danger, track states), `pepper.ts` (FUN_006a4fd0),
  `coffin.ts` (FUN_006aadf6 + the 12 mummy tracks), `props.ts` (camera, mummy, key, page, rock, pillar, debris, torch, spider, rat), `setup.ts` (FUN_006a30c0 set-up, shuffle), `run.ts` (score, banner, result).
* Tests: `tools/tests/m6-z18MMP.mjs` (1913 checks), `tools/tests/m6-z18MMP-emu.mjs` (differential, ~2.3 M checks), helpers `tools/lib/m6-z18MMP-bot.mjs`, `tools/lib/m6-z18MMP-emu.mjs`.
* Browser: `tools/steps/m6-z18MMP.mjs` (win; `MMP_LOSS=1` loss: pause, time-out, banner, menu 19, retry).

## Ported functions
Loop FUN_006a26a8 (mode 2: danger decay 0.2 / tick, clock +1 s per 30 ticks, game-over check FUN_006a21b0, countdown beeps), score FUN_006a2290, clock text FUN_006a4f60, init FUN_006a30c0,
Pepper / puzzle FUN_006a4fd0 (12 states: free, to coffin, knock, back off, hit, to pedestal, take page, turn back, squashed, restart, chase, bump), coffin / symbol FUN_006aadf6,
camera 6ac844, mummy 6aa600, key 6aa070, page 6a9cc0, rock 6a9930, pillar 6a95d5, spider 6a88db, torch 6a8cf0, Walk 0x6a81f6, rat, debris.

## Constants and findings
* 300 s limit; danger >= 145 or var 0xfc & 0x4000 ends the run. Score = 10000 - ftol((sec - 60) * 33.3), clamped; under 60 s the unsigned fild gives 0; 0 when lost. Medals > 8000 gold, > 6000 silver, else bronze. HISCORE var 0x14 / TROPHY 0x48 only written when the score beats the hi-score.
* Distances in the node tests are squared in the original (key pickup 1.44 <= 1.6). The arrival test in Pepper's approach states is the dot of the NORMALISED direction with the normalised forward (found by the differential test).
* Uninitialised locals: the debug heap fill 0xcccccccc (-107374176 as float) is used for the speed and for the direction in HIT and RESTART states; ported as `HEAP_FILL`. Float32 stores (`Math.fround`) matter at borderline sweeps.
* The door record keeps its unclamped y (slightly above 14). Torches share one sound handle. Pillar-fall timing makes the chase sensitive: a squash restarts the chase (as in the original).
* Vars: 0xfb pending coffin, 0xfc coffins in reach (0x4000 win), 0xfd matched, 0xfe open, 0xff ready.

## Tests
`m6-z18MMP`: tables / vtables / immediates against the EXE, score / game-over / clock text against the original run in the x86 interpreter, memory game (right / wrong pair, three coffins), key and door, page, chase, pillars, boulder, squash, gate, time-up, full bot games (smart 40/40 seeds won, careless 39/40, idle = 9001 ticks).
`m6-z18MMP-emu`: the original node update functions run in the emulator next to the port, tick by tick (whole careless and smart games, random-key fuzz, contact, chase, squash, page walk, key): 0 differences.

## Approximations / missing
No particle system exists in the engine: torch flames, symbol twinkles, mummy smoke and pillar dust are not drawn. FUN_004446c0 (specular flags) not ported. The rat ground probe is applied inside the update. The mummy draw `FUN_004388ae(tick) % 3` and the once-per-tick torch sound are simplified. Loaded sounds 0x137 / 0x139 are never played by the original code reachable here. Music segments (Z18MMP / Z18MMPPre / Hotep / Z28HAT) start with the zone.
