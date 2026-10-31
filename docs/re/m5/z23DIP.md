# z23DIP, the Dino island (zone table index 19, `z90DIP`, story nodes 47 and 50)

Hub worker "dip". Code: `src/zones/z23DIP/` (`index.ts` registration, `consts.ts`, `pepsw.ts`, `loon.ts`, `hud.ts`, `setup.ts`). Tests: `tools/tests/m5-z23DIP.mjs` (66 checks), `tools/tests/m5-z23DIP-emu.mjs`
(oracle, ~173 000 checks), oracle library `tools/lib/z23DIP-emu.mjs`. Bots: `tools/steps/m5-z23DIP-story.mjs` (+ `lib-z23DIP.mjs`, helpers `m5-z23DIP-walk/smoke/explore/dirtest.mjs`).
Route helper: `node tools/m5-z23DIP-route.mjs <from> <to>` (PATH hop matrix).

## 1. What runs where

| original | address | port |
|---|---|---|
| wrapper | `FUN_0072645c` | the runner / `registerHub` (sound loader `FUN_007267e0` and overlay `FUN_007265c0` run in the emulated set-up as `pre`; HUD overlay set `Overlays/z14OSD`: `HubSpec.overlay`, additive edit) |
| GameLoop | `FUN_00725ec1` | the shared hub loop (`src/hub/game.ts` + `playzone.ts`); music: `ZONE_MUSIC` (ad2, groove -2 at init) |
| set-up root / set-up | `FUN_007272ee` -> `FUN_0074fac5` (loader) + `FUN_00726e25` + `FUN_00726dbb` (2 cutscene slots ADV07 / ADV10) | **run in the x86 emulation** (foundation); bands `< 0x30` -> `FUN_0072a2b0` (435 lines), `< 0x33` and else -> `FUN_007283e0` (631 lines); sea -80, gravity -10, fog `FUN_00442d90`, 4 HUD hints, 5 gems (`FUN_0072698f`) |
| per-frame HUD | `FUN_00726610` | `hud.ts` `updateDipHud` (every loop pass, `spec.frame`) |
| teardown | `FUN_00727336` (-> `FUN_007272dd` -> engine free, text files freed) | nothing to port (engine); `DipPepSwitch.destroy` stops its 4 looping sounds (`FUN_00727f6c`) |
| PeppSw ctor / update / pre-render / destroy | `FUN_00727e84` / `FUN_00727360` / `FUN_007277f1` / `FUN_00727f6c` | `pepsw.ts` `DipPepSwitch` |
| balloon ctor / update | `FUN_007281aa` / `FUN_00727fe3` | `loon.ts` `LoonNode` |
| third class `FUN_00728333` (update `FUN_00728286` over the empty table 0x935278) | - | **dead**: no call, no table reference anywhere (asm search); not ported |
| `FUN_0043b64d` x 6 (node 50) | logged by the emulation (`animTime`) | `setup.ts` `applyAnimTimes` (token -> record via the emulated record array) |
| `FUN_007651a3` (PeppSw ctor's record writes) / `FUN_00420837(4)` | | `setup.ts` `applyDecorRecords` |

There is **no story handler** in this loop (foundation survey): the hologram texts (`advfsm3/advhol3` node 47, `advfsm4/advhol0` node 50) and the objective arrow (`FUN_00424270` at record 8 TREX / 12 PTER) are chosen by the set-up
and replayed by the framework (`replaySetupState`); the story FSM (src/shell/story.ts) ends the visit: node 47 completes when var 0x101 (SUBGAME 257) & 0x7fff == 2, node 50 when it == 1; 48 = z27TRX, 49 = z28HAT, 51 = z13CAI.

## 2. PeppSw (Pepper's mode switch of the Dino island)

Handler table 0x935230 = { update 0x727360, pre-render 0x7277f1, destroy 0x727f6c, draw 0x727de5 (default draw, returns 1), load 0x727e46, save 0x727e21 }. Chain on PEPP: PeppSw (gate var 0x5e mask 0), SGwalk (&1), sgswim (&2),
skateboard 0x43310c (&4). Differences to the island's `PepSwitc` (all verified by the oracle):

* no vehicles; no PORTAL_VEHICLE clear, no story-node-30 timer; sea -80;
* update (returns 2): the sound scape: 2D 0x30c every tick, 3D 0x30d at HALL (record 43); node 50 (node byte +0x20 = story node == 0x32): 3D 0x31d at PTER, 0x315 at REX4, the Rex step sounds 0x316..0x31c at **REX1's position** while the animation
  frame (ftol) of REX1/2/3/4/5/6/7 (records 11, 20, 21, 22, 23, 29, 30) is < 4, then three `rand()` draws per tick: `ftol(rand*300)` 298 -> 0x322, >= 299 -> 0x321 at BRON; `ftol(rand*60)` picks TRI2 / TRI1 / STE2 / STE1 / TRX2 / TRX1 (10 / 10 / 10 / 10 / 10 / 10)
  and `ftol(rand*300)` 297 -> 0x320, 298 -> 0x31f, >= 299 -> 0x31e at that creature. (`rand` = `src/island/rng.ts` on the shared `src/game/crt.ts` generator; `FUN_004388ae(x)` is float32, `ftol` of it exact.)
* pre-render: walking: Ctrl (unless mailbox 1 / 2 / 0x57 / 0x1f / 0x38 or clip 99 / 0x62) -> skateboard (mode 4, state 0x16, board clip 1, board shown, sound 0x150); otherwise level 1 (2 in clips 0x24 / 0x3f / 0x40); above the sea the place is remembered
  (node +0x24..0x2c), at or below it Pepper is put on the ground `FUN_0043cd62(pos, 4)` or back on the remembered place if there is none (the sea is never entered); "swimming" (control 2): same ground rule, then walk (mode 1) with state 0x25;
  skateboard: Ctrl or bit 0x1000 gets off (state 0x1c, board clip 2, 7 roll sounds stopped, sound 0x106) unless mailbox 0x20 / 0x32 (level 3); water 4 units ahead (ground <= sea, not in the air 0x20 / 0x21) also gets off. Then mailbox / clip start, var 0x5e write,
  `FUN_00443310(level - 3)` when the level changed, Enter -> `FUN_00765281`, every tick `FUN_00765316` (decor hooks, see 6).
* The generic set-up added a stub guard and an M1 `PepSwitc` to Pepper's chain; `dipAfterSetup` removes both (the original has neither).

## 3. Balloon (LOON, record 199, node 50)

Constructor: `y += 17.6`, base = y (done at the framework's `ctorInit`); update returns 0 while hidden (flags & 2 == 0) or a cutscene runs, else 1; hides at base + 56; vertical speed +0.032 * dt up to 0.4; from base + 6 it also drifts along +z (second speed, same ramp); both speeds multiplied by dt.
Visible at node 50 after the set-up (the emulated flags), so it rises as soon as no cutscene runs.

## 4. HUD (`FUN_00726610`)

Centre `"%04d"` var 0x17, left `"x%d"` (format 0x9351a8) popcount of the low 10 bits of var 0x3c, left icon = texture 0, column slot 0 = interaction icon of var 0xc (0x20 -> 3, 1 -> 2, 0x1e -> 1 while PEPPER_CONTROL & 1; 0xc0 -> blink 4 / 5 with a 1 * dt counter, 15 / 30; none -> -1), var 0xc := 0.
The set is `Overlays/z14OSD` (the wrapper's copy-paste: `FUN_007265c0` loads that directory); `HubSpec.overlay` loads it. Screenshot checked: gem icon, "X0", "0000".

## 5. Cutscenes, texts, arrival, hand-over

* Slots 0 / 1 = ADV07 / ADV10 (area `ai`, strings the same names), declared by the framework from the emulated `FUN_00726dbb`; both scripts exist (`missingCutscenes` empty).
* Node 47: LAND carries a StartCSM (shared `0x51e19c`): PATH waypoint 15 (31.4, 0.7, -95.4), radius 16 units, slot 0 (ADV07), then var 0x101 |= 2. TREX (record 8, MeetPepp 0x530d69) is the objective arrow target.
  Node 50: PTER carries a box portal (`0x51ea3c`, 12 x 28 x 12, var 0x101 = 1), balloon, Rex poses.
* Arrival (emulated, independent of the previous zone): node 47 (175.7, -6.6, 56.7), node 50 (106.5, 0.7, -39.3); control 1 (walking).
* `animTime` calls (node 50): REX2 = 7, REX3 = 2, REX4 = 5, REX5 = 10, REX6 = 12, REX7 = 9 (frames). Nothing in the zone advances them afterwards (the advance is the cutscene manager's `FUN_00459740`).
* `FUN_007651a3` (PeppSw ctor): every record's variant word := 0, the 16 decor templates of the list 0x93d590 (records 253..269 except 266) get flags := 0, decor group 4 (22 records: CGOG, TRI1..3, JOHN, PIPP, DOCK, huts ...) the variant word `set << 8 | 1 | variant << 16`.

## 6. Verification

`m5-z23DIP-emu`: the original's `FUN_00727360`, `FUN_007277f1`, `FUN_007281aa` / `FUN_00727fe3`, `FUN_00726610` are executed in the x86 interpreter after the DIP set-up (`IslandSetup.run`, tools/lib/z23DIP-emu.mjs: engine calls as hosts that log: sounds, groove, animation starts,
scripted terrain `FUN_0043cd62`, scripted `rand`, cutscene flag) and compared with the port tick by tick: 2 x 4000 random PeppSw states (all control modes, buttons, mailbox, clips, heights incl. the sea boundary, ground hits / misses, forward rows, REX frames, rare random branches) - place, var 0x5e, mailbox, clip, board flag,
animation starts, sounds (2D / 3D with positions, stops), groove, node words, decor calls; the balloon for 1200 ticks with random cutscene flags at dt 1 and 0.5; the HUD 3000 ticks at dt 1 and 0.5. It found one real error (the left text format `x%d`). The oracle reads the **port's** places of the sound records
(the constructors / walkers of the shared families move some records, e.g. PTER stands at (69.2, 0, -73.4) in the port, the emulation does not run constructors).
Gems 0x62b220 is z14OSD's (`src/zones/z14OSD/gems.ts`): the DIP attach blocks (var 0x3c, masks 1 2 4 8 0x10, value 0) match its gate; the score vars 0x17 / 0xca and the HUD popcount are consistent (bot: see below). Its sound handle DAT_009da8f4 (0x2f1) is loaded by the generic loader, not by DIP's.

## 6b. Bots (real key input, headless, muted; screenshots looked at)

`tools/steps/m5-z23DIP-story.mjs` (helpers `lib-z23DIP.mjs`: arrow keys held through the page keyboard, steering by the yaw error, detours when blocked; the route is the PATH hop route from `tools/m5-z23DIP-route.mjs`):
* **node 47** (`?zone=z23DIP&node=47`): arrival (175.7, -6.6, 56.7), HUD (gem icon, "X0", "0000": checked), walked 0 -> 1 -> 17 -> 18 -> 10 -> 13 -> 15 in ~900 ticks; at waypoint 15 the cutscene ADV07 starts (Pepper, an explorer and the T-Rex: screenshot checked), after it var 0x101 |= 2, story node 47 -> 48, the run leaves to **z27TRX** (zone index 20).
* **node 50**: the zone opens with a cutscene (letterboxed, LAND's StartCSM, var 0xba = 8: screenshot checked); then 24 -> 19 -> two free points east of the T-Rex pair (they block the PATH: TRX1 / TRX2 are solid, like in the original's set-up) -> 14; inside the Pterodactyl's box (the interact icon 2 shows in the HUD column: screenshot checked) Ctrl is tapped
  (the portal's key mask 0x10; the original has the same Ctrl / skateboard overlap and resolves it the same way: the portal sets PEPPER_CONTROL = 0x100 in the update, PeppSw's pre-render then has no case): var 0x101 = 1, node 50 -> 51, **z13CAI** (arrival from zone 19 in the emulated CAI set-up).
* The bot is timing sensitive (walking around actors can take 700..3800 ticks); it passed on the runs above, a stuck run reports `stuck` and the shot of the place.

## 7. Particle emitters

The zone's own code starts none. `FUN_007272ee` loads the set `GENERICBITS` (`FUN_00442900`, VA 0x7272f6: twinkle01/02, GEM01, paul01). Emitters of the shared nodes (Gems: GEM01 per gem + a shared TWINKLE01) are wired by the owner of those nodes (z14OSD).

## 8. Not exact / open

* **Enter near a decor figure** (`FUN_00765281` -> `FUN_00420bb7` / `FUN_00420dc4`, the outfit swap of JOHN / PIPP / DOCK / CGOG / TRI1..3 ...): wired since 2026-10-31 (`src/zones/z23DIP/decor.ts`: `dipDecorHooks` through `setDecorHooks`, the island's `VehicleLooks` / `DecorState` with decor group 4 and the empty roster 0x93d578; `FUN_00765180` = `applyDecorSets` + the roster is now part of `applyDecorRecords`; `m9-hub-decor` swaps a figure through Enter).
* PeppSw save / load handlers (`0x727e21` / `0x727e46`: node +0x18, 0x18 bytes) are ported (`saveBlock` / `loadBlock`, `m8-save-hubs`, `m8-save-pyadip`).
* The three Rex poses are frozen like in the original; the original's cutscene host advances them only during a cutscene.
* `rand` draws from the shared C runtime generator (WP-TIME); the oracle scripts it with `setRandSource`. All comparisons are tolerance 0 at dt 1 and 0.5.
* Shared-file edits: `src/hub/game.ts` (+ `HubSpec.overlay`, + `UiTextureSet` import), re-read before the edit; nothing else outside `src/zones/z23DIP/`, tests, bots, docs.
