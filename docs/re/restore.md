# Herstelde inhoud (restored content): what was built, how it is triggered, what is original and what is reconstructed

The optional mode "Herstelde inhoud" (start page, next to "Debugmenu"; URL `?restored=1`, individual features off with `?restoredoff=id,id`). **Default OFF: with it off the game is exactly the
original** (no hook set, `src/restore/index.ts` never requested; test `tools/tests/restore-core.mjs`). Plan and evidence: `restore-plan.md`; transcripts of the audio-only lines: `src/restore/lines.nl.ts`.

Code layout: `src/restore/flag.ts` (switch + hook table, the only statically imported file), `src/restore/index.ts` (composition), `src/restore/features/<id>.ts` (one file per feature, `Feature` record in
`src/restore/feature.ts`), `overlay.ts` (message overlays, orphan speech indices), `scripts.ts` (rule P: patched cutscene scripts), `lines.nl.ts` (subtitles typed from large-model transcripts).
"Original" = data or code of the game reused as it is; "Reconstruction" = invented by this project (marked `RECONSTRUCTION` in the code).

Each feature appends a section below (append only).

---------------------------------------------------------------------------------------------------------------------------

## Messages and voice: `tips`, `voicefix`, `voiceswap`, `holo`, `joke`

Shared helper (reconstruction, no game data): `src/restore/islandenv.ts` (the island zone game hands itself to `islandStart`; the `say` hooks read the story node / game variables through it; tests install a fake reader).
Hook additions outside `src/restore/`: `src/hub/ctx.ts` (`HubContext.say` calls `restoreHooks.say`, same two lines as `IslandContext.say`; the castle's NPC lines go through it). One additive line in `src/restore/lines.nl.ts`
(`LEBEAA07` in `DOUBTFUL_LINES`). Tests: `tools/tests/restore-tips.mjs`, `restore-voicefix.mjs`, `restore-holo.mjs`, `restore-joke.mjs` (node) and the bots `tools/steps/restore-tips.mjs`, `restore-holo.mjs`, `restore-joke.mjs` (headless, muted).

### tips (`src/restore/features/tips.ts`): Darren's tips and his replaced lines

* **What it does.** Darren (`DARR`) says one of a rotation of pairs: his regular pair of the band, the band's shipped tip, or one of 14 tips whose audio exists only as orphan files (`LEDTHT03-06, 11-16, 21-24, 27-42`; 31/32 "dark corners" is held back, no hook). The first line of a pair
  is spoken on the first talk (`DARRA`), the second on the next talk (`DARRC`), as in the original (his tables only have `DARRA` / `DARRC`, one clip each; the regular pairs of bands 14 / 15 use `A+B` / `C+D` for their extra clips).
* **How triggered.** Talk to Darren (Shift) at story nodes 10..68 (bands `lifsm8/10/12/13/14/15`; the earlier bands 1, 2, 4..7 have no orphans and stay as they are). `IslandContext.say` gets `DARRA` / `DARRC` and the hook speaks `DARR<pair>A..D` of the overlay
  (tags `DARRT03A/C` ... for tips, `DARRR8A..D` for the regular pair of a band). Rotation: per band a talk counter (advances with every talk that starts a pair: the second talk only happens when the NPC has an objective to point at), pool of a node =
  [regular pair, shipped tip, eligible tips in id order], `pool[counter % length]`; no `Math.random`; a busy speech channel retries with the same pair.
* **Original:** the six `lifsmN.str` tables and their shipped `DARRA/DARRC`; the orphan mp3 files and their speech-table slots; SGMFIG's conversation code; `IslandContext.say`; the story handler's node -> table selection (checked by the test against `storyHandler`).
* **Reconstruction:** that the regular pair of each band is the pair of orphan clips filling the numbering hole behind `RICH` (`LEFMAA21/BB21`, `LECCAA20/BB20`, `LERSAA21/BB23`, `LESBAA20/BB21`, `LESPAA22/BB22+23`, `LEGFAA24+25/BB24`); the subtitles (Whisper transcripts in `lines.nl.ts`; `LEDTHT16/37/38/41` are
  in `DOUBTFUL_LINES`); the tag names; the eligibility ranges (from the records the era set-ups enable, probed for nodes 8..68: SPBT from node 10; cars SPD0 / jet ski JSKI / DNGY from 30; PHEL / PCAR from 31; era 3 = node 52+: rails / Super station master, bots, party; "far-away countries" from 33; the
  rest from node 10) and the rotation rule. `ranges` are in the `TIPS` table of the file.
* **Tests.** Node: bands of nodes 10..68 equal the table the story handler selects; pool of every node 0..71 deterministic, non-empty from node 10, starts with the regular pair then the shipped tip; all 42 clips are orphans with a subtitle and exist as mp3 in the data;
  336 simulated talks (A then C) over bands 8..15 speak the right tags / speech indices (orphans >= 1732) and a full rotation uses every pair once; busy channel; other bands / ids pass through; the REAL SGMFIG code (an island NPC renamed `DARR`) says
  `DARRR13A DARRR13C DARRA DARRC DARRT03A DARRT03C` in six talks at node 56; feature off = the original tables / say. Headless (`tools/steps/restore-tips.mjs`, node 56): the same sequence in the real game, subtitles on screen ("Mooie stereo, pizzaman!" ...).

### voicefix (`features/voicefix.ts`) and voiceswap (`features/voiceswap.ts`)

* **voicefix.** `LIFSM5.str` `TBOBA:520` points at `LEBEBB07`, the clip of `TBOBC` (and repeats its text): overlay `TBOBA` -> orphan `LEBEAA07` ("Noodgeval! Niks te maken! Ik moet wat maken!"). Triggered by talking to TBOB at story node 7 (band 5). Original: the table, the orphan clip.
  Reconstruction: the subtitle (garbled transcript: flagged doubtful in `DOUBTFUL_LINES`) and the assignment of the clip to `TBOBA`.
* **voiceswap.** `LIFSM2.str` `NICKA:362` / `LICKA:363` reuse the band-1 clips `LEDPAA05/06`; the band's numbering has the holes `AA03/AA04`, filled by the orphans `LEPHAA03` / `LEPHAA04`: overlay `NICKA` -> `LEPHAA03`, `LICKA` -> `LEPHAA04` (node 4, band 2). A swap of recordings rather than a bug repair, so it has its own feature id.
  Reconstruction: the assignment (they fit policemen) and the subtitles (`LEPHAA03` is doubtful).
* **Tests** (`restore-voicefix.mjs`): each feature alone changes exactly its tags (voice index = orphan index, subtitle = `lines.nl.ts`), nothing else of the tables, the other feature's file is returned as it is; both off = the original tables; the mp3 files exist.

### holo (`features/holo.ts`): shadowed hologram hints

* **What it does.** `LIHOL9.str` has `HOLOA:681` ("pages back") and `HOLOA:682` ("bring the helicopter ...", + `HOLOB:683`); `LIHOL6.str` has `HOLOA:177` and `HOLOA:182`. The original's sort + binary search returns the later duplicate, so 681 / 177 never play (the test shows it).
  The hook speaks the shadowed entry (the table's own entry, voice and text as they are) when a small state test says so. `LIHOL16.str` stays unused (no band selects it).
* **How triggered.** Hold Shift (away from NPCs) to call the hologram (node 8: LIHOL6; nodes 32..51: LIHOL9); the hologram code asks `say(table, 'HOLOA')`.
* **Original:** both tables, the hologram node (`src/island/trigger/holo.ts`), the duplicate lines. **Reconstruction (the state tests):** LIHOL9: 681 while NUM_PAGES (var 0xa5) >= 2 and Pepper is on foot (PEPPER_CONTROL bit 0), else the shipped 682; LIHOL6: 177 the first `HOLOA` per session (so `HOLOB..E` read as its
  continuation), the shipped 182 after that.
* **Tests.** Node `restore-holo.mjs` (33 checks: the shadow facts, every branch, busy channel, other letters / tables untouched). Headless `tools/steps/restore-holo.mjs`: node 8 speaks 177, B, C, D, E, 182, 182; node 32 with 2 pages speaks 681, 683, 681, 681.

### joke (`features/joke.ts`): the castle's three-line joke

* **What it does.** `CI/Data/CSIFSM4.str` has `BAR2C` ("Hoe lang is lang?") - `UNUSED:1293` ("Hoe lang is een touwtje?") - `BAR2D`, and the same for `BAR4C` / `UNUSED:1303` / `BAR4D`. The second talk with the figure now says C and the middle line, then D.
* **How triggered.** The second talk with the tournament figures BAR2 / BAR4 in the castle hub (story node 22, the table `csifsm4`). `HubContext.say` -> hook. **Mechanics (reconstruction):** the first request for `(BAR2C, BAR2D)` speaks C + middle line in one `say` (two clips fit one `say`) and returns false, which makes SGMFIG keep the
  pair as `pending` and ask again when the speech is idle (its own retry in `converse`); the second request speaks D alone. A request for `BAR2A` resets (a skipped conversation). No tick hook, so it works in hubs. Limit: if the speech channel is busy at the very first request, SGMFIG's retry is the first
  request and D is dropped (C + middle still play).
* **Original:** the three lines and the audio (`CAJOBB12` for the middle line), SGMFIG, `HubContext.say`. **Reconstruction:** the chain mechanics only (no new text, no new audio: the middle line is the table's own `UNUSED` entry under a private tag).
* **Tests.** Node `restore-joke.mjs`: state machine on the real table for BAR2 / BAR4, busy channel, reset, other figures / tables pass through; the REAL SGMFIG code says `BAR2A | BAR2C+BAR2M | BAR2D` (the original: `BAR2A | BAR2C+BAR2D`); feature off = untouched. Headless: see the report of the session (`tools/steps/restore-joke.mjs`).

---------------------------------------------------------------------------------------------------------------------------

## Feature `battery`: the radio battery side quest (`src/restore/features/battery.ts`)

**What it does.** After the DJ hands Pepper the radio (LGI10) he now remembers that "die radio werkt op batterijen" (LECSRS06-08), throws batteries away (`dj_throw`) and tells Pepper to pick them up on the way.
In story node 56 (the dance puzzle) the ten hidden records `BTB0..BTB9` (295..304) lie around the island, spinning and bobbing; walking into one gives the radio 4 of its 12 cells. A 12-cell gauge
(red / yellow / green, dark when empty) at the bottom right of the HUD shows the level. The radio only plays while it has power: at level 0 the bricksterbots do not dance and the music is muted; the
level drains only while a bot dances. In any other node the batteries are hidden again, the gauge is gone and the radio is the original's (always on in nodes 56-60). Option off: nothing of this exists.

**Triggers.** `islandStart` attaches the nodes (the story node is checked every tick: `var 0x58 == 56`); `islandTick` shows / hides the gauge; the patched `lgi10` plays when the original starts it.

| Part | Original | Reconstruction |
|---|---|---|
| Records `BTB0..9` (295..304), models, collision, positions (terrain + 1.5..1.9) | the set-up data (the set-up only hides them) | making them visible (`RF_ENABLED | RF_NO_COLLIDE`: the original never sets bit 2; non-solid is mine), `SCALE` 2.5 (drawn larger than the 0.8 x 0.86 x 0.5 mesh so that they are found), spin 0.05 / bob 0.25 |
| Attach | `attachNode` (FUN_0042382c + FUN_00423532, the call of the set-up's 1,107 attach sites) with two node classes registered by name (`RestoreBattery`, `RestoreRadioPower`) | the node behaviour |
| Level / mask | var 22 `SWITCH_GME_BATTERY_LEVEL`, var 225 `UNUSED_` (both inside the saved range 15..318: a save keeps them) | `CELLS` 4 per battery, start level 0, a battery stays on the ground while the radio is full |
| Pickup | `Controller.distSq` (squared XZ distance, FUN_0042226e) | radius 4 (`PICKUP_DIST_SQ` 16), `|dy| < 4`, not during a cutscene, sound 753 `SND_GET_OBJECT` (Collect.wav, in the walking Pepper's loaded set) |
| Power | var 0x22 `SWITCH_GME_RADIO_ON` read by BOTMUSIC (misc.ts: 0 = no dance, no `botDance`) and the blaster's pre-render mute; GETO (record 68) sets it to 1 in nodes 56-60 | `RestoreRadioPower` on BTB0's controller (record 295 runs after the bots 17-26 and GETO 68 in the same tick) sets var 0x22 = level > 0; drain 1 cell per `DRAIN_TICKS` 300 ticks (10 s) of `ambient.botDance` |
| Gauge | `Hud.gauge` = FUN_00460214 (12 segments of 32 x 16), textures 9 REDBAR / 10 GreenBar / 11 YellowBar of Overlays/Z02LGI (bottom to top red 4, yellow 4, green 4, as z22BIP's fuel gauge) | the dark unlit cells (a `Hud.extras` callback: the engine gauge draws lit cells only) |
| DJ lines | `lgi10.txt` lines 43-54 (LECSRS06-08 with `dj_throw` = clip 274, `setfov`, cameras), compiled by the original's compiler | rule P patch: `addNext` (line 40 `... LECSRS05` had no next id at all: next 50; added to `scripts.ts`, the plan's `setNext` cannot express a missing next id) + un-comment lines 43-54 |

**Corrections to the plan.** (1) `setNext` cannot patch line 40 (it ends in `LECSRS05`, whose digits looked like a next id): new `addNext` in `scripts.ts`. (2) `ambient.botDance` is cleared by GETO's pre-render at the end of every
tick, so it is only valid inside the update pass; the power node reads it there (after the bots), it is never read from `islandTick`. (3) The plan's gauge textures and the 12-segment layout hold; the engine gauge shows nothing at level 0,
hence the dark cells. (4) The node is attached to all ten records at island start and gates itself on the story node (a gate on var 0x58 would leave the batteries visible after node 56). (5) The drain is per tick of `w.dt`.
**Not built:** the batteries do not fly out of the DJ's hands (the scene has only the throw animation); the objective is left alone (no arrow to a battery). **Tuning** (`CELLS`, `DRAIN_TICKS`, ...): all `RECONSTRUCTION` constants at the top of the file.

**Tests.** `tools/tests/restore-battery.mjs` (node): option off = hidden, no controller, vars 22 / 225 untouched, radio 1; on: ten records visible and resting 1.5..1.9 above `terrainHeight`, spin, pickup (level + 4, mask bit, hidden, sound 753),
a full radio leaves the battery, far = nothing, drain only next to a dancing bot (first cell after 300 ticks, none after 400 ticks far from the bots), level 0 -> var 0x22 = 0, node 57 hides the batteries and gives var 0x22 back to GETO,
gauge (12 cells, textures, one callback, off after the quest), patched `lgi10` (`LECSRS06-08` + `dj_throw` present, +9 commands, `LECSRS05` signals 50), save round trip of vars 22 / 225. Browser (headless, muted):
`tools/steps/restore-battery.mjs` (gauge at level 0 / 6 / 12, a battery on a slope, a real pickup: level 4, mask bit 5, radio on) and `tools/steps/restore-battery-dj.mjs` (the patched scene).
Run: `node tools/test-formats.mjs --only restore-battery`.

## Feature `arrow`: the objective arrow (`src/restore/features/arrow.ts`, `Ui2D.spriteRot` in `src/ui/renderer2d.ts`)

**What it does.** A yellow arrow (the island HUD's unused texture 8 `Pointer`) at the top centre under the score points to the story objective, turning with the camera: straight up = straight ahead, to the
right = the objective is to the right. It is hidden during cutscenes, from story node 0x3d (no HUD icons then either), when the objective has no destination (mode 0, "nearest talking NPC") and within the
objective's own arrival radius (`Objective.radiusSq` = (radius * 8)^2, the value every objective setter writes to DAT_009da840 and nothing reads: 128 units for the usual radius 16, 64 for 8, 16 for the four-record mode).

| Part | Original | Reconstruction |
|---|---|---|
| Texture 8, 32 x 32 | Overlays/Z02LGI text008 `Pointer` (WhatsWhat.txt) | none |
| Target, radius | `Objective.target()` (FUN_00424e37, incl. the vehicle branch), `radiusSq` | using them as an arrow |
| Draw | `Hud.extras` callback + `Ui2D.spriteRot` (new, additive: a rotated textured quad on the existing `quad4`) | position (400, 112) of the 800 x 600 grid, 48 grid units, rotation convention (the texture points right: turned by bearing - 90 degrees), the hide rules, island only |

**Corrections to the plan.** At story nodes 8 / 12 / 31 the objective is mode 0 (node 8: no destination: no arrow), mode 1 with record 116 (node 12) and mode 1 with record 121 (node 31): not "record / pair / PATH node" as the plan guessed
(measured with `IslandGame.debug()`). The bearing uses the camera's viewing direction on the ground plane (eye -> look-at) and Pepper's (or the vehicle's) position (`World.focus`); the view's right vector is `(fz, -fx)` (camera.ts `updateView`).

**Tests.** `tools/tests/restore-arrow.mjs`: the bearing for the four quadrants, the diagonals, a turned camera, from Pepper not from the camera; every hide rule and the radius cut-off at exactly `sqrt(radiusSq)`; the HUD callback on the real island world with the
real `Objective` in modes 0 / 1 / 2 / 3 (a record, a pair, a PATH node), node 0x3d, hidden HUD, no focus; installed once. Browser (headless, muted): `tools/steps/restore-arrow.mjs` at nodes 8 (no arrow), 12 and 31 (screenshots looked at: the arrow turns with
the camera; with the camera put behind Pepper facing the objective it points straight up). Run: `node tools/test-formats.mjs --only restore-arrow`.

*Addendum (joke, headless):* `tools/steps/restore-joke.mjs` (castle hub, story node 22, the boat put at the dock and moored with Ctrl, then two real Shift talks next to `BAR2`) logged `BAR2A` (1271), `BAR2C + BAR2M` (speech 1292 + 1293, "Hoe lang is lang?" / "Hoe lang is een touwtje?"), `BAR2D` (1294, "Hoe lang blijf ik hier nog kletsen?") with both subtitles on screen.

---------------------------------------------------------------------------------------------------------------------------

## Island worker: `lgi11`, `cutlines`, `cave`, `swimmer`, `looks`

Files: `src/restore/features/{lgi11,cutlines,cave,swimmer,looks}.ts`; tests `tools/tests/restore-{lgi11,cutlines,cave,swimmer,looks}.mjs` (node: `node tools/test-formats.mjs --only restore-lgi11,...`), headless bots
`tools/steps/restore-{lgi11,lgi09,cutlines,cave,swimmer,looks}.mjs` (headless + muted through `tools/m5-botslot.sh`, URL needs `&restored=1`). Every test also checks the option-off state.
Shared files touched (one guarded line): `src/zones/z50LTC.ts` (`restoreHooks.cue?.('ltc-arrive', ...)` when the cave's game is created, import of `flag.ts`). Nothing else outside `src/restore/`.

### lgi11: the arrest scene (LGI11) and the Pied Piper line (LECSBK24)

* **What / how triggered.** At story node 57 the police-station trigger (`StartCSM` on POLB, gate S277) asks for cutscene slot 8 (LGI12 "To_The_Shuttle"). With the option on the island context's `startCutscene`
  hook starts slot 7 (LGI11 "BBs_Dance_Dizzy": Pepper reports the Pied Piper of Pizza with the captured Brickbots, Agent Nick: "Pepper, zo is muziek een dodelijk wapen!" / "Ik arresteer de radio.", speech 731-733)
  and queues slot 8 behind it, so the scenes play LGI11 then LGI12 (speech 734-739) and the trigger's variable operation (S277 = 7, node 58) comes after both. The second line of `lgi09` (Brickster
  kidnaps Mama and Papa, era 3, node 53): after Pepper's `LECSBK23` the commented-out block `//340 pepp saytext LECSBK24` "Pepper, de rattenvanger van Pizza." now plays (rule P).
* **Original.** The scripts, strings and mp3 of LGI11 / LGI09, the set-up's slot 7 declaration, the POLB trigger, the cutscene manager's own one-deep start queue (`FUN_00458d15`: slot 8 follows without a
  gap: no letterbox flicker, the StartCSM node sees "active" throughout), the developers' commented block (compiled by the original's format code; the self-test of rule P checks that the unpatched text still
  compiles to the archive's `.cut`).
* **Reconstruction.** Only the order (7 before 8: slot numbers + the shared stage `CSM_police01`, mirrored roles). Fallback when the queue is taken by another script: `islandTick` starts slot 8 once the manager is idle
  (`cutscenePending` keeps the trigger waiting).
* **Tests.** `restore-lgi11` (node): `lgi09` patched = one more saytext, `LECSBK24` right behind `LECSBK23`, 330 -> 340 -> 350 chain, rest of the script unchanged; LGI11 speech ids 731-733, LGI12 734-739; the chain on a
  mock manager with the original's queue and without it (no idle gap, nothing pending afterwards, other slots / era 2 pass through); the real POLB trigger on the island world of node 57 (option off: slot 8 alone;
  on: 7 then 8, S277 == 7). Bots: `restore-lgi11` at `?zone=z02LGI&node=57&restored=1&mute=1&hold=1` (log `LGIBR08, LGI11, LGI12`, the nine subtitles in order, S277 = 7, node 58; screenshots of both scenes looked at),
  `restore-lgi09` (node 53).

### cutlines: LEINVS04 "Erop af." in lgici25 (Valerie's pizza)

* **What.** The scene `lgici25` (Pepper brings Valerie Stubbins her pizza; slot 25, started by VALS) says LEINVS01-03 and stops; `LGICI25.str` also has `LEINVS04` "Erop af." (voice 35, mp3 present). With the option on a
  `SayText LEINVS04` is inserted in block 40 (both actors hand the pizza over); block 45 (Valerie takes it) starts when the line has been spoken.
* **Original.** The string, the mp3, the script, the compiler. **Reconstruction.** The place of the line and the speaker: the plan guessed Valerie; the pitch of the recording (median F0 of the decoded clip 267 Hz;
  Pepper's own lines 235-333 Hz, median ~280, LEINVS01 286 Hz; Valerie's LEINVS02 / 03 356 / 327 Hz, autocorrelation on the decoded mp3) fits Pepper handing over the pizza ("dig in!"), so the line is Pepper's.
  The camera stays as the script has it (on Valerie; Pepper is in the edge of the shot). A listen decides; switching the speaker is one word (`Pepp` -> `Vals`) in `cutlines.ts`.
* **Tests.** `restore-cutlines` (node: unpatched = 3 lines, patched = 4 with `LEINVS04` Pepp 40 -> 45, every other command unchanged, voice 35 = `LEINVS04` in the speech table); bot `restore-cutlines` (starts lgici25
  directly, subtitles `LEINVS01..04`, screenshot looked at). No other island script lines exist in the audit (section 9); the lgi10 battery lines belong to `battery`.

### cave: the developers' cave without typing SDREAMS

* **What / trigger.** With the story at node 68 (the ending, free roam) the feature sets game variable 0xd := 1 once; the island director (`FUN_004b7c78`, `lgifsm.ts`) then scales the WORM portal in (1 -> 2 -> 5)
  and its box portal leads to z50LTC (var 5 = 0x22). `Teleport.wav` plays when Pepper steps into the portal box (var 5 becomes 0x22), `Teleport2.wav` on arrival in the cave (cue `ltc-arrive` of `z50LTC.ts`, only
  after the portal, not for the story's own way in at node 71). The two sound-table entries are new (ids 902 / 903, appended in `soundPatch`: volume 64, 22050 Hz like the half-finished `SND_CAI_PORTAL`
  entry, which points at the directory `z02lgi\` and stays untouched).
* **Original.** WORM (record 370, gate var 0xd, at the ending it hovers at (433, 23, -99) = the editor's PATH node `CAVE`), the scale-in, the box portal, z50LTC, the two wav files. **Reconstruction.** That the
  unlock is the ending (the data only shows Darren's hint at era 2 and the cheat) and the two sound events.
* **Tests.** `restore-cave` (node: option off: 902 entries, var 0xd stays 0, WORM hidden; on: 904 entries (the original 902 untouched), node 68: 0xd 1 -> 2 -> 5, WORM visible; node 61 stays closed; walking in sets var 5 = 0x22
  and plays the enter sound once; the arrival cue plays once). Bot `restore-cave` (`?zone=z02LGI&node=68&restored=1&mute=1`: var 0xd = 5 without the cheat, screenshot of the green portal, walking in lands in
  z50LTC, screenshot of the cave).

### swimmer: the swimming Brikimal BML2

* **What / trigger.** BML2 (record 367, kind 2) is placed on open sea and gets the Brikimal node on its own shape counter, game variable 0x2e `SWITCH_GME_MOVE_BML2` (like BML1 / BML3 with 0xc3 / 0xe0); all eras.
* **Original.** The record (never placed: (0, 0, 0), flags 0x20), `BrikimalNode` with its kind-2 branch (no terrain snap = swims), the kind-2 rows of the movement table, the morph files, the brick-morph service.
* **Reconstruction.** (1) The place: the open sea (no ground within 60 units, so the wander radius of about 35 stays in water; the terrain mesh has no sea floor: water = the ground ray misses) nearest to the pair
  BML3 / BML4, the kind-1 siblings on the north-east coast: (472, -269); floating at the sea level - 0.3. (2) The original's kind-2 branch never writes the height, so its bob `y += sin(phase) * amplitude`
  would pile up (the animal drifts into the sky: 1441 units after 3000 ticks): the subclass `SwimmingBrikimal` puts the height back before every update (the jump / bob of each shape stays above the water).
* **Tests.** `restore-swimmer` (node, nodes 2 / 31 / 56 / 68: node + gate, home is open sea, 3000 ticks always over water within ~21 units of home, the shape counter cycles through all 8 shapes, height stays near the
  sea level, BML1 / BML3 / BML4 unchanged; option off: BML2 not placed, no node). Bot `restore-swimmer` (camera hovering 16 units from the swimmer: the brick animal swims in the water, screenshots looked at).

### looks: extra vehicle looks

* **What / trigger.** Enter next to a vehicle cycles through its looks (original machinery); with the option on the groups of the ambulance, rescue helicopter and police car have extra looks appended behind the
  game's own (so a save keeps its meaning with the option off; a part number beyond the group wraps to the original paint). The brick effect gets one more model per look (stage = variable modulo models).
* **Original.** SwapText textures no look of the game uses, `BrickMorph/policecar01.txt`. Looked at in the game: **29 / 30 (jetski yellow R.E.S.Q), 124 (police black A emblem), 107 (speedster red panel) and 4 (ambulance
  emblem) are the models' own default paint** (look 0 = "no swap"), so they are not extra looks (the first draft with them showed an identical vehicle and was dropped); 126 (A emblem on blue) is the missing blue police car
  with `policecar01` (works: blue body, white POLICE lettering). 136 / 139-143 (police badges, 64 x 64 in the colours of the six ambulance emblems: six "police ambulance" looks, looked at: blue and orange read well) and 72 (rescue helicopter stripes: a black / blue / yellow helicopter) are real extras. The speedster's 107 with the tan-rim textures only differs from the default in its wheel rims (dropped); 137 / 138 (R.E.S.Q on dark / cream) as jetski looks came out almost black / muddy tan (dropped).
* **Reconstruction.** The pairing of colours and textures (the recipes in `looks.ts`: each look is a copy of an existing look of the vehicle with colour textures exchanged) and the order (appended); the brick model of a
  new look is the model of the look it was copied from (the bricks morph in their colour, the swap shows the new paint), except the blue police car.
* **Tests.** `restore-looks` (node: sizes, every texture id exists in SwapText, brick models = looks, `policecar01.txt` is the last model of the police car, Enter's cycler reaches every new look and wraps, option off: groups
  as read, a second tick adds nothing). Bot `restore-looks` (every new look of the three vehicles in a screenshot, Enter on the police car wraps to look 0 through the real machinery).

*Verification notes (island worker):* the headless bots `restore-lgi11` (restored), `restore-cutlines`, `restore-cave`, `restore-swimmer` and `restore-looks` passed and their screenshots were looked at. The bots `restore-lgi09` and `restore-lgi11` with
`restored=0` did not run cleanly (the first saw no subtitle in time on a loaded machine; the second was interrupted by the era intro LGIBR08 that plays first at node 57), so the lgi09 patch and the option-off behaviour rest on the
node tests (`restore-lgi11`: the patched / unpatched `lgi09` command lists, the real POLB trigger with the hooks off and on).
`node tools/test-formats.mjs` otherwise unchanged: the only failures (m5-z07CSI-control, m5-z07CSI-horse-ride, m5-z40OGL-peppswit, m6-z18MMP) are in hub / mini-game files other agents were editing at the time.

---------------------------------------------------------------------------------------------------------------------------

## Features `cues`, `popups`, `hubcuts`, `page` (worker "cues / popups / hubcuts")

Files: `src/restore/features/cues.ts`, `popups.ts`, `hubcuts.ts`, `page.ts`; helpers `src/restore/popup.ts` (a HUD text popup on `Hud.extras`) and `cuectx.ts` (the loose context a zone hands to `restoreHooks.cue(name, ctx)`);
tests `tools/tests/restore-cues.mjs`, `restore-hubcuts.mjs`, `restore-page.mjs`; bot steps `tools/steps/restore-cues-flowers.mjs`, `restore-popups-wab.mjs`, `restore-popups-bip.mjs`, `restore-ids.mjs` (wraps any zone bot and logs the
sound ids that reach the audio host and the popups shown), `restore-hubcuts-ogl01.mjs`.
Mechanism: a zone raises an EVENT with one guarded line `restoreHooks.cue?.('<event>', ctx)` (option off: the hook is `undefined`, nothing is evaluated); `cues` turns events into sounds, `popups` into texts.

### cues (plan item 9): sounds the original loads and never plays

| Event (where) | What plays | ORIGINAL | RECONSTRUCTION |
|---|---|---|---|
| `flower-grow` / `flower-shrink` (island, `FlowerNode.update`, `src/island/pizza/footy.ts`) | ids 0 / 2 = `z02LGI/GrowBig.wav` / `GrowSmll.wav`: `Feature.soundPatch` re-points the two table entries (the other fields, volume 33, distances 8 / 64, 11025 Hz, stay) | the original CALLS both sounds every tick of the phase (`FUN_005396af` -> `FUN_004433f0(DAT_05d58188 = id 0)` in the growth phase t < 90, `DAT_05d58148 = id 2` in the shrink phase t 180-360, verified in the decompile: `FUN_004433b0(0)` / `(2)` fill the two globals); the table maps both ids to `Silence.wav`; the two real files are unused | the one change is the table entry. The plan's "once per phase" is NOT needed: the audio sink only refreshes the volume of a sound that is still playing (`SfxEngine.play3D`), so the original's per-tick call makes one continuous grow sound, retriggered after each 0.55 s / 0.98 s sample, exactly what the developers meant |
| `rgb-castle-hit` (z10RGB, `collideBall`: the second ray, against `BUNS`) | id 0x196 `HIT_CASTLE.wav` (3D at the hit point) | file, id, the zone loads it | event: a cannonball that hits the castle (the original has no call) |
| `was-hit` kind `snake` (z17WAS `WasNode`, the hammer on an ordinary snake) | id 0x1c8 `big bonk.wav` | file, id | the event. **`BIGSWING` (0x1c9) is NOT restored**: no event identifiable (a swing with a gem is the grab, the hammer swing has its own `X swing` sounds): left out as the weakest |
| `ssh-tick` (z15SSH, `engineSounds`, every tick like the fountain) | id 0xbc `river_amb.wav` loop, 3D at the fountain record `G149` | file, id | the position: the zone has no waterfall record, the fountain is the only water place; weak |
| `hat-freed` (z28HAT, Bronty's FREED state starts) | id 0x2b8 `Horn2` (`hatesFinal`) | file, id (the bank loads it) | the event |
| `map-medal` (z41MAP, `onBanner` with a medal) | id 0x1dc `PAPA_CONGRATS` | file, id | the event |
| `bip-melon-throw` (z22BIP, `MonkeyNode.throwMelon`) / `bip-stone-hit` (`RockyNode.moveStones`, a stone hits the plane) | `melon_fly` 0x7e (3D at the monkey) / `rock_hit` 0x2e5 (3D at the stone) | files, ids | the events. `splash` 0x73 and `hit_valley` #2 0x72 are NOT restored (the zone has no water / second terrain-hit event) |
| `pph-computer` (z03PPH, `update` after the computer step) | 642 `StartComp.wav` when the computer menu opens, 644 `computer.wav` (loop, refreshed every tick) while it is open, 643 `Shutoff.wav` when it closes | files, ids | the events. `SCROLL_OK / SCROLL_NA` (645 / 646) and `FSTEP1-4` (674-677) are NOT restored (the shell's menu sounds and the walker's footsteps already cover those events: it would double them) |

### popups (plan item 10): texts the string tables have and the code never shows

ORIGINAL: the texts (`WAB1-3`, `WAS1-2`, `FSH5`, `BIP10 / 11 / 14 / 15`) and, for `FSH5`, z21FSH's own blinking message slots. RECONSTRUCTION: when / where / how long (the original has no call for any of them).
`WAB1` "Gemept" / `WAB2` "Mis" / `WAB3` "Oh-Nee!" at the three whack events (hit, miss, Infomaniac; hooked in the `play3d` of `WabHost`, which the original calls exactly for those three sounds); `WAS1` / `WAS2` hit / miss of a swing at a basket;
`FSH5` "Mooie vis!" above the weight popup of a catch; `BIP15` with the low-fuel speech `ADSGBI09`, `BIP10` while the engine is out, on the end banner `BIP10` + `BIP11` (out of fuel) / `BIP14` (a medal).
Not restored: `WAS3 / WAS4` (belong to the unplayed big swing), `BIP12 / 13` (the result code they would belong to, 0 / 2, cannot occur), `BIP1-9` (stunt-flight draft, class C).
The HUD popup (`popup.ts`) is one line of text for ~1 s (2.5 s for BIP) at (320, 130) of the 640 x 480 grid, drawn through `Hud.extras`.

### hubcuts (plan section 9): cut lines of the hub scenes (rule P)

| Item | Script | What | Status |
|---|---|---|---|
| R-A1 | z07CSI `csi02` | un-comment block 60: Lion `LSD1` says `CACSBR11` "Hoera, Pepper, Pepper, nu kunnen we gaan vechten!" (the developers' commented block; next id of line 109 70 -> 60) | ORIGINAL; the port's hub declares `csi02` at nodes 19-22 |
| R-A2 | z07CSI `csi02a` | the same in the variant for "page already won" | ORIGINAL; **the port's hub never declares `csi02a`** (the emulated set-up of node 19 gives `csi02` for every value of var 0xc2: the original's `FUN_0057ab10` picks `csi02a` at run time) -> the patch is ready and inactive until the csi worker selects `csi02a` |
| R-A3 | z40OGL `ogl01` | the fourth sleeper `cit4` between cit5 and cit2 (blocks 40 / 45, cosmetic) | ORIGINAL |
| R-A4 | z07CSI `csi01` | `CACSAR02` "Handige hulp en hoop is gearriveerd!" after `CACSAR01`, speaker `Lar2` | RECONSTRUCTION (slot from the numbering hole, speaker guessed) |
| R-A5 | z16PYA `adv02` | the Dr. Pepper gag `ADCSAM05` / `ADCSAM06` between `ADCSAM04` and `ADCSAM07` (the PlayStation script `adv02psx.txt` still has the block); the two clips are audio only: orphan speech indices + subtitles from `lines.nl.ts` | script ORIGINAL; subtitles RECONSTRUCTION, D1 (typed from a transcript, `ADCSAM06` flagged doubtful) and D2 (the gag is probably the soft-drink brand) |
| R-A6 | z07CSI `csi08` | `CACSCS08` "Aha, bijna!" between 07 and 09, speaker `bar2` | RECONSTRUCTION, **doubtful** (speaker is a pitch guess) |
| R-A8 / R-A10 | z07CSI `csi07` / `csi09` | `PEP_CATCHBULLFLAG`, `Flutter.man` (cosmetic) | NOT active (`COSMETIC` list in `hubcuts.ts`): only after the patched scene was looked at in the runner (the castle is still being ported) |
| R-A9 | csi04 `CACSBP17` | class C: contradicts the PC staging | not included |

`restore-hubcuts.mjs` checks for every patch: the unpatched compile equals the archive's `.cut`; the patched compile parses and has the expected command count (+6 / +6 / +5 / +1 / +6 / +1); the saytext ids gain exactly the new id(s) in the expected place; every block can start
(`FUN_00458c15` counters); the new ids exist in the `.str` (R-A5: they do not, the overlay supplies them), as mp3 and in the speech table; no new actor appears; the hook returns the patched bytes for upper / lower case names; the hub's emulated
set-up declares the same zone / script at the node where the scene plays; with the feature off nothing is patched.
Shared-file edit: `src/restore/scripts.ts` `patchText`: a `setNext` whose line ends in a numeric argument after the next id (`... cit5_cit5_sleep 50 2` in `ogl01`) is now found (fallback: the first `from` token that only numbers follow).

### page (plan item 15, R-A7): the fisherman hands over the page (script only, NOT wired)

`page.ts` has the new script `adv04b` of z21FSH (`ADV04B_TEXT`, 11 commands, blocks 0 / 5 / 10 / 20: `fshm` says `ADCSOA13`, `ADCSOA14`, Pepper waves) and `extraCut()`; `restore-page.mjs` checks compile, block graph, vocabulary (every actor / animation occurs in `adv04` / `adv11`
of the same zone), text / mp3 / speech-table entries of the two lines. ORIGINAL: the two lines and their audio, the vocabulary; RECONSTRUCTION: the script, the speaker (`fshm`) and everything about when it plays.
NOT done, needed for the wiring: (1) `cutscene-host.ts` `declare()` must accept a script the archive does not have (`arc.find('cutscene/adv04b.cut')` throws before the hook is asked: ask `restoreHooks.script` first, e.g. have `index.ts` call `extraCut(zone, name)` for names without a baseline);
(2) z21FSH: a third entry `{ slot: 2, zone: 'z21FSH', script: 'adv04b', strings: 'ADV04', area: 'ai' }` in `FSH_CUTSCENES` (only with `restoredFeature('page')`) and a trigger (the plan: the loss / abort path of the fishing game, since ADCSOA12 says "Als je haar vangt, heb jij je bladzijde": the page is the reward for catching Big Bertha, so
a scene that hands the page over for nothing only fits where the game is lost or given up); (3) what the scene does to the story (the page counter / node completion) is a design decision for the lead and the hub workers (z13CAI is not marked done). The z21FSH files are quiet, z13CAI is not, so nothing was wired.

### Tests and bots (results, 2026-10-29)

* Node: `restore-cues` 96 checks (sound-table patch changes exactly entries 0 / 2; every cue id exists and its file exists; handlers on fake contexts; the real `FlowerNode` calls the cue every tick of the grow / shrink phase (~90 / ~90 per cycle); z28HAT on the real nodes: Bronty freed plays `hatesFinal` once with the feature, never with the option off; popup texts exist; the popup replaces / draws; every zone file carries its hook line), `restore-hubcuts` 115, `restore-page` 28, `restore-core` 269 (option off: nothing changes); zone tests of the touched zones unchanged and green (m3-z05WAB / z17WAS / z41MAP / z03PPH, m4-wp5-pizza, m5-audit-z05WAB / z17WAS, m6-z10RGB / z15SSH / z21FSH / z22BIP / z28HAT). `tsc` (only pre-existing / other workers' errors) and `vite build` green.
* Headless bots (`tools/steps/restore-*.mjs`, via `tools/m5-botslot.sh`, screenshots looked at): flowers: ids 0 / 2 reach the engine as GrowBig.wav / GrowSmll.wav (178 / 180 calls); WAB: WAB1 / WAB2 / WAB3 popups visible (`/tmp/restore-popups`); BIP loss: BIP15, BIP10 popups and the banner with BIP10 + BIP11; z10RGB: id 0x196 played; z41MAP: 0x1dc once at the banner; z15SSH: id 188 every tick; z17WAS: id 456 x9 and WAS1 popup; z21FSH: FSH5 "Mooie vis!" visible above the weight; z03PPH: 642 x2, 643 x2, 644 loop; hubs: z40OGL node 66 with `ogl01` patched: cit4 plays clips 7 then 6, scene looks right. Not run in a browser: R-A1/2/4/6 (z07CSI not done), R-A5 (z16PYA not done): node tests only (ready to wire / verify when the hub is done).
* The old steps `m3-z03PPH` (after the replay) and `m3-z41MAP` (restart) time out the same way WITHOUT the option on the current tree: not caused by this work.
* BIP win (pilot lands, result 3, not muted at the page level so the sound log works): `melon_fly` (id 0x7e) reached the engine on every melon throw; banner screenshot `/tmp/restore-ids/bipwin/bip-banner.png`.

*Battery, patched LGI10 scene:* verified node-side (the cutscene runner plays LECSRS01-08 in order, `dj_throw` resolves to clip 274 on DJAB, the scene ends). The browser screenshot of the scene (`tools/steps/restore-battery-dj.mjs`) could not be taken: the bot slots were occupied for over an hour and the last attempt hit another worker's half-edited file; run that step to look at it.

## Status (end of the first implementation pass, 2026-10-29)

Built and node-tested (`node tools/test-formats.mjs --only restore-<id>`): lgi11, cutlines, battery, arrow, tips, voicefix, voiceswap, joke, holo, cues, popups, looks, swimmer, cave, hubcuts (R-A1..R-A6). Option off = original: `restore-core` (no hook set, nothing of `src/restore/index.ts` requested; with every feature off all message tables, scripts, sound and speech tables pass through unchanged).
Not wired / not built: `page` (script `adv04b` exists, needs a third cutscene slot + a z21FSH trigger and a story decision), `hubnpc` (R-A11: hidden castle figures CAVL / LAR4 / BAR4; not built), R-A2 `csi02a` (the hub never declares it), R-A8 / R-A10 cosmetic patches (off until seen in the runner). Hub patches R-A1 / R-A2 / R-A4 / R-A6 (z07CSI) and R-A5 (z16PYA) are ready but only node-tested: verify in a browser when those hubs are done (docs/re/m5/progress.md).
Subtitles: `src/restore/lines.nl.ts` (large-v3-turbo and large-v3 Whisper, typed by this project; `DOUBTFUL_LINES` need one listen).
