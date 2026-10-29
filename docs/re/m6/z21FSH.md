# z21FSH "Fishing" (Adventure Island, story nodes 42-44), M6 port

Archive `z21FSH`, zone table index 17, music `Z21FSH` (+ ambience `Fishing`, shark theme `Z21Jaws` during the fight), strings `AI/Data/fsh.str`, HUD `Overlays/Z21FSH`.
Pepper walks to one of eight fishing spots (Shift), aims (left / right), casts (Ctrl, power meter 10..60), waits for a bite, strikes (Up), reels (Down, tension 10..60) and lands fish
(weight x 78 points). Catching Big Bertha (19 kg) ends the game (win, medal by score: bronze < 4000, silver < 7000, gold); running out of the 20 casts loses.

## Files
| file | what |
|---|---|
| `src/zones/z21fsh/rules.ts` | constants (EXE addresses in comments), `Fish` + `fishStep` (FUN_007061ee), `pickBite` (FUN_00705e00), `Follower` (FUN_006f5b50), `Popups` (FUN_006f48c9 / 49b3) |
| `src/zones/z21fsh/nodes.ts` | the nodes: FSwitch 0x6f51e6/6f4bfa, Fishing 0x6f8e5a/6f6e2b (+ bobber 6f665b, camera 6f6d71), Bertha 0x6f56d0/6f54c0, Shoal 0x6f6034/6f5dac, Splash 0x6f5aa1, rod 0x6f9cdc/6f94d4, Fisherman 0x6f937d/6f9090; `prepareFsh` binds them after set-up |
| `src/zones/z21FSH.ts` | zone game: cutscenes ADV04 / ADV11, HUD, popups, score panel, sounds, music switch, fishing line, argument blocks of the fisherman's generic nodes |
| `tools/tests/m6-z21FSH.mjs` | node tests (199 checks) |
| `tools/steps/m6-z21FSH.mjs`, `-loss.mjs` | headless browser runs |

## Findings
* Result flow: play goes straight to the result menu (no mode-4 banner): `LoopConfig.skipBanner`. The score panel is the machine's state 13.
* The fishing cutscene start at node 42 sets S252 = 1 (completes node 42); the in-zone COMPLETE_SUB_GAME completes node 43, and Continue advances once more (generic `miniGameExit`), so the story lands at node 45 (oasis).
* The fisherman's route table (0x92f720) maps spots 6 / 7 to the way-points of POL6 / POL7 while the spot records are POL8 / POL9: an original quirk, ported as is.
* The last cast (casts == 0) forces the nearest fish to the bait in 50 steps; bites last 30 ticks (60 when forced).
* The symbolic set-up gives no argument block for the fisherman's SGMFIG / Turn2PepA: written in `fishermanArgs` from FUN_006f3eec.

## Approximations / open
* No particle runtime: the splash emitter is not drawn (the ripple ring SPLH is). The generic NPC conversation needs the island context (no speech lines for the fisherman).
* S252 == 2 (node 44) has no writer in the zone code; not needed for the story path above.
* Hint system (`fshhol.str`, HOLOA) not ported; unknown call FUN_0085eb80 in the rod hook skipped; camera variants for DAT_00987660 != 0 unused.
* No differential x86 test of FUN_006f6e2b yet.

## Shared-file edits
`src/zones/index.ts` (import), `src/shell/loopmachine.ts` (`skipBanner`), `src/render/renderer.ts` (`drawLine`).

## Runs
`node tools/test-formats.mjs --only m6-z21FSH`; `node tools/browse.mjs "http://localhost:5602/?zone=z21FSH&mute=1" tools/steps/m6-z21FSH.mjs --size 1024x768 --out /tmp/m6-z21FSH` (win, ~4 min);
`...?zone=z21FSH&node=43&mute=1 ... m6-z21FSH-loss.mjs` (pause, loss, retry, abort). Shortcuts: fish / Bertha moved to the bobber, casts set to 1 in the loss run.
