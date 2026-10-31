# M5 z07CSI: the castle island (zone table index 6, `z90CAS`, archive `z07CSI`, story nodes 15-17, 19-22, 24, 25, 27-29)

Hub worker `csi` (the three Horse constructors 0x579178 / 0x579725 / 0x579948 and the 936-line ride FUN_005769a8 are the worker `csi-horse`'s: `src/zones/z07CSI/horse/**`).
Everything below is ported from the decompile (`LE2.c`, asm for every float branch) and checked against the ORIGINAL code run in the x86 interpreter next to the port
(`src/formats/x86emu.ts`, oracle machine `tools/lib/m5-z07CSI-emu.mjs`), see section 6. Status and open items: section 8.

## 1. Files

| file | content |
|---|---|
| `src/zones/z07CSI/index.ts` | `registerHub({ archive: 'z07CSI', story, ctors, afterSetup, onCreate, frame })`, `applyCsiSetup` (Pepper's chain, dock table, board, roster), emitters / HUD / look hookup |
| `story.ts` | FUN_00574e40 (the hub's own story handler) |
| `hud.ts` | FUN_00575ca0 (per-frame HUD) + FUN_00575c50 (HUD set-up: overlay `Overlays/z07csi`, goblet icon) |
| `goblet.ts` | ctor FUN_005766fb, update FUN_0057652f ("Rattus.c" in the source path: the ten goblets GOB0..GOB9) |
| `rat.ts` | ctor FUN_005763ca, update FUN_00575e70 (the ten rats RAT0..RAT9) |
| `csifsm.ts` | CSIFSM ctor FUN_00575b44, update FUN_005753b0, pre-render FUN_00575673 (cutscene sound table, music activity level, cedric.par) |
| `control.ts` | Control ctor FUN_0057a579 (-> FUN_005b2a23), update FUN_00579a10, pre-render FUN_00579ebe, FUN_00579a96 (the dismount spot), destroy FUN_0057a5ff: Pepper's mode switch |
| `looks.ts` | the castle's vehicle roster (table 0x9031d0: speedboat / dinghy / jet ski looks) and decor group 1 (trees, flowers, citizens' hats), built on `src/island/vehicles/looks.ts` / `src/island/decor.ts` |
| `common.ts` | float32 helpers (`distSq32`, `rand32`, `composeBone32` = FUN_0043a9e5 with the machine's operation order), sound helpers |
| tests | `tools/tests/m5-z07CSI-{story,pickups,fsm,control,npc,setup,cutscenes}.mjs` (the horse worker's `-horse-*`: `z07CSI-horse.md`); harness `tools/lib/m5-z07CSI-emu.mjs`, `m5-z07CSI-load.mjs` |
| bot | `tools/steps/m5-z07CSI.mjs` (+ `lib-z07CSI.mjs`: boat steering, `walkRoute` along the PATH map's hop table; `m5-z07CSI-look.mjs`, `-looks.mjs`, `-portal.mjs`) |

## 2. The zone's code, function by function

| function | what | port |
|---|---|---|
| FUN_00572780 | zone wrapper: loads `z07CSI.bob`, `swaptext`, HUD clear, sounds (FUN_00572ef0), set-up root, `FUN_0042207d(PEPP)`, `FUN_00421bbe(1)`, music (`FUN_00443310(-2)` + `Z07CSI`), the loop, teardown | framework (`src/hub`, `src/shell`); `FUN_00421bbe(1)` = `ensureCsiLooks` at game creation; SwapText hooked in `onCreate`; music = `ZONE_MUSIC` |
| FUN_00574d9c -> FUN_00573527 | set-up root (particles `Z07CSI`, FX_Bricks, ambience `Castle`, loader FUN_0059b3cb, set-up proper, stage sets FUN_0057a6b6 / 0057a8ae / 0057abc9 / 0057af76 + FUN_005b5a20 / 005b2fa0 / 0057b7c0, dictionary FUN_0057b140) | run in the x86 emulation (foundation); results = records, attaches, cutscene slots, dictionaries |
| FUN_00572910 | GameLoop (modes 0..8, story handler call, exit mapping) | `HUB_CONFIG` of `loopmachine.ts` + `HubGame` |
| FUN_00574e40 | story handler | `story.ts` (verified 25445 checks) |
| FUN_00575ca0 / 00575c50 | HUD | `hud.ts` |
| FUN_00574e10 | teardown (`FUN_00423ad4` destroy nodes, free texts, unload music) | framework (`HubGame.destroy`) |
| FUN_00575b44 + 005753b0 + 00575673 | CSIFSM | `csifsm.ts` (verified) |
| FUN_005766fb + 0057652f | goblets | `goblet.ts` (verified) |
| FUN_005763ca + 00575e70 | rats | `rat.ts` (verified) |
| FUN_0057a579 + 00579a10 + 00579ebe + 00579a96 | Control = the castle's PepSwitc | `control.ts` (verified) |
| FUN_005b2a23 / 005b2a00 / 005b2e9f / 005b2f34 / 005b2f7d | Control's constructor tail, Enter look / decor, every-tick roster tick, destroy | `looks.ts` (`constructCastleRoster`, `ensureCsiLooks`), `control.ts` |
| FUN_00579178 / 00579725 / 00579948 / 005769a8 | horse ride | the horse worker |

## 3. The story handler FUN_00574e40 (`story.ts`)

Called by the loop after the story FSM frame whenever var 0x58 changed (and once by the set-up with an uninitialised `*prev`: its writes were made by the emulation). Does nothing while a cutscene runs
(`*prev` stays). Frees both message tables, then by band of the node (`param_3`):

| node | objective (FUN_00424270 record / FUN_004242b9 PATH node, radius 16) | tables (csifsmN / csiholN) | other |
|---|---|---|---|
| < 0x10 (15) | PATH node 0x6f (the dock) | - / csihol1 | |
| 16 | - | csifsm1 / csihol1 | |
| 17, 18 | BRGE (record 4, the broken bridge) | csifsm1 / csihol1 | |
| 19, 20 | BCAS (202, the Bull castle) | csifsm2 / csihol2 | |
| 21 | LCAS (203, the Lion castle) | csifsm3 / csihol3 | HORS, GSAD shown; "just advanced" (prev 20): var 0x112 := 1, PEPP's matrix copied to HORS (16 dwords), var 0x5e := 0x10 (the horse) |
| 22 | BRGE | csifsm4 / csihol4 | CLOK, JKIT, GSAD shown, RSAD hidden; DRKK shown + put on PATH node 0x96, yaw 1.5708, matrix rebuilt, clip 0xb8; DRKH shown, clip 2, on node 0x96, DRKK's Euler; HORS flags := 2 |
| 23, 24 | LCAS | - | "just advanced": var 0x112 := 1 |
| 25 | BCAS | csifsm5 / csihol5 | "just advanced": var 0x112 := 1, var 0x5e := 0x10; JKIT, GSAD, CLOK hidden, RSAD shown |
| 26, 27 | PATH node 0x6f | csifsm6 / csihol6 | |
| 28 | PORS (165, the portal) | csifsm6 / csihol7 | |
| 29+ | PORS | csifsm6 / csihol7 (other strings) | |

It never leaves by itself (always returns 1: the exits are the story FSM, the portal's var 5 and the mini-game hand-overs). Record numbers: `DAT_00983804 + 0x68 k`: BRGE 4, PEPP 7, DRKK 24, JKIT 46, HORS 48,
DRKH 50, RSAD 51, GSAD 52, CLOK 53, PORS 165, BCAS 202, LCAS 203 (`REC` in story.ts). **Verified**: `m5-z07CSI-story` runs the emulated handler (`IslandSetup.run(0x574e40, ...)`) for every node 0..40, the four stage
sets (nodes 15 / 19 / 24 / 27 build different record sets) and the three values of `*prev` (uninitialised, node - 1, other): calls and their order (text-file frees / loads with the string address, objective setters with record /
PATH node / radius, PATH placements, animation starts), the return value, `*prev`, the variable writes and the flag word / translation / yaw / 16 matrix words of 12 records, bit for bit (25445 checks).

## 4. Behaviour nodes of the castle

* **Control** (`control.ts`, ctor FUN_0057a579, gate PEPPER_CONTROL & 0): Pepper's mode switch; first node of her chain, then SGwalk (& 1) / sgswim (& 2) / skate (& 4) / SGVehic (& 8) / the horse worker's Horse (& 0x10).
  *Update* FUN_00579a10: PEPPER_CONTROL & 0x401 == 0x401 (got off the horse) puts Pepper on the node's spot (+0x18..) and starts clip 0x1b; walking makes her visible; returns 2. (The walk node's own `_DAT_008ae330 = 576`
  vehicle range is written here when walking, like the island's PepSwitc port, because the shared SGwalk port does not.) *Pre-render* FUN_00579ebe, every tick: Enter -> the nearest look / decor record (FUN_005b2e9f), the
  roster / decor tick (FUN_005b2f34), the two flag sounds (3D `0x2e2` at the records LFG4 (12) / BFG6 (22), every tick), the story hook (node 0x11, PEPPER_CONTROL != 8, x < -60: var 0x56 := 2 = node 17 done), then the mode
  logic: walking / 0x401: Ctrl (not in the walk states 1 / 2 / 0x57 / 0x1f / 0x38, clips 99 / 0x62, no vehicle) -> skateboard (mode 4, clip 0x16, board shown, sound 0x150); a vehicle that took Pepper (DAT_009daa80: HORS ->
  mode 0x10, else 8; clip 0x43); y <= sea level -> swimming (mode 2, clip 0x15); Pepper shown, JKIT hidden. Swimming: terrain one step ahead (+ 4 up) above the sea -> walking (clip 0x25, sound 0x128). Skateboard: Ctrl /
  interact bit (not in the air states 0x20 / 0x21) or water 4 ahead -> walking (clip 0x1c, board clip 2, the 8 roll sounds stopped, sound 0x106). Horse: Ctrl with var 0x112 & 0x10 clear -> FUN_00579a96 finds a free spot
  (rounds around a point 80 above Pepper: pos -+ right * r, pos +- forward * r with r = 4 and the vectors multiplied by r again every round as the original does; a spot counts when the terrain is not below the sea (surface 9 =
  roof: 36 lower) and the probe down 88 (`0xc2b00000`, mask 3) finds nothing) -> vehicle := none, mode 0x401, clip 0x1b. The original loops for ever when no spot exists: the port stops after 8 rounds and uses PATH node 0x72.
  **Verified** (`m5-z07CSI-control`): Control runs natively in the oracle machine next to the port with random Ctrl presses, mailbox / clip scripts, teleports over land / shore / sea, forced modes, vehicle changes, story hooks:
  5.6M checks over 16000 ticks (dt 1 and 0.5), all modes seen (walk 2848, swim 4606, skate 1360, vehicle 5364, horse 1804, 0x401 21 ticks; 21 horse dismounts, 96 / 115 board on / off, 114 / 92 water in / out).
  Found by the test: the dismount probe is 88 units (the island's FUN_0088e030 uses another constant), not the 56 first read.
* **Goblet** (`goblet.ts`, FUN_005766fb / 0057652f; "Rattus.c" is a copied source header): the ten goblets GOB0..GOB9 (var 0xbc, one bit each, mask 1 .. 0x200, value 0). Pick-up within 2 units (squared < 4.0, the float32 distance
  of FUN_0042216f): +1000 to var 0xaf and var 0xce, the shared TWINKLE01.par moved onto the goblet and switched on, the goblet hidden, sound 0x2f1; 3 ticks later the emitter off and the bit stored (FUN_0041761b).
* **Rat** (`rat.ts`, FUN_005763ca / 00575e70): RAT0..RAT9 scurry about their home (mode 0 slow / 1 sit / 2 fast, clip 4 / 1 / 4, loop counters from rand(3) / rand(10) / rand(20), turn / keep timers, heading home beyond 16 units,
  ground by the controller probe (0, 8, 0) / (0, -16, 0) / 3 / 0x50). Every arithmetic step is float32 like the machine's 24-bit x87; the random numbers are FUN_004388ae's `rand() / 32767 * max` (`rand32`).
  **Verified** (`m5-z07CSI-pickups`, 3.8M checks): 3 sessions x 1500 ticks (dt 1 / 0.5, three seeds, rats carried 40 units from home every 300 ticks: 12515 head-for-home rat-ticks), goblets picked up in turn (all ten, var 0xaf 10000).
* **CSIFSM** (`csifsm.ts`, FUN_00575b44 / 005753b0 / 00575673, one node on the hologram record HOLO, gate always open): the zone's switch processor. *Update*: the cutscene sound table at 0x8f8110 (15 x {variable, slot, record}: the csi01..09
  scripts `setswitch SWITCH_GME_CSM_SFXn 1`; 1 = start the 3D sound `0x5d58904 + 4 slot` at the record and set 2, 4 = keep it at the record, 8 = stop and set 2); records HORS (48) and BAR1 (29) get flag 0x10 while a cutscene runs;
  var 0x113 (SWITCH_CSI_CSM_FX_SWITCH00): 1 = cedric.par's matrix := CEDR's bone 0x10 in the world, emitter on, var := 2; 2 = follow the bone; 3 = off, var := 0; returns 2. *Pre-render*: seven citizens' footstep cues (record, clip,
  truncated frame -> 3D sound `DAT_05d588f0 / ec / f4` at the record) while the record is in the view; the music's activity level (horse in view: clip 3 with a changed frame 3 else 1; walking: clips 0x24 / 0x3f / 0x40 2 else 1; skateboard 3)
  -> `FUN_00443310(level - 3)` = the DirectMusic groove -2 / -1 / 0 when it changes. **Verified** (`m5-z07CSI-fsm`, 2.8M checks; the matrix with the machine's own operation order `composeBone32`, found by testing the three
  summation orders against the native FUN_0043a9e5: `(b0 a0 + b1 a4) + b2 a8` then the translation).
* **Pickups of the castle that are not nodes**: none. The castle score `var 0xce` is `FUN_00423bf0` (framework, `computeIslandTotals`: var 0xaf is added).
* **Shared families with the castle's argument blocks** (`m5-z07CSI-npc`, 7.6M checks, through the island's NPC oracle): the guards / archers / king / queen / cavalry (SGMFIG + Turn2Pep A / B / C + Human1) of the four stage sets walk
  (dt 1 and 0.5, 500 ticks) and talk (conversation 1 / 2, called from behind / beside) next to the original; the ten flags BFG0..7 / BBFG / PFLG (MeetPepp: clip 1 / 2 looping, gate always open) in `m5-z07CSI-setup`.

## 5. Set-up, arrival, hand-overs, the rest of the zone

* **Set-up** (run in the emulation by the foundation): 115 attaches (nodes 15-17) / 127 (19-22) / 125 (24, 25) / 124 (27-29), cutscene slots, dictionaries (246 animations + 70 `SWITCH_CSI_*`: the MOVE_* words of the citizens, `SWITCH_CSI_HORSE` = 0x112,
  `CSM_FX_SWITCH00..09` = 0x113 / 0x114 / 0xfe / 0x105 / 0x11c / 0x10e / 0x11d / 0x116 / 0xff / 0xfb), the boat dock table (ONE dock: PATH node 0x6f, Pepper steps off at node 0x72, map 1; no helipads), `DAT_009daa7c = 0x44` (the board
  SKBD). `applyCsiSetup` makes the world match: Pepper's chain as the original attached it (setupZone's stub guard and the M1 mode switch removed), the dock table into `vehicles(world).docks`, the board, Control's constructor tail run
  in the emulation (FUN_005b2a23: variant words, the speedboat's brick effect). `m5-z07CSI-setup` checks it for the 12 stages.
* **Arrival**: from the island (previous zone 0 / 2 / 31 / 32 / 33) Pepper drives the speedboat SPBT (record 87) at (-377.5, 1.5, -213.5), PEPPER_CONTROL 8; from the mini-games and everywhere else she walks at the place the original's set-up
  code gives her record (**after the joust, previous zone 8, she rides on: the set-up writes var 0x5e := 0x10 + var 0x112 := 1 and copies Pepper's matrix to HORS; the horse's node (horse worker) starts the ride on its first tick: nodes 24 / 25 begin on the horse**), then the wrapper's `FUN_0042207d` puts her walker on the PATH map (a few units of snapping). The speedboat is the island's SGBoat (0x430e6c): Space = forward, Alt = reverse, Left / Right steer, Ctrl within 24
  units of a free dock moors it and Pepper steps off (PEPPER_CONTROL 1 | 0x100 while the hologram talks to her); there is no other way out of a boat.
* **Hand-overs to the mini-games**: story nodes 18 (z08BKD: the bridge blocks), 23 (z09JST: the joust), 26 (z10RGB: the Res-Q boat race) belong to the mini-games: when node 17 / 22 / 25 is done the story FSM moves to the mini-game's zone and
  the loop leaves; the mini-game's own condition (`var 0x53 == 1`) completes the node and the castle starts again with PREV_SUBGAME 7 / 8 / 9 (arrival at the emulated place: on foot at (-65.6, 12.4, -6.8) for 7 and (-238, 32.2, -31.6) for 9, ON THE HORSE at (243.8, 13.6, 7.0) for 8)
  and the next stage's set (nodes 19 / 24 / 27: the immediate cutscene csi02 / csi07 / csi09 starts at once, StartCSM without waypoint). Nothing castle-specific happens on return except what the set-up code does for those arrival values.
* **Portal back to the island**: PORS (record 165) = StartCSM.portal (shared, FUN_0051ea3c, table row 0 = SPBT / JSKI / DNGY): the speedboat entering its box sets var 5 = 0x20 (node 29's condition) and the loop leaves for the island (era 2, node 30).
* **Music** (`ZONE_MUSIC`): `Z07CSI` + ambience `Castle`, groove -2 at the start; CSIFSM changes the groove by Pepper's activity. **Fog**: the zone has one `SetupFog` call (FUN_00573527 @0x573572). **HUD**: `hud.ts`.
* **Particles** (all wired): TWINKLE01.par (goblets, one shared emitter: ctor FUN_005766fb @0x576728, gate (1,1,1), switched on at a pick-up), cedric.par (CSIFSM ctor @0x575bc6, matrix = the node's own copy of CEDR's matrix, local (0, -0.4, 1.6),
  gate (1,1,1), on while var 0x113 is 1 / 2), armour.par (FUN_0057abc9 @0x57ab4c, stages 19-22, on TENT's matrix at (0, -7, 0), gate var 0x32 & 0x10, replayed by `startSetupEmitters`), boatplume (SGBoat, island code, `finishEmitters`).
  `portal.par`, `twinkle02.par`, `cedric1.par` are in the archive but no code of the zone starts them (cedric1 is probably an `[EMITS]` sub-emitter of cedric.par).
* **Sounds**: the castle's own: the table of CSIFSM (cutscene effects), the footsteps, the flag ambience, board / water sounds of Control; the 3D handles are `HubContext.soundOf(addr)` of the emulated loader FUN_00572ef0 (`m5-z07CSI-fsm` checks them against the machine).
* **Look change / decor** (`looks.ts`): Enter next to the speedboat / dinghy / jet ski (variant word 2) cycles its paint through the island's cycler on the castle's roster table 0x9031d0 (var 0xae / 0xd7 / 0x34) with the speedboat's brick morph; Enter next to a
  castle tree / oak / flower bed / citizen (variant type 1, decor group 1: 98 entries) swaps the model (the island's decor module). The stored decor (`decorStore`) is applied at the start (`FUN_00421bbe(1)`). Not oracle-tested (render side); the shared code is the
  island's.

* **Record visibility at a fresh start (the hidden list)** (`applyCsiSetup`, found by the horse worker, decided with evidence here): the emulation hosts `FUN_00423532` (attach) and does not run constructors, but the ORIGINAL runs a constructor at the attach,
  in the middle of the set-up. Control's constructor tail FUN_005b2a23 (Pepper's chain is attached at 0x573936) hides the records of the list at 0x903230 (`flags &= 0xfffd`: the horse set HORS 48 / HRS1 / DRKH, the saddles, the decor templates, the board SKBD ...), and
  the set-up code then shows some of them again (HORS at 0x573cbf, the saddles of the stage at 0x573d5d / 0x573e1b ...; the story handler's calls come BEFORE the attach). `setupZone` applies the extraction's flag writes in address order, so it ended hidden where the machine ends
  visible (HORS, GSAD 52, RSAD 51, CLOK 53 on the stages that show them). Rule now: a record of the hidden list is visible iff the last flag write of the emulated set-up made AFTER Control's attach (execution order: the new `EmuAttach.storeIndex` = `stores.length`
  at the attach, additive field of `src/formats/emusetup.ts`) shows it, else hidden. Checked per stage and record in `m5-z07CSI-setup` (against the emulated store log), and the Control / horse duels (`tools/lib/m5-z07CSI-emu.mjs`) now show the same records after the
  natively run constructor (they ran it after the set-up, hence hid HORS where the original does not). No other record of any stage differs from the emulated set-up's final visibility (scan of all 12 stages: the only mismatches were the hidden-list records).
* **Cutscenes** (`m5-z07CSI-cutscenes`): the castle has 9 scripts in its archive: csi01, csi02, csi02a, csi04 .. csi09 (there is no csi03; csi02a is not named by any slot of the set-up: FUN_0045c397 declares csi01 (slot 0, nodes 15-17), csi02 / 04 / 05 / 06 (slots 0-3, nodes
  19-22), csi07 / 08 / 09 (slots 0-2, nodes 24-25) and csi09 (slot 2, nodes 27-29)). Each declared script is run to its end by the cutscene runner on the castle world of its stage (no Shift, speech off = the minimum text durations): every actor, SETANIM name (the zone's animation
  dictionary), SETSWITCH name, SAYTEXT id (message table `CI/Data/<script>.str`, with a voice id), waypoint (CSM / PATH) resolves, the script ends by itself after 213 (csi09) .. 2002 (csi04) ticks and clears PEPPER_CONTROL's cutscene bit. ATTACH ... NULL and FOLLOW CMRA ACTO name no record
  (the loader's find gives a null pointer). The cutscene sound switches (`SWITCH_GME_CSM_SFXn`, 24 uses in the scripts) are CSIFSM's sound table (the "castle sound-switch table": ported and verified in `m5-z07CSI-fsm`, 15 entries -> 3D sound slots 0x5d58904 + 4 slot); each one's sound id is in
  the zone's preload list (`ZONE_SOUND_SETUP.z07CSI`). The scripts play in the browser bot with their subtitles (screenshots looked at).

## 6. Verification summary

| test | what | checks |
|---|---|---|
| `m5-z07CSI-story` | FUN_00574e40 vs the emulated original, all nodes / stage sets / `*prev` values | 25445 |
| `m5-z07CSI-pickups` | goblets + rats vs the native nodes (random streams shared) | 3847192 |
| `m5-z07CSI-fsm` | CSIFSM vs the native node (sound table, groove, cedric, flags) | 2842653 |
| `m5-z07CSI-control` | Control vs the native node (mode switch, dismount spot, sounds) | 5649038 |
| `m5-z07CSI-npc` | the castle's NPC set vs the island NPC oracle (walk / talk) | 7643260 |
| `m5-z07CSI-setup` | stages, chain, docks, board, hidden-list visibility (execution order), arrival (after the joust: on the horse), MeetPepp flags vs the original | 414444 |
| `m5-z07CSI-cutscenes` | the 8 declared scripts run to their end on the stage worlds: actors / animations / switches / texts + voices / waypoints resolve, sound switches -> CSIFSM table -> preloaded sounds | 662 |
| bot `tools/steps/m5-z07CSI.mjs` | headless browser, real keys: the whole chapter (section 8) | - |

The oracle machine (`tools/lib/m5-z07CSI-emu.mjs`, `makeCsiDuel`) is the Adventure Island's pattern: the original's node framework and the castle's constructors / handlers run natively in `src/formats/x86emu.ts` on the memory
the original's own set-up left (`IslandSetup.mem`), with FUN_004388ae natively on a scripted C `rand()`; only collision (the port's CollisionWorld over the mirrored records), animation instances, sounds / particles / render calls are hosted.

## 7. What is not exact and why

* **Look change / decor**: the island's modules (`src/island/vehicles/looks.ts`, `src/island/decor.ts`) with the castle's roster and decor group 1; the swap machinery is compared with the original's FUN_00420bb7 / FUN_00420dc4 / FUN_00421bbe in `m4-decor` (generic in the decor group), the castle's tables in `m8-save-decor` / `m8-save-csi`.
* **FUN_00579a96** never gives up in the original (it loops for ever when no free spot exists); the port stops after 8 rounds and uses PATH node 0x72. That situation cannot arise on the castle island (the loop finds a spot in the first rounds in every state the story can produce; a port that looped for ever would hang the tab): the only difference, unobservable in play.
* **D8** (NPC oracle; FIXED by WP-ISLAND-FIX, and since WP-TIME `m5-z07CSI-npc` no longer filters it: any difference fails, all explicit tolerances of the z07CSI tests are gone, everything runs at tolerance 0, dt 1 and 0.5; new `m5-z07CSI-hud-emu` = FUN_00575ca0 against `CsiHud` at dt 1 and 0.5): a float32 ulp of a citizen's yaw differs from the original in the shared walker (`src/game/walker.ts`, first at tick 5 of BSD3); a facing test that sits exactly on the boundary flips by one tick (MOVE_LSD3's bit 0x100
  cleared one tick later in 2 of 4000 compared ticks). No record differs. Not fixed (the island package's file); evidence in `m5-z07CSI-npc.mjs`.
* **Hidden-list visibility** is derived from the emulated set-up's flag-store order (rule in section 5), not by running the constructors inside the set-up emulation (the foundation hosts the attach); the other effects of the constructors that run at the attach (Control's variant
  words, the roster) are applied after the set-up (`constructCastleRoster`), which could only differ if set-up code read them back between the attach and the end of the set-up (not checked separately; no such read is known).
* **csi02a** (a script in the archive that no slot names) and **csi03** (no such file) are not played: the original never starts them either.
* **Bot shortcuts**: the three mini-games (z08BKD / z09JST / z10RGB) are left by the loop for real (hand-over, the mini-game's own zone loads) but completed with the node skip (`F9`, the mini-game's story condition) instead of played; their own work is the M6 tests'.
  The bot's key taps are held for 3 game ticks (>= 70 ms); the boat, walk and ride are steered by the arrow keys with a route from the game's own collision / the PATH map.
* **Saved games**: exact since WP-SAVE (docs/re/save.md): Control 12 bytes at +0x18, goblet 4, rat 20 and the horse's blocks are written and read like the original (`m8-save-csi`, `m8-save-nodes`).
* The wrapper's speech set-up (`FUN_00435b59` / `FUN_00435a07("medieval")`), `FUN_00443230` (the audio frame) and `FUN_0041adb5` are the shell's / audio host's.
* The foundation does not run the wrapper's `FUN_00421bbe(n)` itself; the port does it as `ensureCsiLooks` (decor, roster looks).

## 8. Status

**DONE** (see also `docs/re/m5/progress.md`). Bot `tools/steps/m5-z07CSI.mjs` (real key taps held 3 ticks = 100 ms, `&debug=1`, snapshot server 5518): the whole chapter, ALL OK (43 expectations, 0 bot helps in the last run): boat arrival at node 15 -> dock (Ctrl moors) -> csi01 -> Enter on a tree
(decor swap: slot counts down, variant word moves on) -> walk to the bridge -> [z08BKD left for real, completed with the node skip] -> csi02 -> a goblet (+1000, HUD counter) -> Bull castle gate -> csi04 -> story puts Pepper on the horse (node 21) -> ride along the PATH map to the Lion castle
-> csi05 -> node 22 (Dark Knight) -> ride to the bridge -> csi06 -> [z09JST] -> node 24 arrives ON THE HORSE (checked) -> csi07 -> ride -> csi08 -> [z10RGB] -> node 27 on foot -> csi09 -> node 28 (objective PORS) -> Ctrl at the boat -> node 29 -> sail to the portal -> island (z02LGI) node 30, PREV_SUBGAME 6.
Screenshots of `/tmp/m5-z07CSI` looked at: the landing cutscene with subtitle, the decor swap (round trees), the horse with the red bridge in view, the horse arriving at the Lion castle's gate after the joust (white horse, X1 / 1000 HUD), the island boat on arrival. Particles: `window.__particles.stats` showed up to 236 listed / 164 visible
effects over the run (armour.par / twinkle / cedric are wired; exact emitter positions are checked in the oracle tests with the recording fx, not by screenshot). Bot helps: the bot's steering is a plain key controller; when a tree / guard / cliff blocks it (`walkSmart`, `walkRoute`) it backs up like a player and after repeated failures puts Pepper (or the horse)
30 units on / on the next PATH node (logged `BOT-HELP`); the last run needed none. The page occasionally stops ticking under machine load (a watchdog in `walkTo` logs it): not seen in the game's own tests.

## 9. Shared-file edits (additive, surgical)

| file | edit | why |
|---|---|---|
| `src/hub/ctx.ts` | + `decorRender`, `baatat()`, `partMode()` (+ 2 imports) on `HubContext` | the castle's Enter decor swap needs the island's renderer hooks (same code as `IslandContext`) |
| `src/island/npc/human1.ts` | the single-waypoint path (`res === -1 && count === 1`) returns `NODE_NONE` (asm 0x4be7f8) instead of falling through to `NODE_STOP` (+ import) | found by `m5-z07CSI-npc` (the island test knew it as D4): the castle's guards walk single trips; the chain went on to the wrong node |
| `tools/lib/m7-isl-npc-emu.mjs` | the zone-directory regex of the file host accepts any `_data/zNNxxx/` (was `z02lgi`) | the NPC oracle now also runs the castle |
| `src/formats/emusetup.ts` | + `EmuAttach.storeIndex` (`stores.length` when the attach was hosted) | execution order of attach vs record stores: the hidden-list rule (section 5); no behaviour change for other zones |
| `tools/lib/m5-z07CSI-emu.mjs` | with `chain: true` the oracle shows the hidden-list records the set-up shows after Control's constructor (same rule) | the duel ran the constructor after the whole set-up |
