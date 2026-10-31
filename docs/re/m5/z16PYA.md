# z16PYA, the Pyramid (M5 hub worker PYA)

Zone table index 13 (`z90PYA`, archive `z16PYA`), story nodes **36** (arrival, ends at the sphinx entrance -> z17WAS), **38** (back from z17WAS, ends at the tomb door -> z18MMP) and **40** (back from z18MMP, ends
at the Speedster -> z20DSP). Wrapper `FUN_00675f02`, GameLoop `FUN_00675930`, set-up root `FUN_00676c22` -> `FUN_006768ce(1)` (bands `< 0x25` = `FUN_00678000`, `< 0x27` = `FUN_00677900`, `< 0x29` = `FUN_006775d0`,
else flags only), per-record name loop `FUN_00676482`, gems `FUN_006767f8`, slots `FUN_00676418`, per-frame HUD `FUN_006760d0` (+ `FUN_00676080`), sounds `FUN_006762a0`, teardown `FUN_00676ca2`
(`FUN_00423ad4` destroy every node + free both text tables: the framework's `destroyNodes` / `HubGame.destroy`).
Code `src/zones/z16PYA/` (`index.ts`, `peppsw.ts`, `roster.ts`, `hud.ts`); tests `tools/tests/m5-z16PYA-node.mjs` (147 checks), `tools/tests/m5-z16PYA-emu.mjs` (833 checks against the original's code);
bot `tools/steps/m5-z16PYA.mjs` (+ `lib-pya.mjs`); helpers `tools/lib/m5-z16PYA-load.mjs`, `tools/lib/m5-z16PYA-emu.mjs`.

## 1. What runs where

| piece | original | port |
|---|---|---|
| set-up: 39 / 30 / 26 attaches, boxes (`PM??` radius-height 1.6 / 16, `RK*` file boxes), `BL` / `BS` flags 0x10, cutscene slots, hint rows, PATH map, texts, objective, Pepper's place + yaw 1.5708 | `FUN_006768ce`, `FUN_00678000` / `677900` / `6775d0`, `FUN_00676482`, `FUN_00676418` | the emulation (`profile.emu`, src/hub); `arrival` in `index.ts` returns the emulated PEPP record's place and yaw (the symbolic default drops the yaw) |
| texts / objective of the bands | node 36: npc `advfsm2.str`, hologram `advHOL2.str`, arrow at record 24 (SPHX) r 16; node 38: `ADVHOL6.str`, record 23 (TEMP); node 40: `ADVHOL7.str`, record 112 (SPED) | `replaySetupState` of the framework (tested) |
| Pepper's mode switch **PeppSw** | ctor `FUN_00677350`, table 0x91efc0 `{update 0x676cd0, pre-render 0x676d95, destroy 0x677438, draw 0x6772b1, load 0x677312, save 0x6772ed, 0x677474}` | `peppsw.ts` |
| the roster of PeppSw's constructor `FUN_00698963` (decor group 3, the Speedster's looks, 15 hidden templates) | ctor tail, helpers `FUN_00698940` / `698da4` / `698e39` / `698e60` | `roster.ts` (+ the island's `VehicleLooks` / FX_Bricks) |
| HUD | `FUN_00676080` + `FUN_006760d0` (every pass of the loop, any mode) | `hud.ts` `PyaHud`, called from `frame` |
| 2D ambience | `FUN_004435a0(DAT_05d5bdac)` (0x323) and `(DAT_05d5bdb4)` (0x306) on every pass of mode 2 | `index.ts` `frame` |
| music | ctor `FUN_00443290("ad1T")`, loop `FUN_00443310(-2)` + `FUN_004432c0`; groove `level - 3` from PeppSw | start: `src/audio/zonemusic.ts` (`z16PYA: init, groove -2`); groove: `peppsw.ts` -> `ctx.musicGroove` |
| FX_Bricks / particles update | `FUN_00442930` = `FUN_00447de0` + `FUN_0044e8e0` every pass | `tickIslandBrickFx` in `frame` (particles: the framework / particle package) |
| teleport / fog / sea | `FUN_00676c22`: `FUN_00442d90(4, 400, 400, 100, 0xffff, 1)`, sea `DAT_009da858 = -400` (0xc3c80000), gravity `DAT_009da9bc = -10`, board record `DAT_009daa7c = 0x11` | emulation (`W.seaLevel -400`, `vehicles(w).board = 17` in `applyPyaSetup`) |

The zone's own sky `0x426915` is drawn by `src/render/environment.ts`. Not ported because the original never runs it: the second PeppSw class `FUN_00677521` (file PeppSw.c line 799, table 0x91efd8 = `FUN_00677474` over the empty list 0x91eff0):
nothing attaches it (dead code); `FUN_00676c87` (loader + `FUN_006768ce(0)`, never called). The load / save hooks of PeppSw (`FUN_006772ed` / `FUN_00677312`: 0x20 bytes at node + 0x18, then `FUN_00698940` re-run) are ported (`saveBlock` / `loadBlock`, `m8-save-hubs`, `m8-save-pyadip`).

## 2. PeppSw (`peppsw.ts`)

The Pyramid's copy of the island's PepSwitc (`src/island/vehicles/pepswitch.ts`), first on PEPP, gate var 0x5e mask 0 (always); then the grab node `0x62af8d` (mode 0x20), SGwalk (&1), sgswim (&2), skate (&4).
Differences from the island's, all in the code:
* no vehicles: no leaving a car (0x401), PORTAL_VEHICLE (var 0xbb) is not cleared, no story-node-0x1e hologram timer;
* update (returns 2): the temple's 3D sound (`DAT_05d5bdb0`, id 0x307) at record 23 (TEMP) + 0x3c every tick; `ftol(rand / 32767 * (float)(GetTickCount - start)) % 2000` hits 0x557 / 0x15c / 0x2a7 -> 2D sounds 0x30b / 0x30a / 0x309;
* pre-render: walking: Ctrl (pressed) and not mailbox 1, 2, 0x57, 0x1f, 0x38 and not clip 99 / 0x62 -> mode 4, state 0x16, board clip 1, board shown, sound 0x150; otherwise groove level 2 when Pepper's clip is 0x24 / 0x3f / 0x40, else 1;
  `y <= sea` (-400) -> mode 2, state 0x15 (island: `<` and state 0x62). Swimming: terrain one unit ahead (+4) ABOVE the sea (`<`; island `<=`) -> mode 1, state 0x25, no sound, Pepper stays. Board: not Ctrl / 0x1000 interact bit,
  or mailbox 0x20 / 0x32 -> level 3; else mode 1, state 0x1c, board clip 2, the eight rolling sounds stop, sound 0x106; water 4 ahead (mailbox not 0x20 / 0x21; no clip-0x16 test) -> the same. The state goes to the mailbox and Pepper's clip, the mode to var 0x5e
  (| the 0x1000 bit); when the level changed `FUN_00443310((byte)(level - 3))` (a signed byte: GUID_PerfMasterGrooveLevel).
* Enter (`DAT_00983840 & 0x10000`) -> `FUN_00698da4`, every tick `FUN_00698e39` = the island's `lookKey` / `tickLooks` with the Pyramid's roster (`roster.ts`).
* the constructor's `FUN_00443370()` (music notification poll) is not called: the audio queue is empty at set-up.
**Verified** with the original's pre-render and update run in the emulated machine (`m5-z16PYA-emu`, 833 checks): ~60 scripted states (walk / board / swim, every no-board mailbox state and clip, interact bit, water ahead off the map,
y around -400, Enter, modes 8 / 0x20 / 0x40 / 0x101 / 0x401, pending groove states): var 0x5e, mailbox, groove state, every animation start (Pepper / board), sounds played / stopped (the original stops eight handles, two with the same id 0x185:
compared as distinct ids), groove calls, the Enter / tick calls, the board's visibility; the update with scripted random numbers and clocks (the three hits, `+ 2000`, near misses, the temple sound position). The HUD function is run
60 steps against `FUN_006760d0` (texts, icon, blink timer, var 0xc reset) and `%04d` against the C runtime for negative numbers. The machine's walk sounds come from running the loaders `FUN_004b0b37` / `FUN_004b0f16` that SGwalk's constructor would run.

## 3. The roster (`roster.ts`)

`FUN_00698963` (run in the emulated machine after the set-up: the emulation spec of z16PYA got the native range 0x698940..0x698e80, shared `emusetup.ts` edit) writes: every variant word 0; the 15 records of the list 0x925a30 (PN00 .. TRBR) hidden (`flags &= ~2`)
and render mode 1; decor group 3 of the decor tables (48 records: PM00..PM23, BS00..BS08, OBL0..OBL9, JAK0 x2, JTHN, MPRD, DRKL) the variant word `set << 8 | 1 | variant << 16` (type 1); the roster `0x925a00` (one entry: SPED = record 112,
SwapText set 0x37, game variable 0x24) variant word 2 and its FX_Bricks effect (var 0x24, nine models `speedster08, 00 .. 07.txt`, nine stages). The record writes are made by `applyRosterRecords`, the brick registrations come from the run's
calls (`setup.calls`, applied when the brick manager is created). Enter near SPED (the nearest record with a variant word within sqrt(800) and in view) cycles its paint (sound 0x2c0, var 0x24, SwapText textures, brick morph): tested
(`m5-z16PYA-node`) and played by the bot. Enter near a type-1 record (the palms, bushes, obelisks, Johnny / Mrs Read / Dr Kilroy) = the outfit / decor model swap
`FUN_00420bb7` / `FUN_00420dc4`: wired since 2026-10-31 (`ensurePyaLooks` -> `startZoneDecor`, decor group 3, the island's `DecorState`; `m9-hub-decor` swaps a palm through Enter): 48 records in this zone; the stored decor (`decorStore`, what a save holds) is applied at the zone start like the wrapper's `FUN_00421bbe(3)`.

## 4. HUD (`hud.ts`)

The wrapper clears the HUD (`FUN_0045f9d2`), `FUN_00676080` loads the overlay set of the OASIS (`_data\Overlays\z14OSD\`: the Pyramid has none of its own; `onCreate` replaces the runner's empty `Overlays/z16PYA` set), left icon texture 0 (the gem),
centre text `%04d` of var 0x17, left text `x%d` = bits set in the low 10 bits of var 0xde (the gems: `FUN_006767f8` gives the n-th GEM record the bit 1 << n), column slot 0 = the interaction icon of var 0xc (0x20 -> 3, 1 -> 2, 0x1e -> 1 only while
PEPPER_CONTROL & 1, 0xc0 -> blinking 4 / 5 with `DAT_05d5bd9c`), then var 0xc = 0. Textures 4 / 5 of the blink are not used in the Pyramid (nothing sets 0x40 / 0x80).

## 5. Triggers and the story (all in the shared families, tested here)

* node 36: StartCSM #1 on SCRP (gate var 0xba bit 2 clear) starts slot 0 (ADV02) at once and sets 0xba |= 2; StartCSM #2 on SCRP waits at PATH node 0x17 (the sphinx entrance, radius 1.0 x 8, no key, icon bit 0x20) and sets **var 0xfe = 1** (S254): the FSM leaves for z17WAS.
* node 38: slot 1 (ADV03) with 0xba bit 4; PATH node 0x18 (the tomb door) sets var 0xff (S255) -> z18MMP.
* node 40: box portal on SPED (half extents 16 / 16 / 8, Ctrl) ORs var 0x100 |= 1 (S256) -> z20DSP. Ctrl icon (var 0xc bit 2) while near.
* arrival places: PATH 0x19 (2.0, 1.9, 313.8), 0x1a (74.1, -2.1, 261.3), 0x18 (82.9, 6.2, 56.4), yaw 1.5708, independent of the previous zone.
* The three nodes' hand-over is the story FSM (`StoryFsm.frame()` returns 6; tested: 36 -> 37 z17WAS (zone 14), 38 -> 39 z18MMP (15), 40 -> 41 z20DSP (16)).

## 6. The Oasis' shared nodes in this hub (verified for the Pyramid's arguments)

Gems (gate var 0xde, mask 1 << n, value 0; score vars 0x17 and 0xca += 1000; pick-up sound 0x2f1), scorpions SCR0..SCR9 (no argument block, gate 2 & 1) and the grab node on PEPP (pos 1, 0x5e & 0x20), tumbleweeds TUM0 / TUM1 (no argument block): attach sites
match what `src/zones/z14OSD` reads (node tests: GEM1 picked up -> bit 2, +1000, the HUD says `x1`; collected gems stay hidden at the next visit; a scorpion grabs Pepper and lets go; bot: SCR8 grab, GEM2). The Pyramid's sound loader
fills the scorpion globals with the same ids as the Oasis' (`0x5d5bc54..c78` 0x2fc, `c90` 0x2fe, `c94` 0x2fd, `c80` 0x308). **The Tumblewd sound globals `0x5d5bca0..cb8` are NOT loaded by the Pyramid's loader** (the original calls `FUN_004433f0(slot, position)` with the number the Oasis' loader stored there in an earlier visit of the same process, or with the BSS zero when the Oasis was not visited: slot numbers are indices into the 3D bank of the CURRENT zone, which `FUN_00874be4` fills in call order (every `FUN_004433b0` of the zone, including those of node constructors and of the shared loaders) and resets per zone WITHOUT clearing the entries, so an index beyond the Pyramid's own loads reads a stale entry of an earlier zone's bank. The sound that plays is a function of the whole process's load history; the port's set-up emulation does not run the node constructors and so does not know the real slot numbers: **cannot be reproduced exactly, the port is silent for them**; effect: at most a whoosh at the tumbleweeds in the Pyramid). The scorpions wander up the canyon walls like in the Oasis (same drift measured in both worlds: the Oasis' own oracle covers the node).
No difference to report to the OSD worker.

## 7. Particle emitters of this hub's code (listed, not wired here: all belong to shared nodes)

The Pyramid's own functions start none. Through the shared Gems node (`FUN_0062b220`): `GEM01.par` per gem (5, constructor 0x62b2f1, gate: emitting until picked up), `TWINKLE01.par` once (0x62b349, moved to the gem at 0x62b0a0 / 0x62b0b8, on at 0x62b0d1,
off 3 ticks later 0x62b1a0): wired by the OSD worker / particle package. `FUN_00442900("GENERICBITS")` in the root loads the particle bank.

## 8. Shared-file edits

* `src/formats/emusetup.ts`: `HUB_SPECS.z16pya` got `exec: [[0x698940, 0x698e80]]` (PeppSw's helpers behind the zone's region run natively so `setup.run(0x698963)` works). Set-up results unchanged (m5-foundation-emu green).
* nothing else outside `src/zones/z16PYA`, `tools/**/m5-z16PYA*`, `tools/steps/lib-pya.mjs`, this doc and progress.md. (`src/island/vehicles/looks.ts` already took the roster table as a parameter.)

## 9. What is not exact

Random numbers use `rand` of src/island/rng.ts on the shared `src/game/crt.ts` generator, the clock is the shared REAL zone clock (`msClock` = `GetTickCount() - base`, `src/zones/common/tickrand.ts`; `startTickClock()` = FUN_00435c81 runs in the hub's `onCreate` like the wrapper FUN_00675f02; the exported name `msClock` of `peppsw.ts` stays; `m5-z16PYA-emu` pins it with `setTickCountSource`; HUD blink counter also checked at dt 0.5); Tumblewd sounds (section 6).

## 10. Bot (`tools/steps/m5-z16PYA.mjs`, `lib-pya.mjs`; snapshot server port 5514)

Last run (all three nodes in one run, 1280x800, 29 PASS, `ALL CHECKS PASSED`): node 36: ADV02 plays and is skipped with Shift (12 taps), visit flag 0xba bit 2, objective arrow at SPHX + ADVHOL2, HUD on the Oasis overlay set (gem icon, `x0`, `0000`, talk icon),
a friend answers Shift ("Hee Pepper, hier is het lekker ..."), a scorpion (SCR8) grabs Pepper (var 0x5e bit 0x20) and lets go, GEM2 collected (var 0xde bit 4, score 1000, HUD `x1`), the PATH route to the sphinx entrance (node 0x17) -> story node 37, zone z17WAS;
node 38: ADV03 plays (screenshot: the friends in the sphinx hall, subtitle), flag 0xba bit 4, arrow at TEMP + ADVHOL6, route to the temple door (PATH 0x18) -> z18MMP; node 40: arrow at SPED + ADVHOL7, Pepper walks to the Speedster
(2058 - 2438 ticks, her own steering round the dunes), Enter changes its look (var 0x24 0 -> 1, the brick morph is on screen), Ctrl -> var 0x100 -> z20DSP. Screenshots looked at (`/tmp/m5-z16PYA/*.png`): cutscene ADV02 / ADV03, free HUD, talk, scorpion grab, gem, Speedster mid-morph with the Ctrl icon.
Keys: arrow keys / Alt (jump when stuck) / Shift / Enter / Ctrl are DOM keyboard events held for an exact number of simulation ticks counted inside the page (the page is far slower than real time on this loaded machine), Shift / Ctrl at the portal through Playwright's keyboard.
**Not played on foot (honest list)**: the bot's steering is crude (turn on the spot, walk, jump when stuck, no obstacle planning); 6 PATH legs of the sphinx / door routes did not finish in 700 ticks and were closed by putting Pepper on that node (`SHORTCUT` lines in the log, counted
at the end); GEM2 and the scorpion have no road: the bot is put 12 units from GEM2 / 5 - 6 units in front of SCR8 on flat ground and plays from there; between the gem and the sphinx it is put back at PATH node 0x19. The chapter skip brings each node up.

## 11. Notes on precision

The oracle machine runs the original's x87 code as the emulator does it (the tests pass at exact equality for the ints and the terrain-dependent decisions); PeppSw stores `fround` values where the original stores floats (the terrain probe points). Run `node tools/test-formats.mjs --only m5-z16PYA-emu,m5-z16PYA-node`.
