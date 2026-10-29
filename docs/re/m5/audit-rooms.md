# M5 audit: the three rooms z03PPH, z04IFC, z50LTC

Scope: Pepper's house (z03PPH), the Information Centre (z04IFC), the developers' cave (z50LTC) of M3 against the decompile (LE2.c / asm in `decomp-le2`), their story hand-over, and the
open items of docs/re/m3/z03PPH.md, z04IFC.md, z50LTC.md. Method: reading every node function against the port, an **oracle test** for z04IFC (the original's code run in the x86
interpreter next to the port, like the M6 mini-games), a scan of every x87 `qword` constant the three zones' code uses, call-graph / data-reference checks for dead code, headless bots with
real key input (looked at the screenshots).

## Summary

| zone | verified | fixed | not exact |
|---|---|---|---|
| z04IFC | controller / camera / pins / door / sound ids / pin ids by oracle (1.5 M comparisons) | **camera turn constant (float read of a double)**, pin state before the first pre-render, update pass in the fade-in, pre-render pass behind the exit question, faces (already fixed by M4 WP10; doc was stale) | input-before-update order, F8 demo toggle, music start, 3D sounds |
| z03PPH | loop, `FUN_0053fed3`, hotspots, door, browser, map, constants, dead ladder code | pre-render pass in the pause menu | draw-hook order of the computer menu, music start, 3D sounds |
| z50LTC | people update / pre-render / pepswitc / portal / loop by reading; story hand-over | slope alignment of Pepper at the talk start, **cheat code SDREAMS (new, shared)** | particles, 3D sound, var 0x59 = 0x1b quirk |

## Shared-file edits (all additive)

* `src/shell/cheats.ts` (new file): the cheat-code detector `FUN_004375a8` (see z50LTC).
* `src/shell/shell.ts`: one import and one line after `sh.input.attach(window)`: `installCheats(sh.pe, () => sh.vars.set(VAR_SDREAMS, 1));`. Nothing else in the shell changed.
* No other shared file touched (`playzone.ts` / `zonegame.ts` are used through the existing `everyTick` / `resultTick` hooks).

## z04IFC (Information Centre)

Files: `src/zones/z04IFC.ts`, `src/zones/z04IFC/ifc.ts` (edited), oracle `tools/lib/ifc-emu.mjs`, `tools/tests/m5-audit-z04IFC-emu.mjs`, bot `tools/steps/m5-z04IFC.mjs`.

### Oracle (verified)
`tools/lib/ifc-emu.mjs` runs natively from the user's executable: the controller update `FUN_0054bce3`, the camera / pre-render `FUN_0054c00d`, the pin constructor `FUN_0054bc04` and update
`FUN_0054b982`, the door update `FUN_0054caa1`, the sound loader `FUN_0054cd70` and the matrix builder; the engine (sounds, variables, animation, text, clock, random) is a host table that
records its calls. `m5-audit-z04IFC-emu` drives the original and `IfcRoom` with the same buttons and the same random numbers (a scripted walk through the room plus three 6000-tick random key
runs, with the host's part of the info menu / exit question simulated on both sides) and compares **every tick**: node state and counter, the four globals (`DAT_05d587c8 / cc / d0 / d4`),
the door node, the selected pin (var 0xfa), the camera eye and target, the matrices of Pepper and the door, every pin's y and bob angle, the caption text, the full list of sounds / clips /
variable writes (including the sporadic ambient sounds: 34 in the random runs). 1,510,883 comparisons, worst difference 9.5e-7. It also checks the 17 pin id strings (the strings
`FUN_0054ce86` copies into the pin nodes, `IFCCTRL` ... `IFCJAIL`) against the ids the port derives from the page table, and the 12 sound-slot ids `FUN_0054cd70` loads against `SND`.

### Fixed
1. **The turn towards the door was wrong.** `FUN_0054c00d` computes `target z = 0x892610 - cos(angle)` with `fsubr qword ptr [0x892610]`: the constant is the DOUBLE 7.2 (the decompile shows
   a float, -2.0, and the M3 port took -2). The original turns the camera 72 degrees about its eye (target (0.951, 6.89)); the port turned it about 6 degrees. The oracle found it at the
   first turn. `CAM.TURN_Z = 7.199999809265137`; `m3-z04IFC` updated (it asserted the wrong value). A scan of all x87 qword operands in the three zones' code (`/tmp` script, ranges
   0x54916a..0x568fe1, 0x53d7da..0x5498f5, 0x838c2f..0x858d30) lists only 0x892610 (IFC), 0x8925f8 = 30.0 and 0x8925f0 = 30000.0 (z03PPH's frame limiter / fps text): no other double
   constant is in these zones.
2. `DAT_05d587d0` (pins off) is a zeroed global until the first pre-render pass: the pins read it before; the port started it at 1 (the oracle: caption and key handling of tick 0).
3. **Passes outside mode 2** (`FUN_0054996a`): mode 7 (the 16 ticks of the fade-in) runs the UPDATE pass only (the ambient loops play, the pins bob, the figures' clips advance, no
   pre-render so the fly-in starts with mode 2); mode 5 (exit question) runs the PRE-RENDER pass only (the camera hold, Pepper's clock) and **before** the menu step of the same
   iteration. Implemented in `createIfcGame` with the existing `everyTick` / `resultTick` hooks. Bot: the pin's bob angle at the first mode-2 tick equals 16 + ticks steps.
4. Faces: the figures' faces (expression sheet, BrickMorph) are drawn since M4 WP10 (Faces.c set-up in the renderer, all zones): the doc's section 6 was stale. Screenshot
   `ifc-7-character` (Technician Bob with his face and headset); `m4-wp10-render` covers the face set-ups.

### Verified by reading (no oracle)
Loop `FUN_0054996a` (modes 7 / 0 / 2 / 5 / 6 / 8, music call in mode 0, exit block, `FUN_00404d14(&next, state == 2, 1)`, the pause fall-through to exit state 4), `FUN_00549911` (pause
trigger skipped while the menu is open), the menu step `FUN_0054b7f2` / `FUN_0054c398` (random info sound `% 3`), set-up `FUN_0054ce86` clips (Pepper 0x3a, figures 0x73), the pin neighbour test
(`memcmp(record -+ 0x68, "PONT", 4)`: only PONT records are neighbours), story hand-over: the loop never calls the story check `FUN_00423bad` (the port skips `story.frame()` for rooms);
OK at the exit question = exit state 2 -> `FUN_00404d14(.., 1, 1)`: when var 5 equals the story's zone (node 70) var 0x53 = 1 and the story advances to node 71 (z50LTC), otherwise
the player returns to var 0xa3 (the island). Bot `m5-z04IFC` plays the story part (`?zone=z04IFC` = node 70): far view, turn (target checked), question, Annuleren, again, OK ->
z50LTC node 71.

### Not exact
* Input before update: the original reads the input and handles Esc **before** the update pass of the iteration; the shared runner ticks first (matters only for Esc plus a map key in
  the same 33 ms).
* `FUN_00423f7b` (the demo toggle, key F8 = `DAT_009da634`) and the other debug keys of `FUN_004376f9` are read only when `DAT_009dab70 == 0` (windowed mode: the flag is `DAT_00984114`, set when
  the full-screen exclusive device starts); not ported (debug aids; the same code exists in every zone loop).
* Music: the original starts the `menu` segment in mode 0 (after the fade-in); the port starts it at zone entry (audio-timing package). `FUN_00435a07("silence", ..)` is a stub.
* 3D sounds are 2D in the port (shared audio limitation).
* The info menu pages themselves (`FUN_0041fd45` engine, character page) are the shared menu engine; checked by the M3 tests and screenshots, not by an oracle.

## z03PPH (Pepper's house)

Files: `src/zones/z03PPH.ts` (edited), bot `tools/steps/m5-z03PPH.mjs`.

### Verified (reading against the decompile, constants read from the executable)
* Loop `FUN_0053dfda`: update pass in modes 2 / 6, pre-render + collision pass in 2 / 3 / 6, fade, exit block (`var 0xb == 0` -> `FUN_00404d14(&next, state == 2, 1)`; the pause "Stoppen"
  sets state 0 / next -1 and does not fall through here, unlike z04IFC), `FUN_0053df81` (pause trigger skipped while the computer menu runs), `FUN_0053fed3(1)` (var 0x4d bit 7 opens the
  computer, else the previous zone is parked in the top byte: bot reads 0x4d = 0x02000000 after coming from the island), the unused fps text (`"%d (%d)"` is formatted and never drawn)
  and the 30 Hz frame limiter (the port's fixed step).
* PeppHse `FUN_0054042d` / `FUN_005402ac` / `FUN_005401e0` / `FUN_00540733` (easing 0.1, hotspot boxes, heading tolerance 0.78, z > 15 leaves), door `FUN_00540b96` (5 degrees per tick, 90,
  position (-3.763, 0, 14.598)), trophy browser `FUN_005414b0` / `FUN_005419dc` (any button but Left / Right leaves, Alt and Space too, ease 0.2, snap 0.1, the HUD lines, the three sounds),
  map `FUN_00541c98` / `FUN_00541e71` and constructor `FUN_00541f94` (target (-15, 7, 6), eye +2.8), the constants 0x892600 .. 0x892608 / 0x892198 / 0x89206c read from the executable.
* **ClimLadr is dead except its always-on stub**: `0x5421af` (attached, update returns 3, draw clamps y) and the vtable `0x8eb7b8`; the second vtable `0x8eb7d0` (update `0x542259`: the
  ladder climb, 30 ticks of 0.4) belongs to the node of constructor `0x542454`, which has no call and no data reference anywhere in the executable (`/tmp` scan of every dword of every
  section), so the ladder is never built. The house cutscene manager (`FUN_0053faf7`) declares no slots.
* Story: the house is a room (no `FUN_00423bad`); entered from the pause menu / the island door, left through the door / z > 15 / "Afbreken" back to the zone it came from.

### Fixed
* The pre-render pass of mode 3 (pause menu) is run (`everyTick`): behind the pause menu the camera hook of the nodes that ran last runs each tick (no visible change: Pepper's clip
  advances in the update pass). Bot `m5-z03PPH` checks `world.frame` counts the passes during the pause and that nothing else moves.

### Not exact
* The original steps the computer menu in the draw pass; the port runs it right after the world tick of the same frame (same frame, no visible difference).
* Music starts at zone entry (audio-timing package); trophy jingles are 2D.

## z50LTC (developers' cave)

Files: `src/zones/z50LTC.ts`, `src/zones/z50LTC/people.ts` (edited), `src/shell/cheats.ts` + `shell.ts` (shared, new), tests `tools/tests/m5-audit-z50LTC.mjs`, `m5-audit-cheats.mjs`, bot
`tools/steps/m5-z50LTC-sdreams.mjs`.

### Fixed
1. **Slope alignment at the talk start**: `FUN_0083a292` calls `FUN_00429e00(Pepper)` right after turning him to the person (0x83a44a); `FUN_00429e00` is the walk node's `alignToGround`
   (already ported in `src/game/walk.ts`); `LtcGlobals.alignPepper` is wired to Pepper's walk node in `createLtcGame`. Test `m5-audit-z50LTC`: the matrix after the talk start equals turn +
   `alignToGround` (tilt 0.3 in the cave's slope).
2. **The cheat code SDREAMS**. The input poll calls `FUN_004375a8` every frame: a detector of typed key sequences over a table of the executable (6 rows of 16 DIK codes at 0x8aed70, armed
   flags 0x8aeef0). Row 4 = `SDREAMS`, `FUN_00437515` case 4 sets var 0xd = 1; in story era 4 (node >= 61) the island's director scales the wormhole WORM in (var 0xd: 1 -> 2 -> 5) and its
   portal (gate var 0xd & 1, target zone 34) leads to the room. `src/shell/cheats.ts` reads the rows from the executable, keeps the original's exact state machine (lowest key down, one
   step per change, a mismatch un-arms a row, rows 4 / 5 start un-armed so the first key of the first-ever word is lost, `R` and a final `S` of the word start rows 2 / 4 again: typing
   the word twice in a row does not work, a stray key in between does). The other rows are consumed but not acted on: 0 `PEPPERONI` (`DAT_008a933c = 6`) and 1 `FSMADVANCE` (story node + 1) are
   scanned only in windowed mode (debug), 2 `RHUNRHEGED` is an assert box, 3 `BAATAT` switches the credits timing table, 5 `DAFFODILE` has no case. Test `m5-audit-cheats` (rows decoded
   to words, the quirks), bot `m5-z50LTC-sdreams` (real keys on the island at node 61: var 0xd 0 -> 5, wormhole visible, walking into it lands in the cave).
3. PortalNode `table` variant: the island's copy (`src/island/trigger/startcsm.ts`, WP4) implements it; the room's own `PortalNode` never uses `table` (the room's block has 0): doc correction,
   no code change.

### Verified by reading
People update `FUN_00839e20` and pre-render `FUN_0083a292` (every branch, the constants 4.3264 / 32 / 1.28 / -80 / +-pi read from the executable), pepswitc (update / pre-render / draw), the box
portal, the loop `FUN_00838e41` (modes, pause mapping: Stoppen and Afbreken both end with result 0 -> next -1, restart returns 3; the wrapper returns -1 for result 0), set-up. No qword
constants in the zone code.
* Finding: the loop sets `var 0x59 = var 5 = 0x1b (27)` (a copy of the Ogel hub's template), the port keeps 34 (the zone index). Readers of var 0x59 in the room are the walk code
  (values 0x11, 3, 9, 6, 10, 0x16 only) and the story check, which the room's loop never calls (the port's `story.frame()` can only match at node 71, which never completes): no difference.
* Story: node 71 is `NS_OFF == 1` (never complete); the room is entered by the wormhole (var 5 = 34) or by the story from node 70; the portal writes var 5 = 2 and the loop leaves to the island.

### Not exact
* Particles: `TWINKLE01.par` at every appearance, `paul01` on Paul Scully's hands (particle renderer package; the hooks `onTwinkle` / `onPaul` exist).
* The person's sound is played at Pepper's position in 3D by the original (`FUN_004433f0`); the port plays it 2D (shared audio).
* No oracle for the people / pepswitc code (verified by reading and the 76 M3 checks): a second reading found no difference, but an emulated run was not made.
* The loop's mode 4 / 5 (end banner / result menu) is unreachable in the room (`DAT_05d5f65c` is never set); not modelled.

## Tests and bots

* `node tools/test-formats.mjs --only m5-audit-z04IFC-emu,m5-audit-cheats,m5-audit-z50LTC,m3-z04IFC,m3-z03PPH,m3-z50LTC`: 1,510,883 + 8 + 5 + 534 + 174 + 76 checks, 0 failures.
* Bots (headless, muted, own snapshot server on 5512, `sh tools/m5-botslot.sh node tools/browse.mjs ...`): `m5-z04IFC` (node 70, fade-in pass, turn, exit question, story -> z50LTC),
  `m5-z03PPH` (island -> house through the pause menu, var 0x4d, pause passes, door -> island), `m5-z50LTC-sdreams` (typed cheat, wormhole, cave); the M3 bots `m3-z04IFC`, `m3-z03PPH`,
  `m3-z50LTC` re-run green. Screenshots looked at: `/tmp/m5-rooms-ifc/ifc-7-character.png`, `ifc-9-exit-question.png`, `/tmp/m5-ifc/ifc-exit-question.png`,
  `/tmp/m5-ltc-sdreams/sdreams-near-worm.png`, `sdreams-in-cave.png`, `/tmp/m5-pph/house-paused.png`.

## Follow-up: oracles for z50LTC and z03PPH, and the Esc-before-update difference

### z50LTC oracle (`tools/lib/ltc-emu.mjs`, `tools/tests/m5-audit-z50LTC-emu.mjs`)
Native: People update `FUN_00839e20`, pre-render `FUN_0083a292`, pepswitc `FUN_0083ab7b / 0083a9e0 / 0083aa48 / 0083aa8d`, the sound loader `FUN_00839560`, the box portal constructor
`FUN_0051ea3c` and update `FUN_0051e5ab`. Host: variables, the port's `AnimInstance` for all animation calls, emitters, letterbox, sounds, `FUN_00429e00` (logged). Same scripted keys / places
for both: two rounds over all 26 people (talk walked up to 3 or 1.0 units away = push back, Shift again to cut a talk short, walking away, the two halves of the team after the switchers),
Shift while people still appear, Shift out of range; and a portal run (walk in, stay, out, in again, other floor). Compared every tick: update return codes, record flags and 16-float matrices
of Pepper and all people, talk loops / pushed / twinkle / reaction / saved place, clips and frames, toggle, timer, candidate, candidate distance, HUD name / job, bars, var 0x5e, the ordered
list of emitter / sound / alignment calls; portal: var 5, previous distance, age, spin / face-camera matrix. 1,794,837 checks, worst difference 2.4e-7, **0 failures: no difference found**
(42 + 2 talks, 102 appearances / vanishings, 13 portal firings). The SGwalk reset of the candidate distance (576) is reproduced by the harness on both sides, the walk node itself is not run.

### z03PPH oracle (`tools/lib/pph-emu.mjs`, `tools/tests/m5-audit-z03PPH-emu.mjs`)
Native: PeppHse constructor / update / camera (`0x5408c4`, `0x54042d` with `0x5401e0`, `0x5402ac`, `0x540733`), door (`0x540db1`, `0x540b96`), all 23 trophy constructors, the browser
(`0x541b79`, `0x5414b0`, `0x5419dc`), the map (`0x541f94`, `0x541c98`, `0x541e71`), PeppComp's place and camera (`0x53ff69`, `0x53ffa1`), the sound loader `0x53e7c0`, sprintf / strcmp of the CRT.
Three random runs of 5000 ticks (random keys incl. Shift / Left / Right / Esc / Alt / Space, Pepper placed on every hotspot, both floors, in front of / away from the door, z > 15, trophy
browsing with long dwell), modes 1 / 2 / 4 / 0x20 all reached; compared every tick: var 0x5e, leave / door / icon globals, floor index and eased camera, camera eye and target, door state /
angle / matrix, Pepper's place, browser record / focus / state / arrival flag, map focus / state, the three HUD text lines, the trophy sounds. 735,003 checks, worst 4e-6.
* **Difference found and fixed**: `FUN_005414b0` fetches the trophy node of the current record at its start (`local_10 = **(rec + 0x5c)`); a Left / Right in the same tick changes the record,
  but the hi-score line, the value test and the sound of that tick still use the OLD record's node (visible when the camera arrives in the tick of the step: two trophies stand on the same
  spot). `TrophyBrowserNode.update` now captures the node first.
* Not covered by the oracle: the computer MENU (`FUN_0053fbc0`, the shared UI engine with the replay / sound-test / movie pages: covered by the M3 tests and the bot) - the host leaves the
  computer by writing var 0x5e as the menu does; the trophy draw hooks `FUN_00541034 / 0054128c` (draw pass: tier 1 / 2 / 3 -> model part 2 / 1 / 0, nothing for 0 or var -1: read, equals
  `FORCE_PART`; a value above 3 would draw an uninitialised part in the original: not modelled); SGwalk (shared walk code).

### Esc / input before the update pass (all three rooms)
Original: the loop top reads the input (`FUN_00549911` / `FUN_0053df81` / `FUN_00838dd5` -> `FUN_00423170`); Esc switches to mode 3 *there*, so that iteration runs no update pass (z04IFC and
z50LTC: no pre-render either; z03PPH: pre-render yes, mode 3 is in its list). The shared runner ticks the world first, so the Esc tick used to run one extra update.
**Made exact without touching the runner**, with the zones' existing `beforeTick` hook (called before `world.tick` in mode 2):
z04IFC: `escTick` flag makes the four nodes return "did not run" (no update, and therefore no pre-render) and judges the pause-blocked state at the top of the tick;
z03PPH: `world.frozen` for that tick (update pass skipped, pre-render runs) unless the computer menu / a movie is up (pause key not sampled); z50LTC: frozen plus the `ran` lists emptied.
Bot `m5-z04IFC` now checks it: after Esc the pin has taken exactly one step fewer than the world ticks (`tick + 16 - 1`), 16 of them from the fade-in. Remaining difference of this kind: none
(Esc together with another key never reached the update before: the input mapper reports only Esc in that tick).
